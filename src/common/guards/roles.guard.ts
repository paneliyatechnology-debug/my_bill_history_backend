import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@billing/shared-types";
import { ROLES_KEY } from "../decorators/roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): Promise<boolean> | boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.role) {
      throw new ForbiddenException({
        statusCode: 403,
        message: "Access denied: User role unverified.",
        messageGujarati:
          "ઍક્સેસ નકારવામાં આવ્યો: વપરાશકર્તાની ભૂમિકા અમાન્ય છે.",
      });
    }

    // SUPER_ADMIN has platform-wide master override
    if (user.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    const hasRole = requiredRoles.includes(user.role as UserRole);
    if (!hasRole) {
      throw new ForbiddenException({
        statusCode: 403,
        message: `Access denied: Role '${user.role}' lacks permission for this resource. Required: ${requiredRoles.join(", ")}`,
        messageGujarati: `ઍક્સેસ નકારવામાં આવ્યો: તમારી ભૂમિકા '${user.role}' પાસે આ ક્રિયા માટે પરવાનગી નથી.`,
      });
    }

    return true;
  }
}
