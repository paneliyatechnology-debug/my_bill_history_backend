import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { BankAccountsController } from "./bank-accounts.controller";

@Module({
  imports: [DatabaseModule, AuditModule, LedgersModule],
  controllers: [BankAccountsController],
})
export class BankingModule {}
