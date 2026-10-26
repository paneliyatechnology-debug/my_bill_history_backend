export interface CreateStockAdjustmentDto {
  itemId: string;
  warehouseId?: string;
  type: "STOCK_ADJUSTMENT_PLUS" | "STOCK_ADJUSTMENT_MINUS" | "OPENING";
  quantity: number;
  valuationRate?: number;
  reason?: string;
  transactionDate?: string;
}
