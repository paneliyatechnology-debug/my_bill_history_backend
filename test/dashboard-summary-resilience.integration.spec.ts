import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { PartyType, InvoiceStatus, TenantContext } from "@billing/shared-types";
import { PrismaClient } from "@billing/database";

describe("Dashboard Summary Transaction & Database Resilience (Integration Suite)", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  // Tenant A (with financial data)
  let tenantAOrgId: string;
  let tenantACompanyId: string;
  let tenantAToken: string;

  // Tenant B (for tenant isolation)
  let tenantBOrgId: string;
  let tenantBCompanyId: string;
  let tenantBToken: string;

  // Tenant Empty (no transactions)
  let tenantEmptyOrgId: string;
  let tenantEmptyCompanyId: string;
  let tenantEmptyToken: string;

  const testPhones = ["9999000001", "9999000002", "9999000003"];

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
        await tx.auditLog.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.salesInvoiceItem.deleteMany({
          where: { invoice: { organizationId: { in: orgIds } } },
        });
        await tx.salesInvoice.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.purchaseInvoiceItem.deleteMany({
          where: { invoice: { organizationId: { in: orgIds } } },
        });
        await tx.purchaseInvoice.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.journalEntry.deleteMany({
          where: { voucher: { organizationId: { in: orgIds } } },
        });
        await tx.voucher.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.ledgerAccount.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.ledgerGroup.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.party.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.warehouse.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.unitOfMeasure.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.financialYear.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.userBranchAssignment.deleteMany({
          where: { branch: { company: { organizationId: { in: orgIds } } } },
        });
        await tx.branch.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.company.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
      await tx.tenant.deleteMany({
        where: { primaryPhone: { in: testPhones } },
      });
    });

    // 1. Register Tenant A
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        organizationName: "Resilience Org A",
        companyName: "Resilience Enterprises A",
        tradeName: "Resilience A",
        stateCode: "24",
        city: "Ahmedabad",
        pincode: "380001",
        fullName: "Admin A",
        phone: testPhones[0],
        password: "Password123!",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const dataA = JSON.parse(regResA.payload);
    tenantAToken = dataA.accessToken;
    tenantAOrgId = dataA.defaultContext.organizationId;
    tenantACompanyId = dataA.defaultContext.companyId;

    // 2. Register Tenant B
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        organizationName: "Resilience Org B",
        companyName: "Resilience Enterprises B",
        tradeName: "Resilience B",
        stateCode: "24",
        city: "Surat",
        pincode: "395001",
        fullName: "Admin B",
        phone: testPhones[1],
        password: "Password123!",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const dataB = JSON.parse(regResB.payload);
    tenantBToken = dataB.accessToken;
    tenantBOrgId = dataB.defaultContext.organizationId;
    tenantBCompanyId = dataB.defaultContext.companyId;

    // 3. Register Tenant Empty (no transactions)
    const regResEmpty = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        organizationName: "Resilience Empty Org",
        companyName: "Resilience Empty Enterprises",
        tradeName: "Resilience Empty",
        stateCode: "24",
        city: "Rajkot",
        pincode: "360001",
        fullName: "Admin Empty",
        phone: testPhones[2],
        password: "Password123!",
      },
    });
    expect(regResEmpty.statusCode).toBe(201);
    const dataEmpty = JSON.parse(regResEmpty.payload);
    tenantEmptyToken = dataEmpty.accessToken;
    tenantEmptyOrgId = dataEmpty.defaultContext.organizationId;
    tenantEmptyCompanyId = dataEmpty.defaultContext.companyId;

    // Seed Ledger Groups for A & B
    await app.inject({
      method: "POST",
      url: "/api/v1/ledger-groups/seed",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/ledger-groups/seed",
      headers: {
        authorization: `Bearer ${tenantBToken}`,
        "x-organization-id": tenantBOrgId,
        "x-company-id": tenantBCompanyId,
      },
    });

    // Populate data for Tenant A:
    // - Customer with Sales Invoice: balance 5,000.00
    // - Supplier with Purchase Invoice: balance 3,000.00
    // - Cash account with opening 1,000.00
    await prisma.executeBypassRls(async (tx) => {
      const branchA = await tx.branch.findFirst({
        where: { companyId: tenantACompanyId },
      });
      const fyA = await tx.financialYear.findFirst({
        where: { companyId: tenantACompanyId },
      });
      const currentAssetsGroup = await tx.ledgerGroup.findFirst({
        where: { companyId: tenantACompanyId, name: "Current Assets" },
      });

      // Cash Ledger
      await tx.ledgerAccount.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          groupId: currentAssetsGroup!.id,
          name: "Main Cash A",
          code: "CASH-A",
          isCashLedger: true,
          openingBalance: 1000.0,
          openingType: "DR",
          currentBalance: 1000.0,
        },
      });

      // Customer
      const custA = await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: PartyType.CUSTOMER,
          name: "Customer A",
          phone: "9825111111",
          stateCode: "24",
          billingAddress: {
            line1: "Street 1",
            city: "Ahmedabad",
            stateCode: "24",
            pincode: "380001",
          },
        },
      });

      // Sales Invoice for Customer A
      await tx.salesInvoice.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          branchId: branchA!.id,
          financialYearId: fyA!.id,
          partyId: custA.id,
          invoiceNumber: "INV-A-001",
          invoiceDate: new Date("2026-10-15"),
          placeOfSupply: "24",
          billingAddress: {
            line1: "Street 1",
            city: "Ahmedabad",
            stateCode: "24",
            pincode: "380001",
          },
          subTotal: 5000.0,
          taxableAmount: 5000.0,
          grandTotal: 5000.0,
          paidAmount: 0.0,
          balanceAmount: 5000.0,
          status: InvoiceStatus.OVERDUE,
        },
      });

      // Supplier
      const suppA = await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: PartyType.SUPPLIER,
          name: "Supplier A",
          phone: "9825222222",
          stateCode: "24",
          billingAddress: {
            line1: "Street 2",
            city: "Ahmedabad",
            stateCode: "24",
            pincode: "380001",
          },
        },
      });

      // Purchase Invoice for Supplier A
      await tx.purchaseInvoice.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          branchId: branchA!.id,
          financialYearId: fyA!.id,
          partyId: suppA.id,
          vendorInvoiceNumber: "PUR-VEND-101",
          invoiceDate: new Date("2026-10-18"),
          placeOfSupply: "24",
          taxableAmount: 3000.0,
          grandTotal: 3000.0,
          paidAmount: 0.0,
          balanceAmount: 3000.0,
        },
      });
    });

    // Populate data for Tenant B:
    // - Customer with Sales Invoice: balance 12,000.00
    // - Cash account with opening 2,500.00
    await prisma.executeBypassRls(async (tx) => {
      const branchB = await tx.branch.findFirst({
        where: { companyId: tenantBCompanyId },
      });
      const fyB = await tx.financialYear.findFirst({
        where: { companyId: tenantBCompanyId },
      });
      const currentAssetsGroupB = await tx.ledgerGroup.findFirst({
        where: { companyId: tenantBCompanyId, name: "Current Assets" },
      });

      await tx.ledgerAccount.create({
        data: {
          organizationId: tenantBOrgId,
          companyId: tenantBCompanyId,
          groupId: currentAssetsGroupB!.id,
          name: "Main Cash B",
          code: "CASH-B",
          isCashLedger: true,
          openingBalance: 2500.0,
          openingType: "DR",
          currentBalance: 2500.0,
        },
      });

      const custB = await tx.party.create({
        data: {
          organizationId: tenantBOrgId,
          companyId: tenantBCompanyId,
          type: PartyType.CUSTOMER,
          name: "Customer B",
          phone: "9825333333",
          stateCode: "24",
          billingAddress: {
            line1: "Street 3",
            city: "Surat",
            stateCode: "24",
            pincode: "395001",
          },
        },
      });

      await tx.salesInvoice.create({
        data: {
          organizationId: tenantBOrgId,
          companyId: tenantBCompanyId,
          branchId: branchB!.id,
          financialYearId: fyB!.id,
          partyId: custB.id,
          invoiceNumber: "INV-B-001",
          invoiceDate: new Date("2026-10-20"),
          placeOfSupply: "24",
          billingAddress: {
            line1: "Street 3",
            city: "Surat",
            stateCode: "24",
            pincode: "395001",
          },
          subTotal: 12000.0,
          taxableAmount: 12000.0,
          grandTotal: 12000.0,
          paidAmount: 0.0,
          balanceAmount: 12000.0,
          status: InvoiceStatus.OVERDUE,
        },
      });
    });
  });

  afterAll(async () => {
    // Cleanup
    if (prisma) {
      await prisma.executeBypassRls(async (tx) => {
        const users = await tx.user.findMany({
          where: { phone: { in: testPhones } },
          select: { organizationId: true },
        });
        const orgIds = users.map((u) => u.organizationId);
        if (orgIds.length > 0) {
          await tx.salesInvoiceItem.deleteMany({
            where: { invoice: { organizationId: { in: orgIds } } },
          });
          await tx.salesInvoice.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.purchaseInvoiceItem.deleteMany({
            where: { invoice: { organizationId: { in: orgIds } } },
          });
          await tx.purchaseInvoice.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.journalEntry.deleteMany({
            where: { voucher: { organizationId: { in: orgIds } } },
          });
          await tx.voucher.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.ledgerAccount.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.ledgerGroup.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.party.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.warehouse.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.unitOfMeasure.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.financialYear.deleteMany({
            where: { company: { organizationId: { in: orgIds } } },
          });
          await tx.userBranchAssignment.deleteMany({
            where: { branch: { company: { organizationId: { in: orgIds } } } },
          });
          await tx.branch.deleteMany({
            where: { company: { organizationId: { in: orgIds } } },
          });
          await tx.company.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.user.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
        }
        await tx.tenant.deleteMany({
          where: { primaryPhone: { in: testPhones } },
        });
      });
    }
    if (app) {
      await app.close();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 1: Valid dashboard summary for a tenant with data
  // --------------------------------------------------------------------------
  it("TEST 1: should return accurate financial summary for tenant with data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/dashboard-summary?asOfDate=2026-10-22",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.toCollect).toBe("5000.00");
    expect(body.toPay).toBe("3000.00");
    expect(body.cashBalance).toBe("1000.00");
    expect(body.bankBalance).toBe("0.00");
    expect(body.totalCashBankBalance).toBe("1000.00");
    expect(body.currency).toBe("INR");
    expect(body.asOf).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // TEST 2: Valid summary for a tenant with no transactions
  // --------------------------------------------------------------------------
  it("TEST 2: should return zero amounts for a tenant with no transactions without database errors", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/dashboard-summary?asOfDate=2026-10-22",
      headers: {
        authorization: `Bearer ${tenantEmptyToken}`,
        "x-organization-id": tenantEmptyOrgId,
        "x-company-id": tenantEmptyCompanyId,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.toCollect).toBe("0.00");
    expect(body.toPay).toBe("0.00");
    expect(body.cashBalance).toBe("0.00");
    expect(body.bankBalance).toBe("0.00");
    expect(body.totalCashBankBalance).toBe("0.00");
    expect(body.currency).toBe("INR");
  });

  // --------------------------------------------------------------------------
  // TEST 3: Tenant isolation between two companies
  // --------------------------------------------------------------------------
  it("TEST 3: should strictly isolate data between Company A and Company B", async () => {
    const [resA, resB] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/api/v1/reports/dashboard-summary?asOfDate=2026-10-22",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      }),
      app.inject({
        method: "GET",
        url: "/api/v1/reports/dashboard-summary?asOfDate=2026-10-22",
        headers: {
          authorization: `Bearer ${tenantBToken}`,
          "x-organization-id": tenantBOrgId,
          "x-company-id": tenantBCompanyId,
        },
      }),
    ]);

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);

    const bodyA = JSON.parse(resA.payload);
    const bodyB = JSON.parse(resB.payload);

    // Company A: 5,000 to collect, 3,000 to pay, 1,000 cash
    expect(bodyA.toCollect).toBe("5000.00");
    expect(bodyA.toPay).toBe("3000.00");
    expect(bodyA.cashBalance).toBe("1000.00");

    // Company B: 12,000 to collect, 0 to pay, 2,500 cash
    expect(bodyB.toCollect).toBe("12000.00");
    expect(bodyB.toPay).toBe("0.00");
    expect(bodyB.cashBalance).toBe("2500.00");
  });

  // --------------------------------------------------------------------------
  // TEST 4: Invalid asOfDate and invalid company context
  // --------------------------------------------------------------------------
  describe("TEST 4: Validation checks", () => {
    it("4a: should reject invalid asOfDate with 400 Bad Request", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/reports/dashboard-summary?asOfDate=invalid-date-not-real",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": tenantACompanyId,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toMatch(/Invalid asOfDate format/i);
    });

    it("4b: should reject invalid company UUID context with 400 Bad Request", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/reports/dashboard-summary",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": "not-a-valid-uuid",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toMatch(/Invalid company context identifier/i);
    });

    it("4c: should reject empty company context with 400 Bad Request", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/reports/dashboard-summary",
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          "x-organization-id": tenantAOrgId,
          "x-company-id": "   ",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toMatch(/Company context is required/i);
    });
  });

  // --------------------------------------------------------------------------
  // TEST 5: Missing table/column or simulated database failure propagates original error and rolls back
  // --------------------------------------------------------------------------
  it("TEST 5: should propagate original database error and rollback transaction without aborted-tx error 25P02", async () => {
    const ctx: TenantContext = {
      organizationId: tenantAOrgId,
      companyId: tenantACompanyId,
    };

    let caughtError: any = null;
    try {
      await prisma.executeInTenantContext(ctx, async (tx) => {
        // Query a non-existent table to trigger PostgreSQL 42P01 (undefined_table)
        await tx.$queryRawUnsafe(
          `SELECT * FROM nonexistent_table_for_rollback_test`,
        );
      });
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    // Verify it is the original PostgreSQL error 42P01, NOT 25P02
    const pgErrorCode = caughtError?.meta?.code;
    expect(pgErrorCode).toBe("42P01");
    expect(caughtError.message).toMatch(/nonexistent_table_for_rollback_test/);
  });

  // --------------------------------------------------------------------------
  // TEST 6: Subsequent requests succeed after a failed transaction
  // --------------------------------------------------------------------------
  it("TEST 6: subsequent requests succeed immediately after a transaction failure without connection poisoning", async () => {
    const ctx: TenantContext = {
      organizationId: tenantAOrgId,
      companyId: tenantACompanyId,
    };

    // Deliberately fail a transaction
    try {
      await prisma.executeInTenantContext(ctx, async (tx) => {
        await tx.$queryRawUnsafe(`SELECT * FROM intentionally_missing_table`);
      });
    } catch {
      // expected failure
    }

    // Immediately execute a valid dashboard-summary query on the same connection pool
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/dashboard-summary?asOfDate=2026-10-22",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.toCollect).toBe("5000.00");
  });

  // --------------------------------------------------------------------------
  // TEST 7: Concurrent requests do not leak company context between pooled database connections
  // --------------------------------------------------------------------------
  it("TEST 7: concurrent requests do not leak company context across pooled connections", async () => {
    const requests = Array.from({ length: 16 }).map((_, i) => {
      const isTenantA = i % 2 === 0;
      return app.inject({
        method: "GET",
        url: "/api/v1/reports/dashboard-summary?asOfDate=2026-10-22",
        headers: {
          authorization: `Bearer ${isTenantA ? tenantAToken : tenantBToken}`,
          "x-organization-id": isTenantA ? tenantAOrgId : tenantBOrgId,
          "x-company-id": isTenantA ? tenantACompanyId : tenantBCompanyId,
        },
      });
    });

    const responses = await Promise.all(requests);

    responses.forEach((res, i) => {
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      const isTenantA = i % 2 === 0;
      if (isTenantA) {
        expect(body.toCollect).toBe("5000.00");
        expect(body.toPay).toBe("3000.00");
      } else {
        expect(body.toCollect).toBe("12000.00");
        expect(body.toPay).toBe("0.00");
      }
    });
  });

  // --------------------------------------------------------------------------
  // TEST 8: Non-superuser simulation (Render production environment)
  // --------------------------------------------------------------------------
  it("TEST 8: non-superuser connection executes in tenant context without role-switch error 42501 or 25P02", async () => {
    // Connect as a simulated non-superuser role (similar to Render DB user)
    // Create temporary non-superuser role
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'test_render_runner') THEN
          CREATE ROLE test_render_runner WITH LOGIN PASSWORD 'test_pw' NOSUPERUSER;
          GRANT CONNECT ON DATABASE billing_db TO test_render_runner;
          GRANT USAGE ON SCHEMA public TO test_render_runner;
          GRANT SELECT ON ALL TABLES IN SCHEMA public TO test_render_runner;
        END IF;
      END $$;
    `);

    const renderDbUrl = process.env.DATABASE_URL!.replace(
      /postgres:[^@]+@/,
      "test_render_runner:test_pw@",
    );
    const renderPrisma = new DatabaseService({
      datasources: { db: { url: renderDbUrl } },
    });
    await renderPrisma.$connect();

    try {
      const caps = await renderPrisma.detectRoleCapabilities();
      // Render user is non-superuser
      expect(caps.isSuperuser).toBe(false);

      // Execute tenant query as non-superuser
      const tenantCtx: TenantContext = {
        organizationId: tenantAOrgId,
        companyId: tenantACompanyId,
      };

      const result = await renderPrisma.executeInTenantContext(
        tenantCtx,
        async (tx) => {
          return await tx.party.findMany({
            where: { companyId: tenantACompanyId },
            select: { id: true, name: true },
          });
        },
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    } finally {
      await renderPrisma.$disconnect();
      try {
        await prisma.$executeRawUnsafe(
          `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM test_render_runner;`,
        );
        await prisma.$executeRawUnsafe(
          `REVOKE ALL ON SCHEMA public FROM test_render_runner;`,
        );
        await prisma.$executeRawUnsafe(
          `REVOKE ALL ON DATABASE billing_db FROM test_render_runner;`,
        );
        await prisma.$executeRawUnsafe(
          `DROP ROLE IF EXISTS test_render_runner;`,
        );
      } catch {
        // cleanup best-effort
      }
    }
  });
});
