import { toNumber } from "../../common/utils/response.mapper";

export interface ItemListDto {
  id: string;
  name: string;
  nameGujarati?: string | null;
  type: string;
  sku: string | null;
  barcode: string | null;
  hsnCode: string | null;
  isActive: boolean;
  minStockLevel: number;
  taxRate: number;
  retailPrice: number;
  purchaseRate: number;
  currentStock: number;
  unit: string;
  categoryId: string | null;
}

export interface ItemDetailDto extends ItemListDto {
  description: string | null;
  trackBatches: boolean;
  gstRate: number;
  salesPrice: number;
  wholesalePrice: number;
  purchasePrice: number;
  mrp: number;
  unitName: string;
  primaryUomId: string | null;
  secondaryUomId: string | null;
  conversionFactor: number;
  primaryUom: { id: string; name: string; symbol: string } | null;
  secondaryUom: { id: string; name: string; symbol: string } | null;
  category: { id: string; name: string } | null;
  categoryName: string | null;
  openingBatchNumber: string | null;
  openingMfgDate: Date | string | null;
  openingExpiryDate: Date | string | null;
  batches: Array<{
    id: string;
    batchNumber: string;
    mfgDate: Date | string | null;
    expiryDate: Date | string | null;
    mrp: number;
    purchaseRate: number;
    salePrice: number;
  }>;
}

export function mapItemListDto(
  it: any,
  computed: {
    currentStock: number;
    salesPrice: number;
    purchasePrice: number;
    unit: string;
  },
): ItemListDto {
  return {
    id: it.id,
    name: it.name,
    ...(it.nameGujarati ? { nameGujarati: it.nameGujarati } : {}),
    type: it.type,
    sku: it.sku ?? null,
    barcode: it.barcode ?? null,
    hsnCode: it.hsnCode ?? null,
    isActive: Boolean(it.isActive),
    minStockLevel: toNumber(it.minStockLevel),
    taxRate: toNumber(it.taxRate),
    retailPrice: computed.salesPrice,
    purchaseRate: computed.purchasePrice,
    currentStock: computed.currentStock,
    unit: computed.unit,
    categoryId: it.categoryId ?? null,
  };
}

export function mapItemDetailDto(
  it: any,
  computed: {
    currentStock: number;
    salesPrice: number;
    purchasePrice: number;
    unit: string;
    unitName: string;
    categoryName: string | null;
  },
): ItemDetailDto {
  const firstBatch = it.batches?.[0];
  return {
    ...mapItemListDto(it, computed),
    description: it.description || null,
    trackBatches: Boolean(it.trackBatches),
    gstRate: toNumber(it.taxRate),
    salesPrice: computed.salesPrice,
    wholesalePrice: toNumber(it.wholesalePrice),
    purchasePrice: computed.purchasePrice,
    mrp: toNumber(it.mrp),
    unitName: computed.unitName,
    primaryUomId: it.primaryUomId ?? null,
    secondaryUomId: it.secondaryUomId ?? null,
    conversionFactor: toNumber(it.conversionFactor, 1),
    primaryUom: it.primaryUom
      ? {
          id: it.primaryUom.id,
          name: it.primaryUom.name,
          symbol: it.primaryUom.symbol,
        }
      : null,
    secondaryUom: it.secondaryUom
      ? {
          id: it.secondaryUom.id,
          name: it.secondaryUom.name,
          symbol: it.secondaryUom.symbol,
        }
      : null,
    category: it.category
      ? { id: it.category.id, name: it.category.name }
      : null,
    categoryName: computed.categoryName,
    openingBatchNumber: firstBatch?.batchNumber || null,
    openingMfgDate: firstBatch?.mfgDate || null,
    openingExpiryDate: firstBatch?.expiryDate || null,
    batches: (it.batches || []).map((b: any) => ({
      id: b.id,
      batchNumber: b.batchNumber,
      mfgDate: b.mfgDate ?? null,
      expiryDate: b.expiryDate ?? null,
      mrp: toNumber(b.mrp),
      purchaseRate: toNumber(b.purchaseRate),
      salePrice: toNumber(b.salePrice),
    })),
  };
}
