import { describe, expect, it } from "vitest";
import {
  hashOtp,
  isDeliverableEmail,
  normalizeEmail,
  otpMatches,
} from "../src/mail/email.util";
import { renderBrandedEmail, structurePlainText } from "../src/mail/email-template";

describe("email helpers", () => {
  it("normalizes and rejects placeholder inboxes", () => {
    expect(normalizeEmail("  Owner@Gmail.com ")).toBe("owner@gmail.com");
    expect(isDeliverableEmail("owner@gmail.com")).toBe(true);
    expect(isDeliverableEmail("9898990001@billing.local")).toBe(false);
    expect(isDeliverableEmail("not-an-email")).toBe(false);
  });

  it("matches an OTP only for the same email and purpose", () => {
    const pepper = "test-pepper";
    const hash = hashOtp(pepper, "owner@gmail.com", "REGISTER", "123456");
    expect(otpMatches(pepper, "owner@gmail.com", "REGISTER", "123456", hash)).toBe(true);
    expect(otpMatches(pepper, "owner@gmail.com", "REGISTER", "000000", hash)).toBe(false);
    expect(otpMatches(pepper, "other@gmail.com", "REGISTER", "123456", hash)).toBe(false);
    expect(otpMatches(pepper, "owner@gmail.com", "PASSWORD_RESET", "123456", hash)).toBe(false);
  });

  it("renders a branded message with a code and escaped details", () => {
    const parsed = structurePlainText("Invoice: INV-1\nGrand total: ₹100.00\n\nPlease review it.");
    expect(parsed.details).toEqual([
      { label: "Invoice", value: "INV-1" },
      { label: "Grand total", value: "₹100.00" },
    ]);
    expect(parsed.paragraphs).toEqual(["Please review it."]);

    const rendered = renderBrandedEmail({
      heading: "Verification Code",
      code: "123456",
      actionUrl: "http://localhost:3000/login?mode=forgot&otp=123456",
      details: [{ label: "Party", value: "<script>" }],
    });
    expect(rendered.html).toContain("myown");
    expect(rendered.html).toContain("billbook");
    expect(rendered.html).toContain(">123456<");
    expect(rendered.html).toContain("Security Verification Code");
    expect(rendered.html).toContain("Click code to select");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("GST Verified");
    // Ensure 100% English only - no Gujarati characters in email
    expect(rendered.html).not.toMatch(/[\u0A80-\u0AFF]/);
    expect(rendered.text).not.toMatch(/[\u0A80-\u0AFF]/);
    expect(rendered.text).toContain("Verification Code: 123456");
  });

  it("renders an enterprise-grade sales invoice email with hero amount card and CTA", () => {
    const rendered = renderBrandedEmail({
      heading: "Invoice INV/26-27/0004",
      intro: "JMK shared this tax invoice with you.",
      companyName: "JMK",
      actionUrl: "http://localhost:3000/sales/invoices/123",
      actionLabel: "View & Download Invoice →",
      details: [
        { label: "Invoice Number", value: "INV/26-27/0004" },
        { label: "Invoice Date", value: "18/11/2026" },
        { label: "Billed To", value: "Jaydeep" },
        { label: "Grand Total", value: "₹ 9,45,000.00" },
        { label: "Balance", value: "₹ 0.00" },
      ],
      paragraphs: ["Thank you for your business. Please reach out if you have any questions."],
    });

    expect(rendered.html).toContain("Invoice INV/26-27/0004");
    expect(rendered.html).toContain("JMK");
    expect(rendered.html).toContain("₹ 9,45,000.00");
    expect(rendered.html).toContain("Paid in Full");
    expect(rendered.html).toContain("View &amp; Download Invoice");
    expect(rendered.html).toContain("http://localhost:3000/sales/invoices/123");
    // Explicitly verify AI-style badges and Gujarati text are completely absent
    expect(rendered.html).not.toContain("GST Verified");
    expect(rendered.html).not.toMatch(/[\u0A80-\u0AFF]/);
    expect(rendered.text).not.toMatch(/[\u0A80-\u0AFF]/);
  });
});
