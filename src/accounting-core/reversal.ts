import { JournalLineInput } from "./balance-invariants";

export interface OriginalVoucherData {
  id: string;
  voucherNumber: string;
  voucherDate: Date | string;
  narration?: string | null;
  journalEntries: Array<{
    accountId: string;
    debitAmount: any;
    creditAmount: any;
    lineNarration?: string | null;
    sequenceOrder?: number;
  }>;
}

export interface ReversalVoucherPlan {
  reversalVoucherNumber: string;
  narration: string;
  narrationGujarati?: string;
  lines: JournalLineInput[];
}

/**
 * Generates an exact contra reversal voucher plan for a posted voucher.
 * Inverts all debits to credits and credits to debits, preserving the zero-sum double-entry balance.
 */
export function buildReversalVoucherPlan(
  original: OriginalVoucherData,
  reason: string,
  customReversalNumber?: string,
): ReversalVoucherPlan {
  const reversalVoucherNumber =
    customReversalNumber || `REV-${original.voucherNumber}`;
  const narration = `Reversal of Voucher ${original.voucherNumber}: ${reason}`;
  const narrationGujarati = `વાઉચર ${original.voucherNumber} નું રિવર્સલ: ${reason}`;

  const lines: JournalLineInput[] = original.journalEntries.map(
    (entry, idx) => ({
      accountId: entry.accountId,
      // Swap debits and credits
      debitAmount: entry.creditAmount,
      creditAmount: entry.debitAmount,
      lineNarration: `Reversal: ${entry.lineNarration || "Contra correction"}`,
      sequenceOrder: entry.sequenceOrder || idx + 1,
    }),
  );

  return {
    reversalVoucherNumber,
    narration,
    narrationGujarati,
    lines,
  };
}
