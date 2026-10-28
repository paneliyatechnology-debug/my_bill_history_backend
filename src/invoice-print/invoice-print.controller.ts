import { Body, Controller, Get, Post, Put, Query, Res } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { InvoicePrintService } from "./invoice-print.service";
import { AiInvoiceStylerService, AiStyleRequest } from "./ai-invoice-styler.service";
import { UpdateInvoicePrintSettingsDto } from "./dto/update-invoice-settings.dto";

@Controller("invoice-settings")
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.ORG_ADMIN,
  UserRole.COMPANY_ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.AUDITOR,
  UserRole.BRANCH_MANAGER,
  UserRole.CASHIER,
  UserRole.SALESMAN,
)
export class InvoicePrintSettingsController {
  constructor(
    private readonly printService: InvoicePrintService,
    private readonly aiStyler: AiInvoiceStylerService,
  ) {}

  @Get("themes")
  getCatalog() {
    return this.printService.catalog();
  }

  @Get()
  async getSettings(@CurrentTenant() tenant: TenantContext) {
    return this.printService.getSettings(tenant);
  }

  @Put()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
  )
  async saveSettings(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpdateInvoicePrintSettingsDto,
  ) {
    return this.printService.saveSettings(tenant, dto);
  }

  @Post("ai-style")
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ORG_ADMIN,
    UserRole.COMPANY_ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.BRANCH_MANAGER,
    UserRole.CASHIER,
    UserRole.SALESMAN,
  )
  async aiStyle(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: AiStyleRequest,
  ) {
    return this.aiStyler.styleInvoice(body);
  }

  @Get("preview")
  async preview(
    @CurrentTenant() tenant: TenantContext,
    @Query("copy") copy: string,
    @Query("category") category: string,
    @Query("themeId") themeId: string,
    @Query("accentColor") accentColor: string,
    @Query("share") share: string,
    @Res() reply: FastifyReply,
  ) {
    const html = await this.printService.previewHtml(
      tenant,
      copy,
      category,
      share === "true" || share === "1",
      themeId,
      accentColor,
    );
    return reply.type("text/html; charset=utf-8").send(html);
  }
}
