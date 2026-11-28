import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from "@nestjs/common";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import {
  PurchaseOrdersService,
  CreatePurchaseOrderDto,
} from "./purchase-orders.service";

@Controller("purchases/orders")
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @RequirePermissions({ module: "purchases", action: "view" })
  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query("status") status?: string,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.purchaseOrdersService.list(tenant, {
      status,
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @RequirePermissions({ module: "purchases", action: "view" })
  @Get(":id")
  async getById(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.purchaseOrdersService.getById(id, tenant);
  }

  @RequirePermissions({ module: "purchases", action: "create" })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.PARTNER,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async create(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.purchaseOrdersService.create(dto, tenant);
  }

  @RequirePermissions({ module: "purchases", action: "create" })
  @Post("migrate-local")
  @HttpCode(HttpStatus.OK)
  async migrateLocal(
    @Body() body: { orders: CreatePurchaseOrderDto[] },
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.purchaseOrdersService.migrateLocal(body?.orders || [], tenant);
  }

  @RequirePermissions({ module: "purchases", action: "edit" })
  @Put(":id")
  async update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: Partial<CreatePurchaseOrderDto>,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.purchaseOrdersService.update(id, dto, tenant);
  }

  @RequirePermissions({ module: "purchases", action: "edit" })
  @Patch(":id/status")
  async updateStatus(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: { status: string },
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.purchaseOrdersService.updateStatus(id, body?.status, tenant);
  }

  @RequirePermissions({ module: "purchases", action: "delete" })
  @Delete(":id")
  async remove(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.purchaseOrdersService.remove(id, tenant);
  }
}
