import { GstRegistrationType } from "@billing/shared-types";

export interface CreateCompanyDto {
  legalName: string;
  tradeName?: string;
  gstin?: string;
  pan?: string;
  stateCode?: string;
  gstType?: GstRegistrationType;
  compositionScheme?: boolean;
  eInvoiceApplicable?: boolean;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  district?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  bankBranch?: string;
  upiVpa?: string;
  bankAccountBarcode?: string;
  enableGujaratiPrint?: boolean;
  signatoryName?: string;
  signatoryDesignation?: string;
  signatureUrl?: string;
  allowNegativeStock?: boolean;
  branchName?: string;
  branchCode?: string;
}
