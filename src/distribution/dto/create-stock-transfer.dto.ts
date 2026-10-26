export interface CreateStockTransferItemDto {
  itemId: string;
  batchId?: string;
  quantity: number;
}

export interface CreateStockTransferDto {
  fromWarehouseId: string;
  toWarehouseId: string;
  branchId?: string;
  transferDate?: string;
  notes?: string;
  challanNumber?: string;
  items: CreateStockTransferItemDto[];
  idempotencyKey?: string;
}
