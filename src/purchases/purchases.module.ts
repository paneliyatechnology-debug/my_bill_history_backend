import { Module } from "@nestjs/common";
import { PurchasesController } from "./purchases.controller";
import { PurchaseReturnsController } from "./purchase-returns.controller";
import { PurchasesService } from "./purchases.service";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { PurchaseScansController } from "./scanner/purchase-scans.controller";
import { PurchaseScannerService } from "./scanner/services/purchase-scanner.service";
import { BillStorageService } from "./scanner/services/bill-storage.service";
import { BillNormalizerService } from "./scanner/services/bill-normalizer.service";
import { BillMatcherService } from "./scanner/services/bill-matcher.service";
import { MockOcrProvider } from "./scanner/providers/mock-ocr.provider";
import { GeminiOcrProvider } from "./scanner/providers/gemini-ocr.provider";
import { LocalDocumentOcrProvider } from "./scanner/providers/local-document-ocr.provider";
import { OcrProviderFactory } from "./scanner/providers/ocr-provider.factory";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [
    PurchasesController,
    PurchaseReturnsController,
    PurchaseScansController,
  ],
  providers: [
    PurchasesService,
    PurchaseScannerService,
    BillStorageService,
    BillNormalizerService,
    BillMatcherService,
    MockOcrProvider,
    GeminiOcrProvider,
    LocalDocumentOcrProvider,
    OcrProviderFactory,
  ],
  exports: [PurchasesService, PurchaseScannerService],
})
export class PurchasesModule {}

