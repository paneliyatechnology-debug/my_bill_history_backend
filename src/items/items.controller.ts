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
} from "@nestjs/common";
import { ItemsService } from "./items.service";
import { CreateItemDto } from "./dto/create-item.dto";
import { UpdateItemDto, QueryItemsDto, AdjustStockDto } from "./dto/update-item.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller("items")
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateItemDto,
  ) {
    return this.itemsService.create(ctx, dto);
  }

  @Get("lookup")
  async lookup(
    @CurrentTenant() ctx: TenantContext,
    @Query("code") code: string,
  ) {
    return this.itemsService.lookup(ctx, code);
  }

  @Get()
  async findAll(
    @CurrentTenant() ctx: TenantContext,
    @Query() query: QueryItemsDto,
  ) {
    return this.itemsService.findAll(ctx, query);
  }

  @Get(":id")
  async findOne(@CurrentTenant() ctx: TenantContext, @Param("id") id: string) {
    return this.itemsService.findOne(ctx, id);
  }

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Put(":id")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.itemsService.update(ctx, id, dto);
  }

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Post(":id/adjust-stock")
  async adjustStock(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.itemsService.adjustStock(ctx, id, dto);
  }

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Patch(":id/archive")
  async archive(@CurrentTenant() ctx: TenantContext, @Param("id") id: string) {
    return this.itemsService.archive(ctx, id);
  }

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Post("bulk-delete")
  async bulkDelete(
    @CurrentTenant() ctx: TenantContext,
    @Body() body: { ids: string[]; force?: boolean },
  ) {
    return this.itemsService.bulkDelete(ctx, body.ids, Boolean(body.force));
  }

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Delete(":id")
  async delete(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Query("force") force?: string,
  ) {
    return this.itemsService.delete(ctx, id, force === "true" || force === "1");
  }
}
