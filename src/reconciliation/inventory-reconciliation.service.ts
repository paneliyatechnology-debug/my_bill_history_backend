import {
  Injectable,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import { StockTransferStatus, ProductionStatus, StockTransactionType } from "@billing/database";
import { toDecimal, Decimal, toMoney } from "@billing/accounting-core";
import { DatabaseService } from "../database/database.service";
import {
  QueryReconciliationDto,
  StockGlReconciliationResponse,
  InTransitValuationResponse,
  ManufacturingCostReconciliationResponse,
} from "./dto/query-reconciliation.dto";

@Injectable()
export class InventoryReconciliationService {
  private readonly logger = new Logger(InventoryReconciliationService.name);

  constructor(private readonly prisma: DatabaseService) {}

  /**
   * Reconcile physical inventory valuation subledger with general ledger purchase & asset accounts
   */
  async getPhysicalVsGlReconciliation(
    ctx: TenantContext,
    query: QueryReconciliationDto,
  ): Promise<StockGlReconciliationResponse> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      const asOf = query.asOfDate ? new Date(query.asOfDate) : new Date();

      // 1. Calculate Physical Stock Valuation from append-only stock_transactions
      const items = await tx.item.findMany({
        where: {
          companyId: ctx.companyId,
          isActive: true,
          type: "PRODUCT",
        },
        include: {
          stockTransactions: {
            where: {
              companyId: ctx.companyId,
              transactionDate: { lte: asOf },
              ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
            },
            select: {
              quantity: true,
              valuationRate: true,
              totalValuation: true,
            },
          },
        },
      });

      let totalPhysicalValuation = toDecimal(0);
      let totalItemsCount = 0;

      for (const item of items) {
        let onHandQty = toDecimal(0);
        let itemVal = toDecimal(0);

        for (const st of item.stockTransactions) {
          const qty = toDecimal(st.quantity);
          onHandQty = onHandQty.add(qty);
          const stVal = toDecimal(st.totalValuation).abs();
          itemVal = itemVal.add(qty.isNegative() ? stVal.negated() : stVal);
        }

        if (onHandQty.lessThanOrEqualTo(0)) {
          itemVal = toDecimal(0);
        } else if (itemVal.lessThanOrEqualTo(0)) {
          itemVal = onHandQty.mul(toDecimal(item.purchaseRate || item.retailPrice || 0));
        }

        totalPhysicalValuation = totalPhysicalValuation.add(itemVal);
        if (onHandQty.greaterThan(0)) {
          totalItemsCount++;
        }
      }

      // 2. Calculate General Ledger Purchases Total from Journal Entries
      const purchaseAccounts = await tx.ledgerAccount.findMany({
        where: {
          companyId: ctx.companyId,
          OR: [
            { code: "5010" }, // General Purchases
            { name: { contains: "Purchase", mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });

      const purchaseAccountIds = purchaseAccounts.map((a) => a.id);

      const glPurchasesAgg = await tx.journalEntry.aggregate({
        where: {
          accountId: { in: purchaseAccountIds },
          voucher: {
            companyId: ctx.companyId,
            voucherDate: { lte: asOf },
            // Both original and contra reversal vouchers are included to net out naturally
          },
        },
        _sum: {
          debitAmount: true,
          creditAmount: true,
        },
      });

      const glDebit = toDecimal(glPurchasesAgg._sum.debitAmount || 0);
      const glCredit = toDecimal(glPurchasesAgg._sum.creditAmount || 0);
      const netGlPurchases = glDebit.sub(glCredit);

      // 3. Calculate Opening Stock from physical subledger
      const openingStockAgg = await tx.stockTransaction.aggregate({
        where: {
          companyId: ctx.companyId,
          transactionType: StockTransactionType.OPENING as any,
          transactionDate: { lte: asOf },
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        },
        _sum: { totalValuation: true },
      });
      const openingStockVal = toDecimal(openingStockAgg._sum.totalValuation || 0);

      // 4. Calculate Cost of Goods Sold (COGS) from sales dispatches and customer returns
      const salesDispatchAgg = await tx.stockTransaction.aggregate({
        where: {
          companyId: ctx.companyId,
          transactionType: StockTransactionType.SALES_DISPATCH as any,
          transactionDate: { lte: asOf },
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        },
        _sum: { totalValuation: true },
      });

      const salesReturnAgg = await tx.stockTransaction.aggregate({
        where: {
          companyId: ctx.companyId,
          transactionType: StockTransactionType.SALES_RETURN as any,
          transactionDate: { lte: asOf },
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        },
        _sum: { totalValuation: true },
      });

      const grossCogs = toDecimal(salesDispatchAgg._sum.totalValuation || 0);
      const returnCogs = toDecimal(salesReturnAgg._sum.totalValuation || 0);
      const netCogsVal = grossCogs.sub(returnCogs);

      // 5. Calculate In-Transit Inventory Valuation
      const inTransitTransfers = await tx.stockTransfer.findMany({
        where: {
          companyId: ctx.companyId,
          status: StockTransferStatus.DISPATCHED,
          transferDate: { lte: asOf },
        },
        include: {
          items: true,
        },
      });

      let totalInTransitVal = toDecimal(0);
      for (const tr of inTransitTransfers) {
        for (const it of tr.items) {
          const dispatched = toDecimal(it.quantity);
          const received = toDecimal(it.receivedQuantity || 0);
          const remaining = dispatched.sub(received);
          if (remaining.greaterThan(0)) {
            totalInTransitVal = totalInTransitVal.add(remaining.mul(toDecimal(it.unitCost)));
          }
        }
      }

      // 6. Calculate Transit Loss & Shortage Valuation
      const allTransfers = await tx.stockTransfer.findMany({
        where: {
          companyId: ctx.companyId,
          transferDate: { lte: asOf },
        },
        include: { items: true },
      });

      let totalTransitLossVal = toDecimal(0);
      for (const tr of allTransfers) {
        for (const it of tr.items) {
          if (it.receivedQuantity !== null && it.receivedQuantity !== undefined) {
            const dispatched = toDecimal(it.quantity);
            const received = toDecimal(it.receivedQuantity);
            if (dispatched.greaterThan(received)) {
              const variance = dispatched.sub(received);
              totalTransitLossVal = totalTransitLossVal.add(variance.mul(toDecimal(it.unitCost)));
            }
          }
        }
      }

      // 7. Calculate Manufacturing Work-in-Progress (WIP) Valuation
      const inProgressOrders = await tx.productionOrder.findMany({
        where: {
          companyId: ctx.companyId,
          status: ProductionStatus.IN_PROGRESS,
        },
        select: { id: true },
      });

      const inProgressOrderIds = inProgressOrders.map((o) => o.id);

      const wipAgg = await tx.stockTransaction.aggregate({
        where: {
          companyId: ctx.companyId,
          referenceDocType: "PRODUCTION_ORDER",
          referenceDocId: { in: inProgressOrderIds },
          transactionType: StockTransactionType.MANUFACTURING_CONSUMPTION as any,
        },
        _sum: { totalValuation: true },
      });

      const totalWipVal = toDecimal(wipAgg._sum.totalValuation || 0);

      // 8. Calculate GL Inventory Asset Accounts Balance (for Perpetual Model)
      const inventoryAssetAccounts = await tx.ledgerAccount.findMany({
        where: {
          companyId: ctx.companyId,
          OR: [
            { group: { name: "Stock-in-hand" } },
            { name: { contains: "Finished Goods", mode: "insensitive" } },
            { name: { contains: "Raw Material Stock", mode: "insensitive" } },
            { name: { contains: "Inventory", mode: "insensitive" } },
          ],
        },
        select: { id: true },
      });

      const invAssetAccountIds = inventoryAssetAccounts.map((a) => a.id);
      let glInventoryAssetBalance = toDecimal(0);

      if (invAssetAccountIds.length > 0) {
        const glInvAgg = await tx.journalEntry.aggregate({
          where: {
            accountId: { in: invAssetAccountIds },
            voucher: {
              companyId: ctx.companyId,
              voucherDate: { lte: asOf },
            },
          },
          _sum: {
            debitAmount: true,
            creditAmount: true,
          },
        });
        const invDr = toDecimal(glInvAgg._sum.debitAmount || 0);
        const invCr = toDecimal(glInvAgg._sum.creditAmount || 0);
        glInventoryAssetBalance = invDr.sub(invCr);
      }

      // 9. Dual-Model Reconciliation Mathematics
      // Total Physical Asset Stock Across All Locations
      const actualTotalInventory = totalPhysicalValuation
        .add(totalInTransitVal)
        .add(totalWipVal);

      // Periodic Model Expected Inventory: Opening + Net Purchases - Net COGS - Transit Losses
      const expectedPeriodicInventory = openingStockVal
        .add(netGlPurchases)
        .sub(netCogsVal)
        .sub(totalTransitLossVal);

      const periodicVariance = actualTotalInventory.sub(expectedPeriodicInventory);

      // Perpetual Model Variance: Physical Subledger vs GL Inventory Asset Accounts
      const perpetualVariance = actualTotalInventory.sub(glInventoryAssetBalance);

      // Determine active accounting policy
      const isPerpetual = glInventoryAssetBalance.abs().greaterThan(0);
      const accountingPolicy: "PERIODIC" | "PERPETUAL" = isPerpetual ? "PERPETUAL" : "PERIODIC";
      const finalVariance = isPerpetual ? perpetualVariance : periodicVariance;

      return {
        companyId: ctx.companyId,
        asOfDate: asOf.toISOString().split("T")[0],
        physicalStockValuation: totalPhysicalValuation.toNumber(),
        totalItemsCount,
        generalLedgerPurchaseTotal: netGlPurchases.toNumber(),
        inTransitValuation: totalInTransitVal.toNumber(),
        transitLossValuation: totalTransitLossVal.toNumber(),
        manufacturingWipValuation: totalWipVal.toNumber(),
        reconciliationVariance: finalVariance.toNumber(),
        isBalanced: finalVariance.abs().lessThan(0.01),
        notes: [
          "Physical inventory valuation derived from append-only stock ledger.",
          "In-transit inventory represents goods dispatched but not yet received at target warehouses.",
          "Work-in-progress represents raw material consumption for IN_PROGRESS production orders.",
          isPerpetual
            ? "Reconciliation evaluated against Perpetual GL Inventory Asset Accounts."
            : "Reconciliation evaluated against Periodic Trading Formula: Opening + Purchases - COGS - Transit Loss.",
        ],
        openingStockValuation: openingStockVal.toNumber(),
        costOfGoodsSoldValuation: netCogsVal.toNumber(),
        expectedPeriodicInventory: expectedPeriodicInventory.toNumber(),
        glInventoryAssetBalance: glInventoryAssetBalance.toNumber(),
        periodicVariance: periodicVariance.toNumber(),
        perpetualVariance: perpetualVariance.toNumber(),
        accountingPolicy,
      };
    });
  }

  /**
   * Detail report of all in-transit goods across warehouse transfers
   */
  async getInTransitValuationReport(
    ctx: TenantContext,
    query?: QueryReconciliationDto,
  ): Promise<InTransitValuationResponse> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      const transfers = await tx.stockTransfer.findMany({
        where: {
          companyId: ctx.companyId,
          status: StockTransferStatus.DISPATCHED,
        },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          items: { include: { item: true } },
        },
        orderBy: { transferDate: "desc" },
      });

      let grandInTransitQty = toDecimal(0);
      let grandInTransitVal = toDecimal(0);

      const transferSummaries = transfers.map((tr) => {
        let transferQty = toDecimal(0);
        let transferVal = toDecimal(0);

        for (const it of tr.items) {
          const remaining = toDecimal(it.quantity).sub(toDecimal(it.receivedQuantity || 0));
          if (remaining.greaterThan(0)) {
            transferQty = transferQty.add(remaining);
            transferVal = transferVal.add(remaining.mul(toDecimal(it.unitCost)));
          }
        }

        grandInTransitQty = grandInTransitQty.add(transferQty);
        grandInTransitVal = grandInTransitVal.add(transferVal);

        return {
          transferId: tr.id,
          transferNumber: tr.transferNumber,
          fromWarehouse: tr.fromWarehouse.name,
          toWarehouse: tr.toWarehouse.name,
          dispatchedAt: tr.dispatchedAt ? tr.dispatchedAt.toISOString() : tr.createdAt.toISOString(),
          itemsCount: tr.items.length,
          inTransitQuantity: transferQty.toNumber(),
          inTransitValuation: transferVal.toNumber(),
        };
      });

      return {
        companyId: ctx.companyId,
        totalInTransitQuantity: grandInTransitQty.toNumber(),
        totalInTransitValuation: grandInTransitVal.toNumber(),
        transfersCount: transfers.length,
        transfers: transferSummaries,
      };
    });
  }

  /**
   * Manufacturing cost reconciliation: Materials Consumed + Labor + Overhead vs Finished Goods Yield
   */
  async getManufacturingCostReconciliation(
    ctx: TenantContext,
    query?: QueryReconciliationDto,
  ): Promise<ManufacturingCostReconciliationResponse> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      const batches = await tx.productionBatch.findMany({
        where: {
          productionOrder: {
            companyId: ctx.companyId,
          },
        },
        include: {
          productionOrder: true,
        },
      });

      let totalRawCost = toDecimal(0);
      let totalLaborCost = toDecimal(0);
      let totalOverheadCost = toDecimal(0);
      let totalYieldValuation = toDecimal(0);

      for (const b of batches) {
        totalRawCost = totalRawCost.add(toDecimal(b.rawMaterialCost));
        totalLaborCost = totalLaborCost.add(toDecimal(b.actualLaborCost));
        totalOverheadCost = totalOverheadCost.add(toDecimal(b.actualOverheadCost));

        const yieldVal = toDecimal(b.actualProducedQty).mul(toDecimal(b.unitCost));
        totalYieldValuation = totalYieldValuation.add(yieldVal);
      }

      const totalProductionCost = totalRawCost.add(totalLaborCost).add(totalOverheadCost);
      const variance = totalProductionCost.sub(totalYieldValuation);

      return {
        companyId: ctx.companyId,
        totalOrdersCount: batches.length,
        totalRawMaterialCost: totalRawCost.toNumber(),
        totalActualLaborCost: totalLaborCost.toNumber(),
        totalActualOverheadCost: totalOverheadCost.toNumber(),
        totalProductionCost: totalProductionCost.toNumber(),
        totalFinishedValuationYield: totalYieldValuation.toNumber(),
        unabsorbedVariance: variance.toNumber(),
      };
    });
  }
}
