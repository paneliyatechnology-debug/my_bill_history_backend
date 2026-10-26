-- Enable Row Level Security on core tenant tables
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners / superusers
ALTER TABLE companies FORCE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
ALTER TABLE financial_years FORCE ROW LEVEL SECURITY;
ALTER TABLE parties FORCE ROW LEVEL SECURITY;
ALTER TABLE vouchers FORCE ROW LEVEL SECURITY;
ALTER TABLE sales_invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE stock_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- Companies Isolation Policy
CREATE POLICY tenant_isolation_companies ON companies
    AS RESTRICTIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    );

-- Branches Isolation Policy
CREATE POLICY tenant_isolation_branches ON branches
    AS RESTRICTIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Financial Years Isolation Policy
CREATE POLICY tenant_isolation_financial_years ON financial_years
    AS RESTRICTIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    );

-- Parties Isolation Policy
CREATE POLICY tenant_isolation_parties ON parties
    AS RESTRICTIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Vouchers Isolation Policy
CREATE POLICY tenant_isolation_vouchers ON vouchers
    AS RESTRICTIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Sales Invoices Isolation Policy
CREATE POLICY tenant_isolation_sales_invoices ON sales_invoices
    AS RESTRICTIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Stock Transactions Isolation Policy
CREATE POLICY tenant_isolation_stock_transactions ON stock_transactions
    AS RESTRICTIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Audit Logs Isolation Policy
CREATE POLICY tenant_isolation_audit_logs ON audit_logs
    AS RESTRICTIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );