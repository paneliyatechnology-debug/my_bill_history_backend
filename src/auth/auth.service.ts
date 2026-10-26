import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import {
  UserRole,
  SubscriptionTier,
  GstRegistrationType,
} from "@billing/shared-types";
import {
  STANDARD_SME_GROUPS,
  STANDARD_SME_ACCOUNTS,
} from "@billing/accounting-core";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { SupportSessionRegistry } from "../super-admin/support-session.registry";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { SwitchContextDto } from "./dto/switch-context.dto";
import { EmailOtpService } from "./email-otp.service";
import { isDeliverableEmail, normalizeEmail } from "../mail/email.util";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly audit: AuditService,
    private readonly sessionRegistry: SupportSessionRegistry,
    private readonly emailOtp: EmailOtpService,
  ) {}

  /**
   * Atomic registration creating Tenant, Organization, Company, Main Branch, FY and Owner User
   */
  async register(dto: RegisterDto) {
    const email = dto.email ? normalizeEmail(dto.email) : "";
    if (this.emailOtp.requiresVerification() && !isDeliverableEmail(email)) {
      throw new BadRequestException({
        statusCode: 400,
        message: "A real email address is required. We send a verification code before creating the account.",
        messageGujarati:
          "ખરો ઈમેલ જરૂરી છે. ખાતું બનતા પહેલા ઈમેલ પર ચકાસણી કોડ મોકલાય છે.",
      });
    }

    // 1. Check existing phone or email collision
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phone: dto.phone },
          email
            ? { email: { equals: email, mode: "insensitive" } }
            : { phone: dto.phone },
        ],
      },
    });

    if (existing) {
      throw new ConflictException({
        statusCode: 409,
        message: "A user with this phone number or email already exists.",
        messageGujarati:
          "આ ફોન નંબર અથવા ઈમેલ ધરાવતો વપરાશકર્તા પહેલેથી જ હાજર છે.",
      });
    }

    if (this.emailOtp.requiresVerification()) {
      await this.emailOtp.consume(email, "REGISTER", dto.otp || "");
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);
    const stateCode = dto.stateCode || "24"; // Default Gujarat

    // 2. Atomic creation inside bypass transaction
    const result = await this.prisma.executeBypassRls(async (tx) => {
      // 2a. Create Tenant
      const tenant = await tx.tenant.create({
        data: {
          primaryPhone: dto.phone,
          primaryEmail: email || null,
          subscriptionTier: SubscriptionTier.TRIAL,
          subscriptionEnds: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30-day trial
        },
      });

      // 2b. Create Organization
      const organization = await tx.organization.create({
        data: {
          tenantId: tenant.id,
          name: dto.organizationName,
          legalName: dto.companyLegalName || dto.organizationName,
        },
      });

      // 2c. Create Primary Legal Company
      const company = await tx.company.create({
        data: {
          organizationId: organization.id,
          legalName: dto.companyLegalName || dto.organizationName,
          tradeName: dto.tradeName || dto.organizationName,
          gstin: dto.gstin || null,
          stateCode,
          gstType: dto.gstin
            ? GstRegistrationType.REGULAR
            : GstRegistrationType.UNREGISTERED,
          addressLine1: "Main Market Office",
          city: "Ahmedabad",
          pincode: "380001",
          phone: dto.phone,
          email: email || null,
        },
      });

      // 2d. Create Main Branch
      const branch = await tx.branch.create({
        data: {
          organizationId: organization.id,
          companyId: company.id,
          name: "Main Branch",
          code: "BR01",
          isMainBranch: true,
          addressLine1: "Main Market Office",
          city: "Ahmedabad",
          pincode: "380001",
          stateCode,
          phone: dto.phone,
        },
      });

      // 2e. Create Default Financial Year (FY 2026-27)
      const financialYear = await tx.financialYear.create({
        data: {
          companyId: company.id,
          name: "FY 2026-27",
          startDate: new Date("2026-04-01T00:00:00.000Z"),
          endDate: new Date("2027-03-31T23:59:59.999Z"),
          isCurrent: true,
          isLocked: false,
        },
      });

      // 2f. Create Owner User as COMPANY_ADMIN
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          fullName: dto.fullName,
          phone: dto.phone,
          email: email || `${dto.phone}@billing.local`,
          passwordHash,
          role: UserRole.COMPANY_ADMIN,
          preferredLang: dto.preferredLang || "en",
        },
      });

      // 2g. Assign to Main Branch
      await tx.userBranchAssignment.create({
        data: {
          userId: user.id,
          branchId: branch.id,
          role: UserRole.COMPANY_ADMIN,
          isDefault: true,
        },
      });

      return { tenant, organization, company, branch, financialYear, user };
    });

    // 3. Record Audit Log
    await this.audit.record({
      organizationId: result.organization.id,
      companyId: result.company.id,
      userId: result.user.id,
      action: "AUTH_REGISTER",
      entityName: "User",
      entityId: result.user.id,
      newState: {
        userId: result.user.id,
        phone: result.user.phone,
        role: result.user.role,
        organizationId: result.organization.id,
        companyId: result.company.id,
      },
    });

    // 4. Issue JWT
    const tokenPayload = {
      sub: result.user.id,
      userId: result.user.id,
      organizationId: result.organization.id,
      email: result.user.email,
      phone: result.user.phone,
      role: result.user.role,
      preferredLang: result.user.preferredLang,
    };

    const accessToken = await this.jwtService.signAsync(tokenPayload);

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: 86400,
      user: {
        id: result.user.id,
        fullName: result.user.fullName,
        email: result.user.email,
        phone: result.user.phone,
        role: result.user.role,
        preferredLang: result.user.preferredLang,
      },
      defaultContext: {
        organizationId: result.organization.id,
        organizationName: result.organization.name,
        companyId: result.company.id,
        companyName: result.company.tradeName,
        branchId: result.branch.id,
        branchName: result.branch.name,
        financialYearId: result.financialYear.id,
        financialYear: result.financialYear.name,
      },
    };
  }

  /**
   * User login validating credentials and issuing verified tenant context
   */
  async login(dto: LoginDto, clientIp?: string, userAgent?: string) {
    const id = String(dto.identifier || (dto as any).phone || (dto as any).email || "").trim();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phone: id },
          { email: { equals: id, mode: "insensitive" } },
        ],
      },
      include: {
        organization: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: "Invalid phone/email or password credentials.",
        messageGujarati: "ખોટો ફોન નંબર/ઈમેલ અથવા પાસવર્ડ.",
      });
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: "Invalid phone/email or password credentials.",
        messageGujarati: "ખોટો ફોન નંબર/ઈમેલ અથવા પાસવર્ડ.",
      });
    }

    // Resolve default company for this user
    const company = await this.prisma.company.findFirst({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "asc" },
    });

    if (!company) {
      throw new NotFoundException(
        "No active company found for user organization.",
      );
    }

    // Resolve branch: if branchCode provided, verify access; otherwise use assigned/main branch
    let branchId = "";
    let branchName = "";

    if (dto.branchCode) {
      const branch = await this.prisma.branch.findFirst({
        where: { companyId: company.id, code: dto.branchCode },
      });
      if (!branch) {
        throw new NotFoundException(
          `Branch with code '${dto.branchCode}' not found.`,
        );
      }

      // Check assignment if user is branch-constrained
      if (
        [UserRole.CASHIER, UserRole.BRANCH_MANAGER, UserRole.SALESMAN].includes(
          user.role as UserRole,
        )
      ) {
        const assignment = await this.prisma.userBranchAssignment.findUnique({
          where: { userId_branchId: { userId: user.id, branchId: branch.id } },
        });
        if (!assignment) {
          throw new ForbiddenException(
            `User is not assigned to branch '${dto.branchCode}'.`,
          );
        }
      }
      branchId = branch.id;
      branchName = branch.name;
    } else {
      const assignment = await this.prisma.userBranchAssignment.findFirst({
        where: { userId: user.id, isDefault: true },
        include: { branch: true },
      });
      if (assignment) {
        branchId = assignment.branch.id;
        branchName = assignment.branch.name;
      } else {
        const mainBranch = await this.prisma.branch.findFirst({
          where: { companyId: company.id, isMainBranch: true },
        });
        branchId = mainBranch?.id || "";
        branchName = mainBranch?.name || "";
      }
    }

    // Active financial year
    const fy = await this.prisma.financialYear.findFirst({
      where: { companyId: company.id, isCurrent: true },
    });

    // Record login audit log
    await this.audit.record({
      organizationId: user.organizationId,
      companyId: company.id,
      userId: user.id,
      action: "AUTH_LOGIN",
      entityName: "User",
      entityId: user.id,
      newState: {
        userId: user.id,
        role: user.role,
        branchId,
      },
      ipAddress: clientIp,
      userAgent,
    });

    // Generate JWT
    const tokenPayload = {
      sub: user.id,
      userId: user.id,
      organizationId: user.organizationId,
      email: user.email,
      phone: user.phone,
      role: user.role,
      preferredLang: user.preferredLang,
    };

    const accessToken = await this.jwtService.signAsync(tokenPayload);

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: 86400,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        preferredLang: user.preferredLang,
      },
      defaultContext: {
        organizationId: user.organizationId,
        organizationName: user.organization.name,
        companyId: company.id,
        companyName: company.tradeName,
        branchId,
        branchName,
        financialYearId: fy?.id,
        financialYear: fy?.name,
      },
    };
  }

  /**
   * Returns current user identity, organization and accessible companies/branches
   */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        organization: true,
        branchAssignments: {
          include: { branch: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException("User profile not found.");
    }

    const companies = await this.prisma.company.findMany({
      where: { organizationId: user.organizationId },
      select: {
        id: true,
        legalName: true,
        tradeName: true,
        gstin: true,
        stateCode: true,
        branches: {
          select: { id: true, name: true, code: true, isMainBranch: true },
        },
        financialYears: {
          select: { id: true, name: true, isCurrent: true, isLocked: true },
        },
      },
    });

    return {
      role: user.role,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        preferredLang: user.preferredLang,
        organization: {
          id: user.organization.id,
          name: user.organization.name,
        },
      },
      companies,
      assignedBranches: user.branchAssignments.map((a) => ({
        branchId: a.branch.id,
        branchName: a.branch.name,
        branchCode: a.branch.code,
        role: a.role,
        isDefault: a.isDefault,
      })),
    };
  }

  /**
   * Validate and switch active context
   */
  async switchContext(userId: string, dto: SwitchContextDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found.");
    }

    if (!user.isActive) {
      throw new ForbiddenException("User account is deactivated.");
    }

    // Verify company belongs to user's org
    const company = await this.prisma.company.findFirst({
      where: { id: dto.companyId, organizationId: user.organizationId },
    });
    if (!company) {
      throw new ForbiddenException(
        "Requested company does not belong to your organization.",
      );
    }

    // If branch provided, verify access
    let branch: any = null;
    if (dto.branchId) {
      branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, companyId: company.id },
      });
      if (!branch) {
        throw new NotFoundException("Branch not found in selected company.");
      }

      if (
        [UserRole.CASHIER, UserRole.BRANCH_MANAGER, UserRole.SALESMAN].includes(
          user.role as UserRole,
        )
      ) {
        const assignment = await this.prisma.userBranchAssignment.findUnique({
          where: {
            userId_branchId: { userId: user.id, branchId: dto.branchId },
          },
        });
        if (!assignment) {
          throw new ForbiddenException(
            "User is not authorized for this branch.",
          );
        }
      }
    } else {
      // If user has branch-constrained role, find their assigned branch in this company
      if (
        [UserRole.CASHIER, UserRole.BRANCH_MANAGER, UserRole.SALESMAN].includes(
          user.role as UserRole,
        )
      ) {
        const assignment = await this.prisma.userBranchAssignment.findFirst({
          where: {
            userId: user.id,
            branch: { companyId: company.id },
          },
          include: { branch: true },
        });
        if (!assignment) {
          throw new ForbiddenException(
            "User has no assigned branch in this company.",
          );
        }
        branch = assignment.branch;
      } else {
        // Resolve default main branch for company
        branch = await this.prisma.branch.findFirst({
          where: { companyId: company.id },
          orderBy: [{ isMainBranch: "desc" }, { createdAt: "asc" }],
        });
      }
    }

    const fy = await this.prisma.financialYear.findFirst({
      where: { companyId: company.id, isCurrent: true },
    });

    // Record audit log for security compliance
    await this.audit.record({
      organizationId: user.organizationId,
      companyId: company.id,
      userId: user.id,
      action: "AUTH_SWITCH_CONTEXT",
      entityName: "Company",
      entityId: company.id,
      newState: {
        companyId: company.id,
        tradeName: company.tradeName,
        branchId: branch?.id || null,
        branchName: branch?.name || null,
        financialYearId: fy?.id || null,
      },
    });

    return {
      success: true,
      activeContext: {
        organizationId: user.organizationId,
        companyId: company.id,
        companyName: company.tradeName,
        legalName: company.legalName,
        gstin: company.gstin,
        stateCode: company.stateCode,
        branchId: branch?.id || null,
        branchName: branch?.name || null,
        branchCode: branch?.code || null,
        financialYearId: fy?.id || null,
        financialYear: fy?.name || null,
      },
    };
  }

  /**
   * Secure logout: revokes all active support sessions for the user
   */
  async logout(userId: string) {
    if (userId) {
      await this.sessionRegistry.revokeAllForActor(userId);
    }
    return {
      success: true,
      message: "Logged out successfully. All active support sessions revoked.",
    };
  }

  async sendPublicOtp(input: {
    email: string;
    purpose: "REGISTER" | "PASSWORD_RESET";
    phone?: string;
  }) {
    return this.emailOtp.send(input);
  }

  async sendEmailChangeOtp(email: string) {
    return this.emailOtp.send({ email, purpose: "EMAIL_CHANGE" });
  }

  async resetPassword(input: { email: string; otp: string; newPassword: string }) {
    const password = String(input.newPassword || "");
    if (password.length < 6 || password.length > 72) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Password must be between 6 and 72 characters.",
        messageGujarati: "પાસવર્ડ 6 થી 72 અક્ષરનો હોવો જોઈએ.",
      });
    }

    const email = normalizeEmail(input.email);
    await this.emailOtp.consume(email, "PASSWORD_RESET", input.otp);
    const user = await this.emailOtp.findActiveUserByEmail(email);
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    const company = await this.prisma.company.findFirst({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (company) {
      await this.audit.record({
        organizationId: user.organizationId,
        companyId: company.id,
        userId: user.id,
        action: "AUTH_PASSWORD_RESET",
        entityName: "User",
        entityId: user.id,
        newState: { email },
      });
    }

    return {
      success: true,
      message: "Password updated. Sign in with the new password.",
      messageGujarati: "પાસવર્ડ અપડેટ થયો. નવા પાસવર્ડથી પ્રવેશ કરો.",
    };
  }

  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
  ) {
    const next = String(input.newPassword || "");
    if (next.length < 6 || next.length > 72) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Password must be between 6 and 72 characters.",
        messageGujarati: "પાસવર્ડ 6 થી 72 અક્ષરનો હોવો જોઈએ.",
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new NotFoundException("User profile not found.");
    }
    const matches = await bcrypt.compare(String(input.currentPassword || ""), user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: "Current password is incorrect.",
        messageGujarati: "હાલનો પાસવર્ડ ખોટો છે.",
      });
    }
    const passwordHash = await bcrypt.hash(next, 10);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    return { success: true, message: "Password changed." };
  }

  async updateProfile(
    userId: string,
    input: { fullName?: string; email?: string; otp?: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new NotFoundException("User profile not found.");
    }

    const fullName = String(input.fullName || "").trim();
    const nextEmail = input.email ? normalizeEmail(input.email) : "";
    const emailChanged = Boolean(nextEmail) && nextEmail !== normalizeEmail(user.email);

    if (fullName && (fullName.length < 2 || fullName.length > 150)) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Enter a full name between 2 and 150 characters.",
        messageGujarati: "પૂરું નામ 2 થી 150 અક્ષરનું હોવું જોઈએ.",
      });
    }
    if (emailChanged && !isDeliverableEmail(nextEmail)) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Enter a real email address.",
        messageGujarati: "ખરો ઈમેલ સરનામું દાખલ કરો.",
      });
    }
    if (emailChanged) {
      const taken = await this.prisma.user.findFirst({
        where: {
          id: { not: user.id },
          email: { equals: nextEmail, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictException({
          statusCode: 409,
          message: "This email is already used by another account.",
          messageGujarati: "આ ઈમેલ બીજા ખાતા સાથે પહેલેથી જોડાયેલો છે.",
        });
      }
    }
    if (emailChanged && this.emailOtp.requiresVerification()) {
      await this.emailOtp.consume(nextEmail, "EMAIL_CHANGE", input.otp || "");
    }

    const updated = await this.prisma.executeBypassRls(async (tx) => {
      const saved = await tx.user.update({
        where: { id: user.id },
        data: {
          ...(fullName ? { fullName } : {}),
          ...(emailChanged ? { email: nextEmail } : {}),
        },
      });
      if (emailChanged) {
        await tx.company.updateMany({
          where: { organizationId: user.organizationId, email: user.email },
          data: { email: nextEmail },
        });
        const organization = await tx.organization.findUnique({
          where: { id: user.organizationId },
          select: { tenantId: true },
        });
        if (organization) {
          await tx.tenant.updateMany({
            where: {
              id: organization.tenantId,
              OR: [{ primaryEmail: user.email }, { primaryEmail: null }],
            },
            data: { primaryEmail: nextEmail },
          });
        }
      }
      return saved;
    });

    return {
      success: true,
      user: {
        id: updated.id,
        fullName: updated.fullName,
        name: updated.fullName,
        email: updated.email,
        phone: updated.phone,
        role: updated.role,
        preferredLang: updated.preferredLang,
      },
    };
  }
}
