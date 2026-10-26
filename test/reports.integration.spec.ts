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

describe("Phase 6: Reports & GST Implementation (Integration)", () => {
  let app: NestFastifyApplication;
  let prisma: DatabaseService;

  let tenantAOrgId: string;
  let tenantACompanyId: string;
  let tenantABranchId: string;
  let tenantAToken: string;
  let tenantAFinancialYearId: string;
  let tenantAWarehouseId: string;

  let tenantBOrgId: string;
  let tenantBCompanyId: string;
  let tenantBToken: string;

  let customerPartyId: string;
  let itemSugarId: string;
  let itemTeaId: string;
  let invoice1Id: string;
  let invoice2Id: string;
  let cancelledInvoiceId: string;

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

    // Clean up test data for phones used in this suite
    await prisma.executeBypassRls(async (tx) => {
      const testPhones = ["9898000009", "9898000010"];
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
          where: { salesInvoice: { organizationId: { in: orgIds } } },
        });
        await tx.salesInvoiceItem.deleteMany({
          where: { invoice: { organizationId: { in: orgIds } } },
        });
        await tx.salesInvoice.deleteMany({
          where: { organizationId: { in: orgIds } },
        });
        await tx.invoiceSequence.deleteMany({
          where: { company: { organizationId: { in: orgIds } } },
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
        await tx.item.deleteMany({
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
        await tx.organization.deleteMany({
          where: { id: { in: orgIds } },
        });
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
        organizationName: "Reports Test Org A",
        companyName: "Ambica Wholesale Reports",
        tradeName: "Ambica Wholesale",
        stateCode: "24",
        city: "Ahmedabad",
        pincode: "380002",
        fullName: "Auditor Jaydeep",
        phone: "9898000009",
        password: "AuditPassword123!",
      },
    });
    expect(regResA.statusCode).toBe(201);
    const regDataA = JSON.parse(regResA.payload);
    tenantAToken = regDataA.accessToken;
    tenantAOrgId = regDataA.defaultContext.organizationId;
    tenantACompanyId = regDataA.defaultContext.companyId;

    const branchA = await prisma.executeBypassRls(async (tx) => {
      return await tx.branch.findFirst({
        where: { companyId: tenantACompanyId },
      });
    });
    tenantABranchId = branchA!.id;

    const fyA = await prisma.executeBypassRls(async (tx) => {
      return await tx.financialYear.findFirst({
        where: { companyId: tenantACompanyId, isCurrent: true },
      });
    });
    tenantAFinancialYearId = fyA!.id;

    // 2. Register Tenant B
    const regResB = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        organizationName: "Reports Test Org B",
        companyName: "Rival Stores Reports",
        tradeName: "Rival Stores",
        stateCode: "24",
        city: "Surat",
        pincode: "395001",
        fullName: "Rival Auditor",
        phone: "9898000010",
        password: "AuditPassword123!",
      },
    });
    expect(regResB.statusCode).toBe(201);
    const regDataB = JSON.parse(regResB.payload);
    tenantBToken = regDataB.accessToken;
    tenantBOrgId = regDataB.defaultContext.organizationId;
    tenantBCompanyId = regDataB.defaultContext.companyId;

    // 3. Seed Standard SME Chart of Accounts for Tenant A & B
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

    // 4. Setup Tenant A master data: Warehouse, UOM, Items, Customer Party with linked ledger
    await prisma.executeBypassRls(async (tx) => {
      // Create Warehouse
      const wh = await tx.warehouse.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          branchId: tenantABranchId,
          name: "Main Godown",
          isDefault: true,
        },
      });
      tenantAWarehouseId = wh.id;

      // Create UOM
      const uom = await tx.unitOfMeasure.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          name: "Kilogram",
          symbol: "KG",
          uqcCode: "KGS",
        },
      });

      // Create Physical Items
      const itemSugar = await tx.item.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          name: "Madhur Pure Sugar",
          sku: "SUGAR-01",
          hsnCode: "1701",
          primaryUomId: uom.id,
          taxRate: 5.0,
          purchaseRate: 36.0,
          retailPrice: 42.0,
        },
      });
      itemSugarId = itemSugar.id;

      const itemTea = await tx.item.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          name: "Wagh Bakri CTC Tea",
          sku: "TEA-01",
          hsnCode: "0902",
          primaryUomId: uom.id,
          taxRate: 5.0,
          purchaseRate: 260.0,
          retailPrice: 320.0,
        },
      });
      itemTeaId = itemTea.id;

      // Seed Opening Stock for Sugar & Tea
      await tx.stockTransaction.createMany({
        data: [
          {
            organizationId: tenantAOrgId,
            companyId: tenantACompanyId,
            warehouseId: wh.id,
            itemId: itemSugar.id,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date("2026-04-01"),
            quantity: 100.0,
            valuationRate: 36.0,
            totalValuation: 3600.0,
            referenceDocType: "OPENING",
            referenceDocId: wh.id,
          },
          {
            organizationId: tenantAOrgId,
            companyId: tenantACompanyId,
            warehouseId: wh.id,
            itemId: itemTea.id,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date("2026-04-01"),
            quantity: 50.0,
            valuationRate: 260.0,
            totalValuation: 13000.0,
            referenceDocType: "OPENING",
            referenceDocId: wh.id,
          },
        ],
      });

      // Create Party (Customer with GSTIN)
      const party = await tx.party.create({
        data: {
          organizationId: tenantAOrgId,
          companyId: tenantACompanyId,
          name: "Patel Provision Store",
          nameGujarati: "પટેલ પ્રોવિઝન સ્ટોર",
          phone: "9825012345",
          gstin: "24AAAAA0000A1Z5",
          stateCode: "24",
          creditLimit: 50000.0,
          creditDays: 15,
          interestRate: 18.0,
          billingAddress: {
            line1: "Relief Road",
            city: "Ahmedabad",
            state: "Gujarat",
            pincode: "380001",
          },
        },
      });
      customerPartyId = party.id;

      // Find Sundry Debtors group and link a LedgerAccount for the party
      const debtorsGroup = await tx.ledgerGroup.findFirst({
        where: { companyId: tenantACompanyId, name: "Sundry Debtors" },
      });

      if (debtorsGroup) {
        await tx.ledgerAccount.create({
          data: {
            organizationId: tenantAOrgId,
            companyId: tenantACompanyId,
            groupId: debtorsGroup.id,
            name: party.name,
            nameGujarati: party.nameGujarati,
            isPartyLedger: true,
            partyId: party.id,
            openingBalance: 0.0,
            openingType: "DR",
            currentBalance: 0.0,
          },
        });
      }
    });

    // 5. Create Sales Invoices for Tenant A
    // Invoice 1: Intra-state sales (Sugar, 10 KG @ 40 = 400 + 5% GST = 420.00)
    const invRes1 = await app.inject({
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
        invoiceDate: "2026-05-10",
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
    expect(invRes1.statusCode).toBe(201);
    invoice1Id = JSON.parse(invRes1.payload).id;

    // Invoice 2: Intra-state sales (Tea, 5 KG @ 300 = 1500 + 5% GST = 1575.00)
    const invRes2 = await app.inject({
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
            itemId: itemTeaId,
            quantity: 5,
            unitPrice: 300,
            taxRate: 5,
          },
        ],
      },
    });
    expect(invRes2.statusCode).toBe(201);
    invoice2Id = JSON.parse(invRes2.payload).id;

    // Invoice 3 (to be cancelled): Intra-state sales (Sugar, 2 KG @ 40 = 80 + 4 = 84.00)
    const invRes3 = await app.inject({
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
        invoiceDate: "2026-07-01",
        category: InvoiceCategory.TAX_INVOICE,
        items: [
          {
            itemId: itemSugarId,
            quantity: 2,
            unitPrice: 40,
            taxRate: 5,
          },
        ],
      },
    });
    expect(invRes3.statusCode).toBe(201);
    cancelledInvoiceId = JSON.parse(invRes3.payload).id;

    // Cancel Invoice 3
    const cancelRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${cancelledInvoiceId}/cancel`,
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
      payload: {
        reason: "Customer cancellation for report verification",
      },
    });
    expect(cancelRes.statusCode).toBe(200);

    // 6. Record Payment on Invoice 1: ₹200.00 received via Cash
    const payRes = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/sales/${invoice1Id}/payments`,
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
      payload: {
        amount: 200.0,
        paymentMode: PaymentMode.CASH,
        paymentDate: "2026-05-20",
        referenceNumber: "CASH-REC-01",
      },
    });
    expect(payRes.statusCode).toBe(200);
  });

  afterAll(async () => {
    await app.close();
  });

  // --------------------------------------------------------------------------
  // TEST 1: Sales Register & Summaries
  // --------------------------------------------------------------------------
  it("should return accurate sales register and reconcile statutory totals excluding cancelled invoices", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/sales-register",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);

    expect(data.pagination.totalCount).toBe(3); // 2 valid + 1 cancelled
    expect(data.summary.validInvoices).toBe(2);
    expect(data.summary.cancelledInvoices).toBe(1);

    // Valid invoices:
    // Inv 1: Taxable 400.00, CGST 10.00, SGST 10.00, Total 420.00, Paid 200.00, Bal 220.00
    // Inv 2: Taxable 1500.00, CGST 37.50, SGST 37.50, Total 1575.00, Paid 0.00, Bal 1575.00
    // Statutory Totals:
    // Taxable: 1900.00
    // CGST: 47.50
    // SGST: 47.50
    // Grand Total: 1995.00
    // Paid: 200.00
    // Balance: 1795.00
    expect(data.summary.totalTaxable).toBe("1900.00");
    expect(data.summary.totalCgst).toBe("47.50");
    expect(data.summary.totalSgst).toBe("47.50");
    expect(data.summary.totalGrandTotal).toBe("1995.00");
    expect(data.summary.totalPaid).toBe("200.00");
    expect(data.summary.totalBalance).toBe("1795.00");

    expect(data.items.length).toBe(3);
    const validInv1 = data.items.find((i: any) => i.id === invoice1Id);
    expect(validInv1.partyName).toBe("Patel Provision Store");
    expect(validInv1.partyGstin).toBe("24AAAAA0000A1Z5");
    expect(validInv1.balanceAmount).toBe("220.00");
  });

  // --------------------------------------------------------------------------
  // TEST 2: Sales Register CSV Export
  // --------------------------------------------------------------------------
  it("should export sales register CSV with matching columns and summary row", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/sales-register/export",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("sales-register.csv");

    const csv = res.payload;
    expect(csv).toContain('"Invoice Number","Date"');
    expect(csv).toContain('"Patel Provision Store"');
    expect(csv).toContain('"24AAAAA0000A1Z5"');
    expect(csv).toContain('"TOTAL"');
    expect(csv).toContain('"1900.00"'); // Taxable total
    expect(csv).toContain('"1995.00"'); // Grand total
  });

  // --------------------------------------------------------------------------
  // TEST 3: Sales Register Date Range Filtering
  // --------------------------------------------------------------------------
  it("should respect date range filters strictly", async () => {
    // Query only May 2026 (Invoice 1 was 2026-05-10, Invoice 2 was 2026-06-15)
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/sales-register?fromDate=2026-05-01&toDate=2026-05-31",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.pagination.totalCount).toBe(1);
    expect(data.items[0].id).toBe(invoice1Id);
    expect(data.summary.totalGrandTotal).toBe("420.00");
  });

  // --------------------------------------------------------------------------
  // TEST 4: Receipt & Payment Register
  // --------------------------------------------------------------------------
  it("should report receipt register entries with allocations and net cash movement", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/receipt-payment-register",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);

    expect(data.pagination.totalCount).toBeGreaterThanOrEqual(1);
    expect(parseFloat(data.summary.totalReceipts)).toBeGreaterThanOrEqual(
      200.0,
    );
    const receiptItem = data.items.find(
      (i: any) =>
        i.voucherType === "RECEIPT" && parseFloat(i.totalAmount) === 200.0,
    );
    expect(receiptItem).toBeDefined();
    expect(receiptItem.partyOrAccountName).toContain("Patel Provision Store");
  });

  // --------------------------------------------------------------------------
  // TEST 5: Customer Outstanding Balances & Aging
  // --------------------------------------------------------------------------
  it("should calculate customer outstanding balances and overdue aging with accrued interest", async () => {
    // 1. Outstanding Balances
    const balRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/outstanding-balances?partyType=CUSTOMER",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(balRes.statusCode).toBe(200);
    const balData = JSON.parse(balRes.payload);
    expect(balData.summary.totalParties).toBeGreaterThanOrEqual(1);
    expect(balData.summary.totalReceivables).toBe("1795.00"); // 220.00 + 1575.00

    const patel = balData.parties.find(
      (p: any) => p.partyId === customerPartyId,
    );
    expect(patel).toBeDefined();
    expect(patel.unpaidInvoicesCount).toBe(2);
    expect(patel.invoiceOutstanding).toBe("1795.00");

    // 2. Aging Report (As of 2026-08-01: Inv 1 from 2026-05-10 with 15 days credit is ~67 days overdue)
    const agingRes = await app.inject({
      method: "GET",
      url: `/api/v1/reports/party-aging?asOfDate=2026-08-01&partyId=${customerPartyId}`,
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(agingRes.statusCode).toBe(200);
    const agingData = JSON.parse(agingRes.payload);
    expect(agingData.summary.totalReceivable).toBe("1795.00");
    const patelAging = agingData.parties[0];
    expect(patelAging.partyName).toBe("Patel Provision Store");
    expect(patelAging.overdueDays).toBeGreaterThan(30);
    expect(parseFloat(patelAging.accruedInterest)).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // TEST 6: Party Ledger (Statement of Account / Khata)
  // --------------------------------------------------------------------------
  it("should generate party ledger reconciling strictly with double-entry journal entries", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/reports/party-ledger?partyId=${customerPartyId}`,
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);

    expect(data.party.name).toBe("Patel Provision Store");
    expect(data.openingBalance.amount).toBe("0.00");

    // Chronological transactions should contain:
    // 1. Sales Invoice 1 (Debit ₹420.00)
    // 2. Payment Receipt (Credit ₹200.00)
    // 3. Sales Invoice 2 (Debit ₹1575.00)
    // 4. Sales Invoice 3 (Debit ₹84.00) & Contra Reversal (Credit ₹84.00) - net zero
    expect(data.transactions.length).toBeGreaterThanOrEqual(3);

    // Total Debit - Total Credit = Closing Balance
    // Debits: 420.00 + 1575.00 + 84.00 = 2079.00
    // Credits: 200.00 + 84.00 (reversal) = 284.00
    // Net closing balance = 2079.00 - 284.00 = 1795.00 DR
    expect(data.closingBalance.amount).toBe("1795.00");
    expect(data.closingBalance.type).toBe("DR");
  });

  // --------------------------------------------------------------------------
  // TEST 7: Trial Balance Mathematical Invariance (Debits == Credits)
  // --------------------------------------------------------------------------
  it("should prove strict debit-credit equality in Trial Balance (Kachu Sarvaiyu)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/trial-balance",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);

    expect(data.isBalanced).toBe(true);
    expect(data.difference).toBe("0.00");
    expect(data.totals.totalClosingDebit).toBe(data.totals.totalClosingCredit);
    expect(parseFloat(data.totals.totalClosingDebit)).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // TEST 8: Profit & Loss Statement (Nafanuksan Khatun)
  // --------------------------------------------------------------------------
  it("should calculate Profit & Loss with direct sales income", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/profit-and-loss",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);

    // Direct Sales Income = ₹1900.00 (₹400 from Inv 1 + ₹1500 from Inv 2; Inv 3 was cancelled)
    expect(data.summary.directIncome).toBe("1900.00");
    expect(data.summary.grossProfit).toBe("1900.00");
    expect(data.summary.netProfit).toBe("1900.00");
    expect(data.summary.isNetLoss).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TEST 9: Balance Sheet Consistency (Assets == Liabilities + Equity)
  // --------------------------------------------------------------------------
  it("should verify Balance Sheet balance invariance with net profit carried over", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/balance-sheet",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);

    expect(data.isBalanced).toBe(true);
    expect(data.difference).toBe("0.00");
    expect(data.assets.total).toBe(data.totalLiabilitiesAndEquity);
    // Assets: Receivables (1795.00) + Cash (200.00) = 1995.00
    // Liabilities: Output CGST (47.50) + Output SGST (47.50) = 95.00
    // Equity: Net Profit (1900.00)
    // Liabilities & Equity = 95.00 + 1900.00 = 1995.00
    expect(data.assets.total).toBe("1995.00");
    expect(data.totalLiabilitiesAndEquity).toBe("1995.00");
  });

  // --------------------------------------------------------------------------
  // TEST 10: Day Book (Rojmel / Aavad)
  // --------------------------------------------------------------------------
  it("should display daily cash movements in Day Book (Rojmel)", async () => {
    // Payment was recorded on 2026-05-20
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/daybook?date=2026-05-20",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.date).toBe("2026-05-20");
    expect(data.entries.length).toBeGreaterThanOrEqual(1);
    expect(parseFloat(data.totalJama)).toBeGreaterThanOrEqual(200.0);
  });

  // --------------------------------------------------------------------------
  // TEST 11: Stock Summary & Stock Movement Report
  // --------------------------------------------------------------------------
  it("should aggregate on-hand stock and item ledger movements accurately", async () => {
    // 1. Stock Summary
    const sumRes = await app.inject({
      method: "GET",
      url: "/api/v1/reports/stock-summary",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(sumRes.statusCode).toBe(200);
    const sumData = JSON.parse(sumRes.payload);
    expect(sumData.totals.totalItems).toBe(2);

    // Sugar: Opening 100 - Inv 1 (10) - Inv 3 (2) + Cancelled Inv 3 (+2) = 90.0000
    const sugar = sumData.items.find((i: any) => i.itemId === itemSugarId);
    expect(sugar).toBeDefined();
    expect(sugar.currentStockQuantity).toBe("90.0000");
    expect(sugar.minStockLevel).toBe("0.0000");

    // Tea: Opening 50 - Inv 2 (5) = 45.0000
    const tea = sumData.items.find((i: any) => i.itemId === itemTeaId);
    expect(tea).toBeDefined();
    expect(tea.currentStockQuantity).toBe("45.0000");

    // 2. Stock Movement for Sugar
    const movRes = await app.inject({
      method: "GET",
      url: `/api/v1/reports/stock-movement?itemId=${itemSugarId}`,
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(movRes.statusCode).toBe(200);
    const movData = JSON.parse(movRes.payload);
    expect(movData.item.name).toBe("Madhur Pure Sugar");
    expect(movData.closingQuantity).toBe("90.0000");
    expect(movData.transactions.length).toBeGreaterThanOrEqual(3);
  });

  // --------------------------------------------------------------------------
  // TEST 12: GSTR-1 Summary Data Preparation
  // --------------------------------------------------------------------------
  it("should compile GSTR-1 return preparation data (B2B, HSN, Document Summary)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/gstr-1",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);

    expect(data.disclaimer).toContain("Statutory Notice");
    expect(data.grossTurnover).toBe("1995.00");
    expect(data.totalTaxable).toBe("1900.00");
    expect(data.totalCgst).toBe("47.50");
    expect(data.totalSgst).toBe("47.50");

    // B2B Section
    expect(data.b2b.length).toBe(1);
    expect(data.b2b[0].ctin).toBe("24AAAAA0000A1Z5");
    expect(data.b2b[0].inv.length).toBe(2); // 2 valid invoices

    // HSN Section
    expect(data.hsn.data.length).toBeGreaterThanOrEqual(2);
    const sugarHsn = data.hsn.data.find((h: any) => h.hsn_sc === "1701");
    expect(sugarHsn).toBeDefined();
    expect(sugarHsn.qty).toBe("10.00");

    // Document Summary (Table 13)
    expect(data.docSummary.totalIssued).toBe(2);
    expect(data.docSummary.cancelledCount).toBe(1);
  });

  // --------------------------------------------------------------------------
  // TEST 13: Purchase Register Deferred Status
  // --------------------------------------------------------------------------
  it("should return documented deferred status for Purchase Register", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/purchase-register",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
        "x-branch-id": tenantABranchId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.isDeferred).toBe(false);
    expect(data.status).toBe("READY");
    expect(data.totals.totalTaxable).toBe("0.00");
    expect(data.items).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // TEST 14: Tenant Isolation & Security
  // --------------------------------------------------------------------------
  it("should prevent Tenant B from reading Tenant A reports", async () => {
    // Tenant B queries sales register
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/sales-register",
      headers: {
        authorization: `Bearer ${tenantBToken}`,
        "x-organization-id": tenantBOrgId,
        "x-company-id": tenantBCompanyId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.pagination.totalCount).toBe(0);
    expect(data.items.length).toBe(0);
    expect(data.summary.totalGrandTotal).toBe("0.00");

    // Tenant B queries Tenant A's party ledger
    const ledgerRes = await app.inject({
      method: "GET",
      url: `/api/v1/reports/party-ledger?partyId=${customerPartyId}`,
      headers: {
        authorization: `Bearer ${tenantBToken}`,
        "x-organization-id": tenantBOrgId,
        "x-company-id": tenantBCompanyId,
      },
    });
    // Should return 404 because customer belongs to Tenant A
    expect(ledgerRes.statusCode).toBe(404);
  });

  // --------------------------------------------------------------------------
  // TEST 15: Cash Flow Statement (Direct Method)
  // --------------------------------------------------------------------------
  it("should calculate cash flow statement with operating inflows and closing cash balance", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/cash-flow",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.operatingActivities).toBeDefined();
    expect(data.operatingActivities.inflows).toBeDefined();
    // Payment of 200 was collected from customer
    expect(
      parseFloat(data.operatingActivities.inflows.receiptsFromCustomers),
    ).toBeGreaterThanOrEqual(200.0);
    expect(data.closingCashAndBank).toBeDefined();
    expect(parseFloat(data.closingCashAndBank)).toBeGreaterThanOrEqual(200.0);
  });

  // --------------------------------------------------------------------------
  // TEST 16: GSTR-3B Monthly Return Summary
  // --------------------------------------------------------------------------
  it("should compile GSTR-3B summary with Table 3.1 outward tax and Table 6.1 tax payable", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/reports/gstr-3b",
      headers: {
        authorization: `Bearer ${tenantAToken}`,
        "x-organization-id": tenantAOrgId,
        "x-company-id": tenantACompanyId,
      },
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.table3_1_outwardSupplies).toBeDefined();
    expect(
      parseFloat(data.table3_1_outwardSupplies.taxableValue),
    ).toBeGreaterThan(0);
    expect(data.table4_eligibleItc).toBeDefined();
    expect(data.table6_1_paymentOfTax).toBeDefined();
    expect(data.gstin).toBeDefined();
  });
});
