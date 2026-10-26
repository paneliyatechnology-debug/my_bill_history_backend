import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import {
  TenantContext,
  ItemType,
  ValuationMethod,
  StockTransactionType,
} from "@billing/shared-types";
import { CreateItemDto } from "./dto/create-item.dto";
import { UpdateItemDto, QueryItemsDto, AdjustStockDto } from "./dto/update-item.dto";

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private async resolveWarehouseId(ctx: TenantContext, tx: any, warehouseId?: string): Promise<string> {
    if (warehouseId) {
      const existing = await tx.warehouse.findFirst({
        where: { id: warehouseId, companyId: ctx.companyId },
      });
      if (existing) return existing.id;
    }

    const defaultWh = await tx.warehouse.findFirst({
      where: { companyId: ctx.companyId, isDefault: true },
    });
    if (defaultWh) return defaultWh.id;

    const anyWh = await tx.warehouse.findFirst({
      where: { companyId: ctx.companyId },
    });
    if (anyWh) return anyWh.id;

    let resolvedBranchId = ctx.branchId;
    if (!resolvedBranchId) {
      const branch = await tx.branch.findFirst({
        where: { companyId: ctx.companyId },
      });
      if (branch) {
        resolvedBranchId = branch.id;
      } else {
        const newBranch = await tx.branch.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            name: "Main Branch",
            code: "MAIN",
            isMainBranch: true,
            addressLine1: "Main Office",
            city: "Ahmedabad",
            pincode: "380001",
            stateCode: "24",
            phone: "9999999999",
          },
        });
        resolvedBranchId = newBranch.id;
      }
    }

    const createdWh = await tx.warehouse.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        branchId: resolvedBranchId,
        name: "Main Warehouse",
        isDefault: true,
      },
    });
    return createdWh.id;
  }

  async create(ctx: TenantContext, dto: CreateItemDto) {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Item name is required.",
        messageGujarati: "આઇટમનું નામ જરૂરી છે.",
      });
    }

    if (!dto.hsnCode || !dto.hsnCode.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        message: "HSN/SAC code is required for GST compliance.",
        messageGujarati: "GST પાલન માટે HSN/SAC કોડ જરૂરી છે.",
      });
    }

    if (!dto.primaryUomId) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Primary Unit of Measure (UOM) is required.",
        messageGujarati: "પ્રાથમિક માપન એકમ (UOM) જરૂરી છે.",
      });
    }

    if (
      dto.taxRate === undefined ||
      dto.taxRate === null ||
      Number(dto.taxRate) < 0
    ) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Valid GST tax rate is required.",
        messageGujarati: "માન્ય GST કર દર જરૂરી છે.",
      });
    }

    const type = dto.type || ItemType.PRODUCT;
    const name = dto.name.trim();
    const hsnCode = dto.hsnCode.trim();
    const sku = dto.sku?.trim() || null;
    const barcode = dto.barcode?.trim() || null;

    // Non-stock / Service item rule
    let trackBatches = Boolean(dto.trackBatches);
    let trackSerialNo = Boolean(dto.trackSerialNo);
    if (type === ItemType.SERVICE) {
      trackBatches = false;
      trackSerialNo = false;
    }

    const valuationMethod = dto.valuationMethod || ValuationMethod.FIFO;

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Verify primary UOM belongs to company
      const primaryUom = await tx.unitOfMeasure.findFirst({
        where: { id: dto.primaryUomId, companyId: ctx.companyId },
      });

      if (!primaryUom) {
        throw new BadRequestException({
          statusCode: 400,
          message: `Primary Unit of Measure with ID '${dto.primaryUomId}' does not exist in this company.`,
          messageGujarati: "પસંદ કરેલ પ્રાથમિક એકમ આ કંપનીમાં અસ્તિત્વમાં નથી.",
        });
      }

      // 2. Verify secondary UOM and conversion factor if provided
      if (dto.secondaryUomId) {
        const secondaryUom = await tx.unitOfMeasure.findFirst({
          where: { id: dto.secondaryUomId, companyId: ctx.companyId },
        });

        if (!secondaryUom) {
          throw new BadRequestException({
            statusCode: 400,
            message: `Secondary Unit of Measure with ID '${dto.secondaryUomId}' does not exist in this company.`,
            messageGujarati: "પસંદ કરેલ ગૌણ એકમ આ કંપનીમાં અસ્તિત્વમાં નથી.",
          });
        }

        if (!dto.conversionFactor || Number(dto.conversionFactor) <= 0) {
          throw new BadRequestException({
            statusCode: 400,
            message:
              "Conversion factor must be greater than 0 when secondary UOM is defined.",
            messageGujarati:
              "ગૌણ એકમ માટે કન્વર્ઝન ફેક્ટર ૦ થી મોટો હોવો જોઈએ.",
          });
        }
      }

      // 3. Verify category if provided
      if (dto.categoryId) {
        const category = await tx.itemCategory.findFirst({
          where: { id: dto.categoryId, companyId: ctx.companyId },
        });

        if (!category) {
          throw new BadRequestException({
            statusCode: 400,
            message: `Item category with ID '${dto.categoryId}' does not exist in this company.`,
            messageGujarati: "પસંદ કરેલ કેટેગરી આ કંપનીમાં અસ્તિત્વમાં નથી.",
          });
        }
      }

      // 4. Duplicate checks within company
      if (sku) {
        const existingSku = await tx.item.findFirst({
          where: { companyId: ctx.companyId, sku },
        });

        if (existingSku) {
          throw new ConflictException({
            statusCode: 409,
            error: "DUPLICATE_SKU",
            message: `An item with SKU '${sku}' already exists in this company ('${existingSku.name}').`,
            messageGujarati: `SKU '${sku}' વાળી આઇટમ પહેલેથી જ હાજર છે.`,
          });
        }
      }

      if (barcode) {
        const existingBarcode = await tx.item.findFirst({
          where: { companyId: ctx.companyId, barcode },
        });

        if (existingBarcode) {
          throw new ConflictException({
            statusCode: 409,
            error: "DUPLICATE_BARCODE",
            message: `An item with barcode '${barcode}' already exists in this company ('${existingBarcode.name}').`,
            messageGujarati: `બારકોડ '${barcode}' વાળી આઇટમ પહેલેથી જ હાજર છે.`,
          });
        }
      }

      let hsnMasterId = dto.hsnMasterId || null;
      if (!hsnMasterId && hsnCode) {
        const foundHsn = await tx.hsnMaster.findFirst({
          where: {
            code: hsnCode,
            isActive: true,
            OR: [{ companyId: ctx.companyId }, { companyId: null }],
          },
        });
        if (foundHsn) {
          hsnMasterId = foundHsn.id;
        }
      }

      // 5. Create Item
      const item = await tx.item.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          categoryId: dto.categoryId || null,
          hsnMasterId,
          type,
          name,
          nameGujarati: dto.nameGujarati?.trim() || null,
          sku,
          barcode,
          hsnCode,
          primaryUomId: dto.primaryUomId,
          secondaryUomId: dto.secondaryUomId || null,
          conversionFactor: dto.conversionFactor ?? null,
          taxRate: dto.taxRate,
          cessRate: dto.cessRate ?? 0.0,
          cessPerUnit: dto.cessPerUnit ?? 0.0,
          purchaseRate: dto.purchaseRate ?? 0.0,
          retailPrice: dto.retailPrice,
          wholesalePrice: dto.wholesalePrice ?? 0.0,
          mrp: dto.mrp ?? null,
          minStockLevel: dto.minStockLevel ?? 0.0,
          reorderQuantity: dto.reorderQuantity ?? 0.0,
          trackBatches,
          trackSerialNo,
          valuationMethod,
          isActive: true,
        },
        include: {
          primaryUom: true,
          secondaryUom: true,
          category: true,
          hsnMaster: true,
        },
      });

      // 6. Record Opening Stock Transaction if initial stock quantity is provided for Product
      let initialStock = 0;
      if (
        type === ItemType.PRODUCT &&
        dto.openingStock !== undefined &&
        Number(dto.openingStock) > 0
      ) {
        initialStock = Number(dto.openingStock);
        const valRate = Number(dto.purchaseRate || dto.retailPrice || 0);
        const totalVal = initialStock * valRate;

        const warehouseId = await this.resolveWarehouseId(ctx, tx, dto.warehouseId);

        // Optional Batch for Opening Stock if trackBatches is enabled
        let batchId: string | null = null;
        if (trackBatches) {
          const batchNumber = dto.openingBatchNumber?.trim() || "OPENING-BATCH";
          const batch = await tx.itemBatch.create({
            data: {
              itemId: item.id,
              batchNumber,
              mfgDate: dto.openingMfgDate ? new Date(dto.openingMfgDate) : null,
              expiryDate: dto.openingExpiryDate ? new Date(dto.openingExpiryDate) : null,
              purchaseRate: valRate,
              mrp: dto.mrp ?? dto.retailPrice,
              salePrice: dto.retailPrice,
            },
          });
          batchId = batch.id;
        }

        await tx.stockTransaction.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            warehouseId,
            itemId: item.id,
            batchId,
            transactionType: StockTransactionType.OPENING,
            transactionDate: dto.openingStockDate ? new Date(dto.openingStockDate) : new Date(),
            quantity: initialStock,
            valuationRate: valRate,
            totalValuation: totalVal,
            referenceDocType: "OPENING_BALANCE",
            referenceDocId: item.id,
          },
        });
      }

      // 7. Audit Log
      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "ITEM_CREATE",
          entityName: "Item",
          entityId: item.id,
          newState: { ...item, currentStock: initialStock },
        });
      }

      return {
        ...item,
        currentStock: initialStock,
      };
    });
  }

  async lookup(ctx: TenantContext, code: string) {
    if (!code || !code.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Search code (barcode or SKU) is required for lookup.",
        messageGujarati: "શોધવા માટે બારકોડ અથવા SKU કોડ જરૂરી છે.",
      });
    }

    const cleanCode = code.trim();

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const item = await tx.item.findFirst({
        where: {
          companyId: ctx.companyId,
          isActive: true,
          OR: [{ barcode: cleanCode }, { sku: cleanCode }],
        },
        include: {
          primaryUom: true,
          secondaryUom: true,
          category: true,
          batches: {
            orderBy: { createdAt: "desc" },
            take: 5,
          },
          stockTransactions: {
            where: { companyId: ctx.companyId },
            select: { quantity: true },
          },
        },
      });

      if (!item) {
        throw new NotFoundException({
          statusCode: 404,
          error: "ITEM_NOT_FOUND",
          message: `No active item found matching code '${cleanCode}'.`,
          messageGujarati: `કોડ '${cleanCode}' સાથે મેળ ખાતી કોઈ સક્રિય આઇટમ મળી નથી.`,
        });
      }

      const currentStock = (item.stockTransactions || []).reduce(
        (sum, st) => sum + Number(st.quantity),
        0,
      );
      const { stockTransactions, ...rest } = item;
      return {
        ...rest,
        currentStock,
      };
    });
  }

  async findAll(ctx: TenantContext, query: QueryItemsDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const where: any = {
        companyId: ctx.companyId,
      };

      if (query.type) {
        where.type = query.type;
      }

      if (query.categoryId) {
        where.categoryId = query.categoryId;
      }

      if (query.isActive !== undefined && query.isActive !== "") {
        where.isActive = query.isActive === true || query.isActive === "true";
      }

      if (query.search && query.search.trim()) {
        const search = query.search.trim();
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { nameGujarati: { contains: search, mode: "insensitive" } },
          { sku: { contains: search, mode: "insensitive" } },
          { barcode: { contains: search, mode: "insensitive" } },
          { hsnCode: { contains: search, mode: "insensitive" } },
        ];
      }

      const [items, total] = await Promise.all([
        tx.item.findMany({
          where,
          include: {
            primaryUom: true,
            secondaryUom: true,
            category: true,
            hsnMaster: true,
            stockTransactions: {
              where: { companyId: ctx.companyId },
              select: { quantity: true },
            },
          },
          orderBy: { name: "asc" },
          skip,
          take: limit,
        }),
        tx.item.count({ where }),
      ]);

      const itemsWithStock = items.map((it) => {
        const currentStock = (it.stockTransactions || []).reduce(
          (sum, st) => sum + Number(st.quantity),
          0,
        );
        const { stockTransactions, ...rest } = it;
        return {
          ...rest,
          currentStock,
        };
      });

      return {
        items: itemsWithStock,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async findOne(ctx: TenantContext, id: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          primaryUom: true,
          secondaryUom: true,
          category: true,
          batches: true,
          hsnMaster: true,
          stockTransactions: {
            where: { companyId: ctx.companyId },
            select: { quantity: true },
          },
        },
      });

      if (!item) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Item with ID '${id}' not found in the active company.`,
          messageGujarati: `સક્રિય કંપનીમાં આઈડી '${id}' વાળી આઇટમ મળી નથી.`,
        });
      }

      const currentStock = (item.stockTransactions || []).reduce(
        (sum, st) => sum + Number(st.quantity),
        0,
      );
      const { stockTransactions, ...rest } = item;
      return {
        ...rest,
        currentStock,
      };
    });
  }

  async update(ctx: TenantContext, id: string, dto: UpdateItemDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existing = await tx.item.findFirst({
        where: { id, companyId: ctx.companyId },
      });

      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Item with ID '${id}' not found.`,
          messageGujarati: `આઇટમ મળી નથી.`,
        });
      }

      // Check duplicate SKU if changed
      if (dto.sku !== undefined && dto.sku !== existing.sku) {
        const sku = dto.sku ? dto.sku.trim() : null;
        if (sku) {
          const duplicate = await tx.item.findFirst({
            where: { companyId: ctx.companyId, sku, id: { not: id } },
          });
          if (duplicate) {
            throw new ConflictException({
              statusCode: 409,
              error: "DUPLICATE_SKU",
              message: `Another item with SKU '${sku}' already exists in this company.`,
              messageGujarati: `SKU '${sku}' વાળી અન્ય આઇટમ પહેલેથી જ હાજર છે.`,
            });
          }
        }
      }

      // Check duplicate barcode if changed
      if (dto.barcode !== undefined && dto.barcode !== existing.barcode) {
        const barcode = dto.barcode ? dto.barcode.trim() : null;
        if (barcode) {
          const duplicate = await tx.item.findFirst({
            where: { companyId: ctx.companyId, barcode, id: { not: id } },
          });
          if (duplicate) {
            throw new ConflictException({
              statusCode: 409,
              error: "DUPLICATE_BARCODE",
              message: `Another item with barcode '${barcode}' already exists in this company.`,
              messageGujarati: `બારકોડ '${barcode}' વાળી અન્ય આઇટમ પહેલેથી જ હાજર છે.`,
            });
          }
        }
      }

      const type = dto.type ?? existing.type;
      let trackBatches =
        dto.trackBatches !== undefined
          ? dto.trackBatches
          : existing.trackBatches;
      let trackSerialNo =
        dto.trackSerialNo !== undefined
          ? dto.trackSerialNo
          : existing.trackSerialNo;
      if (type === ItemType.SERVICE) {
        trackBatches = false;
        trackSerialNo = false;
      }

      let nextHsnCode = dto.hsnCode ? dto.hsnCode.trim() : existing.hsnCode;
      let nextHsnMasterId = dto.hsnMasterId !== undefined ? dto.hsnMasterId : existing.hsnMasterId;
      if (dto.hsnCode && dto.hsnMasterId === undefined) {
        const foundHsn = await tx.hsnMaster.findFirst({
          where: {
            code: nextHsnCode,
            isActive: true,
            OR: [{ companyId: ctx.companyId }, { companyId: null }],
          },
        });
        nextHsnMasterId = foundHsn ? foundHsn.id : null;
      }

      const updated = await tx.item.update({
        where: { id },
        data: {
          type,
          name: dto.name ? dto.name.trim() : existing.name,
          nameGujarati:
            dto.nameGujarati !== undefined
              ? dto.nameGujarati?.trim() || null
              : existing.nameGujarati,
          sku:
            dto.sku !== undefined
              ? dto.sku
                ? dto.sku.trim()
                : null
              : existing.sku,
          barcode:
            dto.barcode !== undefined
              ? dto.barcode
                ? dto.barcode.trim()
                : null
              : existing.barcode,
          hsnCode: nextHsnCode,
          hsnMasterId: nextHsnMasterId,
          categoryId:
            dto.categoryId !== undefined ? dto.categoryId : existing.categoryId,
          primaryUomId: dto.primaryUomId ?? existing.primaryUomId,
          secondaryUomId:
            dto.secondaryUomId !== undefined
              ? dto.secondaryUomId
              : existing.secondaryUomId,
          conversionFactor:
            dto.conversionFactor !== undefined
              ? dto.conversionFactor
              : existing.conversionFactor,
          taxRate: dto.taxRate !== undefined ? dto.taxRate : existing.taxRate,
          cessRate:
            dto.cessRate !== undefined ? dto.cessRate : existing.cessRate,
          cessPerUnit:
            dto.cessPerUnit !== undefined
              ? dto.cessPerUnit
              : existing.cessPerUnit,
          purchaseRate:
            dto.purchaseRate !== undefined
              ? dto.purchaseRate
              : existing.purchaseRate,
          retailPrice:
            dto.retailPrice !== undefined
              ? dto.retailPrice
              : existing.retailPrice,
          wholesalePrice:
            dto.wholesalePrice !== undefined
              ? dto.wholesalePrice
              : existing.wholesalePrice,
          mrp: dto.mrp !== undefined ? dto.mrp : existing.mrp,
          minStockLevel:
            dto.minStockLevel !== undefined
              ? dto.minStockLevel
              : existing.minStockLevel,
          reorderQuantity:
            dto.reorderQuantity !== undefined
              ? dto.reorderQuantity
              : existing.reorderQuantity,
          trackBatches,
          trackSerialNo,
          valuationMethod: dto.valuationMethod ?? existing.valuationMethod,
          isActive:
            dto.isActive !== undefined ? dto.isActive : existing.isActive,
        },
        include: {
          primaryUom: true,
          secondaryUom: true,
          category: true,
          hsnMaster: true,
        },
      });

      // Synchronize opening stock if provided
      if (dto.openingStock !== undefined) {
        const openingQty = Math.max(0, Number(dto.openingStock) || 0);
        const existingOpening = await tx.stockTransaction.findFirst({
          where: {
            companyId: ctx.companyId,
            itemId: id,
            transactionType: StockTransactionType.OPENING,
          },
        });

        const valRate = Number(dto.purchaseRate ?? updated.purchaseRate ?? updated.retailPrice ?? 0);
        const txDate = dto.openingStockDate ? new Date(dto.openingStockDate) : new Date();

        if (openingQty > 0) {
          if (existingOpening) {
            await tx.stockTransaction.update({
              where: { id: existingOpening.id },
              data: {
                quantity: openingQty,
                valuationRate: valRate,
                totalValuation: openingQty * valRate,
                transactionDate: txDate,
                warehouseId: dto.warehouseId || existingOpening.warehouseId,
              },
            });
          } else {
            const warehouseId = await this.resolveWarehouseId(ctx, tx, dto.warehouseId);

            await tx.stockTransaction.create({
              data: {
                organizationId: ctx.organizationId,
                companyId: ctx.companyId,
                warehouseId,
                itemId: id,
                transactionType: StockTransactionType.OPENING,
                transactionDate: txDate,
                quantity: openingQty,
                valuationRate: valRate,
                totalValuation: openingQty * valRate,
                referenceDocType: "OPENING_BALANCE",
                referenceDocId: id,
              },
            });
          }
        } else if (existingOpening) {
          await tx.stockTransaction.delete({
            where: { id: existingOpening.id },
          });
        }
      }

      // Compute current stock dynamically from all stock transactions
      const stockTransactions = await tx.stockTransaction.findMany({
        where: { itemId: id, companyId: ctx.companyId },
        select: { quantity: true },
      });
      const currentStock = stockTransactions.reduce(
        (sum, t) => sum + Number(t.quantity),
        0,
      );

      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "ITEM_UPDATE",
          entityName: "Item",
          entityId: id,
          previousState: existing,
          newState: { ...updated, currentStock },
        });
      }

      return {
        ...updated,
        currentStock,
      };
    });
  }

  async archive(ctx: TenantContext, id: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existing = await tx.item.findFirst({
        where: { id, companyId: ctx.companyId },
      });

      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Item with ID '${id}' not found.`,
          messageGujarati: `આઇટમ મળી નથી.`,
        });
      }

      const archived = await tx.item.update({
        where: { id },
        data: { isActive: false },
      });

      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "ITEM_ARCHIVE",
          entityName: "Item",
          entityId: id,
          previousState: existing,
          newState: archived,
        });
      }

      return {
        success: true,
        message: `Item '${existing.name}' archived successfully.`,
        messageGujarati: `આઇટમ '${existing.name}' સફળતાપૂર્વક આર્કાઇવ કરવામાં આવી છે.`,
        item: archived,
      };
    });
  }

  async delete(ctx: TenantContext, id: string, force = false) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existing = await tx.item.findFirst({
        where: { id, companyId: ctx.companyId },
      });

      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Item with ID '${id}' not found.`,
          messageGujarati: `આઇટમ મળી નથી.`,
        });
      }

      // If user requested force deletion, or if the item is ALREADY inactive (user wants to completely purge it)
      if (force || existing.isActive === false) {
        await tx.salesReturnItem.deleteMany({ where: { itemId: id } });
        await tx.purchaseReturnItem.deleteMany({ where: { itemId: id } });
        await tx.outwardDebitNoteItem.deleteMany({ where: { itemId: id } });
        await tx.stockTransferItem.deleteMany({ where: { itemId: id } });
        await tx.deliveryChallanItem.deleteMany({ where: { itemId: id } });
        await tx.salesInvoiceItem.deleteMany({ where: { itemId: id } });
        await tx.purchaseInvoiceItem.deleteMany({ where: { itemId: id } });
        await tx.bomItem.deleteMany({ where: { rawItemId: id } });
        await tx.billOfMaterial.deleteMany({ where: { finishedItemId: id } });
        await tx.stockTransaction.deleteMany({ where: { itemId: id } });
        await tx.itemBatch.deleteMany({ where: { itemId: id } });
        await tx.item.delete({ where: { id } });

        if (ctx.userId) {
          await this.audit.record({
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            userId: ctx.userId,
            action: "ITEM_PERMANENT_DELETE",
            entityName: "Item",
            entityId: id,
            previousState: existing,
            newState: null,
          });
        }

        return {
          success: true,
          deleted: true,
          archived: false,
          message: `Item '${existing.name}' was permanently deleted and removed from the system.`,
          messageGujarati: `વસ્તુ '${existing.name}' કાયમ માટે કાઢી નાખવામાં આવી છે.`,
        };
      }

      // Check if item has any transactional relations
      const [
        salesCount,
        purchaseCount,
        salesReturnCount,
        purchaseReturnCount,
        debitNoteCount,
        transferCount,
        challanCount,
        bomOutputCount,
        bomInputCount,
      ] = await Promise.all([
        tx.salesInvoiceItem.count({ where: { itemId: id } }),
        tx.purchaseInvoiceItem.count({ where: { itemId: id } }),
        tx.salesReturnItem.count({ where: { itemId: id } }),
        tx.purchaseReturnItem.count({ where: { itemId: id } }),
        tx.outwardDebitNoteItem.count({ where: { itemId: id } }),
        tx.stockTransferItem.count({ where: { itemId: id } }),
        tx.deliveryChallanItem.count({ where: { itemId: id } }),
        tx.billOfMaterial.count({ where: { finishedItemId: id } }),
        tx.bomItem.count({ where: { rawItemId: id } }),
      ]);

      const hasTransactionalHistory =
        salesCount > 0 ||
        purchaseCount > 0 ||
        salesReturnCount > 0 ||
        purchaseReturnCount > 0 ||
        debitNoteCount > 0 ||
        transferCount > 0 ||
        challanCount > 0 ||
        bomOutputCount > 0 ||
        bomInputCount > 0;

      if (hasTransactionalHistory) {
        const archived = await tx.item.update({
          where: { id },
          data: { isActive: false },
        });

        if (ctx.userId) {
          await this.audit.record({
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            userId: ctx.userId,
            action: "ITEM_ARCHIVE",
            entityName: "Item",
            entityId: id,
            previousState: existing,
            newState: archived,
          });
        }

        return {
          success: true,
          deleted: false,
          archived: true,
          message: `Item '${existing.name}' is referenced in invoices/vouchers. It has been deactivated and removed from the active catalog.`,
          messageGujarati: `આ વસ્તુ બિલ/ટ્રાન્ઝેક્શનમાં વપરાયેલ હોવાથી તેને નિષ્ક્રિય (આર્કાઇવ) કરી કેટલોગમાંથી દૂર કરેલ છે.`,
          item: archived,
        };
      }

      // No financial transactions exist. Safe to permanently delete.
      await tx.stockTransaction.deleteMany({
        where: { itemId: id },
      });

      await tx.itemBatch.deleteMany({
        where: { itemId: id },
      });

      await tx.item.delete({
        where: { id },
      });

      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "ITEM_DELETE",
          entityName: "Item",
          entityId: id,
          previousState: existing,
          newState: null,
        });
      }

      return {
        success: true,
        deleted: true,
        archived: false,
        message: `Item '${existing.name}' has been deleted successfully.`,
        messageGujarati: `વસ્તુ '${existing.name}' સફળતાપૂર્વક કાઢી નાખવામાં આવી છે.`,
      };
    });
  }

  async bulkDelete(ctx: TenantContext, ids: string[], force = false) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: "No item IDs provided for bulk deletion.",
        messageGujarati: "કાઢી નાખવા માટે કોઈ વસ્તુ પસંદ કરેલ નથી.",
      });
    }

    let deletedCount = 0;
    let archivedCount = 0;

    for (const id of ids) {
      try {
        const res = await this.delete(ctx, id, force);
        if (res.deleted) {
          deletedCount++;
        } else {
          archivedCount++;
        }
      } catch {
        // Continue with remaining items
      }
    }

    return {
      success: true,
      totalRequested: ids.length,
      deletedCount,
      archivedCount,
      message: `Successfully processed ${ids.length} items (${deletedCount} permanently deleted, ${archivedCount} archived).`,
      messageGujarati: `${ids.length} વસ્તુઓ સફળતાપૂર્વક પ્રોસેસ કરવામાં આવી (${deletedCount} કાયમ માટે કાઢી નાખી, ${archivedCount} આર્કાઇવ થઈ).`,
    };
  }

  async adjustStock(ctx: TenantContext, id: string, dto: AdjustStockDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id, companyId: ctx.companyId },
      });

      if (!item) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Item with ID '${id}' not found.`,
          messageGujarati: `આઇટમ મળી નથી.`,
        });
      }

      const qty = Math.abs(Number(dto.quantity) || 0);
      if (qty <= 0) {
        throw new BadRequestException({
          statusCode: 400,
          message: "Adjustment quantity must be greater than 0.",
          messageGujarati: "સ્ટોક એડજસ્ટમેન્ટનો જથ્થો 0 થી વધુ હોવો જોઈએ.",
        });
      }

      const isAdd = dto.type === "ADD";
      const signedQty = isAdd ? qty : -qty;
      const txType = isAdd
        ? StockTransactionType.STOCK_ADJUSTMENT_PLUS
        : StockTransactionType.STOCK_ADJUSTMENT_MINUS;

      const warehouseId = await this.resolveWarehouseId(ctx, tx, dto.warehouseId);

      const valRate = Number(item.purchaseRate || item.retailPrice || 0);
      const txDate = dto.date ? new Date(dto.date) : new Date();

      const stockTx = await tx.stockTransaction.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          warehouseId,
          itemId: id,
          transactionType: txType,
          transactionDate: txDate,
          quantity: signedQty,
          valuationRate: valRate,
          totalValuation: qty * valRate,
          referenceDocType: "MANUAL_ADJUSTMENT",
          referenceDocId: id,
        },
      });

      const allTx = await tx.stockTransaction.findMany({
        where: { itemId: id, companyId: ctx.companyId },
        select: { quantity: true },
      });
      const currentStock = allTx.reduce((sum, t) => sum + Number(t.quantity), 0);

      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "ITEM_STOCK_ADJUSTMENT",
          entityName: "Item",
          entityId: id,
          newState: {
            itemId: id,
            adjustmentType: dto.type,
            quantity: qty,
            currentStock,
            remarks: dto.remarks,
          },
        });
      }

      return {
        success: true,
        message: `Stock successfully ${isAdd ? "increased" : "reduced"} by ${qty}.`,
        messageGujarati: `સ્ટોક સફળતાપૂર્વક ${isAdd ? "ઉમેરવામાં આવ્યો" : "ઘટાડવામાં આવ્યો"} (${qty}).`,
        currentStock,
        transaction: stockTx,
      };
    });
  }
}

