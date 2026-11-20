import { SetMetadata } from "@nestjs/common";

export interface RequiredPermission {
  module: string;
  action: string;
}

export const PERMISSIONS_KEY = "required_permissions";
export const RequirePermissions = (...permissions: RequiredPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
