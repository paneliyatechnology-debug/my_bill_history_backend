-- Additive supply category, UTGST, outward debit notes, and advance receipts.
-- Existing rows default to TAXABLE and zero UTGST. No posted rows are deleted.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupplyCategory') THEN
        CREATE TYPE "SupplyCategory" AS ENUM ('TAXABLE', 'NIL_RATED', 'EXEMPT', 'NON_GST');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdvanceSupplyKind') THEN
        CREATE TYPE "AdvanceSupplyKind" AS ENUM ('GOODS', 'SERVICES');
    END IF;
END $$;

ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "supply_category" "SupplyCategory" NOT NULL DEFAULT 'TAXABLE';
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "utgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "sales_invoice_items" ADD COLUMN IF NOT EXISTS "utgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "sales_invoice_items" ADD COLUMN IF NOT EXISTS "supply_category" "SupplyCategory" NOT NULL DEFAULT 'TAXABLE';
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "utgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "utgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "purchase_invoice_items" ADD COLUMN IF NOT EXISTS "utgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "purchase_invoice_items" ADD COLUMN IF NOT EXISTS "supply_category" "SupplyCategory" NOT NULL DEFAULT 'TAXABLE';

CREATE TABLE IF NOT EXISTS "outward_debit_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "sales_invoice_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "voucher_id" UUID,
    "note_number" VARCHAR(100) NOT NULL,
    "note_date" DATE NOT NULL,
    "place_of_supply" CHAR(2) NOT NULL,
    "taxable_amount" DECIMAL(15,2) NOT NULL,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "utgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "grand_total" DECIMAL(15,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outward_debit_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "outward_debit_note_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "note_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "hsn_code" VARCHAR(10) NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "taxable_amount" DECIMAL(15,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "utgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "supply_category" "SupplyCategory" NOT NULL DEFAULT 'TAXABLE',
    CONSTRAINT "outward_debit_note_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "advance_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "receipt_number" VARCHAR(100) NOT NULL,
    "receipt_date" DATE NOT NULL,
    "supply_kind" "AdvanceSupplyKind" NOT NULL,
    "place_of_supply" CHAR(2) NOT NULL,
    "taxable_amount" DECIMAL(15,2) NOT NULL,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "utgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "grand_total" DECIMAL(15,2) NOT NULL,
    "adjusted_taxable" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "accounting_posting" VARCHAR(40) NOT NULL DEFAULT 'NOT_POSTED_PENDING_CA',
    "statutory_note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "advance_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "advance_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "advance_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sales_invoice_id" UUID,
    "adjustment_date" DATE NOT NULL,
    "taxable_amount" DECIMAL(15,2) NOT NULL,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "utgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "advance_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "outward_debit_notes_company_id_note_number_key" ON "outward_debit_notes"("company_id", "note_number");
CREATE INDEX IF NOT EXISTS "outward_debit_notes_organization_id_company_id_note_date_idx" ON "outward_debit_notes"("organization_id", "company_id", "note_date");
CREATE INDEX IF NOT EXISTS "outward_debit_note_items_note_id_idx" ON "outward_debit_note_items"("note_id");
CREATE UNIQUE INDEX IF NOT EXISTS "advance_receipts_company_id_receipt_number_key" ON "advance_receipts"("company_id", "receipt_number");
CREATE INDEX IF NOT EXISTS "advance_receipts_organization_id_company_id_receipt_date_idx" ON "advance_receipts"("organization_id", "company_id", "receipt_date");
CREATE INDEX IF NOT EXISTS "advance_adjustments_company_id_adjustment_date_idx" ON "advance_adjustments"("company_id", "adjustment_date");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'outward_debit_notes_company_id_fkey') THEN
        ALTER TABLE "outward_debit_notes" ADD CONSTRAINT "outward_debit_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'outward_debit_notes_sales_invoice_id_fkey') THEN
        ALTER TABLE "outward_debit_notes" ADD CONSTRAINT "outward_debit_notes_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'outward_debit_notes_party_id_fkey') THEN
        ALTER TABLE "outward_debit_notes" ADD CONSTRAINT "outward_debit_notes_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'outward_debit_note_items_note_id_fkey') THEN
        ALTER TABLE "outward_debit_note_items" ADD CONSTRAINT "outward_debit_note_items_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "outward_debit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'outward_debit_note_items_item_id_fkey') THEN
        ALTER TABLE "outward_debit_note_items" ADD CONSTRAINT "outward_debit_note_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'advance_receipts_company_id_fkey') THEN
        ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'advance_receipts_party_id_fkey') THEN
        ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'advance_adjustments_advance_id_fkey') THEN
        ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "advance_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "outward_debit_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outward_debit_notes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "outward_debit_note_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outward_debit_note_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "advance_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "advance_receipts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "advance_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "advance_adjustments" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
    target text;
BEGIN
    FOREACH target IN ARRAY ARRAY['outward_debit_notes', 'advance_receipts', 'advance_adjustments']
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I', target, target);
        EXECUTE format($policy$
            CREATE POLICY tenant_isolation_%I ON %I AS PERMISSIVE
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
        $policy$, target, target);
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO billing_app', target);
        END IF;
    END LOOP;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE outward_debit_note_items TO billing_app;
    END IF;
END $$;

DROP POLICY IF EXISTS tenant_isolation_outward_debit_note_items ON outward_debit_note_items;
CREATE POLICY tenant_isolation_outward_debit_note_items ON outward_debit_note_items
AS PERMISSIVE
USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR EXISTS (
        SELECT 1 FROM outward_debit_notes n
        WHERE n.id = outward_debit_note_items.note_id
          AND n.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
          AND n.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    )
)
WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR EXISTS (
        SELECT 1 FROM outward_debit_notes n
        WHERE n.id = outward_debit_note_items.note_id
          AND n.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
          AND n.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    )
);
