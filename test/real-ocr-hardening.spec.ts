import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { LocalDocumentOcrProvider } from "../src/purchases/scanner/providers/local-document-ocr.provider";
import { BillNormalizerService } from "../src/purchases/scanner/services/bill-normalizer.service";
import { ItemType } from "@billing/database";

describe("Hardened Real Document OCR & Extraction Verification Suite", () => {
  let provider: LocalDocumentOcrProvider;
  const fixturesDir = path.join(__dirname, "fixtures/scanner-verification");
  const cursorPdfPath = path.join(
    __dirname,
    "../storage/bill-scans/92967a06-d488-4794-bae1-e6188e8fb47d/034b1e55-366f-40b2-ba17-e91d769fcabb.pdf"
  );
  const companyGstin = "24AARCP0909R1ZR";
  const companyName = "PANELIYA TECHNOLOGY PRIVATE LIMITED";

  beforeAll(() => {
    provider = new LocalDocumentOcrProvider();
  });

  // --------------------------------------------------------------------------
  // TEST 1: Text-based PDF (Cursor USD Subscription Bill)
  // --------------------------------------------------------------------------
  it("1. Text-based PDF: Extracts USD currency, service item, RCM flag and excludes buyer GSTIN", async () => {
    const fileBuf = await fs.readFile(cursorPdfPath);
    const result = await provider.extractInvoice(
      fileBuf,
      "application/pdf",
      { fileName: "cursor_invoice.pdf", companyGstin, companyName }
    );

    const ext = result.extractedData;
    expect(result.provider).toBe("local");
    expect(ext.documentMetadata.engine).toBe("pdf-text-extractor");

    // Currency verification: Must preserve USD and not convert or label as INR
    expect(ext.currency).toBe("USD");
    expect(ext.financials.grandTotal).toBe("20.23");

    // Reverse Charge Mechanism (RCM) detection
    expect(ext.isRcm).toBe(true);

    // Supplier extraction & Buyer GSTIN protection
    // Buyer GSTIN is 24AARCP0909R1ZR. It MUST NOT be assigned as the supplier GSTIN!
    expect(ext.supplier.gstin).not.toBe(companyGstin);

    // Invoice number
    expect(ext.invoice.invoiceNumber).toBe("JTSABGXJ-0002");

    // Items classification: Cursor usage is a cloud service / subscription, not a physical good
    expect(ext.items.length).toBeGreaterThan(0);
    const mainItem = ext.items[0];
    expect(mainItem.itemType).toBe("SERVICE");
    expect(Number(mainItem.unitPrice)).toBe(20.23);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Scanned / Image-Only PDF (Pure raster image, 0 text stream)
  // --------------------------------------------------------------------------
  it("2. Scanned/Image-Only PDF: Falls back to pdftoppm + Tesseract pixel OCR and recognizes pixels", async () => {
    const pdfPath = path.join(fixturesDir, "scanned_image_only_invoice.pdf");
    const fileBuf = await fs.readFile(pdfPath);

    const result = await provider.extractInvoice(
      fileBuf,
      "application/pdf",
      { fileName: "scanned_image_only_invoice.pdf", companyGstin, companyName }
    );

    const ext = result.extractedData;
    // Engine must be tesseract-pixel-ocr, confirming real pixel OCR ran
    expect(ext.documentMetadata.engine).toBe("tesseract-pixel-ocr");

    // Raw text recognized from pixel raster
    expect(result.rawText?.toUpperCase()).toContain("MAHALAXMI");
    expect(result.rawText?.toUpperCase()).toMatch(/MSP-9[39]12/);

    // Supplier & Invoice details from OCR pixels
    expect(ext.supplier.gstin).toBe("24AADCM5566G1Z2");
    expect(ext.supplier.gstin).not.toBe(companyGstin);
    expect(ext.invoice.invoiceNumber).toMatch(/MSP-9[39]12/);
  }, 30000);

  // --------------------------------------------------------------------------
  // TEST 3: JPG/PNG Bill Photo (Direct image OCR)
  // --------------------------------------------------------------------------
  it("3. Image Bill Photo: Directly invokes Tesseract image OCR and parses line items", async () => {
    const imgPath = path.join(fixturesDir, "bill_photo.png");
    const fileBuf = await fs.readFile(imgPath);

    const result = await provider.extractInvoice(
      fileBuf,
      "image/png",
      { fileName: "bill_photo.png", companyGstin, companyName }
    );

    const ext = result.extractedData;
    expect(ext.documentMetadata.engine).toBe("tesseract-pixel-ocr");
    expect(ext.currency).toBe("INR");
    expect(ext.supplier.gstin).toBe("24AADCM5566G1Z2");
    expect(ext.invoice.invoiceNumber).toMatch(/MSP-9[39]12/);

    // Line items extracted from image
    expect(ext.items.length).toBeGreaterThan(0);
    const item = ext.items[0];
    expect(item.description.toUpperCase()).toContain("STEEL");
    expect(item.itemType).toBe("PRODUCT");
  }, 30000);

  // --------------------------------------------------------------------------
  // TEST 4: Multi-Page PDF Invoice
  // --------------------------------------------------------------------------
  it("4. Multi-Page PDF: Parses items across multiple pages and distinguishes services from goods", async () => {
    const pdfPath = path.join(fixturesDir, "multi_page_invoice.pdf");
    const fileBuf = await fs.readFile(pdfPath);

    const result = await provider.extractInvoice(
      fileBuf,
      "application/pdf",
      { fileName: "multi_page_invoice.pdf", companyGstin, companyName }
    );

    const ext = result.extractedData;
    expect(ext.documentMetadata.pageCount).toBeGreaterThanOrEqual(2);
    expect(ext.documentMetadata.engine).toBe("pdf-text-extractor");

    // Supplier: National Logistics
    expect(ext.supplier.gstin).toBe("27AABCN8899P1Z4");
    expect(ext.invoice.invoiceNumber).toBe("NL-889901");

    // Items across both pages:
    // Page 1: Conveyor Belt (Good)
    // Page 2: Storage Racks (Good), Freight & Loading Services (Service with SAC 996511)
    expect(ext.items.length).toBeGreaterThanOrEqual(2);

    const serviceItem = ext.items.find(
      (it) => it.description.toLowerCase().includes("freight") || (it.hsnCode && it.hsnCode.startsWith("99"))
    );
    expect(serviceItem).toBeDefined();
    expect(serviceItem?.itemType).toBe("SERVICE");

    const goodsItem = ext.items.find(
      (it) => it.description.toLowerCase().includes("conveyor") || it.description.toLowerCase().includes("racks")
    );
    expect(goodsItem).toBeDefined();
    expect(goodsItem?.itemType).toBe("PRODUCT");

    expect(Number(ext.financials.grandTotal)).toBe(79060);
  });

  // --------------------------------------------------------------------------
  // TEST 5: Indian GST Invoice (Multiple goods, SAC 99xx services, taxes)
  // --------------------------------------------------------------------------
  it("5. Indian GST Invoice: Extracts supplier GSTIN, excludes buyer GSTIN, verifies math & SAC", async () => {
    const pdfPath = path.join(fixturesDir, "indian_gst_invoice.pdf");
    const fileBuf = await fs.readFile(pdfPath);

    const result = await provider.extractInvoice(
      fileBuf,
      "application/pdf",
      { fileName: "indian_gst_invoice.pdf", companyGstin, companyName }
    );

    const ext = result.extractedData;
    expect(ext.documentMetadata.engine).toBe("pdf-text-extractor");

    // Supplier verification
    expect(ext.supplier.name?.toUpperCase()).toContain("SHREE KRISHNA");
    expect(ext.supplier.gstin).toBe("24AAAFK2233C1Z8");

    // Strict Buyer GSTIN Isolation: Buyer GSTIN must NEVER become supplier GSTIN
    expect(ext.supplier.gstin).not.toBe(companyGstin);

    // Invoice Number and Date
    expect(ext.invoice.invoiceNumber).toBe("SKT/2026-27/0412");
    expect(ext.invoice.invoiceDate).toBe("2026-10-12");

    // Line Items: 1 Good (Copper Wire HSN 8544), 1 Service (Installation SAC 998717)
    expect(ext.items.length).toBe(2);

    const wireItem = ext.items.find((i) => i.description.toLowerCase().includes("copper"));
    expect(wireItem).toBeDefined();
    expect(wireItem?.itemType).toBe("PRODUCT");
    expect(wireItem?.hsnCode).toBe("8544");
    expect(Number(wireItem?.quantity)).toBe(10);
    expect(Number(wireItem?.unitPrice)).toBe(1850);

    const serviceItem = ext.items.find((i) => i.description.toLowerCase().includes("installation"));
    expect(serviceItem).toBeDefined();
    expect(serviceItem?.itemType).toBe("SERVICE");
    expect(serviceItem?.hsnCode).toBe("998717");
    expect(Number(serviceItem?.unitPrice)).toBe(3500);

    // Financials
    expect(Number(ext.financials.grandTotal)).toBe(25370);
  });

  // --------------------------------------------------------------------------
  // TEST 6: Unreadable / Blank Document (Zero fabrication)
  // --------------------------------------------------------------------------
  it("6. Unreadable Document: Returns confidence: 0, null fields, and no synthetic items", async () => {
    const blankPath = path.join(fixturesDir, "blank_unreadable.png");
    const fileBuf = await fs.readFile(blankPath);

    const result = await provider.extractInvoice(
      fileBuf,
      "image/png",
      { fileName: "blank_unreadable.png", companyGstin, companyName }
    );

    const ext = result.extractedData;
    // Must flag unreadable and 0 confidence
    expect(ext.documentMetadata.isUnreadable).toBe(true);
    expect(ext.documentMetadata.overallConfidence).toBe(0);

    // Must NOT fabricate invoice number, supplier or today's date
    expect(ext.invoice.invoiceNumber).toBeNull();
    expect(ext.invoice.invoiceDate).toBeNull();
    expect(ext.supplier.name).toBeNull();
    expect(ext.supplier.gstin).toBeNull();
    expect(ext.items.length).toBe(0);

    // Explicit warning about unreadable document
    expect(ext.documentMetadata.warnings.some((w) => w.toLowerCase().includes("unreadable"))).toBe(true);
  });

  // --------------------------------------------------------------------------
  // TEST 7: The Exact Currently Failing SpaceX Invoice (₹570.00)
  // --------------------------------------------------------------------------
  it("7. SpaceX Subscription Invoice: Extracts ₹570.00 total, 02037755F8 invoice number, service item, and isolates buyer email", async () => {
    const spacexPath = path.join(fixturesDir, "spacex_subscription_invoice.pdf");
    const fileBuf = await fs.readFile(spacexPath);

    const result = await provider.extractInvoice(
      fileBuf,
      "application/pdf",
      { fileName: "spacex_subscription_invoice.pdf", companyGstin, companyName }
    );

    const ext = result.extractedData;
    expect(result.provider).toBe("local");
    expect(ext.documentMetadata.engine).toBe("pdf-text-extractor");

    // 1. Supplier Extraction: Must be SpaceXAI, LLC without buyer contact details
    expect(ext.supplier.name).toBe("SpaceXAI, LLC");
    // Buyer email 'kjaydeep842@gmail.com' in 'Bill to' block must NEVER bleed into supplier details!
    expect(ext.supplier.email).toBeNull();
    expect(ext.supplier.phone).toBeNull();

    // 2. Invoice Number: Must be actual reference number, NEVER 'Invoice'
    expect(ext.invoice.invoiceNumber).toBe("02037755F8");
    expect(ext.invoice.invoiceNumber?.toLowerCase()).not.toBe("invoice");

    // 3. Currency and Printed Totals: Must extract ₹570.00, NOT ₹0.00!
    expect(ext.currency).toBe("INR");
    expect(ext.financials.grandTotal).toBe("570.00");
    expect(ext.financials.subtotal).toBe("570.00");

    // 4. Line Items: 1 subscription service item
    expect(ext.items.length).toBe(1);
    const item = ext.items[0];
    expect(item.description).toContain("Plus");
    expect(Number(item.quantity)).toBe(1);
    expect(Number(item.unitPrice)).toBe(570);
    expect(Number(item.totalAmount)).toBe(570);
    expect(item.itemType).toBe("SERVICE");

    // 5. Math reconciliation: No mismatch
    expect(ext.financials.isTaxMismatch).toBe(false);
  });

  // --------------------------------------------------------------------------
  // TEST 8: Zero-tax default and foreign currency preservation
  // --------------------------------------------------------------------------
  it("8. Math & Tax Normalization: Preserves source currency without silent INR conversion and defaults to 0% when unmentioned", () => {
    const normalizer = new BillNormalizerService();

    const normalized = normalizer.normalizeBillData({
      currency: "USD",
      isRcm: false,
      exchangeRate: null,
      sourceGrandTotal: "570.00",
      supplier: { name: "OpenAI, LLC", gstin: null, confidence: 90, isNewSupplier: false },
      invoice: { invoiceNumber: "INV-99", invoiceDate: "2026-10-14", confidence: 90, isDuplicateWarning: false },
      financials: { grandTotal: "570.00", confidence: 90, isTaxMismatch: false },
      items: [
        {
          description: "API Tokens",
          quantity: 1,
          unitPrice: 570,
          discountAmount: 0,
          taxableAmount: 570,
          taxRate: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 0,
          cessAmount: 0,
          totalAmount: 570,
          confidence: 90,
          isAmbiguous: false,
          suggestedItems: [],
          itemType: "SERVICE",
        },
      ],
      documentMetadata: {
        fileName: "bill.pdf",
        pageCount: 1,
        isMultiPage: false,
        overallConfidence: 90,
        warnings: [],
        isUnreadable: false,
      },
    });

    expect(normalized.currency).toBe("USD");
    expect(normalized.financials.grandTotal).toBe("570.00");
    expect(normalized.items[0].taxRate).toBe("0.00");
    expect(normalized.financials.cgstAmount).toBe("0.00");
    expect(normalized.financials.sgstAmount).toBe("0.00");
    expect(normalized.financials.isTaxMismatch).toBe(false);
  });
});
