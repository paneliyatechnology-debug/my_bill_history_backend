-- CreateEnum
CREATE TYPE "HsnType" AS ENUM ('HSN', 'SAC');

-- CreateTable
CREATE TABLE "hsn_masters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "company_id" UUID,
    "code" VARCHAR(10) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "description_gujarati" VARCHAR(255),
    "type" "HsnType" NOT NULL DEFAULT 'HSN',
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
    "cess_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "chapter" VARCHAR(50),
    "notes" VARCHAR(255),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hsn_masters_pkey" PRIMARY KEY ("id")
);

-- Add hsn_master_id to items
ALTER TABLE "items" ADD COLUMN "hsn_master_id" UUID;

-- Indexes on hsn_masters
CREATE UNIQUE INDEX "hsn_masters_global_code_unique" ON "hsn_masters"("code") WHERE "company_id" IS NULL;
CREATE UNIQUE INDEX "hsn_masters_company_code_unique" ON "hsn_masters"("company_id", "code") WHERE "company_id" IS NOT NULL;
CREATE INDEX "hsn_masters_organization_id_company_id_idx" ON "hsn_masters"("organization_id", "company_id");
CREATE INDEX "hsn_masters_code_idx" ON "hsn_masters"("code");
CREATE INDEX "hsn_masters_type_idx" ON "hsn_masters"("type");
CREATE INDEX "hsn_masters_is_active_idx" ON "hsn_masters"("is_active");
CREATE INDEX "items_hsn_master_id_idx" ON "items"("hsn_master_id");

-- Foreign key constraints
ALTER TABLE "hsn_masters" ADD CONSTRAINT "hsn_masters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_hsn_master_id_fkey" FOREIGN KEY ("hsn_master_id") REFERENCES "hsn_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row Level Security (RLS) on hsn_masters
ALTER TABLE "hsn_masters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hsn_masters" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_hsn_masters ON hsn_masters;
CREATE POLICY tenant_isolation_hsn_masters ON hsn_masters
    AS PERMISSIVE
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR company_id IS NULL
        OR (
            organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    )
    WITH CHECK (
        current_setting('app.bypass_rls', true) = 'on'
        OR (
            company_id IS NOT NULL
            AND organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
        )
    );

-- Seed Verified Standard Official Indian GST HSN / SAC Codes (Global is_system = true)
INSERT INTO "hsn_masters" ("id", "code", "description", "description_gujarati", "type", "gst_rate", "cess_rate", "chapter", "is_system", "is_active") VALUES
-- Agriculture, Food & Grains (Chapters 4, 7, 9, 10, 11, 15, 17, 19)
(gen_random_uuid(), '0401', 'Fresh Milk and Cream, not concentrated nor containing added sugar', 'તાજું દૂધ અને ક્રીમ', 'HSN', 0.00, 0.00, '04', true, true),
(gen_random_uuid(), '0402', 'Milk Powder, concentrated or sweetened', 'દૂધનો પાવડર', 'HSN', 5.00, 0.00, '04', true, true),
(gen_random_uuid(), '0701', 'Potatoes, fresh or chilled', 'બટાકા', 'HSN', 0.00, 0.00, '07', true, true),
(gen_random_uuid(), '0702', 'Tomatoes, fresh or chilled', 'ટામેટા', 'HSN', 0.00, 0.00, '07', true, true),
(gen_random_uuid(), '0703', 'Onions, shallots, garlic, leeks, fresh or chilled', 'ડુંગળી અને લસણ', 'HSN', 0.00, 0.00, '07', true, true),
(gen_random_uuid(), '0902', 'Tea, whether or not flavored', 'ચા પત્તી', 'HSN', 5.00, 0.00, '09', true, true),
(gen_random_uuid(), '1001', 'Wheat and meslin (Sharbati, Tukdi, etc.)', 'ઘઉં (શરબતી, ટુકડી)', 'HSN', 5.00, 0.00, '10', true, true),
(gen_random_uuid(), '1006', 'Rice, in the husk or husked (Basmati, Non-Basmati)', 'ચોખા / ડાંગર (બાસમતી)', 'HSN', 5.00, 0.00, '10', true, true),
(gen_random_uuid(), '1101', 'Wheat or meslin flour (Maida, Atta)', 'ઘઉંનો લોટ / મેંદો', 'HSN', 5.00, 0.00, '11', true, true),
(gen_random_uuid(), '1507', 'Soya-bean oil and its fractions', 'સોયાબીન તેલ', 'HSN', 5.00, 0.00, '15', true, true),
(gen_random_uuid(), '1701', 'Cane or beet sugar and chemically pure sucrose', 'ખાંડ / સાકર', 'HSN', 5.00, 0.00, '17', true, true),
(gen_random_uuid(), '1905', 'Bread, pastry, cakes, biscuits and other bakers wares', 'બ્રેડ, બિસ્કિટ અને બેકરી વસ્તુઓ', 'HSN', 18.00, 0.00, '19', true, true),

-- Chemicals, Fertilizers & Plastics (Chapters 25, 30, 31, 33, 34, 39)
(gen_random_uuid(), '2523', 'Portland cement, aluminous cement, slag cement', 'સિમેન્ટ', 'HSN', 28.00, 0.00, '25', true, true),
(gen_random_uuid(), '3004', 'Medicaments consisting of mixed or unmixed products for therapeutic uses', 'દવાઓ (મેડિકામેન્ટ્સ)', 'HSN', 12.00, 0.00, '30', true, true),
(gen_random_uuid(), '3105', 'Mineral or chemical fertilizers containing two or three nutrients (NPK)', 'ખાતર (NPK / ઓર્ગેનિક)', 'HSN', 18.00, 0.00, '31', true, true),
(gen_random_uuid(), '3304', 'Beauty or make-up preparations and skincare preparations', 'સૌંદર્ય પ્રસાધનો / સ્કિનકેર', 'HSN', 18.00, 0.00, '33', true, true),
(gen_random_uuid(), '3401', 'Soap, organic surface-active products and preparations', 'સાબુ અને ડીટરજન્ટ', 'HSN', 18.00, 0.00, '34', true, true),
(gen_random_uuid(), '3901', 'Polymers of ethylene, in primary forms (HDPE/LDPE granules)', 'પ્લાસ્ટિક દાણા (HDPE/LDPE)', 'HSN', 18.00, 0.00, '39', true, true),
(gen_random_uuid(), '3924', 'Tableware, kitchenware, other household articles of plastics', 'પ્લાસ્ટિક ઘરેલું વાસણો', 'HSN', 18.00, 0.00, '39', true, true),

-- Metals, Steel & Fasteners (Chapters 72, 73, 74, 76)
(gen_random_uuid(), '7208', 'Flat-rolled products of iron or non-alloy steel, hot-rolled', 'હોટ-રોલ્ડ સ્ટીલ શીટ્સ', 'HSN', 18.00, 0.00, '72', true, true),
(gen_random_uuid(), '7214', 'Other bars and rods of iron or non-alloy steel (TMT Rebars)', 'સ્ટીલ સળિયા / TMT બાર', 'HSN', 18.00, 0.00, '72', true, true),
(gen_random_uuid(), '7216', 'Angles, shapes and sections of iron or non-alloy steel (Beams/Channels)', 'સ્ટીલ એંગલ, બીમ અને ચેનલ', 'HSN', 18.00, 0.00, '72', true, true),
(gen_random_uuid(), '7307', 'Tube or pipe fittings of iron or steel (Flanges, Elbows)', 'પાઇપ ફિટિંગ્સ / ફ્લેંજ', 'HSN', 18.00, 0.00, '73', true, true),
(gen_random_uuid(), '7318', 'Screws, bolts, nuts, coach screws, screw hooks, rivets, washers', 'નટ, બોલ્ટ અને સ્ક્રૂ', 'HSN', 18.00, 0.00, '73', true, true),
(gen_random_uuid(), '7323', 'Table, kitchen or other household articles of iron or steel', 'સ્ટીલ વાસણો / બોટલ', 'HSN', 18.00, 0.00, '73', true, true),
(gen_random_uuid(), '7407', 'Copper bars, rods and profiles', 'તાંબાના સળિયા / રોડ', 'HSN', 18.00, 0.00, '74', true, true),
(gen_random_uuid(), '7408', 'Copper wire', 'તાંબાનો વાયર', 'HSN', 18.00, 0.00, '74', true, true),
(gen_random_uuid(), '7604', 'Aluminium bars, rods and profiles', 'એલ્યુમિનિયમ સળિયા', 'HSN', 18.00, 0.00, '76', true, true),

-- Machinery, Mechanical Appliances & Electronics (Chapters 84, 85, 91)
(gen_random_uuid(), '8412', 'Other engines and motors (Hydraulic cylinders/motors)', 'હાઇડ્રોલિક એન્જિન / સિલિન્ડર', 'HSN', 18.00, 0.00, '84', true, true),
(gen_random_uuid(), '8424', 'Mechanical appliances for projecting, dispersing or spraying liquids', 'સ્પ્રે પંપ / નોઝલ સેટ', 'HSN', 18.00, 0.00, '84', true, true),
(gen_random_uuid(), '8471', 'Automatic data processing machines (Computers, Laptops)', 'કમ્પ્યુટર / લેપટોપ', 'HSN', 18.00, 0.00, '84', true, true),
(gen_random_uuid(), '8481', 'Taps, cocks, valves and similar appliances for pipes', 'વાલ્વ અને નળ એસેમ્બલી', 'HSN', 18.00, 0.00, '84', true, true),
(gen_random_uuid(), '8482', 'Ball or roller bearings', 'બોલ બેરિંગ્સ', 'HSN', 18.00, 0.00, '84', true, true),
(gen_random_uuid(), '8504', 'Electrical transformers, static converters and inductors', 'ટ્રાન્સફોર્મર / પાવર સપ્લાય', 'HSN', 18.00, 0.00, '85', true, true),
(gen_random_uuid(), '8517', 'Telephone sets, smartphones and other apparatus for transmission', 'સ્માર્ટફોન અને ટેલિફોન', 'HSN', 18.00, 0.00, '85', true, true),
(gen_random_uuid(), '8544', 'Insulated wire, cable and other electric conductors', 'ઇન્સ્યુલેટેડ કેબલ અને વાયર', 'HSN', 18.00, 0.00, '85', true, true),
(gen_random_uuid(), '9102', 'Wrist-watches, pocket-watches and other watches', 'કાંડા ઘડિયાળ', 'HSN', 18.00, 0.00, '91', true, true),

-- Textiles & Apparel (Chapters 61, 62, 64)
(gen_random_uuid(), '6109', 'T-shirts, singlets and other vests, knitted or crocheted', 'ટી-શર્ટ અને ગંજી', 'HSN', 5.00, 0.00, '61', true, true),
(gen_random_uuid(), '6203', 'Mens or boys suits, ensembles, jackets, blazers, trousers', 'પુરુષોના વસ્ત્રો (પેન્ટ, શર્ટ)', 'HSN', 12.00, 0.00, '62', true, true),
(gen_random_uuid(), '6403', 'Footwear with outer soles of rubber, plastics or leather', 'પગરખાં / બૂટ-ચંપલ', 'HSN', 18.00, 0.00, '64', true, true),

-- Services (SAC Code Chapter 99)
(gen_random_uuid(), '9954', 'General construction and infrastructure services', 'બાંધકામ સેવાઓ', 'SAC', 18.00, 0.00, '99', true, true),
(gen_random_uuid(), '9965', 'Goods transport agency (GTA) services', 'માલ પરિવહન સેવાઓ (ટ્રાન્સપોર્ટ)', 'SAC', 5.00, 0.00, '99', true, true),
(gen_random_uuid(), '9968', 'Postal and courier services (Express Delivery)', 'કુરિયર અને ડિલિવરી સેવાઓ', 'SAC', 18.00, 0.00, '99', true, true),
(gen_random_uuid(), '9972', 'Real estate services involving own or leased property', 'રિયલ એસ્ટેટ સેવાઓ', 'SAC', 18.00, 0.00, '99', true, true),
(gen_random_uuid(), '9982', 'Legal, accounting, and advisory services', 'કાનૂની અને હિસાબી સેવાઓ', 'SAC', 18.00, 0.00, '99', true, true),
(gen_random_uuid(), '9983', 'Other professional, technical and business consulting services', 'વ્યાવસાયિક અને તકનીકી કન્સલ્ટિંગ', 'SAC', 18.00, 0.00, '99', true, true),
(gen_random_uuid(), '998311', 'Accounting, auditing and bookkeeping services', 'હિસાબ, ઓડિટ અને બુકકીપિંગ સેવાઓ', 'SAC', 18.00, 0.00, '99', true, true),
(gen_random_uuid(), '9987', 'Maintenance, repair and installation services (Audit/AMC)', 'મેન્ટેનન્સ, સમારકામ અને ઇન્સ્ટોલેશન', 'SAC', 18.00, 0.00, '99', true, true),
(gen_random_uuid(), '9988', 'Manufacturing services on physical inputs owned by others (Job Work)', 'જોબવર્ક ઉત્પાદન સેવાઓ', 'SAC', 18.00, 0.00, '99', true, true)
ON CONFLICT DO NOTHING;

-- Backfill hsn_master_id on existing items where hsn_code matches a seeded master record
UPDATE "items" AS i
SET "hsn_master_id" = m."id"
FROM "hsn_masters" AS m
WHERE i."hsn_code" = m."code"
  AND m."company_id" IS NULL
  AND i."hsn_master_id" IS NULL;
