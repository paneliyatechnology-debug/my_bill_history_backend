-- CreateTable: support_sessions
CREATE TABLE IF NOT EXISTS "support_sessions" (
    "id" VARCHAR(64) NOT NULL,
    "actor_id" UUID NOT NULL,
    "target_organization_id" UUID NOT NULL,
    "target_company_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,

    CONSTRAINT "support_sessions_pkey" PRIMARY KEY ("id")
);

-- Indexes for high-throughput lookup & actor/company revocation
CREATE INDEX IF NOT EXISTS "idx_support_sessions_lookup" ON "support_sessions"("id", "is_revoked", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_support_sessions_actor" ON "support_sessions"("actor_id", "is_revoked");
CREATE INDEX IF NOT EXISTS "idx_support_sessions_comp" ON "support_sessions"("target_company_id", "is_revoked");

-- Permissions for billing_app role
DO $$ BEGIN
    GRANT ALL ON TABLE "support_sessions" TO billing_app;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
