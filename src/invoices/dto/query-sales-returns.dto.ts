export interface QuerySalesReturnsDto {
  partyId?: string;
  salesInvoiceId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number | string;
  offset?: number | string;
}
