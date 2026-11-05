import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import { NotificationsService } from "./notifications.service";

@Injectable()
export class ReminderSchedulerService {
  private readonly logger = new Logger(ReminderSchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly prisma: DatabaseService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Daily scheduled cron execution at 08:00 AM (server local time).
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async handleDailyCron() {
    this.logger.log("Executing daily automated due-date reminder scan (Today, T-3, T-7)...");
    await this.runDueRemindersScan();
  }

  /**
   * Runs the due reminder scan (DUE_TODAY, T-3, T-7) for all companies or a specific company.
   * Can be called by the scheduler or on-demand via the management API.
   */
  async runDueRemindersScan(targetCompanyId?: string): Promise<{
    salesRemindersCreated: number;
    purchaseRemindersCreated: number;
    companiesProcessed: number;
  }> {
    if (this.isRunning) {
      this.logger.warn("Reminder scan is already in progress, skipping concurrent run.");
      return { salesRemindersCreated: 0, purchaseRemindersCreated: 0, companiesProcessed: 0 };
    }

    this.isRunning = true;
    let salesRemindersCreated = 0;
    let purchaseRemindersCreated = 0;
    let companiesProcessed = 0;

    try {
      // Find companies to process
      const companies = await this.prisma.company.findMany({
        where: targetCompanyId ? { id: targetCompanyId } : {},
        select: { id: true, organizationId: true, tradeName: true, legalName: true },
      });

      for (const comp of companies) {
        companiesProcessed++;
        const res = await this.notificationsService.syncDueRemindersForCompany(
          comp.id,
          comp.organizationId,
        );
        salesRemindersCreated += res.salesRemindersCreated;
        purchaseRemindersCreated += res.purchaseRemindersCreated;
      }

      this.logger.log(
        `Reminder scan completed. Sales reminders: ${salesRemindersCreated}, Purchase reminders: ${purchaseRemindersCreated}, Companies: ${companiesProcessed}`,
      );

      return { salesRemindersCreated, purchaseRemindersCreated, companiesProcessed };
    } finally {
      this.isRunning = false;
    }
  }
}
