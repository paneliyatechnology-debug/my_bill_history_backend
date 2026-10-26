import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import { toDecimal, Decimal } from "@billing/accounting-core";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { CreateBomDto } from "./dto/create-bom.dto";
import { UpdateBomDto } from "./dto/update-bom.dto";

@Injectable()
export class BomService {
  private readonly logger = new Logger(BomService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Create a new Bill of Materials (BOM) with strict validation and circular dependency protection
   */
  async createBom(ctx: TenantContext, dto: CreateBomDto): Promise<any> {
    if (!dto.bomName || dto.bomName.trim() === "") {
      throw new BadRequestException("BOM name is required.");
    }
    if (!dto.finishedItemId) {
      throw new BadRequestException("Finished item ID is required.");
    }
    if (typeof dto.batchYieldQty !== "number" || dto.batchYieldQty <= 0) {
      throw new BadRequestException("Batch yield quantity must be greater than zero.");
    }
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException("BOM must contain at least one raw material component.");
    }

    // Check duplicate raw material components
    const rawItemIds = dto.items.map((i) => i.rawItemId);
    if (new Set(rawItemIds).size !== rawItemIds.length) {
      throw new BadRequestException("Duplicate raw material components are not allowed in a single BOM.");
    }

    // Direct circular dependency check
    if (rawItemIds.includes(dto.finishedItemId)) {
      throw new BadRequestException("Finished item cannot be a raw material component in its own BOM.");
    }

    // Validate quantities and wastage
    for (const item of dto.items) {
      if (typeof item.quantity !== "number" || item.quantity <= 0) {
        throw new BadRequestException("Component quantity must be greater than zero.");
      }
      if (
        item.wastagePercent !== undefined &&
        (item.wastagePercent < 0 || item.wastagePercent >= 100)
      ) {
        throw new BadRequestException("Wastage percentage must be between 0% and 99.99%.");
      }
    }

    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Verify finished item ownership and type
      const finishedItem = await tx.item.findFirst({
        where: { id: dto.finishedItemId, companyId: ctx.companyId },
      });
      if (!finishedItem) {
        throw new NotFoundException(`Finished item ${dto.finishedItemId} not found in this company.`);
      }
      if (finishedItem.type === "SERVICE") {
        throw new BadRequestException(`Item "${finishedItem.name}" is a service and cannot be manufactured.`);
      }

      // 2. Verify all raw materials exist and belong to the tenant company
      const rawItems = await tx.item.findMany({
        where: { id: { in: rawItemIds }, companyId: ctx.companyId },
      });
      if (rawItems.length !== rawItemIds.length) {
        throw new BadRequestException("One or more referenced raw material items do not exist in this company.");
      }

      // 3. Nested circular dependency check:
      // Verify no raw item is produced by a BOM that consumes this finished item
      const nestedBoms = await tx.billOfMaterial.findMany({
        where: {
          companyId: ctx.companyId,
          finishedItemId: { in: rawItemIds },
        },
        include: { items: true },
      });
      for (const nb of nestedBoms) {
        if (nb.items.some((i) => i.rawItemId === dto.finishedItemId)) {
          throw new BadRequestException(
            `Circular BOM dependency detected: Raw item "${nb.bomName}" consumes finished item "${finishedItem.name}".`,
          );
        }
      }

      // 4. Create BOM and lines
      const bom = await tx.billOfMaterial.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          finishedItemId: dto.finishedItemId,
          bomName: dto.bomName.trim(),
          batchYieldQty: toDecimal(dto.batchYieldQty).toNumber(),
          laborCostEst: toDecimal(dto.laborCostEst || 0).toNumber(),
          overheadCostEst: toDecimal(dto.overheadCostEst || 0).toNumber(),
          items: {
            create: dto.items.map((i) => ({
              rawItemId: i.rawItemId,
              quantity: toDecimal(i.quantity).toNumber(),
              wastagePercent: toDecimal(i.wastagePercent || 0).toNumber(),
            })),
          },
        },
        include: {
          finishedItem: true,
          items: {
            include: { rawItem: true },
          },
        },
      });

      // 5. Audit log
      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "CREATE_BOM",
          entityName: "BillOfMaterial",
          entityId: bom.id,
          newState: {
            bomName: bom.bomName,
            finishedItemId: bom.finishedItemId,
            batchYieldQty: bom.batchYieldQty,
            itemCount: dto.items.length,
          },
        },
        tx,
      );

      return bom;
    });
  }

  /**
   * List all Bills of Materials for current tenant
   */
  async findAllBoms(ctx: TenantContext): Promise<any[]> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      return await tx.billOfMaterial.findMany({
        where: { companyId: ctx.companyId },
        include: {
          finishedItem: true,
          items: {
            include: { rawItem: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });
  }

  /**
   * Find a specific BOM by ID with tenant security
   */
  async findBomById(ctx: TenantContext, id: string): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      const bom = await tx.billOfMaterial.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          finishedItem: true,
          items: {
            include: { rawItem: true },
          },
        },
      });
      if (!bom) {
        throw new NotFoundException(`Bill of Materials ${id} not found.`);
      }
      return bom;
    });
  }

  /**
   * Update an existing BOM
   */
  async updateBom(ctx: TenantContext, id: string, dto: UpdateBomDto): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existingBom = await tx.billOfMaterial.findFirst({
        where: { id, companyId: ctx.companyId },
        include: { items: true },
      });
      if (!existingBom) {
        throw new NotFoundException(`Bill of Materials ${id} not found.`);
      }

      // Check active production orders
      const activeOrders = await tx.productionOrder.findFirst({
        where: {
          bomId: id,
          companyId: ctx.companyId,
          status: { in: ["PLANNED", "IN_PROGRESS"] },
        },
      });
      if (activeOrders) {
        throw new BadRequestException(
          `Cannot modify BOM "${existingBom.bomName}" because it is in use by active production order ${activeOrders.orderNumber}.`,
        );
      }

      // If updating items, validate them
      if (dto.items && dto.items.length > 0) {
        const rawItemIds = dto.items.map((i) => i.rawItemId);
        if (new Set(rawItemIds).size !== rawItemIds.length) {
          throw new BadRequestException("Duplicate raw material components are not allowed.");
        }
        if (rawItemIds.includes(existingBom.finishedItemId)) {
          throw new BadRequestException("Finished item cannot be a raw material in its own BOM.");
        }

        for (const it of dto.items) {
          if (typeof it.quantity !== "number" || it.quantity <= 0) {
            throw new BadRequestException("Component quantity must be greater than zero.");
          }
          if (
            it.wastagePercent !== undefined &&
            (it.wastagePercent < 0 || it.wastagePercent >= 100)
          ) {
            throw new BadRequestException("Wastage percentage must be between 0% and 99.99%.");
          }
        }

        const rawItems = await tx.item.findMany({
          where: { id: { in: rawItemIds }, companyId: ctx.companyId },
        });
        if (rawItems.length !== rawItemIds.length) {
          throw new BadRequestException("One or more referenced raw material items do not exist in this company.");
        }

        // Delete old items and insert updated ones
        await tx.bomItem.deleteMany({ where: { bomId: id } });
        await tx.bomItem.createMany({
          data: dto.items.map((i) => ({
            bomId: id,
            rawItemId: i.rawItemId,
            quantity: toDecimal(i.quantity).toNumber(),
            wastagePercent: toDecimal(i.wastagePercent || 0).toNumber(),
          })),
        });
      }

      const updated = await tx.billOfMaterial.update({
        where: { id },
        data: {
          bomName: dto.bomName !== undefined ? dto.bomName.trim() : undefined,
          batchYieldQty:
            dto.batchYieldQty !== undefined
              ? toDecimal(dto.batchYieldQty).toNumber()
              : undefined,
          laborCostEst:
            dto.laborCostEst !== undefined
              ? toDecimal(dto.laborCostEst).toNumber()
              : undefined,
          overheadCostEst:
            dto.overheadCostEst !== undefined
              ? toDecimal(dto.overheadCostEst).toNumber()
              : undefined,
        },
        include: {
          finishedItem: true,
          items: {
            include: { rawItem: true },
          },
        },
      });

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "UPDATE_BOM",
          entityName: "BillOfMaterial",
          entityId: id,
          previousState: { bomName: existingBom.bomName },
          newState: { bomName: updated.bomName },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Delete a BOM if no production orders have ever referenced it
   */
  async deleteBom(ctx: TenantContext, id: string): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      const bom = await tx.billOfMaterial.findFirst({
        where: { id, companyId: ctx.companyId },
      });
      if (!bom) {
        throw new NotFoundException(`Bill of Materials ${id} not found.`);
      }

      const linkedOrder = await tx.productionOrder.findFirst({
        where: { bomId: id, companyId: ctx.companyId },
      });
      if (linkedOrder) {
        throw new BadRequestException(
          `Cannot delete BOM "${bom.bomName}" because it is referenced in production order history.`,
        );
      }

      await tx.bomItem.deleteMany({ where: { bomId: id } });
      await tx.billOfMaterial.delete({ where: { id } });

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "DELETE_BOM",
          entityName: "BillOfMaterial",
          entityId: id,
          previousState: { bomName: bom.bomName },
        },
        tx,
      );

      return { success: true, message: `BOM "${bom.bomName}" deleted successfully.` };
    });
  }
}
