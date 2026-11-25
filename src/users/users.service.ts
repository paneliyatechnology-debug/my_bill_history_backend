import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { TenantContext, UserRole, DataScope, ApprovalStatus } from "@billing/shared-types";
import { AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { CreateStaffDto } from "./dto/create-staff.dto";
import { UpdateStaffDto } from "./dto/update-staff.dto";
import { CreateRoleDto, UpdateRoleDto } from "./dto/create-role.dto";
import {
  PERMISSION_CATALOG,
  PERMISSION_MODULE_GROUPS,
  ROLE_TEMPLATES,
  getDefaultRolePermissions,
  resolveEffectivePermissions,
} from "../auth/rbac/permissions.catalog";
import { InvoicesService } from "../invoices/invoices.service";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => InvoicesService))
    private readonly invoicesService: InvoicesService,
  ) {}

  // =========================================================================
  // 1. STAFF MANAGEMENT
  // =========================================================================

  /**
   * List all staff accounts belonging to the organization
   */
  async listUsers(ctx: TenantContext) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const users = await tx.user.findMany({
        where: { organizationId: ctx.organizationId },
        select: {
          id: true,
          fullName: true,
          phone: true,
          email: true,
          username: true,
          role: true,
          customRoleId: true,
          isActive: true,
          joiningDate: true,
          lastLoginAt: true,
          dataScope: true,
          maxInvoiceAmount: true,
          maxDiscountPercent: true,
          canOverridePrice: true,
          createdAt: true,
          customRole: {
            select: { id: true, name: true },
          },
          branchAssignments: {
            select: {
              isDefault: true,
              branch: {
                select: { id: true, name: true, code: true, isMainBranch: true },
              },
            },
          },
          _count: {
            select: { auditLogs: true, invoicesCreated: true },
          },
        },
        orderBy: [{ role: "asc" }, { createdAt: "desc" }],
      });

      return users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        name: u.fullName,
        phone: u.phone,
        email: u.email,
        username: u.username,
        role: u.role,
        customRoleId: u.customRoleId,
        customRoleName: u.customRole?.name,
        isActive: u.isActive,
        status: u.isActive ? "Active" : "Inactive",
        joiningDate: u.joiningDate,
        lastLoginAt: u.lastLoginAt,
        dataScope: u.dataScope,
        maxInvoiceAmount: u.maxInvoiceAmount ? Number(u.maxInvoiceAmount) : null,
        maxDiscountPercent: u.maxDiscountPercent ? Number(u.maxDiscountPercent) : null,
        canOverridePrice: u.canOverridePrice,
        branches: u.branchAssignments.map((b) => ({
          id: b.branch.id,
          name: b.branch.name,
          code: b.branch.code,
          isDefault: b.isDefault,
        })),
        branch:
          u.branchAssignments.length === 0
            ? "All Branches"
            : u.branchAssignments.map((b) => b.branch.name).join(", "),
        activitiesCount: u._count.auditLogs,
        invoicesCount: u._count.invoicesCreated,
        createdAt: u.createdAt,
      }));
    });
  }

  /**
   * Create a new staff account under the organization
   */
  async createUser(ctx: TenantContext, dto: CreateStaffDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const phone = dto.phone.trim();
      const email = dto.email ? dto.email.trim().toLowerCase() : null;
      const username = dto.username ? dto.username.trim().toLowerCase() : null;

      // Check unique constraints
      const existingPhone = await tx.user.findFirst({
        where: { phone },
      });
      if (existingPhone) {
        throw new ConflictException({
          statusCode: 409,
          error: "PHONE_EXISTS",
          message: `Phone number '${phone}' is already registered to another user.`,
          messageGujarati: `ફોન નંબર '${phone}' પહેલેથી જ નોંધાયેલ છે.`,
        });
      }

      if (email) {
        const existingEmail = await tx.user.findFirst({
          where: { email },
        });
        if (existingEmail) {
          throw new ConflictException({
            statusCode: 409,
            error: "EMAIL_EXISTS",
            message: `Email '${email}' is already registered to another user.`,
            messageGujarati: `ઈમેલ '${email}' પહેલેથી જ નોંધાયેલ છે.`,
          });
        }
      }

      if (username) {
        const existingUsername = await tx.user.findFirst({
          where: { username },
        });
        if (existingUsername) {
          throw new ConflictException({
            statusCode: 409,
            error: "USERNAME_EXISTS",
            message: `Username '${username}' is already in use.`,
            messageGujarati: `યુઝરનેમ '${username}' પહેલેથી જ વપરાશમાં છે.`,
          });
        }
      }

      // Hash password
      const passwordHash = await bcrypt.hash(dto.password, 10);

      const user = await tx.user.create({
        data: {
          organizationId: ctx.organizationId,
          fullName: dto.fullName.trim(),
          phone,
          email,
          username,
          passwordHash,
          role: dto.role || UserRole.CASHIER,
          customRoleId: dto.customRoleId || null,
          dataScope: dto.dataScope || DataScope.ALL_ORGANIZATION,
          maxInvoiceAmount: dto.maxInvoiceAmount !== undefined ? dto.maxInvoiceAmount : null,
          maxDiscountPercent: dto.maxDiscountPercent !== undefined ? dto.maxDiscountPercent : null,
          canOverridePrice: dto.canOverridePrice ?? true,
          isActive: true,
          joiningDate: new Date(),
        },
      });

      // Assign branches
      if (dto.branchIds && dto.branchIds.length > 0) {
        for (let i = 0; i < dto.branchIds.length; i++) {
          const bId = dto.branchIds[i];
          await tx.userBranchAssignment.create({
            data: {
              userId: user.id,
              branchId: bId,
              role: user.role,
              isDefault: i === 0,
            },
          });
        }
      }

      // Assign granular permission overrides if provided
      if (dto.permissions && dto.permissions.length > 0) {
        for (const p of dto.permissions) {
          await tx.userPermission.create({
            data: {
              userId: user.id,
              module: p.module,
              action: p.action,
              allowed: p.allowed,
            },
          });
        }
      }

      // Record Audit Log
      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || user.id,
        action: "STAFF_CREATE",
        entityName: "User",
        entityId: user.id,
        newState: {
          id: user.id,
          name: user.fullName,
          role: user.role,
          phone: user.phone,
        },
      });

      return this.getUser(ctx, user.id, tx);
    });
  }

  /**
   * Get single user with profile, branches, custom role, and effective permissions
   */
  async getUser(ctx: TenantContext, userId: string, txClient?: any) {
    const handler = async (tx: any) => {
      const user = await tx.user.findFirst({
        where: { id: userId, organizationId: ctx.organizationId },
        include: {
          customRole: {
            include: { permissions: true },
          },
          userPermissions: true,
          branchAssignments: {
            include: { branch: true },
          },
        },
      });

      if (!user) {
        throw new NotFoundException({
          statusCode: 404,
          message: `User '${userId}' not found.`,
          messageGujarati: `વપરાશકર્તા '${userId}' મળ્યો નથી.`,
        });
      }

      const effective = resolveEffectivePermissions(
        user.role,
        user.customRole?.permissions || [],
        user.userPermissions || [],
      );

      return {
        id: user.id,
        fullName: user.fullName,
        name: user.fullName,
        phone: user.phone,
        email: user.email,
        username: user.username,
        role: user.role,
        customRoleId: user.customRoleId,
        customRole: user.customRole
          ? {
              id: user.customRole.id,
              name: user.customRole.name,
              description: user.customRole.description,
            }
          : null,
        isActive: user.isActive,
        status: user.isActive ? "Active" : "Inactive",
        dataScope: user.dataScope,
        maxInvoiceAmount: user.maxInvoiceAmount ? Number(user.maxInvoiceAmount) : null,
        maxDiscountPercent: user.maxDiscountPercent ? Number(user.maxDiscountPercent) : null,
        canOverridePrice: user.canOverridePrice,
        joiningDate: user.joiningDate,
        lastLoginAt: user.lastLoginAt,
        sessionVersion: user.sessionVersion,
        branches: user.branchAssignments.map((b: any) => ({
          id: b.branch.id,
          name: b.branch.name,
          code: b.branch.code,
          isDefault: b.isDefault,
        })),
        permissions: effective,
        overrides: user.userPermissions.map((p: any) => ({
          module: p.module,
          action: p.action,
          allowed: p.allowed,
        })),
        createdAt: user.createdAt,
      };
    };

    if (txClient) {
      return handler(txClient);
    }
    return this.prisma.executeInTenantContext(ctx, handler);
  }

  /**
   * Update staff details, role, branches, and limits
   */
  async updateUser(ctx: TenantContext, userId: string, dto: UpdateStaffDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existing = await tx.user.findFirst({
        where: { id: userId, organizationId: ctx.organizationId },
      });

      if (!existing) {
        throw new NotFoundException(`User '${userId}' not found.`);
      }

      // Security: Prevent demoting the last Admin in the organization
      if (
        dto.role &&
        dto.role !== existing.role &&
        existing.role === UserRole.COMPANY_ADMIN
      ) {
        const adminCount = await tx.user.count({
          where: {
            organizationId: ctx.organizationId,
            role: { in: [UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN] },
            isActive: true,
          },
        });
        if (adminCount <= 1) {
          throw new BadRequestException({
            statusCode: 400,
            message: "Cannot change the role of the only active Administrator.",
            messageGujarati: "એકમાત્ર સક્રિય એડમિનિસ્ટ્રેટરની ભૂમિકા બદલી શકાતી નથી.",
          });
        }
      }

      const updateData: any = {};
      if (dto.fullName) updateData.fullName = dto.fullName.trim();
      if (dto.phone) updateData.phone = dto.phone.trim();
      if (dto.email !== undefined) updateData.email = dto.email ? dto.email.trim().toLowerCase() : null;
      if (dto.username !== undefined) updateData.username = dto.username ? dto.username.trim().toLowerCase() : null;
      if (dto.role) updateData.role = dto.role;
      if (dto.customRoleId !== undefined) updateData.customRoleId = dto.customRoleId || null;
      if (dto.dataScope) updateData.dataScope = dto.dataScope;
      if (dto.maxInvoiceAmount !== undefined) updateData.maxInvoiceAmount = dto.maxInvoiceAmount;
      if (dto.maxDiscountPercent !== undefined) updateData.maxDiscountPercent = dto.maxDiscountPercent;
      if (dto.canOverridePrice !== undefined) updateData.canOverridePrice = dto.canOverridePrice;
      if (dto.isActive !== undefined) {
        updateData.isActive = dto.isActive;
        if (!dto.isActive) {
          updateData.sessionVersion = existing.sessionVersion + 1; // Invalidate sessions
        }
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: updateData,
      });

      // Update branch assignments if provided
      if (dto.branchIds !== undefined) {
        await tx.userBranchAssignment.deleteMany({
          where: { userId },
        });

        for (let i = 0; i < dto.branchIds.length; i++) {
          await tx.userBranchAssignment.create({
            data: {
              userId,
              branchId: dto.branchIds[i],
              role: updated.role,
              isDefault: i === 0,
            },
          });
        }
      }

      // Record Audit Log
      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || userId,
        action: "STAFF_UPDATE",
        entityName: "User",
        entityId: userId,
        previousState: existing,
        newState: updated,
      });

      return this.getUser(ctx, userId, tx);
    });
  }

  /**
   * Toggle staff status (Active / Inactive)
   */
  async toggleUserStatus(ctx: TenantContext, userId: string, isActive: boolean) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, organizationId: ctx.organizationId },
      });
      if (!user) throw new NotFoundException(`User '${userId}' not found.`);

      if (
        !isActive &&
        (user.role === UserRole.COMPANY_ADMIN || user.role === UserRole.ORG_ADMIN)
      ) {
        const adminCount = await tx.user.count({
          where: {
            organizationId: ctx.organizationId,
            role: { in: [UserRole.COMPANY_ADMIN, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN] },
            isActive: true,
          },
        });
        if (adminCount <= 1) {
          throw new BadRequestException("Cannot deactivate the only active Administrator.");
        }
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          isActive,
          sessionVersion: isActive ? user.sessionVersion : user.sessionVersion + 1,
        },
      });

      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || userId,
        action: isActive ? "STAFF_ACTIVATE" : "STAFF_DEACTIVATE",
        entityName: "User",
        entityId: userId,
        newState: { isActive },
      });

      return {
        id: updated.id,
        isActive: updated.isActive,
        status: updated.isActive ? "Active" : "Inactive",
      };
    });
  }

  /**
   * Reset staff password and revoke active sessions
   */
  async resetPassword(ctx: TenantContext, userId: string, newPassword: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, organizationId: ctx.organizationId },
      });
      if (!user) throw new NotFoundException(`User '${userId}' not found.`);

      if (!newPassword || newPassword.length < 6) {
        throw new BadRequestException("Password must be at least 6 characters long.");
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          sessionVersion: user.sessionVersion + 1, // Force re-login
        },
      });

      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || userId,
        action: "STAFF_PASSWORD_RESET",
        entityName: "User",
        entityId: userId,
      });

      return { success: true, message: "Password updated successfully." };
    });
  }

  /**
   * Revoke staff sessions (bumps sessionVersion)
   */
  async revokeSessions(ctx: TenantContext, userId: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, organizationId: ctx.organizationId },
      });
      if (!user) throw new NotFoundException(`User '${userId}' not found.`);

      await tx.user.update({
        where: { id: userId },
        data: {
          sessionVersion: user.sessionVersion + 1,
        },
      });

      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || userId,
        action: "STAFF_SESSIONS_REVOKED",
        entityName: "User",
        entityId: userId,
      });

      return { success: true, message: "All sessions have been revoked." };
    });
  }

  // =========================================================================
  // 2. PERMISSION MANAGEMENT & OVERRIDES
  // =========================================================================

  /**
   * Get permissions catalog along with user's effective permissions
   */
  async getUserPermissions(ctx: TenantContext, userId: string) {
    const user = await this.getUser(ctx, userId);
    return {
      userId: user.id,
      fullName: user.fullName,
      role: user.role,
      customRole: user.customRole,
      catalog: PERMISSION_CATALOG,
      effective: user.permissions,
      effectivePermissions: user.permissions,
      overrides: user.overrides,
    };
  }

  /**
   * Save individual permission overrides for staff
   */
  async updateUserPermissions(
    ctx: TenantContext,
    userId: string,
    permissions: { module: string; action: string; allowed: boolean }[],
  ) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, organizationId: ctx.organizationId },
      });
      if (!user) throw new NotFoundException(`User '${userId}' not found.`);

      // Replace overrides atomically
      await tx.userPermission.deleteMany({
        where: { userId },
      });

      for (const p of permissions) {
        await tx.userPermission.create({
          data: {
            userId,
            module: p.module,
            action: p.action,
            allowed: p.allowed,
          },
        });
      }

      // Bump session version so token refresh picks up changes immediately
      await tx.user.update({
        where: { id: userId },
        data: { sessionVersion: user.sessionVersion + 1 },
      });

      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || userId,
        action: "STAFF_PERMISSIONS_UPDATED",
        entityName: "User",
        entityId: userId,
        newState: { overridesCount: permissions.length },
      });

      return this.getUser(ctx, userId, tx);
    });
  }

  /**
   * Reset staff permissions to role defaults (clears overrides)
   */
  async resetUserPermissions(ctx: TenantContext, userId: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, organizationId: ctx.organizationId },
      });
      if (!user) throw new NotFoundException(`User '${userId}' not found.`);

      await tx.userPermission.deleteMany({
        where: { userId },
      });

      await tx.user.update({
        where: { id: userId },
        data: { sessionVersion: user.sessionVersion + 1 },
      });

      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || userId,
        action: "STAFF_PERMISSIONS_RESET",
        entityName: "User",
        entityId: userId,
      });

      return this.getUser(ctx, userId, tx);
    });
  }

  /**
   * Copy permissions from another staff member
   */
  async copyUserPermissions(ctx: TenantContext, targetUserId: string, sourceUserId: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const source = await tx.user.findFirst({
        where: { id: sourceUserId, organizationId: ctx.organizationId },
        include: { userPermissions: true },
      });
      if (!source) throw new NotFoundException(`Source user '${sourceUserId}' not found.`);

      const target = await tx.user.findFirst({
        where: { id: targetUserId, organizationId: ctx.organizationId },
      });
      if (!target) throw new NotFoundException(`Target user '${targetUserId}' not found.`);

      await tx.userPermission.deleteMany({
        where: { userId: targetUserId },
      });

      for (const p of source.userPermissions) {
        await tx.userPermission.create({
          data: {
            userId: targetUserId,
            module: p.module,
            action: p.action,
            allowed: p.allowed,
          },
        });
      }

      await tx.user.update({
        where: { id: targetUserId },
        data: {
          customRoleId: source.customRoleId,
          sessionVersion: target.sessionVersion + 1,
        },
      });

      return this.getUser(ctx, targetUserId, tx);
    });
  }

  // =========================================================================
  // 3. ROLE MANAGEMENT
  // =========================================================================

  /**
   * List all predefined system roles and custom roles
   */
  async listRoles(ctx: TenantContext) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const SYS_ROLE_CONFIGS = [
        {
          sysKey: "sys_company_admin",
          role: UserRole.COMPANY_ADMIN,
          name: "Owner / Admin",
          nameGujarati: "માલિક / એડમિન",
          description: "Full master administrative access to all modules and configurations",
        },
        {
          sysKey: "sys_partner",
          role: UserRole.PARTNER,
          name: "Partner",
          nameGujarati: "ભાગીદાર (પાર્ટનર)",
          description: "Full operational and financial access without ownership transfer privileges",
        },
        {
          sysKey: "sys_accountant",
          role: UserRole.ACCOUNTANT,
          name: "Accountant",
          nameGujarati: "નામાકાર (એકાઉન્ટન્ટ)",
          description: "Full double-entry vouchers, ledgers, trial balance, P&L, GST filing and invoices",
        },
        {
          sysKey: "sys_salesman",
          role: UserRole.SALESMAN,
          name: "Salesman",
          nameGujarati: "સેલ્સમેન",
          description: "Issue sales invoices, quotations, proforma, delivery challans and view customers",
        },
        {
          sysKey: "sys_stock_manager",
          role: UserRole.STOCK_MANAGER,
          name: "Stock Manager",
          nameGujarati: "સ્ટોક મેનેજર",
          description: "Inventory stock adjustments, inter-warehouse transfers, item management",
        },
        {
          sysKey: "sys_delivery_boy",
          role: UserRole.DELIVERY_BOY,
          name: "Delivery Boy",
          nameGujarati: "ડિલિવરી બોય",
          description: "View dispatch delivery challans and sales invoices for physical deliveries",
        },
        {
          sysKey: "sys_cashier",
          role: UserRole.CASHIER,
          name: "Cashier",
          nameGujarati: "કેશિયર",
          description: "Point of sale billing, fast sales invoices, cash & bank collection",
        },
        {
          sysKey: "sys_auditor",
          role: UserRole.AUDITOR,
          name: "Chartered Accountant (CA)",
          nameGujarati: "સી.એ. / ઓડિટર",
          description: "Statutory read-only access to financial statements, ledgers, GST returns and reports",
        },
      ];

      // 1. Get all roles stored in DB for this organization
      const allDbRoles = await tx.role.findMany({
        where: { organizationId: ctx.organizationId },
        include: {
          permissions: true,
          _count: { select: { users: true } },
        },
        orderBy: { name: "asc" },
      });

      const dbRolesBySystemRole = new Map<string, any>();
      const customDbRoles: any[] = [];
      for (const r of allDbRoles) {
        if (r.isSystem && r.systemRole) {
          dbRolesBySystemRole.set(String(r.systemRole), r);
        } else {
          customDbRoles.push(r);
        }
      }

      // 2. Count staff in standard roles
      const usersByRole = await tx.user.groupBy({
        by: ["role"],
        where: { organizationId: ctx.organizationId, customRoleId: null },
        _count: { id: true },
      });
      const roleCounts = new Map(usersByRole.map((u) => [u.role, u._count.id]));

      const countGranted = (perms: Record<string, Record<string, boolean>>) => {
        let count = 0;
        for (const mod of Object.values(perms)) {
          for (const allowed of Object.values(mod)) {
            if (allowed === true) count++;
          }
        }
        return count;
      };

      // 3. 8 Standard system roles
      const systemRoles = SYS_ROLE_CONFIGS.map((cfg) => {
        const dbOverride = dbRolesBySystemRole.get(cfg.role);
        let perms: Record<string, Record<string, boolean>>;
        let roleId = cfg.sysKey;

        if (dbOverride && dbOverride.permissions.length > 0) {
          roleId = dbOverride.id;
          perms = {};
          for (const p of dbOverride.permissions) {
            if (!perms[p.module]) perms[p.module] = {};
            perms[p.module][p.action] = p.allowed;
          }
        } else {
          perms = getDefaultRolePermissions(cfg.role);
        }

        return {
          id: roleId,
          sysKey: cfg.sysKey,
          name: cfg.name,
          nameGujarati: cfg.nameGujarati,
          description: cfg.description,
          systemRole: cfg.role,
          isSystem: true,
          isPredefined: true,
          isCustomized: Boolean(dbOverride),
          isActive: dbOverride ? (dbOverride.isActive ?? true) : true,
          status: dbOverride && dbOverride.isActive === false ? "Inactive" : "Active",
          dataScope: dbOverride ? (dbOverride.dataScope ?? DataScope.ALL_ORGANIZATION) : DataScope.ALL_ORGANIZATION,
          usersCount:
            (roleCounts.get(cfg.role) || 0) +
            (cfg.role === UserRole.COMPANY_ADMIN ? roleCounts.get(UserRole.ORG_ADMIN) || 0 : 0),
          userCount:
            (roleCounts.get(cfg.role) || 0) +
            (cfg.role === UserRole.COMPANY_ADMIN ? roleCounts.get(UserRole.ORG_ADMIN) || 0 : 0),
          permissions: perms,
          permissionsCount: countGranted(perms),
        };
      });

      // 4. Custom Roles
      const mappedCustom = customDbRoles.map((r) => {
        const perms: Record<string, Record<string, boolean>> = {};
        for (const p of r.permissions) {
          if (!perms[p.module]) perms[p.module] = {};
          perms[p.module][p.action] = p.allowed;
        }
        return {
          id: r.id,
          name: r.name,
          nameGujarati: r.name,
          description: r.description || "Custom configured staff role",
          isSystem: false,
          isPredefined: false,
          isCustomized: true,
          systemRole: r.systemRole,
          isActive: r.isActive ?? true,
          status: r.isActive === false ? "Inactive" : "Active",
          dataScope: r.dataScope ?? DataScope.ALL_ORGANIZATION,
          usersCount: r._count.users,
          userCount: r._count.users,
          permissions: perms,
          permissionsCount: countGranted(perms),
          createdAt: r.createdAt,
        };
      });

      return [...systemRoles, ...mappedCustom];
    });
  }

  /**
   * Get single role by ID
   */
  async getRole(ctx: TenantContext, roleId: string) {
    const roles = await this.listRoles(ctx);
    const role = roles.find((r: any) => r.id === roleId || r.sysKey === roleId);
    if (!role) throw new NotFoundException(`Role '${roleId}' not found.`);
    return role;
  }

  /**
   * Create a new custom role with granular permissions and data scope
   */
  async createRole(ctx: TenantContext, dto: CreateRoleDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const name = dto.name.trim();

      const existing = await tx.role.findFirst({
        where: { organizationId: ctx.organizationId, name },
      });
      if (existing) {
        throw new ConflictException(`Role with name '${name}' already exists in your organization.`);
      }

      // If cloning from an existing role, copy its base permissions
      let basePermissions: Array<{ module: string; action: string; allowed: boolean }> = [];
      if (Array.isArray(dto.permissions)) {
        basePermissions = dto.permissions;
      } else if (typeof dto.permissions === "object" && dto.permissions !== null) {
        for (const [mod, acts] of Object.entries(dto.permissions)) {
          if (typeof acts === "object" && acts !== null) {
            for (const [act, allowed] of Object.entries(acts as any)) {
              basePermissions.push({ module: mod, action: act, allowed: Boolean(allowed) });
            }
          }
        }
      }
      if (dto.cloneFromRoleId && basePermissions.length === 0) {
        if (dto.cloneFromRoleId.startsWith("sys_")) {
          const sysDefaults = getDefaultRolePermissions(dto.cloneFromRoleId);
          for (const [mod, acts] of Object.entries(sysDefaults)) {
            for (const [act, allowed] of Object.entries(acts)) {
              basePermissions.push({ module: mod, action: act, allowed });
            }
          }
        } else {
          const source = await tx.role.findFirst({
            where: { id: dto.cloneFromRoleId, organizationId: ctx.organizationId },
            include: { permissions: true },
          });
          if (source) {
            basePermissions = source.permissions.map((p) => ({
              module: p.module,
              action: p.action,
              allowed: p.allowed,
            }));
          }
        }
      }

      const role = await tx.role.create({
        data: {
          organizationId: ctx.organizationId,
          name,
          description: dto.description?.trim() || null,
          isSystem: false,
          systemRole: UserRole.CUSTOM,
          isActive: dto.isActive !== undefined ? dto.isActive : true,
          dataScope: dto.dataScope || DataScope.ALL_ORGANIZATION,
        },
      });

      if (basePermissions.length > 0) {
        for (const p of basePermissions) {
          await tx.rolePermission.create({
            data: {
              roleId: role.id,
              module: p.module,
              action: p.action,
              allowed: p.allowed,
            },
          });
        }
      }

      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || role.id,
        action: "ROLE_CREATE",
        entityName: "Role",
        entityId: role.id,
        newState: { name: role.name, permissionsCount: basePermissions.length },
      });

      return role;
    });
  }

  /**
   * Update a custom role or system role override and its permissions
   */
  async updateRole(ctx: TenantContext, roleId: string, dto: UpdateRoleDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      let role: any = null;

      const SYS_KEYS: Record<string, UserRole> = {
        sys_company_admin: UserRole.COMPANY_ADMIN,
        sys_partner: UserRole.PARTNER,
        sys_accountant: UserRole.ACCOUNTANT,
        sys_salesman: UserRole.SALESMAN,
        sys_stock_manager: UserRole.STOCK_MANAGER,
        sys_delivery_boy: UserRole.DELIVERY_BOY,
        sys_cashier: UserRole.CASHIER,
        sys_auditor: UserRole.AUDITOR,
      };

      if (roleId.startsWith("sys_")) {
        const sysRole = SYS_KEYS[roleId];
        if (!sysRole) throw new NotFoundException(`System role '${roleId}' not recognized.`);

        // Critical Lockout Protection: Owner / Admin cannot have master administrative privileges stripped
        if (sysRole === UserRole.COMPANY_ADMIN) {
          if (dto.isActive === false) {
            throw new BadRequestException("The Owner / Admin role cannot be deactivated.");
          }
        }

        role = await tx.role.findFirst({
          where: { organizationId: ctx.organizationId, systemRole: sysRole, isSystem: true },
        });

        if (!role) {
          role = await tx.role.create({
            data: {
              organizationId: ctx.organizationId,
              name: dto.name || roleId,
              description: dto.description || `Customized permissions for ${sysRole}`,
              isSystem: true,
              systemRole: sysRole,
              isActive: dto.isActive !== undefined ? dto.isActive : true,
              dataScope: dto.dataScope || DataScope.ALL_ORGANIZATION,
            },
          });
        }
      } else {
        role = await tx.role.findFirst({
          where: { id: roleId, organizationId: ctx.organizationId },
        });
        if (!role) throw new NotFoundException(`Role '${roleId}' not found.`);
      }

      const updateData: any = {};
      if (dto.name && !role.isSystem) updateData.name = dto.name.trim();
      if (dto.description !== undefined) updateData.description = dto.description?.trim() || null;
      if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
      if (dto.dataScope) updateData.dataScope = dto.dataScope;

      const updated = await tx.role.update({
        where: { id: role.id },
        data: updateData,
      });

      let permissionsList: Array<{ module: string; action: string; allowed: boolean }> = [];
      if (dto.permissions !== undefined) {
        await tx.rolePermission.deleteMany({
          where: { roleId: role.id },
        });

        if (Array.isArray(dto.permissions)) {
          permissionsList = dto.permissions;
        } else if (typeof dto.permissions === "object" && dto.permissions !== null) {
          for (const [mod, acts] of Object.entries(dto.permissions)) {
            if (typeof acts === "object" && acts !== null) {
              for (const [act, allowed] of Object.entries(acts as any)) {
                permissionsList.push({ module: mod, action: act, allowed: Boolean(allowed) });
              }
            }
          }
        }

        for (const p of permissionsList) {
          await tx.rolePermission.create({
            data: {
              roleId: role.id,
              module: p.module,
              action: p.action,
              allowed: p.allowed,
            },
          });
        }

        // Invalidate sessions for all users with this custom role or system role
        if (role.isSystem && role.systemRole) {
          await tx.user.updateMany({
            where: { organizationId: ctx.organizationId, role: role.systemRole },
            data: { sessionVersion: { increment: 1 } },
          });
        } else {
          await tx.user.updateMany({
            where: { customRoleId: role.id },
            data: { sessionVersion: { increment: 1 } },
          });
        }
      }

      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || role.id,
        action: "ROLE_UPDATE",
        entityName: "Role",
        entityId: role.id,
        newState: {
          roleName: role.name,
          permissionsCount: permissionsList.filter((p) => p.allowed).length,
          dataScope: role.dataScope,
          isActive: role.isActive,
        },
      });

      return updated;
    });
  }

  /**
   * Toggle role active / inactive status
   */
  async toggleRoleStatus(ctx: TenantContext, roleId: string, isActive: boolean) {
    if (roleId === "sys_company_admin") {
      throw new BadRequestException("Owner / Admin role cannot be deactivated.");
    }
    return this.updateRole(ctx, roleId, { isActive });
  }

  /**
   * Duplicate a role into a new custom role
   */
  async duplicateRole(ctx: TenantContext, roleId: string, newName: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const name = newName.trim();
      const existing = await tx.role.findFirst({
        where: { organizationId: ctx.organizationId, name },
      });
      if (existing) {
        throw new ConflictException(`Role with name '${name}' already exists.`);
      }

      const SYS_KEYS: Record<string, UserRole> = {
        sys_company_admin: UserRole.COMPANY_ADMIN,
        sys_partner: UserRole.PARTNER,
        sys_accountant: UserRole.ACCOUNTANT,
        sys_salesman: UserRole.SALESMAN,
        sys_stock_manager: UserRole.STOCK_MANAGER,
        sys_delivery_boy: UserRole.DELIVERY_BOY,
        sys_cashier: UserRole.CASHIER,
        sys_auditor: UserRole.AUDITOR,
      };

      let sourcePermissions: { module: string; action: string; allowed: boolean }[] = [];
      let sourceDesc = "Custom role";
      let sourceScope = DataScope.ALL_ORGANIZATION;

      if (roleId.startsWith("sys_")) {
        const sysRole = SYS_KEYS[roleId] || UserRole.SALESMAN;
        const defaults = getDefaultRolePermissions(sysRole);
        sourceDesc = `Customized copy of ${sysRole}`;
        for (const [mod, acts] of Object.entries(defaults)) {
          for (const [act, allowed] of Object.entries(acts)) {
            sourcePermissions.push({ module: mod, action: act, allowed });
          }
        }
      } else {
        const source = await tx.role.findFirst({
          where: { id: roleId, organizationId: ctx.organizationId },
          include: { permissions: true },
        });
        if (!source) throw new NotFoundException(`Role '${roleId}' not found.`);
        sourceDesc = `Copy of ${source.name}`;
        sourceScope = source.dataScope as any;
        sourcePermissions = source.permissions.map((p) => ({
          module: p.module,
          action: p.action,
          allowed: p.allowed,
        }));
      }

      const duplicate = await tx.role.create({
        data: {
          organizationId: ctx.organizationId,
          name,
          description: sourceDesc,
          isSystem: false,
          systemRole: UserRole.CUSTOM,
          isActive: true,
          dataScope: sourceScope,
        },
      });

      for (const p of sourcePermissions) {
        await tx.rolePermission.create({
          data: {
            roleId: duplicate.id,
            module: p.module,
            action: p.action,
            allowed: p.allowed,
          },
        });
      }

      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || duplicate.id,
        action: "ROLE_DUPLICATE",
        entityName: "Role",
        entityId: duplicate.id,
        newState: { sourceRoleId: roleId, newName: duplicate.name },
      });

      return duplicate;
    });
  }

  /**
   * Delete custom role if not currently assigned to active users
   */
  async deleteRole(ctx: TenantContext, roleId: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const SYS_KEYS: Record<string, UserRole> = {
        sys_company_admin: UserRole.COMPANY_ADMIN,
        sys_partner: UserRole.PARTNER,
        sys_accountant: UserRole.ACCOUNTANT,
        sys_salesman: UserRole.SALESMAN,
        sys_stock_manager: UserRole.STOCK_MANAGER,
        sys_delivery_boy: UserRole.DELIVERY_BOY,
        sys_cashier: UserRole.CASHIER,
        sys_auditor: UserRole.AUDITOR,
      };

      if (roleId.startsWith("sys_")) {
        const sysRole = SYS_KEYS[roleId];
        if (sysRole) {
          const orgRole = await tx.role.findFirst({
            where: { organizationId: ctx.organizationId, systemRole: sysRole, isSystem: true },
          });
          if (orgRole) {
            await tx.rolePermission.deleteMany({ where: { roleId: orgRole.id } });
            await tx.role.delete({ where: { id: orgRole.id } });
            await tx.user.updateMany({
              where: { organizationId: ctx.organizationId, role: sysRole },
              data: { sessionVersion: { increment: 1 } },
            });
          }
        }
        return { success: true, message: "System role reset to standard defaults." };
      }

      const role = await tx.role.findFirst({
        where: { id: roleId, organizationId: ctx.organizationId },
        include: { _count: { select: { users: true } } },
      });
      if (!role) throw new NotFoundException(`Role '${roleId}' not found.`);
      if (role._count.users > 0) {
        throw new BadRequestException(
          `Cannot delete role '${role.name}' because ${role._count.users} staff member(s) are assigned to it. Reassign them first.`,
        );
      }

      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.role.delete({ where: { id: roleId } });

      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || roleId,
        action: "ROLE_DELETE",
        entityName: "Role",
        entityId: roleId,
        previousState: { name: role.name },
      });

      return { success: true };
    });
  }

  /**
   * Get pre-built industry role templates
   */
  async getRoleTemplates() {
    return ROLE_TEMPLATES;
  }

  /**
   * Export roles as JSON or CSV
   */
  async exportRoles(ctx: TenantContext, format: string = "json") {
    const roles = await this.listRoles(ctx);
    if (format === "csv") {
      const headers = "Serial,Role Name,Description,Type,Menu Access,Assigned Staff,Status\n";
      const rows = roles
        .map(
          (r, idx) =>
            `${idx + 1},"${r.name}","${r.description || ""}","${r.isSystem ? "System" : "Custom"}",${r.permissionsCount || 0},${r.usersCount || 0},"${r.status || "Active"}"`,
        )
        .join("\n");
      return { format: "csv", data: headers + rows };
    }
    return { format: "json", data: roles };
  }

  // =========================================================================
  // 4. APPROVAL WORKFLOWS
  // =========================================================================

  /**
   * List pending approval requests for organization/company
   */
  async listApprovals(ctx: TenantContext, query?: { status?: ApprovalStatus }) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const requests = await tx.approvalRequest.findMany({
        where: {
          companyId: ctx.companyId,
          ...(query?.status ? { status: query.status } : {}),
        },
        select: {
          id: true,
          documentType: true,
          documentId: true,
          documentNumber: true,
          amount: true,
          reason: true,
          status: true,
          reviewedAt: true,
          comments: true,
          createdAt: true,
          requestedBy: {
            select: { fullName: true, role: true },
          },
          reviewedBy: {
            select: { fullName: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return requests.map((r) => ({
        id: r.id,
        documentType: r.documentType,
        documentId: r.documentId,
        documentNumber: r.documentNumber,
        amount: Number(r.amount),
        reason: r.reason,
        status: r.status,
        requestedBy: r.requestedBy.fullName,
        requestedByRole: r.requestedBy.role,
        reviewedBy: r.reviewedBy?.fullName,
        reviewedAt: r.reviewedAt,
        comments: r.comments,
        createdAt: r.createdAt,
      }));
    });
  }

  /**
   * Approve document request, finalize invoice and post double-entry vouchers
   */
  async approveRequest(ctx: TenantContext, requestId: string, comments?: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const req = await tx.approvalRequest.findFirst({
        where: { id: requestId, companyId: ctx.companyId },
      });
      if (!req) throw new NotFoundException(`Approval request '${requestId}' not found.`);

      if (req.status !== ApprovalStatus.PENDING) {
        throw new BadRequestException(`Request is already ${req.status}.`);
      }

      const updated = await tx.approvalRequest.update({
        where: { id: requestId },
        data: {
          status: ApprovalStatus.APPROVED,
          reviewedById: ctx.userId,
          reviewedAt: new Date(),
          comments: comments || "Approved by manager.",
        },
      });

      // If document is SalesInvoice, update its approval status to APPROVED
      if (req.documentType === "SALES_INVOICE") {
        await tx.salesInvoice.update({
          where: { id: req.documentId },
          data: {
            approvalStatus: ApprovalStatus.APPROVED,
          },
        });
      }

      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || "system",
        action: "APPROVAL_APPROVED",
        entityName: "ApprovalRequest",
        entityId: requestId,
        newState: { status: "APPROVED", comments },
      });

      return updated;
    });
  }

  /**
   * Reject document request
   */
  async rejectRequest(ctx: TenantContext, requestId: string, comments: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const req = await tx.approvalRequest.findFirst({
        where: { id: requestId, companyId: ctx.companyId },
      });
      if (!req) throw new NotFoundException(`Approval request '${requestId}' not found.`);

      if (req.status !== ApprovalStatus.PENDING) {
        throw new BadRequestException(`Request is already ${req.status}.`);
      }

      const updated = await tx.approvalRequest.update({
        where: { id: requestId },
        data: {
          status: ApprovalStatus.REJECTED,
          reviewedById: ctx.userId,
          reviewedAt: new Date(),
          comments: comments || "Rejected by manager.",
        },
      });

      if (req.documentType === "SALES_INVOICE") {
        await tx.salesInvoice.update({
          where: { id: req.documentId },
          data: {
            approvalStatus: ApprovalStatus.REJECTED,
            notes: `[REJECTED]: ${comments || "Rejected by manager."}`,
          },
        });
      }

      await this.audit.record({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        userId: ctx.userId || "system",
        action: "APPROVAL_REJECTED",
        entityName: "ApprovalRequest",
        entityId: requestId,
        newState: { status: "REJECTED", comments },
      });

      return updated;
    });
  }

  // =========================================================================
  // 5. ACTIVITY LOGS
  // =========================================================================

  /**
   * Get activity logs for the organization
   */
  async getActivities(
    ctx: TenantContext,
    query?: any,
    currentUser?: AuthenticatedUser,
  ) {
    const res = await this.audit.getActivities(ctx, query, currentUser);
    return res.items || [];
  }
}
