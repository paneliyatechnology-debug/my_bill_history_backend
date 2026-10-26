export interface QueryReconciliationDto {
  asOfDate?: string;
  warehouseId?: string;
  financialYearId?: string;
}

export interface StockGlReconciliationResponse {
  companyId: string;
  asOfDate: string;
  physicalStockValuation: number;
  totalItemsCount: number;
  generalLedgerPurchaseTotal: number;
  inTransitValuation: number;
  transitLossValuation: number;
  manufacturingWipValuation: number;
  reconciliationVariance: number;
  isBalanced: boolean;
  notes: string[];
  // Enhanced accounting audit fields
  openingStockValuation?: number;
  costOfGoodsSoldValuation?: number;
  expectedPeriodicInventory?: number;
  glInventoryAssetBalance?: number;
  periodicVariance?: number;
  perpetualVariance?: number;
  accountingPolicy?: "PERIODIC" | "PERPETUAL";
}

export interface InTransitValuationResponse {
  companyId: string;
  totalInTransitQuantity: number;
  totalInTransitValuation: number;
  transfersCount: number;
  transfers: Array<{
    transferId: string;
    transferNumber: string;
    fromWarehouse: string;
    toWarehouse: string;
    dispatchedAt: string;
    itemsCount: number;
    inTransitQuantity: number;
    inTransitValuation: number;
  }>;
}

export interface ManufacturingCostReconciliationResponse {
  companyId: string;
  totalOrdersCount: number;
  totalRawMaterialCost: number;
  totalActualLaborCost: number;
  totalActualOverheadCost: number;
  totalProductionCost: number;
  totalFinishedValuationYield: number;
  unabsorbedVariance: number;
}
