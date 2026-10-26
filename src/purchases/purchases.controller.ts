import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { PurchasesService } from "./purchases.service";
import { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto";
import { QueryPurchasesDto } from "./dto/query-purchases.dto";
import { CreatePurchaseReturnDto } from "./dto/create-purchase-return.dto";
import { RecordPurchasePaymentDto } from "./dto/record-purchase-payment.dto";

@Controller("purchases")
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async createPurchaseInvoice(
    @Body() dto: CreatePurchaseInvoiceDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.purchasesService.createPurchaseInvoice(dto, tenant);
  }

  @Post("payments")
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async recordSupplierPayment(
    @Body() dto: RecordPurchasePaymentDto,
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Headers("x-idempotency-key") idempotencyKeyAlt?: string,
  ) {
    return await this.purchasesService.recordSupplierPayment(
      dto,
      tenant,
      idempotencyKey || idempotencyKeyAlt,
    );
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.AUDITOR,
  )
  async getPurchaseInvoices(
    @Query() dto: QueryPurchasesDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.purchasesService.getPurchaseInvoices(dto, tenant);
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
  async getPurchaseInvoiceById(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.purchasesService.getPurchaseInvoiceById(id, tenant);
  }

  @Get(":purchaseId/payments")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.AUDITOR,
  )
  async listPurchasePayments(
    @Param("purchaseId") purchaseId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.purchasesService.listPurchasePayments(purchaseId, tenant);
  }

  @Post(":purchaseId/payments")
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async recordPurchasePayment(
    @Param("purchaseId") purchaseId: string,
    @Body() dto: RecordPurchasePaymentDto,
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Headers("x-idempotency-key") idempotencyKeyAlt?: string,
  ) {
    return await this.purchasesService.recordPurchasePayment(
      purchaseId,
      dto,
      tenant,
      idempotencyKey || idempotencyKeyAlt,
    );
  }

  @Post(":purchaseId/returns")
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async createPurchaseReturn(
    @Param("purchaseId") purchaseId: string,
    @Body() dto: CreatePurchaseReturnDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.purchasesService.createPurchaseReturn(
      purchaseId,
      dto,
      tenant,
    );
  }

  @Get(":purchaseId/returns")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.AUDITOR,
  )
  async getPurchaseReturnsForInvoice(
    @Param("purchaseId") purchaseId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.purchasesService.getPurchaseReturnsForInvoice(
      purchaseId,
      tenant,
    );
  }

  @Delete(":id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.COMPANY_ADMIN)
  async deletePurchaseInvoice(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.purchasesService.deletePurchaseInvoice(id, tenant);
  }

  @Post("bulk-delete")
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.COMPANY_ADMIN)
  async bulkDeletePurchaseInvoices(
    @Body() body: { ids: string[] },
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.purchasesService.bulkDeletePurchaseInvoices(body.ids, tenant);
  }
}
