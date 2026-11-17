export interface VerifiedBusinessPaymentDetails {
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  bankAccountHolder?: string | null;
  upiId?: string | null;
}

export interface ConversationTurnItem {
  role: "system" | "assistant" | "user";
  content: string;
  timestamp?: Date;
}

export interface CallConversationContext {
  callId: string;
  tenantId: string;
  companyId: string;
  businessName: string;
  businessPhone?: string;
  customerName: string;
  customerPhone: string;
  preferredLanguage: string; // "gujarati" | "hindi" | "english"
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate?: string | null;
    grandTotal: number;
    paidAmount: number;
    balanceAmount: number;
  }>;
  totalOutstanding: number;
  verifiedPaymentDetails: VerifiedBusinessPaymentDetails;
  history: ConversationTurnItem[];
  turnIndex: number;
  lastPaymentDate?: string | null;
  previousPromiseDate?: string | null;
}

