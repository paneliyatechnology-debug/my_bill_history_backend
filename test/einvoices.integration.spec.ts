import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { EInvoicesService } from "../src/gst/e-invoices.service";
import { InvoiceCategory } from "@billing/shared-types";

describe("E-Invoice statutory module integration", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;
  let eInvoicesService: EInvoicesService;

  let tokenA = "";
  let tokenB = "";
  let orgA = "";
  let orgB = "";
  let companyA = "";
  let companyB = "";
  let branchA = "";
  let fyA = "";
  let uomA = "";
  let warehouseA = "";
  let itemGoodA = "";
  let itemBadHsnA = "";
  let partyB2bA = "";
  let partyInterstateA = "";

  const headersA = () => ({
    authorization: `Bearer ${tokenA}`,
    "x-organization-id": orgA,
    "x-company-id": companyA,
  });

  const headersB = () => ({
    authorization: `Bearer ${tokenB}`,
    "x-organization-id": orgB,
    "x-company-id": companyB,
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(DatabaseService);
    eInvoicesService = app.get(EInvoicesService);

    const testPhones = ["9898009988", "9898009989"];

    // Clean up test data
    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: { in: testPhones } },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (orgIds.length > 0) {
        await tx.gstApiAuditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.eInvoiceRecord.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
        await tx.eWayBillRecord.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
        await tx.gstIntegrationConfig.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.companyInvoicePrintSettings.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
        await tx.paymentAllocation.deleteMany({ where: { salesInvoice: { organizationId: { in: orgIds } } } });
        await tx.salesInvoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
        await tx.salesInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.journalEntry.deleteMany({ where: { voucher: { organizationId: { in: orgIds } } } });
        await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.stockTransaction.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.item.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.party.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.warehouse.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.unitOfMeasure.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.userBranchAssignment.deleteMany({ where: { user: { organizationId: { in: orgIds } } } });
        await tx.branch.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
        await tx.financialYear.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
        await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
      await tx.tenant.deleteMany({ where: { primaryPhone: { in: testPhones } } });
    });

    const register = async (phone: string, name: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          fullName: name,
          phone,
          password: "Password@123",
          organizationName: `${name} Corp`,
          tradeName: name,
          stateCode: "24",
          city: "Ahmedabad",
          pincode: "380015",
        },
      });
      expect(response.statusCode).toBe(201);
      return JSON.parse(response.body);
    };

    const tenantA = await register("9898009988", "Apex Invoicing A");
    const tenantB = await register("9898009989", "Apex Invoicing B");

    tokenA = tenantA.accessToken;
    orgA = tenantA.defaultContext.organizationId;
    companyA = tenantA.defaultContext.companyId;

    tokenB = tenantB.accessToken;
    orgB = tenantB.defaultContext.organizationId;
    companyB = tenantB.defaultContext.companyId;

    // Set company A with valid GSTIN and full registered address
    await prisma.executeBypassRls(async (tx) => {
      await tx.company.update({
        where: { id: companyA },
        data: {
          legalName: "Apex Invoicing Solutions Pvt Ltd",
          tradeName: "Apex Invoicing",
          gstin: "24AAACA1234A1Z5",
          stateCode: "24",
          addressLine1: "401 Titanium City Centre, Prahladnagar",
          city: "Ahmedabad",
          pincode: "380015",
          phone: "9898009988",
          email: "einvoice@apex.local",
        },
      });
    });

    // Create Branch, FY, Warehouse, UOM for Tenant A
    const branchRecord = await prisma.executeBypassRls(async (tx) => {
      return tx.branch.findFirst({ where: { companyId: companyA } });
    });
    branchA = branchRecord!.id;

    const fyRecord = await prisma.executeBypassRls(async (tx) => {
      return tx.financialYear.findFirst({ where: { companyId: companyA, isCurrent: true } });
    });
    fyA = fyRecord!.id;

    const uom = await prisma.executeBypassRls(async (tx) => {
      return tx.unitOfMeasure.create({
        data: {
          organizationId: orgA,
          companyId: companyA,
          name: "Pieces",
          symbol: "PCS",
          uqcCode: "PCS",
        },
      });
    });
    uomA = uom.id;

    const wh = await prisma.executeBypassRls(async (tx) => {
      return tx.warehouse.create({
        data: {
          organizationId: orgA,
          companyId: companyA,
          branchId: branchA,
          name: "Main Hub",
          isDefault: true,
        },
      });
    });
    warehouseA = wh.id;

    // Item 1: Valid product with 18% GST and 6-digit HSN 847130
    const item1 = await prisma.executeBypassRls(async (tx) => {
      return tx.item.create({
        data: {
          organizationId: orgA,
          companyId: companyA,
          type: "PRODUCT",
          name: "Industrial Barcode Scanner",
          sku: "SCAN-PRO-01",
          hsnCode: "847130",
          primaryUomId: uomA,
          taxRate: 18.0,
          purchaseRate: 2000,
          retailPrice: 3000,
          wholesalePrice: 2800,
        },
      });
    });
    itemGoodA = item1.id;

    // Item 2: Product with invalid HSN
    const item2 = await prisma.executeBypassRls(async (tx) => {
      return tx.item.create({
        data: {
          organizationId: orgA,
          companyId: companyA,
          type: "PRODUCT",
          name: "Invalid HSN Item",
          sku: "BAD-HSN-01",
          hsnCode: "12", // Invalid: less than 4 digits
          primaryUomId: uomA,
          taxRate: 18.0,
          purchaseRate: 100,
          retailPrice: 150,
        },
      });
    });
    itemBadHsnA = item2.id;

    // Seed Opening Stock for Items
    await prisma.executeBypassRls(async (tx) => {
      await tx.stockTransaction.createMany({
        data: [
          {
            organizationId: orgA,
            companyId: companyA,
            warehouseId: warehouseA,
            itemId: itemGoodA,
            transactionType: "OPENING",
            transactionDate: new Date(),
            quantity: 50.0,
            valuationRate: 2000.0,
            totalValuation: 100000.0,
            isProvisionalCost: false,
            referenceDocType: "OPENING",
            referenceDocId: "00000000-0000-0000-0000-000000000000",
          },
          {
            organizationId: orgA,
            companyId: companyA,
            warehouseId: warehouseA,
            itemId: itemBadHsnA,
            transactionType: "OPENING",
            transactionDate: new Date(),
            quantity: 50.0,
            valuationRate: 100.0,
            totalValuation: 5000.0,
            isProvisionalCost: false,
            referenceDocType: "OPENING",
            referenceDocId: "00000000-0000-0000-0000-000000000000",
          },
        ],
      });
    });

    // Party 1: Intra-state B2B Customer (Gujarat - 24)
    const party1 = await prisma.executeBypassRls(async (tx) => {
      return tx.party.create({
        data: {
          organizationId: orgA,
          companyId: companyA,
          type: "CUSTOMER",
          name: "Gujarat Retail MegaStore LLP",
          phone: "9825990001",
          gstin: "24AABCG1234F1Z8",
          stateCode: "24",
          gstType: "REGULAR",
          billingAddress: {
            line1: "Shop 12, Alpha Mall, Vastrapur",
            city: "Ahmedabad",
            pincode: "380054",
          },
        },
      });
    });
    partyB2bA = party1.id;

    // Party 2: Inter-state B2B Customer (Maharashtra - 27)
    const party2 = await prisma.executeBypassRls(async (tx) => {
      return tx.party.create({
        data: {
          organizationId: orgA,
          companyId: companyA,
          type: "CUSTOMER",
          name: "Bombay Trading Corporation",
          phone: "9825990002",
          gstin: "27AABCB9876C1Z3",
          stateCode: "27",
          gstType: "REGULAR",
          billingAddress: {
            line1: "Fort Road, Nariman Point",
            city: "Mumbai",
            pincode: "400021",
          },
        },
      });
    });
    partyInterstateA = party2.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ==========================================
  // SECTION 1: Statutory Validation Engine Unit Tests
  // ==========================================
  describe("1. Statutory Pre-Validation Engine (`validateInvoiceData`)", () => {
    it("should pass validation for a perfectly formed intra-state B2B invoice", () => {
      const validInvoice = {
        invoiceNumber: "INV-2026-0001",
        invoiceDate: new Date().toISOString(),
        category: "TAX_INVOICE",
        placeOfSupply: "24",
        taxableAmount: 1000,
        cgstAmount: 90,
        sgstAmount: 90,
        igstAmount: 0,
        cessAmount: 0,
        roundOff: 0,
        grandTotal: 1180,
        company: {
          gstin: "24AAACA1234A1Z5",
          stateCode: "24",
          addressLine1: "401 Titanium City Centre",
          pincode: "380015",
        },
        party: {
          gstin: "24AABCG1234F1Z8",
          name: "Gujarat Retail MegaStore LLP",
          stateCode: "24",
          billingAddress: { line1: "Shop 12, Alpha Mall", pincode: "380054" },
        },
        items: [
          {
            description: "Industrial Barcode Scanner",
            hsnCode: "847130",
            quantity: 1,
            unitPrice: 1000,
            taxableAmount: 1000,
            cgstAmount: 90,
            sgstAmount: 90,
            igstAmount: 0,
            totalAmount: 1180,
          },
        ],
      };

      const result = eInvoicesService.validateInvoiceData(validInvoice);
      expect(result.valid).toBe(true);
      expect(result.status).toBe("READY");
      expect(result.errors).toHaveLength(0);
      expect(result.summary.documentNumber).toBe("INV-2026-0001");
      expect(result.summary.placeOfSupply).toBe("24");
      expect(result.summary.grandTotal).toBe(1180);
    });

    it("should detect invalid GSTIN format for buyer and supplier", () => {
      const invalidGstinInvoice = {
        invoiceNumber: "INV-2026-0002",
        invoiceDate: new Date().toISOString(),
        category: "TAX_INVOICE",
        placeOfSupply: "24",
        taxableAmount: 1000,
        cgstAmount: 90,
        sgstAmount: 90,
        igstAmount: 0,
        grandTotal: 1180,
        company: {
          gstin: "INVALID_GSTIN_123",
          stateCode: "24",
          addressLine1: "Valid address line",
          pincode: "380015",
        },
        party: {
          gstin: "BAD_BUYER_GSTIN",
          name: "Test Party",
          billingAddress: { line1: "Address", pincode: "380054" },
        },
        items: [
          {
            description: "Product",
            hsnCode: "847130",
            quantity: 1,
            unitPrice: 1000,
            taxableAmount: 1000,
            cgstAmount: 90,
            sgstAmount: 90,
            igstAmount: 0,
            totalAmount: 1180,
          },
        ],
      };

      const result = eInvoicesService.validateInvoiceData(invalidGstinInvoice);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "SUPPLIER_GSTIN_INVALID")).toBe(true);
      expect(result.errors.some((e) => e.code === "BUYER_GSTIN_INVALID")).toBe(true);
    });

    it("should detect supplier state code mismatch with GSTIN first 2 digits", () => {
      const stateMismatchInvoice = {
        invoiceNumber: "INV-2026-0003",
        invoiceDate: new Date().toISOString(),
        category: "TAX_INVOICE",
        placeOfSupply: "24",
        taxableAmount: 1000,
        cgstAmount: 90,
        sgstAmount: 90,
        igstAmount: 0,
        grandTotal: 1180,
        company: {
          gstin: "24AAACA1234A1Z5",
          stateCode: "27", // Mismatch: GSTIN is 24, but stateCode says 27
          addressLine1: "Address",
          pincode: "380015",
        },
        party: {
          gstin: "24AABCG1234F1Z8",
          name: "Test Party",
          billingAddress: { line1: "Address", pincode: "380054" },
        },
        items: [
          {
            description: "Product",
            hsnCode: "847130",
            quantity: 1,
            unitPrice: 1000,
            taxableAmount: 1000,
            cgstAmount: 90,
            sgstAmount: 90,
            igstAmount: 0,
          },
        ],
      };

      const result = eInvoicesService.validateInvoiceData(stateMismatchInvoice);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "SUPPLIER_STATE_MISMATCH")).toBe(true);
    });

    it("should reject invalid HSN/SAC code shorter than 4 digits or non-numeric", () => {
      const badHsnInvoice = {
        invoiceNumber: "INV-2026-0004",
        invoiceDate: new Date().toISOString(),
        placeOfSupply: "24",
        taxableAmount: 1000,
        cgstAmount: 90,
        sgstAmount: 90,
        grandTotal: 1180,
        company: {
          gstin: "24AAACA1234A1Z5",
          stateCode: "24",
          addressLine1: "Address",
          pincode: "380015",
        },
        party: {
          gstin: "24AABCG1234F1Z8",
          name: "Test Party",
          billingAddress: { line1: "Address", pincode: "380054" },
        },
        items: [
          {
            description: "Product with 2-digit HSN",
            hsnCode: "84", // Invalid
            quantity: 1,
            unitPrice: 1000,
            taxableAmount: 1000,
            cgstAmount: 90,
            sgstAmount: 90,
          },
        ],
      };

      const result = eInvoicesService.validateInvoiceData(badHsnInvoice);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "ITEM_HSN_INVALID")).toBe(true);
    });

    it("should reject intra-state invoice with IGST or unequal CGST/SGST", () => {
      const intraWithIgst = {
        invoiceNumber: "INV-2026-0005",
        invoiceDate: new Date().toISOString(),
        placeOfSupply: "24",
        taxableAmount: 1000,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 180, // Disallowed for intra-state supply (24 -> 24)
        grandTotal: 1180,
        company: {
          gstin: "24AAACA1234A1Z5",
          stateCode: "24",
          addressLine1: "Address",
          pincode: "380015",
        },
        party: {
          gstin: "24AABCG1234F1Z8",
          name: "Test Party",
          billingAddress: { line1: "Address", pincode: "380054" },
        },
        items: [
          {
            description: "Product",
            hsnCode: "847130",
            quantity: 1,
            unitPrice: 1000,
            taxableAmount: 1000,
            igstAmount: 180,
          },
        ],
      };

      const result = eInvoicesService.validateInvoiceData(intraWithIgst);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "TAX_INTRA_IGST_DISALLOWED")).toBe(true);
    });

    it("should reject inter-state invoice with CGST or SGST", () => {
      const interWithCgst = {
        invoiceNumber: "INV-2026-0006",
        invoiceDate: new Date().toISOString(),
        placeOfSupply: "27", // Inter-state (24 -> 27)
        taxableAmount: 1000,
        cgstAmount: 90, // Disallowed for inter-state
        sgstAmount: 90,
        igstAmount: 0,
        grandTotal: 1180,
        company: {
          gstin: "24AAACA1234A1Z5",
          stateCode: "24",
          addressLine1: "Address",
          pincode: "380015",
        },
        party: {
          gstin: "27AABCB9876C1Z3",
          name: "Bombay Trading",
          billingAddress: { line1: "Mumbai", pincode: "400021" },
        },
        items: [
          {
            description: "Product",
            hsnCode: "847130",
            quantity: 1,
            unitPrice: 1000,
            taxableAmount: 1000,
            cgstAmount: 90,
            sgstAmount: 90,
          },
        ],
      };

      const result = eInvoicesService.validateInvoiceData(interWithCgst);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "TAX_INTER_CGST_SGST_DISALLOWED")).toBe(true);
    });

    it("should reject total sum mismatch when components do not equal grand total", () => {
      const mismatchInvoice = {
        invoiceNumber: "INV-2026-0007",
        invoiceDate: new Date().toISOString(),
        placeOfSupply: "24",
        taxableAmount: 1000,
        cgstAmount: 90,
        sgstAmount: 90,
        igstAmount: 0,
        grandTotal: 1500, // Discrepancy: 1000 + 90 + 90 = 1180 != 1500
        company: {
          gstin: "24AAACA1234A1Z5",
          stateCode: "24",
          addressLine1: "Address",
          pincode: "380015",
        },
        party: {
          gstin: "24AABCG1234F1Z8",
          name: "Test Party",
          billingAddress: { line1: "Address", pincode: "380054" },
        },
        items: [
          {
            description: "Product",
            hsnCode: "847130",
            quantity: 1,
            unitPrice: 1000,
            taxableAmount: 1000,
            cgstAmount: 90,
            sgstAmount: 90,
          },
        ],
      };

      const result = eInvoicesService.validateInvoiceData(mismatchInvoice);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === "TOTAL_SUM_MISMATCH")).toBe(true);
    });

    it("should provide advisory warning for invoice older than 30 days (AATO >= 10Cr rule)", () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 35); // 35 days ago

      const oldInvoice = {
        invoiceNumber: "INV-2026-0008",
        invoiceDate: oldDate.toISOString(),
        placeOfSupply: "24",
        taxableAmount: 1000,
        cgstAmount: 90,
        sgstAmount: 90,
        igstAmount: 0,
        grandTotal: 1180,
        company: {
          gstin: "24AAACA1234A1Z5",
          stateCode: "24",
          addressLine1: "Address",
          pincode: "380015",
        },
        party: {
          gstin: "24AABCG1234F1Z8",
          name: "Test Party",
          billingAddress: { line1: "Address", pincode: "380054" },
        },
        items: [
          {
            description: "Product",
            hsnCode: "847130",
            quantity: 1,
            unitPrice: 1000,
            taxableAmount: 1000,
            cgstAmount: 90,
            sgstAmount: 90,
          },
        ],
      };

      const result = eInvoicesService.validateInvoiceData(oldInvoice);
      expect(result.valid).toBe(true); // Warnings do not invalidate
      expect(result.warnings.some((w) => w.code === "REPORTING_WINDOW_WARNING")).toBe(true);
    });
  });

  // ==========================================
  // SECTION 2: API Endpoints & Multi-Tenancy
  // ==========================================
  describe("2. REST API Endpoints & Multi-Tenancy", () => {
    let salesInvoiceReadyId: string;
    let salesInvoiceInvalidId: string;

    beforeAll(async () => {
      // Create a valid B2B sales invoice for Tenant A
      const resReady = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: headersA(),
        payload: {
          category: InvoiceCategory.TAX_INVOICE,
          partyId: partyB2bA,
          branchId: branchA,
          financialYearId: fyA,
          warehouseId: warehouseA,
          invoiceDate: new Date().toISOString().slice(0, 10),
          placeOfSupply: "24",
          paymentMode: "CASH",
          items: [
            {
              itemId: itemGoodA,
              quantity: 2,
              unitPrice: 3000,
              discountPercent: 0,
              taxRate: 18,
            },
          ],
        },
      });
      expect(resReady.statusCode).toBe(201);
      salesInvoiceReadyId = JSON.parse(resReady.body).id;

      // Create an invalid sales invoice (using item with invalid 2-digit HSN)
      const resInvalid = await app.inject({
        method: "POST",
        url: "/api/v1/invoices/sales",
        headers: headersA(),
        payload: {
          category: InvoiceCategory.TAX_INVOICE,
          partyId: partyB2bA,
          branchId: branchA,
          financialYearId: fyA,
          warehouseId: warehouseA,
          invoiceDate: new Date().toISOString().slice(0, 10),
          placeOfSupply: "24",
          paymentMode: "CASH",
          items: [
            {
              itemId: itemBadHsnA,
              quantity: 1,
              unitPrice: 150,
              discountPercent: 0,
              taxRate: 18,
            },
          ],
        },
      });
      expect(resInvalid.statusCode).toBe(201);
      salesInvoiceInvalidId = JSON.parse(resInvalid.body).id;
    });

    it("GET /api/v1/e-invoices should list invoices with computed summary metrics and pagination", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/e-invoices?page=1&limit=10",
        headers: headersA(),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.items).toBeInstanceOf(Array);
      expect(data.items.length).toBeGreaterThanOrEqual(2);
      expect(data.summary).toBeDefined();
      expect(data.summary.total).toBeGreaterThanOrEqual(2);
      expect(data.summary.ready).toBeGreaterThanOrEqual(1);

      // Verify row structure
      const row = data.items.find((r: any) => r.id === salesInvoiceReadyId);
      expect(row).toBeDefined();
      expect(row.einvoiceStatus).toBe("READY");
      expect(row.partyName).toBe("Gujarat Retail MegaStore LLP");
      expect(row.isIntraState).toBe(true);
      expect(row.canGenerate).toBe(true);
      expect(row.canCancel).toBe(false);
    });

    it("POST /api/v1/e-invoices/:invoiceId/validate should return valid: true for ready invoice", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}/validate`,
        headers: headersA(),
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.valid).toBe(true);
      expect(data.status).toBe("READY");
      expect(data.errors).toHaveLength(0);
      expect(data.summary.grandTotal).toBeGreaterThan(0);
    });

    it("POST /api/v1/e-invoices/:invoiceId/validate should return valid: false and error list for invalid invoice", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/e-invoices/${salesInvoiceInvalidId}/validate`,
        headers: headersA(),
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.valid).toBe(false);
      expect(data.status).toBe("DRAFT");
      expect(data.errors.length).toBeGreaterThan(0);
      expect(data.errors.some((e: any) => e.code === "ITEM_HSN_INVALID")).toBe(true);
    });

    it("POST /api/v1/e-invoices/:invoiceId/generate should block invalid invoice with 400 Bad Request", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/e-invoices/${salesInvoiceInvalidId}/generate`,
        headers: headersA(),
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.message).toContain("statutory GST e-invoice schema validation");
      expect(data.errors).toBeInstanceOf(Array);
    });

    it("POST /api/v1/e-invoices/:invoiceId/generate should not fabricate IRN when credentials are missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}/generate`,
        headers: headersA(),
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.irn).toBeNull();
      expect(data.outcome).toBe("CREDENTIALS_UNAVAILABLE");
    });

    it("GET /api/v1/e-invoices/:id should return complete invoice details and audit timeline", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}`,
        headers: headersA(),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.invoice).toBeDefined();
      expect(data.company).toBeDefined();
      expect(data.company.gstin).toBe("24AAACA1234A1Z5");
      expect(data.validation).toBeDefined();
      expect(data.auditLogs).toBeInstanceOf(Array);
    });

    it("POST /api/v1/e-invoices/:id/cancel should reject invalid reason codes and short remarks", async () => {
      // Test invalid reason code
      const resBadCode = await app.inject({
        method: "POST",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}/cancel`,
        headers: headersA(),
        payload: {
          reasonCode: "9", // Invalid: must be 1, 2, 3, or 4
          remarks: "This is a valid cancellation remark explaining why.",
        },
      });
      expect(resBadCode.statusCode).toBe(400);

      // Test remarks < 10 characters
      const resShortRemarks = await app.inject({
        method: "POST",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}/cancel`,
        headers: headersA(),
        payload: {
          reasonCode: "1",
          remarks: "Too short",
        },
      });
      expect(resShortRemarks.statusCode).toBe(400);
    });

    it("POST /api/v1/e-invoices/:id/cancel should reject cancellation when no active IRN exists", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}/cancel`,
        headers: headersA(),
        payload: {
          reasonCode: "1",
          remarks: "Order was duplicate and entered by mistake.",
        },
      });

      expect(res.statusCode).toBe(404);
      const data = JSON.parse(res.body);
      expect(data.message).toContain("no active IRN");
    });

    it("POST /api/v1/e-invoices/:id/cancel should enforce the statutory 24-hour cancellation rule", async () => {
      // Manually simulate an active IRN registered 26 hours ago
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 26);

      await prisma.executeBypassRls(async (tx) => {
        await tx.eInvoiceRecord.create({
          data: {
            invoiceId: salesInvoiceReadyId,
            irn: "9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef",
            ackNo: "1122334455",
            ackDate: pastDate,
            signedInvoice: "MOCK_JWT_PAYLOAD",
            signedQrCode: "MOCK_SIGNED_QR_DATA_FOR_TESTING",
            status: "ACT",
            environment: "SANDBOX",
            providerName: "NIC",
            requestHash: "mock_hash_for_test",
          },
        });
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}/cancel`,
        headers: headersA(),
        payload: {
          reasonCode: "2",
          remarks: "Data entry mistake made on party GSTIN.",
        },
      });

      expect(res.statusCode).toBe(422);
      const data = JSON.parse(res.body);
      expect(data.title).toContain("IRN Cancellation Window Expired");
    });

    it("POST /api/v1/e-invoices/:id/reconcile should return active IRN when invoice already registered", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}/reconcile`,
        headers: headersA(),
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.outcome).toBe("SUCCEEDED");
      expect(data.record.irn).toBe("9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef");
      expect(data.record.status).toBe("ACT");
    });

    it("GET /api/v1/settings/e-invoice and PUT /api/v1/settings/e-invoice should configure settings", async () => {
      const getRes = await app.inject({
        method: "GET",
        url: "/api/v1/settings/e-invoice",
        headers: headersA(),
      });
      expect(getRes.statusCode).toBe(200);
      const initialSettings = JSON.parse(getRes.body);
      expect(initialSettings.company).toBeDefined();
      expect(initialSettings.company.gstin).toBe("24AAACA1234A1Z5");

      const updateRes = await app.inject({
        method: "PUT",
        url: "/api/v1/settings/e-invoice",
        headers: headersA(),
        payload: {
          environment: "SANDBOX",
          productionEnabled: false,
          einvoiceClientId: "TEST_CLIENT_ID",
          einvoiceUsername: "TEST_USER_NAME",
        },
      });
      expect(updateRes.statusCode).toBe(200);
      const updated = JSON.parse(updateRes.body);
      expect(updated.environment).toBe("SANDBOX");
      expect(updated.productionEnabled).toBe(false);
    });

    it("GET /api/v1/e-invoices/audit should return audit history", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/e-invoices/audit",
        headers: headersA(),
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.rows).toBeInstanceOf(Array);
    });

    it("GET /api/v1/e-invoices/:id/pdf should generate a valid PDF buffer with IRN headers", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}/pdf`,
        headers: headersA(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.rawPayload.length).toBeGreaterThan(100);
      // Valid PDF begins with %PDF-
      const header = res.rawPayload.slice(0, 5).toString("utf-8");
      expect(header).toBe("%PDF-");
    });

    it("Enforce Tenant Isolation: Tenant B cannot access Tenant A's invoice", async () => {
      // Tenant B tries to view Tenant A's invoice details
      const getRes = await app.inject({
        method: "GET",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}`,
        headers: headersB(),
      });
      expect(getRes.statusCode).toBe(404);

      // Tenant B tries to validate Tenant A's invoice
      const valRes = await app.inject({
        method: "POST",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}/validate`,
        headers: headersB(),
      });
      expect(valRes.statusCode).toBe(404);

      // Tenant B tries to generate Tenant A's invoice
      const genRes = await app.inject({
        method: "POST",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}/generate`,
        headers: headersB(),
      });
      expect(genRes.statusCode).toBe(404);

      // Tenant B tries to cancel Tenant A's invoice
      const cnlRes = await app.inject({
        method: "POST",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}/cancel`,
        headers: headersB(),
        payload: { reasonCode: "1", remarks: "Cross tenant attempt" },
      });
      expect(cnlRes.statusCode).toBe(404);

      // Tenant B tries to download Tenant A's PDF
      const pdfBRes = await app.inject({
        method: "GET",
        url: `/api/v1/e-invoices/${salesInvoiceReadyId}/pdf`,
        headers: headersB(),
      });
      expect(pdfBRes.statusCode).toBe(404);

      // Tenant B listing invoices should NOT see Tenant A's invoice
      const listRes = await app.inject({
        method: "GET",
        url: "/api/v1/e-invoices",
        headers: headersB(),
      });
      expect(listRes.statusCode).toBe(200);
      const bData = JSON.parse(listRes.body);
      const foundInB = bData.items.find((r: any) => r.id === salesInvoiceReadyId);
      expect(foundInB).toBeUndefined();
    });
  });
});
