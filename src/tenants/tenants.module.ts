import { Module } from "@nestjs/common";
import { TenantsService } from "./tenants.service";
import { TenantsController } from "./tenants.controller";
import { WarehousesController } from "./warehouses.controller";
import { CompanyAssetsService } from "./company-assets.service";
import { LedgersModule } from "../ledgers/ledgers.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [LedgersModule, AuthModule],
  controllers: [TenantsController, WarehousesController],
  providers: [TenantsService, CompanyAssetsService],
  exports: [TenantsService],
})
export class TenantsModule {}
