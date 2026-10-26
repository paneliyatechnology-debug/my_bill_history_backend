-- Additive GST compliance tables. Does not delete or rewrite posted accounting data.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GstRuntimeEnvironment') THEN
        CREATE TYPE "GstRuntimeEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Gstr2bDocumentType') THEN
        CREATE TYPE "Gstr2bDocumentType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Gstr2bMatchStatus') THEN
        CREATE TYPE "Gstr2bMatchStatus" AS ENUM ('MATCHED', 'PARTIAL_MATCH', 'MISSING_IN_BOOKS', 'MISSING_IN_GSTR2B', 'DUPLICATE', 'MISMATCH');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ItcReviewDecision') THEN
        CREATE TYPE "ItcReviewDecision" AS ENUM ('UNREVIEWED', 'ACCEPTED', 'REJECTED', 'DEFERRED');
    END IF;
END $$;

ALTER TABLE "einvoice_records" ADD COLUMN IF NOT EXISTS "environment" VARCHAR(20);
ALTER TABLE "einvoice_records" ADD COLUMN IF NOT EXISTS "provider_name" VARCHAR(40);
ALTER TABLE "einvoice_records" ADD COLUMN IF NOT EXISTS "request_hash" VARCHAR(64);

ALTER TABLE "eway_bill_records" ADD COLUMN IF NOT EXISTS "delivery_challan_id" UUID;
ALTER TABLE "eway_bill_records" ADD COLUMN IF NOT EXISTS "cancel_reason" VARCHAR(255);
ALTER TABLE "eway_bill_records" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);
ALTER TABLE "eway_bill_records" ADD COLUMN IF NOT EXISTS "environment" VARCHAR(20);
ALTER TABLE "eway_bill_records" ADD COLUMN IF NOT EXISTS "request_hash" VARCHAR(64);
ALTER TABLE "eway_bill_records" ALTER COLUMN "invoice_id" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "eway_bill_records_delivery_challan_id_key" ON "eway_bill_records"("delivery_challan_id");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'eway_bill_records_delivery_challan_id_fkey') THEN
        ALTER TABLE "eway_bill_records" ADD CONSTRAINT "eway_bill_records_delivery_challan_id_fkey" FOREIGN KEY ("delivery_challan_id") REFERENCES "delivery_challans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "gst_integration_configs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "environment" "GstRuntimeEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "production_enabled" BOOLEAN NOT NULL DEFAULT false,
    "einvoice_client_id" VARCHAR(100),
    "einvoice_username" VARCHAR(100),
    "eway_client_id" VARCHAR(100),
    "eway_username" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gst_integration_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gstr2b_imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "return_period" VARCHAR(6) NOT NULL,
    "source_file_name" VARCHAR(255) NOT NULL,
    "source_sha256" VARCHAR(64) NOT NULL,
    "recipient_gstin" VARCHAR(15) NOT NULL,
    "warnings" JSONB,
    "imported_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gstr2b_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gstr2b_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "supplier_gstin" VARCHAR(15) NOT NULL,
    "supplier_name" VARCHAR(200) NOT NULL DEFAULT '',
    "document_type" "Gstr2bDocumentType" NOT NULL,
    "invoice_number" VARCHAR(100) NOT NULL,
    "normalized_invoice_number" VARCHAR(100) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "taxable_value" DECIMAL(15,2) NOT NULL,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "cess_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "invoice_value" DECIMAL(15,2) NOT NULL,
    "portal_itc_flag" VARCHAR(20),
    "source_section" VARCHAR(20) NOT NULL,
    CONSTRAINT "gstr2b_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gstr2b_reconciliations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "return_period" VARCHAR(6) NOT NULL,
    "match_key" VARCHAR(220) NOT NULL,
    "purchase_invoice_id" UUID,
    "purchase_return_id" UUID,
    "gstr2b_line_id" UUID,
    "system_status" "Gstr2bMatchStatus" NOT NULL,
    "status" "Gstr2bMatchStatus" NOT NULL,
    "user_overridden" BOOLEAN NOT NULL DEFAULT false,
    "itc_decision" "ItcReviewDecision" NOT NULL DEFAULT 'UNREVIEWED',
    "explanation" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gstr2b_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gstr2b_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reconciliation_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID,
    "previous_status" VARCHAR(40) NOT NULL,
    "new_status" VARCHAR(40) NOT NULL,
    "previous_decision" VARCHAR(40) NOT NULL,
    "new_decision" VARCHAR(40) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gstr2b_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "gst_api_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "operation" VARCHAR(60) NOT NULL,
    "environment" VARCHAR(20) NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "error_code" VARCHAR(60),
    "error_message" TEXT,
    "external_document_number" VARCHAR(80),
    "document_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gst_api_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "gst_integration_configs_company_id_key" ON "gst_integration_configs"("company_id");
CREATE INDEX IF NOT EXISTS "gst_integration_configs_organization_id_company_id_idx" ON "gst_integration_configs"("organization_id", "company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "gstr2b_imports_company_id_source_sha256_key" ON "gstr2b_imports"("company_id", "source_sha256");
CREATE INDEX IF NOT EXISTS "gstr2b_imports_organization_id_company_id_return_period_idx" ON "gstr2b_imports"("organization_id", "company_id", "return_period");
CREATE INDEX IF NOT EXISTS "gstr2b_lines_organization_id_company_id_invoice_date_idx" ON "gstr2b_lines"("organization_id", "company_id", "invoice_date");
CREATE INDEX IF NOT EXISTS "gstr2b_lines_company_id_supplier_gstin_normalized_invoice_number_idx" ON "gstr2b_lines"("company_id", "supplier_gstin", "normalized_invoice_number");
CREATE UNIQUE INDEX IF NOT EXISTS "gstr2b_reconciliations_company_id_return_period_match_key_key" ON "gstr2b_reconciliations"("company_id", "return_period", "match_key");
CREATE INDEX IF NOT EXISTS "gstr2b_reconciliations_organization_id_company_id_return_period_status_idx" ON "gstr2b_reconciliations"("organization_id", "company_id", "return_period", "status");
CREATE INDEX IF NOT EXISTS "gstr2b_adjustments_reconciliation_id_created_at_idx" ON "gstr2b_adjustments"("reconciliation_id", "created_at");
CREATE INDEX IF NOT EXISTS "gstr2b_adjustments_organization_id_company_id_idx" ON "gstr2b_adjustments"("organization_id", "company_id");
CREATE UNIQUE INDEX IF NOT EXISTS "gst_api_audit_logs_company_id_operation_idempotency_key_key" ON "gst_api_audit_logs"("company_id", "operation", "idempotency_key");
CREATE INDEX IF NOT EXISTS "gst_api_audit_logs_organization_id_company_id_created_at_idx" ON "gst_api_audit_logs"("organization_id", "company_id", "created_at");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gst_integration_configs_company_id_fkey') THEN
        ALTER TABLE "gst_integration_configs" ADD CONSTRAINT "gst_integration_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gstr2b_imports_company_id_fkey') THEN
        ALTER TABLE "gstr2b_imports" ADD CONSTRAINT "gstr2b_imports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gstr2b_lines_import_id_fkey') THEN
        ALTER TABLE "gstr2b_lines" ADD CONSTRAINT "gstr2b_lines_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "gstr2b_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gstr2b_lines_company_id_fkey') THEN
        ALTER TABLE "gstr2b_lines" ADD CONSTRAINT "gstr2b_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gstr2b_reconciliations_company_id_fkey') THEN
        ALTER TABLE "gstr2b_reconciliations" ADD CONSTRAINT "gstr2b_reconciliations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gstr2b_reconciliations_purchase_invoice_id_fkey') THEN
        ALTER TABLE "gstr2b_reconciliations" ADD CONSTRAINT "gstr2b_reconciliations_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gstr2b_reconciliations_purchase_return_id_fkey') THEN
        ALTER TABLE "gstr2b_reconciliations" ADD CONSTRAINT "gstr2b_reconciliations_purchase_return_id_fkey" FOREIGN KEY ("purchase_return_id") REFERENCES "purchase_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gstr2b_reconciliations_gstr2b_line_id_fkey') THEN
        ALTER TABLE "gstr2b_reconciliations" ADD CONSTRAINT "gstr2b_reconciliations_gstr2b_line_id_fkey" FOREIGN KEY ("gstr2b_line_id") REFERENCES "gstr2b_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gstr2b_adjustments_reconciliation_id_fkey') THEN
        ALTER TABLE "gstr2b_adjustments" ADD CONSTRAINT "gstr2b_adjustments_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "gstr2b_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gstr2b_adjustments_company_id_fkey') THEN
        ALTER TABLE "gstr2b_adjustments" ADD CONSTRAINT "gstr2b_adjustments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'gst_api_audit_logs_company_id_fkey') THEN
        ALTER TABLE "gst_api_audit_logs" ADD CONSTRAINT "gst_api_audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "gst_integration_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gst_integration_configs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "gstr2b_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gstr2b_imports" FORCE ROW LEVEL SECURITY;
ALTER TABLE "gstr2b_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gstr2b_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "gstr2b_reconciliations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gstr2b_reconciliations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "gstr2b_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gstr2b_adjustments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "gst_api_audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gst_api_audit_logs" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'gst_integration_configs',
        'gstr2b_imports',
        'gstr2b_lines',
        'gstr2b_reconciliations',
        'gstr2b_adjustments',
        'gst_api_audit_logs'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', table_name, table_name);
        EXECUTE format($policy$
            CREATE POLICY tenant_isolation_%I ON %I
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
            )
        $policy$, table_name, table_name);
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO billing_app', table_name);
        END IF;
    END LOOP;
END $$;
