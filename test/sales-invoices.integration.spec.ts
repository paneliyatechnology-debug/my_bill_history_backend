import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import {
  InvoiceCategory,
  InvoiceStatus,
  PaymentMode,
  StockTransactionType,
} from "@billing/shared-types";

describe("Phase 5: Sales Billing, POS Engine & Stock Ledger (Integration)", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tenantAOrgId: string;
  let tenantACompanyId: string;
  let tenantABranchId: string;
  let tenantAToken: string;
  let tenantAFinancialYearId: string;

  let tenantBOrgId: string;
  let tenantBCompanyId: string;
  let tenantBToken: string;

  let customerGujaratId: string;
  let customerMaharashtraId: string;
  let productTeaId: string;
  let productSugarId: string;
  let serviceConsultingId: string;
  let lockedFyId: string;

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

    // Clean up test data for phones used in this suite
    await prisma.executeBypassRls(async (tx) => {
      const testPhones = ["9898000005", "9898000006"];
      const users = await tx.user.findMany({
        where: { phone: { in: testPhones } },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.stockTransaction.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.paymentAllocation.deleteMany({
          where: { salesInvoice: { organizationId: { in: orgIds } } },
        });
        await tx.salesInvoiceItem.deleteMany({
          where: { invoice: { organizationId: { in: orgIds } } },
        });
        await tx.salesInvoice.deleteMany({
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
        await tx.warehouse.deleteMany({
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
        await tx.userBranchAssignment.deleteMany({
          where: { branch: { organizationId: { in: orgIds } } },
        });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.financialYear.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.invoiceSequence.deleteMany({
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

    // 1. Setup Tenant A (Gujarat State 24)
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Billing Admin A",
        phone: "9898000005",
        email: "billingA@test.local",
        password: "PasswordBilling123#",
        organizationName: "Gujarat Kirana Stores A",
        tradeName: "GK Stores Ahmedabad",
        stateCode: "24",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const bodyA = JSON.parse(regResA.body);
    tenantAToken = bodyA.accessToken;
    tenantAOrgId = bodyA.defaultContext.organizationId;
    tenantACompanyId = bodyA.defaultContext.companyId;

    // Fetch Branch & FY for Tenant A
    const branchA = await prisma.executeBypassRls(async (tx) => {
      return await tx.branch.findFirst({
        where: { companyId: tenantACompanyId },
      });
    });
    tenantABranchId = branchA!.id;

    const fyA = await prisma.executeBypassRls(async (tx) => {
      return await tx.financialYear.findFirst({
        where: { companyId: tenantACompanyId, isCurrent: true },
      });
    });
    tenantAFinancialYearId = fyA!.id;

    // Create a past locked financial year for period lock test
    const lockedFy = await prisma.executeBypassRls(async (tx) => {
      return await tx.financialYear.create({
        data: {
          companyId: tenantACompanyId,
          name: "FY 2024-25 (Locked)",
          startDate: new Date("2024-04-01T00:00:00.000Z"),
          endDate: new Date("2025-03-31T23:59:59.999Z"),
          isLocked: true,
          isCurrent: false,
        },
      });
    });
    lockedFyId = lockedFy.id;

    // 2. Setup Tenant B (Rajkot State 24)
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Billing Admin B",
        phone: "9898000006",
        email: "billingB@test.local",
        password: "PasswordBilling123#",
        organizationName: "Saurashtra Trading B",
        tradeName: "Saurashtra Trading Rajkot",
        stateCode: "24",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const bodyB = JSON.parse(regResB.body);
    tenantBToken = bodyB.accessToken;
    tenantBOrgId = bodyB.defaultContext.organizationId;
    tenantBCompanyId = bodyB.defaultContext.companyId;

    // 3. Create Master Data for Tenant A
    // UOM (KGS, PCS)
    const uom = await prisma.executeBypassRls(async (tx) => {
      return await tx.unitOfMeasure.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          name: "Kilogram",
          symbol: "KG",
          uqcCode: "KGS",
        },
      });
    });

    // Warehouse
    const wh = await prisma.executeBypassRls(async (tx) => {
      return await tx.warehouse.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          branchId: tenantABranchId,
          name: "Central Warehouse A",
          isDefault: true,
        },
      });
    });

    // Items
    // Product 1: Wagh Bakri Tea (5% GST)
    const tea = await prisma.executeBypassRls(async (tx) => {
      return await tx.item.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: "PRODUCT",
          name: "Wagh Bakri Premium Tea 500g",
          nameGujarati: "વાઘ બકરી પ્રીમિયમ ચા ૫૦૦ ગ્રામ",
          hsnCode: "0902",
          primaryUomId: uom.id,
          taxRate: 5.0,
          purchaseRate: 250.0,
          retailPrice: 295.0,
          wholesalePrice: 280.0,
        },
      });
    });
    productTeaId = tea.id;

    // Product 2: Sugar (5% GST)
    const sugar = await prisma.executeBypassRls(async (tx) => {
      return await tx.item.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: "PRODUCT",
          name: "Madhur Pure Sugar 1kg",
          nameGujarati: "મધુર શુદ્ધ ખાંડ ૧ કિલો",
          hsnCode: "1701",
          primaryUomId: uom.id,
          taxRate: 5.0,
          purchaseRate: 40.0,
          retailPrice: 48.0,
          wholesalePrice: 45.0,
        },
      });
    });
    productSugarId = sugar.id;

    // Service Item: Delivery & Loading Service (18% GST)
    const service = await prisma.executeBypassRls(async (tx) => {
      return await tx.item.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: "SERVICE",
          name: "Doorstep Express Delivery Service",
          nameGujarati: "ઘેરબેઠા ડિલિવરી સેવા",
          hsnCode: "9968",
          primaryUomId: uom.id,
          taxRate: 18.0,
          purchaseRate: 0.0,
          retailPrice: 200.0,
        },
      });
    });
    serviceConsultingId = service.id;

    // Initial Inward Stock for Tea: 50 units
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          warehouseId: wh.id,
          itemId: productTeaId,
          transactionType: StockTransactionType.OPENING,
          transactionDate: new Date(),
          quantity: 50.0,
          valuationRate: 250.0,
          totalValuation: 12500.0,
          isProvisionalCost: false,
          referenceDocType: "OPENING",
          referenceDocId: "00000000-0000-0000-0000-000000000000",
        },
      });
    });

    // Customers:
    // Customer 1: Intra-state Gujarat Customer (24)
    const custGuj = await prisma.executeBypassRls(async (tx) => {
      return await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: "CUSTOMER",
          name: "Patel Provision Store Ahmedabad",
          nameGujarati: "પટેલ પ્રોવિઝન સ્ટોર અમદાવાદ",
          phone: "9825011111",
          stateCode: "24",
          gstin: "24AAACP1234A1Z5",
          gstType: "REGULAR",
          billingAddress: { city: "Ahmedabad", pincode: "380001" },
        },
      });
    });
    customerGujaratId = custGuj.id;

    // Customer 2: Inter-state Maharashtra Customer (27)
    const custMah = await prisma.executeBypassRls(async (tx) => {
      return await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: "CUSTOMER",
          name: "Mumbai Wholesale Traders",
          nameGujarati: "મુંબઈ હોલસેલ ટ્રેડર્સ",
          phone: "9825022222",
          stateCode: "27",
          gstin: "27AAACM5678B1Z2",
          gstType: "REGULAR",
          billingAddress: { city: "Mumbai", pincode: "400001" },
        },
      });
    });
    customerMaharashtraId = custMah.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // --- REQUIREMENT 1: Concurrency-Safe Invoice Numbering ---
  describe("1. Concurrency-Safe Invoice Numbering", () => {
    it("should generate sequential, collision-free legal invoice numbers under concurrent load", async () => {
      const concurrentRequests = 5;
      const promises = Array.from({ length: concurrentRequests }, (_, i) =>
        app.inject({
          method: "POST",
          url: "/api/v1/invoices/sales",
          headers: {
            authorization: `Bearer ${tenantAToken}`,
          },
          payload: {
            category: InvoiceCategory.TAX_INVOICE,
            partyId: customerGujaratId,
            paymentMode: PaymentMode.CASH,
            items: [
              {
                itemId: serviceConsultingId, // service item, no stock constraint
                quantity: 1,
                unitPrice: 100,
                taxRate: 18,
              },
            ],
          },
        }),
      );

      const responses = await Promise.all(promises);

      for (const res of responses) {
        expect(res.statusCode).toBe(201);
      }

      const invoiceNumbers = responses.map(
        (r) => JSON.parse(r.body).invoiceNumber,
      );

      // Verify all invoice numbers are unique
      const uniqueNumbers = new Set(invoiceNumbers);
      expect(uniqueNumbers.size).toBe(concurrentRequests);

      // Verify numbering format INV/YY-YY/XXXX
      for (const num of invoiceNumbers) {
        expect(num).toMatch(/^INV\/\d{2}-\d{2}\/\d{4}$/);
      }
    });
  });

  // --- REQUIREMENT 2: Idempotency & Duplicate Prevention ---
  describe("2. Idempotency & Network Retry Safety", () => {
    it("should replay existing invoice without creating duplicate on duplicate Idempotency-Key", async () => {
      const idempotencyKey = "idemp-sales-key-uuid-1001";

      const res1 = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "idempotency-key": idempotencyKey,
        },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 2,
              unitPrice: 200,
              taxRate: 18,
            },
          ],
        },
      });

      expect(res1.statusCode).toBe(201);
      const invoice1 = JSON.parse(res1.body);

      // Duplicate retry
      const res2 = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "idempotency-key": idempotencyKey,
        },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 2,
              unitPrice: 200,
              taxRate: 18,
            },
          ],
        },
      });

      expect(res2.statusCode).toBe(201);
      const invoice2 = JSON.parse(res2.body);

      expect(invoice2.id).toBe(invoice1.id);
      expect(invoice2.invoiceNumber).toBe(invoice1.invoiceNumber);
    });
  });

  // --- REQUIREMENT 3: Exact Decimal GST Calculations & Round-Off ---
  describe("3. Statutory GST Calculations: Intra vs Inter-State", () => {
    it("should calculate intra-state GST (50% CGST + 50% SGST) with Section 170 round-off", async () => {
      // 10 units @ 295.00 = 2950.00 subtotal, 2% discount = 59.00 -> 2891.00 taxable
      // 5% GST -> 2.5% CGST (72.28) + 2.5% SGST (72.28) = 144.56 tax
      // Grand Total before round = 3035.56 -> Round off +0.44 -> Grand Total = 3036.00
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.UNPAID_CREDIT,
          items: [
            {
              itemId: productTeaId,
              quantity: 10,
              unitPrice: 295.0,
              discountPercent: 2.0,
              taxRate: 5.0,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);

      expect(Number(inv.subTotal)).toBe(2950.0);
      expect(Number(inv.discountTotal)).toBe(59.0);
      expect(Number(inv.taxableAmount)).toBe(2891.0);
      expect(Number(inv.cgstAmount)).toBe(72.28);
      expect(Number(inv.sgstAmount)).toBe(72.28);
      expect(Number(inv.igstAmount)).toBe(0.0);
      expect(Number(inv.roundOff)).toBe(0.44);
      expect(Number(inv.grandTotal)).toBe(3036.0);
      expect(inv.grandTotalWords).toBe("Three Thousand Thirty Six Rupees Only");
      expect(inv.grandTotalWordsGujarati).toBe(
        "અક્ષરે રૂપિયા ત્રણ હજાર છત્રીસ પુરા",
      );
    });

    it("should calculate inter-state GST (100% IGST) across state boundaries", async () => {
      // Inter-state dispatch to Maharashtra (27)
      // 5 units @ 200.00 = 1000.00, 18% IGST = 180.00, total = 1180.00
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerMaharashtraId,
          paymentMode: PaymentMode.UNPAID_CREDIT,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 5,
              unitPrice: 200.0,
              taxRate: 18.0,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);

      expect(Number(inv.cgstAmount)).toBe(0.0);
      expect(Number(inv.sgstAmount)).toBe(0.0);
      expect(Number(inv.igstAmount)).toBe(180.0);
      expect(Number(inv.grandTotal)).toBe(1180.0);
    });
  });

  // --- REQUIREMENT 4: Cash Sales vs Credit Sales ---
  describe("4. Cash Sales vs Credit Sales Handling", () => {
    it("should mark cash sales as PAID with zero balance and debit Cash Account", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 500,
              taxRate: 18,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);

      expect(inv.status).toBe(InvoiceStatus.PAID);
      expect(Number(inv.paidAmount)).toBe(Number(inv.grandTotal));
      expect(Number(inv.balanceAmount)).toBe(0);

      // Verify voucher lines
      const details = await app.inject({
        method: "GET",
        url: `/api/v1/invoices/sales/${inv.id}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      const data = JSON.parse(details.body);
      expect(data.voucher).toBeDefined();
      const cashEntry = data.voucher.journalEntries.find(
        (e: any) => e.account.name === "Cash Account",
      );
      expect(cashEntry).toBeDefined();
      expect(Number(cashEntry.debitAmount)).toBe(Number(inv.grandTotal));
    });

    it("should mark credit sales as ISSUED with full balance and debit Customer ledger", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.UNPAID_CREDIT,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 500,
              taxRate: 18,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);

      expect(inv.status).toBe(InvoiceStatus.ISSUED);
      expect(Number(inv.paidAmount)).toBe(0);
      expect(Number(inv.balanceAmount)).toBe(Number(inv.grandTotal));
    });
  });

  // --- REQUIREMENT 5: Stock Insufficiency & Negative Stock Protection ---
  describe("5. Stock Insufficiency & Append-Only Ledger", () => {
    it("should reject invoice creation when physical stock is insufficient and negative stock is disallowed", async () => {
      // Current Tea stock is 50 - 10 = 40. Requesting 1000 units must fail.
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: productTeaId,
              quantity: 1000, // Insufficient!
              unitPrice: 295.0,
              taxRate: 5.0,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const err = JSON.parse(res.body);
      expect(err.message).toContain("Insufficient stock");
    });

    it("should append negative quantity stock_transactions on successful sales dispatch", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: productTeaId,
              quantity: 2,
              unitPrice: 295.0,
              taxRate: 5.0,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);

      // Verify stock transaction
      const stockTx = await prisma.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findFirst({
          where: {
            referenceDocId: inv.id,
            transactionType: StockTransactionType.SALES_DISPATCH,
          },
        });
      });

      expect(stockTx).toBeDefined();
      expect(Number(stockTx!.quantity)).toBe(-2.0); // Append-only outward dispatch
    });
  });

  // --- REQUIREMENT 6: Double-Entry Balance Invariance & Atomicity ---
  describe("6. Double-Entry Invariants & Transaction Atomicity", () => {
    it("should create a perfectly balanced sales voucher (Debits == Credits)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 2,
              unitPrice: 150.0,
              taxRate: 18.0,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);

      const details = await app.inject({
        method: "GET",
        url: `/api/v1/invoices/sales/${inv.id}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });

      const data = JSON.parse(details.body);
      expect(data.voucher).toBeDefined();

      const totalDr = data.voucher.journalEntries.reduce(
        (sum: number, l: any) => sum + Number(l.debitAmount),
        0,
      );
      const totalCr = data.voucher.journalEntries.reduce(
        (sum: number, l: any) => sum + Number(l.creditAmount),
        0,
      );

      expect(Math.abs(totalDr - totalCr)).toBeLessThan(0.001);
      expect(totalDr).toBe(Number(inv.grandTotal));
    });

    it("should roll back entire transaction if any line item is invalid", async () => {
      const beforeInvoices = await prisma.executeBypassRls(async (tx) => {
        return await tx.salesInvoice.count({
          where: { companyId: tenantACompanyId },
        });
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: "00000000-0000-0000-0000-000000000000", // Non-existent!
              quantity: 1,
              unitPrice: 100,
              taxRate: 18,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);

      const afterInvoices = await prisma.executeBypassRls(async (tx) => {
        return await tx.salesInvoice.count({
          where: { companyId: tenantACompanyId },
        });
      });

      expect(afterInvoices).toBe(beforeInvoices);
    });
  });

  // --- REQUIREMENT 7: Invoice Cancellation & Voucher Reversal ---
  describe("7. Statutory Invoice Cancellation & Contra Reversal", () => {
    it("should mark invoice CANCELLED, reverse sales voucher, and restore stock", async () => {
      // 1. Create invoice with physical goods
      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: productTeaId,
              quantity: 3,
              unitPrice: 295.0,
              taxRate: 5.0,
            },
          ],
        },
      });

      expect(createRes.statusCode).toBe(201);
      const inv = JSON.parse(createRes.body);

      // 2. Cancel the invoice
      const cancelRes = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${inv.id}/cancel`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          cancellationReason: "Customer canceled order before dispatch",
        },
      });

      expect(cancelRes.statusCode).toBe(200);
      const cancelledInv = JSON.parse(cancelRes.body);
      expect(cancelledInv.status).toBe(InvoiceStatus.CANCELLED);

      // 3. Verify stock restoration
      const restoreStock = await prisma.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findFirst({
          where: {
            referenceDocId: inv.id,
            transactionType: StockTransactionType.SALES_CANCELLATION,
          },
        });
      });

      expect(restoreStock).toBeDefined();
      expect(Number(restoreStock!.quantity)).toBe(3.0); // Restored stock

      // 4. Verify reversal voucher created
      const revVoucher = await prisma.executeBypassRls(async (tx) => {
        return await tx.voucher.findFirst({
          where: {
            sourceEntityId: inv.id,
            voucherNumber: { startsWith: "REV/" },
          },
        });
      });

      expect(revVoucher).toBeDefined();
    });
  });

  // --- REQUIREMENT 8: Financial Period Lock Enforcement ---
  describe("8. Period Lock Validation", () => {
    it("should reject invoice creation in a locked financial year", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          invoiceDate: "2024-06-15", // In locked FY 2024-25
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 100,
              taxRate: 18,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const err = JSON.parse(res.body);
      expect(err.message).toContain("locked");
    });
  });

  // --- REQUIREMENT 9: Cross-Tenant Isolation (RLS Security) ---
  describe("9. Cross-Tenant Security & Isolation", () => {
    it("should prevent Tenant B from accessing or viewing Tenant A's sales invoices", async () => {
      // Create invoice for Tenant A
      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 100,
              taxRate: 18,
            },
          ],
        },
      });

      expect(createRes.statusCode).toBe(201);
      const invA = JSON.parse(createRes.body);

      // Attempt access by Tenant B
      const getResB = await app.inject({
        method: "GET",
        url: `/api/v1/invoices/sales/${invA.id}`,
        headers: { authorization: `Bearer ${tenantBToken}` },
      });

      expect(getResB.statusCode).toBe(404);

      // Verify Tenant B's listing does not show Tenant A's invoice
      const listResB = await app.inject({
        method: "GET",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantBToken}` },
      });

      expect(listResB.statusCode).toBe(200);
      const listDataB = JSON.parse(listResB.body);
      const foundInB = listDataB.items.some((i: any) => i.id === invA.id);
      expect(foundInB).toBe(false);
    });
  });

  // --- REQUIREMENT 10: POS Checkout & Offline IndexedDB Batch Sync ---
  describe("10. POS Checkout & Offline Sync Engine", () => {
    it("should process walk-in retail POS checkout with automatic customer resolution", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          customerPhone: "9824055667",
          customerName: "Walk-in Retail Cash Customer",
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 350.0,
              taxRate: 18.0,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);
      expect(inv.status).toBe(InvoiceStatus.PAID);
      expect(inv.invoiceNumber).toMatch(/^INV\/\d{2}-\d{2}\/\d{4}$/);
    });

    it("should process batch offline POS IndexedDB sync and return assigned legal numbers", async () => {
      const offlineUuid = "01925b6e-1d54-7128-874b-ef479e0a6d10";

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-sync",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          terminalId: "POS_TERMINAL_SURAT_01",
          syncTimestamp: new Date().toISOString(),
          invoices: [
            {
              clientOfflineUuid: offlineUuid,
              offlineBillNumber: "POS01-OFF-0001",
              paymentMode: PaymentMode.CASH,
              items: [
                {
                  itemId: serviceConsultingId,
                  quantity: 2,
                  unitPrice: 100.0,
                  taxRate: 18.0,
                },
              ],
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const syncResult = JSON.parse(res.body);

      expect(syncResult.processedCount).toBe(1);
      expect(syncResult.failedCount).toBe(0);
      expect(syncResult.results[0].status).toBe("SYNCED");
      expect(syncResult.results[0].assignedInvoiceNumber).toMatch(
        /^INV\/\d{2}-\d{2}\/\d{4}$/,
      );

      // Re-syncing the same offline UUID must not create a new invoice (idempotent deduplication)
      const resRetry = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-sync",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          terminalId: "POS_TERMINAL_SURAT_01",
          syncTimestamp: new Date().toISOString(),
          invoices: [
            {
              clientOfflineUuid: offlineUuid,
              items: [
                {
                  itemId: serviceConsultingId,
                  quantity: 2,
                  unitPrice: 100.0,
                  taxRate: 18.0,
                },
              ],
            },
          ],
        },
      });

      const retryResult = JSON.parse(resRetry.body);
      expect(retryResult.processedCount).toBe(1);
      expect(retryResult.results[0].assignedInvoiceNumber).toBe(
        syncResult.results[0].assignedInvoiceNumber,
      );
    });

    it("should idempotently replay existing invoice on duplicate POS checkout retry with identical clientOfflineUuid", async () => {
      const offlineUuid = "pos-retry-uuid-" + Date.now();
      const payload = {
        clientOfflineUuid: offlineUuid,
        offlineBillNumber: "POS01-OFF-RETRY",
        paymentMode: PaymentMode.CASH,
        items: [
          {
            itemId: serviceConsultingId,
            quantity: 1,
            unitPrice: 500.0,
            taxRate: 18.0,
          },
        ],
      };

      const res1 = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload,
      });

      expect(res1.statusCode).toBe(201);
      const inv1 = JSON.parse(res1.body);
      expect(inv1.clientOfflineUuid).toBe(offlineUuid);

      // Duplicate retry with identical payload and clientOfflineUuid
      const res2 = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload,
      });

      expect(res2.statusCode).toBe(201);
      const inv2 = JSON.parse(res2.body);
      expect(inv2.id).toBe(inv1.id);
      expect(inv2.invoiceNumber).toBe(inv1.invoiceNumber);

      // Verify in DB that only 1 invoice exists
      const dbInvoices = await prisma.executeBypassRls(async (tx) => {
        return await tx.salesInvoice.findMany({
          where: {
            companyId: tenantACompanyId,
            clientOfflineUuid: offlineUuid,
          },
        });
      });
      expect(dbInvoices.length).toBe(1);

      // Verify only 1 voucher was created
      const dbVouchers = await prisma.executeBypassRls(async (tx) => {
        return await tx.voucher.findMany({
          where: {
            companyId: tenantACompanyId,
            sourceDocument: "SALES_INVOICE",
            sourceEntityId: inv1.id,
          },
        });
      });
      expect(dbVouchers.length).toBe(1);
    });

    it("should handle concurrent duplicate POS checkout requests safely without duplicate records or extra vouchers", async () => {
      const concurrentUuid = "pos-concurrent-" + Date.now();
      const payload = {
        clientOfflineUuid: concurrentUuid,
        customerPhone: "9824099887",
        customerName: "Concurrent Walk-in Customer",
        paymentMode: PaymentMode.CASH,
        items: [
          {
            itemId: serviceConsultingId,
            quantity: 2,
            unitPrice: 200.0,
            taxRate: 18.0,
          },
        ],
      };

      const [res1, res2] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/v1/invoices/pos-checkout",
          headers: { authorization: `Bearer ${tenantAToken}` },
          payload,
        }),
        app.inject({
          method: "POST",
          url: "/api/v1/invoices/pos-checkout",
          headers: { authorization: `Bearer ${tenantAToken}` },
          payload,
        }),
      ]);

      expect(res1.statusCode).toBe(201);
      expect(res2.statusCode).toBe(201);

      const inv1 = JSON.parse(res1.body);
      const inv2 = JSON.parse(res2.body);
      expect(inv1.id).toBe(inv2.id);
      expect(inv1.invoiceNumber).toBe(inv2.invoiceNumber);

      const dbInvoices = await prisma.executeBypassRls(async (tx) => {
        return await tx.salesInvoice.findMany({
          where: {
            companyId: tenantACompanyId,
            clientOfflineUuid: concurrentUuid,
          },
        });
      });
      expect(dbInvoices.length).toBe(1);

      const dbVouchers = await prisma.executeBypassRls(async (tx) => {
        return await tx.voucher.findMany({
          where: {
            companyId: tenantACompanyId,
            sourceDocument: "SALES_INVOICE",
            sourceEntityId: inv1.id,
          },
        });
      });
      expect(dbVouchers.length).toBe(1);
    });

    it("should reject conflicting idempotency key reuse with different sale details with 409 Conflict", async () => {
      const conflictUuid = "pos-conflict-" + Date.now();

      // Original checkout
      const resOriginal = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          clientOfflineUuid: conflictUuid,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 100.0,
              taxRate: 18.0,
            },
          ],
        },
      });
      expect(resOriginal.statusCode).toBe(201);

      // Conflicting checkout reusing same clientOfflineUuid with different quantity
      const resConflict = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          clientOfflineUuid: conflictUuid,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 10, // CONFLICTING QUANTITY
              unitPrice: 100.0,
              taxRate: 18.0,
            },
          ],
        },
      });
      expect(resConflict.statusCode).toBe(409);
      const conflictErr = JSON.parse(resConflict.body);
      expect(conflictErr.message).toMatch(/conflicting idempotency key reuse/i);
    });

    it("should deduplicate offline sync when bill was already checked out online", async () => {
      const onlineUuid = "pos-online-then-sync-" + Date.now();

      // 1. Process online POS checkout
      const onlineRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          clientOfflineUuid: onlineUuid,
          offlineBillNumber: "POS01-OFF-ONLINE",
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 250.0,
              taxRate: 18.0,
            },
          ],
        },
      });
      expect(onlineRes.statusCode).toBe(201);
      const onlineInv = JSON.parse(onlineRes.body);

      // 2. Client offline queue sends pos-sync for the same clientOfflineUuid
      const syncRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-sync",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          terminalId: "POS_TERMINAL_SURAT_01",
          syncTimestamp: new Date().toISOString(),
          invoices: [
            {
              clientOfflineUuid: onlineUuid,
              offlineBillNumber: "POS01-OFF-ONLINE",
              items: [
                {
                  itemId: serviceConsultingId,
                  quantity: 1,
                  unitPrice: 250.0,
                  taxRate: 18.0,
                },
              ],
            },
          ],
        },
      });

      expect(syncRes.statusCode).toBe(200);
      const syncData = JSON.parse(syncRes.body);
      expect(syncData.results[0].status).toBe("SYNCED");
      expect(syncData.results[0].serverInvoiceId).toBe(onlineInv.id);
      expect(syncData.results[0].assignedInvoiceNumber).toBe(
        onlineInv.invoiceNumber,
      );

      // Ensure no duplicate invoices were created in DB
      const dbInvoices = await prisma.executeBypassRls(async (tx) => {
        return await tx.salesInvoice.findMany({
          where: {
            companyId: tenantACompanyId,
            clientOfflineUuid: onlineUuid,
          },
        });
      });
      expect(dbInvoices.length).toBe(1);
    });

    it("should correctly route CASH payments to Cash Account in general ledger voucher", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 100.0,
              taxRate: 18.0,
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);

      const voucher = await prisma.executeBypassRls(async (tx) => {
        return await tx.voucher.findFirst({
          where: {
            sourceEntityId: inv.id,
            companyId: tenantACompanyId,
          },
          include: {
            journalEntries: {
              include: { account: true },
            },
          },
        });
      });

      expect(voucher).toBeDefined();
      const drLine = voucher!.journalEntries.find(
        (je) => Number(je.debitAmount) > 0,
      );
      expect(drLine).toBeDefined();
      expect(drLine!.account.name).toBe("Cash Account");
      expect(Number(drLine!.debitAmount)).toBe(118.0);
    });

    it("should correctly route UPI payments to UPI or Bank Account (not Cash Account)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          paymentMode: PaymentMode.UPI_QR,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 200.0,
              taxRate: 18.0,
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);

      const voucher = await prisma.executeBypassRls(async (tx) => {
        return await tx.voucher.findFirst({
          where: {
            sourceEntityId: inv.id,
            companyId: tenantACompanyId,
          },
          include: {
            journalEntries: {
              include: { account: true },
            },
          },
        });
      });

      expect(voucher).toBeDefined();
      const drLine = voucher!.journalEntries.find(
        (je) => Number(je.debitAmount) > 0,
      );
      expect(drLine).toBeDefined();
      // Must NOT be Cash Account
      expect(drLine!.account.name).not.toBe("Cash Account");
      expect(
        drLine!.account.name === "UPI Account" ||
          drLine!.account.isBankLedger === true,
      ).toBe(true);
      expect(Number(drLine!.debitAmount)).toBe(236.0);
    });

    it("should correctly route CARD and Bank Transfer payments to Bank Account (not Cash Account)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          paymentMode: PaymentMode.BANK_TRANSFER,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 300.0,
              taxRate: 18.0,
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);

      const voucher = await prisma.executeBypassRls(async (tx) => {
        return await tx.voucher.findFirst({
          where: {
            sourceEntityId: inv.id,
            companyId: tenantACompanyId,
          },
          include: {
            journalEntries: {
              include: { account: true },
            },
          },
        });
      });

      expect(voucher).toBeDefined();
      const drLine = voucher!.journalEntries.find(
        (je) => Number(je.debitAmount) > 0,
      );
      expect(drLine).toBeDefined();
      expect(drLine!.account.name).not.toBe("Cash Account");
      expect(
        drLine!.account.name === "Bank Account" ||
          drLine!.account.isBankLedger === true,
      ).toBe(true);
      expect(Number(drLine!.debitAmount)).toBe(354.0);
    });

    it("should process split-tender checkout, posting balanced multi-debit voucher matching tendered amounts", async () => {
      // 500 unit price * 1 + 18% GST (90) = 590 total
      // Split: Cash 200, UPI 250, Bank Transfer 140 (Total: 590)
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          customerName: "Split Tender Customer",
          tenderedSplit: {
            cash: 200.0,
            upiQr: 250.0,
            bankTransfer: 140.0,
          },
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 500.0,
              taxRate: 18.0,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);
      expect(inv.status).toBe(InvoiceStatus.PAID);
      expect(inv.paymentMode).toBe(PaymentMode.SPLIT);
      expect(Number(inv.grandTotal)).toBe(590.0);

      const voucher = await prisma.executeBypassRls(async (tx) => {
        return await tx.voucher.findFirst({
          where: {
            sourceEntityId: inv.id,
            companyId: tenantACompanyId,
          },
          include: {
            journalEntries: {
              include: { account: true },
            },
          },
        });
      });

      expect(voucher).toBeDefined();
      const debits = voucher!.journalEntries.filter(
        (je) => Number(je.debitAmount) > 0,
      );
      const credits = voucher!.journalEntries.filter(
        (je) => Number(je.creditAmount) > 0,
      );

      const totalDebit = debits.reduce(
        (sum, d) => sum + Number(d.debitAmount),
        0,
      );
      const totalCredit = credits.reduce(
        (sum, c) => sum + Number(c.creditAmount),
        0,
      );

      expect(totalDebit).toBe(590.0);
      expect(totalCredit).toBe(590.0);

      // Verify separate debit lines exist for Cash, UPI, and Bank
      const cashDebit = debits.find((d) => d.account.name === "Cash Account");
      expect(cashDebit).toBeDefined();
      expect(Number(cashDebit!.debitAmount)).toBe(200.0);

      const upiDebit = debits.find(
        (d) =>
          d.account.name === "UPI Account" ||
          (d.account.isBankLedger && Boolean(d.lineNarration?.includes("UPI"))),
      );
      expect(upiDebit).toBeDefined();
      expect(Number(upiDebit!.debitAmount)).toBe(250.0);

      const bankDebit = debits.find(
        (d) =>
          d.account.name === "Bank Account" ||
          (d.account.isBankLedger &&
            Boolean(d.lineNarration?.includes("Bank Transfer"))),
      );
      expect(bankDebit).toBeDefined();
      expect(Number(bankDebit!.debitAmount)).toBe(140.0);
    });

    it("should reject split-tender checkout with mismatched, negative, or invalid amounts", async () => {
      // 100 * 1.18 = 118 total
      // 1. Mismatched total (total 100 instead of 118)
      const resMismatched = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          tenderedSplit: {
            cash: 50.0,
            upiQr: 50.0,
          },
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 100.0,
              taxRate: 18.0,
            },
          ],
        },
      });
      expect(resMismatched.statusCode).toBe(400);
      expect(JSON.parse(resMismatched.body).message).toMatch(
        /does not match invoice grand total/i,
      );

      // 2. Negative amount in split
      const resNegative = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          tenderedSplit: {
            cash: -50.0,
            upiQr: 168.0,
          },
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 100.0,
              taxRate: 18.0,
            },
          ],
        },
      });
      expect(resNegative.statusCode).toBe(400);
      expect(JSON.parse(resNegative.body).message).toMatch(
        /non-negative, finite number/i,
      );
    });

    it("should reject POS checkout when receivedAmount is less than invoice total", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          paymentMode: PaymentMode.CASH,
          receivedAmount: 50.0, // Invoice total is 118
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 100.0,
              taxRate: 18.0,
            },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toMatch(
        /received amount.*is less than invoice grand total/i,
      );
    });

    it("should enforce tenant isolation so Tenant B cannot reuse or hijack Tenant A's idempotency key", async () => {
      const isoUuid = "tenant-iso-uuid-" + Date.now();

      // Tenant A creates invoice
      const resA = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          clientOfflineUuid: isoUuid,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 100.0,
              taxRate: 18.0,
            },
          ],
        },
      });
      expect(resA.statusCode).toBe(201);
      const invA = JSON.parse(resA.body);

      // Create an item for Tenant B so item resolution passes
      const itemB = await prisma.executeBypassRls(async (tx) => {
        let uom = await tx.unitOfMeasure.findFirst({
          where: { companyId: tenantBCompanyId },
        });
        if (!uom) {
          uom = await tx.unitOfMeasure.create({
            data: {
              organizationId: tenantBOrgId,
              companyId: tenantBCompanyId,
              name: "Piece",
              symbol: "PCS",
              uqcCode: "NOS",
            },
          });
        }
        return await tx.item.create({
          data: {
            organizationId: tenantBOrgId,
            companyId: tenantBCompanyId,
            type: "SERVICE",
            name: "Tenant B Consulting Service",
            hsnCode: "9983",
            primaryUomId: uom.id,
            taxRate: 18.0,
            retailPrice: 100.0,
          },
        });
      });

      // Tenant B tries to checkout using Tenant A's clientOfflineUuid
      const resB = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-checkout",
        headers: { authorization: `Bearer ${tenantBToken}` },
        payload: {
          clientOfflineUuid: isoUuid,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: itemB.id,
              quantity: 1,
              unitPrice: 100.0,
              taxRate: 18.0,
            },
          ],
        },
      });
      // Must be rejected with 409 Conflict
      expect(resB.statusCode).toBe(409);

      // Tenant B cannot view Tenant A's invoice
      const viewResB = await app.inject({
        method: "GET",
        url: `/api/v1/invoices/sales/${invA.id}`,
        headers: { authorization: `Bearer ${tenantBToken}` },
      });
      expect(viewResB.statusCode).toBe(404);
    });
  });

  // --- REQUIREMENT 11: Draft vs Issued Invoice Lifecycle ---
  describe("11. Draft vs Issued Invoice Lifecycle", () => {
    it("should create DRAFT invoice without reserving legal sequence, stock movement, or accounting voucher", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          isDraft: true,
          partyId: customerGujaratId,
          paymentMode: PaymentMode.UNPAID_CREDIT,
          items: [
            {
              itemId: productTeaId,
              quantity: 2,
              unitPrice: 200.0,
              taxRate: 5.0,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const draft = JSON.parse(res.body);

      expect(draft.status).toBe(InvoiceStatus.DRAFT);
      expect(draft.invoiceNumber).toMatch(/^DFT-/);
      expect(draft.voucher).toBeNull();

      // Verify no stock movements recorded for draft
      const stockMovements = await prisma.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findMany({
          where: {
            referenceDocType: "SALES_INVOICE",
            referenceDocId: draft.id,
          },
        });
      });
      expect(stockMovements.length).toBe(0);

      // Verify no voucher created in database
      const vouchers = await prisma.executeBypassRls(async (tx) => {
        return await tx.voucher.findMany({
          where: {
            sourceDocument: "SALES_INVOICE",
            sourceEntityId: draft.id,
          },
        });
      });
      expect(vouchers.length).toBe(0);

      // Now ISSUE the draft invoice
      const issueRes = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${draft.id}/issue`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });

      expect(issueRes.statusCode).toBe(200);
      const issued = JSON.parse(issueRes.body);

      expect(issued.status).toBe(InvoiceStatus.ISSUED);
      expect(issued.invoiceNumber).toMatch(/^INV\/\d{2}-\d{2}\/\d{4}$/);
      expect(issued.voucher).toBeDefined();
      expect(issued.voucher.balanced).toBe(true);

      // Verify stock movement is now recorded atomically
      const issuedStock = await prisma.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findMany({
          where: {
            referenceDocType: "SALES_INVOICE",
            referenceDocId: draft.id,
          },
        });
      });
      expect(issuedStock.length).toBe(1);
      expect(Number(issuedStock[0].quantity)).toBe(-2);

      // Issuing already issued invoice must be rejected
      const reIssueRes = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${draft.id}/issue`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(reIssueRes.statusCode).toBe(400);
    });
  });

  // --- REQUIREMENT 12: Tax-Inclusive Pricing & Exact Calculations ---
  describe("12. Tax-Inclusive Pricing Exact Decimal Calculations", () => {
    it("should calculate exact taxable value and taxes from MRP/tax-inclusive line price", async () => {
      // 1 item @ ₹118 gross, 18% tax -> Taxable = 100.00, CGST = 9.00, SGST = 9.00, Grand Total = 118.00
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 118.0,
              taxRate: 18.0,
              isTaxInclusive: true,
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);

      expect(Number(inv.taxableAmount)).toBe(100.0);
      expect(Number(inv.cgstAmount)).toBe(9.0);
      expect(Number(inv.sgstAmount)).toBe(9.0);
      expect(Number(inv.grandTotal)).toBe(118.0);
      expect(inv.grandTotalWords).toContain("One Hundred Eighteen");
      expect(inv.grandTotalWordsGujarati).toContain("એક સો અઢાર");
    });
  });

  // --- REQUIREMENT 13: Bill-by-Bill Payments & Overpayment Protection ---
  describe("13. Bill-by-Bill Payments & Receivables", () => {
    let creditInvoiceId: string;

    it("should create credit invoice and record partial payment", async () => {
      const invRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.UNPAID_CREDIT,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 1000.0,
              taxRate: 18.0,
            },
          ],
        },
      });

      expect(invRes.statusCode).toBe(201);
      const inv = JSON.parse(invRes.body);
      creditInvoiceId = inv.id;
      expect(inv.status).toBe(InvoiceStatus.ISSUED);
      expect(Number(inv.grandTotal)).toBe(1180.0);
      expect(Number(inv.balanceAmount)).toBe(1180.0);

      // Record Partial Payment of ₹500
      const payRes = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${creditInvoiceId}/payments`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          amount: 500.0,
          paymentMode: PaymentMode.BANK_TRANSFER,
          referenceNo: "NEFT-REF-778899",
          notes: "Partial payment installment 1",
        },
      });

      expect(payRes.statusCode).toBe(200);
      const payData = JSON.parse(payRes.body);

      expect(payData.invoice.status).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(Number(payData.invoice.paidAmount)).toBe(500.0);
      expect(Number(payData.invoice.balanceAmount)).toBe(680.0);
      expect(Number(payData.allocation.allocatedAmount)).toBe(500.0);
      expect(payData.voucher.voucherType).toBe("RECEIPT");

      // Verify payment allocation query
      const allocRes = await app.inject({
        method: "GET",
        url: `/api/v1/invoices/sales/${creditInvoiceId}/allocations`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(allocRes.statusCode).toBe(200);
      const allocs = JSON.parse(allocRes.body);
      expect(allocs.length).toBe(1);
      expect(Number(allocs[0].allocatedAmount)).toBe(500.0);
    });

    it("should reject overpayment exceeding remaining invoice balance", async () => {
      // Remaining balance is ₹680.00; attempting to pay ₹700.00
      const overpayRes = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${creditInvoiceId}/payments`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          amount: 700.0,
          paymentMode: PaymentMode.CASH,
        },
      });

      expect(overpayRes.statusCode).toBe(400);
      const err = JSON.parse(overpayRes.body);
      expect(err.message).toContain("exceeds outstanding invoice balance");
    });

    it("should settle full remaining balance with cash discount", async () => {
      // Settle remaining ₹680: Pay ₹650 + Cash Discount ₹30
      const settleRes = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${creditInvoiceId}/payments`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          amount: 650.0,
          cashDiscount: 30.0,
          paymentMode: PaymentMode.CASH,
          notes: "Final settlement with cash discount",
        },
      });

      expect(settleRes.statusCode).toBe(200);
      const settleData = JSON.parse(settleRes.body);

      expect(settleData.invoice.status).toBe(InvoiceStatus.PAID);
      expect(Number(settleData.invoice.paidAmount)).toBe(1180.0);
      expect(Number(settleData.invoice.balanceAmount)).toBe(0.0);

      // Attempting further payment on settled bill must be rejected
      const extraPayRes = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${creditInvoiceId}/payments`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          amount: 100.0,
        },
      });
      expect(extraPayRes.statusCode).toBe(400);
    });
  });

  // --- REQUIREMENT 14: Multi-Invoice Bill Settlement via Receipt Voucher ---
  describe("14. Multi-Bill Matching via Receipt Voucher", () => {
    it("should match received payment across multiple customer bills atomically", async () => {
      // Create Bill 1: ₹300
      const bill1Res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.UNPAID_CREDIT,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 254.24,
              taxRate: 18.0,
            },
          ],
        },
      });
      expect(bill1Res.statusCode).toBe(201);
      const bill1 = JSON.parse(bill1Res.body);

      // Create Bill 2: ₹200
      const bill2Res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.UNPAID_CREDIT,
          items: [
            {
              itemId: serviceConsultingId,
              quantity: 1,
              unitPrice: 169.49,
              taxRate: 18.0,
            },
          ],
        },
      });
      expect(bill2Res.statusCode).toBe(201);
      const bill2 = JSON.parse(bill2Res.body);

      const bill1Total = Number(bill1.grandTotal);
      const bill2Total = Number(bill2.grandTotal);
      const totalToPay = bill1Total + 100.0;

      // Single Receipt Voucher settling Bill 1 fully and Bill 2 partially
      const receiptRes = await app.inject({
        method: "POST",
        url: "/api/v1/vouchers/receipt",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          voucherDate: new Date().toISOString().split("T")[0],
          receivedAmount: totalToPay,
          allocations: [
            { invoiceId: bill1.id, settledAmount: bill1Total },
            { invoiceId: bill2.id, settledAmount: 100.0 },
          ],
          narration: "Combined payment against multiple invoices",
        },
      });

      expect(receiptRes.statusCode).toBe(201);
      const receipt = JSON.parse(receiptRes.body);
      expect(receipt.voucherType).toBe("RECEIPT");
      expect(Number(receipt.totalAmount)).toBe(totalToPay);

      // Check Bill 1 is PAID
      const b1Check = await app.inject({
        method: "GET",
        url: `/api/v1/invoices/sales/${bill1.id}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      const b1Data = JSON.parse(b1Check.body);
      expect(b1Data.status).toBe(InvoiceStatus.PAID);
      expect(Number(b1Data.balanceAmount)).toBe(0.0);

      // Check Bill 2 is PARTIALLY_PAID
      const b2Check = await app.inject({
        method: "GET",
        url: `/api/v1/invoices/sales/${bill2.id}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      const b2Data = JSON.parse(b2Check.body);
      expect(b2Data.status).toBe(InvoiceStatus.PARTIALLY_PAID);
      expect(Number(b2Data.balanceAmount)).toBe(bill2Total - 100.0);
    });
  });

  // --- REQUIREMENT 15: Stock Movement Queries & Auditing ---
  describe("15. Stock Ledger Queries & Auditing", () => {
    it("should query append-only stock transactions and item stock movements", async () => {
      const stockRes = await app.inject({
        method: "GET",
        url: "/api/v1/invoices/stock/transactions",
        headers: { authorization: `Bearer ${tenantAToken}` },
      });

      expect(stockRes.statusCode).toBe(200);
      const stockData = JSON.parse(stockRes.body);
      expect(stockData.items).toBeDefined();
      expect(Array.isArray(stockData.items)).toBe(true);
      expect(stockData.total).toBeGreaterThan(0);

      const itemStockRes = await app.inject({
        method: "GET",
        url: `/api/v1/invoices/items/${productTeaId}/stock-movements`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });

      expect(itemStockRes.statusCode).toBe(200);
      const itemStockData = JSON.parse(itemStockRes.body);
      expect(itemStockData.item.id).toBe(productTeaId);
      expect(itemStockData.currentStock).toBeDefined();
      expect(Array.isArray(itemStockData.movements)).toBe(true);
    });
  });
});
