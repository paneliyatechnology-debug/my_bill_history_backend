-- Create automated_billing_schedules, automated_billing_lines, and automated_billing_runs tables with RLS and foreign keys
CREATE TABLE IF NOT EXISTS "automated_billing_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "schedule_name" VARCHAR(255) NOT NULL,
    "party_id" UUID NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "frequency" VARCHAR(50) NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "day_of_week" INTEGER,
    "day_of_month" INTEGER,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_run_status" VARCHAR(50),
    "payment_terms" VARCHAR(100),
    "due_days" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms_and_conditions" TEXT,
    "estimated_total" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "total_runs_count" INTEGER NOT NULL DEFAULT 0,
    "successful_runs_count" INTEGER NOT NULL DEFAULT 0,
    "failed_runs_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automated_billing_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "automated_billing_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_id" UUID NOT NULL,
    "item_id" UUID,
    "description" VARCHAR(255) NOT NULL,
    "hsn_code" VARCHAR(20),
    "quantity" DECIMAL(12,4) NOT NULL DEFAULT 1.0000,
    "unit" VARCHAR(20),
    "rate" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "discount_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "taxable_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automated_billing_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "automated_billing_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "occurrence_key" VARCHAR(100) NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'SUCCESS',
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "invoice_id" UUID,
    "invoice_number" VARCHAR(100),
    "grand_total" DECIMAL(15,2),
    "error_code" VARCHAR(100),
    "error_message" TEXT,
    "triggered_by" VARCHAR(50) NOT NULL DEFAULT 'AUTOMATED',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automated_billing_runs_pkey" PRIMARY KEY ("id")
);

-- Unique & Index constraints
CREATE UNIQUE INDEX IF NOT EXISTS "automated_billing_runs_schedule_occurrence_unique" ON "automated_billing_runs"("schedule_id", "occurrence_key");

CREATE INDEX IF NOT EXISTS "automated_billing_schedules_org_comp_idx" ON "automated_billing_schedules"("organization_id", "company_id");
CREATE INDEX IF NOT EXISTS "automated_billing_schedules_party_idx" ON "automated_billing_schedules"("party_id");
CREATE INDEX IF NOT EXISTS "automated_billing_schedules_status_idx" ON "automated_billing_schedules"("status");
CREATE INDEX IF NOT EXISTS "automated_billing_schedules_next_run_idx" ON "automated_billing_schedules"("next_run_at");

CREATE INDEX IF NOT EXISTS "automated_billing_lines_schedule_id_idx" ON "automated_billing_lines"("schedule_id");
CREATE INDEX IF NOT EXISTS "automated_billing_lines_item_id_idx" ON "automated_billing_lines"("item_id");

CREATE INDEX IF NOT EXISTS "automated_billing_runs_org_comp_idx" ON "automated_billing_runs"("organization_id", "company_id");
CREATE INDEX IF NOT EXISTS "automated_billing_runs_invoice_id_idx" ON "automated_billing_runs"("invoice_id");
CREATE INDEX IF NOT EXISTS "automated_billing_runs_scheduled_for_idx" ON "automated_billing_runs"("scheduled_for");

-- Foreign Keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'automated_billing_schedules_company_id_fkey') THEN
        ALTER TABLE "automated_billing_schedules" ADD CONSTRAINT "automated_billing_schedules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'automated_billing_schedules_party_id_fkey') THEN
        ALTER TABLE "automated_billing_schedules" ADD CONSTRAINT "automated_billing_schedules_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'automated_billing_lines_schedule_id_fkey') THEN
        ALTER TABLE "automated_billing_lines" ADD CONSTRAINT "automated_billing_lines_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "automated_billing_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'automated_billing_lines_item_id_fkey') THEN
        ALTER TABLE "automated_billing_lines" ADD CONSTRAINT "automated_billing_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'automated_billing_runs_schedule_id_fkey') THEN
        ALTER TABLE "automated_billing_runs" ADD CONSTRAINT "automated_billing_runs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "automated_billing_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'automated_billing_runs_invoice_id_fkey') THEN
        ALTER TABLE "automated_billing_runs" ADD CONSTRAINT "automated_billing_runs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Row Level Security (RLS)
ALTER TABLE "automated_billing_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automated_billing_schedules" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_automated_billing_schedules ON automated_billing_schedules;
CREATE POLICY tenant_isolation_automated_billing_schedules ON automated_billing_schedules
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

ALTER TABLE "automated_billing_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automated_billing_runs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_automated_billing_runs ON automated_billing_runs;
CREATE POLICY tenant_isolation_automated_billing_runs ON automated_billing_runs
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE automated_billing_schedules TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE automated_billing_lines TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE automated_billing_runs TO billing_app;
    END IF;
END $$;
