export interface CreateSalesReturnItemDto {
  salesItemId?: string;
  invoiceItemId?: string;
  itemId?: string;
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  taxRate?: number | string;
  taxableAmount?: number | string;
  cgstAmount?: number | string;
  sgstAmount?: number | string;
  igstAmount?: number | string;
  totalAmount?: number | string;
  reason?: string;
  disposition?: string;
}

export interface CreateSalesReturnDto {
  salesInvoiceId?: string;
  returnNumber?: string;
  returnDate?: string;
  reason?: string;
  reasonGujarati?: string;
  warehouseId?: string;
  restoreStock?: boolean;
  docType?: "SALES_RETURN" | "CREDIT_NOTE";
  creditNoteType?: "ITEM_BASED" | "AMOUNT_BASED";
  gstCategory?: "SECTION_34" | "COMMERCIAL";
  disposition?: "SELLABLE" | "DAMAGED" | "SCRAPPED";
  settlementMode?:
    | "ADJUST_OUTSTANDING"
    | "CUSTOMER_CREDIT"
    | "REFUND_CASH"
    | "REFUND_BANK"
    | "PENDING_REFUND";
  linkedReturnId?: string;
  notes?: string;
  items?: CreateSalesReturnItemDto[];
  amount?: number | string; // For simple Amount-Based Credit Notes
  taxRate?: number | string; // For simple Amount-Based Credit Notes
}
