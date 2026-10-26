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
import { GstDocumentsService } from "./gst-documents.service";
import { Gstr2bService } from "./gstr2b.service";
import { GstPortalService } from "./gst-portal.service";
import { GstVerificationService } from "./gst-verification.service";
import { VerifyGstinDto } from "./dto/verify-gstin.dto";

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

@Controller("gst")
export class GstController {
  constructor(
    private readonly gstr2b: Gstr2bService,
    private readonly portal: GstPortalService,
    private readonly documents: GstDocumentsService,
    private readonly gstVerification: GstVerificationService,
  ) {}

  @Post("verify-gstin")
  @Roles(...readers, ...writers)
  verifyGstin(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: VerifyGstinDto,
  ) {
    return this.gstVerification.verifyGstin(
      tenant,
      body?.gstin,
      body?.forceRefresh,
    );
  }

  @Post("debit-notes")
  @Roles(...writers)
  createDebitNote(@CurrentTenant() tenant: TenantContext, @Body() body: any) {
    return this.documents.createDebitNote(tenant, body);
  }

  @Post("advances")
  @Roles(...writers)
  createAdvance(@CurrentTenant() tenant: TenantContext, @Body() body: any) {
    return this.documents.createAdvance(tenant, body);
  }

  @Post("advances/:id/adjustments")
  @Roles(...writers)
  adjustAdvance(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.documents.adjustAdvance(tenant, id, body);
  }

  @Post("gstr-2b/imports")
  @Roles(...writers)
  importGstr2b(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: { fileName?: string; content: string; returnPeriod: string },
  ) {
    return this.gstr2b.importFile(tenant, {
      fileName: body.fileName || "gstr2b.json",
      content: body.content,
      returnPeriod: body.returnPeriod,
    });
  }

  @Get("gstr-2b/reconciliations")
  @Roles(...readers)
  listReconciliations(
    @CurrentTenant() tenant: TenantContext,
    @Query("returnPeriod") returnPeriod: string,
    @Query("status") status?: string,
    @Query("itcDecision") itcDecision?: string,
  ) {
    return this.gstr2b.listReconciliations(tenant, { returnPeriod, status, itcDecision });
  }

  @Get("gstr-2b/summary")
  @Roles(...readers)
  summary(@CurrentTenant() tenant: TenantContext, @Query("returnPeriod") returnPeriod: string) {
    return this.gstr2b.summary(tenant, returnPeriod);
  }

  @Get("gstr-2b/export")
  @Roles(...readers)
  async exportGstr2b(
    @CurrentTenant() tenant: TenantContext,
    @Query("returnPeriod") returnPeriod: string,
    @Res() res: FastifyReply,
  ) {
    const csv = await this.gstr2b.exportCsv(tenant, returnPeriod);
    res.header("Content-Type", "text/csv; charset=utf-8");
    res.header("Content-Disposition", 'attachment; filename="gstr-2b-reconciliation.csv"');
    return res.send(csv);
  }

  @Post("gstr-2b/reconciliations/:id/review")
  @Roles(...writers)
  review(
    @CurrentTenant() tenant: TenantContext,
    @Param("id") id: string,
    @Body() body: { itcDecision: string; status?: string; reason: string },
  ) {
    return this.gstr2b.review(tenant, id, body);
  }

  @Get("gstr-2b/reconciliations/:id/history")
  @Roles(...readers)
  history(@CurrentTenant() tenant: TenantContext, @Param("id") id: string) {
    return this.gstr2b.history(tenant, id);
  }

  @Get("integration")
  @Roles(...readers)
  getIntegration(@CurrentTenant() tenant: TenantContext) {
    return this.portal.getConfig(tenant);
  }

  @Get("documents")
  @Roles(...readers)
  listDocuments(
    @CurrentTenant() tenant: TenantContext,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string,
  ) {
    return this.portal.listOutwardDocuments(tenant, { fromDate, toDate });
  }

  @Get("audit")
  @Roles(...readers)
  audit(@CurrentTenant() tenant: TenantContext) {
    return this.portal.listAudit(tenant);
  }

  @Post("integration/sandbox-ping")
  @Roles(...writers)
  sandboxPing(@CurrentTenant() tenant: TenantContext) {
    return this.portal.sandboxPing(tenant);
  }

  @Put("integration")
  @Roles(...writers)
  saveIntegration(@CurrentTenant() tenant: TenantContext, @Body() body: any) {
    return this.portal.saveConfig(tenant, body);
  }

  @Post("einvoice/:invoiceId/generate")
  @Roles(...writers)
  generateIrn(
    @CurrentTenant() tenant: TenantContext,
    @Param("invoiceId") invoiceId: string,
    @Headers("x-idempotency-key") idempotencyKey?: string,
  ) {
    return this.portal.generateIrn(tenant, invoiceId, idempotencyKey);
  }

  @Get("einvoice/:invoiceId")
  @Roles(...readers)
  einvoiceStatus(@CurrentTenant() tenant: TenantContext, @Param("invoiceId") invoiceId: string) {
    return this.portal.einvoiceStatus(tenant, invoiceId);
  }

  @Post("einvoice/:invoiceId/cancel")
  @Roles(...writers)
  cancelIrn(
    @CurrentTenant() tenant: TenantContext,
    @Param("invoiceId") invoiceId: string,
    @Body() body: { reasonCode: string; remarks: string },
    @Headers("x-idempotency-key") idempotencyKey?: string,
  ) {
    return this.portal.cancelIrn(tenant, invoiceId, body, idempotencyKey);
  }

  @Post("eway-bills/invoices/:invoiceId/generate")
  @Roles(...writers)
  generateInvoiceEway(
    @CurrentTenant() tenant: TenantContext,
    @Param("invoiceId") invoiceId: string,
    @Body() body: any,
    @Headers("x-idempotency-key") idempotencyKey?: string,
  ) {
    return this.portal.generateEwayBill(tenant, { invoiceId }, body, idempotencyKey);
  }

  @Post("eway-bills/challans/:challanId/generate")
  @Roles(...writers)
  generateChallanEway(
    @CurrentTenant() tenant: TenantContext,
    @Param("challanId") challanId: string,
    @Body() body: any,
    @Headers("x-idempotency-key") idempotencyKey?: string,
  ) {
    return this.portal.generateEwayBill(tenant, { challanId }, body, idempotencyKey);
  }

  @Get("eway-bills")
  @Roles(...readers)
  listEwayBills(
    @CurrentTenant() tenant: TenantContext,
    @Query("status") status?: string,
    @Query("search") search?: string,
    @Query("fromDate") fromDate?: string,
    @Query("toDate") toDate?: string,
  ) {
    return this.portal.listEwayBills(tenant, { status, search, fromDate, toDate });
  }

  @Post("eway-bills/link")
  @Roles(...writers)
  linkEwayBill(
    @CurrentTenant() tenant: TenantContext,
    @Body()
    body: {
      invoiceId?: string;
      challanId?: string;
      ewbNumber: string;
      ewbDate?: string;
      validUpto?: string;
      distanceKm: number;
      vehicleNumber?: string;
      transporterId?: string;
      transporterName?: string;
    },
  ) {
    return this.portal.linkEwayBill(tenant, body);
  }

  @Get("eway-bills/:ewbNumber/details")
  @Roles(...readers)
  ewayDetails(@CurrentTenant() tenant: TenantContext, @Param("ewbNumber") ewbNumber: string) {
    return this.portal.getEwayBillDetails(tenant, ewbNumber);
  }

  @Get("eway-bills/:ewbNumber")
  @Roles(...readers)
  ewayStatus(@CurrentTenant() tenant: TenantContext, @Param("ewbNumber") ewbNumber: string) {
    return this.portal.ewayStatus(tenant, ewbNumber);
  }

  @Post("eway-bills/:ewbNumber/cancel")
  @Roles(...writers)
  cancelEway(
    @CurrentTenant() tenant: TenantContext,
    @Param("ewbNumber") ewbNumber: string,
    @Body() body: { reasonCode: string; remarks: string },
  ) {
    return this.portal.cancelEway(tenant, ewbNumber, body);
  }

  @Post("eway-bills/:ewbNumber/vehicle")
  @Roles(...writers)
  updateVehicle(
    @CurrentTenant() tenant: TenantContext,
    @Param("ewbNumber") ewbNumber: string,
    @Body() body: { vehicleNumber: string; reasonCode: string; remarks?: string; fromPlace?: string },
  ) {
    return this.portal.updateEwayVehicle(tenant, ewbNumber, body);
  }
}
