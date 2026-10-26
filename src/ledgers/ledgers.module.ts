import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { LedgersService } from "./ledgers.service";
import { LedgersController } from "./ledgers.controller";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [LedgersController],
  providers: [LedgersService],
  exports: [LedgersService],
})
export class LedgersModule {}
