import { Module, forwardRef } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DatabaseModule } from "../database/database.module";
import { AuthModule } from "../auth/auth.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { WebPushService } from "./web-push.service";
import { ReminderSchedulerService } from "./reminder-scheduler.service";

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => AuthModule),
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

