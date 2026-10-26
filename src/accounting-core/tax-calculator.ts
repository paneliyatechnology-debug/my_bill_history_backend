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

export interface CalculatedInvoiceTotals {
  isIntraState: boolean;
  subTotal: Decimal;
  discountTotal: Decimal;
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
): CalculatedInvoiceTotals {
  const isIntraState = companyStateCode.trim() === placeOfSupply.trim();

  let invoiceSubTotal = new Decimal(0);
  let invoiceDiscountTotal = new Decimal(0);
  let invoiceTaxableAmount = new Decimal(0);
  let invoiceCgstAmount = new Decimal(0);
  let invoiceSgstAmount = new Decimal(0);
  let invoiceIgstAmount = new Decimal(0);
  let invoiceUtgstAmount = new Decimal(0);
  let invoiceCessAmount = new Decimal(0);
  const useUtgst = isIntraState && isUtgstTerritory(placeOfSupply);

  const calculatedItems: CalculatedInvoiceItem[] = itemsInput.map((item) => {
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

    let taxable: Decimal;
    if (item.isTaxInclusive) {
      const grossAfterDisc = lineSubTotal.minus(discAmount);
      // Taxable = gross / (1 + taxRate/100)
      const divisor = new Decimal(1).plus(taxRate.dividedBy(100));
      taxable = toMoney(grossAfterDisc.dividedBy(divisor));
    } else {
      taxable = toMoney(lineSubTotal.minus(discAmount));
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
      const halfRate = toDecimal(taxRate.dividedBy(2).toFixed(2));
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
      igstRate = taxRate;
      igstAmount = toMoney(taxable.times(igstRate).dividedBy(100));
    }

    const cessRate = toDecimal(item.cessRate ?? 0);
    const cessAmount = toMoney(taxable.times(cessRate).dividedBy(100));

    const lineTotal = toMoney(
      taxable
        .plus(cgstAmount)
        .plus(sgstAmount)
        .plus(igstAmount)
        .plus(utgstAmount)
        .plus(cessAmount),
    );

    invoiceSubTotal = invoiceSubTotal.plus(lineSubTotal);
    invoiceDiscountTotal = invoiceDiscountTotal.plus(discAmount);
    invoiceTaxableAmount = invoiceTaxableAmount.plus(taxable);
    invoiceCgstAmount = invoiceCgstAmount.plus(cgstAmount);
    invoiceSgstAmount = invoiceSgstAmount.plus(sgstAmount);
    invoiceIgstAmount = invoiceIgstAmount.plus(igstAmount);
    invoiceUtgstAmount = invoiceUtgstAmount.plus(utgstAmount);
    invoiceCessAmount = invoiceCessAmount.plus(cessAmount);

    return {
      itemId: item.itemId,
      quantity: qty,
      unitPrice: price,
      subTotal: lineSubTotal,
      discountPercent: discPercent,
      discountAmount: discAmount,
      taxableAmount: taxable,
      taxRate,
      cgstRate,
      cgstAmount,
      sgstRate,
      sgstAmount,
      igstRate,
      igstAmount,
      utgstRate,
      utgstAmount,
      cessAmount,
      supplyCategory,
      totalAmount: lineTotal,
    };
  });

  const rawGrandTotal = invoiceTaxableAmount
    .plus(invoiceCgstAmount)
    .plus(invoiceSgstAmount)
    .plus(invoiceIgstAmount)
    .plus(invoiceUtgstAmount)
    .plus(invoiceCessAmount);

  const roundOffRes = calculateRoundOff(rawGrandTotal);

  return {
    isIntraState,
    subTotal: toMoney(invoiceSubTotal),
    discountTotal: toMoney(invoiceDiscountTotal),
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
