import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BadRequestException, GatewayTimeoutException } from "@nestjs/common";
import { GeminiOcrProvider } from "../src/purchases/scanner/providers/gemini-ocr.provider";
import { BillStorageService } from "../src/purchases/scanner/services/bill-storage.service";
import { GoogleGenAI } from "@google/genai";

// Mock @google/genai
vi.mock("@google/genai", () => {
  const mockGenerateContent = vi.fn();
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    })),
    __mockGenerateContent: mockGenerateContent,
  };
});

describe("Gemini Vision OCR Provider & Storage Security Verification", () => {
  let provider: GeminiOcrProvider;
  let storage: BillStorageService;
  const originalEnv = { ...process.env };

  const validSampleJson = JSON.stringify({
    currency: "INR",
    exchangeRate: null,
    sourceGrandTotal: "1180.00",
    isRcm: false,
    buyerGstin: "24AARCP0909R1ZR",
    supplier: {
      name: "Acme Industrial Supplies",
      gstin: "24AAACG1234F1Z9",
      address: "101 GIDC Vatva, Ahmedabad, Gujarat - 382445",
      phone: "+91 98765 43210",
      email: "billing@acme.com",
      confidence: 96,
    },
    invoice: {
      invoiceNumber: "INV-2026-9081",
      invoiceDate: "2026-10-15",
      dueDate: "2026-11-14",
      placeOfSupply: "24",
      paymentTerms: "Net 30 Days",
      confidence: 98,
    },
    financials: {
      subtotal: "1000.00",
      totalDiscount: "0.00",
      taxableAmount: "1000.00",
      cgstAmount: "90.00",
      sgstAmount: "90.00",
      igstAmount: "0.00",
      cessAmount: "0.00",
      otherCharges: "0.00",
      roundOff: "0.00",
      grandTotal: "1180.00",
      isTaxMismatch: false,
      confidence: 99,
    },
    items: [
      {
        description: "Heavy Duty Bearings 6204-2RS",
        rawText: "Heavy Duty Bearings 6204-2RS HSN 8482 10 NOS @ 100",
        hsnCode: "8482",
        quantity: 10,
        unit: "NOS",
        unitPrice: 100,
        discountAmount: 0,
        taxableAmount: 1000,
        taxRate: 18,
        cgstAmount: 90,
        sgstAmount: 90,
        igstAmount: 0,
        cessAmount: 0,
        totalAmount: 1180,
        confidence: 95,
        isAmbiguous: false,
      },
    ],
    documentMetadata: {
      fileName: "invoice.jpg",
      pageCount: 1,
      isMultiPage: false,
      overallConfidence: 97,
      warnings: [],
    },
  });

  beforeEach(() => {
    provider = new GeminiOcrProvider();
    storage = new BillStorageService();
    process.env.GEMINI_API_KEY = "test-secret-key-12345";
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. Availability and Environment Security
  // ─────────────────────────────────────────────────────────────
  describe("1. Environment Security & Credentials", () => {
    it("reports unavailable when no API key is set in environment", () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;
      expect(provider.isAvailable()).toBe(false);
    });

    it("reports available when GEMINI_API_KEY is configured", () => {
      process.env.GEMINI_API_KEY = "test-key";
      expect(provider.isAvailable()).toBe(true);
    });

    it("rejects invoice extraction with BadRequestException if API key is missing", async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;
      const buffer = Buffer.from("dummy-file-content");

      await expect(
        provider.extractInvoice(buffer, "image/jpeg"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Structured Extraction & Schema Validation
  // ─────────────────────────────────────────────────────────────
  describe("2. Structured Extraction & Schema Validation", () => {
    it("extracts all required Indian GST fields including buyer GSTIN, payment terms, and cess", async () => {
      const { __mockGenerateContent } = (await import("@google/genai")) as any;
      __mockGenerateContent.mockResolvedValueOnce({
        text: validSampleJson,
      });

      const buffer = Buffer.from("sample-jpeg-bytes");
      const result = await provider.extractInvoice(buffer, "image/jpeg", {
        fileName: "tax_invoice.jpg",
      });

      expect(result.provider).toBe("gemini");
      const data = result.extractedData;

      // Supplier
      expect(data.supplier.name).toBe("Acme Industrial Supplies");
      expect(data.supplier.gstin).toBe("24AAACG1234F1Z9");
      expect(data.supplier.confidence).toBe(96);

      // Buyer GSTIN
      expect(data.buyerGstin).toBe("24AARCP0909R1ZR");

      // Invoice
      expect(data.invoice.invoiceNumber).toBe("INV-2026-9081");
      expect(data.invoice.invoiceDate).toBe("2026-10-15");
      expect(data.invoice.placeOfSupply).toBe("24");
      expect(data.invoice.paymentTerms).toBe("Net 30 Days");

      // Financials
      expect(data.financials.taxableAmount).toBe("1000.00");
      expect(data.financials.grandTotal).toBe("1180.00");
      expect(data.financials.isTaxMismatch).toBe(false);

      // Items
      expect(data.items.length).toBe(1);
      expect(data.items[0].description).toBe("Heavy Duty Bearings 6204-2RS");
      expect(data.items[0].hsnCode).toBe("8482");
      expect(Number(data.items[0].unitPrice)).toBe(100);
      expect(Number(data.items[0].totalAmount)).toBe(1180);
      expect(Number(data.items[0].cessAmount)).toBe(0);
    });

    it("cleans markdown fences (```json ... ```) automatically before parsing", async () => {
      const { __mockGenerateContent } = (await import("@google/genai")) as any;
      __mockGenerateContent.mockResolvedValueOnce({
        text: "```json\n" + validSampleJson + "\n```",
      });

      const result = await provider.extractInvoice(
        Buffer.from("sample-image"),
        "image/jpeg",
      );
      expect(result.extractedData.supplier.name).toBe(
        "Acme Industrial Supplies",
      );
    });

    it("rejects malformed or unparseable JSON safely with BadRequestException", async () => {
      const { __mockGenerateContent } = (await import("@google/genai")) as any;
      __mockGenerateContent.mockResolvedValueOnce({
        text: "{ invalid_json: ... not real json }",
      });

      await expect(
        provider.extractInvoice(Buffer.from("sample-image"), "image/jpeg"),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects output violating the Zod schema safely", async () => {
      const { __mockGenerateContent } = (await import("@google/genai")) as any;
      __mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          // Missing required sections entirely
          randomField: "malformed",
        }),
      });

      await expect(
        provider.extractInvoice(Buffer.from("sample-image"), "image/jpeg"),
      ).rejects.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Timeouts & Bounded Retries
  // ─────────────────────────────────────────────────────────────
  describe("3. Resilience: Timeouts, Concurrency & Bounded Retries", () => {
    it("retries on retryable errors (status 429) and succeeds when subsequent attempt returns", async () => {
      const { __mockGenerateContent } = (await import("@google/genai")) as any;
      const rateLimitErr: any = new Error("Rate limit exceeded");
      rateLimitErr.status = 429;

      __mockGenerateContent
        .mockRejectedValueOnce(rateLimitErr)
        .mockResolvedValueOnce({ text: validSampleJson });

      const result = await provider.extractInvoice(
        Buffer.from("sample-bytes"),
        "image/jpeg",
      );
      expect(result.extractedData.supplier.gstin).toBe("24AAACG1234F1Z9");
      expect(__mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it("enforces maximum bounded retries (does not loop indefinitely on persistent 503)", async () => {
      const { __mockGenerateContent } = (await import("@google/genai")) as any;
      __mockGenerateContent.mockClear();
      const serviceErr: any = new Error("Service unavailable");
      serviceErr.status = 503;

      __mockGenerateContent.mockRejectedValue(serviceErr);

      await expect(
        provider.extractInvoice(Buffer.from("sample-bytes"), "image/jpeg"),
      ).rejects.toThrow();

      // Bounded attempts across failover models without infinite loop
      expect(__mockGenerateContent.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(__mockGenerateContent.mock.calls.length).toBeLessThanOrEqual(5);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. File Signatures & HEIC Handling in Storage
  // ─────────────────────────────────────────────────────────────
  describe("4. Mobile Image Formats & HEIC Conversion", () => {
    it("validates standard PDF, PNG, JPEG, and WebP signatures", () => {
      // PDF
      const pdfBuf = Buffer.from("%PDF-1.4 test content");
      expect(storage.validateFileSignature(pdfBuf)).toEqual({
        mimeType: "application/pdf",
        extension: "pdf",
      });

      // PNG
      const pngBuf = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
      ]);
      expect(storage.validateFileSignature(pngBuf)).toEqual({
        mimeType: "image/png",
        extension: "png",
      });

      // JPEG
      const jpgBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(storage.validateFileSignature(jpgBuf)).toEqual({
        mimeType: "image/jpeg",
        extension: "jpg",
      });

      // WebP
      const webpBuf = Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ");
      expect(storage.validateFileSignature(webpBuf)).toEqual({
        mimeType: "image/webp",
        extension: "webp",
      });
    });

    it("identifies HEIC/HEIF files by ISOBMFF ftyp header", () => {
      // ISOBMFF box with 'ftyp' at bytes 4-7 and 'heic' at bytes 8-11
      const heicBuf = Buffer.from([
        0x00,
        0x00,
        0x00,
        0x18, // box size
        0x66,
        0x74,
        0x79,
        0x70, // 'ftyp'
        0x68,
        0x65,
        0x69,
        0x63, // 'heic'
        0x00,
        0x00,
        0x00,
        0x00,
      ]);
      expect(storage.validateFileSignature(heicBuf)).toEqual({
        mimeType: "image/heic",
        extension: "heic",
      });
    });

    it("rejects corrupted or truncated files below 4 bytes", () => {
      const tinyBuf = Buffer.from([0x01, 0x02]);
      expect(() => storage.validateFileSignature(tinyBuf)).toThrow(
        BadRequestException,
      );
    });

    it("rejects unsupported file formats (e.g. executable or zip)", () => {
      const exeBuf = Buffer.from("MZ\x90\x00\x03\x00\x00\x00");
      expect(() => storage.validateFileSignature(exeBuf)).toThrow(
        BadRequestException,
      );
    });

    it("enforces maximum file size limit of 15 MB", async () => {
      // Create a virtual buffer > 15MB
      const hugeBuffer = Buffer.alloc(15 * 1024 * 1024 + 1024);
      await expect(
        storage.validateAndSaveFile(
          hugeBuffer,
          "huge.pdf",
          "92967a06-d488-4794-bae1-e6188e8fb47d",
          "scan-1234",
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
