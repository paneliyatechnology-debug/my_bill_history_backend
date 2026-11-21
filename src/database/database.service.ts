import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { PrismaClient, Prisma } from "@billing/database";
import { TenantContext } from "@billing/shared-types";

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);
  private roleCapabilitiesPromise: Promise<{
    isSuperuser: boolean;
    hasAppRole: boolean;
  }> | null = null;

  async onModuleInit() {
    try {
      await this.$connect();
      await this.detectRoleCapabilities();
      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "email_otps" (
            "id" UUID NOT NULL PRIMARY KEY,
            "email" VARCHAR(150) NOT NULL,
            "purpose" VARCHAR(32) NOT NULL,
            "code_hash" VARCHAR(128) NOT NULL,
            "attempts" INTEGER NOT NULL DEFAULT 0,
            "expires_at" TIMESTAMPTZ NOT NULL,
            "consumed_at" TIMESTAMPTZ,
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `).catch((err) => {
        this.logger.warn(`Notice: email_otps table init: ${err.message}`);
      });
      await this.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "email_otps_email_purpose_created_at_idx"
            ON "email_otps"("email", "purpose", "created_at")
      `).catch(() => {});

      // Self-healing schema initialization for Import Jobs in cloud environments
      await this.$executeRawUnsafe(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DbImportStatus') THEN
                CREATE TYPE "DbImportStatus" AS ENUM ('PENDING', 'PARSING', 'VALIDATING', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DbImportMode') THEN
                CREATE TYPE "DbImportMode" AS ENUM ('CREATE_ONLY', 'SKIP_DUPLICATES', 'UPDATE_EXISTING');
            END IF;
        END $$;
      `).catch((err) => {
        this.logger.warn(`Notice: DbImport enums init: ${err.message}`);
      });

      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "import_jobs" (
            "id" UUID NOT NULL DEFAULT gen_random_uuid(),
            "organization_id" UUID NOT NULL,
            "company_id" UUID NOT NULL,
            "user_id" UUID,
            "module" VARCHAR(50) NOT NULL,
            "file_name" VARCHAR(255) NOT NULL,
            "file_size" INTEGER NOT NULL,
            "file_format" VARCHAR(20) NOT NULL,
            "worksheet_name" VARCHAR(100),
            "status" "DbImportStatus" NOT NULL DEFAULT 'PENDING',
            "mode" "DbImportMode" NOT NULL DEFAULT 'SKIP_DUPLICATES',
            "error_policy" VARCHAR(30) NOT NULL DEFAULT 'IMPORT_VALID_ONLY',
            "total_rows" INTEGER NOT NULL DEFAULT 0,
            "valid_rows" INTEGER NOT NULL DEFAULT 0,
            "imported_rows" INTEGER NOT NULL DEFAULT 0,
            "updated_rows" INTEGER NOT NULL DEFAULT 0,
            "skipped_rows" INTEGER NOT NULL DEFAULT 0,
            "failed_rows" INTEGER NOT NULL DEFAULT 0,
            "column_mapping" JSONB,
            "errors_json" JSONB,
            "summary_json" JSONB,
            "error_message" TEXT,
            "idempotency_key" VARCHAR(100),
            "started_at" TIMESTAMP(3),
            "completed_at" TIMESTAMP(3),
            "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
        );
      `).catch((err) => {
        this.logger.warn(`Notice: import_jobs table init: ${err.message}`);
      });

      await this.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "import_jobs_organization_id_company_id_created_at_idx" ON "import_jobs"("organization_id", "company_id", "created_at");
        CREATE INDEX IF NOT EXISTS "import_jobs_company_id_module_idx" ON "import_jobs"("company_id", "module");
        CREATE INDEX IF NOT EXISTS "import_jobs_idempotency_key_idx" ON "import_jobs"("idempotency_key");
      `).catch(() => {});

      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "party_notes" (
            "id" UUID NOT NULL DEFAULT gen_random_uuid(),
            "organization_id" UUID NOT NULL,
            "company_id" UUID NOT NULL,
            "party_id" UUID,
            "title" VARCHAR(200) NOT NULL,
            "description" TEXT NOT NULL,
            "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "party_notes_pkey" PRIMARY KEY ("id")
        );
        CREATE TABLE IF NOT EXISTS "party_appointments" (
            "id" UUID NOT NULL DEFAULT gen_random_uuid(),
            "organization_id" UUID NOT NULL,
            "company_id" UUID NOT NULL,
            "party_id" UUID,
            "title" VARCHAR(200) NOT NULL,
            "description" TEXT,
            "date" DATE NOT NULL,
            "time" VARCHAR(50) NOT NULL,
            "status" VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
            "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "party_appointments_pkey" PRIMARY KEY ("id")
        );
        CREATE TABLE IF NOT EXISTS "shared_ledger_connections" (
            "id" UUID NOT NULL DEFAULT gen_random_uuid(),
            "organization_id" UUID NOT NULL,
            "company_id" UUID NOT NULL,
            "party_id" UUID NOT NULL,
            "token" VARCHAR(64) NOT NULL UNIQUE,
            "status" VARCHAR(30) NOT NULL DEFAULT 'INVITED',
            "is_auto_paired" BOOLEAN NOT NULL DEFAULT false,
            "invited_at" TIMESTAMP(3),
            "last_viewed_at" TIMESTAMP(3),
            "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "shared_ledger_connections_pkey" PRIMARY KEY ("id")
        );
      `).catch((err) => {
        this.logger.warn(`Notice: party notes/appointments init: ${err.message}`);
      });

      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "staff_payments" (
            "id" UUID NOT NULL DEFAULT gen_random_uuid(),
            "organization_id" UUID NOT NULL,
            "company_id" UUID NOT NULL,
            "staff_id" VARCHAR(100) NOT NULL,
            "staff_name" VARCHAR(200) NOT NULL,
            "payment_type" VARCHAR(30) NOT NULL,
            "amount" DECIMAL(15,2) NOT NULL,
            "payment_mode" VARCHAR(30) NOT NULL,
            "payment_date" DATE NOT NULL,
            "paid_from_account_id" UUID,
            "voucher_id" UUID UNIQUE,
            "note" TEXT,
            "idempotency_key" VARCHAR(120) UNIQUE,
            "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
            "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "staff_payments_pkey" PRIMARY KEY ("id")
        );
        CREATE INDEX IF NOT EXISTS "staff_payments_organization_id_company_id_payment_date_idx"
            ON "staff_payments"("organization_id", "company_id", "payment_date");
        CREATE INDEX IF NOT EXISTS "staff_payments_staff_id_idx"
            ON "staff_payments"("staff_id");
      `).catch((err) => {
        this.logger.warn(`Notice: staff_payments table init: ${err.message}`);
      });

      // Self-healing schema initialization for Super Admin Platform Management
      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "coupons" (
            "id" UUID NOT NULL DEFAULT gen_random_uuid(),
            "code" VARCHAR(50) NOT NULL UNIQUE,
            "description" TEXT,
            "discount_type" VARCHAR(20) NOT NULL DEFAULT 'PERCENTAGE',
            "discount_value" DECIMAL(10,2) NOT NULL DEFAULT 10,
            "valid_tiers" JSONB NOT NULL DEFAULT '[]',
            "min_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
            "max_discount" DECIMAL(12,2) NOT NULL DEFAULT 5000,
            "valid_until" TIMESTAMPTZ,
            "usage_limit" INTEGER NOT NULL DEFAULT 100,
            "used_count" INTEGER NOT NULL DEFAULT 0,
            "is_active" BOOLEAN NOT NULL DEFAULT true,
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
        );
        CREATE INDEX IF NOT EXISTS "coupons_code_is_active_idx" ON "coupons"("code", "is_active");

        CREATE TABLE IF NOT EXISTS "subscription_plans" (
            "id" VARCHAR(100) NOT NULL PRIMARY KEY,
            "tier" VARCHAR(50) NOT NULL UNIQUE,
            "name" VARCHAR(150) NOT NULL,
            "name_gujarati" VARCHAR(150),
            "subtitle" TEXT,
            "subtitle_gujarati" TEXT,
            "monthly_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
            "yearly_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
            "annual_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
            "discount_percent" INTEGER NOT NULL DEFAULT 0,
            "monthly_paise" INTEGER NOT NULL DEFAULT 0,
            "yearly_paise" INTEGER NOT NULL DEFAULT 0,
            "max_companies" INTEGER NOT NULL DEFAULT 1,
            "max_invoices_per_year" INTEGER NOT NULL DEFAULT -1,
            "max_users" INTEGER NOT NULL DEFAULT 2,
            "max_godowns" INTEGER NOT NULL DEFAULT 1,
            "features" JSONB NOT NULL DEFAULT '[]',
            "features_gujarati" JSONB NOT NULL DEFAULT '[]',
            "entitlements" JSONB NOT NULL DEFAULT '{}',
            "is_active" BOOLEAN NOT NULL DEFAULT true,
            "is_popular" BOOLEAN NOT NULL DEFAULT false,
            "badge" VARCHAR(50),
            "badge_color" VARCHAR(100),
            "accent_color" VARCHAR(30),
            "is_default" BOOLEAN NOT NULL DEFAULT false,
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS "subscription_plans_tier_is_active_idx" ON "subscription_plans"("tier", "is_active");

        CREATE TABLE IF NOT EXISTS "platform_addons" (
            "id" UUID NOT NULL DEFAULT gen_random_uuid(),
            "name" VARCHAR(150) NOT NULL,
            "name_gujarati" VARCHAR(150),
            "code" VARCHAR(50) NOT NULL UNIQUE,
            "category" VARCHAR(50) NOT NULL DEFAULT 'GENERAL',
            "description" TEXT,
            "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
            "billing_cycle" VARCHAR(20) NOT NULL DEFAULT 'YEARLY',
            "quota_added" INTEGER NOT NULL DEFAULT 1,
            "unit" VARCHAR(50) NOT NULL DEFAULT 'Unit',
            "is_active" BOOLEAN NOT NULL DEFAULT true,
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "platform_addons_pkey" PRIMARY KEY ("id")
        );
        CREATE INDEX IF NOT EXISTS "platform_addons_code_is_active_idx" ON "platform_addons"("code", "is_active");

        CREATE TABLE IF NOT EXISTS "platform_settings" (
            "id" VARCHAR(50) NOT NULL PRIMARY KEY,
            "data" JSONB NOT NULL DEFAULT '{}',
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `).catch((err) => {
        this.logger.warn(`Notice: super admin tables init: ${err.message}`);
      });
    } catch {
      // Allow startup in environments without active DB
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Inspect current database connection privileges to avoid issuing illegal SET LOCAL ROLE
   * commands that would abort the transaction on non-superuser managed databases (e.g. Render, RDS).
   */
  async detectRoleCapabilities(): Promise<{
    isSuperuser: boolean;
    hasAppRole: boolean;
  }> {
    if (this.roleCapabilitiesPromise) {
      return this.roleCapabilitiesPromise;
    }

    this.roleCapabilitiesPromise = (async () => {
      try {
        const rows = await this.$queryRaw<
          Array<{ is_superuser: boolean; has_app_role: boolean }>
        >`
          SELECT 
            COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_superuser,
            EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') AS has_app_role;
        `;
        if (rows && rows.length > 0) {
          return {
            isSuperuser: Boolean(rows[0].is_superuser),
            hasAppRole: Boolean(rows[0].has_app_role),
          };
        }
      } catch (err) {
        this.logger.debug(
          `Could not inspect pg_roles (non-superuser or restricted environment), assuming unprivileged role: ${(err as Error).message}`,
        );
      }
      return { isSuperuser: false, hasAppRole: false };
    })();

    return this.roleCapabilitiesPromise;
  }

  /**
   * Execute callback inside a transaction configured with PostgreSQL Row-Level Security session variables.
   * This guarantees connection-pool safety because `set_config(..., ..., true)` is local to the transaction
   * and automatically resets when the transaction commits or rolls back.
   */
  async executeInTenantContext<T>(
    ctx: TenantContext,
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const caps = await this.detectRoleCapabilities();

    return this.$transaction(async (tx) => {
      try {
        if (ctx.isSystemBypass) {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        } else {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'off', true)`;

          // Only superusers need to downgrade role to test RLS policies.
          // Non-superusers are already subject to FORCE ROW LEVEL SECURITY.
          // Executing SET LOCAL ROLE as a non-superuser throws 42501 which aborts PostgreSQL transactions.
          if (caps.isSuperuser && caps.hasAppRole) {
            await tx.$executeRawUnsafe(`
              DO $$
              BEGIN
                SET LOCAL ROLE billing_app;
              EXCEPTION WHEN OTHERS THEN
                NULL;
              END $$;
            `);
          }

          if (ctx.organizationId) {
            await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${ctx.organizationId}, true)`;
          }
          if (ctx.companyId) {
            await tx.$executeRaw`SELECT set_config('app.current_company_id', ${ctx.companyId}, true)`;
          }
        }

        return await callback(tx);
      } catch (err: any) {
        const errorCode = err?.code || err?.meta?.code || "UNKNOWN";
        const errorMsg = err?.message
          ? err.message.split("\n")[0]
          : "Database operation failed";
        this.logger.error(
          `Tenant transaction failure [errorCode=${errorCode}]: ${errorMsg}`,
        );
        throw err;
      }
    });
  }

  /**
   * Execute a query bypassing RLS within a dedicated transaction (e.g. for registration, migrations)
   */
  async executeBypassRls<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const caps = await this.detectRoleCapabilities();

    return this.$transaction(async (tx) => {
      try {
        if (caps.isSuperuser && caps.hasAppRole) {
          await tx.$executeRawUnsafe(`
            DO $$
            BEGIN
              RESET ROLE;
            EXCEPTION WHEN OTHERS THEN
              NULL;
            END $$;
          `);
        }
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        return await callback(tx);
      } catch (err: any) {
        const errorCode = err?.code || err?.meta?.code || "UNKNOWN";
        const errorMsg = err?.message
          ? err.message.split("\n")[0]
          : "Database bypass operation failed";
        this.logger.error(
          `Bypass transaction failure [errorCode=${errorCode}]: ${errorMsg}`,
        );
        throw err;
      }
    });
  }
}
