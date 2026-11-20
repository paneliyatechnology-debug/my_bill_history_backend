import { Module, forwardRef } from "@nestjs/common";
import { StockTransfersService } from "./stock-transfers.service";
import { StockTransfersController } from "./stock-transfers.controller";
import { DeliveryChallansService } from "./delivery-challans.service";
import { DeliveryChallansController } from "./delivery-challans.controller";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { InvoicesModule } from "../invoices/invoices.module";

@Module({
  imports: [DatabaseModule, AuditModule, forwardRef(() => InvoicesModule)],
  controllers: [StockTransfersController, DeliveryChallansController],
  providers: [StockTransfersService, DeliveryChallansService],
  exports: [StockTransfersService, DeliveryChallansService],
})
export class DistributionModule {}
