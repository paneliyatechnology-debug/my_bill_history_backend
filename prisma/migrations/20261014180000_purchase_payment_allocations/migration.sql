-- Link a payment allocation to either a sales invoice or a purchase bill.
-- Existing sales allocations keep invoice_id. Purchase payments set purchase_invoice_id.

ALTER TABLE "payment_allocations" ALTER COLUMN "invoice_id" DROP NOT NULL;

ALTER TABLE "payment_allocations"
  ADD COLUMN IF NOT EXISTS "purchase_invoice_id" UUID;

ALTER TABLE "payment_allocations"
  DROP CONSTRAINT IF EXISTS "payment_allocations_purchase_invoice_id_fkey";

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_purchase_invoice_id_fkey"
  FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "payment_allocations_purchase_invoice_id_idx"
  ON "payment_allocations"("purchase_invoice_id");

ALTER TABLE "payment_allocations"
  DROP CONSTRAINT IF EXISTS "payment_allocations_one_document";

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_one_document"
  CHECK (
    ("invoice_id" IS NOT NULL AND "purchase_invoice_id" IS NULL)
    OR ("invoice_id" IS NULL AND "purchase_invoice_id" IS NOT NULL)
  );
