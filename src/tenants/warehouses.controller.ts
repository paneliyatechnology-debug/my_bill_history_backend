import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from "@nestjs/common";
import { TenantsService } from "./tenants.service";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller("warehouses")
export class WarehousesController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  async getWarehouses(@CurrentTenant() ctx: TenantContext) {
    return this.tenantsService.getWarehouses(ctx);
  }

  @Post()
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async createWarehouse(
    @CurrentTenant() ctx: TenantContext,
    @Body()
    dto: {
      name: string;
      isDefault?: boolean;
      address?: string;
      branchId?: string;
    },
  ) {
    return this.tenantsService.createWarehouse(ctx, dto);
  }

  @Put(":id")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async updateWarehouse(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body()
    dto: {
      name?: string;
      isDefault?: boolean;
      address?: string;
    },
  ) {
    return this.tenantsService.updateWarehouse(ctx, id, dto);
  }

  @Delete(":id")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async deleteWarehouse(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.tenantsService.deleteWarehouse(ctx, id);
  }
}
