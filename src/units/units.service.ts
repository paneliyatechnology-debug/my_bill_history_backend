import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { TenantContext } from "@billing/shared-types";
import { CreateUnitDto } from "./dto/create-unit.dto";

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(ctx: TenantContext, dto: CreateUnitDto) {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Unit name is required.",
        messageGujarati: "યુનિટનું નામ જરૂરી છે.",
      });
    }

    const rawSymbol = dto.symbol || (dto as any).code;
    if (!rawSymbol || !rawSymbol.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Unit symbol is required.",
        messageGujarati: "યુનિટનું પ્રતીક (સિમ્બોલ) જરૂરી છે.",
      });
    }

    const symbol = rawSymbol.trim().toUpperCase();
    const uqcCode = (dto.uqcCode || (dto as any).code || symbol)
      .trim()
      .toUpperCase();
    const decimalPlaces =
      typeof dto.decimalPlaces === "number" ? dto.decimalPlaces : 2;

    if (decimalPlaces < 0 || decimalPlaces > 4) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Decimal places must be between 0 and 4.",
        messageGujarati: "દશાંશ સ્થાનો ૦ થી ૪ ની વચ્ચે હોવા જોઈએ.",
      });
    }

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existing = await tx.unitOfMeasure.findFirst({
        where: {
          companyId: ctx.companyId,
          symbol,
        },
      });

      if (existing) {
        throw new ConflictException({
          statusCode: 409,
          error: "DUPLICATE_UOM",
          message: `Unit with symbol '${symbol}' already exists in this company.`,
          messageGujarati: `આ કંપનીમાં પ્રતીક '${symbol}' ધરાવતો યુનિટ પહેલેથી જ હાજર છે.`,
        });
      }

      const uom = await tx.unitOfMeasure.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          name: dto.name.trim(),
          symbol,
          uqcCode,
          decimalPlaces,
        },
      });

      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "UOM_CREATE",
          entityName: "UnitOfMeasure",
          entityId: uom.id,
          newState: uom,
        });
      }

      return uom;
    });
  }

  async findAll(ctx: TenantContext) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      let list = await tx.unitOfMeasure.findMany({
        where: { companyId: ctx.companyId },
        orderBy: { symbol: "asc" },
      });

      if (list.length === 0) {
        // Auto-seed standard Indian GST units of measure
        const standardUoms = [
          { name: "Pieces", symbol: "PCS", uqcCode: "PCS", decimalPlaces: 0 },
          { name: "Kilograms", symbol: "KGS", uqcCode: "KGS", decimalPlaces: 2 },
          { name: "Boxes", symbol: "BOX", uqcCode: "BOX", decimalPlaces: 0 },
          { name: "Numbers", symbol: "NOS", uqcCode: "NOS", decimalPlaces: 0 },
          { name: "Meters", symbol: "MTR", uqcCode: "MTR", decimalPlaces: 2 },
        ];

        for (const u of standardUoms) {
          try {
            await tx.unitOfMeasure.create({
              data: {
                organizationId: ctx.organizationId,
                companyId: ctx.companyId,
                name: u.name,
                symbol: u.symbol,
                uqcCode: u.uqcCode,
                decimalPlaces: u.decimalPlaces,
              },
            });
          } catch {
            // Ignore race condition if concurrently inserted
          }
        }

        list = await tx.unitOfMeasure.findMany({
          where: { companyId: ctx.companyId },
          orderBy: { symbol: "asc" },
        });
      }

      return list;
    });
  }

  async findOne(ctx: TenantContext, id: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const uom = await tx.unitOfMeasure.findFirst({
        where: { id, companyId: ctx.companyId },
      });

      if (!uom) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Unit of measure with ID '${id}' not found.`,
          messageGujarati: `આઈડી '${id}' ધરાવતો યુનિટ મળ્યો નથી.`,
        });
      }

      return uom;
    });
  }

  async update(
    ctx: TenantContext,
    id: string,
    dto: { name?: string; symbol?: string; uqcCode?: string; decimalPlaces?: number },
  ) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existing = await tx.unitOfMeasure.findFirst({
        where: { id, companyId: ctx.companyId },
      });

      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Unit of measure with ID '${id}' not found.`,
          messageGujarati: `આઈડી '${id}' ધરાવતો યુનિટ મળ્યો નથી.`,
        });
      }

      const updated = await tx.unitOfMeasure.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(dto.symbol ? { symbol: dto.symbol.trim().toUpperCase() } : {}),
          ...(dto.uqcCode ? { uqcCode: dto.uqcCode.trim().toUpperCase() } : {}),
          ...(dto.decimalPlaces !== undefined ? { decimalPlaces: Number(dto.decimalPlaces) } : {}),
        },
      });

      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "UOM_UPDATE",
          entityName: "UnitOfMeasure",
          entityId: updated.id,
          previousState: existing,
          newState: updated,
        });
      }

      return updated;
    });
  }

  async delete(ctx: TenantContext, id: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existing = await tx.unitOfMeasure.findFirst({
        where: { id, companyId: ctx.companyId },
      });

      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Unit of measure with ID '${id}' not found.`,
          messageGujarati: `આઈડી '${id}' ધરાવતો યુનિટ મળ્યો નથી.`,
        });
      }

      await tx.unitOfMeasure.delete({
        where: { id },
      });

      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "UOM_DELETE",
          entityName: "UnitOfMeasure",
          entityId: id,
          previousState: existing,
        });
      }

      return { success: true };
    });
  }

  async bulkDelete(ctx: TenantContext, ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException("No unit IDs provided for deletion.");
    }
    let count = 0;
    for (const id of ids) {
      try {
        await this.delete(ctx, id);
        count++;
      } catch {
        // continue
      }
    }
    return { success: true, count };
  }
}

