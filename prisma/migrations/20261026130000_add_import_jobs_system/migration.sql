-- 1. Create Enums
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DbImportStatus') THEN
        CREATE TYPE "DbImportStatus" AS ENUM ('PENDING', 'PARSING', 'VALIDATING', 'IMPORTING', 'COMPLETED', 'FAILED', 'CANCELLED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DbImportMode') THEN
        CREATE TYPE "DbImportMode" AS ENUM ('CREATE_ONLY', 'SKIP_DUPLICATES', 'UPDATE_EXISTING');
    END IF;
END $$;

-- 2. Create Import Jobs Table
CREATE TABLE IF NOT EXISTS "import_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID,
    "module" VARCHAR(50) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_format" VARCHAR(20) NOT NULL,
    "worksheet_name" VARCHAR(100),
    "status" "DbImportStatus" NOT NULL DEFAULT 'PENDING',
    "mode" "DbImportMode" NOT NULL DEFAULT 'SKIP_DUPLICATES',
    "error_policy" VARCHAR(30) NOT NULL DEFAULT 'IMPORT_VALID_ONLY',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "column_mapping" JSONB,
    "errors_json" JSONB,
    "summary_json" JSONB,
    "error_message" TEXT,
    "idempotency_key" VARCHAR(100),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- 3. Foreign Key
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'import_jobs_company_id_fkey') THEN
        ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS "import_jobs_organization_id_company_id_created_at_idx" ON "import_jobs"("organization_id", "company_id", "created_at");
CREATE INDEX IF NOT EXISTS "import_jobs_company_id_module_idx" ON "import_jobs"("company_id", "module");
CREATE INDEX IF NOT EXISTS "import_jobs_idempotency_key_idx" ON "import_jobs"("idempotency_key");

-- 5. RLS
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_import_jobs ON import_jobs;
CREATE POLICY tenant_isolation_import_jobs ON import_jobs
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

-- 6. Grants
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE import_jobs TO billing_app;
    END IF;
END $$;
