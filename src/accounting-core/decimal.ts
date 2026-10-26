import { Prisma } from "@billing/database";

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
export type DecimalLike = Prisma.Decimal | string | number;

/**
 * Converts any numeric, string, or Decimal representation to an exact Decimal instance.
 */
export function toDecimal(value: DecimalLike): Decimal {
  if (value instanceof Decimal) {
    return value;
  }
  return new Decimal(value.toString());
}

/**
 * Rounds a Decimal to exactly 2 decimal places using standard half-up rounding for INR monetary currency.
 */
export function toMoney(value: DecimalLike): Decimal {
  const d = toDecimal(value);
  return new Decimal(d.toFixed(2, Decimal.ROUND_HALF_UP));
}

/**
 * Checks if a value is strictly zero (0.00).
 */
export function isZero(value: DecimalLike): boolean {
  return toDecimal(value).isZero();
}

/**
 * Checks if a value is strictly positive (> 0.00).
 */
export function isPositive(value: DecimalLike): boolean {
  return toDecimal(value).greaterThan(0);
}

/**
 * Checks if a value is negative (< 0.00).
 */
export function isNegative(value: DecimalLike): boolean {
  return toDecimal(value).lessThan(0);
}

/**
 * Sums an array of Decimal values with exact precision.
 */
export function sumDecimals(values: DecimalLike[]): Decimal {
  return values.reduce<Decimal>(
    (acc, cur) => acc.plus(toDecimal(cur)),
    new Decimal(0),
  );
}
