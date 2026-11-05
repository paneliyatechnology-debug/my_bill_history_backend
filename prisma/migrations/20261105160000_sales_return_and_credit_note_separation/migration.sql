-- AlterTable: Add module separation and credit note fields to sales_returns
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "doc_type" VARCHAR(30) NOT NULL DEFAULT 'SALES_RETURN';
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "credit_note_type" VARCHAR(30);
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "gst_category" VARCHAR(30);
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "disposition" VARCHAR(30);
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "warehouse_id" UUID;
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "linked_return_id" UUID;
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "settlement_mode" VARCHAR(30);
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "refund_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "allocated_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "remaining_credit" DECIMAL(15,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "sales_returns_doc_type_idx" ON "sales_returns"("doc_type");

-- AlterTable: Make item linkage nullable for amount-based credit notes
ALTER TABLE "sales_return_items" ALTER COLUMN "sales_item_id" DROP NOT NULL;
ALTER TABLE "sales_return_items" ALTER COLUMN "item_id" DROP NOT NULL;
ALTER TABLE "sales_return_items" ADD COLUMN IF NOT EXISTS "description" VARCHAR(255);
ALTER TABLE "sales_return_items" ALTER COLUMN "quantity" SET DEFAULT 1.0000;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_returns_warehouse_id_fkey'
  ) THEN
    ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
