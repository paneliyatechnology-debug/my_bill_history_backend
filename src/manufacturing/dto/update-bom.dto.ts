import { CreateBomItemDto } from "./create-bom.dto";

export interface UpdateBomDto {
  bomName?: string;
  batchYieldQty?: number;
  laborCostEst?: number;
  overheadCostEst?: number;
  items?: CreateBomItemDto[];
}
