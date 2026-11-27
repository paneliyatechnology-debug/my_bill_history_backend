import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Gross Trading Profit, COGS & Balance Sheet Accounting Audit", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;
  let token = "";
  let companyId = "";
  let orgId = "";
  let warehouseId = "";
  let supplierId = "";
  let customerId = "";
  let goodsItemId = "";
  let serviceItemId = "";

  const authHeaders = () => ({ authorization: `Bearer ${token}` });

  async function cleanupTestTenant() {
    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: { in: ["9825999191"] } },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (orgIds.length === 0) return;

      await tx.paymentAllocation.deleteMany({ where: { voucher: { organizationId: { in: orgIds } } } });
      await tx.journalEntry.deleteMany({ where: { voucher: { organizationId: { in: orgIds } } } });
      await tx.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.salesReturnItem.deleteMany({ where: { returnDoc: { organizationId: { in: orgIds } } } });
      await tx.salesReturn.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.salesInvoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
      await tx.salesInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.purchaseReturnItem.deleteMany({ where: { returnDoc: { organizationId: { in: orgIds } } } });
      await tx.purchaseReturn.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.purchaseInvoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
      await tx.purchaseInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.stockTransaction.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.item.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.unitOfMeasure.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.party.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.warehouse.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.ledgerGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.financialYear.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
      await tx.userBranchAssignment.deleteMany({ where: { branch: { organizationId: { in: orgIds } } } });
      await tx.branch.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } });
      const orgs = await tx.organization.findMany({ where: { id: { in: orgIds } }, select: { tenantId: true } });
      await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      await tx.tenant.deleteMany({ where: { id: { in: orgs.map((o) => o.tenantId) } } });
    });
  }

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

    await cleanupTestTenant();

    const regRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "GP Audit User",
        phone: "9825999191",
        password: "Password@123",
        organizationName: "GP Audit Org",
        tradeName: "GP Audit Traders",
        stateCode: "24",
      },
    });
    expect(regRes.statusCode).toBe(201);
    const reg = JSON.parse(regRes.body);
    token = reg.accessToken;
    companyId = reg.defaultContext.companyId;
    orgId = reg.defaultContext.organizationId;

    await app.inject({ method: "POST", url: "/api/v1/ledger-groups/seed", headers: authHeaders() });

    const wh = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/tenants/warehouses",
          headers: authHeaders(),
          payload: { name: "Main Godown", isDefault: true },
        })
      ).body,
    );
    warehouseId = wh.id;

    const uom = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/units",
          headers: authHeaders(),
          payload: { name: "Piece", code: "PCS", isDecimalAllowed: false },
        })
      ).body,
    );

    const supp = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/parties",
          headers: authHeaders(),
          payload: { name: "Audit Supplier", type: "SUPPLIER", phone: "9825999192", stateCode: "24" },
        })
      ).body,
    );
    supplierId = supp.id;

    const cust = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/parties",
          headers: authHeaders(),
          payload: { name: "Audit Customer", type: "CUSTOMER", phone: "9825999193", stateCode: "24" },
        })
      ).body,
    );
    customerId = cust.id;

    const goodsRes = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: authHeaders(),
      payload: {
        name: "Audit Widget",
        sku: "AUD-WID-01",
        hsnCode: "8471",
        type: "PRODUCT",
        primaryUomId: uom.id,
        purchaseRate: 100,
        retailPrice: 150,
        taxRate: 18,
      },
    });
    if (goodsRes.statusCode !== 201) throw new Error(`GOODS ITEM FAILED: ${goodsRes.statusCode} ${goodsRes.body}`);
    goodsItemId = JSON.parse(goodsRes.body).id;

    const svcRes = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: authHeaders(),
      payload: {
        name: "Consulting Service",
        sku: "AUD-SVC-01",
        hsnCode: "998314",
        type: "SERVICE",
        primaryUomId: uom.id,
        purchaseRate: 0,
        retailPrice: 500,
        taxRate: 18,
      },
    });
    if (svcRes.statusCode !== 201) throw new Error(`SVC ITEM FAILED: ${svcRes.statusCode} ${svcRes.body}`);
    serviceItemId = JSON.parse(svcRes.body).id;
  });

  afterAll(async () => {
    await cleanupTestTenant();
    await app.close();
  });

  it("1. Purchase stock & sell nothing: COGS=0, Gross Profit=0, Gross Margin=0%, Closing Stock matches Balance Sheet", async () => {
    // Purchase 10 units @ 100 + 18% GST = 1000 taxable + 180 GST = 1180 total
    const purRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: authHeaders(),
      payload: {
        partyId: supplierId,
        warehouseId,
        vendorInvoiceNumber: "PINV-001",
        invoiceDate: "2026-04-10",
        items: [{ itemId: goodsItemId, quantity: 10, unitPrice: 100, taxRate: 18 }],
      },
    });
    if (purRes.statusCode !== 201) throw new Error(`PURCHASE FAILED: ${purRes.statusCode} ${purRes.body}`);
    expect(purRes.statusCode).toBe(201);

    const [pnlRes, bsRes, stockRes] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/reports/profit-and-loss?fromDate=2026-04-01&toDate=2026-04-30", headers: authHeaders() }),
      app.inject({ method: "GET", url: "/api/v1/reports/balance-sheet?asOfDate=2026-04-30", headers: authHeaders() }),
      app.inject({ method: "GET", url: "/api/v1/reports/stock-summary?asOfDate=2026-04-30", headers: authHeaders() }),
    ]);

    const pnl = JSON.parse(pnlRes.body);
    const bs = JSON.parse(bsRes.body);
    const stock = JSON.parse(stockRes.body);

    expect(pnl.directIncome.total).toBe("0.00");
    expect(pnl.costOfGoodsSold).toBe("0.00");
    expect(pnl.grossProfit).toBe("0.00");
    expect(pnl.grossMarginPct).toBe("0.00");
    expect(pnl.closingStockValuation).toBe("1000.00");
    expect(pnl.valuationStatus).toBe("VERIFIED");

    expect(stock.totals.grandStockValuation).toBe("1000.00");
    expect(bs.closingStockValuation).toBe("1000.00");
    expect(bs.isBalanced).toBe(true);
    expect(bs.difference).toBe("0.00");
  });

  it("2. Partial sale with GST, plus Draft & Cancelled invoices excluded", async () => {
    // Valid sale: 4 units @ 150 + 18% GST = 600 taxable + 108 GST = 708
    const inv1 = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: authHeaders(),
      payload: {
        partyId: customerId,
        warehouseId,
        invoiceDate: "2026-04-15",
        items: [{ itemId: goodsItemId, quantity: 4, unitPrice: 150, taxRate: 18 }],
      },
    });
    expect(inv1.statusCode).toBe(201);

    // Draft sale: must NOT affect P&L or Stock
    const draftInv = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: authHeaders(),
      payload: {
        partyId: customerId,
        warehouseId,
        invoiceDate: "2026-04-16",
        isDraft: true,
        items: [{ itemId: goodsItemId, quantity: 2, unitPrice: 150, taxRate: 18 }],
      },
    });
    expect(draftInv.statusCode).toBe(201);

    // Cancelled sale: create and cancel
    const toCancel = JSON.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/invoices/sales",
          headers: authHeaders(),
          payload: {
            partyId: customerId,
            warehouseId,
            invoiceDate: "2026-04-17",
            items: [{ itemId: goodsItemId, quantity: 2, unitPrice: 150, taxRate: 18 }],
          },
        })
      ).body,
    );
    await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${toCancel.id}/cancel`,
      headers: authHeaders(),
      payload: { reason: "Test cancellation" },
    });

    const [pnlRes, bsRes, stockRes] = await Promise.all([
      app.inject({ method: "GET", url: "/api/v1/reports/profit-and-loss?fromDate=2026-04-01&toDate=2026-04-30", headers: authHeaders() }),
      app.inject({ method: "GET", url: "/api/v1/reports/balance-sheet?asOfDate=2026-04-30", headers: authHeaders() }),
      app.inject({ method: "GET", url: "/api/v1/reports/stock-summary?asOfDate=2026-04-30", headers: authHeaders() }),
    ]);

    const pnl = JSON.parse(pnlRes.body);
    const bs = JSON.parse(bsRes.body);
    const stock = JSON.parse(stockRes.body);

    // Net Sales = 600.00 (excludes 108 GST, draft, and cancelled)
    // COGS = 4 * 100 = 400.00
    // Gross Profit = 600 - 400 = 200.00; Margin = (200/600)*100 = 33.33%
    // Closing Stock = 6 * 100 = 600.00
    expect(pnl.directIncome.total).toBe("600.00");
    expect(pnl.costOfGoodsSold).toBe("400.00");
    expect(pnl.grossProfit).toBe("200.00");
    expect(pnl.grossMarginPct).toBe("33.33");
    expect(pnl.closingStockValuation).toBe("600.00");
    expect(stock.totals.grandStockValuation).toBe("600.00");
    expect(bs.closingStockValuation).toBe("600.00");
    expect(bs.isBalanced).toBe(true);
  });

  it("3. Service item sale & genuine negative gross profit in a subsequent period", async () => {
    // In May 2026: sell remaining 6 units below cost @ 50 each (Revenue = 300, Cost = 600 -> Gross Loss = -300)
    const lossInv = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: authHeaders(),
      payload: {
        partyId: customerId,
        warehouseId,
        invoiceDate: "2026-05-10",
        items: [{ itemId: goodsItemId, quantity: 6, unitPrice: 50, taxRate: 18 }],
      },
    });
    expect(lossInv.statusCode).toBe(201);

    const mayPnlRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/profit-and-loss?fromDate=2026-05-01&toDate=2026-05-31",
      headers: authHeaders(),
    });
    const mayPnl = JSON.parse(mayPnlRes.body);

    // May Opening Stock = 600.00, May Purchases = 0.00, May Closing Stock = 0.00 -> COGS = 600.00
    // May Sales = 300.00 -> Gross Profit = -300.00 -> Gross Margin = -100.00%
    expect(mayPnl.openingStockValuation).toBe("600.00");
    expect(mayPnl.closingStockValuation).toBe("0.00");
    expect(mayPnl.costOfGoodsSold).toBe("600.00");
    expect(mayPnl.grossProfit).toBe("-300.00");
    expect(mayPnl.isGrossLoss).toBe(true);
    expect(mayPnl.grossMarginPct).toBe("-100.00");

    // Service item sale in June 2026: Revenue = 500, COGS = 0 -> Gross Profit = 500
    const svcInv = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: authHeaders(),
      payload: {
        partyId: customerId,
        warehouseId,
        invoiceDate: "2026-06-05",
        items: [{ itemId: serviceItemId, quantity: 1, unitPrice: 500, taxRate: 18 }],
      },
    });
    expect(svcInv.statusCode).toBe(201);

    const junPnlRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/profit-and-loss?fromDate=2026-06-01&toDate=2026-06-30",
      headers: authHeaders(),
    });
    const junPnl = JSON.parse(junPnlRes.body);

    expect(junPnl.directIncome.total).toBe("500.00");
    expect(junPnl.costOfGoodsSold).toBe("0.00");
    expect(junPnl.grossProfit).toBe("500.00");
    expect(junPnl.grossMarginPct).toBe("100.00");
  });

  it("4. Negative stock / provisional cost triggers REQUIRES_RECONCILIATION status", async () => {
    // Simulate a provisional / negative stock transaction in July 2026
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          organizationId: orgId,
          companyId,
          warehouseId,
          itemId: goodsItemId,
          transactionType: "SALES_DISPATCH" as any,
          transactionDate: new Date("2026-07-05T10:00:00.000Z"),
          quantity: -3,
          valuationRate: 100,
          totalValuation: 300,
          isProvisionalCost: true,
          costVariance: 0,
          referenceDocType: "SALES_INVOICE",
          referenceDocId: "00000000-0000-0000-0000-000000000001",
        },
      });
    });

    const julPnlRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/profit-and-loss?fromDate=2026-07-01&toDate=2026-07-31",
      headers: authHeaders(),
    });
    const julPnl = JSON.parse(julPnlRes.body);

    expect(julPnl.requiresReconciliation).toBe(true);
    expect(julPnl.valuationStatus).toBe("REQUIRES_RECONCILIATION");
    expect(julPnl.tradingAccount.hasNegativeInventoryWarning).toBe(true);
    expect(julPnl.tradingAccount.hasProvisionalCost).toBe(true);
  });
});
