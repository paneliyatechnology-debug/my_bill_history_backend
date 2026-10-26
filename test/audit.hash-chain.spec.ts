import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseService } from "../src/database/database.service";
import { AuditService } from "../src/audit/audit.service";
import * as crypto from "crypto";

describe("Phase 2 & Hardening: Audit Logging, Canonical Serialization & Concurrency-Safe Chaining", () => {
  let db: DatabaseService;
  let audit: AuditService;

  const orgId = "44444444-4444-4444-4444-444444444444";
  const tenantId = "55555555-5555-5555-5555-555555555555";
  const companyId = "66666666-6666-6666-6666-666666666666";
  const userId = "77777777-7777-7777-7777-777777777777";

  beforeAll(async () => {
    db = new DatabaseService();
    await db.onModuleInit();
    audit = new AuditService(db);

    await db.executeBypassRls(async (tx) => {
      // Clean up previous test run
      await tx.auditLog.deleteMany({ where: { organizationId: orgId } });
      await tx.userBranchAssignment.deleteMany({
        where: { branch: { organizationId: orgId } },
      });
      await tx.user.deleteMany({ where: { organizationId: orgId } });
      await tx.company.deleteMany({ where: { organizationId: orgId } });
      await tx.organization.deleteMany({ where: { id: orgId } });
      await tx.tenant.deleteMany({ where: { id: tenantId } });

      const trialEnd = new Date(Date.now() + 30 * 86400000);
      await tx.tenant.create({
        data: {
          id: tenantId,
          primaryPhone: "9988776655",
          subscriptionTier: "TRIAL",
          subscriptionEnds: trialEnd,
        },
      });

      await tx.organization.create({
        data: {
          id: orgId,
          tenantId,
          name: "Audit Test Org",
          legalName: "Audit Org",
        },
      });

      await tx.company.create({
        data: {
          id: companyId,
          organizationId: orgId,
          legalName: "Audit Co",
          tradeName: "Audit Co",
          stateCode: "24",
          addressLine1: "SG Highway",
          city: "Ahmedabad",
          pincode: "380015",
          phone: "9988776655",
        },
      });

      await tx.user.create({
        data: {
          id: userId,
          organizationId: orgId,
          fullName: "Audit User",
          phone: "9988776655",
          email: "audit@test.local",
          passwordHash: "dummy-hashed",
          role: "COMPANY_ADMIN",
        },
      });
    });
  });

  afterAll(async () => {
    await db.executeBypassRls(async (tx) => {
      await tx.auditLog.deleteMany({ where: { organizationId: orgId } });
      await tx.user.deleteMany({ where: { organizationId: orgId } });
      await tx.company.deleteMany({ where: { organizationId: orgId } });
      await tx.organization.deleteMany({ where: { id: orgId } });
      await tx.tenant.deleteMany({ where: { id: tenantId } });
    });
    await db.onModuleDestroy();
  });

  it("should sanitize sensitive secrets (passwords, tokens, credentials) from audit logs", async () => {
    const testEntityId = "88888888-8888-8888-8888-888888888880";
    const entry = await audit.record({
      organizationId: orgId,
      companyId,
      userId,
      action: "USER_PASSWORD_CHANGE",
      entityName: "User",
      entityId: testEntityId,
      previousState: {
        username: "auditUser",
        password: "PlainTextPassword1!",
        authToken: "secret-bearer-token-12345",
      },
      newState: {
        username: "auditUser",
        password: "NewPlainTextPassword2@",
        apiSecretKey: "top-secret-private-key",
        allowedSetting: "dark-mode",
      },
    });

    const previousState = entry.previousState as any;
    const newState = entry.newState as any;

    expect(previousState.password).toBe("[REDACTED]");
    expect(previousState.authToken).toBe("[REDACTED]");
    expect(previousState.username).toBe("auditUser");

    expect(newState.password).toBe("[REDACTED]");
    expect(newState.apiSecretKey).toBe("[REDACTED]");
    expect(newState.allowedSetting).toBe("dark-mode");
  });

  it("should compute deterministic canonical JSON across arbitrary key ordering and nested structures", () => {
    const payloadA = {
      zKey: "final",
      aKey: 1234,
      nested: {
        yProp: "unicode-ગુજરાતી",
        bProp: [3, 2, { zSub: true, aSub: false }],
        xProp: null,
      },
    };

    const payloadB = {
      nested: {
        xProp: null,
        bProp: [3, 2, { aSub: false, zSub: true }],
        yProp: "unicode-ગુજરાતી",
      },
      aKey: 1234,
      zKey: "final",
    };

    const canonicalA = audit.canonicalJsonStringify(payloadA);
    const canonicalB = audit.canonicalJsonStringify(payloadB);

    expect(canonicalA).toBe(canonicalB);

    const hashA = audit.computeCanonicalHash(
      "prev-hash-123",
      "ACTION",
      "Entity",
      "id-1",
      payloadA,
    );
    const hashB = audit.computeCanonicalHash(
      "prev-hash-123",
      "ACTION",
      "Entity",
      "id-1",
      payloadB,
    );

    expect(hashA).toBe(hashB);
  });

  it("should maintain backwards compatibility with existing legacy-format records", () => {
    // Record where keys in legacy JSON.stringify match insertion order
    const prevHash = "0".repeat(64);
    const action = "CREATE_SALES_INVOICE";
    const entityName = "SalesInvoice";
    const entityId = "entity-999";
    const legacyObj = { invoiceNumber: "INV/001", grandTotal: 500 };

    const legacyPayload = JSON.stringify(legacyObj);
    const legacyHash = crypto
      .createHash("sha256")
      .update(
        `${prevHash}|${action}|${entityName}|${entityId}|${legacyPayload}`,
      )
      .digest("hex");

    const record = {
      prevHash,
      action,
      entityName,
      entityId,
      newState: legacyObj,
      recordHash: legacyHash,
    };

    const result = audit.verifyRecord(record);
    expect(result.isValid).toBe(true);
    // Legacy format recognized
    expect(["v1_legacy", "v2_canonical"]).toContain(result.version);
  });

  it("should detect tampered payloads and broken previous-hash links", async () => {
    const testEntityUuid = crypto.randomUUID();
    const entry = await audit.record({
      organizationId: orgId,
      companyId,
      userId,
      action: "TAMPER_TEST",
      entityName: "Account",
      entityId: testEntityUuid,
      newState: { balance: 1000 },
    });

    expect(entry).not.toBeNull();

    // Valid record verification
    const validCheck = audit.verifyRecord(entry);
    expect(validCheck.isValid).toBe(true);
    expect(validCheck.version).toBe("v2_canonical");

    // Tampered payload detection
    const tamperedPayloadRecord = {
      ...entry,
      newState: { balance: 999999 }, // Tampered
    };
    const tamperedCheck = audit.verifyRecord(tamperedPayloadRecord);
    expect(tamperedCheck.isValid).toBe(false);
    expect(tamperedCheck.version).toBe("invalid");

    // Tampered prevHash detection
    const tamperedPrevHashRecord = {
      ...entry,
      prevHash: "f".repeat(64),
    };
    const brokenPrevHashCheck = audit.verifyRecord(tamperedPrevHashRecord);
    expect(brokenPrevHashCheck.isValid).toBe(false);
  });

  it("should serialize concurrent parallel writes without forks or duplicate previous hashes", async () => {
    // Clean up audit logs for this specific test company to verify an isolated chain
    await db.executeBypassRls(async (tx) => {
      await tx.auditLog.deleteMany({
        where: { organizationId: orgId, companyId },
      });
    });

    const concurrentCount = 10;
    const actions = Array.from({ length: concurrentCount }, (_, i) => ({
      organizationId: orgId,
      companyId,
      userId,
      action: `CONCURRENT_ACTION_${i}`,
      entityName: "ParallelEntity",
      entityId: crypto.randomUUID(),
      newState: { sequence: i, timestamp: Date.now() },
    }));

    // Trigger 10 parallel asynchronous writes simultaneously
    const results = await Promise.all(actions.map((act) => audit.record(act)));

    expect(results).toHaveLength(concurrentCount);
    for (const res of results) {
      expect(res).not.toBeNull();
    }

    // Verify all 10 records have unique hashes
    const recordHashes = results.map((r) => r.recordHash);
    const uniqueHashes = new Set(recordHashes);
    expect(uniqueHashes.size).toBe(concurrentCount);

    // Verify complete chain using verifyChain
    const chainVerification = await audit.verifyChain(orgId, companyId);
    expect(chainVerification.isValid).toBe(true);
    expect(chainVerification.totalRecords).toBe(concurrentCount);
    expect(chainVerification.errors).toHaveLength(0);

    // Verify no forks: all prevHashes must be unique
    const prevHashes = results.map((r) => r.prevHash);
    const uniquePrevHashes = new Set(prevHashes);
    expect(uniquePrevHashes.size).toBe(concurrentCount);
  });

  it("should atomically roll back financial operations if caller transaction fails", async () => {
    const testItemId = crypto.randomUUID();
    const uniqueCode = `TU_${Date.now()}`;

    let errorCaught = false;
    let actualError: any = null;
    try {
      await db.executeBypassRls(async (tx) => {
        await tx.unitOfMeasure.create({
          data: {
            id: testItemId,
            organizationId: orgId,
            companyId: companyId,
            name: "Test Unit Rollback",
            symbol: "TUR",
            uqcCode: "NOS",
            decimalPlaces: 0,
          },
        });

        await audit.record(
          {
            organizationId: orgId,
            companyId,
            userId,
            action: "CREATE_UNIT_ROLLBACK_TEST",
            entityName: "UnitOfMeasure",
            entityId: testItemId,
            newState: { name: "Test Unit Rollback", symbol: "TUR" },
          },
          tx,
        );

        // Force intentional transaction failure
        throw new Error("INTENTIONAL_TRANSACTION_FAILURE");
      });
    } catch (err: any) {
      if (err.message?.includes("INTENTIONAL_TRANSACTION_FAILURE")) {
        errorCaught = true;
      }
    }

    expect(errorCaught).toBe(true);

    // Verify atomic rollback: neither unit nor audit log entry must exist
    const unitInDb = await db.executeBypassRls(async (tx) =>
      tx.unitOfMeasure.findUnique({ where: { id: testItemId } }),
    );
    expect(unitInDb).toBeNull();

    const auditInDb = await db.executeBypassRls(async (tx) =>
      tx.auditLog.findFirst({
        where: {
          organizationId: orgId,
          entityId: testItemId,
          action: "CREATE_UNIT_ROLLBACK_TEST",
        },
      }),
    );
    expect(auditInDb).toBeNull();
  });
});
