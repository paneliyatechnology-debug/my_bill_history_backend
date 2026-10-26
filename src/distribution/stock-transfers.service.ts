import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import {
  StockTransferStatus,
  StockTransactionType,
} from "@billing/database";
import { toDecimal, Decimal, validatePeriodAccess } from "@billing/accounting-core";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { CreateStockTransferDto } from "./dto/create-stock-transfer.dto";
import { UpdateStockTransferDto } from "./dto/update-stock-transfer.dto";
import { DispatchStockTransferDto } from "./dto/dispatch-stock-transfer.dto";
import { ReceiveStockTransferDto } from "./dto/receive-stock-transfer.dto";
import { CancelStockTransferDto } from "./dto/cancel-stock-transfer.dto";

@Injectable()
export class StockTransfersService {
  private readonly logger = new Logger(StockTransfersService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Create a new Stock Transfer in DRAFT state
   */
  async createTransfer(
    ctx: TenantContext,
    dto: CreateStockTransferDto,
  ): Promise<any> {
    if (!dto.fromWarehouseId || !dto.toWarehouseId) {
      throw new BadRequestException("Source and destination warehouse IDs are required.");
    }
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException("Source and destination warehouses must be different.");
    }
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException("At least one item is required for stock transfer.");
    }

    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Verify warehouses belong to this company
      const fromWarehouse = await tx.warehouse.findFirst({
        where: { id: dto.fromWarehouseId, companyId: ctx.companyId },
        include: { branch: true },
      });
      if (!fromWarehouse) {
        throw new NotFoundException(`Source warehouse ${dto.fromWarehouseId} not found in this company.`);
      }

      const toWarehouse = await tx.warehouse.findFirst({
        where: { id: dto.toWarehouseId, companyId: ctx.companyId },
        include: { branch: true },
      });
      if (!toWarehouse) {
        throw new NotFoundException(`Destination warehouse ${dto.toWarehouseId} not found in this company.`);
      }

      const branchId = dto.branchId || fromWarehouse.branchId;

      // 2. Validate Financial Year & Period
      const transferDate = dto.transferDate ? new Date(dto.transferDate) : new Date();
      let fy = await tx.financialYear.findFirst({
        where: {
          companyId: ctx.companyId,
          startDate: { lte: transferDate },
          endDate: { gte: transferDate },
        },
      });
      if (!fy) {
        fy = await tx.financialYear.findFirst({
          where: { companyId: ctx.companyId, isCurrent: true },
        });
      }
      if (!fy) {
        throw new NotFoundException(
          `No active financial year found for company ${ctx.companyId} on ${transferDate.toISOString().split("T")[0]}.`,
        );
      }

      const periodCheck = validatePeriodAccess(transferDate, ctx.companyId, fy);
      if (!periodCheck.isAllowed) {
        throw new BadRequestException(periodCheck.reason);
      }

      // 3. Concurrency-Safe Sequential Transfer Number Allocation
      const fyStart = new Date(fy.startDate);
      const fyEnd = new Date(fy.endDate);
      const fyCode = `${fyStart.getFullYear().toString().slice(-2)}-${fyEnd.getFullYear().toString().slice(-2)}`;
      const lockKey = `seq_${ctx.companyId}_stock_transfers`;

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)
      `;

      const count = await tx.stockTransfer.count({
        where: { companyId: ctx.companyId },
      });
      const transferNumber = `ST/${fyCode}/${String(count + 1).padStart(4, "0")}`;

      // 4. Validate items and compute valuation
      const transferItemsData: Array<{
        itemId: string;
        batchId: string | null;
        quantity: number;
        unitCost: number;
        totalCost: number;
      }> = [];

      for (const itemDto of dto.items) {
        if (typeof itemDto.quantity !== "number" || itemDto.quantity <= 0) {
          throw new BadRequestException("Item transfer quantity must be greater than zero.");
        }

        const item = await tx.item.findFirst({
          where: { id: itemDto.itemId, companyId: ctx.companyId },
        });
        if (!item) {
          throw new NotFoundException(`Item ${itemDto.itemId} not found in this company.`);
        }

        let unitCost = toDecimal(item.purchaseRate || item.retailPrice || 0);

        if (itemDto.batchId) {
          const batch = await tx.itemBatch.findFirst({
            where: { id: itemDto.batchId, itemId: item.id },
          });
          if (!batch) {
            throw new NotFoundException(`Batch ${itemDto.batchId} not found for item ${item.name}.`);
          }
          if (batch.purchaseRate) {
            unitCost = toDecimal(batch.purchaseRate);
          }
        }

        const qty = toDecimal(itemDto.quantity);
        const totalCost = qty.mul(unitCost);

        transferItemsData.push({
          itemId: item.id,
          batchId: itemDto.batchId || null,
          quantity: qty.toNumber(),
          unitCost: unitCost.toNumber(),
          totalCost: totalCost.toNumber(),
        });
      }

      // 5. Create StockTransfer record
      const transfer = await tx.stockTransfer.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          branchId,
          financialYearId: fy.id,
          transferNumber,
          transferDate,
          fromWarehouseId: fromWarehouse.id,
          toWarehouseId: toWarehouse.id,
          status: StockTransferStatus.DRAFT,
          challanNumber: dto.challanNumber || null,
          notes: dto.notes || null,
          items: {
            create: transferItemsData,
          },
        },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          items: { include: { item: true, batch: true } },
        },
      });

      // 6. Audit Log
      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "CREATE_STOCK_TRANSFER",
          entityName: "StockTransfer",
          entityId: transfer.id,
          newState: {
            transferNumber: transfer.transferNumber,
            fromWarehouseId: transfer.fromWarehouseId,
            toWarehouseId: transfer.toWarehouseId,
            status: transfer.status,
            itemCount: transfer.items.length,
          },
        },
        tx,
      );

      return transfer;
    });
  }

  /**
   * Update a DRAFT Stock Transfer
   */
  async updateTransfer(
    ctx: TenantContext,
    id: string,
    dto: UpdateStockTransferDto,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`stock_transfer_${id}`})::bigint)
      `;

      const transfer = await tx.stockTransfer.findFirst({
        where: { id, companyId: ctx.companyId },
        include: { items: true },
      });
      if (!transfer) {
        throw new NotFoundException(`Stock transfer ${id} not found.`);
      }

      if (transfer.status !== StockTransferStatus.DRAFT) {
        throw new BadRequestException(
          `Only DRAFT stock transfers can be modified. Current status: ${transfer.status}`,
        );
      }

      let toWarehouseId = transfer.toWarehouseId;
      if (dto.toWarehouseId) {
        if (dto.toWarehouseId === transfer.fromWarehouseId) {
          throw new BadRequestException("Source and destination warehouses must be different.");
        }
        const toWarehouse = await tx.warehouse.findFirst({
          where: { id: dto.toWarehouseId, companyId: ctx.companyId },
        });
        if (!toWarehouse) {
          throw new NotFoundException(`Destination warehouse ${dto.toWarehouseId} not found.`);
        }
        toWarehouseId = dto.toWarehouseId;
      }

      if (dto.items && dto.items.length > 0) {
        // Delete old items and insert new
        await tx.stockTransferItem.deleteMany({
          where: { transferId: transfer.id },
        });

        for (const itemDto of dto.items) {
          if (typeof itemDto.quantity !== "number" || itemDto.quantity <= 0) {
            throw new BadRequestException("Item quantity must be greater than zero.");
          }
          const item = await tx.item.findFirst({
            where: { id: itemDto.itemId, companyId: ctx.companyId },
          });
          if (!item) {
            throw new NotFoundException(`Item ${itemDto.itemId} not found.`);
          }
          const unitCost = toDecimal(item.purchaseRate || item.retailPrice || 0);
          const qty = toDecimal(itemDto.quantity);

          await tx.stockTransferItem.create({
            data: {
              transferId: transfer.id,
              itemId: item.id,
              batchId: itemDto.batchId || null,
              quantity: qty.toNumber(),
              unitCost: unitCost.toNumber(),
              totalCost: qty.mul(unitCost).toNumber(),
            },
          });
        }
      }

      const updated = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          toWarehouseId,
          transferDate: dto.transferDate ? new Date(dto.transferDate) : undefined,
          notes: dto.notes !== undefined ? dto.notes : undefined,
          challanNumber: dto.challanNumber !== undefined ? dto.challanNumber : undefined,
        },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          items: { include: { item: true, batch: true } },
        },
      });

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "UPDATE_STOCK_TRANSFER",
          entityName: "StockTransfer",
          entityId: transfer.id,
          newState: {
            toWarehouseId: updated.toWarehouseId,
            notes: updated.notes,
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * List all Stock Transfers
   */
  async findAllTransfers(ctx: TenantContext): Promise<any[]> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      return await tx.stockTransfer.findMany({
        where: { companyId: ctx.companyId },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          items: { include: { item: true, batch: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    });
  }

  /**
   * Find single Stock Transfer by ID
   */
  async findTransferById(ctx: TenantContext, id: string): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          items: { include: { item: true, batch: true } },
        },
      });
      if (!transfer) {
        throw new NotFoundException(`Stock transfer ${id} not found.`);
      }
      return transfer;
    });
  }

  /**
   * Get in-transit reconciliation report for a transfer
   */
  async getReconciliation(ctx: TenantContext, id: string): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          items: { include: { item: true } },
        },
      });
      if (!transfer) {
        throw new NotFoundException(`Stock transfer ${id} not found.`);
      }

      let totalDispatched = toDecimal(0);
      let totalReceived = toDecimal(0);

      const itemsSummary = transfer.items.map((item) => {
        const dispatched = toDecimal(item.quantity);
        const received = toDecimal(item.receivedQuantity || 0);
        const outstanding = dispatched.sub(received);

        totalDispatched = totalDispatched.add(dispatched);
        totalReceived = totalReceived.add(received);

        return {
          itemId: item.itemId,
          itemName: item.item.name,
          dispatchedQuantity: dispatched.toNumber(),
          receivedQuantity: received.toNumber(),
          outstandingQuantity: outstanding.toNumber(),
          isInTransit: transfer.status === StockTransferStatus.DISPATCHED,
        };
      });

      return {
        transferId: transfer.id,
        transferNumber: transfer.transferNumber,
        status: transfer.status,
        fromWarehouse: transfer.fromWarehouse.name,
        toWarehouse: transfer.toWarehouse.name,
        totalDispatched: totalDispatched.toNumber(),
        totalReceived: totalReceived.toNumber(),
        totalOutstanding: totalDispatched.sub(totalReceived).toNumber(),
        items: itemsSummary,
      };
    });
  }

  /**
   * Dispatch Transfer: DRAFT -> DISPATCHED
   * Atomically checks stock, prevents inter-state supply bypass, and appends STOCK_TRANSFER_OUT
   */
  async dispatchTransfer(
    ctx: TenantContext,
    id: string,
    dto: DispatchStockTransferDto,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Transactional advisory lock
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`stock_transfer_${id}`})::bigint)
      `;

      const transfer = await tx.stockTransfer.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          fromWarehouse: { include: { branch: true } },
          toWarehouse: { include: { branch: true } },
          items: { include: { item: true } },
        },
      });
      if (!transfer) {
        throw new NotFoundException(`Stock transfer ${id} not found.`);
      }

      // Idempotency: if already DISPATCHED, return cleanly
      if (transfer.status === StockTransferStatus.DISPATCHED) {
        return transfer;
      }
      if (transfer.status !== StockTransferStatus.DRAFT) {
        throw new BadRequestException(
          `Only DRAFT stock transfers can be dispatched. Current status: ${transfer.status}`,
        );
      }

      // 2. GST Statutory Rule Check: Same GSTIN vs Distinct GSTINs
      const fromState = transfer.fromWarehouse.branch.stateCode;
      const toState = transfer.toWarehouse.branch.stateCode;
      if (fromState && toState && fromState !== toState) {
        throw new BadRequestException(
          `Inter-state transfer from State ${fromState} to State ${toState} constitutes a supply between distinct persons under Section 25(4) CGST Act. Non-taxable warehouse transfer is disallowed; a Branch Transfer Tax Invoice with IGST is required under Rule 46.`,
        );
      }

      // 3. Negative Stock Policy Check
      const company = await tx.company.findUnique({
        where: { id: ctx.companyId },
      });
      const allowNegative = company?.allowNegativeStock ?? false;

      // 4. Check stock availability under advisory lock
      for (const item of transfer.items) {
        const stockLockKey = `stock_${ctx.companyId}_${transfer.fromWarehouseId}_${item.itemId}`;
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${stockLockKey})::bigint)
        `;

        if (!allowNegative) {
          const stockAgg = await tx.stockTransaction.aggregate({
            where: {
              companyId: ctx.companyId,
              warehouseId: transfer.fromWarehouseId,
              itemId: item.itemId,
            },
            _sum: { quantity: true },
          });

          const currentStock = toDecimal(stockAgg._sum.quantity || 0);
          const reqQty = toDecimal(item.quantity);

          if (currentStock.lessThan(reqQty)) {
            throw new BadRequestException(
              `Insufficient stock for item "${item.item.name}" at warehouse "${transfer.fromWarehouse.name}". Available: ${currentStock.toString()}, Required: ${reqQty.toString()}.`,
            );
          }
        }
      }

      // 5. Append-only STOCK_TRANSFER_OUT records
      const now = new Date();
      for (const item of transfer.items) {
        await tx.stockTransaction.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            warehouseId: transfer.fromWarehouseId,
            itemId: item.itemId,
            batchId: item.batchId,
            transactionType: StockTransactionType.STOCK_TRANSFER_OUT as any,
            transactionDate: now,
            quantity: toDecimal(item.quantity).negated().toNumber(), // Negative outward
            valuationRate: toDecimal(item.unitCost).toNumber(),
            totalValuation: toDecimal(item.totalCost).toNumber(),
            referenceDocType: "STOCK_TRANSFER",
            referenceDocId: transfer.id,
          },
        });
      }

      // 6. Transition status -> DISPATCHED
      const updated = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status: StockTransferStatus.DISPATCHED,
          dispatchedAt: now,
          dispatchedBy: ctx.userId || null,
          challanNumber: dto.challanNumber || transfer.challanNumber,
          notes: dto.notes ? (transfer.notes ? `${transfer.notes}\n${dto.notes}` : dto.notes) : transfer.notes,
        },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          items: { include: { item: true, batch: true } },
        },
      });

      // 7. Audit Log
      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "DISPATCH_STOCK_TRANSFER",
          entityName: "StockTransfer",
          entityId: transfer.id,
          previousState: { status: StockTransferStatus.DRAFT },
          newState: {
            status: StockTransferStatus.DISPATCHED,
            dispatchedAt: now,
            itemCount: transfer.items.length,
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Receive Transfer: DISPATCHED -> RECEIVED
   * Appends STOCK_TRANSFER_IN for accepted goods and accounts for shortage/damages
   */
  async receiveTransfer(
    ctx: TenantContext,
    id: string,
    dto: ReceiveStockTransferDto,
  ): Promise<any> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException("Receipt item details are required.");
    }

    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Transactional advisory lock
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`stock_transfer_${id}`})::bigint)
      `;

      const transfer = await tx.stockTransfer.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          items: { include: { item: true } },
        },
      });
      if (!transfer) {
        throw new NotFoundException(`Stock transfer ${id} not found.`);
      }

      // Idempotency: if already RECEIVED, return cleanly
      if (transfer.status === StockTransferStatus.RECEIVED) {
        return transfer;
      }
      if (transfer.status !== StockTransferStatus.DISPATCHED) {
        throw new BadRequestException(
          `Only DISPATCHED stock transfers can be received. Current status: ${transfer.status}`,
        );
      }

      const now = new Date();

      // 2. Process receipt item by item with variance validation
      for (const itemDto of dto.items) {
        const transferItem = transfer.items.find((i) => i.itemId === itemDto.itemId);
        if (!transferItem) {
          throw new BadRequestException(
            `Item ${itemDto.itemId} was not part of original stock transfer dispatch.`,
          );
        }

        const dispatchedQty = toDecimal(transferItem.quantity);
        const previouslyReceived = toDecimal(transferItem.receivedQuantity || 0);
        const newlyReceived = toDecimal(itemDto.receivedQuantity);
        const shortageQty = toDecimal(itemDto.shortageQuantity || 0);
        const damageQty = toDecimal(itemDto.damageQuantity || 0);

        if (newlyReceived.lessThan(0) || shortageQty.lessThan(0) || damageQty.lessThan(0)) {
          throw new BadRequestException("Quantities cannot be negative.");
        }

        const accumulatedReceived = previouslyReceived.add(newlyReceived);
        const totalAccounted = accumulatedReceived.add(shortageQty).add(damageQty);

        if (totalAccounted.greaterThan(dispatchedQty)) {
          throw new BadRequestException(
            `Sum of accumulated received (${accumulatedReceived.toString()}), shortage (${shortageQty.toString()}), and damage (${damageQty.toString()}) cannot exceed dispatched quantity (${dispatchedQty.toString()}) for item "${transferItem.item.name}".`,
          );
        }

        // 3. Append-only STOCK_TRANSFER_IN only for newly accepted goods at destination warehouse
        if (newlyReceived.greaterThan(0)) {
          await tx.stockTransaction.create({
            data: {
              organizationId: ctx.organizationId,
              companyId: ctx.companyId,
              warehouseId: transfer.toWarehouseId,
              itemId: transferItem.itemId,
              batchId: transferItem.batchId,
              transactionType: StockTransactionType.STOCK_TRANSFER_IN as any,
              transactionDate: now,
              quantity: newlyReceived.toNumber(), // Positive inward
              valuationRate: toDecimal(transferItem.unitCost).toNumber(),
              totalValuation: newlyReceived.mul(toDecimal(transferItem.unitCost)).toNumber(),
              referenceDocType: "STOCK_TRANSFER",
              referenceDocId: transfer.id,
            },
          });
        }

        // 4. Update transfer item receivedQuantity with cumulative accepted quantity
        await tx.stockTransferItem.update({
          where: { id: transferItem.id },
          data: {
            receivedQuantity: accumulatedReceived.toNumber(),
          },
        });
      }

      // 5. Evaluate if all items are fully received or accounted for with shortage/damage
      const allItems = await tx.stockTransferItem.findMany({
        where: { transferId: transfer.id },
      });

      const isFullyAccounted = allItems.every((item) => {
        const itemDto = dto.items.find((i) => i.itemId === item.itemId);
        const shortage = itemDto ? toDecimal(itemDto.shortageQuantity || 0) : toDecimal(0);
        const damage = itemDto ? toDecimal(itemDto.damageQuantity || 0) : toDecimal(0);
        const totalAccounted = toDecimal(item.receivedQuantity || 0).add(shortage).add(damage);
        return totalAccounted.greaterThanOrEqualTo(toDecimal(item.quantity));
      });

      const nextStatus = isFullyAccounted
        ? StockTransferStatus.RECEIVED
        : StockTransferStatus.DISPATCHED;

      // 6. Transition status -> RECEIVED if fully accounted, else remain DISPATCHED
      const updatedTransfer = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status: nextStatus,
          receivedAt: now,
          receivedBy: ctx.userId || null,
          notes: dto.notes ? (transfer.notes ? `${transfer.notes}\n${dto.notes}` : dto.notes) : transfer.notes,
        },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          items: { include: { item: true, batch: true } },
        },
      });

      // 7. Audit Log
      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "RECEIVE_STOCK_TRANSFER",
          entityName: "StockTransfer",
          entityId: transfer.id,
          previousState: { status: StockTransferStatus.DISPATCHED },
          newState: {
            status: StockTransferStatus.RECEIVED,
            receivedAt: now,
          },
        },
        tx,
      );

      return updatedTransfer;
    });
  }

  /**
   * Cancel Transfer:
   * - DRAFT: Marked CANCELLED directly.
   * - DISPATCHED: Reverses outward stock movement via append-only compensating transactions, then marked CANCELLED.
   * - RECEIVED: Cannot be cancelled.
   */
  async cancelTransfer(
    ctx: TenantContext,
    id: string,
    dto: CancelStockTransferDto,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`stock_transfer_${id}`})::bigint)
      `;

      const transfer = await tx.stockTransfer.findFirst({
        where: { id, companyId: ctx.companyId },
      });
      if (!transfer) {
        throw new NotFoundException(`Stock transfer ${id} not found.`);
      }

      if (transfer.status === StockTransferStatus.RECEIVED) {
        throw new BadRequestException("Completed/received stock transfers cannot be cancelled.");
      }
      if (transfer.status === StockTransferStatus.CANCELLED) {
        throw new BadRequestException("Stock transfer is already cancelled.");
      }

      // Cannot cancel if partial receipts have already occurred
      const transferItems = await tx.stockTransferItem.findMany({
        where: { transferId: transfer.id },
      });
      const hasAnyReceipt = transferItems.some((i) =>
        toDecimal(i.receivedQuantity || 0).greaterThan(0),
      );
      if (hasAnyReceipt) {
        throw new BadRequestException(
          "Cannot cancel a stock transfer that has already been partially received. Any returned goods must be transferred back via a new reverse stock transfer.",
        );
      }

      // If DISPATCHED, reverse raw dispatch transactions
      if (transfer.status === StockTransferStatus.DISPATCHED) {
        const outTransactions = await tx.stockTransaction.findMany({
          where: {
            companyId: ctx.companyId,
            referenceDocType: "STOCK_TRANSFER",
            referenceDocId: transfer.id,
            transactionType: StockTransactionType.STOCK_TRANSFER_OUT as any,
          },
        });

        const now = new Date();
        for (const st of outTransactions) {
          const qtyToRestore = toDecimal(st.quantity).abs();
          await tx.stockTransaction.create({
            data: {
              organizationId: ctx.organizationId,
              companyId: ctx.companyId,
              warehouseId: st.warehouseId,
              itemId: st.itemId,
              batchId: st.batchId,
              transactionType: StockTransactionType.STOCK_ADJUSTMENT_PLUS as any,
              transactionDate: now,
              quantity: qtyToRestore.toNumber(), // Positive restoring stock
              valuationRate: st.valuationRate.toNumber(),
              totalValuation: st.totalValuation.toNumber(),
              referenceDocType: "STOCK_TRANSFER_CANCELLATION",
              referenceDocId: transfer.id,
            },
          });
        }
      }

      const cancelled = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status: StockTransferStatus.CANCELLED,
          notes: transfer.notes ? `${transfer.notes}\nCancelled: ${dto.reason}` : `Cancelled: ${dto.reason}`,
        },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          items: { include: { item: true, batch: true } },
        },
      });

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "CANCEL_STOCK_TRANSFER",
          entityName: "StockTransfer",
          entityId: transfer.id,
          previousState: { status: transfer.status },
          newState: {
            status: StockTransferStatus.CANCELLED,
            reason: dto.reason,
          },
        },
        tx,
      );

      return cancelled;
    });
  }
}
