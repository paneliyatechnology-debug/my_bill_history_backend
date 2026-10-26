import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import {
  UserRole,
  SubscriptionTier,
  GstRegistrationType,
} from "@billing/shared-types";
import * as bcrypt from "bcryptjs";

describe("Enterprise Multi-Company & Multi-Organization Security Suite", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  // Tenant 1 (Trial Tier - limit 1 company)
  let orgTrialId: string;
  let companyTrial1Id: string;
  let userTrialToken: string;
  let userTrialId: string;

  // Tenant 2 (Wholesale Pro Tier - limit 2 companies)
  let orgProId: string;
  let companyPro1Id: string;
  let userProToken: string;
  let userProId: string;

  // Tenant 3 (Foreign Tenant)
  let orgForeignId: string;
  let companyForeignId: string;

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
      const testPhones = ["9999000001", "9999000002", "9999000003"];
      const existingUsers = await tx.user.findMany({
        where: { phone: { in: testPhones } },
        select: { organizationId: true },
      });
      const existingTenants = await tx.tenant.findMany({
        where: { primaryPhone: { in: testPhones } },
        select: { id: true },
      });
      const orgIds = Array.from(
        new Set([
          ...existingUsers.map((u) => u.organizationId),
          ...existingTenants.map((t) => t.id),
        ]),
      );

      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.salesInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.party.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.item.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.ledgerGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.userBranchAssignment.deleteMany({
          where: { branch: { organizationId: { in: orgIds } } },
        });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.branch.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.financialYear.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
        await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
        await tx.tenant.deleteMany({ where: { id: { in: orgIds } } });
      }
    });

    const passwordHash = await bcrypt.hash("SecurePass@123", 10);

    // 1. Setup Tenant 1: Trial Plan (1 company max)
    const t1 = await prisma.executeBypassRls(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          primaryPhone: "9999000001",
          primaryEmail: "trialadmin@test.local",
          subscriptionTier: SubscriptionTier.TRIAL,
          subscriptionEnds: new Date("2028-12-31"),
          isActive: true,
        },
      });

      const org = await tx.organization.create({
        data: {
          tenantId: tenant.id,
          name: "Trial Tenant Org",
        },
      });

      const comp = await tx.company.create({
        data: {
          organizationId: org.id,
          legalName: "Trial Business Pvt Ltd",
          tradeName: "Trial Business",
          gstin: "24AAACT1111A1Z1",
          stateCode: "24",
          addressLine1: "CG Road",
          city: "Ahmedabad",
          pincode: "380009",
          phone: "9999000001",
          pan: "AAACT1111A",
          gstType: GstRegistrationType.REGULAR,
        },
      });

      const br = await tx.branch.create({
        data: {
          organizationId: org.id,
          companyId: comp.id,
          name: "Main Branch",
          code: "BR01",
          isMainBranch: true,
          addressLine1: "CG Road",
          city: "Ahmedabad",
          pincode: "380009",
          stateCode: "24",
          phone: "9999000001",
        },
      });

      const fy = await tx.financialYear.create({
        data: {
          companyId: comp.id,
          name: "FY 2026-27",
          startDate: new Date("2026-04-01"),
          endDate: new Date("2027-03-31"),
          isCurrent: true,
        },
      });

      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          phone: "9999000001",
          email: "trialadmin@test.local",
          passwordHash,
          fullName: "Trial Admin",
          role: UserRole.COMPANY_ADMIN,
          isActive: true,
        },
      });

      await tx.userBranchAssignment.create({
        data: {
          userId: user.id,
          branchId: br.id,
          role: UserRole.COMPANY_ADMIN,
          isDefault: true,
        },
      });

      return { orgId: org.id, compId: comp.id, userId: user.id };
    });

    orgTrialId = t1.orgId;
    companyTrial1Id = t1.compId;
    userTrialId = t1.userId;

    // 2. Setup Tenant 2: Wholesale Pro Plan (2 companies max)
    const t2 = await prisma.executeBypassRls(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          primaryPhone: "9999000002",
          primaryEmail: "proadmin@test.local",
          subscriptionTier: SubscriptionTier.WHOLESALE_PRO,
          subscriptionEnds: new Date("2028-12-31"),
          isActive: true,
        },
      });

      const org = await tx.organization.create({
        data: {
          tenantId: tenant.id,
          name: "Pro Wholesale Org",
        },
      });

      const comp = await tx.company.create({
        data: {
          organizationId: org.id,
          legalName: "Pro Wholesale Primary Ltd",
          tradeName: "Pro Wholesale Co",
          gstin: "24AAACP2222B1Z2",
          stateCode: "24",
          addressLine1: "Ring Road",
          city: "Surat",
          pincode: "395002",
          phone: "9999000002",
          pan: "AAACP2222B",
          gstType: GstRegistrationType.REGULAR,
        },
      });

      const br = await tx.branch.create({
        data: {
          organizationId: org.id,
          companyId: comp.id,
          name: "Main Branch",
          code: "BR01",
          isMainBranch: true,
          addressLine1: "Ring Road",
          city: "Surat",
          pincode: "395002",
          stateCode: "24",
          phone: "9999000002",
        },
      });

      const fy = await tx.financialYear.create({
        data: {
          companyId: comp.id,
          name: "FY 2026-27",
          startDate: new Date("2026-04-01"),
          endDate: new Date("2027-03-31"),
          isCurrent: true,
        },
      });

      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          phone: "9999000002",
          email: "proadmin@test.local",
          passwordHash,
          fullName: "Pro Admin",
          role: UserRole.COMPANY_ADMIN,
          isActive: true,
        },
      });

      await tx.userBranchAssignment.create({
        data: {
          userId: user.id,
          branchId: br.id,
          role: UserRole.COMPANY_ADMIN,
          isDefault: true,
        },
      });

      return { orgId: org.id, compId: comp.id, userId: user.id };
    });

    orgProId = t2.orgId;
    companyPro1Id = t2.compId;
    userProId = t2.userId;

    // 3. Setup Foreign Tenant 3
    const t3 = await prisma.executeBypassRls(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          primaryPhone: "9999000003",
          primaryEmail: "foreign@test.local",
          subscriptionTier: SubscriptionTier.TRIAL,
          subscriptionEnds: new Date("2028-12-31"),
          isActive: true,
        },
      });
      const org = await tx.organization.create({
        data: { tenantId: tenant.id, name: "Foreign Org" },
      });
      const comp = await tx.company.create({
        data: {
          organizationId: org.id,
          legalName: "Foreign Corp Ltd",
          tradeName: "Foreign Corp",
          gstin: "27AAACF3333C1Z3",
          stateCode: "27",
          addressLine1: "Nariman Point",
          city: "Mumbai",
          pincode: "400021",
          phone: "9999000003",
          pan: "AAACF3333C",
          gstType: GstRegistrationType.REGULAR,
        },
      });
      return { orgId: org.id, compId: comp.id };
    });

    orgForeignId = t3.orgId;
    companyForeignId = t3.compId;

    // Login users to get tokens
    const loginTrialRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { identifier: "9999000001", password: "SecurePass@123" },
    });
    userTrialToken = JSON.parse(loginTrialRes.body).accessToken;

    const loginProRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { identifier: "9999000002", password: "SecurePass@123" },
    });
    userProToken = JSON.parse(loginProRes.body).accessToken;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.executeBypassRls(async (tx) => {
      const orgIds = [orgTrialId, orgProId, orgForeignId].filter(Boolean);
      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.salesInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.party.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.item.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.ledgerGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.userBranchAssignment.deleteMany({
          where: { branch: { organizationId: { in: orgIds } } },
        });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.branch.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.financialYear.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
        await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
        await tx.tenant.deleteMany({ where: { id: { in: orgIds } } });
      }
    });

    await app.close();
  });

  // -------------------------------------------------------------
  // Test 1: One-company user sees correct company context & entitlements
  // -------------------------------------------------------------
  it("should return company list and plan entitlements for Trial user", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tenants/companies",
      headers: {
        authorization: `Bearer ${userTrialToken}`,
        "x-company-id": companyTrial1Id,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.companies).toBeDefined();
    expect(body.companies.length).toBe(1);
    expect(body.companies[0].id).toBe(companyTrial1Id);
    expect(body.companies[0].tradeName).toBe("Trial Business");

    expect(body.entitlements).toBeDefined();
    expect(body.entitlements.tier).toBe(SubscriptionTier.TRIAL);
    expect(body.entitlements.maxCompanies).toBe(1);
    expect(body.entitlements.currentCount).toBe(1);
    expect(body.entitlements.canAddCompany).toBe(false);
  });

  // -------------------------------------------------------------
  // Test 2: Plan-limited user cannot exceed company limit
  // -------------------------------------------------------------
  it("should reject company creation when Trial plan limit (1 company) is reached", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/companies",
      headers: {
        authorization: `Bearer ${userTrialToken}`,
        "x-company-id": companyTrial1Id,
      },
      payload: {
        tradeName: "Trial Second Company",
        legalName: "Trial Second Company Ltd",
        stateCode: "24",
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("PLAN_LIMIT_REACHED");
    expect(body.message).toContain("limit reached");
  });

  // -------------------------------------------------------------
  // Test 3: Plan-authorized user can create another company within entitlement
  // -------------------------------------------------------------
  let companyPro2Id: string;

  it("should allow Wholesale Pro user (limit 2) to create second company", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/companies",
      headers: {
        authorization: `Bearer ${userProToken}`,
        "x-company-id": companyPro1Id,
      },
      payload: {
        tradeName: "Pro Wholesale Secondary",
        legalName: "Pro Wholesale Secondary Pvt Ltd",
        gstin: "24AAACP9999X1Z9",
        stateCode: "24",
        city: "Vadodara",
        phone: "9999000003",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.company).toBeDefined();
    expect(body.company.tradeName).toBe("Pro Wholesale Secondary");
    expect(body.branch).toBeDefined();
    expect(body.branch.code).toBe("BR01");
    expect(body.financialYear).toBeDefined();

    companyPro2Id = body.company.id;
  });

  // -------------------------------------------------------------
  // Test 4: Plan-authorized user reaches max limit after second company
  // -------------------------------------------------------------
  it("should reject third company creation for Wholesale Pro user (max 2)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/companies",
      headers: {
        authorization: `Bearer ${userProToken}`,
        "x-company-id": companyPro1Id,
      },
      payload: {
        tradeName: "Pro Wholesale Third (Should Fail)",
        legalName: "Pro Wholesale Third Ltd",
        stateCode: "24",
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("PLAN_LIMIT_REACHED");
  });

  // -------------------------------------------------------------
  // Test 5: Only authorized company memberships appear in company list
  // -------------------------------------------------------------
  it("should only list the 2 companies for Pro tenant and not Foreign company", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tenants/companies",
      headers: {
        authorization: `Bearer ${userProToken}`,
        "x-company-id": companyPro1Id,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.companies.length).toBe(2);
    const ids = body.companies.map((c: any) => c.id);
    expect(ids).toContain(companyPro1Id);
    expect(ids).toContain(companyPro2Id);
    expect(ids).not.toContain(companyForeignId);
    expect(ids).not.toContain(companyTrial1Id);
  });

  // -------------------------------------------------------------
  // Test 6: Authoritative server-side company switching succeeds
  // -------------------------------------------------------------
  it("should authoritatively switch active company context to Company 2", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/switch-context",
      headers: {
        authorization: `Bearer ${userProToken}`,
      },
      payload: {
        companyId: companyPro2Id,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.activeContext).toBeDefined();
    expect(body.activeContext.companyId).toBe(companyPro2Id);
    expect(body.activeContext.companyName).toBe("Pro Wholesale Secondary");
    expect(body.activeContext.branchId).toBeDefined();
    expect(body.activeContext.financialYearId).toBeDefined();
  });

  // -------------------------------------------------------------
  // Test 7: Switching to foreign organization company is rejected with 403
  // -------------------------------------------------------------
  it("should reject switching to foreign organization company with 403 Forbidden", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/switch-context",
      headers: {
        authorization: `Bearer ${userProToken}`,
      },
      payload: {
        companyId: companyForeignId,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.message).toContain("Requested company does not belong to your organization");
  });

  // -------------------------------------------------------------
  // Test 8: Zero-Trust - arbitrary company ID in request header cannot bypass tenant isolation
  // -------------------------------------------------------------
  it("should reject forged X-Company-Id belonging to foreign tenant with 403 Forbidden", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/tenants/companies",
      headers: {
        authorization: `Bearer ${userProToken}`,
        "x-company-id": companyForeignId, // Forged foreign company ID
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(["FORBIDDEN_TENANT_ACCESS", "FORBIDDEN_COMPANY_ACCESS"]).toContain(body.error);
  });

  // -------------------------------------------------------------
  // Test 9: Deactivated user cannot switch context or access companies
  // -------------------------------------------------------------
  it("should reject deactivated user with 403 Forbidden", async () => {
    // Temporarily deactivate Trial user
    await prisma.executeBypassRls(async (tx) => {
      await tx.user.update({
        where: { id: userTrialId },
        data: { isActive: false },
      });
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/switch-context",
      headers: {
        authorization: `Bearer ${userTrialToken}`,
      },
      payload: {
        companyId: companyTrial1Id,
      },
    });

    expect(res.statusCode).toBe(403);

    // Restore active status
    await prisma.executeBypassRls(async (tx) => {
      await tx.user.update({
        where: { id: userTrialId },
        data: { isActive: true },
      });
    });
  });

  // -------------------------------------------------------------
  // Test 10: Cross-company data isolation (RLS & query scoping)
  // -------------------------------------------------------------
  it("should verify company 1 data is isolated from company 2", async () => {
    // Create a party in company 1 via API
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: {
        authorization: `Bearer ${userProToken}`,
        "x-company-id": companyPro1Id,
      },
      payload: {
        name: "Pro Customer Company 1",
        phone: "9876543210",
        stateCode: "24",
        type: "CUSTOMER",
        billingAddress: {
          line1: "Ring Road",
          city: "Surat",
          pincode: "395002",
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const party1 = JSON.parse(createRes.body);

    // Query parties using Company 2 context via API
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/parties",
      headers: {
        authorization: `Bearer ${userProToken}`,
        "x-company-id": companyPro2Id,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const parties = Array.isArray(body) ? body : body.parties || [];
    const partyIds = parties.map((p: any) => p.id);
    expect(partyIds).not.toContain(party1.id);
  });
});
