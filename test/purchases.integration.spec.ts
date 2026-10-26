import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { Decimal } from "@billing/accounting-core";

describe("Purchases & Supplier Invoices Workflow Integration", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tokenA: string;
  let companyAId: string;
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
        where: { phone: "9825999001" },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({
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

    // Register a dedicated test company
    const regRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Purchase Test Admin",
        phone: "9825999001",
        email: "purchases@test.local",
        password: "Password@123",
        organizationName: "Gujarat Hardware Wholesale",
        tradeName: "Gujarat Hardware Stores",
        stateCode: "24",
      },
    });

    expect(regRes.statusCode).toBe(201);
    const body = JSON.parse(regRes.body);
    tokenA = body.accessToken;
    companyAId = body.defaultContext.companyId;

    // Seed Standard Chart of Accounts
    const seedRes = await app.inject({
      method: "POST",
      url: "/api/v1/ledger-groups/seed",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(seedRes.statusCode).toBe(201);

    // Create warehouse
    const whRes = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: "Central Receiving Godown",
        isDefault: true,
      },
    });
    expect(whRes.statusCode).toBe(201);
    const whBody = JSON.parse(whRes.body);
    warehouseAId = whBody.id;

    // Create UOM
    const uomRes = await app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: "Kilogram",
        code: "KGS",
        isDecimalAllowed: true,
      },
    });
    expect(uomRes.statusCode).toBe(201);
    const uomBody = JSON.parse(uomRes.body);

    // Create Supplier Party
    const partyRes = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: "SUPPLIER",
        name: "Apex Steel Suppliers LLP",
        phone: "9825999002",
        gstin: "24ABCDE1234F1Z6",
        stateCode: "24",
        billingAddress: {
          line1: "GIDC Industrial Zone",
          city: "Ahmedabad",
          pincode: "382445",
        },
      },
    });
    expect(partyRes.statusCode).toBe(201);
    const partyBody = JSON.parse(partyRes.body);
    supplierAId = partyBody.id;

    // Create Item
    const itemRes = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: "PRODUCT",
        name: "Heavy Duty Steel Rod 12mm",
        sku: "ROD-12MM",
        hsnCode: "7214",
        primaryUomId: uomBody.id,
        purchaseRate: 450,
        retailPrice: 550,
        taxRate: 18,
      },
    });
    expect(itemRes.statusCode).toBe(201);
    const itemBody = JSON.parse(itemRes.body);
    itemAId = itemBody.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. Successfully records a purchase bill with atomic stock receipt & double-entry voucher", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "x-correlation-id": "test-pur-001",
      },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: "APEX-2026-881",
        invoiceDate: "2026-10-12",
        warehouseId: warehouseAId,
        items: [
          {
            itemId: itemAId,
            quantity: 10,
            unitPrice: 450,
            taxRate: 18,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBeDefined();
    expect(body.vendorInvoiceNumber).toBe("APEX-2026-881");
    // 10 * 450 = 4500 taxable
    // 18% GST = 810 (CGST 405, SGST 405)
    // Grand Total = 5310.00
    expect(Number(body.taxableAmount)).toBe(4500);
    expect(Number(body.cgstAmount)).toBe(405);
    expect(Number(body.sgstAmount)).toBe(405);
    expect(Number(body.grandTotal)).toBe(5310);

    // Verify Inward Stock Transaction (PURCHASE_RECEIPT)
    const stockTx = await prisma.executeBypassRls(async (tx) => {
      return tx.stockTransaction.findFirst({
        where: {
          referenceDocId: body.id,
          referenceDocType: "PURCHASE_INVOICE",
          transactionType: "PURCHASE_RECEIPT",
        },
      });
    });

    expect(stockTx).toBeDefined();
    expect(Number(stockTx?.quantity)).toBe(10); // Positive inward stock
    expect(Number(stockTx?.valuationRate)).toBe(450);

    // Verify Double-Entry Voucher (PURCHASE)
    const voucher = await prisma.executeBypassRls(async (tx) => {
      return tx.voucher.findFirst({
        where: {
          sourceEntityId: body.id,
          sourceDocument: "PURCHASE_INVOICE",
          voucherType: "PURCHASE",
        },
        include: {
          journalEntries: true,
        },
      });
    });

    expect(voucher).toBeDefined();
    expect(voucher?.journalEntries.length).toBeGreaterThanOrEqual(3); // Dr Purchases, Dr CGST, Dr SGST, Cr Creditor

    let totalDr = new Decimal(0);
    let totalCr = new Decimal(0);
    for (const je of voucher!.journalEntries) {
      totalDr = totalDr.plus(je.debitAmount.toString());
      totalCr = totalCr.plus(je.creditAmount.toString());
    }

    expect(totalDr.equals(totalCr)).toBe(true);
    expect(totalDr.toNumber()).toBe(5310);
  });

  it("2. Rejects duplicate purchase bill for the same supplier and vendor invoice number", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: supplierAId,
        vendorInvoiceNumber: "APEX-2026-881",
        items: [
          {
            itemId: itemAId,
            quantity: 5,
            unitPrice: 450,
            taxRate: 18,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(409); // ConflictException
  });

  it("3. Lists purchase invoices with search and supplier filters", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/purchases?search=APEX",
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.length).toBe(1);
    expect(body.items[0].vendorInvoiceNumber).toBe("APEX-2026-881");
  });

  it("4. Retrieves single purchase invoice details by ID", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/purchases",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const listBody = JSON.parse(listRes.body);
    const invId = listBody.items[0].id;

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/purchases/${invId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(invId);
    expect(body.items.length).toBe(1);
  });

  it("5. Updates and retrieves company business settings via PATCH /tenants/company", async () => {
    const updateRes = await app.inject({
      method: "PATCH",
      url: "/api/v1/tenants/company",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        bankName: "HDFC Bank Ltd",
        bankAccountNo: "50200012345678",
        bankIfsc: "HDFC0001234",
        upiVpa: "gujhardware@hdfcbank",
        enableGujaratiPrint: true,
        allowNegativeStock: false,
      },
    });

    expect(updateRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: "/api/v1/tenants/company",
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(getRes.statusCode).toBe(200);
    const comp = JSON.parse(getRes.body);
    expect(comp.bankName).toBe("HDFC Bank Ltd");
    expect(comp.bankAccountNo).toBe("50200012345678");
    expect(comp.upiVpa).toBe("gujhardware@hdfcbank");
    expect(comp.enableGujaratiPrint).toBe(true);
    expect(comp.allowNegativeStock).toBe(false);
  });
});
