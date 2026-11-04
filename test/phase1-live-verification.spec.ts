import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { ReportsService } from "../src/reports/reports.service";
import { TenantContext } from "@billing/shared-types";

describe("Phase 1 Live Verification - Company JK Financial Statements", () => {
  let prisma: DatabaseService;
  let reportsService: ReportsService;

  const tenant: TenantContext = {
    userId: "ec46866d-7d8e-4119-bba5-0044d0fce8de",
    organizationId: "3127cc52-2797-4dc2-a9d3-55ba236c8d55",
    companyId: "92967a06-d488-4794-bae1-e6188e8fb47d",
    branchId: "96ceb02c-5439-4144-b323-e0d7748c3db0",
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleRef.get(DatabaseService);
    reportsService = moduleRef.get(ReportsService);
  });

  it("1. Profit & Loss: Direct vs Indirect Classification & Account Segregation", async () => {
    const pnl = await reportsService.getProfitAndLoss(
      { fromDate: "2026-04-01", toDate: "2026-11-04" },
      tenant
    );

    expect(pnl).toBeDefined();
    expect(pnl.directIncome).toBeDefined();
    expect(pnl.directExpenses).toBeDefined();
    expect(pnl.indirectIncome).toBeDefined();
    expect(pnl.indirectExpenses).toBeDefined();

    console.log("=== P&L LIVE RESULT ===");
    console.log("Direct Income Total:", pnl.directIncome.total);
    console.log("Direct Income Accounts:", pnl.directIncome.accounts.map((a: any) => `${a.name} (${a.amount})`));
    console.log("Indirect Income Total:", pnl.indirectIncome.total);
    console.log("Indirect Income Accounts:", pnl.indirectIncome.accounts.map((a: any) => `${a.name} (${a.amount})`));
    console.log("Direct Expenses Total:", pnl.directExpenses.total);
    console.log("Direct Expenses Accounts:", pnl.directExpenses.accounts.map((a: any) => `${a.name} (${a.amount})`));
    console.log("Indirect Expenses Total:", pnl.indirectExpenses.total);
    console.log("Indirect Expenses Accounts:", pnl.indirectExpenses.accounts.map((a: any) => `${a.name} (${a.amount})`));
    console.log("Gross Profit:", pnl.grossProfit);
    console.log("Net Profit:", pnl.netProfit);

    // Verify Indirect Income accounts are NOT inside Direct Income accounts
    const directNames = pnl.directIncome.accounts.map((a: any) => a.name.toLowerCase());
    expect(directNames).not.toContain("discount received");
    expect(directNames).not.toContain("round off");

    // General Sales and Interstate Sales are Direct Income
    expect(directNames).toContain("general sales account");
  });

  it("2. Balance Sheet: Asset, Liability & Equity Structure", async () => {
    const bs = await reportsService.getBalanceSheet(
      { asOfDate: "2026-11-04" },
      tenant
    );

    expect(bs).toBeDefined();
    expect(bs.assets).toBeDefined();
    expect(bs.assets.accounts).toBeInstanceOf(Array);
    expect(bs.liabilities).toBeDefined();
    expect(bs.liabilities.accounts).toBeInstanceOf(Array);
    expect(bs.equity).toBeDefined();
    expect(bs.equity.accounts).toBeInstanceOf(Array);

    console.log("=== BALANCE SHEET LIVE RESULT ===");
    console.log("Total Assets:", bs.assets.total);
    console.log("Total Liabilities:", bs.liabilities.total);
    console.log("Total Equity:", bs.equity.total);
    console.log("Net Profit or Loss in Equity:", bs.equity.netProfitOrLoss);
    console.log("Total Liabilities & Equity:", bs.totalLiabilitiesAndEquity);
    console.log("Difference:", bs.difference);
    console.log("Is Balanced:", bs.isBalanced);

    // Asset accounts check
    expect(bs.assets.accounts.length).toBeGreaterThan(0);
    // After approved demo accounts cleanup, Balance Sheet is perfectly balanced at 0.00 difference
    expect(bs.difference).toBe("0.00");
    expect(bs.isBalanced).toBe(true);
  });

  it("3. Trial Balance: Complete Account Balance Listing", async () => {
    const tb = await reportsService.getTrialBalance(
      { asOfDate: "2026-11-04" },
      tenant
    );

    expect(tb).toBeDefined();
    expect(tb.accounts).toBeInstanceOf(Array);
    expect(tb.totals).toBeDefined();

    console.log("=== TRIAL BALANCE LIVE RESULT ===");
    console.log("Total Accounts:", tb.accounts.length);
    console.log("Total Closing Debit:", tb.totals.totalClosingDebit);
    console.log("Total Closing Credit:", tb.totals.totalClosingCredit);
    console.log("Difference:", tb.difference);
    console.log("Is Balanced:", tb.isBalanced);

    expect(tb.accounts.length).toBeGreaterThan(0);
    // After approved demo accounts cleanup, Trial Balance is perfectly balanced at 0.00 difference
    expect(tb.difference).toBe("0.00");
    expect(tb.isBalanced).toBe(true);
  });

  it("4. Demo Accounts Cleanup Verification: 0 Orphaned Demo Accounts", async () => {
    const demoIds = [
      "b3b0ec60-48b0-438b-97e7-eda1ef78af17",
      "92253535-6b97-4753-8038-6245734fc87c",
      "7e260529-5dc5-4d44-98b7-3c3944588891",
      "d77f7b7e-0cab-4189-a4c1-8268ac907c4e",
      "c086fb24-150a-4d1f-b801-5d1ce96c9a01",
      "4b6a7232-22d8-446c-a61e-e44357a7d09b",
      "6822ad21-0fa0-41ad-80e3-d3919ec5e514",
      "5538ae1c-2d11-4880-bb61-6e492a557f70",
      "c9ae79c8-3eb5-46db-849e-01362cf0a8a1",
      "4bd34471-09a5-415d-983e-e1442e81c8fb",
    ];

    const remainingDemoAccounts = await prisma.ledgerAccount.findMany({
      where: {
        id: { in: demoIds },
      },
    });

    expect(remainingDemoAccounts).toHaveLength(0);
  });

  it("5. Periodic SME COGS & Negative Inventory Detection", async () => {
    const pnl = await reportsService.getProfitAndLoss(
      { fromDate: "2026-04-01", toDate: "2026-11-04" },
      tenant
    );

    expect(pnl.tradingAccount).toBeDefined();
    expect(pnl.tradingAccount.costOfGoodsSold).toBeDefined();
    expect(Number(pnl.tradingAccount.costOfGoodsSold)).toBeGreaterThan(0);
    expect(pnl.tradingAccount.hasNegativeInventoryWarning).toBe(true);
    expect(pnl.tradingAccount.isProvisional).toBe(true);
  });
});
