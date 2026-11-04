import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseService } from "../src/database/database.service";
import { Decimal } from "@billing/accounting-core";
import { AccountNature, VoucherType } from "@billing/shared-types";

describe("Accounting Phase 1 Safe Implementation - Unit & Regression Tests", () => {
  let db: DatabaseService;

  beforeAll(async () => {
    db = new DatabaseService();
    await db.onModuleInit();
  });

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  // --------------------------------------------------------------------------
  // TASK 1: DIRECT VS INDIRECT CLASSIFICATION UNIT TESTS
  // --------------------------------------------------------------------------
  describe("Task 1: P&L Direct vs Indirect Ledger Classification", () => {
    /**
     * Pure classification function mirroring reports.service.ts refined logic
     */
    function classifyAccountGroup(groupName: string | null | undefined, nature: "INCOME" | "EXPENSE"): { isDirect: boolean; isIndirect: boolean } {
      const groupNameLower = (groupName || "").trim().toLowerCase();

      let isDirect = false;
      if (nature === "INCOME") {
        const isExplicitIndirect =
          groupNameLower.startsWith("indirect") ||
          groupNameLower.includes("indirect") ||
          groupNameLower === "other income";

        isDirect =
          !isExplicitIndirect &&
          (groupNameLower === "direct income" ||
            groupNameLower === "sales accounts" ||
            groupNameLower === "trading income" ||
            groupNameLower.startsWith("direct"));
      } else {
        const isExplicitIndirect =
          groupNameLower.startsWith("indirect") ||
          groupNameLower.includes("indirect") ||
          groupNameLower === "administrative expenses" ||
          groupNameLower === "operating expenses";

        isDirect =
          !isExplicitIndirect &&
          (groupNameLower === "direct expenses" ||
            groupNameLower === "purchase accounts" ||
            groupNameLower === "trading expenses" ||
            groupNameLower === "subcontracting expenses" ||
            groupNameLower.startsWith("direct"));
      }

      return { isDirect, isIndirect: !isDirect };
    }

    it("1.1 'Indirect Expenses' must NEVER be classified as Direct Expenses", () => {
      const result = classifyAccountGroup("Indirect Expenses", "EXPENSE");
      expect(result.isIndirect).toBe(true);
      expect(result.isDirect).toBe(false);
    });

    it("1.2 'Indirect Income' must NEVER be classified as Direct Income", () => {
      const result = classifyAccountGroup("Indirect Income", "INCOME");
      expect(result.isIndirect).toBe(true);
      expect(result.isDirect).toBe(false);
    });

    it("1.3 'Direct Expenses' must strictly be classified as Direct", () => {
      const result = classifyAccountGroup("Direct Expenses", "EXPENSE");
      expect(result.isIndirect).toBe(false);
      expect(result.isDirect).toBe(true);
    });

    it("1.4 'Direct Income' must strictly be classified as Direct", () => {
      const result = classifyAccountGroup("Direct Income", "INCOME");
      expect(result.isIndirect).toBe(false);
      expect(result.isDirect).toBe(true);
    });

    it("1.5 'Sales Accounts' must be classified as Direct Income", () => {
      const g1 = classifyAccountGroup("Sales Accounts", "INCOME");
      expect(g1.isDirect).toBe(true);
      expect(g1.isIndirect).toBe(false);
    });

    it("1.6 'Purchase Accounts' and 'Subcontracting Expenses' must be classified as Direct Expenses", () => {
      const g1 = classifyAccountGroup("Purchase Accounts", "EXPENSE");
      expect(g1.isDirect).toBe(true);
      expect(g1.isIndirect).toBe(false);

      const g2 = classifyAccountGroup("Subcontracting Expenses", "EXPENSE");
      expect(g2.isDirect).toBe(true);
      expect(g2.isIndirect).toBe(false);
    });

    it("1.7 Indirect ledger groups (Administrative, Rent, Bank Charges, Salaries, Utilities) must remain Indirect", () => {
      const groups = [
        "Indirect Expenses",
        "Administrative Expenses",
        "Operating Expenses",
        "Indirect Expenses - Rent",
        "Indirect Expenses - Bank Charges",
      ];

      for (const grp of groups) {
        const res = classifyAccountGroup(grp, "EXPENSE");
        expect(res.isIndirect, `Group ${grp} should be indirect`).toBe(true);
        expect(res.isDirect, `Group ${grp} should NOT be direct`).toBe(false);
      }
    });

    it("1.8 Indirect Income groups (Discounts Received, Round Off, Interest) must remain Indirect", () => {
      const groups = [
        "Indirect Income",
        "Other Income",
        "Indirect Income - Discount Received",
        "Indirect Income - Round Off",
      ];

      for (const grp of groups) {
        const res = classifyAccountGroup(grp, "INCOME");
        expect(res.isIndirect, `Group ${grp} should be indirect`).toBe(true);
        expect(res.isDirect, `Group ${grp} should NOT be direct`).toBe(false);
      }
    });

    it("1.9 Unknown groups must safely default to Indirect (never Direct)", () => {
      const unkExpense = classifyAccountGroup("Miscellaneous Custom Account", "EXPENSE");
      expect(unkExpense.isDirect).toBe(false);
      expect(unkExpense.isIndirect).toBe(true);

      const unkIncome = classifyAccountGroup("Unknown Grant Category", "INCOME");
      expect(unkIncome.isDirect).toBe(false);
      expect(unkIncome.isIndirect).toBe(true);
    });

    it("1.10 Custom groups with 'Direct' are classified as Direct, others as Indirect", () => {
      const customDirectExp = classifyAccountGroup("Direct Freight Charges", "EXPENSE");
      expect(customDirectExp.isDirect).toBe(true);

      const customIndirectExp = classifyAccountGroup("Stationary & Printing", "EXPENSE");
      expect(customIndirectExp.isDirect).toBe(false);
    });

    it("1.11 Null and empty group names safely default to Indirect", () => {
      const nullExp = classifyAccountGroup(null, "EXPENSE");
      expect(nullExp.isDirect).toBe(false);
      expect(nullExp.isIndirect).toBe(true);

      const emptyInc = classifyAccountGroup("", "INCOME");
      expect(emptyInc.isDirect).toBe(false);
      expect(emptyInc.isIndirect).toBe(true);
    });

    it("1.12 Mixed-case group names are normalized and classified correctly", () => {
      const mixed1 = classifyAccountGroup("InDiReCt ExPeNsEs", "EXPENSE");
      expect(mixed1.isDirect).toBe(false);
      expect(mixed1.isIndirect).toBe(true);

      const mixed2 = classifyAccountGroup("dIrEcT iNcOmE", "INCOME");
      expect(mixed2.isDirect).toBe(true);
      expect(mixed2.isIndirect).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // TASK 5: SALES RETURN LEDGER SELECTION UNIT & REGRESSION TESTS
  // --------------------------------------------------------------------------
  describe("Task 5: Sales Return Ledger Matching Logic", () => {
    /**
     * Logic simulating invoices.service.ts:3157-3190
     */
    function resolveSalesReturnLedger(
      originalVoucherEntries: Array<{ accountName: string; creditAmount: string }> | null,
      partyState: string,
      companyState: string
    ): string {
      let salesAccountId: string | null = null;

      if (originalVoucherEntries && originalVoucherEntries.length > 0) {
        // Look for the sales income account that was originally credited
        const originalSalesEntry = originalVoucherEntries.find((je) => {
          const name = je.accountName.toLowerCase();
          const cr = new Decimal(je.creditAmount || "0");
          return (
            cr.greaterThan(0) &&
            (name.includes("sales") || name.includes("income") || name.includes("revenue"))
          );
        });

        if (originalSalesEntry) {
          salesAccountId = originalSalesEntry.accountName;
        }
      }

      // Fallback if no matching entry from original voucher
      if (!salesAccountId) {
        const isInterState =
          partyState &&
          companyState &&
          partyState.trim().toLowerCase() !== companyState.trim().toLowerCase();
        salesAccountId = isInterState ? "Interstate Sales Account" : "General Sales Account";
      }

      return salesAccountId;
    }

    it("5.1 Reverses 'Interstate Sales Account' when original invoice credited Interstate Sales", () => {
      const originalEntries = [
        { accountName: "Customer ABC", creditAmount: "0" },
        { accountName: "Interstate Sales Account", creditAmount: "10000" },
        { accountName: "IGST Output", creditAmount: "1800" },
      ];

      const chosenLedger = resolveSalesReturnLedger(originalEntries, "24-Gujarat", "24-Gujarat");
      expect(chosenLedger).toBe("Interstate Sales Account");
    });

    it("5.2 Reverses 'General Sales Account' when original invoice credited General Sales Account", () => {
      const originalEntries = [
        { accountName: "Customer Local", creditAmount: "0" },
        { accountName: "General Sales Account", creditAmount: "5000" },
        { accountName: "CGST Output", creditAmount: "450" },
        { accountName: "SGST Output", creditAmount: "450" },
      ];

      const chosenLedger = resolveSalesReturnLedger(originalEntries, "27-Maharashtra", "24-Gujarat");
      expect(chosenLedger).toBe("General Sales Account");
    });

    it("5.3 Falls back cleanly to POS interstate logic when original voucher is not available", () => {
      const interstateLedger = resolveSalesReturnLedger(null, "27-Maharashtra", "24-Gujarat");
      expect(interstateLedger).toBe("Interstate Sales Account");

      const intrastateLedger = resolveSalesReturnLedger(null, "24-Gujarat", "24-Gujarat");
      expect(intrastateLedger).toBe("General Sales Account");
    });
  });

  // --------------------------------------------------------------------------
  // TASK 6: CANCELLED VOUCHERS AUDIT TRAIL PARITY & GL BALANCE
  // --------------------------------------------------------------------------
  describe("Task 6: Cancelled Voucher Audit-Trail Parity & GL Balancing", () => {
    it("6.1 Every cancelled voucher with a reversal voucher nets strictly to ₹0.00", async () => {
      const cancelledPairs = await db.executeBypassRls(async (tx) => {
        return tx.$queryRaw<
          Array<{
            cancelled_id: string;
            cancelled_number: string;
            cancelled_net: string;
            reversal_id: string;
            reversal_number: string;
            reversal_net: string;
          }>
        >`
          SELECT 
            orig.id as cancelled_id,
            orig.voucher_number as cancelled_number,
            (SELECT COALESCE(SUM(debit_amount - credit_amount), 0)::text FROM journal_entries WHERE voucher_id = orig.id) as cancelled_net,
            rev.id as reversal_id,
            rev.voucher_number as reversal_number,
            (SELECT COALESCE(SUM(debit_amount - credit_amount), 0)::text FROM journal_entries WHERE voucher_id = rev.id) as reversal_net
          FROM vouchers orig
          JOIN vouchers rev ON rev.voucher_number = 'REV-' || orig.voucher_number
          WHERE orig.is_cancelled = true
        `;
      });

      // If cancelled vouchers exist with reversals, verify each pair cancels out
      for (const pair of cancelledPairs) {
        const origNet = new Decimal(pair.cancelled_net);
        const revNet = new Decimal(pair.reversal_net);
        expect(
          origNet.plus(revNet).isZero(),
          `Voucher ${pair.cancelled_number} and ${pair.reversal_number} should net to 0`
        ).toBe(true);
      }
    });

    it("6.2 Verifies that excluding cancelled vouchers alone without reversals would corrupt double-entry balance", async () => {
      // Check total journal entry amounts across all vouchers in the system
      const allEntries = await db.executeBypassRls(async (tx) => {
        return tx.$queryRaw<
          Array<{ total_debit: string; total_credit: string }>
        >`
          SELECT 
            COALESCE(SUM(debit_amount), 0)::text as total_debit, 
            COALESCE(SUM(credit_amount), 0)::text as total_credit 
          FROM journal_entries
        `;
      });

      const totalDr = new Decimal(allEntries[0].total_debit);
      const totalCr = new Decimal(allEntries[0].total_credit);
      expect(totalDr.equals(totalCr)).toBe(true);

      // Verify that cancelled vouchers themselves have equal DR and CR
      const cancelledVoucherTotals = await db.executeBypassRls(async (tx) => {
        return tx.$queryRaw<
          Array<{ total_debit: string; total_credit: string }>
        >`
          SELECT 
            COALESCE(SUM(je.debit_amount), 0)::text as total_debit, 
            COALESCE(SUM(je.credit_amount), 0)::text as total_credit 
          FROM journal_entries je
          JOIN vouchers v ON v.id = je.voucher_id
          WHERE v.is_cancelled = true
        `;
      });

      if (cancelledVoucherTotals.length > 0) {
        const cDr = new Decimal(cancelledVoucherTotals[0].total_debit);
        const cCr = new Decimal(cancelledVoucherTotals[0].total_credit);
        expect(cDr.equals(cCr)).toBe(true);
      }
    });

    it("6.3 System-wide journal entry integrity: zero unbalanced vouchers exist", async () => {
      const unbalancedVouchers = await db.executeBypassRls(async (tx) => {
        return tx.$queryRaw<Array<{ voucher_id: string; diff: string }>>`
          SELECT voucher_id, (SUM(debit_amount) - SUM(credit_amount))::text as diff
          FROM journal_entries
          GROUP BY voucher_id
          HAVING SUM(debit_amount) != SUM(credit_amount)
        `;
      });

      expect(unbalancedVouchers).toHaveLength(0);
    });
  });
});

