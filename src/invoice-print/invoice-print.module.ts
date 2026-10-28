import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { InvoicePrintService } from "./invoice-print.service";
import { InvoicePrintSettingsController } from "./invoice-print.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [InvoicePrintSettingsController],
  providers: [InvoicePrintService],
  exports: [InvoicePrintService],
})
export class InvoicePrintModule {}
