import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { TenantContext } from "@billing/shared-types";
import { CreateBatchDto, QueryBatchesDto } from "./dto/create-batch.dto";

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(ctx: TenantContext, dto: CreateBatchDto) {
    if (!dto.itemId) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Item ID is required for batch creation.",
        messageGujarati: "બેચ બનાવવા માટે આઇટમ આઈડી જરૂરી છે.",
      });
    }

    if (!dto.batchNumber || !dto.batchNumber.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Batch number is required.",
        messageGujarati: "બેચ નંબર જરૂરી છે.",
      });
    }

    const effectiveSalePrice =
      dto.salePrice !== undefined ? dto.salePrice : (dto as any).saleRate;

    if (effectiveSalePrice === undefined || effectiveSalePrice < 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Valid sale price is required.",
        messageGujarati: "માન્ય વેચાણ કિંમત જરૂરી છે.",
      });
    }

    if (dto.mrp === undefined || dto.mrp < 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Valid MRP is required.",
        messageGujarati: "માન્ય MRP જરૂરી છે.",
      });
    }

    const rawPurchaseRate =
      dto.purchaseRate !== undefined
        ? dto.purchaseRate
        : (dto as any).purchasePrice;

    if (rawPurchaseRate !== undefined && rawPurchaseRate < 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Valid purchase rate is required.",
        messageGujarati: "માન્ય ખરીદ કિંમત જરૂરી છે.",
      });
    }

    const batchNumber = dto.batchNumber.trim();
    const mfgDate = dto.mfgDate ? new Date(dto.mfgDate) : null;
    const expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;

    if (mfgDate && isNaN(mfgDate.getTime())) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Invalid manufacturing date format.",
        messageGujarati: "અમાન્ય ઉત્પાદન તારીખ ફોર્મેટ.",
      });
    }

    if (expiryDate && isNaN(expiryDate.getTime())) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Invalid expiry date format.",
        messageGujarati: "અમાન્ય એક્સપાયરી તારીખ ફોર્મેટ.",
      });
    }

    if (mfgDate && expiryDate && expiryDate < mfgDate) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Expiry date cannot be prior to manufacturing date.",
        messageGujarati: "એક્સપાયરી તારીખ ઉત્પાદન તારીખ પહેલાંની ન હોઈ શકે.",
      });
    }

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Verify item belongs to company and has trackBatches enabled
      const item = await tx.item.findFirst({
        where: { id: dto.itemId, companyId: ctx.companyId },
      });

      if (!item) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Item with ID '${dto.itemId}' not found in active company.`,
          messageGujarati: "આઇટમ સક્રિય કંપનીમાં મળી નથી.",
        });
      }

      if (!item.trackBatches) {
        if (item.type === "SERVICE") {
          throw new BadRequestException({
            statusCode: 400,
            error: "BATCH_TRACKING_DISABLED",
            message: `Batch tracking cannot be enabled for service item '${item.name}'. Only physical products can have batches.`,
            messageGujarati: `'${item.name}' સેવા આઇટમ માટે બેચ બનાવી શકાતી નથી. માત્ર ભૌતિક ઉત્પાદનો માટે જ બેચ સક્ષમ છે.`,
          });
        }
        // Auto-enable trackBatches on physical product item
        await tx.item.update({
          where: { id: item.id },
          data: { trackBatches: true },
        });
      }

      // 2. Prevent duplicate batch number for this item
      const existingBatch = await tx.itemBatch.findFirst({
        where: { itemId: dto.itemId, batchNumber },
      });

      if (existingBatch) {
        throw new ConflictException({
          statusCode: 409,
          error: "DUPLICATE_BATCH",
          message: `Batch number '${batchNumber}' already exists for item '${item.name}'.`,
          messageGujarati: `આ આઇટમ માટે બેચ નંબર '${batchNumber}' પહેલેથી જ હાજર છે.`,
        });
      }

      const finalPurchaseRate =
        rawPurchaseRate !== undefined
          ? Number(rawPurchaseRate)
          : item.purchaseRate
          ? Number(item.purchaseRate)
          : 0;

      // 3. Create Batch
      const batch = await tx.itemBatch.create({
        data: {
          itemId: dto.itemId,
          batchNumber,
          mfgDate,
          expiryDate,
          purchaseRate: finalPurchaseRate,
          mrp: dto.mrp,
          salePrice: effectiveSalePrice,
          barcode: dto.barcode ? dto.barcode.trim() : null,
        },
        include: {
          item: true,
        },
      });

      // 4. Audit Log
      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "BATCH_CREATE",
          entityName: "ItemBatch",
          entityId: batch.id,
          newState: batch,
        });
      }

      return batch;
    });
  }

  async findAll(ctx: TenantContext, query: QueryBatchesDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const where: any = {
        item: { companyId: ctx.companyId },
      };

      if (query.itemId) {
        where.itemId = query.itemId;
      }

      if (query.barcode) {
        where.barcode = query.barcode.trim();
      }

      return tx.itemBatch.findMany({
        where,
        include: { item: true },
        orderBy: { createdAt: "desc" },
      });
    });
  }

  async findOne(ctx: TenantContext, id: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const batch = await tx.itemBatch.findFirst({
        where: {
          id,
          item: { companyId: ctx.companyId },
        },
        include: { item: true },
      });

      if (!batch) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Item batch with ID '${id}' not found.`,
          messageGujarati: `બેચ મળ્યો નથી.`,
        });
      }

      return batch;
    });
  }
}
