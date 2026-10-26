import { describe, it, expect, vi, beforeEach } from "vitest";
import * as XLSX from "xlsx";
import { ImportSchemaRegistry } from "../src/imports/import-schema.registry";
import { FileParserService } from "../src/imports/file-parser.service";
import { TemplateGeneratorService } from "../src/imports/template-generator.service";
import { ImportValidatorService } from "../src/imports/import-validator.service";
import { ImportExecutorService } from "../src/imports/import-executor.service";
import { ErrorReporterService } from "../src/imports/error-reporter.service";
import { ImportsService } from "../src/imports/imports.service";
import {
  ImportErrorPolicy,
  ImportMode,
  ImportModuleType,
  TenantContext,
} from "@billing/shared-types";

describe("Project-Wide Data Import System (Unit & Integration)", () => {
  let schemaRegistry: ImportSchemaRegistry;
  let fileParser: FileParserService;
  let templateGenerator: TemplateGeneratorService;
  let validator: ImportValidatorService;
  let executor: ImportExecutorService;
  let errorReporter: ErrorReporterService;
  let importsService: ImportsService;

  let mockPrisma: any;
  let mockAudit: any;

  const sampleTenantCtx: TenantContext = {
    organizationId: "11111111-1111-1111-1111-111111111111",
    companyId: "22222222-2222-2222-2222-222222222222",
    branchId: "33333333-3333-3333-3333-333333333333",
    financialYearId: "44444444-4444-4444-4444-444444444444",
    userId: "55555555-5555-5555-5555-555555555555",
  };

  beforeEach(() => {
    schemaRegistry = new ImportSchemaRegistry();
    fileParser = new FileParserService();
    templateGenerator = new TemplateGeneratorService(schemaRegistry);
    errorReporter = new ErrorReporterService();

    mockAudit = {
      record: vi.fn().mockResolvedValue(true),
    };

    const mockDbTx = {
      party: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "party-uuid-1", ...args.data })),
        update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      item: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "item-uuid-1", ...args.data })),
        update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      unitOfMeasure: {
        findFirst: vi.fn().mockResolvedValue({ id: "uom-uuid-pcs", symbol: "PCS", name: "Pieces" }),
        findMany: vi.fn().mockResolvedValue([{ id: "uom-uuid-pcs", symbol: "PCS", name: "Pieces" }]),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "uom-uuid-new", ...args.data })),
        update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      itemCategory: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "cat-uuid-new", ...args.data })),
        update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      warehouse: {
        findFirst: vi.fn().mockResolvedValue({ id: "wh-uuid-main", name: "Main Warehouse", isDefault: true }),
        findMany: vi.fn().mockResolvedValue([{ id: "wh-uuid-main", name: "Main Warehouse", isDefault: true }]),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "wh-uuid-new", ...args.data })),
        update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      ledgerGroup: {
        findFirst: vi.fn().mockResolvedValue({ id: "grp-uuid-debtors", name: "Sundry Debtors" }),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "grp-uuid-new", ...args.data })),
      },
      ledgerAccount: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "acc-uuid-1", ...args.data })),
        update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      stockTransaction: {
        create: vi.fn().mockResolvedValue({ id: "stx-uuid-1" }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: "branch-uuid-1", name: "Main Branch", isMainBranch: true }),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "branch-uuid-new", ...args.data })),
      },
      financialYear: {
        findFirst: vi.fn().mockResolvedValue({ id: "fy-uuid-1", code: "2026-27", isCurrent: true }),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "fy-uuid-new", ...args.data })),
      },
      salesInvoice: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "inv-uuid-1", ...args.data })),
      },
      purchaseInvoice: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "bill-uuid-1", ...args.data })),
      },
      deliveryChallan: {
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "dc-uuid-1", ...args.data })),
      },
      billOfMaterial: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "bom-uuid-1", ...args.data })),
      },
      bomItem: {
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "bom-item-1", ...args.data })),
      },
      hsnMaster: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "hsn-uuid-1", ...args.data })),
        update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      },
      importJob: {
        create: vi.fn().mockImplementation((args) => Promise.resolve({ id: "job-uuid-1", ...args.data })),
        update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
        findFirst: vi.fn().mockResolvedValue({
          id: "job-uuid-1",
          companyId: sampleTenantCtx.companyId,
          organizationId: sampleTenantCtx.organizationId,
          module: "parties",
          fileName: "parties.xlsx",
          fileSize: 1024,
          fileFormat: "XLSX",
          status: "COMPLETED",
          totalRows: 5,
          validRows: 5,
          importedRows: 5,
          updatedRows: 0,
          skippedRows: 0,
          failedRows: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    mockPrisma = {
      executeBypassRls: vi.fn(async (cb) => cb(mockDbTx)),
      executeInTenantContext: vi.fn(async (ctx, cb) => cb(mockDbTx)),
    };

    validator = new ImportValidatorService(mockPrisma, schemaRegistry, fileParser);
    executor = new ImportExecutorService(mockPrisma, mockAudit, fileParser);
    importsService = new ImportsService(
      mockPrisma,
      schemaRegistry,
      fileParser,
      templateGenerator,
      validator,
      executor,
      errorReporter,
    );
  });

  // =============================================================
  // 1. FILE PARSER & SANITIZATION
  // =============================================================
  describe("File Parser & Formula Injection Protection", () => {
    it("should reject completely empty buffers with 400 Bad Request", () => {
      expect(() => fileParser.parseBuffer(Buffer.alloc(0), "empty.xlsx")).toThrow(
        "uploaded file is empty",
      );
    });

    it("should parse valid XLSX workbooks with Gujarati and English text", () => {
      const wb = XLSX.utils.book_new();
      const wsData = [
        ["Party Name", "Phone", "City"],
        ["શ્રી કૃષ્ણ ટ્રેડર્સ", "9825123456", "અમદાવાદ"],
        ["Maharaja Provision Store", "9898000001", "Surat"],
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, "Parties");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      const parsed = fileParser.parseBuffer(buf, "parties.xlsx");
      expect(parsed.totalRows).toBe(2);
      expect(parsed.headers).toContain("Party Name");
      expect(parsed.headers).toContain("Phone");
      expect(parsed.rows[0]["Party Name"]).toBe("શ્રી કૃષ્ણ ટ્રેડર્સ");
      expect(parsed.rows[1]["Party Name"]).toBe("Maharaja Provision Store");
    });

    it("should parse UTF-8 CSV with special characters", () => {
      const csvStr = `Item Name,SKU,Price\nSunflower Oil,OIL-01,145.00\nFortune Besan 500g,BES-02,55.00\n`;
      const buf = Buffer.from(csvStr, "utf-8");

      const parsed = fileParser.parseBuffer(buf, "items.csv");
      expect(parsed.totalRows).toBe(2);
      expect(parsed.headers).toEqual(["Item Name", "SKU", "Price"]);
      expect(parsed.rows[0]["Item Name"]).toBe("Sunflower Oil");
    });

    it("should sanitize spreadsheet formula injection (=, +, -, @)", () => {
      const badInput = "=cmd|'/C calc'!A0";
      const sanitized = fileParser.sanitizeCellValue(badInput);
      expect(sanitized.startsWith("=")).toBe(false);
      expect(sanitized).toBe("cmd|'/C calc'!A0");

      const atFormula = "@SUM(1+1)";
      expect(fileParser.sanitizeCellValue(atFormula)).toBe("SUM(1+1)");
    });
  });

  // =============================================================
  // 2. COLUMN MAPPING & SYNONYM MATCHING
  // =============================================================
  describe("Column Mapping & Synonym Engine", () => {
    it("should automatically detect exact and synonymous column names", () => {
      const partySchema = schemaRegistry.getSchema(ImportModuleType.PARTIES)!;
      const headers = [
        "Customer Name",
        "Mobile Number",
        "GST No",
        "Town",
        "Opening Outstanding",
      ];

      const mapping = fileParser.detectColumnMapping(headers, partySchema.fields);
      expect(mapping["Customer Name"]).toBe("name");
      expect(mapping["Mobile Number"]).toBe("phone");
      expect(mapping["GST No"]).toBe("gstin");
      expect(mapping["Town"]).toBe("city");
      expect(mapping["Opening Outstanding"]).toBe("openingBalance");
    });

    it("should match Gujarati synonym headers properly", () => {
      const partySchema = schemaRegistry.getSchema(ImportModuleType.PARTIES)!;
      const headers = ["ગ્રાહકનું નામ", "મોબાઈલ", "સરનામું"];

      const mapping = fileParser.detectColumnMapping(headers, partySchema.fields);
      expect(mapping["ગ્રાહકનું નામ"]).toBe("name");
      expect(mapping["મોબાઈલ"]).toBe("phone");
      expect(mapping["સરનામું"]).toBe("addressLine1");
    });

    it("should detect true table headers when file starts with company metadata rows", () => {
      const aoa = [
        ["JK Enterprise"],
        ["GSTIN: 24AAACJ1234F1Z5"],
        ["Items Catalog Export"],
        ["Period: All Time"],
        [], // blank row
        ["Item Name", "SKU / Code", "HSN Code", "Tax Rate (%)", "Selling Price", "Current Stock", "Unit"],
        ["Parle-G 100g", "SKU001", "19053100", "18", "10", "150", "PCS"],
        ["Amul Butter 500g", "SKU002", "04051000", "12", "275", "40", "PCS"],
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      const parsed = fileParser.parseBuffer(buf, "test.xlsx");
      expect(parsed.headers).toContain("Item Name");
      expect(parsed.headers).toContain("SKU / Code");
      expect(parsed.headers).toContain("HSN Code");
      expect(parsed.headers).toContain("Tax Rate (%)");
      expect(parsed.headers).toContain("Selling Price");
      expect(parsed.headers).toContain("Current Stock");
      expect(parsed.headers).toContain("Unit");
      expect(parsed.totalRows).toBe(2);
      expect(parsed.rows[0]["Item Name"]).toBe("Parle-G 100g");

      const itemSchema = schemaRegistry.getSchema(ImportModuleType.ITEMS)!;
      const mapping = fileParser.detectColumnMapping(parsed.headers, itemSchema.fields);
      expect(mapping["Item Name"]).toBe("name");
      expect(mapping["SKU / Code"]).toBe("sku");
      expect(mapping["HSN Code"]).toBe("hsnCode");
      expect(mapping["Tax Rate (%)"]).toBe("taxRate");
      expect(mapping["Selling Price"]).toBe("retailPrice");
      expect(mapping["Current Stock"]).toBe("openingStock");
      expect(mapping["Unit"]).toBe("primaryUom");
    });
  });

  // =============================================================
  // 3. TEMPLATE GENERATION
  // =============================================================
  describe("Downloadable Template Generator", () => {
    it("should generate valid Excel template buffer with headers and descriptions", () => {
      const buf = templateGenerator.generateExcelTemplate(ImportModuleType.ITEMS);
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(100);

      const wb = XLSX.read(buf, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      expect(rows[0]).toContain("Item / Product Name");
      expect(rows[0]).toContain("HSN / SAC Code");
      expect(rows[0]).toContain("GST Tax Rate (%)");
    });

    it("should generate valid CSV template buffer with UTF-8 BOM", () => {
      const buf = templateGenerator.generateCsvTemplate(ImportModuleType.PARTIES);
      const str = buf.toString("utf-8");
      // Starts with UTF-8 BOM
      expect(str.charCodeAt(0)).toBe(0xfeff);
      expect(str).toContain("Party / Business Name");
      expect(str).toContain("Phone / Mobile");
    });
  });

  // =============================================================
  // 4. VALIDATION, STATUTORY CHECKS & DUPLICATE DETECTION
  // =============================================================
  describe("Validation & Duplicate Detection", () => {
    it("should detect missing required fields and mark row invalid", async () => {
      const rawRows = [
        { "Party Name": "", "Mobile": "9825123456" }, // missing name
        { "Party Name": "Valid Store", "Mobile": "9825000000" }, // valid
      ];
      const mapping = {
        "Party Name": "name",
        "Mobile": "phone",
      };

      const preview = await validator.validateDataset(
        sampleTenantCtx,
        ImportModuleType.PARTIES,
        rawRows,
        mapping,
        ImportMode.CREATE_ONLY,
      );

      expect(preview.totalRows).toBe(2);
      expect(preview.validRows).toBe(1);
      expect(preview.invalidRows).toBe(1);
      expect(preview.rows[0].status).toBe("INVALID");
      expect(preview.rows[1].status).toBe("VALID");
    });

    it("should validate Indian GSTIN checksum and warn if check digit is wrong", async () => {
      // 24ABCDE1234F1Z5 has invalid checksum (correct is 6)
      const rawRows = [
        { "Party Name": "Bad GST Store", "Mobile": "9825111222", "GST No": "24ABCDE1234F1Z5" },
      ];
      const mapping = {
        "Party Name": "name",
        "Mobile": "phone",
        "GST No": "gstin",
      };

      const preview = await validator.validateDataset(
        sampleTenantCtx,
        ImportModuleType.PARTIES,
        rawRows,
        mapping,
      );

      expect(preview.rows[0].messages.some((m) => m.includes("checksum mismatch"))).toBe(true);
    });

    it("should detect duplicate records within the same file", async () => {
      const rawRows = [
        { "Item Name": "Colgate Toothpaste 100g", "Code": "COLG-100", "HSN": "3306", "Unit": "PCS", "Rate": "50", "Tax": "18" },
        { "Item Name": "Colgate Toothpaste 100g", "Code": "COLG-100", "HSN": "3306", "Unit": "PCS", "Rate": "50", "Tax": "18" },
      ];
      const mapping = {
        "Item Name": "name",
        "Code": "sku",
        "HSN": "hsnCode",
        "Unit": "primaryUom",
        "Rate": "retailPrice",
        "Tax": "taxRate",
      };

      const preview = await validator.validateDataset(
        sampleTenantCtx,
        ImportModuleType.ITEMS,
        rawRows,
        mapping,
        ImportMode.SKIP_DUPLICATES,
      );

      expect(preview.duplicateRows).toBe(1);
      expect(preview.rows[1].status).toBe("DUPLICATE");
      expect(preview.rows[1].action).toBe("SKIP");
    });
  });

  // =============================================================
  // 5. TRANSACTIONAL EXECUTION & AUDITING
  // =============================================================
  describe("Import Execution & Multi-Tenant Boundaries", () => {
    it("should execute party import and record audit log with tenant isolation", async () => {
      const previews = [
        {
          rowNumber: 2,
          data: {
            name: "New Provision Store",
            phone: "9825999888",
            gstin: "24AAAAA0000A1Z5",
            stateCode: "24",
            addressLine1: "Market Yard",
            city: "Rajkot",
            pincode: "360001",
            creditLimit: "50000",
            creditDays: "15",
            openingBalance: "12500",
            openingBalanceType: "DR",
          },
          status: "VALID" as const,
          action: "CREATE" as const,
          messages: [],
        },
      ];

      const result = await executor.executeImport(
        sampleTenantCtx,
        "job-123",
        ImportModuleType.PARTIES,
        previews,
        ImportMode.CREATE_ONLY,
        ImportErrorPolicy.IMPORT_VALID_ONLY,
      );

      expect(result.status).toBe("COMPLETED");
      expect(result.importedRows).toBe(1);
      expect(result.failedRows).toBe(0);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: sampleTenantCtx.organizationId,
          companyId: sampleTenantCtx.companyId,
          action: "DATA_IMPORT_EXECUTED",
        }),
      );
    });

    it("should abort transaction when error policy is ABORT_ON_ERROR and invalid rows exist", async () => {
      const previews = [
        {
          rowNumber: 2,
          data: { name: "Bad Row" },
          status: "INVALID" as const,
          action: "FAIL" as const,
          messages: ["Missing required phone number"],
        },
      ];

      await expect(
        executor.executeImport(
          sampleTenantCtx,
          "job-abort-test",
          ImportModuleType.PARTIES,
          previews,
          ImportMode.CREATE_ONLY,
          ImportErrorPolicy.ABORT_ON_ERROR,
        ),
      ).rejects.toThrow("Import was aborted because one or more rows are invalid");
    });
  });

  // =============================================================
  // 6. ERROR REPORT GENERATION
  // =============================================================
  describe("Diagnostic Error Reporting", () => {
    it("should produce downloadable CSV error report with row numbers and Gujarati descriptions", () => {
      const errors = [
        {
          rowNumber: 4,
          field: "phone",
          column: "Mobile Number",
          providedValue: "123",
          errorCode: "INVALID_PHONE",
          errorMessage: "Phone number must be 10 digits.",
          errorMessageGujarati: "મોબાઈલ નંબર ૧૦ અંકનો હોવો જોઈએ.",
          isBlocking: true,
          actionTaken: "FAILED" as const,
        },
      ];

      const buf = errorReporter.generateCsvErrorReport("job-99", "parties", errors);
      const str = buf.toString("utf-8");
      expect(str).toContain("Row Number");
      expect(str).toContain("Phone number must be 10 digits.");
      expect(str).toContain("INVALID_PHONE");
    });
  });
});
