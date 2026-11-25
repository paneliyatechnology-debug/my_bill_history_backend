import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordHash",
  "refreshTokenHash",
  "otpHash",
  "secretKey",
  "apiSecret",
  "encryptionKey",
]);

function sanitizeSensitiveFields(value: unknown, seen = new WeakSet()): unknown {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSensitiveFields(item, seen));
  }

  const record = value as Record<string, unknown>;
  // Preserve Prisma Decimal / custom objects with toJSON
  if (typeof record.toJSON === "function") {
    return value;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (SENSITIVE_KEYS.has(k)) {
      continue;
    }
    cleaned[k] = sanitizeSensitiveFields(v, seen);
  }
  return cleaned;
}

@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(map((data) => sanitizeSensitiveFields(data)));
  }
}
