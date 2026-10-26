import {
  Controller,
  Get,
  Patch,
  Post,
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
      subscriptionEnds?: string;
      isActive?: boolean;
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
}
