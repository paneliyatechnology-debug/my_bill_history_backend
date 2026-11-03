import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { AutomatedBillingService } from "./automated-billing.service";
import { CreateAutomatedBillingDto } from "./dto/create-automated-billing.dto";
import { UpdateAutomatedBillingDto } from "./dto/update-automated-billing.dto";
import { QueryAutomatedBillingDto } from "./dto/query-automated-billing.dto";

@Controller(["sales/automated-billing", "automated-bills", "automated-billing"])
export class AutomatedBillingController {
  constructor(private readonly service: AutomatedBillingService) {}

  @Get("summary")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
    UserRole.SALESMAN,
  )
  async getSummaryMetrics(@CurrentTenant() tenant: TenantContext) {
    return await this.service.getSummaryMetrics(tenant);
  }

  @Get(["", "schedules"])
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
    UserRole.SALESMAN,
  )
  async listSchedules(
    @Query() query: QueryAutomatedBillingDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.service.listSchedules(query, tenant);
  }

  @Post(["", "schedules"])
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async createSchedule(
    @Body() dto: CreateAutomatedBillingDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.service.createSchedule(dto, tenant);
  }

  @Get(":id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
    UserRole.SALESMAN,
  )
  async getScheduleById(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.service.getScheduleById(id, tenant);
  }

  @Patch(":id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async updateSchedule(
    @Param("id") id: string,
    @Body() dto: UpdateAutomatedBillingDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.service.updateSchedule(id, dto, tenant);
  }

  @Post(":id/pause")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async pauseSchedule(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.service.pauseSchedule(id, tenant);
  }

  @Post(":id/resume")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async resumeSchedule(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.service.resumeSchedule(id, tenant);
  }

  @Post(":id/stop")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async stopSchedule(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.service.stopSchedule(id, tenant);
  }

  @Post(":id/run-now")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async executeScheduleRun(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.service.executeScheduleRun(id, tenant, "MANUAL_RUN_NOW");
  }

  @Get(":id/runs")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
    UserRole.SALESMAN,
  )
  async getRunHistory(
    @Param("id") id: string,
    @Query() query: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.service.getRunHistory(id, query, tenant);
  }

  @Post(":id/runs/:runId/retry")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async retryRun(
    @Param("id") id: string,
    @Param("runId") runId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.service.retryRun(id, runId, tenant);
  }
}
