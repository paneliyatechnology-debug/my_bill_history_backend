import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { InvoicesService } from "./invoices.service";
import { CreateSalesInvoiceDto } from "./dto/create-sales-invoice.dto";
import { PosCheckoutDto } from "./dto/pos-checkout.dto";
import { PosSyncDto } from "./dto/pos-sync.dto";
import { CancelInvoiceDto } from "./dto/cancel-invoice.dto";
import { QueryInvoicesDto } from "./dto/query-invoices.dto";
import { RecordInvoicePaymentDto } from "./dto/record-payment.dto";
import { QueryStockTransactionsDto } from "./dto/query-stock.dto";
import { CreateSalesReturnDto } from "./dto/create-sales-return.dto";

@Controller("invoices")
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Throttle({
    default: { limit: process.env.NODE_ENV === "test" ? 1000 : 30, ttl: 60000 },
  })
  @Post(["", "sales"])
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
    UserRole.SALESMAN,
  )
  async createSalesInvoice(
    @Body() dto: CreateSalesInvoiceDto,
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return await this.invoicesService.createSalesInvoice(
      dto,
      tenant,
      idempotencyKey,
    );
  }

  @Post("sales/:id/issue")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
    UserRole.SALESMAN,
  )
  async issueDraftInvoice(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Body() body?: { allowNegativeStock?: boolean },
  ) {
    return await this.invoicesService.issueDraftInvoice(
      id,
      tenant,
      idempotencyKey,
      body?.allowNegativeStock,
    );
  }

  @Post("sales/:id/payments")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
  )
  async recordInvoicePayment(
    @Param("id") id: string,
    @Body() dto: RecordInvoicePaymentDto,
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return await this.invoicesService.recordInvoicePayment(
      id,
      dto,
      tenant,
      idempotencyKey,
    );
  }

  @Get("sales/:id/allocations")
  async getInvoiceAllocations(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.getInvoiceAllocations(id, tenant);
  }

  @Get("stock/transactions")
  async getStockMovements(
    @Query() query: QueryStockTransactionsDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.getStockMovements(query, tenant);
  }

  @Get("items/:id/stock-movements")
  async getItemStockMovements(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.getItemStockMovements(id, tenant);
  }

  @Throttle({
    default: { limit: process.env.NODE_ENV === "test" ? 1000 : 30, ttl: 60000 },
  })
  @Post("pos-checkout")
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
    UserRole.SALESMAN,
  )
  async posCheckout(
    @Body() dto: PosCheckoutDto,
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return await this.invoicesService.posCheckout(dto, tenant, idempotencyKey);
  }

  @Post("pos-sync")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
    UserRole.SALESMAN,
  )
  async posSync(
    @Body() dto: PosSyncDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.posSync(dto, tenant);
  }

  @Post("sales/:id/cancel")
  @HttpCode(HttpStatus.OK)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async cancelSalesInvoice(
    @Param("id") id: string,
    @Body() dto: CancelInvoiceDto,
    @CurrentTenant() tenant: TenantContext,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return await this.invoicesService.cancelSalesInvoice(
      id,
      dto,
      tenant,
      idempotencyKey,
    );
  }

  @Get(["", "sales"])
  async listSalesInvoices(
    @Query() query: QueryInvoicesDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.listSalesInvoices(query, tenant);
  }

  @Get("sales/:id")
  async getSalesInvoice(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.getSalesInvoiceById(id, tenant);
  }

  @Put("sales/:id")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
    UserRole.SALESMAN,
  )
  async updateSalesInvoice(
    @Param("id") id: string,
    @Body() dto: CreateSalesInvoiceDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.updateSalesInvoice(id, dto, tenant);
  }

  @Post("sales/:id/returns")
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
  )
  async createSalesReturnForInvoice(
    @Param("id") id: string,
    @Body() dto: CreateSalesReturnDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.createSalesReturn(id, dto, tenant);
  }

  @Get("sales/:id/returns")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.AUDITOR,
  )
  async getSalesReturnsForInvoice(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.getSalesReturnsForInvoice(id, tenant);
  }

  @Delete("sales/:id")
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.COMPANY_ADMIN)
  async deleteSalesInvoice(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.deleteSalesInvoice(id, tenant);
  }

  @Post("sales/bulk-delete")
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.COMPANY_ADMIN)
  async bulkDeleteSalesInvoices(
    @Body() body: { ids: string[] },
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.bulkDeleteSalesInvoices(body.ids, tenant);
  }
}
