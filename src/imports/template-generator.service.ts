import { Injectable, BadRequestException } from "@nestjs/common";
import * as XLSX from "xlsx";
import { ImportSchemaRegistry } from "./import-schema.registry";
import { ImportModuleType } from "@billing/shared-types";

@Injectable()
export class TemplateGeneratorService {
  constructor(private readonly schemaRegistry: ImportSchemaRegistry) {}

  /**
   * Generate an Excel (.xlsx) template buffer for the specified module
   */
  generateExcelTemplate(moduleType: ImportModuleType | string): Buffer {
    const schema = this.schemaRegistry.getSchema(moduleType);
    if (!schema) {
      throw new BadRequestException({
        statusCode: 400,
        message: `Unknown module '${moduleType}'. Cannot generate template.`,
      });
    }

    const headers = schema.fields.map((f) => f.label);
    const sampleRow = schema.fields.map((f) => f.sampleValue ?? "");

    // Sheet 1: Data Entry Sheet
    const dataSheet = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
    const colWidths = schema.fields.map((f) => {
      const maxLen = Math.max(f.label.length, String(f.sampleValue || "").length, 16);
      return { wch: Math.min(maxLen + 4, 38) };
    });
    dataSheet["!cols"] = colWidths;

    // Sheet 2: Field Guide & Instructions Sheet
    const guideHeaders = [
      "Field Name (English)",
      "Field Name (Gujarati)",
      "Required / Mandatory",
      "Data Type",
      "Field Description",
      "Example Value",
    ];
    const guideRows = schema.fields.map((f) => [
      f.label,
      f.labelGujarati,
      f.required ? "YES (Required)" : "NO (Optional)",
      f.type.toUpperCase(),
      f.description,
      f.sampleValue !== undefined && f.sampleValue !== null ? String(f.sampleValue) : "",
    ]);
    const guideSheet = XLSX.utils.aoa_to_sheet([guideHeaders, ...guideRows]);
    guideSheet["!cols"] = [
      { wch: 26 },
      { wch: 26 },
      { wch: 18 },
      { wch: 14 },
      { wch: 45 },
      { wch: 22 },
    ];

    const workbook = XLSX.utils.book_new();
    const mainSheetName = (schema.title || "Data").substring(0, 31).replace(/[\\/?*[\]]/g, "");
    XLSX.utils.book_append_sheet(workbook, dataSheet, mainSheetName);
    XLSX.utils.book_append_sheet(workbook, guideSheet, "Field Guide & Instructions");

    // Write to buffer
    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
      compression: true,
    });

    return buffer;
  }

  /**
   * Generate a CSV (.csv) template buffer with UTF-8 BOM
   */
  generateCsvTemplate(moduleType: ImportModuleType | string): Buffer {
    const schema = this.schemaRegistry.getSchema(moduleType);
    if (!schema) {
      throw new BadRequestException({
        statusCode: 400,
        message: `Unknown module '${moduleType}'. Cannot generate template.`,
      });
    }

    const headers = schema.fields.map((f) => `"${f.label.replace(/"/g, '""')}"`);
    const sampleValues = schema.fields.map((f) => {
      const val = f.sampleValue !== undefined && f.sampleValue !== null ? String(f.sampleValue) : "";
      return `"${val.replace(/"/g, '""')}"`;
    });

    // UTF-8 BOM (\uFEFF) ensures Excel opens Gujarati and special characters properly
    const csvContent = "\uFEFF" + headers.join(",") + "\n" + sampleValues.join(",") + "\n";
    return Buffer.from(csvContent, "utf-8");
  }
}
