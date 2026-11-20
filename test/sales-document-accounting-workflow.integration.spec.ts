import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import {
  InvoiceCategory,
  InvoiceStatus,
  PaymentMode,
  StockTransactionType,
} from "@billing/shared-types";

describe("Complete Sales & Document Accounting Workflow (End-to-End Integration)", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tenantOrgId: string;
  let tenantCompanyId: string;
  let tenantBranchId: string;
  let tenantToken: string;
  let tenantFinancialYearId: string;

  let customerId: string;
  let itemId: string;
  let warehouseId: string;

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

    // Clean up test phone
    await prisma.executeBypassRls(async (tx) => {
      const testPhones = ["9898000088"];
      const users = await tx.user.findMany({
        where: { phone: { in: testPhones } },
        select: { organizationId: true },
      });
      const orgIds = users.map((u) => u.organizationId);
      if (orgIds.length > 0) {
        await tx.auditLog.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.stockTransaction.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.paymentAllocation.deleteMany({
          where: { voucher: { organizationId: { in: orgIds } } },
        });
        await tx.journalEntry.deleteMany({
          where: { voucher: { organizationId: { in: orgIds } } },
        });
        await tx.voucher.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.salesInvoiceItem.deleteMany({
          where: { invoice: { organizationId: { in: orgIds } } },
        });
        await tx.deliveryChallanItem.deleteMany({
          where: { challan: { organizationId: { in: orgIds } } },
        });
        await tx.deliveryChallan.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.salesInvoice.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.item.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.warehouse.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.party.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.invoiceSequence.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
        });
        await tx.ledgerAccount.deleteMany({
          where: { organizationId: { in: orgIds } },
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
        await tx.user.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.organization.deleteMany({
          where: { id: { in: orgIds } },
        });
      }
      await tx.tenant.deleteMany({
        where: { primaryPhone: { in: testPhones } },
      });
    });

    // 1. Setup Tenant
    const regRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        fullName: "Workflow Admin",
        phone: "9898000088",
        email: "salesflow@myownbillbook.com",
        password: "PasswordBilling123#",
        organizationName: "Sales Workflow Corp",
        tradeName: "Sales Workflow Trade",
        stateCode: "24",
      },
    });

    expect(regRes.statusCode).toBe(201);
    const regData = JSON.parse(regRes.body || regRes.payload);
    tenantToken = regData.accessToken;
    tenantOrgId = regData.defaultContext.organizationId;
    tenantCompanyId = regData.defaultContext.companyId;

    const compInfo = await prisma.executeBypassRls(async (tx) => {
      const branch = await tx.branch.findFirst({
        where: { companyId: tenantCompanyId },
      });
      const fy = await tx.financialYear.findFirst({
        where: { companyId: tenantCompanyId },
      });
      return { branchId: branch!.id, fyId: fy!.id };
    });
    tenantBranchId = compInfo.branchId;
    tenantFinancialYearId = compInfo.fyId;

    // Update Company to Gujarat state
    await prisma.executeBypassRls(async (tx) => {
      await tx.company.update({
        where: { id: tenantCompanyId },
        data: {
          stateCode: "24",
          city: "Ahmedabad",
          pincode: "380001",
          allowNegativeStock: true,
        },
      });

      const fy = await tx.financialYear.findFirst({
        where: { companyId: tenantCompanyId },
      });
      tenantFinancialYearId = fy!.id;

      // Create warehouse
      const wh = await tx.warehouse.create({
        data: {
          organizationId: tenantOrgId,
          companyId: tenantCompanyId,
          branchId: tenantBranchId,
          name: "Main Warehouse",
          isDefault: true,
        },
      });
      warehouseId = wh.id;

      // Create Party (Customer)
      const party = await tx.party.create({
        data: {
          organizationId: tenantOrgId,
          companyId: tenantCompanyId,
          name: "Jaydeep Enterprise",
          phone: "9876543210",
          stateCode: "24",
          type: "CUSTOMER" as any,
          billingAddress: {
            city: "Ahmedabad",
            stateCode: "24",
            pincode: "380015",
          },
        },
      });
      customerId = party.id;

      // Seed UOM
      const uom = await tx.unitOfMeasure.create({
        data: {
          organizationId: tenantOrgId,
          companyId: tenantCompanyId,
          name: "Pieces",
          symbol: "PCS",
          uqcCode: "PCS",
        },
      });

      // Create Item
      const itm = await tx.item.create({
        data: {
          organizationId: tenantOrgId,
          companyId: tenantCompanyId,
          name: "Industrial Motor 5HP",
          sku: "MTR-5HP",
          hsnCode: "8501",
          taxRate: 18,
          retailPrice: 10000,
          purchaseRate: 7000,
          type: "PRODUCT" as any,
          primaryUomId: uom.id,
        },
      });
      itemId = itm.id;

      // Seed Initial Stock: 50 units @ 7000 via StockTransaction
      await tx.stockTransaction.create({
        data: {
          organizationId: tenantOrgId,
          companyId: tenantCompanyId,
          warehouseId: wh.id,
          itemId: itm.id,
          transactionType: "OPENING" as any,
          transactionDate: new Date(),
          quantity: 50,
          valuationRate: 7000,
          totalValuation: 350000,
          referenceDocType: "OPENING",
          referenceDocId: "00000000-0000-0000-0000-000000000001",
        },
      });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("Step 1: Create Quotation / Estimate with strictly zero accounting, zero stock, zero receivable impact", async () => {
    const qtnPayload = {
      category: InvoiceCategory.QUOTATION,
      partyId: customerId,
      warehouseId,
      notes: "Commercial Quotation for 5HP Motor",
      items: [
        {
          itemId,
          quantity: 5,
          unitPrice: 10000,
          taxRate: 18,
          discountPercent: 0,
        },
      ],
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: { authorization: `Bearer ${tenantToken}` },
      payload: qtnPayload,
    });

    expect(res.statusCode).toBe(201);
    const qtn = JSON.parse(res.payload);

    expect(qtn.id).toBeDefined();
    expect(qtn.category).toBe(InvoiceCategory.QUOTATION);
    expect(qtn.invoiceNumber).toMatch(/^QTN\//);
    expect(qtn.status).toBe(InvoiceStatus.DRAFT);
    expect(Number(qtn.grandTotal)).toBe(59000); // 50,000 + 18% GST (9,000)

    // Verify ZERO stock movements
    const stockMovements = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.findMany({
        where: { referenceDocId: qtn.id },
      }),
    );
    expect(stockMovements.length).toBe(0);

    // Verify ZERO financial vouchers
    const vouchers = await prisma.executeBypassRls((tx) =>
      tx.voucher.findMany({
        where: { sourceEntityId: qtn.id },
      }),
    );
    expect(vouchers.length).toBe(0);

    // Verify customer outstanding via party API is strictly 0
    const partyRes = await app.inject({
      method: "GET",
      url: `/api/v1/parties/${customerId}`,
      headers: { authorization: `Bearer ${tenantToken}` },
    });
    const partyData = JSON.parse(partyRes.payload);
    expect(Number(partyData.outstandingBalance || 0)).toBe(0);
  });

  it("Step 2: Convert Quotation -> Proforma Invoice (PI/ prefix, commercial non-accounting document)", async () => {
    // First get quotation
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/invoices/sales?category=QUOTATION",
      headers: { authorization: `Bearer ${tenantToken}` },
    });
    const listData = JSON.parse(listRes.payload);
    const qtnId = listData.data[0].id;

    // Convert to Proforma
    const convertRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${qtnId}/convert-to-proforma`,
      headers: { authorization: `Bearer ${tenantToken}` },
    });

    expect(convertRes.statusCode).toBe(200);
    const proforma = JSON.parse(convertRes.payload);

    expect(proforma.id).toBeDefined();
    expect(proforma.category).toBe(InvoiceCategory.PROFORMA_INVOICE);
    expect(proforma.invoiceNumber).toMatch(/^PI\//);
    expect(Number(proforma.grandTotal)).toBe(59000);

    // Verify original quotation marked CONVERTED
    const origQtn = await prisma.executeBypassRls((tx) =>
      tx.salesInvoice.findUnique({ where: { id: qtnId } }),
    );
    expect(origQtn!.status).toBe(InvoiceStatus.CONVERTED);
    expect(origQtn!.convertedInvoiceId).toBe(proforma.id);

    // Verify ZERO accounting vouchers for proforma
    const vouchers = await prisma.executeBypassRls((tx) =>
      tx.voucher.findMany({
        where: { sourceEntityId: proforma.id },
      }),
    );
    expect(vouchers.length).toBe(0);
  });

  it("Step 3 & 4: Convert Proforma -> Delivery Challan & Issue Challan (dispatches inventory exactly once)", async () => {
    // Get proforma
    const piRes = await app.inject({
      method: "GET",
      url: "/api/v1/invoices/sales?category=PROFORMA_INVOICE",
      headers: { authorization: `Bearer ${tenantToken}` },
    });
    const piData = JSON.parse(piRes.payload);
    const proformaId = piData.data[0].id;

    // Convert Proforma to Delivery Challan
    const challanRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${proformaId}/convert-to-challan`,
      headers: { authorization: `Bearer ${tenantToken}` },
      payload: { warehouseId },
    });

    expect(challanRes.statusCode).toBe(200);
    const challan = JSON.parse(challanRes.payload);

    expect(challan.id).toBeDefined();
    expect(challan.challanNumber).toMatch(/^DC\//);
    expect(challan.status).toBe("DRAFT");
    const totalQty = challan.items.reduce(
      (s: number, i: any) => s + Number(i.quantity),
      0,
    );
    expect(totalQty).toBe(5);

    // Issue Challan (Rule 55: Dispatches goods from warehouse)
    const issueRes = await app.inject({
      method: "POST",
      url: `/api/v1/distribution/challans/${challan.id}/issue`,
      headers: { authorization: `Bearer ${tenantToken}` },
      payload: { notes: "Dispatched via Transport Express" },
    });

    expect(issueRes.statusCode).toBe(200);
    const issuedChallan = JSON.parse(issueRes.payload);
    expect(issuedChallan.status).toBe("ISSUED");

    // Verify stock was dispatched by Delivery Challan
    const challanStock = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.findMany({
        where: {
          referenceDocType: "DELIVERY_CHALLAN",
          referenceDocId: challan.id,
        },
      }),
    );
    expect(challanStock.length).toBe(1);
    expect(Number(challanStock[0].quantity)).toBe(-5); // Outward dispatch

    // Verify warehouse net stock is now 50 - 5 = 45
    const netStockAgg = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { companyId: tenantCompanyId, itemId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(netStockAgg._sum.quantity)).toBe(45);
  });

  it("Step 5: Convert Delivery Challan -> Sales Invoice (Strict check: NO duplicate stock deduction, double-entry posted)", async () => {
    // Get issued challan
    const challanListRes = await app.inject({
      method: "GET",
      url: "/api/v1/distribution/challans",
      headers: { authorization: `Bearer ${tenantToken}` },
    });
    const challans = JSON.parse(challanListRes.payload);
    const challan = challans[0];

    // Convert Challan to Tax Invoice
    const convertToInvRes = await app.inject({
      method: "POST",
      url: `/api/v1/distribution/challans/${challan.id}/convert-to-invoice`,
      headers: { authorization: `Bearer ${tenantToken}` },
    });

    expect(convertToInvRes.statusCode).toBe(200);
    const invoice = JSON.parse(convertToInvRes.payload);

    expect(invoice.id).toBeDefined();
    expect(invoice.category).toBe(InvoiceCategory.TAX_INVOICE);
    expect(invoice.invoiceNumber).toMatch(/^INV\//);
    expect(invoice.deliveryChallanId).toBe(challan.id);
    expect(Number(invoice.grandTotal)).toBe(59000);

    // CRITICAL INVARIANT: Net stock MUST REMAIN 45!
    // Stock was ALREADY deducted at challan issuance; invoice must NOT deduct again!
    const netStockAggAfter = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.aggregate({
        where: { companyId: tenantCompanyId, itemId },
        _sum: { quantity: true },
      }),
    );
    expect(Number(netStockAggAfter._sum.quantity)).toBe(45);

    // Verify invoice has NO new sales dispatch stock transactions
    const invoiceStock = await prisma.executeBypassRls((tx) =>
      tx.stockTransaction.findMany({
        where: {
          referenceDocType: "SALES_INVOICE",
          referenceDocId: invoice.id,
        },
      }),
    );
    expect(invoiceStock.length).toBe(0);

    // Verify Double-Entry Accounting Voucher WAS created for the Tax Invoice!
    const invoiceVoucher = await prisma.executeBypassRls((tx) =>
      tx.voucher.findFirst({
        where: {
          sourceDocument: "SALES_INVOICE",
          sourceEntityId: invoice.id,
        },
        include: { journalEntries: { include: { account: true } } },
      }),
    );
    expect(invoiceVoucher).toBeDefined();

    const totalDebit = invoiceVoucher!.journalEntries.reduce(
      (s, e) => s + Number(e.debitAmount),
      0,
    );
    const totalCredit = invoiceVoucher!.journalEntries.reduce(
      (s, e) => s + Number(e.creditAmount),
      0,
    );

    expect(totalDebit).toBe(59000);
    expect(totalCredit).toBe(59000);

    // Verify Challan status is CONVERTED
    const updatedChallan = await prisma.executeBypassRls((tx) =>
      tx.deliveryChallan.findUnique({ where: { id: challan.id } }),
    );
    expect(updatedChallan!.status).toBe("CONVERTED");
  });

  it("Step 6: Record Payment In against converted invoice & verify customer ledger and reports", async () => {
    // Get tax invoices
    const invListRes = await app.inject({
      method: "GET",
      url: "/api/v1/invoices/sales?category=TAX_INVOICE",
      headers: { authorization: `Bearer ${tenantToken}` },
    });
    const invList = JSON.parse(invListRes.payload);
    const invoice = invList.data[0];

    // Record Payment In for 59,000
    const paymentRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${invoice.id}/payments`,
      headers: { authorization: `Bearer ${tenantToken}` },
      payload: {
        amount: 59000,
        paymentMode: PaymentMode.BANK_TRANSFER,
        paymentDate: new Date().toISOString(),
        referenceNumber: "NEFT-789012",
      },
    });

    expect(paymentRes.statusCode).toBe(200);
    const paymentData = JSON.parse(paymentRes.payload);
    expect(paymentData.invoice.status).toBe(InvoiceStatus.PAID);
    expect(Number(paymentData.invoice.balanceAmount)).toBe(0);

    // Verify Sales Register in Reports returns only TAX_INVOICE
    const salesReportRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/sales-register",
      headers: { authorization: `Bearer ${tenantToken}` },
    });
    expect(salesReportRes.statusCode).toBe(200);
    const salesReport = JSON.parse(salesReportRes.payload);
    const invoicesInReport = salesReport.invoices || salesReport.items || salesReport.data || [];
    
    // Ensure all documents in Sales Register are strictly tax invoices (no quotations or proformas)
    for (const doc of invoicesInReport) {
      expect(doc.category).not.toBe(InvoiceCategory.QUOTATION);
      expect(doc.category).not.toBe(InvoiceCategory.PROFORMA_INVOICE);
    }
  });
});
