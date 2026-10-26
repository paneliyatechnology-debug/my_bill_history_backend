import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX = "gstsec1";

export interface CredentialKey {
  id: string;
  key: Buffer;
}

export interface CredentialKeyRing {
  current?: CredentialKey;
  previous?: CredentialKey;
  error?: string;
}

export function decodeCredentialKey(value: string | undefined, id: string): CredentialKey | { error: string } {
  if (!value || !value.trim()) return { error: "GST credential encryption key is missing." };
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== 32) return { error: "GST credential encryption key must decode to 32 bytes." };
  if (!id.trim()) return { error: "GST credential key id is missing." };
  return { id: id.trim(), key };
}

export function loadCredentialKeyRing(env: NodeJS.ProcessEnv = process.env): CredentialKeyRing {
  const currentRaw = env.GST_CREDENTIALS_ENCRYPTION_KEY;
  if (!currentRaw) return { error: "GST_CREDENTIALS_ENCRYPTION_KEY is not configured." };
  const current = decodeCredentialKey(currentRaw, env.GST_CREDENTIALS_KEY_ID || "current");
  if ("error" in current) return { error: current.error };
  const ring: CredentialKeyRing = { current };
  if (env.GST_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS) {
    const previous = decodeCredentialKey(
      env.GST_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS,
      env.GST_CREDENTIALS_KEY_ID_PREVIOUS || "previous",
    );
    if ("error" in previous) return { error: previous.error };
    ring.previous = previous;
  }
  return ring;
}

export function sealSecret(
  plaintext: string,
  key: CredentialKey,
  environment: "SANDBOX" | "PRODUCTION",
): string {
  if (!plaintext) throw new Error("Refusing to seal an empty provider secret.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(Buffer.from(`${environment}|${key.id}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, environment, key.id, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function openSecret(
  sealed: string,
  ring: CredentialKeyRing,
  environment: "SANDBOX" | "PRODUCTION",
): string {
  if (ring.error || !ring.current) {
    throw new Error(ring.error || "GST credential encryption key is not configured.");
  }
  const parts = sealed.split(".");
  if (parts.length !== 6 || parts[0] !== PREFIX) throw new Error("Provider secret ciphertext is not recognized.");
  const [, sealedEnvironment, keyId, ivText, tagText, dataText] = parts;
  if (sealedEnvironment !== environment) {
    throw new Error("Sandbox and production provider secrets cannot be opened for each other.");
  }
  const key = [ring.current, ring.previous].find((candidate) => candidate?.id === keyId);
  if (!key) throw new Error("No configured key can open this provider secret.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(ivText, "base64url"));
    decipher.setAAD(Buffer.from(`${environment}|${key.id}`, "utf8"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    throw new Error("Provider secret ciphertext failed authentication.");
  }
}

export function redactSecrets(text: string, secrets: Array<string | undefined | null>): string {
  let output = text;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(escaped, "g"), "[REDACTED]");
  }
  return output;
}

export function keysAreEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
