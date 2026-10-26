-- CreateTable
CREATE TABLE "sales_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "sales_invoice_id" UUID NOT NULL,
    "voucher_id" UUID,
    "party_id" UUID NOT NULL,
    "return_number" VARCHAR(100) NOT NULL,
    "return_date" DATE NOT NULL,
    "reason" TEXT,
    "reason_gujarati" TEXT,
    "taxable_amount" DECIMAL(15,2) NOT NULL,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "grand_total" DECIMAL(15,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ISSUED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "return_id" UUID NOT NULL,
    "sales_item_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "unit_price" DECIMAL(15,4) NOT NULL,
    "taxable_amount" DECIMAL(15,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_company_id_return_number_key" ON "sales_returns"("company_id", "return_number");
CREATE INDEX "sales_returns_organization_id_company_id_return_date_idx" ON "sales_returns"("organization_id", "company_id", "return_date");
CREATE INDEX "sales_returns_sales_invoice_id_idx" ON "sales_returns"("sales_invoice_id");

-- CreateIndex
CREATE INDEX "sales_return_items_return_id_idx" ON "sales_return_items"("return_id");
CREATE INDEX "sales_return_items_sales_item_id_idx" ON "sales_return_items"("sales_item_id");

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_sales_item_id_fkey" FOREIGN KEY ("sales_item_id") REFERENCES "sales_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enable and Force RLS
ALTER TABLE "sales_returns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_returns" FORCE ROW LEVEL SECURITY;

ALTER TABLE "sales_return_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_return_items" FORCE ROW LEVEL SECURITY;

-- Tenant Isolation Policies
DROP POLICY IF EXISTS tenant_isolation_sales_returns ON sales_returns;
CREATE POLICY tenant_isolation_sales_returns ON sales_returns
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

DROP POLICY IF EXISTS tenant_isolation_sales_return_items ON sales_return_items;
CREATE POLICY tenant_isolation_sales_return_items ON sales_return_items
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM sales_returns sr
            WHERE sr.id = sales_return_items.return_id
              AND sr.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND sr.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM sales_returns sr
            WHERE sr.id = sales_return_items.return_id
              AND sr.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND sr.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );
