import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { UsersService } from "./users.service";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RequirePermissions } from "../common/decorators/permissions.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { TenantContext, UserRole, ApprovalStatus } from "@billing/shared-types";
import { CreateStaffDto } from "./dto/create-staff.dto";
import { UpdateStaffDto } from "./dto/update-staff.dto";
import { CreateRoleDto, UpdateRoleDto } from "./dto/create-role.dto";

// =========================================================================
// 1. USERS & STAFF CONTROLLER
// =========================================================================
@Controller("users")
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * List all staff accounts in current organization
   */
  @Get()
  @RequirePermissions({ module: "settings", action: "view" })
  async listUsers(@CurrentTenant() ctx: TenantContext) {
    return this.usersService.listUsers(ctx);
  }

  /**
   * Create a new staff account
   */
  @Post()
  @RequirePermissions({ module: "settings", action: "create" })
  async createUser(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateStaffDto,
  ) {
    return this.usersService.createUser(ctx, dto);
  }

  /**
   * Get team activity logs
   */
  @Get("activities")
  @RequirePermissions({ module: "settings", action: "view" })
  async getActivities(
    @CurrentTenant() ctx: TenantContext,
    @Query("userId") userId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.usersService.getActivities(ctx, {
      userId,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  /**
   * Get staff member profile with permissions and branch assignments
   */
  @Get(":id")
  @RequirePermissions({ module: "settings", action: "view" })
  async getUser(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.usersService.getUser(ctx, id);
  }

  /**
   * Update staff account details, role, branches, or invoice limits
   */
  @Put(":id")
  @RequirePermissions({ module: "settings", action: "edit" })
  async updateUser(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.usersService.updateUser(ctx, id, dto);
  }

  /**
   * Alias patch for update
   */
  @Patch(":id")
  @RequirePermissions({ module: "settings", action: "edit" })
  async patchUser(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.usersService.updateUser(ctx, id, dto);
  }

  /**
   * Soft-deactivate a staff member
   */
  @Delete(":id")
  @RequirePermissions({ module: "settings", action: "delete" })
  async removeUser(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.usersService.toggleUserStatus(ctx, id, false);
  }

  /**
   * Toggle staff status (activate / deactivate)
   */
  @Patch(":id/status")
  @RequirePermissions({ module: "settings", action: "edit" })
  async toggleStatus(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body("isActive") isActive: boolean,
  ) {
    if (typeof isActive !== "boolean") {
      throw new BadRequestException("isActive must be a boolean value.");
    }
    return this.usersService.toggleUserStatus(ctx, id, isActive);
  }

  /**
   * Admin-initiated password reset
   */
  @Post(":id/reset-password")
  @RequirePermissions({ module: "settings", action: "edit" })
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body("newPassword") newPassword: string,
  ) {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException("New password must be at least 6 characters.");
    }
    return this.usersService.resetPassword(ctx, id, newPassword);
  }

  /**
   * Force revoke all active sessions for a staff member
   */
  @Post(":id/revoke-sessions")
  @RequirePermissions({ module: "settings", action: "edit" })
  @HttpCode(HttpStatus.OK)
  async revokeSessions(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.usersService.revokeSessions(ctx, id);
  }

  /**
   * Get user permissions matrix (base role + custom overrides)
   */
  @Get(":id/permissions")
  @RequirePermissions({ module: "settings", action: "view" })
  async getUserPermissions(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.usersService.getUserPermissions(ctx, id);
  }

  /**
   * Update granular permission overrides for a staff member
   */
  @Put(":id/permissions")
  @RequirePermissions({ module: "settings", action: "edit" })
  async updateUserPermissions(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body("overrides") overrides: Array<{ module: string; action: string; allowed?: boolean; isAllowed?: boolean }>,
  ) {
    if (!Array.isArray(overrides)) {
      throw new BadRequestException("overrides must be an array of permissions.");
    }
    const formatted = overrides.map((o) => ({
      module: o.module,
      action: o.action,
      allowed: Boolean(o.allowed ?? o.isAllowed ?? true),
    }));
    return this.usersService.updateUserPermissions(ctx, id, formatted);
  }

  /**
   * Reset user permissions back to base role defaults
   */
  @Post(":id/reset-permissions")
  @RequirePermissions({ module: "settings", action: "edit" })
  @HttpCode(HttpStatus.OK)
  async resetUserPermissions(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.usersService.resetUserPermissions(ctx, id);
  }

  /**
   * Copy permission overrides from one staff member to another
   */
  @Post(":id/copy-permissions")
  @RequirePermissions({ module: "settings", action: "edit" })
  @HttpCode(HttpStatus.OK)
  async copyUserPermissions(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") targetUserId: string,
    @Body("sourceUserId") sourceUserId: string,
  ) {
    if (!sourceUserId) {
      throw new BadRequestException("sourceUserId is required.");
    }
    return this.usersService.copyUserPermissions(ctx, targetUserId, sourceUserId);
  }
}

// =========================================================================
// 2. ROLES CONTROLLER
// =========================================================================
@Controller("roles")
@UseGuards(PermissionsGuard)
export class RolesController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * List all predefined and custom roles for organization
   */
  @Get()
  @RequirePermissions({ module: "settings", action: "view" })
  async listRoles(@CurrentTenant() ctx: TenantContext) {
    return this.usersService.listRoles(ctx);
  }

  /**
   * Get role templates
   */
  @Get("templates")
  @RequirePermissions({ module: "settings", action: "view" })
  async getTemplates() {
    return this.usersService.getRoleTemplates();
  }

  /**
   * Export roles as JSON or CSV
   */
  @Get("export")
  @RequirePermissions({ module: "settings", action: "view" })
  async exportRoles(
    @CurrentTenant() ctx: TenantContext,
    @Query("format") format?: string,
  ) {
    return this.usersService.exportRoles(ctx, format || "json");
  }

  /**
   * Get single role details
   */
  @Get(":id")
  @RequirePermissions({ module: "settings", action: "view" })
  async getRole(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.usersService.getRole(ctx, id);
  }

  /**
   * Create a new custom role
   */
  @Post()
  @RequirePermissions({ module: "settings", action: "create" })
  async createRole(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateRoleDto,
  ) {
    return this.usersService.createRole(ctx, dto);
  }

  /**
   * Update an existing custom role
   */
  @Put(":id")
  @RequirePermissions({ module: "settings", action: "edit" })
  async updateRole(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.usersService.updateRole(ctx, id, dto);
  }

  /**
   * Toggle role status (active / inactive)
   */
  @Patch(":id/status")
  @RequirePermissions({ module: "settings", action: "edit" })
  async toggleRoleStatus(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body("isActive") isActive: boolean,
  ) {
    if (typeof isActive !== "boolean") {
      throw new BadRequestException("isActive must be a boolean.");
    }
    return this.usersService.toggleRoleStatus(ctx, id, isActive);
  }

  /**
   * Duplicate a role
   */
  @Post(":id/duplicate")
  @RequirePermissions({ module: "settings", action: "create" })
  async duplicateRole(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body("name") newName: string,
  ) {
    if (!newName || !newName.trim()) {
      throw new BadRequestException("New role name is required.");
    }
    return this.usersService.duplicateRole(ctx, id, newName.trim());
  }

  /**
   * Delete a custom role
   */
  @Delete(":id")
  @RequirePermissions({ module: "settings", action: "delete" })
  async deleteRole(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.usersService.deleteRole(ctx, id);
  }
}

// =========================================================================
// 3. APPROVALS CONTROLLER
// =========================================================================
@Controller("approvals")
@UseGuards(PermissionsGuard)
export class ApprovalsController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * List invoice approval requests
   */
  @Get()
  @RequirePermissions({ module: "invoices", action: "view" })
  async listApprovals(
    @CurrentTenant() ctx: TenantContext,
    @Query("status") status?: ApprovalStatus,
  ) {
    return this.usersService.listApprovals(ctx, { status });
  }

  /**
   * Approve an invoice request
   */
  @Post(":id/approve")
  @RequirePermissions({ module: "invoices", action: "approve" })
  @HttpCode(HttpStatus.OK)
  async approveRequest(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body("comments") comments?: string,
  ) {
    return this.usersService.approveRequest(ctx, id, comments);
  }

  /**
   * Reject an invoice request
   */
  @Post(":id/reject")
  @RequirePermissions({ module: "invoices", action: "approve" })
  @HttpCode(HttpStatus.OK)
  async rejectRequest(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body("comments") comments: string,
  ) {
    if (!comments || !comments.trim()) {
      throw new BadRequestException("Rejection comments are required.");
    }
    return this.usersService.rejectRequest(ctx, id, comments.trim());
  }
}
