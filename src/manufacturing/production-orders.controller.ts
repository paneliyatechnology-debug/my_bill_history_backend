import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ProductionOrdersService } from "./production-orders.service";
import { CreateProductionOrderDto } from "./dto/create-production-order.dto";
import { StartProductionDto } from "./dto/start-production.dto";
import { CompleteProductionDto } from "./dto/complete-production.dto";
import { CancelProductionDto } from "./dto/cancel-production.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller("manufacturing/orders")
export class ProductionOrdersController {
  constructor(
    private readonly productionOrdersService: ProductionOrdersService,
  ) {}

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
    @Body() dto: CreateProductionOrderDto,
  ) {
    return this.productionOrdersService.createOrder(ctx, dto);
  }

  @Get()
  async findAll(@CurrentTenant() ctx: TenantContext) {
    return this.productionOrdersService.findAllOrders(ctx);
  }

  @Get(":id")
  async findOne(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.productionOrdersService.findOrderById(ctx, id);
  }

  @Post(":id/start")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async start(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: StartProductionDto,
  ) {
    return this.productionOrdersService.startProduction(ctx, id, dto);
  }

  @Post(":id/complete")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async complete(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: CompleteProductionDto,
  ) {
    return this.productionOrdersService.completeProduction(ctx, id, dto);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async cancel(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: CancelProductionDto,
  ) {
    return this.productionOrdersService.cancelOrder(ctx, id, dto);
  }
}
