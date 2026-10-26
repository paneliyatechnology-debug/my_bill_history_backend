import { HsnType } from "@billing/shared-types";

export interface QueryHsnDto {
  search?: string;
  type?: HsnType;
  isActive?: string; // 'true', 'false', 'all'
  page?: number | string;
  limit?: number | string;
}
