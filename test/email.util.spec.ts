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
      heading: "Your verification code",
      code: "123456",
      copyUrl: "http://localhost:3000/copy-code?code=123456&mode=forgot",
      details: [{ label: "Party", value: "<script>" }],
    });
    expect(rendered.html).toContain("myown");
    expect(rendered.html).toContain("billbook");
    expect(rendered.html).toContain(">123456<");
    expect(rendered.html).toContain("Copy code");
    expect(rendered.html).toContain("http://localhost:3000/copy-code?code=123456");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.text).toContain("Copy this code: 123456");
  });
});
