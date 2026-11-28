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

import { EmailCategory } from "./email-template";

interface SendMailAttachmentDto {
  filename?: string;
  contentBase64?: string;
  contentType?: string;
}

interface SendMailDto {
  to: string;
  cc?: string;
  subject: string;
  text: string;
  category?: EmailCategory;
  heading?: string;
  intro?: string;
  note?: string;
  details?: Array<{ label?: string; value?: string }>;
  replyTo?: string;
  actionUrl?: string;
  actionLabel?: string;
  companyName?: string;
  attachments?: SendMailAttachmentDto[];
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

    const attachments = Array.isArray(dto.attachments)
      ? dto.attachments
          .map((att) => {
            const raw = String(att?.contentBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();
            if (!raw) return null;
            const buf = Buffer.from(raw, "base64");
            if (buf.length === 0 || buf.length > 10 * 1024 * 1024) return null;
            const safeName = String(att?.filename || "document.pdf")
              .replace(/[^\w.\-() ]+/g, "_")
              .slice(0, 120);
            return {
              filename: safeName || "document.pdf",
              content: buf,
              contentType: String(att?.contentType || "application/pdf").slice(0, 100),
            };
          })
          .filter((att): att is NonNullable<typeof att> => att !== null)
          .slice(0, 5)
      : undefined;

    return this.mail.send({
      to,
      cc: cc || undefined,
      replyTo: replyTo || undefined,
      subject,
      category: dto.category,
      heading: String(dto.heading || "").trim() || undefined,
      intro: String(dto.intro || "").trim() || undefined,
      note: String(dto.note || "").trim() || undefined,
      actionUrl: String(dto.actionUrl || "").trim() || undefined,
      actionLabel: String(dto.actionLabel || "").trim() || undefined,
      companyName: String(dto.companyName || "").trim() || undefined,
      details,
      text,
      attachments,
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
      category: "support",
      companyName: "myownbillbook Support",
      subject,
      heading: subject,
      intro: supportMissing
        ? "This is a copy of your support request. Our support inbox is currently being configured."
        : "A new support request has been submitted from myownbillbook.",
      details,
      note: supportMissing
        ? "Please keep this confirmation for your records."
        : "Our support team typically responds within 2–4 business hours.",
      text,
    });
  }
}
