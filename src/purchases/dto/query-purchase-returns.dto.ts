export interface QueryPurchaseReturnsDto {
  partyId?: string;
  purchaseInvoiceId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
  offset?: number;
}
