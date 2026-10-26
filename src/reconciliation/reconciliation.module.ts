import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";
import { InventoryReconciliationService } from "./inventory-reconciliation.service";
import { PerpetualInventoryService } from "./perpetual-inventory.service";
import { InventoryReconciliationController } from "./inventory-reconciliation.controller";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [InventoryReconciliationController],
  providers: [InventoryReconciliationService, PerpetualInventoryService],
  exports: [InventoryReconciliationService, PerpetualInventoryService],
})
export class ReconciliationModule {}
