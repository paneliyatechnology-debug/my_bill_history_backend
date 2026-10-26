import { Injectable, BadRequestException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { ImportSchemaRegistry } from "./import-schema.registry";
import { FileParserService } from "./file-parser.service";
import {
  ImportErrorRow,
  ImportMode,
  ImportModuleSchema,
  ImportModuleType,
  ImportPreviewResult,
  ImportRowPreview,
  TenantContext,
} from "@billing/shared-types";
import {
  calculateGstinChecksum,
  INDIAN_STATES,
  isValidStateCode,
} from "../common/validators/gstin.validator";

export interface ValidationContext {
  existingPartiesByPhone: Map<string, any>;
  existingPartiesByGstin: Map<string, any>;
  existingPartiesByName: Map<string, any>;
  existingItemsBySku: Map<string, any>;
  existingItemsByBarcode: Map<string, any>;
  existingItemsByName: Map<string, any>;
  existingUomsBySymbol: Map<string, any>;
  existingCategoriesByName: Map<string, any>;
  existingWarehousesByName: Map<string, any>;
  existingLedgerAccountsByName: Map<string, any>;
  existingSalesInvoicesByNo: Set<string>;
  existingPurchaseInvoicesByNo: Set<string>;
}

@Injectable()
export class ImportValidatorService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly schemaRegistry: ImportSchemaRegistry,
    private readonly fileParser: FileParserService,
  ) {}

  /**
   * Validate uploaded dataset against module schema, business invariants, and DB uniqueness
   */
  async validateDataset(
    ctx: TenantContext,
    moduleType: ImportModuleType | string,
    rawRows: Record<string, any>[],
    columnMapping: Record<string, string>,
    mode: ImportMode = ImportMode.SKIP_DUPLICATES,
  ): Promise<ImportPreviewResult> {
    const schema = this.schemaRegistry.getSchema(moduleType);
    if (!schema) {
      throw new BadRequestException({
        statusCode: 400,
        message: `Schema for module '${moduleType}' is not registered.`,
      });
    }

    // 1. Invert mapping: { fieldKey: spreadsheetHeader }
    const fieldToHeaderMap: Record<string, string> = {};
    Object.entries(columnMapping).forEach(([header, fieldKey]) => {
      if (fieldKey) {
        fieldToHeaderMap[fieldKey] = header;
      }
    });

    // 2. Check unmapped required fields
    const missingRequiredFields = schema.fields
      .filter((f) => f.required && !fieldToHeaderMap[f.key])
      .map((f) => f.label);

    if (missingRequiredFields.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: "MISSING_REQUIRED_MAPPING",
        message: `Missing required field mappings: ${missingRequiredFields.join(", ")}. Please map these fields before validating.`,
        messageGujarati: `જરૂરી કોલમ મેપિંગ બાકી છે: ${missingRequiredFields.join(", ")}.`,
      });
    }

    // 3. Pre-load company reference data for lightning-fast in-memory matching & foreign key checks
    const valCtx = await this.loadValidationContext(ctx, schema.module);

    const previews: ImportRowPreview[] = [];
    const errors: ImportErrorRow[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    let warningCount = 0;

    let newRecordsCount = 0;
    let updateRecordsCount = 0;
    let skipRecordsCount = 0;
    let failedRecordsCount = 0;

    // Track within-file duplicates
    const seenFileIdentifiers = new Set<string>();

    for (const rawRow of rawRows) {
      const rowNum = rawRow._rowNumber || (previews.length + 2);
      const mappedData: Record<string, any> = {};

      schema.fields.forEach((f) => {
        const header = fieldToHeaderMap[f.key];
        const val = header ? rawRow[header] : undefined;
        mappedData[f.key] = val !== undefined && val !== null ? String(val).trim() : "";
      });

      const rowMessages: string[] = [];
      let isRowValid = true;
      let isDuplicate = false;
      let matchedExistingId: string | undefined;
      let matchedExistingName: string | undefined;

      // 4. Validate required values
      for (const f of schema.fields) {
        const val = mappedData[f.key];
        if (f.required && (val === undefined || val === null || val === "")) {
          isRowValid = false;
          rowMessages.push(`Missing required field '${f.label}'`);
          errors.push({
            rowNumber: rowNum,
            field: f.key,
            column: fieldToHeaderMap[f.key] || f.label,
            errorCode: "REQUIRED_FIELD_MISSING",
            errorMessage: `Required field '${f.label}' is empty.`,
            errorMessageGujarati: `'${f.labelGujarati}' ખાલી છે.`,
            isBlocking: true,
            actionTaken: "FAILED",
          });
        }
      }

      // 5. Data type & Statutory checks
      this.validateDataTypesAndStatutory(schema, mappedData, rowNum, rowMessages, errors);
      if (rowMessages.some((m) => m.includes("Invalid") || m.includes("Required"))) {
        isRowValid = false;
      }

      // 6. Within-file duplicate check
      const identifierVal = mappedData[schema.identifierField];
      if (identifierVal) {
        const fileKey = `${schema.module}:${String(identifierVal).toLowerCase()}`;
        if (seenFileIdentifiers.has(fileKey)) {
          isDuplicate = true;
          rowMessages.push(`Duplicate within file for ${schema.identifierField} '${identifierVal}'`);
        } else {
          seenFileIdentifiers.add(fileKey);
        }
      }

      // 7. Check database duplicates & existing records
      const matchResult = this.checkDatabaseDuplicates(schema.module, mappedData, valCtx);
      if (matchResult.isMatched) {
        isDuplicate = true;
        matchedExistingId = matchResult.existingId;
        matchedExistingName = matchResult.existingName;
        rowMessages.push(`Matches existing record in your company: '${matchResult.existingName}'`);
      }

      // 8. Determine final suggested action based on mode
      let action: "CREATE" | "UPDATE" | "SKIP" | "FAIL" = "CREATE";
      let status: "VALID" | "WARNING" | "INVALID" | "DUPLICATE" = "VALID";

      if (!isRowValid) {
        status = "INVALID";
        action = "FAIL";
        invalidCount++;
        failedRecordsCount++;
      } else if (isDuplicate) {
        status = "DUPLICATE";
        duplicateCount++;
        if (mode === ImportMode.UPDATE_EXISTING) {
          action = "UPDATE";
          updateRecordsCount++;
          validCount++;
        } else if (mode === ImportMode.SKIP_DUPLICATES) {
          action = "SKIP";
          skipRecordsCount++;
        } else {
          // CREATE_ONLY fails on duplicates
          status = "INVALID";
          action = "FAIL";
          invalidCount++;
          failedRecordsCount++;
          rowMessages.push("Duplicate record rejected under 'Create New Only' mode.");
        }
      } else {
        status = "VALID";
        action = "CREATE";
        validCount++;
        newRecordsCount++;
      }

      if (rowMessages.some((m) => m.includes("auto-create") || m.includes("warning"))) {
        warningCount++;
      }

      previews.push({
        rowNumber: rowNum,
        data: mappedData,
        status,
        action,
        messages: rowMessages,
        matchedExistingId,
        matchedExistingName,
      });
    }

    return {
      jobId: "",
      module: schema.module,
      totalRows: rawRows.length,
      validRows: validCount,
      invalidRows: invalidCount,
      duplicateRows: duplicateCount,
      warningCount,
      rows: previews,
      summary: {
        newRecords: newRecordsCount,
        updateRecords: updateRecordsCount,
        skipRecords: skipRecordsCount,
        failedRecords: failedRecordsCount,
      },
    };
  }

  private validateDataTypesAndStatutory(
    schema: ImportModuleSchema,
    data: Record<string, any>,
    rowNum: number,
    messages: string[],
    errors: ImportErrorRow[],
  ) {
    // GSTIN check
    if (data.gstin) {
      const cleanGstin = String(data.gstin).trim().toUpperCase();
      if (cleanGstin.length !== 15) {
        messages.push(`Invalid GSTIN '${cleanGstin}' (must be 15 characters)`);
        errors.push({
          rowNumber: rowNum,
          field: "gstin",
          errorCode: "INVALID_GSTIN_LENGTH",
          errorMessage: `GSTIN '${cleanGstin}' must be exactly 15 characters.`,
          isBlocking: false,
          actionTaken: "WARNING",
        });
      } else {
        const statePrefix = cleanGstin.substring(0, 2);
        if (!isValidStateCode(statePrefix)) {
          messages.push(`Invalid GSTIN state code '${statePrefix}'`);
        } else {
          const calcCheck = calculateGstinChecksum(cleanGstin);
          if (calcCheck && calcCheck !== cleanGstin[14]) {
            messages.push(`GSTIN checksum mismatch (expected ${calcCheck}, found ${cleanGstin[14]})`);
          }
        }
      }
    }

    // Number checks
    schema.fields.forEach((f) => {
      if (f.type === "number" && data[f.key]) {
        const num = this.fileParser.parseNumberValue(data[f.key], NaN);
        if (isNaN(num)) {
          messages.push(`Invalid number in '${f.label}'`);
        }
      }
    });

    // Date checks
    schema.fields.forEach((f) => {
      if (f.type === "date" && data[f.key]) {
        const d = this.fileParser.parseDateValue(data[f.key]);
        if (!d) {
          messages.push(`Invalid date in '${f.label}' (use DD/MM/YYYY)`);
        }
      }
    });

    // Enum checks
    schema.fields.forEach((f) => {
      if (f.type === "enum" && f.enumValues && data[f.key]) {
        const clean = String(data[f.key]).trim().toUpperCase();
        if (!f.enumValues.includes(clean)) {
          messages.push(`Invalid choice in '${f.label}'. Allowed: ${f.enumValues.join(", ")}`);
        }
      }
    });
  }

  private async loadValidationContext(
    ctx: TenantContext,
    moduleType: ImportModuleType,
  ): Promise<ValidationContext> {
    const valCtx: ValidationContext = {
      existingPartiesByPhone: new Map(),
      existingPartiesByGstin: new Map(),
      existingPartiesByName: new Map(),
      existingItemsBySku: new Map(),
      existingItemsByBarcode: new Map(),
      existingItemsByName: new Map(),
      existingUomsBySymbol: new Map(),
      existingCategoriesByName: new Map(),
      existingWarehousesByName: new Map(),
      existingLedgerAccountsByName: new Map(),
      existingSalesInvoicesByNo: new Set(),
      existingPurchaseInvoicesByNo: new Set(),
    };

    await this.prisma.executeBypassRls(async (tx) => {
      if (
        [
          ImportModuleType.PARTIES,
          ImportModuleType.CUSTOMERS,
          ImportModuleType.SUPPLIERS,
          ImportModuleType.SALES_INVOICES,
          ImportModuleType.PURCHASE_INVOICES,
          ImportModuleType.DELIVERY_CHALLANS,
        ].includes(moduleType)
      ) {
        const parties = await tx.party.findMany({
          where: { companyId: ctx.companyId },
          select: { id: true, name: true, phone: true, gstin: true },
        });
        parties.forEach((p) => {
          if (p.phone) valCtx.existingPartiesByPhone.set(p.phone.trim(), p);
          if (p.gstin) valCtx.existingPartiesByGstin.set(p.gstin.trim().toUpperCase(), p);
          valCtx.existingPartiesByName.set(p.name.trim().toLowerCase(), p);
        });
      }

      if (
        [
          ImportModuleType.ITEMS,
          ImportModuleType.SERVICES,
          ImportModuleType.ITEM_BATCHES,
          ImportModuleType.SALES_INVOICES,
          ImportModuleType.PURCHASE_INVOICES,
          ImportModuleType.DELIVERY_CHALLANS,
          ImportModuleType.BILL_OF_MATERIALS,
        ].includes(moduleType)
      ) {
        const items = await tx.item.findMany({
          where: { companyId: ctx.companyId },
          select: { id: true, name: true, sku: true, barcode: true },
        });
        items.forEach((it) => {
          if (it.sku) valCtx.existingItemsBySku.set(it.sku.trim().toLowerCase(), it);
          if (it.barcode) valCtx.existingItemsByBarcode.set(it.barcode.trim(), it);
          valCtx.existingItemsByName.set(it.name.trim().toLowerCase(), it);
        });

        const uoms = await tx.unitOfMeasure.findMany({
          where: { companyId: ctx.companyId },
          select: { id: true, symbol: true, name: true },
        });
        uoms.forEach((u) => valCtx.existingUomsBySymbol.set(u.symbol.trim().toUpperCase(), u));

        const cats = await tx.itemCategory.findMany({
          where: { companyId: ctx.companyId },
          select: { id: true, name: true },
        });
        cats.forEach((c) => valCtx.existingCategoriesByName.set(c.name.trim().toLowerCase(), c));
      }

      if (
        [
          ImportModuleType.WAREHOUSES,
          ImportModuleType.ITEMS,
          ImportModuleType.OPENING_STOCK,
        ].includes(moduleType)
      ) {
        const whs = await tx.warehouse.findMany({
          where: { companyId: ctx.companyId },
          select: { id: true, name: true },
        });
        whs.forEach((w) => valCtx.existingWarehousesByName.set(w.name.trim().toLowerCase(), w));
      }

      if (
        [
          ImportModuleType.LEDGER_ACCOUNTS,
          ImportModuleType.JOURNAL_VOUCHERS,
        ].includes(moduleType)
      ) {
        const accounts = await tx.ledgerAccount.findMany({
          where: { companyId: ctx.companyId },
          select: { id: true, name: true },
        });
        accounts.forEach((a) => valCtx.existingLedgerAccountsByName.set(a.name.trim().toLowerCase(), a));
      }

      if (moduleType === ImportModuleType.SALES_INVOICES) {
        const invoices = await tx.salesInvoice.findMany({
          where: { companyId: ctx.companyId },
          select: { invoiceNumber: true },
        });
        invoices.forEach((inv) => valCtx.existingSalesInvoicesByNo.add(inv.invoiceNumber.trim().toLowerCase()));
      }

      if (moduleType === ImportModuleType.PURCHASE_INVOICES) {
        const bills = await tx.purchaseInvoice.findMany({
          where: { companyId: ctx.companyId },
          select: { vendorInvoiceNumber: true },
        });
        bills.forEach((b) => valCtx.existingPurchaseInvoicesByNo.add(b.vendorInvoiceNumber.trim().toLowerCase()));
      }
    });

    return valCtx;
  }

  private checkDatabaseDuplicates(
    moduleType: ImportModuleType,
    data: Record<string, any>,
    valCtx: ValidationContext,
  ): { isMatched: boolean; existingId?: string; existingName?: string } {
    if (
      moduleType === ImportModuleType.PARTIES ||
      moduleType === ImportModuleType.CUSTOMERS ||
      moduleType === ImportModuleType.SUPPLIERS
    ) {
      if (data.gstin && valCtx.existingPartiesByGstin.has(String(data.gstin).trim().toUpperCase())) {
        const p = valCtx.existingPartiesByGstin.get(String(data.gstin).trim().toUpperCase());
        return { isMatched: true, existingId: p.id, existingName: p.name };
      }
      if (data.phone && valCtx.existingPartiesByPhone.has(String(data.phone).trim())) {
        const p = valCtx.existingPartiesByPhone.get(String(data.phone).trim());
        return { isMatched: true, existingId: p.id, existingName: p.name };
      }
      if (data.name && valCtx.existingPartiesByName.has(String(data.name).trim().toLowerCase())) {
        const p = valCtx.existingPartiesByName.get(String(data.name).trim().toLowerCase());
        return { isMatched: true, existingId: p.id, existingName: p.name };
      }
    }

    if (moduleType === ImportModuleType.ITEMS || moduleType === ImportModuleType.SERVICES) {
      if (data.sku && valCtx.existingItemsBySku.has(String(data.sku).trim().toLowerCase())) {
        const it = valCtx.existingItemsBySku.get(String(data.sku).trim().toLowerCase());
        return { isMatched: true, existingId: it.id, existingName: it.name };
      }
      if (data.barcode && valCtx.existingItemsByBarcode.has(String(data.barcode).trim())) {
        const it = valCtx.existingItemsByBarcode.get(String(data.barcode).trim());
        return { isMatched: true, existingId: it.id, existingName: it.name };
      }
      if (data.name && valCtx.existingItemsByName.has(String(data.name).trim().toLowerCase())) {
        const it = valCtx.existingItemsByName.get(String(data.name).trim().toLowerCase());
        return { isMatched: true, existingId: it.id, existingName: it.name };
      }
    }

    if (moduleType === ImportModuleType.UNITS_OF_MEASURE) {
      const sym = String(data.symbol || "").trim().toUpperCase();
      if (valCtx.existingUomsBySymbol.has(sym)) {
        const u = valCtx.existingUomsBySymbol.get(sym);
        return { isMatched: true, existingId: u.id, existingName: u.name };
      }
    }

    if (moduleType === ImportModuleType.ITEM_CATEGORIES) {
      const name = String(data.name || "").trim().toLowerCase();
      if (valCtx.existingCategoriesByName.has(name)) {
        const c = valCtx.existingCategoriesByName.get(name);
        return { isMatched: true, existingId: c.id, existingName: c.name };
      }
    }

    if (moduleType === ImportModuleType.WAREHOUSES) {
      const name = String(data.name || "").trim().toLowerCase();
      if (valCtx.existingWarehousesByName.has(name)) {
        const w = valCtx.existingWarehousesByName.get(name);
        return { isMatched: true, existingId: w.id, existingName: w.name };
      }
    }

    if (moduleType === ImportModuleType.LEDGER_ACCOUNTS) {
      const name = String(data.name || "").trim().toLowerCase();
      if (valCtx.existingLedgerAccountsByName.has(name)) {
        const a = valCtx.existingLedgerAccountsByName.get(name);
        return { isMatched: true, existingId: a.id, existingName: a.name };
      }
    }

    if (moduleType === ImportModuleType.SALES_INVOICES) {
      const invNo = String(data.invoiceNumber || "").trim().toLowerCase();
      if (valCtx.existingSalesInvoicesByNo.has(invNo)) {
        return { isMatched: true, existingName: data.invoiceNumber };
      }
    }

    if (moduleType === ImportModuleType.PURCHASE_INVOICES) {
      const billNo = String(data.vendorInvoiceNumber || "").trim().toLowerCase();
      if (valCtx.existingPurchaseInvoicesByNo.has(billNo)) {
        return { isMatched: true, existingName: data.vendorInvoiceNumber };
      }
    }

    return { isMatched: false };
  }
}
