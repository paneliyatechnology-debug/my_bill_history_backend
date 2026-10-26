export interface CreateSalesReturnItemDto {
  salesItemId?: string;
  invoiceItemId?: string;
  quantity: number | string;
  reason?: string;
  disposition?: string;
}

export interface CreateSalesReturnDto {
  salesInvoiceId?: string;
  returnDate?: string;
  reason?: string;
  reasonGujarati?: string;
  warehouseId?: string;
  restoreStock?: boolean;
  items: CreateSalesReturnItemDto[];
}
