import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseService } from "../src/database/database.service";
import { AuditService } from "../src/audit/audit.service";
import { StockTransfersService } from "../src/distribution/stock-transfers.service";
import { DeliveryChallansService } from "../src/distribution/delivery-challans.service";
import { TenantContext } from "@billing/shared-types";
import {
  StockTransferStatus,
  DeliveryChallanStatus,
  DeliveryChallanType,
  StockTransactionType,
} from "@billing/database";

describe("Phase 8.3: Stock Transfers, In-Transit Inventory & Delivery Challans Integration Test Suite", () => {
  let db: DatabaseService;
  let audit: AuditService;
  let transferService: StockTransfersService;
  let challanService: DeliveryChallansService;

  // Tenant A: Precision Engineering Pvt Ltd
  const tenantAId = "d1111111-8888-8888-8888-aaaaaaaaaaaa";
  const orgAId = "d2222222-8888-8888-8888-aaaaaaaaaaaa";
  const companyAId = "d3333333-8888-8888-8888-aaaaaaaaaaaa";
  const branchA1Id = "d4444444-8888-8888-8888-aaaaaaaaaaaa"; // Gujarat Plant 1
  const branchA2Id = "d5555555-8888-8888-8888-aaaaaaaaaaaa"; // Gujarat Plant 2 (Same State)
  const branchA3Id = "d6666666-8888-8888-8888-aaaaaaaaaaaa"; // Maharashtra Branch (Different State)
  const fyAId = "d7777777-8888-8888-8888-aaaaaaaaaaaa";
  const warehouseA1Id = "d8888888-8888-8888-8888-aaaaaaaaaaaa"; // Rajkot Plant 1
  const warehouseA2Id = "d9999999-8888-8888-8888-aaaaaaaaaaaa"; // Ahmedabad Plant 2
  const warehouseA3Id = "daaaaaaa-8888-8888-8888-aaaaaaaaaaaa"; // Mumbai Hub (Interstate)
  const userAId = "d0000000-0000-0000-0000-000000000001";

  // Tenant B: Competitor Enterprises (Isolation verification)
  const tenantBId = "dbbbbbbb-8888-8888-8888-bbbbbbbbbbbb";
  const orgBId = "dccccccc-8888-8888-8888-bbbbbbbbbbbb";
  const companyBId = "dddddddd-8888-8888-8888-bbbbbbbbbbbb";
  const branchBId = "deeeeeee-8888-8888-8888-bbbbbbbbbbbb";
  const fyBId = "dfffffff-8888-8888-8888-bbbbbbbbbbbb";
  const warehouseBId = "d1212121-8888-8888-8888-bbbbbbbbbbbb";
  const userBId = "d0000000-0000-0000-0000-000000000002";

  // Test Items & Units
  const uomAId = "d3434343-8888-8888-8888-aaaaaaaaaaaa";
  const transferItemId = "d5656565-8888-8888-8888-aaaaaaaaaaaa";
  const jobWorkItemId = "d7878787-8888-8888-8888-aaaaaaaaaaaa";
  const jobWorkerPartyId = "d9090909-8888-8888-8888-aaaaaaaaaaaa";

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

  beforeAll(async () => {
    db = new DatabaseService();
    await db.onModuleInit();
    audit = new AuditService(db);
    transferService = new StockTransfersService(db, audit);
    challanService = new DeliveryChallansService(db, audit);

    // Clean up test data
    await db.executeBypassRls(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM stock_transactions WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE company_id IN ('${companyAId}', '${companyBId}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM stock_transfers WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM delivery_challan_items WHERE challan_id IN (SELECT id FROM delivery_challans WHERE company_id IN ('${companyAId}', '${companyBId}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM delivery_challans WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM parties WHERE company_id IN ('${companyAId}', '${companyBId}')`,
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
        `DELETE FROM tenants WHERE id IN ('${tenantAId}', '${tenantBId}') OR primary_phone IN ('9888800011', '9888800012')`,
      );

      // Seed tenants, organizations, users
      const trialEnd = new Date(Date.now() + 30 * 86400000);
      await tx.tenant.createMany({
        data: [
          { id: tenantAId, primaryPhone: "9888800011", subscriptionTier: "DISTRIBUTION_ENTERPRISE", subscriptionEnds: trialEnd },
          { id: tenantBId, primaryPhone: "9888800012", subscriptionTier: "DISTRIBUTION_ENTERPRISE", subscriptionEnds: trialEnd },
        ],
      });

      await tx.organization.createMany({
        data: [
          { id: orgAId, tenantId: tenantAId, name: "Precision Org A", legalName: "Precision Org A Ltd" },
          { id: orgBId, tenantId: tenantBId, name: "Competitor Org B", legalName: "Competitor Org B Ltd" },
        ],
      });

      await tx.user.createMany({
        data: [
          {
            id: userAId,
            organizationId: orgAId,
            fullName: "Distribution Manager A",
            phone: "9888800011",
            email: "dist_mgr_a@test.local",
            passwordHash: "dummy",
            role: "COMPANY_ADMIN",
          },
          {
            id: userBId,
            organizationId: orgBId,
            fullName: "Competitor Manager B",
            phone: "9888800012",
            email: "dist_mgr_b@test.local",
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
            legalName: "Precision Engineering Pvt Ltd",
            tradeName: "Precision Engg",
            gstin: "24AAAAA8888A1Z5",
            stateCode: "24", // Gujarat
            addressLine1: "GIDC Phase 2",
            city: "Rajkot",
            pincode: "360001",
            phone: "9888800001",
            allowNegativeStock: false,
          },
          {
            id: companyBId,
            organizationId: orgBId,
            legalName: "Competitor Enterprises Ltd",
            tradeName: "Competitor Ent",
            gstin: "24BBBBB8888B1Z6",
            stateCode: "24",
            addressLine1: "Industrial Area",
            city: "Surat",
            pincode: "395001",
            phone: "9888800002",
            allowNegativeStock: false,
          },
        ],
      });

      await tx.branch.createMany({
        data: [
          { id: branchA1Id, organizationId: orgAId, companyId: companyAId, name: "Rajkot Works", code: "RJK-01", addressLine1: "Plot 1", city: "Rajkot", pincode: "360001", stateCode: "24", phone: "9888800001" },
          { id: branchA2Id, organizationId: orgAId, companyId: companyAId, name: "Ahmedabad Depo", code: "AMD-02", addressLine1: "Plot 2", city: "Ahmedabad", pincode: "380001", stateCode: "24", phone: "9888800001" },
          { id: branchA3Id, organizationId: orgAId, companyId: companyAId, name: "Mumbai Branch", code: "MUM-03", addressLine1: "Andheri", city: "Mumbai", pincode: "400001", stateCode: "27", phone: "9888800001" }, // Maharashtra (State 27)
          { id: branchBId, organizationId: orgBId, companyId: companyBId, name: "Surat Depo", code: "SUR-01", addressLine1: "Ring Road", city: "Surat", pincode: "395001", stateCode: "24", phone: "9888800002" },
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
          { id: warehouseA1Id, organizationId: orgAId, companyId: companyAId, branchId: branchA1Id, name: "Central Factory Godown (Rajkot)", isDefault: true },
          { id: warehouseA2Id, organizationId: orgAId, companyId: companyAId, branchId: branchA2Id, name: "Distribution Hub (Ahmedabad)", isDefault: false },
          { id: warehouseA3Id, organizationId: orgAId, companyId: companyAId, branchId: branchA3Id, name: "Western Logistics Depot (Mumbai)", isDefault: false },
          { id: warehouseBId, organizationId: orgBId, companyId: companyBId, branchId: branchBId, name: "Competitor Warehouse", isDefault: true },
        ],
      });

      await tx.unitOfMeasure.create({
        data: { id: uomAId, organizationId: orgAId, companyId: companyAId, name: "Pieces", symbol: "PCS", uqcCode: "PCS" },
      });

      await tx.item.createMany({
        data: [
          {
            id: transferItemId,
            organizationId: orgAId,
            companyId: companyAId,
            primaryUomId: uomAId,
            name: "Precision Hydraulic Cylinder",
            sku: "HYD-CYL-100",
            hsnCode: "8412",
            type: "PRODUCT",
            purchaseRate: 1200,
            retailPrice: 1600,
            taxRate: 18,
          },
          {
            id: jobWorkItemId,
            organizationId: orgAId,
            companyId: companyAId,
            primaryUomId: uomAId,
            name: "Unfinished Valve Casting",
            sku: "CAST-VALVE-RAW",
            hsnCode: "8481",
            type: "PRODUCT",
            purchaseRate: 400,
            retailPrice: 600,
            taxRate: 18,
          },
        ],
      });

      await tx.party.create({
        data: {
          id: jobWorkerPartyId,
          organizationId: orgAId,
          companyId: companyAId,
          name: "Shree Ganesh Heat Treaters",
          type: "JOB_WORKER",
          phone: "9888812345",
          gstin: "24CCCDE1234F1Z5",
          stateCode: "24",
          billingAddress: { line1: "Aji GIDC", city: "Rajkot", pincode: "360003" },
        },
      });

      // Seed Initial Stock at warehouseA1Id (50 Units of transferItemId, 30 Units of jobWorkItemId)
      await tx.stockTransaction.createMany({
        data: [
          {
            organizationId: orgAId,
            companyId: companyAId,
            warehouseId: warehouseA1Id,
            itemId: transferItemId,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date("2026-04-01"),
            quantity: 50,
            valuationRate: 1200,
            totalValuation: 60000,
            referenceDocType: "OPENING",
            referenceDocId: "00000000-0000-0000-0000-000000000000",
          },
          {
            organizationId: orgAId,
            companyId: companyAId,
            warehouseId: warehouseA1Id,
            itemId: jobWorkItemId,
            transactionType: StockTransactionType.OPENING,
            transactionDate: new Date("2026-04-01"),
            quantity: 30,
            valuationRate: 400,
            totalValuation: 12000,
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
        `DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE company_id IN ('${companyAId}', '${companyBId}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM stock_transfers WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM delivery_challan_items WHERE challan_id IN (SELECT id FROM delivery_challans WHERE company_id IN ('${companyAId}', '${companyBId}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM delivery_challans WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM parties WHERE company_id IN ('${companyAId}', '${companyBId}')`,
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
  // 1. STOCK TRANSFER LIFECYCLE & VALIDATIONS
  // =========================================================================
  describe("1. Stock Transfer Lifecycle & In-Transit Tracking", () => {
    let transferId: string;

    it("should reject transfer when source and destination warehouse are identical", async () => {
      await expect(
        transferService.createTransfer(tenantACtx, {
          fromWarehouseId: warehouseA1Id,
          toWarehouseId: warehouseA1Id,
          items: [{ itemId: transferItemId, quantity: 5 }],
        }),
      ).rejects.toThrow(/must be different/);
    });

    it("should reject transfer with negative or zero quantities", async () => {
      await expect(
        transferService.createTransfer(tenantACtx, {
          fromWarehouseId: warehouseA1Id,
          toWarehouseId: warehouseA2Id,
          items: [{ itemId: transferItemId, quantity: 0 }],
        }),
      ).rejects.toThrow(/greater than zero/);

      await expect(
        transferService.createTransfer(tenantACtx, {
          fromWarehouseId: warehouseA1Id,
          toWarehouseId: warehouseA2Id,
          items: [{ itemId: transferItemId, quantity: -5 }],
        }),
      ).rejects.toThrow(/greater than zero/);
    });

    it("should create a valid DRAFT Stock Transfer with sequential number", async () => {
      const transfer = await transferService.createTransfer(tenantACtx, {
        fromWarehouseId: warehouseA1Id,
        toWarehouseId: warehouseA2Id,
        notes: "Routine inventory rebalancing Rajkot to Ahmedabad",
        items: [{ itemId: transferItemId, quantity: 10 }],
      });

      expect(transfer.id).toBeDefined();
      expect(transfer.transferNumber).toMatch(/^ST\/\d{2}-\d{2}\/\d{4}$/);
      expect(transfer.status).toBe(StockTransferStatus.DRAFT);
      expect(transfer.items.length).toBe(1);
      expect(Number(transfer.items[0].quantity)).toBe(10);
      expect(Number(transfer.items[0].unitCost)).toBe(1200);
      expect(Number(transfer.items[0].totalCost)).toBe(12000);

      transferId = transfer.id;
    });

    it("should allow updating DRAFT stock transfer items and notes", async () => {
      const updated = await transferService.updateTransfer(tenantACtx, transferId, {
        notes: "Updated rebalancing quantity to 12",
        items: [{ itemId: transferItemId, quantity: 12 }],
      });

      expect(updated.notes).toBe("Updated rebalancing quantity to 12");
      expect(Number(updated.items[0].quantity)).toBe(12);
      expect(Number(updated.items[0].totalCost)).toBe(14400);
    });

    it("should reject dispatch if source warehouse stock is insufficient under strict policy", async () => {
      const overTransfer = await transferService.createTransfer(tenantACtx, {
        fromWarehouseId: warehouseA1Id,
        toWarehouseId: warehouseA2Id,
        items: [{ itemId: transferItemId, quantity: 9999 }], // Exceeds 50
      });

      await expect(
        transferService.dispatchTransfer(tenantACtx, overTransfer.id, {}),
      ).rejects.toThrow(/Insufficient stock/);
    });

    it("should dispatch transfer atomically: deducting source warehouse stock and setting in-transit status", async () => {
      const dispatched = await transferService.dispatchTransfer(tenantACtx, transferId, {
        challanNumber: "DC-TR-001",
      });

      expect(dispatched.status).toBe(StockTransferStatus.DISPATCHED);
      expect(dispatched.dispatchedAt).toBeDefined();

      // Check stock transaction appended for STOCK_TRANSFER_OUT
      const outTx = await db.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findFirst({
          where: {
            companyId: companyAId,
            referenceDocType: "STOCK_TRANSFER",
            referenceDocId: transferId,
            transactionType: StockTransactionType.STOCK_TRANSFER_OUT as any,
          },
        });
      });

      expect(outTx).toBeDefined();
      expect(outTx!.warehouseId).toBe(warehouseA1Id);
      expect(Number(outTx!.quantity)).toBe(-12); // Outward -12
      expect(Number(outTx!.valuationRate)).toBe(1200);
    });

    it("should prevent modifying a DISPATCHED stock transfer", async () => {
      await expect(
        transferService.updateTransfer(tenantACtx, transferId, {
          notes: "Tamper attempt while in transit",
        }),
      ).rejects.toThrow(/Only DRAFT/);
    });

    it("should be idempotent on dispatch: retried dispatch returns existing state without duplicate stock deduction", async () => {
      const replay = await transferService.dispatchTransfer(tenantACtx, transferId, {});
      expect(replay.status).toBe(StockTransferStatus.DISPATCHED);

      const count = await db.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.count({
          where: {
            companyId: companyAId,
            referenceDocType: "STOCK_TRANSFER",
            referenceDocId: transferId,
            transactionType: StockTransactionType.STOCK_TRANSFER_OUT as any,
          },
        });
      });
      expect(count).toBe(1); // Exactly 1 dispatch record
    });

    it("should accurately report in-transit reconciliation before receipt", async () => {
      const recon = await transferService.getReconciliation(tenantACtx, transferId);
      expect(recon.totalDispatched).toBe(12);
      expect(recon.totalReceived).toBe(0);
      expect(recon.totalOutstanding).toBe(12);
      expect(recon.items[0].isInTransit).toBe(true);
    });

    it("should reject receipt if received + shortage + damage exceeds dispatched quantity", async () => {
      await expect(
        transferService.receiveTransfer(tenantACtx, transferId, {
          items: [
            {
              itemId: transferItemId,
              receivedQuantity: 10,
              shortageQuantity: 2,
              damageQuantity: 2, // Total 14 > 12 dispatched
            },
          ],
        }),
      ).rejects.toThrow(/cannot exceed dispatched quantity/);
    });

    it("should successfully receive transfer with variance: accepted stock (+10) in destination ledger", async () => {
      // Dispatched 12: Received 10, Shortage 1, Damaged 1
      const received = await transferService.receiveTransfer(tenantACtx, transferId, {
        items: [
          {
            itemId: transferItemId,
            receivedQuantity: 10,
            shortageQuantity: 1,
            damageQuantity: 1,
            remarks: "1 damaged in transit due to rough road, 1 missing in box",
          },
        ],
      });

      expect(received.status).toBe(StockTransferStatus.RECEIVED);
      expect(received.receivedAt).toBeDefined();

      // Verify STOCK_TRANSFER_IN record (+10 at warehouseA2Id)
      const inTx = await db.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findFirst({
          where: {
            companyId: companyAId,
            warehouseId: warehouseA2Id,
            referenceDocType: "STOCK_TRANSFER",
            referenceDocId: transferId,
            transactionType: StockTransactionType.STOCK_TRANSFER_IN as any,
          },
        });
      });
      expect(inTx).toBeDefined();
      expect(Number(inTx!.quantity)).toBe(10);
      expect(Number(inTx!.valuationRate)).toBe(1200);

      // Check reconciliation report after receipt
      const postRecon = await transferService.getReconciliation(tenantACtx, transferId);
      expect(postRecon.totalDispatched).toBe(12);
      expect(postRecon.totalReceived).toBe(10);
      expect(postRecon.totalOutstanding).toBe(2);
    });

    it("should support multi-stage partial receipts and prevent cancelling a partially received transfer", async () => {
      // Create and dispatch a transfer of 10 units
      const partialTransfer = await transferService.createTransfer(tenantACtx, {
        fromWarehouseId: warehouseA1Id,
        toWarehouseId: warehouseA2Id,
        items: [{ itemId: transferItemId, quantity: 10 }],
      });
      await transferService.dispatchTransfer(tenantACtx, partialTransfer.id, {});

      // Stage 1: Partial Receipt of 4 units -> transfer remains DISPATCHED
      const p1 = await transferService.receiveTransfer(tenantACtx, partialTransfer.id, {
        items: [{ itemId: transferItemId, receivedQuantity: 4 }],
      });
      expect(p1.status).toBe(StockTransferStatus.DISPATCHED);

      // Verify cancellation is blocked once partially received
      await expect(
        transferService.cancelTransfer(tenantACtx, partialTransfer.id, {
          reason: "Trying to cancel after partial receipt",
        }),
      ).rejects.toThrow(/Cannot cancel a stock transfer that has already been partially received/);

      // Stage 2: Second Partial Receipt of 4 units -> transfer remains DISPATCHED (cumulative 8)
      const p2 = await transferService.receiveTransfer(tenantACtx, partialTransfer.id, {
        items: [{ itemId: transferItemId, receivedQuantity: 4 }],
      });
      expect(p2.status).toBe(StockTransferStatus.DISPATCHED);

      // Stage 3: Final Receipt of 1 unit accepted + 1 unit shortage -> cumulative 9 received + 1 shortage = 10 -> transfer transitions to RECEIVED
      const p3 = await transferService.receiveTransfer(tenantACtx, partialTransfer.id, {
        items: [{ itemId: transferItemId, receivedQuantity: 1, shortageQuantity: 1 }],
      });
      expect(p3.status).toBe(StockTransferStatus.RECEIVED);

      // Verify reconciliation: Dispatched 10, Received 9, Outstanding 1 (the shortage)
      const recon = await transferService.getReconciliation(tenantACtx, partialTransfer.id);
      expect(recon.totalDispatched).toBe(10);
      expect(recon.totalReceived).toBe(9);
      expect(recon.totalOutstanding).toBe(1);
    });

    it("should safely handle concurrent receipt attempts without duplicate stock movements", async () => {
      const concTransfer = await transferService.createTransfer(tenantACtx, {
        fromWarehouseId: warehouseA1Id,
        toWarehouseId: warehouseA2Id,
        items: [{ itemId: transferItemId, quantity: 5 }],
      });
      await transferService.dispatchTransfer(tenantACtx, concTransfer.id, {});

      // Concurrent receipt calls
      const results = await Promise.all([
        transferService.receiveTransfer(tenantACtx, concTransfer.id, {
          items: [{ itemId: transferItemId, receivedQuantity: 5 }],
        }),
        transferService.receiveTransfer(tenantACtx, concTransfer.id, {
          items: [{ itemId: transferItemId, receivedQuantity: 5 }],
        }),
      ]);

      expect(results[0].status).toBe(StockTransferStatus.RECEIVED);
      expect(results[1].status).toBe(StockTransferStatus.RECEIVED);

      // Confirm exactly 1 inward stock transaction created
      const inCount = await db.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.count({
          where: {
            companyId: companyAId,
            warehouseId: warehouseA2Id,
            referenceDocType: "STOCK_TRANSFER",
            referenceDocId: concTransfer.id,
            transactionType: StockTransactionType.STOCK_TRANSFER_IN as any,
          },
        });
      });
      expect(inCount).toBe(1);
    });

    it("should prevent cancelling a completed/received stock transfer", async () => {
      await expect(
        transferService.cancelTransfer(tenantACtx, transferId, {
          reason: "Trying to reverse a received transfer",
        }),
      ).rejects.toThrow(/Completed\/received stock transfers cannot be cancelled/);
    });
  });

  // =========================================================================
  // 2. CANCELLATION RESTOCK & GSTIN AWARE POLICY
  // =========================================================================
  describe("2. Cancellation Restock & GST Branch Transfer Rules", () => {
    it("should cancel a DISPATCHED stock transfer and restore source warehouse inventory", async () => {
      // Create transfer of 5 units
      const transfer = await transferService.createTransfer(tenantACtx, {
        fromWarehouseId: warehouseA1Id,
        toWarehouseId: warehouseA2Id,
        items: [{ itemId: transferItemId, quantity: 5 }],
      });

      // Dispatch transfer (deducts 5)
      await transferService.dispatchTransfer(tenantACtx, transfer.id, {});

      // Cancel transfer while in transit
      const cancelled = await transferService.cancelTransfer(tenantACtx, transfer.id, {
        reason: "Driver vehicle broke down before departure",
      });

      expect(cancelled.status).toBe(StockTransferStatus.CANCELLED);

      // Verify compensating restock transaction appended at warehouseA1Id
      const restockTx = await db.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findFirst({
          where: {
            companyId: companyAId,
            warehouseId: warehouseA1Id,
            referenceDocType: "STOCK_TRANSFER_CANCELLATION",
            referenceDocId: transfer.id,
          },
        });
      });

      expect(restockTx).toBeDefined();
      expect(Number(restockTx!.quantity)).toBe(5); // Restored +5
      expect(Number(restockTx!.valuationRate)).toBe(1200);
    });

    it("should reject inter-state warehouse transfer as non-taxable stock transfer under Section 25 CGST Act", async () => {
      // fromWarehouseA1Id is Gujarat (State 24), warehouseA3Id is Maharashtra (State 27)
      const interStateTransfer = await transferService.createTransfer(tenantACtx, {
        fromWarehouseId: warehouseA1Id,
        toWarehouseId: warehouseA3Id,
        items: [{ itemId: transferItemId, quantity: 2 }],
      });

      // Attempting to dispatch non-taxable stock transfer across states must be rejected
      await expect(
        transferService.dispatchTransfer(tenantACtx, interStateTransfer.id, {}),
      ).rejects.toThrow(/Inter-state transfer from State 24 to State 27 constitutes a supply between distinct persons/);
    });
  });

  // =========================================================================
  // 3. DELIVERY CHALLAN (RULE 55 CGST RULES) & E-WAY BILL
  // =========================================================================
  describe("3. Delivery Challan Lifecycle & E-Way Bill Rule 138", () => {
    let challanId: string;

    it("should create a DRAFT Delivery Challan with statutory non-taxable Job Work defaults (0 tax)", async () => {
      const challan = await challanService.createChallan(tenantACtx, {
        warehouseId: warehouseA1Id,
        partyId: jobWorkerPartyId,
        challanType: DeliveryChallanType.JOB_WORK,
        items: [
          {
            itemId: jobWorkItemId,
            quantity: 20,
            unitPrice: 400,
            taxRate: 18,
          },
        ],
      });

      expect(challan.id).toBeDefined();
      expect(challan.challanNumber).toMatch(/^DC\/\d{2}-\d{2}\/\d{4}$/);
      expect(challan.status).toBe(DeliveryChallanStatus.DRAFT);
      expect(challan.challanType).toBe(DeliveryChallanType.JOB_WORK);

      // Total taxable = 20 * 400 = 8000
      // Non-taxable Job Work under Section 143: CGST 0, SGST 0, IGST 0, Total = 8000
      expect(Number(challan.taxableAmount)).toBe(8000);
      expect(Number(challan.cgstAmount)).toBe(0);
      expect(Number(challan.sgstAmount)).toBe(0);
      expect(Number(challan.igstAmount)).toBe(0);
      expect(Number(challan.totalAmount)).toBe(8000);

      challanId = challan.id;
    });

    it("should compute statutory GST when isTaxable is explicitly true on Delivery Challan", async () => {
      const taxableChallan = await challanService.createChallan(tenantACtx, {
        warehouseId: warehouseA1Id,
        partyId: jobWorkerPartyId,
        challanType: DeliveryChallanType.OTHER,
        isTaxable: true,
        items: [
          {
            itemId: jobWorkItemId,
            quantity: 10,
            unitPrice: 400,
            taxRate: 18,
          },
        ],
      });

      // 10 * 400 = 4000. CGST 9% (360), SGST 9% (360), Total = 4720
      expect(Number(taxableChallan.taxableAmount)).toBe(4000);
      expect(Number(taxableChallan.cgstAmount)).toBe(360);
      expect(Number(taxableChallan.sgstAmount)).toBe(360);
      expect(Number(taxableChallan.totalAmount)).toBe(4720);
    });

    it("should issue delivery challan and atomically dispatch goods from warehouse", async () => {
      const issued = await challanService.issueChallan(tenantACtx, challanId, {
        vehicleNumber: "GJ-03-BW-9999",
      });

      expect(issued.status).toBe(DeliveryChallanStatus.ISSUED);

      // Verify stock transaction appended
      const dispatchTx = await db.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findFirst({
          where: {
            companyId: companyAId,
            warehouseId: warehouseA1Id,
            referenceDocType: "DELIVERY_CHALLAN",
            referenceDocId: challanId,
          },
        });
      });

      expect(dispatchTx).toBeDefined();
      expect(Number(dispatchTx!.quantity)).toBe(-20);
    });

    it("should close an issued delivery challan when job work returns or completes", async () => {
      const closed = await challanService.closeChallan(tenantACtx, challanId);
      expect(closed.status).toBe(DeliveryChallanStatus.CLOSED);

      // Cannot cancel closed challan
      await expect(
        challanService.cancelChallan(tenantACtx, challanId, { reason: "Cancel closed" }),
      ).rejects.toThrow(/Closed delivery challans cannot be cancelled/);
    });

    it("should cancel an ISSUED delivery challan and restore stock", async () => {
      const ch = await challanService.createChallan(tenantACtx, {
        warehouseId: warehouseA1Id,
        challanType: DeliveryChallanType.SUPPLY_ON_APPROVAL,
        items: [{ itemId: jobWorkItemId, quantity: 5, unitPrice: 400, taxRate: 18 }],
      });

      await challanService.issueChallan(tenantACtx, ch.id, {});

      const cancelled = await challanService.cancelChallan(tenantACtx, ch.id, {
        reason: "Customer rejected approval dispatch before transit",
      });

      expect(cancelled.status).toBe(DeliveryChallanStatus.CANCELLED);

      // Verify compensating stock transaction
      const restoreTx = await db.executeBypassRls(async (tx) => {
        return await tx.stockTransaction.findFirst({
          where: {
            companyId: companyAId,
            referenceDocType: "DELIVERY_CHALLAN_CANCELLATION",
            referenceDocId: ch.id,
          },
        });
      });

      expect(restoreTx).toBeDefined();
      expect(Number(restoreTx!.quantity)).toBe(5); // Restored +5
    });

    it("should prepare valid Rule 138 E-Way Bill payload and return NOT_CONFIGURED when live NIC credentials absent", async () => {
      const ewbRes = await challanService.prepareEWayBillPayload(tenantACtx, challanId, {
        distanceKm: 45,
        vehicleNumber: "GJ-03-BW-9999",
      });

      expect(ewbRes.status).toBe("NOT_CONFIGURED");
      expect(ewbRes.payload).toBeDefined();
      expect(ewbRes.payload.docType).toBe("CHL");
      expect(ewbRes.payload.supplyType).toBe("O");
      expect(ewbRes.payload.subSupplyType).toBe(4); // Job Work
      expect(ewbRes.payload.fromGstin).toBe("24AAAAA8888A1Z5");
      expect(ewbRes.payload.transDistance).toBe(45);
      expect(ewbRes.payload.itemList.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 4. MULTI-TENANT ISOLATION & RLS VERIFICATION
  // =========================================================================
  describe("4. Multi-Tenant Security & Isolation", () => {
    let transferAId: string;
    let challanAId: string;

    beforeAll(async () => {
      const transfer = await transferService.createTransfer(tenantACtx, {
        fromWarehouseId: warehouseA1Id,
        toWarehouseId: warehouseA2Id,
        items: [{ itemId: transferItemId, quantity: 1 }],
      });
      transferAId = transfer.id;

      const challan = await challanService.createChallan(tenantACtx, {
        warehouseId: warehouseA1Id,
        challanType: DeliveryChallanType.OTHER,
        items: [{ itemId: transferItemId, quantity: 1, unitPrice: 1200 }],
      });
      challanAId = challan.id;
    });

    it("Tenant B cannot view Tenant A's Stock Transfers", async () => {
      const bTransfers = await transferService.findAllTransfers(tenantBCtx);
      expect(bTransfers.some((t) => t.id === transferAId)).toBe(false);

      await expect(
        transferService.findTransferById(tenantBCtx, transferAId),
      ).rejects.toThrow(/not found/);
    });

    it("Tenant B cannot dispatch, receive, or cancel Tenant A's Stock Transfer", async () => {
      await expect(
        transferService.dispatchTransfer(tenantBCtx, transferAId, {}),
      ).rejects.toThrow(/not found/);

      await expect(
        transferService.receiveTransfer(tenantBCtx, transferAId, {
          items: [{ itemId: transferItemId, receivedQuantity: 1 }],
        }),
      ).rejects.toThrow(/not found/);

      await expect(
        transferService.cancelTransfer(tenantBCtx, transferAId, { reason: "Malicious cancel" }),
      ).rejects.toThrow(/not found/);
    });

    it("Tenant B cannot view, issue, or cancel Tenant A's Delivery Challans", async () => {
      const bChallans = await challanService.findAllChallans(tenantBCtx);
      expect(bChallans.some((c) => c.id === challanAId)).toBe(false);

      await expect(
        challanService.findChallanById(tenantBCtx, challanAId),
      ).rejects.toThrow(/not found/);

      await expect(
        challanService.issueChallan(tenantBCtx, challanAId, {}),
      ).rejects.toThrow(/not found/);

      await expect(
        challanService.cancelChallan(tenantBCtx, challanAId, { reason: "Malicious cancel" }),
      ).rejects.toThrow(/not found/);
    });
  });
});
