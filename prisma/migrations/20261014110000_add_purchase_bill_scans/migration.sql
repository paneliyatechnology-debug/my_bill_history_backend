-- 1. Create ScanStatus Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ScanStatus') THEN
        CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY_FOR_REVIEW', 'CONFIRMED', 'FAILED', 'DISCARDED');
    END IF;
END $$;

-- 2. Create Purchase Bill Scans Table
CREATE TABLE IF NOT EXISTS "purchase_bill_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "file_name" VARCHAR(255) NOT NULL,
    "file_mime_type" VARCHAR(100) NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "file_storage_path" VARCHAR(500) NOT NULL,
    "file_sha256" VARCHAR(64) NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "ocr_provider" VARCHAR(50) NOT NULL DEFAULT 'mock',
    "extracted_data" JSONB,
    "raw_ocr_text" TEXT,
    "matched_party_id" UUID,
    "matched_party_score" DECIMAL(5,2),
    "purchase_invoice_id" UUID,
    "error_message" TEXT,
    "idempotency_key" VARCHAR(100),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_bill_scans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_bill_scans_purchase_invoice_id_key" UNIQUE ("purchase_invoice_id")
);

-- 3. Foreign Key Constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'purchase_bill_scans_company_id_fkey') THEN
        ALTER TABLE "purchase_bill_scans" ADD CONSTRAINT "purchase_bill_scans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'purchase_bill_scans_branch_id_fkey') THEN
        ALTER TABLE "purchase_bill_scans" ADD CONSTRAINT "purchase_bill_scans_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'purchase_bill_scans_matched_party_id_fkey') THEN
        ALTER TABLE "purchase_bill_scans" ADD CONSTRAINT "purchase_bill_scans_matched_party_id_fkey" FOREIGN KEY ("matched_party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'purchase_bill_scans_purchase_invoice_id_fkey') THEN
        ALTER TABLE "purchase_bill_scans" ADD CONSTRAINT "purchase_bill_scans_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS "purchase_bill_scans_organization_id_company_id_status_idx" ON "purchase_bill_scans"("organization_id", "company_id", "status");
CREATE INDEX IF NOT EXISTS "purchase_bill_scans_company_id_file_sha256_idx" ON "purchase_bill_scans"("company_id", "file_sha256");
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_bill_scans_company_id_idempotency_key_key" ON "purchase_bill_scans"("company_id", "idempotency_key");

-- 5. Enable and Force Row Level Security (RLS)
ALTER TABLE "purchase_bill_scans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_bill_scans" FORCE ROW LEVEL SECURITY;

-- 6. Tenant Isolation Policy
DROP POLICY IF EXISTS tenant_isolation_purchase_bill_scans ON purchase_bill_scans;
CREATE POLICY tenant_isolation_purchase_bill_scans ON purchase_bill_scans
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

-- 7. Grant Privileges to Application Role
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE purchase_bill_scans TO billing_app;
    END IF;
END $$;
