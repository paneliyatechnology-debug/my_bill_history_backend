import { toPaise } from "./money";
import { normalizeInvoiceNumber } from "./invoice-number";

export type Gstr2bDocumentType = "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";

export type Gstr2bMatchStatus =
  | "MATCHED"
  | "PARTIAL_MATCH"
  | "MISSING_IN_BOOKS"
  | "MISSING_IN_GSTR2B"
  | "DUPLICATE"
  | "MISMATCH";

export interface ReconDocument {
  id: string;
  supplierGstin: string;
  documentNumber: string;
  documentDate: string;
  documentType: Gstr2bDocumentType;
  taxableValue: string | number;
  cgst: string | number;
  sgst: string | number;
  igst: string | number;
  cess?: string | number;
}

export interface MatchExplanation {
  rules: string[];
  normalizedInvoiceNumber: string;
  supplierGstin: string;
  dateDeltaDays: number | null;
  taxableDifferencePaise: number | null;
  taxDifferencePaise: {
    cgst: number | null;
    sgst: number | null;
    igst: number | null;
    cess: number | null;
  };
  tolerances: {
    exactPaise: number;
    partialPaise: number;
    partialPercent: number;
    partialDateDays: number;
  };
  requiresReview: boolean;
  itcClaim: "NOT_DECIDED";
}

export interface ReconMatch {
  matchKey: string;
  bookId?: string;
  portalId?: string;
  status: Gstr2bMatchStatus;
  explanation: MatchExplanation;
}

const EXACT_PAISE = 100;
const PARTIAL_PAISE = 1000;
const PARTIAL_PERCENT = 0.01;
const PARTIAL_DATE_DAYS = 3;

function dayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function keyOf(doc: ReconDocument): string {
  return `${doc.documentType}|${doc.supplierGstin.trim().toUpperCase()}|${normalizeInvoiceNumber(doc.documentNumber)}`;
}

function explanationBase(
  gstin: string,
  normalized: string,
  rules: string[],
  requiresReview: boolean,
): MatchExplanation {
  return {
    rules,
    normalizedInvoiceNumber: normalized,
    supplierGstin: gstin,
    dateDeltaDays: null,
    taxableDifferencePaise: null,
    taxDifferencePaise: { cgst: null, sgst: null, igst: null, cess: null },
    tolerances: {
      exactPaise: EXACT_PAISE,
      partialPaise: PARTIAL_PAISE,
      partialPercent: PARTIAL_PERCENT,
      partialDateDays: PARTIAL_DATE_DAYS,
    },
    requiresReview,
    itcClaim: "NOT_DECIDED",
  };
}

function comparePair(book: ReconDocument, portal: ReconDocument): {
  status: Gstr2bMatchStatus;
  explanation: MatchExplanation;
} {
  const gstin = book.supplierGstin.trim().toUpperCase();
  const normalized = normalizeInvoiceNumber(book.documentNumber);
  const dateDelta = Math.abs(dayNumber(book.documentDate) - dayNumber(portal.documentDate));
  const taxableDiff = toPaise(book.taxableValue) - toPaise(portal.taxableValue);
  const cgstDiff = toPaise(book.cgst) - toPaise(portal.cgst);
  const sgstDiff = toPaise(book.sgst) - toPaise(portal.sgst);
  const igstDiff = toPaise(book.igst) - toPaise(portal.igst);
  const cessDiff = toPaise(book.cess ?? 0) - toPaise(portal.cess ?? 0);
  const amounts = [taxableDiff, cgstDiff, sgstDiff, igstDiff, cessDiff];
  const exact = dateDelta === 0 && amounts.every((diff) => Math.abs(diff) <= EXACT_PAISE);
  const partialBand = Math.max(
    PARTIAL_PAISE,
    Math.round(Math.abs(toPaise(book.taxableValue)) * PARTIAL_PERCENT),
  );
  const withinPartial =
    dateDelta <= PARTIAL_DATE_DAYS &&
    amounts.every((diff) => Math.abs(diff) <= partialBand);

  let status: Gstr2bMatchStatus;
  const rules = [
    "Supplier GSTIN and document type must be equal.",
    "Invoice numbers match after uppercase normalization that removes spaces and / - . _ separators.",
  ];
  if (exact) {
    status = "MATCHED";
    rules.push(
      "Invoice dates are equal and taxable value plus CGST, SGST, IGST, and cess each differ by at most ₹1.00.",
      "A match does not accept input tax credit. Eligibility stays unreviewed.",
    );
  } else if (withinPartial) {
    status = "PARTIAL_MATCH";
    rules.push(
      "Dates differ by at most 3 days and each amount differs by at most the larger of ₹10.00 or 1% of the books taxable value.",
      "Partial matches require a user decision before any ITC treatment.",
    );
  } else {
    status = "MISMATCH";
    rules.push(
      "The supplier and invoice number match, but the date or the amounts fall outside the partial-match band.",
    );
  }

  return {
    status,
    explanation: {
      ...explanationBase(gstin, normalized, rules, status !== "MATCHED"),
      dateDeltaDays: dateDelta,
      taxableDifferencePaise: taxableDiff,
      taxDifferencePaise: {
        cgst: cgstDiff,
        sgst: sgstDiff,
        igst: igstDiff,
        cess: cessDiff,
      },
      requiresReview: status !== "MATCHED",
    },
  };
}

/**
 * Pair books documents with GSTR-2B rows.
 * Every result leaves ITC undecided, including exact matches.
 */
export function matchGstr2bDocuments(
  books: ReconDocument[],
  portal: ReconDocument[],
): ReconMatch[] {
  const booksByKey = new Map<string, ReconDocument[]>();
  const portalByKey = new Map<string, ReconDocument[]>();
  for (const doc of books) {
    const key = keyOf(doc);
    booksByKey.set(key, [...(booksByKey.get(key) ?? []), doc]);
  }
  for (const doc of portal) {
    const key = keyOf(doc);
    portalByKey.set(key, [...(portalByKey.get(key) ?? []), doc]);
  }

  const keys = new Set<string>([...booksByKey.keys(), ...portalByKey.keys()]);
  const results: ReconMatch[] = [];

  for (const key of keys) {
    const bookRows = booksByKey.get(key) ?? [];
    const portalRows = portalByKey.get(key) ?? [];
    const sample = bookRows[0] ?? portalRows[0];
    const gstin = sample.supplierGstin.trim().toUpperCase();
    const normalized = normalizeInvoiceNumber(sample.documentNumber);

    if (bookRows.length > 1 || portalRows.length > 1) {
      const rules = [
        "More than one books document or GSTR-2B row shares the same supplier GSTIN, document type, and normalized invoice number.",
        "Duplicates are not auto-paired. Review each row before deciding ITC.",
      ];
      for (const book of bookRows) {
        results.push({
          matchKey: `DUP:BOOK:${book.id}`,
          bookId: book.id,
          status: "DUPLICATE",
          explanation: explanationBase(gstin, normalized, rules, true),
        });
      }
      for (const row of portalRows) {
        results.push({
          matchKey: `DUP:PORTAL:${row.id}`,
          portalId: row.id,
          status: "DUPLICATE",
          explanation: explanationBase(gstin, normalized, rules, true),
        });
      }
      continue;
    }

    if (bookRows.length === 1 && portalRows.length === 1) {
      const compared = comparePair(bookRows[0], portalRows[0]);
      results.push({
        matchKey: `PAIR:${bookRows[0].id}:${portalRows[0].id}`,
        bookId: bookRows[0].id,
        portalId: portalRows[0].id,
        status: compared.status,
        explanation: compared.explanation,
      });
      continue;
    }

    if (bookRows.length === 1) {
      results.push({
        matchKey: `BOOK:${bookRows[0].id}`,
        bookId: bookRows[0].id,
        status: "MISSING_IN_GSTR2B",
        explanation: explanationBase(
          gstin,
          normalized,
          [
            "A books document has no GSTR-2B row with the same supplier GSTIN, document type, and normalized invoice number in this import.",
            "Missing GSTR-2B visibility does not by itself reverse or claim ITC.",
          ],
          true,
        ),
      });
      continue;
    }

    results.push({
      matchKey: `PORTAL:${portalRows[0].id}`,
      portalId: portalRows[0].id,
      status: "MISSING_IN_BOOKS",
      explanation: explanationBase(
        gstin,
        normalized,
        [
          "A GSTR-2B row has no books document with the same supplier GSTIN, document type, and normalized invoice number.",
        ],
        true,
      ),
    });
  }

  return results.sort((a, b) => a.matchKey.localeCompare(b.matchKey));
}
