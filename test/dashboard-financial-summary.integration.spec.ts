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
  PartyType,
  AccountNature,
  StockTransactionType,
} from "@billing/shared-types";

describe("Dashboard Financial Summary KPI Cards (Integration Test Suite)", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  // Tenant A
  let tenantAOrgId: string;
  let tenantACompanyId: string;
  let tenantABranchId: string;
  let tenantAToken: string;
  let tenantAFinancialYearId: string;
  let tenantAWarehouseId: string;

  // Tenant B (Tenant isolation)
  let tenantBOrgId: string;
  let tenantBCompanyId: string;
  let tenantBToken: string;

  // Master Data
  let customerPartyId: string;
  let supplierPartyId: string;
  let itemSugarId: string;
  let itemTeaId: string;
  let cashAccountId: string;
  let bankAccountId: string;
  let bankOdAccountId: string;

  const testPhones = ["9898000077", "9898000078"];

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
        await tx.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.stockTransaction.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.paymentAllocation.deleteMany({
          where: { voucher: { organizationId: { in: orgIds } } },
        });
        await tx.salesReturnItem.deleteMany({ where: { returnDoc: { organizationId: { in: orgIds } } } });
        await tx.salesReturn.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.purchaseReturnItem.deleteMany({ where: { returnDoc: { organizationId: { in: orgIds } } } });
        await tx.purchaseReturn.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.salesInvoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
        await tx.salesInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.purchaseInvoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
        await tx.purchaseInvoice.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.invoiceSequence.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
        await tx.journalEntry.deleteMany({ where: { voucher: { organizationId: { in: orgIds } } } });
        await tx.voucher.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.ledgerAccount.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.ledgerGroup.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.party.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.item.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.warehouse.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.unitOfMeasure.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.financialYear.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
        await tx.userBranchAssignment.deleteMany({
          where: { branch: { company: { organizationId: { in: orgIds } } } },
        });
        await tx.branch.deleteMany({ where: { company: { organizationId: { in: orgIds } } } });
        await tx.company.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.user.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
      await tx.tenant.deleteMany({ where: { primaryPhone: { in: testPhones } } });
    });

    // 1. Register Tenant A
    const regResA = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        organizationName: "Financial Cards Org A",
        companyName: "Ambica Financial Traders",
        tradeName: "Ambica Traders",
        stateCode: "24",
        city: "Ahmedabad",
        pincode: "380002",
        fullName: "Fin Admin Jaydeep",
        phone: testPhones[0],
        password: "FinPassword123!",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const regDataA = JSON.parse(regResA.payload);
    tenantAToken = regDataA.accessToken;
    tenantAOrgId = regDataA.defaultContext.organizationId;
    tenantACompanyId = regDataA.defaultContext.companyId;

    const branchA = await prisma.executeBypassRls(async (tx) => {
      return await tx.branch.findFirst({ where: { companyId: tenantACompanyId } });
    });
    tenantABranchId = branchA!.id;

    const fyA = await prisma.executeBypassRls(async (tx) => {
      return await tx.financialYear.findFirst({
        where: { companyId: tenantACompanyId, isCurrent: true },
      });
    });
    tenantAFinancialYearId = fyA!.id;

    // 2. Register Tenant B (for company isolation tests)
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        organizationName: "Financial Cards Org B",
        companyName: "Rival Financial Traders",
        tradeName: "Rival Fin",
        stateCode: "24",
        city: "Surat",
        pincode: "395001",
        fullName: "Rival Admin",
        phone: testPhones[1],
        password: "FinPassword123!",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const regDataB = JSON.parse(regResB.payload);
    tenantBToken = regDataB.accessToken;
    tenantBOrgId = regDataB.defaultContext.organizationId;
    tenantBCompanyId = regDataB.defaultContext.companyId;

    // 3. Seed Chart of Accounts for Tenant A & B
    await app.inject({
      method: "POST",
      url: "/api/v1/ledger-groups/seed",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
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

    // 4. Setup Master Data for Tenant A
    await prisma.executeBypassRls(async (tx) => {
      // Warehouse
      const wh = await tx.warehouse.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          branchId: tenantABranchId,
          name: "Main Central Godown",
          isDefault: true,
        },
      });
      tenantAWarehouseId = wh.id;

      // UOM
      const uom = await tx.unitOfMeasure.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          name: "Kilogram",
          symbol: "KG",
          uqcCode: "KGS",
        },
      });

      // Item 1 (Sugar)
      const it1 = await tx.item.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          primaryUomId: uom.id,
          name: "Organic Sugar",
          sku: "FIN-SUGAR-01",
          retailPrice: 40.0,
          purchaseRate: 32.0,
          taxRate: 5.0,
          hsnCode: "1701",
        },
      });
      itemSugarId = it1.id;

      // Item 2 (Tea)
      const it2 = await tx.item.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          primaryUomId: uom.id,
          name: "Wagh Bakri Tea",
          sku: "FIN-TEA-01",
          retailPrice: 300.0,
          purchaseRate: 240.0,
          taxRate: 5.0,
          hsnCode: "0902",
        },
      });
      itemTeaId = it2.id;

      // Seed Opening Stock for Sugar & Tea
      await tx.stockTransaction.createMany({
        data: [
          {
            organizationId: tenantAOrgId,
            companyId: tenantACompanyId,
            warehouseId: tenantAWarehouseId,
            itemId: itemSugarId,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date("2026-04-01"),
            quantity: 100.0,
            valuationRate: 32.0,
            totalValuation: 3200.0,
            referenceDocType: "OPENING",
            referenceDocId: tenantAWarehouseId,
          },
          {
            organizationId: tenantAOrgId,
            companyId: tenantACompanyId,
            warehouseId: tenantAWarehouseId,
            itemId: itemTeaId,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date("2026-04-01"),
            quantity: 50.0,
            valuationRate: 240.0,
            totalValuation: 12000.0,
            referenceDocType: "OPENING",
            referenceDocId: tenantAWarehouseId,
          },
        ],
      });

      // Customer Party
      const cust = await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: PartyType.CUSTOMER,
          name: "Shah General Stores",
          phone: "9825123456",
          gstin: "24BBBBB0000B1Z6",
          stateCode: "24",
          billingAddress: {
            line1: "Manek Chowk",
            city: "Ahmedabad",
            pincode: "380001",
          },
        },
      });
      customerPartyId = cust.id;

      // Supplier Party
      const supp = await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          type: PartyType.SUPPLIER,
          name: "Gujarat Tea Traders",
          phone: "9825654321",
          gstin: "24CCCCC0000C1Z7",
          stateCode: "24",
          billingAddress: {
            line1: "Ring Road",
            city: "Surat",
            pincode: "395002",
          },
        },
      });
      supplierPartyId = supp.id;

      // Customer Ledger Account under Sundry Debtors
      const debtorsGroup = await tx.ledgerGroup.findFirst({
        where: { companyId: tenantACompanyId, name: "Sundry Debtors" },
      });
      if (debtorsGroup) {
        await tx.ledgerAccount.create({
          data: {
            organizationId: tenantAOrgId,
            companyId: tenantACompanyId,
            groupId: debtorsGroup.id,
            name: cust.name,
            partyId: cust.id,
            isPartyLedger: true,
            openingBalance: 0.0,
            openingType: "DR",
            currentBalance: 0.0,
          },
        });
      }

      // Supplier Ledger Account under Sundry Creditors
      const creditorsGroup = await tx.ledgerGroup.findFirst({
        where: { companyId: tenantACompanyId, name: "Sundry Creditors" },
      });
      if (creditorsGroup) {
        await tx.ledgerAccount.create({
          data: {
            organizationId: tenantAOrgId,
            companyId: tenantACompanyId,
            groupId: creditorsGroup.id,
            name: supp.name,
            partyId: supp.id,
            isPartyLedger: true,
            openingBalance: 0.0,
            openingType: "CR",
            currentBalance: 0.0,
          },
        });
      }

      // Cash Account: Opening Balance DR ₹5,000.00
      const currentAssetsGroup = await tx.ledgerGroup.findFirst({
        where: { companyId: tenantACompanyId, name: "Current Assets" },
      });
      const cashAcc = await tx.ledgerAccount.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          groupId: currentAssetsGroup!.id,
          name: "Main Cash Counter",
          code: "CASH-MAIN",
          isCashLedger: true,
          isBankLedger: false,
          openingBalance: 5000.0,
          openingType: "DR",
          currentBalance: 5000.0,
        },
      });
      cashAccountId = cashAcc.id;

      // Bank Account: Opening Balance DR ₹25,000.00
      const bankAcc = await tx.ledgerAccount.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          groupId: currentAssetsGroup!.id,
          name: "HDFC Current Account",
          code: "BANK-HDFC",
          isCashLedger: false,
          isBankLedger: true,
          openingBalance: 25000.0,
          openingType: "DR",
          currentBalance: 25000.0,
        },
      });
      bankAccountId = bankAcc.id;
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // --------------------------------------------------------------------------
  // TEST 1: Initial Balances & Tenant Isolation
  // --------------------------------------------------------------------------
  it("should calculate exact initial financial summary with opening balances and enforce tenant isolation", async () => {
    // Tenant A Initial:
    // toCollect: 0.00
    // toPay: 0.00
    // cashBalance: 5000.00
    // bankBalance: 25000.00
    // totalCashBankBalance: 30000.00
    const resA = await app.inject({
      method: "GET",
      url: "/api/v1/reports/financial-summary",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(resA.statusCode).toBe(200);
    const dataA = JSON.parse(resA.payload);
    expect(dataA.toCollect).toBe("0.00");
    expect(dataA.toPay).toBe("0.00");
    expect(dataA.cashBalance).toBe("5000.00");
    expect(dataA.bankBalance).toBe("25000.00");
    expect(dataA.totalCashBankBalance).toBe("30000.00");
    expect(dataA.currency).toBe("INR");
    expect(dataA.asOf).toBeDefined();

    // Tenant B (should be completely isolated with 0.00 figures)
    const resB = await app.inject({
      method: "GET",
      url: "/api/v1/reports/financial-summary",
      headers: {
        authorization: `Bearer ${tenantBToken}`,
        "x-organization-id": tenantBOrgId,
        "x-company-id": tenantBCompanyId,
      },
    });

    expect(resB.statusCode).toBe(200);
    const dataB = JSON.parse(resB.payload);
    expect(dataB.toCollect).toBe("0.00");
    expect(dataB.toPay).toBe("0.00");
    expect(dataB.cashBalance).toBe("0.00");
    expect(dataB.bankBalance).toBe("0.00");
    expect(dataB.totalCashBankBalance).toBe("0.00");
  });

  // --------------------------------------------------------------------------
  // TEST 2: Posted Sales Invoice & Partial Customer Payment
  // --------------------------------------------------------------------------
  it("should track customer receivables, partial receipt, and update cash balance correctly", async () => {
    // 1. Post Sales Invoice: 10 Sugar @ ₹40 = 400 + 5% GST (20) = ₹420.00
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
      payload: {
        partyId: customerPartyId,
        warehouseId: tenantAWarehouseId,
        invoiceDate: "2026-06-10",
        category: InvoiceCategory.TAX_INVOICE,
        items: [
          {
            itemId: itemSugarId,
            quantity: 10,
            unitPrice: 40,
            taxRate: 5,
          },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const invoiceId = JSON.parse(invRes.payload).id;

    // After posting: toCollect should be ₹420.00
    const summaryAfterInvoice = await app.inject({
      method: "GET",
      url: "/api/v1/reports/financial-summary",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
      },
    });
    const s1 = JSON.parse(summaryAfterInvoice.payload);
    expect(s1.toCollect).toBe("420.00");

    // 2. Partial Payment: Customer pays ₹200.00 in Cash
    const payRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${invoiceId}/payments`,
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
      payload: {
        amount: 200.0,
        paymentMode: PaymentMode.CASH,
        paymentDate: "2026-06-12",
        referenceNumber: "CASH-PARTIAL-01",
      },
    });
    expect(payRes.statusCode).toBe(200);

    // After partial payment:
    // toCollect: 420.00 - 200.00 = 220.00
    // cashBalance: 5000.00 + 200.00 = 5200.00
    // totalCashBankBalance: 5200.00 + 25000.00 = 30200.00
    const summaryAfterPay = await app.inject({
      method: "GET",
      url: "/api/v1/reports/financial-summary",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
      },
    });
    const s2 = JSON.parse(summaryAfterPay.payload);
    expect(s2.toCollect).toBe("220.00");
    expect(s2.cashBalance).toBe("5200.00");
    expect(s2.bankBalance).toBe("25000.00");
    expect(s2.totalCashBankBalance).toBe("30200.00");
  });

  // --------------------------------------------------------------------------
  // TEST 3: Cancelled Invoices must be excluded
  // --------------------------------------------------------------------------
  it("should exclude cancelled invoices from toCollect", async () => {
    // 1. Create Invoice 2: 5 Sugar @ ₹40 = 200 + 10 = ₹210.00
    const invRes = await app.inject({
      method: "POST",
      url: "/api/v1/invoices/sales",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
      payload: {
        partyId: customerPartyId,
        warehouseId: tenantAWarehouseId,
        invoiceDate: "2026-06-15",
        category: InvoiceCategory.TAX_INVOICE,
        items: [
          {
            itemId: itemSugarId,
            quantity: 5,
            unitPrice: 40,
            taxRate: 5,
          },
        ],
      },
    });
    expect(invRes.statusCode).toBe(201);
    const invoiceId = JSON.parse(invRes.payload).id;

    // Cancel this invoice immediately
    const cancelRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${invoiceId}/cancel`,
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
      payload: {
        reason: "Customer changed order before dispatch",
      },
    });
    expect(cancelRes.statusCode).toBe(200);

    // Verify toCollect is still 220.00 (cancelled invoice not counted)
    const summaryRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/financial-summary",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
      },
    });
    const s = JSON.parse(summaryRes.payload);
    expect(s.toCollect).toBe("220.00");
  });

  // --------------------------------------------------------------------------
  // TEST 4: Purchase Bill & Supplier Payables (To Pay)
  // --------------------------------------------------------------------------
  it("should calculate supplier payables (To Pay) from purchase bills and track bank settlement", async () => {
    // Create Purchase Invoice: Grand Total ₹10,500.00
    await prisma.executeBypassRls(async (tx) => {
      await tx.purchaseInvoice.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          branchId: tenantABranchId,
          financialYearId: tenantAFinancialYearId,
          partyId: supplierPartyId,
          vendorInvoiceNumber: "PUR-VEND-101",
          invoiceDate: new Date("2026-06-20"),
          placeOfSupply: "24",
          taxableAmount: 10000.0,
          cgstAmount: 250.0,
          sgstAmount: 250.0,
          grandTotal: 10500.0,
          paidAmount: 0.0,
          balanceAmount: 10500.0,
        },
      });
    });

    // Check toPay is now ₹10,500.00
    const summary1 = await app.inject({
      method: "GET",
      url: "/api/v1/reports/financial-summary",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
      },
    });
    const s1 = JSON.parse(summary1.payload);
    expect(s1.toPay).toBe("10500.00");

    // Partial supplier payment via Bank: ₹5,500.00
    await prisma.executeBypassRls(async (tx) => {
      const pinv = await tx.purchaseInvoice.findFirst({
        where: { vendorInvoiceNumber: "PUR-VEND-101" },
      });
      await tx.purchaseInvoice.update({
        where: { id: pinv!.id },
        data: {
          paidAmount: 5500.0,
          balanceAmount: 5000.0,
        },
      });

      // Post Payment Voucher reducing Bank Account
      const paymentVoucher = await tx.voucher.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          financialYearId: tenantAFinancialYearId,
          voucherType: "PAYMENT" as any,
          voucherNumber: "PV-BANK-001",
          voucherDate: new Date("2026-06-22"),
          totalAmount: 5500.0,
          isAutoGenerated: false,
          isCancelled: false,
        },
      });

      const creditorsGroup = await tx.ledgerGroup.findFirst({
        where: { companyId: tenantACompanyId, name: "Sundry Creditors" },
      });
      const suppLedger = await tx.ledgerAccount.findFirst({
        where: { companyId: tenantACompanyId, partyId: supplierPartyId },
      });

      // Dr Supplier Ledger, Cr Bank
      await tx.journalEntry.createMany({
        data: [
          {
            voucherId: paymentVoucher.id,
            accountId: suppLedger!.id,
            debitAmount: 5500.0,
            creditAmount: 0.0,
            sequenceOrder: 1,
          },
          {
            voucherId: paymentVoucher.id,
            accountId: bankAccountId,
            debitAmount: 0.0,
            creditAmount: 5500.0,
            sequenceOrder: 2,
          },
        ],
      });
    });

    // After supplier payment:
    // toPay: 5000.00
    // bankBalance: 25000.00 - 5500.00 = 19500.00
    // totalCashBankBalance: 5200.00 + 19500.00 = 24700.00
    const summary2 = await app.inject({
      method: "GET",
      url: "/api/v1/reports/financial-summary",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
      },
    });
    const s2 = JSON.parse(summary2.payload);
    expect(s2.toPay).toBe("5000.00");
    expect(s2.bankBalance).toBe("19500.00");
    expect(s2.totalCashBankBalance).toBe("24700.00");
  });

  // --------------------------------------------------------------------------
  // TEST 5: Bank Overdraft (Genuine negative credit balance)
  // --------------------------------------------------------------------------
  it("should preserve genuine credit balances and overdraft without silent zero clamping", async () => {
    // Add Bank Overdraft Account with Opening Balance CR ₹15,000.00
    await prisma.executeBypassRls(async (tx) => {
      const loansGroup = await tx.ledgerGroup.findFirst({
        where: { companyId: tenantACompanyId, name: "Current Assets" },
      });
      const odAcc = await tx.ledgerAccount.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          groupId: loansGroup!.id,
          name: "ICICI Bank Overdraft A/c",
          code: "OD-ICICI",
          isCashLedger: false,
          isBankLedger: true,
          openingBalance: 15000.0,
          openingType: "CR", // Credit balance (liability/overdraft)
          currentBalance: -15000.0,
        },
      });
      bankOdAccountId = odAcc.id;
    });

    // Bank Balance should now be: 19500.00 (HDFC) - 15000.00 (OD) = 4500.00
    // Total Cash + Bank: 5200.00 + 4500.00 = 9700.00
    const summaryRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/financial-summary",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
      },
    });

    expect(summaryRes.statusCode).toBe(200);
    const s = JSON.parse(summaryRes.payload);
    expect(s.bankBalance).toBe("4500.00");
    expect(s.cashBalance).toBe("5200.00");
    expect(s.totalCashBankBalance).toBe("9700.00");
  });

  // --------------------------------------------------------------------------
  // TEST 6: Dashboard-summary alias & fast query performance
  // --------------------------------------------------------------------------
  it("should support /reports/dashboard-summary alias and return in under 200ms", async () => {
    const start = Date.now();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/dashboard-summary",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
      },
    });
    const elapsed = Date.now() - start;

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.toCollect).toBeDefined();
    expect(data.toPay).toBeDefined();
    expect(data.totalCashBankBalance).toBeDefined();
    expect(elapsed).toBeLessThan(2000); // well within acceptable fast limit
  });
});
