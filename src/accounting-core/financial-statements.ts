import { AccountNature } from "@billing/shared-types";
import {
  Decimal,
  DecimalLike,
  toDecimal,
  toMoney,
  isZero,
  isPositive,
} from "./decimal";

export interface TrialBalanceItemInput {
  accountId: string;
  accountName: string;
  accountCode?: string | null;
  nature: AccountNature;
  groupName: string;
  openingDebit: DecimalLike;
  openingCredit: DecimalLike;
  periodDebit: DecimalLike;
  periodCredit: DecimalLike;
  closingDebit: DecimalLike;
  closingCredit: DecimalLike;
}

export interface TrialBalanceCalculationResult {
  totalOpeningDebit: string;
  totalOpeningCredit: string;
  totalPeriodDebit: string;
  totalPeriodCredit: string;
  totalClosingDebit: string;
  totalClosingCredit: string;
  isBalanced: boolean;
  difference: string;
}

/**
 * Validates and calculates grand totals for a Trial Balance.
 * Statutory Invariant: Total Closing Debits MUST EXACTLY equal Total Closing Credits.
 */
export function calculateTrialBalanceTotals(
  items: TrialBalanceItemInput[],
): TrialBalanceCalculationResult {
  let totalOpeningDr = new Decimal(0);
  let totalOpeningCr = new Decimal(0);
  let totalPeriodDr = new Decimal(0);
  let totalPeriodCr = new Decimal(0);
  let totalClosingDr = new Decimal(0);
  let totalClosingCr = new Decimal(0);

  for (const item of items) {
    totalOpeningDr = totalOpeningDr.plus(toMoney(item.openingDebit || 0));
    totalOpeningCr = totalOpeningCr.plus(toMoney(item.openingCredit || 0));
    totalPeriodDr = totalPeriodDr.plus(toMoney(item.periodDebit || 0));
    totalPeriodCr = totalPeriodCr.plus(toMoney(item.periodCredit || 0));
    totalClosingDr = totalClosingDr.plus(toMoney(item.closingDebit || 0));
    totalClosingCr = totalClosingCr.plus(toMoney(item.closingCredit || 0));
  }

  const diff = totalClosingDr.minus(totalClosingCr).abs();
  const isBalanced = isZero(diff);

  return {
    totalOpeningDebit: totalOpeningDr.toFixed(2),
    totalOpeningCredit: totalOpeningCr.toFixed(2),
    totalPeriodDebit: totalPeriodDr.toFixed(2),
    totalPeriodCredit: totalPeriodCr.toFixed(2),
    totalClosingDebit: totalClosingDr.toFixed(2),
    totalClosingCredit: totalClosingCr.toFixed(2),
    isBalanced,
    difference: diff.toFixed(2),
  };
}

export interface ProfitAndLossInput {
  directIncome: DecimalLike;
  directExpenses: DecimalLike;
  indirectIncome: DecimalLike;
  indirectExpenses: DecimalLike;
}

export interface ProfitAndLossResult {
  directIncome: string;
  directExpenses: string;
  grossProfit: string;
  isGrossLoss: boolean;
  indirectIncome: string;
  indirectExpenses: string;
  netProfit: string;
  isNetLoss: boolean;
}

/**
 * Calculates Profit & Loss (Nafanuksan Khatun) using exact Decimal arithmetic.
 * Gross Profit = Direct Income - Direct Expenses
 * Net Profit = Gross Profit + Indirect Income - Indirect Expenses
 */
export function calculateProfitAndLoss(
  input: ProfitAndLossInput,
): ProfitAndLossResult {
  const dInc = toMoney(input.directIncome || 0);
  const dExp = toMoney(input.directExpenses || 0);
  const iInc = toMoney(input.indirectIncome || 0);
  const iExp = toMoney(input.indirectExpenses || 0);

  const grossProfit = dInc.minus(dExp);
  const netProfit = grossProfit.plus(iInc).minus(iExp);

  return {
    directIncome: dInc.toFixed(2),
    directExpenses: dExp.toFixed(2),
    grossProfit: grossProfit.toFixed(2),
    isGrossLoss: grossProfit.isNegative(),
    indirectIncome: iInc.toFixed(2),
    indirectExpenses: iExp.toFixed(2),
    netProfit: netProfit.toFixed(2),
    isNetLoss: netProfit.isNegative(),
  };
}

export interface BalanceSheetInput {
  totalAssets: DecimalLike;
  totalLiabilities: DecimalLike;
  totalEquity: DecimalLike;
  netProfitOrLoss: DecimalLike;
}

export interface BalanceSheetResult {
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  netProfitOrLoss: string;
  totalLiabilitiesAndEquity: string;
  isBalanced: boolean;
  difference: string;
}

/**
 * Validates Balance Sheet (Paku Sarvaiyu) arithmetic invariance.
 * Assets = Liabilities + Equity + Net Profit (or - Net Loss)
 */
export function calculateBalanceSheetTotals(
  input: BalanceSheetInput,
): BalanceSheetResult {
  const assets = toMoney(input.totalAssets || 0);
  const liabilities = toMoney(input.totalLiabilities || 0);
  const equity = toMoney(input.totalEquity || 0);
  const netProfit = toMoney(input.netProfitOrLoss || 0);

  const liabAndEquity = liabilities.plus(equity).plus(netProfit);
  const diff = assets.minus(liabAndEquity).abs();
  const isBalanced = isZero(diff);

  return {
    totalAssets: assets.toFixed(2),
    totalLiabilities: liabilities.toFixed(2),
    totalEquity: equity.toFixed(2),
    netProfitOrLoss: netProfit.toFixed(2),
    totalLiabilitiesAndEquity: liabAndEquity.toFixed(2),
    isBalanced,
    difference: diff.toFixed(2),
  };
}

export interface InvoiceAgingItem {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date | string;
  dueDate?: Date | string | null;
  grandTotal: DecimalLike;
  balanceAmount: DecimalLike;
  creditDays?: number;
}

export interface PartyAgingResult {
  totalOutstanding: string;
  notDue: string;
  overdue0to30: string;
  overdue31to60: string;
  overdue61to90: string;
  overdue90Plus: string;
  overdueDaysMax: number;
  accruedInterest: string;
}

/**
 * Calculates receivable/payable aging buckets and statutory/contractual interest for a party.
 */
export function calculatePartyAging(
  invoices: InvoiceAgingItem[],
  annualInterestRate: DecimalLike = 0,
  asOfDate: Date | string = new Date(),
): PartyAgingResult {
  const asOf = new Date(asOfDate);
  let totalBal = new Decimal(0);
  let notDue = new Decimal(0);
  let b0to30 = new Decimal(0);
  let b31to60 = new Decimal(0);
  let b61to90 = new Decimal(0);
  let b90Plus = new Decimal(0);
  let maxOverdueDays = 0;
  let totalAccruedInterest = new Decimal(0);

  const intRate = toDecimal(annualInterestRate || 0);

  for (const inv of invoices) {
    const bal = toMoney(inv.balanceAmount || 0);
    if (!isPositive(bal)) {
      continue;
    }
    totalBal = totalBal.plus(bal);

    let effectiveDueDate: Date;
    if (inv.dueDate) {
      effectiveDueDate = new Date(inv.dueDate);
    } else {
      const invDate = new Date(inv.invoiceDate);
      const days = inv.creditDays || 0;
      effectiveDueDate = new Date(
        invDate.getTime() + days * 24 * 60 * 60 * 1000,
      );
    }

    const diffMs = asOf.getTime() - effectiveDueDate.getTime();
    const overdueDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    if (overdueDays > maxOverdueDays) {
      maxOverdueDays = overdueDays;
    }

    if (overdueDays === 0) {
      notDue = notDue.plus(bal);
    } else if (overdueDays <= 30) {
      b0to30 = b0to30.plus(bal);
    } else if (overdueDays <= 60) {
      b31to60 = b31to60.plus(bal);
    } else if (overdueDays <= 90) {
      b61to90 = b61to90.plus(bal);
    } else {
      b90Plus = b90Plus.plus(bal);
    }

    // Accrued interest: Balance * (Interest Rate / 100) * (Overdue Days / 365)
    if (overdueDays > 0 && isPositive(intRate)) {
      const interest = bal
        .times(intRate.dividedBy(100))
        .times(overdueDays)
        .dividedBy(365);
      totalAccruedInterest = totalAccruedInterest.plus(interest);
    }
  }

  return {
    totalOutstanding: totalBal.toFixed(2),
    notDue: notDue.toFixed(2),
    overdue0to30: b0to30.toFixed(2),
    overdue31to60: b31to60.toFixed(2),
    overdue61to90: b61to90.toFixed(2),
    overdue90Plus: b90Plus.toFixed(2),
    overdueDaysMax: maxOverdueDays,
    accruedInterest: toMoney(totalAccruedInterest).toFixed(2),
  };
}

/**
 * Formats a monetary value to the Indian numbering system: ₹12,34,567.89
 */
export function formatCurrencyIndian(amount: DecimalLike): string {
  const dec = toMoney(amount);
  const parts = dec.toFixed(2).split(".");
  let intPart = parts[0];
  const decPart = parts[1];

  const isNeg = intPart.startsWith("-");
  if (isNeg) {
    intPart = intPart.substring(1);
  }

  if (intPart.length > 3) {
    const last3 = intPart.substring(intPart.length - 3);
    const rest = intPart.substring(0, intPart.length - 3);
    intPart = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }

  return (isNeg ? "-" : "") + intPart + "." + decPart;
}
