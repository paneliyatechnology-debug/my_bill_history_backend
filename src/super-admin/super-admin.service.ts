import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { JwtService } from "@nestjs/jwt";
import { SubscriptionTier, UserRole } from "@billing/shared-types";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { SupportSessionRegistry } from "./support-session.registry";

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
    private readonly jwtService: JwtService,
    private readonly sessionRegistry: SupportSessionRegistry,
  ) {}

  /**
   * System-wide statistics for the platform overview
   */
  async getStats() {
    return this.prisma.executeBypassRls(async (tx) => {
      const now = new Date();

      const [
        totalTenants,
        activeTenants,
        trialTenants,
        expiredTenants,
        totalOrgs,
        totalCompanies,
        totalBranches,
        totalWarehouses,
        totalUsers,
        activeUsers,
        totalInvoices,
        invoiceAggregate,
        tenantsByTier,
        usersByRole,
        recentAuditLogs,
      ] = await Promise.all([
        tx.tenant.count(),
        tx.tenant.count({ where: { isActive: true } }),
        tx.tenant.count({ where: { subscriptionTier: SubscriptionTier.TRIAL } }),
        tx.tenant.count({ where: { subscriptionEnds: { lt: now } } }),
        tx.organization.count(),
        tx.company.count(),
        tx.branch.count(),
        tx.warehouse.count(),
        tx.user.count(),
        tx.user.count({ where: { isActive: true } }),
        tx.salesInvoice.count(),
        tx.salesInvoice.aggregate({
          _sum: {
            grandTotal: true,
            taxableAmount: true,
            cgstAmount: true,
            sgstAmount: true,
            igstAmount: true,
          },
        }),
        tx.tenant.groupBy({
          by: ["subscriptionTier"],
          _count: { _all: true },
        }),
        tx.user.groupBy({
          by: ["role"],
          _count: { _all: true },
        }),
        tx.auditLog.count(),
      ]);

      const tierBreakdown: Record<string, number> = {
        TRIAL: 0,
        RETAIL_BASIC: 0,
        WHOLESALE_PRO: 0,
        DISTRIBUTION_ENTERPRISE: 0,
        MANUFACTURING_SUITE: 0,
      };

      for (const t of tenantsByTier) {
        tierBreakdown[t.subscriptionTier] = t._count._all;
      }

      const roleBreakdown: Record<string, number> = {};
      for (const r of usersByRole) {
        roleBreakdown[r.role] = r._count._all;
      }

      const totalGst = Number(
        (
          Number(invoiceAggregate._sum.cgstAmount || 0) +
          Number(invoiceAggregate._sum.sgstAmount || 0) +
          Number(invoiceAggregate._sum.igstAmount || 0)
        ).toFixed(2),
      );

      return {
        totalTenants,
        totalUsers,
        totalInvoices,
        systemStatus: "OPERATIONAL",
        tenants: {
          total: totalTenants,
          active: activeTenants,
          suspended: totalTenants - activeTenants,
          trial: trialTenants,
          expired: expiredTenants,
        },
        subscriptionTiers: tierBreakdown,
        infrastructure: {
          organizations: totalOrgs,
          companies: totalCompanies,
          branches: totalBranches,
          warehouses: totalWarehouses,
        },
        users: {
          total: totalUsers,
          active: activeUsers,
          byRole: roleBreakdown,
        },
        businessVolume: {
          totalInvoices,
          grossVolume: Number(invoiceAggregate._sum.grandTotal || 0),
          totalTaxableAmount: Number(invoiceAggregate._sum.taxableAmount || 0),
          totalGstAmount: totalGst,
        },
        systemHealth: {
          databaseStatus: "CONNECTED",
          rlsStatus: "ACTIVE",
          totalAuditEvents: recentAuditLogs,
          uptimeSeconds: process.uptime(),
          nodeVersion: process.version,
          timestamp: new Date().toISOString(),
        },
      };
    });
  }

  /**
   * List tenants with pagination and filtering
   */
  async getTenants(query: {
    search?: string;
    tier?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 50)));
    const skip = (page - 1) * limit;

    return this.prisma.executeBypassRls(async (tx) => {
      const where: any = {};

      if (query.tier) {
        where.subscriptionTier = query.tier as SubscriptionTier;
      }

      if (query.status === "active") {
        where.isActive = true;
      } else if (query.status === "inactive" || query.status === "suspended") {
        where.isActive = false;
      } else if (query.status === "expired") {
        where.subscriptionEnds = { lt: new Date() };
      }

      if (query.search) {
        const s = query.search.trim();
        where.OR = [
          { primaryPhone: { contains: s, mode: "insensitive" } },
          { primaryEmail: { contains: s, mode: "insensitive" } },
          {
            organizations: {
              some: {
                OR: [
                  { name: { contains: s, mode: "insensitive" } },
                  { legalName: { contains: s, mode: "insensitive" } },
                  {
                    companies: {
                      some: {
                        OR: [
                          { tradeName: { contains: s, mode: "insensitive" } },
                          { legalName: { contains: s, mode: "insensitive" } },
                          { gstin: { contains: s, mode: "insensitive" } },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        ];
      }

      const [total, tenants] = await Promise.all([
        tx.tenant.count({ where }),
        tx.tenant.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            organizations: {
              include: {
                companies: {
                  include: {
                    branches: true,
                    _count: {
                      select: { salesInvoices: true },
                    },
                  },
                },
                users: {
                  select: {
                    id: true,
                    fullName: true,
                    phone: true,
                    email: true,
                    role: true,
                    isActive: true,
                  },
                },
              },
            },
          },
        }),
      ]);

      return {
        data: tenants.map((t) => ({
          id: t.id,
          primaryPhone: t.primaryPhone,
          primaryEmail: t.primaryEmail,
          subscriptionTier: t.subscriptionTier,
          subscriptionEnds: t.subscriptionEnds,
          isActive: t.isActive,
          createdAt: t.createdAt,
          organizations: t.organizations.map((org) => ({
            id: org.id,
            name: org.name,
            legalName: org.legalName,
            userCount: org.users.length,
            users: org.users,
            companies: org.companies.map((c) => ({
              id: c.id,
              legalName: c.legalName,
              tradeName: c.tradeName,
              gstin: c.gstin,
              city: c.city,
              stateCode: c.stateCode,
              branchesCount: c.branches.length,
              invoicesCount: c._count.salesInvoices,
            })),
          })),
        })),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }

  /**
   * Get single tenant deep details
   */
  async getTenantById(tenantId: string) {
    return this.prisma.executeBypassRls(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        include: {
          organizations: {
            include: {
              companies: {
                include: {
                  branches: true,
                  warehouses: true,
                  financialYears: true,
                  _count: {
                    select: {
                      salesInvoices: true,
                      purchaseInvoices: true,
                      vouchers: true,
                      parties: true,
                    },
                  },
                },
              },
              users: {
                select: {
                  id: true,
                  fullName: true,
                  phone: true,
                  email: true,
                  role: true,
                  isActive: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      });

      if (!tenant) {
        throw new NotFoundException(`Tenant with ID '${tenantId}' not found.`);
      }

      return tenant;
    });
  }

  /**
   * Provision a new tenant directly from SuperAdmin Console
   */
  async createTenant(
    dto: {
      phone?: string;
      primaryPhone?: string;
      adminPhone?: string;
      email?: string;
      adminEmail?: string;
      fullName?: string;
      adminFullName?: string;
      password?: string;
      adminPassword?: string;
      organizationName?: string;
      tradeName?: string;
      subscriptionTier?: SubscriptionTier;
      tier?: SubscriptionTier;
      daysValid?: number;
      validityDays?: number;
      stateCode?: string;
    },
    superAdminUserId: string,
  ) {
    return this.prisma.executeBypassRls(async (tx) => {
      const cleanPhone = (dto.phone || dto.primaryPhone || dto.adminPhone || "").trim();
      if (!cleanPhone || cleanPhone.length < 10) {
        throw new BadRequestException("Valid 10-digit mobile phone number is required.");
      }

      const existingTenant = await tx.tenant.findFirst({
        where: { primaryPhone: cleanPhone },
      });
      if (existingTenant) {
        throw new BadRequestException(`Tenant with phone number '${cleanPhone}' already exists.`);
      }

      const existingUser = await tx.user.findFirst({
        where: { phone: cleanPhone },
      });
      if (existingUser) {
        throw new BadRequestException(`A user with phone '${cleanPhone}' already exists.`);
      }

      const tier = dto.subscriptionTier || dto.tier || SubscriptionTier.TRIAL;
      const days = Number(dto.daysValid || dto.validityDays || 30);
      const endsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      const tenant = await tx.tenant.create({
        data: {
          primaryPhone: cleanPhone,
          primaryEmail: dto.email?.trim() || dto.adminEmail?.trim() || null,
          subscriptionTier: tier,
          subscriptionEnds: endsAt,
          isActive: true,
        },
      });

      const orgName = (dto.organizationName || "Main Organization").trim();
      const org = await tx.organization.create({
        data: {
          tenantId: tenant.id,
          name: orgName,
          legalName: orgName,
        },
      });

      const stateCode = dto.stateCode || "24";
      const tradeName = (dto.tradeName || orgName).trim();
      const company = await tx.company.create({
        data: {
          organizationId: org.id,
          legalName: orgName,
          tradeName,
          stateCode,
          city: "Ahmedabad",
          addressLine1: "Commercial Market Center",
          pincode: "380001",
          phone: cleanPhone,
          email: dto.email?.trim() || dto.adminEmail?.trim() || null,
        },
      });

      const branch = await tx.branch.create({
        data: {
          organizationId: org.id,
          companyId: company.id,
          name: "Main Branch",
          code: "BR01",
          isMainBranch: true,
          city: "Ahmedabad",
          addressLine1: "Commercial Market Center",
          pincode: "380001",
          stateCode,
          phone: cleanPhone,
        },
      });

      const fy = await tx.financialYear.create({
        data: {
          companyId: company.id,
          name: "FY 2026-27",
          startDate: new Date("2026-04-01T00:00:00.000Z"),
          endDate: new Date("2027-03-31T23:59:59.999Z"),
          isCurrent: true,
          isLocked: false,
        },
      });

      const fullName = (dto.fullName || dto.adminFullName || "Organization Admin").trim();
      const pwd = dto.password || dto.adminPassword || "Password123#";
      const passwordHash = await bcrypt.hash(pwd, 10);

      const user = await tx.user.create({
        data: {
          organizationId: org.id,
          fullName,
          phone: cleanPhone,
          email: dto.email?.trim() || dto.adminEmail?.trim() || `${cleanPhone}@billing.local`,
          passwordHash,
          role: UserRole.COMPANY_ADMIN,
          preferredLang: "en",
        },
      });

      await tx.userBranchAssignment.create({
        data: {
          userId: user.id,
          branchId: branch.id,
          role: UserRole.COMPANY_ADMIN,
          isDefault: true,
        },
      });

      await this.audit.record({
        organizationId: org.id,
        companyId: company.id,
        userId: superAdminUserId,
        action: "SUPERADMIN_CREATE_TENANT",
        entityName: "Tenant",
        entityId: tenant.id,
        newState: {
          tenantId: tenant.id,
          phone: tenant.primaryPhone,
          tier: tenant.subscriptionTier,
          organizationName: org.name,
        },
      });

      return {
        id: tenant.id,
        tenant,
        organizationId: org.id,
        organization: org,
        companyId: company.id,
        company,
        branchId: branch.id,
        branch,
        financialYearId: fy.id,
        financialYear: fy,
        userId: user.id,
        user,
      };
    });
  }

  /**
   * Update tenant subscription or active status
   */
  async updateTenant(
    tenantId: string,
    dto: {
      subscriptionTier?: SubscriptionTier;
      tier?: SubscriptionTier;
      subscriptionEnds?: string;
      extendDays?: number;
      isActive?: boolean;
      status?: string;
    },
    superAdminUserId: string,
  ) {
    return this.prisma.executeBypassRls(async (tx) => {
      const existing = await tx.tenant.findUnique({
        where: { id: tenantId },
      });

      if (!existing) {
        throw new NotFoundException(`Tenant with ID '${tenantId}' not found.`);
      }

      const updateData: any = {};
      const tier = dto.subscriptionTier || dto.tier;
      if (tier) {
        updateData.subscriptionTier = tier;
      }
      if (dto.subscriptionEnds) {
        updateData.subscriptionEnds = new Date(dto.subscriptionEnds);
      } else if (dto.extendDays && Number(dto.extendDays) > 0) {
        const base = existing.subscriptionEnds && existing.subscriptionEnds > new Date()
          ? existing.subscriptionEnds
          : new Date();
        updateData.subscriptionEnds = new Date(base.getTime() + Number(dto.extendDays) * 86400000);
      }
      if (typeof dto.isActive === "boolean") {
        updateData.isActive = dto.isActive;
      } else if (dto.status === "active") {
        updateData.isActive = true;
      } else if (dto.status === "suspended" || dto.status === "inactive") {
        updateData.isActive = false;
      }

      const updated = await tx.tenant.update({
        where: { id: tenantId },
        data: updateData,
      });

      const firstOrg = await tx.organization.findFirst({
        where: { tenantId },
        include: { companies: true },
      });

      if (updated.isActive === false && firstOrg) {
        for (const comp of firstOrg.companies) {
          await this.sessionRegistry.revokeAllForCompany(comp.id);
        }
      }

      if (firstOrg && firstOrg.companies[0]) {
        await this.audit.record({
          organizationId: firstOrg.id,
          companyId: firstOrg.companies[0].id,
          userId: superAdminUserId,
          action: "SUPERADMIN_TENANT_UPDATE",
          entityName: "Tenant",
          entityId: tenantId,
          previousState: existing as any,
          newState: updated as any,
        });
      }

      return updated;
    });
  }

  /**
   * Get all users across platform with filtering
   */
  async getUsers(query: {
    search?: string;
    role?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 50)));
    const skip = (page - 1) * limit;

    return this.prisma.executeBypassRls(async (tx) => {
      const where: any = {};

      if (query.role) {
        where.role = query.role as UserRole;
      }

      if (query.status === "active") {
        where.isActive = true;
      } else if (query.status === "inactive") {
        where.isActive = false;
      }

      if (query.search) {
        const s = query.search.trim();
        where.OR = [
          { fullName: { contains: s, mode: "insensitive" } },
          { phone: { contains: s, mode: "insensitive" } },
          { email: { contains: s, mode: "insensitive" } },
          {
            organization: {
              name: { contains: s, mode: "insensitive" },
            },
          },
        ];
      }

      const [total, users] = await Promise.all([
        tx.user.count({ where }),
        tx.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            fullName: true,
            phone: true,
            email: true,
            role: true,
            preferredLang: true,
            isActive: true,
            createdAt: true,
            organization: {
              select: {
                id: true,
                name: true,
                tenantId: true,
              },
            },
          },
        }),
      ]);

      return {
        data: users,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }

  /**
   * Update user role, status or password with self-lockout guard
   */
  async updateUser(
    userId: string,
    dto: {
      role?: UserRole;
      isActive?: boolean;
      newPassword?: string;
    },
    superAdminUserId: string,
  ) {
    return this.prisma.executeBypassRls(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!existing) {
        throw new NotFoundException(`User with ID '${userId}' not found.`);
      }

      // Self-lockout prevention
      if (userId === superAdminUserId) {
        if (dto.isActive === false) {
          throw new BadRequestException("Self-lockout denied: You cannot deactivate your own SuperAdmin account.");
        }
        if (dto.role && dto.role !== UserRole.SUPER_ADMIN) {
          throw new BadRequestException("Self-lockout denied: You cannot demote your own SuperAdmin role.");
        }
      }

      // Last remaining active SuperAdmin protection
      if (
        existing.role === UserRole.SUPER_ADMIN &&
        (dto.isActive === false || (dto.role && dto.role !== UserRole.SUPER_ADMIN))
      ) {
        const activeSuperAdminCount = await tx.user.count({
          where: { role: UserRole.SUPER_ADMIN, isActive: true },
        });
        if (activeSuperAdminCount <= 1) {
          throw new BadRequestException(
            "Action denied: Cannot deactivate or demote the last remaining active platform SuperAdmin.",
          );
        }
      }

      const data: any = {};
      if (dto.role) data.role = dto.role;
      if (typeof dto.isActive === "boolean") data.isActive = dto.isActive;
      if (dto.newPassword) {
        if (dto.newPassword.length < 8) {
          throw new BadRequestException("Password must be at least 8 characters long.");
        }
        data.passwordHash = await bcrypt.hash(dto.newPassword, 10);
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data,
      });

      if (dto.isActive === false || dto.role || dto.newPassword) {
        await this.sessionRegistry.revokeAllForActor(userId);
      }

      const firstComp = await tx.company.findFirst({
        where: { organizationId: existing.organizationId },
      });

      if (firstComp) {
        await this.audit.record({
          organizationId: existing.organizationId,
          companyId: firstComp.id,
          userId: superAdminUserId,
          action: "SUPERADMIN_USER_UPDATE",
          entityName: "User",
          entityId: userId,
          previousState: { role: existing.role, isActive: existing.isActive },
          newState: { role: updated.role, isActive: updated.isActive },
        });
      }

      return {
        id: updated.id,
        fullName: updated.fullName,
        email: updated.email,
        phone: updated.phone,
        role: updated.role,
        isActive: updated.isActive,
      };
    });
  }

  /**
   * Get platform-wide audit logs
   */
  async getAuditLogs(query: { limit?: number; action?: string }) {
    const limit = Math.min(100, Math.max(1, Number(query.limit || 50)));

    return this.prisma.executeBypassRls(async (tx) => {
      const where: any = {};
      if (query.action) {
        where.action = query.action;
      }

      return tx.auditLog.findMany({
        where,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              role: true,
            },
          },
          company: {
            select: {
              id: true,
              tradeName: true,
              legalName: true,
            },
          },
        },
      });
    });
  }

  /**
   * Centralized Invoices Explorer (read-only cross-tenant visibility)
   */
  async getInvoices(query: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 50)));
    const skip = (page - 1) * limit;

    return this.prisma.executeBypassRls(async (tx) => {
      const where: any = {};

      if (query.status) {
        where.status = query.status;
      }

      if (query.search) {
        const s = query.search.trim();
        where.OR = [
          { invoiceNumber: { contains: s, mode: "insensitive" } },
          {
            party: {
              name: { contains: s, mode: "insensitive" },
            },
          },
          {
            company: {
              tradeName: { contains: s, mode: "insensitive" },
            },
          },
        ];
      }

      const [total, invoices] = await Promise.all([
        tx.salesInvoice.count({ where }),
        tx.salesInvoice.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            grandTotal: true,
            balanceAmount: true,
            status: true,
            party: {
              select: {
                id: true,
                name: true,
                phone: true,
                gstin: true,
              },
            },
            company: {
              select: {
                id: true,
                tradeName: true,
                legalName: true,
              },
            },
          },
        }),
      ]);

      return {
        data: invoices,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }

  /**
   * Impersonate / Support Session initiation with server-side validation & audit log
   */
  async impersonateCompany(
    companyId: string,
    reason: string | undefined,
    superAdminUserId: string,
  ) {
    return this.prisma.executeBypassRls(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
        include: {
          organization: {
            include: { tenant: true },
          },
          branches: { orderBy: { isMainBranch: "desc" } },
          financialYears: {
            where: { isCurrent: true },
          },
        },
      });

      if (!company) {
        throw new NotFoundException(`Target company with ID '${companyId}' not found.`);
      }

      if (!company.organization?.tenant?.isActive) {
        throw new ForbiddenException("Cannot enter support session: Target tenant is currently suspended.");
      }

      const branch = company.branches[0] || null;
      const fy = company.financialYears[0] || null;

      // Generate unique support session ID
      const sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      await this.sessionRegistry.createSession({
        id: sessionId,
        actorId: superAdminUserId,
        targetOrganizationId: company.organizationId,
        targetCompanyId: company.id,
        expiresAt,
        reason: reason || "Customer technical support / troubleshooting",
      });

      // Issue short-lived support token (1 hour)
      const supportPayload = {
        sub: superAdminUserId,
        userId: superAdminUserId,
        organizationId: company.organizationId,
        role: UserRole.SUPER_ADMIN,
        isSupportSession: true,
        sessionId,
        impersonatedCompanyId: company.id,
        impersonatedCompanyName: company.tradeName,
      };

      const supportToken = await this.jwtService.signAsync(supportPayload, {
        expiresIn: "3600s",
      });

      await this.audit.record({
        organizationId: company.organizationId,
        companyId: company.id,
        userId: superAdminUserId,
        action: "SUPERADMIN_SUPPORT_SESSION_ENTER",
        entityName: "Company",
        entityId: company.id,
        newState: {
          sessionId,
          actorUserId: superAdminUserId,
          targetCompanyId: company.id,
          targetCompanyName: company.tradeName,
          reason: reason || "Customer technical support / troubleshooting",
          timestamp: new Date().toISOString(),
        },
      });

      return {
        supportToken,
        sessionId,
        targetContext: {
          organizationId: company.organizationId,
          organizationName: company.organization.name,
          companyId: company.id,
          companyName: company.tradeName,
          branchId: branch?.id,
          branchName: branch?.name,
          financialYearId: fy?.id,
          financialYear: fy?.name,
        },
      };
    });
  }

  /**
   * Log support session exit and safely terminate session server-side
   */
  async exitImpersonation(
    companyId: string,
    superAdminUserId: string,
    sessionId?: string,
  ) {
    if (sessionId) {
      await this.sessionRegistry.revokeSession(sessionId);
    }
    await this.sessionRegistry.revokeAllForCompany(companyId, superAdminUserId);

    return this.prisma.executeBypassRls(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
      });

      if (company) {
        await this.audit.record({
          organizationId: company.organizationId,
          companyId: company.id,
          userId: superAdminUserId,
          action: "SUPERADMIN_SUPPORT_SESSION_EXIT",
          entityName: "Company",
          entityId: company.id,
          newState: {
            sessionId: sessionId || "ALL",
            actorUserId: superAdminUserId,
            targetCompanyId: company.id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      return { success: true };
    });
  }

  /**
   * Deep system diagnostics
   */
  async getDiagnostics() {
    return this.prisma.executeBypassRls(async (tx) => {
      const pingStart = Date.now();
      await tx.$queryRaw`SELECT 1 as ping`;
      const dbLatencyMs = Date.now() - pingStart;

      const memUsage = process.memoryUsage();

      return {
        database: {
          status: "HEALTHY",
          latencyMs: dbLatencyMs,
          engine: "PostgreSQL 16",
          rlsEnforced: true,
        },
        system: {
          uptimeSeconds: process.uptime(),
          nodeVersion: process.version,
          memoryHeapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
          memoryRssMb: Math.round(memUsage.rss / 1024 / 1024),
          environment: process.env.NODE_ENV || "development",
          timestamp: new Date().toISOString(),
        },
      };
    });
  }
}
