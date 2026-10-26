import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { VouchersService } from "./vouchers.service";
import { VouchersController } from "./vouchers.controller";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [VouchersController],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}
