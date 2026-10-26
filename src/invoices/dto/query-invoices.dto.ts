import { InvoiceStatus, InvoiceCategory } from "@billing/shared-types";

export interface QueryInvoicesDto {
  page?: string;
  limit?: string;
  partyId?: string;
  status?: InvoiceStatus;
  category?: InvoiceCategory;
  startDate?: string;
  endDate?: string;
  search?: string;
}
