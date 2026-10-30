export interface InvitePartyDto {
  partyId: string;
  channel?: "WHATSAPP" | "SMS" | "EMAIL" | "LINK";
}

export interface ToggleSharedLedgerDto {
  partyId: string;
  enabled: boolean;
}

export interface SettleBalanceDto {
  partyId: string;
  amount: number;
  paymentMode: "CASH" | "BANK_TRANSFER" | "UPI" | "CHEQUE";
  referenceNo?: string;
  date?: string | Date;
  notes?: string;
}

export interface QuerySharedLedgerDto {
  search?: string;
  type?: "ALL" | "CUSTOMER" | "SUPPLIER";
  status?: "ALL" | "CONNECTED" | "INVITED" | "NOT_LINKED";
  page?: number | string;
  limit?: number | string;
}

export interface SharedLedgerSettingsDto {
  showSharedLedgersOfParties: boolean;
  allowPartiesToViewSharedLedger: boolean;
}

export interface ConvertToPurchaseDto {
  invoiceId: string;
}

export interface QueryPartyTransactionsDto {
  startDate?: string;
  endDate?: string;
  search?: string;
  type?: string;
  sortBy?: "date" | "amount";
  sortOrder?: "asc" | "desc";
}
