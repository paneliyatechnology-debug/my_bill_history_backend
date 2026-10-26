import { VoucherType, PartyType } from "@billing/shared-types";

export interface QueryReceiptPaymentRegisterDto {
  fromDate?: string;
  toDate?: string;
  voucherType?: VoucherType;
  branchId?: string;
  page?: number | string;
  limit?: number | string;
}

export interface QueryOutstandingBalancesDto {
  partyType?: PartyType | "ALL";
  asOfDate?: string;
  search?: string;
  page?: number | string;
  limit?: number | string;
}

export interface QueryPartyAgingDto {
  asOfDate?: string;
  bucketDays?: number | string;
  partyId?: string;
}

export interface QueryPartyLedgerDto {
  partyId: string;
  fromDate?: string;
  toDate?: string;
  financialYearId?: string;
}

export interface QueryGeneralLedgerDto {
  accountId: string;
  fromDate?: string;
  toDate?: string;
  financialYearId?: string;
}

export interface QueryFinancialStatementDto {
  financialYearId?: string;
  fromDate?: string;
  toDate?: string;
  asOfDate?: string;
  branchId?: string;
}

export interface QueryDaybookDto {
  date?: string;
  branchId?: string;
}

export interface QueryStockSummaryDto {
  warehouseId?: string;
  categoryId?: string;
  asOfDate?: string;
  search?: string;
  page?: number | string;
  limit?: number | string;
}

export interface QueryStockMovementReportDto {
  itemId: string;
  warehouseId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number | string;
  limit?: number | string;
}

export interface QueryGstr1ReportDto {
  financialYearId?: string;
  month?: number | string;
  year?: number | string;
  fromDate?: string;
  toDate?: string;
}

export interface QueryFinancialSummaryDto {
  asOfDate?: string;
}

export type { FinancialSummaryDto } from "@billing/shared-types";
