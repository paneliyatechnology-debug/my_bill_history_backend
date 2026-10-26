-- Add is_active column to ledger_accounts
ALTER TABLE ledger_accounts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Enable and force RLS on ledger_groups
ALTER TABLE ledger_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_groups FORCE ROW LEVEL SECURITY;

-- Enable and force RLS on ledger_accounts
ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_accounts FORCE ROW LEVEL SECURITY;

-- Enable and force RLS on journal_entries
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;

-- Enable and force RLS on payment_allocations
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations FORCE ROW LEVEL SECURITY;

-- Ledger Groups Isolation Policy
DROP POLICY IF EXISTS tenant_isolation_ledger_groups ON ledger_groups;
CREATE POLICY tenant_isolation_ledger_groups ON ledger_groups
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

-- Ledger Accounts Isolation Policy
DROP POLICY IF EXISTS tenant_isolation_ledger_accounts ON ledger_accounts;
CREATE POLICY tenant_isolation_ledger_accounts ON ledger_accounts
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

-- Journal Entries Isolation Policy (relational to parent voucher)
DROP POLICY IF EXISTS tenant_isolation_journal_entries ON journal_entries;
CREATE POLICY tenant_isolation_journal_entries ON journal_entries
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM vouchers v
            WHERE v.id = journal_entries.voucher_id
              AND v.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND v.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM vouchers v
            WHERE v.id = journal_entries.voucher_id
              AND v.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND v.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Payment Allocations Isolation Policy (relational to parent voucher)
DROP POLICY IF EXISTS tenant_isolation_payment_allocations ON payment_allocations;
CREATE POLICY tenant_isolation_payment_allocations ON payment_allocations
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM vouchers v
            WHERE v.id = payment_allocations.voucher_id
              AND v.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND v.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM vouchers v
            WHERE v.id = payment_allocations.voucher_id
              AND v.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND v.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Grant privileges to app role billing_app if role exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ledger_groups TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ledger_accounts TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE journal_entries TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE payment_allocations TO billing_app;
    END IF;
END $$;
