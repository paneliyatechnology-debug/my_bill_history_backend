import { PaymentMode } from "@billing/shared-types";

export interface PurchasePaymentAllocationInput {
  purchaseInvoiceId: string;
  amount: number | string;
  cashDiscount?: number | string;
}

/**
 * Settles one or more posted purchase bills.
 * Unallocated supplier advances are not accepted: the cash amount must equal the sum of allocation amounts,
 * and each allocation plus its discount cannot exceed that bill's remaining payable.
 */
export interface RecordPurchasePaymentDto {
  amount?: number | string;
  paymentMode?: PaymentMode;
  paidFromAccountId?: string;
  paymentDate?: string;
  referenceNo?: string;
  cashDiscount?: number | string;
  notes?: string;
  allocations?: PurchasePaymentAllocationInput[];
}
