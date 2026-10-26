import { DeliveryChallanType } from "@billing/database";

export interface CreateDeliveryChallanItemDto {
  itemId: string;
  batchId?: string;
  description?: string;
  hsnCode?: string;
  quantity: number;
  unitPrice?: number;
  taxRate?: number;
}

export interface CreateDeliveryChallanDto {
  warehouseId: string;
  branchId?: string;
  partyId?: string;
  challanDate?: string;
  challanType: DeliveryChallanType;
  placeOfSupply?: string;
  vehicleNumber?: string;
  isTaxable?: boolean;
  notes?: string;
  items: CreateDeliveryChallanItemDto[];
  idempotencyKey?: string;
}
