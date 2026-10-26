export interface CreatePurchaseInvoiceItemDto {
  itemId: string;
  hsnCode?: string;
  quantity: number | string;
  unitPrice: number | string;
  taxRate: number | string;
}

export interface CreatePurchaseInvoiceDto {
  partyId: string;
  vendorInvoiceNumber: string;
  invoiceDate?: string;
  placeOfSupply?: string;
  warehouseId?: string;
  itcEligibility?: string;
  items: CreatePurchaseInvoiceItemDto[];
}
