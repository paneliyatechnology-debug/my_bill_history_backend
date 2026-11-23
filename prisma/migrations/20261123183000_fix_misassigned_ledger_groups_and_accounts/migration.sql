-- 1. Ensure essential standard ledger groups exist for every company
INSERT INTO "ledger_groups" ("id", "organization_id", "company_id", "name", "nature", "is_system", "created_at")
SELECT gen_random_uuid(), c."organization_id", c."id", 'Sundry Debtors', 'ASSET'::"AccountNature", true, NOW()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "ledger_groups" lg WHERE lg."company_id" = c."id" AND lg."name" = 'Sundry Debtors'
);

INSERT INTO "ledger_groups" ("id", "organization_id", "company_id", "name", "nature", "is_system", "created_at")
SELECT gen_random_uuid(), c."organization_id", c."id", 'Sundry Creditors', 'LIABILITY'::"AccountNature", true, NOW()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "ledger_groups" lg WHERE lg."company_id" = c."id" AND lg."name" = 'Sundry Creditors'
);

INSERT INTO "ledger_groups" ("id", "organization_id", "company_id", "name", "nature", "is_system", "created_at")
SELECT gen_random_uuid(), c."organization_id", c."id", 'Duties & Taxes', 'LIABILITY'::"AccountNature", true, NOW()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "ledger_groups" lg WHERE lg."company_id" = c."id" AND lg."name" = 'Duties & Taxes'
);

INSERT INTO "ledger_groups" ("id", "organization_id", "company_id", "name", "nature", "is_system", "created_at")
SELECT gen_random_uuid(), c."organization_id", c."id", 'Duties & Taxes (ITC)', 'ASSET'::"AccountNature", true, NOW()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "ledger_groups" lg WHERE lg."company_id" = c."id" AND lg."name" = 'Duties & Taxes (ITC)'
);

INSERT INTO "ledger_groups" ("id", "organization_id", "company_id", "name", "nature", "is_system", "created_at")
SELECT gen_random_uuid(), c."organization_id", c."id", 'Cash-in-hand', 'ASSET'::"AccountNature", true, NOW()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "ledger_groups" lg WHERE lg."company_id" = c."id" AND lg."name" = 'Cash-in-hand'
);

-- 2. Fix Output Tax accounts mistakenly assigned to Sundry Creditors
UPDATE "ledger_accounts" la
SET "group_id" = lg."id"
FROM "ledger_groups" lg
WHERE lg."company_id" = la."company_id"
  AND lg."name" = 'Duties & Taxes'
  AND (la."name" ILIKE '%Output CGST%' OR la."name" ILIKE '%Output SGST%' OR la."name" ILIKE '%Output IGST%')
  AND la."group_id" != lg."id";

-- 3. Fix Input Tax accounts mistakenly assigned
UPDATE "ledger_accounts" la
SET "group_id" = lg."id"
FROM "ledger_groups" lg
WHERE lg."company_id" = la."company_id"
  AND lg."name" = 'Duties & Taxes (ITC)'
  AND (la."name" ILIKE '%Input CGST%' OR la."name" ILIKE '%Input SGST%' OR la."name" ILIKE '%Input IGST%')
  AND la."group_id" != lg."id";

-- 4. Fix Cash accounts mistakenly assigned to Duties & Taxes (ITC)
UPDATE "ledger_accounts" la
SET "group_id" = lg."id"
FROM "ledger_groups" lg
WHERE lg."company_id" = la."company_id"
  AND lg."name" = 'Cash-in-hand'
  AND (la."name" ILIKE 'Cash Account%' OR la."is_cash_ledger" = true)
  AND la."group_id" != lg."id";

-- 5. Fix Customer debtor party ledger accounts mistakenly assigned to Duties & Taxes (ITC)
UPDATE "ledger_accounts" la
SET "group_id" = lg."id"
FROM "ledger_groups" lg, "parties" p
WHERE p."id" = la."party_id"
  AND p."type" = 'CUSTOMER'
  AND lg."company_id" = la."company_id"
  AND lg."name" = 'Sundry Debtors'
  AND la."group_id" != lg."id";

-- 6. Link unlinked party accounts by matching party name in same company
UPDATE "ledger_accounts" la
SET "party_id" = p."id", "is_party_ledger" = true, "group_id" = lg."id"
FROM "parties" p, "ledger_groups" lg
WHERE p."company_id" = la."company_id"
  AND LOWER(TRIM(p."name")) = LOWER(TRIM(la."name"))
  AND la."party_id" IS NULL
  AND lg."company_id" = la."company_id"
  AND lg."name" = CASE WHEN p."type" = 'SUPPLIER' THEN 'Sundry Creditors' ELSE 'Sundry Debtors' END;
