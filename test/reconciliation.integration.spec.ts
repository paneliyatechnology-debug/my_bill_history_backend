import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseService } from "../src/database/database.service";
import { AuditService } from "../src/audit/audit.service";
import { InventoryReconciliationService } from "../src/reconciliation/inventory-reconciliation.service";
import { PerpetualInventoryService } from "../src/reconciliation/perpetual-inventory.service";
import { TenantContext } from "@billing/shared-types";
import {
  StockTransferStatus,
  ProductionStatus,
  StockTransactionType,
  VoucherType,
  AccountNature,
} from "@billing/database";
import { Decimal } from "@billing/accounting-core";

describe("Phase 8.4: Inventory & Distribution Accounting Reconciliation Integration Test Suite", () => {
  let db: DatabaseService;
  let audit: AuditService;
  let reconService: InventoryReconciliationService;
  let perpetualService: PerpetualInventoryService;

  // Tenant A: Precision Manufacturing & Distribution
  const tenantAId = "e1111111-9999-9999-9999-aaaaaaaaaaaa";
  const orgAId = "e2222222-9999-9999-9999-aaaaaaaaaaaa";
  const companyAId = "e3333333-9999-9999-9999-aaaaaaaaaaaa";
  const branchA1Id = "e4444444-9999-9999-9999-aaaaaaaaaaaa";
  const fyAId = "e5555555-9999-9999-9999-aaaaaaaaaaaa";
  const warehouseA1Id = "e6666666-9999-9999-9999-aaaaaaaaaaaa";
  const warehouseA2Id = "e7777777-9999-9999-9999-aaaaaaaaaaaa";
  const userAId = "e0000000-0000-0000-0000-000000000001";

  // Tenant B: Competitor Enterprises (Isolation verification)
  const tenantBId = "ebbbbbbb-9999-9999-9999-bbbbbbbbbbbb";
  const orgBId = "eccccccc-9999-9999-9999-bbbbbbbbbbbb";
  const companyBId = "eddddddd-9999-9999-9999-bbbbbbbbbbbb";
  const branchBId = "eeeeeeee-9999-9999-9999-bbbbbbbbbbbb";
  const fyBId = "efffffff-9999-9999-9999-bbbbbbbbbbbb";
  const warehouseBId = "e8888888-9999-9999-9999-bbbbbbbbbbbb";
  const userBId = "e0000000-0000-0000-0000-000000000002";

  // Shared UOM & Items
  const uomId = "ea111111-9999-9999-9999-aaaaaaaaaaaa";
  const rawItemId = "ea222222-9999-9999-9999-aaaaaaaaaaaa";
  const finishedItemId = "ea333333-9999-9999-9999-aaaaaaaaaaaa";
  const bomAId = "ea444444-9999-9999-9999-aaaaaaaaaaaa";

  // Tenant Contexts
  const tenantACtx: TenantContext = {
    userId: userAId,
    organizationId: orgAId,
    companyId: companyAId,
    branchId: branchA1Id,
  };

  const tenantBCtx: TenantContext = {
    userId: userBId,
    organizationId: orgBId,
    companyId: companyBId,
    branchId: branchBId,
  };

  // Ledger Account IDs for Tenant A
  const lgAssetsId = "ea555555-9999-9999-9999-aaaaaaaaaaaa";
  const lgExpensesId = "ea666666-9999-9999-9999-aaaaaaaaaaaa";
  const lgLiabilitiesId = "ea777777-9999-9999-9999-aaaaaaaaaaaa";

  const rawMatAccountId = "ea888888-9999-9999-9999-aaaaaaaaaaaa";
  const fgAccountId = "ea999999-9999-9999-9999-aaaaaaaaaaaa";
  const wipAccountId = "eaa11111-9999-9999-9999-aaaaaaaaaaaa";
  const transitLossAccountId = "eaa22222-9999-9999-9999-aaaaaaaaaaaa";
  const purchasesAccountId = "eaa33333-9999-9999-9999-aaaaaaaaaaaa";
  const creditorsAccountId = "eaa44444-9999-9999-9999-aaaaaaaaaaaa";

  beforeAll(async () => {
    db = new DatabaseService();
    await db.onModuleInit();
    audit = new AuditService(db);
    reconService = new InventoryReconciliationService(db);
    perpetualService = new PerpetualInventoryService(db, audit);

    // Clean up test data bypassing RLS
    await db.executeBypassRls(async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM journal_entries WHERE voucher_id IN (SELECT id FROM vouchers WHERE company_id IN ('${companyAId}', '${companyBId}'))`);
      await tx.$executeRawUnsafe(`DELETE FROM vouchers WHERE company_id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM stock_transactions WHERE company_id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE company_id IN ('${companyAId}', '${companyBId}'))`);
      await tx.$executeRawUnsafe(`DELETE FROM stock_transfers WHERE company_id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM production_batches WHERE production_order_id IN (SELECT id FROM production_orders WHERE company_id IN ('${companyAId}', '${companyBId}'))`);
      await tx.$executeRawUnsafe(`DELETE FROM production_orders WHERE company_id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM bom_items WHERE bom_id IN (SELECT id FROM bills_of_material WHERE company_id IN ('${companyAId}', '${companyBId}'))`);
      await tx.$executeRawUnsafe(`DELETE FROM bills_of_material WHERE company_id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM ledger_accounts WHERE company_id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM ledger_groups WHERE company_id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM items WHERE company_id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM units_of_measure WHERE company_id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM warehouses WHERE company_id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM financial_years WHERE company_id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM branches WHERE company_id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM audit_logs WHERE organization_id IN ('${orgAId}', '${orgBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM users WHERE organization_id IN ('${orgAId}', '${orgBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM companies WHERE id IN ('${companyAId}', '${companyBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM organizations WHERE id IN ('${orgAId}', '${orgBId}')`);
      await tx.$executeRawUnsafe(`DELETE FROM tenants WHERE id IN ('${tenantAId}', '${tenantBId}')`);

      // Seed Tenants & Orgs
      const trialEnd = new Date(Date.now() + 30 * 86400000);
      await tx.tenant.createMany({
        data: [
          { id: tenantAId, primaryPhone: "9666600001", subscriptionTier: "DISTRIBUTION_ENTERPRISE", subscriptionEnds: trialEnd },
          { id: tenantBId, primaryPhone: "9666600002", subscriptionTier: "DISTRIBUTION_ENTERPRISE", subscriptionEnds: trialEnd },
        ],
      });

      await tx.organization.createMany({
        data: [
          { id: orgAId, tenantId: tenantAId, name: "Precision Recon Org A", legalName: "Precision Recon Org A Ltd" },
          { id: orgBId, tenantId: tenantBId, name: "Competitor Recon Org B", legalName: "Competitor Recon Org B Ltd" },
        ],
      });

      await tx.user.createMany({
        data: [
          {
            id: userAId,
            organizationId: orgAId,
            email: "accountant@precisionrecon.com",
            phone: "9666600001",
            passwordHash: "dummyhash",
            fullName: "Recon Accountant A",
            role: "ACCOUNTANT",
          },
          {
            id: userBId,
            organizationId: orgBId,
            email: "accountant@competitorrecon.com",
            phone: "9666600002",
            passwordHash: "dummyhash",
            fullName: "Recon Accountant B",
            role: "ACCOUNTANT",
          },
        ],
      });

      await tx.company.createMany({
        data: [
          {
            id: companyAId,
            organizationId: orgAId,
            legalName: "Precision Engineering Works Pvt Ltd",
            tradeName: "Precision Engineering Works",
            gstin: "24AAACP0001A1Z5",
            stateCode: "24",
            addressLine1: "GIDC Industrial Estate",
            city: "Rajkot",
            pincode: "360001",
            phone: "9777700001",
            allowNegativeStock: false,
          },
          {
            id: companyBId,
            organizationId: orgBId,
            legalName: "Competitor Forge Pvt Ltd",
            tradeName: "Competitor Forge",
            gstin: "24BBBCP0002B1Z6",
            stateCode: "24",
            addressLine1: "Makarpura GIDC",
            city: "Vadodara",
            pincode: "390010",
            phone: "9777700002",
            allowNegativeStock: false,
          },
        ],
      });

      await tx.branch.createMany({
        data: [
          {
            id: branchA1Id,
            organizationId: orgAId,
            companyId: companyAId,
            name: "Rajkot Factory Plant",
            code: "RJK-01",
            addressLine1: "GIDC Industrial Estate",
            city: "Rajkot",
            pincode: "360001",
            stateCode: "24",
            phone: "9777700001",
          },
          {
            id: branchBId,
            organizationId: orgBId,
            companyId: companyBId,
            name: "Vadodara Plant",
            code: "VAD-01",
            addressLine1: "Makarpura GIDC",
            city: "Vadodara",
            pincode: "390010",
            stateCode: "24",
            phone: "9777700002",
          },
        ],
      });

      await tx.financialYear.createMany({
        data: [
          {
            id: fyAId,
            companyId: companyAId,
            name: "FY 2026-27",
            startDate: new Date("2026-04-01"),
            endDate: new Date("2027-03-31"),
            isCurrent: true,
            isLocked: false,
          },
          {
            id: fyBId,
            companyId: companyBId,
            name: "FY 2026-27",
            startDate: new Date("2026-04-01"),
            endDate: new Date("2027-03-31"),
            isCurrent: true,
            isLocked: false,
          },
        ],
      });

      await tx.warehouse.createMany({
        data: [
          {
            id: warehouseA1Id,
            organizationId: orgAId,
            companyId: companyAId,
            branchId: branchA1Id,
            name: "Raw Material Yard",
            isDefault: true,
          },
          {
            id: warehouseA2Id,
            organizationId: orgAId,
            companyId: companyAId,
            branchId: branchA1Id,
            name: "Finished Goods Depot",
            isDefault: false,
          },
          {
            id: warehouseBId,
            organizationId: orgBId,
            companyId: companyBId,
            branchId: branchBId,
            name: "Competitor Warehouse",
            isDefault: true,
          },
        ],
      });

      // Seed UOM & Items
      await tx.unitOfMeasure.create({
        data: {
          id: uomId,
          organizationId: orgAId,
          companyId: companyAId,
          name: "Kilograms",
          symbol: "KG",
          uqcCode: "KGS",
          decimalPlaces: 2,
        },
      });

      await tx.item.createMany({
        data: [
          {
            id: rawItemId,
            organizationId: orgAId,
            companyId: companyAId,
            name: "Steel Rod 20mm",
            sku: "STL-ROD-20",
            hsnCode: "7214",
            taxRate: 18.0,
            type: "PRODUCT",
            primaryUomId: uomId,
            purchaseRate: 100.0,
            retailPrice: 130.0,
          },
          {
            id: finishedItemId,
            organizationId: orgAId,
            companyId: companyAId,
            name: "Machined Steel Flange",
            sku: "MCH-FLG-50",
            hsnCode: "7307",
            taxRate: 18.0,
            type: "PRODUCT",
            primaryUomId: uomId,
            purchaseRate: 200.0,
            retailPrice: 280.0,
          },
        ],
      });

      // Seed Ledger Groups & Accounts
      await tx.ledgerGroup.createMany({
        data: [
          { id: lgAssetsId, organizationId: orgAId, companyId: companyAId, name: "Current Assets", nature: AccountNature.ASSET, isSystem: true },
          { id: lgExpensesId, organizationId: orgAId, companyId: companyAId, name: "Direct Expenses", nature: AccountNature.EXPENSE, isSystem: true },
          { id: lgLiabilitiesId, organizationId: orgAId, companyId: companyAId, name: "Current Liabilities", nature: AccountNature.LIABILITY, isSystem: true },
        ],
      });

      await tx.ledgerAccount.createMany({
        data: [
          { id: rawMatAccountId, organizationId: orgAId, companyId: companyAId, groupId: lgAssetsId, name: "Raw Material Stock A/c", openingBalance: 0, openingType: "DR", currentBalance: 0 },
          { id: fgAccountId, organizationId: orgAId, companyId: companyAId, groupId: lgAssetsId, name: "Finished Goods Stock A/c", openingBalance: 0, openingType: "DR", currentBalance: 0 },
          { id: wipAccountId, organizationId: orgAId, companyId: companyAId, groupId: lgAssetsId, name: "Work In Progress A/c", openingBalance: 0, openingType: "DR", currentBalance: 0 },
          { id: transitLossAccountId, organizationId: orgAId, companyId: companyAId, groupId: lgExpensesId, name: "Transit Loss A/c", openingBalance: 0, openingType: "DR", currentBalance: 0 },
          { id: purchasesAccountId, organizationId: orgAId, companyId: companyAId, groupId: lgExpensesId, name: "Purchase Account", openingBalance: 0, openingType: "DR", currentBalance: 0 },
          { id: creditorsAccountId, organizationId: orgAId, companyId: companyAId, groupId: lgLiabilitiesId, name: "Sundry Creditors", openingBalance: 0, openingType: "CR", currentBalance: 0 },
        ],
      });
    });
  });

  afterAll(async () => {
    await db.onModuleDestroy();
  });

  describe("1. Physical Stock Valuation vs General Ledger Reconciliation", () => {
    it("should compute physical stock valuation and match GL purchases", async () => {
      // Create stock transactions for Tenant A: 100 KG @ 100 = 10,000
      await db.executeInTenantContext(tenantACtx, async (tx) => {
        await tx.stockTransaction.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            warehouseId: warehouseA1Id,
            itemId: rawItemId,
            transactionType: StockTransactionType.PURCHASE_RECEIPT,
            transactionDate: new Date("2026-05-10"),
            quantity: 100,
            valuationRate: 100.0,
            totalValuation: 10000.0,
            referenceDocType: "PURCHASE_ORDER",
            referenceDocId: "ea999999-0000-0000-0000-000000000001",
          },
        });
      });

      // Post General Ledger purchase entry: Dr Purchase A/c 10,000 / Cr Creditors 10,000
      await db.executeInTenantContext(tenantACtx, async (tx) => {
        const v = await tx.voucher.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            financialYearId: fyAId,
            voucherType: VoucherType.PURCHASE,
            voucherNumber: "PUR-2026-0001",
            voucherDate: new Date("2026-05-10"),
            totalAmount: 10000.0,
            narration: "Raw material purchase",
            sourceDocument: "PURCHASE_INVOICE",
          },
        });
        await tx.journalEntry.createMany({
          data: [
            { voucherId: v.id, accountId: purchasesAccountId, debitAmount: 10000.0, creditAmount: 0.0, sequenceOrder: 1 },
            { voucherId: v.id, accountId: creditorsAccountId, debitAmount: 0.0, creditAmount: 10000.0, sequenceOrder: 2 },
          ],
        });
      });

      const report = await reconService.getPhysicalVsGlReconciliation(tenantACtx, {
        financialYearId: fyAId,
      });

      expect(report.companyId).toBe(companyAId);
      expect(report.physicalStockValuation).toBe(10000.0);
      expect(report.generalLedgerPurchaseTotal).toBe(10000.0);
      expect(report.reconciliationVariance).toBe(0.0);
      expect(report.isBalanced).toBe(true);
      expect(report.totalItemsCount).toBe(1);
    });
  });

  describe("2. In-Transit Inventory Valuation & Transit Variance", () => {
    let transferId: string;

    it("should report goods in transit and detect shortage and damage", async () => {
      // Create Stock Transfer: RMY -> FGD (50 KG @ 100 = 5000)
      await db.executeInTenantContext(tenantACtx, async (tx) => {
        const tr = await tx.stockTransfer.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            branchId: branchA1Id,
            financialYearId: fyAId,
            fromWarehouseId: warehouseA1Id,
            toWarehouseId: warehouseA2Id,
            transferNumber: "TRF-2026-0001",
            transferDate: new Date("2026-06-01"),
            status: StockTransferStatus.DISPATCHED,
            dispatchedAt: new Date("2026-06-01T10:00:00Z"),
          },
        });
        transferId = tr.id;

        await tx.stockTransferItem.create({
          data: {
            transferId: tr.id,
            itemId: rawItemId,
            quantity: 50,
            unitCost: 100.0,
            totalCost: 5000.0,
          },
        });
      });

      // Verify in-transit valuation while DISPATCHED
      const inTransitBefore = await reconService.getInTransitValuationReport(tenantACtx);
      expect(inTransitBefore.totalInTransitValuation).toBe(5000.0);
      expect(inTransitBefore.totalInTransitQuantity).toBe(50.0);
      expect(inTransitBefore.transfersCount).toBe(1);
      expect(inTransitBefore.transfers[0].transferNumber).toBe("TRF-2026-0001");

      // Mark received with shortage (received 47 out of 50, variance = 3 KG @ 100 = 300)
      await db.executeInTenantContext(tenantACtx, async (tx) => {
        await tx.stockTransferItem.updateMany({
          where: { transferId },
          data: { receivedQuantity: 47 },
        });

        await tx.stockTransfer.update({
          where: { id: transferId },
          data: {
            status: StockTransferStatus.RECEIVED,
            receivedAt: new Date("2026-06-02T14:00:00Z"),
          },
        });
      });

      // Verify in-transit report after receipt
      const inTransitAfter = await reconService.getInTransitValuationReport(tenantACtx);
      expect(inTransitAfter.totalInTransitValuation).toBe(0.0);
      expect(inTransitAfter.transfersCount).toBe(0);

      // Verify physical stock vs GL report reflects transit loss valuation
      const recon = await reconService.getPhysicalVsGlReconciliation(tenantACtx, {});
      expect(recon.transitLossValuation).toBe(300.0); // 3 KG * 100
    });
  });

  describe("3. Manufacturing WIP & Cost Reconciliation", () => {
    let prodOrderId: string;

    it("should compute WIP and finished goods valuation for production orders", async () => {
      // Create BOM
      await db.executeInTenantContext(tenantACtx, async (tx) => {
        const bom = await tx.billOfMaterial.create({
          data: {
            id: bomAId,
            organizationId: orgAId,
            companyId: companyAId,
            finishedItemId,
            bomName: "Standard Flange BOM",
            batchYieldQty: 10,
            laborCostEst: 500.0,
            overheadCostEst: 200.0,
          },
        });

        await tx.bomItem.create({
          data: {
            bomId: bom.id,
            rawItemId,
            quantity: 12,
            wastagePercent: 2.0,
          },
        });

        // Create Production Order (IN_PROGRESS)
        const po = await tx.productionOrder.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            bomId: bom.id,
            orderNumber: "PO-MFG-001",
            targetQuantity: 10,
            status: ProductionStatus.IN_PROGRESS,
            startDate: new Date("2026-07-01"),
          },
        });
        prodOrderId = po.id;

        // Record raw material consumption stock transaction
        await tx.stockTransaction.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            warehouseId: warehouseA1Id,
            itemId: rawItemId,
            transactionType: StockTransactionType.MANUFACTURING_CONSUMPTION,
            transactionDate: new Date("2026-07-01"),
            quantity: -12,
            valuationRate: 100.0,
            totalValuation: 1200.0,
            referenceDocType: "PRODUCTION_ORDER",
            referenceDocId: po.id,
          },
        });
      });

      // Check WIP valuation while IN_PROGRESS
      const wipRecon = await reconService.getPhysicalVsGlReconciliation(tenantACtx, {});
      expect(wipRecon.manufacturingWipValuation).toBe(1200.0);

      // Complete Production Order with ProductionBatch
      await db.executeInTenantContext(tenantACtx, async (tx) => {
        await tx.productionOrder.update({
          where: { id: prodOrderId },
          data: {
            status: ProductionStatus.COMPLETED,
            completedDate: new Date("2026-07-02"),
          },
        });

        await tx.productionBatch.create({
          data: {
            productionOrderId: prodOrderId,
            batchNumber: "BATCH-2026-001",
            actualProducedQty: 10,
            scrapQuantity: 0.5,
            rawMaterialCost: 1200.0,
            actualLaborCost: 500.0,
            actualOverheadCost: 200.0,
            unitCost: 190.0,
          },
        });
      });

      // Verify finished goods cost reconciliation
      const mfgCost = await reconService.getManufacturingCostReconciliation(tenantACtx);
      expect(mfgCost.totalOrdersCount).toBe(1);
      expect(mfgCost.totalRawMaterialCost).toBe(1200.0);
      expect(mfgCost.totalActualLaborCost).toBe(500.0);
      expect(mfgCost.totalActualOverheadCost).toBe(200.0);
      expect(mfgCost.totalProductionCost).toBe(1900.0);
      expect(mfgCost.totalFinishedValuationYield).toBe(1900.0);
      expect(mfgCost.unabsorbedVariance).toBe(0.0);
    });
  });

  describe("4. Perpetual Inventory Journal Postings & Double-Entry Invariants", () => {
    let prodOrderId: string;
    let mfgVoucherId: string;
    let transferId: string;
    let transitVoucherId: string;

    beforeAll(async () => {
      const po = await db.productionOrder.findFirst({
        where: { companyId: companyAId, orderNumber: "PO-MFG-001" },
      });
      prodOrderId = po!.id;

      const tr = await db.stockTransfer.findFirst({
        where: { companyId: companyAId, transferNumber: "TRF-2026-0001" },
      });
      transferId = tr!.id;
    });

    it("should post balanced manufacturing completion journal (Dr. FG / Cr. WIP)", async () => {
      const voucher = await perpetualService.postManufacturingCompletionJournal(tenantACtx, {
        journalType: "MANUFACTURING_COMPLETION",
        productionOrderId: prodOrderId,
        debitAccountId: fgAccountId,
        creditAccountId: wipAccountId,
        narration: "Manufacturing batch FG capitalization",
      });

      expect(voucher.voucherType).toBe("JOURNAL");
      expect(Number(voucher.totalAmount)).toBe(1900.0);
      mfgVoucherId = voucher.id;

      // Verify double-entry balance in database: sum(Dr) == sum(Cr)
      const fullVoucher = await db.voucher.findUnique({
        where: { id: voucher.id },
        include: { journalEntries: true },
      });
      expect(fullVoucher).toBeDefined();
      expect(fullVoucher!.journalEntries).toHaveLength(2);

      const debitTotal = fullVoucher!.journalEntries.reduce(
        (sum, line) => sum.plus(line.debitAmount.toString()),
        new Decimal(0),
      );
      const creditTotal = fullVoucher!.journalEntries.reduce(
        (sum, line) => sum.plus(line.creditAmount.toString()),
        new Decimal(0),
      );

      expect(debitTotal.equals(creditTotal)).toBe(true);
      expect(debitTotal.toNumber()).toBe(1900.0);
      expect(creditTotal.toNumber()).toBe(1900.0);
    });

    it("should prevent duplicate vouchers for the same production order (idempotency)", async () => {
      const duplicateVoucher = await perpetualService.postManufacturingCompletionJournal(tenantACtx, {
        journalType: "MANUFACTURING_COMPLETION",
        productionOrderId: prodOrderId,
        debitAccountId: fgAccountId,
        creditAccountId: wipAccountId,
      });

      // Must return the exact same existing voucher without creating a duplicate
      expect(duplicateVoucher.id).toBe(mfgVoucherId);

      const count = await db.voucher.count({
        where: {
          companyId: companyAId,
          sourceDocument: "PRODUCTION_ORDER",
          sourceEntityId: prodOrderId,
        },
      });
      expect(count).toBe(1);
    });

    it("should post balanced transit loss write-off journal (Dr. Transit Loss / Cr. Purchases)", async () => {
      const voucher = await perpetualService.postTransitLossWriteOffJournal(tenantACtx, {
        journalType: "TRANSIT_LOSS_WRITEOFF",
        stockTransferId: transferId,
        debitAccountId: transitLossAccountId,
        creditAccountId: purchasesAccountId,
        narration: "Transit shortage and damage write-off",
      });

      expect(voucher.voucherType).toBe("JOURNAL");
      expect(Number(voucher.totalAmount)).toBe(300.0);
      transitVoucherId = voucher.id;

      // Verify double-entry balance
      const fullVoucher = await db.voucher.findUnique({
        where: { id: voucher.id },
        include: { journalEntries: true },
      });
      expect(fullVoucher).toBeDefined();
      expect(fullVoucher!.journalEntries).toHaveLength(2);

      const drLine = fullVoucher!.journalEntries.find((e) => e.accountId === transitLossAccountId);
      const crLine = fullVoucher!.journalEntries.find((e) => e.accountId === purchasesAccountId);

      expect(drLine).toBeDefined();
      expect(Number(drLine!.debitAmount)).toBe(300.0);
      expect(Number(drLine!.creditAmount)).toBe(0.0);

      expect(crLine).toBeDefined();
      expect(Number(crLine!.creditAmount)).toBe(300.0);
      expect(Number(crLine!.debitAmount)).toBe(0.0);
    });

    it("should prevent duplicate transit loss vouchers for the same transfer", async () => {
      const duplicate = await perpetualService.postTransitLossWriteOffJournal(tenantACtx, {
        journalType: "TRANSIT_LOSS_WRITEOFF",
        stockTransferId: transferId,
        debitAccountId: transitLossAccountId,
        creditAccountId: purchasesAccountId,
      });

      expect(duplicate.id).toBe(transitVoucherId);
    });

    it("should reject posting when the accounting period is locked", async () => {
      // Lock the financial year
      await db.financialYear.update({
        where: { id: fyAId },
        data: { isLocked: true },
      });

      // Try posting transit loss journal while locked
      // Create a fresh transfer to avoid the existing-voucher idempotency guard
      let freshTransferId: string;
      await db.executeInTenantContext(tenantACtx, async (tx) => {
        const freshTr = await tx.stockTransfer.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            branchId: branchA1Id,
            financialYearId: fyAId,
            fromWarehouseId: warehouseA1Id,
            toWarehouseId: warehouseA2Id,
            transferNumber: "TRF-LOCKED-001",
            transferDate: new Date("2026-06-05"),
            status: StockTransferStatus.RECEIVED,
            receivedAt: new Date("2026-06-06T12:00:00Z"),
          },
        });
        freshTransferId = freshTr.id;
        await tx.stockTransferItem.create({
          data: {
            transferId: freshTr.id,
            itemId: rawItemId,
            quantity: 10,
            receivedQuantity: 8,
            unitCost: 100.0,
            totalCost: 1000.0,
          },
        });
      });

      await expect(
        perpetualService.postTransitLossWriteOffJournal(tenantACtx, {
          journalType: "TRANSIT_LOSS_WRITEOFF",
          stockTransferId: freshTransferId!,
          debitAccountId: transitLossAccountId,
          creditAccountId: purchasesAccountId,
        }),
      ).rejects.toThrow("is locked");

      // Unlock for subsequent tests
      await db.financialYear.update({
        where: { id: fyAId },
        data: { isLocked: false },
      });
    });

    it("should create append-only contra reversal voucher and mark original cancelled", async () => {
      const revVoucher = await perpetualService.reverseInventoryJournal(
        tenantACtx,
        mfgVoucherId,
        "Erroneous production batch cost calculation",
      );

      expect(revVoucher.referenceNo).toMatch(/^JRN\//);

      // Verify original voucher is marked isCancelled: true
      const original = await db.voucher.findUnique({
        where: { id: mfgVoucherId },
      });
      expect(original!.isCancelled).toBe(true);

      // Verify reversal voucher is append-only contra entry
      expect(revVoucher.isCancelled).toBe(false);

      // Verify swapped debits and credits
      const drLine = revVoucher.journalEntries.find((e: any) => e.accountId === wipAccountId);
      const crLine = revVoucher.journalEntries.find((e: any) => e.accountId === fgAccountId);

      expect(drLine).toBeDefined();
      expect(Number(drLine!.debitAmount)).toBe(1900.0);
      expect(crLine).toBeDefined();
      expect(Number(crLine!.creditAmount)).toBe(1900.0);

      // Net balance across original + reversal is exactly zero
      const netDebit = revVoucher.journalEntries
        .concat(await db.journalEntry.findMany({ where: { voucherId: mfgVoucherId } }))
        .reduce((sum: Decimal, e: any) => sum.plus(e.debitAmount.toString()), new Decimal(0));
      const netCredit = revVoucher.journalEntries
        .concat(await db.journalEntry.findMany({ where: { voucherId: mfgVoucherId } }))
        .reduce((sum: Decimal, e: any) => sum.plus(e.creditAmount.toString()), new Decimal(0));

      expect(netDebit.equals(netCredit)).toBe(true);
    });

    it("should prevent reversing an already cancelled voucher", async () => {
      await expect(
        perpetualService.reverseInventoryJournal(
          tenantACtx,
          mfgVoucherId,
          "Attempt duplicate reversal",
        ),
      ).rejects.toThrow("already cancelled");
    });
  });

  describe("5. Tenant Isolation & Cross-Tenant Boundary Enforcement", () => {
    it("should prevent Tenant B from accessing Tenant A reconciliation reports", async () => {
      const reportB = await reconService.getPhysicalVsGlReconciliation(tenantBCtx, {});
      expect(reportB.companyId).toBe(companyBId);
      expect(reportB.physicalStockValuation).toBe(0.0);
      expect(reportB.totalItemsCount).toBe(0);

      const inTransitB = await reconService.getInTransitValuationReport(tenantBCtx);
      expect(inTransitB.totalInTransitValuation).toBe(0.0);
      expect(inTransitB.transfersCount).toBe(0);
      expect(inTransitB.transfers).toHaveLength(0);
    });

    it("should prevent Tenant B from reversing Tenant A vouchers", async () => {
      const vA = await db.voucher.findFirst({
        where: { companyId: companyAId, isCancelled: false },
      });
      expect(vA).toBeDefined();

      await expect(
        perpetualService.reverseInventoryJournal(
          tenantBCtx,
          vA!.id,
          "Unauthorized cross-tenant reversal attempt",
        ),
      ).rejects.toThrow();
    });
  });

  describe("6. Comprehensive Lifecycle & Reversal Accounting Correctness", () => {
    it("should reconcile end-to-end periodic inventory lifecycle with opening stock and sales COGS", async () => {
      // Create isolated second item for end-to-end trace: Copper Wire (50/KG)
      const copperItemId = "ea666666-0000-0000-0000-000000000001";
      await db.executeInTenantContext(tenantACtx, async (tx) => {
        await tx.item.create({
          data: {
            id: copperItemId,
            organizationId: orgAId,
            companyId: companyAId,
            name: "Copper Wire 2mm",
            sku: "CPR-WIR-02",
            hsnCode: "7408",
            taxRate: 18.0,
            type: "PRODUCT",
            primaryUomId: uomId,
            purchaseRate: 50.0,
            retailPrice: 75.0,
          },
        });

        // 1. Opening Stock: 20 KG @ 50 = 1,000
        await tx.stockTransaction.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            warehouseId: warehouseA1Id,
            itemId: copperItemId,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date("2026-04-01"),
            quantity: 20,
            valuationRate: 50.0,
            totalValuation: 1000.0,
            referenceDocType: "OPENING_BALANCE",
            referenceDocId: "ea999999-0000-0000-0000-000000000099",
          },
        });

        // 2. Sales Dispatch: Sold 10 KG (Cost = 10 * 50 = 500 COGS)
        await tx.stockTransaction.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            warehouseId: warehouseA1Id,
            itemId: copperItemId,
            transactionType: StockTransactionType.SALES_DISPATCH,
            transactionDate: new Date("2026-04-15"),
            quantity: -10,
            valuationRate: 50.0,
            totalValuation: 500.0,
            referenceDocType: "SALES_INVOICE",
            referenceDocId: "ea999999-0000-0000-0000-000000000098",
          },
        });
      });

      // Query reconciliation
      const report = await reconService.getPhysicalVsGlReconciliation(tenantACtx, {
        asOfDate: "2026-05-01",
      });

      // Expected math:
      // Copper On-hand: 10 KG @ 50 = 500
      // Opening Stock = 1,000
      // COGS = 500
      // Expected Periodic Inventory = Opening (1,000) - COGS (500) = 500
      // Actual Physical Inventory = 500 (plus steel purchases from section 1 if within range)
      expect(report.openingStockValuation).toBeGreaterThanOrEqual(1000.0);
      expect(report.costOfGoodsSoldValuation).toBeGreaterThanOrEqual(500.0);
      expect(report.isBalanced).toBe(true);
    });

    it("should guarantee cancelled and reversed purchase vouchers net to zero without skewing GL purchases", async () => {
      let testVoucherId: string;

      // 1. Post a test purchase voucher of 7,500
      await db.executeInTenantContext(tenantACtx, async (tx) => {
        const v = await tx.voucher.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            financialYearId: fyAId,
            voucherType: VoucherType.PURCHASE,
            voucherNumber: "PUR-TEST-CANCEL-01",
            voucherDate: new Date("2026-08-10"),
            totalAmount: 7500.0,
            narration: "Temporary test purchase to be cancelled",
          },
        });
        testVoucherId = v.id;
        await tx.journalEntry.createMany({
          data: [
            { voucherId: v.id, accountId: purchasesAccountId, debitAmount: 7500.0, creditAmount: 0.0, sequenceOrder: 1 },
            { voucherId: v.id, accountId: creditorsAccountId, debitAmount: 0.0, creditAmount: 7500.0, sequenceOrder: 2 },
          ],
        });
      });

      // 2. Reverse it with append-only contra voucher
      await db.executeInTenantContext(tenantACtx, async (tx) => {
        // Mark original cancelled
        await tx.voucher.update({
          where: { id: testVoucherId },
          data: { isCancelled: true },
        });

        // Create contra reversal voucher
        const rev = await tx.voucher.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            financialYearId: fyAId,
            voucherType: VoucherType.JOURNAL,
            voucherNumber: "REV/PUR-TEST-CANCEL-01",
            voucherDate: new Date("2026-08-11"),
            referenceNo: "PUR-TEST-CANCEL-01",
            totalAmount: 7500.0,
            narration: "Contra reversal of PUR-TEST-CANCEL-01",
            isCancelled: false,
            sourceDocument: "VOUCHER_REVERSAL",
          },
        });
        await tx.journalEntry.createMany({
          data: [
            { voucherId: rev.id, accountId: creditorsAccountId, debitAmount: 7500.0, creditAmount: 0.0, sequenceOrder: 1 },
            { voucherId: rev.id, accountId: purchasesAccountId, debitAmount: 0.0, creditAmount: 7500.0, sequenceOrder: 2 },
          ],
        });
      });

      // 3. Query reconciliation: The cancelled + reversal pair must net to exactly 0 in Purchases
      const report = await reconService.getPhysicalVsGlReconciliation(tenantACtx, {
        asOfDate: "2026-08-31",
      });

      // Net purchase reflects:
      // 10,000 (initial purchase) - 300 (transit loss write-off credit from Section 4) + 7,500 (test) - 7,500 (reversal) = 9,700.0
      expect(report.generalLedgerPurchaseTotal).toBe(9700.0);
    });
  });
});
