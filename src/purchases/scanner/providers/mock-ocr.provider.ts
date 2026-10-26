import { Injectable, Logger } from "@nestjs/common";
import { IOcrProvider, OcrOptions, OcrResult } from "./ocr-provider.interface";
import { ExtractedBillDataSchema } from "../schemas/bill-extraction.schema";

@Injectable()
export class MockOcrProvider implements IOcrProvider {
  readonly name = "mock";
  private readonly logger = new Logger(MockOcrProvider.name);

  isAvailable(): boolean {
    return true;
  }

  async extractInvoice(
    fileBuffer: Buffer,
    mimeType: string,
    options?: OcrOptions,
  ): Promise<OcrResult> {
    const fileName = (options?.fileName || "sample-invoice.pdf").toLowerCase();
    const rawContent = fileBuffer.toString("utf8", 0, Math.min(fileBuffer.length, 4096));

    this.logger.log(`Mock OCR processing file: ${fileName} (${mimeType}, ${fileBuffer.length} bytes)`);

    // Scenario 1: Low-quality or Wrinkled photo fixture
    if (fileName.includes("low_quality") || rawContent.includes("FIXTURE_LOW_QUALITY")) {
      const data = ExtractedBillDataSchema.parse({
        supplier: {
          name: "Shreeji Trading Co",
          gstin: "24AAACS1234M1Z2",
          address: "Shop 12, APMC Market, Rajkot, Gujarat",
          phone: "9825012345",
          email: null,
          confidence: 62,
        },
        invoice: {
          invoiceNumber: "INV-2026-LQ01",
          invoiceDate: "2026-10-10",
          dueDate: null,
          placeOfSupply: "24",
          confidence: 58,
        },
        financials: {
          subtotal: "1500.00",
          totalDiscount: "0.00",
          taxableAmount: "1500.00",
          cgstAmount: "135.00",
          sgstAmount: "135.00",
          igstAmount: "0.00",
          cessAmount: "0.00",
          otherCharges: "0.00",
          roundOff: "0.00",
          grandTotal: "1770.00",
          isTaxMismatch: false,
          confidence: 65,
        },
        items: [
          {
            description: "Loose Wheat / Gehu",
            rawText: "Wheat 50k",
            hsnCode: "1001",
            quantity: 1,
            unit: "BAG",
            unitPrice: 1500,
            discountAmount: 0,
            taxableAmount: 1500,
            taxRate: 18,
            cgstAmount: 135,
            sgstAmount: 135,
            igstAmount: 0,
            totalAmount: 1770,
            confidence: 55,
            isAmbiguous: true,
          },
        ],
        documentMetadata: {
          fileName: options?.fileName || "low_quality_bill.jpg",
          pageCount: 1,
          isMultiPage: false,
          overallConfidence: 60,
          warnings: [
            "Low image resolution detected. Some characters were ambiguous.",
            "Please verify item description and quantity carefully.",
          ],
        },
      });

      return {
        provider: this.name,
        extractedData: data,
        rawText: "Shreeji Trading Co ... Wheat 50k ... Total 1770",
      };
    }

    // Scenario 2: Multi-page PDF fixture
    if (fileName.includes("multi_page") || rawContent.includes("FIXTURE_MULTI_PAGE")) {
      const data = ExtractedBillDataSchema.parse({
        supplier: {
          name: "National Distributors Private Limited",
          gstin: "24AAACN9999P1Z8",
          address: "GIDC Industrial Estate, Vatva, Ahmedabad - 382445",
          phone: "9879011223",
          email: "billing@nationaldistributors.in",
          confidence: 96,
        },
        invoice: {
          invoiceNumber: "NDPL/2026/0892",
          invoiceDate: "2026-10-12",
          dueDate: "2026-11-12",
          placeOfSupply: "24",
          confidence: 98,
        },
        financials: {
          subtotal: "45000.00",
          totalDiscount: "1000.00",
          taxableAmount: "44000.00",
          cgstAmount: "3960.00",
          sgstAmount: "3960.00",
          igstAmount: "0.00",
          cessAmount: "0.00",
          otherCharges: "200.00",
          roundOff: "-0.20",
          grandTotal: "52119.80",
          isTaxMismatch: false,
          confidence: 95,
        },
        items: [
          {
            description: "Premium Basmati Rice 25kg Bag",
            rawText: "Item 1: Premium Basmati Rice 25kg (HSN 1006) 10 BAG @ 2200",
            hsnCode: "1006",
            quantity: 10,
            unit: "BAG",
            unitPrice: 2200,
            discountAmount: 500,
            taxableAmount: 21500,
            taxRate: 18,
            cgstAmount: 1935,
            sgstAmount: 1935,
            igstAmount: 0,
            totalAmount: 25370,
            confidence: 94,
            isAmbiguous: false,
          },
          {
            description: "Refined Groundnut Oil 15L Tin",
            rawText: "Item 2: Refined Oil 15L Tin (HSN 1508) 10 TIN @ 2250",
            hsnCode: "1508",
            quantity: 10,
            unit: "TIN",
            unitPrice: 2250,
            discountAmount: 500,
            taxableAmount: 22000,
            taxRate: 18,
            cgstAmount: 1980,
            sgstAmount: 1980,
            igstAmount: 0,
            totalAmount: 25960,
            confidence: 95,
            isAmbiguous: false,
          },
        ],
        documentMetadata: {
          fileName: options?.fileName || "multi_page_invoice.pdf",
          pageCount: 3,
          isMultiPage: true,
          overallConfidence: 96,
          warnings: ["Multi-page table parsed across pages 1 to 2."],
        },
      });

      return {
        provider: this.name,
        extractedData: data,
        rawText: "National Distributors Multi-Page Tax Invoice ... Page 1 of 3 ... Page 2 of 3 ...",
      };
    }

    // Scenario 3: Inter-state IGST Fixture
    if (fileName.includes("igst") || rawContent.includes("FIXTURE_IGST")) {
      const data = ExtractedBillDataSchema.parse({
        supplier: {
          name: "Maharashtra Industrial Suppliers",
          gstin: "27AABCM7777K1Z4", // Maharashtra 27
          address: "Andheri East, Mumbai, Maharashtra 400069",
          phone: "9820098200",
          email: "sales@mahaindustries.com",
          confidence: 97,
        },
        invoice: {
          invoiceNumber: "MIS-BOM-7788",
          invoiceDate: "2026-10-13",
          dueDate: "2026-10-28",
          placeOfSupply: "24", // Destination Gujarat
          confidence: 96,
        },
        financials: {
          subtotal: "10000.00",
          totalDiscount: "0.00",
          taxableAmount: "10000.00",
          cgstAmount: "0.00",
          sgstAmount: "0.00",
          igstAmount: "1800.00",
          cessAmount: "0.00",
          otherCharges: "0.00",
          roundOff: "0.00",
          grandTotal: "11800.00",
          isTaxMismatch: false,
          confidence: 96,
        },
        items: [
          {
            description: "Industrial Precision Bearings 6205-2RS",
            rawText: "Bearings 6205-2RS HSN 8482 Qty 50 @ 200",
            hsnCode: "8482",
            quantity: 50,
            unit: "PCS",
            unitPrice: 200,
            discountAmount: 0,
            taxableAmount: 10000,
            taxRate: 18,
            cgstAmount: 0,
            sgstAmount: 0,
            igstAmount: 1800,
            totalAmount: 11800,
            confidence: 95,
            isAmbiguous: false,
          },
        ],
        documentMetadata: {
          fileName: options?.fileName || "igst_invoice.pdf",
          pageCount: 1,
          isMultiPage: false,
          overallConfidence: 96,
          warnings: ["Inter-state IGST transaction detected (Maharashtra -> Gujarat)."],
        },
      });

      return {
        provider: this.name,
        extractedData: data,
        rawText: "Maharashtra Industrial Suppliers Tax Invoice ... IGST 18% ... Grand Total 11800",
      };
    }

    // Scenario 4: Missing / Unreadable Fields Fixture
    if (fileName.includes("unreadable") || rawContent.includes("FIXTURE_UNREADABLE")) {
      const data = ExtractedBillDataSchema.parse({
        supplier: {
          name: null, // Unreadable
          gstin: null, // Missing
          address: "Some Market, Near Station",
          phone: null,
          email: null,
          confidence: 30,
        },
        invoice: {
          invoiceNumber: null, // Unreadable stamp
          invoiceDate: "2026-10-14",
          dueDate: null,
          placeOfSupply: "24",
          confidence: 40,
        },
        financials: {
          subtotal: "5000.00",
          totalDiscount: "0.00",
          taxableAmount: "5000.00",
          cgstAmount: "450.00",
          sgstAmount: "450.00",
          igstAmount: "0.00",
          cessAmount: "0.00",
          otherCharges: "0.00",
          roundOff: "0.00",
          grandTotal: "5900.00",
          isTaxMismatch: false,
          confidence: 50,
        },
        items: [
          {
            description: "Unknown Hardware Supplies",
            rawText: "Hardware item ???",
            hsnCode: null,
            quantity: 1,
            unit: "PCS",
            unitPrice: 5000,
            discountAmount: 0,
            taxableAmount: 5000,
            taxRate: 18,
            cgstAmount: 450,
            sgstAmount: 450,
            igstAmount: 0,
            totalAmount: 5900,
            confidence: 35,
            isAmbiguous: true,
          },
        ],
        documentMetadata: {
          fileName: options?.fileName || "unreadable_bill.png",
          pageCount: 1,
          isMultiPage: false,
          overallConfidence: 40,
          warnings: [
            "Supplier name and GSTIN could not be identified.",
            "Invoice number is obscured or missing. Manual input required.",
          ],
        },
      });

      return {
        provider: this.name,
        extractedData: data,
        rawText: "Cash Memo ... Hardware item ??? ... 5900",
      };
    }

    // Scenario 5: Tax Mismatch Fixture
    if (fileName.includes("mismatch") || rawContent.includes("FIXTURE_MISMATCH")) {
      const data = ExtractedBillDataSchema.parse({
        supplier: {
          name: "Apex Electronics Gujarat",
          gstin: "24AABCA5555L1Z1",
          address: "Ring Road, Surat",
          phone: "9898011223",
          email: "apex@surat.in",
          confidence: 90,
        },
        invoice: {
          invoiceNumber: "APX-9988",
          invoiceDate: "2026-10-14",
          dueDate: null,
          placeOfSupply: "24",
          confidence: 90,
        },
        financials: {
          subtotal: "2000.00",
          totalDiscount: "0.00",
          taxableAmount: "2000.00",
          cgstAmount: "180.00",
          sgstAmount: "180.00",
          igstAmount: "0.00",
          cessAmount: "0.00",
          otherCharges: "0.00",
          roundOff: "0.00",
          grandTotal: "2500.00", // Mismatch: 2000 + 360 != 2500!
          isTaxMismatch: true,
          taxMismatchReason: "Sum of line items (₹2360.00) does not match printed bill total (₹2500.00).",
          confidence: 70,
        },
        items: [
          {
            description: "LED Power Adapter 12V 2A",
            rawText: "Power Adapter 12V 10 PCS @ 200",
            hsnCode: "8504",
            quantity: 10,
            unit: "PCS",
            unitPrice: 200,
            discountAmount: 0,
            taxableAmount: 2000,
            taxRate: 18,
            cgstAmount: 180,
            sgstAmount: 180,
            igstAmount: 0,
            totalAmount: 2360,
            confidence: 88,
            isAmbiguous: false,
          },
        ],
        documentMetadata: {
          fileName: options?.fileName || "mismatch_invoice.pdf",
          pageCount: 1,
          isMultiPage: false,
          overallConfidence: 75,
          warnings: [
            "Mathematical discrepancy: Printed grand total (₹2500.00) does not equal item totals + GST (₹2360.00).",
          ],
        },
      });

      return {
        provider: this.name,
        extractedData: data,
        rawText: "Apex Electronics ... Total 2500",
      };
    }

    // Default Scenario: Standard Clear Indian GST Tax Invoice
    const data = ExtractedBillDataSchema.parse({
      supplier: {
        name: "Gujarat Agro & Machinery Corp",
        gstin: "24ABCDE1234F1Z6",
        address: "Plot 45, GIDC Industrial Estate, Naroda, Ahmedabad - 382330",
        phone: "9825123456",
        email: "contact@gujaratingro.com",
        confidence: 96,
      },
      invoice: {
        invoiceNumber: "GAMC/2026/1042",
        invoiceDate: "2026-10-14",
        dueDate: "2026-11-14",
        placeOfSupply: "24",
        confidence: 95,
      },
      financials: {
        subtotal: "12500.00",
        totalDiscount: "500.00",
        taxableAmount: "12000.00",
        cgstAmount: "1080.00",
        sgstAmount: "1080.00",
        igstAmount: "0.00",
        cessAmount: "0.00",
        otherCharges: "0.00",
        roundOff: "0.00",
        grandTotal: "14160.00",
        isTaxMismatch: false,
        confidence: 95,
      },
      items: [
        {
          description: "Organic Fertilizer 50kg Bag",
          rawText: "Item 1: Organic Fertilizer 50kg Bag (HSN 3105) 10 BAG @ 800",
          hsnCode: "3105",
          quantity: 10,
          unit: "BAG",
          unitPrice: 800,
          discountAmount: 200,
          taxableAmount: 7800,
          taxRate: 18,
          cgstAmount: 702,
          sgstAmount: 702,
          igstAmount: 0,
          totalAmount: 9204,
          confidence: 94,
          isAmbiguous: false,
        },
        {
          description: "High Pressure Spray Nozzle Set",
          rawText: "Item 2: Spray Nozzle Set (HSN 8424) 20 SET @ 225",
          hsnCode: "8424",
          quantity: 20,
          unit: "SET",
          unitPrice: 225,
          discountAmount: 300,
          taxableAmount: 4200,
          taxRate: 18,
          cgstAmount: 378,
          sgstAmount: 378,
          igstAmount: 0,
          totalAmount: 4956,
          confidence: 93,
          isAmbiguous: false,
        },
      ],
      documentMetadata: {
        fileName: options?.fileName || "tax_invoice.pdf",
        pageCount: 1,
        isMultiPage: false,
        overallConfidence: 95,
        warnings: [],
      },
    });

    return {
      provider: this.name,
      extractedData: data,
      rawText: "TAX INVOICE ... Gujarat Agro & Machinery Corp ... 24AAACG1234F1Z9 ... GAMC/2026/1042 ... Total 14,160.00",
    };
  }
}
