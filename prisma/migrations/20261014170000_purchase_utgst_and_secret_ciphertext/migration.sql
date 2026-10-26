-- Nullable ciphertext columns for future sealed NIC secrets.
-- Existing rows stay NULL. Environment secrets are not copied into this table.

ALTER TABLE "gst_integration_configs" ADD COLUMN IF NOT EXISTS "einvoice_secret_ciphertext" TEXT;
ALTER TABLE "gst_integration_configs" ADD COLUMN IF NOT EXISTS "einvoice_password_ciphertext" TEXT;
ALTER TABLE "gst_integration_configs" ADD COLUMN IF NOT EXISTS "eway_secret_ciphertext" TEXT;
ALTER TABLE "gst_integration_configs" ADD COLUMN IF NOT EXISTS "eway_password_ciphertext" TEXT;
ALTER TABLE "gst_integration_configs" ADD COLUMN IF NOT EXISTS "secret_key_id" VARCHAR(40);

ALTER TABLE "purchase_returns" ADD COLUMN IF NOT EXISTS "utgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "purchase_return_items" ADD COLUMN IF NOT EXISTS "utgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00;
