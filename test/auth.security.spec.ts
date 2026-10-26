import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { UserRole } from "@billing/shared-types";
import * as bcrypt from "bcryptjs";

describe("Phase 2: Authentication & Tenant Security (Zero-Trust & RBAC)", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let orgAId: string;
  let companyAId: string;
  let branchA1Id: string;
  let branchA2Id: string;
  let userAdminAToken: string;
  let cashierAToken: string;
  let cashierAId: string;

  let orgBId: string;
  let companyBId: string;
  let userAdminBToken: string;

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

    // Clean up any test organizations/users from prior runs
    await prisma.executeBypassRls(async (tx) => {
      const testUsers = await tx.user.findMany({
        where: {
          OR: [
            { phone: { in: ["9825000001", "9825000002", "9825000003", "9825000099"] } },
            { email: { in: ["adminA@test.local", "cashierA@test.local", "adminB@test.local"] } },
          ],
        },
        select: { organizationId: true, id: true },
      });
      const orgIds = testUsers.map((u) => u.organizationId);
      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.userBranchAssignment.deleteMany({
          where: { branch: { organizationId: { in: orgIds } } },
        });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.journalEntry.deleteMany({
          where: { voucher: { company: { organizationId: { in: orgIds } } } },
        });
        await tx.voucher.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.ledgerAccount.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
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

    // Setup Test Tenant A via register endpoint
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Admin User A",
        phone: "9825000001",
        email: "adminA@test.local",
        password: "Password123#",
        organizationName: "Shree Ambica Traders Org A",
        tradeName: "Ambica Traders GJ",
        stateCode: "24",
      },
    });

    expect(regResA.statusCode).toBe(201);
    const bodyA = JSON.parse(regResA.body);
    userAdminAToken = bodyA.accessToken;
    orgAId = bodyA.defaultContext.organizationId;
    companyAId = bodyA.defaultContext.companyId;
    branchA1Id = bodyA.defaultContext.branchId;

    // Create a second branch in Company A
    const branchA2 = await prisma.branch.create({
      data: {
        organizationId: orgAId,
        companyId: companyAId,
        name: "Surat Sub Branch",
        code: "BR02",
        addressLine1: "Ring Road",
        city: "Surat",
        pincode: "395002",
        stateCode: "24",
        phone: "9825000002",
      },
    });
    branchA2Id = branchA2.id;

    // Create a Cashier User in Org A assigned ONLY to branchA1
    const passwordHash = await bcrypt.hash("CashierPass123#", 10);
    const cashierUser = await prisma.user.create({
      data: {
        organizationId: orgAId,
        fullName: "Ramesh Cashier",
        phone: "9825000003",
        email: "cashierA@test.local",
        passwordHash,
        role: UserRole.CASHIER,
      },
    });
    cashierAId = cashierUser.id;

    // Assign Cashier explicitly to Branch 1 only
    await prisma.userBranchAssignment.create({
      data: {
        userId: cashierAId,
        branchId: branchA1Id,
        role: UserRole.CASHIER,
        isDefault: true,
      },
    });

    // Login as Cashier to get token
    const cashLoginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        identifier: "9825000003",
        password: "CashierPass123#",
      },
    });
    expect(cashLoginRes.statusCode).toBe(200);
    cashierAToken = JSON.parse(cashLoginRes.body).accessToken;

    // Setup Test Tenant B via register endpoint
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Admin User B",
        phone: "9825000099",
        email: "adminB@test.local",
        password: "PasswordB123#",
        organizationName: "Marwar Traders Org B",
        tradeName: "Marwar RJ",
        stateCode: "08",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const bodyB = JSON.parse(regResB.body);
    userAdminBToken = bodyB.accessToken;
    orgBId = bodyB.defaultContext.organizationId;
    companyBId = bodyB.defaultContext.companyId;
  });

  afterAll(async () => {
    // Cleanup created test records
    try {
      await prisma.userBranchAssignment.deleteMany({
        where: { user: { organizationId: { in: [orgAId, orgBId] } } },
      });
      await prisma.user.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } },
      });
      await prisma.branch.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } },
      });
      await prisma.financialYear.deleteMany({
        where: { company: { organizationId: { in: [orgAId, orgBId] } } },
      });
      await prisma.company.deleteMany({
        where: { organizationId: { in: [orgAId, orgBId] } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [orgAId, orgBId] } },
      });
      await prisma.tenant.deleteMany({
        where: { primaryPhone: { in: ["9825000001", "9825000099"] } },
      });
    } catch {
      // Ignore cleanup error
    }
    await app.close();
  });

  // -------------------------------------------------------------
  // Test 1: Unauthenticated request handling
  // -------------------------------------------------------------
  it("should block unauthenticated requests with HTTP 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("Missing or malformed Authorization header");
  });

  // -------------------------------------------------------------
  // Test 2: Invalid password handling
  // -------------------------------------------------------------
  it("should reject login with wrong password with HTTP 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        identifier: "9825000001",
        password: "IncorrectPassword#",
      },
    });

    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------
  // Test 3: Authenticated user profile retrieval
  // -------------------------------------------------------------
  it("should return authenticated user profile on /api/v1/auth/me", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: {
        authorization: `Bearer ${userAdminAToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.phone).toBe("9825000001");
    expect(body.user.role).toBe(UserRole.COMPANY_ADMIN);
    expect(body.companies.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------
  // Test 4: Role-Based Access Control (RBAC)
  // -------------------------------------------------------------
  it("should deny CASHIER from creating a branch (403 Forbidden)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/branches",
      headers: {
        authorization: `Bearer ${cashierAToken}`,
      },
      payload: {
        name: "Unauthorized Branch Attempt",
        code: "BR99",
        addressLine1: "Test St",
        city: "Ahmedabad",
        pincode: "380001",
        stateCode: "24",
        phone: "9825009999",
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("Role 'CASHIER' lacks permission");
  });

  it("should permit COMPANY_ADMIN to create a branch (201 Created)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/branches",
      headers: {
        authorization: `Bearer ${userAdminAToken}`,
      },
      payload: {
        name: "Rajkot Wholesale Godown",
        code: "BR03",
        addressLine1: "GIDC Phase 2",
        city: "Rajkot",
        pincode: "360002",
        stateCode: "24",
        phone: "9825000004",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.name).toBe("Rajkot Wholesale Godown");
    expect(body.code).toBe("BR03");
  });

  // -------------------------------------------------------------
  // Test 5: Zero Trust - Forged Organization Header
  // -------------------------------------------------------------
  it("should reject forged X-Organization-Id header with 403 Forbidden", async () => {
    // User A attempts to pass Org B ID in header
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tenants/companies",
      headers: {
        authorization: `Bearer ${userAdminAToken}`,
        "x-organization-id": orgBId, // Forged
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  // -------------------------------------------------------------
  // Test 6: Zero Trust - Forged Cross-Company Header
  // -------------------------------------------------------------
  it("should reject forged X-Company-Id belonging to another tenant (403 Forbidden)", async () => {
    // User A attempts to access Company B
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tenants/branches",
      headers: {
        authorization: `Bearer ${userAdminAToken}`,
        "x-company-id": companyBId, // Cross-tenant company
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("FORBIDDEN_COMPANY_ACCESS");
  });

  // -------------------------------------------------------------
  // Test 7: Zero Trust - Branch Membership & Authorization
  // -------------------------------------------------------------
  it("should deny Cashier from accessing unassigned Branch 2 (403 Forbidden)", async () => {
    // Cashier A is assigned to Branch 1, attempts to access Branch 2
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tenants/branches",
      headers: {
        authorization: `Bearer ${cashierAToken}`,
        "x-branch-id": branchA2Id, // Unassigned branch
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("FORBIDDEN_BRANCH_ACCESS");
  });

  it("should allow Cashier to access their assigned Branch 1 (200 OK)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tenants/branches",
      headers: {
        authorization: `Bearer ${cashierAToken}`,
        "x-branch-id": branchA1Id, // Assigned branch
      },
    });

    expect(res.statusCode).toBe(200);
  });

  // -------------------------------------------------------------
  // Test 8: Cross-tenant Privilege Escalation Prevention
  // -------------------------------------------------------------
  it("should block cross-tenant context switching or access by User B into Org A (403 Forbidden)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/switch-context",
      headers: {
        authorization: `Bearer ${userAdminBToken}`,
      },
      payload: {
        organizationId: orgAId, // Org A target
        companyId: companyAId,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("does not belong to your organization");
  });

  // -------------------------------------------------------------
  // Test 9: Observability - Correlation ID Header Propagation
  // -------------------------------------------------------------
  it("should attach and propagate x-correlation-id header on all HTTP responses", async () => {
    const customCorrelationId = "test-corr-id-12345-abcdef";
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: {
        "x-correlation-id": customCorrelationId,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-correlation-id"]).toBe(customCorrelationId);
  });
});
