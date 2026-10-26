export interface CreateBomItemDto {
  rawItemId: string;
  quantity: number;
  wastagePercent?: number;
}

export interface CreateBomDto {
  finishedItemId: string;
  bomName: string;
  batchYieldQty: number;
  laborCostEst?: number;
  overheadCostEst?: number;
  items: CreateBomItemDto[];
}
