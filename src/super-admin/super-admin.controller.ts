import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { UserRole, SubscriptionTier } from "@billing/shared-types";
import { SuperAdminService } from "./super-admin.service";
import { SuperAdminGuard } from "../common/guards/super-admin.guard";

@Controller("super-admin")
@Roles(UserRole.SUPER_ADMIN)
@UseGuards(SuperAdminGuard)
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}

  @Get("stats")
  async getStats() {
    return this.superAdminService.getStats();
  }

  @Get("plans")
  async getPlans() {
    return this.superAdminService.getSubscriptionPlans();
  }

  @Post("plans")
  @HttpCode(HttpStatus.CREATED)
  async createPlan(
    @Body() dto: any,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.createSubscriptionPlan(dto, superAdminUserId);
  }

  @Patch("plans/:id")
  async updatePlan(
    @Param("id") id: string,
    @Body() dto: any,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.updateSubscriptionPlan(id, dto, superAdminUserId);
  }

  @Delete("plans/:id")
  async deletePlan(
    @Param("id") id: string,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.deleteSubscriptionPlan(id, superAdminUserId);
  }

  @Get("tenants")
  async getTenants(
    @Query("search") search?: string,
    @Query("tier") tier?: string,
    @Query("status") status?: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.superAdminService.getTenants({ search, tier, status, page, limit });
  }

  @Get("tenants/:id")
  async getTenantById(@Param("id") id: string) {
    return this.superAdminService.getTenantById(id);
  }

  @Post("tenants")
  @HttpCode(HttpStatus.CREATED)
  async createTenant(
    @Body() dto: any,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.createTenant(dto, superAdminUserId);
  }

  @Patch("tenants/:id")
  async updateTenant(
    @Param("id") id: string,
    @Body()
    dto: {
      subscriptionTier?: SubscriptionTier;
      tier?: SubscriptionTier;
      subscriptionEnds?: string;
      extendDays?: number;
      isActive?: boolean;
      status?: string;
      name?: string;
      organizationName?: string;
      legalName?: string;
      primaryPhone?: string;
      primaryEmail?: string;
    },
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.updateTenant(id, dto, superAdminUserId);
  }

  @Get("users")
  async getUsers(
    @Query("search") search?: string,
    @Query("role") role?: string,
    @Query("status") status?: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.superAdminService.getUsers({ search, role, status, page, limit });
  }

  @Patch("users/:id")
  async updateUser(
    @Param("id") id: string,
    @Body()
    dto: {
      role?: UserRole;
      isActive?: boolean;
      newPassword?: string;
    },
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.updateUser(id, dto, superAdminUserId);
  }

  @Get("audit-logs")
  async getAuditLogs(
    @Query("limit") limit?: number,
    @Query("action") action?: string,
  ) {
    return this.superAdminService.getAuditLogs({ limit, action });
  }

  @Get("invoices")
  async getInvoices(
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.superAdminService.getInvoices({ search, status, page, limit });
  }

  @Get("diagnostics")
  async getDiagnostics() {
    return this.superAdminService.getDiagnostics();
  }

  @Post("impersonate")
  @HttpCode(HttpStatus.OK)
  async impersonateCompany(
    @Body() body: { companyId?: string; targetCompanyId?: string; reason?: string },
    @CurrentUser("id") superAdminUserId: string,
  ) {
    const cid = body?.companyId || body?.targetCompanyId || "";
    return this.superAdminService.impersonateCompany(cid, body?.reason, superAdminUserId);
  }

  @Post("impersonate/exit")
  @HttpCode(HttpStatus.OK)
  async exitImpersonation(
    @Body() body: { companyId?: string; targetCompanyId?: string; sessionId?: string },
    @CurrentUser("id") superAdminUserId: string,
  ) {
    const cid = body?.companyId || body?.targetCompanyId || "";
    return this.superAdminService.exitImpersonation(cid, superAdminUserId, body?.sessionId);
  }
  @Delete("tenants/:id")
  @HttpCode(HttpStatus.OK)
  async deleteTenant(
    @Param("id") id: string,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.deleteTenant(id, superAdminUserId);
  }

  @Post("tenants/bulk-delete")
  @HttpCode(HttpStatus.OK)
  async bulkDeleteTenants(
    @Body() body: { tenantIds: string[] },
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.bulkDeleteTenants(body?.tenantIds || [], superAdminUserId);
  }

  @Post("tenants/bulk-status")
  @HttpCode(HttpStatus.OK)
  async bulkUpdateTenantStatus(
    @Body() body: { tenantIds: string[]; isActive: boolean },
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.bulkUpdateTenantStatus(body?.tenantIds || [], body?.isActive, superAdminUserId);
  }

  // 1. Subscriptions Management
  @Get("subscriptions")
  async getSubscriptions(
    @Query("search") search?: string,
    @Query("tier") tier?: string,
    @Query("status") status?: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.superAdminService.getSubscriptions({ search, tier, status, page, limit });
  }

  @Post("subscriptions/:id/action")
  @HttpCode(HttpStatus.OK)
  async updateSubscription(
    @Param("id") id: string,
    @Body() dto: any,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.updateSubscription(id, dto, superAdminUserId);
  }

  // 2. Transactions & Payments
  @Get("transactions")
  async getTransactions(
    @Query("search") search?: string,
    @Query("tier") tier?: string,
    @Query("status") status?: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.superAdminService.getTransactions({ search, tier, status, page, limit });
  }

  @Post("transactions/:id/refund")
  @HttpCode(HttpStatus.OK)
  async refundTransaction(
    @Param("id") id: string,
    @Body("reason") reason: string,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.refundTransaction(id, reason, superAdminUserId);
  }

  // 3. Platform Analytics
  @Get("analytics")
  async getAnalytics(@Query("timeframe") timeframe?: string) {
    return this.superAdminService.getPlatformAnalytics(timeframe);
  }

  // 4. Promotional Coupons
  @Get("coupons")
  async getCoupons() {
    return this.superAdminService.getCoupons();
  }

  @Post("coupons")
  @HttpCode(HttpStatus.CREATED)
  async createCoupon(
    @Body() dto: any,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.createCoupon(dto, superAdminUserId);
  }

  @Patch("coupons/:id")
  async updateCoupon(
    @Param("id") id: string,
    @Body() dto: any,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.updateCoupon(id, dto, superAdminUserId);
  }

  @Delete("coupons/:id")
  async deleteCoupon(
    @Param("id") id: string,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.deleteCoupon(id, superAdminUserId);
  }

  // 5. Add-ons Catalog
  @Get("addons")
  async getAddons() {
    return this.superAdminService.getAddons();
  }

  @Post("addons")
  @HttpCode(HttpStatus.CREATED)
  async createAddon(
    @Body() dto: any,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.createAddon(dto, superAdminUserId);
  }

  @Patch("addons/:id")
  async updateAddon(
    @Param("id") id: string,
    @Body() dto: any,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.updateAddon(id, dto, superAdminUserId);
  }

  @Delete("addons/:id")
  async deleteAddon(
    @Param("id") id: string,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.deleteAddon(id, superAdminUserId);
  }

  // 6. Platform Settings
  @Get("settings")
  async getSettings() {
    return this.superAdminService.getPlatformSettings();
  }

  @Patch("settings")
  async updateSettings(
    @Body() dto: any,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.updatePlatformSettings(dto, superAdminUserId);
  }

  // 7. Global Default HSN / SAC Master
  @Get("hsn")
  async getGlobalHsnCodes(
    @Query("search") search?: string,
    @Query("type") type?: string,
    @Query("isActive") isActive?: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.superAdminService.getGlobalHsnCodes({
      search,
      type,
      isActive,
      page,
      limit,
    });
  }

  @Post("hsn")
  @HttpCode(HttpStatus.CREATED)
  async createGlobalHsnCode(
    @Body() dto: any,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.createGlobalHsnCode(dto, superAdminUserId);
  }

  @Patch("hsn/:id")
  async updateGlobalHsnCode(
    @Param("id") id: string,
    @Body() dto: any,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.updateGlobalHsnCode(id, dto, superAdminUserId);
  }

  @Patch("hsn/:id/status")
  async toggleGlobalHsnStatus(
    @Param("id") id: string,
    @Body("isActive") isActive: boolean,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.toggleGlobalHsnStatus(id, Boolean(isActive), superAdminUserId);
  }

  @Delete("hsn/:id")
  async deleteGlobalHsnCode(
    @Param("id") id: string,
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.deleteGlobalHsnCode(id, superAdminUserId);
  }

  @Post("hsn/bulk-delete")
  @HttpCode(HttpStatus.OK)
  async bulkDeleteGlobalHsnCodes(
    @Body("ids") ids: string[],
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.bulkDeleteGlobalHsnCodes(ids, superAdminUserId);
  }

  @Post("hsn/bulk-import")
  @HttpCode(HttpStatus.OK)
  async bulkImportGlobalHsnCodes(
    @Body("items") items: any[],
    @CurrentUser("id") superAdminUserId: string,
  ) {
    return this.superAdminService.bulkImportGlobalHsnCodes(items, superAdminUserId);
  }
}
