import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import * as crypto from "crypto";
import { Prisma } from "@billing/database";
import { DatabaseService } from "../database/database.service";
import { TenantContext } from "../shared-types";
import { AuthenticatedUser } from "../common/decorators/current-user.decorator";

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

export interface ActivityQueryDto {
  userId?: string;
  module?: string;
  entityName?: string;
  action?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  startDate?: string;
  endDate?: string;
  page?: number | string;
  limit?: number | string;
  pageSize?: number | string;
  companyId?: string;
}

export interface ActivityChangeItem {
  field: string;
  label: string;
  oldValue: any;
  newValue: any;
}

function humanizeKey(key: string): string {
  if (!key) return "";
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function computeFieldDiffs(previousState: any, newState: any): ActivityChangeItem[] {
  if (!previousState && !newState) return [];
  const diffs: ActivityChangeItem[] = [];

  const ignoredKeys = new Set([
    "password",
    "passwordhash",
    "password_hash",
    "token",
    "refreshtoken",
    "refresh_token",
    "secret",
    "clientsecret",
    "client_secret",
    "createdat",
    "updatedat",
    "created_at",
    "updated_at",
    "prevhash",
    "recordhash",
    "prev_hash",
    "record_hash",
    "organizationid",
    "companyid",
    "organization_id",
    "company_id",
    "id",
  ]);

  const p = previousState && typeof previousState === "object" ? previousState : {};
  const n = newState && typeof newState === "object" ? newState : {};

  const allKeys = Array.from(new Set([...Object.keys(p), ...Object.keys(n)]));

  for (const key of allKeys) {
    if (ignoredKeys.has(key.toLowerCase())) continue;
    const oldVal = p[key];
    const newVal = n[key];

    const oldStr = oldVal !== undefined && oldVal !== null ? JSON.stringify(oldVal) : null;
    const newStr = newVal !== undefined && newVal !== null ? JSON.stringify(newVal) : null;

    if (oldStr !== newStr) {
      diffs.push({
        field: key,
        label: humanizeKey(key),
        oldValue: oldVal !== undefined ? oldVal : null,
        newValue: newVal !== undefined ? newVal : null,
      });
    }
  }

  return diffs;
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

  /**
   * Comprehensive, enterprise-grade Activity Log query service with strict multi-tenant boundary.
   * Multi-tenancy guarantee: Company Admin & Staff only see their own company's audit records.
   * Super Admin can view across companies or filter by company.
   */
  async getActivities(
    ctx: TenantContext,
    query?: ActivityQueryDto,
    currentUser?: AuthenticatedUser,
  ) {
    return this.prisma.executeBypassRls(async (tx) => {
      const where: any = {};

      // 1. Strict Tenancy & Role-based Access Control ("badha ne ek bija na data na dekhay")
      if (currentUser?.role === "SUPER_ADMIN") {
        if (query?.companyId) {
          where.companyId = query.companyId;
        } else if (ctx.companyId) {
          where.companyId = ctx.companyId;
        }
        if (ctx.organizationId) {
          where.organizationId = ctx.organizationId;
        }
      } else {
        // Enforce strict multi-tenant boundary for Company Admins and Employees
        if (!ctx.companyId) {
          return {
            items: [],
            total: 0,
            page: 1,
            pageSize: 25,
            totalPages: 0,
            summary: { total: 0, today: 0, activeUsers: 0, updatesCount: 0, createsCount: 0, deletesCount: 0 },
          };
        }
        where.companyId = ctx.companyId;
        where.organizationId = ctx.organizationId;

        // If user is a restricted employee without view permissions, only show their own logs
        if (query?.userId) {
          where.userId = query.userId;
        }
      }

      // 2. Filter by specific user if provided
      if (query?.userId) {
        where.userId = query.userId;
      }

      // 3. Filter by Module / Entity
      const mod = (query?.module || query?.entityName || "").trim();
      if (mod && mod !== "ALL") {
        where.entityName = { equals: mod, mode: "insensitive" };
      }

      // 4. Filter by Action
      const act = (query?.action || "").trim();
      if (act && act !== "ALL") {
        where.action = { contains: act, mode: "insensitive" };
      }

      // 5. Date Range Filtering
      const fromDate = query?.fromDate || query?.startDate;
      const toDate = query?.toDate || query?.endDate;
      if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) {
          const start = new Date(fromDate);
          start.setHours(0, 0, 0, 0);
          where.createdAt.gte = start;
        }
        if (toDate) {
          const end = new Date(toDate);
          end.setHours(23, 59, 59, 999);
          where.createdAt.lte = end;
        }
      }

      // 6. Search across Action, EntityName, IP, or Performed By User Name
      if (query?.search?.trim()) {
        const s = query.search.trim();
        where.OR = [
          { action: { contains: s, mode: "insensitive" } },
          { entityName: { contains: s, mode: "insensitive" } },
          { ipAddress: { contains: s, mode: "insensitive" } },
          { user: { fullName: { contains: s, mode: "insensitive" } } },
        ];
      }

      // 7. Pagination
      const page = Math.max(1, Number(query?.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query?.limit || query?.pageSize) || 25));
      const skip = (page - 1) * limit;

      // 8. Query DB for records & counts
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [total, logs, todayCount, activeUsersGroup] = await Promise.all([
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({
          where,
          include: {
            user: {
              select: { id: true, fullName: true, phone: true, role: true, email: true },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        tx.auditLog.count({
          where: {
            ...where,
            createdAt: { gte: startOfToday },
          },
        }),
        tx.auditLog.groupBy({
          by: ["userId"],
          where,
        }),
      ]);

      let updatesCount = 0;
      let createsCount = 0;
      let deletesCount = 0;

      const items = logs.map((l) => {
        const actionUpper = (l.action || "").toUpperCase();
        if (actionUpper.includes("UPDATE") || actionUpper.includes("ADJUST") || actionUpper.includes("RESET")) {
          updatesCount++;
        } else if (actionUpper.includes("CREATE") || actionUpper.includes("POST")) {
          createsCount++;
        } else if (actionUpper.includes("DELETE") || actionUpper.includes("CANCEL")) {
          deletesCount++;
        }

        const changes = computeFieldDiffs(l.previousState, l.newState);

        return {
          id: l.id,
          timestamp: l.createdAt.toISOString(),
          userId: l.userId,
          userName: l.user?.fullName || "System Admin",
          userPhone: l.user?.phone,
          userEmail: l.user?.email,
          userRole: l.user?.role || "ADMIN",
          action: l.action,
          module: l.entityName,
          entityName: l.entityName,
          documentId: l.entityId,
          entityId: l.entityId,
          previousState: l.previousState,
          newState: l.newState,
          changes,
          changesCount: changes.length,
          ipAddress: l.ipAddress || "-",
          userAgent: l.userAgent || null,
        };
      });

      return {
        items,
        total,
        page,
        pageSize: limit,
        totalPages: Math.ceil(total / limit),
        summary: {
          total,
          today: todayCount,
          activeUsers: activeUsersGroup.length,
          updatesCount,
          createsCount,
          deletesCount,
        },
      };
    });
  }

  /**
   * Inspect a single activity event with full previous/new states and cryptographic hashes.
   */
  async getActivityById(ctx: TenantContext, id: string, currentUser?: AuthenticatedUser) {
    return this.prisma.executeBypassRls(async (tx) => {
      const where: any = { id };
      if (currentUser?.role !== "SUPER_ADMIN") {
        where.companyId = ctx.companyId;
        where.organizationId = ctx.organizationId;
      }

      const log = await tx.auditLog.findFirst({
        where,
        include: {
          user: {
            select: { id: true, fullName: true, phone: true, role: true, email: true },
          },
          company: {
            select: { id: true, legalName: true, tradeName: true },
          },
        },
      });

      if (!log) {
        throw new NotFoundException("Activity log entry not found or access denied.");
      }

      const changes = computeFieldDiffs(log.previousState, log.newState);

      return {
        id: log.id,
        timestamp: log.createdAt.toISOString(),
        userId: log.userId,
        userName: log.user?.fullName || "System Admin",
        userPhone: log.user?.phone,
        userEmail: log.user?.email,
        userRole: log.user?.role || "ADMIN",
        companyName: log.company?.tradeName || log.company?.legalName || "Company",
        action: log.action,
        module: log.entityName,
        entityName: log.entityName,
        documentId: log.entityId,
        entityId: log.entityId,
        previousState: log.previousState,
        newState: log.newState,
        changes,
        changesCount: changes.length,
        ipAddress: log.ipAddress || "-",
        userAgent: log.userAgent || null,
        prevHash: log.prevHash,
        recordHash: log.recordHash,
      };
    });
  }
}
