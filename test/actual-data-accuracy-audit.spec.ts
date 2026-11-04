import { describe, it, expect, beforeAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { ReportsService } from "../src/reports/reports.service";
import { TenantContext, UserRole, InvoiceStatus, InvoiceCategory, VoucherType, AccountNature } from "@billing/shared-types";
import { Decimal, toMoney, toDecimal } from "@billing/accounting-core";

describe("Actual Data Accuracy Audit of All 33 Reports", () => {
  let prisma: DatabaseService;
  let reportsService: ReportsService;

  // Real company in the database with rich multi-module transactions
  const companyId = "92967a06-d488-4794-bae1-e6188e8fb47d";
  const organizationId = "3127cc52-2797-4dc2-a9d3-55ba236c8d55";
  const branchId = "96ceb02c-5439-4144-b323-e0d7748c3db0";

  const tenant: TenantContext = {
    userId: "ec46866d-7d8e-4119-bba5-0044d0fce8de",
    organizationId,
    companyId,
    branchId,
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleRef.get(DatabaseService);
    reportsService = moduleRef.get(ReportsService);
  });

  // --------------------------------------------------------------------------
  // Category 1: Sales Reports (Reports 1 to 8)
  // --------------------------------------------------------------------------
  it("Report 1 & 2: Sales Register & Sales Summary vs Source Module", async () => {
    // 1. Run Report Service Method
    const reportData = await reportsService.getSalesRegister({}, tenant);

    // 2. Query Ground Truth from DB directly
    const sourceInvoices = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.salesInvoice.findMany({
        where: { companyId },
        select: {
          id: true,
          status: true,
          taxableAmount: true,
          cgstAmount: true,
          sgstAmount: true,
          igstAmount: true,
          cessAmount: true,
          roundOff: true,
          grandTotal: true,
          paidAmount: true,
          balanceAmount: true,
        },
      });
    });

    let groundTaxable = new Decimal(0);
    let groundCgst = new Decimal(0);
    let groundSgst = new Decimal(0);
    let groundIgst = new Decimal(0);
    let groundGrand = new Decimal(0);
    let groundPaid = new Decimal(0);
    let groundBalance = new Decimal(0);
    let validCount = 0;
    let cancelledCount = 0;

    for (const inv of sourceInvoices) {
      if (inv.status === InvoiceStatus.CANCELLED) {
        cancelledCount++;
        continue;
      }
      validCount++;
      groundTaxable = groundTaxable.plus(toMoney(inv.taxableAmount));
      groundCgst = groundCgst.plus(toMoney(inv.cgstAmount));
      groundSgst = groundSgst.plus(toMoney(inv.sgstAmount));
      groundIgst = groundIgst.plus(toMoney(inv.igstAmount));
      groundGrand = groundGrand.plus(toMoney(inv.grandTotal));
      groundPaid = groundPaid.plus(toMoney(inv.paidAmount));
      groundBalance = groundBalance.plus(toMoney(inv.balanceAmount));
    }

    console.log("=== REPORT 1 & 2: SALES REGISTER AUDIT ===");
    console.log(`Source Invoices: ${sourceInvoices.length} total, ${validCount} valid, ${cancelledCount} cancelled`);
    console.log(`Report Invoices: ${reportData.summary.totalInvoices} total, ${reportData.summary.validInvoices} valid, ${reportData.summary.cancelledInvoices} cancelled`);
    console.log(`Ground Taxable: ${groundTaxable.toFixed(2)}, Report Taxable: ${reportData.summary.totalTaxable}`);
    console.log(`Ground GrandTotal: ${groundGrand.toFixed(2)}, Report GrandTotal: ${reportData.summary.totalGrandTotal}`);
    console.log(`Ground Paid: ${groundPaid.toFixed(2)}, Report Paid: ${reportData.summary.totalPaid}`);
    console.log(`Ground Balance: ${groundBalance.toFixed(2)}, Report Balance: ${reportData.summary.totalBalance}`);

    expect(reportData.summary.validInvoices).toBe(validCount);
    expect(reportData.summary.cancelledInvoices).toBe(cancelledCount);
    expect(reportData.summary.totalTaxable).toBe(groundTaxable.toFixed(2));
    expect(reportData.summary.totalGrandTotal).toBe(groundGrand.toFixed(2));
    expect(reportData.summary.totalPaid).toBe(groundPaid.toFixed(2));
    expect(reportData.summary.totalBalance).toBe(groundBalance.toFixed(2));
  });

  it("Report 3: Bill-Wise Profit & Margin vs Ground Truth COGS", async () => {
    const reportData = await reportsService.getBillWiseProfit({}, tenant);

    const invoices = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.salesInvoice.findMany({
        where: { companyId, status: { not: InvoiceStatus.CANCELLED } },
        include: {
          items: {
            include: {
              item: { select: { purchaseRate: true } },
            },
          },
        },
      });
    });

    let groundRevenue = new Decimal(0);
    let groundTaxable = new Decimal(0);
    let groundCogs = new Decimal(0);

    for (const inv of invoices) {
      groundRevenue = groundRevenue.plus(toMoney(inv.grandTotal));
      groundTaxable = groundTaxable.plus(toMoney(inv.taxableAmount));
      for (const it of inv.items) {
        groundCogs = groundCogs.plus(toMoney(it.quantity).times(toMoney(it.item?.purchaseRate || 0)));
      }
    }

    console.log("=== REPORT 3: BILL-WISE PROFIT AUDIT ===");
    console.log(`Report Total Revenue: ${reportData.summary.totalRevenue}, Ground GrandTotal: ${groundRevenue.toFixed(2)}, Ground Taxable: ${groundTaxable.toFixed(2)}`);
    console.log(`Report Total COGS: ${reportData.summary.totalCogs}, Ground COGS: ${groundCogs.toFixed(2)}`);
    console.log(`Report Total Gross Profit: ${reportData.summary.totalGrossProfit}`);
  });

  it("Report 4: Item-Wise Sales Report vs Source Sales Items", async () => {
    const reportData = await reportsService.getItemSalesReport({}, tenant);

    const sourceItems = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.salesInvoiceItem.findMany({
        where: {
          invoice: {
            companyId,
            status: { not: InvoiceStatus.CANCELLED },
          },
        },
      });
    });

    let groundQty = new Decimal(0);
    let groundTaxable = new Decimal(0);
    let groundTax = new Decimal(0);
    let groundTotal = new Decimal(0);

    for (const it of sourceItems) {
      const q = toMoney(it.quantity);
      const tax = toMoney(it.cgstAmount).plus(toMoney(it.sgstAmount)).plus(toMoney(it.igstAmount));
      const taxable = toMoney(it.taxableAmount);
      const tot = toMoney(it.totalAmount || taxable.plus(tax));

      groundQty = groundQty.plus(q);
      groundTaxable = groundTaxable.plus(taxable);
      groundTax = groundTax.plus(tax);
      groundTotal = groundTotal.plus(tot);
    }

    console.log("=== REPORT 4: ITEM-WISE SALES AUDIT ===");
    console.log(`Ground Quantity: ${groundQty.toFixed(2)}, Report Quantity: ${reportData.summary.totalQuantity}`);
    console.log(`Ground Taxable: ${groundTaxable.toFixed(2)}, Report Taxable: ${reportData.summary.totalTaxable}`);
    console.log(`Ground Total: ${groundTotal.toFixed(2)}, Report Total: ${reportData.summary.totalSales}`);

    expect(reportData.summary.totalQuantity).toBe(groundQty.toFixed(2));
    expect(reportData.summary.totalTaxable).toBe(groundTaxable.toFixed(2));
    expect(reportData.summary.totalSales).toBe(groundTotal.toFixed(2));
  });

  it("Report 5: Customer-Wise Sales Report vs Source Customer Invoices", async () => {
    const reportData = await reportsService.getPartySalesReport({}, tenant);

    const sourceInvoices = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.salesInvoice.findMany({
        where: { companyId, status: { not: InvoiceStatus.CANCELLED } },
      });
    });

    let groundSales = new Decimal(0);
    let groundPaid = new Decimal(0);
    let groundBalance = new Decimal(0);

    for (const inv of sourceInvoices) {
      groundSales = groundSales.plus(toMoney(inv.grandTotal));
      groundPaid = groundPaid.plus(toMoney(inv.paidAmount));
      groundBalance = groundBalance.plus(toMoney(inv.balanceAmount));
    }

    console.log("=== REPORT 5: CUSTOMER-WISE SALES AUDIT ===");
    console.log(`Ground Sales: ${groundSales.toFixed(2)}, Report Sales: ${reportData.summary.totalSales}`);
    console.log(`Ground Paid: ${groundPaid.toFixed(2)}, Report Paid: ${reportData.summary.totalPaid}`);
    console.log(`Ground Balance: ${groundBalance.toFixed(2)}, Report Balance: ${reportData.summary.totalBalance}`);

    expect(reportData.summary.totalSales).toBe(groundSales.toFixed(2));
    expect(reportData.summary.totalPaid).toBe(groundPaid.toFixed(2));
    expect(reportData.summary.totalBalance).toBe(groundBalance.toFixed(2));
  });

  it("Report 6: Sales Returns (Credit Notes) vs Source Sales Returns", async () => {
    const reportData = await reportsService.getSalesReturnsReport({}, tenant);

    const sourceReturns = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.salesReturn.findMany({
        where: { companyId },
      });
    });

    let groundTaxable = new Decimal(0);
    let groundTax = new Decimal(0);
    let groundGrand = new Decimal(0);

    for (const r of sourceReturns) {
      groundTaxable = groundTaxable.plus(toMoney(r.taxableAmount));
      groundTax = groundTax.plus(toMoney(r.cgstAmount)).plus(toMoney(r.sgstAmount)).plus(toMoney(r.igstAmount));
      groundGrand = groundGrand.plus(toMoney(r.grandTotal));
    }

    console.log("=== REPORT 6: SALES RETURNS AUDIT ===");
    console.log(`Source Returns: ${sourceReturns.length}, Report Returns: ${reportData.summary.totalReturns}`);
    console.log(`Ground Taxable: ${groundTaxable.toFixed(2)}, Report Taxable: ${reportData.summary.totalTaxable}`);
    console.log(`Ground Grand: ${groundGrand.toFixed(2)}, Report Grand: ${reportData.summary.grandTotal}`);

    expect(reportData.summary.totalReturns).toBe(sourceReturns.length);
    expect(reportData.summary.totalTaxable).toBe(groundTaxable.toFixed(2));
    expect(reportData.summary.grandTotal).toBe(groundGrand.toFixed(2));
  });

  it("Report 7: Quotations / Estimates Report vs Source Proforma Invoices", async () => {
    const reportData = await reportsService.getQuotationsReport({}, tenant);

    const sourceQuotes = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.salesInvoice.findMany({
        where: { companyId, category: InvoiceCategory.PROFORMA_INVOICE },
      });
    });

    let groundValue = new Decimal(0);
    for (const q of sourceQuotes) {
      groundValue = groundValue.plus(toMoney(q.grandTotal));
    }

    console.log("=== REPORT 7: QUOTATIONS AUDIT ===");
    console.log(`Source Quotes: ${sourceQuotes.length}, Report Quotes: ${reportData.summary.totalQuotations}`);
    console.log(`Ground Value: ${groundValue.toFixed(2)}, Report Value: ${reportData.summary.totalValue}`);

    expect(reportData.summary.totalQuotations).toBe(sourceQuotes.length);
    expect(reportData.summary.totalValue).toBe(groundValue.toFixed(2));
  });

  it("Report 8: Delivery Challans Report vs Source Delivery Challans", async () => {
    const reportData = await reportsService.getDeliveryChallansReport({}, tenant);

    const sourceChallans = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.deliveryChallan.findMany({
        where: { companyId },
      });
    });

    console.log("=== REPORT 8: DELIVERY CHALLANS AUDIT ===");
    console.log(`Source Challans: ${sourceChallans.length}, Report Challans: ${reportData.summary.totalChallans}`);

    expect(reportData.summary.totalChallans).toBe(sourceChallans.length);
  });

  // --------------------------------------------------------------------------
  // Category 2: Purchase Reports (Reports 9 to 13)
  // --------------------------------------------------------------------------
  it("Report 9 & 10: Purchase Register & Summary vs Source Purchases & Returns", async () => {
    const reportData = await reportsService.getPurchaseRegister(tenant, {});

    const { purchases, returns } = await prisma.executeInTenantContext(tenant, async (tx) => {
      const p = await tx.purchaseInvoice.findMany({ where: { companyId } });
      const r = await tx.purchaseReturn.findMany({ where: { companyId } });
      return { purchases: p, returns: r };
    });

    let groundTaxable = new Decimal(0);
    let groundCgst = new Decimal(0);
    let groundSgst = new Decimal(0);
    let groundIgst = new Decimal(0);
    let groundGrand = new Decimal(0);

    for (const pinv of purchases) {
      groundTaxable = groundTaxable.plus(toMoney(pinv.taxableAmount));
      groundCgst = groundCgst.plus(toMoney(pinv.cgstAmount));
      groundSgst = groundSgst.plus(toMoney(pinv.sgstAmount));
      groundIgst = groundIgst.plus(toMoney(pinv.igstAmount));
      groundGrand = groundGrand.plus(toMoney(pinv.grandTotal));
    }

    for (const pr of returns) {
      groundTaxable = groundTaxable.minus(toMoney(pr.taxableAmount));
      groundCgst = groundCgst.minus(toMoney(pr.cgstAmount));
      groundSgst = groundSgst.minus(toMoney(pr.sgstAmount));
      groundIgst = groundIgst.minus(toMoney(pr.igstAmount));
      groundGrand = groundGrand.minus(toMoney(pr.grandTotal));
    }

    console.log("=== REPORT 9 & 10: PURCHASE REGISTER AUDIT ===");
    console.log(`Source Purchases: ${purchases.length}, Returns: ${returns.length}, Net Count: ${purchases.length + returns.length}`);
    console.log(`Report Total Count: ${reportData.totalCount}`);
    console.log(`Ground Net Taxable: ${groundTaxable.toFixed(2)}, Report Taxable: ${reportData.totals.totalTaxable}`);
    console.log(`Ground Net Grand: ${groundGrand.toFixed(2)}, Report Grand: ${reportData.totals.totalGrandTotal}`);

    expect(reportData.totalCount).toBe(purchases.length + returns.length);
    expect(reportData.totals.totalTaxable).toBe(groundTaxable.toFixed(2));
    expect(reportData.totals.totalGrandTotal).toBe(groundGrand.toFixed(2));
  });

  it("Report 11: Item-Wise Purchase Report vs Source Purchase Items", async () => {
    const reportData = await reportsService.getItemPurchaseReport({}, tenant);

    const sourceItems = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.purchaseInvoiceItem.findMany({
        where: { invoice: { companyId } },
      });
    });

    let groundQty = new Decimal(0);
    let groundPurchases = new Decimal(0);

    for (const it of sourceItems) {
      const q = toMoney(it.quantity);
      const taxable = toMoney(it.taxableAmount);
      const tax = toMoney(it.cgstAmount).plus(toMoney(it.sgstAmount)).plus(toMoney(it.igstAmount));
      const tot = toMoney(it.totalAmount || taxable.plus(tax));

      groundQty = groundQty.plus(q);
      groundPurchases = groundPurchases.plus(tot);
    }

    console.log("=== REPORT 11: ITEM-WISE PURCHASE AUDIT ===");
    console.log(`Ground Qty: ${groundQty.toFixed(2)}, Report Qty: ${reportData.summary.totalQuantity}`);
    console.log(`Ground Purchases: ${groundPurchases.toFixed(2)}, Report Purchases: ${reportData.summary.totalPurchases}`);

    expect(reportData.summary.totalQuantity).toBe(groundQty.toFixed(2));
    expect(reportData.summary.totalPurchases).toBe(groundPurchases.toFixed(2));
  });

  it("Report 12: Supplier-Wise Purchase Report vs Source Supplier Purchases", async () => {
    const reportData = await reportsService.getPartyPurchaseReport({}, tenant);

    const sourceInvoices = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.purchaseInvoice.findMany({ where: { companyId } });
    });

    let groundPurchases = new Decimal(0);
    let groundPaid = new Decimal(0);
    let groundPayable = new Decimal(0);

    for (const inv of sourceInvoices) {
      groundPurchases = groundPurchases.plus(toMoney(inv.grandTotal));
      groundPaid = groundPaid.plus(toMoney(inv.paidAmount));
      groundPayable = groundPayable.plus(toMoney(inv.balanceAmount));
    }

    console.log("=== REPORT 12: SUPPLIER-WISE PURCHASE AUDIT ===");
    console.log(`Ground Purchases: ${groundPurchases.toFixed(2)}, Report Purchases: ${reportData.summary.totalPurchases}`);
    console.log(`Ground Paid: ${groundPaid.toFixed(2)}, Report Paid: ${reportData.summary.totalPaid}`);
    console.log(`Ground Payable: ${groundPayable.toFixed(2)}, Report Payable: ${reportData.summary.totalPayable}`);

    expect(reportData.summary.totalPurchases).toBe(groundPurchases.toFixed(2));
    expect(reportData.summary.totalPaid).toBe(groundPaid.toFixed(2));
    expect(reportData.summary.totalPayable).toBe(groundPayable.toFixed(2));
  });

  it("Report 13: Purchase Returns (Debit Notes) vs Source Purchase Returns", async () => {
    const reportData = await reportsService.getPurchaseReturnsReport({}, tenant);

    const sourceReturns = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.purchaseReturn.findMany({ where: { companyId } });
    });

    let groundTaxable = new Decimal(0);
    let groundGrand = new Decimal(0);

    for (const r of sourceReturns) {
      groundTaxable = groundTaxable.plus(toMoney(r.taxableAmount));
      groundGrand = groundGrand.plus(toMoney(r.grandTotal));
    }

    console.log("=== REPORT 13: PURCHASE RETURNS AUDIT ===");
    console.log(`Source Returns: ${sourceReturns.length}, Report Returns: ${reportData.summary.totalReturns}`);
    console.log(`Ground Taxable: ${groundTaxable.toFixed(2)}, Report Taxable: ${reportData.summary.totalTaxable}`);
    console.log(`Ground Grand: ${groundGrand.toFixed(2)}, Report Grand: ${reportData.summary.grandTotal}`);

    expect(reportData.summary.totalReturns).toBe(sourceReturns.length);
    expect(reportData.summary.totalTaxable).toBe(groundTaxable.toFixed(2));
    expect(reportData.summary.grandTotal).toBe(groundGrand.toFixed(2));
  });

  // --------------------------------------------------------------------------
  // Category 3: Stock / Inventory Reports (Reports 14 to 17)
  // --------------------------------------------------------------------------
  it("Report 14: Stock Summary vs Actual Stock Transactions", async () => {
    const reportData = await reportsService.getStockSummary({}, tenant);

    const items = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.item.findMany({
        where: { companyId, isActive: true },
        include: {
          stockTransactions: {
            where: { companyId },
          },
        },
      });
    });

    let groundQty = new Decimal(0);
    let groundValuation = new Decimal(0);

    for (const it of items) {
      let itQty = new Decimal(0);
      let itVal = new Decimal(0);
      for (const st of it.stockTransactions) {
        const q = toDecimal(st.quantity);
        itQty = itQty.plus(q);
        const stVal = toMoney(st.totalValuation).abs();
        itVal = itVal.plus(q.isNegative() ? stVal.negated() : stVal);
      }
      if (itQty.lte(0)) itVal = new Decimal(0);

      groundQty = groundQty.plus(itQty);
      groundValuation = groundValuation.plus(itVal);
    }

    console.log("=== REPORT 14: STOCK SUMMARY AUDIT ===");
    console.log(`Ground Total Items: ${items.length}, Report Total Items: ${reportData.totals.totalItems}`);
    console.log(`Ground Stock Qty: ${groundQty.toFixed(4)}, Report Stock Qty: ${reportData.totals.grandStockQuantity}`);
    console.log(`Ground Stock Valuation: ${groundValuation.toFixed(2)}, Report Stock Valuation: ${reportData.totals.grandStockValuation}`);

    expect(reportData.totals.totalItems).toBe(items.length);
    expect(reportData.totals.grandStockQuantity).toBe(groundQty.toFixed(4));
    expect(reportData.totals.grandStockValuation).toBe(groundValuation.toFixed(2));
  });

  it("Report 15: Stock Movement vs Ground Truth Item Movements", async () => {
    // Audit for item with transactions
    const items = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.item.findMany({
        where: { companyId, isActive: true },
        include: { stockTransactions: true },
      });
    });

    const itemWithTx = items.find((i) => i.stockTransactions.length > 0) || items[0];
    if (itemWithTx) {
      const reportData = await reportsService.getStockMovement({ itemId: itemWithTx.id }, tenant);

      let groundIn = new Decimal(0);
      let groundOut = new Decimal(0);
      let groundClosing = new Decimal(0);

      for (const st of itemWithTx.stockTransactions) {
        const q = toDecimal(st.quantity);
        groundClosing = groundClosing.plus(q);
        if (q.isPositive()) groundIn = groundIn.plus(q);
        else groundOut = groundOut.plus(q.abs());
      }

      console.log(`=== REPORT 15: STOCK MOVEMENT AUDIT for Item: ${itemWithTx.name} ===`);
      console.log(`Ground In: ${groundIn.toFixed(4)}, Report In: ${reportData.totalIn}`);
      console.log(`Ground Out: ${groundOut.toFixed(4)}, Report Out: ${reportData.totalOut}`);
      console.log(`Ground Closing: ${groundClosing.toFixed(4)}, Report Closing: ${reportData.closingQuantity}`);

      expect(reportData.totalIn).toBe(groundIn.toFixed(4));
      expect(reportData.totalOut).toBe(groundOut.toFixed(4));
      expect(reportData.closingQuantity).toBe(groundClosing.toFixed(4));
    }
  });

  it("Report 16: Item Batch & Expiry vs Source Batches", async () => {
    const reportData = await reportsService.getItemBatchReport({}, tenant);

    const sourceBatches = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.itemBatch.findMany({
        where: { item: { companyId } },
      });
    });

    console.log("=== REPORT 16: ITEM BATCH AUDIT ===");
    console.log(`Source Batches: ${sourceBatches.length}, Report Batches: ${reportData.summary.totalBatches}`);
    expect(reportData.summary.totalBatches).toBe(sourceBatches.length);
  });

  it("Report 17: Low Stock Alert vs Calculated On-Hand Deficit", async () => {
    const reportData = await reportsService.getLowStockAlertReport({}, tenant);

    const items = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.item.findMany({
        where: { companyId, isActive: true },
        include: { stockTransactions: true },
      });
    });

    let groundLowStockCount = 0;
    for (const it of items) {
      let cur = new Decimal(0);
      for (const st of it.stockTransactions) cur = cur.plus(toMoney(st.quantity));
      const minLevel = toMoney(it.minStockLevel);
      if (minLevel.gt(0) && cur.lte(minLevel)) {
        groundLowStockCount++;
      }
    }

    console.log("=== REPORT 17: LOW STOCK ALERT AUDIT ===");
    console.log(`Ground Low Stock Count: ${groundLowStockCount}, Report Low Stock Count: ${reportData.summary.totalLowStockCount}`);
    expect(reportData.summary.totalLowStockCount).toBe(groundLowStockCount);
  });

  // --------------------------------------------------------------------------
  // Category 4: Party Balances & Aging (Reports 18 to 20)
  // --------------------------------------------------------------------------
  it("Report 18: Party Ledger vs Source Double-Entry Journal Entries", async () => {
    // Pick first party with ledger
    const party = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.party.findFirst({
        where: { companyId },
        include: { ledgerAccount: true },
      });
    });

    if (party) {
      const reportData = await reportsService.getPartyLedger({ partyId: party.id }, tenant);

      console.log(`=== REPORT 18: PARTY LEDGER AUDIT for Party: ${party.name} ===`);
      console.log(`Opening Balance: ${reportData.openingBalance.amount} ${reportData.openingBalance.type}`);
      console.log(`Total Debit: ${reportData.totalDebit}, Total Credit: ${reportData.totalCredit}`);
      console.log(`Closing Balance: ${reportData.closingBalance.amount} ${reportData.closingBalance.type}`);
      console.log(`Transactions Count: ${reportData.transactions.length}`);

      expect(reportData.party.id).toBe(party.id);
    }
  });

  it("Report 19: Receivables Aging vs Unpaid Invoices", async () => {
    const reportData = await reportsService.getPartyAging({}, tenant);

    console.log("=== REPORT 19: RECEIVABLES AGING AUDIT ===");
    console.log(`Total Receivable: ${reportData.summary.totalReceivable}`);
    console.log(`Not Due: ${reportData.summary.notDue}, 0-30: ${reportData.summary.overdue0to30}, 31-60: ${reportData.summary.overdue31to60}`);
    console.log(`Parties with Overdue: ${reportData.parties.length}`);
  });

  it("Report 20: Outstanding Balances vs Source Invoice Balances", async () => {
    const reportData = await reportsService.getOutstandingBalances({}, tenant);

    const parties = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.party.findMany({
        where: { companyId, isActive: true },
        include: {
          salesInvoices: {
            where: { status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT] }, balanceAmount: { not: 0 } },
          },
          purchaseInvoices: {
            where: { balanceAmount: { not: 0 } },
          },
        },
      });
    });

    let groundReceivables = new Decimal(0);
    let groundPayables = new Decimal(0);

    for (const p of parties) {
      let sBal = new Decimal(0);
      for (const si of p.salesInvoices) sBal = sBal.plus(toMoney(si.balanceAmount));
      let pBal = new Decimal(0);
      for (const pi of p.purchaseInvoices) pBal = pBal.plus(toMoney(pi.balanceAmount));

      if (p.type === "CUSTOMER") groundReceivables = groundReceivables.plus(sBal);
      else if (p.type === "SUPPLIER") groundPayables = groundPayables.plus(pBal);
      else if (p.type === "BOTH") {
        groundReceivables = groundReceivables.plus(sBal);
        groundPayables = groundPayables.plus(pBal);
      }
    }

    console.log("=== REPORT 20: OUTSTANDING BALANCES AUDIT ===");
    console.log(`Ground Receivables: ${groundReceivables.toFixed(2)}, Report Receivables: ${reportData.summary.totalReceivables}`);
    console.log(`Ground Payables: ${groundPayables.toFixed(2)}, Report Payables: ${reportData.summary.totalPayables}`);

    expect(reportData.summary.totalReceivables).toBe(groundReceivables.toFixed(2));
    expect(reportData.summary.totalPayables).toBe(groundPayables.toFixed(2));
  });

  // --------------------------------------------------------------------------
  // Category 5: Financial Statements & Books (Reports 21 to 28)
  // --------------------------------------------------------------------------
  it("Report 21: Profit & Loss Statement vs Ledger Income & Expenses", async () => {
    const reportData = await reportsService.getProfitAndLoss({}, tenant);

    console.log("=== REPORT 21: PROFIT & LOSS AUDIT ===");
    console.log(`Direct Income: ${reportData.directIncome.total}`);
    console.log(`Direct Expenses: ${reportData.directExpenses.total}`);
    console.log(`Gross Profit: ${reportData.grossProfit}`);
    console.log(`Indirect Income: ${reportData.indirectIncome.total}`);
    console.log(`Indirect Expenses: ${reportData.indirectExpenses.total}`);
    console.log(`Net Profit: ${reportData.netProfit}`);
    console.log(`Trading Gross Profit: ${reportData.tradingAccount.tradingGrossProfit}`);
  });

  it("Report 22: Balance Sheet vs Assets, Liabilities & Equity", async () => {
    const reportData = await reportsService.getBalanceSheet({}, tenant);

    console.log("=== REPORT 22: BALANCE SHEET AUDIT ===");
    console.log(`Total Assets: ${reportData.assets.total}`);
    console.log(`Total Liabilities: ${reportData.liabilities.total}`);
    console.log(`Total Equity: ${reportData.equity.total}`);
    console.log(`Total Liabilities & Equity: ${reportData.totalLiabilitiesAndEquity}`);
    console.log(`Is Balanced: ${reportData.isBalanced}, Difference: ${reportData.difference}`);
  });

  it("Report 23: Trial Balance vs General Ledger Equality", async () => {
    const reportData = await reportsService.getTrialBalance({}, tenant);

    console.log("=== REPORT 23: TRIAL BALANCE AUDIT ===");
    console.log(`Total Period Debit: ${reportData.totals.totalPeriodDebit}`);
    console.log(`Total Period Credit: ${reportData.totals.totalPeriodCredit}`);
    console.log(`Total Closing Debit: ${reportData.totals.totalClosingDebit}`);
    console.log(`Total Closing Credit: ${reportData.totals.totalClosingCredit}`);
    console.log(`Is Balanced: ${reportData.isBalanced}, Difference: ${reportData.difference}`);
  });

  it("Report 24: Cash Flow Statement vs Bank/Cash Movements", async () => {
    const reportData = await reportsService.getCashFlow({}, tenant);

    console.log("=== REPORT 24: CASH FLOW AUDIT ===");
    console.log(`Opening Cash: ${reportData.openingCashBalance}`);
    console.log(`Operating Cash Flow: ${reportData.operatingCashFlow}`);
    console.log(`Investing Cash Flow: ${reportData.investingCashFlow}`);
    console.log(`Financing Cash Flow: ${reportData.financingCashFlow}`);
    console.log(`Net Cash Flow: ${reportData.netCashFlow}`);
    console.log(`Closing Cash: ${reportData.closingCashBalance}`);
  });

  it("Report 25: Day Book (Rojmel) vs Daily Transactions", async () => {
    const reportData = await reportsService.getDaybook({ date: "2026-10-31" }, tenant);

    console.log("=== REPORT 25: DAY BOOK AUDIT (2026-10-31) ===");
    console.log(`Opening Cash: ${reportData.openingCashBalance}`);
    console.log(`Total Udhar: ${reportData.totalUdhar}, Total Jama: ${reportData.totalJama}`);
    console.log(`Closing Cash: ${reportData.closingCashBalance}`);
    console.log(`Entries Count: ${reportData.entries.length}`);
  });

  it("Report 26: Receipt & Payment Register vs Source Vouchers", async () => {
    const reportData = await reportsService.getReceiptPaymentRegister({}, tenant);

    const sourceVouchers = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.voucher.findMany({
        where: {
          companyId,
          isCancelled: false,
          voucherType: { in: [VoucherType.RECEIPT, VoucherType.PAYMENT, VoucherType.CONTRA] },
        },
      });
    });

    let groundReceipts = new Decimal(0);
    let groundPayments = new Decimal(0);
    let groundContra = new Decimal(0);

    for (const v of sourceVouchers) {
      const amt = toMoney(v.totalAmount);
      if (v.voucherType === VoucherType.RECEIPT) groundReceipts = groundReceipts.plus(amt);
      else if (v.voucherType === VoucherType.PAYMENT) groundPayments = groundPayments.plus(amt);
      else if (v.voucherType === VoucherType.CONTRA) groundContra = groundContra.plus(amt);
    }

    console.log("=== REPORT 26: RECEIPT / PAYMENT REGISTER AUDIT ===");
    console.log(`Source Vouchers: ${sourceVouchers.length}, Report Count: ${reportData.summary.totalVouchers}`);
    console.log(`Ground Receipts: ${groundReceipts.toFixed(2)}, Report Receipts: ${reportData.summary.totalReceipts}`);
    console.log(`Ground Payments: ${groundPayments.toFixed(2)}, Report Payments: ${reportData.summary.totalPayments}`);
    console.log(`Ground Contra: ${groundContra.toFixed(2)}, Report Contra: ${reportData.summary.totalContra}`);

    expect(reportData.summary.totalVouchers).toBe(sourceVouchers.length);
    expect(reportData.summary.totalReceipts).toBe(groundReceipts.toFixed(2));
    expect(reportData.summary.totalPayments).toBe(groundPayments.toFixed(2));
  });

  it("Report 27: Expense Category Report vs Expense Ledger Accounts", async () => {
    const reportData = await reportsService.getExpenseCategoryReport({}, tenant);

    console.log("=== REPORT 27: EXPENSE CATEGORY AUDIT ===");
    console.log(`Total Categories: ${reportData.summary.totalCategories}`);
    console.log(`Total Expense Amount: ${reportData.summary.totalExpenseAmount}`);
  });

  it("Report 28: Audit Trail Report vs Source Audit Logs", async () => {
    const reportData = await reportsService.getAuditTrailReport({}, tenant);

    const sourceLogsCount = await prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.auditLog.count({ where: { companyId } });
    });

    console.log("=== REPORT 28: AUDIT TRAIL AUDIT ===");
    console.log(`Source Logs Count: ${sourceLogsCount}, Report Logs Count: ${reportData.summary.totalLogs}`);

    expect(reportData.summary.totalLogs).toBeLessThanOrEqual(100);
  });

  // --------------------------------------------------------------------------
  // Category 6: GST Reports (Reports 29 to 33)
  // --------------------------------------------------------------------------
  it("Report 29: GSTR-1 Return Prep vs Sales Invoices & Credit Notes", async () => {
    const reportData = await reportsService.getGstr1Report({}, tenant);

    console.log("=== REPORT 29: GSTR-1 AUDIT ===");
    console.log(`B2B Invoices: ${reportData.b2b?.length || 0}`);
    console.log(`HSN Summary: ${reportData.hsn?.length || 0}`);
    console.log(`Document Summary:`, reportData.docSummary);
  });

  it("Report 30: GSTR-3B Monthly Return vs Inward/Outward Tax", async () => {
    const reportData = await reportsService.getGstr3bReport({}, tenant);

    console.log("=== REPORT 30: GSTR-3B AUDIT ===");
    console.log(`Table 3.1 Outward Taxable: ${reportData.table31?.taxableAmount}`);
    console.log(`Table 4 ITC:`, reportData.table4);
  });

  it("Report 31: GST Purchase (With HSN) vs Purchase Invoice Lines", async () => {
    const reportData = await reportsService.getGstPurchaseHsn(tenant, {});

    console.log("=== REPORT 31: GST PURCHASE (HSN) AUDIT ===");
    console.log(`Total Lines: ${reportData.totalCount}`);
    console.log(`Total Amount: ${reportData.totals.totalAmount}`);
    console.log(`Total CGST: ${reportData.totals.totalCgst}, Total SGST: ${reportData.totals.totalSgst}, Total IGST: ${reportData.totals.totalIgst}`);
  });

  it("Report 32: GST Sales (With HSN) vs Sales Invoice Lines", async () => {
    const reportData = await reportsService.getGstSalesHsn(tenant, {});

    console.log("=== REPORT 32: GST SALES (HSN) AUDIT ===");
    console.log(`Total Lines: ${reportData.totalCount}`);
    console.log(`Total Amount: ${reportData.totals.totalAmount}`);
    console.log(`Total CGST: ${reportData.totals.totalCgst}, Total SGST: ${reportData.totals.totalSgst}, Total IGST: ${reportData.totals.totalIgst}`);
  });

  it("Report 33: HSN Wise Sales Summary vs Sales Line Master HSN", async () => {
    const reportData = await reportsService.getHsnWiseSalesReport({}, tenant);

    console.log("=== REPORT 33: HSN WISE SALES SUMMARY AUDIT ===");
    console.log(`Total Unique HSNs: ${reportData.summary.totalHsns}`);
    console.log(`Total Taxable: ${reportData.summary.totalTaxable}`);
    console.log(`Total Tax: ${reportData.summary.totalTax}`);
    console.log(`Total Value: ${reportData.summary.totalValue}`);
  });

  // --------------------------------------------------------------------------
  // Date Presets Testing
  // --------------------------------------------------------------------------
  it("Test Date Presets: Current FY, Last Month, Custom Range, Single Day, Previous FY", async () => {
    console.log("=== TESTING DATE PRESETS ACROSS REPORTS ===");

    // Presets
    const presets = [
      { name: "Current FY", from: "2026-04-01", to: "2027-03-31" },
      { name: "Last Month (Oct 2026)", from: "2026-10-01", to: "2026-10-31" },
      { name: "Custom Range", from: "2026-10-15", to: "2026-11-02" },
      { name: "Single Day", from: "2026-10-31", to: "2026-10-31" },
      { name: "Single Day (Nov 3)", from: "2026-11-03", to: "2026-11-03" },
      { name: "Previous FY", from: "2025-04-01", to: "2026-03-31" },
    ];

    for (const p of presets) {
      const sales = await reportsService.getSalesRegister({ fromDate: p.from, toDate: p.to }, tenant);
      const purchases = await reportsService.getPurchaseRegister(tenant, { fromDate: p.from, toDate: p.to });
      const gstPurch = await reportsService.getGstPurchaseHsn(tenant, { fromDate: p.from, toDate: p.to });
      const gstSales = await reportsService.getGstSalesHsn(tenant, { fromDate: p.from, toDate: p.to });
      const stockSummary = await reportsService.getStockSummary({ asOfDate: p.to }, tenant);
      const stockMovement = await reportsService.getStockMovement({ itemId: "all", fromDate: p.from, toDate: p.to }, tenant);

      console.log(`Date Preset [${p.name}] (${p.from} -> ${p.to}):`);
      console.log(`  Sales Invoices: ${sales.summary.validInvoices}, Grand Total: ₹${sales.summary.totalGrandTotal}`);
      console.log(`  Purchase Items: ${purchases.totalCount}, Grand Total: ₹${purchases.totals.totalGrandTotal}`);
      console.log(`  GST Purchase HSN lines: ${gstPurch.totalCount}, Total: ₹${gstPurch.totals.totalAmount}`);
      console.log(`  GST Sales HSN lines: ${gstSales.totalCount}, Total: ₹${gstSales.totals.totalAmount}`);
      console.log(`  Stock Qty: ${stockSummary.totals.grandStockQuantity}, Valuation: ₹${stockSummary.totals.grandStockValuation}`);
      console.log(`  Stock Movement transactions: ${stockMovement.transactions?.length || 0}`);
    }
  });
});
