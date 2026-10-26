import { Decimal, DecimalLike, toDecimal, toMoney } from "./decimal";

export interface RoundOffResult {
  originalAmount: Decimal;
  roundedAmount: Decimal;
  roundOffAmount: Decimal;
}

/**
 * Calculates nearest integer Rupee rounding and the associated round-off delta for vouchers/invoices.
 * Adheres to Section 170 of the CGST Act (rounding to nearest rupee, where >= 50 paise rounds up).
 */
export function calculateRoundOff(amountInput: DecimalLike): RoundOffResult {
  const original = toMoney(amountInput);
  // Round to nearest integer (0 decimal places)
  const rounded = new Decimal(original.toFixed(0, Decimal.ROUND_HALF_UP));
  // Round-off difference is (rounded - original)
  const roundOff = toMoney(rounded.minus(original));

  return {
    originalAmount: original,
    roundedAmount: toMoney(rounded),
    roundOffAmount: roundOff,
  };
}
