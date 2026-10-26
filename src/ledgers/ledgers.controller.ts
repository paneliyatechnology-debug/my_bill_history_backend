import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { LedgersService } from "./ledgers.service";
import { CreateLedgerGroupDto } from "./dto/create-ledger-group.dto";
import { CreateLedgerAccountDto } from "./dto/create-ledger-account.dto";
import { UpdateLedgerAccountDto } from "./dto/update-ledger-account.dto";

@Controller()
export class LedgersController {
  constructor(private readonly ledgersService: LedgersService) {}

  @Post("ledger-groups/seed")
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.COMPANY_ADMIN)
  async seedCOA(@CurrentTenant() tenant: TenantContext) {
    return await this.ledgersService.seedStandardChartOfAccounts(tenant);
  }

  @Get("ledger-groups")
  async listGroups(@CurrentTenant() tenant: TenantContext) {
    return await this.ledgersService.listGroups(tenant);
  }

  @Post("ledger-groups")
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.COMPANY_ADMIN)
  async createGroup(
    @Body() dto: CreateLedgerGroupDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.ledgersService.createGroup(dto, tenant);
  }

  @Get("ledgers")
  async listAccounts(
    @Query() query: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.ledgersService.listAccounts(tenant, query);
  }

  @Post("ledgers")
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async createAccount(
    @Body() dto: CreateLedgerAccountDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.ledgersService.createAccount(dto, tenant);
  }

  @Get("ledgers/:id")
  async getAccount(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.ledgersService.getAccountById(id, tenant);
  }

  @Patch("ledgers/:id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async updateAccount(
    @Param("id") id: string,
    @Body() dto: UpdateLedgerAccountDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.ledgersService.updateAccount(id, dto, tenant);
  }

  @Delete("ledgers/:id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.COMPANY_ADMIN)
  async deactivateAccount(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.ledgersService.deactivateAccount(id, tenant);
  }
}
