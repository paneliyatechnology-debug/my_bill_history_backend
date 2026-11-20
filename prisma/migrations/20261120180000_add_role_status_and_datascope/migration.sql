-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "DataScope" AS ENUM ('OWN_RECORDS', 'ASSIGNED_BRANCH', 'ALL_ORGANIZATION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PARTNER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'STOCK_MANAGER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DELIVERY_BOY';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CUSTOM';

ALTER TYPE "InvoiceCategory" ADD VALUE IF NOT EXISTS 'QUOTATION';

ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'CONVERTED';

ALTER TYPE "DeliveryChallanStatus" ADD VALUE IF NOT EXISTS 'CONVERTED';

-- AlterTable users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" VARCHAR(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "can_override_price" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "custom_role_id" UUID;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "data_scope" "DataScope" NOT NULL DEFAULT 'ALL_ORGANIZATION';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "joining_date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "max_discount_percent" DECIMAL(5,2);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "max_invoice_amount" DECIMAL(15,2);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "session_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" VARCHAR(50);
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable sales_invoices
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "converted_invoice_id" UUID;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "delivery_challan_id" UUID;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "quotation_id" UUID;

-- CreateTable subscription_payments
CREATE TABLE IF NOT EXISTS "subscription_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "organization_id" UUID,
    "order_id" VARCHAR(100) NOT NULL,
    "payment_id" VARCHAR(100),
    "signature" VARCHAR(255),
    "tier" "SubscriptionTier" NOT NULL,
    "billing_cycle" VARCHAR(20) NOT NULL DEFAULT 'yearly',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "receipt_no" VARCHAR(100) NOT NULL,
    "notes" JSONB,
    "payment_method" VARCHAR(50),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable roles
CREATE TABLE IF NOT EXISTS "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "system_role" "UserRole",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "data_scope" "DataScope" NOT NULL DEFAULT 'ALL_ORGANIZATION',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable role_permissions
CREATE TABLE IF NOT EXISTS "role_permissions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable user_permissions
CREATE TABLE IF NOT EXISTS "user_permissions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable approval_requests
CREATE TABLE IF NOT EXISTS "approval_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "document_id" UUID NOT NULL,
    "document_number" VARCHAR(100) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "reason" VARCHAR(255),
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "comments" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_payments_order_id_key" ON "subscription_payments"("order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_payments_payment_id_key" ON "subscription_payments"("payment_id");
CREATE INDEX IF NOT EXISTS "subscription_payments_tenant_id_idx" ON "subscription_payments"("tenant_id");
CREATE INDEX IF NOT EXISTS "subscription_payments_order_id_idx" ON "subscription_payments"("order_id");
CREATE INDEX IF NOT EXISTS "subscription_payments_payment_id_idx" ON "subscription_payments"("payment_id");

CREATE INDEX IF NOT EXISTS "roles_organization_id_idx" ON "roles"("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "roles_organization_id_name_key" ON "roles"("organization_id", "name");

CREATE INDEX IF NOT EXISTS "role_permissions_role_id_idx" ON "role_permissions"("role_id");
CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_role_id_module_action_key" ON "role_permissions"("role_id", "module", "action");

CREATE INDEX IF NOT EXISTS "user_permissions_user_id_idx" ON "user_permissions"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "user_permissions_user_id_module_action_key" ON "user_permissions"("user_id", "module", "action");

CREATE INDEX IF NOT EXISTS "approval_requests_organization_id_company_id_status_idx" ON "approval_requests"("organization_id", "company_id", "status");
CREATE INDEX IF NOT EXISTS "approval_requests_document_type_document_id_idx" ON "approval_requests"("document_type", "document_id");

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_invoices_converted_invoice_id_key" ON "sales_invoices"("converted_invoice_id");
CREATE INDEX IF NOT EXISTS "sales_invoices_quotation_id_idx" ON "sales_invoices"("quotation_id");
CREATE INDEX IF NOT EXISTS "sales_invoices_delivery_challan_id_idx" ON "sales_invoices"("delivery_challan_id");
CREATE INDEX IF NOT EXISTS "sales_invoices_created_by_id_idx" ON "sales_invoices"("created_by_id");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "users" ADD CONSTRAINT "users_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_converted_invoice_id_fkey" FOREIGN KEY ("converted_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_delivery_challan_id_fkey" FOREIGN KEY ("delivery_challan_id") REFERENCES "delivery_challans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Grant permissions to billing_app if present
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "subscription_payments" TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "roles" TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "role_permissions" TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "user_permissions" TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "approval_requests" TO billing_app;
    END IF;
END $$;
