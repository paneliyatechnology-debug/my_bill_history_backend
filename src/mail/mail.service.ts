import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import { safeSubject } from "./email.util";
import { EmailDetail, renderBrandedEmail, structurePlainText } from "./email-template";

export interface OutboundEmail {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  text: string;
  heading?: string;
  intro?: string;
  details?: EmailDetail[];
  note?: string;
  replyTo?: string;
}

export interface MailDeliveryResult {
  delivered: boolean;
  mode: "smtp" | "preview";
  message: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>("SMTP_HOST") && this.fromAddress());
  }

  fromAddress(): string {
    return (
      this.config.get<string>("SMTP_FROM") ||
      this.config.get<string>("SMTP_USER") ||
      ""
    );
  }

  async send(message: OutboundEmail): Promise<MailDeliveryResult> {
    const subject = safeSubject(message.subject);
    const text = message.text.slice(0, 8000);
    const structured = structurePlainText(text);
    const rendered = renderBrandedEmail({
      appName: this.appName(),
      heading: message.heading || subject,
      preheader: message.intro || structured.paragraphs[0] || subject,
      intro: message.intro,
      details: message.details?.length ? message.details : structured.details,
      paragraphs: message.intro ? structured.paragraphs : structured.paragraphs,
      note: message.note,
    });
    const html = rendered.html;
    const plain = rendered.text || text;

    return this.deliver({
      to: message.to,
      cc: message.cc,
      replyTo: message.replyTo,
      subject,
      text: plain,
      html,
    });
  }

  private async deliver(input: {
    to: string | string[];
    cc?: string | string[];
    replyTo?: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<MailDeliveryResult> {
    const subject = safeSubject(input.subject);
    if (!this.isConfigured()) {
      if (this.config.get<string>("NODE_ENV") === "production") {
        throw new ServiceUnavailableException({
          statusCode: 503,
          message:
            "Email delivery is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM.",
          messageGujarati:
            "ઈમેલ સેવા ગોઠવેલી નથી. SMTP સેટિંગ્સ ઉમેર્યા પછી ઈમેલ મોકલાશે.",
        });
      }
      this.logger.warn(
        `SMTP is not configured. Preview only. To=${this.join(input.to)} Subject="${subject}"`,
      );
      return {
        delivered: false,
        mode: "preview",
        message:
          "SMTP is not configured, so this email was not delivered to an inbox.",
      };
    }

    const port = Number(this.config.get<string>("SMTP_PORT") || 587);
    const secure =
      this.config.get<string>("SMTP_SECURE") === "true" || port === 465;
    const user = this.config.get<string>("SMTP_USER");
    const pass = this.config.get<string>("SMTP_PASS");

    const transport = nodemailer.createTransport({
      host: this.config.get<string>("SMTP_HOST"),
      port,
      secure,
      auth: user ? { user, pass: pass || "" } : undefined,
    });

    try {
      await transport.sendMail({
        from: this.fromAddress(),
        to: input.to,
        cc: input.cc,
        replyTo: input.replyTo,
        subject,
        text: input.text,
        html: input.html,
      });
    } catch (err) {
      this.logger.error(
        `SMTP send failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: "The email could not be delivered. Check the SMTP settings and try again.",
        messageGujarati:
          "ઈમેલ મોકલી શકાયો નથી. SMTP સેટિંગ્સ તપાસીને ફરી પ્રયાસ કરો.",
      });
    }

    return {
      delivered: true,
      mode: "smtp",
      message: "Email delivered.",
    };
  }

  async sendOtp(email: string, purposeLabel: string, code: string) {
    const appName = this.appName();
    const purpose = this.purposeCopy(purposeLabel);
    const rendered = renderBrandedEmail({
      appName,
      heading: "Your verification code",
      preheader: `Your ${appName} code is ${code}. It expires in 10 minutes.`,
      intro: purpose.en,
      code,
      codeCaption: "This code expires in 10 minutes. Do not share it with anyone.",
      copyUrl: this.copyLink(code, purposeLabel),
      gujaratiNote: `${purpose.gu} આ કોડ 10 મિનિટમાં સમાપ્ત થશે.`,
    });
    return this.deliver({
      to: email,
      subject: `${appName} verification code`,
      text: rendered.text,
      html: rendered.html,
    });
  }

  private copyLink(code: string, purposeLabel: string): string {
    const base = (this.config.get<string>("FRONTEND_URL") || "http://localhost:3000").replace(/\/$/, "");
    const key = purposeLabel.toLowerCase();
    const mode = key.includes("password") ? "forgot" : key.includes("email") ? "email" : "signup";
    return `${base}/copy-code?code=${encodeURIComponent(code)}&mode=${mode}`;
  }

  private appName(): string {
    return this.config.get<string>("NEXT_PUBLIC_APP_NAME") || "myownbillbook";
  }

  private purposeCopy(purposeLabel: string): { en: string; gu: string } {
    const key = purposeLabel.toLowerCase();
    if (key.includes("password")) {
      return {
        en: "Use this code to reset your password.",
        gu: "પાસવર્ડ રીસેટ કરવા માટે આ કોડ વાપરો.",
      };
    }
    if (key.includes("email")) {
      return {
        en: "Use this code to confirm your new email address.",
        gu: "નવો ઈમેલ પુષ્ટિ કરવા માટે આ કોડ વાપરો.",
      };
    }
    return {
      en: "Use this code to finish creating your account.",
      gu: "ખાતું બનાવવાનું પૂર્ણ કરવા માટે આ કોડ વાપરો.",
    };
  }

  private join(value: string | string[]): string {
    return Array.isArray(value) ? value.join(", ") : value;
  }

}

