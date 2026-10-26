import { CreateStockTransferItemDto } from "./create-stock-transfer.dto";

export interface UpdateStockTransferDto {
  toWarehouseId?: string;
  transferDate?: string;
  notes?: string;
  challanNumber?: string;
  items?: CreateStockTransferItemDto[];
}
