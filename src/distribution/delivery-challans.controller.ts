import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { DeliveryChallansService } from "./delivery-challans.service";
import { CreateDeliveryChallanDto } from "./dto/create-delivery-challan.dto";
import { IssueDeliveryChallanDto } from "./dto/issue-delivery-challan.dto";
import { CancelDeliveryChallanDto } from "./dto/cancel-delivery-challan.dto";
import { EWayBillRequestDto } from "./dto/eway-bill-payload.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller(["distribution/challans", "sales/challans", "sales/delivery-challan", "sales/delivery-challans"])
export class DeliveryChallansController {
  constructor(private readonly service: DeliveryChallansService) {}

  @RequirePermissions({ module: "delivery_challans", action: "create" })
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
    @Body() dto: CreateDeliveryChallanDto,
  ) {
    return this.service.createChallan(ctx, dto);
  }

  @RequirePermissions({ module: "delivery_challans", action: "view" })
  @Get()
  async findAll(@CurrentTenant() ctx: TenantContext) {
    return this.service.findAllChallans(ctx);
  }

  @RequirePermissions({ module: "delivery_challans", action: "view" })
  @Get("next-number")
  async getNextNumber(@CurrentTenant() ctx: TenantContext) {
    return this.service.getNextChallanNumber(ctx);
  }

  @RequirePermissions({ module: "delivery_challans", action: "view" })
  @Get(":id")
  async findOne(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.service.findChallanById(ctx, id);
  }

  @RequirePermissions({ module: "delivery_challans", action: "edit" })
  @Post(":id/issue")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async issue(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: IssueDeliveryChallanDto,
  ) {
    return this.service.issueChallan(ctx, id, dto);
  }

  @RequirePermissions({ module: "delivery_challans", action: "edit" })
  @Post(":id/close")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async close(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.service.closeChallan(ctx, id);
  }

  @RequirePermissions({ module: "delivery_challans", action: "convert" })
  @Post(":id/convert-to-invoice")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.CASHIER,
    UserRole.SALESMAN,
  )
  async convertToInvoice(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() body?: { asDraft?: boolean; allowNegativeStock?: boolean },
  ) {
    return this.service.convertChallanToInvoice(ctx, id, body);
  }

  @RequirePermissions({ module: "delivery_challans", action: "edit" })
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
    @Body() dto: CancelDeliveryChallanDto,
  ) {
    return this.service.cancelChallan(ctx, id, dto);
  }

  @RequirePermissions({ module: "delivery_challans", action: "print" })
  @Post(":id/eway-bill")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async prepareEWayBill(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: EWayBillRequestDto,
  ) {
    return this.service.prepareEWayBillPayload(ctx, id, dto);
  }
}
