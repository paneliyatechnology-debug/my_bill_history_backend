import { VoucherType } from "@billing/shared-types";

export interface CreateJournalLineDto {
  accountId: string;
  debitAmount: number | string;
  creditAmount: number | string;
  lineNarration?: string;
  sequenceOrder?: number;
}

export interface CreateVoucherDto {
  voucherType: VoucherType;
  voucherNumber: string;
  voucherDate: string; // "YYYY-MM-DD"
  financialYearId?: string;
  referenceNo?: string;
  narration?: string;
  narrationGujarati?: string;
  lines: CreateJournalLineDto[];
}
