-- Enable RLS and Force RLS on catalog tables
ALTER TABLE units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE units_of_measure FORCE ROW LEVEL SECURITY;

ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_categories FORCE ROW LEVEL SECURITY;

ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE items FORCE ROW LEVEL SECURITY;

ALTER TABLE item_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_batches FORCE ROW LEVEL SECURITY;

-- Unit of Measure Isolation Policy
DROP POLICY IF EXISTS tenant_isolation_uom ON units_of_measure;
CREATE POLICY tenant_isolation_uom ON units_of_measure
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

-- Item Categories Isolation Policy
DROP POLICY IF EXISTS tenant_isolation_item_categories ON item_categories;
CREATE POLICY tenant_isolation_item_categories ON item_categories
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

-- Items Isolation Policy
DROP POLICY IF EXISTS tenant_isolation_items ON items;
CREATE POLICY tenant_isolation_items ON items
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

-- Item Batches Isolation Policy (via parent item)
DROP POLICY IF EXISTS tenant_isolation_item_batches ON item_batches;
CREATE POLICY tenant_isolation_item_batches ON item_batches
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM items
            WHERE items.id = item_batches.item_id
              AND items.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND items.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR EXISTS (
            SELECT 1 FROM items
            WHERE items.id = item_batches.item_id
              AND items.organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
              AND items.company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Ensure billing_app permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO billing_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO billing_app;
