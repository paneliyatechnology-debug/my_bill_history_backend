import { z } from "zod";

/**
 * Preprocessor for numeric fields (e.g., quantity, price, taxes) that gracefully
 * handles null, undefined, empty strings, and comma-formatted strings without failing.
 */
const flexibleNumber = (defaultValue: number = 0) =>
  z.preprocess((val) => {
    if (val === null || val === undefined || val === "") return defaultValue;
    if (typeof val === "string") {
      const cleaned = val.replace(/,/g, "").trim();
      const n = Number(cleaned);
      return isNaN(n) ? defaultValue : n;
    }
    if (typeof val === "number") return isNaN(val) ? defaultValue : val;
    return defaultValue;
  }, z.union([z.number(), z.string()]).default(defaultValue));

/**
 * Preprocessor for confidence scores (0 to 100), defaulting to 80 if null/invalid.
 */
const flexibleConfidence = (defaultValue: number = 80) =>
  z.preprocess((val) => {
    if (typeof val === "number" && !isNaN(val)) {
      return Math.min(100, Math.max(0, val));
    }
    if (typeof val === "string") {
      const n = Number(val.trim());
      if (!isNaN(n)) return Math.min(100, Math.max(0, n));
    }
    return defaultValue;
  }, z.number().min(0).max(100).default(defaultValue));

/**
 * Preprocessor for boolean flags, handling null, undefined, and truthy string values.
 */
const flexibleBoolean = (defaultValue: boolean = false) =>
  z.preprocess((val) => {
    if (val === null || val === undefined) return defaultValue;
    if (typeof val === "boolean") return val;
    if (typeof val === "string") {
      const s = val.toLowerCase().trim();
      return s === "true" || s === "1" || s === "yes";
    }
    return Boolean(val);
  }, z.boolean().default(defaultValue));

/**
 * Preprocessor for item descriptions ensuring non-empty string.
 */
const flexibleDescription = () =>
  z.preprocess((val) => {
    if (val === null || val === undefined) return "Item";
    const s = String(val).trim();
    return s.length > 0 ? s : "Item";
  }, z.string().default("Item"));

/**
 * Zod schema for extracted purchase line items.
 */
export const ExtractedBillItemSchema = z.object({
  id: z.string().optional(),
  description: flexibleDescription(),
  rawText: z.string().nullable().optional(),
  hsnCode: z.string().nullable().optional(),
  quantity: flexibleNumber(1),
  unit: z.string().nullable().optional(),
  unitPrice: flexibleNumber(0),
  discountAmount: flexibleNumber(0),
  taxableAmount: flexibleNumber(0),
  taxRate: flexibleNumber(18),
  cgstAmount: flexibleNumber(0),
  sgstAmount: flexibleNumber(0),
  igstAmount: flexibleNumber(0),
  cessAmount: flexibleNumber(0),
  totalAmount: flexibleNumber(0),
  confidence: flexibleConfidence(80),
  itemType: z.preprocess((val) => (val === "SERVICE" ? "SERVICE" : "PRODUCT"), z.enum(["PRODUCT", "SERVICE"]).default("PRODUCT")),
  isAmbiguous: flexibleBoolean(false),
  matchedItemId: z.string().nullable().optional(),
  matchedItemName: z.string().nullable().optional(),
  matchedItemScore: z.number().nullable().optional(),
  matchType: z.enum(["BARCODE", "SKU", "EXACT_NAME", "FUZZY_NAME", "NEW_PRODUCT"]).nullable().optional(),
  suggestedItems: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      sku: z.string().nullable().optional(),
      score: z.number(),
    })
  ).optional().default([]),
});

export type ExtractedBillItemInput = z.infer<typeof ExtractedBillItemSchema>;

/**
 * Zod schema for complete extracted bill data.
 */
export const ExtractedBillDataSchema = z.object({
  currency: z.string().default("INR"),
  exchangeRate: z.number().nullable().optional(),
  sourceGrandTotal: z.string().nullable().optional(),
  isRcm: flexibleBoolean(false),
  buyerGstin: z.string().nullable().optional(),
  supplier: z.object({
    name: z.string().nullable().optional(),
    gstin: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    confidence: flexibleConfidence(80),
    matchedPartyId: z.string().nullable().optional(),
    matchedPartyName: z.string().nullable().optional(),
    matchedPartyGstin: z.string().nullable().optional(),
    matchedPartyScore: z.number().nullable().optional(),
    isNewSupplier: flexibleBoolean(false),
  }),
  buyer: z.object({
    name: z.string().nullable().optional(),
    gstin: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    stateCode: z.string().nullable().optional(),
    confidence: flexibleConfidence(80),
    matchedPartyId: z.string().nullable().optional(),
    matchedPartyName: z.string().nullable().optional(),
    matchedPartyScore: z.number().nullable().optional(),
  }).optional(),
  invoice: z.object({
    invoiceNumber: z.string().nullable().optional(),
    invoiceDate: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    placeOfSupply: z.string().nullable().optional(),
    paymentTerms: z.string().nullable().optional(),
    confidence: flexibleConfidence(80),
    isDuplicateWarning: flexibleBoolean(false),
  }),
  financials: z.object({
    subtotal: z.string().nullable().optional(),
    totalDiscount: z.string().nullable().optional(),
    taxableAmount: z.string().nullable().optional(),
    cgstAmount: z.string().nullable().optional(),
    sgstAmount: z.string().nullable().optional(),
    igstAmount: z.string().nullable().optional(),
    cessAmount: z.string().nullable().optional(),
    otherCharges: z.string().nullable().optional(),
    roundOff: z.string().nullable().optional(),
    grandTotal: z.string().nullable().optional(),
    isTaxMismatch: flexibleBoolean(false),
    taxMismatchReason: z.string().nullable().optional(),
    confidence: flexibleConfidence(80),
  }),
  items: z.array(ExtractedBillItemSchema).default([]),
  documentMetadata: z.object({
    fileName: z.string().default("bill.pdf"),
    pageCount: z.preprocess((val) => (typeof val === "number" && val > 0 ? Math.floor(val) : 1), z.number().int().min(1).default(1)),
    isMultiPage: flexibleBoolean(false),
    overallConfidence: flexibleConfidence(80),
    warnings: z.preprocess((val) => (Array.isArray(val) ? val : []), z.array(z.string()).default([])),
    engine: z.string().optional(),
    isUnreadable: flexibleBoolean(false),
  }),
});

export type ExtractedBillDataDto = z.infer<typeof ExtractedBillDataSchema>;

/**
 * Zod schema for editing/saving a scan draft
 */
export const UpdateScanDraftSchema = z.object({
  partyId: z.string().uuid().nullable().optional(),
  vendorInvoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  placeOfSupply: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
  extractedData: ExtractedBillDataSchema.optional(),
});

export type UpdateScanDraftDto = z.infer<typeof UpdateScanDraftSchema>;

/**
 * Zod schema for confirming purchase scan
 */
export const ConfirmPurchaseScanSchema = z.object({
  partyId: z.string().optional(),
  createNewSupplier: z.boolean().optional().default(false),
  newSupplierDetails: z.object({
    name: z.string().min(1, "Supplier name is required"),
    gstin: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
  }).optional(),
  currency: z.string().optional().default("INR"),
  exchangeRate: z.number().optional().default(1),
  vendorInvoiceNumber: z.string().min(1, "Vendor invoice number is required"),
  invoiceDate: z.string().optional(),
  placeOfSupply: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
  itcEligibility: z.string().optional().default("INPUT"),
  items: z.array(
    z.object({
      itemId: z.string().optional(), // Existing or newly created item ID
      createNewProduct: z.boolean().optional().default(false),
      itemType: z.enum(["PRODUCT", "SERVICE"]).optional().default("PRODUCT"),
      newProductDetails: z.object({
        name: z.string().min(1),
        itemType: z.enum(["PRODUCT", "SERVICE"]).optional().default("PRODUCT"),
        hsnCode: z.string().default("0000"),
        unitSymbol: z.string().default("PCS"),
        taxRate: z.number().default(18),
        purchasePrice: z.number().default(0),
        retailPrice: z.number().optional(),
      }).optional(),
      hsnCode: z.string().optional(),
      quantity: z.union([z.number(), z.string()]),
      unitPrice: z.union([z.number(), z.string()]),
      taxRate: z.union([z.number(), z.string()]),
    })
  ).min(1, "At least one purchase item is required"),
  idempotencyKey: z.string().optional(),
});

export type ConfirmPurchaseScanDto = z.infer<typeof ConfirmPurchaseScanSchema>;
