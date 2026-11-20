import { DataScope } from "@billing/shared-types";

export interface RolePermissionDto {
  module: string;
  action: string;
  allowed: boolean;
}

export class CreateRoleDto {
  name: string;
  description?: string;
  dataScope?: DataScope;
  isActive?: boolean;
  cloneFromRoleId?: string;
  permissions?: RolePermissionDto[] | Record<string, any>;
}

export class UpdateRoleDto {
  name?: string;
  description?: string;
  dataScope?: DataScope;
  isActive?: boolean;
  permissions?: RolePermissionDto[] | Record<string, any>;
}
