-- Create sms_campaigns and sms_campaign_recipients tables with RLS and foreign keys
CREATE TABLE IF NOT EXISTS "sms_campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "template_id" VARCHAR(100),
    "message" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "number_of_recipients" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(50) NOT NULL DEFAULT 'SENT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sms_campaign_recipients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "party_id" UUID,
    "party_name" VARCHAR(255) NOT NULL,
    "mobile_number" VARCHAR(50) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'DELIVERED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_campaign_recipients_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sms_campaigns_org_comp_idx" ON "sms_campaigns"("organization_id", "company_id");
CREATE INDEX IF NOT EXISTS "sms_campaigns_created_at_idx" ON "sms_campaigns"("created_at");

CREATE INDEX IF NOT EXISTS "sms_campaign_recipients_campaign_id_idx" ON "sms_campaign_recipients"("campaign_id");
CREATE INDEX IF NOT EXISTS "sms_campaign_recipients_org_comp_idx" ON "sms_campaign_recipients"("organization_id", "company_id");
CREATE INDEX IF NOT EXISTS "sms_campaign_recipients_party_id_idx" ON "sms_campaign_recipients"("party_id");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'sms_campaigns_company_id_fkey') THEN
        ALTER TABLE "sms_campaigns" ADD CONSTRAINT "sms_campaigns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'sms_campaign_recipients_campaign_id_fkey') THEN
        ALTER TABLE "sms_campaign_recipients" ADD CONSTRAINT "sms_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "sms_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'sms_campaign_recipients_party_id_fkey') THEN
        ALTER TABLE "sms_campaign_recipients" ADD CONSTRAINT "sms_campaign_recipients_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "sms_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_campaigns" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_sms_campaigns ON sms_campaigns;
CREATE POLICY tenant_isolation_sms_campaigns ON sms_campaigns
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

ALTER TABLE "sms_campaign_recipients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_campaign_recipients" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_sms_campaign_recipients ON sms_campaign_recipients;
CREATE POLICY tenant_isolation_sms_campaign_recipients ON sms_campaign_recipients
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
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sms_campaigns TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sms_campaign_recipients TO billing_app;
    END IF;
END $$;

