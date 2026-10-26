import { ItemType, ValuationMethod } from "@billing/shared-types";

export interface CreateItemDto {
  type: ItemType; // PRODUCT | SERVICE
  name: string;
  nameGujarati?: string;
  sku?: string;
  barcode?: string;
  hsnCode: string; // 2, 4, 6, 8 digit HSN or 6-digit SAC (99xxxx)
  hsnMasterId?: string;
  categoryId?: string;
  primaryUomId: string;
  secondaryUomId?: string;
  conversionFactor?: number;
  taxRate: number; // e.g. 5.00, 12.00, 18.00, 28.00
  cessRate?: number;
  cessPerUnit?: number;
  purchaseRate?: number;
  retailPrice: number;
  wholesalePrice?: number;
  mrp?: number;
  minStockLevel?: number;
  reorderQuantity?: number;
  openingStock?: number;
  openingStockDate?: string;
  openingBatchNumber?: string;
  openingMfgDate?: string;
  openingExpiryDate?: string;
  warehouseId?: string;
  trackBatches?: boolean;
  trackSerialNo?: boolean;
  valuationMethod?: ValuationMethod;
}
