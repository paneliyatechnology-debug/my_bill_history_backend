import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { TenantContext } from "@billing/shared-types";
import { CreateCategoryDto } from "./dto/create-category.dto";

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(ctx: TenantContext, dto: CreateCategoryDto) {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Category name is required.",
        messageGujarati: "કેટેગરીનું નામ જરૂરી છે.",
      });
    }

    const name = dto.name.trim();

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existing = await tx.itemCategory.findFirst({
        where: {
          companyId: ctx.companyId,
          name: { equals: name, mode: "insensitive" },
        },
      });

      if (existing) {
        throw new ConflictException({
          statusCode: 409,
          error: "DUPLICATE_CATEGORY",
          message: `Category with name '${name}' already exists in this company.`,
          messageGujarati: `આ કંપનીમાં '${name}' નામવાળી કેટેગરી પહેલેથી જ હાજર છે.`,
        });
      }

      const category = await tx.itemCategory.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          name,
          nameGujarati: dto.nameGujarati?.trim() || null,
        },
      });

      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "CATEGORY_CREATE",
          entityName: "ItemCategory",
          entityId: category.id,
          newState: category,
        });
      }

      return category;
    });
  }

  async findAll(ctx: TenantContext) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      return tx.itemCategory.findMany({
        where: { companyId: ctx.companyId },
        orderBy: { name: "asc" },
      });
    });
  }

  async findOne(ctx: TenantContext, id: string) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const category = await tx.itemCategory.findFirst({
        where: { id, companyId: ctx.companyId },
      });

      if (!category) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Item category with ID '${id}' not found.`,
          messageGujarati: `આઈડી '${id}' ધરાવતી કેટેગરી મળી નથી.`,
        });
      }

      return category;
    });
  }

  async update(
    ctx: TenantContext,
    id: string,
    dto: { name?: string; nameGujarati?: string },
  ) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const existing = await tx.itemCategory.findFirst({
        where: { id, companyId: ctx.companyId },
      });

      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Item category with ID '${id}' not found.`,
          messageGujarati: `આઈડી '${id}' ધરાવતી કેટેગરી મળી નથી.`,
        });
      }

      const updated = await tx.itemCategory.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(dto.nameGujarati !== undefined
            ? { nameGujarati: dto.nameGujarati ? dto.nameGujarati.trim() : null }
            : {}),
        },
      });

      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "CATEGORY_UPDATE",
          entityName: "ItemCategory",
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
      const existing = await tx.itemCategory.findFirst({
        where: { id, companyId: ctx.companyId },
      });

      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Item category with ID '${id}' not found.`,
          messageGujarati: `આઈડી '${id}' ધરાવતી કેટેગરી મળી નથી.`,
        });
      }

      await tx.itemCategory.delete({
        where: { id },
      });

      if (ctx.userId) {
        await this.audit.record({
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId,
          action: "CATEGORY_DELETE",
          entityName: "ItemCategory",
          entityId: id,
          previousState: existing,
        });
      }

      return { success: true };
    });
  }

  async bulkDelete(ctx: TenantContext, ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException("No category IDs provided for deletion.");
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

