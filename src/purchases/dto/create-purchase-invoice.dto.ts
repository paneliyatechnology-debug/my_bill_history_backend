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
  freightAmount?: number | string;
  additionalCharges?: number | string | Array<{ name?: string; amount: number | string }>;
  shippingAddress?: any;
  vehicleNumber?: string;
  transportMode?: string;
  notes?: string;
  termsAndConditions?: string;
  roundOff?: number | string;
  items: CreatePurchaseInvoiceItemDto[];
}
