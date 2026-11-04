import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DatabaseModule } from "../database/database.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { WebPushService } from "./web-push.service";
import { ReminderSchedulerService } from "./reminder-scheduler.service";

@Module({
  imports: [
    DatabaseModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    WebPushService,
    ReminderSchedulerService,
  ],
  exports: [
    NotificationsService,
    WebPushService,
    ReminderSchedulerService,
  ],
})
export class NotificationsModule {}

