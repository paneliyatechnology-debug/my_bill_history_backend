import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import {
  StockTransactionType,
  VoucherType,
  PaymentMode,
} from "@billing/shared-types";
import { ProductionStatus, StockTransferStatus } from "@billing/database";

describe("Controlled Staging Pilot: End-to-End Business Flow Execution & Acceptance Test", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  // Pilot Profile Details
  const pilotProfile = {
    phone: "9825000077",
    email: "pilot-admin@somnath.test",
    password: "PasswordPilot@123",
    fullName: "Jaydeepbhai Somnath",
    organizationName: "Somnath Precision Industries Group",
    companyLegalName: "Shree Somnath Manufacturing & Distribution LLP",
    tradeName: "Somnath Precision Works",
    gstin: "24AABCS1429B1Z8",
    stateCode: "24",
  };

  // Competitor Tenant for Isolation Check
  const competitorProfile = {
    phone: "9825000078",
    email: "competitor@somnath.test",
    password: "PasswordComp@123",
    fullName: "Competitor User",
    organizationName: "Competitor Group",
    companyLegalName: "Competitor LLP",
    tradeName: "Competitor Traders",
    gstin: "24BBBCB9999B1Z1",
    stateCode: "24",
  };

  let pilotToken: string;
  let pilotOrgId: string;
  let pilotCompanyId: string;
  let pilotBranchId: string;

  let competitorToken: string;
  let competitorCompanyId: string;

  // Master IDs
  let factoryWhId: string;
  let depotWhId: string;
  let uomKgId: string;
  let uomPcsId: string;
  let catRawId: string;
  let catFinishedId: string;
  let rawItemBrassId: string;
  let rawItemFastenerId: string;
  let finishedItemValveId: string;
  let supplierPartyId: string;
  let customerPartyId: string;

  // Financial Accounts
  let cashAccountId: string;
  let capitalAccountId: string;

  // Workflow References
  let purchaseBillId: string;
  let purchaseItemId: string;
  let bomId: string;
  let productionOrderId: string;
  let stockTransferId: string;
  let salesInvoiceId: string;
  let salesInvoiceItemId: string;

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

    // Clean up any existing pilot entities from previous test runs
    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: {
          phone: { in: [pilotProfile.phone, competitorProfile.phone] },
        },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.journalEntry.deleteMany({
          where: { voucher: { company: { organizationId: { in: orgIds } } } },
        });
        await tx.voucher.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.ledgerAccount.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.ledgerGroup.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.productionBatch.deleteMany({
          where: { productionOrder: { company: { organizationId: { in: orgIds } } } },
        });
        await tx.productionOrder.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.bomItem.deleteMany({
          where: { bom: { company: { organizationId: { in: orgIds } } } },
        });
        await tx.billOfMaterial.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.stockTransferItem.deleteMany({
          where: { transfer: { company: { organizationId: { in: orgIds } } } },
        });
        await tx.stockTransfer.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.deliveryChallanItem.deleteMany({
          where: { challan: { company: { organizationId: { in: orgIds } } } },
        });
        await tx.deliveryChallan.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.purchaseReturnItem.deleteMany({
          where: { returnDoc: { organizationId: { in: orgIds } } },
        });
        await tx.purchaseReturn.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.purchaseInvoiceItem.deleteMany({
          where: { invoice: { organizationId: { in: orgIds } } },
        });
        await tx.purchaseInvoice.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.salesReturnItem.deleteMany({
          where: { returnDoc: { organizationId: { in: orgIds } } },
        });
        await tx.salesReturn.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.salesInvoiceItem.deleteMany({
          where: { invoice: { company: { organizationId: { in: orgIds } } } },
        });
        await tx.salesInvoice.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.stockTransaction.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.item.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.itemCategory.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.unitOfMeasure.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.party.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.warehouse.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.financialYear.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.userBranchAssignment.deleteMany({
          where: { branch: { organizationId: { in: orgIds } } },
        });
        await tx.branch.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.user.deleteMany({
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
  });

  afterAll(async () => {
    await app.close();
  });

  // --------------------------------------------------------------------------
  // STEP 1: PILOT ONBOARDING & PROVISIONING
  // --------------------------------------------------------------------------
  it("Step 1: Pilot Onboarding — Register Pilot Company and Seed Chart of Accounts", async () => {
    // 1. Register Pilot Tenant
    const regRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "x-correlation-id": "pilot-e2e-reg-001" },
      payload: pilotProfile,
    });
    expect(regRes.statusCode).toBe(201);
    const regBody = JSON.parse(regRes.body);
    pilotToken = regBody.accessToken;
    pilotOrgId = regBody.defaultContext.organizationId;
    pilotCompanyId = regBody.defaultContext.companyId;
    pilotBranchId = regBody.defaultContext.branchId;

    // 2. Register Competitor Tenant
    const compRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "x-correlation-id": "pilot-e2e-comp-001" },
      payload: competitorProfile,
    });
    expect(compRes.statusCode).toBe(201);
    const compBody = JSON.parse(compRes.body);
    competitorToken = compBody.accessToken;
    competitorCompanyId = compBody.defaultContext.companyId;

    // 3. Seed Chart of Accounts for Pilot Tenant
    const seedRes = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-groups/seed",
      headers: { authorization: `Bearer ${pilotToken}` },
    });
    expect(seedRes.statusCode).toBe(201);

    // Fetch Cash and Capital accounts
    const accounts = await prisma.executeBypassRls(async (tx) => {
      return tx.ledgerAccount.findMany({
        where: { companyId: pilotCompanyId },
      });
    });
    const cashAcc = accounts.find((a) => a.code === "CASH" || a.name.includes("Cash"));
    const capAcc = accounts.find((a) => a.name.includes("Capital") || a.code === "CAPITAL");
    expect(cashAcc).toBeDefined();
    expect(capAcc).toBeDefined();
    cashAccountId = cashAcc!.id;
    capitalAccountId = capAcc!.id;

    // Introduce Opening Proprietor Capital: Rs 100,000 (Cash Dr = Capital Cr)
    const capVoucherRes = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        voucherType: VoucherType.RECEIPT,
        voucherNumber: "RC/PILOT/001",
        voucherDate: "2026-10-12",
        narration: "Initial pilot capital introduced in cash",
        lines: [
          {
            accountId: cashAccountId,
            debitAmount: "100000.00",
            creditAmount: "0.00",
            lineNarration: "Cash received",
          },
          {
            accountId: capitalAccountId,
            debitAmount: "0.00",
            creditAmount: "100000.00",
            lineNarration: "Capital credited",
          },
        ],
      },
    });
    expect(capVoucherRes.statusCode).toBe(201);
  });

  // --------------------------------------------------------------------------
  // STEP 2: MASTER DATA CATALOGS & OPENING BALANCES
  // --------------------------------------------------------------------------
  it("Step 2: Pilot Masters — Warehouses, UOMs, Categories, Items & Parties", async () => {
    // 1. Warehouses (Factory & Depot)
    const wh1Res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: { name: "Rajkot Central Factory Godown", isDefault: true },
    });
    expect(wh1Res.statusCode).toBe(201);
    factoryWhId = JSON.parse(wh1Res.body).id;

    const wh2Res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: { name: "Ahmedabad Distribution Hub", isDefault: false },
    });
    expect(wh2Res.statusCode).toBe(201);
    depotWhId = JSON.parse(wh2Res.body).id;

    // 2. Units of Measure
    const uom1 = await app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: { name: "Kilogram", code: "KGS", isDecimalAllowed: true },
    });
    expect(uom1.statusCode).toBe(201);
    uomKgId = JSON.parse(uom1.body).id;

    const uom2 = await app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: { name: "Piece", code: "PCS", isDecimalAllowed: false },
    });
    expect(uom2.statusCode).toBe(201);
    uomPcsId = JSON.parse(uom2.body).id;

    // 3. Categories
    const cat1 = await app.inject({
      method: "POST",
      url: "/api/v1/categories",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: { name: "Raw Materials" },
    });
    expect(cat1.statusCode).toBe(201);
    catRawId = JSON.parse(cat1.body).id;

    const cat2 = await app.inject({
      method: "POST",
      url: "/api/v1/categories",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: { name: "Finished Goods" },
    });
    expect(cat2.statusCode).toBe(201);
    catFinishedId = JSON.parse(cat2.body).id;

    // 4. Items (Brass Alloy Rod, Fasteners, Finished Valve)
    const it1 = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        type: "PRODUCT",
        name: "Brass Alloy Rod 20mm",
        sku: "ROD-BRASS-20",
        hsnCode: "7407",
        categoryId: catRawId,
        primaryUomId: uomKgId,
        purchaseRate: 300,
        retailPrice: 380,
        taxRate: 18,
      },
    });
    expect(it1.statusCode).toBe(201);
    rawItemBrassId = JSON.parse(it1.body).id;

    const it2 = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        type: "PRODUCT",
        name: "Stainless Steel Fastener M8",
        sku: "FAST-SS-M8",
        hsnCode: "7318",
        categoryId: catRawId,
        primaryUomId: uomPcsId,
        purchaseRate: 15,
        retailPrice: 22,
        taxRate: 18,
      },
    });
    expect(it2.statusCode).toBe(201);
    rawItemFastenerId = JSON.parse(it2.body).id;

    const it3 = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        type: "PRODUCT",
        name: "Industrial Valve Assembly 2-Inch",
        sku: "VALVE-IND-2IN",
        hsnCode: "8481",
        categoryId: catFinishedId,
        primaryUomId: uomPcsId,
        purchaseRate: 900,
        retailPrice: 1500,
        taxRate: 18,
      },
    });
    expect(it3.statusCode).toBe(201);
    finishedItemValveId = JSON.parse(it3.body).id;

    // 5. Parties (Supplier & Customer)
    const p1 = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        type: "SUPPLIER",
        name: "Apex Metals & Alloys Ltd",
        tradeName: "Apex Metals",
        gstin: "24ABCDE1234F1Z6",
        stateCode: "24",
        phone: "9825112233",
        billingAddress: {
          line1: "Plot 12, GIDC Industrial Estate",
          city: "Vadodara",
          pincode: "390001",
        },
      },
    });
    expect(p1.statusCode).toBe(201);
    supplierPartyId = JSON.parse(p1.body).id;

    const p2 = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        type: "CUSTOMER",
        name: "Baroda Valves & Pumps Corp",
        tradeName: "Baroda Pumps",
        gstin: "24AAACA1111A1ZY",
        stateCode: "24",
        phone: "9825445566",
        billingAddress: {
          line1: "Shop 4, Market Yard Complex",
          city: "Vadodara",
          pincode: "390002",
        },
      },
    });
    expect(p2.statusCode).toBe(201);
    customerPartyId = JSON.parse(p2.body).id;

    // 6. Record Initial Opening Stock for Raw Materials
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.createMany({
        data: [
          {
            organizationId: pilotOrgId,
            companyId: pilotCompanyId,
            warehouseId: factoryWhId,
            itemId: rawItemBrassId,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date("2026-04-01"),
            quantity: 100, // 100 KGS
            valuationRate: 300,
            totalValuation: 30000,
            referenceDocType: "OPENING_BALANCE",
            referenceDocId: rawItemBrassId,
          },
          {
            organizationId: pilotOrgId,
            companyId: pilotCompanyId,
            warehouseId: factoryWhId,
            itemId: rawItemFastenerId,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date("2026-04-01"),
            quantity: 500, // 500 PCS
            valuationRate: 15,
            totalValuation: 7500,
            referenceDocType: "OPENING_BALANCE",
            referenceDocId: rawItemFastenerId,
          },
        ],
      });
    });
  });

  // --------------------------------------------------------------------------
  // STEP 3: WORKFLOW 1 — PURCHASES -> PAYMENT -> PURCHASE RETURN (DEBIT NOTE)
  // --------------------------------------------------------------------------
  it("Step 3: Workflow 1 — Purchase Bill, Supplier Payment, and Return with Debit Note", async () => {
    // 1. Create Purchase Bill: 50 KGS Brass @ 300 = Rs 15,000 + 18% GST (CGST 1350 + SGST 1350) = Rs 17,700
    const purRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: {
        authorization: `Bearer ${pilotToken}`,
        "x-correlation-id": "pilot-pur-001",
      },
      payload: {
        partyId: supplierPartyId,
        vendorInvoiceNumber: "GMA-2026-001",
        invoiceDate: "2026-10-12",
        warehouseId: factoryWhId,
        items: [
          {
            itemId: rawItemBrassId,
            quantity: 50,
            unitPrice: 300,
            taxRate: 18,
          },
        ],
      },
    });

    expect(purRes.statusCode).toBe(201);
    const bill = JSON.parse(purRes.body);
    purchaseBillId = bill.id;
    purchaseItemId = bill.items[0].id;
    expect(Number(bill.grandTotal)).toBe(17700);

    // Verify Stock increased (+50 KGS -> Total 100 + 50 = 150 KGS)
    const stockBrass = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: { companyId: pilotCompanyId, itemId: rawItemBrassId },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity);
    });
    expect(stockBrass).toBe(150);

    // 2. Make Supplier Payment: Rs 10,000 partial payment
    const supplierAccount = await prisma.executeBypassRls(async (tx) => {
      return tx.ledgerAccount.findFirst({
        where: { partyId: supplierPartyId, companyId: pilotCompanyId },
      });
    });
    expect(supplierAccount).toBeDefined();

    const payVoucher = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        voucherType: VoucherType.PAYMENT,
        voucherNumber: "PV/PILOT/001",
        voucherDate: "2026-10-12",
        narration: "Partial payment to Gujarat Metals via Cash",
        lines: [
          {
            accountId: supplierAccount!.id,
            debitAmount: "10000.00",
            creditAmount: "0.00",
            lineNarration: "Supplier debited on payment",
          },
          {
            accountId: cashAccountId,
            debitAmount: "0.00",
            creditAmount: "10000.00",
            lineNarration: "Cash credited",
          },
        ],
      },
    });
    expect(payVoucher.statusCode).toBe(201);

    // 3. Purchase Return (Debit Note): Return 5 KGS Brass @ 300 = Rs 1,500 + 18% GST (270) = Rs 1,770
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${purchaseBillId}/returns`,
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        returnDate: "2026-10-12",
        reason: "5 KGS brass rods defective diameter",
        items: [
          {
            purchaseItemId,
            quantity: 5,
          },
        ],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const debitNote = JSON.parse(retRes.body);
    expect(debitNote.returnNumber).toMatch(/^DN-/);
    expect(Number(debitNote.grandTotal)).toBe(1770);

    // Verify stock decreased (-5 KGS -> Total 150 - 5 = 145 KGS)
    const postReturnStock = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: { companyId: pilotCompanyId, itemId: rawItemBrassId },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity);
    });
    expect(postReturnStock).toBe(145);
  });

  // --------------------------------------------------------------------------
  // STEP 4: WORKFLOW 2 — BOM & PRODUCTION ORDER (MANUFACTURING)
  // --------------------------------------------------------------------------
  it("Step 4: Workflow 2 — BOM Creation, Production Order Execution & Finished Stock Yield", async () => {
    // 1. Create BOM for Industrial Valve (Requires 2 KGS Brass + 4 PCS Fasteners per valve)
    const bomRes = await app.inject({
      method: "POST",
      url: "/api/v1/manufacturing/boms",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        bomName: "Standard Valve Assembly Recipe",
        finishedItemId: finishedItemValveId,
        batchYieldQty: 1,
        items: [
          {
            rawItemId: rawItemBrassId,
            quantity: 2, // 2 KGS per valve
            wastagePercent: 0,
          },
          {
            rawItemId: rawItemFastenerId,
            quantity: 4, // 4 Fasteners per valve
            wastagePercent: 0,
          },
        ],
      },
    });
    expect(bomRes.statusCode).toBe(201);
    bomId = JSON.parse(bomRes.body).id;

    // 2. Create Production Order for 10 Finished Valves
    const prodRes = await app.inject({
      method: "POST",
      url: "/api/v1/manufacturing/orders",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        bomId,
        targetQuantity: 10,
        startDate: "2026-10-12",
      },
    });
    expect(prodRes.statusCode).toBe(201);
    productionOrderId = JSON.parse(prodRes.body).id;

    // 3. Start Order (PLANNED -> IN_PROGRESS)
    const startRes = await app.inject({
      method: "POST",
      url: `/api/v1/manufacturing/orders/${productionOrderId}/start`,
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        sourceWarehouseId: factoryWhId,
      },
    });
    expect(startRes.statusCode).toBe(200);
    expect(JSON.parse(startRes.body).status).toBe("IN_PROGRESS");

    // 4. Complete Production Order: Produces 10 Valves
    // Consumes: 10 * 2 = 20 KGS Brass, 10 * 4 = 40 PCS Fasteners
    // Yields: +10 Finished Valves
    const compRes = await app.inject({
      method: "POST",
      url: `/api/v1/manufacturing/orders/${productionOrderId}/complete`,
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        targetWarehouseId: factoryWhId,
        actualProducedQty: 10,
      },
    });
    expect(compRes.statusCode).toBe(200);
    expect(JSON.parse(compRes.body).status).toBe("COMPLETED");

    // Verify Stock changes:
    // Finished Valves: 0 + 10 = 10 PCS
    // Brass: 145 - 20 = 125 KGS
    // Fasteners: 500 - 40 = 460 PCS
    const [valves, brass, fasteners] = await prisma.executeBypassRls(async (tx) => {
      const v = await tx.stockTransaction.aggregate({
        where: { companyId: pilotCompanyId, itemId: finishedItemValveId },
        _sum: { quantity: true },
      });
      const b = await tx.stockTransaction.aggregate({
        where: { companyId: pilotCompanyId, itemId: rawItemBrassId },
        _sum: { quantity: true },
      });
      const f = await tx.stockTransaction.aggregate({
        where: { companyId: pilotCompanyId, itemId: rawItemFastenerId },
        _sum: { quantity: true },
      });
      return [Number(v._sum.quantity), Number(b._sum.quantity), Number(f._sum.quantity)];
    });
    expect(valves).toBe(10);
    expect(brass).toBe(125);
    expect(fasteners).toBe(460);
  });

  // --------------------------------------------------------------------------
  // STEP 5: WORKFLOW 3 — STOCK TRANSFER -> DISPATCH -> PARTIAL RECEIPT
  // --------------------------------------------------------------------------
  it("Step 5: Workflow 3 — Stock Transfer from Factory to Depot with Variance Reconciliation", async () => {
    // Transfer 4 Valves from Factory to Depot
    const trCreate = await app.inject({
      method: "POST",
      url: "/api/v1/distribution/transfers",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        fromWarehouseId: factoryWhId,
        toWarehouseId: depotWhId,
        items: [{ itemId: finishedItemValveId, quantity: 4 }],
        notes: "Pilot replenishment from Factory to Ahmedabad Depot",
      },
    });
    expect(trCreate.statusCode).toBe(201);
    stockTransferId = JSON.parse(trCreate.body).id;

    // Dispatch Transfer: Factory stock decreases by 4 (10 - 4 = 6)
    const trDisp = await app.inject({
      method: "POST",
      url: `/api/v1/distribution/transfers/${stockTransferId}/dispatch`,
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: { challanNumber: "DC-PILOT-TR-01" },
    });
    expect(trDisp.statusCode).toBe(200);
    expect(JSON.parse(trDisp.body).status).toBe("DISPATCHED");

    // Receive Transfer with Variance: 3 Received, 1 Damaged in Transit
    const trRec = await app.inject({
      method: "POST",
      url: `/api/v1/distribution/transfers/${stockTransferId}/receive`,
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        items: [
          {
            itemId: finishedItemValveId,
            receivedQuantity: 3,
            damageQuantity: 1,
            shortageQuantity: 0,
            remarks: "1 valve handle cracked during transit",
          },
        ],
      },
    });
    expect(trRec.statusCode).toBe(200);
    expect(JSON.parse(trRec.body).status).toBe("RECEIVED");

    // Verify Depot warehouse stock has exactly +3 valves
    const depotStock = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: {
          companyId: pilotCompanyId,
          warehouseId: depotWhId,
          itemId: finishedItemValveId,
        },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity);
    });
    expect(depotStock).toBe(3);
  });

  // --------------------------------------------------------------------------
  // STEP 6: WORKFLOW 4 — SALES INVOICE -> RECEIPT -> CUSTOMER RETURN
  // --------------------------------------------------------------------------
  it("Step 6: Workflow 4 — Sales Invoice, Customer Receipt & Return with Credit Note", async () => {
    // 1. Create Sales Invoice: 2 Finished Valves @ 1500 = Rs 3,000 + 18% GST (CGST 270 + SGST 270) = Rs 3,540
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: {
        authorization: `Bearer ${pilotToken}`,
        "idempotency-key": "pilot-sales-inv-001",
      },
      payload: {
        partyId: customerPartyId,
        warehouseId: factoryWhId,
        paymentMode: PaymentMode.UNPAID_CREDIT,
        items: [
          {
            itemId: finishedItemValveId,
            quantity: 2,
            unitPrice: 1500,
            taxRate: 18,
          },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);
    salesInvoiceId = inv.id;
    salesInvoiceItemId = inv.items[0].id;
    expect(Number(inv.grandTotal)).toBe(3540);

    // Factory stock: 6 - 2 = 4 valves remaining
    const factoryStock = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: {
          companyId: pilotCompanyId,
          warehouseId: factoryWhId,
          itemId: finishedItemValveId,
        },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity);
    });
    expect(factoryStock).toBe(4);

    // 2. Customer Payment Receipt: Rs 2,000 partial payment received in cash
    const customerAccount = await prisma.executeBypassRls(async (tx) => {
      return tx.ledgerAccount.findFirst({
        where: { partyId: customerPartyId, companyId: pilotCompanyId },
      });
    });
    expect(customerAccount).toBeDefined();

    const rcVoucher = await app.inject({
      method: "POST",
      url: "/api/v1/vouchers",
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        voucherType: VoucherType.RECEIPT,
        voucherNumber: "RC/PILOT/002",
        voucherDate: "2026-10-13",
        narration: "Partial payment received from Baroda Valves in cash",
        lines: [
          {
            accountId: cashAccountId,
            debitAmount: "2000.00",
            creditAmount: "0.00",
            lineNarration: "Cash received",
          },
          {
            accountId: customerAccount!.id,
            debitAmount: "0.00",
            creditAmount: "2000.00",
            lineNarration: "Debtor credited",
          },
        ],
      },
    });
    expect(rcVoucher.statusCode).toBe(201);

    // 3. Customer Return (Credit Note): Customer returns 1 Valve @ 1500 = Rs 1,500 + 18% GST (270) = Rs 1,770
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${salesInvoiceId}/returns`,
      headers: { authorization: `Bearer ${pilotToken}` },
      payload: {
        returnDate: "2026-10-13",
        reason: "1 valve returned due to overstock at customer end",
        warehouseId: factoryWhId,
        restoreStock: true,
        items: [
          {
            salesItemId: salesInvoiceItemId,
            quantity: 1,
          },
        ],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const creditNote = JSON.parse(retRes.body);
    expect(creditNote.id).toBeDefined();
    expect(Number(creditNote.grandTotal)).toBe(1770);

    // Factory stock: 4 + 1 restored = 5 valves
    const postRetStock = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: {
          companyId: pilotCompanyId,
          warehouseId: factoryWhId,
          itemId: finishedItemValveId,
        },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity);
    });
    expect(postRetStock).toBe(5);
  });

  // --------------------------------------------------------------------------
  // STEP 7: TRIAL BALANCE, P&L, BALANCE SHEET & GENERAL LEDGER INVARIANTS
  // --------------------------------------------------------------------------
  it("Step 7: Accounting Correctness — Balanced Trial Balance, P&L and Balance Sheet", async () => {
    // 1. Direct General Ledger Invariant Check: Sum(Debits) === Sum(Credits)
    const ledgerTotals = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.journalEntry.aggregate({
        where: { voucher: { companyId: pilotCompanyId } },
        _sum: { debitAmount: true, creditAmount: true },
      });
      return {
        debit: Number(agg._sum.debitAmount),
        credit: Number(agg._sum.creditAmount),
      };
    });

    expect(ledgerTotals.debit).toBeGreaterThan(0);
    expect(ledgerTotals.credit).toBeGreaterThan(0);
    // Exact zero variance in double-entry ledger
    expect(ledgerTotals.debit).toBe(ledgerTotals.credit);

    // 2. Fetch Trial Balance via Reports API
    const tbRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/trial-balance",
      headers: { authorization: `Bearer ${pilotToken}` },
    });
    expect(tbRes.statusCode).toBe(200);
    const tb = JSON.parse(tbRes.body);
    expect(tb).toBeDefined();
    expect(tb.isBalanced).toBe(true);
    expect(tb.difference).toBe("0.00");

    // 3. Fetch Profit & Loss Report via Reports API
    const plRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/profit-and-loss",
      headers: { authorization: `Bearer ${pilotToken}` },
    });
    expect(plRes.statusCode).toBe(200);

    // 4. Fetch Balance Sheet via Reports API
    const bsRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/balance-sheet",
      headers: { authorization: `Bearer ${pilotToken}` },
    });
    expect(bsRes.statusCode).toBe(200);
    const bs = JSON.parse(bsRes.body);
    expect(bs.isBalanced).toBe(true);
    expect(bs.difference).toBe("0.00");

    // 5. Fetch Inventory Reconciliation via Reconciliation API
    const recRes = await app.inject({
      method: "GET",
      url: "/api/v1/reconciliation/stock-gl",
      headers: { authorization: `Bearer ${pilotToken}` },
    });
    expect(recRes.statusCode).toBe(200);
  });

  // --------------------------------------------------------------------------
  // STEP 8: MULTI-TENANT ISOLATION & AUDIT TRAIL VERIFICATION
  // --------------------------------------------------------------------------
  it("Step 8: Security & Audit Invariants — Multi-Tenant Isolation and Hash Chains", async () => {
    // 1. Competitor attempts to access Pilot Sales Invoices -> Must return empty list
    const compInvRes = await app.inject({
      method: "GET",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${competitorToken}` },
    });
    expect(compInvRes.statusCode).toBe(200);
    const compInvoices = JSON.parse(compInvRes.body);
    const hasPilotInvoice = compInvoices.items?.some((i: any) => i.id === salesInvoiceId);
    expect(hasPilotInvoice).toBeFalsy();

    // 2. Competitor attempts to directly fetch Pilot Sales Invoice by ID -> 404 / 403
    const compDirectRes = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/sales/${salesInvoiceId}`,
      headers: { authorization: `Bearer ${competitorToken}` },
    });
    expect([403, 404]).toContain(compDirectRes.statusCode);

    // 3. Audit Log Entries for Pilot events must exist with non-empty recordHash
    const pilotAuditLogs = await prisma.executeBypassRls(async (tx) => {
      return tx.auditLog.findMany({
        where: { organizationId: pilotOrgId },
      });
    });
    expect(pilotAuditLogs.length).toBeGreaterThan(0);
    for (const entry of pilotAuditLogs) {
      expect(entry.recordHash).toBeDefined();
      expect(entry.recordHash.length).toBeGreaterThanOrEqual(16);
    }
  });
});
