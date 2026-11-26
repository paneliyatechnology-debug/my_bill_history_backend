const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const crypto = require("crypto");
const path = require("path");

let accountingCore;
try {
  accountingCore = require(path.resolve(__dirname, "../dist/accounting-core/index.js"));
} catch {
  accountingCore = null;
}

const prisma = new PrismaClient();

const COMPANY_TEMPLATES = [
  { tradeName: "Shreeji Agro & Traders", legalName: "Shreeji Agro & Traders Pvt. Ltd.", owner: "Rameshbhai Patel", city: "Ahmedabad", pincode: "380009", slug: "shreeji.agro" },
  { tradeName: "Navkar Pharma Distributors", legalName: "Navkar Pharma Distributors LLP", owner: "Chirag Shah", city: "Surat", pincode: "395002", slug: "navkar.pharma" },
  { tradeName: "Mahavir Textiles & Silks", legalName: "Mahavir Textiles & Silks Pvt. Ltd.", owner: "Jignesh Mehta", city: "Surat", pincode: "395003", slug: "mahavir.textiles" },
  { tradeName: "Khodiyar Hardware & Tools", legalName: "Khodiyar Hardware & Tools", owner: "Maheshbhai Gajjar", city: "Rajkot", pincode: "360001", slug: "khodiyar.hardware" },
  { tradeName: "Ambica Electronics Hub", legalName: "Ambica Electronics Hub Pvt. Ltd.", owner: "Nikhil Desai", city: "Vadodara", pincode: "390001", slug: "ambica.electronics" },
  { tradeName: "Saurashtra Spices & Foods", legalName: "Saurashtra Spices & Foods LLP", owner: "Bhavesh Jadeja", city: "Jamnagar", pincode: "361001", slug: "saurashtra.spices" },
  { tradeName: "Umiya Ceramic & Sanitary", legalName: "Umiya Ceramic & Sanitary Pvt. Ltd.", owner: "Ketan Patel", city: "Morbi", pincode: "363641", slug: "umiya.ceramic" },
  { tradeName: "Ganesh Kirana & Supermart", legalName: "Ganesh Kirana & Supermart", owner: "Suresh Agarwal", city: "Bhavnagar", pincode: "364001", slug: "ganesh.kirana" },
  { tradeName: "Swastik Chemicals & Dyes", legalName: "Swastik Chemicals & Dyes Pvt. Ltd.", owner: "Prashant Joshi", city: "Ankleshwar", pincode: "393001", slug: "swastik.chemicals" },
  { tradeName: "Bansidhar Dairy Products", legalName: "Bansidhar Dairy Products LLP", owner: "Hitesh Chaudhary", city: "Mehsana", pincode: "384002", slug: "bansidhar.dairy" },
  { tradeName: "Radhe Packaging Solutions", legalName: "Radhe Packaging Solutions Pvt. Ltd.", owner: "Darshan Panchal", city: "Gandhinagar", pincode: "382010", slug: "radhe.packaging" },
  { tradeName: "Vardhman Jewels & Bullion", legalName: "Vardhman Jewels & Bullion LLP", owner: "Siddharth Jain", city: "Ahmedabad", pincode: "380001", slug: "vardhman.jewels" },
  { tradeName: "Kisan Seeds & Fertilizers", legalName: "Kisan Seeds & Fertilizers", owner: "Nilesh Parmar", city: "Junagadh", pincode: "362001", slug: "kisan.seeds" },
  { tradeName: "Apex Auto Spares & Service", legalName: "Apex Auto Spares & Service Pvt. Ltd.", owner: "Vivek Thakkar", city: "Rajkot", pincode: "360002", slug: "apex.autospares" },
  { tradeName: "Shantinath Paper & Stationery", legalName: "Shantinath Paper & Stationery LLP", owner: "Krunal Kothari", city: "Vadodara", pincode: "390005", slug: "shantinath.paper" },
  { tradeName: "Devendra Steel & Tubes", legalName: "Devendra Steel & Tubes Pvt. Ltd.", owner: "Devendra Chauhan", city: "Bhavnagar", pincode: "364002", slug: "devendra.steel" },
  { tradeName: "Gokul Sweets & Namkeen", legalName: "Gokul Sweets & Namkeen", owner: "Harshad Vyas", city: "Anand", pincode: "388001", slug: "gokul.sweets" },
  { tradeName: "Trident Logistics & Cargo", legalName: "Trident Logistics & Cargo Pvt. Ltd.", owner: "Rohan Trivedi", city: "Gandhidham", pincode: "370201", slug: "trident.logistics" },
  { tradeName: "Meera Apparels & Garments", legalName: "Meera Apparels & Garments LLP", owner: "Pooja Bhatt", city: "Ahmedabad", pincode: "380015", slug: "meera.apparels" },
  { tradeName: "Jay Ambe Timber & Plywood", legalName: "Jay Ambe Timber & Plywood", owner: "Vikram Solanki", city: "Nadiad", pincode: "387001", slug: "jayambe.timber" },
];

function generatePassword(index) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const specials = "@#$%&*";
  let rand = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    rand += chars[bytes[i] % chars.length];
  }
  const spec = specials[index % specials.length];
  return `Cl${rand}${spec}9`;
}

function generateGstin(index) {
  const panNum = String(1000 + index).slice(-4);
  return `24AAACC${panNum}A1Z5`;
}

async function seedChartOfAccounts(tx, organizationId, companyId) {
  if (!accountingCore) return;
  const { STANDARD_SME_GROUPS = [], STANDARD_SME_ACCOUNTS = [] } = accountingCore;

  const groupMap = new Map();
  for (const tGroup of STANDARD_SME_GROUPS) {
    let parentId = null;
    if (tGroup.parentName) {
      parentId = groupMap.get(tGroup.parentName) || null;
      if (!parentId) {
        const existingParent = await tx.ledgerGroup.findFirst({
          where: { companyId, name: tGroup.parentName },
        });
        if (existingParent) parentId = existingParent.id;
      }
    }

    const created = await tx.ledgerGroup.create({
      data: {
        organizationId,
        companyId,
        name: tGroup.name,
        nameGujarati: tGroup.nameGujarati,
        nature: tGroup.nature,
        parentId: parentId || undefined,
        isSystem: tGroup.isSystem,
      },
    });
    groupMap.set(tGroup.name, created.id);
  }

  for (const tAcc of STANDARD_SME_ACCOUNTS) {
    const groupId = groupMap.get(tAcc.groupName);
    if (!groupId) continue;

    await tx.ledgerAccount.create({
      data: {
        organizationId,
        companyId,
        groupId,
        name: tAcc.name,
        nameGujarati: tAcc.nameGujarati,
        code: tAcc.code,
        isBankLedger: tAcc.isBankLedger || false,
        isCashLedger: tAcc.isCashLedger || false,
        isTaxLedger: tAcc.isTaxLedger || false,
        taxRate: tAcc.taxRate,
        openingBalance: 0,
        currentBalance: 0,
        openingType: tAcc.openingType,
        isActive: true,
      },
    });
  }
}

async function findUniquePhoneAndEmail(baseSlug, baseIndex) {
  let suffix = "";
  let attempt = 0;
  while (true) {
    const email = `${baseSlug}${suffix}@client.billing.local`;
    const phoneNum = 9700000000 + attempt * 100 + baseIndex + 1;
    const phone = String(phoneNum);

    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { id: true },
    });
    const existingTenant = await prisma.tenant.findFirst({
      where: { OR: [{ primaryEmail: email }, { primaryPhone: phone }] },
      select: { id: true },
    });

    if (!existingUser && !existingTenant) {
      return { email, phone };
    }
    attempt += 1;
    suffix = `.${attempt}`;
  }
}

async function main() {
  console.log("Creating 20 new client companies with login credentials...");

  const createdRows = [];
  const subscriptionTier = "WHOLESALE_PRO";
  const subscriptionEnds = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  for (let i = 0; i < COMPANY_TEMPLATES.length; i++) {
    const tpl = COMPANY_TEMPLATES[i];
    const { email, phone } = await findUniquePhoneAndEmail(tpl.slug, i);
    const plainPassword = generatePassword(i);
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    const gstin = generateGstin(i + 1);

    const created = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`
          DO $$
          BEGIN
            RESET ROLE;
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END $$;
        `);
        await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'on', true)`);

        const tenant = await tx.tenant.create({
          data: {
            primaryPhone: phone,
            primaryEmail: email,
            subscriptionTier,
            subscriptionEnds,
            isActive: true,
          },
        });

        const organization = await tx.organization.create({
          data: {
            tenantId: tenant.id,
            name: tpl.tradeName,
            legalName: tpl.legalName,
          },
        });

        const company = await tx.company.create({
          data: {
            organizationId: organization.id,
            legalName: tpl.legalName,
            tradeName: tpl.tradeName,
            gstin,
            stateCode: "24",
            gstType: "REGULAR",
            addressLine1: "Main Market Road",
            city: tpl.city,
            pincode: tpl.pincode,
            phone,
            email,
          },
        });

        const branch = await tx.branch.create({
          data: {
            organizationId: organization.id,
            companyId: company.id,
            name: "Main Branch",
            code: "BR01",
            isMainBranch: true,
            addressLine1: "Main Market Road",
            city: tpl.city,
            pincode: tpl.pincode,
            stateCode: "24",
            phone,
          },
        });

        await tx.financialYear.create({
          data: {
            companyId: company.id,
            name: "FY 2026-27",
            startDate: new Date("2026-04-01T00:00:00.000Z"),
            endDate: new Date("2027-03-31T23:59:59.999Z"),
            isCurrent: true,
            isLocked: false,
          },
        });

        const user = await tx.user.create({
          data: {
            organizationId: organization.id,
            fullName: tpl.owner,
            phone,
            email,
            passwordHash,
            role: "COMPANY_ADMIN",
            preferredLang: "en",
            isActive: true,
          },
        });

        await tx.userBranchAssignment.create({
          data: {
            userId: user.id,
            branchId: branch.id,
            role: "COMPANY_ADMIN",
            isDefault: true,
          },
        });

        await seedChartOfAccounts(tx, organization.id, company.id);

        return { tenant, organization, company, user };
      },
      { timeout: 60000, maxWait: 10000 },
    );

    createdRows.push({
      "Sr No": i + 1,
      "Company Name": tpl.tradeName,
      "Legal Name": tpl.legalName,
      "Owner Name": tpl.owner,
      "Login Email": email,
      "Phone": phone,
      "Password": plainPassword,
      "Role": "COMPANY_ADMIN",
      "Subscription Tier": subscriptionTier,
      "City": tpl.city,
      "GSTIN": gstin,
      "Tenant ID": created.tenant.id,
      "Company ID": created.company.id,
      "User ID": created.user.id,
    });

    console.log(`[${i + 1}/20] Created ${tpl.tradeName} -> ${email}`);
  }

  const outputPath = path.resolve(__dirname, "client-companies-credentials.xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(createdRows);
  worksheet["!cols"] = [
    { wch: 6 },
    { wch: 30 },
    { wch: 36 },
    { wch: 22 },
    { wch: 36 },
    { wch: 14 },
    { wch: 16 },
    { wch: 15 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 38 },
    { wch: 38 },
    { wch: 38 },
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, "Client Companies");
  XLSX.writeFile(workbook, outputPath);

  console.log(`\nExcel file saved at: ${outputPath}`);
  console.log(`Total companies created: ${createdRows.length}`);
}

main()
  .catch((err) => {
    console.error("Failed to create client companies:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
