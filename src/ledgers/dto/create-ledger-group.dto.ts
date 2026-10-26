import { AccountNature } from "@billing/shared-types";

export interface CreateLedgerGroupDto {
  name: string;
  nameGujarati?: string;
  nature: AccountNature;
  parentId?: string;
}
