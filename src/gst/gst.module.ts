import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { InvoicePrintModule } from "../invoice-print/invoice-print.module";
import { GstController } from "./gst.controller";
import { EInvoicesController, EInvoicesSettingsController } from "./e-invoices.controller";
import { GstPortalService } from "./gst-portal.service";
import { GstDocumentsService } from "./gst-documents.service";
import { Gstr2bService } from "./gstr2b.service";
import { GstVerificationService } from "./gst-verification.service";
import { EInvoicesService } from "./e-invoices.service";

@Module({
  imports: [DatabaseModule, InvoicePrintModule],
  controllers: [
    GstController,
    EInvoicesController,
    EInvoicesSettingsController,
  ],
  providers: [
    Gstr2bService,
    GstPortalService,
    GstDocumentsService,
    GstVerificationService,
    EInvoicesService,
  ],
  exports: [
    Gstr2bService,
    GstPortalService,
    GstDocumentsService,
    GstVerificationService,
    EInvoicesService,
  ],
})
export class GstModule {}
