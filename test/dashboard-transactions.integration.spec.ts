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
  PartyType,
} from "@billing/shared-types";

describe("Dashboard All Transactions & Transaction by ID (Integration Test Suite)", () => {
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

  let customerPartyId: string;
  let testSalesInvoiceId: string;
  let testVoucherId: string;

  const testPhones = ["9898000911", "9898000912"];

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

    // Clean up test data for phones
    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: { in: testPhones } },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.salesInvoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
        await tx.salesInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.journalEntry.deleteMany({ where: { voucher: { organizationId: { in: orgIds } } } });
        await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.party.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.branch.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
        await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
      await tx.tenant.deleteMany({ where: { primaryPhone: { in: testPhones } } });
    });

    // 1. Register Tenant A
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        organizationName: "Dashboard Txn Org A",
        companyName: "Dashboard Txn Co A",
        tradeName: "Dashboard Co A",
        stateCode: "24",
        city: "Ahmedabad",
        pincode: "380002",
        fullName: "Txn Admin A",
        phone: testPhones[0],
        password: "TxnPassword123!",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const regDataA = JSON.parse(regResA.payload);
    tenantAToken = regDataA.accessToken;
    tenantAOrgId = regDataA.defaultContext.organizationId;
    tenantACompanyId = regDataA.defaultContext.companyId;

    const branchA = await prisma.executeBypassRls(async (tx) => {
      return await tx.branch.findFirst({ where: { companyId: tenantACompanyId } });
    });
    tenantABranchId = branchA!.id;

    const fyA = await prisma.executeBypassRls(async (tx) => {
      return await tx.financialYear.findFirst({
        where: { companyId: tenantACompanyId, isCurrent: true },
      });
    });
    tenantAFinancialYearId = fyA!.id;

    // 2. Register Tenant B
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        organizationName: "Dashboard Txn Org B",
        companyName: "Dashboard Txn Co B",
        tradeName: "Dashboard Co B",
        stateCode: "24",
        city: "Surat",
        pincode: "395001",
        fullName: "Txn Admin B",
        phone: testPhones[1],
        password: "TxnPassword123!",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const regDataB = JSON.parse(regResB.payload);
    tenantBToken = regDataB.accessToken;
    tenantBOrgId = regDataB.defaultContext.organizationId;
    tenantBCompanyId = regDataB.defaultContext.companyId;

    // 3. Setup Party for Tenant A
    const party = await prisma.executeBypassRls(async (tx) => {
      return await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          name: "Test Customer Dashboard",
          type: PartyType.CUSTOMER,
          phone: "9123456789",
          stateCode: "24",
          billingAddress: { city: "Ahmedabad", state: "Gujarat", stateCode: "24" },
        },
      });
    });
    customerPartyId = party.id;

    // 4. Create a Sales Invoice for Tenant A
    const salesInvoice = await prisma.executeBypassRls(async (tx) => {
      return await tx.salesInvoice.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          branchId: tenantABranchId,
          financialYearId: tenantAFinancialYearId,
          partyId: customerPartyId,
          category: InvoiceCategory.TAX_INVOICE,
          invoiceNumber: "INV-DASH-001",
          invoiceDate: new Date("2026-10-15"),
          status: InvoiceStatus.ISSUED,
          paymentMode: PaymentMode.UNPAID_CREDIT,
          placeOfSupply: "24",
          billingAddress: { city: "Ahmedabad" },
          subTotal: 1000,
          taxableAmount: 1000,
          cgstAmount: 90,
          sgstAmount: 90,
          grandTotal: 1180,
          paidAmount: 0,
          balanceAmount: 1180,
          notes: "Test dashboard transaction",
        },
      });
    });
    testSalesInvoiceId = salesInvoice.id;

    // 5. Create a Receipt Voucher for Tenant A
    const voucher = await prisma.executeBypassRls(async (tx) => {
      return await tx.voucher.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          financialYearId: tenantAFinancialYearId,
          voucherType: "RECEIPT",
          voucherNumber: "REC-DASH-001",
          voucherDate: new Date("2026-10-16"),
          totalAmount: 500,
          narration: "Payment received from customer",
        },
      });
    });
    testVoucherId = voucher.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.executeBypassRls(async (tx) => {
        const users = await tx.user.findMany({
          where: { phone: { in: testPhones } },
          select: { organizationId: true },
        });
        const orgIds = users.map((u) => u.organizationId);
        if (orgIds.length > 0) {
          await tx.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.salesInvoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
          await tx.salesInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.journalEntry.deleteMany({ where: { voucher: { organizationId: { in: orgIds } } } });
          await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.party.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.branch.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
          await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
        }
        await tx.tenant.deleteMany({ where: { primaryPhone: { in: testPhones } } });
      });
    }
    if (app) {
      await app.close();
    }
  });

  function headers(token: string, orgId: string, companyId: string) {
    return {
      authorization: `Bearer ${token}`,
      "x-organization-id": orgId,
      "x-company-id": companyId,
    };
  }

  it("should list all transactions with pagination and URLs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/all-transactions?page=1&limit=50&sortBy=date&sortOrder=desc",
      headers: headers(tenantAToken, tenantAOrgId, tenantACompanyId),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toBeDefined();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(50);

    const inv = body.items.find((it: any) => it.id === testSalesInvoiceId);
    expect(inv).toBeDefined();
    expect(inv.type).toBe("Sales Invoices");
    expect(inv.printUrl).toContain(`/api/v1/invoices/${testSalesInvoiceId}/print`);
    expect(inv.previewUrl).toContain(`/api/v1/invoices/${testSalesInvoiceId}/print`);
    expect(inv.pdfUrl).toContain(`/api/v1/invoices/${testSalesInvoiceId}/pdf`);
  });

  it("should filter all transactions by search query", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/all-transactions?search=INV-DASH-001",
      headers: headers(tenantAToken, tenantAOrgId, tenantACompanyId),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.length).toBe(1);
    expect(body.items[0].id).toBe(testSalesInvoiceId);
  });

  it("should filter all transactions by partyId", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/dashboard/all-transactions?partyId=${customerPartyId}`,
      headers: headers(tenantAToken, tenantAOrgId, tenantACompanyId),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.every((it: any) => it.partyId === customerPartyId)).toBe(true);
  });

  it("should filter all transactions by date range", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/all-transactions?startDate=2026-10-15&endDate=2026-10-15",
      headers: headers(tenantAToken, tenantAOrgId, tenantACompanyId),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.some((it: any) => it.id === testSalesInvoiceId)).toBe(true);
  });

  it("should filter all transactions by rawType", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/all-transactions?rawType=RECEIPT",
      headers: headers(tenantAToken, tenantAOrgId, tenantACompanyId),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items.every((it: any) => it.rawType === "RECEIPT")).toBe(true);
  });

  it("should get sales invoice transaction details by ID", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/dashboard/transactions/${testSalesInvoiceId}`,
      headers: headers(tenantAToken, tenantAOrgId, tenantACompanyId),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(testSalesInvoiceId);
    expect(body.rawType).toBe("SALES_INVOICE");
    expect(body.txnNo).toBe("INV-DASH-001");
    expect(body.partyName).toBe("Test Customer Dashboard");
    expect(body.amount).toBe(1180);
    expect(body.printUrl).toContain(`/api/v1/invoices/${testSalesInvoiceId}/print`);
    expect(body.previewUrl).toContain(`/api/v1/invoices/${testSalesInvoiceId}/print`);
    expect(body.pdfUrl).toContain(`/api/v1/invoices/${testSalesInvoiceId}/pdf`);
  });

  it("should get voucher transaction details by ID via all-transactions/:id alias", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/dashboard/all-transactions/${testVoucherId}`,
      headers: headers(tenantAToken, tenantAOrgId, tenantACompanyId),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(testVoucherId);
    expect(body.rawType).toBe("RECEIPT");
    expect(body.type).toBe("Payment In");
    expect(body.txnNo).toBe("REC-DASH-001");
    expect(body.amount).toBe(500);
  });

  it("should return 404 for non-existent transaction ID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/transactions/00000000-0000-0000-0000-000000000000",
      headers: headers(tenantAToken, tenantAOrgId, tenantACompanyId),
    });

    expect(res.statusCode).toBe(404);
  });

  it("should enforce tenant isolation so Tenant B cannot get Tenant A's transaction", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/dashboard/transactions/${testSalesInvoiceId}`,
      headers: headers(tenantBToken, tenantBOrgId, tenantBCompanyId),
    });

    expect(res.statusCode).toBe(404);
  });
});
