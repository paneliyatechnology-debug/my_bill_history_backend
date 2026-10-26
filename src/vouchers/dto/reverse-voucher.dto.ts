export interface ReverseVoucherDto {
  reason: string;
  reversalVoucherNumber?: string;
  reversalDate?: string; // Optional: defaults to current date or original voucher date
}
