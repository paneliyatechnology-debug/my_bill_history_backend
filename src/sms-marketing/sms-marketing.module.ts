import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { SmsMarketingController } from "./sms-marketing.controller";
import { SmsMarketingService } from "./sms-marketing.service";

@Module({
  imports: [DatabaseModule],
  controllers: [SmsMarketingController],
  providers: [SmsMarketingService],
  exports: [SmsMarketingService],
})
export class SmsMarketingModule {}

