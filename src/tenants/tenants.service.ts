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
  GstRegistrationType,
  getPlanEntitlements,
  canCreateCompany,
} from "@billing/shared-types";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { CompanyAssetsService } from "./company-assets.service";
import {
  companySettingsCatalog,
  matchIndianStateCode,
} from "./company-settings.catalog";
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

const COMPANY_PROFILE_FIELDS = [
  "legalName",
  "tradeName",
  "gstin",
  "pan",
  "stateCode",
  "gstType",
  "compositionScheme",
  "eInvoiceApplicable",
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
  "logoUrl",
  "enableTds",
  "enableTcs",
  "businessTypes",
  "industryType",
  "registrationType",
  "extraDetails",
  "enableGujaratiPrint",
  "allowNegativeStock",
] as const;

function readExtraDetails(company: object): Record<string, string> {
  const raw = (company as { extraDetails?: unknown }).extraDetails;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, string>) };
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
    private readonly ledgersService: LedgersService,
    private readonly assets: CompanyAssetsService,
  ) {}

  async getCompanies(ctx: TenantContext) {
    return this.prisma.executeBypassRls(async (tx) => {
      return tx.company.findMany({
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
    });
  }

  async getCompaniesWithEntitlements(ctx: TenantContext) {
    const [companies, org] = await this.prisma.executeBypassRls(async (tx) => {
      return Promise.all([
        tx.company.findMany({
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
        tx.organization.findUnique({
          where: { id: ctx.organizationId },
          include: { tenant: true },
        }),
      ]);
    });

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
        isExpired: org?.tenant?.subscriptionEnds ? new Date(org.tenant.subscriptionEnds).getTime() < Date.now() : false,
        daysRemaining: org?.tenant?.subscriptionEnds ? Math.ceil((new Date(org.tenant.subscriptionEnds).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0,
        isActive: (org?.tenant?.isActive ?? true) && (org?.tenant?.subscriptionEnds ? new Date(org.tenant.subscriptionEnds).getTime() >= Date.now() : true),
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
          gstType:
            dto.gstType ||
            (dto.gstRegistered === false
              ? GstRegistrationType.UNREGISTERED
              : GstRegistrationType.REGULAR),
          compositionScheme: dto.compositionScheme ?? false,
          eInvoiceApplicable: dto.eInvoiceApplicable ?? false,
          enableTds: dto.enableTds ?? false,
          enableTcs: dto.enableTcs ?? false,
          businessTypes: dto.businessTypes || [],
          industryType: dto.industryType || null,
          registrationType: dto.registrationType || null,
          extraDetails: dto.extraDetails || {},
          logoUrl: dto.logoUrl || null,
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
    const company = await this.prisma.executeBypassRls(async (tx) => {
      return tx.company.findFirst({
        where: {
          id,
          organizationId: ctx.organizationId,
        },
        include: {
          branches: true,
          financialYears: true,
        },
      });
    });
    if (!company) {
      throw new NotFoundException("Company not found in your organization.");
    }
    return this.presentCompany(company);
  }

  async updateCompany(ctx: TenantContext, id: string, dto: any) {
    const company = await this.prisma.executeBypassRls(async (tx) => {
      return tx.company.findFirst({
        where: { id, organizationId: ctx.organizationId },
      });
    });
    if (!company) {
      throw new NotFoundException("Company not found in your organization.");
    }

    const data = this.buildCompanyProfileData(dto);
    const updated = await this.prisma.executeBypassRls(async (tx) => {
      return tx.company.update({
        where: { id },
        data,
      });
    });
    return this.presentCompany(updated);
  }

  async getCurrentCompany(ctx: TenantContext) {
    const compId = ctx.companyId;
    const company = await this.prisma.executeBypassRls(async (tx) => {
      if (compId) {
        const found = await tx.company.findFirst({
          where: {
            id: compId,
            organizationId: ctx.organizationId,
          },
          include: {
            branches: true,
            financialYears: true,
          },
        });
        if (found) return found;
      }
      return tx.company.findFirst({
        where: { organizationId: ctx.organizationId },
        orderBy: { createdAt: "asc" },
        include: {
          branches: true,
          financialYears: true,
        },
      });
    });

    if (!company) {
      throw new NotFoundException("Company not found.");
    }
    return this.presentCompany(company);
  }

  async updateCurrentCompany(ctx: TenantContext, dto: any) {
    const compId = ctx.companyId;
    const company = await this.prisma.executeBypassRls(async (tx) => {
      if (compId) {
        const found = await tx.company.findFirst({
          where: {
            id: compId,
            organizationId: ctx.organizationId,
          },
        });
        if (found) return found;
      }
      return tx.company.findFirst({
        where: { organizationId: ctx.organizationId },
        orderBy: { createdAt: "asc" },
      });
    });

    if (!company) {
      throw new NotFoundException("Company not found.");
    }

    const data = this.buildCompanyProfileData(dto);
    const updated = await this.prisma.executeBypassRls(async (tx) => {
      return tx.company.update({
        where: { id: company.id },
        data,
      });
    });
    return this.presentCompany(updated);
  }

  getCompanySettingsOptions() {
    return companySettingsCatalog();
  }

  async lookupPincode(pincode: string) {
    const pin = String(pincode || "").replace(/\D/g, "");
    if (pin.length !== 6) {
      throw new BadRequestException("Enter a valid 6-digit pincode.");
    }

    let payload: any;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      payload = await res.json();
    } catch {
      throw new BadRequestException(
        "Pincode lookup is temporarily unavailable. Enter city and state manually.",
      );
    }

    const first = Array.isArray(payload) ? payload[0] : payload;
    const offices = first?.PostOffice;
    if (first?.Status !== "Success" || !Array.isArray(offices) || !offices.length) {
      throw new NotFoundException("No city found for this pincode.");
    }

    const office = offices[0];
    const city = String(office.District || office.Block || office.Name || "").trim();
    const stateName = String(office.State || "").trim();
    return {
      pincode: pin,
      city,
      district: String(office.District || city).trim(),
      state: stateName,
      stateCode: matchIndianStateCode(stateName),
      postOffice: String(office.Name || "").trim(),
    };
  }

  async addExtraDetail(
    ctx: TenantContext,
    dto: { key?: string; value?: string },
  ) {
    const key = String(dto?.key || "").trim();
    const value = String(dto?.value || "").trim();
    if (!key || !value) {
      throw new BadRequestException("Both key and value are required.");
    }
    const company = await this.requireCurrentCompany(ctx);
    const extra = {
      ...readExtraDetails(company),
      [key]: value,
    };
    const updated = await this.prisma.executeBypassRls(async (tx) => {
      return tx.company.update({
        where: { id: company.id },
        data: { extraDetails: extra } as never,
      });
    });
    return this.presentCompany(updated);
  }

  async saveCompanyImage(
    ctx: TenantContext,
    kind: "logo" | "signature",
    buffer: Buffer,
  ) {
    const company = await this.requireCurrentCompany(ctx);
    const saved = await this.assets.saveImage(
      company.id,
      kind,
      buffer,
      kind === "logo" ? 5 * 1024 * 1024 : 2 * 1024 * 1024,
    );
    const urlPath =
      kind === "logo"
        ? "/api/v1/tenants/company/logo"
        : "/api/v1/tenants/company/signature";
    const data =
      kind === "logo"
        ? { logoUrl: urlPath }
        : { signatureUrl: urlPath };
    await this.prisma.executeBypassRls(async (tx) => {
      return tx.company.update({ where: { id: company.id }, data });
    });
    return { ok: true, kind, mimeType: saved.mimeType, url: urlPath };
  }

  async readCompanyImage(ctx: TenantContext, kind: "logo" | "signature") {
    const company = await this.requireCurrentCompany(ctx);
    const file = await this.assets.readImage(company.id, kind);
    if (!file) {
      throw new NotFoundException(`${kind} is not uploaded yet.`);
    }
    return file;
  }

  async deleteCompanyImage(ctx: TenantContext, kind: "logo" | "signature") {
    const company = await this.requireCurrentCompany(ctx);
    await this.assets.deleteImage(company.id, kind);
    const data =
      kind === "logo" ? { logoUrl: null } : { signatureUrl: null };
    await this.prisma.executeBypassRls(async (tx) => {
      return tx.company.update({ where: { id: company.id }, data });
    });
    return { ok: true };
  }

  async closeFinancialYear(ctx: TenantContext, id: string) {
    const company = await this.requireCurrentCompany(ctx);
    return this.prisma.executeBypassRls(async (tx) => {
      const fy = await tx.financialYear.findFirst({
        where: { id, companyId: company.id },
      });
      if (!fy) throw new NotFoundException("Financial year not found.");
      if (fy.isLocked) {
        throw new BadRequestException("This financial year is already closed.");
      }

      await tx.financialYear.update({
        where: { id: fy.id },
        data: { isLocked: true, isCurrent: false },
      });

      const nextStart = new Date(fy.endDate);
      nextStart.setDate(nextStart.getDate() + 1);
      const nextEnd = new Date(nextStart);
      nextEnd.setFullYear(nextEnd.getFullYear() + 1);
      nextEnd.setDate(nextEnd.getDate() - 1);
      const nextName = `FY ${nextStart.getFullYear()}-${String(nextEnd.getFullYear()).slice(-2)}`;

      let next = await tx.financialYear.findFirst({
        where: { companyId: company.id, startDate: nextStart },
      });
      if (!next) {
        next = await tx.financialYear.create({
          data: {
            companyId: company.id,
            name: nextName,
            startDate: nextStart,
            endDate: nextEnd,
            isLocked: false,
            isCurrent: true,
          },
        });
      } else {
        await tx.financialYear.update({
          where: { id: next.id },
          data: { isCurrent: true, isLocked: false },
        });
      }

      return {
        closed: fy,
        current: next,
        message: `${fy.name} closed. ${next.name} is now current.`,
      };
    });
  }

  async exportTallyMasters(ctx: TenantContext) {
    const company = await this.requireCurrentCompany(ctx);
    return this.prisma.executeBypassRls(async (tx) => {
      const [parties, items, ledgers] = await Promise.all([
        tx.party.findMany({
          where: { companyId: company.id },
          select: { name: true, gstin: true, type: true, phone: true, pan: true },
        }),
        tx.item.findMany({
          where: { companyId: company.id },
          select: { name: true, sku: true, hsnCode: true, taxRate: true },
        }),
        tx.ledgerAccount.findMany({
          where: { companyId: company.id },
          select: { name: true, code: true, openingBalance: true, openingType: true },
        }),
      ]);
      return {
        format: "TALLY_MASTERS_JSON",
        exportedAt: new Date().toISOString(),
        company: {
          name: company.tradeName,
          legalName: company.legalName,
          gstin: company.gstin,
          stateCode: company.stateCode,
        },
        parties,
        items,
        ledgers,
      };
    });
  }

  async getBranches(ctx: TenantContext) {
    return this.prisma.executeBypassRls(async (tx) => {
      let compId = ctx.companyId;
      if (!compId) {
        const primary = await tx.company.findFirst({
          where: { organizationId: ctx.organizationId },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        compId = primary?.id;
      }
      return tx.branch.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(compId ? { companyId: compId } : {}),
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
    });
  }

  async createBranch(ctx: TenantContext, dto: CreateBranchDto) {
    return this.prisma.executeBypassRls(async (tx) => {
      let compId = ctx.companyId;
      if (!compId) {
        const primary = await tx.company.findFirst({
          where: { organizationId: ctx.organizationId },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        compId = primary?.id;
      }

      const existing = await tx.branch.findFirst({
        where: {
          companyId: compId,
          code: dto.code,
        },
      });

      if (existing) {
        throw new ForbiddenException(
          `Branch with code '${dto.code}' already exists in this company.`,
        );
      }

      return tx.branch.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: compId || "",
          name: dto.name,
          code: dto.code,
          addressLine1: dto.addressLine1,
          city: dto.city,
          pincode: dto.pincode,
          stateCode: dto.stateCode,
          phone: dto.phone,
        },
      });
    });
  }

  async getFinancialYears(ctx: TenantContext) {
    return this.prisma.executeBypassRls(async (tx) => {
      let compId = ctx.companyId;
      if (!compId) {
        const primary = await tx.company.findFirst({
          where: { organizationId: ctx.organizationId },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        compId = primary?.id;
      }
      return tx.financialYear.findMany({
        where: {
          ...(compId ? { companyId: compId } : {}),
        },
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
    });
  }

  async getWarehouses(ctx: TenantContext) {
    return this.prisma.executeBypassRls(async (tx) => {
      let compId = ctx.companyId;
      if (!compId) {
        const primary = await tx.company.findFirst({
          where: { organizationId: ctx.organizationId },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        compId = primary?.id;
      }
      return tx.warehouse.findMany({
        where: {
          companyId: compId,
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
    return this.prisma.executeBypassRls(async (tx) => {
      let compId = ctx.companyId;
      if (!compId) {
        const primary = await tx.company.findFirst({
          where: { organizationId: ctx.organizationId },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        compId = primary?.id;
      }
      if (!compId) {
        throw new BadRequestException("No active company found for warehouse.");
      }

      let orgId = ctx.organizationId;
      if (!orgId) {
        const comp = await tx.company.findUnique({
          where: { id: compId },
          select: { organizationId: true },
        });
        orgId = comp?.organizationId;
      }
      if (!orgId) {
        throw new BadRequestException("No organization found for company.");
      }

      let branchId = dto.branchId || ctx.branchId;
      if (branchId) {
        const existingBranch = await tx.branch.findFirst({
          where: { id: branchId, companyId: compId },
        });
        if (!existingBranch) {
          const fallback = await tx.branch.findFirst({
            where: { companyId: compId },
          });
          branchId = fallback?.id;
        }
      } else {
        const branch = await tx.branch.findFirst({
          where: { companyId: compId },
        });
        branchId = branch?.id;
      }

      if (!branchId) {
        throw new BadRequestException(
          "No valid branch found for warehouse. Please ensure a branch exists.",
        );
      }

      if (dto.isDefault) {
        await tx.warehouse.updateMany({
          where: { companyId: compId },
          data: { isDefault: false },
        });
      }

      return tx.warehouse.create({
        data: {
          organizationId: orgId,
          companyId: compId,
          branchId,
          name: dto.name,
          isDefault: dto.isDefault ?? false,
          address: dto.address,
        },
      });
    });
  }

  async updateWarehouse(
    ctx: TenantContext,
    id: string,
    dto: { name?: string; isDefault?: boolean; address?: string },
  ) {
    return this.prisma.executeBypassRls(async (tx) => {
      let compId = ctx.companyId;
      if (!compId) {
        const existingWh = await tx.warehouse.findUnique({
          where: { id },
          select: { companyId: true },
        });
        compId = existingWh?.companyId;
      }

      if (dto.isDefault && compId) {
        await tx.warehouse.updateMany({
          where: { companyId: compId },
          data: { isDefault: false },
        });
      }

      return tx.warehouse.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
        },
      });
    });
  }

  async deleteWarehouse(ctx: TenantContext, id: string) {
    return this.prisma.executeBypassRls(async (tx) => {
      return tx.warehouse.delete({
        where: { id },
      });
    });
  }

  async getOrganizationUsers(ctx: TenantContext) {
    if (!ctx.organizationId) {
      return [];
    }
    const users = await this.prisma.executeInTenantContext(ctx, async (tx) => {
      return tx.user.findMany({
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

  async getBillingHistory(ctx: TenantContext) {
    if (!ctx.organizationId) {
      throw new BadRequestException("Organization context is required");
    }

    const org = await this.prisma.executeBypassRls(async (tx) => {
      return tx.organization.findUnique({
        where: { id: ctx.organizationId },
        include: {
          tenant: true,
          companies: {
            where: ctx.companyId ? { id: ctx.companyId } : undefined,
            take: 1,
          },
        },
      });
    });

    if (!org || !org.tenant) {
      throw new NotFoundException("Organization or Tenant subscription not found");
    }

    const tenant = org.tenant;
    const company = org.companies[0];
    const subEnds = tenant.subscriptionEnds ? new Date(tenant.subscriptionEnds) : new Date();
    const isExpired = subEnds.getTime() < Date.now();
    const daysRemaining = Math.ceil((subEnds.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    // Pricing details mapping
    const planDetails: Record<string, { name: string; amount: number }> = {
      TRIAL: { name: "Trial Plan (14 Days Free)", amount: 0 },
      RETAIL_BASIC: { name: "Retail Basic (Annual)", amount: 1499 },
      WHOLESALE_PRO: { name: "Wholesale Pro (Annual)", amount: 2999 },
      DISTRIBUTION_ENTERPRISE: { name: "Distribution Enterprise (Annual)", amount: 4999 },
      MANUFACTURING_SUITE: { name: "Manufacturing Suite (Annual)", amount: 7999 },
    };

    const currentTier = tenant.subscriptionTier || SubscriptionTier.TRIAL;
    const currentPlan = planDetails[currentTier] || { name: `${currentTier} Plan`, amount: 2999 };

    const billedBy = {
      name: "myBillBook Technologies Private Limited",
      tradeName: "myBillBook Billing & ERP Services",
      gstin: "24AABCM9124P1ZX",
      sacCode: "998314",
      address: "402, Titanium City Centre, Satellite, Ahmedabad, Gujarat - 380015",
      supportEmail: "support@myownbillbook.com",
      supportPhone: "+91 82388 78965",
    };

    const historyItems: any[] = [];
    const tenantShortId = tenant.id.replace(/-/g, "").slice(0, 6).toUpperCase();

    // 1. Current Plan Subscription Record
    if (currentTier !== SubscriptionTier.TRIAL) {
      const activeDate = new Date(Math.min(subEnds.getTime() - 365 * 24 * 60 * 60 * 1000, tenant.createdAt.getTime()));
      const totalAmount = currentPlan.amount;
      const taxable = Math.round((totalAmount / 1.18) * 100) / 100;
      const cgst = Math.round(((totalAmount - taxable) / 2) * 100) / 100;
      const sgst = Math.round((totalAmount - taxable - cgst) * 100) / 100;

      historyItems.push({
        id: `INV-SUB-${tenantShortId}-01`,
        referenceNo: `MBB/26-27/${tenantShortId}`,
        planName: currentPlan.name,
        tier: currentTier,
        date: activeDate.toISOString(),
        displayDate: activeDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
        periodStart: activeDate.toISOString(),
        periodEnd: subEnds.toISOString(),
        paymentStatus: isExpired ? "Expired" : "Success",
        amount: totalAmount,
        formattedAmount: `₹ ${totalAmount.toLocaleString("en-IN")}`,
        taxableAmount: taxable,
        cgst,
        sgst,
        igst: 0,
        paymentMode: "UPI / Net Banking (Instant Activation)",
        organizationName: org.name || "Default Business",
        companyName: company?.tradeName || company?.legalName || org.name,
        gstin: company?.gstin || "Unregistered",
        customerPhone: tenant.primaryPhone || company?.phone,
        customerEmail: tenant.primaryEmail || company?.email,
        billedBy,
      });
    }

    // 2. Onboarding Trial / Foundation Record
    const trialEnds = new Date(tenant.createdAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    historyItems.push({
      id: `INV-SUB-${tenantShortId}-TR`,
      referenceNo: `MBB/TR-${tenantShortId}`,
      planName: "Trial Plan (14 Days Free Access)",
      tier: "TRIAL",
      date: tenant.createdAt.toISOString(),
      displayDate: tenant.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      periodStart: tenant.createdAt.toISOString(),
      periodEnd: trialEnds.toISOString(),
      paymentStatus: currentTier === SubscriptionTier.TRIAL ? (isExpired ? "Expired" : "Success") : "Success",
      amount: 0,
      formattedAmount: "₹ 0",
      taxableAmount: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      paymentMode: "Free Trial Onboarding",
      organizationName: org.name || "Default Business",
      companyName: company?.tradeName || company?.legalName || org.name,
      gstin: company?.gstin || "Unregistered",
      customerPhone: tenant.primaryPhone || company?.phone,
      customerEmail: tenant.primaryEmail || company?.email,
      billedBy,
    });

    return {
      tenantId: tenant.id,
      organizationId: org.id,
      organizationName: org.name,
      currentTier,
      currentPlanName: currentPlan.name,
      subscriptionEnds: tenant.subscriptionEnds,
      isExpired,
      daysRemaining,
      isActive: tenant.isActive && !isExpired,
      history: historyItems,
    };
  }

  async upgradeSubscription(
    ctx: TenantContext,
    dto: {
      tier: SubscriptionTier;
      billingCycle?: "1year" | "3years";
    },
  ) {
    if (!ctx.organizationId) {
      throw new BadRequestException("Organization context is required");
    }

    const org = await this.prisma.executeBypassRls(async (tx) => {
      return tx.organization.findUnique({
        where: { id: ctx.organizationId },
        include: { tenant: true },
      });
    });

    if (!org || !org.tenant) {
      throw new NotFoundException("Organization or Tenant not found");
    }

    const daysToAdd = dto.billingCycle === "3years" ? 365 * 3 : 365;
    const currentEnds = org.tenant.subscriptionEnds ? new Date(org.tenant.subscriptionEnds) : new Date();
    const baseDate = currentEnds.getTime() > Date.now() ? currentEnds : new Date();
    const newSubscriptionEnds = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);

    const updatedTenant = await this.prisma.executeBypassRls(async (tx) => {
      return tx.tenant.update({
        where: { id: org.tenant.id },
        data: {
          subscriptionTier: dto.tier,
          subscriptionEnds: newSubscriptionEnds,
          isActive: true,
        },
      });
    });

    const plan = getPlanEntitlements(updatedTenant.subscriptionTier);

    return {
      success: true,
      message: `Successfully upgraded to ${plan.name}`,
      entitlements: {
        tier: updatedTenant.subscriptionTier,
        name: plan.name,
        nameGujarati: plan.nameGujarati,
        maxCompanies: plan.maxCompanies,
        subscriptionEnds: updatedTenant.subscriptionEnds,
        isExpired: false,
        daysRemaining: Math.ceil((newSubscriptionEnds.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        isActive: true,
        features: plan.features,
      },
    };
  }

  private async requireCurrentCompany(ctx: TenantContext) {
    const company = await this.prisma.executeBypassRls(async (tx) => {
      if (ctx.companyId) {
        const found = await tx.company.findFirst({
          where: { id: ctx.companyId, organizationId: ctx.organizationId },
        });
        if (found) return found;
      }
      return tx.company.findFirst({
        where: { organizationId: ctx.organizationId },
        orderBy: { createdAt: "asc" },
      });
    });
    if (!company) throw new NotFoundException("Company not found.");
    return company;
  }

  private presentCompany(company: any) {
    const gstRegistered =
      company.gstType && company.gstType !== GstRegistrationType.UNREGISTERED;
    return {
      ...company,
      gstRegistered,
      extraDetails: readExtraDetails(company),
      businessTypes: company.businessTypes || [],
    };
  }

  private buildCompanyProfileData(dto: any) {
    const data: any = {};
    for (const key of COMPANY_PROFILE_FIELDS) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (dto.gstRegistered === true && dto.gstType === undefined) {
      data.gstType = dto.compositionScheme
        ? GstRegistrationType.COMPOSITION
        : GstRegistrationType.REGULAR;
    }
    if (dto.gstRegistered === false && dto.gstType === undefined) {
      data.gstType = GstRegistrationType.UNREGISTERED;
      data.eInvoiceApplicable = false;
    }
    if (data.gstin !== undefined) {
      data.gstin = String(data.gstin || "").trim().toUpperCase() || null;
    }
    if (data.pan !== undefined) {
      data.pan = String(data.pan || "").trim().toUpperCase() || null;
    }
    if (data.businessTypes && !Array.isArray(data.businessTypes)) {
      data.businessTypes = [data.businessTypes];
    }
    return data;
  }
}
