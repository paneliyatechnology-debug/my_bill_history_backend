import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
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
import { CreatePaymentOutVoucherDto } from "./dto/create-payment-out-voucher.dto";

@Controller(["purchases/payment-out", "purchases/payments-out"])
export class PurchasesPaymentOutController {
  constructor(private readonly vouchersService: VouchersService) {}

  @Get()
  async listPaymentsOut(
    @Query() query: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.listPaymentsOut(tenant, query);
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
  async createPaymentOut(
    @Body() dto: CreatePaymentOutVoucherDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.createPaymentOutVoucher(dto, tenant);
  }

  @Get(":id")
  async getPaymentOutById(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.getVoucherById(id, tenant);
  }

  @Put(":id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async updatePaymentOut(
    @Param("id") id: string,
    @Body() dto: CreatePaymentOutVoucherDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.updatePaymentOutVoucher(id, dto, tenant);
  }

  @Delete(":id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async deletePaymentOut(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.reverseVoucher(
      id,
      { reason: "Payment-out voucher cancelled" },
      tenant,
    );
  }
}
