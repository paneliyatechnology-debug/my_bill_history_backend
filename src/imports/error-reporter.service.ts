import { Injectable } from "@nestjs/common";
import * as XLSX from "xlsx";
import { ImportErrorRow } from "@billing/shared-types";

@Injectable()
export class ErrorReporterService {
  /**
   * Generate an Excel (.xlsx) diagnostic error workbook for failed import rows
   */
  generateExcelErrorReport(
    jobId: string,
    moduleName: string,
    errors: ImportErrorRow[],
  ): Buffer {
    const headers = [
      "Row Number",
      "Field / Column",
      "Provided Value",
      "Error Code",
      "Error Message",
      "ગુજરાતી વિગત",
      "Action Taken",
    ];

    const rows = (errors || []).map((err) => [
      err.rowNumber,
      err.column || err.field || "General",
      err.providedValue !== undefined ? String(err.providedValue) : "",
      err.errorCode || "VALIDATION_ERROR",
      err.errorMessage,
      err.errorMessageGujarati || "",
      err.actionTaken || "FAILED",
    ]);

    const wsData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(wsData);

    // Auto widths
    worksheet["!cols"] = [
      { wch: 12 },
      { wch: 20 },
      { wch: 20 },
      { wch: 22 },
      { wch: 45 },
      { wch: 45 },
      { wch: 15 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Import Errors");

    return XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
      compression: true,
    });
  }

  /**
   * Generate a CSV (.csv) diagnostic error report with UTF-8 BOM
   */
  generateCsvErrorReport(
    jobId: string,
    moduleName: string,
    errors: ImportErrorRow[],
  ): Buffer {
    const headers = [
      "Row Number",
      "Field / Column",
      "Provided Value",
      "Error Code",
      "Error Message",
      "Action Taken",
    ];

    const csvLines = [headers.map((h) => `"${h}"`).join(",")];

    (errors || []).forEach((err) => {
      const line = [
        err.rowNumber,
        `"${(err.column || err.field || "General").replace(/"/g, '""')}"`,
        `"${String(err.providedValue ?? "").replace(/"/g, '""')}"`,
        `"${(err.errorCode || "VALIDATION_ERROR").replace(/"/g, '""')}"`,
        `"${(err.errorMessage || "").replace(/"/g, '""')}"`,
        `"${(err.actionTaken || "FAILED").replace(/"/g, '""')}"`,
      ];
      csvLines.push(line.join(","));
    });

    // UTF-8 BOM
    const content = "\uFEFF" + csvLines.join("\n") + "\n";
    return Buffer.from(content, "utf-8");
  }
}
