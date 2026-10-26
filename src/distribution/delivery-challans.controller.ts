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
import { TenantContext, UserRole } from "@billing/shared-types";

@Controller("distribution/challans")
export class DeliveryChallansController {
  constructor(private readonly service: DeliveryChallansService) {}

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

  @Get()
  async findAll(@CurrentTenant() ctx: TenantContext) {
    return this.service.findAllChallans(ctx);
  }

  @Get(":id")
  async findOne(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.service.findChallanById(ctx, id);
  }

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
