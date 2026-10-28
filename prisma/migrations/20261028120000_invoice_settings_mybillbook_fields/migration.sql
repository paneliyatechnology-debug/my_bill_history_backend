ALTER TABLE "company_invoice_print_settings"
  ALTER COLUMN "theme_id" SET DEFAULT 'advanced_gst_tally';

ALTER TABLE "company_invoice_print_settings"
  ADD COLUMN IF NOT EXISTS "show_emojis" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "print_history" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "auto_apply_luxury_for_sharing" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "show_po_number" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "show_eway_bill_number" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "show_vehicle_number" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "show_tax_column" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "show_batch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "show_expiry" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "show_sku" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "invoice_custom_fields" JSONB,
  ADD COLUMN IF NOT EXISTS "party_custom_fields" JSONB,
  ADD COLUMN IF NOT EXISTS "item_column_order" JSONB;
