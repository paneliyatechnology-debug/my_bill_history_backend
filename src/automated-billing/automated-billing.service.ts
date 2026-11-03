import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { TenantContext, InvoiceCategory, PaymentMode } from "@billing/shared-types";
import { DatabaseService } from "../database/database.service";
import { InvoicesService } from "../invoices/invoices.service";
import { CreateSalesInvoiceDto } from "../invoices/dto/create-sales-invoice.dto";
import {
  CreateAutomatedBillingDto,
  CreateAutomatedBillingLineDto,
} from "./dto/create-automated-billing.dto";
import { UpdateAutomatedBillingDto } from "./dto/update-automated-billing.dto";
import { QueryAutomatedBillingDto } from "./dto/query-automated-billing.dto";
import {
  calculateNextOccurrence,
  getInitialNextRun,
} from "./automated-billing-recurrence.helper";

@Injectable()
export class AutomatedBillingService {
  private readonly logger = new Logger(AutomatedBillingService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly invoicesService: InvoicesService,
  ) {}

  /**
   * Helper to compute line calculations and estimated total
   */
  private calculateEstimatedLines(lines: CreateAutomatedBillingLineDto[]) {
    let estimatedTotal = 0;

    const mappedLines = lines.map((line, idx) => {
      const qty = Number(line.quantity) || 1;
      const rate = Number(line.rate) || 0;
      const discPct = Number(line.discountPercent) || 0;
      const taxRate = Number(line.taxRate) || 0;

      const gross = qty * rate;
      const discAmt = gross * (discPct / 100);
      const taxable = Math.max(0, gross - discAmt);
      const taxAmt = taxable * (taxRate / 100);
      const lineTotal = taxable + taxAmt;

      estimatedTotal += lineTotal;

      return {
        itemId: line.itemId || null,
        description: line.description || "Line Item",
        hsnCode: line.hsnCode || null,
        quantity: qty,
        unit: line.unit || "PCS",
        rate: rate,
        discountPercent: discPct,
        discountAmount: Number(discAmt.toFixed(2)),
        taxRate: taxRate,
        taxableAmount: Number(taxable.toFixed(2)),
        totalAmount: Number(lineTotal.toFixed(2)),
        sortOrder: idx,
      };
    });

    return {
      lines: mappedLines,
      estimatedTotal: Number(estimatedTotal.toFixed(2)),
    };
  }

  /**
   * List schedules with pagination, status filters, and search
   */
  async listSchedules(
    query: QueryAutomatedBillingDto,
    tenant: TenantContext,
  ): Promise<any> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const where: any = {
        companyId: tenant.companyId,
      };

      if (query.status && query.status.toUpperCase() !== "ALL") {
        where.status = query.status.toUpperCase();
      }

      if (query.partyId) {
        where.partyId = query.partyId;
      }

      if (query.search && query.search.trim()) {
        const searchStr = query.search.trim();
        where.OR = [
          { scheduleName: { contains: searchStr, mode: "insensitive" } },
          { party: { name: { contains: searchStr, mode: "insensitive" } } },
          { party: { phone: { contains: searchStr, mode: "insensitive" } } },
        ];
      }

      const [items, total] = await Promise.all([
        tx.automatedBillingSchedule.findMany({
          where,
          include: {
            party: {
              select: {
                id: true,
                name: true,
                nameGujarati: true,
                phone: true,
                gstin: true,
                billingAddress: true,
                stateCode: true,
              },
            },
            _count: {
              select: { lines: true, runs: true },
            },
          },
          orderBy: [{ nextRunAt: "asc" }, { createdAt: "desc" }],
          skip,
          take: limit,
        }),
        tx.automatedBillingSchedule.count({ where }),
      ]);

      return {
        items,
        data: items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  /**
   * Get KPI metrics for dashboard summary cards
   */
  async getSummaryMetrics(tenant: TenantContext): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const now = new Date();
      const in7Days = new Date();
      in7Days.setDate(in7Days.getDate() + 7);

      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const [activeCount, dueSoonCount, monthRunsCount, failedCount] = await Promise.all([
        tx.automatedBillingSchedule.count({
          where: {
            companyId: tenant.companyId,
            status: "ACTIVE",
          },
        }),
        tx.automatedBillingSchedule.count({
          where: {
            companyId: tenant.companyId,
            status: "ACTIVE",
            nextRunAt: {
              gte: now,
              lte: in7Days,
            },
          },
        }),
        tx.automatedBillingRun.count({
          where: {
            companyId: tenant.companyId,
            status: "SUCCESS",
            createdAt: {
              gte: startOfMonth,
            },
          },
        }),
        tx.automatedBillingSchedule.count({
          where: {
            companyId: tenant.companyId,
            lastRunStatus: "FAILED",
          },
        }),
      ]);

      return {
        activeSchedulesCount: activeCount,
        dueSoonCount,
        invoicesThisMonthCount: monthRunsCount,
        needsAttentionCount: failedCount,
      };
    });
  }

  /**
   * Create a new automated recurring billing schedule
   */
  async createSchedule(
    dto: CreateAutomatedBillingDto,
    tenant: TenantContext,
  ): Promise<any> {
    if (!dto.scheduleName || !dto.scheduleName.trim()) {
      throw new BadRequestException("Schedule name is required.");
    }
    if (!dto.partyId) {
      throw new BadRequestException("Customer/party selection is required.");
    }
    if (!dto.startDate) {
      throw new BadRequestException("Start date is required.");
    }
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException("At least one line item is required.");
    }

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      // 1. Verify party exists
      const party = await tx.party.findFirst({
        where: { id: dto.partyId, companyId: tenant.companyId },
        select: { id: true, name: true },
      });
      if (!party) {
        throw new NotFoundException(`Party with ID ${dto.partyId} not found.`);
      }

      // 2. Validate dates
      const startDate = new Date(dto.startDate);
      const endDate = dto.endDate ? new Date(dto.endDate) : null;
      if (endDate && endDate < startDate) {
        throw new BadRequestException("End date cannot be earlier than start date.");
      }

      // 3. Compute recurrence initial run
      const freq = (dto.frequency || "MONTHLY").toUpperCase();
      const interval = Math.max(1, Number(dto.interval) || 1);
      const initialNextRun = getInitialNextRun(
        startDate,
        freq,
        interval,
        dto.dayOfWeek,
        dto.dayOfMonth,
        endDate,
      );

      // 4. Calculate lines
      const { lines: mappedLines, estimatedTotal } = this.calculateEstimatedLines(
        dto.lines,
      );

      // 5. Create schedule with lines
      const schedule = await tx.automatedBillingSchedule.create({
        data: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          branchId: tenant.branchId || null,
          scheduleName: dto.scheduleName.trim(),
          partyId: dto.partyId,
          status: initialNextRun ? "ACTIVE" : "COMPLETED",
          startDate,
          endDate,
          frequency: freq,
          interval,
          dayOfWeek: dto.dayOfWeek !== undefined ? Number(dto.dayOfWeek) : null,
          dayOfMonth: dto.dayOfMonth !== undefined ? Number(dto.dayOfMonth) : null,
          nextRunAt: initialNextRun,
          paymentTerms: dto.paymentTerms || "Due on Receipt",
          dueDays: Number(dto.dueDays) || 0,
          notes: dto.notes || null,
          termsAndConditions: dto.termsAndConditions || null,
          estimatedTotal,
          createdBy: tenant.userId || null,
          lines: {
            create: mappedLines,
          },
        },
        include: {
          party: true,
          lines: true,
        },
      });

      this.logger.log(
        `Created Automated Billing Schedule ${schedule.id} (${schedule.scheduleName}) for company ${tenant.companyId}`,
      );

      return schedule;
    });
  }

  /**
   * Get single schedule by ID with full party, lines, and recent runs
   */
  async getScheduleById(id: string, tenant: TenantContext): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const schedule = await tx.automatedBillingSchedule.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          party: {
            select: {
              id: true,
              name: true,
              nameGujarati: true,
              phone: true,
              email: true,
              gstin: true,
              billingAddress: true,
              stateCode: true,
            },
          },
          lines: {
            orderBy: { sortOrder: "asc" },
            include: {
              item: {
                select: {
                  id: true,
                  name: true,
                  nameGujarati: true,
                  sku: true,
                },
              },
            },
          },
          runs: {
            orderBy: { createdAt: "desc" },
            take: 20,
            include: {
              invoice: {
                select: {
                  id: true,
                  invoiceNumber: true,
                  invoiceDate: true,
                  grandTotal: true,
                  status: true,
                },
              },
            },
          },
        },
      });

      if (!schedule) {
        throw new NotFoundException(`Automated billing schedule ${id} not found.`);
      }

      return schedule;
    });
  }

  /**
   * Update an existing schedule
   */
  async updateSchedule(
    id: string,
    dto: UpdateAutomatedBillingDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const existing = await tx.automatedBillingSchedule.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (!existing) {
        throw new NotFoundException(`Schedule ${id} not found.`);
      }

      if (existing.status === "STOPPED") {
        throw new BadRequestException("Stopped schedules cannot be modified.");
      }

      const updateData: any = {};
      if (dto.scheduleName) updateData.scheduleName = dto.scheduleName.trim();
      if (dto.paymentTerms !== undefined) updateData.paymentTerms = dto.paymentTerms;
      if (dto.dueDays !== undefined) updateData.dueDays = Number(dto.dueDays);
      if (dto.notes !== undefined) updateData.notes = dto.notes;
      if (dto.termsAndConditions !== undefined)
        updateData.termsAndConditions = dto.termsAndConditions;

      const startDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
      const endDate =
        dto.endDate !== undefined
          ? dto.endDate
            ? new Date(dto.endDate)
            : null
          : existing.endDate;

      if (dto.startDate) updateData.startDate = startDate;
      if (dto.endDate !== undefined) updateData.endDate = endDate;

      const freq = (dto.frequency || existing.frequency).toUpperCase();
      const interval = dto.interval !== undefined ? Number(dto.interval) : existing.interval;
      if (dto.frequency) updateData.frequency = freq;
      if (dto.interval !== undefined) updateData.interval = interval;
      if (dto.dayOfWeek !== undefined) updateData.dayOfWeek = dto.dayOfWeek;
      if (dto.dayOfMonth !== undefined) updateData.dayOfMonth = dto.dayOfMonth;

      // Recalculate next run if recurrence or dates updated
      if (dto.frequency || dto.interval !== undefined || dto.startDate || dto.endDate !== undefined) {
        updateData.nextRunAt = getInitialNextRun(
          startDate,
          freq,
          interval,
          dto.dayOfWeek !== undefined ? dto.dayOfWeek : existing.dayOfWeek,
          dto.dayOfMonth !== undefined ? dto.dayOfMonth : existing.dayOfMonth,
          endDate,
        );
      }

      // Handle lines update if provided
      if (dto.lines && dto.lines.length > 0) {
        await tx.automatedBillingLine.deleteMany({
          where: { scheduleId: id },
        });

        const { lines: mappedLines, estimatedTotal } = this.calculateEstimatedLines(
          dto.lines,
        );
        updateData.estimatedTotal = estimatedTotal;

        await tx.automatedBillingLine.createMany({
          data: mappedLines.map((l) => ({
            ...l,
            scheduleId: id,
          })),
        });
      }

      const updated = await tx.automatedBillingSchedule.update({
        where: { id },
        data: updateData,
        include: {
          party: true,
          lines: true,
        },
      });

      return updated;
    });
  }

  /**
   * Pause schedule
   */
  async pauseSchedule(id: string, tenant: TenantContext): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const existing = await tx.automatedBillingSchedule.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (!existing) {
        throw new NotFoundException(`Schedule ${id} not found.`);
      }
      if (existing.status === "STOPPED") {
        throw new BadRequestException("Stopped schedule cannot be paused.");
      }

      return await tx.automatedBillingSchedule.update({
        where: { id },
        data: { status: "PAUSED" },
      });
    });
  }

  /**
   * Resume paused schedule
   */
  async resumeSchedule(id: string, tenant: TenantContext): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const existing = await tx.automatedBillingSchedule.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (!existing) {
        throw new NotFoundException(`Schedule ${id} not found.`);
      }
      if (existing.status === "STOPPED") {
        throw new BadRequestException("Stopped schedule cannot be resumed.");
      }

      // Recalculate next eligible run >= today
      const nextRun = getInitialNextRun(
        existing.startDate,
        existing.frequency,
        existing.interval,
        existing.dayOfWeek,
        existing.dayOfMonth,
        existing.endDate,
      );

      return await tx.automatedBillingSchedule.update({
        where: { id },
        data: {
          status: nextRun ? "ACTIVE" : "COMPLETED",
          nextRunAt: nextRun,
        },
      });
    });
  }

  /**
   * Stop schedule permanently (terminal state)
   */
  async stopSchedule(id: string, tenant: TenantContext): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const existing = await tx.automatedBillingSchedule.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (!existing) {
        throw new NotFoundException(`Schedule ${id} not found.`);
      }

      return await tx.automatedBillingSchedule.update({
        where: { id },
        data: {
          status: "STOPPED",
          nextRunAt: null,
        },
      });
    });
  }

  /**
   * Execute immediate or scheduled invoice generation run
   * Uses real InvoicesService to guarantee legal numbering, GST split, and accounting invariants.
   */
  async executeScheduleRun(
    id: string,
    tenant: TenantContext,
    triggeredBy: "AUTOMATED" | "MANUAL_RUN_NOW" | "MANUAL_RETRY" = "AUTOMATED",
  ): Promise<any> {
    // 1. Fetch schedule outside transaction to prepare invoice payload
    const schedule = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return await tx.automatedBillingSchedule.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          party: true,
          lines: true,
        },
      });
    });

    if (!schedule) {
      throw new NotFoundException(`Schedule ${id} not found.`);
    }

    if (schedule.status === "STOPPED") {
      throw new BadRequestException("Cannot run invoice for a stopped schedule.");
    }

    if (schedule.lines.length === 0) {
      throw new BadRequestException("Schedule has no line items to bill.");
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const occurrenceKey = `autobill_${schedule.id}_${todayStr}_${Date.now()}`;
    const scheduledFor = schedule.nextRunAt || new Date();

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (schedule.dueDays || 0));
    const dueDateStr = dueDate.toISOString().split("T")[0];

    // Formulate real CreateSalesInvoiceDto
    const invoiceDto: CreateSalesInvoiceDto = {
      partyId: schedule.partyId,
      invoiceDate: todayStr,
      dueDate: dueDateStr,
      category: InvoiceCategory.TAX_INVOICE,
      paymentMode: PaymentMode.UNPAID_CREDIT,
      notes: schedule.notes || `Recurring Invoice from Schedule: ${schedule.scheduleName}`,
      termsAndConditions: schedule.termsAndConditions || undefined,
      clientOfflineUuid: occurrenceKey,
      items: schedule.lines.map((l) => ({
        itemId: l.itemId || undefined,
        description: l.description,
        hsnCode: l.hsnCode || undefined,
        quantity: Number(l.quantity),
        unitPrice: Number(l.rate),
        discountPercent: Number(l.discountPercent || 0),
        taxRate: Number(l.taxRate || 0),
      })),
    };

    try {
      // 2. Execute invoice creation using the real InvoicesService
      const invoice = await this.invoicesService.createSalesInvoice(
        invoiceDto,
        tenant,
        occurrenceKey,
      );

      // 3. Record successful run & advance nextRunAt
      return await this.prisma.executeInTenantContext(tenant, async (tx) => {
        const run = await tx.automatedBillingRun.create({
          data: {
            scheduleId: schedule.id,
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            occurrenceKey,
            scheduledFor,
            status: "SUCCESS",
            attemptCount: 1,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            grandTotal: invoice.grandTotal,
            triggeredBy,
            startedAt: new Date(),
            completedAt: new Date(),
          },
        });

        // Compute next occurrence
        const nextOccurrence = calculateNextOccurrence({
          frequency: schedule.frequency,
          interval: schedule.interval,
          dayOfWeek: schedule.dayOfWeek,
          dayOfMonth: schedule.dayOfMonth,
          startDate: schedule.startDate,
          endDate: schedule.endDate,
          fromDate: scheduledFor,
        });

        await tx.automatedBillingSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: new Date(),
            lastRunStatus: "SUCCESS",
            successfulRunsCount: { increment: 1 },
            totalRunsCount: { increment: 1 },
            nextRunAt: nextOccurrence,
            status: nextOccurrence ? schedule.status : "COMPLETED",
          },
        });

        return {
          success: true,
          run,
          invoice,
          nextRunAt: nextOccurrence,
        };
      });
    } catch (err: any) {
      this.logger.error(
        `Automated billing run failed for schedule ${schedule.id}: ${err.message}`,
        err.stack,
      );

      // Record failed run
      await this.prisma.executeInTenantContext(tenant, async (tx) => {
        await tx.automatedBillingRun.create({
          data: {
            scheduleId: schedule.id,
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            occurrenceKey,
            scheduledFor,
            status: "FAILED",
            attemptCount: 1,
            errorCode: err.code || "BILLING_GENERATE_ERROR",
            errorMessage: err.message || "Failed to generate sales invoice.",
            triggeredBy,
            startedAt: new Date(),
            completedAt: new Date(),
          },
        });

        await tx.automatedBillingSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: new Date(),
            lastRunStatus: "FAILED",
            failedRunsCount: { increment: 1 },
            totalRunsCount: { increment: 1 },
          },
        });
      });

      throw new BadRequestException(
        `Failed to generate invoice: ${err.message || "Internal error"}`,
      );
    }
  }

  /**
   * Get run history for a schedule
   */
  async getRunHistory(
    scheduleId: string,
    query: any,
    tenant: TenantContext,
  ): Promise<any> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const where: any = {
        scheduleId,
        companyId: tenant.companyId,
      };

      const [items, total] = await Promise.all([
        tx.automatedBillingRun.findMany({
          where,
          orderBy: { createdAt: "desc" },
          include: {
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                invoiceDate: true,
                grandTotal: true,
                status: true,
              },
            },
          },
          skip,
          take: limit,
        }),
        tx.automatedBillingRun.count({ where }),
      ]);

      return {
        items,
        data: items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  /**
   * Retry a failed run
   */
  async retryRun(
    scheduleId: string,
    runId: string,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.executeScheduleRun(scheduleId, tenant, "MANUAL_RETRY");
  }
}
