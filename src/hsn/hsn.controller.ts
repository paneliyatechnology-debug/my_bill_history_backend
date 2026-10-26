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
import { HsnService } from "./hsn.service";
import { CreateHsnDto } from "./dto/create-hsn.dto";
import { UpdateHsnDto } from "./dto/update-hsn.dto";
import { QueryHsnDto } from "./dto/query-hsn.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller("hsn")
export class HsnController {
  constructor(private readonly hsnService: HsnService) {}

  @Get()
  async findAll(
    @CurrentTenant() ctx: TenantContext,
    @Query() query: QueryHsnDto,
  ) {
    return this.hsnService.findAll(ctx, query);
  }

  @Get("search")
  async search(
    @CurrentTenant() ctx: TenantContext,
    @Query("q") q?: string,
    @Query("limit") limit?: string,
  ) {
    return this.hsnService.search(ctx, q, limit ? Number(limit) : undefined);
  }

  @Get(":id")
  async findOne(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.hsnService.findOne(ctx, id);
  }

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateHsnDto,
  ) {
    return this.hsnService.create(ctx, dto);
  }

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Put(":id")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: UpdateHsnDto,
  ) {
    return this.hsnService.update(ctx, id, dto);
  }

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Patch(":id/status")
  async toggleStatus(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body("isActive") isActive: boolean,
  ) {
    return this.hsnService.toggleStatus(ctx, id, Boolean(isActive));
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Delete(":id")
  async delete(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.hsnService.delete(ctx, id);
  }
}
