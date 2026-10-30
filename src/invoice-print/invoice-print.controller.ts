import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { Public } from "../common/decorators/public.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { InvoicePrintService } from "./invoice-print.service";
import { AiInvoiceStylerService, AiStyleRequest } from "./ai-invoice-styler.service";
import { UpdateInvoicePrintSettingsDto } from "./dto/update-invoice-settings.dto";
import { InvoiceThemeManagerService } from "./invoice-theme-manager.service";

@Controller("invoice-settings")
export class InvoicePrintSettingsController {
  constructor(
    private readonly printService: InvoicePrintService,
    private readonly aiStyler: AiInvoiceStylerService,
    private readonly themeManager: InvoiceThemeManagerService,
  ) {}

  @Get("themes")
  @Public()
  getCatalog() {
    const defaultCatalog = this.printService.catalog();
    const managedThemes = this.themeManager.getAllThemes(true);
    return {
      ...defaultCatalog,
      managedThemes,
    };
  }

  @Get("theme-list")
  @Public()
  getActiveThemes() {
    return this.themeManager.getAllThemes(true);
  }

  // Superadmin endpoints for managing themes
  @Get("superadmin/themes")
  @Roles(UserRole.SUPER_ADMIN)
  getSuperadminThemes() {
    return this.themeManager.getAllThemes(false);
  }

  @Post("superadmin/themes")
  @Roles(UserRole.SUPER_ADMIN)
  createSuperadminTheme(@Body() body: any) {
    return this.themeManager.createTheme(body);
  }

  @Put("superadmin/themes/:id")
  @Roles(UserRole.SUPER_ADMIN)
  updateSuperadminTheme(@Param("id") id: string, @Body() body: any) {
    return this.themeManager.updateTheme(id, body);
  }

  @Delete("superadmin/themes/:id")
  @Roles(UserRole.SUPER_ADMIN)
  deleteSuperadminTheme(@Param("id") id: string) {
    const success = this.themeManager.deleteTheme(id);
    return { success, id };
  }

  @Post("superadmin/themes/reset")
  @Roles(UserRole.SUPER_ADMIN)
  resetSuperadminThemes() {
    return this.themeManager.resetToDefaults();
  }

  @Get()
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
  @Public()
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

  @Get(["print/:id", ":id/print"])
  @Public()
  async printDirect(
    @Param("id") id: string,
    @Query("copy") copy: string,
    @Query("share") share: string,
    @Query("themeId") themeId: string,
    @Query("accentColor") accentColor: string,
    @Res() reply: FastifyReply,
  ) {
    const html = await this.printService.printInvoiceHtml(
      undefined,
      id,
      copy,
      share === "true" || share === "1",
      themeId,
      accentColor,
    );
    return reply.type("text/html; charset=utf-8").send(html);
  }
}
