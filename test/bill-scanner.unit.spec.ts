import { describe, it, expect } from "vitest";
import { BillNormalizerService } from "../src/purchases/scanner/services/bill-normalizer.service";
import { BillStorageService } from "../src/purchases/scanner/services/bill-storage.service";
import { BillMatcherService } from "../src/purchases/scanner/services/bill-matcher.service";
import { MockOcrProvider } from "../src/purchases/scanner/providers/mock-ocr.provider";
import { ExtractedBillDataSchema } from "../src/purchases/scanner/schemas/bill-extraction.schema";

describe("AI Bill Scanner - Unit Tests", () => {
  const normalizer = new BillNormalizerService();
  const storage = new BillStorageService();
  const mockOcr = new MockOcrProvider();

  describe("1. Indian Currency & Number Normalization", () => {
    it("correctly parses Indian formatted number with lakhs commas (1,25,000.50)", () => {
      const parsed = normalizer.parseIndianNumber("1,25,000.50");
      expect(parsed).not.toBeNull();
      expect(parsed?.toFixed(2)).toBe("125000.50");
    });

    it("correctly parses currency prefixed values (₹ 4,500.00 and Rs. 9,999/-)", () => {
      const p1 = normalizer.parseIndianNumber("₹ 4,500.00");
      const p2 = normalizer.parseIndianNumber("Rs. 9,999/-");
      expect(p1?.toFixed(2)).toBe("4500.00");
      expect(p2?.toFixed(2)).toBe("9999.00");
    });

    it("handles bracketed negative numbers for credits/discounts ((500.25))", () => {
      const parsed = normalizer.parseIndianNumber("(500.25)");
      expect(parsed?.toFixed(2)).toBe("-500.25");
    });

    it("returns null on completely unreadable or alphabetic strings", () => {
      expect(normalizer.parseIndianNumber("N/A")).toBeNull();
      expect(normalizer.parseIndianNumber("unknown-price")).toBeNull();
      expect(normalizer.parseIndianNumber("")).toBeNull();
    });

    it("sanitizes Indian GSTINs properly and rejects invalid strings", () => {
      expect(normalizer.sanitizeGstin("24AAACG1234F1Z9")).toBe("24AAACG1234F1Z9");
      expect(normalizer.sanitizeGstin("  24aaacg1234f1z9  ")).toBe("24AAACG1234F1Z9");
      expect(normalizer.sanitizeGstin("12345")).toBeNull();
    });
  });

  describe("2. GST Tax Calculations and Mismatch Detection", () => {
    it("calculates intra-state CGST & SGST 50/50 split correctly", () => {
      const rawData = ExtractedBillDataSchema.parse({
        supplier: { name: "Gujarat Traders", gstin: "24AAACG1234F1Z9" },
        invoice: { invoiceNumber: "INV-01", placeOfSupply: "24" },
        financials: { grandTotal: "1180.00" },
        items: [
          {
            description: "Product A",
            quantity: 10,
            unitPrice: 100,
            taxRate: 18,
            taxableAmount: 1000,
            totalAmount: 1180,
          },
        ],
        documentMetadata: { fileName: "bill.pdf" },
      });

      const normalized = normalizer.normalizeBillData(rawData, "24");
      expect(normalized.items[0].cgstAmount).toBe("90.00");
      expect(normalized.items[0].sgstAmount).toBe("90.00");
      expect(normalized.items[0].igstAmount).toBe("0.00");
      expect(normalized.items[0].totalAmount).toBe("1180.00");
      expect(normalized.financials.isTaxMismatch).toBe(false);
    });

    it("calculates inter-state IGST 100% split correctly", () => {
      const rawData = ExtractedBillDataSchema.parse({
        supplier: { name: "Mumbai Corp", gstin: "27AABCM7777K1Z4" },
        invoice: { invoiceNumber: "INV-02", placeOfSupply: "27" }, // From MH to GJ
        financials: { grandTotal: "1180.00" },
        items: [
          {
            description: "Industrial Valve",
            quantity: 1,
            unitPrice: 1000,
            taxRate: 18,
            taxableAmount: 1000,
            totalAmount: 1180,
          },
        ],
        documentMetadata: { fileName: "bill.pdf" },
      });

      const normalized = normalizer.normalizeBillData(rawData, "24");
      expect(normalized.items[0].cgstAmount).toBe("0.00");
      expect(normalized.items[0].sgstAmount).toBe("0.00");
      expect(normalized.items[0].igstAmount).toBe("180.00");
      expect(normalized.financials.isTaxMismatch).toBe(false);
    });

    it("flags tax mismatch when item sum does not equal printed grand total", () => {
      const rawData = ExtractedBillDataSchema.parse({
        supplier: { name: "Discrepant Seller", gstin: "24AAACG1234F1Z9" },
        invoice: { invoiceNumber: "INV-03", placeOfSupply: "24" },
        financials: { grandTotal: "1500.00" }, // Printed 1500, but line is 1180
        items: [
          {
            description: "Widget",
            quantity: 1,
            unitPrice: 1000,
            taxRate: 18,
            taxableAmount: 1000,
            totalAmount: 1180,
          },
        ],
        documentMetadata: { fileName: "bill.pdf" },
      });

      const normalized = normalizer.normalizeBillData(rawData, "24");
      expect(normalized.financials.isTaxMismatch).toBe(true);
      expect(normalized.financials.taxMismatchReason).toContain("differs from printed total");
      expect(normalized.documentMetadata.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("3. File Signature Magic Byte Validation", () => {
    it("accepts valid PDF magic bytes (%PDF-)", () => {
      const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      const res = storage.validateFileSignature(pdfBuffer);
      expect(res.mimeType).toBe("application/pdf");
      expect(res.extension).toBe("pdf");
    });

    it("accepts valid PNG magic bytes", () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      const res = storage.validateFileSignature(pngBuffer);
      expect(res.mimeType).toBe("image/png");
      expect(res.extension).toBe("png");
    });

    it("accepts valid JPEG magic bytes", () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const res = storage.validateFileSignature(jpegBuffer);
      expect(res.mimeType).toBe("image/jpeg");
      expect(res.extension).toBe("jpg");
    });

    it("accepts valid WebP magic bytes (RIFF....WEBP)", () => {
      const webpBuffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x20, 0x00, 0x00, 0x00, // size
        0x57, 0x45, 0x42, 0x50, // WEBP
        0x56, 0x50, 0x38, 0x20, // VP8
      ]);
      const res = storage.validateFileSignature(webpBuffer);
      expect(res.mimeType).toBe("image/webp");
      expect(res.extension).toBe("webp");
    });

    it("rejects truncated files smaller than 4 bytes", () => {
      const tinyBuffer = Buffer.from([0x25, 0x50]);
      expect(() => storage.validateFileSignature(tinyBuffer)).toThrow("File is empty or truncated.");
    });

    it("rejects malicious or executable files disguised with .pdf or .jpg extension", () => {
      const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // Windows MZ header
      const scriptBuffer = Buffer.from("<script>alert(1)</script>");
      expect(() => storage.validateFileSignature(exeBuffer)).toThrow("Invalid file type");
      expect(() => storage.validateFileSignature(scriptBuffer)).toThrow("Invalid file type");
    });
  });

  describe("4. String Similarity and Item Matching Algorithm", () => {
    const matcher = new BillMatcherService(null as any);

    it("calculates exact match similarity as 1.0", () => {
      expect(matcher.calculateSimilarity("Organic Fertilizer 50kg", "Organic Fertilizer 50kg")).toBe(1.0);
    });

    it("calculates high similarity for minor word variations and punctuation", () => {
      const sim = matcher.calculateSimilarity(
        "Organic Fertilizer 50kg Bag",
        "Organic Fertilizer 50 kg (Bag)",
      );
      expect(sim).toBeGreaterThanOrEqual(0.7);
    });

    it("matches product by exact barcode with 100 confidence", async () => {
      const companyItems = [
        {
          id: "item-1",
          name: "Organic Fertilizer",
          sku: "FERT-01",
          barcode: "8901234567890",
          hsnCode: "3105",
        },
      ];

      const match = await matcher.matchLineItem(
        {
          description: "Fertilizer Bag",
          rawText: "Item with Barcode: 8901234567890",
          quantity: 1,
          unitPrice: 500,
          taxableAmount: 500,
          taxRate: 18,
          totalAmount: 590,
          confidence: 90,
        },
        companyItems,
      );

      expect(match.matchType).toBe("BARCODE");
      expect(match.matchedItemId).toBe("item-1");
      expect(match.matchedItemScore).toBe(100);
    });

    it("matches product by SKU with high confidence", async () => {
      const companyItems = [
        {
          id: "item-2",
          name: "Industrial Bearing",
          sku: "BRG-6205",
          barcode: null,
          hsnCode: "8482",
        },
      ];

      const match = await matcher.matchLineItem(
        {
          description: "Precision Ball Bearing (BRG-6205)",
          quantity: 1,
          unitPrice: 200,
          taxableAmount: 200,
          taxRate: 18,
          totalAmount: 236,
          confidence: 90,
        },
        companyItems,
      );

      expect(match.matchType).toBe("SKU");
      expect(match.matchedItemId).toBe("item-2");
      expect(match.matchedItemScore).toBe(98);
    });

    it("proposes NEW_PRODUCT when no catalog items match, but includes candidates", async () => {
      const companyItems = [
        {
          id: "item-3",
          name: "Agricultural Pipe 2 inch",
          sku: "PIPE-2",
          barcode: null,
          hsnCode: "3917",
        },
      ];

      const match = await matcher.matchLineItem(
        {
          description: "High Grade Stainless Steel Screw M8",
          quantity: 100,
          unitPrice: 5,
          taxableAmount: 500,
          taxRate: 18,
          totalAmount: 590,
          confidence: 90,
        },
        companyItems,
      );

      expect(match.matchType).toBe("NEW_PRODUCT");
      expect(match.matchedItemId).toBeNull();
    });
  });

  describe("5. Deterministic Mock OCR Provider Scenarios", () => {
    it("extracts multi-page PDF fixture correctly", async () => {
      const res = await mockOcr.extractInvoice(
        Buffer.from("%PDF-1.4 sample multi-page"),
        "application/pdf",
        { fileName: "national_multi_page_bill.pdf" },
      );

      expect(res.extractedData.documentMetadata.isMultiPage).toBe(true);
      expect(res.extractedData.documentMetadata.pageCount).toBe(3);
      expect(res.extractedData.items.length).toBe(2);
      expect(res.extractedData.supplier.name).toBe("National Distributors Private Limited");
    });

    it("handles low quality bill fixture with reduced confidence and ambiguity warnings", async () => {
      const res = await mockOcr.extractInvoice(
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        "image/jpeg",
        { fileName: "wrinkled_low_quality_camera.jpg" },
      );

      expect(res.extractedData.documentMetadata.overallConfidence).toBeLessThan(75);
      expect(res.extractedData.documentMetadata.warnings.length).toBeGreaterThan(0);
      expect(res.extractedData.items[0].isAmbiguous).toBe(true);
    });

    it("handles unreadable fields fixture by returning null instead of hallucinated data", async () => {
      const res = await mockOcr.extractInvoice(
        Buffer.from("%PDF-1.4 unreadable test"),
        "application/pdf",
        { fileName: "torn_unreadable_bill.pdf" },
      );

      expect(res.extractedData.supplier.name).toBeNull();
      expect(res.extractedData.supplier.gstin).toBeNull();
      expect(res.extractedData.invoice.invoiceNumber).toBeNull();
      expect(res.extractedData.documentMetadata.warnings.some((w) => w.includes("Manual input required"))).toBe(true);
    });
  });
});
