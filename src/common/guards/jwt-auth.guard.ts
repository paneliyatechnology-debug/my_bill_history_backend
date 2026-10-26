import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException({
        statusCode: 401,
        message:
          "Missing or malformed Authorization header. Bearer token required.",
        messageGujarati: "ઓથોરાઇઝેશન ટોકન મળ્યું નથી. કૃપા કરીને લોગિન કરો.",
      });
    }

    const token = authHeader.substring(7);
    try {
      const secret = this.configService.get<string>(
        "JWT_SECRET",
        "dev-super-secure-jwt-secret-key-at-least-32-chars-long-123456",
      );
      const payload = await this.jwtService.verifyAsync(token, { secret });
      request.user = {
        ...payload,
        id: payload.id || payload.userId || payload.sub,
      };
      return true;
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        message: "Invalid or expired authorization token.",
        messageGujarati: "ઓથોરાઇઝેશન ટોકન અમાન્ય અથવા એક્સપાયર થયેલ છે.",
      });
    }
  }
}
