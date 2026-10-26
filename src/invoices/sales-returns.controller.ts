import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { InvoicesService } from "./invoices.service";
import { CreateSalesReturnDto } from "./dto/create-sales-return.dto";
import { QuerySalesReturnsDto } from "./dto/query-sales-returns.dto";

@Controller("sales-returns")
export class SalesReturnsController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.AUDITOR,
  )
  async getSalesReturns(
    @Query() dto: QuerySalesReturnsDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.getSalesReturns(dto, tenant);
  }

  @Get(":id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.AUDITOR,
  )
  async getSalesReturnById(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.getSalesReturnById(id, tenant);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async createSalesReturn(
    @Body() dto: CreateSalesReturnDto & { salesInvoiceId?: string },
    @CurrentTenant() tenant: TenantContext,
  ) {
    const invoiceId = dto.salesInvoiceId;
    if (!invoiceId) {
      throw new BadRequestException("salesInvoiceId is required.");
    }
    return await this.invoicesService.createSalesReturn(invoiceId, dto, tenant);
  }

  @Delete(":id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async deleteSalesReturn(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.deleteSalesReturn(id, tenant);
  }
}
