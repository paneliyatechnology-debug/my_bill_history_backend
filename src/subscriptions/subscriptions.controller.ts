import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { SubscriptionsService } from "./subscriptions.service";
import { CreateOrderDto, ValidateCouponDto } from "./dto/create-order.dto";
import { VerifyPaymentDto } from "./dto/verify-payment.dto";
import { PublicOrderDto } from "./dto/public-order.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Public } from "../common/decorators/public.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TenantContext, UserRole } from "../shared-types";

@Controller("subscriptions")
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Public()
  @Get("plans")
  getPlans() {
    return this.subscriptionsService.getPlans();
  }

  @Public()
  @Post("validate-coupon")
  @HttpCode(HttpStatus.OK)
  async validateCoupon(@Body() dto: ValidateCouponDto) {
    return this.subscriptionsService.validateCoupon(dto);
  }

  @Public()
  @Post("public-order")
  @HttpCode(HttpStatus.OK)
  createPublicOrder(@Body() dto: PublicOrderDto) {
    return this.subscriptionsService.createPublicOrder(dto);
  }

  @Get("current")
  async getCurrentSubscription(@CurrentTenant() ctx: TenantContext) {
    return this.subscriptionsService.getCurrentSubscription(ctx);
  }

  @Post("create-order")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async createOrder(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateOrderDto,
  ) {
    return this.subscriptionsService.createOrder(ctx, dto);
  }

  @Post("verify-payment")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async verifyPayment(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.subscriptionsService.verifyPayment(ctx, dto);
  }

  @Get("history")
  async getBillingHistory(@CurrentTenant() ctx: TenantContext) {
    return this.subscriptionsService.getBillingHistory(ctx);
  }

  @Public()
  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: any,
    @Headers("x-razorpay-signature") signature: string,
  ) {
    return this.subscriptionsService.handleWebhook(body, signature);
  }
}
