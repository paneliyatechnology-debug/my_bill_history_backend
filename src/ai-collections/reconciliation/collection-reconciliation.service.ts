import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { TenantContext } from "@billing/shared-types";

@Injectable()
export class CollectionReconciliationService {
  private readonly logger = new Logger(CollectionReconciliationService.name);

  constructor(private readonly prisma: DatabaseService) {}

  /**
   * Reconciles payments for a party when new receipts are posted or on demand.
   * Cancels unnecessary pending calls and updates commitments.
   */
  async reconcilePartyCollections(
    ctx: TenantContext,
    partyId: string,
  ): Promise<{
    partyId: string;
    totalOutstanding: number;
    cancelledQueuedReminders: number;
    fulfilledCommitments: number;
  }> {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Fetch all unpaid/partially paid sales invoices for this party
      const unpaidInvoices = await tx.salesInvoice.findMany({
        where: {
          companyId: ctx.companyId,
          partyId,
          status: { in: ["ISSUED", "PARTIALLY_PAID"] },
          balanceAmount: { gt: 0 },
        },
        select: {
          id: true,
          invoiceNumber: true,
          balanceAmount: true,
          paidAmount: true,
          grandTotal: true,
          status: true,
        },
      });

      const totalOutstanding = unpaidInvoices.reduce(
        (sum, inv) => sum + Number(inv.balanceAmount),
        0,
      );

      let cancelledQueuedReminders = 0;
      let fulfilledCommitments = 0;

      // 2. If party has zero outstanding balance (fully paid)
      if (totalOutstanding <= 0) {
        // Cancel all pending / queued calls
        const cancelResult = await tx.aiCollectionQueue.updateMany({
          where: {
            companyId: ctx.companyId,
            partyId,
            status: { in: ["QUEUED", "PROCESSING"] },
          },
          data: {
            status: "CANCELLED",
            lastError: "Auto-cancelled: All pending invoices have been fully paid.",
          },
        });
        cancelledQueuedReminders = cancelResult.count;

        // Mark pending commitments as fulfilled
        const commitResult = await tx.aiCollectionCommitment.updateMany({
          where: {
            companyId: ctx.companyId,
            partyId,
            status: "PENDING",
          },
          data: {
            status: "FULFILLED",
            fulfilledAt: new Date(),
            notes: "Automatically marked fulfilled via invoice payment settlement.",
          },
        });
        fulfilledCommitments = commitResult.count;

        // Cancel pending follow-ups
        await tx.aiCollectionFollowUp.updateMany({
          where: {
            companyId: ctx.companyId,
            partyId,
            status: "PENDING",
          },
          data: {
            status: "CANCELLED",
            notes: "Cancelled: Invoices fully cleared.",
          },
        });

        this.logger.log(
          `Reconciled fully cleared collections for party ${partyId}. Cancelled ${cancelledQueuedReminders} queue items.`,
        );
      } else {
        // Party has remaining dues: Update queue totalOutstanding amounts
        await tx.aiCollectionQueue.updateMany({
          where: {
            companyId: ctx.companyId,
            partyId,
            status: "QUEUED",
          },
          data: {
            totalOutstanding,
          },
        });
      }

      return {
        partyId,
        totalOutstanding,
        cancelledQueuedReminders,
        fulfilledCommitments,
      };
    });
  }

  /**
   * Recalculates total outstanding balance for a customer from real invoice records.
   */
  async getCustomerOutstanding(
    ctx: TenantContext,
    partyId: string,
  ): Promise<{
    partyId: string;
    totalOutstanding: number;
    invoicesCount: number;
    invoices: Array<{
      id: string;
      invoiceNumber: string;
      invoiceDate: string;
      dueDate: string | null;
      grandTotal: number;
      paidAmount: number;
      balanceAmount: number;
      status: string;
    }>;
  }> {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const invoices = await tx.salesInvoice.findMany({
        where: {
          companyId: ctx.companyId,
          partyId,
          status: { in: ["ISSUED", "PARTIALLY_PAID"] },
          balanceAmount: { gt: 0 },
        },
        orderBy: { dueDate: "asc" },
      });

      const totalOutstanding = invoices.reduce(
        (sum, inv) => sum + Number(inv.balanceAmount),
        0,
      );

      return {
        partyId,
        totalOutstanding,
        invoicesCount: invoices.length,
        invoices: invoices.map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate.toISOString().split("T")[0],
          dueDate: inv.dueDate ? inv.dueDate.toISOString().split("T")[0] : null,
          grandTotal: Number(inv.grandTotal),
          paidAmount: Number(inv.paidAmount),
          balanceAmount: Number(inv.balanceAmount),
          status: inv.status,
        })),
      };
    });
  }
}

