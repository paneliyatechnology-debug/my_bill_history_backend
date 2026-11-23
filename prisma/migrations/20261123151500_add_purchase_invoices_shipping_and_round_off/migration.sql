-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "shipping_address" JSONB;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "terms_and_conditions" TEXT;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "round_off" DECIMAL(6, 2) DEFAULT 0.00;
UPDATE "purchase_invoices" SET "round_off" = 0.00 WHERE "round_off" IS NULL;
