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
  UseGuards,
} from "@nestjs/common";
import { BomService } from "./bom.service";
import { CreateBomDto } from "./dto/create-bom.dto";
import { UpdateBomDto } from "./dto/update-bom.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller("manufacturing/boms")
export class BomController {
  constructor(private readonly bomService: BomService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateBomDto,
  ) {
    return this.bomService.createBom(ctx, dto);
  }

  @Get()
  async findAll(@CurrentTenant() ctx: TenantContext) {
    return this.bomService.findAllBoms(ctx);
  }

  @Get(":id")
  async findOne(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.bomService.findBomById(ctx, id);
  }

  @Put(":id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: UpdateBomDto,
  ) {
    return this.bomService.updateBom(ctx, id, dto);
  }

  @Delete(":id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
  )
  async delete(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.bomService.deleteBom(ctx, id);
  }
}
