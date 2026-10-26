export interface CompleteProductionDto {
  targetWarehouseId: string;
  actualProducedQty: number;
  scrapQuantity?: number;
  actualLaborCost?: number;
  actualOverheadCost?: number;
  batchNumber?: string;
  mfgDate?: string;
  expiryDate?: string;
  idempotencyKey?: string;
}
