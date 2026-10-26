import { Module } from "@nestjs/common";
import { SuperAdminController } from "./super-admin.controller";
import { SuperAdminService } from "./super-admin.service";
import { SuperAdminGuard } from "../common/guards/super-admin.guard";
import { SupportSessionRegistry } from "./support-session.registry";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule],
  controllers: [SuperAdminController],
  providers: [SuperAdminService, SuperAdminGuard, SupportSessionRegistry],
  exports: [SuperAdminService, SuperAdminGuard, SupportSessionRegistry],
})
export class SuperAdminModule {}
