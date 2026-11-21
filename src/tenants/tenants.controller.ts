import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { FastifyRequest, FastifyReply } from "fastify";
import { TenantsService, CreateBranchDto } from "./tenants.service";
import { UsersService } from "../users/users.service";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { TenantContext, UserRole, SubscriptionTier } from "@billing/shared-types";
import { CreateCompanyDto } from "./dto/create-company.dto";

@Controller("tenants")
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly usersService: UsersService,
  ) {}

  @Get("company")
  async getCurrentCompany(@CurrentTenant() ctx: TenantContext) {
    return this.tenantsService.getCurrentCompany(ctx);
  }

  @Patch("company")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async updateCurrentCompany(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: any,
  ) {
    return this.tenantsService.updateCurrentCompany(ctx, dto);
  }

  @Get("company/settings-options")
  getCompanySettingsOptions() {
    return this.tenantsService.getCompanySettingsOptions();
  }

  @Get("pincode/:pincode")
  lookupPincode(@Param("pincode") pincode: string) {
    return this.tenantsService.lookupPincode(pincode);
  }

  @Post("company/extra-details")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async addExtraDetail(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: { key?: string; value?: string },
  ) {
    return this.tenantsService.addExtraDetail(ctx, dto);
  }

  @Post("company/logo")
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async uploadLogo(
    @CurrentTenant() ctx: TenantContext,
    @Req() req: FastifyRequest,
  ) {
    const buffer = await this.readImageUpload(req);
    return this.tenantsService.saveCompanyImage(ctx, "logo", buffer);
  }

  @Get("company/logo")
  async getLogo(
    @CurrentTenant() ctx: TenantContext,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.tenantsService.readCompanyImage(ctx, "logo");
    return reply
      .header("Content-Type", file.mimeType)
      .header("Cache-Control", "private, max-age=60")
      .send(file.buffer);
  }

  @Delete("company/logo")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async deleteLogo(@CurrentTenant() ctx: TenantContext) {
    return this.tenantsService.deleteCompanyImage(ctx, "logo");
  }

  @Post("company/signature")
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async uploadSignature(
    @CurrentTenant() ctx: TenantContext,
    @Req() req: FastifyRequest,
  ) {
    const buffer = await this.readImageUpload(req);
    return this.tenantsService.saveCompanyImage(ctx, "signature", buffer);
  }

  @Get("company/signature")
  async getSignature(
    @CurrentTenant() ctx: TenantContext,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.tenantsService.readCompanyImage(ctx, "signature");
    return reply
      .header("Content-Type", file.mimeType)
      .header("Cache-Control", "private, max-age=60")
      .send(file.buffer);
  }

  @Delete("company/signature")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async deleteSignature(@CurrentTenant() ctx: TenantContext) {
    return this.tenantsService.deleteCompanyImage(ctx, "signature");
  }

  @Get("company/tally-export")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async exportTally(@CurrentTenant() ctx: TenantContext) {
    return this.tenantsService.exportTallyMasters(ctx);
  }

  @Post("financial-years/:id/close")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async closeFinancialYear(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.tenantsService.closeFinancialYear(ctx, id);
  }

  private async readImageUpload(req: FastifyRequest): Promise<Buffer> {
    if ((req as any).isMultipart && (req as any).isMultipart()) {
      const parts = (req as any).parts();
      for await (const part of parts) {
        if (part.type === "file") {
          return await part.toBuffer();
        }
      }
    }
    const body = (req.body || {}) as any;
    if (body.fileBase64) {
      return Buffer.from(String(body.fileBase64).replace(/^data:image\/\w+;base64,/, ""), "base64");
    }
    throw new BadRequestException(
      "Upload a PNG/JPG file (multipart) or fileBase64 JSON.",
    );
  }

  @Get("companies")
  async getCompanies(@CurrentTenant() ctx: TenantContext) {
    return this.tenantsService.getCompaniesWithEntitlements(ctx);
  }

  @Post("companies")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async createCompany(
    @CurrentTenant() ctx: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCompanyDto,
  ) {
    return this.tenantsService.createCompany(
      ctx,
      dto,
      user?.id || ctx.userId || "",
    );
  }

  @Get("companies/:id")
  async getCompanyById(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.tenantsService.getCompanyById(ctx, id);
  }

  @Patch("companies/:id")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async updateCompany(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: Partial<CreateCompanyDto>,
  ) {
    return this.tenantsService.updateCompany(ctx, id, dto);
  }

  @Get("branches")
  async getBranches(@CurrentTenant() ctx: TenantContext) {
    return this.tenantsService.getBranches(ctx);
  }

  @Post("branches")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async createBranch(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateBranchDto,
  ) {
    return this.tenantsService.createBranch(ctx, dto);
  }

  @Get("financial-years")
  async getFinancialYears(@CurrentTenant() ctx: TenantContext) {
    return this.tenantsService.getFinancialYears(ctx);
  }

  @Post("financial-years")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async createFinancialYear(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: { name: string; startDate: string; endDate: string; isCurrent?: boolean },
  ) {
    return this.tenantsService.createFinancialYear(ctx, dto);
  }

  @Patch("financial-years/:id")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async updateFinancialYear(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: { name?: string; startDate?: string; endDate?: string; isLocked?: boolean; isCurrent?: boolean },
  ) {
    return this.tenantsService.updateFinancialYear(ctx, id, dto);
  }

  @Delete("financial-years/:id")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async deleteFinancialYear(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.tenantsService.deleteFinancialYear(ctx, id);
  }

  @Get("warehouses")
  async getWarehouses(@CurrentTenant() ctx: TenantContext) {
    return this.tenantsService.getWarehouses(ctx);
  }

  @Post("warehouses")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async createWarehouse(
    @CurrentTenant() ctx: TenantContext,
    @Body()
    dto: {
      name: string;
      isDefault?: boolean;
      address?: string;
      branchId?: string;
    },
  ) {
    return this.tenantsService.createWarehouse(ctx, dto);
  }

  @Put("warehouses/:id")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async updateWarehouse(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body()
    dto: {
      name?: string;
      isDefault?: boolean;
      address?: string;
    },
  ) {
    return this.tenantsService.updateWarehouse(ctx, id, dto);
  }

  @Delete("warehouses/:id")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async deleteWarehouse(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.tenantsService.deleteWarehouse(ctx, id);
  }

  @Get("users")
  async getOrganizationUsers(@CurrentTenant() ctx: TenantContext) {
    return this.usersService.listUsers(ctx);
  }

  @Post("users")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async createOrganizationUser(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: any,
  ) {
    return this.usersService.createUser(ctx, {
      fullName: dto.name || dto.fullName,
      phone: dto.phone,
      email: dto.email,
      username: dto.username,
      password: dto.password,
      role: dto.role,
      branchIds: dto.branchId ? [dto.branchId] : dto.branchIds,
      dataScope: dto.dataScope,
      maxInvoiceAmount: dto.maxInvoiceAmount,
      maxDiscountPercent: dto.maxDiscountPercent,
      canOverridePrice: dto.canOverridePrice,
    });
  }

  @Patch("users/:id")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async updateOrganizationUser(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: any,
  ) {
    return this.usersService.updateUser(ctx, id, {
      fullName: dto.name || dto.fullName,
      phone: dto.phone,
      email: dto.email,
      role: dto.role,
      isActive: dto.isActive,
      branchIds: dto.branchId ? [dto.branchId] : dto.branchIds,
      dataScope: dto.dataScope,
      maxInvoiceAmount: dto.maxInvoiceAmount,
      maxDiscountPercent: dto.maxDiscountPercent,
      canOverridePrice: dto.canOverridePrice,
    });
  }

  @Delete("users/:id")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async deleteOrganizationUser(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.usersService.toggleUserStatus(ctx, id, false);
  }

  @Get("activities")
  async getOrganizationActivities(@CurrentTenant() ctx: TenantContext) {
    return this.usersService.getActivities(ctx);
  }

  @Get("billing-history")
  async getBillingHistory(@CurrentTenant() ctx: TenantContext) {
    return this.tenantsService.getBillingHistory(ctx);
  }

  @Post("subscription/upgrade")
  @Roles(UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  async upgradeSubscription(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: { tier: SubscriptionTier; billingCycle?: "1year" | "3years" },
  ) {
    return this.tenantsService.upgradeSubscription(ctx, dto);
  }
}
