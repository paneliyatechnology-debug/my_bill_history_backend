import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseService } from "../src/database/database.service";

describe("Phase 2: PostgreSQL Row-Level Security (RLS) & Connection-Pool Isolation", () => {
  let db: DatabaseService;

  const orgAId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const orgBId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const tenantAId = "11111111-1111-1111-1111-111111111111";
  const tenantBId = "22222222-2222-2222-2222-222222222222";
  const companyAId = "caaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const companyBId = "cbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const userAId = "0aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const userBId = "0bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeAll(async () => {
    db = new DatabaseService();
    await db.onModuleInit();

    // Clean up test data if any
    await db.executeBypassRls(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM audit_logs WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM users WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM parties WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM branches WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM companies WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM organizations WHERE id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM tenants WHERE id IN ('${tenantAId}', '${tenantBId}')`,
      );

      // Create base tenants and orgs under bypass
      const trialEnd = new Date(Date.now() + 30 * 86400000);
      await tx.tenant.createMany({
        data: [
          {
            id: tenantAId,
            primaryPhone: "9900000001",
            subscriptionTier: "TRIAL",
            subscriptionEnds: trialEnd,
          },
          {
            id: tenantBId,
            primaryPhone: "9900000002",
            subscriptionTier: "TRIAL",
            subscriptionEnds: trialEnd,
          },
        ],
      });

      await tx.organization.createMany({
        data: [
          {
            id: orgAId,
            tenantId: tenantAId,
            name: "RLS Test Org A",
            legalName: "RLS Org A",
          },
          {
            id: orgBId,
            tenantId: tenantBId,
            name: "RLS Test Org B",
            legalName: "RLS Org B",
          },
        ],
      });

      await tx.company.createMany({
        data: [
          {
            id: companyAId,
            organizationId: orgAId,
            legalName: "RLS Company A",
            tradeName: "RLS Company A",
            stateCode: "24",
            addressLine1: "Market Yard GIDC",
            city: "Ahmedabad",
            pincode: "380001",
            phone: "9900000001",
          },
          {
            id: companyBId,
            organizationId: orgBId,
            legalName: "RLS Company B",
            tradeName: "RLS Company B",
            stateCode: "24",
            addressLine1: "Krishi Mandi",
            city: "Surat",
            pincode: "395001",
            phone: "9900000002",
          },
        ],
      });

      await tx.user.createMany({
        data: [
          {
            id: userAId,
            organizationId: orgAId,
            fullName: "User A",
            phone: "9900000001",
            email: "usera@test.local",
            passwordHash: "dummy",
            role: "COMPANY_ADMIN",
          },
          {
            id: userBId,
            organizationId: orgBId,
            fullName: "User B",
            phone: "9900000002",
            email: "userb@test.local",
            passwordHash: "dummy",
            role: "COMPANY_ADMIN",
          },
        ],
      });
    });
  });

  afterAll(async () => {
    await db.executeBypassRls(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM audit_logs WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM users WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM parties WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM branches WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM companies WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM organizations WHERE id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM tenants WHERE id IN ('${tenantAId}', '${tenantBId}')`,
      );
    });
    await db.onModuleDestroy();
  });

  it("should restrict Tenant A from seeing Tenant B companies when tenant context is active", async () => {
    const companiesTenantA = await db.executeInTenantContext(
      {
        organizationId: orgAId,
        companyId: companyAId,
      },
      async (tx) => {
        return tx.company.findMany();
      },
    );

    // Tenant A context must ONLY see Tenant A's company
    expect(companiesTenantA).toHaveLength(1);
    expect(companiesTenantA[0].id).toBe(companyAId);
    expect(companiesTenantA[0].organizationId).toBe(orgAId);
  });

  it("should restrict Tenant B from seeing Tenant A companies when tenant context is active", async () => {
    const companiesTenantB = await db.executeInTenantContext(
      {
        organizationId: orgBId,
        companyId: companyBId,
      },
      async (tx) => {
        return tx.company.findMany();
      },
    );

    // Tenant B context must ONLY see Tenant B's company
    expect(companiesTenantB).toHaveLength(1);
    expect(companiesTenantB[0].id).toBe(companyBId);
    expect(companiesTenantB[0].organizationId).toBe(orgBId);
  });

  it("should isolate parties across tenants under RLS", async () => {
    const partyAId = "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const partyBId = "22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    // Tenant A creates party A
    await db.executeInTenantContext(
      { organizationId: orgAId, companyId: companyAId },
      async (tx) => {
        await tx.party.create({
          data: {
            id: partyAId,
            organizationId: orgAId,
            companyId: companyAId,
            type: "CUSTOMER",
            name: "Customer of A",
            phone: "9900000010",
            stateCode: "24",
            billingAddress: { line1: "Market Yard", city: "Ahmedabad" },
          },
        });
      },
    );

    // Tenant B creates party B
    await db.executeInTenantContext(
      { organizationId: orgBId, companyId: companyBId },
      async (tx) => {
        await tx.party.create({
          data: {
            id: partyBId,
            organizationId: orgBId,
            companyId: companyBId,
            type: "CUSTOMER",
            name: "Customer of B",
            phone: "9900000020",
            stateCode: "24",
            billingAddress: { line1: "Ring Road", city: "Surat" },
          },
        });
      },
    );

    // Query under Tenant A context
    const partiesA = await db.executeInTenantContext(
      { organizationId: orgAId, companyId: companyAId },
      async (tx) => {
        return tx.party.findMany();
      },
    );

    // Must strictly only see party A
    expect(partiesA.some((p) => p.id === partyAId)).toBe(true);
    expect(partiesA.some((p) => p.id === partyBId)).toBe(false);

    // Query under Tenant B context
    const partiesB = await db.executeInTenantContext(
      { organizationId: orgBId, companyId: companyBId },
      async (tx) => {
        return tx.party.findMany();
      },
    );

    // Must strictly only see party B
    expect(partiesB.some((p) => p.id === partyBId)).toBe(true);
    expect(partiesB.some((p) => p.id === partyAId)).toBe(false);
  });

  it("should guarantee connection pool isolation by resetting session variables after transaction", async () => {
    // Run Tenant A transaction
    await db.executeInTenantContext(
      { organizationId: orgAId, companyId: companyAId },
      async (tx) => {
        const result = await tx.$queryRaw<Array<{ current_setting: string }>>`
          SELECT current_setting('app.current_organization_id', true) as current_setting
        `;
        expect(result[0].current_setting).toBe(orgAId);
      },
    );

    // Now query outside executeInTenantContext directly on db (simulating pooled connection reused)
    const directResult = await db.$queryRaw<Array<{ current_setting: string }>>`
      SELECT current_setting('app.current_organization_id', true) as current_setting
    `;

    // The session variable MUST be empty/null outside the transaction because SET LOCAL was used
    expect(directResult[0].current_setting).toBeFalsy();
  });

  it("should cleanly rollback all changes when an error occurs inside tenant transaction", async () => {
    const testBranchId = "33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

    let errorThrown = false;
    try {
      await db.executeInTenantContext(
        { organizationId: orgAId, companyId: companyAId },
        async (tx) => {
          // 1. Create a branch
          await tx.branch.create({
            data: {
              id: testBranchId,
              organizationId: orgAId,
              companyId: companyAId,
              code: "RB-FAIL",
              name: "Rollback Test Branch",
              addressLine1: "Station Road",
              city: "Ahmedabad",
              pincode: "380001",
              stateCode: "24",
              phone: "9900000001",
            },
          });

          // 2. Deliberately throw an error before completion
          throw new Error("Simulated atomic transaction failure");
        },
      );
    } catch (err: any) {
      errorThrown = true;
      expect(err.message).toContain("Simulated atomic transaction failure");
    }

    expect(errorThrown).toBe(true);

    // Verify branch was NOT persisted due to transaction rollback
    const branchRecord = await db.executeBypassRls(async (tx) => {
      return tx.branch.findUnique({
        where: { id: testBranchId },
      });
    });

    expect(branchRecord).toBeNull();
  });

  it("should enforce strict tenant isolation on audit_logs table", async () => {
    const auditAId = "55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const auditBId = "55555555-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    // 1. Create audit log for Org A
    await db.executeInTenantContext(
      { organizationId: orgAId, companyId: companyAId },
      async (tx) => {
        await tx.auditLog.create({
          data: {
            id: auditAId,
            organizationId: orgAId,
            companyId: companyAId,
            userId: userAId,
            action: "TENANT_A_ACTION",
            entityName: "Branch",
            entityId: "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            prevHash: "0".repeat(64),
            recordHash: "a".repeat(64),
            newState: { note: "Tenant A private audit" },
          },
        });
      },
    );

    // 2. Query under Tenant B context - Org A's audit log MUST NOT be visible
    const queryUnderTenantB = await db.executeInTenantContext(
      { organizationId: orgBId, companyId: companyBId },
      async (tx) => {
        return tx.auditLog.findMany({
          where: { id: auditAId },
        });
      },
    );
    expect(queryUnderTenantB).toHaveLength(0);

    // 3. Attempting to write audit log with Org A's ID while under Tenant B context MUST fail RLS WITH CHECK
    let crossTenantWriteFailed = false;
    try {
      await db.executeInTenantContext(
        { organizationId: orgBId, companyId: companyBId },
        async (tx) => {
          await tx.auditLog.create({
            data: {
              id: auditBId,
              organizationId: orgAId, // Spoofed Org A
              companyId: companyAId,
              userId: userBId,
              action: "FORGED_ACTION",
              entityName: "Branch",
              entityId: "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              prevHash: "0".repeat(64),
              recordHash: "b".repeat(64),
              newState: { note: "Forged cross-tenant audit" },
            },
          });
        },
      );
    } catch {
      crossTenantWriteFailed = true;
    }
    expect(crossTenantWriteFailed).toBe(true);
  });
});
