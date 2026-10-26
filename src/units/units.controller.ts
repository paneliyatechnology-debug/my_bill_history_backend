import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { UnitsService } from "./units.service";
import { CreateUnitDto } from "./dto/create-unit.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller("units")
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateUnitDto,
  ) {
    return this.unitsService.create(ctx, dto);
  }

  @Get()
  async findAll(@CurrentTenant() ctx: TenantContext) {
    return this.unitsService.findAll(ctx);
  }

  @Get(":id")
  async findOne(@CurrentTenant() ctx: TenantContext, @Param("id") id: string) {
    return this.unitsService.findOne(ctx, id);
  }

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Put(":id")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: { name?: string; symbol?: string; uqcCode?: string; decimalPlaces?: number },
  ) {
    return this.unitsService.update(ctx, id, dto);
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Post("bulk-delete")
  @HttpCode(HttpStatus.OK)
  async bulkDelete(
    @CurrentTenant() ctx: TenantContext,
    @Body() body: { ids: string[] },
  ) {
    return this.unitsService.bulkDelete(ctx, body.ids);
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Delete(":id")
  async delete(@CurrentTenant() ctx: TenantContext, @Param("id") id: string) {
    return this.unitsService.delete(ctx, id);
  }
}

