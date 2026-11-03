import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { AutomatedBillingService } from "./automated-billing.service";
import { AutomatedBillingController } from "./automated-billing.controller";

@Module({
  imports: [DatabaseModule, InvoicesModule],
  controllers: [AutomatedBillingController],
  providers: [AutomatedBillingService],
  exports: [AutomatedBillingService],
})
export class AutomatedBillingModule {}
