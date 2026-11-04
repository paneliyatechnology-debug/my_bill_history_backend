import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import { NotificationsService } from "./notifications.service";
import { NotificationType } from "@prisma/client";

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
    this.logger.log("Executing daily automated due-date reminder scan (T-3 days)...");
    await this.runDueRemindersScan();
  }

  /**
   * Runs the T-3 calendar day due reminder scan for all companies or a specific company.
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

      // Target calendar date: exactly 3 calendar days from today
      const today = new Date();
      const targetDueDate = new Date(today);
      targetDueDate.setDate(today.getDate() + 3);
      targetDueDate.setHours(0, 0, 0, 0);

      const nextDayOfTarget = new Date(targetDueDate);
      nextDayOfTarget.setDate(targetDueDate.getDate() + 1);

      const targetDueDateString = targetDueDate.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      for (const comp of companies) {
        companiesProcessed++;

        // =====================================================================
        // 1. SALES INVOICES: Due in 3 calendar days with positive outstanding balance
        // =====================================================================
        const eligibleSalesInvoices = await this.prisma.salesInvoice.findMany({
          where: {
            companyId: comp.id,
            status: { notIn: ["CANCELLED", "DRAFT", "PAID"] },
            balanceAmount: { gt: 0 },
            dueDate: {
              gte: targetDueDate,
              lt: nextDayOfTarget,
            },
          },
          include: { party: true },
        });

        for (const invoice of eligibleSalesInvoices) {
          const outstanding = Number(invoice.balanceAmount);
          if (outstanding <= 0) continue;

          // Check if T-3 reminder has already been logged for this invoice and due date
          const existingLog = await this.prisma.scheduledReminderLog.findUnique({
            where: {
              companyId_entityType_entityId_reminderType_dueDate: {
                companyId: comp.id,
                entityType: "SALES_INVOICE",
                entityId: invoice.id,
                reminderType: "T_MINUS_3",
                dueDate: targetDueDate,
              },
            },
          });

          if (existingLog) {
            continue;
          }

          // Format notification message
          const partyName = invoice.party?.name || "Customer";
          const formattedAmount = `₹${outstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
          const title = "Invoice Due in 3 Days";
          const message = `Invoice Due in 3 Days: ${partyName} — ${invoice.invoiceNumber} — Outstanding ${formattedAmount} — Due ${targetDueDateString}.`;

          const created = await this.notificationsService.createNotification({
            organizationId: comp.organizationId,
            companyId: comp.id,
            type: NotificationType.INVOICE_DUE_REMINDER,
            title,
            message,
            entityType: "SALES_INVOICE",
            entityId: invoice.id,
            data: {
              invoiceNumber: invoice.invoiceNumber,
              partyName,
              outstandingAmount: outstanding,
              currency: "INR",
              dueDate: invoice.dueDate,
              reminderType: "T_MINUS_3",
              action: "OPEN_INVOICE",
            },
            deepLink: `/sales/invoices/${invoice.id}`,
          });

          // Log reminder to enforce atomic database-level uniqueness
          await this.prisma.scheduledReminderLog.create({
            data: {
              organizationId: comp.organizationId,
              companyId: comp.id,
              entityType: "SALES_INVOICE",
              entityId: invoice.id,
              reminderType: "T_MINUS_3",
              dueDate: targetDueDate,
              status: "SENT",
              outstandingAmount: outstanding,
              notificationId: created[0]?.id || null,
            },
          });

          salesRemindersCreated++;
        }

        // =====================================================================
        // 2. PURCHASE INVOICES: Due in 3 calendar days with positive payable balance
        // =====================================================================
        const eligiblePurchaseInvoices = await this.prisma.purchaseInvoice.findMany({
          where: {
            companyId: comp.id,
            balanceAmount: { gt: 0 },
            dueDate: {
              gte: targetDueDate,
              lt: nextDayOfTarget,
            },
          },
          include: { party: true },
        });

        for (const bill of eligiblePurchaseInvoices) {
          const outstanding = Number(bill.balanceAmount);
          if (outstanding <= 0) continue;

          // Check if T-3 reminder has already been logged for this purchase bill
          const existingLog = await this.prisma.scheduledReminderLog.findUnique({
            where: {
              companyId_entityType_entityId_reminderType_dueDate: {
                companyId: comp.id,
                entityType: "PURCHASE_INVOICE",
                entityId: bill.id,
                reminderType: "T_MINUS_3",
                dueDate: targetDueDate,
              },
            },
          });

          if (existingLog) {
            continue;
          }

          const partyName = bill.party?.name || "Supplier";
          const formattedAmount = `₹${outstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
          const title = "Purchase Bill Due in 3 Days";
          const message = `Purchase Bill Due in 3 Days: ${partyName} — ${bill.vendorInvoiceNumber} — Payable ${formattedAmount} — Due ${targetDueDateString}.`;

          const created = await this.notificationsService.createNotification({
            organizationId: comp.organizationId,
            companyId: comp.id,
            type: NotificationType.PURCHASE_DUE_REMINDER,
            title,
            message,
            entityType: "PURCHASE_INVOICE",
            entityId: bill.id,
            data: {
              vendorInvoiceNumber: bill.vendorInvoiceNumber,
              partyName,
              payableAmount: outstanding,
              currency: "INR",
              dueDate: bill.dueDate,
              reminderType: "T_MINUS_3",
              action: "OPEN_PURCHASE_BILL",
            },
            deepLink: `/purchases/${bill.id}`,
          });

          await this.prisma.scheduledReminderLog.create({
            data: {
              organizationId: comp.organizationId,
              companyId: comp.id,
              entityType: "PURCHASE_INVOICE",
              entityId: bill.id,
              reminderType: "T_MINUS_3",
              dueDate: targetDueDate,
              status: "SENT",
              outstandingAmount: outstanding,
              notificationId: created[0]?.id || null,
            },
          });

          purchaseRemindersCreated++;
        }
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
