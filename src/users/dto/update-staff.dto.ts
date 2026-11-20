import { UserRole, DataScope } from "@billing/shared-types";

export class UpdateStaffDto {
  fullName?: string;
  phone?: string;
  email?: string;
  username?: string;
  password?: string;
  role?: UserRole;
  isActive?: boolean;
  customRoleId?: string;
  branchIds?: string[];
  dataScope?: DataScope;
  maxInvoiceAmount?: number;
  maxDiscountPercent?: number;
  canOverridePrice?: boolean;
  permissions?: { module: string; action: string; allowed: boolean }[];
}
