import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { StockTransactionType, VoucherType } from "@billing/shared-types";
import { Decimal } from "@billing/accounting-core";

describe("Sales Returns & Credit Notes Module Integration", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tokenA: string;
  let tokenB: string;
  let orgAId: string;
  let companyAId: string;
  let companyBId: string;
  let warehouseAId: string;
  let customerAId: string;
  let interstateCustomerAId: string;
  let itemAId: string;
  let customerLedgerAId: string;

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

    // Clean up test data from prior runs
    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: { in: ["9825999030", "9825999031"] } },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (orgIds.length > 0) {
        await tx.salesReturnItem.deleteMany({
          where: { returnDoc: { organizationId: { in: orgIds } } },
        });
        await tx.salesReturn.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.salesInvoiceItem.deleteMany({
          where: { invoice: { organizationId: { in: orgIds } } },
        });
        await tx.salesInvoice.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.stockTransaction.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.journalEntry.deleteMany({
          where: { voucher: { organizationId: { in: orgIds } } },
        });
        await tx.voucher.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.auditLog.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.item.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.unitOfMeasure.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.party.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.warehouse.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.ledgerAccount.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.ledgerGroup.deleteMany({
          where: { organizationId: { in: orgIds } },
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
        await tx.organization.deleteMany({
          where: { id: { in: orgIds } },
        });
        await tx.tenant.deleteMany({
          where: { id: { in: orgs.map((o) => o.tenantId) } },
        });
      }
    });

    // 1. Register Company A (Tenant A) in Gujarat (State Code 24)
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Company A Sales Admin",
        phone: "9825999030",
        email: "companyA@salesreturns.local",
        password: "Password@123",
        organizationName: "Gujarat Steel Trading Co",
        tradeName: "Gujarat Steel",
        stateCode: "24",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const bodyA = JSON.parse(regResA.body);
    tokenA = bodyA.accessToken;
    orgAId = bodyA.defaultContext.organizationId;
    companyAId = bodyA.defaultContext.companyId;

    // Seed Standard Chart of Accounts for Company A
    await app.inject({
      method: "POST",
      url: "/api/v1/ledger-groups/seed",
      headers: { authorization: `Bearer ${tokenA}` },
    });

    // Warehouse for Company A
    const whRes = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: "Main Finished Goods Warehouse",
        isDefault: true,
      },
    });
    expect(whRes.statusCode).toBe(201);
    warehouseAId = JSON.parse(whRes.body).id;

    // UOM for Company A
    const uomRes = await app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: "Metric Tons",
        code: "MT",
        isDecimalAllowed: true,
      },
    });
    expect(uomRes.statusCode).toBe(201);
    const uomId = JSON.parse(uomRes.body).id;

    // Intra-state Customer Party for Company A (Gujarat - 24)
    const partyRes = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: "CUSTOMER",
        name: "Ahmedabad Fabricators LLP",
        phone: "9825999035",
        gstin: "24ABCDE1234F1Z6",
        stateCode: "24",
        billingAddress: {
          line1: "Plot 45, Vatva GIDC",
          city: "Ahmedabad",
          pincode: "382445",
        },
      },
    });
    expect(partyRes.statusCode).toBe(201);
    customerAId = JSON.parse(partyRes.body).id;

    // Inter-state Customer Party for Company A (Maharashtra - 27)
    const interstatePartyRes = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: "CUSTOMER",
        name: "Mumbai Heavy Engineering Ltd",
        phone: "9825999036",
        gstin: "27AABCU9603R1ZN",
        stateCode: "27",
        billingAddress: {
          line1: "Andheri East Industrial Area",
          city: "Mumbai",
          pincode: "400069",
        },
      },
    });
    expect(interstatePartyRes.statusCode).toBe(201);
    interstateCustomerAId = JSON.parse(interstatePartyRes.body).id;

    // Item for Company A
    const itemRes = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: "PRODUCT",
        name: "Structural Steel Beam ISMB 300",
        sku: "STEEL-ISMB-300",
        hsnCode: "7216",
        primaryUomId: uomId,
        purchaseRate: 50000,
        retailPrice: 65000,
        taxRate: 18,
      },
    });
    expect(itemRes.statusCode).toBe(201);
    itemAId = JSON.parse(itemRes.body).id;

    // Initial stock injection (10 MT in warehouse)
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          organizationId: orgAId,
          companyId: companyAId,
          warehouseId: warehouseAId,
          itemId: itemAId,
          transactionType: StockTransactionType.OPENING,
          transactionDate: new Date(),
          quantity: 10,
          valuationRate: 50000,
          totalValuation: 500000,
          referenceDocType: "OPENING_BALANCE",
          referenceDocId: itemAId,
        },
      });
    });

    // 2. Register Company B (Tenant B) for tenant isolation verification
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Company B Sales Admin",
        phone: "9825999031",
        email: "companyB@salesreturns.local",
        password: "Password@123",
        organizationName: "Baroda Chemical Industries",
        tradeName: "Baroda Chemicals",
        stateCode: "24",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const bodyB = JSON.parse(regResB.body);
    tokenB = bodyB.accessToken;
    companyBId = bodyB.defaultContext.companyId;
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. Successfully creates partial sales return, restores inventory, and creates balanced credit note voucher", async () => {
    // Step 1: Create an issued sales invoice for Customer A
    // 2 MT @ 65,000 = 130,000 taxable + 18% GST (CGST 11,700 + SGST 11,700) = 153,400 Grand Total
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          {
            itemId: itemAId,
            quantity: 2,
            unitPrice: 65000,
            taxRate: 18,
          },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);
    expect(inv.id).toBeDefined();
    const salesItemId = inv.items[0].id;

    // Verify initial invoice balances
    expect(Number(inv.grandTotal)).toBe(153400);
    expect(Number(inv.balanceAmount)).toBe(153400);

    // Initial stock check: 10 opening - 2 dispatched = 8 MT on hand
    const initialStock = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: { companyId: companyAId, itemId: itemAId },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity);
    });
    expect(initialStock).toBe(8);

    // Step 2: Post partial sales return (0.5 MT)
    // 0.5 MT @ 65,000 = 32,500 taxable + 18% GST (CGST 2,925 + SGST 2,925) = 38,350 Grand Total Credit
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        returnDate: "2026-10-12",
        reason: "Customer rejected 0.5 MT due to slight dimension variance",
        reasonGujarati: "માપમાં ફેરફાર હોવાથી ૦.૫ ટન પરત મળ્યો",
        warehouseId: warehouseAId,
        restoreStock: true,
        items: [
          {
            salesItemId: salesItemId,
            quantity: 0.5,
          },
        ],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const salesReturn = JSON.parse(retRes.body);

    expect(salesReturn.id).toBeDefined();
    expect(salesReturn.returnNumber).toMatch(/^CN-2026-\d{4}$/);
    expect(salesReturn.status).toBe("ISSUED");
    expect(Number(salesReturn.taxableAmount)).toBe(32500);
    expect(Number(salesReturn.cgstAmount)).toBe(2925);
    expect(Number(salesReturn.sgstAmount)).toBe(2925);
    expect(Number(salesReturn.igstAmount)).toBe(0);
    expect(Number(salesReturn.grandTotal)).toBe(38350);

    // Step 3: Verify Stock Transaction was created with positive quantity (restoration)
    const stockTx = await prisma.executeBypassRls(async (tx) => {
      return tx.stockTransaction.findFirst({
        where: {
          referenceDocType: "SALES_RETURN",
          referenceDocId: salesReturn.id,
        },
      });
    });
    expect(stockTx).toBeDefined();
    expect(stockTx?.transactionType).toBe(StockTransactionType.SALES_RETURN);
    expect(Number(stockTx?.quantity)).toBe(0.5);

    // Cumulative stock on hand should now be 8 + 0.5 = 8.5 MT
    const updatedStock = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: { companyId: companyAId, itemId: itemAId },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity);
    });
    expect(updatedStock).toBe(8.5);

    // Step 4: Verify Balanced Credit Note Voucher
    expect(salesReturn.voucherId).toBeDefined();
    const voucher = await prisma.executeBypassRls(async (tx) => {
      return tx.voucher.findUnique({
        where: { id: salesReturn.voucherId },
        include: { journalEntries: { include: { account: true } } },
      });
    });
    expect(voucher).toBeDefined();
    expect(voucher?.voucherType).toBe(VoucherType.CREDIT_NOTE);
    expect(Number(voucher?.totalAmount)).toBe(38350);

    // Check Journal Entries: Debits must exactly equal Credits
    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);
    for (const je of voucher!.journalEntries) {
      totalDebit = totalDebit.plus(new Decimal(je.debitAmount.toString()));
      totalCredit = totalCredit.plus(new Decimal(je.creditAmount.toString()));
    }
    expect(totalDebit.toNumber()).toBe(38350);
    expect(totalCredit.toNumber()).toBe(38350);
    expect(totalDebit.equals(totalCredit)).toBe(true);

    // Verify Sales Invoice balance reconciled: 153,400 - 38,350 = 115,050
    const refreshedInv = await prisma.executeBypassRls(async (tx) => {
      return tx.salesInvoice.findUnique({ where: { id: inv.id } });
    });
    expect(Number(refreshedInv?.balanceAmount)).toBe(115050);
  });

  it("2. Multiple partial returns against single invoice strictly enforces remaining returnable quantity limit", async () => {
    // Step 1: Create an invoice for 1 MT
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [
          {
            itemId: itemAId,
            quantity: 1.0,
            unitPrice: 65000,
            taxRate: 18,
          },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);
    const lineId = inv.items[0].id;

    // Step 2: First return of 0.4 MT (available remaining: 0.6 MT)
    const ret1 = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        items: [{ salesItemId: lineId, quantity: 0.4 }],
      },
    });
    expect(ret1.statusCode).toBe(201);

    // Step 3: Second return of 0.6 MT (available remaining: 0.0 MT)
    const ret2 = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        items: [{ salesItemId: lineId, quantity: 0.6 }],
      },
    });
    expect(ret2.statusCode).toBe(201);

    // Step 4: Third return attempt of 0.1 MT must be rejected
    const ret3 = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        items: [{ salesItemId: lineId, quantity: 0.1 }],
      },
    });
    expect(ret3.statusCode).toBe(400);
    expect(JSON.parse(ret3.body).message).toMatch(
      /already been fully returned|exceeds remaining/i,
    );
  });

  it("3. Rejects return quantity exceeding original invoice quantity immediately", async () => {
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [
          {
            itemId: itemAId,
            quantity: 1.0,
            unitPrice: 65000,
            taxRate: 18,
          },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);
    const lineId = inv.items[0].id;

    const overRet = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        items: [{ salesItemId: lineId, quantity: 1.5 }],
      },
    });
    expect(overRet.statusCode).toBe(400);
    expect(JSON.parse(overRet.body).message).toMatch(
      /exceeds remaining returnable quantity/i,
    );
  });

  it("4. Correctly reverses Inter-State IGST for out-of-state customer returns", async () => {
    // Interstate sales invoice to Mumbai customer (Place of supply 27, company 24)
    // 1 MT @ 65,000 = 65,000 taxable + 18% IGST (11,700) = 76,700 Grand Total
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: interstateCustomerAId,
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [
          {
            itemId: itemAId,
            quantity: 1.0,
            unitPrice: 65000,
            taxRate: 18,
          },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);
    const lineId = inv.items[0].id;

    // Issue return for 1 MT
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        items: [{ salesItemId: lineId, quantity: 1.0 }],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const ret = JSON.parse(retRes.body);

    // Verify IGST breakdown
    expect(Number(ret.taxableAmount)).toBe(65000);
    expect(Number(ret.cgstAmount)).toBe(0);
    expect(Number(ret.sgstAmount)).toBe(0);
    expect(Number(ret.igstAmount)).toBe(11700);
    expect(Number(ret.grandTotal)).toBe(76700);

    // Verify Voucher has Output IGST reversal line and is balanced
    const voucher = await prisma.executeBypassRls(async (tx) => {
      return tx.voucher.findUnique({
        where: { id: ret.voucherId },
        include: { journalEntries: { include: { account: true } } },
      });
    });
    expect(voucher).toBeDefined();

    const igstEntry = voucher?.journalEntries.find(
      (e) => e.account.name.includes("IGST") || e.account.code === "2130",
    );
    expect(igstEntry).toBeDefined();
    expect(Number(igstEntry?.debitAmount)).toBe(11700);
  });

  it("5. Supports non-restocking disposition for damaged goods without creating stock transaction", async () => {
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [
          {
            itemId: itemAId,
            quantity: 1.0,
            unitPrice: 65000,
            taxRate: 18,
          },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);
    const lineId = inv.items[0].id;

    const initialStockCount = await prisma.executeBypassRls(async (tx) => {
      return tx.stockTransaction.count({ where: { companyId: companyAId } });
    });

    // Return with disposition: "DAMAGED"
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        items: [
          {
            salesItemId: lineId,
            quantity: 1.0,
            disposition: "DAMAGED",
          },
        ],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const ret = JSON.parse(retRes.body);

    // Verify Credit Note and voucher created
    expect(ret.voucherId).toBeDefined();

    // Verify NO stock transaction was created for this return
    const postStockCount = await prisma.executeBypassRls(async (tx) => {
      return tx.stockTransaction.count({
        where: {
          referenceDocType: "SALES_RETURN",
          referenceDocId: ret.id,
        },
      });
    });
    expect(postStockCount).toBe(0);
  });

  it("6. Concurrency safe: prevents concurrent over-return via transactional advisory lock", async () => {
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [
          {
            itemId: itemAId,
            quantity: 1.0,
            unitPrice: 65000,
            taxRate: 18,
          },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);
    const lineId = inv.items[0].id;

    // Send two concurrent requests to return the entire 1.0 MT
    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${inv.id}/returns`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { items: [{ salesItemId: lineId, quantity: 1.0 }] },
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${inv.id}/returns`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: { items: [{ salesItemId: lineId, quantity: 1.0 }] },
      }),
    ]);

    // Exactly one should succeed (201) and one should be rejected (400)
    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([201, 400]);
  });

  it("7. Multi-tenant isolation: Tenant B cannot access or return against Tenant A's invoice", async () => {
    // Create invoice in Tenant A
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [
          {
            itemId: itemAId,
            quantity: 1.0,
            unitPrice: 65000,
            taxRate: 18,
          },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);
    const lineId = inv.items[0].id;

    // Tenant B attempts to create return against Tenant A's invoice
    const breachAttempt = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        items: [{ salesItemId: lineId, quantity: 0.5 }],
      },
    });
    expect(breachAttempt.statusCode).toBe(404);

    // Tenant A creates a return
    const validReturnRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        items: [{ salesItemId: lineId, quantity: 0.5 }],
      },
    });
    expect(validReturnRes.statusCode).toBe(201);
    const validReturn = JSON.parse(validReturnRes.body);

    // Tenant B attempts to fetch Tenant A's return by ID
    const breachGet = await app.inject({
      method: "GET",
      url: `/api/v1/sales-returns/${validReturn.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(breachGet.statusCode).toBe(404);

    // Tenant B lists sales returns; should receive empty data
    const breachList = await app.inject({
      method: "GET",
      url: "/api/v1/sales-returns",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(breachList.statusCode).toBe(200);
    const listData = JSON.parse(breachList.body);
    expect(listData.total).toBe(0);
    expect(listData.data).toHaveLength(0);
  });

  it("8. Rejects invalid returns: empty items, zero quantity, and negative quantities", async () => {
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [
          { itemId: itemAId, quantity: 1.0, unitPrice: 65000, taxRate: 18 },
        ],
      },
    });
    const inv = JSON.parse(invRes.body);

    // Empty items
    const res1 = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { items: [] },
    });
    expect(res1.statusCode).toBe(400);

    // Zero quantity
    const res2 = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { items: [{ salesItemId: inv.items[0].id, quantity: 0 }] },
    });
    expect(res2.statusCode).toBe(400);

    // Negative quantity
    const res3 = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { items: [{ salesItemId: inv.items[0].id, quantity: -1 }] },
    });
    expect(res3.statusCode).toBe(400);
  });

  it("9. Keeps a customer credit when a return exceeds the unpaid invoice balance", async () => {
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        paymentMode: "CASH",
        items: [
          { itemId: itemAId, quantity: 1, unitPrice: 1000, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);
    expect(Number(inv.balanceAmount)).toBe(0);

    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        returnDate: "2026-10-12",
        reason: "Cash sale returned in full after collection",
        warehouseId: warehouseAId,
        restoreStock: true,
        items: [{ salesItemId: inv.items[0].id, quantity: 1 }],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const credit = JSON.parse(retRes.body);
    const refreshed = await prisma.executeBypassRls((tx) =>
      tx.salesInvoice.findUnique({ where: { id: inv.id } }),
    );
    expect(Number(refreshed?.balanceAmount)).toBe(-Number(credit.grandTotal));
    expect(Number(credit.grandTotal)).toBeGreaterThan(0);
  });

  it("10. Deleting a sales return cleanly cascades: restores invoice balance, deletes stock transaction, reverses accounting voucher and ledger balance", async () => {
    // 1. Create credit sales invoice
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 2, unitPrice: 1000, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);
    const originalBal = Number(inv.balanceAmount);

    // 2. Create sales return for 1 unit
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        returnDate: "2026-10-12",
        reason: "Defective piece returned",
        warehouseId: warehouseAId,
        restoreStock: true,
        items: [{ salesItemId: inv.items[0].id, quantity: 1 }],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const retData = JSON.parse(retRes.body);

    // 3. Delete the sales return
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/sales-returns/${retData.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(delRes.statusCode).toBe(200);

    // 4. Verification: Return does not exist
    const fetchReturn = await app.inject({
      method: "GET",
      url: `/api/v1/sales-returns/${retData.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(fetchReturn.statusCode).toBe(404);

    // 5. Verification: Invoice balance restored
    const refreshedInv = await prisma.executeBypassRls((tx) =>
      tx.salesInvoice.findUnique({ where: { id: inv.id } }),
    );
    expect(Number(refreshedInv?.balanceAmount)).toBe(originalBal);

    // 6. Verification: Associated return voucher & stock transaction removed
    const orphanStock = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.findMany({
        where: { referenceDocType: "SALES_RETURN", referenceDocId: retData.id },
      }),
    );
    expect(orphanStock).toHaveLength(0);

    const orphanVoucher = await prisma.executeBypassRls((tx) =>
      tx.voucher.findMany({
        where: { sourceDocument: "SALES_RETURN", sourceEntityId: retData.id },
      }),
    );
    expect(orphanVoucher).toHaveLength(0);
  });

  it("11. Deleting a sales invoice cleanly cascades all linked returns, vouchers, stock movements, and items", async () => {
    // 1. Create invoice with return
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 3, unitPrice: 1000, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);

    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${inv.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        returnDate: "2026-10-12",
        reason: "Customer changed mind",
        warehouseId: warehouseAId,
        restoreStock: true,
        items: [{ salesItemId: inv.items[0].id, quantity: 1 }],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const retData = JSON.parse(retRes.body);

    // 2. Delete the sales invoice
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/invoices/sales/${inv.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(delRes.statusCode).toBe(200);

    // 3. Verify invoice is deleted
    const checkInv = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/sales/${inv.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(checkInv.statusCode).toBe(404);

    // 4. Verify linked return is deleted
    const checkRet = await app.inject({
      method: "GET",
      url: `/api/v1/sales-returns/${retData.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(checkRet.statusCode).toBe(404);

    // 5. Verify no orphan vouchers remain for invoice or return
    const orphanVouchers = await prisma.executeBypassRls((tx) =>
      tx.voucher.findMany({
        where: {
          OR: [
            { sourceEntityId: inv.id },
            { sourceEntityId: retData.id },
          ],
        },
      }),
    );
    expect(orphanVouchers).toHaveLength(0);

    // 6. Verify no orphan stock transactions remain
    const orphanStock = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.findMany({
        where: {
          OR: [
            { referenceDocId: inv.id },
            { referenceDocId: retData.id },
          ],
        },
      }),
    );
    expect(orphanStock).toHaveLength(0);
  });

  it("12. Successfully creates an Amount-Based Credit Note (flat monetary adjustment without item lines)", async () => {
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          organizationId: orgAId,
          companyId: companyAId,
          warehouseId: warehouseAId,
          itemId: itemAId,
          transactionType: StockTransactionType.OPENING,
          transactionDate: new Date(),
          quantity: 20,
          valuationRate: 50000,
          totalValuation: 1000000,
          referenceDocType: "OPENING_BALANCE",
          referenceDocId: itemAId,
        },
      });
    });

    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-14",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 5, unitPrice: 1000, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);

    const cnRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: inv.id,
        docType: "CREDIT_NOTE",
        creditNoteType: "AMOUNT_BASED",
        gstCategory: "SECTION_34",
        amount: 500,
        taxRate: 18,
        reason: "Annual volume rebate",
      },
    });
    expect(cnRes.statusCode).toBe(201);
    const cn = JSON.parse(cnRes.body);
    expect(cn.docType).toBe("CREDIT_NOTE");
    expect(cn.creditNoteType).toBe("AMOUNT_BASED");
    expect(Number(cn.taxableAmount)).toBe(500);
    expect(Number(cn.grandTotal)).toBe(590); // 500 + 18% GST (90)
    expect(cn.voucherId).toBeDefined();

    // Verify ZERO stock transactions were created
    const stockMovements = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.findMany({
        where: { referenceDocId: cn.id },
      }),
    );
    expect(stockMovements).toHaveLength(0);
  });

  it("13. Successfully creates a Commercial Credit Note (without GST reversal, debits commercial discount)", async () => {
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-15",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 2, unitPrice: 2000, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);

    const cnRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: inv.id,
        docType: "CREDIT_NOTE",
        creditNoteType: "AMOUNT_BASED",
        gstCategory: "COMMERCIAL",
        amount: 800,
        reason: "Special commercial compensation",
      },
    });
    expect(cnRes.statusCode).toBe(201);
    const cn = JSON.parse(cnRes.body);
    expect(cn.gstCategory).toBe("COMMERCIAL");
    expect(Number(cn.cgstAmount)).toBe(0);
    expect(Number(cn.sgstAmount)).toBe(0);
    expect(Number(cn.igstAmount)).toBe(0);
    expect(Number(cn.grandTotal)).toBe(800);

    // Verify voucher has Commercial Discounts debit line
    const voucher = await prisma.executeBypassRls((tx) =>
      tx.voucher.findUnique({
        where: { id: cn.voucherId },
        include: { journalEntries: { include: { account: true } } },
      }),
    );
    expect(voucher).toBeDefined();
    const discountLine = voucher?.journalEntries.find((je) =>
      je.account.name.includes("Commercial Discount"),
    );
    expect(discountLine).toBeDefined();
    expect(Number(discountLine?.debitAmount)).toBe(800);
  });

  it("14. 1-Click 'Create Credit Note from Sales Return' links documents and prevents duplicate credits", async () => {
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          organizationId: orgAId,
          companyId: companyAId,
          warehouseId: warehouseAId,
          itemId: itemAId,
          transactionType: StockTransactionType.OPENING,
          transactionDate: new Date(),
          quantity: 20,
          valuationRate: 50000,
          totalValuation: 1000000,
          referenceDocType: "OPENING_BALANCE",
          referenceDocId: itemAId,
        },
      });
    });

    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-16",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 10, unitPrice: 500, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);

    // 1. Create a physical Sales Return
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: inv.id,
        docType: "SALES_RETURN",
        returnDate: "2026-10-16",
        warehouseId: warehouseAId,
        restoreStock: true,
        items: [{ salesItemId: inv.items[0].id, quantity: 2 }],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const ret = JSON.parse(retRes.body);

    // 2. Call 1-click Create Credit Note endpoint
    const linkRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns/${ret.id}/create-credit-note`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(linkRes.statusCode).toBe(201);
    const linkedCn = JSON.parse(linkRes.body);
    expect(linkedCn.docType).toBe("CREDIT_NOTE");
    expect(linkedCn.linkedReturnId).toBe(ret.id);

    // 3. Attempt duplicate creation -> must reject with 400
    const dupRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns/${ret.id}/create-credit-note`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(dupRes.statusCode).toBe(400);
  });

  it("15. Filtering parties by availableForReturnOnly returns only customers with return-eligible invoices", async () => {
    // Customer without invoice
    const emptyPartyRes = await app.inject({
      method: "POST",
      url: `/api/v1/parties`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: "Empty Customer No Invoices",
        phone: "9825999039",
        stateCode: "24",
        type: "CUSTOMER",
        billingAddress: { line1: "Street 1", city: "Surat", pincode: "395006" },
      },
    });
    expect(emptyPartyRes.statusCode).toBe(201);
    const emptyParty = JSON.parse(emptyPartyRes.body);

    // Fetch parties with availableForReturnOnly=true
    const returnEligibleRes = await app.inject({
      method: "GET",
      url: `/api/v1/parties?availableForReturnOnly=true&type=CUSTOMER`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(returnEligibleRes.statusCode).toBe(200);
    const eligibleData = JSON.parse(returnEligibleRes.body);
    const eligibleList = eligibleData.items || eligibleData.data || [];

    // CustomerA has active returnable invoices, so must be included
    expect(eligibleList.some((p: any) => p.id === customerAId)).toBe(true);
    const matchedCustomer = eligibleList.find((p: any) => p.id === customerAId);
    expect(matchedCustomer.returnableInvoicesCount).toBeGreaterThan(0);

    // Empty customer has no invoices, so MUST NOT be included
    expect(eligibleList.some((p: any) => p.id === emptyParty.id)).toBe(false);
  });

  it("16. Accounting Audit Scenario A: Linked Credit Note never duplicates ledger, balance, or stock impacts", async () => {
    // Inject stock
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          organizationId: orgAId,
          companyId: companyAId,
          warehouseId: warehouseAId,
          itemId: itemAId,
          transactionType: StockTransactionType.OPENING,
          transactionDate: new Date(),
          quantity: 20,
          valuationRate: 50000,
          totalValuation: 1000000,
          referenceDocType: "OPENING_BALANCE",
          referenceDocId: itemAId,
        },
      });
    });

    // 1. Create Sales Invoice for 10 units @ 1000 = ₹10,000 + 18% GST (1800) = ₹11,800
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-18",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 10, unitPrice: 1000, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const invoice = JSON.parse(invRes.body);
    expect(Number(invoice.grandTotal)).toBe(11800);
    expect(Number(invoice.balanceAmount)).toBe(11800);

    // Initial stock check
    const stockBefore = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );

    // 2. Issue physical Sales Return for 2 units (2 * 1000 + 18% = ₹2,360)
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "SALES_RETURN",
        returnDate: "2026-10-18",
        warehouseId: warehouseAId,
        restoreStock: true,
        disposition: "SELLABLE",
        items: [{ salesItemId: invoice.items[0].id, quantity: 2 }],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const salesReturn = JSON.parse(retRes.body);
    expect(Number(salesReturn.grandTotal)).toBe(2360);

    // Invoice balance should now be 11,800 - 2,360 = 9,440
    const invAfterRet = await prisma.executeBypassRls((tx) =>
      tx.salesInvoice.findUnique({ where: { id: invoice.id } }),
    );
    expect(Number(invAfterRet?.balanceAmount)).toBe(9440);

    // Stock should have increased by exactly 2
    const stockAfterRet = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(stockAfterRet._sum.quantity)).toBe(
      Number(stockBefore._sum.quantity) + 2,
    );

    // Check customer ledger balance after return
    const custAcc = await prisma.executeBypassRls((tx) =>
      tx.ledgerAccount.findFirst({ where: { partyId: customerAId } }),
    );
    const custBalAfterRet = Number(custAcc?.currentBalance);

    // 3. Issue Linked Credit Note from the Sales Return
    const cnRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns/${salesReturn.id}/create-credit-note`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(cnRes.statusCode).toBe(201);
    const creditNote = JSON.parse(cnRes.body);
    expect(creditNote.docType).toBe("CREDIT_NOTE");
    expect(creditNote.linkedReturnId).toBe(salesReturn.id);

    // VERIFICATION 1: Receivable / invoice balance is NOT reduced twice!
    const invAfterCN = await prisma.executeBypassRls((tx) =>
      tx.salesInvoice.findUnique({ where: { id: invoice.id } }),
    );
    expect(Number(invAfterCN?.balanceAmount)).toBe(9440); // Still 9440, not 7080!

    // VERIFICATION 2: Customer ledger is NOT credited twice!
    const custAccAfterCN = await prisma.executeBypassRls((tx) =>
      tx.ledgerAccount.findFirst({ where: { partyId: customerAId } }),
    );
    expect(Number(custAccAfterCN?.currentBalance)).toBe(custBalAfterRet); // Exactly unchanged!

    // VERIFICATION 3: Stock is NOT increased twice!
    const stockAfterCN = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(stockAfterCN._sum.quantity)).toBe(
      Number(stockAfterRet._sum.quantity),
    ); // No extra stock added!

    // VERIFICATION 4: Shared voucher attached, no duplicate vouchers created
    expect(creditNote.voucherId).toBe(salesReturn.voucherId);
  });

  it("17. Accounting Audit Scenario B: Direct Credit Note without Sales Return causes zero stock movement", async () => {
    // Inject stock
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          organizationId: orgAId,
          companyId: companyAId,
          warehouseId: warehouseAId,
          itemId: itemAId,
          transactionType: StockTransactionType.OPENING,
          transactionDate: new Date(),
          quantity: 20,
          valuationRate: 50000,
          totalValuation: 1000000,
          referenceDocType: "OPENING_BALANCE",
          referenceDocId: itemAId,
        },
      });
    });

    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-18",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 5, unitPrice: 200, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const invoice = JSON.parse(invRes.body);

    const stockBefore = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );

    // Direct Amount-Based Credit Note for commercial turnover incentive of ₹300
    const cnRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "CREDIT_NOTE",
        creditNoteType: "AMOUNT_BASED",
        gstCategory: "COMMERCIAL",
        amount: 300,
        returnDate: "2026-10-18",
        restoreStock: false,
      },
    });
    expect(cnRes.statusCode).toBe(201);
    const cn = JSON.parse(cnRes.body);
    expect(Number(cn.grandTotal)).toBe(300);

    // Verify stock is strictly untouched
    const stockAfter = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(stockAfter._sum.quantity)).toBe(Number(stockBefore._sum.quantity));
  });

  it("18. Stock Audit: Damaged and Scrapped goods do not increase sellable warehouse inventory", async () => {
    // Inject stock
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          organizationId: orgAId,
          companyId: companyAId,
          warehouseId: warehouseAId,
          itemId: itemAId,
          transactionType: StockTransactionType.OPENING,
          transactionDate: new Date(),
          quantity: 20,
          valuationRate: 50000,
          totalValuation: 1000000,
          referenceDocType: "OPENING_BALANCE",
          referenceDocId: itemAId,
        },
      });
    });

    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-18",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 5, unitPrice: 400, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const invoice = JSON.parse(invRes.body);

    const stockBefore = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );

    // Return marked as DAMAGED
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "SALES_RETURN",
        disposition: "DAMAGED",
        restoreStock: false,
        returnDate: "2026-10-18",
        items: [{ salesItemId: invoice.items[0].id, quantity: 2 }],
      },
    });
    expect(retRes.statusCode).toBe(201);

    const stockAfter = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(stockAfter._sum.quantity)).toBe(Number(stockBefore._sum.quantity));
  });

  it("19. Refund Audit: Refund to Cash generates balanced Payment Voucher and records cash outflow", async () => {
    // Inject stock
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          organizationId: orgAId,
          companyId: companyAId,
          warehouseId: warehouseAId,
          itemId: itemAId,
          transactionType: StockTransactionType.OPENING,
          transactionDate: new Date(),
          quantity: 20,
          valuationRate: 50000,
          totalValuation: 1000000,
          referenceDocType: "OPENING_BALANCE",
          referenceDocId: itemAId,
        },
      });
    });

    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-18",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 2, unitPrice: 500, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const invoice = JSON.parse(invRes.body);

    // Issue return with REFUND_CASH
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "SALES_RETURN",
        returnDate: "2026-10-18",
        warehouseId: warehouseAId,
        restoreStock: true,
        settlementMode: "REFUND_CASH",
        items: [{ salesItemId: invoice.items[0].id, quantity: 1 }],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const ret = JSON.parse(retRes.body);
    expect(ret.settlementMode).toBe("REFUND_CASH");

    // Verify refund payment voucher was created
    const refundVoucher = await prisma.executeBypassRls((tx) =>
      tx.voucher.findFirst({
        where: {
          companyId: companyAId,
          sourceDocument: "SALES_RETURN_REFUND",
          sourceEntityId: ret.id,
        },
        include: { journalEntries: { include: { account: true } } },
      }),
    );
    expect(refundVoucher).toBeDefined();
    expect(refundVoucher?.voucherType).toBe("PAYMENT");
    expect(Number(refundVoucher?.totalAmount)).toBe(590);
  });
});
