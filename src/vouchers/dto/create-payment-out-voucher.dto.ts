export interface PaymentOutAllocationDto {
  purchaseInvoiceId: string;
  amount: number | string;
  cashDiscount?: number | string;
}

export interface CreatePaymentOutVoucherDto {
  partyId: string;
  voucherDate: string;
  paidFromAccountId?: string;
  amount: number | string;
  paymentMode?: string;
  paymentNumber?: string;
  referenceNo?: string;
  discount?: number | string;
  narration?: string;
  narrationGujarati?: string;
  allocations?: PaymentOutAllocationDto[];
}
