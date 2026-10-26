import { AccountNature, AccountOpeningType } from "@billing/shared-types";
import {
  Decimal,
  DecimalLike,
  toDecimal,
  toMoney,
  isNegative,
} from "./decimal";

/**
 * Returns the statutory normal balance type ("DR" or "CR") for a given account nature.
 */
export function getNormalBalanceType(
  nature: AccountNature,
): AccountOpeningType {
  switch (nature) {
    case AccountNature.ASSET:
    case AccountNature.EXPENSE:
      return "DR";
    case AccountNature.LIABILITY:
    case AccountNature.EQUITY:
    case AccountNature.INCOME:
      return "CR";
    default:
      return "DR";
  }
}

/**
 * Calculates the delta change to an account's natural balance:
 * - ASSET & EXPENSE: Debit increases (+), Credit decreases (-)
 * - LIABILITY, EQUITY & INCOME: Credit increases (+), Debit decreases (-)
 */
export function calculateNaturalBalanceDelta(
  nature: AccountNature,
  debitAmount: DecimalLike,
  creditAmount: DecimalLike,
): Decimal {
  const dr = toMoney(debitAmount);
  const cr = toMoney(creditAmount);

  if (nature === AccountNature.ASSET || nature === AccountNature.EXPENSE) {
    return dr.minus(cr);
  } else {
    return cr.minus(dr);
  }
}

/**
 * Updates an account's current natural balance given a debit and credit transaction.
 */
export function applyTransactionToBalance(
  nature: AccountNature,
  currentBalance: DecimalLike,
  debitAmount: DecimalLike,
  creditAmount: DecimalLike,
): Decimal {
  const cur = toMoney(currentBalance);
  const delta = calculateNaturalBalanceDelta(nature, debitAmount, creditAmount);
  return toMoney(cur.plus(delta));
}

/**
 * Formats a numeric balance with its appropriate Dr / Cr suffix based on its sign and nature.
 */
export function formatAccountingBalance(
  nature: AccountNature,
  balance: DecimalLike,
): { amount: string; type: "DR" | "CR" } {
  const bal = toMoney(balance);
  const normalType = getNormalBalanceType(nature);

  if (isNegative(bal)) {
    // Inverse of normal balance
    const oppositeType = normalType === "DR" ? "CR" : "DR";
    return {
      amount: bal.abs().toFixed(2),
      type: oppositeType,
    };
  }

  return {
    amount: bal.toFixed(2),
    type: normalType,
  };
}
