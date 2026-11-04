import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { LedgersModule } from "../ledgers/ledgers.module";
import { InvoicesController } from "./invoices.controller";
import { SalesReturnsController } from "./sales-returns.controller";
import { InvoicesService } from "./invoices.service";
import { InvoicePrintModule } from "../invoice-print/invoice-print.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    LedgersModule,
    InvoicePrintModule,
    NotificationsModule,
  ],
  controllers: [InvoicesController, SalesReturnsController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
