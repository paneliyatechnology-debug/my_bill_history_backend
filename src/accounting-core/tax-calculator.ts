import { Decimal, DecimalLike, toMoney, toDecimal } from "./decimal";
import { calculateRoundOff } from "./rounding";
import { amountToWordsEnglish, amountToWordsGujarati } from "./number-to-words";

export type SupplyCategory = "TAXABLE" | "NIL_RATED" | "EXEMPT" | "NON_GST";

/**
 * Union territories without a legislature use CGST + UTGST for intra-UT supplies.
 * Delhi (07), Puducherry (34) and Jammu & Kashmir (01) have legislatures and use SGST.
 * Source: GST state codes and Section 2(8) of the UTGST Act. Confirm with a CA if a later notification changes a code.
 */
export const UNION_TERRITORIES_WITHOUT_LEGISLATURE = new Set([
  "04",
  "26",
  "31",
  "35",
  "38",
]);

export function isUtgstTerritory(stateCode: string): boolean {
  return UNION_TERRITORIES_WITHOUT_LEGISLATURE.has(stateCode.trim());
}

export interface InvoiceItemCalculationInput {
  itemId: string;
  quantity: DecimalLike;
  unitPrice: DecimalLike;
  discountPercent?: DecimalLike;
  discountAmount?: DecimalLike;
  taxRate: DecimalLike; // e.g. 5.0, 12.0, 18.0, 28.0
  cessRate?: DecimalLike;
  isTaxInclusive?: boolean;
  supplyCategory?: SupplyCategory;
}

export interface CalculatedInvoiceItem {
  itemId: string;
  quantity: Decimal;
  unitPrice: Decimal;
  subTotal: Decimal; // quantity * unitPrice
  discountPercent: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  taxRate: Decimal;
  cgstRate: Decimal;
  cgstAmount: Decimal;
  sgstRate: Decimal;
  sgstAmount: Decimal;
  igstRate: Decimal;
  igstAmount: Decimal;
  utgstRate: Decimal;
  utgstAmount: Decimal;
  cessAmount: Decimal;
  supplyCategory: SupplyCategory;
  totalAmount: Decimal;
}

export interface InvoiceAdditionalChargeInput {
  name?: string;
  amount: DecimalLike;
  taxRate?: DecimalLike;
}

export interface InvoiceTaxCalculationOptions {
  discountType?: "BEFORE_TAX" | "AFTER_TAX";
  discountPercent?: DecimalLike;
  discountAmount?: DecimalLike;
  additionalCharges?: InvoiceAdditionalChargeInput[];
}

export interface CalculatedInvoiceTotals {
  isIntraState: boolean;
  subTotal: Decimal;
  discountTotal: Decimal;
  billDiscount: Decimal;
  chargesTotal: Decimal;
  taxableAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  igstAmount: Decimal;
  utgstAmount: Decimal;
  cessAmount: Decimal;
  roundOff: Decimal;
  grandTotal: Decimal;
  grandTotalWords: string;
  grandTotalWordsGujarati: string;
  items: CalculatedInvoiceItem[];
}

/**
 * Pure deterministic Statutory Indian GST invoice tax calculation engine.
 */
export function calculateSalesInvoiceTaxes(
  companyStateCode: string,
  placeOfSupply: string,
  itemsInput: InvoiceItemCalculationInput[],
  options?: InvoiceTaxCalculationOptions,
): CalculatedInvoiceTotals {
  const isIntraState = companyStateCode.trim() === placeOfSupply.trim();
  const useUtgst = isIntraState && isUtgstTerritory(placeOfSupply);

  // 1. Initial pass: Calculate line subtotal, line discount, and line base taxable
  const preCalculatedLines = itemsInput.map((item) => {
    const qty = toDecimal(item.quantity);
    const price = toDecimal(item.unitPrice);
    const supplyCategory: SupplyCategory = item.supplyCategory ?? "TAXABLE";
    const taxRate =
      supplyCategory === "TAXABLE" ? toDecimal(item.taxRate) : new Decimal(0);
    const lineSubTotal = toMoney(qty.times(price));

    let discPercent = toDecimal(item.discountPercent ?? 0);
    let discAmount = toMoney(item.discountAmount ?? 0);

    if (discPercent.greaterThan(0) && discAmount.isZero()) {
      discAmount = toMoney(lineSubTotal.times(discPercent).dividedBy(100));
    } else if (
      discAmount.greaterThan(0) &&
      discPercent.isZero() &&
      lineSubTotal.greaterThan(0)
    ) {
      discPercent = toDecimal(
        discAmount.dividedBy(lineSubTotal).times(100).toFixed(2),
      );
    }

    let baseTaxable: Decimal;
    if (item.isTaxInclusive) {
      const grossAfterDisc = lineSubTotal.minus(discAmount);
      // Taxable = gross / (1 + taxRate/100)
      const divisor = new Decimal(1).plus(taxRate.dividedBy(100));
      baseTaxable = toMoney(grossAfterDisc.dividedBy(divisor));
    } else {
      baseTaxable = toMoney(lineSubTotal.minus(discAmount));
    }

    return {
      item,
      qty,
      price,
      supplyCategory,
      taxRate,
      lineSubTotal,
      discPercent,
      discAmount,
      baseTaxable,
    };
  });

  const totalBaseTaxable = preCalculatedLines.reduce(
    (sum, l) => sum.plus(l.baseTaxable),
    new Decimal(0),
  );

  const discountType = options?.discountType ?? "AFTER_TAX";
  const optDiscPercent = toDecimal(options?.discountPercent ?? 0);
  const optDiscAmount = toMoney(options?.discountAmount ?? 0);

  // Bill discount for BEFORE_TAX (Trade discount under CGST Act Section 15(3))
  let billDiscount = new Decimal(0);
  if (discountType === "BEFORE_TAX") {
    if (optDiscAmount.greaterThan(0)) {
      billDiscount = Decimal.min(totalBaseTaxable, optDiscAmount);
    } else if (optDiscPercent.greaterThan(0) && totalBaseTaxable.greaterThan(0)) {
      billDiscount = toMoney(totalBaseTaxable.times(optDiscPercent).dividedBy(100));
    }
  }

  // 2. Compute lines with proportional BEFORE_TAX discount distribution
  let invoiceSubTotal = new Decimal(0);
  let invoiceLineDiscountTotal = new Decimal(0);
  let invoiceTaxableAmount = new Decimal(0);
  let invoiceCgstAmount = new Decimal(0);
  let invoiceSgstAmount = new Decimal(0);
  let invoiceIgstAmount = new Decimal(0);
  let invoiceUtgstAmount = new Decimal(0);
  let invoiceCessAmount = new Decimal(0);

  let allocatedBillDiscountSum = new Decimal(0);

  const calculatedItems: CalculatedInvoiceItem[] = preCalculatedLines.map((line, idx) => {
    let taxable = line.baseTaxable;

    if (
      discountType === "BEFORE_TAX" &&
      billDiscount.greaterThan(0) &&
      totalBaseTaxable.greaterThan(0)
    ) {
      let itemBillDisc: Decimal;
      if (idx === preCalculatedLines.length - 1) {
        // Last line absorbs rounding difference
        itemBillDisc = toMoney(billDiscount.minus(allocatedBillDiscountSum));
      } else {
        const ratio = line.baseTaxable.dividedBy(totalBaseTaxable);
        itemBillDisc = toMoney(billDiscount.times(ratio));
        allocatedBillDiscountSum = allocatedBillDiscountSum.plus(itemBillDisc);
      }
      taxable = toMoney(Decimal.max(0, line.baseTaxable.minus(itemBillDisc)));
    }

    let cgstRate = new Decimal(0);
    let cgstAmount = new Decimal(0);
    let sgstRate = new Decimal(0);
    let sgstAmount = new Decimal(0);
    let igstRate = new Decimal(0);
    let igstAmount = new Decimal(0);
    let utgstRate = new Decimal(0);
    let utgstAmount = new Decimal(0);

    if (isIntraState) {
      const halfRate = toDecimal(line.taxRate.dividedBy(2).toFixed(2));
      cgstRate = halfRate;
      cgstAmount = toMoney(taxable.times(cgstRate).dividedBy(100));
      if (useUtgst) {
        utgstRate = halfRate;
        utgstAmount = toMoney(taxable.times(utgstRate).dividedBy(100));
      } else {
        sgstRate = halfRate;
        sgstAmount = toMoney(taxable.times(sgstRate).dividedBy(100));
      }
    } else {
      igstRate = line.taxRate;
      igstAmount = toMoney(taxable.times(igstRate).dividedBy(100));
    }

    const cessRate = toDecimal(line.item.cessRate ?? 0);
    const cessAmount = toMoney(taxable.times(cessRate).dividedBy(100));

    const lineTotal = toMoney(
      taxable
        .plus(cgstAmount)
        .plus(sgstAmount)
        .plus(igstAmount)
        .plus(utgstAmount)
        .plus(cessAmount),
    );

    invoiceSubTotal = invoiceSubTotal.plus(line.lineSubTotal);
    invoiceLineDiscountTotal = invoiceLineDiscountTotal.plus(line.discAmount);
    invoiceTaxableAmount = invoiceTaxableAmount.plus(taxable);
    invoiceCgstAmount = invoiceCgstAmount.plus(cgstAmount);
    invoiceSgstAmount = invoiceSgstAmount.plus(sgstAmount);
    invoiceIgstAmount = invoiceIgstAmount.plus(igstAmount);
    invoiceUtgstAmount = invoiceUtgstAmount.plus(utgstAmount);
    invoiceCessAmount = invoiceCessAmount.plus(cessAmount);

    return {
      itemId: line.item.itemId,
      quantity: line.qty,
      unitPrice: line.price,
      subTotal: line.lineSubTotal,
      discountPercent: line.discPercent,
      discountAmount: line.discAmount,
      taxableAmount: taxable,
      taxRate: line.taxRate,
      cgstRate,
      cgstAmount,
      sgstRate,
      sgstAmount,
      igstRate,
      igstAmount,
      utgstRate,
      utgstAmount,
      cessAmount,
      supplyCategory: line.supplyCategory,
      totalAmount: lineTotal,
    };
  });

  const taxesTotal = invoiceCgstAmount
    .plus(invoiceSgstAmount)
    .plus(invoiceIgstAmount)
    .plus(invoiceUtgstAmount)
    .plus(invoiceCessAmount);

  // Compute AFTER_TAX bill discount if applicable
  if (discountType === "AFTER_TAX") {
    const beforeChargesTotal = invoiceTaxableAmount.plus(taxesTotal);
    if (optDiscAmount.greaterThan(0)) {
      billDiscount = Decimal.min(beforeChargesTotal, optDiscAmount);
    } else if (optDiscPercent.greaterThan(0) && beforeChargesTotal.greaterThan(0)) {
      billDiscount = toMoney(beforeChargesTotal.times(optDiscPercent).dividedBy(100));
    }
  }

  // Additional charges (with optional GST per charge)
  let chargesTotal = new Decimal(0);
  let chargesTaxTotal = new Decimal(0);
  if (options?.additionalCharges && options.additionalCharges.length > 0) {
    for (const ch of options.additionalCharges) {
      const amt = toMoney(ch.amount ?? 0);
      chargesTotal = chargesTotal.plus(amt);
      const chRate = toDecimal(ch.taxRate ?? 0);
      if (amt.greaterThan(0) && chRate.greaterThan(0)) {
        const chTax = toMoney(amt.times(chRate).dividedBy(100));
        if (isIntraState) {
          const half = toMoney(chTax.dividedBy(2));
          const otherHalf = toMoney(chTax.minus(half));
          invoiceCgstAmount = invoiceCgstAmount.plus(half);
          invoiceSgstAmount = invoiceSgstAmount.plus(otherHalf);
        } else {
          invoiceIgstAmount = invoiceIgstAmount.plus(chTax);
        }
        chargesTaxTotal = chargesTaxTotal.plus(chTax);
      }
    }
  }
  const taxesTotalWithCharges = taxesTotal.plus(chargesTaxTotal);

  // Raw grand total
  let rawGrandTotal: Decimal;
  if (discountType === "BEFORE_TAX") {
    rawGrandTotal = Decimal.max(
      0,
      invoiceTaxableAmount.plus(taxesTotalWithCharges).plus(chargesTotal),
    );
  } else {
    rawGrandTotal = Decimal.max(
      0,
      invoiceTaxableAmount.plus(taxesTotalWithCharges).minus(billDiscount).plus(chargesTotal),
    );
  }

  const roundOffRes = calculateRoundOff(rawGrandTotal);
  const totalDiscount = invoiceLineDiscountTotal.plus(billDiscount);

  return {
    isIntraState,
    subTotal: toMoney(invoiceSubTotal),
    discountTotal: toMoney(totalDiscount),
    billDiscount: toMoney(billDiscount),
    chargesTotal: toMoney(chargesTotal),
    taxableAmount: toMoney(invoiceTaxableAmount),
    cgstAmount: toMoney(invoiceCgstAmount),
    sgstAmount: toMoney(invoiceSgstAmount),
    igstAmount: toMoney(invoiceIgstAmount),
    utgstAmount: toMoney(invoiceUtgstAmount),
    cessAmount: toMoney(invoiceCessAmount),
    roundOff: roundOffRes.roundOffAmount,
    grandTotal: roundOffRes.roundedAmount,
    grandTotalWords: amountToWordsEnglish(roundOffRes.roundedAmount),
    grandTotalWordsGujarati: amountToWordsGujarati(roundOffRes.roundedAmount),
    items: calculatedItems,
  };
}
