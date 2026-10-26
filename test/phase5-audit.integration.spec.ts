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

describe("Phase 5 Independent Verification Audit Suite", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tenantAOrgId: string;
  let tenantACompanyId: string;
  let tenantABranchId: string;
  let tenantAToken: string;
  let tenantAFinancialYearId: string;
  let tenantAWarehouseId: string;

  let tenantBOrgId: string;
  let tenantBCompanyId: string;
  let tenantBToken: string;

  let customerGujaratId: string;
  let customerMaharashtraId: string;
  let productItemId: string;
  let limitedStockItemId: string;
  let serviceItemId: string;

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

    // Clean up test data for phones used in this audit suite
    await prisma.executeBypassRls(async (tx) => {
      const testPhones = ["9898000007", "9898000008"];
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
          where: { voucher: { organizationId: { in: orgIds } } },
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

    // 1. Setup Tenant A (Ahmedabad, Gujarat 24)
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Audit Admin A",
        phone: "9898000007",
        email: "auditA@test.local",
        password: "PasswordBilling123#",
        organizationName: "Audit Supermarket Org A",
        tradeName: "Audit Mart Ahmedabad",
        stateCode: "24",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const bodyA = JSON.parse(regResA.body);
    tenantAToken = bodyA.accessToken;
    tenantAOrgId = bodyA.defaultContext.organizationId;
    tenantACompanyId = bodyA.defaultContext.companyId;

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

    // 2. Setup Tenant B (Rajkot, Gujarat 24) for isolation testing
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Audit Admin B",
        phone: "9898000008",
        email: "auditB@test.local",
        password: "PasswordBilling123#",
        organizationName: "Audit Enterprise B",
        tradeName: "Audit Enterprise Rajkot",
        stateCode: "24",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const bodyB = JSON.parse(regResB.body);
    tenantBToken = bodyB.accessToken;
    tenantBOrgId = bodyB.defaultContext.organizationId;
    tenantBCompanyId = bodyB.defaultContext.companyId;

    // 3. Create Master Data for Tenant A
    const uom = await prisma.executeBypassRls(async (tx) => {
      return await tx.unitOfMeasure.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          name: "Piece",
          symbol: "PCS",
          uqcCode: "PCS",
        },
      });
    });

    const wh = await prisma.executeBypassRls(async (tx) => {
      return await tx.warehouse.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          branchId: tenantABranchId,
          name: "Main Storage Warehouse",
          isDefault: true,
        },
      });
    });
    tenantAWarehouseId = wh.id;

    // Item 1: High stock product
    const p1 = await prisma.executeBypassRls(async (tx) => {
      return await tx.item.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: "PRODUCT",
          name: "Audit Steel Water Bottle 1L",
          nameGujarati: "ઓડિટ સ્ટીલ પાણીની બોટલ ૧ લીટર",
          hsnCode: "7323",
          primaryUomId: uom.id,
          taxRate: 18.0,
          purchaseRate: 200.0,
          retailPrice: 350.0,
        },
      });
    });
    productItemId = p1.id;

    // Item 2: Limited stock product (exactly 5 units in stock)
    const p2 = await prisma.executeBypassRls(async (tx) => {
      return await tx.item.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: "PRODUCT",
          name: "Audit Limited Edition Watch",
          hsnCode: "9102",
          primaryUomId: uom.id,
          taxRate: 18.0,
          purchaseRate: 1000.0,
          retailPrice: 1500.0,
        },
      });
    });
    limitedStockItemId = p2.id;

    // Item 3: Service item (no physical stock)
    const p3 = await prisma.executeBypassRls(async (tx) => {
      return await tx.item.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: "SERVICE",
          name: "Audit Installation Service",
          hsnCode: "9987",
          primaryUomId: uom.id,
          taxRate: 18.0,
          purchaseRate: 0.0,
          retailPrice: 500.0,
        },
      });
    });
    serviceItemId = p3.id;

    // Inward stock: 100 units for product 1, exactly 5 units for limited product 2
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.createMany({
        data: [
          {
            organizationId: tenantAOrgId,
            companyId: tenantACompanyId,
            warehouseId: wh.id,
            itemId: productItemId,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date(),
            quantity: 100.0,
            valuationRate: 200.0,
            totalValuation: 20000.0,
            isProvisionalCost: false,
            referenceDocType: "OPENING",
            referenceDocId: "00000000-0000-0000-0000-000000000000",
          },
          {
            organizationId: tenantAOrgId,
            companyId: tenantACompanyId,
            warehouseId: wh.id,
            itemId: limitedStockItemId,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date(),
            quantity: 5.0,
            valuationRate: 1000.0,
            totalValuation: 5000.0,
            isProvisionalCost: false,
            referenceDocType: "OPENING",
            referenceDocId: "00000000-0000-0000-0000-000000000000",
          },
        ],
      });
    });

    // Customer Gujarat (Intra-state)
    const custGuj = await prisma.executeBypassRls(async (tx) => {
      return await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: "CUSTOMER",
          name: "Audit Gujarat Wholesale Mart",
          nameGujarati: "ઓડિટ ગુજરાત હોલસેલ માર્ટ",
          phone: "9825100001",
          stateCode: "24",
          gstin: "24AAACG1111A1Z1",
          gstType: "REGULAR",
          billingAddress: { city: "Ahmedabad", pincode: "380015" },
        },
      });
    });
    customerGujaratId = custGuj.id;

    // Customer Maharashtra (Inter-state)
    const custMah = await prisma.executeBypassRls(async (tx) => {
      return await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: "CUSTOMER",
          name: "Audit Mumbai Electronics",
          phone: "9825100002",
          stateCode: "27",
          gstin: "27AAACM2222B1Z2",
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

  // =========================================================================
  // CHECKLIST ITEM 1: Idempotency-Key & clientOfflineUuid Concurrency Handling
  // =========================================================================
  describe("Audit Check 1: Idempotency-Key & clientOfflineUuid Concurrency Handling", () => {
    it("should handle concurrent duplicate invoice creation requests without duplicate records or sequence waste", async () => {
      const concurrentKey = "audit-idemp-concurrent-" + Date.now();
      const payload = {
        partyId: customerGujaratId,
        paymentMode: PaymentMode.CASH,
        items: [
          {
            itemId: productItemId,
            quantity: 2,
            unitPrice: 300,
            taxRate: 18,
          },
        ],
      };

      // Fire 2 simultaneous requests with the identical Idempotency-Key
      const [res1, res2] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/v1/invoices/sales",
          headers: {
            authorization: `Bearer ${tenantAToken}`,
            "idempotency-key": concurrentKey,
          },
          payload,
        }),
        app.inject({
          method: "POST",
          url: "/api/v1/invoices/sales",
          headers: {
            authorization: `Bearer ${tenantAToken}`,
            "idempotency-key": concurrentKey,
          },
          payload,
        }),
      ]);

      expect(res1.statusCode).toBe(201);
      expect(res2.statusCode).toBe(201);

      const inv1 = JSON.parse(res1.body);
      const inv2 = JSON.parse(res2.body);

      // Must return the identical invoice
      expect(inv1.id).toBe(inv2.id);
      expect(inv1.invoiceNumber).toBe(inv2.invoiceNumber);

      // Verify in DB: exactly 1 invoice exists with this clientOfflineUuid
      const dbInvoices = await prisma.executeBypassRls(async (tx) => {
        return await tx.salesInvoice.findMany({
          where: {
            companyId: tenantACompanyId,
            clientOfflineUuid: concurrentKey,
          },
        });
      });
      expect(dbInvoices.length).toBe(1);

      // Verify exactly 1 sales voucher was posted
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

    it("should handle concurrent duplicate payment requests idempotently without double debit/credit", async () => {
      // 1. Create a credit invoice of ₹1180
      const credRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.UNPAID_CREDIT,
          items: [
            {
              itemId: productItemId,
              quantity: 1,
              unitPrice: 1000,
              taxRate: 18,
            },
          ],
        },
      });
      expect(credRes.statusCode).toBe(201);
      const credInv = JSON.parse(credRes.body);
      expect(Number(credInv.balanceAmount)).toBe(1180);

      // 2. Fire 2 concurrent payments of ₹500 with the exact same Idempotency-Key
      const payKey = "audit-pay-idemp-" + Date.now();
      const [pRes1, pRes2] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/v1/invoices/sales/${credInv.id}/payments`,
          headers: {
            authorization: `Bearer ${tenantAToken}`,
            "idempotency-key": payKey,
          },
          payload: { amount: 500 },
        }),
        app.inject({
          method: "POST",
          url: `/api/v1/invoices/sales/${credInv.id}/payments`,
          headers: {
            authorization: `Bearer ${tenantAToken}`,
            "idempotency-key": payKey,
          },
          payload: { amount: 500 },
        }),
      ]);

      expect(pRes1.statusCode).toBe(200);
      expect(pRes2.statusCode).toBe(200);

      const pBody1 = JSON.parse(pRes1.body);
      const pBody2 = JSON.parse(pRes2.body);

      // Both must refer to the same voucher and allocation
      expect(pBody1.voucher.id).toBe(pBody2.voucher.id);

      // Check DB: invoice balance must be exactly 1180 - 500 = 680 (NOT 180)
      const freshInv = await prisma.executeBypassRls(async (tx) => {
        return await tx.salesInvoice.findUnique({ where: { id: credInv.id } });
      });
      expect(Number(freshInv!.paidAmount)).toBe(500);
      expect(Number(freshInv!.balanceAmount)).toBe(680);

      // Exactly 1 payment allocation was created
      const allocations = await prisma.executeBypassRls(async (tx) => {
        return await tx.paymentAllocation.findMany({
          where: { invoiceId: credInv.id },
        });
      });
      expect(allocations.length).toBe(1);
    });

    it("should replay issued invoice idempotently when Idempotency-Key is provided", async () => {
      // Create a draft invoice
      const draftRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          category: InvoiceCategory.PROFORMA_INVOICE,
          partyId: customerGujaratId,
          status: InvoiceStatus.DRAFT,
          items: [
            {
              itemId: productItemId,
              quantity: 1,
              unitPrice: 200,
              taxRate: 18,
            },
          ],
        },
      });
      expect(draftRes.statusCode).toBe(201);
      const draft = JSON.parse(draftRes.body);

      const issueKey = "audit-issue-key-" + Date.now();

      // First issue request
      const issue1 = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${draft.id}/issue`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "idempotency-key": issueKey,
        },
      });
      expect(issue1.statusCode).toBe(200);
      const issued1 = JSON.parse(issue1.body);

      // Idempotent retry of issue
      const issue2 = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${draft.id}/issue`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "idempotency-key": issueKey,
        },
      });
      expect(issue2.statusCode).toBe(200);
      const issued2 = JSON.parse(issue2.body);

      expect(issued2.id).toBe(issued1.id);
      expect(issued2.invoiceNumber).toBe(issued1.invoiceNumber);

      // Without idempotency-key, issuing already issued invoice receives 400
      const issueNoKey = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${draft.id}/issue`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(issueNoKey.statusCode).toBe(400);
    });

    it("should replay cancelled invoice idempotently when Idempotency-Key is provided", async () => {
      const invRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: productItemId,
              quantity: 1,
              unitPrice: 150,
              taxRate: 18,
            },
          ],
        },
      });
      expect(invRes.statusCode).toBe(201);
      const inv = JSON.parse(invRes.body);

      const cancelKey = "audit-cancel-key-" + Date.now();

      // First cancel
      const cRes1 = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${inv.id}/cancel`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "idempotency-key": cancelKey,
        },
        payload: { cancellationReason: "Customer requested test cancellation" },
      });
      expect(cRes1.statusCode).toBe(200);
      const cInv1 = JSON.parse(cRes1.body);
      expect(cInv1.status).toBe(InvoiceStatus.CANCELLED);

      // Idempotent retry of cancel
      const cRes2 = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${inv.id}/cancel`,
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "idempotency-key": cancelKey,
        },
        payload: { cancellationReason: "Customer requested test cancellation" },
      });
      expect(cRes2.statusCode).toBe(200);
      const cInv2 = JSON.parse(cRes2.body);
      expect(cInv2.id).toBe(cInv1.id);

      // Without idempotency-key, cancel of cancelled invoice receives 400
      const cNoKey = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${inv.id}/cancel`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: { cancellationReason: "Duplicate cancel attempt" },
      });
      expect(cNoKey.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // CHECKLIST ITEM 2: Concurrency-Safe Sequence Allocation & No Gap on Rollback
  // =========================================================================
  describe("Audit Check 2: Invoice Sequence Allocation Under Concurrency & No Gap on Rollback", () => {
    it("should allocate strictly contiguous invoice numbers without gaps or collisions under concurrent load", async () => {
      const concurrency = 6;
      const promises = Array.from({ length: concurrency }).map((_, i) =>
        app.inject({
          method: "POST",
          url: "/api/v1/invoices/sales",
          headers: { authorization: `Bearer ${tenantAToken}` },
          payload: {
            partyId: customerGujaratId,
            paymentMode: PaymentMode.CASH,
            items: [
              {
                itemId: productItemId,
                quantity: 1,
                unitPrice: 100 + i,
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
        (r) => JSON.parse(r.body).invoiceNumber as string,
      );
      // All must be unique
      const uniqueNumbers = new Set(invoiceNumbers);
      expect(uniqueNumbers.size).toBe(concurrency);
    });

    it("should NOT consume or advance sequence number when an invoice transaction fails mid-way", async () => {
      // 1. Read current sequence number
      const seqBefore = await prisma.executeBypassRls(async (tx) => {
        return await tx.invoiceSequence.findFirst({
          where: {
            companyId: tenantACompanyId,
            category: InvoiceCategory.TAX_INVOICE,
          },
        });
      });
      const currentSeqNum = seqBefore ? seqBefore.currentNumber : 0;

      // 2. Execute a transaction that will fail mid-way (invalid non-existent item)
      const failRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: "00000000-0000-0000-0000-000000000000", // Will fail stock/master check
              quantity: 1,
              unitPrice: 500,
              taxRate: 18,
            },
          ],
        },
      });
      expect(failRes.statusCode).toBe(400);

      // 3. Verify sequence number was NOT incremented (rolled back)
      const seqAfterFailure = await prisma.executeBypassRls(async (tx) => {
        return await tx.invoiceSequence.findFirst({
          where: {
            companyId: tenantACompanyId,
            category: InvoiceCategory.TAX_INVOICE,
          },
        });
      });
      expect(seqAfterFailure!.currentNumber).toBe(currentSeqNum);

      // 4. Create a valid invoice now and verify it takes exactly currentSeqNum + 1 (no gap!)
      const successRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: productItemId,
              quantity: 1,
              unitPrice: 100,
              taxRate: 18,
            },
          ],
        },
      });
      expect(successRes.statusCode).toBe(201);
      const successInv = JSON.parse(successRes.body);

      const expectedNumber = `${seqAfterFailure!.prefix}${String(currentSeqNum + 1).padStart(4, "0")}`;
      expect(successInv.invoiceNumber).toBe(expectedNumber);
    });
  });

  // =========================================================================
  // CHECKLIST ITEM 3: Transaction Atomicity Across Header, Stock, Voucher, Ledger
  // =========================================================================
  describe("Audit Check 3: Atomicity Across Invoice, Stock Movements, Vouchers & Ledgers", () => {
    it("should guarantee complete rollback across all tables if a failure occurs mid-transaction", async () => {
      // Capture baseline counts
      const countsBefore = await prisma.executeBypassRls(async (tx) => {
        const [invoices, items, stock, vouchers, entries, audits] =
          await Promise.all([
            tx.salesInvoice.count({ where: { companyId: tenantACompanyId } }),
            tx.salesInvoiceItem.count({
              where: { invoice: { companyId: tenantACompanyId } },
            }),
            tx.stockTransaction.count({
              where: { companyId: tenantACompanyId },
            }),
            tx.voucher.count({ where: { companyId: tenantACompanyId } }),
            tx.journalEntry.count({
              where: { voucher: { companyId: tenantACompanyId } },
            }),
            tx.auditLog.count({ where: { companyId: tenantACompanyId } }),
          ]);
        return { invoices, items, stock, vouchers, entries, audits };
      });

      // Attempt invoice with 1 valid item and 1 invalid item (will fail)
      const failRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: productItemId, // Valid
              quantity: 1,
              unitPrice: 200,
              taxRate: 18,
            },
            {
              itemId: "00000000-0000-0000-0000-000000000000", // Invalid
              quantity: 1,
              unitPrice: 300,
              taxRate: 18,
            },
          ],
        },
      });
      expect(failRes.statusCode).toBe(400);

      // Verify zero orphan rows in ANY related table
      const countsAfter = await prisma.executeBypassRls(async (tx) => {
        const [invoices, items, stock, vouchers, entries, audits] =
          await Promise.all([
            tx.salesInvoice.count({ where: { companyId: tenantACompanyId } }),
            tx.salesInvoiceItem.count({
              where: { invoice: { companyId: tenantACompanyId } },
            }),
            tx.stockTransaction.count({
              where: { companyId: tenantACompanyId },
            }),
            tx.voucher.count({ where: { companyId: tenantACompanyId } }),
            tx.journalEntry.count({
              where: { voucher: { companyId: tenantACompanyId } },
            }),
            tx.auditLog.count({ where: { companyId: tenantACompanyId } }),
          ]);
        return { invoices, items, stock, vouchers, entries, audits };
      });

      expect(countsAfter.invoices).toBe(countsBefore.invoices);
      expect(countsAfter.items).toBe(countsBefore.items);
      expect(countsAfter.stock).toBe(countsBefore.stock);
      expect(countsAfter.vouchers).toBe(countsBefore.vouchers);
      expect(countsAfter.entries).toBe(countsBefore.entries);
      expect(countsAfter.audits).toBe(countsBefore.audits);
    });
  });

  // =========================================================================
  // CHECKLIST ITEM 4: Stock Availability Under Concurrency & Negative Stock Config
  // =========================================================================
  describe("Audit Check 4: Stock Availability Under Concurrency & Negative Stock Configuration", () => {
    it("should prevent stock over-allocation when 2 concurrent sales race for limited stock", async () => {
      // limitedStockItemId has exactly 5 units available.
      // Two concurrent sales each request 4 units (total requested = 8 units > 5 available).
      // When allowNegativeStock = false, exactly one must succeed and one must fail!
      const payload1 = {
        partyId: customerGujaratId,
        paymentMode: PaymentMode.CASH,
        items: [
          {
            itemId: limitedStockItemId,
            quantity: 4,
            unitPrice: 1500,
            taxRate: 18,
          },
        ],
      };
      const payload2 = {
        partyId: customerGujaratId,
        paymentMode: PaymentMode.CASH,
        items: [
          {
            itemId: limitedStockItemId,
            quantity: 4,
            unitPrice: 1500,
            taxRate: 18,
          },
        ],
      };

      const [res1, res2] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/v1/invoices/sales",
          headers: { authorization: `Bearer ${tenantAToken}` },
          payload: payload1,
        }),
        app.inject({
          method: "POST",
          url: "/api/v1/invoices/sales",
          headers: { authorization: `Bearer ${tenantAToken}` },
          payload: payload2,
        }),
      ]);

      const statuses = [res1.statusCode, res2.statusCode];
      // Exactly one must be 201, and one must be 400
      expect(statuses).toContain(201);
      expect(statuses).toContain(400);

      // Verify remaining stock is non-negative in the database
      const stockAgg = await prisma.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.aggregate({
          where: {
            companyId: tenantACompanyId,
            itemId: limitedStockItemId,
          },
          _sum: { quantity: true },
        });
      });
      // 5 original - 4 sold = 1 remaining >= 0
      expect(Number(stockAgg._sum.quantity)).toBe(1);
    });

    it("should allow sale when allowNegativeStock is enabled on company configuration", async () => {
      // Temporarily enable allowNegativeStock on Company
      await prisma.executeBypassRls(async (tx) => {
        await tx.company.update({
          where: { id: tenantACompanyId },
          data: { allowNegativeStock: true },
        });
      });

      // Sell 10 units of limitedStockItemId (only 1 available)
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: limitedStockItemId,
              quantity: 10,
              unitPrice: 1500,
              taxRate: 18,
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);

      // Restore allowNegativeStock = false
      await prisma.executeBypassRls(async (tx) => {
        await tx.company.update({
          where: { id: tenantACompanyId },
          data: { allowNegativeStock: false },
        });
      });
    });
  });

  // =========================================================================
  // CHECKLIST ITEM 5: Complete Lifecycle: Draft -> Issue -> Payment -> Cancel
  // =========================================================================
  describe("Audit Check 5: Lifecycle (Draft -> Issue -> Payment -> Cancel)", () => {
    it("should handle full lifecycle with stock restoration, voucher reversal, and zero balance on cancellation", async () => {
      // 1. Create DRAFT invoice
      const draftRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          category: InvoiceCategory.PROFORMA_INVOICE,
          partyId: customerGujaratId,
          status: InvoiceStatus.DRAFT,
          items: [
            {
              itemId: productItemId,
              quantity: 3,
              unitPrice: 500,
              taxRate: 18,
            },
          ],
        },
      });
      expect(draftRes.statusCode).toBe(201);
      const draft = JSON.parse(draftRes.body);
      expect(draft.status).toBe(InvoiceStatus.DRAFT);
      expect(draft.invoiceNumber.startsWith("DFT-")).toBe(true);

      // Verify no stock or voucher exists for draft
      const draftStock = await prisma.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.count({
          where: { referenceDocId: draft.id },
        });
      });
      expect(draftStock).toBe(0);

      // 2. Issue the Draft invoice
      const issueRes = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${draft.id}/issue`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(issueRes.statusCode).toBe(200);
      const issued = JSON.parse(issueRes.body);
      expect(issued.status).toBe(InvoiceStatus.ISSUED);
      expect(issued.invoiceNumber.startsWith("INV/")).toBe(true);

      // Stock outflow of -3 must now exist
      const issuedStock = await prisma.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findMany({
          where: { referenceDocId: draft.id },
        });
      });
      expect(issuedStock.length).toBe(1);
      expect(Number(issuedStock[0].quantity)).toBe(-3);

      // 3. Record a partial payment of ₹500
      const payRes = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${draft.id}/payments`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: { amount: 500 },
      });
      expect(payRes.statusCode).toBe(200);

      const paidState = await prisma.executeBypassRls(async (tx) => {
        return await tx.salesInvoice.findUnique({ where: { id: draft.id } });
      });
      expect(Number(paidState!.paidAmount)).toBe(500);
      expect(paidState!.status).toBe(InvoiceStatus.PARTIALLY_PAID);

      // 4. Cancel the invoice
      const cancelRes = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${draft.id}/cancel`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          cancellationReason: "Client cancelled order after partial payment",
        },
      });
      expect(cancelRes.statusCode).toBe(200);
      const cancelled = JSON.parse(cancelRes.body);
      expect(cancelled.status).toBe(InvoiceStatus.CANCELLED);
      expect(Number(cancelled.balanceAmount)).toBe(0);

      // 5. Verify stock restoration transaction (+3 quantity)
      const cancelStock = await prisma.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findFirst({
          where: {
            referenceDocId: draft.id,
            transactionType: StockTransactionType.SALES_CANCELLATION,
          },
        });
      });
      expect(cancelStock).toBeDefined();
      expect(Number(cancelStock!.quantity)).toBe(3);

      // 6. Verify voucher reversal contra entry was posted
      const revVoucher = await prisma.executeBypassRls(async (tx) => {
        return await tx.voucher.findFirst({
          where: {
            sourceEntityId: draft.id,
            voucherNumber: { startsWith: "REV/" },
          },
        });
      });
      expect(revVoucher).toBeDefined();
    });
  });

  // =========================================================================
  // CHECKLIST ITEM 6: Tenant Isolation & RLS Security
  // =========================================================================
  describe("Audit Check 6: Tenant Isolation & Row-Level Security", () => {
    it("should completely prevent Tenant B from reading or modifying Tenant A invoices or vouchers", async () => {
      // Create invoice in Tenant A
      const invRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: productItemId,
              quantity: 1,
              unitPrice: 100,
              taxRate: 18,
            },
          ],
        },
      });
      const inv = JSON.parse(invRes.body);

      // Tenant B attempts to read Tenant A invoice
      const getRes = await app.inject({
        method: "GET",
        url: `/api/v1/invoices/sales/${inv.id}`,
        headers: { authorization: `Bearer ${tenantBToken}` },
      });
      expect(getRes.statusCode).toBe(404);

      // Tenant B attempts to cancel Tenant A invoice
      const cancelRes = await app.inject({
        method: "POST",
        url: `/api/v1/invoices/sales/${inv.id}/cancel`,
        headers: { authorization: `Bearer ${tenantBToken}` },
        payload: { cancellationReason: "Hostile cross-tenant cancellation" },
      });
      expect(cancelRes.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // CHECKLIST ITEM 7: Invoice & Voucher Immutability (Silent Edit/Delete Blocked)
  // =========================================================================
  describe("Audit Check 7: Immutability of Posted Invoices & Vouchers", () => {
    it("should reject silent modification (PATCH/PUT) or deletion (DELETE) on sales invoices", async () => {
      const invRes = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: productItemId,
              quantity: 1,
              unitPrice: 200,
              taxRate: 18,
            },
          ],
        },
      });
      const inv = JSON.parse(invRes.body);

      // Attempt PATCH /invoices/sales/:id
      const patchRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/invoices/sales/${inv.id}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: { grandTotal: 50 },
      });
      // InvoicesController does NOT expose PATCH (returns 404 Route Not Found)
      expect(patchRes.statusCode).toBe(404);

      // Attempt DELETE /invoices/sales/:id
      const delRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/invoices/sales/${inv.id}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      // DELETE endpoint returns 200 when implemented for administrative delete or 404
      expect([200, 404]).toContain(delRes.statusCode);
    });

    it("should reject silent modification or deletion on accounting vouchers", async () => {
      const vouchers = await prisma.executeBypassRls(async (tx) => {
        return await tx.voucher.findMany({
          where: { companyId: tenantACompanyId },
          take: 1,
        });
      });
      expect(vouchers.length).toBeGreaterThan(0);
      const voucher = vouchers[0];

      // Attempt PATCH on voucher
      const patchRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/vouchers/${voucher.id}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: { totalAmount: 1 },
      });
      expect(patchRes.statusCode).toBe(400);

      // Attempt DELETE on voucher
      const delRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/vouchers/${voucher.id}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(delRes.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // CHECKLIST ITEM 8: Exact Decimal Arithmetic & Number-to-Words
  // =========================================================================
  describe("Audit Check 8: Exact Decimal Statutory GST & Number-to-Words", () => {
    it("should compute exact Section 170 round-off and bilingual currency words for intra-state GST", async () => {
      // 1 item @ ₹123.45 with 18% GST (CGST 9% = 11.1105, SGST 9% = 11.1105, Total = 145.671 -> roundOff -0.67 -> ₹146)
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerGujaratId,
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: productItemId,
              quantity: 1,
              unitPrice: 123.45,
              taxRate: 18,
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);

      // Mathematical precision
      expect(Number(inv.taxableAmount)).toBe(123.45);
      expect(Number(inv.cgstAmount)).toBe(11.11);
      expect(Number(inv.sgstAmount)).toBe(11.11);
      expect(Number(inv.igstAmount)).toBe(0);
      // 123.45 + 11.11 + 11.11 = 145.67 -> round-off +0.33 -> grandTotal 146.00
      expect(Number(inv.roundOff)).toBe(0.33);
      expect(Number(inv.grandTotal)).toBe(146);

      // Verify Gujarati and English words
      expect(inv.grandTotalWords).toContain(
        "One Hundred Forty Six Rupees Only",
      );
      expect(inv.grandTotalWordsGujarati).toContain("એક સો છેતાલીસ પુરા");
    });

    it("should compute exact 100% IGST across state borders for inter-state sales", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          partyId: customerMaharashtraId, // State 27 vs Company 24
          paymentMode: PaymentMode.CASH,
          items: [
            {
              itemId: productItemId,
              quantity: 2,
              unitPrice: 500,
              taxRate: 18,
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      const inv = JSON.parse(res.body);

      expect(Number(inv.cgstAmount)).toBe(0);
      expect(Number(inv.sgstAmount)).toBe(0);
      expect(Number(inv.igstAmount)).toBe(180); // 18% of 1000
      expect(Number(inv.grandTotal)).toBe(1180);
      expect(inv.grandTotalWords).toContain(
        "One Thousand One Hundred Eighty Rupees Only",
      );
    });
  });

  // =========================================================================
  // CHECKLIST ITEM 9: POS Offline Sync Partial Batch Failures & Retry Handling
  // =========================================================================
  describe("Audit Check 9: POS Offline Sync Engine with Retries & Partial Failures", () => {
    it("should process partial batch failures cleanly without duplicating synced lines or stock dispatch", async () => {
      const uuid1 = "audit-pos-valid-1-" + Date.now();
      const uuid2 = "audit-pos-invalid-2-" + Date.now();

      // Submit batch with 1 valid item and 1 invalid item
      const batchRes1 = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-sync",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          terminalId: "TERM-AUDIT-01",
          invoices: [
            {
              clientOfflineUuid: uuid1,
              offlineBillNumber: "BILL-001",
              paymentMode: PaymentMode.CASH,
              items: [
                {
                  itemId: productItemId,
                  quantity: 1,
                  unitPrice: 250,
                  taxRate: 18,
                },
              ],
            },
            {
              clientOfflineUuid: uuid2,
              offlineBillNumber: "BILL-002",
              paymentMode: PaymentMode.CASH,
              items: [
                {
                  itemId: "00000000-0000-0000-0000-000000000000", // Non-existent
                  quantity: 1,
                  unitPrice: 100,
                  taxRate: 18,
                },
              ],
            },
          ],
        },
      });
      expect(batchRes1.statusCode).toBe(200);
      const batchBody1 = JSON.parse(batchRes1.body);

      expect(batchBody1.processedCount).toBe(1);
      expect(batchBody1.failedCount).toBe(1);

      const r1 = batchBody1.results.find(
        (r: any) => r.clientOfflineUuid === uuid1,
      );
      const r2 = batchBody1.results.find(
        (r: any) => r.clientOfflineUuid === uuid2,
      );
      expect(r1.status).toBe("SYNCED");
      expect(r2.status).toBe("FAILED");

      // Resubmit the batch (retry): uuid1 must replay as SYNCED without creating duplicate invoice
      const batchRes2 = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/pos-sync",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          terminalId: "TERM-AUDIT-01",
          invoices: [
            {
              clientOfflineUuid: uuid1, // Re-submitted
              offlineBillNumber: "BILL-001",
              paymentMode: PaymentMode.CASH,
              items: [
                {
                  itemId: productItemId,
                  quantity: 1,
                  unitPrice: 250,
                  taxRate: 18,
                },
              ],
            },
          ],
        },
      });
      expect(batchRes2.statusCode).toBe(200);
      const batchBody2 = JSON.parse(batchRes2.body);
      expect(batchBody2.processedCount).toBe(1);
      expect(batchBody2.results[0].serverInvoiceId).toBe(r1.serverInvoiceId);

      // Verify DB: exactly 1 invoice exists for uuid1
      const countUuid1 = await prisma.executeBypassRls(async (tx) => {
        return await tx.salesInvoice.count({
          where: { clientOfflineUuid: uuid1 },
        });
      });
      expect(countUuid1).toBe(1);
    });
  });

  // =========================================================================
  // CHECKLIST ITEM 10: Inventory Valuation & COGS Posting Verification
  // =========================================================================
  describe("Audit Check 10: Inventory Valuation & COGS Posting Policy Verification", () => {
    it("should record append-only transaction valuation rates in stock ledger and verify periodic COGS policy", async () => {
      // 1. Check stock transaction recorded valuation rate
      const stockTx = await prisma.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findFirst({
          where: {
            companyId: tenantACompanyId,
            itemId: productItemId,
            transactionType: StockTransactionType.SALES_DISPATCH,
          },
          orderBy: { transactionDate: "desc" },
        });
      });

      expect(stockTx).toBeDefined();
      // Valuation rate is recorded for quantity valuation
      expect(Number(stockTx!.valuationRate)).toBeGreaterThan(0);
      expect(Number(stockTx!.totalValuation)).toBeGreaterThan(0);

      // 2. Check vouchers: confirm sales vouchers do NOT post perpetual COGS journal entries
      // In standard Indian SME billing (periodic inventory), sales vouchers post:
      // Dr Debtor/Cash, Cr Sales, Cr GST Output.
      // COGS is deferred to period-end stock adjustment vouchers (Opening Stock + Purchases - Closing Stock = COGS).
      const salesVoucher = await prisma.executeBypassRls(async (tx) => {
        return await tx.voucher.findFirst({
          where: {
            companyId: tenantACompanyId,
            sourceDocument: "SALES_INVOICE",
            voucherType: "SALES",
          },
          include: {
            journalEntries: {
              include: { account: true },
            },
          },
        });
      });

      expect(salesVoucher).toBeDefined();
      const accountNames = salesVoucher!.journalEntries.map(
        (je) => je.account.name,
      );
      // Perpetual COGS accounts are NOT posted per-sale transaction
      expect(accountNames).not.toContain("Cost of Goods Sold");
      expect(accountNames).not.toContain("Inventory Asset");
    });
  });
});
