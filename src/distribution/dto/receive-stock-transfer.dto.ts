export interface ReceiveStockTransferItemDto {
  itemId: string;
  batchId?: string;
  receivedQuantity: number;
  shortageQuantity?: number;
  damageQuantity?: number;
  remarks?: string;
}

export interface ReceiveStockTransferDto {
  items: ReceiveStockTransferItemDto[];
  notes?: string;
  idempotencyKey?: string;
}
