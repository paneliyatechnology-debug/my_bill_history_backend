import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { VouchersService } from "./vouchers.service";
import { CreateVoucherDto } from "./dto/create-voucher.dto";
import { ReverseVoucherDto } from "./dto/reverse-voucher.dto";
import { CreatePaymentOutVoucherDto } from "./dto/create-payment-out-voucher.dto";
import { CreateStaffPaymentDto } from "./dto/create-staff-payment.dto";

@Controller(["vouchers", "payments", "accounting/vouchers"])
export class VouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async createVoucher(
    @Body() dto: CreateVoucherDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.createVoucher(dto, tenant);
  }

  @Post(["receipt", "payment-in", "receipts"])
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async createReceiptVoucher(
    @Body() dto: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.createReceiptVoucher(dto, tenant);
  }

  @Put(["receipt/:id", "payment-in/:id", "receipts/:id", "payments-in/:id"])
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async updateReceiptVoucher(
    @Param("id") id: string,
    @Body() dto: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.updateReceiptVoucher(id, dto, tenant);
  }

  @Delete(["receipt/:id", "payment-in/:id", "receipts/:id", "payments-in/:id"])
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async cancelReceipt(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.reverseVoucher(
      id,
      { reason: "Payment-in voucher cancelled" },
      tenant,
    );
  }

  @Post("expense")
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async createExpenseVoucher(
    @Body() dto: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.createExpenseVoucher(dto, tenant);
  }

  @Put("expense/:id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async updateExpenseVoucher(
    @Param("id") id: string,
    @Body() dto: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.updateExpenseVoucher(id, dto, tenant);
  }

  @Get()
  async listVouchers(
    @Query() query: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.listVouchers(tenant, query);
  }

  @Get(["receipts", "payment-in", "payments-in"])
  async listReceipts(
    @Query() query: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.listReceipts(tenant, query);
  }

  @Get(["payments-out", "payment-out"])
  async listPaymentsOut(
    @Query() query: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.listPaymentsOut(tenant, query);
  }

  @Post(["payment-out", "payments-out"])
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async createPaymentOutVoucher(
    @Body() dto: CreatePaymentOutVoucherDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.createPaymentOutVoucher(dto, tenant);
  }

  @Get(["payment-out/:id", "payments-out/:id"])
  async getPaymentOutById(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.getVoucherById(id, tenant);
  }

  @Put(["payment-out/:id", "payments-out/:id"])
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async updatePaymentOutVoucher(
    @Param("id") id: string,
    @Body() dto: CreatePaymentOutVoucherDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.updatePaymentOutVoucher(id, dto, tenant);
  }

  @Delete(["payment-out/:id", "payments-out/:id"])
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async cancelPaymentOut(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.cancelPaymentOut(id, tenant);
  }

  @Get(":id")
  async getVoucher(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.getVoucherById(id, tenant);
  }

  @Post(":id/reverse")
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async reverseVoucher(
    @Param("id") id: string,
    @Body() dto: ReverseVoucherDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.reverseVoucher(id, dto, tenant);
  }

  @Post(["staff-payment", "staff-payments", "salary-payment", "salary-payments"])
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async createStaffPayment(
    @Body() dto: CreateStaffPaymentDto,
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Headers("x-idempotency-key") idempotencyKeyAlt?: string,
  ) {
    return await this.vouchersService.createStaffPaymentVoucher(
      dto,
      tenant,
      idempotencyKey || idempotencyKeyAlt,
    );
  }

  @Get(["staff-payments", "staff-payment", "salary-payments"])
  async listStaffPayments(
    @Query() query: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.listStaffPayments(tenant, query);
  }

  @Post([
    "staff-payment/:id/cancel",
    "staff-payments/:id/cancel",
    "salary-payment/:id/cancel",
    "staff-payment/:id/reverse",
  ])
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async cancelStaffPayment(
    @Param("id") id: string,
    @Body() body: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.cancelStaffPayment(
      id,
      tenant,
      body?.reason,
    );
  }

  @Delete(["staff-payment/:id", "staff-payments/:id", "salary-payment/:id"])
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async deleteStaffPayment(
    @Param("id") id: string,
    @Query() query: any,
    @Body() body: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.vouchersService.cancelStaffPayment(
      id,
      tenant,
      query?.reason || body?.reason,
    );
  }

  @Patch(":id")
  updateVoucher() {
    throw new BadRequestException(
      "Posted vouchers are immutable according to double-entry accounting rules. Use the /vouchers/:id/reverse endpoint to reverse this voucher.",
    );
  }

  @Delete(":id")
  deleteVoucher() {
    throw new BadRequestException(
      "Posted vouchers cannot be deleted according to double-entry accounting rules. Use the /vouchers/:id/reverse endpoint to reverse this voucher.",
    );
  }
}
