-- 1. Create Enums
CREATE TYPE "StockTransferStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'RECEIVED', 'CANCELLED');
CREATE TYPE "DeliveryChallanType" AS ENUM ('JOB_WORK', 'SUPPLY_ON_APPROVAL', 'BRANCH_TRANSFER', 'OTHER');
CREATE TYPE "DeliveryChallanStatus" AS ENUM ('DRAFT', 'ISSUED', 'CLOSED', 'CANCELLED');

-- 2. Create Stock Transfers Tables
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "transfer_number" VARCHAR(100) NOT NULL,
    "transfer_date" DATE NOT NULL,
    "from_warehouse_id" UUID NOT NULL,
    "to_warehouse_id" UUID NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "challan_number" VARCHAR(100),
    "dispatched_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "dispatched_by" UUID,
    "received_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_transfer_warehouses_different" CHECK ("from_warehouse_id" <> "to_warehouse_id")
);

CREATE TABLE "stock_transfer_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transfer_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "batch_id" UUID,
    "quantity" DECIMAL(15,4) NOT NULL,
    "received_quantity" DECIMAL(15,4),
    "unit_cost" DECIMAL(15,4) NOT NULL DEFAULT 0.00,
    "total_cost" DECIMAL(15,2) NOT NULL DEFAULT 0.00,

    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

-- 3. Create Delivery Challans Tables
CREATE TABLE "delivery_challans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "party_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "challan_number" VARCHAR(100) NOT NULL,
    "challan_date" DATE NOT NULL,
    "challan_type" "DeliveryChallanType" NOT NULL DEFAULT 'JOB_WORK',
    "status" "DeliveryChallanStatus" NOT NULL DEFAULT 'ISSUED',
    "eway_bill_number" VARCHAR(50),
    "place_of_supply" VARCHAR(50),
    "taxable_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "converted_invoice_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_challans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "delivery_challan_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "challan_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "batch_id" UUID,
    "description" VARCHAR(255),
    "hsn_code" VARCHAR(20),
    "quantity" DECIMAL(15,4) NOT NULL,
    "unit_price" DECIMAL(15,4) NOT NULL,
    "taxable_amount" DECIMAL(15,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "delivery_challan_items_pkey" PRIMARY KEY ("id")
);

-- 4. Indexes
CREATE INDEX "stock_transfers_organization_id_company_id_transfer_date_idx" ON "stock_transfers"("organization_id", "company_id", "transfer_date");
CREATE INDEX "stock_transfers_from_warehouse_id_idx" ON "stock_transfers"("from_warehouse_id");
CREATE INDEX "stock_transfers_to_warehouse_id_idx" ON "stock_transfers"("to_warehouse_id");
CREATE UNIQUE INDEX "stock_transfers_company_id_transfer_number_key" ON "stock_transfers"("company_id", "transfer_number");

CREATE INDEX "stock_transfer_items_transfer_id_idx" ON "stock_transfer_items"("transfer_id");
CREATE INDEX "stock_transfer_items_item_id_idx" ON "stock_transfer_items"("item_id");

CREATE INDEX "delivery_challans_organization_id_company_id_challan_date_idx" ON "delivery_challans"("organization_id", "company_id", "challan_date");
CREATE INDEX "delivery_challans_party_id_idx" ON "delivery_challans"("party_id");
CREATE INDEX "delivery_challans_warehouse_id_idx" ON "delivery_challans"("warehouse_id");
CREATE UNIQUE INDEX "delivery_challans_company_id_challan_number_key" ON "delivery_challans"("company_id", "challan_number");

CREATE INDEX "delivery_challan_items_challan_id_idx" ON "delivery_challan_items"("challan_id");
CREATE INDEX "delivery_challan_items_item_id_idx" ON "delivery_challan_items"("item_id");

-- 5. Foreign Key Constraints
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_warehouse_id_fkey" FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_warehouse_id_fkey" FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "item_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "delivery_challan_items" ADD CONSTRAINT "delivery_challan_items_challan_id_fkey" FOREIGN KEY ("challan_id") REFERENCES "delivery_challans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_challan_items" ADD CONSTRAINT "delivery_challan_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_challan_items" ADD CONSTRAINT "delivery_challan_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "item_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Enable and Force Row Level Security (RLS) on Manufacturing & Distribution Tables
ALTER TABLE "bills_of_material" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bills_of_material" FORCE ROW LEVEL SECURITY;

ALTER TABLE "bom_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bom_items" FORCE ROW LEVEL SECURITY;

ALTER TABLE "production_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "production_orders" FORCE ROW LEVEL SECURITY;

ALTER TABLE "production_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "production_batches" FORCE ROW LEVEL SECURITY;

ALTER TABLE "stock_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfers" FORCE ROW LEVEL SECURITY;

ALTER TABLE "stock_transfer_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfer_items" FORCE ROW LEVEL SECURITY;

ALTER TABLE "delivery_challans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_challans" FORCE ROW LEVEL SECURITY;

ALTER TABLE "delivery_challan_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_challan_items" FORCE ROW LEVEL SECURITY;

-- 7. Row Level Security Policies (AS PERMISSIVE with USING & WITH CHECK)

-- BOM
DROP POLICY IF EXISTS tenant_isolation_bills_of_material ON bills_of_material;
CREATE POLICY tenant_isolation_bills_of_material ON bills_of_material
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

-- BOM Items
DROP POLICY IF EXISTS tenant_isolation_bom_items ON bom_items;
CREATE POLICY tenant_isolation_bom_items ON bom_items
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM bills_of_material bom
            WHERE bom.id = bom_items.bom_id
              AND bom.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND bom.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM bills_of_material bom
            WHERE bom.id = bom_items.bom_id
              AND bom.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND bom.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Production Orders
DROP POLICY IF EXISTS tenant_isolation_production_orders ON production_orders;
CREATE POLICY tenant_isolation_production_orders ON production_orders
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

-- Production Batches
DROP POLICY IF EXISTS tenant_isolation_production_batches ON production_batches;
CREATE POLICY tenant_isolation_production_batches ON production_batches
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM production_orders po
            WHERE po.id = production_batches.production_order_id
              AND po.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND po.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM production_orders po
            WHERE po.id = production_batches.production_order_id
              AND po.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND po.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Stock Transfers
DROP POLICY IF EXISTS tenant_isolation_stock_transfers ON stock_transfers;
CREATE POLICY tenant_isolation_stock_transfers ON stock_transfers
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

-- Stock Transfer Items
DROP POLICY IF EXISTS tenant_isolation_stock_transfer_items ON stock_transfer_items;
CREATE POLICY tenant_isolation_stock_transfer_items ON stock_transfer_items
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM stock_transfers st
            WHERE st.id = stock_transfer_items.transfer_id
              AND st.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND st.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM stock_transfers st
            WHERE st.id = stock_transfer_items.transfer_id
              AND st.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND st.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Delivery Challans
DROP POLICY IF EXISTS tenant_isolation_delivery_challans ON delivery_challans;
CREATE POLICY tenant_isolation_delivery_challans ON delivery_challans
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

-- Delivery Challan Items
DROP POLICY IF EXISTS tenant_isolation_delivery_challan_items ON delivery_challan_items;
CREATE POLICY tenant_isolation_delivery_challan_items ON delivery_challan_items
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM delivery_challans dc
            WHERE dc.id = delivery_challan_items.challan_id
              AND dc.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND dc.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM delivery_challans dc
            WHERE dc.id = delivery_challan_items.challan_id
              AND dc.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND dc.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- 8. Grant privileges to app role billing_app if role exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bills_of_material TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bom_items TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE production_orders TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE production_batches TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE stock_transfers TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE stock_transfer_items TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE delivery_challans TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE delivery_challan_items TO billing_app;
    END IF;
END $$;
