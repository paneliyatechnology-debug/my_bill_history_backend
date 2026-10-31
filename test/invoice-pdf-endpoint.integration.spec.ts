import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";

describe("Generate Invoice PDF API (Authentication & Tenant Isolation)", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tokenA: string;
  let orgA: string;
  let companyA: string;
  let invoiceAId: string;

  let tokenB: string;
  let orgB: string;
  let companyB: string;

  const phones = ["9898000781", "9898000782"];

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

    // Clean previous test runs
    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: { in: phones } },
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
        await tx.companyInvoicePrintSettings.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.item.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.party.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.userBranchAssignment.deleteMany({
          where: { branch: { organizationId: { in: orgIds } } },
        });
        await tx.journalEntry.deleteMany({
          where: { voucher: { organizationId: { in: orgIds } } },
        });
        await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.ledgerGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.branch.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.company.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.user.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.organization.deleteMany({
          where: { id: { in: orgIds } },
        });
      }
      await tx.tenant.deleteMany({
        where: { primaryPhone: { in: phones } },
      });
    });

    // Register User A
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Test User A",
        phone: phones[0],
        email: "testpdfa@test.local",
        password: "PasswordInvoice123#",
        organizationName: "Enterprise A Org",
        tradeName: "Enterprise A Traders",
        stateCode: "24",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const regDataA = JSON.parse(regResA.payload);
    tokenA = regDataA.accessToken;
    orgA = regDataA.defaultContext.organizationId;
    companyA = regDataA.defaultContext.companyId;

    // Register User B
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Test User B",
        phone: phones[1],
        email: "testpdfb@test.local",
        password: "PasswordInvoice123#",
        organizationName: "Enterprise B Org",
        tradeName: "Enterprise B Traders",
        stateCode: "27",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const regDataB = JSON.parse(regResB.payload);
    tokenB = regDataB.accessToken;
    orgB = regDataB.defaultContext.organizationId;
    companyB = regDataB.defaultContext.companyId;

    // Create UOM and item directly using prisma
    const uom = await prisma.executeBypassRls(async (tx) => {
      return tx.unitOfMeasure.create({
        data: {
          organizationId: orgA,
          companyId: companyA,
          name: "Pieces",
          symbol: "PCS",
          uqcCode: "PCS",
        },
      });
    });

    const item = await prisma.executeBypassRls(async (tx) => {
      return tx.item.create({
        data: {
          organizationId: orgA,
          companyId: companyA,
          name: "Test Widget",
          sku: "TW-01",
          hsnCode: "8471",
          type: "SERVICE",
          primaryUomId: uom.id,
          retailPrice: 100,
          purchaseRate: 60,
          taxRate: 18,
          isActive: true,
        },
      });
    });

    // Create sales invoice for User A
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        customerName: "Acme Customer",
        customerPhone: "9876543210",
        items: [
          {
            itemId: item.id,
            quantity: 2,
            unitPrice: 100,
            taxRate: 18,
          },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const invData = JSON.parse(invRes.payload);
    invoiceAId = invData.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.executeBypassRls(async (tx) => {
        const users = await tx.user.findMany({
          where: { phone: { in: phones } },
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
          await tx.companyInvoicePrintSettings.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.item.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.unitOfMeasure.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.party.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.userBranchAssignment.deleteMany({
            where: { branch: { organizationId: { in: orgIds } } },
          });
          await tx.journalEntry.deleteMany({
            where: { voucher: { organizationId: { in: orgIds } } },
          });
          await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.ledgerGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
          await tx.branch.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.company.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.user.deleteMany({
            where: { organizationId: { in: orgIds } },
          });
          await tx.organization.deleteMany({
            where: { id: { in: orgIds } },
          });
        }
        await tx.tenant.deleteMany({
          where: { primaryPhone: { in: phones } },
        });
      });
    }
    await app.close();
  });

  it("should reject unauthenticated request without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/generate-pdf",
      payload: {
        invoiceId: invoiceAId,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("should generate PDF when invoiceId is passed in JSON body with user token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/generate-pdf",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        invoiceId: invoiceAId,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.invoiceId).toBe(invoiceAId);
    expect(body.pdfUrl).toBeDefined();
    expect(body.pdfUrl).toContain(`/api/v1/invoices/${invoiceAId}/pdf`);
    expect(body.previewUrl).toBeDefined();
    expect(body.previewUrl).toContain(`/api/v1/invoices/${invoiceAId}/print`);
  });

  it("should generate PDF when invoiceId is passed as URL param with user token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoiceAId}/generate-pdf`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.invoiceId).toBe(invoiceAId);
    expect(body.pdfUrl).toContain(`/api/v1/invoices/${invoiceAId}/pdf`);
    expect(body.previewUrl).toContain(`/api/v1/invoices/${invoiceAId}/print`);
  });

  it("should reject cross-tenant invoice access (User B cannot generate PDF for User A invoice)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/generate-pdf",
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        invoiceId: invoiceAId,
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("should validate that the generated public pdfUrl and previewUrl can be fetched", async () => {
    const previewRes = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${invoiceAId}/print`,
    });
    expect(previewRes.statusCode).toBe(200);
    expect(previewRes.headers["content-type"]).toContain("text/html");

    const pdfRes = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${invoiceAId}/pdf`,
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers["content-type"]).toBe("application/pdf");
  });
});
