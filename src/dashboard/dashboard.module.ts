import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ReportsModule } from "../reports/reports.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  imports: [DatabaseModule, ReportsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
