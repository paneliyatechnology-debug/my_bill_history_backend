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
  Res,
  BadRequestException,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { Throttle } from "@nestjs/throttler";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { Public } from "../common/decorators/public.decorator";
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
import { GenerateInvoicePdfDto } from "./dto/generate-invoice-pdf.dto";
import { InvoicePrintService } from "../invoice-print/invoice-print.service";
import { buildInvoiceUrls, buildInvoicePdfDetails } from "../invoice-print/invoice-url.helper";

@Controller(["invoices", "sales", "sales-invoices", "inventory"])
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly invoicePrintService: InvoicePrintService,
  ) {}

  @Throttle({
    default: { limit: process.env.NODE_ENV === "test" ? 1000 : 30, ttl: 60000 },
  })
  @Post(["", "sales", "invoices"])
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

  @Post(["sales/:id/issue", "invoices/:id/issue", ":id/issue"])
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

  @Post(["sales/:id/payments", "invoices/:id/payments", ":id/payments"])
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

  @Get(["sales/:id/allocations", "invoices/:id/allocations", ":id/allocations"])
  async getInvoiceAllocations(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.getInvoiceAllocations(id, tenant);
  }

  @Get(["stock/transactions", "stock-movements"])
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

  @Get(["next-number", "sales/next-number", "invoices/next-number"])
  async getNextInvoiceNumber(
    @Query("category") category: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.getNextInvoiceNumber(category, tenant);
  }

  @Throttle({
    default: { limit: process.env.NODE_ENV === "test" ? 1000 : 30, ttl: 60000 },
  })
  @Post(["pos-checkout", "sales/pos-checkout"])
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

  @Post(["pos-sync", "sales/pos-sync"])
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

  @Post(["sales/:id/cancel", "invoices/:id/cancel", ":id/cancel"])
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

  @Get(["", "sales", "invoices"])
  async listSalesInvoices(
    @Query() query: QueryInvoicesDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.listSalesInvoices(query, tenant);
  }

  @Get(["sales/:id/print", "invoices/:id/print", ":id/print"])
  @Public()
  async printSalesInvoice(
    @Param("id") id: string,
    @Query("copy") copy: string,
    @Query("share") share: string,
    @Query("themeId") themeId: string,
    @Query("accentColor") accentColor: string,
    @CurrentTenant() tenant: TenantContext,
    @Res() reply: FastifyReply,
  ) {
    const html = await this.invoicePrintService.printInvoiceHtml(
      tenant,
      id,
      copy,
      share === "true" || share === "1",
      themeId,
      accentColor,
    );
    return reply.type("text/html; charset=utf-8").send(html);
  }

  /**
   * Generates PDF in backend and returns:
   * { "success": true, "invoiceId": "...", "pdfUrl": "...", "previewUrl": "...", "downloadUrl": "..." }
   * Requires JWT authentication: User details and tenant context are derived directly from the login token.
   */
  @Post([
    "generate-pdf",
    "pdf-details",
    "pdf-url",
    "sales/generate-pdf",
    "invoices/generate-pdf",
    "sales/:id/generate-pdf",
    "invoices/:id/generate-pdf",
    ":id/generate-pdf",
    "sales/:id/pdf-details",
    "invoices/:id/pdf-details",
    ":id/pdf-details",
    "sales/:id/pdf-url",
    "invoices/:id/pdf-url",
    ":id/pdf-url",
  ])
  async generateSalesInvoicePdfDetails(
    @Param("id") paramId: string | undefined,
    @Body() body: GenerateInvoicePdfDto | undefined,
    @Query("copy") copyQuery: string | undefined,
    @Query("share") shareQuery: string | undefined,
    @Query("themeId") themeIdQuery: string | undefined,
    @Query("accentColor") accentColorQuery: string | undefined,
    @CurrentTenant() tenant: TenantContext,
  ) {
    const invoiceId = paramId || body?.invoiceId || body?.id;
    if (!invoiceId || typeof invoiceId !== "string" || !invoiceId.trim()) {
      throw new BadRequestException("Invoice ID is required. Please provide it in the URL path or JSON body.");
    }
    const cleanInvoiceId = invoiceId.trim();
    const copy = body?.copy || copyQuery;
    const share = body?.share !== undefined ? Boolean(body.share) : (shareQuery === "true" || shareQuery === "1");
    const themeId = body?.themeId || themeIdQuery;
    const accentColor = body?.accentColor || accentColorQuery;

    const { invoice } = await this.invoicePrintService.generateInvoicePdf(
      tenant,
      cleanInvoiceId,
      copy,
      share,
      themeId,
      accentColor,
    );
    return buildInvoicePdfDetails(cleanInvoiceId, invoice?.invoiceNumber);
  }

  @Get([
    "sales/:id/generate-pdf",
    "invoices/:id/generate-pdf",
    ":id/generate-pdf",
    "sales/:id/pdf-details",
    "invoices/:id/pdf-details",
    ":id/pdf-details",
    "sales/:id/pdf-url",
    "invoices/:id/pdf-url",
    ":id/pdf-url",
  ])
  async getSalesInvoicePdfDetails(
    @Param("id") id: string,
    @Query("copy") copy: string,
    @Query("share") share: string,
    @Query("themeId") themeId: string,
    @Query("accentColor") accentColor: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.generateSalesInvoicePdfDetails(
      id,
      undefined,
      copy,
      share,
      themeId,
      accentColor,
      tenant,
    );
  }

  /**
   * View or download high-fidelity binary PDF
   */
  @Get(["sales/:id/pdf", "invoices/:id/pdf", ":id/pdf", "sales/:id/download-pdf", "invoices/:id/download-pdf", ":id/download-pdf"])
  @Public()
  async downloadSalesInvoicePdf(
    @Param("id") id: string,
    @Query("copy") copy: string,
    @Query("share") share: string,
    @Query("themeId") themeId: string,
    @Query("accentColor") accentColor: string,
    @CurrentTenant() tenant: TenantContext,
    @Res() reply: FastifyReply,
  ) {
    const { pdfBuffer, invoice } = await this.invoicePrintService.generateInvoicePdf(
      tenant,
      id,
      copy,
      share === "true" || share === "1",
      themeId,
      accentColor,
    );
    const safeInvNum = String(invoice.invoiceNumber || id).replace(/[\/\\]/g, "_");
    return reply
      .type("application/pdf")
      .header("Content-Disposition", `inline; filename="Invoice-${safeInvNum}.pdf"`)
      .send(pdfBuffer);
  }

  @Get(["sales/:id", "invoices/:id", ":id"])
  async getSalesInvoice(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.getSalesInvoiceById(id, tenant);
  }

  @Put(["sales/:id", "invoices/:id", ":id"])
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

  @Post(["sales/:id/returns", "invoices/:id/returns", ":id/returns"])
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

  @Get(["sales/:id/returns", "invoices/:id/returns", ":id/returns"])
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

  @Delete(["sales/:id", "invoices/:id", ":id"])
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.COMPANY_ADMIN)
  async deleteSalesInvoice(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.deleteSalesInvoice(id, tenant);
  }

  @Post(["sales/bulk-delete", "invoices/bulk-delete", "bulk-delete"])
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.COMPANY_ADMIN)
  async bulkDeleteSalesInvoices(
    @Body() body: { ids: string[] },
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.invoicesService.bulkDeleteSalesInvoices(body.ids, tenant);
  }
}
