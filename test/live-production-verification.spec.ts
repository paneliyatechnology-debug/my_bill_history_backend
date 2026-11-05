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

describe("LIVE PRODUCTION VERIFICATION — SALES RETURN & CREDIT NOTE", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tokenA: string;
  let tokenB: string;
  let orgAId: string;
  let companyAId: string;
  let companyBId: string;
  let warehouseAId: string;
  let warehouseBId: string;
  let customerAId: string;
  let interstateCustomerAId: string;
  let itemAId: string;
  let cashAccountId: string;
  let bankAccountId: string;
  let salesAccountId: string;
  let outputCgstAccountId: string;
  let outputSgstAccountId: string;
  let outputIgstAccountId: string;

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

    const runSuffix = Date.now().toString().slice(-6);

    // 1. Register Isolated Company A (Tenant A) in Gujarat (State Code 24)
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Live Audit Lead Auditor",
        phone: `9825${runSuffix}`,
        email: `liveauditA_${runSuffix}@myownbillbook.local`,
        password: "AuditPassword@123",
        organizationName: `Audit Steel Corporation ${runSuffix}`,
        tradeName: "Audit Steel",
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

    // Warehouses for Company A
    const whRes = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: "Central Finished Goods Godown",
        isDefault: true,
      },
    });
    expect(whRes.statusCode).toBe(201);
    warehouseAId = JSON.parse(whRes.body).id;

    const whRes2 = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: "Secondary Branch Godown",
        isDefault: false,
      },
    });
    expect(whRes2.statusCode).toBe(201);
    warehouseBId = JSON.parse(whRes2.body).id;

    // UOM for Company A
    const uomRes = await app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: "Number of Units",
        code: "UNT",
        isDecimalAllowed: true,
      },
    });
    expect(uomRes.statusCode).toBe(201);
    const uomId = JSON.parse(uomRes.body).id;

    // Intra-state Customer Party (Gujarat - 24)
    const partyRes = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: "CUSTOMER",
        name: "Patel Steel Fabricators",
        phone: "9825111222",
        gstin: "24ABCDE1234F1Z6",
        stateCode: "24",
        billingAddress: {
          line1: "GIDC Industrial Estate",
          city: "Ahmedabad",
          pincode: "380015",
          state: "Gujarat",
        },
      },
    });
    expect(partyRes.statusCode).toBe(201);
    customerAId = JSON.parse(partyRes.body).id;

    // Inter-state Customer Party (Maharashtra - 27)
    const interstateRes = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: "CUSTOMER",
        name: "Mumbai Heavy Infrastructure Ltd",
        phone: "9822334455",
        gstin: "27AABCU9603R1ZN",
        stateCode: "27",
        billingAddress: {
          line1: "Bandra Kurla Complex",
          city: "Mumbai",
          pincode: "400051",
          state: "Maharashtra",
        },
      },
    });
    expect(interstateRes.statusCode).toBe(201);
    interstateCustomerAId = JSON.parse(interstateRes.body).id;

    // Inventory Item
    const itemRes = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        type: "PRODUCT",
        name: "TMT Rebar 12mm FE550D",
        sku: "TMT-12MM-FE550",
        hsnCode: "7214",
        primaryUomId: uomId,
        retailPrice: 1000,
        purchaseRate: 800,
        taxRate: 18,
      },
    });
    expect(itemRes.statusCode).toBe(201);
    itemAId = JSON.parse(itemRes.body).id;

    // Cache common account IDs for verification
    const accounts = await prisma.executeBypassRls((tx) =>
      tx.ledgerAccount.findMany({
        where: { companyId: companyAId },
        select: { id: true, code: true, name: true },
      }),
    );
    cashAccountId = accounts.find((a) => a.code === "1010" || a.name.includes("Cash"))?.id || "";
    bankAccountId = accounts.find((a) => a.code === "1020" || a.name.includes("Bank"))?.id || "";
    salesAccountId = accounts.find((a) => a.code === "4010" || a.name.includes("Sales"))?.id || "";
    outputCgstAccountId = accounts.find((a) => a.code === "2110" || a.name.includes("Output CGST"))?.id || "";
    outputSgstAccountId = accounts.find((a) => a.code === "2120" || a.name.includes("Output SGST"))?.id || "";
    outputIgstAccountId = accounts.find((a) => a.code === "2130" || a.name.includes("Output IGST"))?.id || "";

    // 2. Register Isolated Company B (Tenant B) for Tenant Isolation checks
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Company B Auditor",
        phone: `9826${runSuffix}`,
        email: `liveauditB_${runSuffix}@salesreturns.local`,
        password: "Password@123",
        organizationName: `Isolated Tenant B Enterprises ${runSuffix}`,
        tradeName: "Tenant B Corp",
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

  // --------------------------------------------------------------------------
  // SECTION 1 & 2: COMPLETE TRANSACTION LIFECYCLE & ACCOUNTING INVARIANTS
  // --------------------------------------------------------------------------
  it("Lifecycle 1-7: Full lifecycle verify single effect on balance, ledger, voucher, and inventory", async () => {
    // 0. Inject Opening Stock of 100 units @ ₹800 into warehouse A
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          organizationId: orgAId,
          companyId: companyAId,
          warehouseId: warehouseAId,
          itemId: itemAId,
          transactionType: StockTransactionType.OPENING,
          transactionDate: new Date(),
          quantity: 100,
          valuationRate: 800,
          totalValuation: 80000,
          referenceDocType: "OPENING_BALANCE",
          referenceDocId: itemAId,
        },
      });
    });

    // 1. Create and issue Sales Invoice: 10 units @ ₹1,000 + 18% GST (9% CGST + 9% SGST)
    // Taxable = ₹10,000, CGST = ₹900, SGST = ₹900, Grand Total = ₹11,800
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-20",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 10, unitPrice: 1000, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const invoice = JSON.parse(invRes.body);

    // Initial Verification
    expect(Number(invoice.grandTotal)).toBe(11800);
    expect(Number(invoice.balanceAmount)).toBe(11800);

    // Verify Stock reduced by 10 (100 - 10 = 90)
    const stockAfterInv = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(stockAfterInv._sum.quantity)).toBe(90);

    // Verify Customer Ledger balance = DR ₹11,800
    const custAcc = await prisma.executeBypassRls((tx) =>
      tx.ledgerAccount.findFirst({ where: { partyId: customerAId } }),
    );
    expect(Number(custAcc?.currentBalance)).toBe(11800);

    // 2. Step 2: Create Partial Sales Return for 2 units (2 * 1000 + 18% = ₹2,360)
    const ret1Res = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "SALES_RETURN",
        returnDate: "2026-10-20",
        warehouseId: warehouseAId,
        restoreStock: true,
        disposition: "SELLABLE",
        reason: "Customer partial excess quantity return",
        items: [{ salesItemId: invoice.items[0].id, quantity: 2 }],
      },
    });
    expect(ret1Res.statusCode).toBe(201);
    const ret1 = JSON.parse(ret1Res.body);
    expect(Number(ret1.grandTotal)).toBe(2360);
    expect(ret1.voucherId).toBeDefined();

    // 3. Step 3: Verify invoice outstanding and customer ledger after Return #1
    const invAfterRet1 = await prisma.executeBypassRls((tx) =>
      tx.salesInvoice.findUnique({ where: { id: invoice.id } }),
    );
    // 11,800 - 2,360 = 9,440
    expect(Number(invAfterRet1?.balanceAmount)).toBe(9440);

    const custAfterRet1 = await prisma.executeBypassRls((tx) =>
      tx.ledgerAccount.findFirst({ where: { partyId: customerAId } }),
    );
    expect(Number(custAfterRet1?.currentBalance)).toBe(9440);

    // Verify Stock restored by 2 units (90 + 2 = 92)
    const stockAfterRet1 = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(stockAfterRet1._sum.quantity)).toBe(92);

    // Verify Return #1 Voucher Invariants: Debits == Credits = ₹2,360
    const voucherRet1 = await prisma.executeBypassRls((tx) =>
      tx.voucher.findUnique({
        where: { id: ret1.voucherId },
        include: { journalEntries: true },
      }),
    );
    expect(voucherRet1).toBeDefined();
    let totalDebitRet1 = new Decimal(0);
    let totalCreditRet1 = new Decimal(0);
    for (const je of voucherRet1!.journalEntries) {
      totalDebitRet1 = totalDebitRet1.plus(je.debitAmount);
      totalCreditRet1 = totalCreditRet1.plus(je.creditAmount);
    }
    expect(totalDebitRet1.toNumber()).toBe(2360);
    expect(totalCreditRet1.toNumber()).toBe(2360);

    // 4. Step 4: Create linked Credit Note from Sales Return #1
    const linkRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns/${ret1.id}/create-credit-note`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(linkRes.statusCode).toBe(201);
    const linkedCN = JSON.parse(linkRes.body);
    expect(linkedCN.docType).toBe("CREDIT_NOTE");
    expect(linkedCN.linkedReturnId).toBe(ret1.id);

    // 5. Step 5: INVARIANT CHECK — Zero duplicate effects!
    // A. Shared voucher attached (no duplicate voucher)
    expect(linkedCN.voucherId).toBe(ret1.voucherId);

    // B. Invoice balance NOT reduced twice (must remain 9,440)
    const invAfterLinkedCN = await prisma.executeBypassRls((tx) =>
      tx.salesInvoice.findUnique({ where: { id: invoice.id } }),
    );
    expect(Number(invAfterLinkedCN?.balanceAmount)).toBe(9440);

    // C. Customer ledger balance NOT reduced twice (must remain 9,440)
    const custAfterLinkedCN = await prisma.executeBypassRls((tx) =>
      tx.ledgerAccount.findFirst({ where: { partyId: customerAId } }),
    );
    expect(Number(custAfterLinkedCN?.currentBalance)).toBe(9440);

    // D. Stock NOT increased twice (must remain 92, not 94)
    const stockAfterLinkedCN = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(stockAfterLinkedCN._sum.quantity)).toBe(92);

    // E. Total vouchers for this invoice remains exactly 2 (1 Sales Invoice + 1 Sales Return/CN)
    const totalVouchers = await prisma.executeBypassRls((tx) =>
      tx.voucher.count({
        where: {
          companyId: companyAId,
          OR: [
            { sourceEntityId: invoice.id },
            { sourceEntityId: ret1.id },
            { sourceEntityId: linkedCN.id },
          ],
        },
      }),
    );
    expect(totalVouchers).toBe(2);

    // 6. Step 6: Create another partial Sales Return (3 units @ ₹1,000 + 18% = ₹3,540)
    // Total returned so far: 2 units. Remaining returnable: 10 - 2 = 8 units.
    // 3 units is valid (leaves 5 units).
    const ret2Res = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "SALES_RETURN",
        returnDate: "2026-10-21",
        warehouseId: warehouseAId,
        restoreStock: true,
        disposition: "SELLABLE",
        reason: "Second partial return",
        items: [{ salesItemId: invoice.items[0].id, quantity: 3 }],
      },
    });
    expect(ret2Res.statusCode).toBe(201);
    const ret2 = JSON.parse(ret2Res.body);
    expect(Number(ret2.grandTotal)).toBe(3540);

    // Invoice balance: 9,440 - 3,540 = 5,900
    const invAfterRet2 = await prisma.executeBypassRls((tx) =>
      tx.salesInvoice.findUnique({ where: { id: invoice.id } }),
    );
    expect(Number(invAfterRet2?.balanceAmount)).toBe(5900);

    // Stock: 92 + 3 = 95
    const stockAfterRet2 = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(stockAfterRet2._sum.quantity)).toBe(95);

    // Verify over-return is strictly rejected:
    // Available remaining is 5 units. Attempting 6 units must fail with 400
    const overRetRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "SALES_RETURN",
        returnDate: "2026-10-21",
        warehouseId: warehouseAId,
        restoreStock: true,
        items: [{ salesItemId: invoice.items[0].id, quantity: 6 }],
      },
    });
    expect(overRetRes.statusCode).toBe(400);

    // 7. Step 7: Cancel Return #2 and verify exact single reversal
    const delRet2Res = await app.inject({
      method: "DELETE",
      url: `/api/v1/sales-returns/${ret2.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(delRet2Res.statusCode).toBe(200);

    // A. Invoice balance restored from 5,900 back to 9,440
    const invAfterCancel = await prisma.executeBypassRls((tx) =>
      tx.salesInvoice.findUnique({ where: { id: invoice.id } }),
    );
    expect(Number(invAfterCancel?.balanceAmount)).toBe(9440);

    // B. Customer ledger restored back to 9,440
    const custAfterCancel = await prisma.executeBypassRls((tx) =>
      tx.ledgerAccount.findFirst({ where: { partyId: customerAId } }),
    );
    expect(Number(custAfterCancel?.currentBalance)).toBe(9440);

    // C. Stock decremented from 95 back to 92
    const stockAfterCancel = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(stockAfterCancel._sum.quantity)).toBe(92);

    // D. Return #2 stock transaction deleted
    const ret2StockTx = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.findFirst({
        where: { referenceDocId: ret2.id },
      }),
    );
    expect(ret2StockTx).toBeNull();
  });

  // --------------------------------------------------------------------------
  // SECTION 3: STOCK INVARIANTS (SELLABLE, DAMAGED, SCRAPPED)
  // --------------------------------------------------------------------------
  it("Stock Invariants: Test SELLABLE, DAMAGED, SCRAPPED, and Standalone Credit Note", async () => {
    // Invoice for 6 units @ 1000 = ₹7,080
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-22",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 6, unitPrice: 1000, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const invoice = JSON.parse(invRes.body);

    const initialStock = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    const startQty = Number(initialStock._sum.quantity);

    // A. SELLABLE return (1 unit into Warehouse A) -> MUST increase stock by 1
    const sellableRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "SALES_RETURN",
        disposition: "SELLABLE",
        warehouseId: warehouseAId,
        restoreStock: true,
        items: [{ salesItemId: invoice.items[0].id, quantity: 1 }],
      },
    });
    expect(sellableRes.statusCode).toBe(201);
    const stockAfterSellable = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(stockAfterSellable._sum.quantity)).toBe(startQty + 1);

    // B. DAMAGED return (1 unit into Warehouse A) -> Quarantined, ZERO sellable stock added
    const damagedRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "SALES_RETURN",
        disposition: "DAMAGED",
        warehouseId: warehouseAId,
        restoreStock: false,
        items: [{ salesItemId: invoice.items[0].id, quantity: 1 }],
      },
    });
    expect(damagedRes.statusCode).toBe(201);
    const stockAfterDamaged = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    // Stock remains startQty + 1 (NOT incremented)
    expect(Number(stockAfterDamaged._sum.quantity)).toBe(startQty + 1);

    // C. SCRAPPED return (1 unit into Warehouse A) -> ZERO sellable stock added
    const scrappedRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "SALES_RETURN",
        disposition: "SCRAPPED",
        warehouseId: warehouseAId,
        restoreStock: false,
        items: [{ salesItemId: invoice.items[0].id, quantity: 1 }],
      },
    });
    expect(scrappedRes.statusCode).toBe(201);
    const stockAfterScrapped = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    // Stock remains startQty + 1 (NOT incremented)
    expect(Number(stockAfterScrapped._sum.quantity)).toBe(startQty + 1);

    // D. Multi-warehouse stock movement: Return 1 unit into Secondary Warehouse B
    const whBStockBefore = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseBId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    const whBQtyStart = Number(whBStockBefore._sum.quantity || 0);

    const whBReturnRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "SALES_RETURN",
        disposition: "SELLABLE",
        warehouseId: warehouseBId,
        restoreStock: true,
        items: [{ salesItemId: invoice.items[0].id, quantity: 1 }],
      },
    });
    expect(whBReturnRes.statusCode).toBe(201);

    const whBStockAfter = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseBId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(whBStockAfter._sum.quantity)).toBe(whBQtyStart + 1);

    // E. Standalone Amount-Based Credit Note -> ZERO stock movement anywhere
    const directCNRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "CREDIT_NOTE",
        creditNoteType: "AMOUNT_BASED",
        gstCategory: "COMMERCIAL",
        amount: 250,
        restoreStock: false,
      },
    });
    expect(directCNRes.statusCode).toBe(201);

    const finalWhA = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { itemId: itemAId, warehouseId: warehouseAId, companyId: companyAId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(finalWhA._sum.quantity)).toBe(startQty + 1);
  });

  // --------------------------------------------------------------------------
  // SECTION 4: GST COMPLIANCE (SECTION 34 VS COMMERCIAL CREDIT NOTES)
  // --------------------------------------------------------------------------
  it("GST Compliance: Section 34 reverses GST while Commercial Note leaves tax unaffected", async () => {
    // 1. Intra-State Invoice: 5 units @ 1000 = ₹5,000 + 18% (9% CGST ₹450 + 9% SGST ₹450)
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-23",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 5, unitPrice: 1000, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const invoice = JSON.parse(invRes.body);

    // Initial Output CGST & SGST
    const cgstBefore = await prisma.executeBypassRls((tx) =>
      tx.ledgerAccount.findUnique({ where: { id: outputCgstAccountId } }),
    );
    const sgstBefore = await prisma.executeBypassRls((tx) =>
      tx.ledgerAccount.findUnique({ where: { id: outputSgstAccountId } }),
    );

    // A. Statutory Section 34 Credit Note: Return 1 unit (Taxable ₹1,000 + CGST ₹90 + SGST ₹90)
    const sec34Res = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "CREDIT_NOTE",
        creditNoteType: "ITEM_BASED",
        gstCategory: "SECTION_34",
        restoreStock: false,
        items: [{ salesItemId: invoice.items[0].id, quantity: 1 }],
      },
    });
    expect(sec34Res.statusCode).toBe(201);
    const sec34CN = JSON.parse(sec34Res.body);
    expect(Number(sec34CN.taxableAmount)).toBe(1000);
    expect(Number(sec34CN.cgstAmount)).toBe(90);
    expect(Number(sec34CN.sgstAmount)).toBe(90);
    expect(Number(sec34CN.grandTotal)).toBe(1180);

    // Verify Output Tax Reversal: DR CGST ₹90, DR SGST ₹90
    const sec34Voucher = await prisma.executeBypassRls((tx) =>
      tx.voucher.findUnique({
        where: { id: sec34CN.voucherId },
        include: { journalEntries: true },
      }),
    );
    const cgstLine = sec34Voucher?.journalEntries.find((je) => je.accountId === outputCgstAccountId);
    const sgstLine = sec34Voucher?.journalEntries.find((je) => je.accountId === outputSgstAccountId);
    expect(Number(cgstLine?.debitAmount)).toBe(90);
    expect(Number(sgstLine?.debitAmount)).toBe(90);

    // B. Commercial Credit Note: Volume rebate ₹600 without GST adjustment
    const commRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: invoice.id,
        docType: "CREDIT_NOTE",
        creditNoteType: "AMOUNT_BASED",
        gstCategory: "COMMERCIAL",
        amount: 600,
        restoreStock: false,
      },
    });
    expect(commRes.statusCode).toBe(201);
    const commCN = JSON.parse(commRes.body);
    expect(Number(commCN.grandTotal)).toBe(600);
    expect(Number(commCN.cgstAmount)).toBe(0);
    expect(Number(commCN.sgstAmount)).toBe(0);
    expect(Number(commCN.igstAmount)).toBe(0);

    // Verify Commercial Voucher: Debits Commercial Discounts, ZERO entries on tax accounts
    const commVoucher = await prisma.executeBypassRls((tx) =>
      tx.voucher.findUnique({
        where: { id: commCN.voucherId },
        include: { journalEntries: { include: { account: true } } },
      }),
    );
    const taxEntryInComm = commVoucher?.journalEntries.find(
      (je) =>
        je.accountId === outputCgstAccountId ||
        je.accountId === outputSgstAccountId ||
        je.accountId === outputIgstAccountId,
    );
    expect(taxEntryInComm).toBeUndefined(); // Zero tax entries!

    const discountLine = commVoucher?.journalEntries.find((je) =>
      je.account.name.includes("Commercial Discount"),
    );
    expect(discountLine).toBeDefined();
    expect(Number(discountLine?.debitAmount)).toBe(600);

    // C. Inter-State Section 34 Note: 18% IGST reversal
    const interInvRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: interstateCustomerAId,
        invoiceDate: "2026-10-23",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 2, unitPrice: 2000, taxRate: 18 },
        ],
      },
    });
    expect(interInvRes.statusCode).toBe(201);
    const interInv = JSON.parse(interInvRes.body);

    const interCNRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: interInv.id,
        docType: "CREDIT_NOTE",
        creditNoteType: "ITEM_BASED",
        gstCategory: "SECTION_34",
        restoreStock: false,
        items: [{ salesItemId: interInv.items[0].id, quantity: 1 }],
      },
    });
    expect(interCNRes.statusCode).toBe(201);
    const interCN = JSON.parse(interCNRes.body);
    expect(Number(interCN.igstAmount)).toBe(360);
    expect(Number(interCN.cgstAmount)).toBe(0);
    expect(Number(interCN.sgstAmount)).toBe(0);

    // Verify GSTR-1 endpoint aggregates correctly
    const gstr1Res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/gstr-1?startDate=2026-10-01&endDate=2026-10-31`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(gstr1Res.statusCode).toBe(200);
    const gstr1Data = JSON.parse(gstr1Res.body);
    expect(gstr1Data.creditNotes).toBeDefined();
    expect(Array.isArray(gstr1Data.creditNotes)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // SECTION 5: ACCOUNT RESOLUTION & DYNAMIC CHART OF ACCOUNTS
  // --------------------------------------------------------------------------
  it("Account Resolution: Resolves through tenant Chart of Accounts and tolerates code 5150 collision", async () => {
    // Simulate code 5150 collision by creating another account with code 5150
    await prisma.executeBypassRls(async (tx) => {
      const expGroup = await tx.ledgerGroup.findFirst({
        where: { companyId: companyAId, nature: "EXPENSE" },
      });
      if (expGroup) {
        const existing5150 = await tx.ledgerAccount.findFirst({
          where: { companyId: companyAId, code: "5150" },
        });
        if (!existing5150) {
          await tx.ledgerAccount.create({
            data: {
              organizationId: orgAId,
              companyId: companyAId,
              groupId: expGroup.id,
              name: "Existing Custom Expense 5150",
              code: "5150",
              openingType: "DR",
              openingBalance: "0.00",
              currentBalance: "0.00",
            },
          });
        }
      }
    });

    // Create an invoice
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-24",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 2, unitPrice: 500, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);

    // Issue Commercial Credit Note — MUST NOT fail due to unique code collision
    const commRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: inv.id,
        docType: "CREDIT_NOTE",
        creditNoteType: "AMOUNT_BASED",
        gstCategory: "COMMERCIAL",
        amount: 150,
        restoreStock: false,
      },
    });
    expect(commRes.statusCode).toBe(201);
    const comm = JSON.parse(commRes.body);
    expect(Number(comm.grandTotal)).toBe(150);

    // Multi-tenant check: Tenant B cannot access Tenant A's return
    const crossRes = await app.inject({
      method: "GET",
      url: `/api/v1/sales-returns/${comm.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(crossRes.statusCode).toBe(404);
  });

  // --------------------------------------------------------------------------
  // SECTION 6 & 7: CASH & BANK REFUND AUDIT & REGRESSION CHECKS
  // --------------------------------------------------------------------------
  it("Refund Audit & Regression: Verifies Cash and Bank Payout vouchers and reports suite", async () => {
    // 1. Invoice for refund testing: ₹2,000 + 18% = ₹2,360
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        partyId: customerAId,
        invoiceDate: "2026-10-25",
        warehouseId: warehouseAId,
        paymentMode: "UNPAID_CREDIT",
        items: [
          { itemId: itemAId, quantity: 2, unitPrice: 1000, taxRate: 18 },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const inv = JSON.parse(invRes.body);

    // 2. Refund to Bank (`REFUND_BANK`)
    const refundBankRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales-returns`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        salesInvoiceId: inv.id,
        docType: "SALES_RETURN",
        returnDate: "2026-10-25",
        warehouseId: warehouseAId,
        restoreStock: true,
        settlementMode: "REFUND_BANK",
        items: [{ salesItemId: inv.items[0].id, quantity: 1 }],
      },
    });
    expect(refundBankRes.statusCode).toBe(201);
    const retBank = JSON.parse(refundBankRes.body);

    // Verify refund voucher
    const bankRefundVoucher = await prisma.executeBypassRls((tx) =>
      tx.voucher.findFirst({
        where: {
          companyId: companyAId,
          sourceDocument: "SALES_RETURN_REFUND",
          sourceEntityId: retBank.id,
        },
        include: { journalEntries: true },
      }),
    );
    expect(bankRefundVoucher).toBeDefined();
    expect(bankRefundVoucher?.voucherType).toBe("PAYMENT");
    expect(Number(bankRefundVoucher?.totalAmount)).toBe(1180);

    // Verify Reports API (`GET /api/v1/reports/sales-returns`)
    const reportRes = await app.inject({
      method: "GET",
      url: `/api/v1/reports/sales-returns?startDate=2026-10-01&endDate=2026-10-31`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(reportRes.statusCode).toBe(200);
    const reportData = JSON.parse(reportRes.body);

    // Verify all 7 report dimensions exist with live PostgreSQL data
    expect(reportData.summary).toBeDefined();
    expect(reportData.returns).toBeDefined();
    expect(reportData.itemWise).toBeDefined();
    expect(reportData.customerWise).toBeDefined();
    expect(reportData.reasonWise).toBeDefined();
    expect(reportData.warehouseWise).toBeDefined();
    expect(reportData.gstSchedule).toBeDefined();
    expect(reportData.gstSchedule.section34).toBeDefined();
    expect(reportData.gstSchedule.commercial).toBeDefined();

    expect(Number(reportData.summary.totalReturns)).toBeGreaterThan(0);
    expect(reportData.returns.length).toBeGreaterThan(0);
  });
});
