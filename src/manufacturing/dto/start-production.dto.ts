export interface StartProductionDto {
  sourceWarehouseId: string;
  batchOverrides?: Array<{
    rawItemId: string;
    batchId?: string;
    quantity?: number;
  }>;
  idempotencyKey?: string;
}
