-- Create Enums if not exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationType') THEN
        CREATE TYPE "NotificationType" AS ENUM (
            'PAYMENT_RECEIVED',
            'PAYMENT_SENT',
            'INVOICE_DUE_REMINDER',
            'PURCHASE_DUE_REMINDER',
            'OVERDUE_INVOICE',
            'SALARY_PAID',
            'PAYMENT_REVERSED',
            'OTHER'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DevicePlatform') THEN
        CREATE TYPE "DevicePlatform" AS ENUM ('WEB', 'ANDROID', 'IOS');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PushProvider') THEN
        CREATE TYPE "PushProvider" AS ENUM ('WEB_PUSH', 'FCM', 'APNS');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationChannel') THEN
        CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'WEB_PUSH', 'FCM', 'APNS');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeliveryStatus') THEN
        CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
    END IF;
END $$;

-- Add due_date column to purchase_invoices
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "due_date" DATE;

-- 1. Create notifications table
CREATE TABLE IF NOT EXISTS "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "data" JSONB,
    "read_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- 2. Create notification_devices table
CREATE TABLE IF NOT EXISTS "notification_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID,
    "user_id" UUID NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "provider" "PushProvider" NOT NULL,
    "token" TEXT,
    "endpoint" TEXT,
    "p256dh_key" TEXT,
    "auth_key" TEXT,
    "device_id" VARCHAR(255),
    "app_version" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_devices_pkey" PRIMARY KEY ("id")
);

-- 3. Create notification_deliveries table
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "device_id" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "last_error_code" VARCHAR(100),
    "last_error_message" TEXT,
    "provider_message_id" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- 4. Create notification_preferences table
CREATE TABLE IF NOT EXISTS "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "payment_received" BOOLEAN NOT NULL DEFAULT true,
    "payment_sent" BOOLEAN NOT NULL DEFAULT true,
    "invoice_due_reminder" BOOLEAN NOT NULL DEFAULT true,
    "purchase_due_reminder" BOOLEAN NOT NULL DEFAULT true,
    "overdue_reminder" BOOLEAN NOT NULL DEFAULT true,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- 5. Create scheduled_reminder_logs table
CREATE TABLE IF NOT EXISTS "scheduled_reminder_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "reminder_type" VARCHAR(50) NOT NULL,
    "due_date" DATE NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'SENT',
    "outstanding_amount" DECIMAL(15,2) NOT NULL,
    "notification_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_reminder_logs_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_preferences_company_id_user_id_key') THEN
        ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_company_id_user_id_key" UNIQUE ("company_id", "user_id");
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_reminder_logs_company_id_entity_type_entity_id_reminder_type_due_date_key') THEN
        ALTER TABLE "scheduled_reminder_logs" ADD CONSTRAINT "scheduled_reminder_logs_company_id_entity_type_entity_id_reminder_type_due_date_key" UNIQUE ("company_id", "entity_type", "entity_id", "reminder_type", "due_date");
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "notifications_org_comp_recipient_read_created_idx" ON "notifications"("organization_id", "company_id", "recipient_user_id", "read_at", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_comp_entity_idx" ON "notifications"("company_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "notifications_recipient_created_idx" ON "notifications"("recipient_user_id", "created_at");

CREATE INDEX IF NOT EXISTS "notification_devices_user_active_idx" ON "notification_devices"("user_id", "is_active");
CREATE INDEX IF NOT EXISTS "notification_devices_org_user_idx" ON "notification_devices"("organization_id", "user_id");

CREATE INDEX IF NOT EXISTS "notification_deliveries_notification_status_idx" ON "notification_deliveries"("notification_id", "status");

CREATE INDEX IF NOT EXISTS "scheduled_reminder_logs_company_entity_idx" ON "scheduled_reminder_logs"("company_id", "entity_type", "entity_id");

-- Foreign Keys
DO $$
BEGIN
    -- notifications
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'notifications_company_id_fkey') THEN
        ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'notifications_organization_id_fkey') THEN
        ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'notifications_recipient_user_id_fkey') THEN
        ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- notification_devices
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'notification_devices_organization_id_fkey') THEN
        ALTER TABLE "notification_devices" ADD CONSTRAINT "notification_devices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'notification_devices_user_id_fkey') THEN
        ALTER TABLE "notification_devices" ADD CONSTRAINT "notification_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- notification_deliveries
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'notification_deliveries_notification_id_fkey') THEN
        ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'notification_deliveries_device_id_fkey') THEN
        ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "notification_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- notification_preferences
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'notification_preferences_company_id_fkey') THEN
        ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'notification_preferences_organization_id_fkey') THEN
        ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'notification_preferences_user_id_fkey') THEN
        ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- scheduled_reminder_logs
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'scheduled_reminder_logs_company_id_fkey') THEN
        ALTER TABLE "scheduled_reminder_logs" ADD CONSTRAINT "scheduled_reminder_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Row Level Security (RLS)
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_notifications ON "notifications";
CREATE POLICY tenant_isolation_notifications ON "notifications"
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

ALTER TABLE "notification_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_devices" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_notification_devices ON "notification_devices";
CREATE POLICY tenant_isolation_notification_devices ON "notification_devices"
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
        )
    );

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_notification_preferences ON "notification_preferences";
CREATE POLICY tenant_isolation_notification_preferences ON "notification_preferences"
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

ALTER TABLE "scheduled_reminder_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scheduled_reminder_logs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_scheduled_reminder_logs ON "scheduled_reminder_logs";
CREATE POLICY tenant_isolation_scheduled_reminder_logs ON "scheduled_reminder_logs"
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
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "notifications" TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "notification_devices" TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "notification_deliveries" TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "notification_preferences" TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "scheduled_reminder_logs" TO billing_app;
    END IF;
END $$;

