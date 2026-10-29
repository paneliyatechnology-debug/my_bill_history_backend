-- Create party_notes and party_appointments tables with RLS and foreign keys
CREATE TABLE IF NOT EXISTS "party_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "party_appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "date" DATE NOT NULL,
    "time" VARCHAR(50) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_appointments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "party_notes_organization_id_company_id_idx" ON "party_notes"("organization_id", "company_id");
CREATE INDEX IF NOT EXISTS "party_notes_party_id_idx" ON "party_notes"("party_id");

CREATE INDEX IF NOT EXISTS "party_appointments_organization_id_company_id_idx" ON "party_appointments"("organization_id", "company_id");
CREATE INDEX IF NOT EXISTS "party_appointments_party_id_idx" ON "party_appointments"("party_id");
CREATE INDEX IF NOT EXISTS "party_appointments_date_idx" ON "party_appointments"("date");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'party_notes_party_id_fkey') THEN
        ALTER TABLE "party_notes" ADD CONSTRAINT "party_notes_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'party_notes_company_id_fkey') THEN
        ALTER TABLE "party_notes" ADD CONSTRAINT "party_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'party_appointments_party_id_fkey') THEN
        ALTER TABLE "party_appointments" ADD CONSTRAINT "party_appointments_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'party_appointments_company_id_fkey') THEN
        ALTER TABLE "party_appointments" ADD CONSTRAINT "party_appointments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "party_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "party_notes" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_party_notes ON party_notes;
CREATE POLICY tenant_isolation_party_notes ON party_notes
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

ALTER TABLE "party_appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "party_appointments" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_party_appointments ON party_appointments;
CREATE POLICY tenant_isolation_party_appointments ON party_appointments
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
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE party_notes TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE party_appointments TO billing_app;
    END IF;
END $$;
