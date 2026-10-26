export interface CreateExpenseVoucherDto {
  expenseAccountId: string;
  paidFromAccountId?: string;
  amount: number;
  voucherDate?: string;
  voucherNumber?: string;
  narration?: string;
  referenceNo?: string;
}
