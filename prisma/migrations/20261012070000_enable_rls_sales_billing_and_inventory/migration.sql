-- Add batch_id to sales_invoice_items
ALTER TABLE sales_invoice_items ADD COLUMN IF NOT EXISTS batch_id UUID;

-- Enable and force RLS on sales_invoice_items, invoice_sequences, warehouses, pos_sessions
ALTER TABLE sales_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice_items FORCE ROW LEVEL SECURITY;

ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_sequences FORCE ROW LEVEL SECURITY;

ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses FORCE ROW LEVEL SECURITY;

ALTER TABLE pos_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_sessions FORCE ROW LEVEL SECURITY;

-- Sales Invoice Items Isolation Policy (relational to parent sales_invoices)
DROP POLICY IF EXISTS tenant_isolation_sales_invoice_items ON sales_invoice_items;
CREATE POLICY tenant_isolation_sales_invoice_items ON sales_invoice_items
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM sales_invoices si
            WHERE si.id = sales_invoice_items.invoice_id
              AND si.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND si.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM sales_invoices si
            WHERE si.id = sales_invoice_items.invoice_id
              AND si.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND si.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Invoice Sequences Isolation Policy
DROP POLICY IF EXISTS tenant_isolation_invoice_sequences ON invoice_sequences;
CREATE POLICY tenant_isolation_invoice_sequences ON invoice_sequences
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    );

-- Warehouses Isolation Policy
DROP POLICY IF EXISTS tenant_isolation_warehouses ON warehouses;
CREATE POLICY tenant_isolation_warehouses ON warehouses
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

-- POS Sessions Isolation Policy (relational to branch)
DROP POLICY IF EXISTS tenant_isolation_pos_sessions ON pos_sessions;
CREATE POLICY tenant_isolation_pos_sessions ON pos_sessions
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM branches b
            WHERE b.id = pos_sessions.branch_id
              AND b.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND b.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM branches b
            WHERE b.id = pos_sessions.branch_id
              AND b.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND b.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Grant privileges to app role billing_app if role exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sales_invoice_items TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE invoice_sequences TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE warehouses TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pos_sessions TO billing_app;
    END IF;
END $$;
