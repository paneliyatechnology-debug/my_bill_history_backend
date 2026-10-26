import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { MailService } from "../mail/mail.service";
import {
  OtpPurpose,
  generateOtpCode,
  hashOtp,
  isDeliverableEmail,
  normalizeEmail,
  otpMatches,
} from "../mail/email.util";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

const PURPOSE_LABEL: Record<OtpPurpose, string> = {
  REGISTER: "new account registration",
  PASSWORD_RESET: "password reset",
  EMAIL_CHANGE: "email address change",
};

@Injectable()
export class EmailOtpService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  requiresVerification(): boolean {
    return (
      process.env.SKIP_EMAIL_OTP !== "true" &&
      this.config.get<string>("SKIP_EMAIL_OTP") !== "true"
    );
  }

  private pepper(): string {
    return (
      this.config.get<string>("JWT_SECRET") ||
      "dev-super-secure-jwt-secret-key-at-least-32-chars-long-123456"
    );
  }

  async send(input: { email: string; purpose: OtpPurpose; phone?: string }) {
    const email = normalizeEmail(input.email);
    const purpose = input.purpose;

    if (!isDeliverableEmail(email)) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Enter a real email address. Placeholder addresses cannot receive a code.",
        messageGujarati:
          "ખરો ઈમેલ સરનામું દાખલ કરો. ખોટા સરનામા પર કોડ મોકલી શકાતો નથી.",
      });
    }

    if (purpose === "REGISTER") {
      const phone = String(input.phone || "").trim();
      if (phone.replace(/\D/g, "").length < 10) {
        throw new BadRequestException({
          statusCode: 400,
          message: "Enter a 10-digit phone number before requesting the email code.",
          messageGujarati: "ઈમેલ કોડ માંગતા પહેલા 10 અંકનો મોબાઇલ નંબર દાખલ કરો.",
        });
      }
      const existing = await this.prisma.user.findFirst({
        where: {
          OR: [
            { phone },
            { email: { equals: email, mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException({
          statusCode: 409,
          message: "A user with this phone number or email already exists.",
          messageGujarati:
            "આ ફોન નંબર અથવા ઈમેલ ધરાવતો વપરાશકર્તા પહેલેથી જ હાજર છે.",
        });
      }
    }

    if (purpose === "PASSWORD_RESET") {
      const user = await this.prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" }, isActive: true },
        select: { id: true, email: true },
      });
      if (!user || !isDeliverableEmail(normalizeEmail(user.email))) {
        return {
          sent: true,
          delivered: false,
          expiresInSeconds: 600,
          message:
            "If an account with this email exists, a verification code has been sent.",
        };
      }
    }

    if (purpose === "EMAIL_CHANGE") {
      const taken = await this.prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException({
          statusCode: 409,
          message: "This email is already used by another account.",
          messageGujarati: "આ ઈમેલ બીજા ખાતા સાથે પહેલેથી જોડાયેલો છે.",
        });
      }
    }

    const latest = await this.prisma.emailOtp.findFirst({
      where: { email, purpose, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      throw new HttpException(
        {
          statusCode: 429,
          message: "Please wait a minute before requesting another code.",
          messageGujarati: "બીજો કોડ માંગતા પહેલા એક મિનિટ રાહ જુઓ.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = generateOtpCode();
    const codeHash = hashOtp(this.pepper(), email, purpose, code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.prisma.executeBypassRls(async (tx) => {
      await tx.emailOtp.updateMany({
        where: { email, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.emailOtp.create({
        data: { email, purpose, codeHash, expiresAt },
      });
    });

    let delivery;
    try {
      delivery = await this.mail.sendOtp(email, PURPOSE_LABEL[purpose], code);
    } catch (err) {
      await this.prisma.emailOtp.updateMany({
        where: { email, purpose, codeHash, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      throw err;
    }

    const preview =
      delivery.mode === "preview" && this.config.get<string>("NODE_ENV") !== "production"
        ? code
        : undefined;

    return {
      sent: true,
      delivered: delivery.delivered,
      mode: delivery.mode,
      expiresInSeconds: 600,
      devOtp: preview,
      message: delivery.delivered
        ? "Verification code sent to your email."
        : delivery.message,
    };
  }

  async consume(emailInput: string, purpose: OtpPurpose, codeInput: string) {
    const email = normalizeEmail(emailInput);
    const code = String(codeInput || "").trim();
    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Enter the 6-digit code from your email.",
        messageGujarati: "ઈમેલમાંથી 6 અંકનો કોડ દાખલ કરો.",
      });
    }

    const row = await this.prisma.emailOtp.findFirst({
      where: { email, purpose, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!row || row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        statusCode: 400,
        message: "This verification code is invalid or expired. Request a new code.",
        messageGujarati: "આ ચકાસણી કોડ અમાન્ય અથવા સમાપ્ત થયેલો છે. નવો કોડ માંગો.",
      });
    }

    if (row.attempts >= MAX_ATTEMPTS) {
      await this.prisma.emailOtp.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      });
      throw new HttpException(
        {
          statusCode: 429,
          message: "Too many incorrect attempts. Request a new code.",
          messageGujarati: "ખોટા પ્રયાસો વધી ગયા. નવો કોડ માંગો.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!otpMatches(this.pepper(), email, purpose, code, row.codeHash)) {
      await this.prisma.emailOtp.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException({
        statusCode: 400,
        message: "The verification code does not match.",
        messageGujarati: "ચકાસણી કોડ મળતો નથી.",
      });
    }

    const consumed = await this.prisma.emailOtp.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new BadRequestException({
        statusCode: 400,
        message: "This verification code was already used.",
        messageGujarati: "આ ચકાસણી કોડ પહેલેથી વાપરાઈ ગયો છે.",
      });
    }
  }

  async findActiveUserByEmail(emailInput: string) {
    const email = normalizeEmail(emailInput);
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, isActive: true },
    });
    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        message: "No active account was found for this email.",
        messageGujarati: "આ ઈમેલ સાથે સક્રિય ખાતું મળ્યું નથી.",
      });
    }
    return user;
  }
}
