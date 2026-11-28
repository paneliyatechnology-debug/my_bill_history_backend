-- AlterEnum
BEGIN;
CREATE TYPE "DbImportStatus_new" AS ENUM ('PENDING', 'PARSING', 'VALIDATING', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');
ALTER TABLE "import_jobs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "import_jobs" ALTER COLUMN "status" TYPE "DbImportStatus_new" USING ("status"::text::"DbImportStatus_new");
ALTER TYPE "DbImportStatus" RENAME TO "DbImportStatus_old";
ALTER TYPE "DbImportStatus_new" RENAME TO "DbImportStatus";
DROP TYPE "DbImportStatus_old";
ALTER TABLE "import_jobs" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
ALTER TYPE "InvoiceCategory" ADD VALUE 'SALES_ORDER';

-- DropForeignKey
ALTER TABLE "sms_campaign_recipients" DROP CONSTRAINT "sms_campaign_recipients_party_id_fkey";

-- AlterTable
ALTER TABLE "advance_adjustments" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "advance_receipts" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "automated_billing_lines" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "automated_billing_runs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "automated_billing_schedules" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "company_invoice_print_settings" ADD COLUMN     "orientation" VARCHAR(20) NOT NULL DEFAULT 'portrait',
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "coupons" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "delivery_challan_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "delivery_challans" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "gst_api_audit_logs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "gst_integration_configs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "gstr2b_adjustments" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "gstr2b_imports" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "gstr2b_lines" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "gstr2b_reconciliations" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "hsn_masters" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "import_jobs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "invoice_themes" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "custom_fields" JSONB,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "notification_deliveries" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notification_devices" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notification_preferences" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "outward_debit_note_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "outward_debit_notes" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "party_appointments" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "party_notes" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "platform_addons" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "platform_settings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "purchase_bill_scans" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "purchase_return_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "purchase_returns" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sales_return_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sales_returns" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "scheduled_reminder_logs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "shared_ledger_connections" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sms_campaign_recipients" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sms_campaigns" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "staff_payments" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stock_transfer_items" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stock_transfers" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "subscription_plans" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "financial_year_id" UUID,
    "party_id" UUID NOT NULL,
    "order_number" VARCHAR(100) NOT NULL,
    "order_date" DATE NOT NULL,
    "valid_till" DATE,
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "place_of_supply" VARCHAR(10),
    "taxable_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "freight_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "overall_discount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "additional_charges" JSONB,
    "grand_total" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "notes" TEXT,
    "terms_and_conditions" TEXT,
    "converted_invoice_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "item_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "hsn_code" VARCHAR(20),
    "unit" VARCHAR(30),
    "quantity" DECIMAL(15,4) NOT NULL,
    "rate" DECIMAL(15,4) NOT NULL,
    "discount_percent" DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    "tax_rate" DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    "taxable_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_company_id_order_date_idx" ON "purchase_orders"("organization_id", "company_id", "order_date");

-- CreateIndex
CREATE INDEX "purchase_orders_company_id_status_idx" ON "purchase_orders"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_company_id_order_number_key" ON "purchase_orders"("company_id", "order_number");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "automated_billing_runs_org_comp_idx" RENAME TO "automated_billing_runs_organization_id_company_id_idx";

-- RenameIndex
ALTER INDEX "automated_billing_runs_schedule_occurrence_unique" RENAME TO "automated_billing_runs_schedule_id_occurrence_key_key";

-- RenameIndex
ALTER INDEX "automated_billing_schedules_next_run_idx" RENAME TO "automated_billing_schedules_next_run_at_idx";

-- RenameIndex
ALTER INDEX "automated_billing_schedules_org_comp_idx" RENAME TO "automated_billing_schedules_organization_id_company_id_idx";

-- RenameIndex
ALTER INDEX "automated_billing_schedules_party_idx" RENAME TO "automated_billing_schedules_party_id_idx";

-- RenameIndex
ALTER INDEX "company_invoice_print_settings_org_company_idx" RENAME TO "company_invoice_print_settings_organization_id_company_id_idx";

-- RenameIndex
ALTER INDEX "gstr2b_lines_company_id_supplier_gstin_normalized_invoice_numbe" RENAME TO "gstr2b_lines_company_id_supplier_gstin_normalized_invoice_n_idx";

-- RenameIndex
ALTER INDEX "gstr2b_reconciliations_organization_id_company_id_return_period" RENAME TO "gstr2b_reconciliations_organization_id_company_id_return_pe_idx";

-- RenameIndex
ALTER INDEX "notification_deliveries_notification_status_idx" RENAME TO "notification_deliveries_notification_id_status_idx";

-- RenameIndex
ALTER INDEX "notification_devices_org_user_idx" RENAME TO "notification_devices_organization_id_user_id_idx";

-- RenameIndex
ALTER INDEX "notification_devices_user_active_idx" RENAME TO "notification_devices_user_id_is_active_idx";

-- RenameIndex
ALTER INDEX "notifications_comp_entity_idx" RENAME TO "notifications_company_id_entity_type_entity_id_idx";

-- RenameIndex
ALTER INDEX "notifications_org_comp_recipient_read_created_idx" RENAME TO "notifications_organization_id_company_id_recipient_user_id__idx";

-- RenameIndex
ALTER INDEX "notifications_recipient_created_idx" RENAME TO "notifications_recipient_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "scheduled_reminder_logs_company_entity_idx" RENAME TO "scheduled_reminder_logs_company_id_entity_type_entity_id_idx";

-- RenameIndex
ALTER INDEX "scheduled_reminder_logs_company_id_entity_type_entity_id_remind" RENAME TO "scheduled_reminder_logs_company_id_entity_type_entity_id_re_key";

-- RenameIndex
ALTER INDEX "sms_campaign_recipients_org_comp_idx" RENAME TO "sms_campaign_recipients_organization_id_company_id_idx";

-- RenameIndex
ALTER INDEX "sms_campaigns_org_comp_idx" RENAME TO "sms_campaigns_organization_id_company_id_idx";

