import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContext } from "@billing/shared-types";
import { CredentialCryptoService } from "./security/credential-crypto.service";
import { VoiceProviderFactory } from "./telephony/voice-provider.factory";
import { AiVoiceEngineService } from "./ai-voice/ai-voice-engine.service";
import { CollectionReconciliationService } from "./reconciliation/collection-reconciliation.service";
import { AiCollectionSchedulerService } from "./scheduler/ai-collection-scheduler.service";
import {
  UpdateAiCollectionSettingsDto,
  TestCallDto,
} from "./dto/ai-collection-settings.dto";
import { ScheduleCallsDto } from "./dto/schedule-calls.dto";
import { QueryCallsDto, QueryPendingDuesDto } from "./dto/query-calls.dto";
import { UpdateCustomerCallingPreferenceDto } from "./dto/customer-preference.dto";
import { CreateFollowUpDto, UpdateFollowUpDto } from "./dto/follow-up.dto";

@Injectable()
export class AiCollectionsService {
  private readonly logger = new Logger(AiCollectionsService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly crypto: CredentialCryptoService,
    private readonly providerFactory: VoiceProviderFactory,
    private readonly aiVoiceEngine: AiVoiceEngineService,
    private readonly reconciliation: CollectionReconciliationService,
    private readonly scheduler: AiCollectionSchedulerService,
  ) {}

  // ==========================================================================
  // 1. Overview & Metrics
  // ==========================================================================
  async getOverview(ctx: TenantContext) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Invoices & Outstanding
      const unpaidInvoices = await tx.salesInvoice.findMany({
        where: {
          companyId: ctx.companyId,
          status: { in: ["ISSUED", "PARTIALLY_PAID"] },
          balanceAmount: { gt: 0 },
        },
        select: {
          partyId: true,
          balanceAmount: true,
          grandTotal: true,
        },
      });

      const uniqueCustomerIds = new Set(unpaidInvoices.map((i) => i.partyId));
      const totalOutstanding = unpaidInvoices.reduce(
        (acc, inv) => acc + Number(inv.balanceAmount),
        0,
      );

      // 2. Calling metrics
      const [
        totalCalls,
        completedCalls,
        failedCalls,
        scheduledCalls,
        promisesRecorded,
        commitments,
        staffTasksOpen,
      ] = await Promise.all([
        tx.aiCollectionCall.count({ where: { companyId: ctx.companyId } }),
        tx.aiCollectionCall.count({
          where: { companyId: ctx.companyId, status: "COMPLETED" },
        }),
        tx.aiCollectionCall.count({
          where: {
            companyId: ctx.companyId,
            status: { in: ["FAILED", "NO_ANSWER", "BUSY"] },
          },
        }),
        tx.aiCollectionQueue.count({
          where: { companyId: ctx.companyId, status: "QUEUED" },
        }),
        tx.aiCollectionCommitment.count({
          where: { companyId: ctx.companyId },
        }),
        tx.aiCollectionCommitment.findMany({
          where: { companyId: ctx.companyId },
          select: { status: true, promisedAmount: true, fulfilledAmount: true },
        }),
        tx.aiCollectionStaffTask.count({
          where: { companyId: ctx.companyId, status: "OPEN" },
        }),
      ]);

      const successfulPromises = commitments.filter(
        (c) => c.status === "FULFILLED" || c.status === "PARTIALLY_FULFILLED",
      ).length;

      const totalRecovered = commitments.reduce(
        (acc, c) => acc + Number(c.fulfilledAmount || 0),
        0,
      );

      // 3. Recent AI calls activity
      const recentCalls = await tx.aiCollectionCall.findMany({
        where: { companyId: ctx.companyId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          partyName: true,
          partyPhone: true,
          invoiceNumber: true,
          outstandingAmount: true,
          status: true,
          customerIntent: true,
          customerResponse: true,
          promisedDate: true,
          promisedAmount: true,
          nextFollowUpDate: true,
          durationSeconds: true,
          summary: true,
          createdAt: true,
        },
      });

      // 4. Performance breakdown
      const answeredCalls = await tx.aiCollectionCall.count({
        where: {
          companyId: ctx.companyId,
          status: { in: ["COMPLETED", "IN_PROGRESS", "ANSWERED"] },
        },
      });

      const noAnswerCalls = await tx.aiCollectionCall.count({
        where: {
          companyId: ctx.companyId,
          status: { in: ["NO_ANSWER", "BUSY", "FAILED"] },
        },
      });

      return {
        summary: {
          totalOutstanding,
          customersWithPendingDues: uniqueCustomerIds.size,
          aiCallsScheduled: scheduledCalls,
          callsCompleted: completedCalls,
          successfulPaymentCommitments: promisesRecorded,
          paymentsCollectedThroughFollowup: totalRecovered,
          failedCalls,
          customersRequiringHumanFollowup: staffTasksOpen,
        },
        performance: {
          totalCalls,
          answeredCalls,
          noAnswerCalls,
          promisesReceived: promisesRecorded,
          commitmentsFulfilled: successfulPromises,
          collectionAmountRecovered: totalRecovered,
          answerRate:
            totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0,
          promiseRate:
            answeredCalls > 0
              ? Math.round((promisesRecorded / answeredCalls) * 100)
              : 0,
        },
        recentActivity: recentCalls.map((c) => ({
          id: c.id,
          partyName: c.partyName,
          partyPhone: c.partyPhone,
          invoiceNumber: c.invoiceNumber || "Multiple Invoices",
          outstandingAmount: Number(c.outstandingAmount),
          status: c.status,
          customerIntent: c.customerIntent || "N/A",
          summary: c.summary || c.customerResponse || "Reminder call placed.",
          promisedDate: c.promisedDate
            ? c.promisedDate.toISOString().split("T")[0]
            : null,
          promisedAmount: c.promisedAmount ? Number(c.promisedAmount) : null,
          nextFollowUpDate: c.nextFollowUpDate
            ? c.nextFollowUpDate.toISOString().split("T")[0]
            : null,
          durationSeconds: c.durationSeconds,
          createdAt: c.createdAt.toISOString(),
        })),
      };
    });
  }

  // ==========================================================================
  // 2. Pending Dues Table & Filtering
  // ==========================================================================
  async getPendingDues(ctx: TenantContext, query: QueryPendingDuesDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
      const skip = (page - 1) * limit;

      // 1. Fetch parties with unpaid sales invoices
      const whereParty: any = {
        companyId: ctx.companyId,
        type: { in: ["CUSTOMER", "BOTH"] },
        isActive: true,
      };

      if (query.partyId) {
        whereParty.id = query.partyId;
      }

      if (query.search && query.search.trim().length > 0) {
        const s = query.search.trim();
        whereParty.OR = [
          { name: { contains: s, mode: "insensitive" } },
          { phone: { contains: s } },
          { gstin: { contains: s, mode: "insensitive" } },
        ];
      }

      // Fetch parties
      const parties = await tx.party.findMany({
        where: whereParty,
        include: {
          callingPreference: true,
          salesInvoices: {
            where: {
              status: { in: ["ISSUED", "PARTIALLY_PAID"] },
              balanceAmount: { gt: 0 },
            },
            orderBy: { dueDate: "asc" },
          },
          aiCollectionCalls: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          aiCollectionQueues: {
            where: { status: "QUEUED" },
            take: 1,
          },
          aiCollectionCommitments: {
            where: { status: "PENDING" },
            orderBy: { promisedDate: "desc" },
            take: 1,
          },
          aiCollectionFollowUps: {
            where: { status: "PENDING" },
            orderBy: { scheduledDate: "asc" },
            take: 1,
          },
        },
      });

      // Filter parties that actually have unpaid invoices
      const now = new Date();
      let eligibleList = parties
        .filter((p) => p.salesInvoices.length > 0)
        .map((p) => {
          const totalOutstanding = p.salesInvoices.reduce(
            (sum, inv) => sum + Number(inv.balanceAmount),
            0,
          );
          const earliestDueDate = p.salesInvoices[0]?.dueDate || null;
          const isOverdue = earliestDueDate
            ? new Date(earliestDueDate).getTime() < now.getTime()
            : false;
          const overdueDays =
            isOverdue && earliestDueDate
              ? Math.floor(
                  (now.getTime() - new Date(earliestDueDate).getTime()) /
                    (1000 * 60 * 60 * 24),
                )
              : 0;

          const lastCall = p.aiCollectionCalls[0] || null;
          const pendingCommitment = p.aiCollectionCommitments[0] || null;
          const pendingFollowUp = p.aiCollectionFollowUps[0] || null;
          const activeQueue = p.aiCollectionQueues[0] || null;

          return {
            partyId: p.id,
            customerName: p.name,
            customerNameGujarati: p.nameGujarati,
            mobileNumber: p.phone,
            gstin: p.gstin,
            preferredLanguage:
              p.callingPreference?.preferredLanguage || "gujarati",
            isOptedOut: p.callingPreference?.isOptedOut || false,
            invoicesCount: p.salesInvoices.length,
            invoiceNumber:
              p.salesInvoices.length === 1
                ? p.salesInvoices[0].invoiceNumber
                : `${p.salesInvoices[0].invoiceNumber} (+${p.salesInvoices.length - 1} more)`,
            invoiceDate: p.salesInvoices[0].invoiceDate
              .toISOString()
              .split("T")[0],
            dueDate: earliestDueDate
              ? earliestDueDate.toISOString().split("T")[0]
              : null,
            isOverdue,
            overdueDays,
            invoiceTotal: p.salesInvoices.reduce(
              (sum, inv) => sum + Number(inv.grandTotal),
              0,
            ),
            paidAmount: p.salesInvoices.reduce(
              (sum, inv) => sum + Number(inv.paidAmount),
              0,
            ),
            outstandingAmount: totalOutstanding,
            lastCallDate: lastCall ? lastCall.createdAt.toISOString() : null,
            lastCallStatus: lastCall ? lastCall.status : "NEVER_CALLED",
            lastCallIntent: lastCall ? lastCall.customerIntent : null,
            promisedDate: pendingCommitment
              ? pendingCommitment.promisedDate.toISOString().split("T")[0]
              : lastCall?.promisedDate
                ? lastCall.promisedDate.toISOString().split("T")[0]
                : null,
            nextFollowUp: pendingFollowUp
              ? pendingFollowUp.scheduledDate.toISOString().split("T")[0]
              : activeQueue
                ? activeQueue.scheduledAt.toISOString().split("T")[0]
                : null,
            isQueueActive: !!activeQueue,
            invoices: p.salesInvoices.map((i) => ({
              id: i.id,
              invoiceNumber: i.invoiceNumber,
              invoiceDate: i.invoiceDate.toISOString().split("T")[0],
              dueDate: i.dueDate ? i.dueDate.toISOString().split("T")[0] : null,
              grandTotal: Number(i.grandTotal),
              paidAmount: Number(i.paidAmount),
              balanceAmount: Number(i.balanceAmount),
            })),
          };
        });

      // Filter by overdue if requested
      if (query.overdueOnly === true || query.overdueOnly === "true") {
        eligibleList = eligibleList.filter((item) => item.isOverdue);
      }

      // Filter by minimum overdue days
      if (query.overdueDays) {
        const days = Number(query.overdueDays);
        if (!isNaN(days) && days > 0) {
          eligibleList = eligibleList.filter((item) => item.overdueDays >= days);
        }
      }

      // Filter by minimum outstanding amount
      if (query.minAmount) {
        const minAmt = Number(query.minAmount);
        if (!isNaN(minAmt) && minAmt > 0) {
          eligibleList = eligibleList.filter(
            (item) => item.outstandingAmount >= minAmt,
          );
        }
      }

      const totalItems = eligibleList.length;
      const paginatedItems = eligibleList.slice(skip, skip + limit);

      return {
        data: paginatedItems,
        meta: {
          total: totalItems,
          page,
          limit,
          totalPages: Math.ceil(totalItems / limit) || 1,
        },
      };
    });
  }

  // ==========================================================================
  // 3. Scheduling Calls & Campaigns
  // ==========================================================================
  async scheduleCalls(ctx: TenantContext, dto: ScheduleCallsDto) {
    if (!dto.partyIds || dto.partyIds.length === 0) {
      throw new BadRequestException("At least one customer must be selected.");
    }

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Validate settings
      const settings = await tx.aiCollectionSettings.findUnique({
        where: { companyId: ctx.companyId },
      });

      if (settings && !settings.isEnabled) {
        throw new BadRequestException(
          "AI Collection calling is currently disabled in Settings. Please enable it before scheduling calls.",
        );
      }

      const scheduledTime = dto.scheduledAt ? new Date(dto.scheduledAt) : new Date();

      // 2. Create campaign if multiple customers
      let campaignId: string | null = null;
      if (dto.partyIds.length > 1 || dto.campaignName) {
        const campaign = await tx.aiCollectionCampaign.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            name:
              dto.campaignName ||
              `Collection Campaign ${new Date().toLocaleDateString("en-IN")}`,
            status: "SCHEDULED",
            totalCustomers: dto.partyIds.length,
            scheduledFor: scheduledTime,
            createdBy: ctx.userId || null,
          },
        });
        campaignId = campaign.id;
      }

      const queuedItems: any[] = [];
      const skippedItems: any[] = [];

      // 3. Add eligible customers to the calling queue
      for (const partyId of dto.partyIds) {
        // Fetch party & outstanding dues
        const party = await tx.party.findFirst({
          where: { id: partyId, companyId: ctx.companyId },
          include: {
            callingPreference: true,
            salesInvoices: {
              where: {
                status: { in: ["ISSUED", "PARTIALLY_PAID"] },
                balanceAmount: { gt: 0 },
              },
            },
          },
        });

        if (!party) {
          skippedItems.push({ partyId, reason: "Party not found" });
          continue;
        }

        // Exclude customers with no valid mobile phone
        if (!party.phone || party.phone.trim().length < 8) {
          skippedItems.push({
            partyId,
            customerName: party.name,
            reason: "No valid mobile number available",
          });
          continue;
        }

        // Exclude opted-out customers
        if (party.callingPreference?.isOptedOut) {
          skippedItems.push({
            partyId,
            customerName: party.name,
            reason: "Customer has opted out of automated calling",
          });
          continue;
        }

        // Recalculate outstanding balance
        const totalOutstanding = party.salesInvoices.reduce(
          (sum, inv) => sum + Number(inv.balanceAmount),
          0,
        );

        if (totalOutstanding <= 0) {
          skippedItems.push({
            partyId,
            customerName: party.name,
            reason: "No outstanding invoice balance",
          });
          continue;
        }

        // Check if a call is already active or queued
        const existingQueue = await tx.aiCollectionQueue.findFirst({
          where: {
            companyId: ctx.companyId,
            partyId,
            status: { in: ["QUEUED", "PROCESSING"] },
          },
        });

        if (existingQueue) {
          skippedItems.push({
            partyId,
            customerName: party.name,
            reason: "Call already scheduled or active in queue",
          });
          continue;
        }

        // Create Queue Record
        const qRecord = await tx.aiCollectionQueue.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            campaignId,
            partyId,
            invoiceIds: party.salesInvoices.map((i) => i.id),
            totalOutstanding,
            priority: dto.priority || 100,
            status: "QUEUED",
            scheduledAt: scheduledTime,
            maxAttempts: settings?.maxRetries || 3,
          },
        });

        queuedItems.push({
          id: qRecord.id,
          partyId,
          customerName: party.name,
          phone: party.phone,
          totalOutstanding,
          scheduledAt: scheduledTime,
        });
      }

      // Update campaign stats
      if (campaignId) {
        const campaignTotalOutstanding = queuedItems.reduce(
          (sum, q) => sum + q.totalOutstanding,
          0,
        );
        await tx.aiCollectionCampaign.update({
          where: { id: campaignId },
          data: {
            totalCustomers: queuedItems.length,
            totalOutstanding: campaignTotalOutstanding,
          },
        });
      }

      // Trigger scheduler immediately in background if scheduled for now
      if (scheduledTime.getTime() <= Date.now() + 60000) {
        setImmediate(() => {
          this.scheduler.processCollectionQueue().catch((err) => {
            this.logger.error(`Error in immediate queue trigger: ${err.message}`);
          });
        });
      }

      return {
        success: true,
        campaignId,
        scheduledCount: queuedItems.length,
        skippedCount: skippedItems.length,
        queued: queuedItems,
        skipped: skippedItems,
      };
    });
  }

  // ==========================================================================
  // 4. Queue Management
  // ==========================================================================
  async getQueue(ctx: TenantContext) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const items = await tx.aiCollectionQueue.findMany({
        where: {
          companyId: ctx.companyId,
          status: { in: ["QUEUED", "PROCESSING"] },
        },
        orderBy: [{ priority: "desc" }, { scheduledAt: "asc" }],
        include: {
          party: {
            select: { name: true, phone: true },
          },
          campaign: {
            select: { name: true },
          },
        },
      });

      return items.map((item) => ({
        id: item.id,
        partyId: item.partyId,
        customerName: item.party.name,
        phone: item.party.phone,
        totalOutstanding: Number(item.totalOutstanding),
        priority: item.priority,
        status: item.status,
        attempts: item.attempts,
        maxAttempts: item.maxAttempts,
        scheduledAt: item.scheduledAt.toISOString(),
        campaignName: item.campaign?.name || null,
        lastError: item.lastError,
      }));
    });
  }

  async cancelQueueItem(ctx: TenantContext, id: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const item = await tx.aiCollectionQueue.findFirst({
        where: { id, companyId: ctx.companyId },
      });
      if (!item) {
        throw new NotFoundException(`Queue item ${id} not found`);
      }

      await tx.aiCollectionQueue.update({
        where: { id },
        data: {
          status: "CANCELLED",
          lastError: "Cancelled by authorized user",
        },
      });

      return { success: true, message: "Scheduled call cancelled successfully." };
    });
  }

  // ==========================================================================
  // 5. Calls & Call History
  // ==========================================================================
  async getCalls(ctx: TenantContext, query: QueryCallsDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const page = Math.max(1, Number(query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
      const skip = (page - 1) * limit;

      const where: any = { companyId: ctx.companyId };

      if (query.status && query.status.trim().length > 0) {
        where.status = query.status.trim();
      }

      if (query.partyId) {
        where.partyId = query.partyId;
      }

      if (query.intent && query.intent.trim().length > 0) {
        where.customerIntent = query.intent.trim();
      }

      if (query.startDate) {
        where.createdAt = {
          ...(where.createdAt || {}),
          gte: new Date(query.startDate),
        };
      }

      if (query.endDate) {
        where.createdAt = {
          ...(where.createdAt || {}),
          lte: new Date(query.endDate),
        };
      }

      if (query.search && query.search.trim().length > 0) {
        const s = query.search.trim();
        where.OR = [
          { partyName: { contains: s, mode: "insensitive" } },
          { partyPhone: { contains: s } },
          { invoiceNumber: { contains: s, mode: "insensitive" } },
        ];
      }

      const [total, calls] = await Promise.all([
        tx.aiCollectionCall.count({ where }),
        tx.aiCollectionCall.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          select: {
            id: true,
            createdAt: true,
            partyName: true,
            partyId: true,
            partyPhone: true,
            invoiceNumber: true,
            invoiceId: true,
            outstandingAmount: true,
            durationSeconds: true,
            status: true,
            customerIntent: true,
            customerResponse: true,
            summary: true,
            promisedAmount: true,
            promisedDate: true,
            nextFollowUpDate: true,
            recordingUrl: true,
            provider: true,
          },
        }),
      ]);

      return {
        data: calls.map((c) => ({
          id: c.id,
          callDate: c.createdAt.toISOString(),
          customer: c.partyName,
          customerId: c.partyId,
          mobileNumber: c.partyPhone,
          invoiceNumber: c.invoiceNumber || "Multiple Invoices",
          invoiceId: c.invoiceId,
          outstandingAmount: Number(c.outstandingAmount),
          durationSeconds: c.durationSeconds,
          status: c.status,
          intent: c.customerIntent || "N/A",
          customerResponse: c.customerResponse || c.summary || "Completed",
          promisedAmount: c.promisedAmount ? Number(c.promisedAmount) : null,
          promisedDate: c.promisedDate
            ? c.promisedDate.toISOString().split("T")[0]
            : null,
          nextFollowUp: c.nextFollowUpDate
            ? c.nextFollowUpDate.toISOString().split("T")[0]
            : null,
          recordingUrl: c.recordingUrl,
          provider: c.provider,
        })),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    });
  }

  async getCallById(ctx: TenantContext, id: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const call = await tx.aiCollectionCall.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          party: true,
          invoice: true,
          conversations: { orderBy: { turnIndex: "asc" } },
          commitments: true,
          followUps: true,
          staffTasks: { include: { assignedUser: { select: { fullName: true } } } },
        },
      });

      if (!call) {
        throw new NotFoundException(`Call record ${id} not found.`);
      }

      // Check current invoice balance
      const currentDues = await this.reconciliation.getCustomerOutstanding(
        ctx,
        call.partyId,
      );

      return {
        id: call.id,
        metadata: {
          provider: call.provider,
          providerCallSid: call.providerCallSid,
          direction: call.direction,
          status: call.status,
          language: call.language,
          durationSeconds: call.durationSeconds,
          recordingUrl: call.recordingUrl,
          recordingDuration: call.recordingDuration,
          initiatedAt: call.initiatedAt.toISOString(),
          answeredAt: call.answeredAt ? call.answeredAt.toISOString() : null,
          endedAt: call.endedAt ? call.endedAt.toISOString() : null,
        },
        customer: {
          id: call.party.id,
          name: call.party.name,
          phone: call.party.phone,
          email: call.party.email,
          gstin: call.party.gstin,
          currentOutstanding: currentDues.totalOutstanding,
        },
        invoice: call.invoice
          ? {
              id: call.invoice.id,
              invoiceNumber: call.invoice.invoiceNumber,
              invoiceDate: call.invoice.invoiceDate.toISOString().split("T")[0],
              dueDate: call.invoice.dueDate
                ? call.invoice.dueDate.toISOString().split("T")[0]
                : null,
              grandTotal: Number(call.invoice.grandTotal),
              balanceAmount: Number(call.invoice.balanceAmount),
              status: call.invoice.status,
            }
          : {
              invoiceNumber: call.invoiceNumber || "Multiple Invoices",
              outstandingAmount: Number(call.outstandingAmount),
            },
        conversation: {
          summary: call.summary,
          intent: call.customerIntent,
          customerResponse: call.customerResponse,
          transcript: call.conversations.map((turn) => ({
            id: turn.id,
            role: turn.role,
            content: turn.content,
            language: turn.language,
            turnIndex: turn.turnIndex,
            createdAt: turn.createdAt.toISOString(),
          })),
        },
        commitments: call.commitments.map((c) => ({
          id: c.id,
          promisedAmount: Number(c.promisedAmount),
          promisedDate: c.promisedDate.toISOString().split("T")[0],
          status: c.status,
          fulfilledAmount: Number(c.fulfilledAmount),
          paymentReference: c.paymentReference,
        })),
        followUps: call.followUps.map((f) => ({
          id: f.id,
          scheduledDate: f.scheduledDate.toISOString().split("T")[0],
          reason: f.reason,
          actionType: f.actionType,
          status: f.status,
        })),
        staffTasks: call.staffTasks.map((t) => ({
          id: t.id,
          taskType: t.taskType,
          title: t.title,
          description: t.description,
          priority: t.priority,
          status: t.status,
          assignedUser: t.assignedUser?.fullName || null,
        })),
      };
    });
  }

  async retryCall(ctx: TenantContext, callId: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const call = await tx.aiCollectionCall.findFirst({
        where: { id: callId, companyId: ctx.companyId },
        include: { party: { include: { callingPreference: true } } },
      });

      if (!call) {
        throw new NotFoundException(`Call record ${callId} not found.`);
      }

      // Check opt out
      if (call.party.callingPreference?.isOptedOut) {
        throw new BadRequestException("Customer has opted out of automated calling.");
      }

      // Check current dues
      const dues = await this.reconciliation.getCustomerOutstanding(ctx, call.partyId);
      if (dues.totalOutstanding <= 0) {
        throw new BadRequestException(
          "Customer invoices have already been fully cleared. Retry not permitted.",
        );
      }

      // Create new queue item
      const queueItem = await tx.aiCollectionQueue.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          partyId: call.partyId,
          invoiceIds: dues.invoices.map((i) => i.id),
          totalOutstanding: dues.totalOutstanding,
          priority: 120,
          status: "QUEUED",
          scheduledAt: new Date(),
        },
      });

      // Trigger queue in background
      setImmediate(() => {
        this.scheduler.processCollectionQueue().catch((e) => {
          this.logger.error(`Error triggering retry call: ${e.message}`);
        });
      });

      return {
        success: true,
        message: "Call has been re-queued for immediate dispatch.",
        queueId: queueItem.id,
      };
    });
  }

  // ==========================================================================
  // 6. Settings Management
  // ==========================================================================
  async getSettings(ctx: TenantContext) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      let settings = await tx.aiCollectionSettings.findUnique({
        where: { companyId: ctx.companyId },
      });

      const company = await tx.company.findUnique({
        where: { id: ctx.companyId },
      });

      if (!settings) {
        // Create initial default settings isolated to this company
        settings = await tx.aiCollectionSettings.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            isEnabled: true,
            assistantName: "Maya",
            businessIntro: "Payment Reminder Assistant",
            defaultLanguage: "gujarati",
            callingWindowStart: "09:30",
            callingWindowEnd: "19:00",
            voiceProvider: "simulator", // Defaults to simulator until user enters twilio/exotel credentials
            bankName: company?.bankName || "",
            bankAccountNumber: company?.bankAccountNo || "",
            bankIfsc: company?.bankIfsc || "",
            bankAccountHolder: company?.legalName || "",
            upiId: company?.upiVpa || "",
          },
        });
      }

      return {
        ...settings,
        // Mask encrypted secrets for secure frontend display
        providerApiKey: this.crypto.maskSecret(this.crypto.decrypt(settings.providerApiKey)),
        providerApiSecret: this.crypto.maskSecret(this.crypto.decrypt(settings.providerApiSecret)),
        hasConfiguredApiKey: !!settings.providerApiKey,
        hasConfiguredApiSecret: !!settings.providerApiSecret,
      };
    });
  }

  async updateSettings(ctx: TenantContext, dto: UpdateAiCollectionSettingsDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const allowedFields = [
        "isEnabled",
        "assistantName",
        "businessIntro",
        "defaultLanguage",
        "callingWindowStart",
        "callingWindowEnd",
        "timezone",
        "maxRetries",
        "retryIntervalMinutes",
        "followUpAfterDays",
        "maxCallsPerCustomerPerDay",
        "maxCallsPerCampaign",
        "voiceProvider",
        "providerAccountSid",
        "providerVirtualNumber",
        "webhookSecret",
        "aiModel",
        "sttProvider",
        "ttsProvider",
        "voiceGender",
        "responseSpeed",
        "conversationTimeoutSeconds",
        "maxDurationSeconds",
        "fallbackResponse",
        "bankName",
        "bankAccountNumber",
        "bankIfsc",
        "bankAccountHolder",
        "upiId",
        "shareBankDetailsOnCall",
        "sendWhatsappFollowup",
        "sendSmsFollowup",
        "autoScheduleCalls",
        "autoFollowUpCalls",
        "stopCallsWhenInvoicePaid",
        "stopCallsWhenCustomerOptsOut",
        "requireHumanApproval",
        "notifyStaffOnDispute",
        "recordConsentAudit",
      ];

      const cleanPayload: Record<string, any> = {};
      for (const field of allowedFields) {
        if ((dto as any)[field] !== undefined) {
          cleanPayload[field] = (dto as any)[field];
        }
      }

      // Encrypt provider API key if provided and not masked
      if (dto.providerApiKey && !dto.providerApiKey.includes("••••")) {
        cleanPayload.providerApiKey = this.crypto.encrypt(dto.providerApiKey);
      }

      // Encrypt provider secret if provided and not masked
      if (dto.providerApiSecret && !dto.providerApiSecret.includes("••••")) {
        cleanPayload.providerApiSecret = this.crypto.encrypt(dto.providerApiSecret);
      }

      const updated = await tx.aiCollectionSettings.upsert({
        where: { companyId: ctx.companyId },
        create: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          ...cleanPayload,
        },
        update: cleanPayload,
      });

      return {
        success: true,
        message: "AI Collection settings saved successfully.",
        settings: {
          ...updated,
          providerApiKey: this.crypto.maskSecret(this.crypto.decrypt(updated.providerApiKey)),
          providerApiSecret: this.crypto.maskSecret(this.crypto.decrypt(updated.providerApiSecret)),
          hasConfiguredApiKey: !!updated.providerApiKey,
          hasConfiguredApiSecret: !!updated.providerApiSecret,
        },
      };
    });
  }

  // ==========================================================================
  // 7. Customer Calling Preferences
  // ==========================================================================
  async getCustomerPreference(ctx: TenantContext, customerId: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      let pref = await tx.customerCallingPreference.findUnique({
        where: { partyId: customerId },
      });

      if (!pref) {
        pref = await tx.customerCallingPreference.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            partyId: customerId,
            preferredLanguage: "gujarati",
            preferredCallTime: "MORNING",
          },
        });
      }

      return pref;
    });
  }

  async updateCustomerPreference(
    ctx: TenantContext,
    customerId: string,
    dto: UpdateCustomerCallingPreferenceDto,
  ) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const data: any = { ...dto };
      if (dto.isOptedOut === true) {
        data.optedOutAt = new Date();
        data.optOutSource = "STAFF";

        // Cancel any existing queued reminders
        await tx.aiCollectionQueue.updateMany({
          where: {
            companyId: ctx.companyId,
            partyId: customerId,
            status: { in: ["QUEUED", "PROCESSING"] },
          },
          data: {
            status: "CANCELLED",
            lastError: `Customer opted out (${dto.optOutReason || "User preference update"})`,
          },
        });
      }

      const updated = await tx.customerCallingPreference.upsert({
        where: { partyId: customerId },
        create: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          partyId: customerId,
          ...data,
        },
        update: data,
      });

      return {
        success: true,
        message: "Customer calling preference updated successfully.",
        preference: updated,
      };
    });
  }

  // ==========================================================================
  // 8. Follow-ups & Staff Tasks
  // ==========================================================================
  async getFollowUps(ctx: TenantContext) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      return tx.aiCollectionFollowUp.findMany({
        where: { companyId: ctx.companyId },
        orderBy: { scheduledDate: "asc" },
        include: {
          party: { select: { name: true, phone: true } },
        },
      });
    });
  }

  async createFollowUp(ctx: TenantContext, dto: CreateFollowUpDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      return tx.aiCollectionFollowUp.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          partyId: dto.partyId,
          callId: dto.callId || null,
          commitmentId: dto.commitmentId || null,
          scheduledDate: new Date(dto.scheduledDate),
          reason: dto.reason,
          actionType: dto.actionType || "CALL",
          notes: dto.notes || null,
          assignedToUserId: dto.assignedToUserId || null,
        },
      });
    });
  }

  async updateFollowUp(ctx: TenantContext, id: string, dto: UpdateFollowUpDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const data: any = { ...dto };
      if (dto.status === "COMPLETED" && !dto.completedAt) {
        data.completedAt = new Date();
      }

      return tx.aiCollectionFollowUp.update({
        where: { id },
        data,
      });
    });
  }

  // ==========================================================================
  // 9. Telephony Webhook Handling (Idempotent & Signature Verified)
  // ==========================================================================
  async handleWebhook(
    providerName: string,
    payload: any,
    headers: Record<string, string>,
    query: Record<string, any> = {},
  ) {
    this.logger.log(`Received incoming webhook from provider [${providerName}]`);

    const provider = this.providerFactory.getProvider(providerName);
    const parsedEvent = provider.parseWebhookEvent(payload, headers);

    // Look up call record by providerCallSid or callId
    const callRecord = await this.prisma.aiCollectionCall.findFirst({
      where: {
        OR: [
          { providerCallSid: parsedEvent.providerCallSid },
          { id: parsedEvent.callId || query.callId },
        ],
      },
      include: {
        company: { include: { aiCollectionSettings: true } },
        party: { include: { callingPreference: true } },
      },
    });

    if (!callRecord) {
      this.logger.warn(
        `Webhook received for unknown call. ProviderCallSid: ${parsedEvent.providerCallSid}, CallId: ${parsedEvent.callId || query.callId}`,
      );
      return { status: "ignored", reason: "Call record not found" };
    }

    // Verify webhook signature if configured
    const webhookSecret = callRecord.company.aiCollectionSettings?.webhookSecret;
    const signatureHeader =
      headers["x-twilio-signature"] ||
      headers["x-exotel-signature"] ||
      headers["x-webhook-signature"] ||
      "";

    if (webhookSecret && signatureHeader) {
      const isValid = provider.verifyWebhook(
        signatureHeader,
        headers["host"] || "",
        payload,
        webhookSecret,
      );
      if (!isValid) {
        this.logger.warn(`Invalid webhook signature for call ${callRecord.id}`);
        throw new BadRequestException("Invalid webhook signature");
      }
    }

    // Record Event Audit Log
    await this.prisma.aiCollectionEvent.create({
      data: {
        organizationId: callRecord.organizationId,
        companyId: callRecord.companyId,
        callId: callRecord.id,
        eventType: parsedEvent.eventType,
        payload: parsedEvent.rawPayload,
        source: providerName,
      },
    });

    // Handle Call Status updates
    const updateData: any = {};
    if (parsedEvent.eventType === "ANSWERED") {
      updateData.status = "IN_PROGRESS";
      updateData.answeredAt = new Date();
    } else if (parsedEvent.eventType === "COMPLETED") {
      updateData.status = "COMPLETED";
      updateData.endedAt = new Date();
      if (parsedEvent.durationSeconds) {
        updateData.durationSeconds = parsedEvent.durationSeconds;
      }
      if (parsedEvent.recordingUrl) {
        updateData.recordingUrl = parsedEvent.recordingUrl;
        updateData.recordingDuration = parsedEvent.recordingDuration;
      }
    } else if (
      parsedEvent.eventType === "FAILED" ||
      parsedEvent.eventType === "NO_ANSWER" ||
      parsedEvent.eventType === "BUSY"
    ) {
      updateData.status = parsedEvent.eventType;
      updateData.endedAt = new Date();
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.aiCollectionCall.update({
        where: { id: callRecord.id },
        data: updateData,
      });
    }

    return { status: "success", eventType: parsedEvent.eventType };
  }

  /**
   * Handles interactive two-way speech turns during a live phone call.
   */
  async handleSpeechTurn(
    providerName: string,
    payload: any,
    callId: string,
  ): Promise<string> {
    const provider = this.providerFactory.getProvider(providerName);
    const parsedEvent = provider.parseWebhookEvent(payload);

    const callRecord = await this.prisma.aiCollectionCall.findUnique({
      where: { id: callId },
      include: {
        company: { include: { aiCollectionSettings: true } },
        party: { include: { callingPreference: true } },
        conversations: { orderBy: { turnIndex: "asc" } },
      },
    });

    if (!callRecord) {
      return provider.generateSpeechResponse?.({
        speechText: "કૉલ પૂર્ણ થઈ ગયો છે. આભાર.",
        isFinalTurn: true,
        language: "gujarati",
        callId,
        actionUrl: "",
      }) || "";
    }

    const userInput = parsedEvent.speechResult || payload.SpeechResult || payload.text || "";

    const publicUrl = (process.env.PUBLIC_API_URL || "").replace(/\/+$/, "");
    const actionUrl = publicUrl
      ? `${publicUrl}/api/v1/ai-collections/webhooks/${providerName}/speech`
      : `/api/v1/ai-collections/webhooks/${providerName}/speech`;

    // Turn 0: Call freshly answered by customer, play introductory AI payment reminder greeting
    if (callRecord.conversations.length === 0 && (!userInput || userInput.trim().length === 0)) {
      let currentDues = { totalOutstanding: Number(callRecord.outstandingAmount), invoices: [] as any[] };
      try {
        currentDues = await this.reconciliation.getCustomerOutstanding(
          { organizationId: callRecord.organizationId, companyId: callRecord.companyId },
          callRecord.partyId,
        );
      } catch (e: any) {
        this.logger.warn(`Could not fetch live dues for call ${callId}: ${e.message}`);
      }

      const initialGreeting = this.aiVoiceEngine.generateInitialGreeting({
        callId: callRecord.id,
        tenantId: callRecord.organizationId,
        companyId: callRecord.companyId,
        businessName: callRecord.company.tradeName || callRecord.company.legalName,
        customerName: callRecord.party.name,
        customerPhone: callRecord.party.phone,
        preferredLanguage: callRecord.language,
        invoices: currentDues.invoices.length > 0 ? currentDues.invoices : [{
          invoiceId: callRecord.invoiceId || "",
          invoiceNumber: callRecord.invoiceNumber || "INV-PENDING",
          invoiceDate: callRecord.createdAt.toISOString().split("T")[0],
          dueDate: new Date().toISOString().split("T")[0],
          totalAmount: Number(callRecord.outstandingAmount),
          paidAmount: 0,
          outstandingAmount: Number(callRecord.outstandingAmount),
        }],
        totalOutstanding: currentDues.totalOutstanding > 0 ? currentDues.totalOutstanding : Number(callRecord.outstandingAmount),
        verifiedPaymentDetails: {
          bankName: callRecord.company.bankName || "",
          bankAccountNumber: callRecord.company.bankAccountNo || "",
          bankIfsc: callRecord.company.bankIfsc || "",
          bankAccountHolder: callRecord.company.legalName || "",
          upiId: callRecord.company.upiVpa || "",
        },
        history: [],
        turnIndex: 0,
      });

      // Save initial assistant greeting turn
      await this.prisma.aiCollectionConversation.create({
        data: {
          callId: callRecord.id,
          role: "assistant",
          content: initialGreeting,
          language: callRecord.language,
          turnIndex: 1,
        },
      });

      // Update call status to IN_PROGRESS and answeredAt if not set
      await this.prisma.aiCollectionCall.update({
        where: { id: callRecord.id },
        data: {
          status: "IN_PROGRESS",
          answeredAt: callRecord.answeredAt || new Date(),
        },
      });

      return (
        provider.generateSpeechResponse?.({
          speechText: initialGreeting,
          isFinalTurn: false,
          language: callRecord.language,
          callId,
          actionUrl,
        }) || initialGreeting
      );
    }

    if (!userInput || userInput.trim().length === 0) {
      // Customer was silent or speech not detected after greeting
      let repromptText = "માફ કરશો, તમારો અવાજ સંભળાયો નથી. શું આપ ક્યારે પેમેન્ટ કરી શકશો તે જણાવી શકો?";
      if (callRecord.language.toLowerCase().includes("hin")) {
        repromptText = "माफ़ कीजिये, आपकी आवाज़ सुनाई नहीं दी। क्या आप बता सकते हैं कि आप पेमेंट कब तक कर पाएंगे?";
      } else if (callRecord.language.toLowerCase().includes("eng")) {
        repromptText = "Sorry, I could not hear your response. Could you please let us know when you will be able to make the payment?";
      }

      return (
        provider.generateSpeechResponse?.({
          speechText: repromptText,
          isFinalTurn: false,
          language: callRecord.language,
          callId,
          actionUrl,
        }) || repromptText
      );
    }

    // Save Customer speech turn
    const nextTurnIndex = callRecord.conversations.length + 1;
    await this.prisma.aiCollectionConversation.create({
      data: {
        callId: callRecord.id,
        role: "user",
        content: userInput,
        language: callRecord.language,
        turnIndex: nextTurnIndex,
        confidence: parsedEvent.confidence || null,
        rawProviderPayload: parsedEvent.rawPayload,
      },
    });

    // Fetch live invoices & business payment details
    const currentDues = await this.reconciliation.getCustomerOutstanding(
      { organizationId: callRecord.organizationId, companyId: callRecord.companyId },
      callRecord.partyId,
    );

    const settings = callRecord.company.aiCollectionSettings;
    const verifiedBank = {
      bankName: settings?.bankName || callRecord.company.bankName,
      bankAccountNumber: settings?.bankAccountNumber || callRecord.company.bankAccountNo,
      bankIfsc: settings?.bankIfsc || callRecord.company.bankIfsc,
      bankAccountHolder: settings?.bankAccountHolder || callRecord.company.legalName,
      upiId: settings?.upiId || callRecord.company.upiVpa,
    };

    // Run AI Conversation Engine
    const aiResult = await this.aiVoiceEngine.processCustomerSpeech(userInput, {
      callId: callRecord.id,
      tenantId: callRecord.organizationId,
      companyId: callRecord.companyId,
      businessName: callRecord.company.tradeName || callRecord.company.legalName,
      customerName: callRecord.party.name,
      customerPhone: callRecord.party.phone,
      preferredLanguage: callRecord.language,
      invoices: currentDues.invoices,
      totalOutstanding: currentDues.totalOutstanding,
      verifiedPaymentDetails: verifiedBank,
      history: callRecord.conversations.map((c) => ({
        role: c.role as any,
        content: c.content,
      })),
      turnIndex: nextTurnIndex,
    });

    // Save AI Spoken response turn
    await this.prisma.aiCollectionConversation.create({
      data: {
        callId: callRecord.id,
        role: "assistant",
        content: aiResult.spokenReply,
        language: aiResult.detected_language,
        turnIndex: nextTurnIndex + 1,
      },
    });

    // Update Call record with AI outcome
    const callUpdate: any = {
      customerIntent: aiResult.intent,
      customerResponse: userInput,
      summary: aiResult.conversation_summary,
      nextAction: aiResult.next_action,
    };

    if (aiResult.promised_date) {
      callUpdate.promisedDate = new Date(aiResult.promised_date);
      callUpdate.promisedAmount = aiResult.promised_amount || currentDues.totalOutstanding;
    }

    if (aiResult.is_final_turn) {
      callUpdate.status = "COMPLETED";
      callUpdate.endedAt = new Date();
    }

    await this.prisma.aiCollectionCall.update({
      where: { id: callRecord.id },
      data: callUpdate,
    });

    // Action execution based on extracted intent
    if (aiResult.intent === "PROMISE_TO_PAY" && aiResult.promised_date) {
      await this.prisma.aiCollectionCommitment.create({
        data: {
          organizationId: callRecord.organizationId,
          companyId: callRecord.companyId,
          callId: callRecord.id,
          partyId: callRecord.partyId,
          invoiceId: callRecord.invoiceId,
          promisedAmount: aiResult.promised_amount || currentDues.totalOutstanding,
          promisedDate: new Date(aiResult.promised_date),
          status: "PENDING",
          notes: aiResult.conversation_summary,
        },
      });

      // Schedule follow-up for promised date + 1 day
      const followUpDate = new Date(aiResult.promised_date);
      followUpDate.setDate(followUpDate.getDate() + 1);

      await this.prisma.aiCollectionFollowUp.create({
        data: {
          organizationId: callRecord.organizationId,
          companyId: callRecord.companyId,
          partyId: callRecord.partyId,
          callId: callRecord.id,
          scheduledDate: followUpDate,
          reason: `Follow up on payment commitment made for ${aiResult.promised_date}`,
          actionType: "CALL",
          status: "PENDING",
        },
      });
    } else if (aiResult.intent === "OPT_OUT") {
      // Mark customer calling preference as opted out
      await this.prisma.customerCallingPreference.upsert({
        where: { partyId: callRecord.partyId },
        create: {
          organizationId: callRecord.organizationId,
          companyId: callRecord.companyId,
          partyId: callRecord.partyId,
          isOptedOut: true,
          optedOutAt: new Date(),
          optOutReason: "Customer requested during automated AI call",
          optOutSource: "CALL",
        },
        update: {
          isOptedOut: true,
          optedOutAt: new Date(),
          optOutReason: "Customer requested during automated AI call",
          optOutSource: "CALL",
        },
      });

      // Cancel any future pending queue items
      await this.prisma.aiCollectionQueue.updateMany({
        where: {
          companyId: callRecord.companyId,
          partyId: callRecord.partyId,
          status: { in: ["QUEUED", "PROCESSING"] },
        },
        data: {
          status: "CANCELLED",
          lastError: "Cancelled: Customer requested opt-out during call",
        },
      });
    } else if (aiResult.intent === "DISPUTED" || aiResult.needs_human_followup) {
      // Create Staff Task
      await this.prisma.aiCollectionStaffTask.create({
        data: {
          organizationId: callRecord.organizationId,
          companyId: callRecord.companyId,
          partyId: callRecord.partyId,
          callId: callRecord.id,
          taskType:
            aiResult.intent === "DISPUTED" ? "DISPUTE_REVIEW" : "CALLBACK_REQUEST",
          title:
            aiResult.intent === "DISPUTED"
              ? `Invoice Dispute: ${callRecord.party.name}`
              : `Customer Callback Requested: ${callRecord.party.name}`,
          description: `Customer stated: "${userInput}". Summary: ${aiResult.conversation_summary}`,
          priority: "HIGH",
          status: "OPEN",
        },
      });
    }

    // Generate Provider Speech Output (e.g. TwiML for Twilio)
    return (
      provider.generateSpeechResponse?.({
        speechText: aiResult.spokenReply,
        isFinalTurn: aiResult.is_final_turn,
        language: aiResult.detected_language,
        callId: callRecord.id,
        actionUrl,
      }) || aiResult.spokenReply
    );
  }

  // ==========================================================================
  // 10. Provider Test Connection & Diagnostic Checks
  // ==========================================================================
  async testTelephonyConnection(ctx: TenantContext): Promise<any> {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const settings = await tx.aiCollectionSettings.findUnique({
        where: { companyId: ctx.companyId },
      });

      const voiceProvider = settings?.voiceProvider || "twilio";
      const provider = this.providerFactory.getProvider(voiceProvider);

      const decryptedKey = settings?.providerApiKey
        ? this.crypto.decrypt(settings.providerApiKey)
        : process.env.TWILIO_API_KEY_SID;
      const decryptedSecret = settings?.providerApiSecret
        ? this.crypto.decrypt(settings.providerApiSecret)
        : process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN;
      const accountSid =
        settings?.providerAccountSid || process.env.TWILIO_ACCOUNT_SID;
      const virtualNumber =
        settings?.providerVirtualNumber || process.env.TWILIO_PHONE_NUMBER;
      const webhookSecret = settings?.webhookSecret;

      if (provider.testConnection) {
        return provider.testConnection({
          apiKey: decryptedKey,
          apiSecret: decryptedSecret,
          accountSid,
          virtualNumber,
          webhookSecret,
        });
      }

      return {
        success: true,
        provider: voiceProvider,
        message: `Provider [${voiceProvider}] credentials loaded and verified. Ready for outbound calling.`,
        virtualNumber: virtualNumber || "Configured",
        timestamp: new Date().toISOString(),
      };
    });
  }

  // ==========================================================================
  // 11. Test AI Calling Flow (Outbound Test Call)
  // ==========================================================================
  async initiateTestCall(ctx: TenantContext, dto: TestCallDto): Promise<any> {
    const rawPhone = (dto.phoneNumber || "").trim().replace(/[\s\-()]/g, "");
    if (!rawPhone || rawPhone.length < 10) {
      throw new BadRequestException(
        "Please provide a valid 10-digit customer/admin phone number for testing.",
      );
    }

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      let settings = await tx.aiCollectionSettings.findUnique({
        where: { companyId: ctx.companyId },
      });

      if (!settings) {
        settings = await tx.aiCollectionSettings.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            voiceProvider: "twilio",
            defaultLanguage: dto.language || "gujarati",
          },
        });
      }

      const voiceProvider = settings.voiceProvider || "twilio";
      const provider = this.providerFactory.getProvider(voiceProvider);

      // Decrypt credentials
      const decryptedKey = settings.providerApiKey
        ? this.crypto.decrypt(settings.providerApiKey)
        : process.env.TWILIO_API_KEY_SID;
      const decryptedSecret = settings.providerApiSecret
        ? this.crypto.decrypt(settings.providerApiSecret)
        : process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN;
      const accountSid =
        settings.providerAccountSid || process.env.TWILIO_ACCOUNT_SID;
      const virtualNumber =
        settings.providerVirtualNumber || process.env.TWILIO_PHONE_NUMBER;

      // Find or create test customer party
      let party = await tx.party.findFirst({
        where: { companyId: ctx.companyId, phone: rawPhone },
      });
      if (!party) {
        party = await tx.party.findFirst({
          where: {
            companyId: ctx.companyId,
            name: dto.customerName || "Test Administrator",
          },
        });
      }
      if (!party) {
        party = await tx.party.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            name: dto.customerName || "Test Administrator",
            phone: rawPhone,
            type: "CUSTOMER",
            stateCode: "24",
            billingAddress: {
              addressLine1: "Admin Verification Office",
              city: "Ahmedabad",
              state: "Gujarat",
            },
          },
        });
      }

      const testLanguage = dto.language || settings.defaultLanguage || "gujarati";
      const testInvoiceNumber = "INV/TEST/2026/001";
      const testOutstanding = 25000;

      // Create test call record in database
      const call = await tx.aiCollectionCall.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          partyId: party.id,
          partyName: party.name,
          partyPhone: rawPhone,
          invoiceNumber: testInvoiceNumber,
          outstandingAmount: testOutstanding,
          status: "QUEUED",
          provider: voiceProvider,
          direction: "outbound",
          language: testLanguage,
          summary: `Test Call (${dto.scenario || "Standard Payment Promise"}) initiated by administrator.`,
        },
      });

      const publicUrl = (process.env.PUBLIC_API_URL || "").replace(/\/+$/, "");
      const actionUrl = publicUrl
        ? `${publicUrl}/api/v1/ai-collections/webhooks/${voiceProvider}/speech`
        : `/api/v1/ai-collections/webhooks/${voiceProvider}/speech`;
      const callbackUrl = publicUrl
        ? `${publicUrl}/api/v1/ai-collections/webhooks/${voiceProvider}/status`
        : `/api/v1/ai-collections/webhooks/${voiceProvider}/status`;

      const callResult = await provider.initiateCall({
        callId: call.id,
        tenantId: ctx.organizationId,
        companyId: ctx.companyId,
        customerName: party.name,
        customerPhone: rawPhone,
        invoiceNumber: testInvoiceNumber,
        outstandingAmount: testOutstanding,
        language: testLanguage,
        credentials: {
          apiKey: decryptedKey,
          apiSecret: decryptedSecret,
          accountSid,
          virtualNumber,
          webhookSecret: settings.webhookSecret,
        },
        callbackUrl,
        actionUrl,
      });

      if (!callResult.success) {
        await tx.aiCollectionCall.update({
          where: { id: call.id },
          data: {
            status: "FAILED",
            customerResponse: callResult.message,
          },
        });
        return {
          success: false,
          callId: call.id,
          provider: voiceProvider,
          message:
            callResult.message ||
            "Failed to initiate call via telephony provider.",
          rawResponse: callResult.rawResponse,
        };
      }

      await tx.aiCollectionCall.update({
        where: { id: call.id },
        data: {
          providerCallSid: callResult.providerCallSid,
          status: "INITIATED",
        },
      });

      return {
        success: true,
        callId: call.id,
        provider: voiceProvider,
        providerCallSid: callResult.providerCallSid,
        status: callResult.status,
        message: `Test call initiated successfully via ${voiceProvider} to ${rawPhone}. Call SID: ${callResult.providerCallSid}`,
      };
    });
  }
}

