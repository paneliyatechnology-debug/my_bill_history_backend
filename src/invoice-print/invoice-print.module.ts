import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { InvoicePrintService } from "./invoice-print.service";
import { InvoicePrintSettingsController } from "./invoice-print.controller";
import { AiInvoiceStylerService } from "./ai-invoice-styler.service";
import { InvoiceThemeManagerService } from "./invoice-theme-manager.service";

@Module({
  imports: [DatabaseModule],
  controllers: [InvoicePrintSettingsController],
  providers: [InvoicePrintService, AiInvoiceStylerService, InvoiceThemeManagerService],
  exports: [InvoicePrintService, AiInvoiceStylerService, InvoiceThemeManagerService],
})
export class InvoicePrintModule {}
