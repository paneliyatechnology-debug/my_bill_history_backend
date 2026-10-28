import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Invoice print settings persistence & tenant isolation", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;
  let tokenA: string;
  let tokenB: string;
  let orgA: string;
  let companyA: string;
  let orgB: string;
  let companyB: string;

  const phones = ["9898000191", "9898000192"];

  const headers = (token: string, orgId: string, companyId: string) => ({
    authorization: `Bearer ${token}`,
    "x-organization-id": orgId,
    "x-company-id": companyId,
  });

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

    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: { in: phones } },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (!orgIds.length) return;
      await tx.companyInvoicePrintSettings.deleteMany({
        where: { organizationId: { in: orgIds } },
      });
      await tx.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.userBranchAssignment.deleteMany({
        where: { branch: { organizationId: { in: orgIds } } },
      });
      await tx.journalEntry.deleteMany({
        where: { voucher: { organizationId: { in: orgIds } } },
      });
      await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.ledgerGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.warehouse.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.invoiceSequence.deleteMany({
        where: { company: { organizationId: { in: orgIds } } },
      });
      await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.financialYear.deleteMany({
        where: { company: { organizationId: { in: orgIds } } },
      });
      await tx.branch.deleteMany({ where: { organizationId: { in: orgIds } } });
      await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } });
      const orgs = await tx.organization.findMany({
        where: { id: { in: orgIds } },
        select: { tenantId: true },
      });
      await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      await tx.tenant.deleteMany({
        where: { id: { in: orgs.map((o) => o.tenantId) } },
      });
    });

    const a = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Invoice Settings Admin A",
        phone: phones[0],
        email: "invsettingsA@test.local",
        password: "PasswordInvoice123#",
        organizationName: "Invoice Settings Org A",
        tradeName: "Settings A Traders",
        stateCode: "24",
      },
    });
    expect(a.statusCode).toBe(201);
    const bodyA = JSON.parse(a.body);
    tokenA = bodyA.accessToken;
    orgA = bodyA.defaultContext.organizationId;
    companyA = bodyA.defaultContext.companyId;

    const b = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Invoice Settings Admin B",
        phone: phones[1],
        email: "invsettingsB@test.local",
        password: "PasswordInvoice123#",
        organizationName: "Invoice Settings Org B",
        tradeName: "Settings B Traders",
        stateCode: "27",
      },
    });
    expect(b.statusCode).toBe(201);
    const bodyB = JSON.parse(b.body);
    tokenB = bodyB.accessToken;
    orgB = bodyB.defaultContext.organizationId;
    companyB = bodyB.defaultContext.companyId;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("rejects unauthenticated settings access", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/invoice-settings" });
    expect([401, 403]).toContain(res.statusCode);
  });

  it("creates defaults, saves company settings, and reloads them", async () => {
    const initial = await app.inject({
      method: "GET",
      url: "/api/v1/invoice-settings",
      headers: headers(tokenA, orgA, companyA),
    });
    expect(initial.statusCode).toBe(200);
    const initialBody = JSON.parse(initial.body);
    expect(initialBody.settings.companyId).toBe(companyA);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/v1/invoice-settings",
      headers: headers(tokenA, orgA, companyA),
      payload: {
        themeId: "luxury",
        accentColor: "#DC2626",
        showPoNumber: true,
        showBatch: true,
        showTimeOnInvoice: true,
        showMfgDate: true,
        termsAndConditions: { sales: "Pay within 7 days." },
        invoiceCustomFields: [{ label: "Job No", value: "J-9", enabled: true }],
      },
    });
    expect(saved.statusCode).toBe(200);
    const savedBody = JSON.parse(saved.body);
    expect(savedBody.settings.themeId).toBe("luxury");
    expect(savedBody.settings.accentColor).toBe("#DC2626");
    expect(savedBody.settings.showPoNumber).toBe(true);
    expect(savedBody.settings.showBatch).toBe(true);
    expect(savedBody.settings.showTimeOnInvoice).toBe(true);
    expect(savedBody.settings.termsAndConditions.sales).toBe("Pay within 7 days.");

    const reloaded = await app.inject({
      method: "GET",
      url: "/api/v1/invoice-settings",
      headers: headers(tokenA, orgA, companyA),
    });
    const reloadedBody = JSON.parse(reloaded.body);
    expect(reloadedBody.settings.accentColor).toBe("#DC2626");
    expect(reloadedBody.settings.showPoNumber).toBe(true);
  });

  it("does not leak company A settings to company B", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/invoice-settings",
      headers: headers(tokenB, orgB, companyB),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.settings.companyId).toBe(companyB);
    expect(body.settings.accentColor).not.toBe("#DC2626");
  });

  it("rejects unknown theme ids", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/invoice-settings",
      headers: headers(tokenA, orgA, companyA),
      payload: { themeId: "not-a-real-theme" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("renders a tenant preview that includes saved accent and PO field", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/invoice-settings/preview",
      headers: headers(tokenA, orgA, companyA),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("#DC2626");
    expect(res.body).toContain("PO");
  });
});
