import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import * as XLSX from "xlsx";
import { ImportFieldDefinition } from "@billing/shared-types";

export interface ParsedSheetData {
  worksheets: string[];
  selectedWorksheet: string;
  headers: string[];
  rows: Record<string, any>[];
  totalRows: number;
}

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);
  private readonly maxRows = 5000;
  private readonly maxFileSize = 15 * 1024 * 1024; // 15MB

  /**
   * Parse uploaded file buffer (XLSX, XLS, CSV) into normalized sheet data
   */
  parseBuffer(
    buffer: Buffer,
    fileName: string,
    targetWorksheet?: string,
  ): ParsedSheetData {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: "EMPTY_FILE",
        message: "The uploaded file is empty. Please upload a valid Excel (.xlsx) or CSV (.csv) file.",
        messageGujarati: "અપલોડ કરેલી ફાઇલ ખાલી છે. કૃપા કરીને માન્ય એક્સેલ અથવા સીએસવી ફાઇલ અપલોડ કરો.",
      });
    }

    if (buffer.length > this.maxFileSize) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: "FILE_TOO_LARGE",
        message: `File size exceeds the 15 MB limit. Received: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB.`,
        messageGujarati: "ફાઇલ સાઇઝ ૧૫ MB કરતાં વધુ છે.",
      });
    }

    let workbook: XLSX.WorkBook;
    try {
      // Read with UTF-8 support and raw date parsing
      workbook = XLSX.read(buffer, {
        type: "buffer",
        cellDates: true,
        cellText: false,
        raw: false,
        codepage: 65001, // UTF-8
      });
    } catch (err: any) {
      this.logger.warn(`Failed to parse workbook '${fileName}': ${err.message}`);
      throw new BadRequestException({
        statusCode: 400,
        errorCode: "MALFORMED_WORKBOOK",
        message: "Could not read the uploaded spreadsheet. Ensure it is a valid, uncorrupted .xlsx, .xls, or .csv file.",
        messageGujarati: "સ્પ્રેડશીટ વાંચી શકાઈ નથી. ખાતરી કરો કે ફાઇલ બગડેલી નથી.",
      });
    }

    const worksheets = workbook.SheetNames || [];
    if (worksheets.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: "NO_WORKSHEETS",
        message: "The uploaded spreadsheet contains no worksheets.",
        messageGujarati: "સ્પ્રેડશીટમાં કોઈ વર્કશીટ મળેલ નથી.",
      });
    }

    const selectedWorksheet = targetWorksheet && worksheets.includes(targetWorksheet)
      ? targetWorksheet
      : worksheets[0];

    const sheet = workbook.Sheets[selectedWorksheet];
    if (!sheet) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: "INVALID_WORKSHEET",
        message: `Worksheet '${selectedWorksheet}' not found in the uploaded workbook.`,
        messageGujarati: `વર્કશીટ '${selectedWorksheet}' મળી નથી.`,
      });
    }

    // Convert sheet to 2D array of cells so we can inspect and find the true header row
    const rawMatrix: any[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
      dateNF: "dd/mm/yyyy",
      blankrows: false,
    });

    if (rawMatrix.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: "EMPTY_DATASET",
        message: `Worksheet '${selectedWorksheet}' has no data rows to import.`,
        messageGujarati: `પસંદ કરેલ વર્કશીટમાં આયાત કરવા માટે કોઈ ડેટા નથી.`,
      });
    }

    // 1. SMART HEADER ROW DETECTION:
    // Files exported from ERP/billing software often have company metadata rows (Company name, GSTIN, Title, blank lines)
    // before the actual table header. Scan the first 25 rows to identify the row with the best header characteristics.
    let bestHeaderRowIdx = 0;
    let maxHeaderScore = -1;

    for (let r = 0; r < Math.min(rawMatrix.length, 25); r++) {
      const row = rawMatrix[r];
      if (!Array.isArray(row)) continue;

      const nonBlankCells = row.filter((c) => c !== undefined && c !== null && String(c).trim().length > 0);
      const textCells = row.filter(
        (c) => typeof c === "string" && c.trim().length > 0 && isNaN(Number(c.trim())),
      );

      // Scoring criteria:
      // Single-cell rows (e.g. ["JK Enterprise"]) have high penalty
      // Multiple text columns indicate tabular headers
      let score = 0;
      if (textCells.length >= 2) {
        score = textCells.length * 3 + nonBlankCells.length;
      } else if (nonBlankCells.length > 1) {
        score = nonBlankCells.length;
      } else {
        score = -5; // Single cell title row
      }

      // Bonus if row contains common accounting/billing header terms
      const rowStr = row.map((c) => String(c).toLowerCase()).join(" ");
      const commonTerms = [
        "name", "code", "sku", "item", "party", "customer", "supplier",
        "gst", "gstin", "phone", "mobile", "hsn", "qty", "quantity", "stock",
        "price", "rate", "amount", "total", "balance", "unit", "uom", "date",
        "નામ", "કોડ", "ભાવ", "એકમ", "સ્ટોક", "બાકી", "બિલ", "તારીખ"
      ];
      for (const term of commonTerms) {
        if (rowStr.includes(term)) score += 2;
      }

      if (score > maxHeaderScore) {
        maxHeaderScore = score;
        bestHeaderRowIdx = r;
      }
    }

    const headerRow = rawMatrix[bestHeaderRowIdx] || [];

    // Find the maximum columns across headers and following data rows
    let maxCols = headerRow.length;
    for (let r = bestHeaderRowIdx; r < Math.min(bestHeaderRowIdx + 50, rawMatrix.length); r++) {
      if (rawMatrix[r] && rawMatrix[r].length > maxCols) {
        maxCols = rawMatrix[r].length;
      }
    }

    // 2. BUILD CLEAN HEADERS
    const headers: string[] = [];
    const seenHeaders = new Map<string, number>();

    for (let colIdx = 0; colIdx < maxCols; colIdx++) {
      let rawHeader = String(headerRow[colIdx] || "").trim();

      // If header is empty or undefined, check if any row below has data
      if (!rawHeader) {
        const hasDataBelow = rawMatrix
          .slice(bestHeaderRowIdx + 1, bestHeaderRowIdx + 15)
          .some((r) => r[colIdx] !== undefined && r[colIdx] !== null && String(r[colIdx]).trim().length > 0);

        if (hasDataBelow) {
          rawHeader = `Column ${colIdx + 1}`;
        } else {
          continue; // Empty column with no data below
        }
      }

      // Handle duplicate header names (e.g. "Rate", "Rate (2)")
      const baseKey = rawHeader.toLowerCase();
      let uniqueHeader = rawHeader;
      if (seenHeaders.has(baseKey)) {
        const count = seenHeaders.get(baseKey)! + 1;
        seenHeaders.set(baseKey, count);
        uniqueHeader = `${rawHeader} (${count})`;
      } else {
        seenHeaders.set(baseKey, 1);
      }

      headers.push(uniqueHeader);
    }

    // 3. EXTRACT AND SANITIZE DATA ROWS
    const rawDataRows = rawMatrix.slice(bestHeaderRowIdx + 1);
    const sanitizedRows: Record<string, any>[] = [];

    rawDataRows.forEach((row, rowOffset) => {
      if (!Array.isArray(row)) return;

      // Check if completely blank row
      const isCompletelyBlank = row.every(
        (cell) => cell === undefined || cell === null || String(cell).trim().length === 0,
      );
      if (isCompletelyBlank) return;

      // Check if this is a template guidance/type row (e.g. "REQUIRED (STRING)")
      const firstCellStr = String(row[0] || "").trim().toUpperCase();
      if (
        firstCellStr.includes("REQUIRED (") ||
        firstCellStr.includes("OPTIONAL (") ||
        firstCellStr === "MANDATORY"
      ) {
        return; // Skip template guidance row
      }

      // Check if this is a summary/total row at the bottom
      if (
        firstCellStr === "TOTAL" ||
        firstCellStr === "GRAND TOTAL" ||
        firstCellStr === "SUBTOTAL" ||
        firstCellStr === "કુલ"
      ) {
        return; // Skip summary totals row
      }

      const cleanRow: Record<string, any> = {};
      headers.forEach((h, colIdx) => {
        const rawVal = row[colIdx];
        cleanRow[h] = this.sanitizeCellValue(rawVal);
      });

      // SpreadSheet 1-indexed row number
      cleanRow._rowNumber = bestHeaderRowIdx + rowOffset + 2;
      sanitizedRows.push(cleanRow);
    });

    if (sanitizedRows.length > this.maxRows) {
      throw new BadRequestException({
        statusCode: 400,
        errorCode: "ROW_LIMIT_EXCEEDED",
        message: `Worksheet exceeds the maximum limit of ${this.maxRows} rows per import batch. Received: ${sanitizedRows.length} rows. Please split your file into smaller batches.`,
        messageGujarati: `વર્કશીટમાં ${this.maxRows} કરતાં વધુ લાઈનો છે (મળેલ: ${sanitizedRows.length}). કૃપા કરીને ફાઇલને નાના ભાગોમાં વહેંચો.`,
      });
    }

    return {
      worksheets,
      selectedWorksheet,
      headers,
      rows: sanitizedRows,
      totalRows: sanitizedRows.length,
    };
  }

  /**
   * Formula injection protection:
   * Strips dangerous formula prefixes `=, +, -, @, \t, \r` from raw spreadsheet cells
   */
  sanitizeCellValue(val: any): any {
    if (val === null || val === undefined) return "";
    if (typeof val === "string") {
      let trimmed = val.trim();
      // If starts with formula trigger characters, neutralize formula execution
      if (/^[=+\-@\t\r]/.test(trimmed)) {
        trimmed = trimmed.replace(/^[=+\-@\t\r]+/, "").trim();
      }
      return trimmed;
    }
    return val;
  }

  /**
   * Intelligently auto-match spreadsheet columns to module field keys with multi-pass matching
   */
  detectColumnMapping(
    spreadsheetHeaders: string[],
    fieldDefinitions: ImportFieldDefinition[],
  ): Record<string, string> {
    const mapping: Record<string, string> = {}; // { spreadsheetHeader: fieldKey }
    const assignedFields = new Set<string>();

    const normalize = (str: string) =>
      str
        .toLowerCase()
        .replace(/[^a-z0-9\u0A80-\u0AFF]+/g, " ")
        .trim();

    // PASS 1: Exact key, label, labelGujarati or synonym match
    for (const header of spreadsheetHeaders) {
      const cleanHeader = normalize(header);
      if (!cleanHeader) continue;

      for (const field of fieldDefinitions) {
        if (assignedFields.has(field.key)) continue;

        const fieldKeyClean = normalize(field.key);
        const fieldLabelClean = normalize(field.label);
        const fieldLabelGujClean = normalize(field.labelGujarati);

        if (
          cleanHeader === fieldKeyClean ||
          cleanHeader === fieldLabelClean ||
          cleanHeader === fieldLabelGujClean
        ) {
          mapping[header] = field.key;
          assignedFields.add(field.key);
          break;
        }

        // Check exact synonyms
        let matchedSyn = false;
        for (const syn of field.synonyms) {
          if (cleanHeader === normalize(syn)) {
            mapping[header] = field.key;
            assignedFields.add(field.key);
            matchedSyn = true;
            break;
          }
        }
        if (matchedSyn) break;
      }
    }

    // PASS 2: Token / Word boundary match (e.g. "SKU / Code" matches "sku", "Tax Rate (%)" matches "tax rate")
    for (const header of spreadsheetHeaders) {
      if (mapping[header]) continue;
      const cleanHeader = normalize(header);
      if (!cleanHeader) continue;

      const headerWords = cleanHeader.split(" ").filter((w) => w.length > 0);

      for (const field of fieldDefinitions) {
        if (assignedFields.has(field.key)) continue;

        let matched = false;
        for (const syn of field.synonyms) {
          const cleanSyn = normalize(syn);
          if (!cleanSyn) continue;

          // If synonym is single word (e.g. "sku", "unit", "price", "stock") and appears in header words
          if (headerWords.includes(cleanSyn)) {
            mapping[header] = field.key;
            assignedFields.add(field.key);
            matched = true;
            break;
          }

          // If multi-word synonym is completely contained inside cleanHeader
          if (cleanSyn.includes(" ") && cleanHeader.includes(cleanSyn)) {
            mapping[header] = field.key;
            assignedFields.add(field.key);
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
    }

    // PASS 3: Substring match (for keywords >= 4 characters)
    for (const header of spreadsheetHeaders) {
      if (mapping[header]) continue;
      const cleanHeader = normalize(header);
      if (!cleanHeader || cleanHeader.length < 3) continue;

      for (const field of fieldDefinitions) {
        if (assignedFields.has(field.key)) continue;

        for (const syn of field.synonyms) {
          const cleanSyn = normalize(syn);
          if (cleanSyn.length >= 4 && (cleanHeader.includes(cleanSyn) || cleanSyn.includes(cleanHeader))) {
            mapping[header] = field.key;
            assignedFields.add(field.key);
            break;
          }
        }
        if (mapping[header]) break;
      }
    }

    return mapping;
  }

  /**
   * Safe date normalization:
   * Handles:
   * - DD/MM/YYYY or DD-MM-YYYY
   * - YYYY-MM-DD (ISO)
   * - MM/DD/YYYY
   * - Excel numeric serial date (e.g. 45678)
   */
  parseDateValue(raw: any): Date | null {
    if (!raw) return null;

    if (raw instanceof Date) {
      return isNaN(raw.getTime()) ? null : raw;
    }

    // Excel serial number
    if (typeof raw === "number") {
      const parsed = XLSX.SSF.parse_date_code(raw);
      if (parsed) {
        return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
      }
    }

    const str = String(raw).trim();
    if (!str) return null;

    // DD/MM/YYYY or DD-MM-YYYY
    const ddmmyyyy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmyyyy) {
      const day = parseInt(ddmmyyyy[1], 10);
      const month = parseInt(ddmmyyyy[2], 10) - 1;
      const year = parseInt(ddmmyyyy[3], 10);
      const d = new Date(Date.UTC(year, month, day));
      if (!isNaN(d.getTime())) return d;
    }

    // YYYY-MM-DD
    const yyyymmdd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (yyyymmdd) {
      const year = parseInt(yyyymmdd[1], 10);
      const month = parseInt(yyyymmdd[2], 10) - 1;
      const day = parseInt(yyyymmdd[3], 10);
      const d = new Date(Date.UTC(year, month, day));
      if (!isNaN(d.getTime())) return d;
    }

    const standardDate = new Date(str);
    if (!isNaN(standardDate.getTime())) {
      return standardDate;
    }

    return null;
  }

  /**
   * Parse numeric value safely (removes commas, currency signs, percentages)
   */
  parseNumberValue(raw: any, defaultValue: number = 0): number {
    if (raw === null || raw === undefined || raw === "") return defaultValue;
    if (typeof raw === "number") return isNaN(raw) ? defaultValue : raw;

    const str = String(raw).replace(/[₹$,%\s]/g, "").trim();
    const num = parseFloat(str);
    return isNaN(num) ? defaultValue : num;
  }
}
