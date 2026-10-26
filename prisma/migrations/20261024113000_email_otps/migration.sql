CREATE TABLE IF NOT EXISTS "email_otps" (
    "id" UUID NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "purpose" VARCHAR(32) NOT NULL,
    "code_hash" VARCHAR(128) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_otps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_otps_email_purpose_created_at_idx"
    ON "email_otps"("email", "purpose", "created_at");

DO $$ BEGIN
    GRANT ALL ON TABLE "email_otps" TO billing_app;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
