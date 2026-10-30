import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { InvoicePrintService } from "./invoice-print.service";
import { InvoicePrintSettingsController } from "./invoice-print.controller";
import { AiInvoiceStylerService } from "./ai-invoice-styler.service";
import { InvoiceThemeManagerService } from "./invoice-theme-manager.service";

import { InvoicePdfService } from "./invoice-pdf.service";

@Module({
  imports: [DatabaseModule],
  controllers: [InvoicePrintSettingsController],
  providers: [
    InvoicePrintService,
    AiInvoiceStylerService,
    InvoiceThemeManagerService,
    InvoicePdfService,
  ],
  exports: [
    InvoicePrintService,
    AiInvoiceStylerService,
    InvoiceThemeManagerService,
    InvoicePdfService,
  ],
})
export class InvoicePrintModule {}
