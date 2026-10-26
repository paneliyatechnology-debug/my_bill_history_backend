import { Decimal, toDecimal, toMoney } from "./decimal";
import { isUtgstTerritory, SupplyCategory } from "./tax-calculator";

const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export type InwardTaxKind = "INTRA_SGST" | "INTRA_UTGST" | "INTER_IGST" | "NON_TAXABLE";

export interface InwardSupplyDecision {
  supplierStateCode: string;
  placeOfSupply: string;
  taxKind: InwardTaxKind;
  supplierRegistered: boolean;
  placeOfSupplyAssumed: boolean;
  recipientStateDiffersFromPlaceOfSupply: boolean;
  notes: string[];
}

function gstinChecksum(first14: string): string | null {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = GSTIN_CHARSET.indexOf(first14[i]);
    if (value < 0) return null;
    let product = value * (i % 2 === 0 ? 1 : 2);
    product = Math.floor(product / 36) + (product % 36);
    sum += product;
  }
  return GSTIN_CHARSET[(36 - (sum % 36)) % 36];
}

export function supplierStateFromGstin(gstin: string, partyStateCode: string): string {
  const clean = gstin.trim().toUpperCase();
  if (!GSTIN_REGEX.test(clean) || gstinChecksum(clean.slice(0, 14)) !== clean[14]) {
    throw new Error("Supplier GSTIN failed format or checksum validation.");
  }
  const gstinState = clean.slice(0, 2);
  if (partyStateCode.trim() !== gstinState) {
    throw new Error(
      `Supplier GSTIN state ${gstinState} does not match the supplier state ${partyStateCode.trim()}.`,
    );
  }
  return gstinState;
}

/**
 * Inward tax follows the supplier's state and the place of supply.
 * The recipient's state is not used to choose SGST, UTGST, or IGST.
 * Section 7 and Section 8 of the IGST Act: intra-state when both are in the same state or UT.
 */
export function resolveInwardSupply(input: {
  supplierGstin?: string | null;
  supplierStateCode?: string | null;
  placeOfSupply?: string | null;
  recipientStateCode: string;
}): InwardSupplyDecision {
  const partyState = (input.supplierStateCode || "").trim();
  if (!/^[0-9]{2}$/.test(partyState)) {
    throw new Error("Supplier state code is required before purchase tax can be classified.");
  }
  const supplierRegistered = Boolean(input.supplierGstin && input.supplierGstin.trim());
  const supplierStateCode = supplierRegistered
    ? supplierStateFromGstin(input.supplierGstin!, partyState)
    : partyState;
  const notes: string[] = [];
  let placeOfSupply = (input.placeOfSupply || "").trim();
  let placeOfSupplyAssumed = false;
  if (!placeOfSupply) {
    if (supplierStateCode !== input.recipientStateCode.trim()) {
      throw new Error(
        "Place of supply is required when the supplier state and the recipient registration state differ.",
      );
    }
    placeOfSupply = supplierStateCode;
    placeOfSupplyAssumed = true;
    notes.push(
      "Place of supply was not on the bill. It was taken as the supplier state because that state is also the recipient's registration state.",
    );
  }
  if (!/^[0-9]{2}$/.test(placeOfSupply)) {
    throw new Error("Place of supply must be a 2-digit state or UT code.");
  }
  if (!supplierRegistered) {
    notes.push(
      "The supplier has no GSTIN. Tax is classified from the supplier state and place of supply. Input tax credit is not treated as eligible merely because tax was calculated.",
    );
  }
  const intra = supplierStateCode === placeOfSupply;
  const taxKind: InwardTaxKind = !intra
    ? "INTER_IGST"
    : isUtgstTerritory(placeOfSupply)
      ? "INTRA_UTGST"
      : "INTRA_SGST";
  const recipientStateDiffersFromPlaceOfSupply = placeOfSupply !== input.recipientStateCode.trim();
  if (recipientStateDiffersFromPlaceOfSupply) {
    notes.push(
      "Place of supply differs from the recipient's registration state. The tax split still follows the supplier and place of supply. Whether this input tax is claimable needs CA confirmation.",
    );
  }
  return {
    supplierStateCode,
    placeOfSupply,
    taxKind,
    supplierRegistered,
    placeOfSupplyAssumed,
    recipientStateDiffersFromPlaceOfSupply,
    notes,
  };
}

export function splitInwardLineTax(input: {
  taxableAmount: Decimal;
  taxRate: Decimal;
  supplyCategory?: SupplyCategory | null;
  taxKind: InwardTaxKind;
}): { cgst: Decimal; sgst: Decimal; utgst: Decimal; igst: Decimal; taxRate: Decimal; supplyCategory: SupplyCategory } {
  const supplyCategory = input.supplyCategory ?? "TAXABLE";
  const zero = new Decimal(0);
  if (supplyCategory !== "TAXABLE" || input.taxKind === "NON_TAXABLE") {
    return { cgst: zero, sgst: zero, utgst: zero, igst: zero, taxRate: zero, supplyCategory };
  }
  const taxRate = toDecimal(input.taxRate);
  const taxAmount = toMoney(input.taxableAmount.times(taxRate).dividedBy(100));
  if (input.taxKind === "INTER_IGST") {
    return { cgst: zero, sgst: zero, utgst: zero, igst: taxAmount, taxRate, supplyCategory };
  }
  const half = taxAmount.dividedBy(2).toDecimalPlaces(2);
  const other = taxAmount.minus(half);
  if (input.taxKind === "INTRA_UTGST") {
    return { cgst: half, sgst: zero, utgst: other, igst: zero, taxRate, supplyCategory };
  }
  return { cgst: half, sgst: other, utgst: zero, igst: zero, taxRate, supplyCategory };
}
