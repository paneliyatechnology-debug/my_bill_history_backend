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

describe("Purchase Returns & Debit Notes Workflow Integration", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tokenA: string;
  let tokenB: string;
  let companyAId: string;
  let companyBId: string;
  let warehouseAId: string;
  let supplierAId: string;
  let itemAId: string;

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
        where: { phone: { in: ["9825999020", "9825999021"] } },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (orgIds.length > 0) {
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

    // 1. Register Company A (Tenant A)
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Company A Admin",
        phone: "9825999020",
        email: "companyA@returns.local",
        password: "Password@123",
        organizationName: "Gujarat Tools & Hardware",
        tradeName: "Gujarat Tools",
        stateCode: "24",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const bodyA = JSON.parse(regResA.body);
    tokenA = bodyA.accessToken;
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
        name: "Main Receiving Godown",
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
        name: "Pieces",
        code: "PCS",
        isDecimalAllowed: false,
      },
    });
    expect(uomRes.statusCode).toBe(201);
    const uomId = JSON.parse(uomRes.body).id;

    // Supplier Party for Company A
    const partyRes = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: "SUPPLIER",
        name: "Industrial Fasteners Pvt Ltd",
        phone: "9825999025",
        gstin: "24ABCDE1234F1Z6",
        stateCode: "24",
        billingAddress: {
          line1: "Plot 101, GIDC Estate",
          city: "Rajkot",
          pincode: "360002",
        },
      },
    });
    expect(partyRes.statusCode).toBe(201);
    supplierAId = JSON.parse(partyRes.body).id;

    // Item for Company A
    const itemRes = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: "PRODUCT",
        name: "High Tensile Bolt M16",
        sku: "BOLT-M16",
        hsnCode: "7318",
        primaryUomId: uomId,
        purchaseRate: 100,
        retailPrice: 150,
        taxRate: 18,
      },
    });
    expect(itemRes.statusCode).toBe(201);
    itemAId = JSON.parse(itemRes.body).id;

    // 2. Register Company B (Tenant B) for tenant isolation verification
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Company B Admin",
        phone: "9825999021",
        email: "companyB@returns.local",
        password: "Password@123",
        organizationName: "Surat Textiles Ltd",
        tradeName: "Surat Textiles",
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

  it("1. Successfully executes partial purchase return with stock deduction and balanced debit note", async () => {
    // Step 1: Create an eligible purchase bill (10 units @ 100 = 1000 taxable + 18% GST = 1180)
    const billRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: "INV-RET-001",
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [
          {
            itemId: itemAId,
            quantity: 10,
            unitPrice: 100,
            taxRate: 18,
          },
        ],
      },
    });
    expect(billRes.statusCode).toBe(201);
    const bill = JSON.parse(billRes.body);
    const purchaseItemId = bill.items[0].id;

    // Step 2: Post partial return (3 units)
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        returnDate: "2026-10-12",
        reason: "3 bolts damaged during transit",
        items: [
          {
            purchaseItemId,
            quantity: 3,
          },
        ],
      },
    });

    expect(retRes.statusCode).toBe(201);
    const returnData = JSON.parse(retRes.body);
    expect(returnData.id).toBeDefined();
    expect(returnData.returnNumber).toMatch(/^DN-\d{4}-\d{4}$/);
    expect(returnData.purchaseInvoiceId).toBe(bill.id);
    expect(returnData.partyId).toBe(supplierAId);

    // 3 units @ 100 = 300 taxable
    // 18% GST = 54 (CGST 27, SGST 27)
    // Grand Total = 354
    expect(Number(returnData.taxableAmount)).toBe(300);
    expect(Number(returnData.cgstAmount)).toBe(27);
    expect(Number(returnData.sgstAmount)).toBe(27);
    expect(Number(returnData.grandTotal)).toBe(354);
    expect(returnData.items).toHaveLength(1);
    expect(Number(returnData.items[0].quantity)).toBe(3);
  });

  it("2. Successfully executes full return for remaining quantity within the allowable balance", async () => {
    // Retrieve the bill created in Test 1
    const getBillRes = await app.inject({
      method: "GET",
      url: "/api/v1/purchases",
      headers: { authorization: `Bearer ${tokenA}` },
      query: { search: "INV-RET-001" },
    });
    const bill = JSON.parse(getBillRes.body).items[0];
    const purchaseItemId = bill.items[0].id;

    // Return the remaining 7 units (10 - 3 = 7 remaining)
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        returnDate: "2026-10-12",
        reason: "Remaining 7 bolts defective specifications",
        items: [
          {
            purchaseItemId,
            quantity: 7,
          },
        ],
      },
    });

    expect(retRes.statusCode).toBe(201);
    const returnData = JSON.parse(retRes.body);
    // 7 units @ 100 = 700 taxable, GST 126, Grand Total 826
    expect(Number(returnData.taxableAmount)).toBe(700);
    expect(Number(returnData.grandTotal)).toBe(826);
  });

  it("3. Rejects return quantity exceeding the remaining returnable balance", async () => {
    // The bill from Test 1 already has 10 out of 10 returned!
    const getBillRes = await app.inject({
      method: "GET",
      url: "/api/v1/purchases",
      headers: { authorization: `Bearer ${tokenA}` },
      query: { search: "INV-RET-001" },
    });
    const bill = JSON.parse(getBillRes.body).items[0];
    const purchaseItemId = bill.items[0].id;

    // Attempting to return even 1 more unit should be rejected
    const excessRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        reason: "Over-return attempt",
        items: [
          {
            purchaseItemId,
            quantity: 1,
          },
        ],
      },
    });

    expect(excessRes.statusCode).toBe(400);
    const err = JSON.parse(excessRes.body);
    expect(err.message).toMatch(
      /already been fully returned|exceeds remaining/i,
    );
  });

  it("4. Supports multiple partial returns against one original purchase bill", async () => {
    // Create a new purchase bill with 20 units
    const billRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: "INV-MULTI-001",
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [
          {
            itemId: itemAId,
            quantity: 20,
            unitPrice: 100,
            taxRate: 18,
          },
        ],
      },
    });
    expect(billRes.statusCode).toBe(201);
    const bill = JSON.parse(billRes.body);
    const purchaseItemId = bill.items[0].id;

    // First return: 5 units
    const ret1 = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        reason: "First batch return: 5 units",
        items: [{ purchaseItemId, quantity: 5 }],
      },
    });
    expect(ret1.statusCode).toBe(201);

    // Second return: 8 units
    const ret2 = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        reason: "Second batch return: 8 units",
        items: [{ purchaseItemId, quantity: 8 }],
      },
    });
    expect(ret2.statusCode).toBe(201);

    // List returns for this specific purchase
    const listRes = await app.inject({
      method: "GET",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(listRes.statusCode).toBe(200);
    const returnsList = JSON.parse(listRes.body);
    expect(returnsList).toHaveLength(2);

    // Now attempt to return 8 units (only 20 - 5 - 8 = 7 remaining)
    const ret3Fail = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        reason: "Attempt to return 8 when only 7 left",
        items: [{ purchaseItemId, quantity: 8 }],
      },
    });
    expect(ret3Fail.statusCode).toBe(400);

    // Returning exact remaining 7 units succeeds
    const ret3Success = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        reason: "Final return of remaining 7 units",
        items: [{ purchaseItemId, quantity: 7 }],
      },
    });
    expect(ret3Success.statusCode).toBe(201);
  });

  it("5. Handles concurrent return requests safely via advisory lock", async () => {
    // Create a purchase bill with 10 units
    const billRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: "INV-CONCURR-001",
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [
          {
            itemId: itemAId,
            quantity: 10,
            unitPrice: 100,
            taxRate: 18,
          },
        ],
      },
    });
    expect(billRes.statusCode).toBe(201);
    const bill = JSON.parse(billRes.body);
    const purchaseItemId = bill.items[0].id;

    // Send two concurrent return requests:
    // Request 1 wants 8 units, Request 2 wants 8 units (Total 16 > 10)
    // Exactly one must succeed and one must fail
    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/purchases/${bill.id}/returns`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          reason: "Concurrent branch 1",
          items: [{ purchaseItemId, quantity: 8 }],
        },
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/purchases/${bill.id}/returns`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          reason: "Concurrent branch 2",
          items: [{ purchaseItemId, quantity: 8 }],
        },
      }),
    ]);

    const statusCodes = [res1.statusCode, res2.statusCode].sort();
    expect(statusCodes).toEqual([201, 400]);
  });

  it("6. Rejects cross-tenant access for purchase returns", async () => {
    // Company A creates a bill and a return
    const billRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: "INV-TENANT-001",
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [{ itemId: itemAId, quantity: 5, unitPrice: 100, taxRate: 18 }],
      },
    });
    expect(billRes.statusCode).toBe(201);
    const bill = JSON.parse(billRes.body);

    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        reason: "Tenant A return",
        items: [{ purchaseItemId: bill.items[0].id, quantity: 2 }],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const returnData = JSON.parse(retRes.body);

    // Company B attempts to access Company A's return by ID: Must be 404
    const getResB = await app.inject({
      method: "GET",
      url: `/api/v1/purchase-returns/${returnData.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getResB.statusCode).toBe(404);

    // Company B attempts to post a return against Company A's purchase invoice: Must be 404
    const postResB = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        reason: "Cross tenant hijack attempt",
        items: [{ purchaseItemId: bill.items[0].id, quantity: 1 }],
      },
    });
    expect(postResB.statusCode).toBe(404);
  });

  it("7. Verifies correct stock-out movement and valuation in the stock ledger", async () => {
    const billRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: "INV-STOCK-001",
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [{ itemId: itemAId, quantity: 6, unitPrice: 120, taxRate: 18 }],
      },
    });
    const bill = JSON.parse(billRes.body);

    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        reason: "Stock check return",
        items: [{ purchaseItemId: bill.items[0].id, quantity: 4 }],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const returnData = JSON.parse(retRes.body);

    // Query Stock Transactions directly in database
    const stockTx = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.findFirst({
        where: {
          referenceDocType: "PURCHASE_RETURN",
          referenceDocId: returnData.id,
        },
      }),
    );

    expect(stockTx).toBeDefined();
    expect(stockTx?.transactionType).toBe(StockTransactionType.PURCHASE_RETURN);
    // Outward stock is recorded as negative quantity (-4)
    expect(Number(stockTx?.quantity)).toBe(-4);
    expect(Number(stockTx?.valuationRate)).toBe(120);
    expect(Number(stockTx?.totalValuation)).toBe(480); // 4 * 120 = 480
    expect(stockTx?.warehouseId).toBe(warehouseAId);
  });

  it("8. Verifies balanced double-entry Debit Note voucher (Dr Supplier = Cr Purchases + Cr Taxes)", async () => {
    const billRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: "INV-VOUCHER-001",
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [{ itemId: itemAId, quantity: 5, unitPrice: 200, taxRate: 18 }],
      },
    });
    const bill = JSON.parse(billRes.body);

    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        reason: "Voucher balance verification",
        items: [{ purchaseItemId: bill.items[0].id, quantity: 2 }],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const returnData = JSON.parse(retRes.body);

    // 2 units @ 200 = 400 taxable. GST 18% = 72 (CGST 36, SGST 36). Total = 472
    const voucher = await prisma.executeBypassRls((tx) =>
      tx.voucher.findFirst({
        where: {
          sourceDocument: "PURCHASE_RETURN",
          sourceEntityId: returnData.id,
          voucherType: VoucherType.DEBIT_NOTE,
        },
        include: { journalEntries: { include: { account: true } } },
      }),
    );

    expect(voucher).toBeDefined();
    expect(Number(voucher?.totalAmount)).toBe(472);

    let sumDebit = new Decimal(0);
    let sumCredit = new Decimal(0);

    for (const entry of voucher!.journalEntries) {
      sumDebit = sumDebit.plus(new Decimal(entry.debitAmount.toString()));
      sumCredit = sumCredit.plus(new Decimal(entry.creditAmount.toString()));
    }

    // Double-entry must balance perfectly: sumDebit == sumCredit
    expect(sumDebit.toFixed(2)).toBe("472.00");
    expect(sumCredit.toFixed(2)).toBe("472.00");
    expect(sumDebit.equals(sumCredit)).toBe(true);

    // Check specific accounts
    const supplierDebit = voucher!.journalEntries.find(
      (e) => Number(e.debitAmount) > 0,
    );
    expect(supplierDebit).toBeDefined();
    expect(Number(supplierDebit?.debitAmount)).toBe(472);

    const purchaseCredit = voucher!.journalEntries.find(
      (e) =>
        Number(e.creditAmount) === 400 &&
        e.account.name.toLowerCase().includes("purchase"),
    );
    expect(purchaseCredit).toBeDefined();
  });

  it("9. Verifies reconciliation of supplier outstanding balance on the purchase invoice", async () => {
    // Bill total: 10 * 100 + 18% = 1180
    const billRes = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: "INV-BAL-001",
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [{ itemId: itemAId, quantity: 10, unitPrice: 100, taxRate: 18 }],
      },
    });
    const bill = JSON.parse(billRes.body);
    expect(Number(bill.balanceAmount)).toBe(1180);

    // Return 4 units (Taxable 400 + Tax 72 = 472)
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        reason: "Reconciliation check",
        items: [{ purchaseItemId: bill.items[0].id, quantity: 4 }],
      },
    });
    expect(retRes.statusCode).toBe(201);

    // Check updated bill balance in database: 1180 - 472 = 708
    const updatedBill = await prisma.executeBypassRls((tx) =>
      tx.purchaseInvoice.findUnique({ where: { id: bill.id } }),
    );
    expect(Number(updatedBill?.balanceAmount)).toBe(708);
  });

  it("10. Rejects returns in a locked financial year", async () => {
    // Lock the financial year
    const fy = await prisma.executeBypassRls((tx) =>
      tx.financialYear.findFirst({
        where: { companyId: companyAId, isCurrent: true },
      }),
    );
    expect(fy).toBeDefined();

    await prisma.executeBypassRls((tx) =>
      tx.financialYear.update({
        where: { id: fy!.id },
        data: { isLocked: true },
      }),
    );

    try {
      // Attempting to create a return should now be rejected
      const getBillRes = await app.inject({
        method: "GET",
        url: "/api/v1/purchases",
        headers: { authorization: `Bearer ${tokenA}` },
        query: { search: "INV-BAL-001" },
      });
      const bill = JSON.parse(getBillRes.body).items[0];

      const retRes = await app.inject({
        method: "POST",
        url: `/api/v1/purchases/${bill.id}/returns`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {
          reason: "Locked FY test",
          items: [{ purchaseItemId: bill.items[0].id, quantity: 1 }],
        },
      });

      expect(retRes.statusCode).toBe(400);
      const err = JSON.parse(retRes.body);
      expect(err.message).toMatch(/locked financial (year|period)/i);
    } finally {
      // Unlock financial year to restore test environment
      await prisma.executeBypassRls((tx) =>
        tx.financialYear.update({
          where: { id: fy!.id },
          data: { isLocked: false },
        }),
      );
    }
  });

  it("11. Verifies audit event creation and atomic rollback on failure", async () => {
    const getBillRes = await app.inject({
      method: "GET",
      url: "/api/v1/purchases",
      headers: { authorization: `Bearer ${tokenA}` },
      query: { search: "INV-BAL-001" },
    });
    const bill = JSON.parse(getBillRes.body).items[0];

    // Successful return creates audit log
    const retRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        reason: "Audit log verification",
        items: [{ purchaseItemId: bill.items[0].id, quantity: 1 }],
      },
    });
    expect(retRes.statusCode).toBe(201);
    const returnData = JSON.parse(retRes.body);

    const auditLog = await prisma.executeBypassRls((tx) =>
      tx.auditLog.findFirst({
        where: {
          action: "CREATE_PURCHASE_RETURN",
          entityId: returnData.id,
        },
      }),
    );
    expect(auditLog).toBeDefined();
    expect(auditLog?.action).toBe("CREATE_PURCHASE_RETURN");

    // Atomic Rollback check:
    // If request contains invalid quantity (e.g. negative or 0) or fake item, transaction fails
    const initialReturnsCount = await prisma.executeBypassRls((tx) =>
      tx.purchaseReturn.count({ where: { companyId: companyAId } }),
    );
    const initialVouchersCount = await prisma.executeBypassRls((tx) =>
      tx.voucher.count({
        where: {
          companyId: companyAId,
          voucherType: VoucherType.DEBIT_NOTE,
        },
      }),
    );

    const failRes = await app.inject({
      method: "POST",
      url: `/api/v1/purchases/${bill.id}/returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        reason: "Invalid rollback test",
        items: [{ purchaseItemId: bill.items[0].id, quantity: -5 }],
      },
    });
    expect(failRes.statusCode).toBe(400);

    const finalReturnsCount = await prisma.executeBypassRls((tx) =>
      tx.purchaseReturn.count({ where: { companyId: companyAId } }),
    );
    const finalVouchersCount = await prisma.executeBypassRls((tx) =>
      tx.voucher.count({
        where: {
          companyId: companyAId,
          voucherType: VoucherType.DEBIT_NOTE,
        },
      }),
    );

    // Counts must not have incremented (atomic rollback)
    expect(finalReturnsCount).toBe(initialReturnsCount);
    expect(finalVouchersCount).toBe(initialVouchersCount);
  });

  it("12. Lists purchase returns with filters (search, supplier, pagination)", async () => {
    // Call GET /api/v1/purchase-returns
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/purchase-returns",
      headers: { authorization: `Bearer ${tokenA}` },
      query: {
        partyId: supplierAId,
        limit: "10",
        offset: "0",
      },
    });

    expect(listRes.statusCode).toBe(200);
    const body = JSON.parse(listRes.body);
    expect(body.items).toBeDefined();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);

    // Verify detailed single return GET /api/v1/purchase-returns/:id
    const singleReturnId = body.items[0].id;
    const detailRes = await app.inject({
      method: "GET",
      url: `/api/v1/purchase-returns/${singleReturnId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = JSON.parse(detailRes.body);
    expect(detail.id).toBe(singleReturnId);
    expect(detail.party).toBeDefined();
    expect(detail.purchaseInvoice).toBeDefined();
    expect(detail.items).toBeDefined();
  });
});
