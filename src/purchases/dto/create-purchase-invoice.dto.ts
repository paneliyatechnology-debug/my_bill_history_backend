export interface CreatePurchaseInvoiceItemDto {
  itemId: string;
  hsnCode?: string;
  quantity: number | string;
  unitPrice: number | string;
  taxRate: number | string;
}

export interface CreatePurchaseInvoiceDto {
  partyId: string;
  vendorInvoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  placeOfSupply?: string;
  warehouseId?: string;
  itcEligibility?: string;
  paidAmount?: number | string;
  paymentMode?: string;
  paidFromAccountId?: string;
  paymentDate?: string;
  paymentReference?: string;
  items: CreatePurchaseInvoiceItemDto[];
}
