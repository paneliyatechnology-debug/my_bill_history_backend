export interface QuerySalesReturnsDto {
  partyId?: string;
  salesInvoiceId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  docType?: "SALES_RETURN" | "CREDIT_NOTE";
  creditNoteType?: string;
  gstCategory?: string;
  warehouseId?: string;
  settlementMode?: string;
  disposition?: string;
  limit?: number | string;
  offset?: number | string;
}
