import { createHmac, randomInt, timingSafeEqual } from "crypto";

export const OTP_PURPOSES = ["REGISTER", "PASSWORD_RESET", "EMAIL_CHANGE"] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function isDeliverableEmail(email: string): boolean {
  if (!EMAIL_RE.test(email) || email.length > 150) return false;
  if (email.endsWith("@billing.local") || email.endsWith("@example.local")) return false;
  return true;
}

export function generateOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

export function hashOtp(
  pepper: string,
  email: string,
  purpose: string,
  code: string,
): string {
  return createHmac("sha256", pepper)
    .update(`${purpose}|${email}|${code}`)
    .digest("hex");
}

export function otpMatches(
  pepper: string,
  email: string,
  purpose: string,
  code: string,
  codeHash: string,
): boolean {
  const next = hashOtp(pepper, email, purpose, code);
  const left = Buffer.from(next);
  const right = Buffer.from(String(codeHash || ""));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function safeSubject(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 180);
}
