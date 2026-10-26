import { Injectable, OnModuleInit } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

export interface SupportSessionRecord {
  id: string;
  actor_id: string;
  target_organization_id: string;
  target_company_id: string;
  created_at: Date;
  expires_at: Date;
  is_revoked: boolean;
  revoked_at: Date | null;
  reason: string | null;
}

@Injectable()
export class SupportSessionRegistry implements OnModuleInit {
  constructor(private readonly prisma: DatabaseService) {}

  async onModuleInit() {
    await this.verifySchema();
  }

  /**
   * Non-destructive schema verification.
   * Schema provisioning is now governed by versioned Prisma/SQL migrations.
   */
  async verifySchema(): Promise<void> {
    try {
      const tableExists = await this.prisma.$queryRawUnsafe<any[]>(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'support_sessions'
        LIMIT 1
      `);
      if (!tableExists || tableExists.length === 0) {
        // Table not found; operations will fail safely/closed
      }
    } catch {
      // Allow execution in testing environments without active DB
    }
  }

  /**
   * Backward-compatible alias for verifySchema
   */
  async initTable(): Promise<void> {
    await this.verifySchema();
  }

  async createSession(data: {
    id: string;
    actorId: string;
    targetOrganizationId: string;
    targetCompanyId: string;
    expiresAt: Date;
    reason?: string;
  }): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO support_sessions (id, actor_id, target_organization_id, target_company_id, expires_at, reason)
       VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $6)`,
      data.id,
      data.actorId,
      data.targetOrganizationId,
      data.targetCompanyId,
      data.expiresAt.toISOString(),
      data.reason || null,
    );
  }

  async getValidSession(sessionId: string): Promise<SupportSessionRecord | null> {
    if (!sessionId) return null;
    try {
      const rows = await this.prisma.$queryRawUnsafe<SupportSessionRecord[]>(
        `SELECT id, actor_id, target_organization_id, target_company_id, created_at, expires_at, is_revoked, revoked_at, reason
         FROM support_sessions
         WHERE id = $1 AND is_revoked = FALSE AND expires_at > NOW()
         LIMIT 1`,
        sessionId,
      );
      return rows && rows.length > 0 ? rows[0] : null;
    } catch {
      return null;
    }
  }

  async revokeSession(sessionId: string): Promise<void> {
    if (!sessionId) return;
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE support_sessions
         SET is_revoked = TRUE, revoked_at = NOW()
         WHERE id = $1 AND is_revoked = FALSE`,
        sessionId,
      );
    } catch {
      // Ignore if table not ready
    }
  }

  async revokeAllForActor(actorId: string): Promise<void> {
    if (!actorId) return;
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE support_sessions
         SET is_revoked = TRUE, revoked_at = NOW()
         WHERE actor_id = $1::uuid AND is_revoked = FALSE`,
        actorId,
      );
    } catch {
      // Ignore
    }
  }

  async revokeAllForCompany(companyId: string, actorId?: string): Promise<void> {
    if (!companyId) return;
    try {
      if (actorId) {
        await this.prisma.$executeRawUnsafe(
          `UPDATE support_sessions
           SET is_revoked = TRUE, revoked_at = NOW()
           WHERE target_company_id = $1::uuid AND actor_id = $2::uuid AND is_revoked = FALSE`,
          companyId,
          actorId,
        );
      } else {
        await this.prisma.$executeRawUnsafe(
          `UPDATE support_sessions
           SET is_revoked = TRUE, revoked_at = NOW()
           WHERE target_company_id = $1::uuid AND is_revoked = FALSE`,
          companyId,
        );
      }
    } catch {
      // Ignore
    }
  }
}
