import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../common/decorators/public.decorator";
import { DatabaseService } from "../database/database.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: DatabaseService) {}

  @Public()
  @Get()
  getHealth() {
    return {
      status: "ok",
      service: "billing-api",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: "0.1.0",
    };
  }

  @Public()
  @Get("liveness")
  getLiveness() {
    return {
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get("readiness")
  async getReadiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: "ok",
        database: "connected",
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      throw new ServiceUnavailableException({
        status: "error",
        database: "disconnected",
        message: "PostgreSQL database connectivity check failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
