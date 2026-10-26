import { HsnType } from "@billing/shared-types";

export interface CreateHsnDto {
  code: string; // 2 to 8 digit HSN or 6-digit SAC
  description: string;
  descriptionGujarati?: string;
  type?: HsnType; // HSN or SAC
  gstRate?: number; // 0, 0.1, 0.25, 3, 5, 12, 18, 28
  cessRate?: number;
  chapter?: string;
  notes?: string;
}
