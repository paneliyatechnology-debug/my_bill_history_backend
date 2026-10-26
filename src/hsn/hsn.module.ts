import { Module } from "@nestjs/common";
import { HsnController } from "./hsn.controller";
import { HsnService } from "./hsn.service";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [HsnController],
  providers: [HsnService],
  exports: [HsnService],
})
export class HsnModule {}
