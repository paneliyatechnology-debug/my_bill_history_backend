import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { StockTransfersService } from "./stock-transfers.service";
import { CreateStockTransferDto } from "./dto/create-stock-transfer.dto";
import { UpdateStockTransferDto } from "./dto/update-stock-transfer.dto";
import { DispatchStockTransferDto } from "./dto/dispatch-stock-transfer.dto";
import { ReceiveStockTransferDto } from "./dto/receive-stock-transfer.dto";
import { CancelStockTransferDto } from "./dto/cancel-stock-transfer.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller("distribution/transfers")
export class StockTransfersController {
  constructor(private readonly service: StockTransfersService) {}

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
    @Body() dto: CreateStockTransferDto,
  ) {
    return this.service.createTransfer(ctx, dto);
  }

  @Get()
  async findAll(@CurrentTenant() ctx: TenantContext) {
    return this.service.findAllTransfers(ctx);
  }

  @Get(":id")
  async findOne(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.service.findTransferById(ctx, id);
  }

  @Get(":id/reconciliation")
  async getReconciliation(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.service.getReconciliation(ctx, id);
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
    @Body() dto: UpdateStockTransferDto,
  ) {
    return this.service.updateTransfer(ctx, id, dto);
  }

  @Post(":id/dispatch")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async dispatch(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: DispatchStockTransferDto,
  ) {
    return this.service.dispatchTransfer(ctx, id, dto);
  }

  @Post(":id/receive")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async receive(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: ReceiveStockTransferDto,
  ) {
    return this.service.receiveTransfer(ctx, id, dto);
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
    @Body() dto: CancelStockTransferDto,
  ) {
    return this.service.cancelTransfer(ctx, id, dto);
  }
}
