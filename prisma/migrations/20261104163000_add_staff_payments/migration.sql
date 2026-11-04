-- CreateTable staff_payments with RLS, foreign keys and indexes
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
    "voucher_id" UUID,
    "note" TEXT,
    "idempotency_key" VARCHAR(120),
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_payments_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_payments_voucher_id_key') THEN
        ALTER TABLE "staff_payments" ADD CONSTRAINT "staff_payments_voucher_id_key" UNIQUE ("voucher_id");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_payments_idempotency_key_key') THEN
        ALTER TABLE "staff_payments" ADD CONSTRAINT "staff_payments_idempotency_key_key" UNIQUE ("idempotency_key");
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "staff_payments_organization_id_company_id_payment_date_idx" ON "staff_payments"("organization_id", "company_id", "payment_date");
CREATE INDEX IF NOT EXISTS "staff_payments_staff_id_idx" ON "staff_payments"("staff_id");

-- Foreign Keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'staff_payments_company_id_fkey') THEN
        ALTER TABLE "staff_payments" ADD CONSTRAINT "staff_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'staff_payments_voucher_id_fkey') THEN
        ALTER TABLE "staff_payments" ADD CONSTRAINT "staff_payments_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'staff_payments_paid_from_account_id_fkey') THEN
        ALTER TABLE "staff_payments" ADD CONSTRAINT "staff_payments_paid_from_account_id_fkey" FOREIGN KEY ("paid_from_account_id") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Row Level Security (RLS)
ALTER TABLE "staff_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_payments" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_staff_payments ON staff_payments;
CREATE POLICY tenant_isolation_staff_payments ON staff_payments
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
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE staff_payments TO billing_app;
    END IF;
END $$;

