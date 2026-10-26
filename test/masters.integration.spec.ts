import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { PartyType, ItemType } from "@billing/shared-types";

describe("Phase 3: Master Data & Party/Item Catalogs (Integration)", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tenantAOrgId: string;
  let tenantACompanyId: string;
  let tenantABranchId: string;
  let tenantAToken: string;

  let tenantBOrgId: string;
  let tenantBCompanyId: string;
  let tenantBToken: string;

  let uomBoxId: string;
  let uomPcsId: string;
  let categoryGroceryId: string;
  let customerPatelId: string;
  let batchTrackedItemId: string;

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

    // Clean up test data
    await prisma.executeBypassRls(async (tx) => {
      const testPhones = ["9898000001", "9898000002"];
      const users = await tx.user.findMany({
        where: { phone: { in: testPhones } },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.userBranchAssignment.deleteMany({
          where: { branch: { organizationId: { in: orgIds } } },
        });
        await tx.stockTransaction.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.itemBatch.deleteMany({
          where: { item: { organizationId: { in: orgIds } } },
        });
        await tx.item.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.itemCategory.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.unitOfMeasure.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.party.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.financialYear.deleteMany({
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

    // 1. Setup Tenant A
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Master Admin A",
        phone: "9898000001",
        email: "masterA@test.local",
        password: "PasswordMaster123#",
        organizationName: "Shree Krishna Traders Org A",
        tradeName: "Krishna Traders GJ",
        stateCode: "24",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const bodyA = JSON.parse(regResA.body);
    tenantAToken = bodyA.accessToken;
    tenantAOrgId = bodyA.defaultContext.organizationId;
    tenantACompanyId = bodyA.defaultContext.companyId;
    tenantABranchId = bodyA.defaultContext.branchId;

    // 2. Setup Tenant B
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Master Admin B",
        phone: "9898000002",
        email: "masterB@test.local",
        password: "PasswordMaster123#",
        organizationName: "Maharaja Provision Org B",
        tradeName: "Maharaja Stores MH",
        stateCode: "27",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const bodyB = JSON.parse(regResB.body);
    tenantBToken = bodyB.accessToken;
    tenantBOrgId = bodyB.defaultContext.organizationId;
    tenantBCompanyId = bodyB.defaultContext.companyId;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // ==========================================
  // SECTION 1: UNITS OF MEASURE (UOM)
  // ==========================================
  describe("Units of Measure (UOM)", () => {
    it("should create new Units of Measure under Tenant A", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/units",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          name: "Box",
          symbol: "BOX",
          uqcCode: "BOX",
          decimalPlaces: 0,
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.symbol).toBe("BOX");
      expect(data.companyId).toBe(tenantACompanyId);
      uomBoxId = data.id;

      // Create secondary PCS unit
      const resPcs = await app.inject({
        method: "POST",
        url: "/api/v1/units",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          name: "Pieces",
          symbol: "PCS",
          uqcCode: "NOS",
          decimalPlaces: 0,
        },
      });
      expect(resPcs.statusCode).toBe(201);
      uomPcsId = JSON.parse(resPcs.body).id;
    });

    it("should prevent duplicate UOM symbol within the same company (409 Conflict)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/units",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          name: "Box Duplicate",
          symbol: "BOX",
          uqcCode: "BOX",
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("DUPLICATE_UOM");
    });

    it("should enforce cross-tenant isolation on UOMs (Tenant B cannot see Tenant A UOMs)", async () => {
      const resA = await app.inject({
        method: "GET",
        url: "/api/v1/units",
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      const listA = JSON.parse(resA.body);
      expect(listA.some((u: any) => u.id === uomBoxId)).toBe(true);

      const resB = await app.inject({
        method: "GET",
        url: "/api/v1/units",
        headers: { authorization: `Bearer ${tenantBToken}` },
      });
      const listB = JSON.parse(resB.body);
      expect(listB.some((u: any) => u.id === uomBoxId)).toBe(false);
    });

    it("should update and delete Unit of Measure under Tenant A", async () => {
      // 1. Create a temp unit
      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/units",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          name: "Temp Unit",
          symbol: "TMPU",
          uqcCode: "OTH",
          decimalPlaces: 1,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const tempId = JSON.parse(createRes.body).id;

      // 2. Update it
      const updateRes = await app.inject({
        method: "PUT",
        url: `/api/v1/units/${tempId}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          name: "Updated Temp Unit",
          decimalPlaces: 2,
        },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(JSON.parse(updateRes.body).name).toBe("Updated Temp Unit");

      // 3. Delete it
      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/units/${tempId}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(deleteRes.statusCode).toBe(200);

      // Verify deletion
      const verifyRes = await app.inject({
        method: "GET",
        url: `/api/v1/units/${tempId}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(verifyRes.statusCode).toBe(404);
    });
  });

  // ==========================================
  // SECTION 2: ITEM CATEGORIES
  // ==========================================
  describe("Item Categories", () => {
    it("should create new Item Category under Tenant A", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/categories",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          name: "Groceries & Spices",
          nameGujarati: "કરિયાણું અને મસાલા",
        },
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.name).toBe("Groceries & Spices");
      categoryGroceryId = data.id;
    });

    it("should reject duplicate category name within same company (409 Conflict)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/categories",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          name: "Groceries & Spices",
        },
      });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error).toBe("DUPLICATE_CATEGORY");
    });

    it("should update and delete Category under Tenant A", async () => {
      // 1. Create temp category
      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/categories",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          name: "Temp Category",
          nameGujarati: "ટેમ્પ કેટેગરી",
        },
      });
      expect(createRes.statusCode).toBe(201);
      const tempId = JSON.parse(createRes.body).id;

      // 2. Update it
      const updateRes = await app.inject({
        method: "PUT",
        url: `/api/v1/categories/${tempId}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          name: "Updated Temp Category",
        },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(JSON.parse(updateRes.body).name).toBe("Updated Temp Category");

      // 3. Delete it
      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/categories/${tempId}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(deleteRes.statusCode).toBe(200);

      // Verify deletion
      const verifyRes = await app.inject({
        method: "GET",
        url: `/api/v1/categories/${tempId}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(verifyRes.statusCode).toBe(404);
    });

    it("should create, update, and delete Warehouse under Tenant A", async () => {
      // 1. Create warehouse
      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/tenants/warehouses",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          name: "GIDC Storage Unit 9",
          address: "Plot 99, GIDC Naroda",
          isDefault: false,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const whId = JSON.parse(createRes.body).id;

      // 2. Update warehouse
      const updateRes = await app.inject({
        method: "PUT",
        url: `/api/v1/tenants/warehouses/${whId}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          name: "GIDC Storage Unit 9 Renamed",
          address: "Plot 99B, GIDC Naroda",
        },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(JSON.parse(updateRes.body).name).toBe("GIDC Storage Unit 9 Renamed");

      // 3. Delete warehouse
      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/tenants/warehouses/${whId}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(deleteRes.statusCode).toBe(200);
    });
  });

  // ==========================================
  // SECTION 3: PARTY MASTERS (CUSTOMERS / SUPPLIERS)
  // ==========================================
  describe("Party Masters", () => {
    it("should create Customer with valid Gujarat GSTIN and stateCode 24", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          type: PartyType.CUSTOMER,
          name: "Patel Provision Store",
          nameGujarati: "પટેલ પ્રોવિઝન સ્ટોર",
          contactPerson: "Rameshbhai Patel",
          phone: "9825123456",
          email: "patelstore@example.com",
          gstin: "24ABCDE1234F1Z6", // Valid Gujarat GSTIN with Luhn Modulo 36 checksum 6
          stateCode: "24",
          billingAddress: {
            line1: "14, Sardar Complex, Ring Road",
            city: "Surat",
            state: "Gujarat",
            pincode: "395002",
          },
          creditLimit: 150000,
          creditDays: 30,
        },
      });

      expect(res.statusCode).toBe(201);
      const party = JSON.parse(res.body);
      expect(party.name).toBe("Patel Provision Store");
      expect(party.gstin).toBe("24ABCDE1234F1Z6");
      expect(party.pan).toBe("ABCDE1234F"); // Derived PAN
      expect(party.stateCode).toBe("24");
      customerPatelId = party.id;
    });

    it("should create Supplier and Combined (BOTH) party accounts", async () => {
      // 1. Supplier
      const resSup = await app.inject({
        method: "POST",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          type: PartyType.SUPPLIER,
          name: "Shree Ambica Agro Foods",
          phone: "9825999888",
          stateCode: "24",
          billingAddress: {
            line1: "Market Yard",
            city: "Ahmedabad",
            pincode: "380001",
          },
        },
      });
      expect(resSup.statusCode).toBe(201);
      expect(JSON.parse(resSup.body).type).toBe(PartyType.SUPPLIER);

      // 2. Combined BOTH account
      const resBoth = await app.inject({
        method: "POST",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          type: PartyType.BOTH,
          name: "Jay Somnath Trading Co",
          phone: "9825777666",
          stateCode: "24",
          billingAddress: {
            line1: "GIDC Phase 2",
            city: "Rajkot",
            pincode: "360002",
          },
        },
      });
      expect(resBoth.statusCode).toBe(201);
      expect(JSON.parse(resBoth.body).type).toBe(PartyType.BOTH);
    });

    it("should reject GSTIN when state prefix mismatches party stateCode (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          type: PartyType.CUSTOMER,
          name: "Mismatch Store",
          phone: "9825111222",
          gstin: "27AABCU9603R1ZN", // Prefix 27 (Maharashtra)
          stateCode: "24", // Party in Gujarat
          billingAddress: {
            line1: "GIDC",
            city: "Vadodara",
            pincode: "390001",
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("INVALID_GSTIN");
      expect(body.message).toContain("does not match party's state code");
    });

    it("should reject GSTIN with invalid checksum (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          type: PartyType.CUSTOMER,
          name: "Tampered GSTIN Store",
          phone: "9825333444",
          gstin: "24ABCDE1234F1Z9", // Wrong check digit 9 instead of 6
          stateCode: "24",
          billingAddress: {
            line1: "GIDC",
            city: "Vadodara",
            pincode: "390001",
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe("INVALID_GSTIN");
    });

    it("should reject duplicate GSTIN in the same company (409 Conflict)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          type: PartyType.CUSTOMER,
          name: "Duplicate GSTIN Store",
          phone: "9825555666",
          gstin: "24ABCDE1234F1Z6", // Already used by Patel Provision Store
          stateCode: "24",
          billingAddress: {
            line1: "Main Market",
            city: "Surat",
            pincode: "395001",
          },
        },
      });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error).toBe("DUPLICATE_GSTIN");
    });

    it("should reject duplicate party with identical Name and Phone in same company (409 Conflict)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          type: PartyType.CUSTOMER,
          name: "Patel Provision Store", // Same name
          phone: "9825123456", // Same phone
          stateCode: "24",
          billingAddress: {
            line1: "Different Address",
            city: "Surat",
            pincode: "395002",
          },
        },
      });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error).toBe("DUPLICATE_PARTY");
    });

    it("should support party search and pagination", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/parties?search=Patel&page=1&limit=10",
        headers: { authorization: `Bearer ${tenantAToken}` },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.items.length).toBeGreaterThanOrEqual(1);
      expect(data.total).toBeGreaterThanOrEqual(1);
      expect(data.items[0].name).toContain("Patel");
    });

    it("should update party details and archive party", async () => {
      // 1. Update party
      const updateRes = await app.inject({
        method: "PUT",
        url: `/api/v1/parties/${customerPatelId}`,
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          creditLimit: 250000,
          contactPerson: "Rameshbhai K. Patel",
        },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(JSON.parse(updateRes.body).contactPerson).toBe(
        "Rameshbhai K. Patel",
      );

      // 2. Archive party
      const archiveRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/parties/${customerPatelId}/archive`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(archiveRes.statusCode).toBe(200);
      expect(JSON.parse(archiveRes.body).party.isActive).toBe(false);

      // Verify filtered out by isActive: true query
      const activeRes = await app.inject({
        method: "GET",
        url: "/api/v1/parties?isActive=true",
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      const activeParties = JSON.parse(activeRes.body).items;
      expect(activeParties.some((p: any) => p.id === customerPatelId)).toBe(
        false,
      );
    });

    it("should isolate parties across tenants (Tenant B cannot read Tenant A party)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/parties/${customerPatelId}`,
        headers: { authorization: `Bearer ${tenantBToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("should look up GSTIN and return autofill details for valid GSTIN", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/parties/lookup/gstin/07ABCDE1234F1Z2",
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.isValid).toBe(true);
      expect(data.gstin).toBe("07ABCDE1234F1Z2");
      expect(data.stateCode).toBe("07");
      expect(data.legalName).toBeDefined();
      expect(data.address?.city).toBeDefined();
      expect(data.address?.pincode).toBeDefined();
    });

    it("should detect invalid GSTIN checksum and suggest corrected check digit", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/parties/lookup/gstin/07ABCDE1234F1Z5",
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.isValid).toBe(false);
      expect(data.calculatedChecksum).toBe("2");
      expect(data.actualChecksum).toBe("5");
      expect(data.suggestedGstin).toBe("07ABCDE1234F1Z2");
    });

    it("should dynamically resolve State, PAN, Constitution for unlisted valid GSTIN cleanly", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/parties/lookup/gstin/24AAACA1234A1ZQ",
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.isValid).toBe(true);
      expect(data.stateCode).toBe("24");
      expect(data.stateName).toBe("Gujarat");
      expect(data.stateNameGujarati).toBe("ગુજરાત");
      expect(data.pan).toBe("AAACA1234A");
      expect(data.constitution).toContain("Company");
      expect(data.source).toBe("STATUTORY_DERIVATION");
      expect(data.message).toBeDefined();
    });
  });

  // ==========================================
  // SECTION 4: ITEM CATALOG
  // ==========================================
  describe("Item Catalog", () => {
    it("should create Product item with bilingual names, primary/secondary UOM and batch tracking", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/items",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          type: ItemType.PRODUCT,
          name: "Tata Tea Gold 500g",
          nameGujarati: "ટાટા ટી ગોલ્ડ ૫૦૦ ગ્રામ",
          sku: "TTG-500",
          barcode: "8901234567890",
          hsnCode: "0902",
          categoryId: categoryGroceryId,
          primaryUomId: uomBoxId,
          secondaryUomId: uomPcsId,
          conversionFactor: 24, // 1 Box = 24 Pcs
          taxRate: 5.0,
          cessRate: 0.0,
          purchaseRate: 295.0,
          retailPrice: 340.0,
          wholesalePrice: 310.0,
          mrp: 350.0,
          trackBatches: true,
        },
      });

      expect(res.statusCode).toBe(201);
      const item = JSON.parse(res.body);
      expect(item.sku).toBe("TTG-500");
      expect(item.trackBatches).toBe(true);
      expect(item.primaryUom.symbol).toBe("BOX");
      batchTrackedItemId = item.id;
    });

    it("should create Service item and ensure batch/serial tracking is disabled", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/items",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          type: ItemType.SERVICE,
          name: "Accounting & GST Consultation Service",
          nameGujarati: "હિસાબી અને GST સલાહ સેવા",
          sku: "SRV-GST-CONSULT",
          hsnCode: "998311", // SAC 998311 for Accounting services
          primaryUomId: uomPcsId,
          taxRate: 18.0,
          retailPrice: 2500.0,
          trackBatches: true, // Should be overridden to false for services
        },
      });

      expect(res.statusCode).toBe(201);
      const serviceItem = JSON.parse(res.body);
      expect(serviceItem.type).toBe(ItemType.SERVICE);
      expect(serviceItem.trackBatches).toBe(false);
      expect(serviceItem.trackSerialNo).toBe(false);
    });

    it("should create Product item with opening stock and initialize StockTransaction", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/items",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          type: ItemType.PRODUCT,
          name: "Premium Basmati Rice 25kg",
          nameGujarati: "પ્રીમિયમ બાસમતી ચોખા ૨૫ કિલો",
          sku: "RICE-BAS-25",
          barcode: "8901234567899",
          hsnCode: "1006",
          primaryUomId: uomBoxId,
          taxRate: 5.0,
          purchaseRate: 80.0,
          retailPrice: 100.0,
          minStockLevel: 10.0,
          openingStock: 50.0,
        },
      });

      expect(res.statusCode).toBe(201);
      const item = JSON.parse(res.body);
      expect(item.name).toBe("Premium Basmati Rice 25kg");
      expect(Number(item.currentStock)).toBe(50);

      // Verify list endpoint includes currentStock
      const listRes = await app.inject({
        method: "GET",
        url: `/api/v1/items?search=RICE-BAS-25`,
        headers: { authorization: `Bearer ${tenantAToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const listData = JSON.parse(listRes.body);
      expect(listData.items.length).toBe(1);
      expect(Number(listData.items[0].currentStock)).toBe(50);
    });

    it("should reject duplicate SKU and duplicate Barcode within company (409 Conflict)", async () => {
      // 1. Duplicate SKU
      const resSku = await app.inject({
        method: "POST",
        url: "/api/v1/items",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          type: ItemType.PRODUCT,
          name: "Duplicate SKU Item",
          sku: "TTG-500", // Already used
          hsnCode: "0902",
          primaryUomId: uomBoxId,
          taxRate: 5.0,
          retailPrice: 100,
        },
      });
      expect(resSku.statusCode).toBe(409);
      expect(JSON.parse(resSku.body).error).toBe("DUPLICATE_SKU");

      // 2. Duplicate Barcode
      const resBarcode = await app.inject({
        method: "POST",
        url: "/api/v1/items",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          type: ItemType.PRODUCT,
          name: "Duplicate Barcode Item",
          barcode: "8901234567890", // Already used
          hsnCode: "0902",
          primaryUomId: uomBoxId,
          taxRate: 5.0,
          retailPrice: 100,
        },
      });
      expect(resBarcode.statusCode).toBe(409);
      expect(JSON.parse(resBarcode.body).error).toBe("DUPLICATE_BARCODE");
    });

    it("should perform fast barcode lookup for checkout and pos indexing", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/items/lookup?code=8901234567890",
        headers: { authorization: `Bearer ${tenantAToken}` },
      });

      expect(res.statusCode).toBe(200);
      const item = JSON.parse(res.body);
      expect(item.id).toBe(batchTrackedItemId);
      expect(item.name).toBe("Tata Tea Gold 500g");
    });

    it("should isolate items across tenants (Tenant B lookup returns 404)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/items/lookup?code=8901234567890",
        headers: { authorization: `Bearer ${tenantBToken}` },
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error).toBe("ITEM_NOT_FOUND");
    });
  });

  // ==========================================
  // SECTION 5: ITEM BATCHES & EXPIRY DATES
  // ==========================================
  describe("Item Batches", () => {
    it("should create batch on batch-tracked item with manufacturing and expiry date", async () => {
      const mfgDate = "2026-10-01";
      const expiryDate = "2027-09-30";

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/batches",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          itemId: batchTrackedItemId,
          batchNumber: "B-OCT2026-01",
          mfgDate,
          expiryDate,
          purchaseRate: 290.0,
          mrp: 350.0,
          salePrice: 340.0,
          barcode: "8901234567890-B01",
        },
      });

      expect(res.statusCode).toBe(201);
      const batch = JSON.parse(res.body);
      expect(batch.batchNumber).toBe("B-OCT2026-01");
      expect(batch.itemId).toBe(batchTrackedItemId);
    });

    it("should reject batch when expiryDate is before mfgDate (400 Bad Request)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/batches",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          itemId: batchTrackedItemId,
          batchNumber: "B-INVALID-EXP",
          mfgDate: "2026-10-01",
          expiryDate: "2026-09-01", // Earlier than mfg!
          purchaseRate: 290.0,
          mrp: 350.0,
          salePrice: 340.0,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).message).toContain(
        "Expiry date cannot be prior to manufacturing date",
      );
    });

    it("should reject duplicate batch number for the same item (409 Conflict)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/batches",
        headers: { authorization: `Bearer ${tenantAToken}` },
        payload: {
          itemId: batchTrackedItemId,
          batchNumber: "B-OCT2026-01", // Already created
          purchaseRate: 290.0,
          mrp: 350.0,
          salePrice: 340.0,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error).toBe("DUPLICATE_BATCH");
    });

    it("should isolate batches across tenants (Tenant B cannot create or query Tenant A batches)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/batches",
        headers: { authorization: `Bearer ${tenantBToken}` },
        payload: {
          itemId: batchTrackedItemId, // Belongs to Tenant A!
          batchNumber: "B-CROSS-TENANT",
          purchaseRate: 200,
          mrp: 250,
          salePrice: 240,
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
