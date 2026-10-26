import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { LedgersService } from "../ledgers/ledgers.service";
import {
  TenantContext,
  UserRole,
  SubscriptionTier,
  getPlanEntitlements,
  canCreateCompany,
} from "@billing/shared-types";
import { CreateCompanyDto } from "./dto/create-company.dto";
import {
  STANDARD_SME_GROUPS,
  STANDARD_SME_ACCOUNTS,
} from "@billing/accounting-core";

export interface CreateBranchDto {
  name: string;
  code: string;
  addressLine1: string;
  city: string;
  pincode: string;
  stateCode: string;
  phone: string;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
    private readonly ledgersService: LedgersService,
  ) {}

  async getCompanies(ctx: TenantContext) {
    return this.prisma.company.findMany({
      where: { organizationId: ctx.organizationId },
      select: {
        id: true,
        legalName: true,
        tradeName: true,
        gstin: true,
        stateCode: true,
        city: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async getCompaniesWithEntitlements(ctx: TenantContext) {
    const [companies, org] = await Promise.all([
      this.prisma.company.findMany({
        where: { organizationId: ctx.organizationId },
        select: {
          id: true,
          legalName: true,
          tradeName: true,
          gstin: true,
          pan: true,
          stateCode: true,
          city: true,
          phone: true,
          email: true,
          bankName: true,
          bankAccountNo: true,
          bankIfsc: true,
          bankBranch: true,
          upiVpa: true,
          bankAccountBarcode: true,
          signatoryName: true,
          signatoryDesignation: true,
          signatureUrl: true,
          createdAt: true,
          _count: {
            select: { branches: true },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.organization.findUnique({
        where: { id: ctx.organizationId },
        include: { tenant: true },
      }),
    ]);

    const tier = org?.tenant?.subscriptionTier || SubscriptionTier.TRIAL;
    const plan = getPlanEntitlements(tier);

    return {
      companies: companies.map((c) => ({
        id: c.id,
        legalName: c.legalName,
        tradeName: c.tradeName,
        gstin: c.gstin,
        pan: c.pan,
        stateCode: c.stateCode,
        city: c.city,
        phone: c.phone,
        email: c.email,
        bankName: c.bankName,
        bankAccountNo: c.bankAccountNo,
        bankIfsc: c.bankIfsc,
        bankBranch: c.bankBranch,
        upiVpa: c.upiVpa,
        bankAccountBarcode: c.bankAccountBarcode,
        signatoryName: c.signatoryName,
        signatoryDesignation: c.signatoryDesignation,
        signatureUrl: c.signatureUrl,
        branchesCount: c._count.branches,
        isCurrent: c.id === ctx.companyId,
        createdAt: c.createdAt,
      })),
      entitlements: {
        tier,
        name: plan.name,
        nameGujarati: plan.nameGujarati,
        maxCompanies: plan.maxCompanies,
        currentCount: companies.length,
        canAddCompany: companies.length < plan.maxCompanies,
        maxBranchesPerCompany: plan.maxBranchesPerCompany,
        maxUsers: plan.maxUsers,
        subscriptionEnds: org?.tenant?.subscriptionEnds,
        isActive: org?.tenant?.isActive ?? true,
        features: plan.features,
      },
    };
  }

  /**
   * Safe, plan-entitlement verified company creation.
   * Creates Company, Default Branch (BR01), Financial Year (FY 2026-27),
   * seeds standard Chart of Accounts and assigns creating user.
   */
  async createCompany(
    ctx: TenantContext,
    dto: CreateCompanyDto,
    userId: string,
  ) {
    if (!dto.legalName || !dto.legalName.trim()) {
      throw new BadRequestException("Company legal name is required.");
    }

    return await this.prisma.executeBypassRls(async (tx) => {
      // 1. Fetch organization & tenant with authoritative plan check
      const org = await tx.organization.findUnique({
        where: { id: ctx.organizationId },
        include: { tenant: true },
      });

      if (!org) {
        throw new NotFoundException("Organization not found.");
      }

      if (!org.tenant.isActive) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "TENANT_INACTIVE",
          message: "Organization account is suspended or inactive.",
          messageGujarati:
            "સંસ્થાનું એકાઉન્ટ સ્થગિત અથવા નિષ્ક્રિય કરવામાં આવ્યું છે.",
        });
      }

      // 2. Authoritative Plan Entitlement Check (Race-condition safe in transaction)
      const currentCount = await tx.company.count({
        where: { organizationId: ctx.organizationId },
      });

      const plan = getPlanEntitlements(org.tenant.subscriptionTier);
      if (currentCount >= plan.maxCompanies) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "PLAN_LIMIT_REACHED",
          message: `Company limit reached (${currentCount}/${plan.maxCompanies}) for ${plan.name}. Please upgrade your subscription plan to create additional companies.`,
          messageGujarati: `તમારા ${plan.nameGujarati} પ્લાન હેઠળ કંપની મર્યાદા (${currentCount}/${plan.maxCompanies}) પૂર્ણ થઈ ગઈ છે. વધુ કંપની ઉમેરવા માટે પ્લાન અપગ્રેડ કરો.`,
        });
      }

      // 3. GSTIN Validation & Uniqueness within Organization
      const cleanGstin = dto.gstin?.trim().toUpperCase();
      if (cleanGstin) {
        const gstinRegex =
          /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
        if (!gstinRegex.test(cleanGstin)) {
          throw new BadRequestException({
            statusCode: 400,
            error: "INVALID_GSTIN",
            message:
              "Invalid 15-character Indian GSTIN format (e.g. 24ABCDE1234F1Z5).",
            messageGujarati: "અમાન્ય 15-અક્ષરનો જીએસટી નંબર ફોર્મેટ.",
          });
        }

        const duplicateGstin = await tx.company.findFirst({
          where: { organizationId: ctx.organizationId, gstin: cleanGstin },
        });
        if (duplicateGstin) {
          throw new BadRequestException({
            statusCode: 400,
            error: "DUPLICATE_GSTIN",
            message: `A company with GSTIN '${cleanGstin}' already exists in your organization.`,
            messageGujarati:
              "આ જીએસટી નંબર સાથે કંપની તમારી સંસ્થામાં પહેલેથી જ અસ્તિત્વમાં છે.",
          });
        }
      }

      // Derive State Code & PAN
      const stateCode =
        dto.stateCode?.trim() ||
        (cleanGstin ? cleanGstin.substring(0, 2) : "24");
      const pan =
        dto.pan?.trim().toUpperCase() ||
        (cleanGstin ? cleanGstin.substring(2, 12) : null);
      const legalName = dto.legalName.trim();
      const tradeName = (dto.tradeName || legalName).trim();

      // 4. Create Company Record
      const company = await tx.company.create({
        data: {
          organizationId: ctx.organizationId,
          legalName,
          tradeName,
          gstin: cleanGstin || null,
          pan,
          stateCode,
          gstType: dto.gstType || "REGULAR",
          compositionScheme: dto.compositionScheme ?? false,
          eInvoiceApplicable: dto.eInvoiceApplicable ?? false,
          currencyCode: "INR",
          addressLine1: dto.addressLine1?.trim() || "Commercial Market Center",
          addressLine2: dto.addressLine2?.trim() || null,
          city: dto.city?.trim() || "Ahmedabad",
          district: dto.district?.trim() || null,
          pincode: dto.pincode?.trim() || "380001",
          phone: dto.phone?.trim() || "9898000000",
          email: dto.email?.trim() || null,
          bankName: dto.bankName?.trim() || null,
          bankAccountNo: dto.bankAccountNo?.trim() || null,
          bankIfsc: dto.bankIfsc?.trim() || null,
          bankBranch: dto.bankBranch?.trim() || null,
          upiVpa: dto.upiVpa?.trim() || null,
          bankAccountBarcode: dto.bankAccountBarcode?.trim() || null,
          signatoryName: dto.signatoryName?.trim() || null,
          signatoryDesignation: dto.signatoryDesignation?.trim() || "Authorised Signatory",
          signatureUrl: dto.signatureUrl || null,
          enableGujaratiPrint: dto.enableGujaratiPrint ?? true,
          allowNegativeStock: dto.allowNegativeStock ?? false,
        },
      });

      // 5. Create Default Main Branch
      const branchCode = dto.branchCode?.trim() || "BR01";
      const branch = await tx.branch.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: company.id,
          name: dto.branchName?.trim() || "Main Branch",
          code: branchCode,
          isMainBranch: true,
          addressLine1: company.addressLine1,
          city: company.city,
          pincode: company.pincode,
          stateCode: company.stateCode,
          phone: company.phone,
        },
      });

      // 6. Create Current Financial Year (FY 2026-27)
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

      // 7. Assign Creating User to the New Branch
      if (userId) {
        try {
          await tx.userBranchAssignment.create({
            data: {
              userId,
              branchId: branch.id,
              role: UserRole.COMPANY_ADMIN,
              isDefault: false,
            },
          });
        } catch {
          // ignore duplicate assignment
        }
      }

      // 8. Seed Standard Chart of Accounts (Idempotent for new company)
      const groupMap = new Map<string, string>();
      for (const tGroup of STANDARD_SME_GROUPS) {
        let parentId: string | null = null;
        if (tGroup.parentName) {
          parentId = groupMap.get(tGroup.parentName) || null;
        }

        const createdGroup = await tx.ledgerGroup.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: company.id,
            name: tGroup.name,
            nameGujarati: tGroup.nameGujarati,
            nature: tGroup.nature as any,
            parentId: parentId || undefined,
            isSystem: true,
          },
        });
        groupMap.set(tGroup.name, createdGroup.id);
      }

      for (const tAcc of STANDARD_SME_ACCOUNTS) {
        const groupId = groupMap.get(tAcc.groupName);
        if (groupId) {
          await tx.ledgerAccount.create({
            data: {
              organizationId: ctx.organizationId,
              companyId: company.id,
              groupId,
              name: tAcc.name,
              nameGujarati: tAcc.nameGujarati,
              code: tAcc.code,
              isBankLedger: tAcc.isBankLedger ?? false,
              isCashLedger: tAcc.isCashLedger ?? false,
              isTaxLedger: tAcc.isTaxLedger ?? false,
            },
          });
        }
      }

      // 9. Record Audit Log
      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: company.id,
          userId: userId || "00000000-0000-0000-0000-000000000000",
          action: "COMPANY_CREATE",
          entityName: "Company",
          entityId: company.id,
          newState: {
            companyId: company.id,
            legalName: company.legalName,
            tradeName: company.tradeName,
            gstin: company.gstin,
            stateCode: company.stateCode,
            branchId: branch.id,
          },
        },
        tx,
      );

      return {
        success: true,
        company,
        branch,
        financialYear,
        entitlements: {
          tier: org.tenant.subscriptionTier,
          name: plan.name,
          maxCompanies: plan.maxCompanies,
          currentCount: currentCount + 1,
          canAddCompany: currentCount + 1 < plan.maxCompanies,
        },
      };
    });
  }

  async getCompanyById(ctx: TenantContext, id: string) {
    const company = await this.prisma.company.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
      },
      include: {
        branches: true,
        financialYears: true,
      },
    });
    if (!company) {
      throw new NotFoundException("Company not found in your organization.");
    }
    return company;
  }

  async updateCompany(ctx: TenantContext, id: string, dto: any) {
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!company) {
      throw new NotFoundException("Company not found in your organization.");
    }

    const data: any = {};
    const allowed = [
      "legalName",
      "tradeName",
      "gstin",
      "pan",
      "stateCode",
      "addressLine1",
      "addressLine2",
      "city",
      "district",
      "pincode",
      "phone",
      "email",
      "bankName",
      "bankAccountNo",
      "bankIfsc",
      "bankBranch",
      "upiVpa",
      "bankAccountBarcode",
      "signatoryName",
      "signatoryDesignation",
      "signatureUrl",
      "enableGujaratiPrint",
      "allowNegativeStock",
    ];

    for (const key of allowed) {
      if (dto[key] !== undefined) {
        data[key] = dto[key];
      }
    }

    return this.prisma.company.update({
      where: { id },
      data,
    });
  }

  async getCurrentCompany(ctx: TenantContext) {
    const company = await this.prisma.company.findFirst({
      where: {
        id: ctx.companyId,
        organizationId: ctx.organizationId,
      },
      include: {
        branches: true,
        financialYears: true,
      },
    });
    if (!company) {
      throw new NotFoundException("Company not found.");
    }
    return company;
  }

  async updateCurrentCompany(ctx: TenantContext, dto: any) {
    const company = await this.prisma.company.findFirst({
      where: {
        id: ctx.companyId,
        organizationId: ctx.organizationId,
      },
    });
    if (!company) {
      throw new NotFoundException("Company not found.");
    }

    const data: any = {};
    const allowed = [
      "legalName",
      "tradeName",
      "gstin",
      "pan",
      "stateCode",
      "addressLine1",
      "addressLine2",
      "city",
      "district",
      "pincode",
      "phone",
      "email",
      "bankName",
      "bankAccountNo",
      "bankIfsc",
      "bankBranch",
      "upiVpa",
      "bankAccountBarcode",
      "signatoryName",
      "signatoryDesignation",
      "signatureUrl",
      "enableGujaratiPrint",
      "allowNegativeStock",
    ];

    for (const key of allowed) {
      if (dto[key] !== undefined) {
        data[key] = dto[key];
      }
    }

    return this.prisma.company.update({
      where: { id: ctx.companyId },
      data,
    });
  }

  async getBranches(ctx: TenantContext) {
    return this.prisma.branch.findMany({
      where: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
      },
      select: {
        id: true,
        name: true,
        code: true,
        isMainBranch: true,
        city: true,
        stateCode: true,
        phone: true,
      },
    });
  }

  async createBranch(ctx: TenantContext, dto: CreateBranchDto) {
    const existing = await this.prisma.branch.findFirst({
      where: {
        companyId: ctx.companyId,
        code: dto.code,
      },
    });

    if (existing) {
      throw new ForbiddenException(
        `Branch with code '${dto.code}' already exists in this company.`,
      );
    }

    return this.prisma.branch.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        name: dto.name,
        code: dto.code,
        addressLine1: dto.addressLine1,
        city: dto.city,
        pincode: dto.pincode,
        stateCode: dto.stateCode,
        phone: dto.phone,
      },
    });
  }

  async getFinancialYears(ctx: TenantContext) {
    return this.prisma.financialYear.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { startDate: "desc" },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        isCurrent: true,
        isLocked: true,
      },
    });
  }

  async getWarehouses(ctx: TenantContext) {
    return this.prisma.warehouse.findMany({
      where: {
        companyId: ctx.companyId,
      },
      select: {
        id: true,
        name: true,
        isDefault: true,
        address: true,
        branchId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async createWarehouse(
    ctx: TenantContext,
    dto: {
      name: string;
      isDefault?: boolean;
      address?: string;
      branchId?: string;
    },
  ) {
    let branchId = dto.branchId || ctx.branchId;
    if (!branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { companyId: ctx.companyId },
      });
      branchId = branch?.id;
    }
    if (!branchId) {
      throw new ForbiddenException("No valid branch found for warehouse.");
    }

    if (dto.isDefault) {
      await this.prisma.warehouse.updateMany({
        where: { companyId: ctx.companyId },
        data: { isDefault: false },
      });
    }

    return this.prisma.warehouse.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        branchId,
        name: dto.name,
        isDefault: dto.isDefault ?? false,
        address: dto.address,
      },
    });
  }

  async updateWarehouse(
    ctx: TenantContext,
    id: string,
    dto: { name?: string; isDefault?: boolean; address?: string },
  ) {
    if (dto.isDefault) {
      await this.prisma.warehouse.updateMany({
        where: { companyId: ctx.companyId },
        data: { isDefault: false },
      });
    }

    return this.prisma.warehouse.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
      },
    });
  }

  async deleteWarehouse(ctx: TenantContext, id: string) {
    return this.prisma.warehouse.delete({
      where: { id },
    });
  }

  async getOrganizationUsers(ctx: TenantContext) {
    if (!ctx.organizationId) {
      return [];
    }
    const users = await this.prisma.user.findMany({
      where: { organizationId: ctx.organizationId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        preferredLang: true,
        isActive: true,
        createdAt: true,
        branchAssignments: {
          select: {
            branch: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            role: true,
            isDefault: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return users.map((u) => {
      const defaultBranch =
        u.branchAssignments?.find((b) => b.isDefault)?.branch?.name ||
        u.branchAssignments?.[0]?.branch?.name ||
        "All Branches";

      return {
        id: u.id,
        name: u.fullName,
        phone: u.phone,
        email: u.email,
        role: u.role,
        branch: defaultBranch,
        status: u.isActive ? ("Active" as const) : ("Inactive" as const),
        createdAt: u.createdAt.toISOString(),
      };
    });
  }

  async createOrganizationUser(
    ctx: TenantContext,
    dto: {
      name: string;
      phone: string;
      email?: string;
      role: UserRole;
      branchId?: string;
    },
  ) {
    if (!ctx.organizationId) {
      throw new ForbiddenException("Organization context required.");
    }

    const existing = await this.prisma.user.findFirst({
      where: { phone: dto.phone },
    });
    if (existing) {
      throw new BadRequestException("User with this phone number already exists.");
    }

    const email = dto.email || `${dto.phone}@billing.internal`;
    const defaultPassword = await bcrypt.hash(dto.phone, 10);

    const created = await this.prisma.user.create({
      data: {
        organizationId: ctx.organizationId,
        fullName: dto.name,
        phone: dto.phone,
        email,
        passwordHash: defaultPassword,
        role: dto.role,
        isActive: true,
        preferredLang: "en",
      },
    });

    const branchId = dto.branchId || ctx.branchId;
    if (branchId) {
      await this.prisma.userBranchAssignment
        .create({
          data: {
            userId: created.id,
            branchId,
            role: dto.role,
            isDefault: true,
          },
        })
        .catch(() => {});
    }

    return {
      id: created.id,
      name: created.fullName,
      phone: created.phone,
      email: created.email,
      role: created.role,
      branch: "All Branches",
      status: "Active" as const,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async updateOrganizationUser(
    ctx: TenantContext,
    userId: string,
    dto: {
      name?: string;
      role?: UserRole;
      isActive?: boolean;
    },
  ) {
    if (!ctx.organizationId) {
      throw new ForbiddenException("Organization context required.");
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: ctx.organizationId },
    });
    if (!user) {
      throw new NotFoundException("User not found in this organization.");
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name ? { fullName: dto.name } : {}),
        ...(dto.role ? { role: dto.role } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deleteOrganizationUser(ctx: TenantContext, userId: string) {
    if (!ctx.organizationId) {
      throw new ForbiddenException("Organization context required.");
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: ctx.organizationId },
    });
    if (!user) {
      throw new NotFoundException("User not found in this organization.");
    }
    if (user.id === ctx.userId) {
      throw new BadRequestException("You cannot delete your own account.");
    }

    return this.prisma.user.delete({
      where: { id: userId },
    });
  }

  async getOrganizationActivities(ctx: TenantContext) {
    if (!ctx.organizationId) {
      return [];
    }
    const logs = await this.prisma.auditLog.findMany({
      where: { organizationId: ctx.organizationId },
      include: {
        user: {
          select: {
            fullName: true,
            phone: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    return logs.map((log) => ({
      id: log.id,
      userName: log.user?.fullName || "Admin",
      userRole: log.user?.role || "ADMIN",
      action: log.action.replace(/_/g, " "),
      timestamp: log.createdAt.toISOString(),
      details: `${log.entityName} ${log.entityId ? `#${log.entityId.slice(0, 8)}` : ""}`,
    }));
  }
}

