import { fromPaise, toPaise } from "./money";
import { isWithinPeriod, resolveReportPeriod } from "./invoice-number";
import { settleItc } from "./itc-settlement";

export type SupplyCategory = "TAXABLE" | "NIL_RATED" | "EXEMPT" | "NON_GST";

export const B2CL_THRESHOLD_RUPEES = 250000;

export interface GstrTaxLine {
  hsnCode: string;
  description?: string | null;
  quantity: string | number;
  taxableAmount: string | number;
  taxRate: string | number;
  cgstAmount: string | number;
  sgstAmount: string | number;
  igstAmount: string | number;
  utgstAmount?: string | number;
  cessAmount?: string | number;
  supplyCategory?: SupplyCategory;
  totalAmount: string | number;
}

export interface GstrSalesDocument {
  invoiceNumber: string;
  invoiceDate: string;
  grandTotal: string | number;
  taxableAmount: string | number;
  cgstAmount: string | number;
  sgstAmount: string | number;
  igstAmount: string | number;
  utgstAmount?: string | number;
  cessAmount?: string | number;
  roundOff?: string | number;
  placeOfSupply: string;
  isReverseCharge?: boolean;
  partyGstin?: string | null;
  items: GstrTaxLine[];
}

export interface GstrAdvance {
  receiptNumber: string;
  receiptDate: string;
  supplyKind: "GOODS" | "SERVICES";
  placeOfSupply: string;
  taxableAmount: string | number;
  cgstAmount: string | number;
  sgstAmount: string | number;
  utgstAmount?: string | number;
  igstAmount: string | number;
  adjustedTaxable?: string | number;
}

export interface GstrNoteDocument extends GstrSalesDocument {
  noteNumber: string;
  noteDate: string;
  originalInvoiceNumber?: string;
  originalInvoiceDate?: string;
  noteType?: "C" | "D";
}

export interface GstrPurchaseDocument {
  id: string;
  taxableAmount: string | number;
  cgstAmount: string | number;
  sgstAmount: string | number;
  igstAmount: string | number;
  utgstAmount?: string | number;
  cessAmount?: string | number;
  itcEligibility?: string | null;
  invoiceDate: string;
}

interface TaxBucket {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  utgst: number;
}

function emptyBucket(): TaxBucket {
  return { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, utgst: 0 };
}

function addBucket(bucket: TaxBucket, doc: GstrSalesDocument | GstrPurchaseDocument, sign: 1 | -1) {
  bucket.taxable += sign * toPaise(doc.taxableAmount);
  bucket.cgst += sign * toPaise(doc.cgstAmount);
  bucket.sgst += sign * toPaise(doc.sgstAmount);
  bucket.igst += sign * toPaise(doc.igstAmount);
  bucket.cess += sign * toPaise(doc.cessAmount ?? 0);
  bucket.utgst += sign * toPaise("utgstAmount" in doc ? doc.utgstAmount ?? 0 : 0);
}

function formatBucket(bucket: TaxBucket) {
  return {
    taxableValue: fromPaise(bucket.taxable),
    igst: fromPaise(bucket.igst),
    cgst: fromPaise(bucket.cgst),
    sgst: fromPaise(bucket.sgst),
    utgst: fromPaise(bucket.utgst),
    stateOrUtTax: fromPaise(bucket.sgst + bucket.utgst),
    cess: fromPaise(bucket.cess),
    totalTax: fromPaise(bucket.igst + bucket.cgst + bucket.sgst + bucket.utgst + bucket.cess),
    isNegative:
      bucket.taxable < 0 ||
      bucket.cgst < 0 ||
      bucket.sgst < 0 ||
      bucket.utgst < 0 ||
      bucket.igst < 0,
  };
}

export function classifySupplyDocument(
  doc: GstrSalesDocument,
): "TAXABLE" | "NIL_RATED" | "EXEMPT" | "NON_GST" | "UNSPECIFIED_ZERO" | "MIXED" {
  const classes = doc.items.map((item) => {
    if (item.supplyCategory === "NIL_RATED" || item.supplyCategory === "EXEMPT" || item.supplyCategory === "NON_GST") {
      return item.supplyCategory;
    }
    const tax =
      toPaise(item.cgstAmount) +
      toPaise(item.sgstAmount) +
      toPaise(item.utgstAmount ?? 0) +
      toPaise(item.igstAmount) +
      toPaise(item.cessAmount ?? 0);
    if (toPaise(item.taxRate) === 0 && tax === 0) return "UNSPECIFIED_ZERO" as const;
    return "TAXABLE" as const;
  });
  const unique = new Set(classes);
  if (unique.size === 1) return [...unique][0];
  return "MIXED";
}

export function isWhollyNilRated(doc: GstrSalesDocument): boolean {
  const tax =
    toPaise(doc.cgstAmount) +
    toPaise(doc.sgstAmount) +
    toPaise(doc.igstAmount) +
    toPaise(doc.cessAmount ?? 0);
  if (tax !== 0) return false;
  return doc.items.every((item) => toPaise(item.taxRate) === 0);
}

function hasGstin(doc: GstrSalesDocument): boolean {
  return Boolean(doc.partyGstin && doc.partyGstin.trim() !== "");
}

function itemDetails(items: GstrTaxLine[]) {
  return items.map((item, index) => ({
    num: index + 1,
    itm_det: {
      txval: toPaise(item.taxableAmount) / 100,
      rt: Number(item.taxRate),
      iamt: toPaise(item.igstAmount) / 100,
      camt: toPaise(item.cgstAmount) / 100,
      samt: (toPaise(item.sgstAmount) + toPaise(item.utgstAmount ?? 0)) / 100,
      csamt: toPaise(item.cessAmount ?? 0) / 100,
      utgstIncludedInSamt: toPaise(item.utgstAmount ?? 0) / 100,
    },
  }));
}

export function buildGstr1(input: {
  companyStateCode: string;
  invoices: GstrSalesDocument[];
  creditNotes?: GstrNoteDocument[];
  debitNotes?: GstrNoteDocument[];
  advances?: GstrAdvance[];
  period?: { fromDate?: string; toDate?: string; month?: number | string; year?: number | string };
}): {
  grossTurnover: string;
  totalTaxable: string;
  totalCgst: string;
  totalSgst: string;
  totalUtgst: string;
  totalIgst: string;
  totalCess: string;
  totalRoundOff: string;
  b2b: any[];
  b2cl: any[];
  b2cs: any[];
  nil: { assumption: string; rows: any[] };
  cdnr: any[];
  cdnur: any[];
  hsn: { data: any[] };
  table11Advances: {
    servicesReceived: any[];
    goodsNotTaxedOnReceipt: string[];
    legalBasis: string;
  };
  filingStatus: "NOT_FILED";
  statutoryAssumptions: string[];
  period: { from?: string; to?: string };
} {
  const bounds = input.period ? resolveReportPeriod(input.period) : {};
  const invoices = input.invoices.filter((invoice) =>
    isWithinPeriod(invoice.invoiceDate, bounds),
  );
  const notes = [...(input.creditNotes ?? []), ...(input.debitNotes ?? [])].filter((note) =>
    isWithinPeriod(note.noteDate, bounds),
  );

  let gross = 0;
  let taxable = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let utgst = 0;
  let cess = 0;
  let roundOff = 0;
  const b2bMap = new Map<string, any>();
  const b2cl: any[] = [];
  const b2csMap = new Map<string, any>();
  const nilMap = new Map<string, { nil: number; expt: number; ngsup: number }>();
  const hsnMap = new Map<string, any>();

  const addHsn = (item: GstrTaxLine, sign: 1 | -1) => {
    const hsn = item.hsnCode || "999999";
    if (!hsnMap.has(hsn)) {
      hsnMap.set(hsn, {
        hsn_sc: hsn,
        desc: item.description || "General Goods",
        uqc: "NOS",
        qty: 0,
        val: 0,
        txval: 0,
        iamt: 0,
        camt: 0,
        samt: 0,
        csamt: 0,
      });
    }
    const row = hsnMap.get(hsn);
    row.qty += sign * Number(item.quantity);
    row.val += sign * toPaise(item.totalAmount);
    row.txval += sign * toPaise(item.taxableAmount);
    row.iamt += sign * toPaise(item.igstAmount);
    row.camt += sign * toPaise(item.cgstAmount);
    row.samt += sign * (toPaise(item.sgstAmount) + toPaise(item.utgstAmount ?? 0));
    row.csamt += sign * toPaise(item.cessAmount ?? 0);
  };

  for (const invoice of invoices) {
    gross += toPaise(invoice.grandTotal);
    taxable += toPaise(invoice.taxableAmount);
    cgst += toPaise(invoice.cgstAmount);
    sgst += toPaise(invoice.sgstAmount);
    utgst += toPaise(invoice.utgstAmount ?? 0);
    igst += toPaise(invoice.igstAmount);
    cess += toPaise(invoice.cessAmount ?? 0);
    roundOff += toPaise(invoice.roundOff ?? 0);
    const inter = invoice.placeOfSupply !== input.companyStateCode;
    const supplyClass = classifySupplyDocument(invoice);
    if (supplyClass !== "TAXABLE" && supplyClass !== "MIXED") {
      const supply = inter ? "INTER" : "INTRA";
      const registered = hasGstin(invoice) ? "B2B" : "B2C";
      const key = `${supply}_${registered}_${invoice.placeOfSupply}`;
      const current = nilMap.get(key) ?? { nil: 0, expt: 0, ngsup: 0 };
      const amount = toPaise(invoice.taxableAmount);
      if (supplyClass === "EXEMPT") current.expt += amount;
      else if (supplyClass === "NON_GST") current.ngsup += amount;
      else current.nil += amount;
      nilMap.set(key, current);
    } else if (hasGstin(invoice)) {
      const ctin = invoice.partyGstin!.trim().toUpperCase();
      if (!b2bMap.has(ctin)) b2bMap.set(ctin, { ctin, inv: [] });
      b2bMap.get(ctin).inv.push({
        inum: invoice.invoiceNumber,
        idt: invoice.invoiceDate.slice(0, 10),
        val: toPaise(invoice.grandTotal) / 100,
        pos: invoice.placeOfSupply,
        rchrg: invoice.isReverseCharge ? "Y" : "N",
        itms: itemDetails(invoice.items),
      });
    } else if (inter && toPaise(invoice.grandTotal) > B2CL_THRESHOLD_RUPEES * 100) {
      b2cl.push({
        pos: invoice.placeOfSupply,
        inv: [
          {
            inum: invoice.invoiceNumber,
            idt: invoice.invoiceDate.slice(0, 10),
            val: toPaise(invoice.grandTotal) / 100,
            itms: itemDetails(invoice.items),
          },
        ],
      });
    } else {
      for (const item of invoice.items) {
        const rate = Number(item.taxRate).toFixed(2);
        const key = `${invoice.placeOfSupply}_${inter ? "INTER" : "INTRA"}_${rate}`;
        if (!b2csMap.has(key)) {
          b2csMap.set(key, {
            sply_ty: inter ? "INTER" : "INTRA",
            pos: invoice.placeOfSupply,
            rt: Number(rate),
            txval: 0,
            iamt: 0,
            camt: 0,
            samt: 0,
            csamt: 0,
          });
        }
        const row = b2csMap.get(key);
        row.txval += toPaise(item.taxableAmount);
        row.iamt += toPaise(item.igstAmount);
        row.camt += toPaise(item.cgstAmount);
        row.samt += toPaise(item.sgstAmount) + toPaise(item.utgstAmount ?? 0);
        row.csamt += toPaise(item.cessAmount ?? 0);
      }
    }
    for (const item of invoice.items) addHsn(item, 1);
  }

  const cdnrMap = new Map<string, any>();
  const cdnur: any[] = [];
  for (const note of notes) {
    const sign: 1 | -1 = note.noteType === "D" ? 1 : -1;
    for (const item of note.items) addHsn(item, sign);
    const inter = note.placeOfSupply !== input.companyStateCode;
    const noteDoc = {
      ntty: note.noteType ?? "C",
      nt_num: note.noteNumber,
      nt_dt: note.noteDate.slice(0, 10),
      inum: note.originalInvoiceNumber || note.invoiceNumber,
      idt: (note.originalInvoiceDate || note.invoiceDate).slice(0, 10),
      val: toPaise(note.grandTotal) / 100,
      pos: note.placeOfSupply,
      itms: itemDetails(note.items),
    };
    if (hasGstin(note)) {
      const ctin = note.partyGstin!.trim().toUpperCase();
      if (!cdnrMap.has(ctin)) cdnrMap.set(ctin, { ctin, nt: [] });
      cdnrMap.get(ctin).nt.push(noteDoc);
    } else {
      cdnur.push({
        typ: inter && toPaise(note.grandTotal) > B2CL_THRESHOLD_RUPEES * 100 ? "B2CL" : "B2CS",
        ...noteDoc,
      });
    }
  }

  return {
    grossTurnover: fromPaise(gross),
    totalTaxable: fromPaise(taxable),
    totalCgst: fromPaise(cgst),
    totalSgst: fromPaise(sgst),
    totalUtgst: fromPaise(utgst),
    totalIgst: fromPaise(igst),
    totalCess: fromPaise(cess),
    totalRoundOff: fromPaise(roundOff),
    b2b: Array.from(b2bMap.values()),
    b2cl,
    b2cs: Array.from(b2csMap.values()).map((row) => ({
      ...row,
      txval: fromPaise(row.txval),
      iamt: fromPaise(row.iamt),
      camt: fromPaise(row.camt),
      samt: fromPaise(row.samt),
      csamt: fromPaise(row.csamt),
    })),
    nil: {
      assumption:
        "Explicit EXEMPT supplies go to expt_amt and NON_GST supplies go to ngsup_amt. NIL_RATED supplies, and zero-tax supplies with no stored category, go to nil_amt. Unspecified zero-tax supplies still need CA confirmation before filing.",
      rows: Array.from(nilMap.entries()).map(([key, value]) => {
        const [supply, registered, pos] = key.split("_");
        return {
          sply_ty: supply,
          typ: registered,
          pos,
          nil_amt: fromPaise(value.nil),
          expt_amt: fromPaise(value.expt),
          ngsup_amt: fromPaise(value.ngsup),
        };
      }),
    },
    cdnr: Array.from(cdnrMap.values()),
    cdnur,
    hsn: {
      data: Array.from(hsnMap.values()).map((row, index) => ({
        num: index + 1,
        hsn_sc: row.hsn_sc,
        desc: row.desc,
        uqc: row.uqc,
        qty: row.qty.toFixed(2),
        val: fromPaise(row.val),
        txval: fromPaise(row.txval),
        iamt: fromPaise(row.iamt),
        camt: fromPaise(row.camt),
        samt: fromPaise(row.samt),
        csamt: fromPaise(row.csamt),
      })),
    },
    table11Advances: {
      servicesReceived: (input.advances ?? [])
        .filter((advance) => advance.supplyKind === "SERVICES" && isWithinPeriod(advance.receiptDate, bounds))
        .map((advance) => ({
          receiptNumber: advance.receiptNumber,
          receiptDate: advance.receiptDate.slice(0, 10),
          pos: advance.placeOfSupply,
          taxableValue: fromPaise(toPaise(advance.taxableAmount) - toPaise(advance.adjustedTaxable ?? 0)),
          cgst: fromPaise(toPaise(advance.cgstAmount)),
          sgst: fromPaise(toPaise(advance.sgstAmount)),
          utgst: fromPaise(toPaise(advance.utgstAmount ?? 0)),
          igst: fromPaise(toPaise(advance.igstAmount)),
        })),
      goodsNotTaxedOnReceipt: (input.advances ?? [])
        .filter((advance) => advance.supplyKind === "GOODS" && isWithinPeriod(advance.receiptDate, bounds))
        .map((advance) => advance.receiptNumber),
      legalBasis:
        "Notification 66/2017-Central Tax: advances received for goods are not taxed on receipt. Service advances follow the time of supply in Section 13 of the CGST Act. These rows are preparation data and are not posted to the ledger by this builder.",
    },
    filingStatus: "NOT_FILED",
    statutoryAssumptions: [
      "This is return-preparation data. No GSTR-1 has been filed with the GST portal.",
      "Inter-state supplies to unregistered persons above ₹2,50,000 are placed in B2CL. Smaller unregistered supplies are aggregated in B2CS.",
      "Invoice grand totals follow the stored Section 170 round-off. Tax totals are the stored 2-decimal component amounts and are not re-rounded into the tax.",
      "HSN quantities use UQC NOS because the invoice line does not store a separate reporting UQC.",
      "GSTR-1 schema version used here reports State and UT tax together in samt. A separate utgst amount is also returned so it is not confused with SGST.",
      "B2CL uses invoice value above ₹2,50,000 for inter-state supplies to unregistered persons, following the GSTR-1 Table 5 instruction. The threshold is not re-derived.",
      "A zero-tax document without an explicit nil, exempt, or non-GST category is reported under nil amount and flagged as unspecified.",
      "Service advances are included only when advance documents are supplied. Goods advances are not taxed on receipt, following Notification 66/2017-Central Tax, and still need CA confirmation that the supply is goods.",
    ],
    period: bounds,
  };
}

function cashPayable(signedPaise: number): string {
  return fromPaise(Math.max(0, signedPaise));
}

export function buildGstr3b(input: {
  invoices: GstrSalesDocument[];
  creditNotes?: GstrNoteDocument[];
  debitNotes?: GstrNoteDocument[];
  purchases?: GstrPurchaseDocument[];
  purchaseReturns?: GstrPurchaseDocument[];
  acceptedPurchaseIds?: string[];
  acceptedReturnIds?: string[];
  igstCreditAllocation?: { cgst?: string | number; stateOrUt?: string | number };
  period?: { fromDate?: string; toDate?: string; month?: number | string; year?: number | string };
}) {
  const bounds = input.period ? resolveReportPeriod(input.period) : {};
  const invoices = input.invoices.filter((invoice) => isWithinPeriod(invoice.invoiceDate, bounds));
  const notes = [...(input.creditNotes ?? []), ...(input.debitNotes ?? [])].filter((note) =>
    isWithinPeriod(note.noteDate, bounds),
  );
  const purchases = (input.purchases ?? []).filter((purchase) =>
    isWithinPeriod(purchase.invoiceDate, bounds),
  );
  const purchaseReturns = (input.purchaseReturns ?? []).filter((purchase) =>
    isWithinPeriod(purchase.invoiceDate, bounds),
  );
  const acceptedPurchases = new Set(input.acceptedPurchaseIds ?? []);
  const acceptedReturns = new Set(input.acceptedReturnIds ?? []);

  const taxableOutward = emptyBucket();
  const nilOutward = emptyBucket();
  const exemptOutward = emptyBucket();
  const nonGstOutward = emptyBucket();
  const rcmOutward = emptyBucket();
  const sourceNet = emptyBucket();
  const booksItc = emptyBucket();
  const reversedItc = emptyBucket();
  const excludedItc = emptyBucket();
  const inwardRcm = emptyBucket();
  const reviewedItc = emptyBucket();

  const addOutward = (doc: GstrSalesDocument, sign: 1 | -1) => {
    addBucket(sourceNet, doc, sign);
    if (doc.isReverseCharge) {
      addBucket(rcmOutward, doc, sign);
      return;
    }
    const supplyClass = classifySupplyDocument(doc);
    if (supplyClass === "EXEMPT") addBucket(exemptOutward, doc, sign);
    else if (supplyClass === "NON_GST") addBucket(nonGstOutward, doc, sign);
    else if (supplyClass === "NIL_RATED" || supplyClass === "UNSPECIFIED_ZERO") addBucket(nilOutward, doc, sign);
    else addBucket(taxableOutward, doc, sign);
  };
  for (const invoice of invoices) addOutward(invoice, 1);
  for (const note of notes) addOutward(note, note.noteType === "D" ? 1 : -1);

  const countsForItc = (eligibility: string) =>
    eligibility !== "INELIGIBLE" && eligibility !== "BLOCKED" && eligibility !== "RCM";

  for (const purchase of purchases) {
    const eligibility = (purchase.itcEligibility || "INPUT").toUpperCase();
    if (eligibility === "RCM") addBucket(inwardRcm, purchase, 1);
    else if (!countsForItc(eligibility)) addBucket(excludedItc, purchase, 1);
    else addBucket(booksItc, purchase, 1);
    if (acceptedPurchases.has(purchase.id) && countsForItc(eligibility)) {
      addBucket(reviewedItc, purchase, 1);
    }
  }
  for (const purchaseReturn of purchaseReturns) {
    const eligibility = (purchaseReturn.itcEligibility || "INPUT").toUpperCase();
    if (eligibility === "RCM") addBucket(inwardRcm, purchaseReturn, -1);
    else if (!countsForItc(eligibility)) addBucket(excludedItc, purchaseReturn, -1);
    else addBucket(reversedItc, purchaseReturn, 1);
    if (acceptedReturns.has(purchaseReturn.id) && countsForItc(eligibility)) {
      addBucket(reviewedItc, purchaseReturn, -1);
    }
  }

  const booksNet = {
    taxable: booksItc.taxable - reversedItc.taxable,
    cgst: booksItc.cgst - reversedItc.cgst,
    sgst: booksItc.sgst - reversedItc.sgst,
    igst: booksItc.igst - reversedItc.igst,
    cess: booksItc.cess - reversedItc.cess,
    utgst: booksItc.utgst - reversedItc.utgst,
  };
  const pendingReview = {
    igst: booksNet.igst - reviewedItc.igst,
    cgst: booksNet.cgst - reviewedItc.cgst,
    sgst: booksNet.sgst - reviewedItc.sgst,
    utgst: booksNet.utgst - reviewedItc.utgst,
  };
  const utilization = settleItc({
    liability: {
      igst: fromPaise(Math.max(0, taxableOutward.igst + inwardRcm.igst)),
      cgst: fromPaise(Math.max(0, taxableOutward.cgst + inwardRcm.cgst)),
      sgst: fromPaise(Math.max(0, taxableOutward.sgst + inwardRcm.sgst)),
      utgst: fromPaise(Math.max(0, taxableOutward.utgst + inwardRcm.utgst)),
      cess: fromPaise(Math.max(0, taxableOutward.cess)),
    },
    acceptedItc: {
      igst: fromPaise(Math.max(0, reviewedItc.igst)),
      cgst: fromPaise(Math.max(0, reviewedItc.cgst)),
      sgst: fromPaise(Math.max(0, reviewedItc.sgst)),
      utgst: fromPaise(Math.max(0, reviewedItc.utgst)),
      cess: fromPaise(Math.max(0, reviewedItc.cess)),
    },
    igstCreditAllocation: input.igstCreditAllocation,
  });
  const signedCgst = taxableOutward.cgst - reviewedItc.cgst;
  const signedSgst = taxableOutward.sgst - reviewedItc.sgst;
  const signedIgst = taxableOutward.igst - reviewedItc.igst;

  return {
    filingStatus: "NOT_FILED" as const,
    period: bounds,
    claimPolicy:
      "Input tax credit is not claimed because a purchase exists or because it matches GSTR-2B. Table 6 uses only reconciliation rows whose review decision is ACCEPTED. Acceptance records a review; it does not post an extra voucher and it does not prove Section 16 eligibility.",
    table3_1_outwardSupplies: formatBucket(taxableOutward),
    table3_1_nilRated: formatBucket(nilOutward),
    table3_1_exempt: formatBucket(exemptOutward),
    table3_1_nonGst: formatBucket(nonGstOutward),
    table3_1_reverseChargeOutward: {
      ...formatBucket(rcmOutward),
      payableBySupplier: false,
    },
    table3_1_inwardReverseCharge: formatBucket(inwardRcm),
    sourceDocumentNet: formatBucket(sourceNet),
    table4_eligibleItc: {
      itcAvailable: {
        igst: fromPaise(booksItc.igst),
        cgst: fromPaise(booksItc.cgst),
        sgst: fromPaise(booksItc.sgst),
      },
      itcReversed: {
        igst: fromPaise(reversedItc.igst),
        cgst: fromPaise(reversedItc.cgst),
        sgst: fromPaise(reversedItc.sgst),
      },
      booksNetItc: {
        igst: fromPaise(booksNet.igst),
        cgst: fromPaise(booksNet.cgst),
        sgst: fromPaise(booksNet.sgst),
      },
      reviewedAcceptedItc: {
        igst: fromPaise(reviewedItc.igst),
        cgst: fromPaise(reviewedItc.cgst),
        sgst: fromPaise(reviewedItc.sgst),
        total: fromPaise(reviewedItc.igst + reviewedItc.cgst + reviewedItc.sgst),
      },
      pendingReviewItc: {
        igst: fromPaise(pendingReview.igst),
        cgst: fromPaise(pendingReview.cgst),
        sgst: fromPaise(pendingReview.sgst),
        utgst: fromPaise(pendingReview.utgst),
      },
      excludedItc: {
        igst: fromPaise(excludedItc.igst),
        cgst: fromPaise(excludedItc.cgst),
        sgst: fromPaise(excludedItc.sgst),
        utgst: fromPaise(excludedItc.utgst),
      },
      netItcAvailable: {
        igst: fromPaise(reviewedItc.igst),
        cgst: fromPaise(reviewedItc.cgst),
        sgst: fromPaise(reviewedItc.sgst),
        utgst: fromPaise(reviewedItc.utgst),
        total: fromPaise(reviewedItc.igst + reviewedItc.cgst + reviewedItc.sgst + reviewedItc.utgst),
      },
    },
    table6_itcUtilization: utilization,
    table6_1_paymentOfTax: {
      signedNetIgst: fromPaise(signedIgst),
      signedNetCgst: fromPaise(signedCgst),
      signedNetSgst: fromPaise(signedSgst),
      netPayableIgst: cashPayable(signedIgst + inwardRcm.igst),
      netPayableCgst: cashPayable(signedCgst + inwardRcm.cgst),
      netPayableSgst: cashPayable(signedSgst + inwardRcm.sgst),
      cess: fromPaise(taxableOutward.cess),
      totalCashTaxPayable: fromPaise(
        Math.max(0, signedIgst + inwardRcm.igst) +
          Math.max(0, signedCgst + inwardRcm.cgst) +
          Math.max(0, signedSgst + inwardRcm.sgst) +
          taxableOutward.cess,
      ),
      creditNotesExceedOutward:
        taxableOutward.taxable < 0 ||
        taxableOutward.cgst < 0 ||
        taxableOutward.sgst < 0 ||
        taxableOutward.igst < 0,
    },
    statutoryAssumptions: [
      "No GSTR-3B has been filed. Cash payable is a draft and excludes unreviewed ITC.",
      "Explicit EXEMPT and NON_GST categories are reported separately. A zero-tax document without a category remains in the nil-rated row until a CA classifies it.",
      "IGST credit left after the IGST liability is not split between CGST and SGST/UTGST unless an allocation is supplied. Rule 88A allows any order.",
      "Reverse-charge outward tax is disclosed and is not treated as payable by the supplier. Inward reverse charge uses purchases marked RCM.",
      "Component amounts are not forced to zero when credit notes exceed outward supplies in the period.",
    ],
  };
}
