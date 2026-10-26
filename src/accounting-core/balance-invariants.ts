import {
  Decimal,
  DecimalLike,
  toDecimal,
  toMoney,
  isZero,
  isPositive,
  isNegative,
} from "./decimal";

export interface JournalLineInput {
  accountId: string;
  debitAmount: DecimalLike;
  creditAmount: DecimalLike;
  lineNarration?: string | null;
  sequenceOrder?: number;
}

export interface BalanceValidationResult {
  isValid: boolean;
  isBalanced: boolean;
  totalDebit: Decimal;
  totalCredit: Decimal;
  difference: Decimal;
  errors: string[];
}

/**
 * Validates double-entry invariants on voucher journal lines:
 * 1. Must contain at least two entries (one debit and one credit).
 * 2. No negative amounts in debit or credit.
 * 3. No line with both debit > 0 and credit > 0.
 * 4. No zero-value lines (both debit and credit are zero).
 * 5. Total debits must equal total credits exactly (zero-sum balance).
 */
export function validateJournalLines(
  lines: JournalLineInput[],
): BalanceValidationResult {
  const errors: string[] = [];

  if (!lines || lines.length < 2) {
    errors.push(
      "A double-entry voucher must contain at least two journal lines.",
    );
  }

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  let hasDebit = false;
  let hasCredit = false;

  for (let i = 0; i < (lines || []).length; i++) {
    const line = lines[i];
    const lineIdx = i + 1;

    if (!line.accountId || line.accountId.trim() === "") {
      errors.push(`Line ${lineIdx}: Ledger account ID is required.`);
    }

    let dr: Decimal;
    let cr: Decimal;

    try {
      dr = toMoney(line.debitAmount || 0);
      cr = toMoney(line.creditAmount || 0);
    } catch {
      errors.push(
        `Line ${lineIdx}: Invalid decimal format for debit or credit amount.`,
      );
      continue;
    }

    if (isNegative(dr)) {
      errors.push(`Line ${lineIdx}: Debit amount cannot be negative.`);
    }

    if (isNegative(cr)) {
      errors.push(`Line ${lineIdx}: Credit amount cannot be negative.`);
    }

    if (isZero(dr) && isZero(cr)) {
      errors.push(
        `Line ${lineIdx}: Journal line cannot have zero debit and zero credit.`,
      );
    }

    if (isPositive(dr) && isPositive(cr)) {
      errors.push(
        `Line ${lineIdx}: A single journal line cannot contain both debit and credit amounts.`,
      );
    }

    if (isPositive(dr)) {
      hasDebit = true;
      totalDebit = totalDebit.plus(dr);
    }

    if (isPositive(cr)) {
      hasCredit = true;
      totalCredit = totalCredit.plus(cr);
    }
  }

  if (!hasDebit) {
    errors.push("Voucher must contain at least one debit line.");
  }

  if (!hasCredit) {
    errors.push("Voucher must contain at least one credit line.");
  }

  totalDebit = toMoney(totalDebit);
  totalCredit = toMoney(totalCredit);
  const difference = toMoney(totalDebit.minus(totalCredit).abs());
  const isBalanced = totalDebit.equals(totalCredit);

  if (!isBalanced) {
    errors.push(
      `Unbalanced voucher: Total Debits (₹${totalDebit.toFixed(2)}) must equal Total Credits (₹${totalCredit.toFixed(2)}). Difference is ₹${difference.toFixed(2)}.`,
    );
  }

  return {
    isValid: errors.length === 0,
    isBalanced,
    totalDebit,
    totalCredit,
    difference,
    errors,
  };
}
