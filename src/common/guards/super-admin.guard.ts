import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { UserRole } from "@billing/shared-types";
import { DatabaseService } from "../../database/database.service";

/**
 * SuperAdminGuard enforces strict server-side authorization for platform-level management.
 * In addition to cryptographic JWT verification, it performs an authoritative database lookup
 * to ensure the user exists, is active, and possesses the SUPER_ADMIN role.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tokenUser = request.user;

    if (!tokenUser || !tokenUser.id) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: "Authorization required. Please sign in as a platform administrator.",
        messageGujarati: "ઓથોરાઇઝેશન જરૂરી છે. કૃપા કરીને પ્લેટફોર્મ એડમિન તરીકે લોગિન કરો.",
      });
    }

    // Fast-fail token payload check
    if (tokenUser.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException({
        statusCode: 403,
        message: "Access denied: Platform SuperAdmin privileges required.",
        messageGujarati: "ઍક્સેસ નકારવામાં આવ્યો: પ્લેટફોર્મ સુપર એડમિન પરવાનગી જરૂરી છે.",
      });
    }

    // Disallow support session tokens from invoking platform-admin endpoints,
    // EXCEPT for the dedicated support exit route (/impersonate/exit)
    if (tokenUser.isSupportSession) {
      const pathname = (request.url || "").split("?")[0];
      if (!pathname.endsWith("/impersonate/exit")) {
        throw new ForbiddenException({
          statusCode: 403,
          message:
            "Access denied: Support session tokens cannot invoke platform administration endpoints. Please use primary SuperAdmin credentials.",
          messageGujarati:
            "સપોર્ટ સેશન ટોકન પ્લેટફોર્મ એડમિનિસ્ટ્રેશન માટે ઉપયોગ કરી શકાતો નથી.",
        });
      }
    }

    // Authoritative Zero-Trust Database Validation
    const dbUser = await this.prisma.user.findUnique({
      where: { id: tokenUser.id },
      select: {
        id: true,
        role: true,
        isActive: true,
        organizationId: true,
        email: true,
        phone: true,
      },
    });

    if (!dbUser) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: "User account not found or has been revoked.",
        messageGujarati: "વપરાશકર્તા એકાઉન્ટ મળ્યું નથી.",
      });
    }

    if (!dbUser.isActive) {
      throw new ForbiddenException({
        statusCode: 403,
        message: "Access denied: Account is suspended or deactivated.",
        messageGujarati: "એકાઉન્ટ સ્થગિત અથવા નિષ્ક્રિય કરવામાં આવ્યું છે.",
      });
    }

    if (dbUser.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException({
        statusCode: 403,
        message: "Access denied: Platform SuperAdmin privileges required.",
        messageGujarati: "ઍક્સેસ નકારવામાં આવ્યો: પ્લેટફોર્મ સુપર એડમિન પરવાનગી જરૂરી છે.",
      });
    }

    request.superAdminUser = dbUser;
    return true;
  }
}
