export interface CreateStaffPaymentDto {
  staffId: string;
  staffName: string;
  amount: number;
  paymentType: "SALARY" | "ADVANCE" | "BONUS" | "DEDUCTION";
  paymentMode?: "CASH" | "BANK_TRANSFER" | "UPI" | "CHEQUE";
  paymentDate?: string;
  paidFromAccountId?: string;
  note?: string;
  referenceNo?: string;
  idempotencyKey?: string;
}
