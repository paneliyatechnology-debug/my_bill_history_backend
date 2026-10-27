import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { VouchersModule } from "../vouchers/vouchers.module";
import { ExpensesController } from "./expenses.controller";

@Module({
  imports: [DatabaseModule, AuditModule, VouchersModule],
  controllers: [ExpensesController],
})
export class ExpensesModule {}
