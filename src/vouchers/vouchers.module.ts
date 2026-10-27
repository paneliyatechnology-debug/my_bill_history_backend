import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { VouchersService } from "./vouchers.service";
import { VouchersController } from "./vouchers.controller";
import { SalesPaymentInController } from "./sales-payment-in.controller";
import { PurchasesPaymentOutController } from "./purchases-payment-out.controller";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [
    VouchersController,
    SalesPaymentInController,
    PurchasesPaymentOutController,
  ],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}

