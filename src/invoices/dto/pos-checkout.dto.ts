import { PaymentMode } from "@billing/shared-types";
import { CreateSalesInvoiceItemDto } from "./create-sales-invoice.dto";

export interface PosCheckoutDto {
  clientOfflineUuid?: string;
  offlineBillNumber?: string;
  customerPhone?: string;
  customerName?: string;
  partyId?: string;
  paymentMode?: PaymentMode;
  discountType?: "BEFORE_TAX" | "AFTER_TAX";
  discountPercent?: number | string;
  discountAmount?: number | string;
  additionalCharges?: Array<{ name?: string; amount: number | string }>;
  receivedAmount?: number;
  tenderedSplit?: {
    cash?: number;
    upiQr?: number;
    bankTransfer?: number;
    cheque?: number;
    card?: number;
  };
  items: CreateSalesInvoiceItemDto[];
  warehouseId?: string;
  branchId?: string;
  notes?: string;
}
