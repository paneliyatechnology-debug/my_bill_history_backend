import { HsnType } from "@billing/shared-types";

export interface UpdateHsnDto {
  description?: string;
  descriptionGujarati?: string;
  type?: HsnType;
  gstRate?: number;
  cessRate?: number;
  chapter?: string;
  notes?: string;
  isActive?: boolean;
}
