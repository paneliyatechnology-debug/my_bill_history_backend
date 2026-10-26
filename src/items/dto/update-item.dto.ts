import { ItemType, ValuationMethod } from "@billing/shared-types";

export interface UpdateItemDto {
  type?: ItemType;
  name?: string;
  nameGujarati?: string;
  sku?: string;
  barcode?: string;
  hsnCode?: string;
  hsnMasterId?: string | null;
  categoryId?: string | null;
  primaryUomId?: string;
  secondaryUomId?: string | null;
  conversionFactor?: number | null;
  taxRate?: number;
  cessRate?: number;
  cessPerUnit?: number;
  purchaseRate?: number;
  retailPrice?: number;
  wholesalePrice?: number;
  mrp?: number | null;
  minStockLevel?: number;
  reorderQuantity?: number;
  trackBatches?: boolean;
  trackSerialNo?: boolean;
  valuationMethod?: ValuationMethod;
  isActive?: boolean;
  openingStock?: number | string;
  openingStockDate?: string;
  warehouseId?: string;
}

export interface AdjustStockDto {
  quantity: number | string;
  type: "ADD" | "REDUCE";
  warehouseId?: string;
  date?: string;
  remarks?: string;
}

export interface QueryItemsDto {
  search?: string;
  type?: ItemType;
  categoryId?: string;
  isActive?: boolean | string;
  page?: number | string;
  limit?: number | string;
}
