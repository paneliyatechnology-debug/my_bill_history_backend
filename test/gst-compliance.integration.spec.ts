import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { calculateGstinChecksum } from "../src/common/validators/gstin.validator";

describe("GST compliance phase", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;
  let tokenA = "";
  let tokenB = "";
  let orgA = "";
  let companyA = "";
  let companyB = "";
  let orgB = "";
  const headersA = () => ({
    authorization: `Bearer ${tokenA}`,
    "x-organization-id": orgA,
    "x-company-id": companyA,
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(DatabaseService);

    await prisma.executeBypassRls(async (tx) => {
      const users = await tx.user.findMany({
        where: { phone: { in: ["9898002211", "9898002212"] } },
        select: { organizationId: true },
      });
      const orgIds = users.map((user) => user.organizationId);
      if (orgIds.length > 0) {
        await tx.advanceAdjustment.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.advanceReceipt.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.outwardDebitNoteItem.deleteMany({ where: { note: { organizationId: { in: orgIds } } } });
        await tx.outwardDebitNote.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.gstr2bAdjustment.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.gstr2bReconciliation.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.gstr2bLine.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.gstr2bImport.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.gstApiAuditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.gstIntegrationConfig.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.journalEntry.deleteMany({ where: { voucher: { organizationId: { in: orgIds } } } });
        await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.purchaseInvoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
        await tx.purchaseInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.stockTransaction.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.item.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.party.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.ledgerGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.warehouse.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.unitOfMeasure.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
      await tx.tenant.deleteMany({ where: { primaryPhone: { in: ["9898002211", "9898002212"] } } });
    });

    const register = async (phone: string, name: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: {
          fullName: name,
          phone,
          password: "Password@123",
          organizationName: `${name} Org`,
          tradeName: name,
          stateCode: "24",
          city: "Ahmedabad",
          pincode: "380002",
        },
      });
      expect(response.statusCode).toBe(201);
      return JSON.parse(response.body);
    };

    const tenantA = await register("9898002211", "GST Compliance A");
    const tenantB = await register("9898002212", "GST Compliance B");
    tokenA = tenantA.accessToken;
    tokenB = tenantB.accessToken;
    orgA = tenantA.defaultContext.organizationId;
    companyA = tenantA.defaultContext.companyId;
    orgB = tenantB.defaultContext.organizationId;
    companyB = tenantB.defaultContext.companyId;

    await prisma.executeBypassRls(async (tx) => {
      await tx.company.update({
        where: { id: companyA },
        data: { gstin: "24AAAAA0000A1Z5" },
      });
    });

    expect((await app.inject({ method: "POST", url: "/api/v1/ledger-groups/seed", headers: headersA() })).statusCode).toBe(201);
    const warehouse = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/warehouses",
      headers: headersA(),
      payload: { name: "GST Godown", isDefault: true },
    });
    const unit = await app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers: headersA(),
      payload: { name: "Kilogram", code: "KGS", isDecimalAllowed: true },
    });
    const party = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: headersA(),
      payload: {
        type: "SUPPLIER",
        name: "Apex Steel Suppliers LLP",
        phone: "9825999221",
        gstin: "24ABCDE1234F1Z6",
        stateCode: "24",
        billingAddress: { line1: "GIDC", city: "Ahmedabad", pincode: "382445" },
      },
    });
    const item = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: headersA(),
      payload: {
        type: "PRODUCT",
        name: "GST Test Rod",
        sku: "GST-ROD",
        hsnCode: "7214",
        primaryUomId: JSON.parse(unit.body).id,
        purchaseRate: 1000,
        retailPrice: 1200,
        taxRate: 18,
      },
    });
    const purchase = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: headersA(),
      payload: {
        partyId: JSON.parse(party.body).id,
        vendorInvoiceNumber: "INV/001",
        invoiceDate: "2026-04-02",
        warehouseId: JSON.parse(warehouse.body).id,
        items: [{ itemId: JSON.parse(item.body).id, quantity: 1, unitPrice: 1000, taxRate: 18 }],
      },
    });
    expect(purchase.statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("matches a GSTR-2B file, keeps ITC unreviewed, and isolates tenants", async () => {
    const before = await prisma.executeBypassRls((tx) =>
      tx.voucher.count({ where: { companyId: companyA } }),
    );
    const portalFile = {
      fileName: "gstr2b.json",
      returnPeriod: "042026",
      content: JSON.stringify({
          data: {
            gstin: "24AAAAA0000A1Z5",
            rtnprd: "042026",
            docdata: {
              b2b: [
                {
                  ctin: "24ABCDE1234F1Z6",
                  trdnm: "Apex",
                  inv: [
                    {
                      inum: "inv-001",
                      dt: "02-04-2026",
                      val: 1180,
                      itcavl: "Y",
                      itms: [{ txval: 1000, cgst: 90, sgst: 90, igst: 0, cess: 0 }],
                    },
                    {
                      inum: "PORTAL-ONLY",
                      dt: "03-04-2026",
                      val: 590,
                      itms: [{ txval: 500, cgst: 45, sgst: 45, igst: 0, cess: 0 }],
                    },
                  ],
                },
              ],
            },
          },
        }),
    };
    const imported = await app.inject({
      method: "POST",
      url: "/api/v1/gst/gstr-2b/imports",
      headers: headersA(),
      payload: portalFile,
    });
    expect(imported.statusCode).toBe(201);
    const importBody = JSON.parse(imported.body);
    expect(importBody.summary.counts.MATCHED).toBe(1);
    expect(importBody.summary.counts.MISSING_IN_BOOKS).toBe(1);
    expect(importBody.summary.matchedDoesNotClaimItc).toBe(true);

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/gst/gstr-2b/reconciliations?returnPeriod=042026&status=MATCHED",
      headers: headersA(),
    });
    const rows = JSON.parse(listed.body).rows;
    expect(rows[0].itcDecision).toBe("UNREVIEWED");
    const review = await app.inject({
      method: "POST",
      url: `/api/v1/gst/gstr-2b/reconciliations/${rows[0].id}/review`,
      headers: headersA(),
      payload: { itcDecision: "ACCEPTED", reason: "Supplier invoice checked against the physical bill." },
    });
    expect(review.statusCode).toBe(201);
    expect(JSON.parse(review.body).accountingPosting).toBe("NONE");
    const after = await prisma.executeBypassRls((tx) =>
      tx.voucher.count({ where: { companyId: companyA } }),
    );
    expect(after).toBe(before);

    const foreign = await app.inject({
      method: "GET",
      url: "/api/v1/gst/gstr-2b/summary?returnPeriod=042026",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "x-organization-id": orgB,
        "x-company-id": companyB,
      },
    });
    expect(foreign.statusCode).toBe(200);
    expect(JSON.parse(foreign.body).counts.MATCHED ?? 0).toBe(0);

    const again = await app.inject({
      method: "POST",
      url: "/api/v1/gst/gstr-2b/imports",
      headers: headersA(),
      payload: portalFile,
    });
    expect(again.statusCode).toBe(201);
    expect(JSON.parse(again.body).duplicateFile).toBe(true);
    const importCount = await prisma.executeBypassRls((tx) =>
      tx.gstr2bImport.count({ where: { companyId: companyA, sourceSha256: { not: "" } } }),
    );
    expect(importCount).toBe(1);

    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/gst/gstr-2b/reconciliations?returnPeriod=042026&status=MISSING_IN_BOOKS",
      headers: headersA(),
    });
    const missingRow = JSON.parse(missing.body).rows[0];
    const blocked = await app.inject({
      method: "POST",
      url: `/api/v1/gst/gstr-2b/reconciliations/${missingRow.id}/review`,
      headers: headersA(),
      payload: {
        itcDecision: "ACCEPTED",
        reason: "This portal-only row must stay unaccepted until it exists in the books.",
      },
    });
    expect(blocked.statusCode).toBe(400);
  });

  it("posts intra-UT purchase tax to Input UTGST and keeps the other tenant out", async () => {
    const ladakhGstin = `38AAAAA0000A1Z${calculateGstinChecksum("38AAAAA0000A1Z")}`;
    const supplier = await app.inject({
      method: "POST",
      url: "/api/v1/parties",
      headers: headersA(),
      payload: {
        type: "SUPPLIER",
        name: "Ladakh Supply Co",
        phone: "9825999331",
        gstin: ladakhGstin,
        stateCode: "38",
        billingAddress: { line1: "Main Bazaar", city: "Leh", pincode: "194101" },
      },
    });
    expect(supplier.statusCode).toBe(201);
    const item = await prisma.executeBypassRls((tx) =>
      tx.item.findFirst({ where: { companyId: companyA, sku: "GST-ROD" } }),
    );
    const warehouse = await prisma.executeBypassRls((tx) =>
      tx.warehouse.findFirst({ where: { companyId: companyA } }),
    );
    const purchase = await app.inject({
      method: "POST",
      url: "/api/v1/purchases",
      headers: headersA(),
      payload: {
        partyId: JSON.parse(supplier.body).id,
        vendorInvoiceNumber: "LEH-UT-1",
        invoiceDate: "2026-04-08",
        placeOfSupply: "38",
        warehouseId: warehouse!.id,
        items: [{ itemId: item!.id, quantity: 1, unitPrice: 1000, taxRate: 18 }],
      },
    });
    expect(purchase.statusCode).toBe(201);
    const bill = JSON.parse(purchase.body);
    expect(Number(bill.utgstAmount)).toBe(90);
    expect(Number(bill.sgstAmount)).toBe(0);
    expect(Number(bill.cgstAmount)).toBe(90);
    expect(Number(bill.igstAmount)).toBe(0);
    const lines = await prisma.executeBypassRls((tx) =>
      tx.journalEntry.findMany({
        where: { voucher: { companyId: companyA, referenceNo: "LEH-UT-1" } },
        include: { account: true },
      }),
    );
    const debit = lines.reduce((sum, line) => sum + Number(line.debitAmount), 0);
    const credit = lines.reduce((sum, line) => sum + Number(line.creditAmount), 0);
    expect(debit).toBeCloseTo(credit, 2);
    expect(lines.some((line) => line.account.name.includes("Input UTGST") && Number(line.debitAmount) === 90)).toBe(true);
    expect(lines.some((line) => line.account.name.includes("Input SGST") && Number(line.debitAmount) > 0)).toBe(false);
    const foreign = await app.inject({
      method: "GET",
      url: "/api/v1/purchases",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "x-organization-id": orgB,
        "x-company-id": companyB,
      },
    });
    expect(foreign.statusCode).toBe(200);
    expect(JSON.stringify(JSON.parse(foreign.body))).not.toContain("LEH-UT-1");
  });

  it("refuses production enablement and does not fabricate an IRN without credentials", async () => {
    const config = await app.inject({
      method: "PUT",
      url: "/api/v1/gst/integration",
      headers: headersA(),
      payload: { environment: "PRODUCTION", productionEnabled: true, clientSecret: "nope" },
    });
    expect(config.statusCode).toBe(400);

    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/gst/einvoice/00000000-0000-0000-0000-000000000000/generate",
      headers: headersA(),
    });
    expect(missing.statusCode).toBe(404);

    const gstr1 = await app.inject({
      method: "GET",
      url: "/api/v1/reports/gstr-1?month=4&year=2026",
      headers: headersA(),
    });
    expect(gstr1.statusCode).toBe(200);
    expect(JSON.parse(gstr1.body).filingStatus).toBe("NOT_FILED");
  });

  it("lists GST documents and audit for the selected company and does not ping the network", async () => {
    const before = await prisma.executeBypassRls((tx) =>
      tx.voucher.count({ where: { companyId: companyA } }),
    );
    const documents = await app.inject({
      method: "GET",
      url: "/api/v1/gst/documents?fromDate=2026-04-01&toDate=2026-04-30",
      headers: headersA(),
    });
    expect(documents.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(documents.body))).toBe(true);

    const foreign = await app.inject({
      method: "GET",
      url: "/api/v1/gst/documents?fromDate=2026-04-01&toDate=2026-04-30",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "x-organization-id": orgB,
        "x-company-id": companyB,
      },
    });
    expect(foreign.statusCode).toBe(200);
    expect(JSON.parse(foreign.body)).toEqual([]);

    const audit = await app.inject({
      method: "GET",
      url: "/api/v1/gst/audit",
      headers: headersA(),
    });
    expect(audit.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(audit.body).rows)).toBe(true);

    delete process.env.GST_SANDBOX_LIVE;
    const ping = await app.inject({
      method: "POST",
      url: "/api/v1/gst/integration/sandbox-ping",
      headers: headersA(),
    });
    expect(ping.statusCode).toBe(201);
    const pingBody = JSON.parse(ping.body);
    expect(pingBody.attempted).toBe(false);
    expect(pingBody.outcome).not.toBe("REACHABLE");

    const register = await app.inject({
      method: "GET",
      url: "/api/v1/reports/purchase-register?fromDate=2026-04-01&toDate=2026-04-30",
      headers: headersA(),
    });
    expect(register.statusCode).toBe(200);
    const registerBody = JSON.parse(register.body);
    expect(registerBody.totals.totalUtgst).toBeDefined();
    expect(registerBody.items.some((row: { vendorInvoiceNumber: string }) => row.vendorInvoiceNumber === "LEH-UT-1")).toBe(true);

    const gstr3b = await app.inject({
      method: "GET",
      url: "/api/v1/reports/gstr-3b?fromDate=2026-04-01&toDate=2026-04-30",
      headers: headersA(),
    });
    expect(gstr3b.statusCode).toBe(200);
    expect(JSON.parse(gstr3b.body).filingStatus).toBe("NOT_FILED");
    const after = await prisma.executeBypassRls((tx) =>
      tx.voucher.count({ where: { companyId: companyA } }),
    );
    expect(after).toBe(before);
  });
});
