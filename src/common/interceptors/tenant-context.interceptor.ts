import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
  Optional,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { TenantContext, UserRole } from "@billing/shared-types";
import { DatabaseService } from "../../database/database.service";
import { SupportSessionRegistry } from "../../super-admin/support-session.registry";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

export const TENANT_CONTEXT_KEY = "TENANT_CONTEXT";

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly sessionRegistry: SupportSessionRegistry;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: DatabaseService,
    @Optional() sessionRegistry?: SupportSessionRegistry,
  ) {
    this.sessionRegistry =
      sessionRegistry || new SupportSessionRegistry(prisma);
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();

    // If public endpoint without credentials, bypass tenant context resolution
    if (isPublic && !request.headers.authorization) {
      request[TENANT_CONTEXT_KEY] = {
        organizationId: "",
        companyId: "",
        isSystemBypass: true,
      };
      return next.handle();
    }

    const user = request.user;
    if (!user || !user.organizationId) {
      // If endpoint is not public but user is missing, JwtAuthGuard will handle it.
      // If we reach here, establish safe empty context
      request[TENANT_CONTEXT_KEY] = {
        organizationId: "",
        companyId: "",
        isSystemBypass: false,
      };
      return next.handle();
    }

    // 0. Zero-Trust Authoritative Account Validation
    // Ensure the account has not been deactivated, revoked, or demoted
    const currentUserId = user.id || user.userId || user.sub;
    if (currentUserId) {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: currentUserId },
        select: { id: true, role: true, isActive: true, updatedAt: true },
      });

      if (!dbUser || !dbUser.isActive) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "ACCOUNT_DEACTIVATED",
          message:
            "Access denied: Account is suspended, deactivated, or revoked.",
          messageGujarati: "એકાઉન્ટ સ્થગિત અથવા નિષ્ક્રિય કરવામાં આવ્યું છે.",
        });
      }

      // Check if session token was invalidated by password reset or security change
      if (user.iat && dbUser.updatedAt) {
        const tokenIssuedAtMs = user.iat * 1000;
        // Invalidate tokens issued more than 2 seconds before password reset or security update
        if (dbUser.updatedAt.getTime() - tokenIssuedAtMs > 2000) {
          throw new UnauthorizedException({
            statusCode: 401,
            error: "SESSION_REVOKED",
            message:
              "Session invalidated due to password reset or security change. Please sign in again.",
            messageGujarati:
              "પાસવર્ડ બદલાયો હોવાથી સેશન અમાન્ય કરવામાં આવ્યું છે. કૃપા કરીને ફરી લોગિન કરો.",
          });
        }
      }

      // Authoritative role sync: override token role with authoritative DB role
      user.role = dbUser.role;
    }

    const rawOrgHeader = request.headers["x-organization-id"] as
      string | undefined;
    const rawCompanyHeader = request.headers["x-company-id"] as
      string | undefined;
    const rawBranchHeader = request.headers["x-branch-id"] as
      string | undefined;
    const rawFyHeader = request.headers["x-financial-year-id"] as
      string | undefined;

    // 1. Support Session Handling & Boundary Isolation
    if (user.isSupportSession) {
      const validSession = await this.sessionRegistry.getValidSession(
        user.sessionId,
      );
      if (!validSession) {
        throw new UnauthorizedException({
          statusCode: 401,
          error: "SUPPORT_SESSION_EXPIRED",
          message:
            "Support session has been terminated, revoked, or expired. Please re-authenticate as SuperAdmin.",
          messageGujarati:
            "સપોર્ટ સેશન પૂર્ણ થઈ ગયું છે અથવા એક્સપાયર થઈ ગયું છે.",
        });
      }

      // Strict actor binding: verify the authenticated user matches the session actor
      if (validSession.actor_id !== currentUserId) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "FORBIDDEN_SUPPORT_ACTOR_MISMATCH",
          message:
            "Security violation: Authenticated user does not match the active support session actor.",
          messageGujarati: "સપોર્ટ સેશન એક્ટર મેળ ખાતો નથી.",
        });
      }

      // Strict boundary: support token claims must match authoritative DB record
      if (
        user.organizationId !== validSession.target_organization_id ||
        user.impersonatedCompanyId !== validSession.target_company_id
      ) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "FORBIDDEN_SUPPORT_CLAIM_MISMATCH",
          message:
            "Support session claims do not match authoritative records in the session registry.",
          messageGujarati: "સપોર્ટ સેશન ડેટાબેઝ સાથે મેળ ખાતો નથી.",
        });
      }

      // Strict boundary: support token cannot be redirected to another tenant organization via headers
      if (
        rawOrgHeader &&
        rawOrgHeader !== validSession.target_organization_id
      ) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "FORBIDDEN_SUPPORT_TENANT_ACCESS",
          message: `Cross-tenant access forbidden. Support session is strictly restricted to organization '${validSession.target_organization_id}'.`,
          messageGujarati:
            "સપોર્ટ સેશન દરમિયાન અન્ય સંસ્થાનો ઍક્સેસ પ્રતિબંધિત છે.",
        });
      }

      // Strict boundary: support token cannot access another company via headers
      if (
        rawCompanyHeader &&
        rawCompanyHeader !== validSession.target_company_id
      ) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "FORBIDDEN_SUPPORT_COMPANY_ACCESS",
          message: `Cross-company access forbidden. Support session is strictly restricted to company '${validSession.target_company_id}'.`,
          messageGujarati:
            "સપોર્ટ સેશન દરમિયાન અન્ય કંપનીનો ઍક્સેસ પ્રતિબંધિત છે.",
        });
      }

      // Validate branch header against authoritative DB if provided
      if (rawBranchHeader) {
        const branch = await this.prisma.branch.findFirst({
          where: {
            id: rawBranchHeader,
            companyId: validSession.target_company_id,
          },
          select: { id: true },
        });
        if (!branch) {
          throw new ForbiddenException({
            statusCode: 403,
            error: "INVALID_BRANCH",
            message:
              "Requested branch does not exist within the active support company.",
            messageGujarati:
              "વિનંતી કરેલ શાખા સક્રિય કંપનીમાં અસ્તિત્વમાં નથી.",
          });
        }
      }

      // Establish support context: RLS remains active for target company, preserving real actor ID in audit records
      request[TENANT_CONTEXT_KEY] = {
        organizationId: validSession.target_organization_id,
        companyId: validSession.target_company_id,
        branchId: rawBranchHeader,
        financialYearId: rawFyHeader,
        userId: validSession.actor_id,
        isSystemBypass: false,
        isSupportSession: true,
      };
      return next.handle();
    }

    // 2. Regular Platform SuperAdmin Global Context Bypass
    if (user.role === UserRole.SUPER_ADMIN) {
      const superOrgId = rawOrgHeader || user.organizationId || "";
      const superCompanyId = rawCompanyHeader || "";
      request[TENANT_CONTEXT_KEY] = {
        organizationId: superOrgId,
        companyId: superCompanyId,
        branchId: rawBranchHeader,
        financialYearId: rawFyHeader,
        userId: user.id || user.userId || user.sub,
        isSystemBypass: true,
      };
      return next.handle();
    }

    // 3. Zero Trust: Organization Check for Standard Users
    if (
      rawOrgHeader &&
      rawOrgHeader !== user.organizationId &&
      user.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "FORBIDDEN_TENANT_ACCESS",
        message:
          "Forged or cross-tenant organization access detected. Access denied.",
        messageGujarati:
          "અનધિકૃત સંસ્થા ઍક્સેસ પ્રયાસ. પ્રવેશ નકારવામાં આવ્યો.",
      });
    }

    const verifiedOrgId = user.organizationId;

    // 2. Zero Trust: Company Check (Derived from authenticated user membership)
    let verifiedCompanyId: string;
    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (rawCompanyHeader !== undefined) {
      const trimmedCompanyId = rawCompanyHeader.trim();
      if (!trimmedCompanyId) {
        throw new BadRequestException("Company context is required.");
      }
      if (!UUID_REGEX.test(trimmedCompanyId)) {
        throw new BadRequestException(
          "Invalid company context identifier. Must be a valid UUID.",
        );
      }
      const company = await this.prisma.company.findFirst({
        where: { id: trimmedCompanyId, organizationId: verifiedOrgId },
        select: { id: true },
      });

      if (!company) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "FORBIDDEN_COMPANY_ACCESS",
          message: "Requested company does not belong to your organization.",
          messageGujarati: "વિનંતી કરેલ કંપની તમારી સંસ્થા સાથે જોડાયેલ નથી.",
        });
      }
      verifiedCompanyId = company.id;
    } else {
      const defaultCompany = await this.prisma.company.findFirst({
        where: { organizationId: verifiedOrgId },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      if (!defaultCompany) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "NO_COMPANY_FOUND",
          message: "No registered company found under your organization.",
          messageGujarati: "તમારી સંસ્થા હેઠળ કોઈ રજિસ્ટર્ડ કંપની મળી નથી.",
        });
      }
      verifiedCompanyId = defaultCompany.id;
    }

    // 3. Zero Trust: Branch Authorization Check
    let verifiedBranchId: string | undefined;
    if (rawBranchHeader) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: rawBranchHeader, companyId: verifiedCompanyId },
        select: { id: true },
      });

      if (!branch) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "INVALID_BRANCH",
          message: "Requested branch does not exist within the active company.",
          messageGujarati: "વિનંતી કરેલ શાખા સક્રિય કંપનીમાં અસ્તિત્વમાં નથી.",
        });
      }

      const effectiveUserId = user.id || user.userId || user.sub;

      // If user has branch-constrained role (CASHIER, BRANCH_MANAGER, SALESMAN), verify assignment
      const branchConstrainedRoles = [
        UserRole.CASHIER,
        UserRole.BRANCH_MANAGER,
        UserRole.SALESMAN,
      ];
      if (branchConstrainedRoles.includes(user.role as UserRole)) {
        const assignment = await this.prisma.userBranchAssignment.findUnique({
          where: {
            userId_branchId: {
              userId: effectiveUserId,
              branchId: rawBranchHeader,
            },
          },
        });

        if (!assignment) {
          throw new ForbiddenException({
            statusCode: 403,
            error: "FORBIDDEN_BRANCH_ACCESS",
            message: `User is not assigned or authorized to operate branch '${rawBranchHeader}'.`,
            messageGujarati: "વપરાશકર્તા આ શાખા માટે અધિકૃત નથી.",
          });
        }
      }
      verifiedBranchId = branch.id;
    } else {
      // Find user's default branch assignment or company's main branch
      const effectiveUserId = user.id || user.userId || user.sub;
      const userAssignment = await this.prisma.userBranchAssignment.findFirst({
        where: { userId: effectiveUserId, isDefault: true },
        select: { branchId: true },
      });

      if (userAssignment) {
        verifiedBranchId = userAssignment.branchId;
      } else {
        const mainBranch = await this.prisma.branch.findFirst({
          where: { companyId: verifiedCompanyId, isMainBranch: true },
          select: { id: true },
        });
        verifiedBranchId = mainBranch?.id;
      }
    }

    // 4. Zero Trust: Financial Year Check
    let verifiedFyId: string | undefined;
    if (rawFyHeader) {
      const fy = await this.prisma.financialYear.findFirst({
        where: { id: rawFyHeader, companyId: verifiedCompanyId },
        select: { id: true },
      });

      if (!fy) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "INVALID_FINANCIAL_YEAR",
          message:
            "Requested financial year does not belong to the active company.",
          messageGujarati:
            "વિનંતી કરેલ નાણાકીય વર્ષ સક્રિય કંપની સાથે જોડાયેલ નથી.",
        });
      }
      verifiedFyId = fy.id;
    } else {
      const currentFy = await this.prisma.financialYear.findFirst({
        where: { companyId: verifiedCompanyId, isCurrent: true },
        select: { id: true },
      });
      verifiedFyId = currentFy?.id;
    }

    // Bind fully validated and verified context to request
    const tenantContext: TenantContext = {
      organizationId: verifiedOrgId,
      companyId: verifiedCompanyId,
      branchId: verifiedBranchId,
      financialYearId: verifiedFyId,
      userId: user.id || user.userId || user.sub,
      isSystemBypass: false,
    };

    request[TENANT_CONTEXT_KEY] = tenantContext;

    return next.handle();
  }
}
