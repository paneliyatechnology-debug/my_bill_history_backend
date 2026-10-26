import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { UserRole, SubscriptionTier } from "@billing/shared-types";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";

describe("Platform SuperAdmin Security & Complete Isolation (Zero-Trust RBAC)", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;
  let jwtService: JwtService;

  // Test identities
  let superAdminUser: any;
  let superAdminToken: string;

  let companyAdminUser: any;
  let companyAdminToken: string;

  let accountantUser: any;
  let accountantToken: string;

  let cashierUser: any;
  let cashierToken: string;

  let deactivatedSuperAdminUser: any;
  let deactivatedSuperAdminToken: string;

  let orgAId: string;
  let companyAId: string;
  let tenantAId: string;

  let orgBId: string;
  let companyBId: string;
  let tenantBId: string;

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
    jwtService = app.get(JwtService);

    // Clean up test data from prior runs
    await prisma.executeBypassRls(async (tx) => {
      const phones = "('9911000001', '9911000002', '9999000001', '9999000002', '9911000010', '9911000011', '9911000012')";
      await tx.$executeRawUnsafe(`DELETE FROM user_branch_assignments WHERE user_id IN (SELECT id FROM users WHERE phone IN ${phones})`);
      await tx.$executeRawUnsafe(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE phone IN ${phones})`);
      await tx.$executeRawUnsafe(`DELETE FROM users WHERE phone IN ${phones}`);
      await tx.$executeRawUnsafe(`DELETE FROM financial_years WHERE company_id IN (SELECT id FROM companies WHERE phone IN ('9911000001', '9911000002'))`);
      await tx.$executeRawUnsafe(`DELETE FROM branches WHERE phone IN ('9911000001', '9911000002')`);
      await tx.$executeRawUnsafe(`DELETE FROM companies WHERE phone IN ('9911000001', '9911000002')`);
      await tx.$executeRawUnsafe(`DELETE FROM organizations WHERE tenant_id IN (SELECT id FROM tenants WHERE primary_phone IN ('9911000001', '9911000002'))`);
      await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE primary_phone IN ('9911000001', '9911000002')`);

      // 1. Create Tenant A & Org A
      const tenantA = await tx.tenant.create({
        data: {
          primaryPhone: "9911000001",
          subscriptionTier: SubscriptionTier.WHOLESALE_PRO,
          subscriptionEnds: new Date(Date.now() + 30 * 86400000),
          isActive: true,
        },
      });
      tenantAId = tenantA.id;

      const orgA = await tx.organization.create({
        data: {
          tenantId: tenantAId,
          name: "Tenant A Enterprises",
          legalName: "Tenant A Enterprises LLP",
        },
      });
      orgAId = orgA.id;

      const companyA = await tx.company.create({
        data: {
          organizationId: orgAId,
          legalName: "Tenant A Private Limited",
          tradeName: "Tenant A Retail",
          stateCode: "24",
          addressLine1: "101 High Street",
          city: "Ahmedabad",
          pincode: "380001",
          phone: "9911000001",
        },
      });
      companyAId = companyA.id;

      const branchA = await tx.branch.create({
        data: {
          organizationId: orgAId,
          companyId: companyAId,
          name: "Main Branch A",
          code: "MAIN-A",
          stateCode: "24",
          addressLine1: "GIDC Industrial Estate",
          city: "Ahmedabad",
          pincode: "380001",
          phone: "9911000001",
        },
      });

      // 2. Create Tenant B & Org B (for tenant isolation verification)
      const tenantB = await tx.tenant.create({
        data: {
          primaryPhone: "9911000002",
          subscriptionTier: SubscriptionTier.RETAIL_BASIC,
          subscriptionEnds: new Date(Date.now() + 30 * 86400000),
          isActive: true,
        },
      });
      tenantBId = tenantB.id;

      const orgB = await tx.organization.create({
        data: {
          tenantId: tenantBId,
          name: "Tenant B Logistics",
          legalName: "Tenant B Logistics LLP",
        },
      });
      orgBId = orgB.id;

      const companyB = await tx.company.create({
        data: {
          organizationId: orgBId,
          legalName: "Tenant B Logistics LLP",
          tradeName: "Tenant B Express",
          stateCode: "27",
          addressLine1: "202 Port Road",
          city: "Mumbai",
          pincode: "400001",
          phone: "9911000002",
        },
      });
      companyBId = companyB.id;

      const passHash = await bcrypt.hash("SecPass123#", 10);

      // Create Platform SuperAdmin user
      superAdminUser = await tx.user.create({
        data: {
          organizationId: orgAId,
          fullName: "Global Root SuperAdmin",
          email: "superadmin.test@platform.local",
          phone: "9999000001",
          passwordHash: passHash,
          role: UserRole.SUPER_ADMIN,
          isActive: true,
        },
      });

      // Create Deactivated SuperAdmin user
      deactivatedSuperAdminUser = await tx.user.create({
        data: {
          organizationId: orgAId,
          fullName: "Revoked SuperAdmin",
          email: "superadmin.inactive@platform.local",
          phone: "9999000002",
          passwordHash: passHash,
          role: UserRole.SUPER_ADMIN,
          isActive: false, // Inactive in DB
        },
      });

      // Create Tenant A Company Admin
      companyAdminUser = await tx.user.create({
        data: {
          organizationId: orgAId,
          fullName: "Tenant A Admin",
          email: "admin.tenantA@test.local",
          phone: "9911000010",
          passwordHash: passHash,
          role: UserRole.COMPANY_ADMIN,
          isActive: true,
        },
      });

      // Create Tenant A Accountant
      accountantUser = await tx.user.create({
        data: {
          organizationId: orgAId,
          fullName: "Tenant A Accountant",
          email: "accountant.tenantA@test.local",
          phone: "9911000011",
          passwordHash: passHash,
          role: UserRole.ACCOUNTANT,
          isActive: true,
        },
      });

      // Create Tenant A Cashier
      cashierUser = await tx.user.create({
        data: {
          organizationId: orgAId,
          fullName: "Tenant A Cashier",
          email: "cashier.tenantA@test.local",
          phone: "9911000012",
          passwordHash: passHash,
          role: UserRole.CASHIER,
          isActive: true,
        },
      });
    });

    // Generate JWT tokens using the authentic secret
    superAdminToken = await jwtService.signAsync({
      sub: superAdminUser.id,
      userId: superAdminUser.id,
      organizationId: orgAId,
      email: superAdminUser.email,
      phone: superAdminUser.phone,
      role: UserRole.SUPER_ADMIN,
    });

    deactivatedSuperAdminToken = await jwtService.signAsync({
      sub: deactivatedSuperAdminUser.id,
      userId: deactivatedSuperAdminUser.id,
      organizationId: orgAId,
      email: deactivatedSuperAdminUser.email,
      phone: deactivatedSuperAdminUser.phone,
      role: UserRole.SUPER_ADMIN,
    });

    companyAdminToken = await jwtService.signAsync({
      sub: companyAdminUser.id,
      userId: companyAdminUser.id,
      organizationId: orgAId,
      companyId: companyAId,
      email: companyAdminUser.email,
      phone: companyAdminUser.phone,
      role: UserRole.COMPANY_ADMIN,
    });

    accountantToken = await jwtService.signAsync({
      sub: accountantUser.id,
      userId: accountantUser.id,
      organizationId: orgAId,
      companyId: companyAId,
      email: accountantUser.email,
      phone: accountantUser.phone,
      role: UserRole.ACCOUNTANT,
    });

    cashierToken = await jwtService.signAsync({
      sub: cashierUser.id,
      userId: cashierUser.id,
      organizationId: orgAId,
      companyId: companyAId,
      email: cashierUser.email,
      phone: cashierUser.phone,
      role: UserRole.CASHIER,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. UNAUTHENTICATED REQUESTS REJECTION
  // =========================================================================
  describe("1. Unauthenticated Request Rejection (401)", () => {
    const endpoints = [
      { method: "GET" as const, url: "/api/v1/super-admin/stats" },
      { method: "GET" as const, url: "/api/v1/super-admin/tenants" },
      { method: "POST" as const, url: "/api/v1/super-admin/tenants", payload: {} },
      { method: "GET" as const, url: "/api/v1/super-admin/users" },
      { method: "GET" as const, url: "/api/v1/super-admin/invoices" },
      { method: "GET" as const, url: "/api/v1/super-admin/audit-logs" },
      { method: "GET" as const, url: "/api/v1/super-admin/diagnostics" },
      { method: "POST" as const, url: "/api/v1/super-admin/impersonate", payload: {} },
    ];

    for (const ep of endpoints) {
      it(`should reject unauthenticated ${ep.method} ${ep.url} with 401 Unauthorized`, async () => {
        const res = await app.inject({
          method: ep.method,
          url: ep.url,
          payload: ep.payload,
        });
        expect(res.statusCode).toBe(401);
      });
    }
  });

  // =========================================================================
  // 2. COMPANY ADMIN ACCESS DENIED (403)
  // =========================================================================
  describe("2. Company Admin Access Denied (403)", () => {
    it("should reject Company Admin from GET /api/v1/super-admin/stats with 403 Forbidden", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/stats",
        headers: { authorization: `Bearer ${companyAdminToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("should reject Company Admin from GET /api/v1/super-admin/tenants with 403 Forbidden", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/tenants",
        headers: { authorization: `Bearer ${companyAdminToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("should reject Company Admin from POST /api/v1/super-admin/tenants with 403 Forbidden", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/tenants",
        headers: { authorization: `Bearer ${companyAdminToken}` },
        payload: {
          primaryPhone: "9988776655",
          organizationName: "Illicit Org",
          tradeName: "Illicit Company",
          adminFullName: "Illicit Admin",
          adminPhone: "9988776655",
          adminPassword: "Password123#",
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it("should reject Company Admin from GET /api/v1/super-admin/audit-logs with 403 Forbidden", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/audit-logs",
        headers: { authorization: `Bearer ${companyAdminToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("should reject Company Admin from GET /api/v1/super-admin/diagnostics with 403 Forbidden", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/diagnostics",
        headers: { authorization: `Bearer ${companyAdminToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // 3. OTHER TENANT ROLES DENIED (403)
  // =========================================================================
  describe("3. Other Business Roles (Accountant, Cashier) Denied (403)", () => {
    it("should reject Accountant from accessing SuperAdmin stats with 403 Forbidden", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/stats",
        headers: { authorization: `Bearer ${accountantToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("should reject Cashier from accessing SuperAdmin users list with 403 Forbidden", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/users",
        headers: { authorization: `Bearer ${cashierToken}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // 4. HEADER & PARAMETER TAMPERING / PRIVILEGE ESCALATION PREVENTION
  // =========================================================================
  describe("4. Header Tampering, Parameter Spoofing & Zero-Trust Database Checks", () => {
    it("should reject normal user attempting to spoof x-organization-id or x-company-id headers", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/stats",
        headers: {
          authorization: `Bearer ${companyAdminToken}`,
          "x-organization-id": orgBId,
          "x-company-id": companyBId,
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it("should reject forged JWT token claiming SUPER_ADMIN if user is normal in database", async () => {
      // Craft a signed JWT with role: SUPER_ADMIN, but subject is companyAdminUser.id
      const forgedToken = await jwtService.signAsync({
        sub: companyAdminUser.id,
        userId: companyAdminUser.id,
        organizationId: orgAId,
        email: companyAdminUser.email,
        phone: companyAdminUser.phone,
        role: UserRole.SUPER_ADMIN, // Spoofed role in JWT
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/stats",
        headers: { authorization: `Bearer ${forgedToken}` },
      });
      // SuperAdminGuard performs authoritative database check and sees user is actually COMPANY_ADMIN
      expect(res.statusCode).toBe(403);
    });

    it("should reject deactivated/disabled SuperAdmin even with a valid signed token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/stats",
        headers: { authorization: `Bearer ${deactivatedSuperAdminToken}` },
      });
      // Database check verifies isActive === false and rejects
      expect(res.statusCode).toBe(403);
    });

    it("should prevent normal user from resetting another user's password via SuperAdmin endpoint", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/super-admin/users/${superAdminUser.id}`,
        headers: { authorization: `Bearer ${companyAdminToken}` },
        payload: { newPassword: "HackedPassword123#" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // 5. AUTHORIZED SUPERADMIN OPERATIONS (200)
  // =========================================================================
  describe("5. Authorized SuperAdmin Operations (200)", () => {
    it("should allow SuperAdmin to retrieve platform stats", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/stats",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data).toHaveProperty("totalTenants");
      expect(data).toHaveProperty("totalUsers");
      expect(data).toHaveProperty("systemStatus", "OPERATIONAL");
      expect(typeof data.totalTenants).toBe("number");
      expect(data.totalTenants).toBeGreaterThanOrEqual(2);
    });

    it("should allow SuperAdmin to list all tenants with deep metadata", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/tenants",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const list = body.data || body;
      expect(Array.isArray(list)).toBe(true);
      const tenantA = list.find((t: any) => t.id === tenantAId);
      expect(tenantA).toBeDefined();
      expect(tenantA.organizations[0].name).toBe("Tenant A Enterprises");
    });

    it("should allow SuperAdmin to transactionally provision a new tenant", async () => {
      const phone = `9988${Math.floor(100000 + Math.random() * 900000)}`;
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/tenants",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          primaryPhone: phone,
          organizationName: "Provisioned Corp",
          tradeName: "Provisioned Mart",
          adminFullName: "Provisioned Director",
          adminEmail: `admin.${phone}@provisioned.local`,
          adminPhone: phone,
          adminPassword: "Password123#",
          tier: SubscriptionTier.DISTRIBUTION_ENTERPRISE,
          validityDays: 90,
          stateCode: "24",
        },
      });
      expect(res.statusCode).toBe(201);
      const created = JSON.parse(res.body);
      expect(created).toHaveProperty("id");
      expect(created).toHaveProperty("organizationId");
      expect(created).toHaveProperty("companyId");
      expect(created).toHaveProperty("userId");

      // Verify in DB that all components were provisioned transactionally
      const checkOrg = await prisma.organization.findUnique({
        where: { id: created.organizationId },
        include: { companies: true, users: true },
      });
      expect(checkOrg).toBeDefined();
      expect(checkOrg?.companies.length).toBe(1);
      expect(checkOrg?.users.length).toBe(1);
    });

    it("should allow SuperAdmin to update tenant subscription and status", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/super-admin/tenants/${tenantAId}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          subscriptionTier: SubscriptionTier.DISTRIBUTION_ENTERPRISE,
          extendDays: 60,
          reason: "Annual enterprise renewal approval",
        },
      });
      expect(res.statusCode).toBe(200);
      const updated = JSON.parse(res.body);
      expect(updated.subscriptionTier).toBe(SubscriptionTier.DISTRIBUTION_ENTERPRISE);
    });

    it("should allow SuperAdmin to list cross-tenant users", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/users",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const users = body.data || body;
      expect(Array.isArray(users)).toBe(true);
      expect(users.some((u: any) => u.id === companyAdminUser.id)).toBe(true);
    });

    it("should allow SuperAdmin to inspect cross-tenant audit logs", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/audit-logs",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const logs = JSON.parse(res.body);
      expect(Array.isArray(logs)).toBe(true);
    });

    it("should allow SuperAdmin to run system diagnostics", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/diagnostics",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const diag = JSON.parse(res.body);
      expect(diag.database).toHaveProperty("status", "HEALTHY");
      expect(diag.database).toHaveProperty("rlsEnforced", true);
      expect(diag).toHaveProperty("system");
    });
  });

  // =========================================================================
  // 6. SELF-LOCKOUT PREVENTION
  // =========================================================================
  describe("6. SuperAdmin Self-Lockout Prevention", () => {
    it("should reject SuperAdmin from deactivating their own account", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/super-admin/users/${superAdminUser.id}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { isActive: false },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.message).toContain("Self-lockout denied");
    });

    it("should reject SuperAdmin from downgrading their own role to CASHIER", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/super-admin/users/${superAdminUser.id}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { role: UserRole.CASHIER },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.message).toContain("Self-lockout denied");
    });
  });

  // =========================================================================
  // 7. SECURE TENANT CONTEXT SWITCHING / IMPERSONATION
  // =========================================================================
  describe("7. Secure Tenant Context Switching & Impersonation Workflow", () => {
    it("should reject impersonation request with non-existent tenant/company", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/impersonate",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          targetCompanyId: "00000000-0000-0000-0000-000000000000",
          reason: "Investigating customer issue",
        },
      });
      expect(res.statusCode).toBe(404);
    });

    it("should issue a secure short-lived support token for authorized SuperAdmin and create audit record", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/impersonate",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          targetCompanyId: companyAId,
          reason: "GST e-way bill sync verification",
        },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data).toHaveProperty("supportToken");
      expect(data.targetContext.companyId).toBe(companyAId);

      // Verify audit log was recorded with actor identity
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: "SUPERADMIN_SUPPORT_SESSION_ENTER",
          userId: superAdminUser.id,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toBeDefined();
      expect(audit?.entityId).toBe(companyAId);
    });

    it("should record support exit audit event when SuperAdmin exits support session", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/impersonate/exit",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          targetCompanyId: companyAId,
        },
      });
      expect(res.statusCode).toBe(200);

      const audit = await prisma.auditLog.findFirst({
        where: {
          action: "SUPERADMIN_SUPPORT_SESSION_EXIT",
          userId: superAdminUser.id,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toBeDefined();
    });

    it("should reject support-session token from invoking platform-admin endpoints", async () => {
      // 1. Enter support session to obtain support token
      const enterRes = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/impersonate",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { targetCompanyId: companyAId, reason: "Testing support scope" },
      });
      expect(enterRes.statusCode).toBe(200);
      const { supportToken } = JSON.parse(enterRes.body);

      // 2. Attempt to invoke SuperAdmin stats with the support token -> MUST be 403
      const statsRes = await app.inject({
        method: "GET",
        url: "/api/v1/super-admin/stats",
        headers: { authorization: `Bearer ${supportToken}` },
      });
      expect(statsRes.statusCode).toBe(403);
      const body = JSON.parse(statsRes.body);
      expect(body.message).toContain("Support session tokens cannot invoke platform administration endpoints");
    });

    it("should reject support-session token from modifying x-company-id to target another tenant", async () => {
      // 1. Enter support session for Company A
      const enterRes = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/impersonate",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { targetCompanyId: companyAId, reason: "Testing company isolation" },
      });
      const { supportToken } = JSON.parse(enterRes.body);

      // 2. Attempt to access Company B using Company A support token -> MUST be 403
      const crossCompRes = await app.inject({
        method: "GET",
        url: "/api/v1/parties",
        headers: {
          authorization: `Bearer ${supportToken}`,
          "x-company-id": companyBId,
        },
      });
      expect(crossCompRes.statusCode).toBe(403);
      const body = JSON.parse(crossCompRes.body);
      expect(body.message).toContain("Cross-company access forbidden");
    });

    it("should reject support-session token once session exit has been called", async () => {
      // 1. Enter support session
      const enterRes = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/impersonate",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { targetCompanyId: companyAId, reason: "Testing termination" },
      });
      const { supportToken, sessionId } = JSON.parse(enterRes.body);

      // 2. Exit support session
      const exitRes = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/impersonate/exit",
        headers: { authorization: `Bearer ${supportToken}` },
        payload: { companyId: companyAId, sessionId },
      });
      expect(exitRes.statusCode).toBe(200);

      // 3. Attempt to use support token after exit -> MUST be 401 Unauthorized
      const useAfterExitRes = await app.inject({
        method: "GET",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${supportToken}` },
      });
      expect(useAfterExitRes.statusCode).toBe(401);
      const body = JSON.parse(useAfterExitRes.body);
      expect(body.message).toContain("Support session has been terminated");
    });
  });

  // =========================================================================
  // 8. CREDENTIAL LEAKAGE & SENSITIVE DATA DEFENSE
  // =========================================================================
  describe("8. Credential Security & Last-SuperAdmin Protection", () => {
    it("should never expose password hashes or sensitive tokens in user update responses", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/super-admin/users/${companyAdminUser.id}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { newPassword: "BrandNewSecurePassword123#" },
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data).not.toHaveProperty("passwordHash");
      expect(data).not.toHaveProperty("password");
      expect(data).not.toHaveProperty("newPassword");

      // Verify audit log also did not store the plaintext or hash
      const audit = await prisma.auditLog.findFirst({
        where: {
          action: "SUPERADMIN_USER_UPDATE",
          entityId: companyAdminUser.id,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).toBeDefined();
      const auditStr = JSON.stringify(audit);
      expect(auditStr).not.toContain("BrandNewSecurePassword123#");
    });

    it("should reject deactivating the last remaining active platform SuperAdmin", async () => {
      // superAdminUser is the only active SuperAdmin (deactivatedSuperAdminUser is inactive)
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/super-admin/users/${superAdminUser.id}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { isActive: false },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.message).toContain("Self-lockout denied");
    });
  });

  // =========================================================================
  // 9. PRODUCTION HARDENING: SHARED DURABLE SESSION REGISTRY & POSTGRESQL RLS
  // (Clearly marked as Real PostgreSQL Integration Tests vs Mocks)
  // =========================================================================
  describe("9. Production Hardening: Shared Durable Session Registry & Security Guarantees (Real PostgreSQL Tests)", () => {
    let supportToken: string;
    let sessionId: string;

    it("[Real PostgreSQL] should persist active support session to the durable support_sessions database table", async () => {
      const enterRes = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/impersonate",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { targetCompanyId: companyAId, reason: "Durable session verification" },
      });
      expect(enterRes.statusCode).toBe(200);
      const data = JSON.parse(enterRes.body);
      supportToken = data.supportToken;
      sessionId = data.sessionId;
      expect(sessionId).toBeDefined();

      // Directly verify row exists in PostgreSQL support_sessions table
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, actor_id, target_organization_id, target_company_id, is_revoked, expires_at
         FROM support_sessions WHERE id = $1`,
        sessionId,
      );
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(sessionId);
      expect(rows[0].actor_id).toBe(superAdminUser.id);
      expect(rows[0].target_organization_id).toBe(orgAId);
      expect(rows[0].target_company_id).toBe(companyAId);
      expect(rows[0].is_revoked).toBe(false);
      expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it("[Real PostgreSQL] should reject support session requests if session is expired in PostgreSQL", async () => {
      // Force expiry in PostgreSQL by backdating expires_at
      await prisma.$executeRawUnsafe(
        `UPDATE support_sessions SET expires_at = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
        sessionId,
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${supportToken}` },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("SUPPORT_SESSION_EXPIRED");
    });

    it("[Real PostgreSQL] should reject support session requests if session is explicitly marked revoked in PostgreSQL", async () => {
      // Re-enter a valid session
      const enterRes = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/impersonate",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { targetCompanyId: companyAId, reason: "Revocation test" },
      });
      const data = JSON.parse(enterRes.body);
      const activeToken = data.supportToken;
      const activeSessionId = data.sessionId;

      // Mark revoked in DB
      await prisma.$executeRawUnsafe(
        `UPDATE support_sessions SET is_revoked = TRUE, revoked_at = NOW() WHERE id = $1`,
        activeSessionId,
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${activeToken}` },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("SUPPORT_SESSION_EXPIRED");
    });

    it("[Real PostgreSQL] should support multiple API instances and restarts via durable PostgreSQL session table", async () => {
      // 1. Enter session on Primary Instance (app)
      const enterRes = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/impersonate",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { targetCompanyId: companyAId, reason: "Cross-instance test" },
      });
      const data = JSON.parse(enterRes.body);
      const sharedSupportToken = data.supportToken;
      const sharedSessionId = data.sessionId;

      // 2. Spin up a secondary API instance (simulating second load-balanced container or API restart)
      const moduleFixtureB: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      const instanceB = moduleFixtureB.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter({ logger: false }),
      );
      instanceB.setGlobalPrefix("api/v1");
      await instanceB.init();
      await instanceB.getHttpAdapter().getInstance().ready();

      try {
        // 3. Make request on Instance B using token created on Instance A
        const resOnB = await instanceB.inject({
          method: "GET",
          url: "/api/v1/parties",
          headers: { authorization: `Bearer ${sharedSupportToken}` },
        });
        expect(resOnB.statusCode).toBe(200);

        // 4. Revoke session on Instance A via exit endpoint
        const exitRes = await app.inject({
          method: "POST",
          url: "/api/v1/super-admin/impersonate/exit",
          headers: { authorization: `Bearer ${sharedSupportToken}` },
          payload: { companyId: companyAId, sessionId: sharedSessionId },
        });
        expect(exitRes.statusCode).toBe(200);

        // 5. Instance B immediately sees the revocation without in-memory state or sticky sessions
        const resOnBAfterRevoke = await instanceB.inject({
          method: "GET",
          url: "/api/v1/parties",
          headers: { authorization: `Bearer ${sharedSupportToken}` },
        });
        expect(resOnBAfterRevoke.statusCode).toBe(401);
        const body = JSON.parse(resOnBAfterRevoke.body);
        expect(body.error).toBe("SUPPORT_SESSION_EXPIRED");
      } finally {
        await instanceB.close();
      }
    });

    it("[Real PostgreSQL] should revoke all support sessions when SuperAdmin logs out via POST /api/v1/auth/logout", async () => {
      const enterRes = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/impersonate",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { targetCompanyId: companyAId, reason: "Logout revocation test" },
      });
      const { supportToken: tokenBeforeLogout, sessionId: sessId } = JSON.parse(enterRes.body);

      // Verify active
      const preCheck = await app.inject({
        method: "GET",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${tokenBeforeLogout}` },
      });
      expect(preCheck.statusCode).toBe(200);

      // Perform logout
      const logoutRes = await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(logoutRes.statusCode).toBe(200);

      // Verify token is now rejected
      const postCheck = await app.inject({
        method: "GET",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${tokenBeforeLogout}` },
      });
      expect(postCheck.statusCode).toBe(401);

      // Verify DB record is revoked
      const sessRow = await prisma.$queryRawUnsafe<any[]>(
        `SELECT is_revoked FROM support_sessions WHERE id = $1`,
        sessId,
      );
      expect(sessRow[0].is_revoked).toBe(true);
    });

    it("[Real PostgreSQL] should reject support tokens with forged/mismatched actor or company claims", async () => {
      // 1. Enter legitimate session
      const enterRes = await app.inject({
        method: "POST",
        url: "/api/v1/super-admin/impersonate",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { targetCompanyId: companyAId, reason: "Mismatched claims test" },
      });
      const { sessionId: validSessId } = JSON.parse(enterRes.body);

      // 2. Tampered token: forged company mismatch (claiming Company B with session for Company A)
      const tamperedCompanyToken = await jwtService.signAsync({
        sub: superAdminUser.id,
        userId: superAdminUser.id,
        organizationId: orgAId,
        role: UserRole.SUPER_ADMIN,
        isSupportSession: true,
        sessionId: validSessId,
        impersonatedCompanyId: companyBId, // TAMPERED
      });

      const resTamperedComp = await app.inject({
        method: "GET",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${tamperedCompanyToken}` },
      });
      expect(resTamperedComp.statusCode).toBe(403);
      expect(JSON.parse(resTamperedComp.body).error).toBe("FORBIDDEN_SUPPORT_CLAIM_MISMATCH");

      // 3. Tampered token: forged actor mismatch (claiming to be companyAdminUser using superAdmin's session)
      const tamperedActorToken = await jwtService.signAsync({
        sub: companyAdminUser.id, // TAMPERED
        userId: companyAdminUser.id,
        organizationId: orgAId,
        role: UserRole.SUPER_ADMIN,
        isSupportSession: true,
        sessionId: validSessId,
        impersonatedCompanyId: companyAId,
      });

      const resTamperedActor = await app.inject({
        method: "GET",
        url: "/api/v1/parties",
        headers: { authorization: `Bearer ${tamperedActorToken}` },
      });
      expect(resTamperedActor.statusCode).toBe(403);
      expect(JSON.parse(resTamperedActor.body).error).toBe("FORBIDDEN_SUPPORT_ACTOR_MISMATCH");
    });

    it("[Real PostgreSQL] should prevent tenant users from bypassing RLS via session variable manipulation or parameter injection", async () => {
      // Normal Company Admin attempts to manipulate app.bypass_rls or access Company B data
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/parties",
        headers: {
          authorization: `Bearer ${companyAdminToken}`,
          "x-company-id": companyBId, // Spoofing company B
        },
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toBe("FORBIDDEN_COMPANY_ACCESS");

      // Verify that direct tenant query inside executeInTenantContext strictly enforces RLS
      const crossTenantCheck = await prisma.executeInTenantContext(
        {
          organizationId: orgAId,
          companyId: companyAId,
          isSystemBypass: false,
        },
        async (tx) => {
          // Attempt to query parties in Company B
          const parties = await tx.party.findMany({
            where: { companyId: companyBId },
          });
          return parties;
        },
      );
      // RLS policy prevents viewing Company B rows; result must be empty
      expect(crossTenantCheck).toHaveLength(0);
    });
  });
});
