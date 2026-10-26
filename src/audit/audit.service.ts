import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import { Prisma } from "@billing/database";
import { DatabaseService } from "../database/database.service";

export interface AuditLogOptions {
  organizationId: string;
  companyId: string;
  userId: string;
  action: string;
  entityName: string;
  entityId: string;
  previousState?: Record<string, any> | null;
  newState?: Record<string, any> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  strict?: boolean;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "password_hash",
  "token",
  "refreshtoken",
  "refresh_token",
  "secret",
  "clientsecret",
  "client_secret",
  "authorization",
]);

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: DatabaseService) {}

  /**
   * Deterministic Canonical JSON Serialization (RFC 8785 principles)
   * Ensures nested object key ordering, Unicode, null values, numbers, arrays, and dates are strictly deterministic.
   */
  canonicalJsonStringify(value: any): string {
    if (value === null || value === undefined) {
      return "null";
    }
    if (typeof value === "boolean" || typeof value === "number") {
      return JSON.stringify(value);
    }
    if (typeof value === "string") {
      return JSON.stringify(value);
    }
    if (value instanceof Date) {
      return JSON.stringify(value.toISOString());
    }
    if (Array.isArray(value)) {
      return (
        "[" +
        value
          .map((item) =>
            this.canonicalJsonStringify(item === undefined ? null : item),
          )
          .join(",") +
        "]"
      );
    }
    if (typeof value === "object") {
      const keys = Object.keys(value).sort();
      const entries: string[] = [];
      for (const key of keys) {
        const v = value[key];
        if (
          v !== undefined &&
          typeof v !== "function" &&
          typeof v !== "symbol"
        ) {
          entries.push(
            JSON.stringify(key) + ":" + this.canonicalJsonStringify(v),
          );
        }
      }
      return "{" + entries.join(",") + "}";
    }
    return JSON.stringify(value);
  }

  /**
   * Generates a stable pair of 32-bit signed integers for PostgreSQL transaction-scoped advisory locks.
   * Lock key is derived deterministically from the organization and company UUIDs.
   */
  getAdvisoryLockKeys(
    organizationId: string,
    companyId: string,
  ): [number, number] {
    const hash = crypto
      .createHash("sha256")
      .update(`${organizationId}:${companyId}`)
      .digest();
    return [hash.readInt32BE(0), hash.readInt32BE(4)];
  }

  /**
   * Sanitizes payload by stripping sensitive credentials before hashing or storing
   */
  sanitizePayload(data: any): any {
    if (!data || typeof data !== "object") {
      return data;
    }

    let normalized = data;
    try {
      normalized = JSON.parse(JSON.stringify(data));
    } catch {
      normalized = data;
    }

    if (Array.isArray(normalized)) {
      return normalized.map((item) => this.sanitizePayload(item));
    }

    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(normalized)) {
      const lower = key.toLowerCase();
      const isSensitive =
        SENSITIVE_KEYS.has(lower) ||
        lower.includes("password") ||
        lower.includes("token") ||
        lower.includes("secret") ||
        lower.includes("privatekey") ||
        lower.includes("credential");

      if (isSensitive) {
        clean[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        clean[key] = this.sanitizePayload(value);
      } else {
        clean[key] = value;
      }
    }
    return clean;
  }

  /**
   * Computes the canonical record hash given a previous hash and action parameters.
   */
  computeCanonicalHash(
    prevHash: string,
    action: string,
    entityName: string,
    entityId: string,
    payload: any,
  ): string {
    const canonicalPayload = this.canonicalJsonStringify(payload || {});
    const dataToHash = `${prevHash}|${action}|${entityName}|${entityId}|${canonicalPayload}`;
    return crypto.createHash("sha256").update(dataToHash).digest("hex");
  }

  /**
   * Verifies an individual audit record hash against v2 (canonical) and v1 (legacy JSON.stringify) formats.
   */
  verifyRecord(record: {
    prevHash: string | null;
    action: string;
    entityName: string;
    entityId: string;
    newState?: any;
    recordHash: string;
  }): { isValid: boolean; version: "v2_canonical" | "v1_legacy" | "invalid" } {
    const effectivePrevHash = record.prevHash || "0".repeat(64);
    // 1. Check v2_canonical
    const canonicalHash = this.computeCanonicalHash(
      effectivePrevHash,
      record.action,
      record.entityName,
      record.entityId,
      record.newState,
    );
    if (record.recordHash === canonicalHash) {
      return { isValid: true, version: "v2_canonical" };
    }

    // 2. Check v1_legacy (for backwards compatibility with historic records)
    const legacyPayload = JSON.stringify(record.newState || {});
    const legacyDataToHash = `${effectivePrevHash}|${record.action}|${record.entityName}|${record.entityId}|${legacyPayload}`;
    const legacyHash = crypto
      .createHash("sha256")
      .update(legacyDataToHash)
      .digest("hex");
    if (record.recordHash === legacyHash) {
      return { isValid: true, version: "v1_legacy" };
    }

    return { isValid: false, version: "invalid" };
  }

  /**
   * Verifies an entire audit trail sequence for a company.
   */
  async verifyChain(
    organizationId: string,
    companyId: string,
  ): Promise<{
    isValid: boolean;
    totalRecords: number;
    versions: { v1Count: number; v2Count: number };
    errors: string[];
  }> {
    const logs = await this.prisma.auditLog.findMany({
      where: { organizationId, companyId },
      orderBy: { createdAt: "asc" },
    });

    let currentExpectedPrevHash = "0".repeat(64);
    let v1Count = 0;
    let v2Count = 0;
    const errors: string[] = [];

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      if (log.prevHash !== currentExpectedPrevHash) {
        errors.push(
          `Broken chain link at index ${i} (ID: ${log.id}): expected prevHash ${currentExpectedPrevHash}, found ${log.prevHash}`,
        );
      }

      const res = this.verifyRecord(log);
      if (!res.isValid) {
        errors.push(
          `Hash mismatch at index ${i} (ID: ${log.id}): recordHash ${log.recordHash} does not match computed hash`,
        );
      } else {
        if (res.version === "v2_canonical") v2Count++;
        if (res.version === "v1_legacy") v1Count++;
      }

      currentExpectedPrevHash = log.recordHash;
    }

    return {
      isValid: errors.length === 0,
      totalRecords: logs.length,
      versions: { v1Count, v2Count },
      errors,
    };
  }

  /**
   * Records an immutable MCA-compliant audit log entry with SHA-256 hash chaining.
   * Concurrency-safe: acquires a transaction-scoped PostgreSQL advisory lock on (organizationId, companyId).
   * Supports participation in an existing caller transaction (callerTx) for atomic all-or-nothing execution.
   */
  async record(
    opts: AuditLogOptions,
    callerTx?: Prisma.TransactionClient,
  ): Promise<any> {
    const sanitizedPrev = opts.previousState
      ? this.sanitizePayload(opts.previousState)
      : null;
    const sanitizedNew = opts.newState
      ? this.sanitizePayload(opts.newState)
      : null;

    const executeInTx = async (tx: Prisma.TransactionClient) => {
      // 1. Transaction-scoped PostgreSQL advisory lock per (orgId, companyId)
      const [k1, k2] = this.getAdvisoryLockKeys(
        opts.organizationId,
        opts.companyId,
      );
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${k1}::integer, ${k2}::integer)`;

      // 2. Fetch the absolute latest hash in the company chain
      const lastLog = await tx.auditLog.findFirst({
        where: {
          organizationId: opts.organizationId,
          companyId: opts.companyId,
        },
        orderBy: { createdAt: "desc" },
        select: { recordHash: true },
      });

      const prevHash = lastLog?.recordHash || "0".repeat(64);

      // 3. Compute deterministic canonical record hash
      const recordHash = this.computeCanonicalHash(
        prevHash,
        opts.action,
        opts.entityName,
        opts.entityId,
        sanitizedNew,
      );

      // 4. Insert audit log record
      return tx.auditLog.create({
        data: {
          organizationId: opts.organizationId,
          companyId: opts.companyId,
          userId: opts.userId,
          action: opts.action,
          entityName: opts.entityName,
          entityId: opts.entityId,
          previousState: sanitizedPrev,
          newState: sanitizedNew,
          ipAddress: opts.ipAddress || null,
          userAgent: opts.userAgent || null,
          prevHash,
          recordHash,
        },
      });
    };

    if (callerTx) {
      // Must execute within caller's existing transaction so failure rolls back caller's financial operations
      return await executeInTx(callerTx);
    }

    // Otherwise execute inside a standalone transaction
    try {
      return await this.prisma.executeBypassRls(async (tx) => {
        return await executeInTx(tx);
      });
    } catch (err: any) {
      this.logger.error(
        `Failed to record audit log: ${err.message}`,
        err.stack,
      );
      if (opts.strict || process.env.NODE_ENV === "production") {
        throw err;
      }
      return null;
    }
  }
}
