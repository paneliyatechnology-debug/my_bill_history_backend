import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";

@Injectable()
export class CredentialCryptoService {
  private readonly logger = new Logger(CredentialCryptoService.name);
  private readonly secretKey: Buffer;

  constructor(private readonly config: ConfigService) {
    const rawSecret =
      this.config.get<string>("JWT_SECRET") ||
      this.config.get<string>("APP_SECRET") ||
      "super-secret-encryption-master-key-default-32-bytes";

    // Derive a fixed 32-byte key using SHA-256
    this.secretKey = crypto.createHash("sha256").update(rawSecret).digest();
  }

  /**
   * Encrypts plaintext string using AES-256-GCM.
   * Returns base64 string formatted as: `iv:authTag:ciphertext`
   */
  encrypt(plaintext: string | null | undefined): string | null {
    if (!plaintext || plaintext.trim().length === 0) {
      return null;
    }

    try {
      const iv = crypto.randomBytes(12); // standard 96-bit IV for GCM
      const cipher = crypto.createCipheriv("aes-256-gcm", this.secretKey, iv);
      let encrypted = cipher.update(plaintext, "utf8", "base64");
      encrypted += cipher.final("base64");
      const authTag = cipher.getAuthTag();

      return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
    } catch (err: any) {
      this.logger.error(`Encryption failed: ${err.message}`);
      throw new Error("Failed to securely encrypt sensitive credential");
    }
  }

  /**
   * Decrypts ciphertext formatted as: `iv:authTag:ciphertext`
   */
  decrypt(ciphertext: string | null | undefined): string | null {
    if (!ciphertext || ciphertext.trim().length === 0) {
      return null;
    }

    // If string does not contain colon delimiter, it might be unencrypted legacy or plaintext
    if (!ciphertext.includes(":")) {
      return ciphertext;
    }

    try {
      const parts = ciphertext.split(":");
      if (parts.length !== 3) {
        return ciphertext; // Fallback
      }

      const [ivBase64, authTagBase64, encryptedBase64] = parts;
      const iv = Buffer.from(ivBase64, "base64");
      const authTag = Buffer.from(authTagBase64, "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.secretKey, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedBase64, "base64", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (err: any) {
      this.logger.warn(`Decryption failed or invalid key: ${err.message}`);
      return null;
    }
  }

  /**
   * Masks sensitive credentials for display in frontend (e.g. "AC••••••••••••1234")
   */
  maskSecret(secret: string | null | undefined, visibleChars = 4): string {
    if (!secret || secret.trim().length === 0) {
      return "";
    }
    const clean = secret.trim();
    if (clean.length <= visibleChars * 2) {
      return "••••••••";
    }
    const start = clean.slice(0, 2);
    const end = clean.slice(-visibleChars);
    return `${start}••••••••${end}`;
  }

  /**
   * Validates Twilio Webhook Signature (HMAC-SHA1)
   */
  verifyTwilioSignature(
    expectedSignature: string,
    authToken: string,
    url: string,
    params: Record<string, any> = {},
  ): boolean {
    if (!expectedSignature || !authToken || !url) {
      return false;
    }

    try {
      // Sort parameter keys alphabetically
      const sortedKeys = Object.keys(params).sort();
      let data = url;
      for (const key of sortedKeys) {
        data += `${key}${params[key]}`;
      }

      const hmac = crypto.createHmac("sha1", authToken);
      hmac.update(data, "utf8");
      const calculatedSignature = hmac.digest("base64");

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(calculatedSignature),
      );
    } catch {
      return false;
    }
  }

  /**
   * Generic Webhook Token Verification
   */
  verifyWebhookToken(providedToken: string, configuredSecret: string): boolean {
    if (!providedToken || !configuredSecret) {
      return false;
    }
    try {
      const a = Buffer.from(providedToken.trim());
      const b = Buffer.from(configuredSecret.trim());
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}

