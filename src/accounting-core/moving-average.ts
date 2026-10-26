import { Decimal, DecimalLike } from "./decimal";

/**
 * Moving weighted-average cost for one warehouse.
 *
 * On-hand value is the signed sum of movement values. A positive quantity
 * adds its absolute value; a negative quantity subtracts it. An issue takes
 * value = quantity × (on-hand value / on-hand quantity).
 *
 * Negative stock policy: the quantity covered by on-hand stock uses the
 * average. Any excess is provisional and must use an explicit master
 * purchase rate supplied by the caller. This module never invents a rate.
 */
export interface MovingAverageIssue {
  rate: Decimal;
  value: Decimal;
  provisionalQuantity: Decimal;
  provisionalValue: Decimal;
}

export function signedMovementValue(
  quantity: DecimalLike,
  totalValuation: DecimalLike,
): Decimal {
  const qty = new Decimal(quantity);
  const abs = new Decimal(totalValuation).abs();
  return qty.isNegative() ? abs.negated() : abs;
}

export function costMovingAverageIssue(input: {
  onHandQuantity: DecimalLike;
  onHandValue: DecimalLike;
  issueQuantity: DecimalLike;
  provisionalRate?: DecimalLike | null;
}): MovingAverageIssue {
  const onHandQty = new Decimal(input.onHandQuantity);
  const onHandValue = new Decimal(input.onHandValue);
  const issueQty = new Decimal(input.issueQuantity);
  if (issueQty.lte(0)) {
    throw new Error("Issue quantity must be greater than zero.");
  }

  const covered = Decimal.min(Decimal.max(onHandQty, 0), issueQty);
  const excess = issueQty.minus(covered);
  let coveredValue = new Decimal(0);
  let coveredRate = new Decimal(0);
  if (covered.gt(0)) {
    if (onHandValue.lte(0)) {
      throw new Error(
        "On-hand stock has no recorded cost, so a moving-average issue cannot be valued.",
      );
    }
    coveredRate = onHandValue.div(onHandQty);
    coveredValue = coveredRate.mul(covered);
  }

  let provisionalValue = new Decimal(0);
  let provisionalRate = new Decimal(0);
  if (excess.gt(0)) {
    if (input.provisionalRate == null) {
      throw new Error(
        "This issue exceeds valued on-hand stock and the item has no purchase rate to use as a provisional cost.",
      );
    }
    provisionalRate = new Decimal(input.provisionalRate);
    if (provisionalRate.lte(0)) {
      throw new Error(
        "This issue exceeds valued on-hand stock and the item purchase rate is zero.",
      );
    }
    provisionalValue = provisionalRate.mul(excess);
  }

  const value = coveredValue.plus(provisionalValue);
  const rate = value.div(issueQty);
  return {
    rate,
    value,
    provisionalQuantity: excess,
    provisionalValue,
  };
}
