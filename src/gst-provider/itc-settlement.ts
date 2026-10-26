import { fromPaise, toPaise } from "./money";

export interface TaxComponentInput {
  igst: string | number;
  cgst: string | number;
  sgst: string | number;
  utgst?: string | number;
  cess?: string | number;
}

export interface ItcSettlementResult {
  legalBasis: string[];
  igstCreditUsedForIgst: string;
  remainingIgstCredit: string;
  igstCreditAllocationRequired: boolean;
  allocatedIgstCreditToCgst: string;
  allocatedIgstCreditToStateOrUt: string;
  cgstCreditUsedForCgst: string;
  cgstCreditUsedForIgst: string;
  sgstCreditUsedForSgst: string;
  sgstCreditUsedForIgst: string;
  utgstCreditUsedForUtgst: string;
  utgstCreditUsedForIgst: string;
  cessCreditUsedForCess: string;
  cashPayable: {
    igst: string;
    cgst: string;
    sgst: string;
    utgst: string;
    cess: string;
    total: string;
  };
  unusedCredit: {
    igst: string;
    cgst: string;
    sgst: string;
    utgst: string;
    cess: string;
  };
}

function nonNegative(value: number): number {
  return value < 0 ? 0 : value;
}

/**
 * Settles accepted ITC against output liability.
 * Section 49(5) and Rule 88A: IGST credit is used for IGST first.
 * Any remainder may be used for CGST and SGST/UTGST in any order.
 * This function does not choose that order unless the caller supplies an allocation.
 * CGST credit cannot be used for SGST/UTGST, and SGST/UTGST credit cannot be used for CGST.
 * Cess credit is applied only to cess.
 */
export function settleItc(input: {
  liability: TaxComponentInput;
  acceptedItc: TaxComponentInput;
  igstCreditAllocation?: { cgst?: string | number; stateOrUt?: string | number };
}): ItcSettlementResult {
  let igstLiability = nonNegative(toPaise(input.liability.igst));
  let cgstLiability = nonNegative(toPaise(input.liability.cgst));
  let sgstLiability = nonNegative(toPaise(input.liability.sgst));
  let utgstLiability = nonNegative(toPaise(input.liability.utgst ?? 0));
  let cessLiability = nonNegative(toPaise(input.liability.cess ?? 0));

  let igstCredit = nonNegative(toPaise(input.acceptedItc.igst));
  let cgstCredit = nonNegative(toPaise(input.acceptedItc.cgst));
  let sgstCredit = nonNegative(toPaise(input.acceptedItc.sgst));
  let utgstCredit = nonNegative(toPaise(input.acceptedItc.utgst ?? 0));
  let cessCredit = nonNegative(toPaise(input.acceptedItc.cess ?? 0));

  const igstForIgst = Math.min(igstCredit, igstLiability);
  igstCredit -= igstForIgst;
  igstLiability -= igstForIgst;

  const requestedCgst = toPaise(input.igstCreditAllocation?.cgst ?? 0);
  const requestedState = toPaise(input.igstCreditAllocation?.stateOrUt ?? 0);
  if (requestedCgst < 0 || requestedState < 0) {
    throw new Error("IGST credit allocation cannot be negative.");
  }
  if (requestedCgst + requestedState > igstCredit) {
    throw new Error("IGST credit allocation exceeds the credit remaining after the IGST liability.");
  }
  const stateRoom = sgstLiability + utgstLiability;
  if (requestedCgst > cgstLiability || requestedState > stateRoom) {
    throw new Error("IGST credit allocation exceeds the remaining CGST or State/UT liability.");
  }

  let allocatedCgst = requestedCgst;
  let allocatedState = requestedState;
  cgstLiability -= allocatedCgst;
  igstCredit -= allocatedCgst;
  if (allocatedState > 0) {
    const toSgst = Math.min(sgstLiability, allocatedState);
    sgstLiability -= toSgst;
    const toUtgst = allocatedState - toSgst;
    utgstLiability -= toUtgst;
    igstCredit -= allocatedState;
  }

  const cgstForCgst = Math.min(cgstCredit, cgstLiability);
  cgstCredit -= cgstForCgst;
  cgstLiability -= cgstForCgst;
  const cgstForIgst = Math.min(cgstCredit, igstLiability);
  cgstCredit -= cgstForIgst;
  igstLiability -= cgstForIgst;

  const sgstForSgst = Math.min(sgstCredit, sgstLiability);
  sgstCredit -= sgstForSgst;
  sgstLiability -= sgstForSgst;
  const sgstForIgst = Math.min(sgstCredit, igstLiability);
  sgstCredit -= sgstForIgst;
  igstLiability -= sgstForIgst;

  const utgstForUtgst = Math.min(utgstCredit, utgstLiability);
  utgstCredit -= utgstForUtgst;
  utgstLiability -= utgstForUtgst;
  const utgstForIgst = Math.min(utgstCredit, igstLiability);
  utgstCredit -= utgstForIgst;
  igstLiability -= utgstForIgst;

  const cessForCess = Math.min(cessCredit, cessLiability);
  cessCredit -= cessForCess;
  cessLiability -= cessForCess;

  const stateOrUtLiabilityRemains = sgstLiability + utgstLiability > 0;
  const allocationRequired = igstCredit > 0 && (cgstLiability > 0 || stateOrUtLiabilityRemains);

  const cashTotal = igstLiability + cgstLiability + sgstLiability + utgstLiability + cessLiability;
  return {
    legalBasis: [
      "Section 49(5) of the CGST Act: IGST credit is used for IGST before other taxes. CGST credit is used for CGST and then IGST. SGST or UTGST credit is used for that State or UT tax and then IGST.",
      "Rule 88A of the CGST Rules: after the IGST liability, the remaining IGST credit may be used for CGST and SGST/UTGST in any order. No order is assumed unless an allocation is supplied.",
      "Cess credit is applied only against cess.",
    ],
    igstCreditUsedForIgst: fromPaise(igstForIgst),
    remainingIgstCredit: fromPaise(igstCredit),
    igstCreditAllocationRequired: allocationRequired,
    allocatedIgstCreditToCgst: fromPaise(allocatedCgst),
    allocatedIgstCreditToStateOrUt: fromPaise(allocatedState),
    cgstCreditUsedForCgst: fromPaise(cgstForCgst),
    cgstCreditUsedForIgst: fromPaise(cgstForIgst),
    sgstCreditUsedForSgst: fromPaise(sgstForSgst),
    sgstCreditUsedForIgst: fromPaise(sgstForIgst),
    utgstCreditUsedForUtgst: fromPaise(utgstForUtgst),
    utgstCreditUsedForIgst: fromPaise(utgstForIgst),
    cessCreditUsedForCess: fromPaise(cessForCess),
    cashPayable: {
      igst: fromPaise(igstLiability),
      cgst: fromPaise(cgstLiability),
      sgst: fromPaise(sgstLiability),
      utgst: fromPaise(utgstLiability),
      cess: fromPaise(cessLiability),
      total: fromPaise(cashTotal),
    },
    unusedCredit: {
      igst: fromPaise(igstCredit),
      cgst: fromPaise(cgstCredit),
      sgst: fromPaise(sgstCredit),
      utgst: fromPaise(utgstCredit),
      cess: fromPaise(cessCredit),
    },
  };
}

export function assertItcReview(status: string, decision: string): string | null {
  if (decision !== "ACCEPTED") return null;
  if (status === "MATCHED" || status === "PARTIAL_MATCH") return null;
  return "ITC can be marked ACCEPTED only for MATCHED or PARTIAL_MATCH rows. A missing, duplicate, or mismatch row is not accepted, including a row missing in GSTR-2B.";
}
