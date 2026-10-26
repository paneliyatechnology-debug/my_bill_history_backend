import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import { MailService } from "./mail.service";
import { isDeliverableEmail, normalizeEmail } from "./email.util";

interface SendMailDto {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  heading?: string;
  intro?: string;
  note?: string;
  details?: Array<{ label?: string; value?: string }>;
  replyTo?: string;
}

@Controller("mail")
export class MailController {
  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  @Throttle({
    default: { limit: process.env.NODE_ENV === "test" ? 1000 : 20, ttl: 60000 },
  })
  @Post("send")
  @HttpCode(HttpStatus.OK)
  async send(@Body() dto: SendMailDto) {
    const to = normalizeEmail(dto?.to);
    const cc = dto?.cc ? normalizeEmail(dto.cc) : "";
    const subject = String(dto?.subject || "").trim();
    const text = String(dto?.text || "").trim();
    const replyTo = dto?.replyTo ? normalizeEmail(dto.replyTo) : "";

    if (!isDeliverableEmail(to)) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Enter a valid recipient email address.",
        messageGujarati: "માન્ય પ્રાપ્તકર્તા ઈમેલ દાખલ કરો.",
      });
    }
    if (cc && !isDeliverableEmail(cc)) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Enter a valid CC email address.",
        messageGujarati: "માન્ય CC ઈમેલ દાખલ કરો.",
      });
    }
    if (replyTo && !isDeliverableEmail(replyTo)) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Enter a valid reply-to email address.",
        messageGujarati: "માન્ય reply-to ઈમેલ દાખલ કરો.",
      });
    }
    if (subject.length < 3 || text.length < 3) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Email subject and message are required.",
        messageGujarati: "ઈમેલ વિષય અને સંદેશ જરૂરી છે.",
      });
    }

    const details = Array.isArray(dto.details)
      ? dto.details
          .map((row) => ({
            label: String(row?.label || "").trim().slice(0, 48),
            value: String(row?.value || "").trim().slice(0, 240),
          }))
          .filter((row) => row.label && row.value)
          .slice(0, 20)
      : undefined;

    return this.mail.send({
      to,
      cc: cc || undefined,
      replyTo: replyTo || undefined,
      subject,
      heading: String(dto.heading || "").trim() || undefined,
      intro: String(dto.intro || "").trim() || undefined,
      note: String(dto.note || "").trim() || undefined,
      details,
      text,
    });
  }

  @Throttle({
    default: { limit: process.env.NODE_ENV === "test" ? 1000 : 10, ttl: 60000 },
  })
  @Post("support")
  @HttpCode(HttpStatus.OK)
  async support(
    @Body()
    body: { name?: string; phone?: string; email?: string; subject?: string; text?: string },
  ) {
    const replyTo = normalizeEmail(body?.email);
    const subject = String(body?.subject || "").trim();
    const text = String(body?.text || "").trim();
    if (!isDeliverableEmail(replyTo)) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Enter a real email so we can reply.",
        messageGujarati: "જવાબ માટે ખરો ઈમેલ દાખલ કરો.",
      });
    }
    if (subject.length < 3 || text.length < 3) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Subject and message are required.",
        messageGujarati: "વિષય અને સંદેશ જરૂરી છે.",
      });
    }

    const support = normalizeEmail(this.config.get<string>("SUPPORT_EMAIL") || "");
    const details = [
      { label: "Name", value: String(body?.name || "").trim() || "Not provided" },
      { label: "Phone", value: String(body?.phone || "").trim() || "Not provided" },
      { label: "Email", value: replyTo },
    ];
    const supportMissing = !isDeliverableEmail(support);

    return this.mail.send({
      to: supportMissing ? replyTo : support,
      cc: supportMissing ? undefined : replyTo,
      replyTo,
      subject,
      heading: subject,
      intro: supportMissing
        ? "This is a copy of your request. The support inbox is not configured yet."
        : "A new request was sent from myownbillbook.",
      details,
      text,
    });
  }
}
