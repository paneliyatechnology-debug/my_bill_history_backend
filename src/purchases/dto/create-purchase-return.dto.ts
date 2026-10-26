export interface CreatePurchaseReturnItemDto {
  purchaseItemId: string;
  quantity: number | string;
}

export interface CreatePurchaseReturnDto {
  returnNumber?: string;
  returnDate?: string;
  reason?: string;
  reasonGujarati?: string;
  warehouseId?: string;
  items: CreatePurchaseReturnItemDto[];
}
