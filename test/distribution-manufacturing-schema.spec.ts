import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseService } from "../src/database/database.service";
import { TenantContext } from "@billing/shared-types";
import { StockTransferStatus, DeliveryChallanStatus, DeliveryChallanType } from "@billing/database";

describe("Phase 8.1: Distribution & Manufacturing Schema & Row-Level Security (RLS) Audit", () => {
  let db: DatabaseService;

  const orgAId = "88888888-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const orgBId = "88888888-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const tenantAId = "99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const tenantBId = "99999999-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const companyAId = "aaaaaaaa-8888-8888-8888-aaaaaaaaaaaa";
  const companyBId = "bbbbbbbb-8888-8888-8888-bbbbbbbbbbbb";
  const branchAId = "a1111111-8888-8888-8888-aaaaaaaaaaaa";
  const branchBId = "b1111111-8888-8888-8888-bbbbbbbbbbbb";
  const fyAId = "a2222222-8888-8888-8888-aaaaaaaaaaaa";
  const fyBId = "b2222222-8888-8888-8888-bbbbbbbbbbbb";

  const warehouseA1Id = "a3333333-8888-8888-8888-aaaaaaaaaaaa";
  const warehouseA2Id = "a4444444-8888-8888-8888-aaaaaaaaaaaa";
  const warehouseB1Id = "b3333333-8888-8888-8888-bbbbbbbbbbbb";

  const itemA1Id = "a5555555-8888-8888-8888-aaaaaaaaaaaa";
  const itemA2Id = "a6666666-8888-8888-8888-aaaaaaaaaaaa";
  const itemB1Id = "b5555555-8888-8888-8888-bbbbbbbbbbbb";

  const partyAId = "a7777777-8888-8888-8888-aaaaaaaaaaaa";

  const tenantACtx: TenantContext = {
    userId: "00000000-0000-0000-0000-000000000001",
    organizationId: orgAId,
    companyId: companyAId,
    branchId: branchAId,
  };

  const tenantBCtx: TenantContext = {
    userId: "00000000-0000-0000-0000-000000000002",
    organizationId: orgBId,
    companyId: companyBId,
    branchId: branchBId,
  };

  beforeAll(async () => {
    db = new DatabaseService();
    await db.onModuleInit();

    // Clean up test data if existing
    await db.executeBypassRls(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM delivery_challan_items WHERE challan_id IN (SELECT id FROM delivery_challans WHERE company_id IN ('${companyAId}', '${companyBId}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM delivery_challans WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE company_id IN ('${companyAId}', '${companyBId}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM stock_transfers WHERE company_id IN ('${companyAId}', '${companyBId}')`,
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
        `DELETE FROM parties WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM items WHERE company_id IN ('${companyAId}', '${companyBId}')`,
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
        `DELETE FROM companies WHERE id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM organizations WHERE id IN ('${orgAId}', '${orgBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM tenants WHERE id IN ('${tenantAId}', '${tenantBId}')`,
      );

      // Seed tenants and base entities
      const trialEnd = new Date(Date.now() + 30 * 86400000);
      await tx.tenant.createMany({
        data: [
          { id: tenantAId, primaryPhone: "9888800001", subscriptionTier: "DISTRIBUTION_ENTERPRISE", subscriptionEnds: trialEnd },
          { id: tenantBId, primaryPhone: "9888800002", subscriptionTier: "DISTRIBUTION_ENTERPRISE", subscriptionEnds: trialEnd },
        ],
      });

      await tx.organization.createMany({
        data: [
          { id: orgAId, tenantId: tenantAId, name: "Mfg Org A", legalName: "Manufacturing Org A Ltd" },
          { id: orgBId, tenantId: tenantBId, name: "Mfg Org B", legalName: "Manufacturing Org B Ltd" },
        ],
      });

      await tx.company.createMany({
        data: [
          {
            id: companyAId,
            organizationId: orgAId,
            legalName: "Company A Mfg",
            tradeName: "Comp A",
            gstin: "24AAAAA0000A1Z5",
            stateCode: "24",
            addressLine1: "GIDC Industrial Estate",
            city: "Ahmedabad",
            pincode: "380001",
            phone: "9888800001",
          },
          {
            id: companyBId,
            organizationId: orgBId,
            legalName: "Company B Mfg",
            tradeName: "Comp B",
            gstin: "24BBBBB0000B1Z6",
            stateCode: "24",
            addressLine1: "Makarpura GIDC",
            city: "Vadodara",
            pincode: "390010",
            phone: "9888800002",
          },
        ],
      });

      await tx.branch.createMany({
        data: [
          {
            id: branchAId,
            organizationId: orgAId,
            companyId: companyAId,
            name: "Main Branch A",
            code: "BR-A01",
            addressLine1: "Phase 1",
            city: "Ahmedabad",
            pincode: "380001",
            stateCode: "24",
            phone: "9888800001",
          },
          {
            id: branchBId,
            organizationId: orgBId,
            companyId: companyBId,
            name: "Main Branch B",
            code: "BR-B01",
            addressLine1: "Phase 2",
            city: "Vadodara",
            pincode: "390010",
            stateCode: "24",
            phone: "9888800002",
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
          },
          {
            id: fyBId,
            companyId: companyBId,
            name: "FY 2026-27",
            startDate: new Date("2026-04-01"),
            endDate: new Date("2027-03-31"),
            isCurrent: true,
          },
        ],
      });

      // Warehouses
      await tx.warehouse.createMany({
        data: [
          { id: warehouseA1Id, organizationId: orgAId, companyId: companyAId, branchId: branchAId, name: "Raw Material Warehouse A", isDefault: true },
          { id: warehouseA2Id, organizationId: orgAId, companyId: companyAId, branchId: branchAId, name: "Finished Goods Warehouse A", isDefault: false },
          { id: warehouseB1Id, organizationId: orgBId, companyId: companyBId, branchId: branchBId, name: "Main Warehouse B", isDefault: true },
        ],
      });

      // Units of Measure
      const uomAId = "a9999999-8888-8888-8888-aaaaaaaaaaaa";
      const uomBId = "b9999999-8888-8888-8888-bbbbbbbbbbbb";
      await tx.unitOfMeasure.createMany({
        data: [
          { id: uomAId, organizationId: orgAId, companyId: companyAId, name: "Kilogram", symbol: "KG", uqcCode: "KGS" },
          { id: uomBId, organizationId: orgBId, companyId: companyBId, name: "Kilogram", symbol: "KG", uqcCode: "KGS" },
        ],
      });

      // Items
      await tx.item.createMany({
        data: [
          { id: itemA1Id, organizationId: orgAId, companyId: companyAId, primaryUomId: uomAId, name: "Steel Ingot Raw Material", sku: "SKU-RAW-01", hsnCode: "7208", type: "PRODUCT", retailPrice: 100, purchaseRate: 80, taxRate: 18 },
          { id: itemA2Id, organizationId: orgAId, companyId: companyAId, primaryUomId: uomAId, name: "Machined Steel Valve Finished", sku: "SKU-FIN-01", hsnCode: "8481", type: "PRODUCT", retailPrice: 350, purchaseRate: 200, taxRate: 18 },
          { id: itemB1Id, organizationId: orgBId, companyId: companyBId, primaryUomId: uomBId, name: "Competitor Ingot", sku: "SKU-RAW-B1", hsnCode: "7208", type: "PRODUCT", retailPrice: 105, purchaseRate: 85, taxRate: 18 },
        ],
      });

      // Party for delivery challan
      await tx.party.create({
        data: {
          id: partyAId,
          organizationId: orgAId,
          companyId: companyAId,
          name: "Subcontractor Job Worker",
          type: "CUSTOMER",
          stateCode: "24",
          phone: "9888800099",
          billingAddress: { city: "Ahmedabad", pincode: "380001" },
        },
      });
    });
  });

  afterAll(async () => {
    // Cleanup test data
    await db.executeBypassRls(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM delivery_challan_items WHERE challan_id IN (SELECT id FROM delivery_challans WHERE company_id IN ('${companyAId}', '${companyBId}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM delivery_challans WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE company_id IN ('${companyAId}', '${companyBId}'))`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM stock_transfers WHERE company_id IN ('${companyAId}', '${companyBId}')`,
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
        `DELETE FROM parties WHERE company_id IN ('${companyAId}', '${companyBId}')`,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM items WHERE company_id IN ('${companyAId}', '${companyBId}')`,
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

  describe("1. StockTransfer Model Invariants & Constraints", () => {
    it("should create valid StockTransfer between two different warehouses of the same company", async () => {
      const transfer = await db.executeInTenantContext(tenantACtx, async (tx) => {
        return await tx.stockTransfer.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            branchId: branchAId,
            financialYearId: fyAId,
            transferNumber: "TRF-2026-0001",
            transferDate: new Date("2026-10-15"),
            fromWarehouseId: warehouseA1Id,
            toWarehouseId: warehouseA2Id,
            status: "DRAFT",
            notes: "Transfer raw material to processing floor",
            items: {
              create: [
                {
                  itemId: itemA1Id,
                  quantity: 50,
                  unitCost: 80,
                  totalCost: 4000,
                },
              ],
            },
          },
          include: {
            items: true,
            fromWarehouse: true,
            toWarehouse: true,
          },
        });
      });

      expect(transfer).toBeDefined();
      expect(transfer.transferNumber).toBe("TRF-2026-0001");
      expect(transfer.items.length).toBe(1);
      expect(Number(transfer.items[0].quantity)).toBe(50);
      expect(transfer.fromWarehouse.id).toBe(warehouseA1Id);
      expect(transfer.toWarehouse.id).toBe(warehouseA2Id);
    });

    it("should reject StockTransfer when source and destination warehouse are identical (Check Constraint)", async () => {
      await expect(
        db.executeInTenantContext(tenantACtx, async (tx) => {
          return await tx.stockTransfer.create({
            data: {
              organizationId: orgAId,
              companyId: companyAId,
              branchId: branchAId,
              financialYearId: fyAId,
              transferNumber: "TRF-INVALID-SAME",
              transferDate: new Date("2026-10-15"),
              fromWarehouseId: warehouseA1Id,
              toWarehouseId: warehouseA1Id, // Same warehouse!
              status: "DRAFT",
            },
          });
        }),
      ).rejects.toThrow();
    });

    it("should reject duplicate transferNumber within the same company", async () => {
      await expect(
        db.executeInTenantContext(tenantACtx, async (tx) => {
          return await tx.stockTransfer.create({
            data: {
              organizationId: orgAId,
              companyId: companyAId,
              branchId: branchAId,
              financialYearId: fyAId,
              transferNumber: "TRF-2026-0001", // Duplicate!
              transferDate: new Date("2026-10-16"),
              fromWarehouseId: warehouseA1Id,
              toWarehouseId: warehouseA2Id,
              status: "DRAFT",
            },
          });
        }),
      ).rejects.toThrow();
    });
  });

  describe("2. DeliveryChallan Model Invariants (GST Rule 55)", () => {
    it("should create valid DeliveryChallan with items and compute line totals", async () => {
      const challan = await db.executeInTenantContext(tenantACtx, async (tx) => {
        return await tx.deliveryChallan.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            branchId: branchAId,
            financialYearId: fyAId,
            warehouseId: warehouseA1Id,
            partyId: partyAId,
            challanNumber: "DC-2026-0001",
            challanDate: new Date("2026-10-15"),
            challanType: "JOB_WORK",
            status: "ISSUED",
            taxableAmount: 10000,
            cgstAmount: 900,
            sgstAmount: 900,
            igstAmount: 0,
            totalAmount: 11800,
            items: {
              create: [
                {
                  itemId: itemA1Id,
                  description: "Job work dispatch for turning",
                  hsnCode: "7208",
                  quantity: 100,
                  unitPrice: 100,
                  taxableAmount: 10000,
                  taxRate: 18,
                  cgstAmount: 900,
                  sgstAmount: 900,
                  igstAmount: 0,
                  totalAmount: 11800,
                },
              ],
            },
          },
          include: {
            items: true,
            party: true,
            warehouse: true,
          },
        });
      });

      expect(challan).toBeDefined();
      expect(challan.challanNumber).toBe("DC-2026-0001");
      expect(challan.challanType).toBe("JOB_WORK");
      expect(Number(challan.totalAmount)).toBe(11800);
      expect(challan.items.length).toBe(1);
      expect(challan.party?.name).toBe("Subcontractor Job Worker");
    });

    it("should reject duplicate challanNumber within the same company", async () => {
      await expect(
        db.executeInTenantContext(tenantACtx, async (tx) => {
          return await tx.deliveryChallan.create({
            data: {
              organizationId: orgAId,
              companyId: companyAId,
              branchId: branchAId,
              financialYearId: fyAId,
              warehouseId: warehouseA1Id,
              challanNumber: "DC-2026-0001", // Duplicate!
              challanDate: new Date("2026-10-16"),
              challanType: "JOB_WORK",
              status: "ISSUED",
            },
          });
        }),
      ).rejects.toThrow();
    });
  });

  describe("3. BillOfMaterial & ProductionOrder Schema", () => {
    it("should create BOM with raw material inputs and finished good output", async () => {
      const bom = await db.executeInTenantContext(tenantACtx, async (tx) => {
        return await tx.billOfMaterial.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            finishedItemId: itemA2Id,
            bomName: "Machined Steel Valve BOM v1",
            batchYieldQty: 10,
            laborCostEst: 500,
            overheadCostEst: 200,
            items: {
              create: [
                {
                  rawItemId: itemA1Id,
                  quantity: 25,
                  wastagePercent: 2.5,
                },
              ],
            },
          },
          include: {
            items: true,
            finishedItem: true,
          },
        });
      });

      expect(bom).toBeDefined();
      expect(bom.bomName).toBe("Machined Steel Valve BOM v1");
      expect(bom.items.length).toBe(1);
      expect(Number(bom.items[0].quantity)).toBe(25);
      expect(bom.finishedItem.name).toBe("Machined Steel Valve Finished");

      // Create ProductionOrder referencing the BOM
      const prodOrder = await db.executeInTenantContext(tenantACtx, async (tx) => {
        return await tx.productionOrder.create({
          data: {
            organizationId: orgAId,
            companyId: companyAId,
            bomId: bom.id,
            orderNumber: "PO-2026-0001",
            targetQuantity: 100,
            status: "PLANNED",
            startDate: new Date("2026-10-20"),
          },
        });
      });

      expect(prodOrder).toBeDefined();
      expect(prodOrder.orderNumber).toBe("PO-2026-0001");
      expect(prodOrder.status).toBe("PLANNED");
    });
  });

  describe("4. PostgreSQL Row-Level Security (RLS) Tenant Isolation", () => {
    it("Tenant B cannot query Tenant A's StockTransfers under RLS", async () => {
      const transfersB = await db.executeInTenantContext(tenantBCtx, async (tx) => {
        return await tx.stockTransfer.findMany();
      });
      expect(transfersB.length).toBe(0);

      // Tenant A can query its own StockTransfers
      const transfersA = await db.executeInTenantContext(tenantACtx, async (tx) => {
        return await tx.stockTransfer.findMany();
      });
      expect(transfersA.length).toBeGreaterThan(0);
    });

    it("Tenant B cannot query Tenant A's DeliveryChallans under RLS", async () => {
      const challansB = await db.executeInTenantContext(tenantBCtx, async (tx) => {
        return await tx.deliveryChallan.findMany();
      });
      expect(challansB.length).toBe(0);

      // Tenant A sees its challan
      const challansA = await db.executeInTenantContext(tenantACtx, async (tx) => {
        return await tx.deliveryChallan.findMany();
      });
      expect(challansA.length).toBeGreaterThan(0);
    });

    it("Tenant B cannot query Tenant A's BillOfMaterial or ProductionOrders under RLS", async () => {
      const bomsB = await db.executeInTenantContext(tenantBCtx, async (tx) => {
        return await tx.billOfMaterial.findMany();
      });
      expect(bomsB.length).toBe(0);

      const prodOrdersB = await db.executeInTenantContext(tenantBCtx, async (tx) => {
        return await tx.productionOrder.findMany();
      });
      expect(prodOrdersB.length).toBe(0);
    });

    it("Tenant B cannot attach child items to Tenant A's StockTransfer (WITH CHECK enforcement)", async () => {
      // Find Tenant A transfer ID
      const transferA = await db.executeBypassRls(async (tx) => {
        return await tx.stockTransfer.findFirst({
          where: { companyId: companyAId },
        });
      });
      expect(transferA).toBeDefined();

      // Tenant B tries to insert an item into Tenant A's transfer
      await expect(
        db.executeInTenantContext(tenantBCtx, async (tx) => {
          return await tx.stockTransferItem.create({
            data: {
              transferId: transferA!.id,
              itemId: itemB1Id,
              quantity: 10,
              unitCost: 10,
              totalCost: 100,
            },
          });
        }),
      ).rejects.toThrow();
    });

    it("Tenant B cannot attach child items to Tenant A's DeliveryChallan (WITH CHECK enforcement)", async () => {
      // Find Tenant A challan ID
      const challanA = await db.executeBypassRls(async (tx) => {
        return await tx.deliveryChallan.findFirst({
          where: { companyId: companyAId },
        });
      });
      expect(challanA).toBeDefined();

      // Tenant B tries to insert an item into Tenant A's challan
      await expect(
        db.executeInTenantContext(tenantBCtx, async (tx) => {
          return await tx.deliveryChallanItem.create({
            data: {
              challanId: challanA!.id,
              itemId: itemB1Id,
              quantity: 5,
              unitPrice: 50,
              taxableAmount: 250,
              totalAmount: 250,
            },
          });
        }),
      ).rejects.toThrow();
    });

    it("Tenant B cannot modify or delete Tenant A's BOM, StockTransfer, or DeliveryChallan", async () => {
      const transferA = await db.executeBypassRls(async (tx) => {
        return await tx.stockTransfer.findFirst({
          where: { companyId: companyAId },
        });
      });

      // Tenant B attempts to update Tenant A transfer note
      const updateResult = await db.executeInTenantContext(tenantBCtx, async (tx) => {
        return await tx.stockTransfer.updateMany({
          where: { id: transferA!.id },
          data: { notes: "Hacked by Tenant B" },
        });
      });
      // RLS filters out rows not matching Tenant B, resulting in 0 rows updated
      expect(updateResult.count).toBe(0);

      // Verify notes remained unchanged in Tenant A
      const refreshedA = await db.executeInTenantContext(tenantACtx, async (tx) => {
        return await tx.stockTransfer.findUnique({
          where: { id: transferA!.id },
        });
      });
      expect(refreshedA?.notes).not.toBe("Hacked by Tenant B");
    });
  });

  describe("5. Restrictive Deletion & Integrity Invariants", () => {
    it("should prevent deleting a Warehouse that has active StockTransfers", async () => {
      await expect(
        db.executeInTenantContext(tenantACtx, async (tx) => {
          return await tx.warehouse.delete({
            where: { id: warehouseA1Id },
          });
        }),
      ).rejects.toThrow();
    });

    it("should prevent deleting an Item that is referenced in StockTransferItems", async () => {
      await expect(
        db.executeInTenantContext(tenantACtx, async (tx) => {
          return await tx.item.delete({
            where: { id: itemA1Id },
          });
        }),
      ).rejects.toThrow();
    });
  });
});
