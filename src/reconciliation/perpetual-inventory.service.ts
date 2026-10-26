import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import { ProductionStatus, StockTransferStatus, VoucherType } from "@billing/database";
import {
  toDecimal,
  Decimal,
  validateJournalLines,
  validatePeriodAccess,
} from "@billing/accounting-core";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { PostInventoryJournalDto } from "./dto/post-inventory-journal.dto";

@Injectable()
export class PerpetualInventoryService {
  private readonly logger = new Logger(PerpetualInventoryService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Post double-entry General Ledger JOURNAL voucher for Manufacturing Completion
   * Debit: Finished Goods Inventory
   * Credit: Work-in-Progress (WIP)
   */
  async postManufacturingCompletionJournal(
    ctx: TenantContext,
    dto: PostInventoryJournalDto,
  ): Promise<any> {
    if (!dto.productionOrderId) {
      throw new BadRequestException("Production Order ID is required for manufacturing journal.");
    }
    if (!dto.debitAccountId || !dto.creditAccountId) {
      throw new BadRequestException("Debit (Finished Goods) and Credit (WIP) ledger account IDs are required.");
    }
    if (dto.debitAccountId === dto.creditAccountId) {
      throw new BadRequestException("Debit and Credit accounts must be different.");
    }

    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Transactional advisory lock on production order voucher creation
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`prod_voucher_${dto.productionOrderId}`})::bigint)
      `;

      // 2. Fetch completed production order and batch
      const order = await tx.productionOrder.findFirst({
        where: { id: dto.productionOrderId, companyId: ctx.companyId },
        include: {
          batches: { orderBy: { completedAt: "desc" }, take: 1 },
          bom: { include: { finishedItem: true } },
        },
      });
      if (!order) {
        throw new NotFoundException(`Production order ${dto.productionOrderId} not found.`);
      }

      if (order.status !== ProductionStatus.COMPLETED) {
        throw new BadRequestException(
          `Inventory journal can only be posted for COMPLETED production orders. Current status: ${order.status}`,
        );
      }

      const batch = order.batches[0];
      if (!batch) {
        throw new NotFoundException(`No completion batch record found for order ${order.orderNumber}.`);
      }

      // 3. Idempotency Guard: Prevent duplicate voucher creation
      const existingVoucher = await tx.voucher.findFirst({
        where: {
          companyId: ctx.companyId,
          sourceDocument: "PRODUCTION_ORDER",
          sourceEntityId: order.id,
          isCancelled: false,
        },
      });
      if (existingVoucher) {
        return existingVoucher; // Idempotent safe return
      }

      // 4. Validate Ledger Accounts exist and belong to company
      const debitAccount = await tx.ledgerAccount.findFirst({
        where: { id: dto.debitAccountId, companyId: ctx.companyId },
      });
      if (!debitAccount) {
        throw new NotFoundException(`Debit ledger account ${dto.debitAccountId} not found.`);
      }

      const creditAccount = await tx.ledgerAccount.findFirst({
        where: { id: dto.creditAccountId, companyId: ctx.companyId },
      });
      if (!creditAccount) {
        throw new NotFoundException(`Credit ledger account ${dto.creditAccountId} not found.`);
      }

      // 5. Validate Financial Year and Period Lock
      const vDate = dto.voucherDate ? new Date(dto.voucherDate) : new Date(batch.completedAt);
      let fy = await tx.financialYear.findFirst({
        where: {
          companyId: ctx.companyId,
          startDate: { lte: vDate },
          endDate: { gte: vDate },
        },
      });
      if (!fy) {
        fy = await tx.financialYear.findFirst({
          where: { companyId: ctx.companyId, isCurrent: true },
        });
      }
      if (!fy) {
        throw new NotFoundException(`No active financial year found for date ${vDate.toISOString().split("T")[0]}.`);
      }

      const periodCheck = validatePeriodAccess(vDate, ctx.companyId, fy);
      if (!periodCheck.isAllowed) {
        throw new BadRequestException(periodCheck.reason);
      }

      // 6. Sequential Voucher Number Allocation
      const fyStart = new Date(fy.startDate);
      const fyEnd = new Date(fy.endDate);
      const fyCode = `${fyStart.getFullYear().toString().slice(-2)}-${fyEnd.getFullYear().toString().slice(-2)}`;
      const lockKey = `seq_${ctx.companyId}_journal_vouchers`;

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)
      `;

      const vCount = await tx.voucher.count({
        where: { companyId: ctx.companyId, voucherType: VoucherType.JOURNAL as any },
      });
      const voucherNumber = `JRN/${fyCode}/${String(vCount + 1).padStart(4, "0")}`;

      // 7. Calculate Total Production Valuation
      const totalAmount = toDecimal(batch.actualProducedQty).mul(toDecimal(batch.unitCost));

      // 8. Build and Validate Journal Lines
      const lines = [
        {
          accountId: debitAccount.id,
          debitAmount: totalAmount.toNumber(),
          creditAmount: 0,
          lineNarration: `Finished Goods Yield: ${order.bom.finishedItem.name} (${batch.actualProducedQty} units @ ₹${batch.unitCost})`,
        },
        {
          accountId: creditAccount.id,
          debitAmount: 0,
          creditAmount: totalAmount.toNumber(),
          lineNarration: `Work-in-Progress conversion absorption for Order #${order.orderNumber}`,
        },
      ];

      const validation = validateJournalLines(lines);
      if (!validation.isValid) {
        throw new BadRequestException(`Double-entry invariant failure: ${validation.errors.join("; ")}`);
      }

      // 9. Create Voucher
      const voucher = await tx.voucher.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          financialYearId: fy.id,
          voucherType: VoucherType.JOURNAL as any,
          voucherNumber,
          voucherDate: vDate,
          referenceNo: order.orderNumber,
          narration: dto.narration || `Manufacturing completion journal for Order #${order.orderNumber}`,
          totalAmount: totalAmount.toNumber(),
          isAutoGenerated: true,
          isCancelled: false,
          sourceDocument: "PRODUCTION_ORDER",
          sourceEntityId: order.id,
          journalEntries: {
            create: lines.map((l, idx) => ({
              accountId: l.accountId,
              debitAmount: l.debitAmount,
              creditAmount: l.creditAmount,
              lineNarration: l.lineNarration,
              sequenceOrder: idx + 1,
            })),
          },
        },
        include: {
          journalEntries: { include: { account: true } },
        },
      });

      // 10. Audit Log
      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "POST_MANUFACTURING_JOURNAL",
          entityName: "Voucher",
          entityId: voucher.id,
          newState: {
            voucherNumber: voucher.voucherNumber,
            totalAmount: voucher.totalAmount,
            productionOrderId: order.id,
          },
        },
        tx,
      );

      return voucher;
    });
  }

  /**
   * Post double-entry General Ledger JOURNAL voucher for Transit Damage / Shortage Write-off
   * Debit: Transit Loss Expense
   * Credit: General Purchases / Goods in Transit
   */
  async postTransitLossWriteOffJournal(
    ctx: TenantContext,
    dto: PostInventoryJournalDto,
  ): Promise<any> {
    if (!dto.stockTransferId) {
      throw new BadRequestException("Stock Transfer ID is required for transit write-off journal.");
    }
    if (!dto.debitAccountId || !dto.creditAccountId) {
      throw new BadRequestException("Debit (Transit Loss) and Credit (Purchases/Inventory) ledger account IDs are required.");
    }
    if (dto.debitAccountId === dto.creditAccountId) {
      throw new BadRequestException("Debit and Credit accounts must be different.");
    }

    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`transfer_voucher_${dto.stockTransferId}`})::bigint)
      `;

      const transfer = await tx.stockTransfer.findFirst({
        where: { id: dto.stockTransferId, companyId: ctx.companyId },
        include: { items: { include: { item: true } } },
      });
      if (!transfer) {
        throw new NotFoundException(`Stock transfer ${dto.stockTransferId} not found.`);
      }

      if (transfer.status !== StockTransferStatus.RECEIVED) {
        throw new BadRequestException(
          `Transit loss journal can only be posted for RECEIVED stock transfers with recorded variances. Current status: ${transfer.status}`,
        );
      }

      // Compute total loss valuation across lines
      let totalLossAmount = toDecimal(0);
      const lossDescriptions: string[] = [];

      for (const it of transfer.items) {
        const dispatched = toDecimal(it.quantity);
        const received = toDecimal(it.receivedQuantity || 0);
        if (dispatched.greaterThan(received)) {
          const variance = dispatched.sub(received);
          const lineLoss = variance.mul(toDecimal(it.unitCost));
          totalLossAmount = totalLossAmount.add(lineLoss);
          lossDescriptions.push(`${it.item.name}: ${variance.toString()} units (₹${lineLoss.toString()})`);
        }
      }

      if (totalLossAmount.lessThanOrEqualTo(0)) {
        throw new BadRequestException(`No transit loss or shortage variance found on stock transfer #${transfer.transferNumber}.`);
      }

      // Idempotency Guard
      const existingVoucher = await tx.voucher.findFirst({
        where: {
          companyId: ctx.companyId,
          sourceDocument: "STOCK_TRANSFER_TRANSIT_LOSS",
          sourceEntityId: transfer.id,
          isCancelled: false,
        },
      });
      if (existingVoucher) {
        return existingVoucher;
      }

      const debitAccount = await tx.ledgerAccount.findFirst({
        where: { id: dto.debitAccountId, companyId: ctx.companyId },
      });
      if (!debitAccount) {
        throw new NotFoundException(`Debit account ${dto.debitAccountId} not found.`);
      }

      const creditAccount = await tx.ledgerAccount.findFirst({
        where: { id: dto.creditAccountId, companyId: ctx.companyId },
      });
      if (!creditAccount) {
        throw new NotFoundException(`Credit account ${dto.creditAccountId} not found.`);
      }

      const vDate = dto.voucherDate ? new Date(dto.voucherDate) : new Date(transfer.receivedAt || transfer.updatedAt);
      let fy = await tx.financialYear.findFirst({
        where: {
          companyId: ctx.companyId,
          startDate: { lte: vDate },
          endDate: { gte: vDate },
        },
      });
      if (!fy) {
        fy = await tx.financialYear.findFirst({
          where: { companyId: ctx.companyId, isCurrent: true },
        });
      }
      if (!fy) {
        throw new NotFoundException(`No active financial year found for company on date ${vDate.toISOString().split("T")[0]}.`);
      }

      const periodCheck = validatePeriodAccess(vDate, ctx.companyId, fy);
      if (!periodCheck.isAllowed) {
        throw new BadRequestException(periodCheck.reason);
      }

      const fyStart = new Date(fy.startDate);
      const fyEnd = new Date(fy.endDate);
      const fyCode = `${fyStart.getFullYear().toString().slice(-2)}-${fyEnd.getFullYear().toString().slice(-2)}`;
      const lockKey = `seq_${ctx.companyId}_journal_vouchers`;

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)
      `;

      const vCount = await tx.voucher.count({
        where: { companyId: ctx.companyId, voucherType: VoucherType.JOURNAL as any },
      });
      const voucherNumber = `JRN/${fyCode}/${String(vCount + 1).padStart(4, "0")}`;

      const lines = [
        {
          accountId: debitAccount.id,
          debitAmount: totalLossAmount.toNumber(),
          creditAmount: 0,
          lineNarration: `Transit Loss Write-off: Transfer #${transfer.transferNumber} (${lossDescriptions.join(", ")})`,
        },
        {
          accountId: creditAccount.id,
          debitAmount: 0,
          creditAmount: totalLossAmount.toNumber(),
          lineNarration: `Credit out inventory valuation for in-transit shortage/damage #${transfer.transferNumber}`,
        },
      ];

      const validation = validateJournalLines(lines);
      if (!validation.isValid) {
        throw new BadRequestException(`Double-entry invariant failure: ${validation.errors.join("; ")}`);
      }

      const voucher = await tx.voucher.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          financialYearId: fy.id,
          voucherType: VoucherType.JOURNAL as any,
          voucherNumber,
          voucherDate: vDate,
          referenceNo: transfer.transferNumber,
          narration: dto.narration || `Transit shortage/damage write-off for Transfer #${transfer.transferNumber}`,
          totalAmount: totalLossAmount.toNumber(),
          isAutoGenerated: true,
          isCancelled: false,
          sourceDocument: "STOCK_TRANSFER_TRANSIT_LOSS",
          sourceEntityId: transfer.id,
          journalEntries: {
            create: lines.map((l, idx) => ({
              accountId: l.accountId,
              debitAmount: l.debitAmount,
              creditAmount: l.creditAmount,
              lineNarration: l.lineNarration,
              sequenceOrder: idx + 1,
            })),
          },
        },
        include: {
          journalEntries: { include: { account: true } },
        },
      });

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "POST_TRANSIT_LOSS_JOURNAL",
          entityName: "Voucher",
          entityId: voucher.id,
          newState: {
            voucherNumber: voucher.voucherNumber,
            totalAmount: voucher.totalAmount,
            transferId: transfer.id,
          },
        },
        tx,
      );

      return voucher;
    });
  }

  /**
   * Append-only reversal of a posted inventory journal voucher
   */
  async reverseInventoryJournal(
    ctx: TenantContext,
    voucherId: string,
    reason: string,
  ): Promise<any> {
    if (!reason || reason.trim() === "") {
      throw new BadRequestException("Cancellation/reversal reason is required.");
    }

    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`voucher_rev_${voucherId}`})::bigint)
      `;

      const original = await tx.voucher.findFirst({
        where: { id: voucherId, companyId: ctx.companyId },
        include: { journalEntries: true, financialYear: true },
      });
      if (!original) {
        throw new NotFoundException(`Voucher ${voucherId} not found.`);
      }

      if (original.isCancelled) {
        throw new BadRequestException(`Voucher ${original.voucherNumber} is already cancelled.`);
      }

      const periodCheck = validatePeriodAccess(new Date(), ctx.companyId, original.financialYear);
      if (!periodCheck.isAllowed) {
        throw new BadRequestException(periodCheck.reason);
      }

      // Generate reversal lines swapping Debits and Credits
      const reversalLines = original.journalEntries.map((e) => ({
        accountId: e.accountId,
        debitAmount: Number(e.creditAmount),
        creditAmount: Number(e.debitAmount),
        lineNarration: `Reversal of #${original.voucherNumber}: ${reason}`,
      }));

      const validation = validateJournalLines(reversalLines);
      if (!validation.isValid) {
        throw new BadRequestException(`Reversal double-entry invariant failure: ${validation.errors.join("; ")}`);
      }

      const fyStart = new Date(original.financialYear.startDate);
      const fyEnd = new Date(original.financialYear.endDate);
      const fyCode = `${fyStart.getFullYear().toString().slice(-2)}-${fyEnd.getFullYear().toString().slice(-2)}`;

      const vCount = await tx.voucher.count({
        where: { companyId: ctx.companyId, voucherType: VoucherType.JOURNAL as any },
      });
      const reversalVoucherNumber = `REV/${original.voucherNumber}/${String(vCount + 1).padStart(4, "0")}`;

      const now = new Date();

      // Mark original as cancelled
      await tx.voucher.update({
        where: { id: original.id },
        data: {
          isCancelled: true,
        },
      });

      // Create append-only reversal voucher
      const reversalVoucher = await tx.voucher.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          financialYearId: original.financialYearId,
          voucherType: VoucherType.JOURNAL as any,
          voucherNumber: reversalVoucherNumber,
          voucherDate: now,
          referenceNo: original.voucherNumber,
          narration: `Reversal of Voucher #${original.voucherNumber} - ${reason}`,
          totalAmount: original.totalAmount,
          isAutoGenerated: true,
          isCancelled: false,
          sourceDocument: original.sourceDocument,
          sourceEntityId: original.sourceEntityId,
          journalEntries: {
            create: reversalLines.map((l, idx) => ({
              accountId: l.accountId,
              debitAmount: l.debitAmount,
              creditAmount: l.creditAmount,
              lineNarration: l.lineNarration,
              sequenceOrder: idx + 1,
            })),
          },
        },
        include: {
          journalEntries: { include: { account: true } },
        },
      });

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "REVERSE_INVENTORY_JOURNAL",
          entityName: "Voucher",
          entityId: reversalVoucher.id,
          previousState: { originalVoucherId: original.id, originalNumber: original.voucherNumber },
          newState: {
            reversalVoucherNumber: reversalVoucher.voucherNumber,
            reason,
          },
        },
        tx,
      );

      return reversalVoucher;
    });
  }
}
