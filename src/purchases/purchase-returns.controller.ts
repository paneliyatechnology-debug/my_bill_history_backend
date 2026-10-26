import {
  Controller,
  Get,
  Post,
  Put,
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
import { PurchasesService } from "./purchases.service";
import { CreatePurchaseReturnDto } from "./dto/create-purchase-return.dto";
import { QueryPurchaseReturnsDto } from "./dto/query-purchase-returns.dto";

@Controller("purchase-returns")
export class PurchaseReturnsController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.AUDITOR,
  )
  async getPurchaseReturns(
    @Query() dto: QueryPurchaseReturnsDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.purchasesService.getPurchaseReturns(dto, tenant);
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
  async getPurchaseReturnById(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.purchasesService.getPurchaseReturnById(id, tenant);
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
  async createPurchaseReturn(
    @Body() dto: CreatePurchaseReturnDto & { purchaseInvoiceId?: string },
    @CurrentTenant() tenant: TenantContext,
  ) {
    const purchaseId = dto.purchaseInvoiceId;
    if (!purchaseId) {
      throw new BadRequestException("purchaseInvoiceId is required.");
    }
    return await this.purchasesService.createPurchaseReturn(
      purchaseId,
      dto,
      tenant,
    );
  }

  @Put(":id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async updatePurchaseReturn(
    @Param("id") id: string,
    @Body() dto: CreatePurchaseReturnDto & { purchaseInvoiceId?: string; returnNumber?: string },
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.purchasesService.updatePurchaseReturn(id, dto, tenant);
  }

  @Delete(":id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async deletePurchaseReturn(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.purchasesService.deletePurchaseReturn(id, tenant);
  }
}
