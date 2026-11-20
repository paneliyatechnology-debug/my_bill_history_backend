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

describe("Quotation to Sales Invoice Accounting Workflow Implementation (Integration)", () => {
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
  let productItemId: string;
  let warehouseId: string;

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
      const testPhones = ["9898000077", "9898000078"];
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
        await tx.deliveryChallanItem.deleteMany({
          where: { challan: { organizationId: { in: orgIds } } },
        });
        await tx.deliveryChallan.deleteMany({
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

    // 1. Seed Tenant A
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Test Tenant A Admin",
        phone: "9898000077",
        email: "tenantA@test.local",
        password: "PasswordBilling123#",
        organizationName: "Test Tenant A Org",
        tradeName: "Tenant A Trade",
        stateCode: "24",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const signupAData = JSON.parse(regResA.body);
    tenantAToken = signupAData.accessToken;
    tenantAOrgId = signupAData.defaultContext.organizationId;
    tenantACompanyId = signupAData.defaultContext.companyId;

    // Retrieve Tenant A branch and financial year
    const compA = await prisma.executeBypassRls(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: { companyId: tenantACompanyId },
      });
      const fy = await tx.financialYear.findFirst({
        where: { companyId: tenantACompanyId, isCurrent: true },
      });
      return { branch, fy };
    });
    tenantABranchId = compA.branch!.id;
    tenantAFinancialYearId = compA.fy!.id;

    // Configure Gujarat State for Company A
    await prisma.executeBypassRls(async (tx) => {
      await tx.company.update({
        where: { id: tenantACompanyId },
        data: {
          stateCode: "24",
          gstin: "24AABCU9603R1ZM",
          allowNegativeStock: false,
        },
      });
    });

    // Seed Warehouse for Tenant A
    const whA = await prisma.executeBypassRls(async (tx) => {
      return await tx.warehouse.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          branchId: tenantABranchId,
          name: "Main Storage",
          isDefault: true,
        },
      });
    });
    warehouseId = whA.id;

    // Seed Unit of Measure
    const uom = await prisma.executeBypassRls(async (tx) => {
      return await tx.unitOfMeasure.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          name: "Pieces",
          symbol: "PCS",
          uqcCode: "PCS",
        },
      });
    });

    // Seed Product Item for Tenant A
    const it = await prisma.executeBypassRls(async (tx) => {
      return await tx.item.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: "PRODUCT",
          name: "Tractor Engine Spare",
          hsnCode: "8708",
          taxRate: 18,
          retailPrice: 3000,
          purchaseRate: 2000,
          primaryUomId: uom.id,
        },
      });
    });
    productItemId = it.id;

    // Initial Stock: 100 units @ 2000 in warehouse
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          warehouseId,
          itemId: productItemId,
          transactionType: StockTransactionType.PURCHASE_RECEIPT as any,
          transactionDate: new Date(),
          quantity: 100,
          valuationRate: 2000,
          totalValuation: 200000,
          referenceDocType: "INITIAL_STOCK",
          referenceDocId: "00000000-0000-0000-0000-000000000001",
        },
      });
    });

    // Seed Customer 1: Intra-state (Gujarat - 24)
    const cust1 = await prisma.executeBypassRls(async (tx) => {
      return await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          name: "Jaydeep Patel (Intra)",
          type: "CUSTOMER",
          stateCode: "24",
          gstin: "24AABCP1234A1Z5",
          phone: "9898111122",
          billingAddress: { city: "Ahmedabad", state: "Gujarat", pincode: "380001" },
        },
      });
    });
    customerGujaratId = cust1.id;

    // Seed Customer 2: Inter-state (Maharashtra - 27)
    const cust2 = await prisma.executeBypassRls(async (tx) => {
      return await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          name: "Ramesh Sharma (Inter)",
          type: "CUSTOMER",
          stateCode: "27",
          gstin: "27AABCS5678B1Z8",
          phone: "9898222233",
          billingAddress: { city: "Mumbai", state: "Maharashtra", pincode: "400001" },
        },
      });
    });
    customerMaharashtraId = cust2.id;

    // 2. Seed Tenant B (for multi-tenant isolation verification)
    const signupBRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Test Tenant B Admin",
        phone: "9898000078",
        email: "tenantB@test.local",
        password: "PasswordBilling123#",
        organizationName: "Test Tenant B Org",
        tradeName: "Tenant B Trade",
        stateCode: "24",
      },
    });
    expect(signupBRes.statusCode).toBe(201);
    const signupBData = JSON.parse(signupBRes.body);
    tenantBToken = signupBData.accessToken;
    tenantBOrgId = signupBData.defaultContext.organizationId;
    tenantBCompanyId = signupBData.defaultContext.companyId;
  });

  afterAll(async () => {
    await app.close();
  });

  it("1 & 2 & 3 & 4: Creating a Quotation has strictly ZERO accounting, stock, or receivable impact", async () => {
    // Check initial stock for productItemId
    const initialStock = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: { itemId: productItemId, companyId: tenantACompanyId },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity || 0);
    });
    expect(initialStock).toBe(100);

    // Initial vouchers count
    const initialVouchersCount = await prisma.executeBypassRls(async (tx) => {
      return await tx.voucher.count({
        where: { companyId: tenantACompanyId },
      });
    });

    // Create a Quotation for 10 units @ 3000 = 30,000 + 18% GST (5,400) = 35,400
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        category: InvoiceCategory.PROFORMA_INVOICE,
        partyId: customerGujaratId,
        invoiceNumber: "QTN-26-27-0001",
        isDraft: true,
        items: [
          {
            itemId: productItemId,
            quantity: 10,
            unitPrice: 3000,
            taxRate: 18,
          },
        ],
      },
    });

    expect(createRes.statusCode).toBe(201);
    const quotation = JSON.parse(createRes.body);
    expect(quotation.category).toBe(InvoiceCategory.PROFORMA_INVOICE);
    expect(quotation.status).toBe(InvoiceStatus.DRAFT);
    expect(quotation.voucher).toBeNull();
    expect(Number(quotation.grandTotal)).toBe(35400);

    // Rule 1: No Sales Invoice created yet (only PROFORMA_INVOICE exists)
    const salesInvoicesCount = await prisma.executeBypassRls(async (tx) => {
      return await tx.salesInvoice.count({
        where: {
          companyId: tenantACompanyId,
          category: InvoiceCategory.TAX_INVOICE,
        },
      });
    });
    expect(salesInvoicesCount).toBe(0);

    // Rule 2: Stock is NOT deducted (still 100)
    const currentStock = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: { itemId: productItemId, companyId: tenantACompanyId },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity || 0);
    });
    expect(currentStock).toBe(100);

    // Rule 3: Customer receivables NOT affected (balance is 0)
    const partyRes = await app.inject({
      method: "GET",
      url: `/api/v1/parties/${customerGujaratId}`,
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    expect(partyRes.statusCode).toBe(200);
    const partyData = JSON.parse(partyRes.body);
    expect(partyData.balance).toBe(0);

    // Rule 4: No accounting vouchers created
    const currentVouchersCount = await prisma.executeBypassRls(async (tx) => {
      return await tx.voucher.count({
        where: { companyId: tenantACompanyId },
      });
    });
    expect(currentVouchersCount).toBe(initialVouchersCount);
  });

  it("5 & 6 & 7: Converting Quotation to Draft Tax Invoice creates separate Draft, preserves Quotation as CONVERTED, and leaves stock/vouchers untouched", async () => {
    // 1. Create a Quotation: 5 units @ 3000 = 15,000 + 18% GST (1350 CGST + 1350 SGST) = 17,700
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        category: InvoiceCategory.PROFORMA_INVOICE,
        partyId: customerGujaratId,
        invoiceNumber: "QTN-26-27-0002",
        isDraft: true,
        items: [
          {
            itemId: productItemId,
            quantity: 5,
            unitPrice: 3000,
            taxRate: 18,
          },
        ],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const quotation = JSON.parse(createRes.body);

    const stockBeforeConvert = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: { itemId: productItemId, companyId: tenantACompanyId },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity || 0);
    });

    // 2. Convert to Sales Invoice (default: asDraft = true)
    const convertRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales/${quotation.id}/convert-to-invoice`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: { asDraft: true },
    });
    expect(convertRes.statusCode).toBe(200);
    const draftInvoice = JSON.parse(convertRes.body);

    // Requirement 5: Creates correct DRAFT Sales Invoice
    expect(draftInvoice.category).toBe(InvoiceCategory.TAX_INVOICE);
    expect(draftInvoice.status).toBe(InvoiceStatus.DRAFT);
    expect(draftInvoice.invoiceNumber).toMatch(/^DFT-INV/);
    expect(draftInvoice.quotationId).toBe(quotation.id);
    expect(draftInvoice.quotationNumber).toBe("QTN-26-27-0002");
    expect(draftInvoice.voucher).toBeNull();

    // Stock must NOT be deducted yet for draft
    const stockAfterConvert = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: { itemId: productItemId, companyId: tenantACompanyId },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity || 0);
    });
    expect(stockAfterConvert).toBe(stockBeforeConvert);

    // Requirement 6: All item and tax details transferred & recalculated
    expect(Number(draftInvoice.taxableAmount)).toBe(15000);
    expect(Number(draftInvoice.cgstAmount)).toBe(1350);
    expect(Number(draftInvoice.sgstAmount)).toBe(1350);
    expect(Number(draftInvoice.igstAmount)).toBe(0);
    expect(Number(draftInvoice.grandTotal)).toBe(17700);
    expect(draftInvoice.items.length).toBe(1);
    expect(Number(draftInvoice.items[0].quantity)).toBe(5);
    expect(Number(draftInvoice.items[0].unitPrice)).toBe(3000);

    // Requirement 7: Converted quotation displays linked invoice and has status CONVERTED
    const qtnRes = await app.inject({
      method: "GET",
      url: `/api/v1/sales/${quotation.id}`,
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    expect(qtnRes.statusCode).toBe(200);
    const updatedQuotation = JSON.parse(qtnRes.body);
    expect(updatedQuotation.status).toBe(InvoiceStatus.CONVERTED);
    expect(updatedQuotation.convertedInvoiceId).toBe(draftInvoice.id);

    // Original quotation data remains 100% intact
    expect(updatedQuotation.invoiceNumber).toBe("QTN-26-27-0002");
    expect(updatedQuotation.category).toBe(InvoiceCategory.PROFORMA_INVOICE);
    expect(Number(updatedQuotation.grandTotal)).toBe(17700);

    // 3. Finalize / Issue the Draft Invoice
    const issueRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales/${draftInvoice.id}/issue`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {},
    });
    expect(issueRes.statusCode).toBe(200);
    const issuedInvoice = JSON.parse(issueRes.body);
    expect(issuedInvoice.status).toBe(InvoiceStatus.ISSUED);
    expect(issuedInvoice.invoiceNumber).toMatch(/^INV\/\d{2}-\d{2}\/\d{4}$/);
    expect(issuedInvoice.voucher).toBeDefined();
    expect(issuedInvoice.voucher.balanced).toBe(true);

    // Now stock IS deducted by -5
    const stockAfterIssue = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: { itemId: productItemId, companyId: tenantACompanyId },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity || 0);
    });
    expect(stockAfterIssue).toBe(stockBeforeConvert - 5);
  });

  it("8: Quotation editing controls: Open quotation can be edited; Converted quotation cannot be modified; Converted quotation cannot be deleted", async () => {
    // 1. Create an open quotation
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        category: InvoiceCategory.PROFORMA_INVOICE,
        partyId: customerGujaratId,
        invoiceNumber: "QTN-26-27-EDIT-TEST",
        isDraft: true,
        items: [
          {
            itemId: productItemId,
            quantity: 3,
            unitPrice: 3000,
            taxRate: 18,
          },
        ],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const quotation = JSON.parse(createRes.body);

    // 2. Edit open quotation (e.g. increase quantity to 4) -> Allowed
    const editRes = await app.inject({
      method: "PUT",
      url: `/api/v1/invoices/sales/${quotation.id}`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        category: InvoiceCategory.PROFORMA_INVOICE,
        partyId: customerGujaratId,
        invoiceNumber: "QTN-26-27-EDIT-TEST",
        items: [
          {
            itemId: productItemId,
            quantity: 4,
            unitPrice: 3000,
            taxRate: 18,
          },
        ],
      },
    });
    expect(editRes.statusCode).toBe(200);
    const editedQuote = JSON.parse(editRes.body);
    expect(Number(editedQuote.taxableAmount)).toBe(12000);

    // 3. Convert quotation to invoice
    const convRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales/${quotation.id}/convert-to-invoice`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: { asDraft: true },
    });
    expect(convRes.statusCode).toBe(200);

    // 4. Attempt to edit converted quotation -> Must be rejected (400)
    const rogueEdit = await app.inject({
      method: "PUT",
      url: `/api/v1/invoices/sales/${quotation.id}`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        category: InvoiceCategory.PROFORMA_INVOICE,
        partyId: customerGujaratId,
        items: [
          {
            itemId: productItemId,
            quantity: 10,
            unitPrice: 3000,
            taxRate: 18,
          },
        ],
      },
    });
    expect(rogueEdit.statusCode).toBe(400);
    const rogueEditErr = JSON.parse(rogueEdit.body);
    expect(rogueEditErr.message).toContain("Converted quotations cannot be modified");

    // 5. Attempt to delete converted quotation -> Must be rejected (400)
    const rogueDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/invoices/sales/${quotation.id}`,
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    expect(rogueDelete.statusCode).toBe(400);
    const rogueDeleteErr = JSON.parse(rogueDelete.body);
    expect(rogueDeleteErr.message).toContain("Converted quotations cannot be deleted");
  });

  it("9: Repeated conversion is idempotent and does NOT create duplicate invoices", async () => {
    // 1. Create a Quotation
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        category: InvoiceCategory.PROFORMA_INVOICE,
        partyId: customerGujaratId,
        invoiceNumber: "QTN-26-27-0003",
        isDraft: true,
        items: [
          {
            itemId: productItemId,
            quantity: 2,
            unitPrice: 3000,
            taxRate: 18,
          },
        ],
      },
    });
    const quotation = JSON.parse(createRes.body);

    // 2. Convert first time
    const convert1 = await app.inject({
      method: "POST",
      url: `/api/v1/sales/${quotation.id}/convert-to-invoice`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {},
    });
    expect(convert1.statusCode).toBe(200);
    const invoice1 = JSON.parse(convert1.body);

    // 3. Repeated conversion (e.g. repeated click or retry)
    const convert2 = await app.inject({
      method: "POST",
      url: `/api/v1/sales/${quotation.id}/convert-to-invoice`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {},
    });
    expect(convert2.statusCode).toBe(200);
    const invoice2 = JSON.parse(convert2.body);

    // Must return the SAME existing invoice ID and invoice number
    expect(invoice2.id).toBe(invoice1.id);
    expect(invoice2.invoiceNumber).toBe(invoice1.invoiceNumber);
    expect(invoice2.alreadyConverted).toBe(true);

    // Verify in database that only ONE invoice exists for this quotation
    const invoicesForQuotation = await prisma.executeBypassRls(async (tx) => {
      return await tx.salesInvoice.findMany({
        where: { quotationId: quotation.id },
      });
    });
    expect(invoicesForQuotation.length).toBe(1);
  });

  it("10: Direct conversion with issueImmediately: false / true validates stock policy correctly", async () => {
    // 1. Disallow negative stock on Company
    await prisma.executeBypassRls(async (tx) => {
      await tx.company.update({
        where: { id: tenantACompanyId },
        data: { allowNegativeStock: false },
      });
    });

    // 2. Create Quotation for 500 units (insufficient stock)
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        category: InvoiceCategory.PROFORMA_INVOICE,
        partyId: customerGujaratId,
        invoiceNumber: "QTN-26-27-EXCESS",
        isDraft: true,
        items: [
          {
            itemId: productItemId,
            quantity: 500,
            unitPrice: 3000,
            taxRate: 18,
          },
        ],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const quotation = JSON.parse(createRes.body);

    // 3. Attempt direct conversion & immediate issue without negative stock override -> must fail
    const convertRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales/${quotation.id}/convert-to-invoice`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: { issueImmediately: true, allowNegativeStock: false },
    });
    expect(convertRes.statusCode).toBe(400);
    const errBody = JSON.parse(convertRes.body);
    expect(errBody.message).toContain("Insufficient stock");

    // 4. Verify original quotation status remains DRAFT / OPEN
    const qtnCheck = await prisma.executeBypassRls(async (tx) => {
      return await tx.salesInvoice.findUnique({
        where: { id: quotation.id },
      });
    });
    expect(qtnCheck!.status).toBe(InvoiceStatus.DRAFT);
    expect(qtnCheck!.convertedInvoiceId).toBeNull();
  });

  it("11 & 12 & 13 & 14: Finalized converted invoice creates correct postings, exactly once stock deduction, and balanced ledger", async () => {
    // Current stock before conversion
    const stockBefore = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: { itemId: productItemId, companyId: tenantACompanyId },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity || 0);
    });

    // Create an Inter-State quotation: 10 units @ 3000 = 30,000 + 18% IGST (5,400) = 35,400
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        category: InvoiceCategory.PROFORMA_INVOICE,
        partyId: customerMaharashtraId,
        invoiceNumber: "QTN-26-27-INTERSTATE",
        isDraft: true,
        items: [
          {
            itemId: productItemId,
            quantity: 10,
            unitPrice: 3000,
            taxRate: 18,
          },
        ],
      },
    });
    const quotation = JSON.parse(createRes.body);

    // Direct convert with immediate issue
    const convertRes = await app.inject({
      method: "POST",
      url: `/api/v1/sales/${quotation.id}/convert-to-invoice`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: { issueImmediately: true },
    });
    expect(convertRes.statusCode).toBe(200);
    const invoice = JSON.parse(convertRes.body);

    // Rule 12: Stock is deducted exactly once (by -10)
    const stockAfter = await prisma.executeBypassRls(async (tx) => {
      const agg = await tx.stockTransaction.aggregate({
        where: { itemId: productItemId, companyId: tenantACompanyId },
        _sum: { quantity: true },
      });
      return Number(agg._sum.quantity || 0);
    });
    expect(stockAfter).toBe(stockBefore - 10);

    // Rule 13: GST is calculated correctly for inter-state (IGST = 5400, CGST = 0, SGST = 0)
    expect(Number(invoice.igstAmount)).toBe(5400);
    expect(Number(invoice.cgstAmount)).toBe(0);
    expect(Number(invoice.sgstAmount)).toBe(0);
    expect(Number(invoice.grandTotal)).toBe(35400);

    // Rule 11 & 14: Balanced double-entry General Ledger voucher posted
    expect(invoice.voucher).toBeDefined();
    expect(invoice.voucher.balanced).toBe(true);

    const voucherEntries = await prisma.executeBypassRls(async (tx) => {
      return await tx.journalEntry.findMany({
        where: { voucherId: invoice.voucher.id },
      });
    });

    let totalDebit = 0;
    let totalCredit = 0;
    for (const entry of voucherEntries) {
      totalDebit += Number(entry.debitAmount);
      totalCredit += Number(entry.creditAmount);
    }
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(35400);

    // Customer receivable increased by 35400
    const partyRes = await app.inject({
      method: "GET",
      url: `/api/v1/parties/${customerMaharashtraId}`,
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    const partyData = JSON.parse(partyRes.body);
    expect(partyData.balance).toBe(35400);
  });

  it("15: Multi-Tenant Security: Tenant B cannot convert Tenant A's quotation", async () => {
    // Create Quotation under Tenant A
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        category: InvoiceCategory.PROFORMA_INVOICE,
        partyId: customerGujaratId,
        invoiceNumber: "QTN-26-27-TENANT-A",
        isDraft: true,
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
    expect(createRes.statusCode).toBe(201);
    const quotationA = JSON.parse(createRes.body);

    // Tenant B attempts to convert Tenant A's quotation -> Must be rejected
    const rogueConvert = await app.inject({
      method: "POST",
      url: `/api/v1/sales/${quotationA.id}/convert-to-invoice`,
      headers: { authorization: `Bearer ${tenantBToken}` },
      payload: {},
    });

    expect([403, 404]).toContain(rogueConvert.statusCode);

    // Verify Tenant A's quotation is unchanged
    const checkQtn = await prisma.executeBypassRls(async (tx) => {
      return await tx.salesInvoice.findUnique({
        where: { id: quotationA.id },
      });
    });
    expect(checkQtn!.status).toBe(InvoiceStatus.DRAFT);
    expect(checkQtn!.convertedInvoiceId).toBeNull();
  });
});
