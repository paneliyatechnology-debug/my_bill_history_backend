export interface ReceiptAllocationDto {
  invoiceId?: string;
  salesInvoiceId?: string;
  settledAmount?: number | string;
  amount?: number | string;
  cashDiscountGiven?: number | string;
  cashDiscount?: number | string;
}

export interface CreateReceiptVoucherDto {
  partyId: string;
  voucherDate: string;
  depositToAccountId?: string;
  receivedAmount: number | string;
  paymentMode?: string;
  paymentReference?: string;
  narration?: string;
  narrationGujarati?: string;
  allocations?: ReceiptAllocationDto[];
}

export interface UpdateReceiptVoucherDto {
  partyId?: string;
  voucherDate?: string;
  date?: string;
  voucherNumber?: string;
  paymentNumber?: string;
  receiptNumber?: string;
  depositToAccountId?: string;
  paidToAccountId?: string;
  accountId?: string;
  bankAccountId?: string;
  receivedAmount?: number | string;
  amount?: number | string;
  totalAmount?: number | string;
  discount?: number | string;
  discountAmount?: number | string;
  cashDiscount?: number | string;
  paymentMode?: string;
  referenceNo?: string;
  paymentReference?: string;
  chequeNumber?: string;
  narration?: string;
  notes?: string;
  narrationGujarati?: string;
  allocations?: ReceiptAllocationDto[];
}
