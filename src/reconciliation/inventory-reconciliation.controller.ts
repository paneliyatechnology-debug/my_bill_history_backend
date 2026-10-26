import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { InventoryReconciliationService } from "./inventory-reconciliation.service";
import { PerpetualInventoryService } from "./perpetual-inventory.service";
import { QueryReconciliationDto } from "./dto/query-reconciliation.dto";
import { PostInventoryJournalDto } from "./dto/post-inventory-journal.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller("reconciliation")
export class InventoryReconciliationController {
  constructor(
    private readonly reconService: InventoryReconciliationService,
    private readonly perpetualService: PerpetualInventoryService,
  ) {}

  @Get("stock-gl")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async getStockGlReconciliation(
    @CurrentTenant() ctx: TenantContext,
    @Query() query: QueryReconciliationDto,
  ) {
    return this.reconService.getPhysicalVsGlReconciliation(ctx, query);
  }

  @Get("in-transit")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async getInTransitValuation(
    @CurrentTenant() ctx: TenantContext,
    @Query() query: QueryReconciliationDto,
  ) {
    return this.reconService.getInTransitValuationReport(ctx, query);
  }

  @Get("manufacturing-cost")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async getManufacturingCostReconciliation(
    @CurrentTenant() ctx: TenantContext,
    @Query() query: QueryReconciliationDto,
  ) {
    return this.reconService.getManufacturingCostReconciliation(ctx, query);
  }

  @Post("post-manufacturing-journal")
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async postManufacturingJournal(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: PostInventoryJournalDto,
  ) {
    return this.perpetualService.postManufacturingCompletionJournal(ctx, dto);
  }

  @Post("post-transit-loss-journal")
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async postTransitLossJournal(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: PostInventoryJournalDto,
  ) {
    return this.perpetualService.postTransitLossWriteOffJournal(ctx, dto);
  }

  @Post("vouchers/:id/reverse")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async reverseInventoryJournal(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body("reason") reason: string,
  ) {
    return this.perpetualService.reverseInventoryJournal(ctx, id, reason);
  }
}
