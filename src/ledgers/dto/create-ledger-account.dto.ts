import { AccountOpeningType } from "@billing/shared-types";

export interface CreateLedgerAccountDto {
  groupId: string;
  name: string;
  nameGujarati?: string;
  code?: string;
  partyId?: string;
  isBankLedger?: boolean;
  isCashLedger?: boolean;
  isTaxLedger?: boolean;
  taxRate?: number;
  openingBalance?: number | string;
  openingType?: AccountOpeningType;
  isActive?: boolean;
}
