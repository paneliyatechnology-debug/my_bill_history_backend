import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { InvoicePrintService } from "./invoice-print.service";
import { InvoicePrintSettingsController } from "./invoice-print.controller";
import { AiInvoiceStylerService } from "./ai-invoice-styler.service";

@Module({
  imports: [DatabaseModule],
  controllers: [InvoicePrintSettingsController],
  providers: [InvoicePrintService, AiInvoiceStylerService],
  exports: [InvoicePrintService, AiInvoiceStylerService],
})
export class InvoicePrintModule {}
