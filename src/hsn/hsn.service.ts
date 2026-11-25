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
      const [total, items, hsnCount, sacCount, activeCount] = await Promise.all([
        tx.hsnMaster.count({ where }),
        tx.hsnMaster.findMany({
          where,
          select: {
            id: true,
            code: true,
            type: true,
            description: true,
            descriptionGujarati: true,
            gstRate: true,
            cessRate: true,
            chapter: true,
            isActive: true,
            isSystem: true,
          },
          orderBy: [{ code: "asc" }],
          skip,
          take: limit,
        }),
        tx.hsnMaster.count({ where: { ...where, type: "HSN" } }),
        tx.hsnMaster.count({ where: { ...where, type: "SAC" } }),
        tx.hsnMaster.count({ where: { ...where, isActive: true } }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        counts: {
          total,
          hsn: hsnCount,
          sac: sacCount,
          active: activeCount,
        },
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
        select: {
          id: true,
          code: true,
          type: true,
          description: true,
          descriptionGujarati: true,
          gstRate: true,
          cessRate: true,
          chapter: true,
          isActive: true,
          isSystem: true,
        },
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

      if (existing.companyId !== null && existing.companyId !== ctx.companyId) {
        throw new NotFoundException({
          statusCode: 404,
          message: "HSN/SAC master record not found in current company.",
          messageGujarati: "આ કંપનીમાં HSN/SAC માસ્ટર રેકોર્ડ મળ્યો નથી.",
        });
      }

      // Prevent editing global system codes
      if (existing.isSystem) {
        throw new BadRequestException({
          statusCode: 400,
          message: "Global system HSN/SAC codes cannot be edited. Create a company-specific override instead.",
          messageGujarati: "ગ્લોબલ સિસ્ટમ HSN/SAC કોડ એડિટ કરી શકાતા નથી. કૃપા કરીને કંપની-સ્પેસિફિક ઓવરરાઈડ બનાવો.",
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

      if (existing.companyId !== null && existing.companyId !== ctx.companyId) {
        throw new NotFoundException("HSN/SAC record not found in current company.");
      }

      // Prevent deleting global system codes
      if (existing.isSystem) {
        throw new BadRequestException({
          statusCode: 400,
          message: "Global system HSN/SAC codes cannot be deleted.",
          messageGujarati: "ગ્લોબલ સિસ્ટમ HSN/SAC કોડ ડિલીટ કરી શકાતા નથી.",
        });
      }

      // Check if referenced by items
      const itemCount = await tx.item.count({
        where: { hsnMasterId: id },
      });

      if (itemCount > 0) {
        throw new BadRequestException({
          statusCode: 400,
          message: `Cannot delete HSN code '${existing.code}' because it is linked to ${itemCount} item(s) in your catalog. Please unlink the items or deactivate this HSN code instead.`,
          messageGujarati: `આ HSN કોડ તમારી કેટલોગમાં ${itemCount} વસ્તુ(ઓ) સાથે જોડાયેલ હોવાથી ડિલીટ કરી શકાતો નથી. કૃપા કરીને તેને નિષ્ક્રિય કરો.`,
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

  async bulkDelete(ctx: TenantContext, ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException("No HSN IDs provided for deletion.");
    }

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      // Find items linked to any of these HSN codes
      const linked = await tx.item.findMany({
        where: { hsnMasterId: { in: ids } },
        select: { hsnMasterId: true },
      });
      const linkedIds = new Set(linked.map((l) => l.hsnMasterId).filter(Boolean));
      const deletableIds = ids.filter((id) => !linkedIds.has(id));

      if (deletableIds.length === 0) {
        throw new BadRequestException({
          statusCode: 400,
          message: "All selected HSN codes are linked to items in your catalog and cannot be deleted.",
          messageGujarati: "પસંદ કરેલા તમામ HSN કોડ કેટલોગની વસ્તુઓ સાથે જોડાયેલ હોવાથી ડિલીટ કરી શકાય તેમ નથી.",
        });
      }

      const res = await tx.hsnMaster.deleteMany({
        where: { id: { in: deletableIds } },
      });

      return {
        success: true,
        deletedCount: res.count,
        skippedCount: linkedIds.size,
      };
    });
  }
}
