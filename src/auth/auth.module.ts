import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { EmailOtpService } from "./email-otp.service";

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>("JWT_SECRET");
        if (config.get<string>("NODE_ENV") === "production") {
          if (!secret || secret.length < 32) {
            throw new Error(
              "FATAL: JWT_SECRET environment variable must be set and at least 32 characters long in production mode.",
            );
          }
        }
        return {
          secret:
            secret ||
            "dev-super-secure-jwt-secret-key-at-least-32-chars-long-123456",
          signOptions: {
            expiresIn: (config.get<string>("JWT_EXPIRES_IN") || "1d") as any,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, EmailOtpService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
