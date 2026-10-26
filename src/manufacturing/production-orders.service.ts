import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import {
  StockTransactionType,
  ProductionStatus,
} from "@billing/database";
import { toDecimal, Decimal, validatePeriodAccess } from "@billing/accounting-core";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { CreateProductionOrderDto } from "./dto/create-production-order.dto";
import { StartProductionDto } from "./dto/start-production.dto";
import { CompleteProductionDto } from "./dto/complete-production.dto";
import { CancelProductionDto } from "./dto/cancel-production.dto";

@Injectable()
export class ProductionOrdersService {
  private readonly logger = new Logger(ProductionOrdersService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Create a new Production Order in PLANNED state with concurrency-safe document numbering
   */
  async createOrder(
    ctx: TenantContext,
    dto: CreateProductionOrderDto,
  ): Promise<any> {
    if (!dto.bomId) {
      throw new BadRequestException("BOM ID is required.");
    }
    if (typeof dto.targetQuantity !== "number" || dto.targetQuantity <= 0) {
      throw new BadRequestException("Target quantity must be greater than zero.");
    }

    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Verify BOM belongs to tenant company
      const bom = await tx.billOfMaterial.findFirst({
        where: { id: dto.bomId, companyId: ctx.companyId },
        include: { finishedItem: true, items: true },
      });
      if (!bom) {
        throw new NotFoundException(`Bill of Materials ${dto.bomId} not found in this company.`);
      }

      // 2. Validate Financial Year & Period Lock
      const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
      let fy = await tx.financialYear.findFirst({
        where: {
          companyId: ctx.companyId,
          startDate: { lte: startDate },
          endDate: { gte: startDate },
        },
      });
      if (!fy) {
        fy = await tx.financialYear.findFirst({
          where: { companyId: ctx.companyId, isCurrent: true },
        });
      }
      if (!fy) {
        throw new NotFoundException(
          `No active financial year found for company ${ctx.companyId} on ${startDate.toISOString().split("T")[0]}.`,
        );
      }

      const periodCheck = validatePeriodAccess(startDate, ctx.companyId, fy);
      if (!periodCheck.isAllowed) {
        throw new BadRequestException(periodCheck.reason);
      }

      // 3. Concurrency-Safe Order Number Allocation
      let orderNumber: string;
      if (dto.orderNumber && dto.orderNumber.trim() !== "") {
        const existing = await tx.productionOrder.findFirst({
          where: { companyId: ctx.companyId, orderNumber: dto.orderNumber.trim() },
        });
        if (existing) {
          throw new BadRequestException(`Production order number "${dto.orderNumber}" already exists.`);
        }
        orderNumber = dto.orderNumber.trim();
      } else {
        const fyStart = new Date(fy.startDate);
        const fyEnd = new Date(fy.endDate);
        const fyCode = `${fyStart.getFullYear().toString().slice(-2)}-${fyEnd.getFullYear().toString().slice(-2)}`;
        const lockKey = `seq_${ctx.companyId}_prod_orders`;

        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)
        `;

        const count = await tx.productionOrder.count({
          where: { companyId: ctx.companyId },
        });
        orderNumber = `PO/${fyCode}/${String(count + 1).padStart(4, "0")}`;
      }

      // 4. Create Production Order
      const order = await tx.productionOrder.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          bomId: bom.id,
          orderNumber,
          targetQuantity: toDecimal(dto.targetQuantity).toNumber(),
          status: ProductionStatus.PLANNED,
          startDate,
        },
        include: {
          bom: {
            include: {
              finishedItem: true,
              items: { include: { rawItem: true } },
            },
          },
          batches: true,
        },
      });

      // 5. Audit Log
      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "CREATE_PRODUCTION_ORDER",
          entityName: "ProductionOrder",
          entityId: order.id,
          newState: {
            orderNumber: order.orderNumber,
            bomId: order.bomId,
            targetQuantity: order.targetQuantity,
            status: order.status,
          },
        },
        tx,
      );

      return order;
    });
  }

  /**
   * List all Production Orders for current tenant
   */
  async findAllOrders(ctx: TenantContext): Promise<any[]> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      return await tx.productionOrder.findMany({
        where: { companyId: ctx.companyId },
        include: {
          bom: {
            include: {
              finishedItem: true,
              items: { include: { rawItem: true } },
            },
          },
          batches: true,
        },
        orderBy: { createdAt: "desc" },
      });
    });
  }

  /**
   * Get single Production Order by ID
   */
  async findOrderById(ctx: TenantContext, id: string): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      const order = await tx.productionOrder.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          bom: {
            include: {
              finishedItem: true,
              items: { include: { rawItem: true } },
            },
          },
          batches: true,
        },
      });
      if (!order) {
        throw new NotFoundException(`Production order ${id} not found.`);
      }
      return order;
    });
  }

  /**
   * Start Production: Transition PLANNED -> IN_PROGRESS
   * Atomically checks available stock and deduces raw materials via append-only StockTransaction
   */
  async startProduction(
    ctx: TenantContext,
    id: string,
    dto: StartProductionDto,
  ): Promise<any> {
    if (!dto.sourceWarehouseId) {
      throw new BadRequestException("Source warehouse ID is required to dispatch raw materials.");
    }

    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Advisory concurrency lock on this specific production order
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`prod_order_${id}`})::bigint)
      `;

      const order = await tx.productionOrder.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          bom: {
            include: {
              items: { include: { rawItem: true } },
              finishedItem: true,
            },
          },
        },
      });
      if (!order) {
        throw new NotFoundException(`Production order ${id} not found.`);
      }

      // Idempotency: If already IN_PROGRESS, return safely
      if (order.status === ProductionStatus.IN_PROGRESS) {
        return order;
      }
      if (order.status !== ProductionStatus.PLANNED) {
        throw new BadRequestException(
          `Production order can only be started from PLANNED status. Current status: ${order.status}`,
        );
      }

      // 2. Validate source warehouse ownership
      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.sourceWarehouseId, companyId: ctx.companyId },
      });
      if (!warehouse) {
        throw new NotFoundException(`Warehouse ${dto.sourceWarehouseId} not found in this company.`);
      }

      // 3. Fetch company negative stock policy
      const company = await tx.company.findUnique({
        where: { id: ctx.companyId },
      });
      const allowNegative = company?.allowNegativeStock ?? false;

      // 4. Calculate raw material consumption requirements
      // Multiplier = targetQuantity / batchYieldQty
      const targetQty = toDecimal(order.targetQuantity);
      const yieldQty = toDecimal(order.bom.batchYieldQty);
      const multiplier = targetQty.div(yieldQty);

      const consumptionLines: Array<{
        rawItemId: string;
        grossQty: Decimal;
        valRate: Decimal;
        name: string;
      }> = [];

      for (const item of order.bom.items) {
        const baseQty = toDecimal(item.quantity).mul(multiplier);
        const wastageMul = toDecimal(1).add(toDecimal(item.wastagePercent).div(100));
        const grossQty = baseQty.mul(wastageMul);
        const valRate = toDecimal(
          item.rawItem.purchaseRate || item.rawItem.retailPrice || 1,
        );

        consumptionLines.push({
          rawItemId: item.rawItemId,
          grossQty,
          valRate,
          name: item.rawItem.name,
        });
      }

      // 5. Stock availability check with advisory lock per raw material
      for (const line of consumptionLines) {
        const stockLockKey = `stock_${ctx.companyId}_${warehouse.id}_${line.rawItemId}`;
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${stockLockKey})::bigint)
        `;

        if (!allowNegative) {
          const stockAgg = await tx.stockTransaction.aggregate({
            where: {
              companyId: ctx.companyId,
              warehouseId: warehouse.id,
              itemId: line.rawItemId,
            },
            _sum: { quantity: true },
          });

          const currentStock = toDecimal(stockAgg._sum.quantity || 0);
          if (currentStock.lessThan(line.grossQty)) {
            throw new BadRequestException(
              `Insufficient stock for raw material "${line.name}". Available: ${currentStock.toString()}, Required: ${line.grossQty.toString()}.`,
            );
          }
        }
      }

      // 6. Record append-only StockTransactions (MANUFACTURING_CONSUMPTION)
      const now = new Date();
      for (const line of consumptionLines) {
        await tx.stockTransaction.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            warehouseId: warehouse.id,
            itemId: line.rawItemId,
            transactionType: StockTransactionType.MANUFACTURING_CONSUMPTION as any,
            transactionDate: now,
            quantity: line.grossQty.negated().toNumber(), // Negative for raw material deduction
            valuationRate: line.valRate.toNumber(),
            totalValuation: line.grossQty.mul(line.valRate).toNumber(),
            referenceDocType: "PRODUCTION_ORDER",
            referenceDocId: order.id,
          },
        });
      }

      // 7. Transition order status -> IN_PROGRESS
      const updatedOrder = await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: ProductionStatus.IN_PROGRESS,
        },
        include: {
          bom: {
            include: {
              items: { include: { rawItem: true } },
              finishedItem: true,
            },
          },
          batches: true,
        },
      });

      // 8. Audit Log
      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "START_PRODUCTION",
          entityName: "ProductionOrder",
          entityId: order.id,
          previousState: { status: ProductionStatus.PLANNED },
          newState: {
            status: ProductionStatus.IN_PROGRESS,
            sourceWarehouseId: warehouse.id,
            consumedComponentsCount: consumptionLines.length,
          },
        },
        tx,
      );

      return updatedOrder;
    });
  }

  /**
   * Complete Production: Transition IN_PROGRESS -> COMPLETED
   * Yields finished goods to target warehouse, calculates exact unit cost, and creates ProductionBatch
   */
  async completeProduction(
    ctx: TenantContext,
    id: string,
    dto: CompleteProductionDto,
  ): Promise<any> {
    if (!dto.targetWarehouseId) {
      throw new BadRequestException("Target warehouse ID is required to yield finished goods.");
    }
    if (typeof dto.actualProducedQty !== "number" || dto.actualProducedQty <= 0) {
      throw new BadRequestException("Actual produced quantity must be greater than zero.");
    }

    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Advisory lock on this production order
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`prod_order_${id}`})::bigint)
      `;

      const order = await tx.productionOrder.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          bom: {
            include: {
              items: true,
              finishedItem: true,
            },
          },
          batches: true,
        },
      });
      if (!order) {
        throw new NotFoundException(`Production order ${id} not found.`);
      }

      // Idempotency: If already COMPLETED, return cleanly
      if (order.status === ProductionStatus.COMPLETED) {
        return order;
      }
      if (order.status !== ProductionStatus.IN_PROGRESS) {
        throw new BadRequestException(
          `Production order can only be completed from IN_PROGRESS status. Current status: ${order.status}`,
        );
      }

      // 2. Validate target warehouse ownership
      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.targetWarehouseId, companyId: ctx.companyId },
      });
      if (!warehouse) {
        throw new NotFoundException(`Target warehouse ${dto.targetWarehouseId} not found in this company.`);
      }

      // 3. Aggregate actual consumed raw material cost from recorded StockTransactions
      const consumedStockAgg = await tx.stockTransaction.aggregate({
        where: {
          companyId: ctx.companyId,
          referenceDocType: "PRODUCTION_ORDER",
          referenceDocId: order.id,
          transactionType: StockTransactionType.MANUFACTURING_CONSUMPTION as any,
        },
        _sum: { totalValuation: true },
      });

      const rawMaterialCost = toDecimal(consumedStockAgg._sum.totalValuation || 0);

      // 4. Calculate actual conversion costs and final unit cost
      const actualProduced = toDecimal(dto.actualProducedQty);
      const yieldRatio = actualProduced.div(toDecimal(order.bom.batchYieldQty));

      const actualLaborCost =
        dto.actualLaborCost !== undefined
          ? toDecimal(dto.actualLaborCost)
          : toDecimal(order.bom.laborCostEst).mul(yieldRatio);

      const actualOverheadCost =
        dto.actualOverheadCost !== undefined
          ? toDecimal(dto.actualOverheadCost)
          : toDecimal(order.bom.overheadCostEst).mul(yieldRatio);

      const scrapQty = toDecimal(dto.scrapQuantity || 0);

      // Total Production Cost = Raw Material Cost + Actual Labor + Actual Overhead
      const totalProductionCost = rawMaterialCost
        .add(actualLaborCost)
        .add(actualOverheadCost);

      const unitCost = totalProductionCost.div(actualProduced);

      // 5. Finished Goods Output & Batch Assignment
      let itemBatchId: string | null = null;
      const batchNumber =
        dto.batchNumber ||
        `BATCH-${order.orderNumber.replace(/\//g, "-")}-${Date.now().toString().slice(-4)}`;

      if (order.bom.finishedItem.trackBatches) {
        const mfgDate = dto.mfgDate ? new Date(dto.mfgDate) : new Date();
        const expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;

        const createdBatch = await tx.itemBatch.create({
          data: {
            itemId: order.bom.finishedItemId,
            batchNumber,
            mfgDate,
            expiryDate,
            purchaseRate: unitCost.toNumber(),
            mrp: order.bom.finishedItem.mrp || unitCost.mul(1.5).toNumber(),
            salePrice: order.bom.finishedItem.retailPrice.toNumber(),
          },
        });
        itemBatchId = createdBatch.id;
      }

      // 6. Record append-only StockTransaction (MANUFACTURING_YIELD)
      const now = new Date();
      await tx.stockTransaction.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          warehouseId: warehouse.id,
          itemId: order.bom.finishedItemId,
          batchId: itemBatchId,
          transactionType: StockTransactionType.MANUFACTURING_YIELD as any,
          transactionDate: now,
          quantity: actualProduced.toNumber(), // Positive for finished goods addition
          valuationRate: unitCost.toNumber(),
          totalValuation: totalProductionCost.toNumber(),
          referenceDocType: "PRODUCTION_ORDER",
          referenceDocId: order.id,
        },
      });

      // 7. Create ProductionBatch record
      const prodBatch = await tx.productionBatch.create({
        data: {
          productionOrderId: order.id,
          batchNumber,
          actualProducedQty: actualProduced.toNumber(),
          scrapQuantity: scrapQty.toNumber(),
          rawMaterialCost: rawMaterialCost.toNumber(),
          actualLaborCost: actualLaborCost.toNumber(),
          actualOverheadCost: actualOverheadCost.toNumber(),
          unitCost: unitCost.toNumber(),
          completedAt: now,
        },
      });

      // 8. Update Production Order -> COMPLETED
      const completedOrder = await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: ProductionStatus.COMPLETED,
          completedDate: now,
        },
        include: {
          bom: {
            include: {
              items: { include: { rawItem: true } },
              finishedItem: true,
            },
          },
          batches: true,
        },
      });

      // 9. Audit Log
      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "COMPLETE_PRODUCTION",
          entityName: "ProductionOrder",
          entityId: order.id,
          previousState: { status: ProductionStatus.IN_PROGRESS },
          newState: {
            status: ProductionStatus.COMPLETED,
            actualProducedQty: actualProduced.toNumber(),
            unitCost: unitCost.toNumber(),
            totalProductionCost: totalProductionCost.toNumber(),
            batchNumber,
            batchId: prodBatch.id,
          },
        },
        tx,
      );

      return completedOrder;
    });
  }

  /**
   * Cancel Production Order:
   * - PLANNED: Simply marks as CANCELLED.
   * - IN_PROGRESS: Restores consumed raw materials to stock ledger and marks CANCELLED.
   * - COMPLETED: Cannot be cancelled.
   */
  async cancelOrder(
    ctx: TenantContext,
    id: string,
    dto: CancelProductionDto,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`prod_order_${id}`})::bigint)
      `;

      const order = await tx.productionOrder.findFirst({
        where: { id, companyId: ctx.companyId },
      });
      if (!order) {
        throw new NotFoundException(`Production order ${id} not found.`);
      }

      if (order.status === ProductionStatus.COMPLETED) {
        throw new BadRequestException("Completed production orders cannot be cancelled.");
      }
      if (order.status === ProductionStatus.CANCELLED) {
        throw new BadRequestException("Production order is already cancelled.");
      }

      // If IN_PROGRESS, reverse raw material consumption
      if (order.status === ProductionStatus.IN_PROGRESS) {
        const consumptionTxs = await tx.stockTransaction.findMany({
          where: {
            companyId: ctx.companyId,
            referenceDocType: "PRODUCTION_ORDER",
            referenceDocId: order.id,
            transactionType: StockTransactionType.MANUFACTURING_CONSUMPTION as any,
          },
        });

        const now = new Date();
        for (const st of consumptionTxs) {
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
              referenceDocType: "PRODUCTION_ORDER_CANCELLATION",
              referenceDocId: order.id,
            },
          });
        }
      }

      const cancelledOrder = await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: ProductionStatus.CANCELLED,
        },
        include: {
          bom: {
            include: {
              items: { include: { rawItem: true } },
              finishedItem: true,
            },
          },
          batches: true,
        },
      });

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "CANCEL_PRODUCTION_ORDER",
          entityName: "ProductionOrder",
          entityId: order.id,
          previousState: { status: order.status },
          newState: {
            status: ProductionStatus.CANCELLED,
            reason: dto.reason || "Cancelled by user",
          },
        },
        tx,
      );

      return cancelledOrder;
    });
  }
}
