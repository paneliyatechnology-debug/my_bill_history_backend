import { Injectable } from "@nestjs/common";
import { Decimal, toDecimal } from "@billing/accounting-core";
import { ExtractedBillDataDto, ExtractedBillItemInput } from "../schemas/bill-extraction.schema";

export const INDIAN_STATE_NAME_TO_CODE: Record<string, string> = {
  "jammu and kashmir": "01",
  "jammu & kashmir": "01",
  "jk": "01",
  "himachal pradesh": "02",
  "hp": "02",
  "punjab": "03",
  "pb": "03",
  "chandigarh": "04",
  "ch": "04",
  "uttarakhand": "05",
  "uk": "05",
  "haryana": "06",
  "hr": "06",
  "delhi": "07",
  "dl": "07",
  "rajasthan": "08",
  "rj": "08",
  "uttar pradesh": "09",
  "up": "09",
  "bihar": "10",
  "br": "10",
  "sikkim": "11",
  "sk": "11",
  "arunachal pradesh": "12",
  "ar": "12",
  "nagaland": "13",
  "nl": "13",
  "manipur": "14",
  "mn": "14",
  "mizoram": "15",
  "mz": "15",
  "tripura": "16",
  "tr": "16",
  "meghalaya": "17",
  "ml": "17",
  "assam": "18",
  "as": "18",
  "west bengal": "19",
  "wb": "19",
  "jharkhand": "20",
  "jh": "20",
  "odisha": "21",
  "orissa": "21",
  "or": "21",
  "od": "21",
  "chhattisgarh": "22",
  "cg": "22",
  "madhya pradesh": "23",
  "mp": "23",
  "gujarat": "24",
  "gj": "24",
  "in-gj": "24",
  "daman and diu": "26",
  "dadra and nagar haveli": "26",
  "dadra and nagar haveli and daman and diu": "26",
  "maharashtra": "27",
  "mh": "27",
  "andhra pradesh": "37",
  "ap": "37",
  "karnataka": "29",
  "ka": "29",
  "goa": "30",
  "ga": "30",
  "lakshadweep": "31",
  "ld": "31",
  "kerala": "32",
  "kl": "32",
  "tamil nadu": "33",
  "tn": "33",
  "puducherry": "34",
  "py": "34",
  "andaman and nicobar": "35",
  "andaman and nicobar islands": "35",
  "an": "35",
  "telangana": "36",
  "ts": "36",
  "tg": "36",
  "ladakh": "38",
  "la": "38",
};

@Injectable()
export class BillNormalizerService {
  /**
   * Resolves raw place of supply string, state name, or supplier GSTIN into a 2-digit Indian State Code
   */
  resolveStateCode(
    rawState?: string | null,
    supplierGstin?: string | null,
    fallbackState: string = "24",
  ): string {
    if (rawState) {
      const clean = rawState.trim();
      if (/^\d{2}$/.test(clean)) {
        return clean;
      }
      if (/^\d{1}$/.test(clean)) {
        return clean.padStart(2, "0");
      }
      const lower = clean.toLowerCase().replace(/[^a-z0-9& -]/g, "").trim();
      if (INDIAN_STATE_NAME_TO_CODE[lower]) {
        return INDIAN_STATE_NAME_TO_CODE[lower];
      }
      for (const [name, code] of Object.entries(INDIAN_STATE_NAME_TO_CODE)) {
        if (lower === name || lower.includes(name) || name.includes(lower)) {
          return code;
        }
      }
    }

    if (supplierGstin) {
      const cleanGstin = supplierGstin.trim().toUpperCase();
      const match = cleanGstin.match(/^(\d{2})/);
      if (match && match[1]) {
        return match[1];
      }
    }

    return fallbackState || "24";
  }

  /**
   * Parses Indian or international formatted currency / quantity strings into a clean Decimal string.
   * Examples: "1,25,000.50", "₹ 4,500/-", "123.456", "(500.00)"
   */
  parseIndianNumber(val: any): Decimal | null {
    if (val === null || val === undefined) return null;
    if (typeof val === "number") {
      if (isNaN(val)) return null;
      return new Decimal(val);
    }
    if (typeof val !== "string") {
      try {
        return new Decimal(val.toString());
      } catch {
        return null;
      }
    }

    let cleaned = val.trim();
    if (!cleaned) return null;

    // Check if bracketed negative e.g. "(500.00)"
    let isNegative = false;
    if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
      isNegative = true;
      cleaned = cleaned.slice(1, -1).trim();
    } else if (cleaned.startsWith("-")) {
      isNegative = true;
      cleaned = cleaned.slice(1).trim();
    }

    // Strip currency symbols (₹, $, Rs., etc.), slashes, spaces, commas
    cleaned = cleaned
      .replace(/[₹$€£]/g, "")
      .replace(/\s+/g, "")
      .replace(/Rs\.?/gi, "")
      .replace(/\/-/g, "")
      .replace(/,/g, "");

    // Must be valid numeric format
    if (!/^\d+(\.\d+)?$/.test(cleaned)) {
      return null;
    }

    try {
      const dec = new Decimal(cleaned);
      return isNegative ? dec.negated() : dec;
    } catch {
      return null;
    }
  }

  /**
   * Sanitizes and validates Indian GSTIN format (15 characters: 2 state + 10 PAN + 1 entity + Z + 1 check)
   */
  sanitizeGstin(gstin?: string | null): string | null {
    if (!gstin) return null;
    const clean = gstin.trim().toUpperCase().replace(/[\s-]/g, "");
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    return gstinRegex.test(clean) ? clean : clean.length >= 10 ? clean : null;
  }

  /**
   * Normalizes dates from various formats (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.) to standard YYYY-MM-DD.
   */
  normalizeDate(rawDate?: string | null): string | null {
    if (!rawDate) return null;
    const clean = rawDate.trim();
    if (!clean) return null;

    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

    // DD/MM/YYYY or DD-MM-YYYY
    const dmy = clean.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})$/);
    if (dmy) {
      const day = dmy[1].padStart(2, "0");
      const month = dmy[2].padStart(2, "0");
      const year = dmy[3];
      return `${year}-${month}-${day}`;
    }

    // YYYY/MM/DD
    const ymd = clean.match(/^(\d{4})[\/\.-](\d{1,2})[\/\.-](\d{1,2})$/);
    if (ymd) {
      const year = ymd[1];
      const month = ymd[2].padStart(2, "0");
      const day = ymd[3].padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }

    return clean;
  }

  /**
   * Normalizes extracted bill data, recalculates line items, and verifies mathematical integrity.
   */
  normalizeBillData(
    data: ExtractedBillDataDto,
    companyStateCode: string = "24",
  ): ExtractedBillDataDto {
    const warnings: string[] = [...(data.documentMetadata?.warnings || [])];
    const placeOfSupply = this.resolveStateCode(
      data.invoice?.placeOfSupply,
      data.supplier?.gstin,
      companyStateCode,
    );
    const isIntraState = placeOfSupply === companyStateCode;

    let sumTaxable = new Decimal(0);
    let sumCgst = new Decimal(0);
    let sumSgst = new Decimal(0);
    let sumIgst = new Decimal(0);
    let sumTotal = new Decimal(0);

    const normalizedItems: ExtractedBillItemInput[] = (data.items || []).map(
      (item, index) => {
        let qtyDec = this.parseIndianNumber(item.quantity) || new Decimal(1);
        if (qtyDec.isZero() || qtyDec.isNegative()) qtyDec = new Decimal(1);

        let rateDec = this.parseIndianNumber(item.unitPrice) || new Decimal(0);
        let discountDec =
          this.parseIndianNumber(item.discountAmount) || new Decimal(0);
        const parsedTaxRate = this.parseIndianNumber(item.taxRate);
        const taxRateDec = parsedTaxRate !== null ? parsedTaxRate : new Decimal(0);

        const extractedTaxable = this.parseIndianNumber(item.taxableAmount);
        const extractedTotal = this.parseIndianNumber(item.totalAmount);

        // Taxable base determination:
        let taxable: Decimal;
        if (extractedTaxable && extractedTaxable.gt(0)) {
          taxable = extractedTaxable.toDecimalPlaces(2);
          // If rateDec is 0 or differs from (taxable + discount) / qty, align rateDec to true pre-tax unit price
          const calcTaxable = qtyDec.times(rateDec).minus(discountDec);
          if (rateDec.isZero() || !calcTaxable.equals(taxable)) {
            rateDec = taxable.plus(discountDec).dividedBy(qtyDec).toDecimalPlaces(2);
          }
        } else if (extractedTotal && extractedTotal.gt(0) && taxRateDec.gt(0)) {
          // If only total is provided, reverse-compute taxable = total / (1 + taxRate / 100)
          const multiplier = new Decimal(1).plus(taxRateDec.dividedBy(100));
          taxable = extractedTotal.dividedBy(multiplier).toDecimalPlaces(2);
          rateDec = taxable.plus(discountDec).dividedBy(qtyDec).toDecimalPlaces(2);
        } else {
          // Standard forward computation: Taxable = (Qty * Rate) - Discount
          taxable = qtyDec.times(rateDec).minus(discountDec);
          if (taxable.isNegative()) taxable = new Decimal(0);
          taxable = taxable.toDecimalPlaces(2);
        }

        // Tax calculation
        const taxAmount = taxable
          .times(taxRateDec)
          .dividedBy(100)
          .toDecimalPlaces(2);

        let cgst = new Decimal(0);
        let sgst = new Decimal(0);
        let igst = new Decimal(0);

        if (isIntraState) {
          cgst = taxAmount.dividedBy(2).toDecimalPlaces(2);
          sgst = taxAmount.minus(cgst);
        } else {
          igst = taxAmount;
        }

        const lineTotal = taxable.plus(cgst).plus(sgst).plus(igst).toDecimalPlaces(2);

        sumTaxable = sumTaxable.plus(taxable);
        sumCgst = sumCgst.plus(cgst);
        sumSgst = sumSgst.plus(sgst);
        sumIgst = sumIgst.plus(igst);
        sumTotal = sumTotal.plus(lineTotal);

        return {
          ...item,
          quantity: qtyDec.toFixed(4),
          unitPrice: rateDec.toFixed(2),
          discountAmount: discountDec.toFixed(2),
          taxableAmount: taxable.toFixed(2),
          taxRate: taxRateDec.toFixed(2),
          cgstAmount: cgst.toFixed(2),
          sgstAmount: sgst.toFixed(2),
          igstAmount: igst.toFixed(2),
          totalAmount: lineTotal.toFixed(2),
          confidence: item.confidence ?? 80,
          isAmbiguous: item.isAmbiguous ?? false,
        };
      },
    );

    // Extract printed financials
    const extractedGrandTotalDec = this.parseIndianNumber(
      data.financials?.grandTotal,
    );
    const roundOffDec =
      this.parseIndianNumber(data.financials?.roundOff) || new Decimal(0);
    const otherChargesDec =
      this.parseIndianNumber(data.financials?.otherCharges) || new Decimal(0);

    // If no items were extracted or all items had 0 total, but document has a positive grand total (e.g. payment slips, vouchers)
    if (normalizedItems.length === 0 && extractedGrandTotalDec && extractedGrandTotalDec.gt(0)) {
      const supName = data.supplier?.name?.trim() || "Purchase Order";
      const totalStr = extractedGrandTotalDec.toFixed(2);
      normalizedItems.push({
        description: `${supName} - Purchase Bill / Expense`,
        rawText: `Grand Total: ${totalStr}`,
        hsnCode: "9983",
        quantity: "1.0000",
        unit: "PCS",
        unitPrice: totalStr,
        discountAmount: "0.00",
        taxableAmount: totalStr,
        taxRate: "0.00",
        cgstAmount: "0.00",
        sgstAmount: "0.00",
        igstAmount: "0.00",
        cessAmount: "0.00",
        totalAmount: totalStr,
        confidence: 90,
        itemType: "PRODUCT",
        isAmbiguous: false,
        suggestedItems: [],
      });

      sumTaxable = extractedGrandTotalDec;
      sumTotal = extractedGrandTotalDec;
    }

    const calculatedGrandTotal = sumTotal
      .plus(otherChargesDec)
      .plus(roundOffDec)
      .toDecimalPlaces(2);

    let isTaxMismatch = false;
    let taxMismatchReason: string | null = null;

    if (extractedGrandTotalDec) {
      const diff = calculatedGrandTotal
        .minus(extractedGrandTotalDec)
        .abs();
      const currSymbol = (data.currency && data.currency !== "INR") ? `${data.currency} ` : "₹";
      // Allow minor 1-unit rounding differences, otherwise flag
      if (diff.gt(1.0)) {
        isTaxMismatch = true;
        taxMismatchReason = `Calculated total (${currSymbol}${calculatedGrandTotal.toFixed(2)}) differs from printed total (${currSymbol}${extractedGrandTotalDec.toFixed(2)}) by ${currSymbol}${diff.toFixed(2)}.`;
        warnings.push(taxMismatchReason);
      }
    }

    const gstin = this.sanitizeGstin(data.supplier?.gstin);
    if (!gstin) {
      warnings.push("Supplier GSTIN is missing or invalid. Please verify.");
    }

    return {
      currency: data.currency || "INR",
      exchangeRate: data.exchangeRate ?? null,
      sourceGrandTotal: data.sourceGrandTotal ?? null,
      isRcm: !!data.isRcm,
      supplier: {
        ...data.supplier,
        gstin,
        confidence: data.supplier?.confidence ?? (gstin ? 90 : 40),
      },
      buyer: data.buyer
        ? {
            ...data.buyer,
            gstin: this.sanitizeGstin(data.buyer?.gstin),
            stateCode: this.resolveStateCode(
              data.buyer?.stateCode,
              data.buyer?.gstin,
              companyStateCode,
            ),
            confidence: data.buyer?.confidence ?? (data.buyer?.gstin ? 90 : 80),
          }
        : undefined,
      invoice: {
        ...data.invoice,
        invoiceDate: this.normalizeDate(data.invoice?.invoiceDate),
        dueDate: this.normalizeDate(data.invoice?.dueDate),
        placeOfSupply,
        confidence: data.invoice?.confidence ?? 85,
      },
      financials: {
        subtotal: sumTaxable.toFixed(2),
        totalDiscount: "0.00",
        taxableAmount: sumTaxable.toFixed(2),
        cgstAmount: sumCgst.toFixed(2),
        sgstAmount: sumSgst.toFixed(2),
        igstAmount: sumIgst.toFixed(2),
        cessAmount: "0.00",
        otherCharges: otherChargesDec.toFixed(2),
        roundOff: roundOffDec.toFixed(2),
        grandTotal: (extractedGrandTotalDec || calculatedGrandTotal).toFixed(2),
        isTaxMismatch,
        taxMismatchReason,
        confidence: isTaxMismatch ? 60 : (data.financials?.confidence ?? 90),
      },
      items: normalizedItems,
      documentMetadata: {
        ...data.documentMetadata,
        warnings,
      },
    };
  }
}
