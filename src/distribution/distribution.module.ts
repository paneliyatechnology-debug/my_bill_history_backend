import { Module } from "@nestjs/common";
import { StockTransfersService } from "./stock-transfers.service";
import { StockTransfersController } from "./stock-transfers.controller";
import { DeliveryChallansService } from "./delivery-challans.service";
import { DeliveryChallansController } from "./delivery-challans.controller";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [StockTransfersController, DeliveryChallansController],
  providers: [StockTransfersService, DeliveryChallansService],
  exports: [StockTransfersService, DeliveryChallansService],
})
export class DistributionModule {}
