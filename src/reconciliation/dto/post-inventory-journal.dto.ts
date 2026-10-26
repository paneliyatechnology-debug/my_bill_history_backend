export interface PostInventoryJournalDto {
  journalType: "MANUFACTURING_COMPLETION" | "TRANSIT_LOSS_WRITEOFF";
  productionOrderId?: string;
  stockTransferId?: string;
  debitAccountId?: string;
  creditAccountId?: string;
  voucherDate?: string;
  narration?: string;
  idempotencyKey?: string;
}
