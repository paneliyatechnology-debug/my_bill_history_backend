import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@billing/shared-types";
import { PERMISSIONS_KEY, RequiredPermission } from "../decorators/permissions.decorator";
import { DatabaseService } from "../../database/database.service";
import { resolveEffectivePermissions } from "../../auth/rbac/permissions.catalog";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<RequiredPermission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: "Authentication required to access this resource.",
        messageGujarati: "આ સંસાધનને ઍક્સેસ કરવા માટે લૉગિન જરૂરી છે.",
      });
    }

    // Admins and Super Admins bypass granular permission check
    if (
      user.role === UserRole.SUPER_ADMIN ||
      user.role === UserRole.ORG_ADMIN ||
      user.role === UserRole.COMPANY_ADMIN
    ) {
      return true;
    }

    // Load user record from database to verify status, session version, custom role, and overrides
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        customRole: {
          include: {
            permissions: true,
          },
        },
        userPermissions: true,
      },
    });

    if (!dbUser || !dbUser.isActive) {
      throw new ForbiddenException({
        statusCode: 403,
        message: "Your staff account is currently inactive. Contact your administrator.",
        messageGujarati: "તમારું સ્ટાફ એકાઉન્ટ નિષ્ક્રિય છે. કૃપા કરીને એડમિનનો સંપર્ક કરો.",
      });
    }

    if (dbUser.customRole && dbUser.customRole.isActive === false) {
      throw new ForbiddenException({
        statusCode: 403,
        message: "Your assigned role is currently inactive. Contact your administrator.",
        messageGujarati: "તમારો સોંપાયેલ રોલ હાલમાં નિષ્ક્રિય છે. કૃપા કરીને એડમિનનો સંપર્ક કરો.",
      });
    }

    // Session revocation check
    if (user.sessionVersion && dbUser.sessionVersion > user.sessionVersion) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: "Your session has been revoked. Please log in again.",
        messageGujarati: "તમારું સત્ર રદ કરવામાં આવ્યું છે. કૃપા કરીને ફરીથી લૉગિન કરો.",
      });
    }

    // Calculate effective permissions (checking custom role, organization-customized system role, and staff overrides)
    let customRolePerms = dbUser.customRole?.permissions || [];
    if (customRolePerms.length === 0 && dbUser.organizationId) {
      const orgRole = await this.prisma.role.findFirst({
        where: {
          organizationId: dbUser.organizationId,
          systemRole: dbUser.role,
          isSystem: true,
        },
        include: { permissions: true },
      });
      if (orgRole) {
        if (orgRole.isActive === false) {
          throw new ForbiddenException({
            statusCode: 403,
            message: "Your assigned role is currently inactive. Contact your administrator.",
            messageGujarati: "તમારો સોંપાયેલ રોલ હાલમાં નિષ્ક્રિય છે. કૃપા કરીને એડમિનનો સંપર્ક કરો.",
          });
        }
        if (orgRole.permissions.length > 0) {
          customRolePerms = orgRole.permissions;
        }
      }
    }

    const effective = resolveEffectivePermissions(
      dbUser.role,
      customRolePerms,
      dbUser.userPermissions || [],
    );

    // Attach resolved permissions & dataScope to request for downstream controller/service use
    request.userPermissions = effective;
    request.userDataScope = dbUser.dataScope;
    request.userMaxInvoiceAmount = dbUser.maxInvoiceAmount ? Number(dbUser.maxInvoiceAmount) : null;
    request.userMaxDiscountPercent = dbUser.maxDiscountPercent ? Number(dbUser.maxDiscountPercent) : null;
    request.userCanOverridePrice = dbUser.canOverridePrice;

    // Check every required permission
    for (const req of requiredPermissions) {
      const aliases = [req.module];
      if (req.module === "sales_invoices") aliases.push("invoices");
      if (req.module === "invoices") aliases.push("sales_invoices");
      if (req.module === "proforma_invoices") aliases.push("proformas");
      if (req.module === "proformas") aliases.push("proforma_invoices");
      if (req.module === "cash_bank") aliases.push("banking");
      if (req.module === "banking") aliases.push("cash_bank");
      if (req.module === "gst_tax") aliases.push("gst");
      if (req.module === "gst") aliases.push("gst_tax");
      if (req.module === "accounting") aliases.push("vouchers");
      if (req.module === "vouchers") aliases.push("accounting");

      const isAllowed = aliases.some(
        (mod) => effective[mod] && effective[mod][req.action] === true,
      );

      if (!isAllowed) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "PERMISSION_DENIED",
          message: `Permission denied: You lack '${req.action}' permission on '${req.module}'.`,
          messageGujarati: `પરવાનગી નકારી: તમારી પાસે '${req.module}' માટે '${req.action}' ની પરવાનગી નથી.`,
        });
      }
    }

    return true;
  }
}
