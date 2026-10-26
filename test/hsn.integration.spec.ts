import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("HSN/SAC Centralized Master Integration Suite", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tenantACompanyId: string;
  let tenantAToken: string;

  let tenantBCompanyId: string;
  let tenantBToken: string;

  let createdHsnId: string;
  let createdSacId: string;

  const testPhones = ["9879000101", "9879000102"];

  const cleanup = async () => {
    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: { in: testPhones } },
        select: { organizationId: true, id: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      const userIds = users.map((u) => u.id);
      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.userBranchAssignment.deleteMany({ where: { userId: { in: userIds } } });
        await tx.item.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.hsnMaster.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.unitOfMeasure.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.branch.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
      await tx.tenant.deleteMany({ where: { primaryPhone: { in: testPhones } } });
    });
  };

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

    // Clean up any stale test records from previous aborted runs
    await cleanup();

    // Register Tenant A
    const resA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "HSN Test Admin A",
        phone: testPhones[0],
        password: "Password@123",
        organizationName: "HSN Test Org A",
        tradeName: "HSN Test Company A",
        stateCode: "24",
      },
    });
    expect(resA.statusCode).toBe(201);
    const bodyA = JSON.parse(resA.body);
    tenantAToken = bodyA.accessToken;
    tenantACompanyId = bodyA.defaultContext.companyId;

    // Register Tenant B
    const resB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "HSN Test Admin B",
        phone: testPhones[1],
        password: "Password@123",
        organizationName: "HSN Test Org B",
        tradeName: "HSN Test Company B",
        stateCode: "27",
      },
    });
    expect(resB.statusCode).toBe(201);
    const bodyB = JSON.parse(resB.body);
    tenantBToken = bodyB.accessToken;
    tenantBCompanyId = bodyB.defaultContext.companyId;
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  it("1. lists global verified system HSN/SAC codes for any authenticated tenant", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/hsn?limit=50",
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toBeDefined();
    expect(body.total).toBeGreaterThanOrEqual(40);

    // Verify key standard codes exist (e.g. 1006 for rice, 7214 for steel, 998311 for accounting)
    const rice = body.items.find((h: any) => h.code === "1006");
    expect(rice).toBeDefined();
    expect(rice.type).toBe("HSN");
    expect(rice.isSystem).toBe(true);

    const steel = body.items.find((h: any) => h.code === "7214");
    expect(steel).toBeDefined();
    expect(Number(steel.gstRate)).toBe(18);

    const acct = body.items.find((h: any) => h.code === "998311");
    expect(acct).toBeDefined();
    expect(acct.type).toBe("SAC");
  });

  it("2. supports search and filtering by code, description, and type", async () => {
    // Search by code prefix
    const resCode = await app.inject({
      method: "GET",
      url: "/api/v1/hsn?search=100",
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    expect(resCode.statusCode).toBe(200);
    const bodyCode = JSON.parse(resCode.body);
    expect(bodyCode.items.some((h: any) => h.code === "1001")).toBe(true);
    expect(bodyCode.items.some((h: any) => h.code === "1006")).toBe(true);

    // Filter by type SAC
    const resSac = await app.inject({
      method: "GET",
      url: "/api/v1/hsn?type=SAC&limit=50",
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    expect(resSac.statusCode).toBe(200);
    const bodySac = JSON.parse(resSac.body);
    expect(bodySac.items.length).toBeGreaterThan(0);
    expect(bodySac.items.every((h: any) => h.type === "SAC")).toBe(true);
  });

  it("3. provides fast search autocompletion endpoint for dropdowns", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/hsn/search?q=steel",
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.body);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((h: any) => h.code === "7214" || h.code === "7208" || h.code === "7216")).toBe(true);
  });

  it("4. creates custom company-specific HSN and SAC codes", async () => {
    // Create custom Goods HSN
    const resHsn = await app.inject({
      method: "POST",
      url: "/api/v1/hsn",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        code: "84799090",
        description: "Specialized Industrial Machining Parts",
        descriptionGujarati: "ખાસ ઔદ્યોગિક મશીનિંગ પાર્ટ્સ",
        type: "HSN",
        gstRate: 18,
        chapter: "84",
      },
    });
    expect(resHsn.statusCode).toBe(201);
    const createdHsn = JSON.parse(resHsn.body);
    expect(createdHsn.id).toBeDefined();
    expect(createdHsn.code).toBe("84799090");
    expect(createdHsn.isSystem).toBe(false);
    expect(createdHsn.companyId).toBe(tenantACompanyId);
    createdHsnId = createdHsn.id;

    // Create custom Service SAC (starts with 99, auto-detected if omitted)
    const resSac = await app.inject({
      method: "POST",
      url: "/api/v1/hsn",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        code: "998319",
        description: "Specialized Software Architecture & Consulting",
        descriptionGujarati: "સોફ્ટવેર આર્કિટેક્ચર કન્સલ્ટિંગ",
        gstRate: 18,
      },
    });
    expect(resSac.statusCode).toBe(201);
    const createdSac = JSON.parse(resSac.body);
    expect(createdSac.type).toBe("SAC");
    expect(createdSac.companyId).toBe(tenantACompanyId);
    createdSacId = createdSac.id;
  });

  it("5. rejects duplicate HSN code within the same company (409 Conflict)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/hsn",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        code: "84799090",
        description: "Duplicate Attempt",
        gstRate: 18,
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it("6. validates code format and standard GST tax rates", async () => {
    // Invalid code length / format
    const resInvalidCode = await app.inject({
      method: "POST",
      url: "/api/v1/hsn",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        code: "ABC",
        description: "Invalid Non-numeric Code",
        gstRate: 18,
      },
    });
    expect(resInvalidCode.statusCode).toBe(400);

    // Invalid GST slab (e.g. 17% is not a standard Indian GST rate)
    const resInvalidRate = await app.inject({
      method: "POST",
      url: "/api/v1/hsn",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        code: "848190",
        description: "Invalid Rate Item",
        gstRate: 17,
      },
    });
    expect(resInvalidRate.statusCode).toBe(400);
  });

  it("7. prevents editing or deleting global system HSN codes", async () => {
    // Find a system HSN code ID
    const searchRes = await app.inject({
      method: "GET",
      url: "/api/v1/hsn/search?q=1006",
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    const systemCode = JSON.parse(searchRes.body)[0];
    expect(systemCode.isSystem).toBe(true);

    // Attempt to update
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/v1/hsn/${systemCode.id}`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: { description: "Mutated System Description" },
    });
    expect(putRes.statusCode).toBe(400);

    // Attempt to delete
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/hsn/${systemCode.id}`,
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    expect(delRes.statusCode).toBe(400);
  });

  it("8. updates and toggles status of company custom HSN code", async () => {
    const updateRes = await app.inject({
      method: "PUT",
      url: `/api/v1/hsn/${createdHsnId}`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        description: "Updated Machining Components High Precision",
        gstRate: 12, // changed slab
      },
    });
    expect(updateRes.statusCode).toBe(200);
    const updated = JSON.parse(updateRes.body);
    expect(updated.description).toBe("Updated Machining Components High Precision");
    expect(Number(updated.gstRate)).toBe(12);

    // Toggle active status
    const toggleRes = await app.inject({
      method: "PATCH",
      url: `/api/v1/hsn/${createdHsnId}/status`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: { isActive: false },
    });
    expect(toggleRes.statusCode).toBe(200);
    const toggled = JSON.parse(toggleRes.body);
    expect(toggled.isActive).toBe(false);

    // Reactivate
    await app.inject({
      method: "PATCH",
      url: `/api/v1/hsn/${createdHsnId}/status`,
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: { isActive: true },
    });
  });

  it("9. prevents deleting HSN code when linked to items in catalog", async () => {
    // Create unit for Item
    const unitRes = await app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: { name: "Pieces", symbol: "PCS", decimalPlaces: 0 },
    });
    const unit = JSON.parse(unitRes.body);

    // Create item referencing createdHsnId
    const itemRes = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: { authorization: `Bearer ${tenantAToken}` },
      payload: {
        type: "PRODUCT",
        name: "Precision Machined Part 8479",
        sku: "SKU-HSN-8479",
        hsnCode: "84799090",
        hsnMasterId: createdHsnId,
        primaryUomId: unit.id,
        purchaseRate: 500,
        retailPrice: 750,
        taxRate: 12,
      },
    });
    expect(itemRes.statusCode).toBe(201);
    const item = JSON.parse(itemRes.body);
    expect(item.hsnMasterId).toBe(createdHsnId);
    expect(item.hsnMaster?.code).toBe("84799090");

    // Attempt to delete createdHsnId -> must be rejected
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/hsn/${createdHsnId}`,
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    expect(delRes.statusCode).toBe(400);
    const delBody = JSON.parse(delRes.body);
    expect(delBody.message).toContain("linked to 1 item(s)");
  });

  it("10. enforces strict tenant isolation on company HSN codes", async () => {
    // Tenant B cannot see Tenant A's custom HSN code in their list
    const resB = await app.inject({
      method: "GET",
      url: "/api/v1/hsn?search=84799090",
      headers: { authorization: `Bearer ${tenantBToken}` },
    });
    expect(resB.statusCode).toBe(200);
    const listB = JSON.parse(resB.body);
    expect(listB.items.some((h: any) => h.id === createdHsnId)).toBe(false);

    // Tenant B cannot modify Tenant A's custom code
    const putB = await app.inject({
      method: "PUT",
      url: `/api/v1/hsn/${createdHsnId}`,
      headers: { authorization: `Bearer ${tenantBToken}` },
      payload: { description: "Malicious Cross-Tenant Overwrite" },
    });
    expect(putB.statusCode).toBe(404);

    // Tenant B can create the same code for their own company without conflict
    const createB = await app.inject({
      method: "POST",
      url: "/api/v1/hsn",
      headers: { authorization: `Bearer ${tenantBToken}` },
      payload: {
        code: "84799090",
        description: "Tenant B Own Industrial Parts",
        gstRate: 18,
      },
    });
    expect(createB.statusCode).toBe(201);
    const bodyCreateB = JSON.parse(createB.body);
    expect(bodyCreateB.companyId).toBe(tenantBCompanyId);
  });

  it("11. deletes unreferenced company custom HSN code cleanly", async () => {
    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/hsn/${createdSacId}`,
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    expect(delRes.statusCode).toBe(200);

    // Verify it is gone
    const getRes = await app.inject({
      method: "GET",
      url: `/api/v1/hsn/${createdSacId}`,
      headers: { authorization: `Bearer ${tenantAToken}` },
    });
    expect(getRes.statusCode).toBe(404);
  });
});
