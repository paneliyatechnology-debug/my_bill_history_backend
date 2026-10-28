CREATE TABLE IF NOT EXISTS "company_invoice_print_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "theme_id" VARCHAR(40) NOT NULL DEFAULT 'advanced_gst',
    "accent_color" VARCHAR(16) NOT NULL DEFAULT '#111111',
    "paper_size" VARCHAR(20) NOT NULL DEFAULT 'A4',
    "print_copies" JSONB NOT NULL DEFAULT '["ORIGINAL_FOR_RECIPIENT"]',
    "logo_url" TEXT,
    "watermark_url" TEXT,
    "slogan" VARCHAR(200),
    "footer_text" VARCHAR(500),
    "document_titles" JSONB,
    "show_party_balance" BOOLEAN NOT NULL DEFAULT false,
    "enable_free_item_quantity" BOOLEAN NOT NULL DEFAULT false,
    "show_item_description" BOOLEAN NOT NULL DEFAULT true,
    "show_alternate_unit" BOOLEAN NOT NULL DEFAULT true,
    "show_phone_number" BOOLEAN NOT NULL DEFAULT true,
    "show_gstin" BOOLEAN NOT NULL DEFAULT true,
    "show_pan" BOOLEAN NOT NULL DEFAULT true,
    "show_email" BOOLEAN NOT NULL DEFAULT true,
    "show_hsn" BOOLEAN NOT NULL DEFAULT true,
    "show_discount" BOOLEAN NOT NULL DEFAULT true,
    "show_tax_breakup" BOOLEAN NOT NULL DEFAULT true,
    "show_bank_details" BOOLEAN NOT NULL DEFAULT true,
    "show_upi_qr" BOOLEAN NOT NULL DEFAULT true,
    "show_signature" BOOLEAN NOT NULL DEFAULT true,
    "show_amount_in_words" BOOLEAN NOT NULL DEFAULT true,
    "show_received_amount" BOOLEAN NOT NULL DEFAULT true,
    "show_terms" BOOLEAN NOT NULL DEFAULT true,
    "show_notes" BOOLEAN NOT NULL DEFAULT true,
    "show_due_date" BOOLEAN NOT NULL DEFAULT true,
    "show_place_of_supply" BOOLEAN NOT NULL DEFAULT true,
    "show_shipping_address" BOOLEAN NOT NULL DEFAULT true,
    "show_saved_amount" BOOLEAN NOT NULL DEFAULT false,
    "header_layout" INTEGER NOT NULL DEFAULT 1,
    "font_size" VARCHAR(8) NOT NULL DEFAULT '13',
    "margin_top" INTEGER NOT NULL DEFAULT 8,
    "margin_right" INTEGER NOT NULL DEFAULT 8,
    "margin_bottom" INTEGER NOT NULL DEFAULT 8,
    "margin_left" INTEGER NOT NULL DEFAULT 8,
    "stretch_item_table" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_invoice_print_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_invoice_print_settings_company_id_key"
  ON "company_invoice_print_settings"("company_id");

CREATE INDEX IF NOT EXISTS "company_invoice_print_settings_org_company_idx"
  ON "company_invoice_print_settings"("organization_id", "company_id");

ALTER TABLE "company_invoice_print_settings"
  ADD CONSTRAINT "company_invoice_print_settings_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "company_invoice_print_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_invoice_print_settings" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_company_invoice_print_settings ON company_invoice_print_settings;
CREATE POLICY tenant_isolation_company_invoice_print_settings ON company_invoice_print_settings
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
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE company_invoice_print_settings TO billing_app;
    END IF;
END $$;
