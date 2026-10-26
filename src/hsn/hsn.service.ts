import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { HsnType, TenantContext } from "@billing/shared-types";
import { Prisma } from "@billing/database";
import { CreateHsnDto } from "./dto/create-hsn.dto";
import { UpdateHsnDto } from "./dto/update-hsn.dto";
import { QueryHsnDto } from "./dto/query-hsn.dto";

const VALID_GST_SLABS = [0, 0.1, 0.25, 3, 5, 12, 18, 28];

@Injectable()
export class HsnService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async findAll(ctx: TenantContext, query: QueryHsnDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const skip = (page - 1) * limit;

    const where: Prisma.HsnMasterWhereInput = {
      OR: [{ companyId: ctx.companyId }, { companyId: null }],
    };

    if (query.type) {
      where.type = query.type;
    }

    if (query.isActive === "true") {
      where.isActive = true;
    } else if (query.isActive === "false") {
      where.isActive = false;
    }

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.AND = [
        {
          OR: [
            { code: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
            { descriptionGujarati: { contains: term, mode: "insensitive" } },
            { chapter: { contains: term, mode: "insensitive" } },
          ],
        },
      ];
    }

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const [total, items] = await Promise.all([
        tx.hsnMaster.count({ where }),
        tx.hsnMaster.findMany({
          where,
          orderBy: [{ code: "asc" }],
          skip,
          take: limit,
        }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async search(ctx: TenantContext, q?: string, limit = 20) {
    const term = (q || "").trim();
    const take = Math.min(50, Math.max(1, Number(limit) || 20));

    const where: Prisma.HsnMasterWhereInput = {
      isActive: true,
      OR: [{ companyId: ctx.companyId }, { companyId: null }],
    };

    if (term) {
      where.AND = [
        {
          OR: [
            { code: { startsWith: term, mode: "insensitive" } },
            { code: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
            { descriptionGujarati: { contains: term, mode: "insensitive" } },
          ],
        },
      ];
    }

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      return tx.hsnMaster.findMany({
        where,
        orderBy: [{ code: "asc" }],
        take,
      });
    });
  }

  async findOne(ctx: TenantContext, id: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const record = await tx.hsnMaster.findFirst({
        where: {
          id,
          OR: [{ companyId: ctx.companyId }, { companyId: null }],
        },
        include: {
          _count: { select: { items: true } },
        },
      });

      if (!record) {
        throw new NotFoundException({
          statusCode: 404,
          message: "HSN/SAC master record not found.",
          messageGujarati: "HSN/SAC માસ્ટર રેકોર્ડ મળ્યો નથી.",
        });
      }

      return record;
    });
  }

  async findByCode(ctx: TenantContext, code: string) {
    const cleanCode = (code || "").trim();
    if (!cleanCode) return null;

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      // First check company-specific code, then fallback to global system code
      const companySpecific = await tx.hsnMaster.findFirst({
        where: { companyId: ctx.companyId, code: cleanCode, isActive: true },
      });
      if (companySpecific) return companySpecific;

      return tx.hsnMaster.findFirst({
        where: { companyId: null, code: cleanCode, isActive: true },
      });
    });
  }

  async create(ctx: TenantContext, dto: CreateHsnDto) {
    if (!dto.code || !dto.code.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        message: "HSN/SAC code is required.",
        messageGujarati: "HSN/SAC કોડ જરૂરી છે.",
      });
    }

    const code = dto.code.trim();
    // Validate format: 2 to 8 alphanumeric/digits (standard Indian GST format)
    if (!/^[0-9]{2,8}$/.test(code)) {
      throw new BadRequestException({
        statusCode: 400,
        message: "HSN/SAC code must be between 2 and 8 digits (e.g. 1006, 7214, 998311).",
        messageGujarati: "HSN/SAC કોડ ૨ થી ૮ અંકોનો હોવો જોઈએ.",
      });
    }

    if (!dto.description || !dto.description.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Description is required.",
        messageGujarati: "વિગત/વર્ણન જરૂરી છે.",
      });
    }

    // Auto-detect type if not provided: starts with 99 is SAC, else HSN
    let type = dto.type;
    if (!type) {
      type = code.startsWith("99") ? HsnType.SAC : HsnType.HSN;
    }

    const gstRate = dto.gstRate !== undefined ? Number(dto.gstRate) : 18;
    if (!VALID_GST_SLABS.includes(gstRate)) {
      throw new BadRequestException({
        statusCode: 400,
        message: `GST rate must be a standard slab: ${VALID_GST_SLABS.join(", ")}%`,
        messageGujarati: `GST કર દર માન્ય સ્લેબ હોવો જોઈએ: ${VALID_GST_SLABS.join(", ")}%`,
      });
    }

    const cessRate = dto.cessRate !== undefined ? Math.max(0, Number(dto.cessRate)) : 0;
    const chapter = dto.chapter?.trim() || code.slice(0, 2);

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      // Check if duplicate code exists for this company
      const existing = await tx.hsnMaster.findFirst({
        where: {
          companyId: ctx.companyId,
          code,
        },
      });

      if (existing) {
        throw new ConflictException({
          statusCode: 409,
          message: `HSN/SAC code '${code}' already exists for your company.`,
          messageGujarati: `HSN/SAC કોડ '${code}' તમારી કંપની માટે પહેલેથી અસ્તિત્વમાં છે.`,
        });
      }

      const created = await tx.hsnMaster.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          code,
          description: dto.description.trim(),
          descriptionGujarati: dto.descriptionGujarati?.trim() || null,
          type,
          gstRate,
          cessRate,
          chapter,
          notes: dto.notes?.trim() || null,
          isSystem: false,
          isActive: true,
        },
      });

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "CREATE_HSN_MASTER",
          entityName: "HsnMaster",
          entityId: created.id,
          newState: created,
        },
        tx,
      );

      return created;
    });
  }

  async update(ctx: TenantContext, id: string, dto: UpdateHsnDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existing = await tx.hsnMaster.findFirst({
        where: { id },
      });

      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          message: "HSN/SAC master record not found.",
          messageGujarati: "HSN/SAC માસ્ટર રેકોર્ડ મળ્યો નથી.",
        });
      }

      if (existing.isSystem && existing.companyId === null) {
        throw new BadRequestException({
          statusCode: 400,
          message: "Standard system HSN codes cannot be edited directly. You can create a company custom override instead.",
          messageGujarati: "પ્રમાણભૂત સિસ્ટમ HSN કોડ સીધા સુધારી શકાતા નથી.",
        });
      }

      if (existing.companyId !== ctx.companyId) {
        throw new NotFoundException({
          statusCode: 404,
          message: "HSN/SAC master record not found in current company.",
          messageGujarati: "આ કંપનીમાં HSN/SAC માસ્ટર રેકોર્ડ મળ્યો નથી.",
        });
      }

      const dataToUpdate: Prisma.HsnMasterUpdateInput = {};

      if (dto.description !== undefined) {
        if (!dto.description.trim()) {
          throw new BadRequestException("Description cannot be empty.");
        }
        dataToUpdate.description = dto.description.trim();
      }

      if (dto.descriptionGujarati !== undefined) {
        dataToUpdate.descriptionGujarati = dto.descriptionGujarati.trim() || null;
      }

      if (dto.type !== undefined) {
        dataToUpdate.type = dto.type;
      }

      if (dto.gstRate !== undefined) {
        const rate = Number(dto.gstRate);
        if (!VALID_GST_SLABS.includes(rate)) {
          throw new BadRequestException(`GST rate must be one of: ${VALID_GST_SLABS.join(", ")}%`);
        }
        dataToUpdate.gstRate = rate;
      }

      if (dto.cessRate !== undefined) {
        dataToUpdate.cessRate = Math.max(0, Number(dto.cessRate));
      }

      if (dto.chapter !== undefined) {
        dataToUpdate.chapter = dto.chapter.trim() || null;
      }

      if (dto.notes !== undefined) {
        dataToUpdate.notes = dto.notes.trim() || null;
      }

      if (dto.isActive !== undefined) {
        dataToUpdate.isActive = Boolean(dto.isActive);
      }

      const updated = await tx.hsnMaster.update({
        where: { id },
        data: dataToUpdate,
      });

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "UPDATE_HSN_MASTER",
          entityName: "HsnMaster",
          entityId: id,
          previousState: existing,
          newState: updated,
        },
        tx,
      );

      return updated;
    });
  }

  async toggleStatus(ctx: TenantContext, id: string, isActive: boolean) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existing = await tx.hsnMaster.findFirst({
        where: { id, companyId: ctx.companyId },
      });

      if (!existing) {
        throw new NotFoundException("Company HSN record not found.");
      }

      return tx.hsnMaster.update({
        where: { id },
        data: { isActive },
      });
    });
  }

  async delete(ctx: TenantContext, id: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existing = await tx.hsnMaster.findFirst({
        where: { id },
      });

      if (!existing) {
        throw new NotFoundException("HSN/SAC record not found.");
      }

      if (existing.isSystem || existing.companyId === null) {
        throw new BadRequestException({
          statusCode: 400,
          message: "Standard system HSN codes cannot be deleted.",
          messageGujarati: "પ્રમાણભૂત સિસ્ટમ HSN કોડ કાઢી શકાતા નથી.",
        });
      }

      if (existing.companyId !== ctx.companyId) {
        throw new NotFoundException("HSN/SAC record not found in current company.");
      }

      // Check if referenced by items
      const itemCount = await tx.item.count({
        where: { hsnMasterId: id },
      });

      if (itemCount > 0) {
        throw new BadRequestException({
          statusCode: 400,
          message: `Cannot delete HSN code because it is linked to ${itemCount} item(s) in your catalog. Please deactivate it instead.`,
          messageGujarati: `આ HSN કોડ તમારી કેટલોગમાં ${itemCount} વસ્તુ(ઓ) સાથે જોડાયેલ છે, તેથી તેને કાઢી શકાતો નથી. કૃપા કરીને તેને નિષ્ક્રિય કરો.`,
        });
      }

      await tx.hsnMaster.delete({
        where: { id },
      });

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "DELETE_HSN_MASTER",
          entityName: "HsnMaster",
          entityId: id,
          previousState: existing,
        },
        tx,
      );

      return { success: true, message: "HSN code deleted successfully." };
    });
  }
}
