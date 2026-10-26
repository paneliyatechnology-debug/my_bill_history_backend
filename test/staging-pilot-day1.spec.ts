import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Phase 7: Staging Pilot Day 1 — Multi-Profile Onboarding & Provisioning", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  // Profile 1: Retail / POS
  const profile1 = {
    phone: "9825111001",
    email: "admin@ambicasupermarket.test",
    password: "Password@123",
    fullName: "Rameshbhai Patel",
    organizationName: "Shree Ambica Retail Group",
    companyLegalName: "Shree Ambica Provision Store Pvt Ltd",
    tradeName: "Ambica Supermarket",
    gstin: "24AAACA1111A1Z1",
    stateCode: "24",
  };

  // Profile 2: Wholesale & Distribution
  const profile2 = {
    phone: "9825111002",
    email: "admin@krishimandi.test",
    password: "Password@123",
    fullName: "Hareshbhai Shah",
    organizationName: "Gujarat Agro Holdings",
    companyLegalName: "Gujarat Agro-Commodities Trading LLP",
    tradeName: "Krishi Mandi Wholesalers",
    gstin: "24BBBCB2222B1Z2",
    stateCode: "24",
  };

  // Profile 3: Inter-State Trading
  const profile3 = {
    phone: "9825111003",
    email: "admin@westernspares.test",
    password: "Password@123",
    fullName: "Vikrambhai Desai",
    organizationName: "Western Industrial Group",
    companyLegalName: "Western Industrial Spares & Equipment Corporation",
    tradeName: "Western Machinery Spares",
    gstin: "24CCCCD3333C1Z3",
    stateCode: "24",
  };

  let tokenP1: string;
  let tokenP2: string;
  let tokenP3: string;

  let org1Id: string;
  let company1Id: string;
  let branch1Id: string;

  let org2Id: string;
  let company2Id: string;
  let branch2Id: string;

  let org3Id: string;
  let company3Id: string;
  let branch3Id: string;

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

    // Clean up any existing pilot day 1 test entities
    await prisma.executeBypassRls(async (tx) => {
      const existingUsers = await tx.user.findMany({
        where: {
          phone: { in: [profile1.phone, profile2.phone, profile3.phone] },
        },
        select: { organizationId: true },
      });
      const orgIds = existingUsers.map((u) => u.organizationId);
      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.journalEntry.deleteMany({
          where: { voucher: { company: { organizationId: { in: orgIds } } } },
        });
        await tx.voucher.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.ledgerAccount.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.ledgerGroup.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.stockTransaction.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.warehouse.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
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
  });

  afterAll(async () => {
    await app.close();
  });

  it("Day 1 - Profile 1: Provision Retail/POS Company (Shree Ambica Provision Store Pvt Ltd)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "x-correlation-id": "pilot-p1-reg-001" },
      payload: profile1,
    });

    expect(res.statusCode).toBe(201);
    expect(res.headers["x-correlation-id"]).toBe("pilot-p1-reg-001");

    const body = JSON.parse(res.body);
    expect(body.user).toBeDefined();
    expect(body.accessToken).toBeDefined();
    tokenP1 = body.accessToken;
    org1Id = body.defaultContext.organizationId;
    company1Id = body.defaultContext.companyId;
    branch1Id = body.defaultContext.branchId;

    // Provision Retail Point-of-Sale Main Warehouse
    const whRes = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: {
        authorization: `Bearer ${tokenP1}`,
        "x-correlation-id": "pilot-p1-wh-001",
      },
      payload: {
        name: "Retail Front Store Godown",
        isDefault: true,
        address: "Ground Floor, Ambica Supermarket",
      },
    });
    expect(whRes.statusCode).toBe(201);

    // Verify company attributes & default Financial Year
    const company = await prisma.executeBypassRls(async (tx) => {
      return tx.company.findUnique({
        where: { id: company1Id },
        include: {
          financialYears: true,
          warehouses: true,
        },
      });
    });

    expect(company).toBeDefined();
    expect(company?.legalName).toBe(profile1.companyLegalName);
    expect(company?.gstin).toBe(profile1.gstin);
    expect(company?.stateCode).toBe("24");
    expect(company?.financialYears.length).toBeGreaterThan(0);
    expect(company?.warehouses.length).toBeGreaterThan(0);
  });

  it("Day 1 - Profile 2: Provision Wholesale Company & Branch (Gujarat Agro-Commodities Trading LLP)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "x-correlation-id": "pilot-p2-reg-002" },
      payload: profile2,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    tokenP2 = body.accessToken;
    org2Id = body.defaultContext.organizationId;
    company2Id = body.defaultContext.companyId;
    branch2Id = body.defaultContext.branchId;

    // Wholesale business: Provision secondary depot branch (APMC Market Yard Branch)
    const branchRes = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/branches",
      headers: {
        authorization: `Bearer ${tokenP2}`,
        "x-correlation-id": "pilot-p2-branch-001",
      },
      payload: {
        name: "APMC Market Yard Depot",
        code: "APMC-SURAT",
        addressLine1: "Gate 4, Agricultural Produce Market Committee",
        city: "Surat",
        pincode: "395003",
        stateCode: "24",
        phone: "9825111002",
      },
    });

    expect(branchRes.statusCode).toBe(201);
    const branchBody = JSON.parse(branchRes.body);
    expect(branchBody.code).toBe("APMC-SURAT");

    // Provision dedicated warehouse at secondary depot
    const whRes = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: {
        authorization: `Bearer ${tokenP2}`,
        "x-correlation-id": "pilot-p2-wh-001",
      },
      payload: {
        name: "APMC Godown No. 12",
        branchId: branchBody.id,
      },
    });

    expect(whRes.statusCode).toBe(201);
  });

  it("Day 1 - Profile 3: Provision Inter-State Trading Company (Western Industrial Spares & Equipment Corporation)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "x-correlation-id": "pilot-p3-reg-003" },
      payload: profile3,
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    tokenP3 = body.accessToken;
    org3Id = body.defaultContext.organizationId;
    company3Id = body.defaultContext.companyId;
    branch3Id = body.defaultContext.branchId;

    // Provision Central Parts Depot for Inter-State shipments
    const whRes = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: {
        authorization: `Bearer ${tokenP3}`,
        "x-correlation-id": "pilot-p3-wh-001",
      },
      payload: {
        name: "Makarpura Central Logistics Hub",
        isDefault: true,
        address: "GIDC Estate, Makarpura, Vadodara",
      },
    });
    expect(whRes.statusCode).toBe(201);

    const company = await prisma.executeBypassRls(async (tx) => {
      return tx.company.findUnique({
        where: { id: company3Id },
      });
    });
    expect(company?.legalName).toBe(profile3.companyLegalName);
    expect(company?.gstin).toBe(profile3.gstin);
  });

  it("Day 1 - Multi-Tenant Isolation & Context Verification across 3 Profiles", async () => {
    // 1. Profile 1 queries its branches - must not see Profile 2 or 3 branches
    const p1Branches = await app.inject({
      method: "GET",
      url: "/api/v1/tenants/branches",
      headers: { authorization: `Bearer ${tokenP1}` },
    });
    expect(p1Branches.statusCode).toBe(200);
    const p1BranchList = JSON.parse(p1Branches.body);
    const hasP2BranchInP1 = p1BranchList.some(
      (b: any) => b.code === "APMC-SURAT",
    );
    expect(hasP2BranchInP1).toBe(false);

    // 2. Profile 2 queries warehouses - sees its APMC warehouse
    const p2Warehouses = await app.inject({
      method: "GET",
      url: "/api/v1/tenants/warehouses",
      headers: { authorization: `Bearer ${tokenP2}` },
    });
    expect(p2Warehouses.statusCode).toBe(200);
    const p2WhList = JSON.parse(p2Warehouses.body);
    expect(p2WhList.length).toBeGreaterThanOrEqual(1);
    expect(p2WhList.some((w: any) => w.name === "APMC Godown No. 12")).toBe(
      true,
    );

    // 3. Profile 3 queries financial years
    const p3Fys = await app.inject({
      method: "GET",
      url: "/api/v1/tenants/financial-years",
      headers: { authorization: `Bearer ${tokenP3}` },
    });
    expect(p3Fys.statusCode).toBe(200);
    const p3FyList = JSON.parse(p3Fys.body);
    expect(p3FyList.length).toBeGreaterThan(0);
    expect(p3FyList[0].name).toBe("FY 2026-27");

    // 4. Audit Log verification for Day 1 provisioning
    const day1AuditEntries = await prisma.executeBypassRls(async (tx) => {
      return tx.auditLog.findMany({
        where: {
          organizationId: { in: [org1Id, org2Id, org3Id] },
        },
      });
    });
    expect(day1AuditEntries.length).toBeGreaterThanOrEqual(3);
    for (const entry of day1AuditEntries) {
      expect(entry.recordHash).toBeDefined();
    }
  });
});
