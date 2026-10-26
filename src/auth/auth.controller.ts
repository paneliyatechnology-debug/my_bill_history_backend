import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { SwitchContextDto } from "./dto/switch-context.dto";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({
    default: { limit: process.env.NODE_ENV === "test" ? 1000 : 5, ttl: 60000 },
  })
  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({
    default: { limit: process.env.NODE_ENV === "test" ? 1000 : 5, ttl: 60000 },
  })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: FastifyRequest) {
    const ip = req.ip || req.headers["x-forwarded-for"]?.toString();
    const userAgent = req.headers["user-agent"] || undefined;
    return this.authService.login(dto, ip, userAgent);
  }

  @Get("me")
  async getMe(@CurrentUser("id") userId: string) {
    return this.authService.getMe(userId);
  }

  @Post("switch-context")
  @HttpCode(HttpStatus.OK)
  async switchContext(
    @CurrentUser("id") userId: string,
    @Body() dto: SwitchContextDto,
  ) {
    return this.authService.switchContext(userId, dto);
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser("id") userId: string) {
    return this.authService.logout(userId);
  }

  @Public()
  @Throttle({
    default: { limit: process.env.NODE_ENV === "test" ? 1000 : 5, ttl: 60000 },
  })
  @Post("otp/send")
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Body() body: { email?: string; purpose?: string; phone?: string }) {
    const purpose = body?.purpose;
    if (purpose !== "REGISTER" && purpose !== "PASSWORD_RESET") {
      throw new BadRequestException({
        statusCode: 400,
        message: "Choose a valid email code purpose.",
        messageGujarati: "માન્ય ઈમેલ કોડનો હેતુ પસંદ કરો.",
      });
    }
    return this.authService.sendPublicOtp({
      email: body.email || "",
      purpose,
      phone: body.phone,
    });
  }

  @Public()
  @Throttle({
    default: { limit: process.env.NODE_ENV === "test" ? 1000 : 5, ttl: 60000 },
  })
  @Post("password/reset")
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() body: { email?: string; otp?: string; newPassword?: string },
  ) {
    return this.authService.resetPassword({
      email: body?.email || "",
      otp: body?.otp || "",
      newPassword: body?.newPassword || "",
    });
  }

  @Throttle({
    default: { limit: process.env.NODE_ENV === "test" ? 1000 : 5, ttl: 60000 },
  })
  @Post("email/send-otp")
  @HttpCode(HttpStatus.OK)
  async sendEmailChangeOtp(@Body() body: { email?: string }) {
    return this.authService.sendEmailChangeOtp(body?.email || "");
  }

  @Post("password/change")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser("id") userId: string,
    @Body() body: { currentPassword?: string; newPassword?: string },
  ) {
    return this.authService.changePassword(userId, {
      currentPassword: body?.currentPassword || "",
      newPassword: body?.newPassword || "",
    });
  }

  @Patch("profile")
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @CurrentUser("id") userId: string,
    @Body() body: { fullName?: string; email?: string; otp?: string },
  ) {
    return this.authService.updateProfile(userId, body || {});
  }
}
