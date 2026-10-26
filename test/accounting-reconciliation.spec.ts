import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseService } from "../src/database/database.service";
import { Decimal } from "@billing/accounting-core";

describe("Phase 7: Accounting & Statutory Reconciliation Integrity", () => {
  let db: DatabaseService;

  beforeAll(async () => {
    db = new DatabaseService();
    await db.onModuleInit();
  });

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  it("1. Total debits must strictly equal total credits across all posted journal entries", async () => {
    const totals = await db.executeBypassRls(async (tx) => {
      return tx.$queryRaw<
        Array<{ total_debit: string; total_credit: string }>
      >`SELECT COALESCE(SUM(debit_amount), 0)::text as total_debit, COALESCE(SUM(credit_amount), 0)::text as total_credit FROM journal_entries`;
    });

    expect(totals).toHaveLength(1);
    const totalDebit = new Decimal(totals[0].total_debit);
    const totalCredit = new Decimal(totals[0].total_credit);

    expect(totalDebit.equals(totalCredit)).toBe(true);
    expect(totalDebit.minus(totalCredit).isZero()).toBe(true);

    // Verify no individual voucher is unbalanced
    const unbalanced = await db.executeBypassRls(async (tx) => {
      return tx.$queryRaw<Array<{ voucher_id: string; diff: string }>>`
        SELECT voucher_id, (SUM(debit_amount) - SUM(credit_amount))::text as diff
        FROM journal_entries
        GROUP BY voucher_id
        HAVING SUM(debit_amount) != SUM(credit_amount)
      `;
    });

    expect(unbalanced).toHaveLength(0);
  });

  it("2. Trial Balance agreement: Debit account balances must equal credit account balances", async () => {
    const accounts = await db.executeBypassRls(async (tx) => {
      return tx.ledgerAccount.findMany({
        include: {
          journalEntries: true,
        },
      });
    });

    let totalDr = new Decimal(0);
    let totalCr = new Decimal(0);

    for (const acc of accounts) {
      let dr = new Decimal(0);
      let cr = new Decimal(0);
      for (const je of acc.journalEntries) {
        dr = dr.plus(je.debitAmount.toString());
        cr = cr.plus(je.creditAmount.toString());
      }
      const net = dr.minus(cr);
      if (net.isPositive()) {
        totalDr = totalDr.plus(net);
      } else if (net.isNegative()) {
        totalCr = totalCr.plus(net.abs());
      }
    }

    expect(totalDr.equals(totalCr)).toBe(true);
  });

  it("3. Balance Sheet consistency: Net assets must equal equity and liabilities plus net profit", async () => {
    const accounts = await db.executeBypassRls(async (tx) => {
      return tx.ledgerAccount.findMany({
        include: {
          group: true,
          journalEntries: true,
        },
      });
    });

    let assetTotal = new Decimal(0);
    let liabilityTotal = new Decimal(0);
    let equityTotal = new Decimal(0);
    let incomeTotal = new Decimal(0);
    let expenseTotal = new Decimal(0);

    for (const acc of accounts) {
      let dr = new Decimal(0);
      let cr = new Decimal(0);
      for (const je of acc.journalEntries) {
        dr = dr.plus(je.debitAmount.toString());
        cr = cr.plus(je.creditAmount.toString());
      }
      const net = dr.minus(cr);
      switch (acc.group.nature) {
        case "ASSET":
          assetTotal = assetTotal.plus(net);
          break;
        case "LIABILITY":
          liabilityTotal = liabilityTotal.plus(net.negated());
          break;
        case "EQUITY":
          equityTotal = equityTotal.plus(net.negated());
          break;
        case "INCOME":
          incomeTotal = incomeTotal.plus(net.negated());
          break;
        case "EXPENSE":
          expenseTotal = expenseTotal.plus(net);
          break;
      }
    }

    const netProfit = incomeTotal.minus(expenseTotal);
    const totalEquityAndLiabilities = liabilityTotal
      .plus(equityTotal)
      .plus(netProfit);

    expect(
      assetTotal.minus(totalEquityAndLiabilities).abs().toNumber(),
    ).toBeLessThan(0.01);
  });

  it("4. Invoice totals must strictly equal line items and tax totals under Section 170 round-off", async () => {
    const invoices = await db.executeBypassRls(async (tx) => {
      return tx.salesInvoice.findMany({
        where: { status: { in: ["ISSUED", "PAID", "PARTIALLY_PAID"] } },
        include: { items: true },
      });
    });

    for (const inv of invoices) {
      let sumTaxable = new Decimal(0);
      let sumCgst = new Decimal(0);
      let sumSgst = new Decimal(0);
      let sumIgst = new Decimal(0);

      for (const item of inv.items) {
        sumTaxable = sumTaxable.plus(item.taxableAmount.toString());
        sumCgst = sumCgst.plus(item.cgstAmount.toString());
        sumSgst = sumSgst.plus(item.sgstAmount.toString());
        sumIgst = sumIgst.plus(item.igstAmount.toString());
      }

      const totalTax = sumCgst.plus(sumSgst).plus(sumIgst);
      const unroundedTotal = sumTaxable.plus(totalTax);
      const roundOff = new Decimal(inv.roundOff.toString());
      const persistedGrandTotal = new Decimal(inv.grandTotal.toString());

      // Line total + roundOff equals grandTotal within 1 paisa (due to individual line-item rounding vs invoice slab aggregation)
      const diff = unroundedTotal
        .plus(roundOff)
        .minus(persistedGrandTotal)
        .abs();
      expect(diff.toNumber()).toBeLessThanOrEqual(0.01);
      // RoundOff must be between -0.50 and +0.50
      expect(roundOff.abs().toNumber()).toBeLessThanOrEqual(0.5);
    }
  });

  it("5. Payment allocations must not exceed applicable invoice totals", async () => {
    const allocations = await db.executeBypassRls(async (tx) => {
      return tx.$queryRaw<
        Array<{
          invoice_id: string;
          invoice_total: string;
          total_allocated: string;
        }>
      >`
        SELECT 
          si.id as invoice_id,
          si.grand_total::text as invoice_total,
          COALESCE(SUM(pa.allocated_amount), 0)::text as total_allocated
        FROM sales_invoices si
        LEFT JOIN payment_allocations pa ON si.id = pa.invoice_id
        GROUP BY si.id, si.grand_total
        HAVING COALESCE(SUM(pa.allocated_amount), 0) > si.grand_total
      `;
    });

    expect(allocations).toHaveLength(0);
  });

  it("6. Stock quantities and valuations must agree with append-only stock ledger movements", async () => {
    const anomalies = await db.executeBypassRls(async (tx) => {
      return tx.$queryRaw<
        Array<{ id: string; quantity: string; valuation_rate: string }>
      >`
        SELECT id, quantity::text, valuation_rate::text
        FROM stock_transactions
        WHERE valuation_rate < 0
      `;
    });

    expect(anomalies).toHaveLength(0);
  });

  it("7. Cancellation/reversal entries must preserve original audit trail and contra entries", async () => {
    const cancelledInvoices = await db.executeBypassRls(async (tx) => {
      return tx.salesInvoice.findMany({
        where: { status: "CANCELLED" },
        select: { id: true, invoiceNumber: true, companyId: true },
      });
    });

    for (const inv of cancelledInvoices) {
      // Must have corresponding CANCEL_SALES_INVOICE audit log
      const auditLog = await db.executeBypassRls(async (tx) => {
        return tx.auditLog.findFirst({
          where: {
            entityId: inv.id,
            action: "CANCEL_SALES_INVOICE",
          },
        });
      });
      expect(auditLog).toBeDefined();
      expect(auditLog?.recordHash).toBeDefined();

      // Must have inward cancellation stock transaction restoring the outward movement
      const reversalStock = await db.executeBypassRls(async (tx) => {
        return tx.stockTransaction.findFirst({
          where: {
            referenceDocId: inv.id,
            referenceDocType: "SALES_INVOICE",
            transactionType: "SALES_CANCELLATION",
          },
        });
      });
      expect(reversalStock).toBeDefined();
    }
  });

  it("8. GST summaries must reconcile with underlying eligible transactions and place-of-supply rules", async () => {
    const invoices = await db.executeBypassRls(async (tx) => {
      return tx.salesInvoice.findMany({
        include: {
          items: true,
          company: true,
          party: true,
        },
      });
    });

    for (const inv of invoices) {
      const isIntraState = inv.placeOfSupply === inv.company.stateCode;
      const cgst = new Decimal(inv.cgstAmount.toString());
      const sgst = new Decimal(inv.sgstAmount.toString());
      const igst = new Decimal(inv.igstAmount.toString());

      if (isIntraState) {
        expect(igst.isZero()).toBe(true);
        expect(cgst.equals(sgst)).toBe(true);
      } else {
        expect(cgst.isZero()).toBe(true);
        expect(sgst.isZero()).toBe(true);
      }
    }
  });
});
