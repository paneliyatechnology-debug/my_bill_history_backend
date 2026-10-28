const { PrismaClient } = require("@prisma/client");
const path = require("path");
let bcrypt;
try {
  bcrypt = require("bcryptjs");
} catch {
  bcrypt = require(path.resolve(__dirname, "../node_modules/bcryptjs"));
}
let accountingCore;
try {
  accountingCore = require(path.resolve(__dirname, "../dist/accounting-core/index.js"));
} catch {
  accountingCore = require(path.resolve(__dirname, "../../accounting-core/dist/index.js"));
}
const { STANDARD_SME_GROUPS, STANDARD_SME_ACCOUNTS } = accountingCore;

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database with demo users and initial data...");

  const passwordHash = await bcrypt.hash("Password123#", 10);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      DO $$
      BEGIN
        RESET ROLE;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END $$;
    `);
    await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'on', true)`);

    // 1. Create Demo Business Tenant
    let tenant = await tx.tenant.findFirst({
      where: { primaryPhone: "9898990001" },
    });

    if (!tenant) {
      tenant = await tx.tenant.create({
        data: {
          primaryPhone: "9898990001",
          primaryEmail: "demo@billing.local",
          subscriptionTier: "DISTRIBUTION_ENTERPRISE",
          subscriptionEnds: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });
      console.log("Created Tenant:", tenant.id);
    }

    // 2. Create Organization
    let organization = await tx.organization.findFirst({
      where: { tenantId: tenant.id },
    });

    if (!organization) {
      organization = await tx.organization.create({
        data: {
          tenantId: tenant.id,
          name: "Paneliya Technology Traders",
          legalName: "Paneliya Technology Private Limited",
        },
      });
      console.log("Created Organization:", organization.id);
    }

    // 3. Create Company
    let company = await tx.company.findFirst({
      where: { organizationId: organization.id },
    });

    if (!company) {
      company = await tx.company.create({
        data: {
          organizationId: organization.id,
          legalName: "Paneliya Technology Private Limited",
          tradeName: "Paneliya Tech & Billing",
          gstin: "24AAACP1234A1Z5",
          stateCode: "24",
          gstType: "REGULAR",
          addressLine1: "101, Business Hub, CG Road",
          city: "Ahmedabad",
          pincode: "380009",
          phone: "9898990001",
          email: "demo@billing.local",
        },
      });
      console.log("Created Company:", company.id);
    }

    // 4. Create Main Branch
    let branch = await tx.branch.findFirst({
      where: { companyId: company.id, code: "BR01" },
    });

    if (!branch) {
      branch = await tx.branch.create({
        data: {
          organizationId: organization.id,
          companyId: company.id,
          name: "Main Branch",
          code: "BR01",
          isMainBranch: true,
          addressLine1: "101, Business Hub, CG Road",
          city: "Ahmedabad",
          pincode: "380009",
          stateCode: "24",
          phone: "9898990001",
        },
      });
      console.log("Created Branch:", branch.id);
    }

    // 5. Create Financial Year (FY 2026-27)
    let fy = await tx.financialYear.findFirst({
      where: { companyId: company.id, name: "FY 2026-27" },
    });

    if (!fy) {
      fy = await tx.financialYear.create({
        data: {
          companyId: company.id,
          name: "FY 2026-27",
          startDate: new Date("2026-04-01T00:00:00.000Z"),
          endDate: new Date("2027-03-31T23:59:59.999Z"),
          isCurrent: true,
          isLocked: false,
        },
      });
      console.log("Created Financial Year:", fy.id);
    }

    // 6. Create Demo Business User (Phone: 9898990001)
    let businessUser = await tx.user.findFirst({
      where: { phone: "9898990001" },
    });

    if (!businessUser) {
      businessUser = await tx.user.create({
        data: {
          organizationId: organization.id,
          fullName: "Keyur Paneliya",
          phone: "9898990001",
          email: "demo@billing.local",
          passwordHash,
          role: "COMPANY_ADMIN",
          preferredLang: "en",
          isActive: true,
        },
      });
      console.log("Created Demo Business User (9898990001):", businessUser.id);
    } else {
      await tx.user.update({
        where: { id: businessUser.id },
        data: { passwordHash, isActive: true },
      });
      console.log("Updated Demo Business User password");
    }

    // Assign user to branch
    const assignment = await tx.userBranchAssignment.findUnique({
      where: {
        userId_branchId: {
          userId: businessUser.id,
          branchId: branch.id,
        },
      },
    });

    if (!assignment) {
      await tx.userBranchAssignment.create({
        data: {
          userId: businessUser.id,
          branchId: branch.id,
          role: "COMPANY_ADMIN",
          isDefault: true,
        },
      });
    }

    // 7. Seed Standard Ledger Groups & Accounts
    const groupMap = new Map();
    for (const tGroup of STANDARD_SME_GROUPS) {
      let parentId = null;
      if (tGroup.parentName) {
        parentId = groupMap.get(tGroup.parentName) || null;
        if (!parentId) {
          const existingParent = await tx.ledgerGroup.findFirst({
            where: { companyId: company.id, name: tGroup.parentName },
          });
          if (existingParent) parentId = existingParent.id;
        }
      }

      const existingGroup = await tx.ledgerGroup.findUnique({
        where: {
          companyId_name: {
            companyId: company.id,
            name: tGroup.name,
          },
        },
      });

      if (existingGroup) {
        groupMap.set(tGroup.name, existingGroup.id);
      } else {
        const created = await tx.ledgerGroup.create({
          data: {
            organizationId: organization.id,
            companyId: company.id,
            name: tGroup.name,
            nameGujarati: tGroup.nameGujarati,
            nature: tGroup.nature,
            parentId: parentId || undefined,
            isSystem: tGroup.isSystem,
          },
        });
        groupMap.set(tGroup.name, created.id);
      }
    }

    for (const tAcc of STANDARD_SME_ACCOUNTS) {
      const groupId = groupMap.get(tAcc.groupName);
      if (!groupId) continue;

      const existingAcc = await tx.ledgerAccount.findUnique({
        where: {
          companyId_name: {
            companyId: company.id,
            name: tAcc.name,
          },
        },
      });

      if (!existingAcc) {
        await tx.ledgerAccount.create({
          data: {
            organizationId: organization.id,
            companyId: company.id,
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
    console.log("Seeded Chart of Accounts for company");

    // 8. Create SuperAdmin User (superadmin@billing.local)
    let superUser = await tx.user.findFirst({
      where: { email: "superadmin@billing.local" },
    });

    if (!superUser) {
      superUser = await tx.user.create({
        data: {
          organizationId: organization.id,
          fullName: "Master SuperAdmin",
          phone: "9999999999",
          email: "superadmin@billing.local",
          passwordHash,
          role: "SUPER_ADMIN",
          preferredLang: "en",
          isActive: true,
        },
      });
      console.log("Created SuperAdmin User (superadmin@billing.local):", superUser.id);
    } else {
      await tx.user.update({
        where: { id: superUser.id },
        data: { organizationId: organization.id, passwordHash, role: "SUPER_ADMIN", isActive: true },
      });
      console.log("Updated SuperAdmin User");
    }

    const superAssignment = await tx.userBranchAssignment.findUnique({
      where: {
        userId_branchId: {
          userId: superUser.id,
          branchId: branch.id,
        },
      },
    });

    if (!superAssignment) {
      await tx.userBranchAssignment.create({
        data: {
          userId: superUser.id,
          branchId: branch.id,
          role: "SUPER_ADMIN",
          isDefault: true,
        },
      });
    }
  }, { timeout: 60000, maxWait: 10000 });

  console.log("\n✅ All seed data created successfully!");
  console.log("Credentials available:");
  console.log("  1. Business Login:");
  console.log("     Phone:    9898990001");
  console.log("     Password: Password123#");
  console.log("  2. SuperAdmin Portal:");
  console.log("     Email:    superadmin@billing.local");
  console.log("     Password: Password123#");
}

main()
  .catch((e) => {
    console.error("Error during seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
