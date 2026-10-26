export interface CreateBatchDto {
  itemId: string;
  batchNumber: string;
  mfgDate?: string | Date;
  expiryDate?: string | Date;
  purchaseRate?: number;
  mrp: number;
  salePrice?: number;
  saleRate?: number;
  barcode?: string;
}

export interface QueryBatchesDto {
  itemId?: string;
  barcode?: string;
}
