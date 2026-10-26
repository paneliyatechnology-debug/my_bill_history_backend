import { PaymentMode } from "@billing/shared-types";
import { CreateSalesInvoiceItemDto } from "./create-sales-invoice.dto";

export interface PosSyncInvoiceDto {
  clientOfflineUuid: string;
  offlineBillNumber?: string;
  createdAt?: string;
  customerPhone?: string;
  customerName?: string;
  grandTotal?: number;
  paymentMode?: PaymentMode;
  receivedAmount?: number;
  tenderedSplit?: {
    cash?: number;
    upiQr?: number;
    bankTransfer?: number;
    cheque?: number;
    card?: number;
  };
  items: CreateSalesInvoiceItemDto[];
}

export interface PosSyncDto {
  terminalId: string;
  syncTimestamp: string;
  invoices: PosSyncInvoiceDto[];
}
