import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { VouchersService } from "./vouchers.service";
import { ReverseVoucherDto } from "./dto/reverse-voucher.dto";

@Controller(["sales/payment-in", "sales/receipts"])
export class SalesPaymentInController {
  constructor(private readonly vouchersService: VouchersService) {}

  @Get()
  async listReceipts(
    @Query() query: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.listReceipts(tenant, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async createReceipt(
    @Body() dto: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.createReceiptVoucher(dto, tenant);
  }

  @Get(":id")
  async getReceiptById(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.getVoucherById(id, tenant);
  }

  @Post(":id/reverse")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async reverseReceipt(
    @Param("id") id: string,
    @Body() dto: ReverseVoucherDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.reverseVoucher(id, dto, tenant);
  }
}
