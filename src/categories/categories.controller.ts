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
import { CategoriesService } from "./categories.service";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller("categories")
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(ctx, dto);
  }

  @Get()
  async findAll(@CurrentTenant() ctx: TenantContext) {
    return this.categoriesService.findAll(ctx);
  }

  @Get(":id")
  async findOne(@CurrentTenant() ctx: TenantContext, @Param("id") id: string) {
    return this.categoriesService.findOne(ctx, id);
  }

  @Roles(UserRole.COMPANY_ADMIN, UserRole.ACCOUNTANT)
  @Put(":id")
  async update(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: { name?: string; nameGujarati?: string },
  ) {
    return this.categoriesService.update(ctx, id, dto);
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Post("bulk-delete")
  @HttpCode(HttpStatus.OK)
  async bulkDelete(
    @CurrentTenant() ctx: TenantContext,
    @Body() body: { ids: string[] },
  ) {
    return this.categoriesService.bulkDelete(ctx, body.ids);
  }

  @Roles(UserRole.COMPANY_ADMIN)
  @Delete(":id")
  async delete(@CurrentTenant() ctx: TenantContext, @Param("id") id: string) {
    return this.categoriesService.delete(ctx, id);
  }
}

