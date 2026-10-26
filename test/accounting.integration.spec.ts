import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { AccountNature, VoucherType } from "@billing/shared-types";

describe("Phase 4: Double-Entry Accounting Core & Chart of Accounts (Integration)", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tenantAOrgId: string;
  let tenantACompanyId: string;
  let tenantAToken: string;
  let tenantAFinancialYearId: string;

  let tenantBOrgId: string;
  let tenantBCompanyId: string;
  let tenantBToken: string;

  let cashAccountId: string;
  let capitalAccountId: string;
  let salesAccountId: string;
  let cgstAccountId: string;
  let sgstAccountId: string;
  let debtorAccountId: string;
  let inactiveAccountId: string;
  let lockedFyId: string;

  let postedVoucherId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );

    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(DatabaseService);

    // Clean up test data for phone numbers used in this test
    await prisma.executeBypassRls(async (tx) => {
      const testPhones = ["9898000003", "9898000004"];
      const users = await tx.user.findMany({
        where: { phone: { in: testPhones } },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.journalEntry.deleteMany({
          where: { voucher: { organizationId: { in: orgIds } } },
        });
        await tx.voucher.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.ledgerAccount.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.ledgerGroup.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.userBranchAssignment.deleteMany({
          where: { branch: { organizationId: { in: orgIds } } },
        });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.financialYear.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.branch.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.company.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        const orgs = await tx.organization.findMany({
          where: { id: { in: orgIds } },
          select: { tenantId: true },
        });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
        await tx.tenant.deleteMany({
          where: { id: { in: orgs.map((o) => o.tenantId) } },
        });
      }
    });

    // 1. Setup Tenant A
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Accountant Admin A",
        phone: "9898000003",
        email: "accountantA@test.local",
        password: "PasswordAccounting123#",
        organizationName: "Shree Ram Textiles Org A",
        tradeName: "Ram Textiles Surat",
        stateCode: "24",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const bodyA = JSON.parse(regResA.body);
    tenantAToken = bodyA.accessToken;
    tenantAOrgId = bodyA.defaultContext.organizationId;
    tenantACompanyId = bodyA.defaultContext.companyId;

    // Fetch Tenant A Default FY
    const fyA = await prisma.executeBypassRls(async (tx) => {
      return await tx.financialYear.findFirst({
        where: { companyId: tenantACompanyId, isCurrent: true },
      });
    });
    expect(fyA).toBeDefined();
    tenantAFinancialYearId = fyA!.id;

    // Create a past locked financial year for period lock test
    const lockedFy = await prisma.executeBypassRls(async (tx) => {
      return await tx.financialYear.create({
        data: {
          companyId: tenantACompanyId,
          name: "FY 2025-26 (Locked)",
          startDate: new Date("2025-04-01T00:00:00.000Z"),
          endDate: new Date("2026-03-31T23:59:59.999Z"),
          isLocked: true,
          isCurrent: false,
        },
      });
    });
    lockedFyId = lockedFy.id;

    // 2. Setup Tenant B
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Accountant Admin B",
        phone: "9898000004",
        email: "accountantB@test.local",
        password: "PasswordAccounting123#",
        organizationName: "Bhavani Steels Org B",
        tradeName: "Bhavani Steels Rajkot",
        stateCode: "24",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const bodyB = JSON.parse(regResB.body);
    tenantBToken = bodyB.accessToken;
    tenantBOrgId = bodyB.defaultContext.organizationId;
    tenantBCompanyId = bodyB.defaultContext.companyId;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe("1. Chart of Accounts (COA) Seeding & Hierarchy", () => {
    it("should idempotently seed standard Indian SME Chart of Accounts", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/ledger-groups/seed",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.seededGroups).toBeGreaterThanOrEqual(10);
      expect(data.seededAccounts).toBeGreaterThanOrEqual(10);

      // Repeat seed to verify idempotency (zero duplicates created)
      const repeatRes = await app.inject({
        method: "POST",
        url: "/api/v1/ledger-groups/seed",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });
      expect(repeatRes.statusCode).toBe(201);
      const repeatData = JSON.parse(repeatRes.body);
      expect(repeatData.seededGroups).toBe(0);
      expect(repeatData.seededAccounts).toBe(0);
    });

    it("should list seeded ledger groups with parent-child hierarchy", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/ledger-groups",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });

      expect(res.statusCode).toBe(200);
      const groups = JSON.parse(res.body);
      expect(Array.isArray(groups)).toBe(true);

      const cashGroup = groups.find((g: any) => g.name === "Cash-in-hand");
      expect(cashGroup).toBeDefined();
      expect(cashGroup.nature).toBe("ASSET");
      expect(cashGroup.parent).toBeDefined();
      expect(cashGroup.parent.name).toBe("Current Assets");
    });

    it("should create a custom ledger group and reject duplicate name within company", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/ledger-groups",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          name: "Subcontracting Expenses",
          nameGujarati: "જોબવર્ક ખર્ચા",
          nature: AccountNature.EXPENSE,
        },
      });
      expect(res.statusCode).toBe(201);

      // Duplicate attempt should return 409 Conflict
      const dupRes = await app.inject({
        method: "POST",
        url: "/api/v1/ledger-groups",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          name: "Subcontracting Expenses",
          nature: AccountNature.EXPENSE,
        },
      });
      expect(dupRes.statusCode).toBe(409);
    });

    it("should list seeded ledger accounts and capture key account IDs", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/ledgers?limit=100",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });

      expect(res.statusCode).toBe(200);
      const { data } = JSON.parse(res.body);

      const cashAcc = data.find((a: any) => a.name === "Cash Account");
      const capitalAcc = data.find(
        (a: any) => a.name === "Proprietor Capital Account",
      );
      const salesAcc = data.find(
        (a: any) => a.name === "General Sales Account",
      );
      const cgstAcc = data.find((a: any) => a.name === "Output CGST");
      const sgstAcc = data.find((a: any) => a.name === "Output SGST");

      expect(cashAcc).toBeDefined();
      expect(capitalAcc).toBeDefined();
      expect(salesAcc).toBeDefined();
      expect(cgstAcc).toBeDefined();
      expect(sgstAcc).toBeDefined();

      cashAccountId = cashAcc.id;
      capitalAccountId = capitalAcc.id;
      salesAccountId = salesAcc.id;
      cgstAccountId = cgstAcc.id;
      sgstAccountId = sgstAcc.id;

      // Verify all seeded accounts start with exactly 0.00 current balance
      expect(Number(cashAcc.currentBalance)).toBe(0);
      expect(Number(capitalAcc.currentBalance)).toBe(0);
    });

    it("should create custom ledger accounts including debtor and inactive account", async () => {
      const groupsRes = await app.inject({
        method: "GET",
        url: "/api/v1/ledger-groups",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });
      const groups = JSON.parse(groupsRes.body);
      const debtorsGroup = groups.find((g: any) => g.name === "Sundry Debtors");

      // 1. Create Debtor Account
      const debtorRes = await app.inject({
        method: "POST",
        url: "/api/v1/ledgers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          groupId: debtorsGroup.id,
          name: "Ambica Textiles Surat (Debtor)",
          nameGujarati: "અંબિકા ટેક્સટાઈલ્સ",
          code: "DEBT-001",
          openingBalance: 0.0,
          openingType: "DR",
        },
      });
      expect(debtorRes.statusCode).toBe(201);
      debtorAccountId = JSON.parse(debtorRes.body).id;

      // 2. Create and then deactivate an account
      const inactiveRes = await app.inject({
        method: "POST",
        url: "/api/v1/ledgers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          groupId: debtorsGroup.id,
          name: "Old Closed Debtor Co.",
          isActive: false,
        },
      });
      expect(inactiveRes.statusCode).toBe(201);
      inactiveAccountId = JSON.parse(inactiveRes.body).id;
      expect(JSON.parse(inactiveRes.body).isActive).toBe(false);
    });
  });

  describe("2. Double-Entry Voucher & Journal Posting", () => {
    it("should post a balanced two-line receipt/journal voucher (Cash Dr = Capital Cr)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          voucherType: VoucherType.RECEIPT,
          voucherNumber: "RC/26-27/0001",
          voucherDate: "2026-10-12",
          narration: "Initial proprietor capital introduced in cash",
          lines: [
            {
              accountId: cashAccountId,
              debitAmount: "50000.00",
              creditAmount: "0.00",
              lineNarration: "Cash received",
            },
            {
              accountId: capitalAccountId,
              debitAmount: "0.00",
              creditAmount: "50000.00",
              lineNarration: "Capital credited",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const voucher = JSON.parse(res.body);
      expect(voucher.voucherNumber).toBe("RC/26-27/0001");
      expect(Number(voucher.totalAmount)).toBe(50000.0);
      expect(voucher.journalEntries).toHaveLength(2);
      postedVoucherId = voucher.id;

      // Verify Account Balances Updated:
      // Cash (ASSET): increased by 50,000 Dr -> currentBalance = 50,000
      const cashAcc = await app.inject({
        method: "GET",
        url: `/api/v1/ledgers/${cashAccountId}`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });
      expect(Number(JSON.parse(cashAcc.body).currentBalance)).toBe(50000.0);

      // Capital (EQUITY): increased by 50,000 Cr -> currentBalance = 50,000
      const capitalAcc = await app.inject({
        method: "GET",
        url: `/api/v1/ledgers/${capitalAccountId}`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });
      expect(Number(JSON.parse(capitalAcc.body).currentBalance)).toBe(50000.0);
    });

    it("should post a balanced compound voucher (Sales with CGST & SGST)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          voucherType: VoucherType.SALES,
          voucherNumber: "SL/26-27/0001",
          voucherDate: "2026-10-12",
          narration: "Wholesale fabric credit sale with 18% GST",
          lines: [
            {
              accountId: debtorAccountId,
              debitAmount: "118000.00",
              creditAmount: "0.00",
              lineNarration: "Total receivable from Ambica Textiles",
            },
            {
              accountId: salesAccountId,
              debitAmount: "0.00",
              creditAmount: "100000.00",
              lineNarration: "Taxable sales value",
            },
            {
              accountId: cgstAccountId,
              debitAmount: "0.00",
              creditAmount: "9000.00",
              lineNarration: "Output CGST @ 9%",
            },
            {
              accountId: sgstAccountId,
              debitAmount: "0.00",
              creditAmount: "9000.00",
              lineNarration: "Output SGST @ 9%",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const voucher = JSON.parse(res.body);
      expect(Number(voucher.totalAmount)).toBe(118000.0);
      expect(voucher.journalEntries).toHaveLength(4);

      // Verify Debtor Balance is now 118,000.00
      const debtorAcc = await app.inject({
        method: "GET",
        url: `/api/v1/ledgers/${debtorAccountId}`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });
      expect(Number(JSON.parse(debtorAcc.body).currentBalance)).toBe(118000.0);
    });

    it("should reject an unbalanced voucher where total debits != total credits (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          voucherType: VoucherType.JOURNAL,
          voucherNumber: "JV/26-27/9999",
          voucherDate: "2026-10-12",
          lines: [
            {
              accountId: cashAccountId,
              debitAmount: "1000.00",
              creditAmount: "0.00",
            },
            {
              accountId: salesAccountId,
              debitAmount: "0.00",
              creditAmount: "999.00",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("Unbalanced voucher");
    });

    it("should reject voucher with zero-value line (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          voucherType: VoucherType.JOURNAL,
          voucherNumber: "JV/26-27/0002",
          voucherDate: "2026-10-12",
          lines: [
            {
              accountId: cashAccountId,
              debitAmount: "500.00",
              creditAmount: "0.00",
            },
            {
              accountId: capitalAccountId,
              debitAmount: "0.00",
              creditAmount: "0.00",
            },
            {
              accountId: salesAccountId,
              debitAmount: "0.00",
              creditAmount: "500.00",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("zero debit and zero credit");
    });

    it("should reject voucher with negative amounts (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          voucherType: VoucherType.JOURNAL,
          voucherNumber: "JV/26-27/0003",
          voucherDate: "2026-10-12",
          lines: [
            {
              accountId: cashAccountId,
              debitAmount: "-500.00",
              creditAmount: "0.00",
            },
            {
              accountId: salesAccountId,
              debitAmount: "0.00",
              creditAmount: "500.00",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("cannot be negative");
    });

    it("should reject simultaneous debit and credit on the same line (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          voucherType: VoucherType.JOURNAL,
          voucherNumber: "JV/26-27/0004",
          voucherDate: "2026-10-12",
          lines: [
            {
              accountId: cashAccountId,
              debitAmount: "500.00",
              creditAmount: "500.00",
            },
            {
              accountId: salesAccountId,
              debitAmount: "0.00",
              creditAmount: "500.00",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("cannot contain both debit and credit");
    });

    it("should reject posting to an inactive ledger account (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          voucherType: VoucherType.JOURNAL,
          voucherNumber: "JV/26-27/0005",
          voucherDate: "2026-10-12",
          lines: [
            {
              accountId: inactiveAccountId,
              debitAmount: "500.00",
              creditAmount: "0.00",
            },
            {
              accountId: cashAccountId,
              debitAmount: "0.00",
              creditAmount: "500.00",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("is inactive");
    });

    it("should reject duplicate voucher number within same company and financial year (409 Conflict)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          voucherType: VoucherType.RECEIPT,
          voucherNumber: "RC/26-27/0001", // Already created in earlier test
          voucherDate: "2026-10-12",
          lines: [
            {
              accountId: cashAccountId,
              debitAmount: "100.00",
              creditAmount: "0.00",
            },
            {
              accountId: capitalAccountId,
              debitAmount: "0.00",
              creditAmount: "100.00",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.body).toContain("already exists");
    });
  });

  describe("3. Financial Year & Period Locking Enforcement", () => {
    it("should reject posting voucher with date outside financial year bounds", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          voucherType: VoucherType.JOURNAL,
          voucherNumber: "JV/26-27/0006",
          voucherDate: "2028-05-15", // Far in the future outside FY 2026-27
          lines: [
            {
              accountId: cashAccountId,
              debitAmount: "500.00",
              creditAmount: "0.00",
            },
            {
              accountId: capitalAccountId,
              debitAmount: "0.00",
              creditAmount: "500.00",
            },
          ],
        },
      });

      // No active FY for 2028 or date out of period
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it("should reject posting voucher into a locked financial year (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          voucherType: VoucherType.JOURNAL,
          voucherNumber: "JV/25-26/0001",
          voucherDate: "2025-06-15",
          financialYearId: lockedFyId,
          lines: [
            {
              accountId: cashAccountId,
              debitAmount: "500.00",
              creditAmount: "0.00",
            },
            {
              accountId: capitalAccountId,
              debitAmount: "0.00",
              creditAmount: "500.00",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("locked");
    });
  });

  describe("4. Voucher Immutability & Reversals", () => {
    it("should reject PATCH /vouchers/:id with 400 Bad Request (immutability)", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/vouchers/${postedVoucherId}`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: { narration: "Modified narration" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("immutable");
    });

    it("should reject DELETE /vouchers/:id with 400 Bad Request (deletion prohibited)", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/vouchers/${postedVoucherId}`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("cannot be deleted");
    });

    it("should reverse a posted voucher and restore account balances atomically", async () => {
      // Prior to reversal, Cash was 50,000 and Capital was 50,000 from RC/26-27/0001
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/vouchers/${postedVoucherId}/reverse`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          reason: "Cash counted incorrectly during audit",
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.isCancelled).toBe(true);
      expect(data.reversalVoucher.voucherNumber).toBe("REV-RC/26-27/0001");
      expect(data.reversalVoucher.voucherType).toBe("JOURNAL");
      expect(data.reversalVoucher.journalEntries).toHaveLength(2);

      // Verify Cash Account balance reverted back to 0.00
      const cashAcc = await app.inject({
        method: "GET",
        url: `/api/v1/ledgers/${cashAccountId}`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });
      expect(Number(JSON.parse(cashAcc.body).currentBalance)).toBe(0.0);

      // Verify Capital Account balance reverted back to 0.00
      const capitalAcc = await app.inject({
        method: "GET",
        url: `/api/v1/ledgers/${capitalAccountId}`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });
      expect(Number(JSON.parse(capitalAcc.body).currentBalance)).toBe(0.0);

      // Verify original voucher is flagged as cancelled
      const origVoucher = await app.inject({
        method: "GET",
        url: `/api/v1/vouchers/${postedVoucherId}`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });
      expect(JSON.parse(origVoucher.body).isCancelled).toBe(true);
    });

    it("should reject double-reversing an already reversed voucher (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/vouchers/${postedVoucherId}/reverse`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          reason: "Attempt second reversal",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.body).toContain("already cancelled");
    });
  });

  describe("5. Atomic Transaction Rollback & Invariant Integrity", () => {
    it("should rollback completely when a voucher posting encounters invalid account midway", async () => {
      const nonExistentId = "00000000-0000-0000-0000-999999999999";
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          voucherType: VoucherType.JOURNAL,
          voucherNumber: "JV/26-27/FAIL-01",
          voucherDate: "2026-10-12",
          lines: [
            {
              accountId: cashAccountId,
              debitAmount: "1000.00",
              creditAmount: "0.00",
            },
            {
              accountId: nonExistentId,
              debitAmount: "0.00",
              creditAmount: "1000.00",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);

      // Verify no voucher with this number was created in the database
      const count = await prisma.executeBypassRls(async (tx) => {
        return await tx.voucher.count({
          where: { voucherNumber: "JV/26-27/FAIL-01" },
        });
      });
      expect(count).toBe(0);
    });
  });

  describe("6. Concurrent Posting & Sequence Safety", () => {
    it("should handle concurrent distinct voucher postings safely", async () => {
      const postRequests = Array.from({ length: 5 }, (_, i) => {
        const num = `CP/26-27/000${i + 1}`;
        return app.inject({
          method: "POST",
          url: "/api/v1/vouchers",
          headers: {
            authorization: `Bearer ${tenantAToken}`,
            "x-organization-id": tenantAOrgId,
            "x-company-id": tenantACompanyId,
          },
          payload: {
            voucherType: VoucherType.CONTRA,
            voucherNumber: num,
            voucherDate: "2026-10-12",
            lines: [
              {
                accountId: cashAccountId,
                debitAmount: "100.00",
                creditAmount: "0.00",
              },
              {
                accountId: capitalAccountId,
                debitAmount: "0.00",
                creditAmount: "100.00",
              },
            ],
          },
        });
      });

      const responses = await Promise.all(postRequests);
      for (const res of responses) {
        expect(res.statusCode).toBe(201);
      }
    });
  });

  describe("7. Tenant Isolation & PostgreSQL Row Level Security (RLS)", () => {
    it("should prevent Tenant B from reading Tenant A's voucher (404 Not Found)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/vouchers/${postedVoucherId}`,
        headers: {
          authorization: `Bearer ${tenantBToken}`,
          "x-organization-id": tenantBOrgId,
          "x-company-id": tenantBCompanyId,
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it("should prevent Tenant B from reversing Tenant A's voucher (404 Not Found)", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/vouchers/${postedVoucherId}/reverse`,
        headers: {
          authorization: `Bearer ${tenantBToken}`,
          "x-organization-id": tenantBOrgId,
          "x-company-id": tenantBCompanyId,
        },
        payload: {
          reason: "Malicious cross-tenant reversal attempt",
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it("should isolate ledger accounts across tenants under RLS", async () => {
      // Tenant B queries ledger accounts: should see 0 accounts before seeding
      const resB = await app.inject({
        method: "GET",
        url: "/api/v1/ledgers",
        headers: {
          authorization: `Bearer ${tenantBToken}`,
          "x-organization-id": tenantBOrgId,
          "x-company-id": tenantBCompanyId,
        },
      });

      expect(resB.statusCode).toBe(200);
      const dataB = JSON.parse(resB.body);
      expect(dataB.total).toBe(0); // Tenant B sees none of Tenant A's accounts
    });
  });

  describe("8. Expense Payment Vouchers & Ledger Balance Integrity", () => {
    let expenseAccountId: string;

    beforeAll(async () => {
      // Create an Office Stationery & Supplies expense ledger account under Tenant A
      const groupRes = await app.inject({
        method: "GET",
        url: "/api/v1/ledger-groups",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });
      const groups = JSON.parse(groupRes.body);
      const expenseGroup =
        groups.find((g: any) => g.nature === "EXPENSE") || groups[0];

      const accRes = await app.inject({
        method: "POST",
        url: "/api/v1/ledgers",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          groupId: expenseGroup.id,
          name: "Office Stationery Expenses",
          openingType: "DR",
          openingBalance: 0,
        },
      });
      expect(accRes.statusCode).toBe(201);
      const accData = JSON.parse(accRes.body);
      expenseAccountId = accData.id;
    });

    it("should successfully post an expense payment voucher and update expense balance", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers/expense",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          expenseAccountId,
          amount: 2500,
          narration: "Office supplies and printer paper purchased",
        },
      });

      expect(res.statusCode).toBe(201);
      const voucher = JSON.parse(res.body);
      expect(voucher.voucherType).toBe("PAYMENT");
      expect(voucher.journalEntries).toHaveLength(2);

      const drEntry = voucher.journalEntries.find(
        (je: any) => je.accountId === expenseAccountId,
      );
      expect(Number(drEntry.debitAmount)).toBe(2500);
      expect(Number(drEntry.creditAmount)).toBe(0);

      // Verify that expense account current balance updated
      const getAccRes = await app.inject({
        method: "GET",
        url: `/api/v1/ledgers/${expenseAccountId}`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });
      expect(getAccRes.statusCode).toBe(200);
      const updatedAcc = JSON.parse(getAccRes.body);
      expect(Number(updatedAcc.currentBalance)).toBe(2500);
    });

    it("should reject expense voucher with non-positive amount (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers/expense",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          expenseAccountId,
          amount: 0,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should reject expense voucher with non-existent expense account (404 Not Found)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers/expense",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
        payload: {
          expenseAccountId: "00000000-0000-0000-0000-000000000000",
          amount: 1000,
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
