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
  SupplyCategory,
} from "@billing/shared-types";

describe("Global Search (Multi-Entity Unified Search) Integration Suite", () => {
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

  let partyAId: string;
  let itemAId: string;
  let salesInvoiceAId: string;
  let purchaseInvoiceAId: string;

  const testPhones = ["9898000951", "9898000952"];

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
        await tx.purchaseInvoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
        await tx.purchaseInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.journalEntry.deleteMany({ where: { voucher: { organizationId: { in: orgIds } } } });
        await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.item.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.party.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.branch.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
        await tx.financialYear.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
        await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
      await tx.tenant.deleteMany({ where: { primaryPhone: { in: testPhones } } });
    });

    // 1. Setup Tenant A
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        organizationName: "Global Search Org A",
        companyName: "Search Enterprise A Pvt Ltd",
        tradeName: "Search Co A",
        stateCode: "24",
        city: "Ahmedabad",
        pincode: "380001",
        fullName: "Tenant A Search Admin",
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

    // 2. Setup Tenant B
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        organizationName: "Global Search Org B",
        companyName: "Search Enterprise B Pvt Ltd",
        tradeName: "Search Co B",
        stateCode: "24",
        city: "Ahmedabad",
        pincode: "380001",
        fullName: "Tenant B Search Admin",
        phone: testPhones[1],
        password: "TxnPassword123!",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const regDataB = JSON.parse(regResB.payload);
    tenantBToken = regDataB.accessToken;
    tenantBOrgId = regDataB.defaultContext.organizationId;
    tenantBCompanyId = regDataB.defaultContext.companyId;

    // 3. Create searchable records in Tenant A
    await prisma.executeBypassRls(async (tx) => {
      // Create Party in Tenant A
      const party = await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: PartyType.CUSTOMER,
          name: "Acme Global Trading Co",
          nameGujarati: "એક્મી ગ્લોબલ ટ્રેડિંગ",
          phone: "9123456789",
          email: "acme.global@test.com",
          gstin: "24ABCDE1234F1Z5",
          stateCode: "24",
          billingAddress: { line1: "Shop 101", city: "Ahmedabad", state: "Gujarat", pincode: "380001" },
        },
      });
      partyAId = party.id;

      // Create UOM
      let uom = await tx.unitOfMeasure.findFirst({
        where: { companyId: tenantACompanyId },
      });
      if (!uom) {
        uom = await tx.unitOfMeasure.create({
          data: {
            organizationId: tenantAOrgId,
            companyId: tenantACompanyId,
            name: "Pieces",
            symbol: "pcs",
            uqcCode: "PCS",
          },
        });
      }

      // Create Item in Tenant A
      const item = await tx.item.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          name: "Premium Super Jet Pump",
          nameGujarati: "પ્રીમિયમ સુપર જેટ પંપ",
          sku: "PUMP-JET-9000",
          hsnCode: "841370",
          primaryUomId: uom.id,
          taxRate: 18.0,
          supplyCategory: "TAXABLE" as any,
          retailPrice: 4500.0,
          purchaseRate: 3200.0,
        },
      });
      itemAId = item.id;

      // Create Sales Invoice in Tenant A
      const salesInvoice = await tx.salesInvoice.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          branchId: tenantABranchId,
          financialYearId: tenantAFinancialYearId,
          partyId: party.id,
          category: InvoiceCategory.TAX_INVOICE,
          invoiceNumber: "INV/26-27/SEARCH-001",
          invoiceDate: new Date(),
          status: InvoiceStatus.ISSUED,
          paymentMode: PaymentMode.UNPAID_CREDIT,
          placeOfSupply: "24",
          billingAddress: party.billingAddress as any,
          subTotal: 4500.0,
          taxableAmount: 4500.0,
          cgstAmount: 405.0,
          sgstAmount: 405.0,
          grandTotal: 5310.0,
          paidAmount: 0.0,
          balanceAmount: 5310.0,
        },
      });
      salesInvoiceAId = salesInvoice.id;

      // Create Purchase Invoice in Tenant A
      const purchaseInvoice = await tx.purchaseInvoice.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          branchId: tenantABranchId,
          financialYearId: tenantAFinancialYearId,
          partyId: party.id,
          vendorInvoiceNumber: "BILL/VEND/8899",
          invoiceDate: new Date(),
          placeOfSupply: "24",
          taxableAmount: 3200.0,
          cgstAmount: 288.0,
          sgstAmount: 288.0,
          grandTotal: 3776.0,
          paidAmount: 0.0,
          balanceAmount: 3776.0,
        },
      });
      purchaseInvoiceAId = purchaseInvoice.id;
    });
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
          await tx.purchaseInvoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
          await tx.purchaseInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.journalEntry.deleteMany({ where: { voucher: { organizationId: { in: orgIds } } } });
          await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.item.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.party.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.branch.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
          await tx.financialYear.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
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

  it("should return empty result for blank or empty query", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/search?q=",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totalMatches).toBe(0);
    expect(body.parties).toHaveLength(0);
    expect(body.salesInvoices).toHaveLength(0);
  });

  it("should search and match Party by name, phone, or GSTIN", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/search?q=Acme",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.parties.length).toBeGreaterThanOrEqual(1);
    const matchedParty = body.parties.find((p: any) => p.id === partyAId);
    expect(matchedParty).toBeDefined();
    expect(matchedParty.name).toBe("Acme Global Trading Co");
    expect(matchedParty.link).toContain(`/masters/parties?partyId=${partyAId}`);
  });

  it("should search and match Sales Invoice by invoiceNumber", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/search?q=SEARCH-001",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.salesInvoices.length).toBeGreaterThanOrEqual(1);
    const matchedInvoice = body.salesInvoices.find((inv: any) => inv.id === salesInvoiceAId);
    expect(matchedInvoice).toBeDefined();
    expect(matchedInvoice.invoiceNumber).toBe("INV/26-27/SEARCH-001");
    expect(matchedInvoice.grandTotal).toBe(5310);
    expect(matchedInvoice.link).toBe(`/sales/invoices/${salesInvoiceAId}`);
  });

  it("should search and match Item by SKU or name", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/search?q=PUMP-JET",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    const matchedItem = body.items.find((item: any) => item.id === itemAId);
    expect(matchedItem).toBeDefined();
    expect(matchedItem.name).toBe("Premium Super Jet Pump");
    expect(matchedItem.retailPrice).toBe(4500);
    expect(matchedItem.link).toBe(`/masters/items/${itemAId}`);
  });

  it("should enforce tenant isolation so Tenant B cannot see Tenant A records", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/dashboard/search?q=Acme",
      headers: {
        authorization: `Bearer ${tenantBToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.parties).toHaveLength(0);
    expect(body.salesInvoices).toHaveLength(0);
    expect(body.totalMatches).toBe(0);
  });
});
