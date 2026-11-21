-- CreateTable coupons
CREATE TABLE IF NOT EXISTS "coupons" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "discount_type" VARCHAR(20) NOT NULL DEFAULT 'PERCENTAGE',
    "discount_value" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "valid_tiers" JSONB NOT NULL DEFAULT '[]',
    "min_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "max_discount" DECIMAL(12,2) NOT NULL DEFAULT 5000,
    "valid_until" TIMESTAMP(3),
    "usage_limit" INTEGER NOT NULL DEFAULT 100,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable subscription_plans
CREATE TABLE IF NOT EXISTS "subscription_plans" (
    "id" VARCHAR(100) NOT NULL,
    "tier" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_gujarati" VARCHAR(150),
    "subtitle" TEXT,
    "subtitle_gujarati" TEXT,
    "monthly_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "yearly_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "annual_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_percent" INTEGER NOT NULL DEFAULT 0,
    "monthly_paise" INTEGER NOT NULL DEFAULT 0,
    "yearly_paise" INTEGER NOT NULL DEFAULT 0,
    "max_companies" INTEGER NOT NULL DEFAULT 1,
    "max_invoices_per_year" INTEGER NOT NULL DEFAULT -1,
    "max_users" INTEGER NOT NULL DEFAULT 2,
    "max_godowns" INTEGER NOT NULL DEFAULT 1,
    "features" JSONB NOT NULL DEFAULT '[]',
    "features_gujarati" JSONB NOT NULL DEFAULT '[]',
    "entitlements" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_popular" BOOLEAN NOT NULL DEFAULT false,
    "badge" VARCHAR(50),
    "badge_color" VARCHAR(100),
    "accent_color" VARCHAR(30),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable platform_addons
CREATE TABLE IF NOT EXISTS "platform_addons" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_gujarati" VARCHAR(150),
    "code" VARCHAR(50) NOT NULL,
    "category" VARCHAR(50) NOT NULL DEFAULT 'GENERAL',
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "billing_cycle" VARCHAR(20) NOT NULL DEFAULT 'YEARLY',
    "quota_added" INTEGER NOT NULL DEFAULT 1,
    "unit" VARCHAR(50) NOT NULL DEFAULT 'Unit',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable platform_settings
CREATE TABLE IF NOT EXISTS "platform_settings" (
    "id" VARCHAR(50) NOT NULL DEFAULT 'default',
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "coupons_code_key" ON "coupons"("code");
CREATE INDEX IF NOT EXISTS "coupons_code_is_active_idx" ON "coupons"("code", "is_active");

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_tier_key" ON "subscription_plans"("tier");
CREATE INDEX IF NOT EXISTS "subscription_plans_tier_is_active_idx" ON "subscription_plans"("tier", "is_active");

CREATE UNIQUE INDEX IF NOT EXISTS "platform_addons_code_key" ON "platform_addons"("code");
CREATE INDEX IF NOT EXISTS "platform_addons_code_is_active_idx" ON "platform_addons"("code", "is_active");

-- Permissions for billing_app role
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'billing_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "coupons" TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "subscription_plans" TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "platform_addons" TO billing_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "platform_settings" TO billing_app;
    END IF;
END $$;

-- Insert default platform settings row if not exists
INSERT INTO "platform_settings" ("id", "data", "created_at", "updated_at")
VALUES ('default', '{"bypassPlanRestrictions": false}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Seed initial subscription plans from constants if table is empty
INSERT INTO "subscription_plans" (
    "id", "tier", "name", "name_gujarati", "subtitle", "subtitle_gujarati",
    "monthly_price", "yearly_price", "annual_total", "discount_percent",
    "monthly_paise", "yearly_paise", "max_companies", "max_invoices_per_year",
    "max_users", "max_godowns", "features", "features_gujarati", "entitlements",
    "is_active", "is_popular", "badge", "badge_color", "accent_color", "is_default"
) VALUES
(
    'starter', 'RETAIL_BASIC', 'Starter Plan', 'સ્ટાર્ટર પ્લાન (Starter)',
    'Best for small retail shops and individual traders', 'નાના રિટેલ વેપારીઓ અને દુકાનદારો માટે ઉત્તમ',
    499.00, 399.00, 4788.00, 20,
    49900, 478800, 1, 3000,
    2, 1,
    '["1 Business Company Profile", "Up to 3,000 Invoices per year", "Standard B2B & B2C GST Invoicing", "A4 Laser & 58/80mm Thermal Print", "Basic Sales & Cash Reports", "Standard Chat & Email Support"]'::jsonb,
    '["૧ કંપની અથવા દુકાન પ્રોફાઇલ", "વર્ષે ૩,૦૦૦ ઇન્વૉઇસ સુધી", "સ્ટાન્ડર્ડ B2B અને B2C GST બિલિંગ", "A4 લેસર અને ૫૮mm/૮૦mm થર્મલ પ્રિન્ટ", "લાઇવ વેચાણ ચાર્ટ અને રોકડ રિપોર્ટ્સ", "સ્ટાન્ડર્ડ ચેટ અને ઇમેઇલ હેલ્પડેસ્ક"]'::jsonb,
    '{}'::jsonb,
    true, false, NULL, NULL, '#1677E8', true
),
(
    'professional', 'WHOLESALE_PRO', 'Professional Plan', 'પ્રોફેશનલ પ્લાન (Professional)',
    'Ideal for growing distributors, wholesalers and multi-counter shops', 'હોલસેલર્સ અને ડિસ્ટ્રિબ્યુટર્સ માટે સૌથી વધુ લોકપ્રિય',
    999.00, 799.00, 9588.00, 20,
    99900, 958800, 3, -1,
    5, 3,
    '["Up to 3 Business Companies", "Unlimited Invoices & E-Way Bills", "Purchase Bill AI Camera Scanner (OCR)", "Multi-Godown Stock Sync & Transfer Slips", "Automated WhatsApp Reminders & Statements", "GSTR-1, 3B & 2B Return Preparation", "Priority Phone & Remote Support"]'::jsonb,
    '["૩ કંપનીઓ અથવા બ્રાન્ચ સુધી", "અનલિમિટેડ ઇન્વૉઇસ અને e-Way Bills", "ખરીદી બિલ AI કેમેરા સ્કેનર (OCR)", "બહુ-ગોડાઉન સ્ટોક સિન્ક & ટ્રાન્સફર", "WhatsApp ઓટોમેટિક રિમાઇન્ડર્સ", "GSTR-1, 3B અને 2B તૈયાર ફાઈલો", "પ્રાથમિક ફોન અને રિમોટ સપોર્ટ"]'::jsonb,
    '{}'::jsonb,
    true, true, 'POPULAR', 'bg-indigo-50 text-indigo-700 border-indigo-200', '#4F46E5', false
),
(
    'enterprise', 'DISTRIBUTION_ENTERPRISE', 'Enterprise Plan', 'એન્ટરપ્રાઇઝ પ્લાન (Enterprise)',
    'For large distributors, multi-branch businesses and high-volume operations', 'મોટા ડિસ્ટ્રિબ્યુશન અને મલ્ટી-બ્રાન્ચ બિઝનેસ માટે સંપૂર્ણ ઉકેલ',
    1999.00, 1599.00, 19188.00, 20,
    199900, 1918800, 9999, -1,
    15, 10,
    '["Unlimited Companies, Warehouses & Branches", "Unlimited Staff Logins with Role Permissions", "Direct Government E-Invoicing API Integration", "Real-time Multi-Branch Cloud Data Sync", "Dedicated Relationship Support Manager", "Custom Branded Print Templates & Ledgers", "24/7 Priority Dedicated Helpline"]'::jsonb,
    '["અનલિમિટેડ કંપનીઓ અને ગોડાઉન", "અનલિમિટેડ સ્ટાફ લોગિન & રોલ પરમિશન", "સરકારી e-Invoice સીધો API ઇન્ટિગ્રેશન", "મલ્ટી-બ્રાન્ચ રિયલ-ટાઇમ ક્લાઉડ સિન્ક", "ડેડિકેટેડ એકાઉન્ટિંગ મેનેજર સપોર્ટ", "કસ્ટમ પ્રિન્ટ થીમ્સ અને બિલ ફોર્મેટ્સ", "૨૪/૭ પ્રાથમિક હેલ્પલાઇન સપોર્ટ"]'::jsonb,
    '{}'::jsonb,
    true, false, 'ENTERPRISE', 'bg-purple-50 text-purple-700 border-purple-200', '#9333EA', false
),
(
    'manufacturing', 'MANUFACTURING_SUITE', 'Manufacturing Suite', 'મેન્યુફેક્ચરિંગ સ્યુટ',
    'Advanced Bill of Materials (BoM), raw material scrap, job work & production', 'ઉત્પાદન અને મેન્યુફેક્ચરિંગ યુનિટ્સ માટે વિશિષ્ટ સોલ્યુશન',
    2499.00, 1999.00, 23988.00, 20,
    249900, 2398800, 9999, -1,
    25, 25,
    '["Complete Manufacturing BoM & Batch Production", "Unlimited Companies, Warehouses & Branches", "Raw Material Scrap & Job Work Tracking", "Enterprise Multi-Godown Logistics"]'::jsonb,
    '["સંપૂર્ણ મેન્યુફેક્ચરિંગ BoM અને બેચ ઉત્પાદન", "અનલિમિટેડ કંપનીઓ અને ગોડાઉન"]'::jsonb,
    '{}'::jsonb,
    true, false, 'MANUFACTURING', 'bg-amber-50 text-amber-700 border-amber-200', '#D97706', false
)
ON CONFLICT ("id") DO NOTHING;
