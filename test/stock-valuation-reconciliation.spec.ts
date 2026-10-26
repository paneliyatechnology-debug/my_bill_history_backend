import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Moving weighted-average stock valuation & party reconciliation", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;
  let tokenA = "";
  let tokenB = "";
  let companyA = "";
  let companyB = "";
  let orgA = "";
  const headersA = () => ({ authorization: `Bearer ${tokenA}` });
  const headersB = () => ({ authorization: `Bearer ${tokenB}` });

  let supplierId = "";
  let customerId = "";
  let bothPartyId = "";
  let warehouseId = "";
  let itemId = "";

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(DatabaseService);

    // Clean test phones
    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: { in: ["9825999081", "9825999082"] } },
        select: { organizationId: true },
      });
      const orgIds = users.map((user) => user.organizationId);
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
      await tx.tenant.deleteMany({ where: { id: { in: orgs.map((org) => org.tenantId) } } });
    });

    const register = async (phone: string, name: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          fullName: name,
          phone,
          password: "Password@123",
          organizationName: `${name} Org`,
          tradeName: name,
          stateCode: "24",
        },
      });
      expect(response.statusCode).toBe(201);
      return JSON.parse(response.body);
    };

    const companyResA = await register("9825999081", "Stock Valuation Co");
    tokenA = companyResA.accessToken;
    companyA = companyResA.defaultContext.companyId;
    orgA = companyResA.defaultContext.organizationId;

    const companyResB = await register("9825999082", "Rival Stock Co");
    tokenB = companyResB.accessToken;
    companyB = companyResB.defaultContext.companyId;

    // Seed ledger groups
    expect((await app.inject({ method: "POST", url: "/api/v1/ledger-groups/seed", headers: headersA() })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/v1/ledger-groups/seed", headers: headersB() })).statusCode).toBe(201);

    // Warehouse
    const wh = JSON.parse((await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: headersA(),
      payload: { name: "Valuation Godown", isDefault: true },
    })).body);
    warehouseId = wh.id;

    // Unit
    const uom = JSON.parse((await app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers: headersA(),
      payload: { name: "Kilogram", code: "KG", isDecimalAllowed: true },
    })).body);

    // Supplier
    const suppRes = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: headersA(),
      payload: {
        type: "SUPPLIER",
        name: "Grain Wholesaler",
        phone: "9825999083",
        gstin: "24ABCDE1234F1Z6",
        stateCode: "24",
        billingAddress: { line1: "APMC Market", city: "Ahmedabad", pincode: "380001" },
      },
    });
    expect(suppRes.statusCode).toBe(201);
    const supp = JSON.parse(suppRes.body);
    supplierId = supp.id;

    // Customer
    const cust = JSON.parse((await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: headersA(),
      payload: {
        type: "CUSTOMER",
        name: "Retail Grocery",
        phone: "9825999084",
        stateCode: "24",
        billingAddress: { line1: "Shop 12", city: "Ahmedabad", pincode: "380002" },
      },
    })).body);
    customerId = cust.id;

    // Both (Customer & Supplier)
    const both = JSON.parse((await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: headersA(),
      payload: {
        type: "BOTH",
        name: "Universal Trader",
        phone: "9825999085",
        stateCode: "24",
        billingAddress: { line1: "Main Road", city: "Ahmedabad", pincode: "380003" },
      },
    })).body);
    bothPartyId = both.id;

    // Item: Basmati Rice with minStockLevel = 10
    const it = JSON.parse((await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: headersA(),
      payload: {
        type: "PRODUCT",
        name: "Basmati Rice Premium",
        sku: "RICE-BASMATI",
        hsnCode: "1006",
        primaryUomId: uom.id,
        purchaseRate: 100,
        retailPrice: 150,
        taxRate: 0,
        minStockLevel: 10,
      },
    })).body);
    itemId = it.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("calculates moving weighted-average cost: Buy 10 @ ₹100, Buy 10 @ ₹120, Sell 15 -> 5 @ ₹550", async () => {
    // 1. Buy 10 @ ₹100 (Vendor bill 1)
    const bill1Res = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: headersA(),
      payload: {
        partyId: supplierId,
        vendorInvoiceNumber: "BILL-WAC-1",
        invoiceDate: "2026-10-01",
        warehouseId,
        items: [{ itemId, quantity: 10, unitPrice: 100, taxRate: 0 }],
      },
    });
    if (bill1Res.statusCode !== 201) console.log("BILL1 ERROR:", bill1Res.body);
    expect(bill1Res.statusCode).toBe(201);

    // Check stock summary after Bill 1: 10 @ ₹100 = ₹1,000
    let summaryRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/stock-summary",
      headers: headersA(),
    });
    expect(summaryRes.statusCode).toBe(200);
    let summaryData = JSON.parse(summaryRes.body);
    let riceRow = summaryData.items.find((i: any) => i.itemId === itemId);
    expect(Number(riceRow.currentStockQuantity)).toBe(10);
    expect(Number(riceRow.totalValuation)).toBe(1000);
    expect(summaryData.totals.costingMethod).toBe("MOVING_AVERAGE");

    // 2. Buy 10 @ ₹120 (Vendor bill 2)
    const bill2Res = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: headersA(),
      payload: {
        partyId: supplierId,
        vendorInvoiceNumber: "BILL-WAC-2",
        invoiceDate: "2026-10-02",
        warehouseId,
        items: [{ itemId, quantity: 10, unitPrice: 120, taxRate: 0 }],
      },
    });
    expect(bill2Res.statusCode).toBe(201);
    const bill2 = JSON.parse(bill2Res.body);

    // Check stock summary after Bill 2: 20 total, value = 1000 + 1200 = ₹2,200 (WAC = 2200 / 20 = ₹110)
    summaryRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/stock-summary",
      headers: headersA(),
    });
    summaryData = JSON.parse(summaryRes.body);
    riceRow = summaryData.items.find((i: any) => i.itemId === itemId);
    expect(Number(riceRow.currentStockQuantity)).toBe(20);
    expect(Number(riceRow.totalValuation)).toBe(2200);

    // 3. Sell 15 to Customer (Sales Invoice)
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: headersA(),
      payload: {
        partyId: customerId,
        invoiceDate: "2026-10-03",
        warehouseId,
        items: [{ itemId, quantity: 15, unitPrice: 150, taxRate: 0 }],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const salesInv = JSON.parse(invRes.body);

    // The sales dispatch must take 15 @ ₹110 = ₹1,650
    // Remaining stock must be exactly: 20 - 15 = 5 units, and valuation = 2200 - 1650 = ₹550
    summaryRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/stock-summary",
      headers: headersA(),
    });
    summaryData = JSON.parse(summaryRes.body);
    riceRow = summaryData.items.find((i: any) => i.itemId === itemId);
    expect(Number(riceRow.currentStockQuantity)).toBe(5);
    expect(Number(riceRow.totalValuation)).toBe(550);
    expect(riceRow.isLowStock).toBe(true); // 5 <= minStockLevel 10

    // 4. Sales Return of 2 units from the customer
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${salesInv.id}/returns`,
      headers: headersA(),
      payload: {
        returnDate: "2026-10-04",
        warehouseId,
        reason: "Customer returned 2 bags",
        items: [{ salesItemId: salesInv.items[0].id, quantity: 2 }],
      },
    });
    expect(retRes.statusCode).toBe(201);

    // Sales return must restore the stock at the ORIGINAL cost of sales (₹110), NOT selling price (₹150)!
    // New quantity = 5 + 2 = 7 units
    // New valuation = 550 + (2 × 110) = 550 + 220 = ₹770
    summaryRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/stock-summary",
      headers: headersA(),
    });
    summaryData = JSON.parse(summaryRes.body);
    riceRow = summaryData.items.find((i: any) => i.itemId === itemId);
    expect(Number(riceRow.currentStockQuantity)).toBe(7);
    expect(Number(riceRow.totalValuation)).toBe(770);

    // 5. Purchase Return of 2 units against Bill 2 (which was bought @ ₹120)
    const purchRetRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill2.id}/returns`,
      headers: headersA(),
      payload: {
        returnDate: "2026-10-05",
        warehouseId,
        reason: "Defective bags returned to vendor",
        items: [{ purchaseItemId: bill2.items[0].id, quantity: 2 }],
      },
    });
    expect(purchRetRes.statusCode).toBe(201);

    // Purchase return reverses 2 units at the bill cost (₹120) = ₹240
    // New quantity = 7 - 2 = 5 units
    // New valuation = 770 - 240 = ₹530
    summaryRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/stock-summary",
      headers: headersA(),
    });
    summaryData = JSON.parse(summaryRes.body);
    riceRow = summaryData.items.find((i: any) => i.itemId === itemId);
    expect(Number(riceRow.currentStockQuantity)).toBe(5);
    expect(Number(riceRow.totalValuation)).toBe(530);

    // 6. Tenant B isolation: Tenant B cannot see Tenant A's stock items or movements
    const tenantBSummary = await app.inject({
      method: "GET",
      url: "/api/v1/reports/stock-summary",
      headers: headersB(),
    });
    expect(tenantBSummary.statusCode).toBe(200);
    const bItems = JSON.parse(tenantBSummary.body).items;
    expect(bItems.some((i: any) => i.itemId === itemId)).toBe(false);
  });

  it("reconciles party ledger and outstanding balances with correct Dr/Cr sign convention", async () => {
    // Customer ledger & outstanding check:
    // Customer bought 15 @ ₹150 = ₹2,250
    // Customer returned 2 @ ₹150 = ₹300 credit note
    // Net customer balance should be ₹1,950 DR
    const custOutstandingRes = await app.inject({
      method: "GET",
      url: `/api/v1/reports/outstanding-balances?partyType=CUSTOMER`,
      headers: headersA(),
    });
    expect(custOutstandingRes.statusCode).toBe(200);
    const custOutData = JSON.parse(custOutstandingRes.body);
    const custRow = custOutData.parties.find((p: any) => p.partyId === customerId);
    expect(custRow).toBeDefined();
    expect(Number(custRow.invoiceOutstanding)).toBe(1950);
    expect(Number(custRow.ledgerBalance)).toBe(1950);
    expect(custRow.balanceType).toBe("DR");
    expect(custRow.isReconciled).toBe(true);

    // Check party ledger for Customer agrees with outstanding:
    const custLedgerRes = await app.inject({
      method: "GET",
      url: `/api/v1/reports/party-ledger?partyId=${customerId}`,
      headers: headersA(),
    });
    expect(custLedgerRes.statusCode).toBe(200);
    const custLedgerData = JSON.parse(custLedgerRes.body);
    expect(Number(custLedgerData.closingBalance.amount)).toBe(1950);
    expect(custLedgerData.closingBalance.type).toBe("DR");
    expect(Number(custRow.ledgerBalance)).toBe(Number(custLedgerData.closingBalance.amount));

    // Supplier ledger & outstanding check:
    // Bill 1: 10 @ ₹100 = ₹1,000
    // Bill 2: 10 @ ₹120 = ₹1,200
    // Total bills = ₹2,200
    // Return on Bill 2: 2 @ ₹120 = ₹240 debit note
    // Net supplier payable = ₹2,200 - ₹240 = ₹1,960 CR
    const suppOutstandingRes = await app.inject({
      method: "GET",
      url: `/api/v1/reports/outstanding-balances?partyType=SUPPLIER`,
      headers: headersA(),
    });
    expect(suppOutstandingRes.statusCode).toBe(200);
    const suppOutData = JSON.parse(suppOutstandingRes.body);
    const suppRow = suppOutData.parties.find((p: any) => p.partyId === supplierId);
    expect(suppRow).toBeDefined();
    expect(Number(suppRow.invoiceOutstanding)).toBe(1960);
    expect(Number(suppRow.ledgerBalance)).toBe(1960);
    expect(suppRow.balanceType).toBe("CR");
    expect(suppRow.isReconciled).toBe(true);

    const suppLedgerRes = await app.inject({
      method: "GET",
      url: `/api/v1/reports/party-ledger?partyId=${supplierId}`,
      headers: headersA(),
    });
    expect(suppLedgerRes.statusCode).toBe(200);
    const suppLedgerData = JSON.parse(suppLedgerRes.body);
    expect(Number(suppLedgerData.closingBalance.amount)).toBe(1960);
    expect(suppLedgerData.closingBalance.type).toBe("CR");
    expect(Number(suppRow.ledgerBalance)).toBe(Number(suppLedgerData.closingBalance.amount));

    // Party with no transactions returns clean 0.00 ledger without crashing
    const bothLedgerRes = await app.inject({
      method: "GET",
      url: `/api/v1/reports/party-ledger?partyId=${bothPartyId}`,
      headers: headersA(),
    });
    expect(bothLedgerRes.statusCode).toBe(200);
    const bothLedgerData = JSON.parse(bothLedgerRes.body);
    expect(Number(bothLedgerData.closingBalance.amount)).toBe(0);
    expect(bothLedgerData.transactions).toHaveLength(0);
  });
});
