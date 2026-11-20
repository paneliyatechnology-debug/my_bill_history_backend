import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { AccountNature, VoucherType } from "@billing/shared-types";

describe("Manual Vouchers & Double-Entry Accounting Core (Integration)", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tenantOrgId: string;
  let tenantCompanyId: string;
  let tenantToken: string;
  let tenantFinancialYearId: string;

  let cashAccountId: string;
  let bankAccountId: string;
  let rentExpenseAccountId: string;
  let consultingRevenueAccountId: string;

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

    // Clean up any previous test user
    const testPhone = "9898000088";
    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: testPhone },
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
        await tx.salesInvoiceItem.deleteMany({
          where: { invoice: { organizationId: { in: orgIds } } },
        });
        await tx.salesInvoice.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.deliveryChallanItem.deleteMany({
          where: { challan: { organizationId: { in: orgIds } } },
        });
        await tx.deliveryChallan.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.stockTransaction.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.userBranchAssignment.deleteMany({
          where: { branch: { organizationId: { in: orgIds } } },
        });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.invoiceSequence.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
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

    // Register test company & tenant
    const regRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Voucher Test Auditor",
        phone: testPhone,
        email: "voucher.auditor@test.local",
        password: "PasswordVoucher123#",
        organizationName: "Voucher Audit Org",
        tradeName: "Voucher Audit Trading",
        stateCode: "24",
      },
    });
    expect(regRes.statusCode).toBe(201);
    const body = JSON.parse(regRes.body);
    tenantToken = body.accessToken;
    tenantOrgId = body.defaultContext.organizationId;
    tenantCompanyId = body.defaultContext.companyId;

    // Get current financial year
    const fy = await prisma.executeBypassRls(async (tx) => {
      return await tx.financialYear.findFirst({
        where: { companyId: tenantCompanyId, isCurrent: true },
      });
    });
    tenantFinancialYearId = fy!.id;

    // Seed Standard Chart of Accounts
    const seedRes = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-groups/seed",
      headers: {
        authorization: `Bearer ${tenantToken}`,
        "x-organization-id": tenantOrgId,
        "x-company-id": tenantCompanyId,
      },
    });
    expect(seedRes.statusCode).toBe(201);

    // Fetch accounts seeded by registration
    await prisma.executeBypassRls(async (tx) => {
      const cash = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenantCompanyId,
          isCashLedger: true,
        },
      });
      cashAccountId = cash!.id;

      let bank = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenantCompanyId,
          isBankLedger: true,
        },
      });
      if (!bank) {
        // Create bank account if not present
        const bankGroup = await tx.ledgerGroup.findFirst({
          where: { companyId: tenantCompanyId, name: "Bank Accounts" },
        });
        bank = await tx.ledgerAccount.create({
          data: {
            organizationId: tenantOrgId,
            companyId: tenantCompanyId,
            groupId: bankGroup!.id,
            name: "HDFC Primary Bank",
            code: "1002",
            isBankLedger: true,
            openingType: "DR",
          },
        });
      }
      bankAccountId = bank.id;

      // Create Rent Expense Account
      const expenseGroup = await tx.ledgerGroup.findFirst({
        where: { companyId: tenantCompanyId, nature: AccountNature.EXPENSE },
      });
      const rent = await tx.ledgerAccount.create({
        data: {
          organizationId: tenantOrgId,
          companyId: tenantCompanyId,
          groupId: expenseGroup!.id,
          name: "Office Rent Expense Account",
          code: "5001",
          openingType: "DR",
        },
      });
      rentExpenseAccountId = rent.id;

      // Create Consulting Revenue Account
      const incomeGroup = await tx.ledgerGroup.findFirst({
        where: { companyId: tenantCompanyId, nature: AccountNature.INCOME },
      });
      const revenue = await tx.ledgerAccount.create({
        data: {
          organizationId: tenantOrgId,
          companyId: tenantCompanyId,
          groupId: incomeGroup!.id,
          name: "Consulting Service Revenue",
          code: "4001",
          openingType: "CR",
        },
      });
      consultingRevenueAccountId = revenue.id;
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe("1. Manual JOURNAL Voucher Posting", () => {
    it("should successfully post a balanced general journal voucher (Office Rent Dr = Bank Cr)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/accounting/vouchers",
        headers: {
          authorization: `Bearer ${tenantToken}`,
          "x-organization-id": tenantOrgId,
          "x-company-id": tenantCompanyId,
        },
        payload: {
          voucherType: "JOURNAL",
          voucherNumber: "JV-2026-TEST-001",
          voucherDate: "2026-11-20",
          referenceNo: "CHQ-100201",
          narration: "Being office rent paid for November",
          lines: [
            {
              accountId: rentExpenseAccountId,
              debitAmount: 15000,
              creditAmount: 0,
              lineNarration: "Rent expense debit",
              sequenceOrder: 1,
            },
            {
              accountId: bankAccountId,
              debitAmount: 0,
              creditAmount: 15000,
              lineNarration: "Bank account credit",
              sequenceOrder: 2,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const voucher = JSON.parse(res.body);
      expect(voucher.voucherType).toBe("JOURNAL");
      expect(voucher.voucherNumber).toBe("JV-2026-TEST-001");
      expect(voucher.journalEntries).toHaveLength(2);
      expect(Number(voucher.totalAmount)).toBe(15000);

      // Verify running balances updated
      const rentAcc = await prisma.executeBypassRls(async (tx) => {
        return await tx.ledgerAccount.findUnique({
          where: { id: rentExpenseAccountId },
        });
      });
      // Expense natural balance is Debit: Dr 15000 increases balance to 15000
      expect(Number(rentAcc!.currentBalance)).toBe(15000);
    });

    it("should reject an unbalanced journal voucher where Debit != Credit (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/accounting/vouchers",
        headers: {
          authorization: `Bearer ${tenantToken}`,
          "x-organization-id": tenantOrgId,
          "x-company-id": tenantCompanyId,
        },
        payload: {
          voucherType: "JOURNAL",
          voucherNumber: "JV-UNBALANCED-01",
          voucherDate: "2026-11-20",
          lines: [
            {
              accountId: rentExpenseAccountId,
              debitAmount: 10000,
              creditAmount: 0,
            },
            {
              accountId: bankAccountId,
              debitAmount: 0,
              creditAmount: 9500, // ₹500 mismatch
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.message).toContain("Unbalanced voucher");
    });

    it("should reject a line with both Debit and Credit positive on the same row (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/accounting/vouchers",
        headers: {
          authorization: `Bearer ${tenantToken}`,
          "x-organization-id": tenantOrgId,
          "x-company-id": tenantCompanyId,
        },
        payload: {
          voucherType: "JOURNAL",
          voucherNumber: "JV-DUAL-LINE-01",
          voucherDate: "2026-11-20",
          lines: [
            {
              accountId: rentExpenseAccountId,
              debitAmount: 5000,
              creditAmount: 5000, // Dual positive amounts forbidden
            },
            {
              accountId: bankAccountId,
              debitAmount: 0,
              creditAmount: 5000,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.message).toContain(
        "cannot contain both debit and credit amounts",
      );
    });
  });

  describe("2. CONTRA Voucher Invariant Enforcement", () => {
    it("should successfully post a balanced CONTRA voucher between Cash and Bank (Cash Dr = Bank Cr)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/accounting/vouchers",
        headers: {
          authorization: `Bearer ${tenantToken}`,
          "x-organization-id": tenantOrgId,
          "x-company-id": tenantCompanyId,
        },
        payload: {
          voucherType: "CONTRA",
          voucherNumber: "CTR-2026-001",
          voucherDate: "2026-11-20",
          referenceNo: "CASH-WDL-01",
          narration: "Cash withdrawn from HDFC bank for office petty cash",
          lines: [
            {
              accountId: cashAccountId,
              debitAmount: 25000,
              creditAmount: 0,
              lineNarration: "Cash in hand Dr",
              sequenceOrder: 1,
            },
            {
              accountId: bankAccountId,
              debitAmount: 0,
              creditAmount: 25000,
              lineNarration: "HDFC Bank Cr",
              sequenceOrder: 2,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const voucher = JSON.parse(res.body);
      expect(voucher.voucherType).toBe("CONTRA");
      expect(voucher.voucherNumber).toBe("CTR-2026-001");
      expect(Number(voucher.totalAmount)).toBe(25000);
    });

    it("should reject a CONTRA voucher if no Cash or Bank account is involved (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/accounting/vouchers",
        headers: {
          authorization: `Bearer ${tenantToken}`,
          "x-organization-id": tenantOrgId,
          "x-company-id": tenantCompanyId,
        },
        payload: {
          voucherType: "CONTRA",
          voucherNumber: "CTR-INVALID-001",
          voucherDate: "2026-11-20",
          lines: [
            {
              accountId: rentExpenseAccountId, // Expense is NOT cash or bank
              debitAmount: 10000,
              creditAmount: 0,
            },
            {
              accountId: consultingRevenueAccountId, // Income is NOT cash or bank
              debitAmount: 0,
              creditAmount: 10000,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.message).toContain("Contra vouchers must involve at least one Cash or Bank account");
    });
  });

  describe("3. RECEIPT & PAYMENT Voucher Posting", () => {
    it("should post a balanced manual RECEIPT voucher (Bank Dr = Consulting Revenue Cr)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/accounting/vouchers",
        headers: {
          authorization: `Bearer ${tenantToken}`,
          "x-organization-id": tenantOrgId,
          "x-company-id": tenantCompanyId,
        },
        payload: {
          voucherType: "RECEIPT",
          voucherNumber: "RCP-2026-001",
          voucherDate: "2026-11-20",
          narration: "Direct consulting fee received via NEFT",
          lines: [
            {
              accountId: bankAccountId,
              debitAmount: 50000,
              creditAmount: 0,
            },
            {
              accountId: consultingRevenueAccountId,
              debitAmount: 0,
              creditAmount: 50000,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const voucher = JSON.parse(res.body);
      expect(voucher.voucherType).toBe("RECEIPT");
      expect(Number(voucher.totalAmount)).toBe(50000);
    });

    it("should list vouchers and include journal entries mapped as lines for UI compatibility", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/accounting/vouchers",
        headers: {
          authorization: `Bearer ${tenantToken}`,
          "x-organization-id": tenantOrgId,
          "x-company-id": tenantCompanyId,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toBeDefined();
      expect(body.data.length).toBeGreaterThanOrEqual(3);

      const firstVoucher = body.data[0];
      // Verify both lines and journalEntries are present
      expect(firstVoucher.lines).toBeDefined();
      expect(firstVoucher.journalEntries).toBeDefined();
      expect(firstVoucher.lines.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("4. Financial Statement Integration", () => {
    it("should immediately reflect posted vouchers in Trial Balance with Total Debits = Total Credits", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/reports/trial-balance",
        headers: {
          authorization: `Bearer ${tenantToken}`,
          "x-organization-id": tenantOrgId,
          "x-company-id": tenantCompanyId,
        },
      });

      expect(res.statusCode).toBe(200);
      const tb = JSON.parse(res.body);
      expect(tb.isBalanced).toBe(true);
      expect(Number(tb.difference)).toBe(0);
      expect(Number(tb.totals.totalClosingDebit)).toBe(
        Number(tb.totals.totalClosingCredit),
      );
    });
  });
});
