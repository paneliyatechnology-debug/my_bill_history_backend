import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { EInvoicesService } from "./e-invoices.service";
import { QueryEInvoicesDto } from "./dto/query-einvoices.dto";
import { CancelEInvoiceDto } from "./dto/cancel-einvoice.dto";
import { UpdateEInvoiceSettingsDto } from "./dto/update-einvoice-settings.dto";

const readers = [
  UserRole.SUPER_ADMIN,
  UserRole.ORG_ADMIN,
  UserRole.COMPANY_ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.AUDITOR,
];

const writers = [
  UserRole.SUPER_ADMIN,
  UserRole.ORG_ADMIN,
  UserRole.COMPANY_ADMIN,
  UserRole.ACCOUNTANT,
];

const cancellers = [
  UserRole.SUPER_ADMIN,
  UserRole.ORG_ADMIN,
  UserRole.COMPANY_ADMIN,
  UserRole.ACCOUNTANT,
];

@Controller(["e-invoices", "sales/e-invoices", "gst/e-invoices", "gst/einvoices"])
export class EInvoicesController {
  constructor(private readonly service: EInvoicesService) {}

  @Get()
  @Roles(...readers)
  list(@CurrentTenant() tenant: TenantContext, @Query() query: QueryEInvoicesDto) {
    return this.service.listEInvoices(tenant, query);
  }

  @Get("audit")
  @Roles(...readers)
  audit(@CurrentTenant() tenant: TenantContext, @Query() query: any) {
    return this.service.getAuditLogs(tenant, query);
  }

  @Get("reconciliation")
  @Roles(...readers)
  reconciliationHistory(@CurrentTenant() tenant: TenantContext, @Query() query: any) {
    return this.service.getAuditLogs(tenant, query);
  }

  @Get(":id")
  @Roles(...readers)
  getDetails(@CurrentTenant() tenant: TenantContext, @Param("id") id: string) {
    return this.service.getEInvoiceDetails(tenant, id);
  }

  @Post(":invoiceId/validate")
  @Roles(...readers, ...writers)
  validate(@CurrentTenant() tenant: TenantContext, @Param("invoiceId") invoiceId: string) {
    return this.service.validateInvoice(tenant, invoiceId);
  }

  @Post(":invoiceId/generate")
  @Roles(...writers)
  generate(
    @CurrentTenant() tenant: TenantContext,
    @Param("invoiceId") invoiceId: string,
    @Headers("x-idempotency-key") idempotencyKey?: string,
  ) {
    return this.service.generateEInvoice(tenant, invoiceId, idempotencyKey);
  }

  @Post(":id/reconcile")
  @Roles(...writers)
  reconcile(@CurrentTenant() tenant: TenantContext, @Param("id") id: string) {
    return this.service.reconcileEInvoice(tenant, id);
  }

  @Post(":id/cancel")
  @Roles(...cancellers)
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
    @Body() body: CancelEInvoiceDto,
    @Headers("x-idempotency-key") idempotencyKey?: string,
  ) {
    return this.service.cancelEInvoice(tenant, id, body, idempotencyKey);
  }

  @Get(":id/pdf")
  @Roles(...readers)
  async downloadPdf(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
    @Query("copy") copy: string,
    @Res() reply: FastifyReply,
  ) {
    const { pdfBuffer, invoice } = await this.service.getEInvoicePdf(tenant, id, copy);
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", `attachment; filename="EInvoice-${invoice.invoiceNumber}.pdf"`);
    return reply.send(pdfBuffer);
  }
}

@Controller(["settings/e-invoice", "gst/settings/e-invoice"])
export class EInvoicesSettingsController {
  constructor(private readonly service: EInvoicesService) {}

  @Get()
  @Roles(...readers)
  getSettings(@CurrentTenant() tenant: TenantContext) {
    return this.service.getSettings(tenant);
  }

  @Put()
  @Roles(...writers)
  saveSettings(@CurrentTenant() tenant: TenantContext, @Body() body: UpdateEInvoiceSettingsDto) {
    return this.service.saveSettings(tenant, body);
  }
}

