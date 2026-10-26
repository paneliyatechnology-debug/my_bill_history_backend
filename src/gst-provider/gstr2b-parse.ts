import { normalizeInvoiceNumber } from "./invoice-number";
import { Gstr2bDocumentType } from "./gstr2b-match";

export interface ParsedGstr2bLine {
  supplierGstin: string;
  supplierName: string;
  documentType: Gstr2bDocumentType;
  invoiceNumber: string;
  normalizedInvoiceNumber: string;
  invoiceDate: string;
  taxableValue: string;
  cgst: string;
  sgst: string;
  igst: string;
  cess: string;
  invoiceValue: string;
  portalItcFlag: string | null;
  sourceSection: string;
}

export interface Gstr2bParseResult {
  ok: boolean;
  recipientGstin?: string;
  returnPeriod?: string;
  lines: ParsedGstr2bLine[];
  errors: string[];
  warnings: string[];
  unsupportedSections: string[];
}

function money(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "0.00";
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return numeric.toFixed(2);
}

function parseDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(raw);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymd) return raw;
  return null;
}

function pushLine(
  lines: ParsedGstr2bLine[],
  errors: string[],
  rowLabel: string,
  input: {
    supplierGstin: string;
    supplierName?: string;
    documentType: Gstr2bDocumentType;
    invoiceNumber: unknown;
    invoiceDate: unknown;
    taxableValue: unknown;
    cgst: unknown;
    sgst: unknown;
    igst: unknown;
    cess: unknown;
    invoiceValue: unknown;
    portalItcFlag?: unknown;
    sourceSection: string;
  },
) {
  const gstin = input.supplierGstin.trim().toUpperCase();
  const invoiceNumber = String(input.invoiceNumber ?? "").trim();
  const invoiceDate = parseDate(input.invoiceDate);
  const taxableValue = money(input.taxableValue);
  const cgst = money(input.cgst);
  const sgst = money(input.sgst);
  const igst = money(input.igst);
  const cess = money(input.cess);
  const invoiceValue = money(input.invoiceValue);
  if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) {
    errors.push(`${rowLabel}: supplier GSTIN '${gstin}' is not 15 characters.`);
    return;
  }
  if (!invoiceNumber) {
    errors.push(`${rowLabel}: invoice or note number is missing.`);
    return;
  }
  if (!invoiceDate) {
    errors.push(`${rowLabel}: date '${String(input.invoiceDate)}' must be DD-MM-YYYY or YYYY-MM-DD.`);
    return;
  }
  if (!taxableValue || !cgst || !sgst || !igst || !cess || !invoiceValue) {
    errors.push(`${rowLabel}: one or more amounts are not numeric.`);
    return;
  }
  lines.push({
    supplierGstin: gstin,
    supplierName: input.supplierName?.trim() || "",
    documentType: input.documentType,
    invoiceNumber,
    normalizedInvoiceNumber: normalizeInvoiceNumber(invoiceNumber),
    invoiceDate,
    taxableValue,
    cgst,
    sgst,
    igst,
    cess,
    invoiceValue,
    portalItcFlag:
      input.portalItcFlag === undefined || input.portalItcFlag === null
        ? null
        : String(input.portalItcFlag),
    sourceSection: input.sourceSection,
  });
}

function sumItems(items: any[] | undefined, field: string): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const source = item?.itm_det ?? item;
    return sum + Number(source?.[field] ?? 0);
  }, 0);
}

function parsePortalJson(payload: any, errors: string[], warnings: string[], unsupported: string[]): {
  recipientGstin?: string;
  returnPeriod?: string;
  lines: ParsedGstr2bLine[];
} {
  const data = payload?.data ?? payload;
  const recipientGstin = String(data?.gstin ?? payload?.gstin ?? "").trim().toUpperCase();
  const returnPeriod = String(data?.rtnprd ?? payload?.rtnprd ?? "").trim();
  const docdata = data?.docdata ?? data;
  const lines: ParsedGstr2bLine[] = [];
  const supported = new Set(["b2b", "b2ba", "cdnr", "cdnra"]);
  if (docdata && typeof docdata === "object") {
    for (const section of Object.keys(docdata)) {
      if (!supported.has(section) && Array.isArray(docdata[section]) && docdata[section].length > 0) {
        unsupported.push(section);
      }
    }
  }

  const b2b = [...(docdata?.b2b ?? []), ...(docdata?.b2ba ?? [])];
  b2b.forEach((supplier: any, supplierIndex: number) => {
    const invoices = supplier?.inv ?? [];
    invoices.forEach((invoice: any, invoiceIndex: number) => {
      const items = invoice?.itms ?? invoice?.items ?? [];
      pushLine(lines, errors, `b2b[${supplierIndex}].inv[${invoiceIndex}]`, {
        supplierGstin: supplier?.ctin ?? "",
        supplierName: supplier?.trdnm,
        documentType: "INVOICE",
        invoiceNumber: invoice?.inum,
        invoiceDate: invoice?.dt,
        taxableValue: sumItems(items, "txval") || invoice?.txval || 0,
        cgst: sumItems(items, "cgst") || sumItems(items, "camt"),
        sgst: sumItems(items, "sgst") || sumItems(items, "samt"),
        igst: sumItems(items, "igst") || sumItems(items, "iamt"),
        cess: sumItems(items, "cess") || sumItems(items, "csamt"),
        invoiceValue: invoice?.val ?? 0,
        portalItcFlag: invoice?.itcavl,
        sourceSection: "b2b",
      });
    });
  });

  const notes = [...(docdata?.cdnr ?? []), ...(docdata?.cdnra ?? [])];
  notes.forEach((supplier: any, supplierIndex: number) => {
    const noteRows = supplier?.nt ?? [];
    noteRows.forEach((note: any, noteIndex: number) => {
      const items = note?.itms ?? note?.items ?? [];
      const noteType = String(note?.ntty ?? "C").toUpperCase();
      pushLine(lines, errors, `cdnr[${supplierIndex}].nt[${noteIndex}]`, {
        supplierGstin: supplier?.ctin ?? "",
        supplierName: supplier?.trdnm,
        documentType: noteType === "D" ? "DEBIT_NOTE" : "CREDIT_NOTE",
        invoiceNumber: note?.ntnum ?? note?.nt_num,
        invoiceDate: note?.ntdt ?? note?.nt_dt,
        taxableValue: sumItems(items, "txval") || note?.txval || 0,
        cgst: sumItems(items, "cgst") || sumItems(items, "camt"),
        sgst: sumItems(items, "sgst") || sumItems(items, "samt"),
        igst: sumItems(items, "igst") || sumItems(items, "iamt"),
        cess: sumItems(items, "cess") || sumItems(items, "csamt"),
        invoiceValue: note?.val ?? 0,
        portalItcFlag: note?.itcavl,
        sourceSection: "cdnr",
      });
    });
  });

  if (unsupported.length > 0) {
    warnings.push(
      `Sections not used for invoice matching: ${unsupported.join(", ")}. Import them only after the CA confirms the mapping.`,
    );
  }
  return { recipientGstin, returnPeriod, lines };
}

function parseCsv(content: string, errors: string[]): ParsedGstr2bLine[] {
  const rows = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (rows.length === 0) {
    errors.push("CSV file is empty.");
    return [];
  }
  const header = rows[0].split(",").map((cell) => cell.trim().toLowerCase());
  const required = [
    "supplier_gstin",
    "invoice_number",
    "invoice_date",
    "taxable_value",
    "cgst",
    "sgst",
    "igst",
  ];
  for (const column of required) {
    if (!header.includes(column)) {
      errors.push(`CSV header is missing '${column}'.`);
    }
  }
  if (errors.length > 0) return [];
  const index = (name: string) => header.indexOf(name);
  const lines: ParsedGstr2bLine[] = [];
  rows.slice(1).forEach((row, rowIndex) => {
    const cells = row.split(",").map((cell) => cell.trim());
    const documentType = (cells[index("document_type")] || "INVOICE").toUpperCase();
    const mappedType: Gstr2bDocumentType =
      documentType === "CREDIT_NOTE" || documentType === "C"
        ? "CREDIT_NOTE"
        : documentType === "DEBIT_NOTE" || documentType === "D"
          ? "DEBIT_NOTE"
          : "INVOICE";
    pushLine(lines, errors, `csv row ${rowIndex + 2}`, {
      supplierGstin: cells[index("supplier_gstin")] ?? "",
      supplierName: index("supplier_name") >= 0 ? cells[index("supplier_name")] : "",
      documentType: mappedType,
      invoiceNumber: cells[index("invoice_number")],
      invoiceDate: cells[index("invoice_date")],
      taxableValue: cells[index("taxable_value")],
      cgst: cells[index("cgst")],
      sgst: cells[index("sgst")],
      igst: cells[index("igst")],
      cess: index("cess") >= 0 ? cells[index("cess")] : 0,
      invoiceValue: index("invoice_value") >= 0 ? cells[index("invoice_value")] : cells[index("taxable_value")],
      portalItcFlag: index("itc_available") >= 0 ? cells[index("itc_available")] : null,
      sourceSection: "csv",
    });
  });
  return lines;
}

export function parseGstr2bFile(content: string, fileName = "gstr2b.json"): Gstr2bParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unsupportedSections: string[] = [];
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      ok: false,
      lines: [],
      errors: ["File is empty."],
      warnings,
      unsupportedSections,
    };
  }

  let recipientGstin: string | undefined;
  let returnPeriod: string | undefined;
  let lines: ParsedGstr2bLine[] = [];
  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[") || fileName.endsWith(".json");
  if (looksJson && trimmed.startsWith("{")) {
    try {
      const payload = JSON.parse(trimmed);
      const parsed = parsePortalJson(payload, errors, warnings, unsupportedSections);
      recipientGstin = parsed.recipientGstin;
      returnPeriod = parsed.returnPeriod;
      lines = parsed.lines;
    } catch {
      errors.push("JSON could not be parsed.");
    }
  } else if (looksJson) {
    errors.push("GSTR-2B JSON must be an object with data.docdata or a flat document list.");
  } else {
    lines = parseCsv(trimmed, errors);
  }

  const seen = new Set<string>();
  lines.forEach((line, index) => {
    const key = `${line.documentType}|${line.supplierGstin}|${line.normalizedInvoiceNumber}`;
    if (seen.has(key)) {
      errors.push(
        `Duplicate ${line.documentType} ${line.invoiceNumber} for GSTIN ${line.supplierGstin} (row ${index + 1}).`,
      );
    }
    seen.add(key);
  });

  if (lines.length === 0 && errors.length === 0) {
    errors.push("No B2B invoices or notes were found in the file.");
  }

  return {
    ok: errors.length === 0,
    recipientGstin,
    returnPeriod,
    lines,
    errors,
    warnings,
    unsupportedSections,
  };
}
