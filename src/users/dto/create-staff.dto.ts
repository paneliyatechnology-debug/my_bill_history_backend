import { UserRole, DataScope } from "@billing/shared-types";

export class CreateStaffDto {
  fullName: string;
  phone: string;
  email?: string;
  username?: string;
  password?: string;
  role: UserRole;
  customRoleId?: string;
  branchIds?: string[];
  dataScope?: DataScope;
  maxInvoiceAmount?: number;
  maxDiscountPercent?: number;
  canOverridePrice?: boolean;
  permissions?: { module: string; action: string; allowed: boolean }[];
}
