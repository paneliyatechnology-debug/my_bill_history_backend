import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseService } from "../src/database/database.service";
import { BomService } from "../src/manufacturing/bom.service";
import { ProductionOrdersService } from "../src/manufacturing/production-orders.service";
import { AuditService } from "../src/audit/audit.service";
import { TenantContext } from "@billing/shared-types";
import { StockTransactionType, ProductionStatus } from "@billing/database";

describe("Phase 8.2: BOM & Production Backend Integration Test Suite", () => {
  let db: DatabaseService;
  let audit: AuditService;
  let bomService: BomService;
  let prodService: ProductionOrdersService;

  const orgAId = "77777777-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const orgBId = "77777777-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const tenantAId = "66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const tenantBId = "66666666-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const companyAId = "aaaaaaaa-7777-7777-7777-aaaaaaaaaaaa";
  const companyBId = "bbbbbbbb-7777-7777-7777-bbbbbbbbbbbb";
  const branchAId = "a1111111-7777-7777-7777-aaaaaaaaaaaa";
  const branchBId = "b1111111-7777-7777-7777-bbbbbbbbbbbb";
  const fyAId = "a2222222-7777-7777-7777-aaaaaaaaaaaa";
  const fyBId = "b2222222-7777-7777-7777-bbbbbbbbbbbb";

  const warehouseAId = "a3333333-7777-7777-7777-aaaaaaaaaaaa";
  const warehouseBId = "b3333333-7777-7777-7777-bbbbbbbbbbbb";

  const uomAId = "a4444444-7777-7777-7777-aaaaaaaaaaaa";
  const rawItem1Id = "a5555555-7777-7777-7777-aaaaaaaaaaaa";
  const rawItem2Id = "a6666666-7777-7777-7777-aaaaaaaaaaaa";
  const finishedItemId = "a7777777-7777-7777-7777-aaaaaaaaaaaa";
  const serviceItemId = "a8888888-7777-7777-7777-aaaaaaaaaaaa";

  const userAId = "00000000-0000-0000-0000-000000000001";
  const userBId = "00000000-0000-0000-0000-000000000002";

  const tenantACtx: TenantContext = {
    userId: userAId,
    organizationId: orgAId,
    companyId: companyAId,
    branchId: branchAId,
  };

  const tenantBCtx: TenantContext = {
    userId: userBId,
    organizationId: orgBId,
    companyId: companyBId,
    branchId: branchBId,
  };

  beforeAll(async () => {
    db = new DatabaseService();
    await db.onModuleInit();
    audit = new AuditService(db);
    bomService = new BomService(db, audit);
    prodService = new ProductionOrdersService(db, audit);

    // Clean up isolated test data
    await db.executeBypassRls(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM stock_transactions WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM production_batches WHERE production_order_id IN (SELECT id FROM production_orders WHERE company_id IN ('${companyAId}', '${companyBId}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM production_orders WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM bom_items WHERE bom_id IN (SELECT id FROM bills_of_material WHERE company_id IN ('${companyAId}', '${companyBId}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM bills_of_material WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM item_batches WHERE item_id IN ('${finishedItemId}', '${rawItem1Id}', '${rawItem2Id}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM items WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM units_of_measure WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM warehouses WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM financial_years WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM branches WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM audit_logs WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM users WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM companies WHERE id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM organizations WHERE id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM tenants WHERE id IN ('${tenantAId}', '${tenantBId}')`,
      );

      // Seed tenants, companies, branches, financial years
      const trialEnd = new Date(Date.now() + 30 * 86400000);
      await tx.tenant.createMany({
        data: [
          { id: tenantAId, primaryPhone: "9777700001", subscriptionTier: "MANUFACTURING_SUITE", subscriptionEnds: trialEnd },
          { id: tenantBId, primaryPhone: "9777700002", subscriptionTier: "MANUFACTURING_SUITE", subscriptionEnds: trialEnd },
        ],
      });

      await tx.organization.createMany({
        data: [
          { id: orgAId, tenantId: tenantAId, name: "Mfg Test Org A", legalName: "Mfg Org A Ltd" },
          { id: orgBId, tenantId: tenantBId, name: "Mfg Test Org B", legalName: "Mfg Org B Ltd" },
        ],
      });

      await tx.user.createMany({
        data: [
          {
            id: userAId,
            organizationId: orgAId,
            fullName: "Mfg Operator A",
            phone: "9777700001",
            email: "mfg_op_a@test.local",
            passwordHash: "dummy",
            role: "COMPANY_ADMIN",
          },
          {
            id: userBId,
            organizationId: orgBId,
            fullName: "Mfg Operator B",
            phone: "9777700002",
            email: "mfg_op_b@test.local",
            passwordHash: "dummy",
            role: "COMPANY_ADMIN",
          },
        ],
      });

      await tx.company.createMany({
        data: [
          {
            id: companyAId,
            organizationId: orgAId,
            legalName: "Precision Manufacturing Ltd",
            tradeName: "Precision Mfg",
            gstin: "24AAAAA7777A1Z5",
            stateCode: "24",
            addressLine1: "Industrial Zone",
            city: "Rajkot",
            pincode: "360001",
            phone: "9777700001",
            allowNegativeStock: false, // Strict negative stock enforcement
          },
          {
            id: companyBId,
            organizationId: orgBId,
            legalName: "Competitor Mfg Ltd",
            tradeName: "Competitor Mfg",
            gstin: "24BBBBB7777B1Z6",
            stateCode: "24",
            addressLine1: "GIDC",
            city: "Surat",
            pincode: "395001",
            phone: "9777700002",
            allowNegativeStock: false,
          },
        ],
      });

      await tx.branch.createMany({
        data: [
          { id: branchAId, organizationId: orgAId, companyId: companyAId, name: "Plant A", code: "PLANT-A", addressLine1: "Line 1", city: "Rajkot", pincode: "360001", stateCode: "24", phone: "9777700001" },
          { id: branchBId, organizationId: orgBId, companyId: companyBId, name: "Plant B", code: "PLANT-B", addressLine1: "Line 2", city: "Surat", pincode: "395001", stateCode: "24", phone: "9777700002" },
        ],
      });

      await tx.financialYear.createMany({
        data: [
          { id: fyAId, companyId: companyAId, name: "FY 2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31"), isCurrent: true },
          { id: fyBId, companyId: companyBId, name: "FY 2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31"), isCurrent: true },
        ],
      });

      await tx.warehouse.createMany({
        data: [
          { id: warehouseAId, organizationId: orgAId, companyId: companyAId, branchId: branchAId, name: "Main Factory Warehouse A", isDefault: true },
          { id: warehouseBId, organizationId: orgBId, companyId: companyBId, branchId: branchBId, name: "Main Factory Warehouse B", isDefault: true },
        ],
      });

      await tx.unitOfMeasure.create({
        data: { id: uomAId, organizationId: orgAId, companyId: companyAId, name: "Pieces", symbol: "PCS", uqcCode: "PCS" },
      });

      await tx.item.createMany({
        data: [
          { id: rawItem1Id, organizationId: orgAId, companyId: companyAId, primaryUomId: uomAId, name: "Aluminium Rod 10mm", sku: "RAW-AL-10", hsnCode: "7604", type: "PRODUCT", purchaseRate: 150, retailPrice: 180, taxRate: 18 },
          { id: rawItem2Id, organizationId: orgAId, companyId: companyAId, primaryUomId: uomAId, name: "Brass Fitting Bush", sku: "RAW-BR-01", hsnCode: "7412", type: "PRODUCT", purchaseRate: 50, retailPrice: 65, taxRate: 18 },
          { id: finishedItemId, organizationId: orgAId, companyId: companyAId, primaryUomId: uomAId, name: "Industrial Pneumatic Valve", sku: "FIN-PN-VALVE", hsnCode: "8481", type: "PRODUCT", purchaseRate: 200, retailPrice: 450, taxRate: 18, trackBatches: true },
          { id: serviceItemId, organizationId: orgAId, companyId: companyAId, primaryUomId: uomAId, name: "Lathe Machining Labor Service", sku: "SRV-LABOR", hsnCode: "9988", type: "SERVICE", purchaseRate: 0, retailPrice: 100, taxRate: 18 },
        ],
      });

      // Seed initial stock for raw materials in warehouseAId
      await tx.stockTransaction.createMany({
        data: [
          {
            organizationId: orgAId,
            companyId: companyAId,
            warehouseId: warehouseAId,
            itemId: rawItem1Id,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date("2026-04-01"),
            quantity: 100, // 100 PCS available
            valuationRate: 150,
            totalValuation: 15000,
            referenceDocType: "OPENING",
            referenceDocId: "00000000-0000-0000-0000-000000000000",
          },
          {
            organizationId: orgAId,
            companyId: companyAId,
            warehouseId: warehouseAId,
            itemId: rawItem2Id,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date("2026-04-01"),
            quantity: 200, // 200 PCS available
            valuationRate: 50,
            totalValuation: 10000,
            referenceDocType: "OPENING",
            referenceDocId: "00000000-0000-0000-0000-000000000000",
          },
        ],
      });
    });
  });

  afterAll(async () => {
    await db.executeBypassRls(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM stock_transactions WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM production_batches WHERE production_order_id IN (SELECT id FROM production_orders WHERE company_id IN ('${companyAId}', '${companyBId}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM production_orders WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM bom_items WHERE bom_id IN (SELECT id FROM bills_of_material WHERE company_id IN ('${companyAId}', '${companyBId}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM bills_of_material WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM item_batches WHERE item_id IN ('${finishedItemId}', '${rawItem1Id}', '${rawItem2Id}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM items WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM units_of_measure WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM warehouses WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM financial_years WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM branches WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM audit_logs WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM users WHERE organization_id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM companies WHERE id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM organizations WHERE id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM tenants WHERE id IN ('${tenantAId}', '${tenantBId}')`,
      );
    });
    await db.onModuleDestroy();
  });

  // =========================================================================
  // 1. BILL OF MATERIALS (BOM) MANAGEMENT & VALIDATIONS
  // =========================================================================
  describe("1. BOM Management & Validation Engine", () => {
    let createdBomId: string;

    it("should successfully create a valid Bill of Materials with multiple raw components and wastage", async () => {
      const bom = await bomService.createBom(tenantACtx, {
        finishedItemId,
        bomName: "Pneumatic Valve Standard Assembly",
        batchYieldQty: 10,
        laborCostEst: 200,
        overheadCostEst: 100,
        items: [
          { rawItemId: rawItem1Id, quantity: 20, wastagePercent: 5 }, // 2 rods per unit + 5% scrap
          { rawItemId: rawItem2Id, quantity: 10, wastagePercent: 0 }, // 1 fitting per unit
        ],
      });

      expect(bom).toBeDefined();
      expect(bom.bomName).toBe("Pneumatic Valve Standard Assembly");
      expect(bom.items.length).toBe(2);
      expect(Number(bom.batchYieldQty)).toBe(10);
      expect(Number(bom.laborCostEst)).toBe(200);
      expect(Number(bom.overheadCostEst)).toBe(100);

      createdBomId = bom.id;
    });

    it("should reject BOM creation when manufacturing a SERVICE item", async () => {
      await expect(
        bomService.createBom(tenantACtx, {
          finishedItemId: serviceItemId,
          bomName: "Service BOM Invalid",
          batchYieldQty: 1,
          items: [{ rawItemId: rawItem1Id, quantity: 1 }],
        }),
      ).rejects.toThrow(/service and cannot be manufactured/);
    });

    it("should reject direct circular dependency (finished item used as raw material)", async () => {
      await expect(
        bomService.createBom(tenantACtx, {
          finishedItemId: finishedItemId,
          bomName: "Circular BOM",
          batchYieldQty: 1,
          items: [{ rawItemId: finishedItemId, quantity: 1 }],
        }),
      ).rejects.toThrow(/Finished item cannot be a raw material component/);
    });

    it("should reject duplicate raw material components in the same BOM", async () => {
      await expect(
        bomService.createBom(tenantACtx, {
          finishedItemId,
          bomName: "Duplicate Components BOM",
          batchYieldQty: 5,
          items: [
            { rawItemId: rawItem1Id, quantity: 2 },
            { rawItemId: rawItem1Id, quantity: 3 }, // Duplicate!
          ],
        }),
      ).rejects.toThrow(/Duplicate raw material components are not allowed/);
    });

    it("should reject negative or zero component quantities and invalid wastage", async () => {
      await expect(
        bomService.createBom(tenantACtx, {
          finishedItemId,
          bomName: "Zero Qty BOM",
          batchYieldQty: 1,
          items: [{ rawItemId: rawItem1Id, quantity: 0 }],
        }),
      ).rejects.toThrow(/greater than zero/);

      await expect(
        bomService.createBom(tenantACtx, {
          finishedItemId,
          bomName: "Negative Qty BOM",
          batchYieldQty: 1,
          items: [{ rawItemId: rawItem1Id, quantity: -5 }],
        }),
      ).rejects.toThrow(/greater than zero/);

      await expect(
        bomService.createBom(tenantACtx, {
          finishedItemId,
          bomName: "Excessive Wastage BOM",
          batchYieldQty: 1,
          items: [{ rawItemId: rawItem1Id, quantity: 1, wastagePercent: 105 }],
        }),
      ).rejects.toThrow(/between 0% and 99.99%/);
    });

    it("should list all BOMs for the tenant", async () => {
      const boms = await bomService.findAllBoms(tenantACtx);
      expect(boms.length).toBeGreaterThanOrEqual(1);
      expect(boms.some((b) => b.id === createdBomId)).toBe(true);
    });

    it("should fetch single BOM by ID with lines and item details", async () => {
      const bom = await bomService.findBomById(tenantACtx, createdBomId);
      expect(bom.id).toBe(createdBomId);
      expect(bom.finishedItem.name).toBe("Industrial Pneumatic Valve");
      expect(bom.items[0].rawItem).toBeDefined();
    });

    it("should update BOM properties when no active production order is running", async () => {
      const updated = await bomService.updateBom(tenantACtx, createdBomId, {
        bomName: "Pneumatic Valve Enhanced Assembly v2",
        laborCostEst: 220,
      });
      expect(updated.bomName).toBe("Pneumatic Valve Enhanced Assembly v2");
      expect(Number(updated.laborCostEst)).toBe(220);
    });
  });

  // =========================================================================
  // 2. PRODUCTION ORDER LIFECYCLE (PLANNED -> IN_PROGRESS -> COMPLETED)
  // =========================================================================
  describe("2. Production Order Lifecycle & Concurrency Engine", () => {
    let bomId: string;
    let orderId: string;

    beforeAll(async () => {
      const bom = await bomService.createBom(tenantACtx, {
        finishedItemId,
        bomName: "Pneumatic Valve Run BOM",
        batchYieldQty: 10,
        laborCostEst: 300,
        overheadCostEst: 150,
        items: [
          { rawItemId: rawItem1Id, quantity: 20, wastagePercent: 0 }, // 2 per finished unit
          { rawItemId: rawItem2Id, quantity: 10, wastagePercent: 0 }, // 1 per finished unit
        ],
      });
      bomId = bom.id;
    });

    it("should create production order in PLANNED state with sequential orderNumber", async () => {
      const order = await prodService.createOrder(tenantACtx, {
        bomId,
        targetQuantity: 10, // Target output: 10 units
        startDate: "2026-10-15",
      });

      expect(order).toBeDefined();
      expect(order.status).toBe(ProductionStatus.PLANNED);
      expect(Number(order.targetQuantity)).toBe(10);
      expect(order.orderNumber).toMatch(/^PO\/26-27\/\d{4}$/);

      orderId = order.id;
    });

    it("should prevent completing an order directly from PLANNED state (invalid transition)", async () => {
      await expect(
        prodService.completeProduction(tenantACtx, orderId, {
          targetWarehouseId: warehouseAId,
          actualProducedQty: 10,
        }),
      ).rejects.toThrow(/only be completed from IN_PROGRESS status/);
    });

    it("should reject startProduction if raw material stock is insufficient under strict policy", async () => {
      // Create a huge order requiring 500 aluminium rods (only 100 in stock)
      const hugeOrder = await prodService.createOrder(tenantACtx, {
        bomId,
        targetQuantity: 500, // Requires 1000 rods
      });

      await expect(
        prodService.startProduction(tenantACtx, hugeOrder.id, {
          sourceWarehouseId: warehouseAId,
        }),
      ).rejects.toThrow(/Insufficient stock for raw material/);
    });

    it("should start production order atomically deducting raw materials in stock ledger", async () => {
      // Order target is 10 units: requires 20 units of rawItem1 and 10 units of rawItem2
      const started = await prodService.startProduction(tenantACtx, orderId, {
        sourceWarehouseId: warehouseAId,
      });

      expect(started.status).toBe(ProductionStatus.IN_PROGRESS);

      // Verify stock ledger has recorded negative append-only movements
      const consumptionTxs = await db.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findMany({
          where: {
            companyId: companyAId,
            referenceDocType: "PRODUCTION_ORDER",
            referenceDocId: orderId,
            transactionType: StockTransactionType.MANUFACTURING_CONSUMPTION,
          },
        });
      });

      expect(consumptionTxs.length).toBe(2);

      const txRaw1 = consumptionTxs.find((t) => t.itemId === rawItem1Id);
      const txRaw2 = consumptionTxs.find((t) => t.itemId === rawItem2Id);

      expect(Number(txRaw1!.quantity)).toBe(-20); // 20 units consumed
      expect(Number(txRaw1!.valuationRate)).toBe(150);
      expect(Number(txRaw1!.totalValuation)).toBe(3000); // 20 * 150 = 3000

      expect(Number(txRaw2!.quantity)).toBe(-10); // 10 units consumed
      expect(Number(txRaw2!.valuationRate)).toBe(50);
      expect(Number(txRaw2!.totalValuation)).toBe(500); // 10 * 50 = 500
    });

    it("should prevent starting an order that is already IN_PROGRESS (idempotent replay)", async () => {
      const replay = await prodService.startProduction(tenantACtx, orderId, {
        sourceWarehouseId: warehouseAId,
      });
      expect(replay.status).toBe(ProductionStatus.IN_PROGRESS);
    });

    it("should prevent deleting a BOM while an active production order is IN_PROGRESS", async () => {
      await expect(
        bomService.deleteBom(tenantACtx, bomId),
      ).rejects.toThrow(/referenced in production order history/);
    });

    it("should complete production order, yield finished goods, compute unit cost, and record batch", async () => {
      // Raw Material Cost Consumed = 3000 + 500 = 3500
      // Actual Labor = 300, Overhead = 150
      // Total Produced Cost = 3500 + 300 + 150 = 3950
      // Actual Produced Qty = 10 -> Unit Cost = 395.00
      const completed = await prodService.completeProduction(tenantACtx, orderId, {
        targetWarehouseId: warehouseAId,
        actualProducedQty: 10,
        actualLaborCost: 300,
        actualOverheadCost: 150,
        batchNumber: "VALVE-BATCH-2026-X1",
      });

      expect(completed.status).toBe(ProductionStatus.COMPLETED);
      expect(completed.batches.length).toBe(1);

      const batch = completed.batches[0];
      expect(batch.batchNumber).toBe("VALVE-BATCH-2026-X1");
      expect(Number(batch.actualProducedQty)).toBe(10);
      expect(Number(batch.rawMaterialCost)).toBe(3500);
      expect(Number(batch.actualLaborCost)).toBe(300);
      expect(Number(batch.actualOverheadCost)).toBe(150);
      expect(Number(batch.unitCost)).toBe(395);

      // Verify finished goods stock ledger entry
      const yieldTx = await db.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findFirst({
          where: {
            companyId: companyAId,
            referenceDocType: "PRODUCTION_ORDER",
            referenceDocId: orderId,
            transactionType: StockTransactionType.MANUFACTURING_YIELD,
          },
        });
      });

      expect(yieldTx).toBeDefined();
      expect(yieldTx!.itemId).toBe(finishedItemId);
      expect(Number(yieldTx!.quantity)).toBe(10);
      expect(Number(yieldTx!.valuationRate)).toBe(395);
      expect(Number(yieldTx!.totalValuation)).toBe(3950);
    });

    it("should prevent starting an already COMPLETED order", async () => {
      await expect(
        prodService.startProduction(tenantACtx, orderId, {
          sourceWarehouseId: warehouseAId,
        }),
      ).rejects.toThrow(/only be started from PLANNED status/);
    });

    it("should prevent cancelling an already COMPLETED order", async () => {
      await expect(
        prodService.cancelOrder(tenantACtx, orderId, {
          reason: "Attempt to cancel completed run",
        }),
      ).rejects.toThrow(/Completed production orders cannot be cancelled/);
    });
  });

  // =========================================================================
  // 3. CANCELLATION & RAW MATERIAL RESTORATION
  // =========================================================================
  describe("3. Cancellation & Stock Restock Reversal", () => {
    it("should cancel an IN_PROGRESS order and safely restock consumed materials", async () => {
      const bom = await bomService.createBom(tenantACtx, {
        finishedItemId,
        bomName: "BOM For Cancel Test",
        batchYieldQty: 5,
        items: [{ rawItemId: rawItem1Id, quantity: 5 }],
      });

      const order = await prodService.createOrder(tenantACtx, {
        bomId: bom.id,
        targetQuantity: 5,
      });

      // Start order: consumes 5 aluminium rods
      await prodService.startProduction(tenantACtx, order.id, {
        sourceWarehouseId: warehouseAId,
      });

      // Cancel order: should restore 5 aluminium rods
      const cancelled = await prodService.cancelOrder(tenantACtx, order.id, {
        reason: "Machine breakdown on factory floor",
      });

      expect(cancelled.status).toBe(ProductionStatus.CANCELLED);

      // Verify restock transaction was appended
      const restockTx = await db.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findFirst({
          where: {
            companyId: companyAId,
            referenceDocType: "PRODUCTION_ORDER_CANCELLATION",
            referenceDocId: order.id,
          },
        });
      });

      expect(restockTx).toBeDefined();
      expect(Number(restockTx!.quantity)).toBe(5); // Restored +5
    });
  });

  // =========================================================================
  // 4. TENANT ISOLATION & ROW-LEVEL SECURITY (RLS)
  // =========================================================================
  describe("4. Multi-Tenant Security & Isolation", () => {
    let bomAId: string;
    let orderAId: string;

    beforeAll(async () => {
      const bom = await bomService.createBom(tenantACtx, {
        finishedItemId,
        bomName: "Confidential Formula BOM Tenant A",
        batchYieldQty: 1,
        items: [{ rawItemId: rawItem1Id, quantity: 1 }],
      });
      bomAId = bom.id;

      const order = await prodService.createOrder(tenantACtx, {
        bomId: bomAId,
        targetQuantity: 1,
      });
      orderAId = order.id;
    });

    it("Tenant B cannot read Tenant A's BOMs", async () => {
      const bomsB = await bomService.findAllBoms(tenantBCtx);
      expect(bomsB.some((b) => b.id === bomAId)).toBe(false);

      await expect(
        bomService.findBomById(tenantBCtx, bomAId),
      ).rejects.toThrow(/not found/);
    });

    it("Tenant B cannot modify or delete Tenant A's BOM", async () => {
      await expect(
        bomService.updateBom(tenantBCtx, bomAId, { bomName: "Hacked BOM Name" }),
      ).rejects.toThrow(/not found/);

      await expect(
        bomService.deleteBom(tenantBCtx, bomAId),
      ).rejects.toThrow(/not found/);
    });

    it("Tenant B cannot read Tenant A's Production Orders", async () => {
      const ordersB = await prodService.findAllOrders(tenantBCtx);
      expect(ordersB.some((o) => o.id === orderAId)).toBe(false);

      await expect(
        prodService.findOrderById(tenantBCtx, orderAId),
      ).rejects.toThrow(/not found/);
    });

    it("Tenant B cannot start, complete, or cancel Tenant A's Production Order", async () => {
      await expect(
        prodService.startProduction(tenantBCtx, orderAId, {
          sourceWarehouseId: warehouseBId,
        }),
      ).rejects.toThrow(/not found/);

      await expect(
        prodService.completeProduction(tenantBCtx, orderAId, {
          targetWarehouseId: warehouseBId,
          actualProducedQty: 1,
        }),
      ).rejects.toThrow(/not found/);

      await expect(
        prodService.cancelOrder(tenantBCtx, orderAId, { reason: "Malicious Cancel" }),
      ).rejects.toThrow(/not found/);
    });
  });
});
