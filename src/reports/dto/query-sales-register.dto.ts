import { InvoiceCategory, InvoiceStatus } from "@billing/shared-types";

export interface QuerySalesRegisterDto {
  fromDate?: string;
  toDate?: string;
  branchId?: string;
  partyId?: string;
  category?: InvoiceCategory;
  status?: InvoiceStatus;
  page?: number | string;
  limit?: number | string;
}
