-- Create shared_ledger_connections table with RLS
CREATE TABLE IF NOT EXISTS "shared_ledger_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'INVITED',
    "is_auto_paired" BOOLEAN NOT NULL DEFAULT false,
    "invited_at" TIMESTAMP(3),
    "last_viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_ledger_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "shared_ledger_connections_token_key" ON "shared_ledger_connections"("token");
CREATE INDEX IF NOT EXISTS "shared_ledger_connections_organization_id_company_id_idx" ON "shared_ledger_connections"("organization_id", "company_id");
CREATE INDEX IF NOT EXISTS "shared_ledger_connections_party_id_idx" ON "shared_ledger_connections"("party_id");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'shared_ledger_connections_party_id_fkey') THEN
        ALTER TABLE "shared_ledger_connections" ADD CONSTRAINT "shared_ledger_connections_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'shared_ledger_connections_company_id_fkey') THEN
        ALTER TABLE "shared_ledger_connections" ADD CONSTRAINT "shared_ledger_connections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "shared_ledger_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shared_ledger_connections" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_shared_ledger_connections ON shared_ledger_connections;
CREATE POLICY tenant_isolation_shared_ledger_connections ON shared_ledger_connections
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
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE shared_ledger_connections TO billing_app;
    END IF;
END $$;
