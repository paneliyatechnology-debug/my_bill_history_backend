-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('TRIAL', 'RETAIL_BASIC', 'WHOLESALE_PRO', 'DISTRIBUTION_ENTERPRISE', 'MANUFACTURING_SUITE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ORG_ADMIN', 'COMPANY_ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER', 'CASHIER', 'SALESMAN', 'AUDITOR');

-- CreateEnum
CREATE TYPE "GstRegistrationType" AS ENUM ('REGULAR', 'COMPOSITION', 'UNREGISTERED', 'CONSUMER', 'OVERSEAS', 'SPECIAL_ECONOMIC_ZONE');

-- CreateEnum
CREATE TYPE "ValuationMethod" AS ENUM ('FIFO', 'WEIGHTED_AVERAGE', 'BATCH_ACTUAL');

-- CreateEnum
CREATE TYPE "InventoryIntegrationMode" AS ENUM ('PERIODIC_TRADING', 'PERPETUAL_COGS');

-- CreateEnum
CREATE TYPE "AccountNature" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('SALES', 'PURCHASE', 'PAYMENT', 'RECEIPT', 'CONTRA', 'JOURNAL', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'BOTH', 'BROKER', 'JOB_WORKER');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "StockTransactionType" AS ENUM ('OPENING', 'PURCHASE_RECEIPT', 'PURCHASE_RETURN', 'SALES_DISPATCH', 'SALES_RETURN', 'SALES_CANCELLATION', 'STOCK_TRANSFER_IN', 'STOCK_TRANSFER_OUT', 'MANUFACTURING_CONSUMPTION', 'MANUFACTURING_YIELD', 'STOCK_ADJUSTMENT_PLUS', 'STOCK_ADJUSTMENT_MINUS');

-- CreateEnum
CREATE TYPE "InvoiceCategory" AS ENUM ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'EXPORT_INVOICE', 'PROFORMA_INVOICE', 'DELIVERY_CHALLAN');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'UPI_QR', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT_NOTE', 'SPLIT', 'UNPAID_CREDIT');

-- CreateEnum
CREATE TYPE "ProductionStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "primary_phone" VARCHAR(20) NOT NULL,
    "primary_email" VARCHAR(255),
    "subscription_tier" "SubscriptionTier" NOT NULL DEFAULT 'TRIAL',
    "subscription_ends_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "legal_name" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "legal_name" VARCHAR(255) NOT NULL,
    "trade_name" VARCHAR(255) NOT NULL,
    "gstin" VARCHAR(15),
    "pan" VARCHAR(10),
    "state_code" CHAR(2) NOT NULL,
    "gst_type" "GstRegistrationType" NOT NULL DEFAULT 'REGULAR',
    "composition_scheme" BOOLEAN NOT NULL DEFAULT false,
    "e_invoice_applicable" BOOLEAN NOT NULL DEFAULT false,
    "currency_code" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "address_line1" VARCHAR(255) NOT NULL,
    "address_line2" VARCHAR(255),
    "city" VARCHAR(100) NOT NULL,
    "district" VARCHAR(100),
    "pincode" VARCHAR(10) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(100),
    "bank_name" VARCHAR(100),
    "bank_account_no" VARCHAR(50),
    "bank_ifsc" VARCHAR(15),
    "bank_branch" VARCHAR(100),
    "upi_vpa" VARCHAR(100),
    "enable_gujarati_print" BOOLEAN NOT NULL DEFAULT true,
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
    "inventory_costing_method" "ValuationMethod" NOT NULL DEFAULT 'FIFO',
    "inventory_integration_mode" "InventoryIntegrationMode" NOT NULL DEFAULT 'PERIODIC_TRADING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "is_main_branch" BOOLEAN NOT NULL DEFAULT false,
    "address_line1" VARCHAR(255) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "pincode" VARCHAR(10) NOT NULL,
    "state_code" CHAR(2) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_years" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "full_name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CASHIER',
    "preferred_lang" VARCHAR(5) NOT NULL DEFAULT 'en',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_branch_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "entity_name" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "previous_state" JSONB,
    "new_state" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(255),
    "prev_hash" VARCHAR(64),
    "record_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_groups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "name_gujarati" VARCHAR(150),
    "nature" "AccountNature" NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "name_gujarati" VARCHAR(200),
    "code" VARCHAR(50),
    "is_party_ledger" BOOLEAN NOT NULL DEFAULT false,
    "party_id" UUID,
    "is_bank_ledger" BOOLEAN NOT NULL DEFAULT false,
    "is_cash_ledger" BOOLEAN NOT NULL DEFAULT false,
    "is_tax_ledger" BOOLEAN NOT NULL DEFAULT false,
    "tax_rate" DECIMAL(5,2),
    "opening_balance" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "opening_type" CHAR(2) NOT NULL DEFAULT 'DR',
    "current_balance" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "voucher_type" "VoucherType" NOT NULL,
    "voucher_number" VARCHAR(100) NOT NULL,
    "voucher_date" DATE NOT NULL,
    "reference_no" VARCHAR(100),
    "narration" TEXT,
    "narration_gujarati" TEXT,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "is_auto_generated" BOOLEAN NOT NULL DEFAULT false,
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    "source_document" VARCHAR(50),
    "source_entity_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "debit_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "credit_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "line_narration" VARCHAR(255),
    "sequence_order" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "allocated_amount" DECIMAL(15,2) NOT NULL,
    "cash_discount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "allocation_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "PartyType" NOT NULL DEFAULT 'CUSTOMER',
    "name" VARCHAR(200) NOT NULL,
    "name_gujarati" VARCHAR(200),
    "contact_person" VARCHAR(150),
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(150),
    "gstin" VARCHAR(15),
    "pan" VARCHAR(10),
    "gst_type" "GstRegistrationType" NOT NULL DEFAULT 'UNREGISTERED',
    "state_code" CHAR(2) NOT NULL,
    "billing_address" JSONB NOT NULL,
    "shipping_address" JSONB,
    "credit_limit" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "credit_days" INTEGER NOT NULL DEFAULT 0,
    "interest_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "default_discount" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "bank_details" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units_of_measure" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "symbol" VARCHAR(20) NOT NULL,
    "uqc_code" VARCHAR(10) NOT NULL,
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_categories" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_gujarati" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "category_id" UUID,
    "type" "ItemType" NOT NULL DEFAULT 'PRODUCT',
    "name" VARCHAR(255) NOT NULL,
    "name_gujarati" VARCHAR(255),
    "sku" VARCHAR(100),
    "barcode" VARCHAR(100),
    "hsn_code" VARCHAR(10) NOT NULL,
    "primary_uom_id" UUID NOT NULL,
    "secondary_uom_id" UUID,
    "conversion_factor" DECIMAL(12,4),
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "cess_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "cess_per_unit" DECIMAL(10,4) NOT NULL DEFAULT 0.00,
    "purchase_rate" DECIMAL(15,4) NOT NULL DEFAULT 0.00,
    "retail_price" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "wholesale_price" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "mrp" DECIMAL(15,2),
    "min_stock_level" DECIMAL(15,4) NOT NULL DEFAULT 0.00,
    "reorder_quantity" DECIMAL(15,4) NOT NULL DEFAULT 0.00,
    "track_batches" BOOLEAN NOT NULL DEFAULT false,
    "track_serial_no" BOOLEAN NOT NULL DEFAULT false,
    "valuation_method" "ValuationMethod" NOT NULL DEFAULT 'FIFO',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_batches" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "batch_number" VARCHAR(100) NOT NULL,
    "mfg_date" DATE,
    "expiry_date" DATE,
    "purchase_rate" DECIMAL(15,4) NOT NULL,
    "mrp" DECIMAL(15,2) NOT NULL,
    "sale_price" DECIMAL(15,2) NOT NULL,
    "barcode" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "address" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "batch_id" UUID,
    "transaction_type" "StockTransactionType" NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "valuation_rate" DECIMAL(15,4) NOT NULL,
    "total_valuation" DECIMAL(15,2) NOT NULL,
    "is_provisional_cost" BOOLEAN NOT NULL DEFAULT false,
    "cost_variance" DECIMAL(15,4) NOT NULL DEFAULT 0.00,
    "reference_doc_type" VARCHAR(50) NOT NULL,
    "reference_doc_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_sequences" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "branch_id" UUID,
    "prefix" VARCHAR(20) NOT NULL,
    "current_number" INTEGER NOT NULL DEFAULT 0,
    "padding" INTEGER NOT NULL DEFAULT 4,
    "category" "InvoiceCategory" NOT NULL,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "category" "InvoiceCategory" NOT NULL DEFAULT 'TAX_INVOICE',
    "invoice_number" VARCHAR(100) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'UNPAID_CREDIT',
    "is_b2b" BOOLEAN NOT NULL DEFAULT false,
    "is_reverse_charge" BOOLEAN NOT NULL DEFAULT false,
    "place_of_supply" CHAR(2) NOT NULL,
    "billing_address" JSONB NOT NULL,
    "shipping_address" JSONB,
    "sub_total" DECIMAL(15,2) NOT NULL,
    "discount_total" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "taxable_amount" DECIMAL(15,2) NOT NULL,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "cess_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "round_off" DECIMAL(6,2) NOT NULL DEFAULT 0.00,
    "grand_total" DECIMAL(15,2) NOT NULL,
    "paid_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "balance_amount" DECIMAL(15,2) NOT NULL,
    "terms_and_conditions" TEXT,
    "notes" TEXT,
    "client_offline_uuid" VARCHAR(100),
    "provisional_cost_reconciled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "description" VARCHAR(255),
    "hsn_code" VARCHAR(10) NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "unit_price" DECIMAL(15,4) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "discount_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "taxable_amount" DECIMAL(15,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "cess_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "sales_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_sessions" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "opening_cash" DECIMAL(15,2) NOT NULL,
    "closing_cash" DECIMAL(15,2),
    "expected_cash" DECIMAL(15,2),
    "cash_difference" DECIMAL(15,2),
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "pos_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "financial_year_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "vendor_invoice_number" VARCHAR(100) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "place_of_supply" CHAR(2) NOT NULL,
    "taxable_amount" DECIMAL(15,2) NOT NULL,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "cess_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "grand_total" DECIMAL(15,2) NOT NULL,
    "paid_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "balance_amount" DECIMAL(15,2) NOT NULL,
    "itc_eligibility" VARCHAR(20) NOT NULL DEFAULT 'INPUT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "hsn_code" VARCHAR(10) NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "unit_price" DECIMAL(15,4) NOT NULL,
    "taxable_amount" DECIMAL(15,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "cgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "sgst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "igst_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "total_amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "purchase_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills_of_material" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "finished_item_id" UUID NOT NULL,
    "bom_name" VARCHAR(150) NOT NULL,
    "batch_yield_qty" DECIMAL(15,4) NOT NULL,
    "labor_cost_est" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "overhead_cost_est" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bills_of_material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_items" (
    "id" UUID NOT NULL,
    "bom_id" UUID NOT NULL,
    "raw_item_id" UUID NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "wastage_percent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,

    CONSTRAINT "bom_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "bom_id" UUID NOT NULL,
    "order_number" VARCHAR(100) NOT NULL,
    "target_quantity" DECIMAL(15,4) NOT NULL,
    "status" "ProductionStatus" NOT NULL DEFAULT 'PLANNED',
    "start_date" DATE NOT NULL,
    "completed_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_batches" (
    "id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "batch_number" VARCHAR(100) NOT NULL,
    "actual_produced_qty" DECIMAL(15,4) NOT NULL,
    "scrap_quantity" DECIMAL(15,4) NOT NULL DEFAULT 0.00,
    "raw_material_cost" DECIMAL(15,2) NOT NULL,
    "actual_labor_cost" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "actual_overhead_cost" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "unit_cost" DECIMAL(15,4) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "einvoice_records" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "irn" VARCHAR(64) NOT NULL,
    "ack_no" VARCHAR(50) NOT NULL,
    "ack_date" TIMESTAMP(3) NOT NULL,
    "signed_invoice" TEXT NOT NULL,
    "signed_qr_code" TEXT NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACT',
    "cancel_reason" VARCHAR(255),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "einvoice_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eway_bill_records" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "ewb_number" VARCHAR(20) NOT NULL,
    "ewb_date" TIMESTAMP(3) NOT NULL,
    "valid_upto" TIMESTAMP(3) NOT NULL,
    "distance_km" INTEGER NOT NULL,
    "vehicle_number" VARCHAR(20),
    "transporter_id" VARCHAR(15),
    "transporter_name" VARCHAR(150),
    "status" VARCHAR(10) NOT NULL DEFAULT 'ACT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eway_bill_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_primary_phone_key" ON "tenants"("primary_phone");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_primary_email_key" ON "tenants"("primary_email");

-- CreateIndex
CREATE INDEX "organizations_tenant_id_idx" ON "organizations"("tenant_id");

-- CreateIndex
CREATE INDEX "companies_organization_id_idx" ON "companies"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_gstin_organization_id_key" ON "companies"("gstin", "organization_id");

-- CreateIndex
CREATE INDEX "branches_organization_id_company_id_idx" ON "branches"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_company_id_code_key" ON "branches"("company_id", "code");

-- CreateIndex
CREATE INDEX "financial_years_company_id_idx" ON "financial_years"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_years_company_id_start_date_end_date_key" ON "financial_years"("company_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "user_branch_assignments_user_id_idx" ON "user_branch_assignments"("user_id");

-- CreateIndex
CREATE INDEX "user_branch_assignments_branch_id_idx" ON "user_branch_assignments"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_branch_assignments_user_id_branch_id_key" ON "user_branch_assignments"("user_id", "branch_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_company_id_entity_name_entity_id_idx" ON "audit_logs"("organization_id", "company_id", "entity_name", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "ledger_groups_organization_id_company_id_idx" ON "ledger_groups"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_groups_company_id_name_key" ON "ledger_groups"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_party_id_key" ON "ledger_accounts"("party_id");

-- CreateIndex
CREATE INDEX "ledger_accounts_organization_id_company_id_idx" ON "ledger_accounts"("organization_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_company_id_name_key" ON "ledger_accounts"("company_id", "name");

-- CreateIndex
CREATE INDEX "vouchers_organization_id_company_id_voucher_date_idx" ON "vouchers"("organization_id", "company_id", "voucher_date");

-- CreateIndex
CREATE INDEX "vouchers_source_entity_id_idx" ON "vouchers"("source_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_company_id_financial_year_id_voucher_type_voucher__key" ON "vouchers"("company_id", "financial_year_id", "voucher_type", "voucher_number");

-- CreateIndex
CREATE INDEX "journal_entries_voucher_id_idx" ON "journal_entries"("voucher_id");

-- CreateIndex
CREATE INDEX "journal_entries_account_id_idx" ON "journal_entries"("account_id");

-- CreateIndex
CREATE INDEX "payment_allocations_voucher_id_idx" ON "payment_allocations"("voucher_id");

-- CreateIndex
CREATE INDEX "payment_allocations_invoice_id_idx" ON "payment_allocations"("invoice_id");

-- CreateIndex
CREATE INDEX "parties_organization_id_company_id_idx" ON "parties"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "parties_phone_idx" ON "parties"("phone");

-- CreateIndex
CREATE INDEX "parties_gstin_idx" ON "parties"("gstin");

-- CreateIndex
CREATE UNIQUE INDEX "units_of_measure_company_id_symbol_key" ON "units_of_measure"("company_id", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "item_categories_company_id_name_key" ON "item_categories"("company_id", "name");

-- CreateIndex
CREATE INDEX "items_organization_id_company_id_idx" ON "items"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "items_barcode_idx" ON "items"("barcode");

-- CreateIndex
CREATE INDEX "items_hsn_code_idx" ON "items"("hsn_code");

-- CreateIndex
CREATE UNIQUE INDEX "items_company_id_sku_key" ON "items"("company_id", "sku");

-- CreateIndex
CREATE INDEX "item_batches_barcode_idx" ON "item_batches"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "item_batches_item_id_batch_number_key" ON "item_batches"("item_id", "batch_number");

-- CreateIndex
CREATE INDEX "warehouses_organization_id_company_id_idx" ON "warehouses"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "stock_transactions_organization_id_company_id_item_id_wareh_idx" ON "stock_transactions"("organization_id", "company_id", "item_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_transactions_reference_doc_type_reference_doc_id_idx" ON "stock_transactions"("reference_doc_type", "reference_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_sequences_company_id_financial_year_id_branch_id_pr_key" ON "invoice_sequences"("company_id", "financial_year_id", "branch_id", "prefix", "category");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_client_offline_uuid_key" ON "sales_invoices"("client_offline_uuid");

-- CreateIndex
CREATE INDEX "sales_invoices_organization_id_company_id_invoice_date_idx" ON "sales_invoices"("organization_id", "company_id", "invoice_date");

-- CreateIndex
CREATE INDEX "sales_invoices_financial_year_id_idx" ON "sales_invoices"("financial_year_id");

-- CreateIndex
CREATE INDEX "sales_invoices_party_id_idx" ON "sales_invoices"("party_id");

-- CreateIndex
CREATE INDEX "sales_invoices_status_idx" ON "sales_invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_company_id_financial_year_id_invoice_number_key" ON "sales_invoices"("company_id", "financial_year_id", "invoice_number");

-- CreateIndex
CREATE INDEX "sales_invoice_items_invoice_id_idx" ON "sales_invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "sales_invoice_items_item_id_idx" ON "sales_invoice_items"("item_id");

-- CreateIndex
CREATE INDEX "pos_sessions_branch_id_opened_at_idx" ON "pos_sessions"("branch_id", "opened_at");

-- CreateIndex
CREATE INDEX "purchase_invoices_organization_id_company_id_invoice_date_idx" ON "purchase_invoices"("organization_id", "company_id", "invoice_date");

-- CreateIndex
CREATE INDEX "purchase_invoices_financial_year_id_idx" ON "purchase_invoices"("financial_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_company_id_party_id_vendor_invoice_number_key" ON "purchase_invoices"("company_id", "party_id", "vendor_invoice_number");

-- CreateIndex
CREATE INDEX "purchase_invoice_items_invoice_id_idx" ON "purchase_invoice_items"("invoice_id");

-- CreateIndex
CREATE INDEX "bills_of_material_organization_id_company_id_idx" ON "bills_of_material"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "bom_items_bom_id_idx" ON "bom_items"("bom_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_company_id_order_number_key" ON "production_orders"("company_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "einvoice_records_invoice_id_key" ON "einvoice_records"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "einvoice_records_irn_key" ON "einvoice_records"("irn");

-- CreateIndex
CREATE UNIQUE INDEX "eway_bill_records_invoice_id_key" ON "eway_bill_records"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "eway_bill_records_ewb_number_key" ON "eway_bill_records"("ewb_number");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_years" ADD CONSTRAINT "financial_years_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_groups" ADD CONSTRAINT "ledger_groups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_groups" ADD CONSTRAINT "ledger_groups_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ledger_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "ledger_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units_of_measure" ADD CONSTRAINT "units_of_measure_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_primary_uom_id_fkey" FOREIGN KEY ("primary_uom_id") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_secondary_uom_id_fkey" FOREIGN KEY ("secondary_uom_id") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "item_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_financial_year_id_fkey" FOREIGN KEY ("financial_year_id") REFERENCES "financial_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_items" ADD CONSTRAINT "purchase_invoice_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills_of_material" ADD CONSTRAINT "bills_of_material_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills_of_material" ADD CONSTRAINT "bills_of_material_finished_item_id_fkey" FOREIGN KEY ("finished_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "bills_of_material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_raw_item_id_fkey" FOREIGN KEY ("raw_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "bills_of_material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "einvoice_records" ADD CONSTRAINT "einvoice_records_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eway_bill_records" ADD CONSTRAINT "eway_bill_records_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
