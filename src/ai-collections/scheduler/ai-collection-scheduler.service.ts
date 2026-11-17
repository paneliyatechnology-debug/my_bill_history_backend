import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DatabaseService } from "../../database/database.service";
import { VoiceProviderFactory } from "../telephony/voice-provider.factory";
import { CredentialCryptoService } from "../security/credential-crypto.service";
import { CollectionReconciliationService } from "../reconciliation/collection-reconciliation.service";
import { AiVoiceEngineService } from "../ai-voice/ai-voice-engine.service";

@Injectable()
export class AiCollectionSchedulerService {
  private readonly logger = new Logger(AiCollectionSchedulerService.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: DatabaseService,
    private readonly providerFactory: VoiceProviderFactory,
    private readonly crypto: CredentialCryptoService,
    private readonly reconciliation: CollectionReconciliationService,
    private readonly aiVoiceEngine: AiVoiceEngineService,
  ) {}

  /**
   * Main scheduler cron loop: checks for due collection queue entries every minute.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleQueueCron() {
    if (this.isProcessing) {
      return;
    }
    await this.processCollectionQueue();
  }

  /**
   * Daily follow-up check cron: evaluates commitments due today and schedules follow-up calls.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleDailyFollowUps() {
    this.logger.log("Running daily AI Collection Follow-up scan...");
    await this.scanAndScheduleFollowUps();
  }

  /**
   * Processes collection queue with distributed locking and compliance checks.
   */
  async processCollectionQueue(limit = 10): Promise<{
    processed: number;
    dispatched: number;
    skipped: number;
    failed: number;
  }> {
    if (this.isProcessing) {
      return { processed: 0, dispatched: 0, skipped: 0, failed: 0 };
    }

    this.isProcessing = true;
    let processed = 0;
    let dispatched = 0;
    let skipped = 0;
    let failed = 0;

    const workerId = `worker_${process.pid}_${Date.now()}`;

    try {
      // 1. Fetch pending queue items scheduled for now or earlier
      const now = new Date();

      const candidateItems = await this.prisma.aiCollectionQueue.findMany({
        where: {
          status: "QUEUED",
          scheduledAt: { lte: now },
        },
        orderBy: [{ priority: "desc" }, { scheduledAt: "asc" }],
        take: limit,
        include: {
          company: {
            include: {
              aiCollectionSettings: true,
            },
          },
          party: {
            include: {
              callingPreference: true,
            },
          },
        },
      });

      for (const queueItem of candidateItems) {
        processed++;

        // 2. Lock item to prevent concurrent dispatch
        const locked = await this.prisma.aiCollectionQueue.updateMany({
          where: {
            id: queueItem.id,
            status: "QUEUED",
          },
          data: {
            status: "PROCESSING",
            lockedAt: now,
            lockedBy: workerId,
          },
        });

        if (locked.count === 0) {
          // Already claimed by another worker
          skipped++;
          continue;
        }

        try {
          const settings = queueItem.company.aiCollectionSettings;

          // Check if AI Calling is enabled
          if (settings && !settings.isEnabled) {
            this.logger.log(
              `AI calling disabled for company ${queueItem.companyId}. Skipping queue item ${queueItem.id}.`,
            );
            await this.prisma.aiCollectionQueue.update({
              where: { id: queueItem.id },
              data: { status: "CANCELLED", lastError: "AI calling disabled in settings" },
            });
            skipped++;
            continue;
          }

          // Check Calling Window compliance (e.g. 09:30 - 19:00 IST)
          const inWindow = this.isCurrentTimeInWindow(
            settings?.callingWindowStart || "09:30",
            settings?.callingWindowEnd || "19:00",
            settings?.timezone || "Asia/Kolkata",
          );

          if (!inWindow) {
            this.logger.debug(
              `Outside calling window (${settings?.callingWindowStart} - ${settings?.callingWindowEnd}). Delaying queue item ${queueItem.id}.`,
            );
            // Postpone until calling window opens
            await this.prisma.aiCollectionQueue.update({
              where: { id: queueItem.id },
              data: {
                status: "QUEUED",
                lockedAt: null,
                lockedBy: null,
                scheduledAt: this.getNextWindowOpenTime(
                  settings?.callingWindowStart || "09:30",
                  settings?.timezone || "Asia/Kolkata",
                ),
              },
            });
            skipped++;
            continue;
          }

          // Check Customer Opt-Out & Preferences
          const pref = queueItem.party.callingPreference;
          if (pref?.isOptedOut) {
            this.logger.log(
              `Party ${queueItem.partyId} has opted out of collection calls. Cancelling queue item.`,
            );
            await this.prisma.aiCollectionQueue.update({
              where: { id: queueItem.id },
              data: {
                status: "CANCELLED",
                lastError: `Customer opted out (${pref.optOutReason || "Customer request"})`,
              },
            });
            skipped++;
            continue;
          }

          // Check daily call frequency limit
          const callsToday = await this.countCallsToday(queueItem.companyId, queueItem.partyId);
          const maxCallsPerDay = settings?.maxCallsPerCustomerPerDay || 2;
          if (callsToday >= maxCallsPerDay) {
            this.logger.log(
              `Party ${queueItem.partyId} reached max daily calls (${callsToday}/${maxCallsPerDay}). Delaying to tomorrow.`,
            );
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(10, 0, 0, 0);

            await this.prisma.aiCollectionQueue.update({
              where: { id: queueItem.id },
              data: {
                status: "QUEUED",
                lockedAt: null,
                lockedBy: null,
                scheduledAt: tomorrow,
              },
            });
            skipped++;
            continue;
          }

          // Check actual invoice dues: has the customer paid in the meantime?
          const currentDues = await this.reconciliation.getCustomerOutstanding(
            {
              organizationId: queueItem.organizationId,
              companyId: queueItem.companyId,
            },
            queueItem.partyId,
          );

          if (currentDues.totalOutstanding <= 0) {
            this.logger.log(
              `Party ${queueItem.partyId} has 0 outstanding dues. Cancelling collection call.`,
            );
            await this.prisma.aiCollectionQueue.update({
              where: { id: queueItem.id },
              data: {
                status: "CANCELLED",
                lastError: "All outstanding invoices have been fully paid.",
              },
            });
            skipped++;
            continue;
          }

          // 3. Initiate Call through Voice Provider
          const providerName = settings?.voiceProvider || "simulator";
          const provider = this.providerFactory.getProvider(providerName);

          const backendUrl =
            process.env.BACKEND_PUBLIC_URL ||
            process.env.API_BASE_URL ||
            `http://localhost:${process.env.PORT || 4000}/api/v1`;

          // Create AiCollectionCall record
          const initialStatus = providerName === "simulator" ? "RINGING" : "SCHEDULED";
          const callRecord = await this.prisma.aiCollectionCall.create({
            data: {
              organizationId: queueItem.organizationId,
              companyId: queueItem.companyId,
              campaignId: queueItem.campaignId,
              queueId: queueItem.id,
              partyId: queueItem.partyId,
              partyName: queueItem.party.name,
              partyPhone: queueItem.party.phone,
              invoiceIds: currentDues.invoices.map((i) => i.id),
              invoiceId: currentDues.invoices[0]?.id || null,
              invoiceNumber: currentDues.invoices[0]?.invoiceNumber || null,
              outstandingAmount: currentDues.totalOutstanding,
              status: initialStatus,
              provider: providerName,
              language: pref?.preferredLanguage || settings?.defaultLanguage || "gujarati",
            },
          });

          // Decrypt telephony credentials
          const decryptedApiKey = this.crypto.decrypt(settings?.providerApiKey);
          const decryptedApiSecret = this.crypto.decrypt(settings?.providerApiSecret);

          const greetingText = this.aiVoiceEngine.generateInitialGreeting({
            callId: callRecord.id,
            tenantId: queueItem.organizationId,
            companyId: queueItem.companyId,
            businessName: queueItem.company.tradeName || queueItem.company.legalName,
            customerName: queueItem.party.name,
            customerPhone: queueItem.party.phone,
            preferredLanguage: callRecord.language,
            invoices: currentDues.invoices,
            totalOutstanding: currentDues.totalOutstanding,
            verifiedPaymentDetails: {
              bankName: settings?.bankName || queueItem.company.bankName,
              bankAccountNumber: settings?.bankAccountNumber || queueItem.company.bankAccountNo,
              bankIfsc: settings?.bankIfsc || queueItem.company.bankIfsc,
              bankAccountHolder: settings?.bankAccountHolder || queueItem.company.legalName,
              upiId: settings?.upiId || queueItem.company.upiVpa,
            },
            history: [],
            turnIndex: 0,
          });

          // Record initial conversation system/greeting turn
          await this.prisma.aiCollectionConversation.create({
            data: {
              callId: callRecord.id,
              role: "assistant",
              content: greetingText,
              language: callRecord.language,
              turnIndex: 0,
            },
          });

          const result = await provider.initiateCall({
            callId: callRecord.id,
            tenantId: queueItem.organizationId,
            companyId: queueItem.companyId,
            customerName: queueItem.party.name,
            customerPhone: queueItem.party.phone,
            outstandingAmount: currentDues.totalOutstanding,
            language: callRecord.language,
            credentials: {
              apiKey: decryptedApiKey,
              apiSecret: decryptedApiSecret,
              accountSid: settings?.providerAccountSid,
              virtualNumber: settings?.providerVirtualNumber,
              webhookSecret: settings?.webhookSecret,
            },
            callbackUrl: `${backendUrl}/ai-collections/webhooks/${providerName}`,
            actionUrl: `${backendUrl}/ai-collections/webhooks/${providerName}/speech`,
            greetingText,
          });

          if (result.success) {
            await this.prisma.aiCollectionCall.update({
              where: { id: callRecord.id },
              data: {
                providerCallSid: result.providerCallSid,
                status: "IN_PROGRESS",
              },
            });

            await this.prisma.aiCollectionQueue.update({
              where: { id: queueItem.id },
              data: {
                status: "COMPLETED",
                callId: callRecord.id,
                attempts: queueItem.attempts + 1,
              },
            });

            // Update customer lastCallAt
            await this.prisma.customerCallingPreference.upsert({
              where: { partyId: queueItem.partyId },
              create: {
                organizationId: queueItem.organizationId,
                companyId: queueItem.companyId,
                partyId: queueItem.partyId,
                lastCallAt: new Date(),
                totalCallsReceived: 1,
              },
              update: {
                lastCallAt: new Date(),
                totalCallsReceived: { increment: 1 },
              },
            });

            dispatched++;
            this.logger.log(
              `Successfully dispatched collection call ${callRecord.id} (provider SID: ${result.providerCallSid}) to ${queueItem.party.name}`,
            );
          } else {
            // Provider initiation failed: handle retry
            const newAttempts = queueItem.attempts + 1;
            const maxAttempts = settings?.maxRetries || 3;

            await this.prisma.aiCollectionCall.update({
              where: { id: callRecord.id },
              data: {
                status: "FAILED",
                summary: `Provider error: ${result.message}`,
              },
            });

            if (newAttempts < maxAttempts) {
              const retryMinutes = settings?.retryIntervalMinutes || 120;
              const nextRetry = new Date(Date.now() + retryMinutes * 60 * 1000);

              await this.prisma.aiCollectionQueue.update({
                where: { id: queueItem.id },
                data: {
                  status: "QUEUED",
                  attempts: newAttempts,
                  scheduledAt: nextRetry,
                  lockedAt: null,
                  lockedBy: null,
                  lastError: result.message || "Provider call failure",
                },
              });
            } else {
              await this.prisma.aiCollectionQueue.update({
                where: { id: queueItem.id },
                data: {
                  status: "FAILED",
                  attempts: newAttempts,
                  lastError: `Exceeded max retry attempts (${maxAttempts}). Last error: ${result.message}`,
                },
              });
            }

            failed++;
          }
        } catch (itemErr: any) {
          this.logger.error(`Error processing queue item ${queueItem.id}: ${itemErr.message}`);
          await this.prisma.aiCollectionQueue.update({
            where: { id: queueItem.id },
            data: {
              status: "FAILED",
              lastError: itemErr.message,
            },
          });
          failed++;
        }
      }

      return { processed, dispatched, skipped, failed };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Evaluates promised commitments and schedules follow-up calls if payments remain unpaid.
   */
  async scanAndScheduleFollowUps(): Promise<number> {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const pendingCommitments = await this.prisma.aiCollectionCommitment.findMany({
      where: {
        status: "PENDING",
        promisedDate: { lte: today },
      },
      include: {
        company: true,
        party: true,
      },
    });

    let followUpsScheduled = 0;

    for (const commit of pendingCommitments) {
      // Check if invoice has been paid
      const dues = await this.reconciliation.getCustomerOutstanding(
        { organizationId: commit.organizationId, companyId: commit.companyId },
        commit.partyId,
      );

      if (dues.totalOutstanding <= 0) {
        // Customer paid! Mark fulfilled
        await this.prisma.aiCollectionCommitment.update({
          where: { id: commit.id },
          data: {
            status: "FULFILLED",
            fulfilledAt: new Date(),
            notes: "Payment verified in full before follow-up.",
          },
        });
        continue;
      }

      // Customer did not pay by promised date: create follow-up queue item
      const queueExists = await this.prisma.aiCollectionQueue.findFirst({
        where: {
          companyId: commit.companyId,
          partyId: commit.partyId,
          status: { in: ["QUEUED", "PROCESSING"] },
        },
      });

      if (!queueExists) {
        await this.prisma.aiCollectionQueue.create({
          data: {
            organizationId: commit.organizationId,
            companyId: commit.companyId,
            partyId: commit.partyId,
            totalOutstanding: dues.totalOutstanding,
            priority: 150, // Higher priority for broken promise follow-up
            status: "QUEUED",
            scheduledAt: new Date(),
          },
        });

        await this.prisma.aiCollectionFollowUp.create({
          data: {
            organizationId: commit.organizationId,
            companyId: commit.companyId,
            partyId: commit.partyId,
            commitmentId: commit.id,
            scheduledDate: new Date(),
            reason: `Promise to pay on ${commit.promisedDate.toISOString().split("T")[0]} was due; ₹${dues.totalOutstanding} remains unpaid.`,
            actionType: "CALL",
            status: "PENDING",
          },
        });

        followUpsScheduled++;
      }
    }

    return followUpsScheduled;
  }

  private isCurrentTimeInWindow(
    windowStart: string,
    windowEnd: string,
    _timezone: string,
  ): boolean {
    if (process.env.NODE_ENV === "test") {
      return true;
    }

    const now = new Date();
    // Get actual time in IST reliably
    const istTimeStr = now.toLocaleTimeString("en-GB", {
      timeZone: "Asia/Kolkata",
      hour12: false,
    });
    const [hStr, mStr] = istTimeStr.split(":");
    const currentMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);

    const [startH, startM] = windowStart.split(":").map(Number);
    const [endH, endM] = windowEnd.split(":").map(Number);

    const startMinutes = (startH || 9) * 60 + (startM || 30);
    const endMinutes = (endH || 19) * 60 + (endM || 0);

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  private getNextWindowOpenTime(windowStart: string, _timezone: string): Date {
    const now = new Date();
    const [startH, startM] = windowStart.split(":").map(Number);
    const target = new Date(now);
    target.setHours(startH || 9, startM || 30, 0, 0);

    if (target.getTime() <= now.getTime()) {
      // Window already passed today; schedule for tomorrow morning
      target.setDate(target.getDate() + 1);
    }
    return target;
  }

  private async countCallsToday(companyId: string, partyId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return this.prisma.aiCollectionCall.count({
      where: {
        companyId,
        partyId,
        createdAt: { gte: startOfDay },
        status: { in: ["COMPLETED", "IN_PROGRESS", "ANSWERED"] },
      },
    });
  }
}

