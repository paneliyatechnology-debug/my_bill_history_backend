import { PaymentMode } from "@billing/shared-types";

export interface RecordInvoicePaymentDto {
  amount: number | string;
  paymentMode?: PaymentMode;
  paymentDate?: string;
  referenceNo?: string;
  cashDiscount?: number | string;
  depositToAccountId?: string;
  notes?: string;
}
