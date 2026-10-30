import {
  Controller,
  Get,
  Put,
  Delete,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.ORG_ADMIN,
  UserRole.COMPANY_ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.AUDITOR,
  UserRole.BRANCH_MANAGER,
  UserRole.CASHIER,
  UserRole.SALESMAN,
)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get(["summary", "financial-summary"])
  async getSummary(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: any,
  ) {
    return await this.dashboardService.getSummary(tenant, query);
  }

  @Get("latest-transactions")
  async getLatestTransactions(
    @CurrentTenant() tenant: TenantContext,
    @Query("limit") limit?: number,
  ) {
    return await this.dashboardService.getLatestTransactions(tenant, limit);
  }

  @Get("sales-overview")
  async getSalesOverview(
    @CurrentTenant() tenant: TenantContext,
    @Query("days") days?: number,
  ) {
    return await this.dashboardService.getSalesOverview(tenant, days);
  }

  @Get("bank-accounts")
  async getBankAccounts(@CurrentTenant() tenant: TenantContext) {
    return await this.dashboardService.getBankAccounts(tenant);
  }

  @Get(["all-transactions", "vouchers/all_transactions", "transactions"])
  async getAllTransactions(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: any,
  ) {
    return await this.dashboardService.getAllTransactions(tenant, query);
  }

  @Put(["transactions/:id", "all-transactions/:id"])
  async updateTransaction(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
    @Body() dto: { narration?: string; referenceNo?: string; notes?: string },
  ) {
    return await this.dashboardService.updateTransaction(tenant, id, dto);
  }

  @Delete(["transactions/:id", "all-transactions/:id"])
  @HttpCode(HttpStatus.OK)
  async deleteTransaction(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
    @Body("reason") reason?: string,
  ) {
    return await this.dashboardService.deleteTransaction(tenant, id, reason);
  }
}
