import { Module } from "@nestjs/common";
import { BomService } from "./bom.service";
import { BomController } from "./bom.controller";
import { ProductionOrdersService } from "./production-orders.service";
import { ProductionOrdersController } from "./production-orders.controller";
import { DatabaseModule } from "../database/database.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [BomController, ProductionOrdersController],
  providers: [BomService, ProductionOrdersService],
  exports: [BomService, ProductionOrdersService],
})
export class ManufacturingModule {}
