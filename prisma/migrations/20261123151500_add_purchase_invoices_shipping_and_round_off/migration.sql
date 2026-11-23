-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "shipping_address" JSONB;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "terms_and_conditions" TEXT;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "round_off" DECIMAL(6, 2);
