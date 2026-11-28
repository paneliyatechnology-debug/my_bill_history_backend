import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import { DatabaseService } from "../database/database.service";

export interface PurchaseOrderItemInput {
  itemId?: string;
  name: string;
  hsnCode?: string;
  unit?: string;
  quantity: number | string;
  rate: number | string;
  discountPercent?: number | string;
  taxRate?: number | string;
  taxableAmount?: number | string;
  totalAmount?: number | string;
}

export interface CreatePurchaseOrderDto {
  orderNumber?: string;
  orderDate: string;
  validTill?: string;
  partyId: string;
  status?: string;
  placeOfSupply?: string;
  taxableAmount?: number | string;
  cgstAmount?: number | string;
  sgstAmount?: number | string;
  igstAmount?: number | string;
  freightAmount?: number | string;
  overallDiscount?: number | string;
  additionalCharges?: any[];
  grandTotal?: number | string;
  notes?: string;
  termsAndConditions?: string;
  items: PurchaseOrderItemInput[];
}

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: DatabaseService) {}

  private requireCompany(tenant: TenantContext): string {
    if (!tenant?.companyId || !tenant?.organizationId) {
      throw new BadRequestException("Active company context is required.");
    }
    return tenant.companyId;
  }

  private mapOrder(order: any) {
    return {
      ...order,
      taxableAmount: Number(order.taxableAmount || 0),
      cgstAmount: Number(order.cgstAmount || 0),
      sgstAmount: Number(order.sgstAmount || 0),
      igstAmount: Number(order.igstAmount || 0),
      freightAmount: Number(order.freightAmount || 0),
      overallDiscount: Number(order.overallDiscount || 0),
      grandTotal: Number(order.grandTotal || 0),
      items: (order.items || []).map((it: any) => ({
        ...it,
        quantity: Number(it.quantity || 0),
        rate: Number(it.rate || 0),
        discountPercent: Number(it.discountPercent || 0),
        taxRate: Number(it.taxRate || 0),
        taxableAmount: Number(it.taxableAmount || 0),
        totalAmount: Number(it.totalAmount || 0),
      })),
    };
  }

  async list(
    tenant: TenantContext,
    query?: { status?: string; search?: string; page?: number; limit?: number },
  ) {
    const companyId = this.requireCompany(tenant);
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query?.limit) || 50));

    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const where: any = { companyId };
      if (query?.status && query.status !== "ALL") {
        where.status = query.status;
      }
      if (query?.search?.trim()) {
        const q = query.search.trim();
        where.OR = [
          { orderNumber: { contains: q, mode: "insensitive" } },
          { party: { name: { contains: q, mode: "insensitive" } } },
        ];
      }

      const [total, rows] = await Promise.all([
        tx.purchaseOrder.count({ where }),
        tx.purchaseOrder.findMany({
          where,
          include: {
            party: { select: { id: true, name: true, phone: true, gstin: true } },
            items: true,
          },
          orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      return {
        items: rows.map((r: any) => this.mapOrder(r)),
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      };
    });
  }

  async getById(id: string, tenant: TenantContext) {
    const companyId = this.requireCompany(tenant);
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const order = await tx.purchaseOrder.findFirst({
        where: { id, companyId },
        include: {
          party: { select: { id: true, name: true, phone: true, gstin: true, stateCode: true } },
          items: true,
        },
      });
      if (!order) {
        throw new NotFoundException("Purchase order not found.");
      }
      return this.mapOrder(order);
    });
  }

  async create(dto: CreatePurchaseOrderDto, tenant: TenantContext) {
    const companyId = this.requireCompany(tenant);
    if (!dto.partyId) {
      throw new BadRequestException("Supplier partyId is required.");
    }
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException("At least one purchase order item is required.");
    }

    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const party = await tx.party.findFirst({
        where: { id: dto.partyId, companyId },
        select: { id: true },
      });
      if (!party) {
        throw new BadRequestException("Invalid supplier party for this company.");
      }

      const orderNumber =
        dto.orderNumber?.trim() ||
        `PO-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

      const existing = await tx.purchaseOrder.findFirst({
        where: { companyId, orderNumber },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(`Purchase order number ${orderNumber} already exists.`);
      }

      const validItemIds = new Set<string>();
      const requestedIds = dto.items
        .map((it) => it.itemId)
        .filter((id): id is string => Boolean(id));
      if (requestedIds.length > 0) {
        const dbItems = await tx.item.findMany({
          where: { id: { in: requestedIds }, companyId },
          select: { id: true },
        });
        dbItems.forEach((i: any) => validItemIds.add(i.id));
      }

      const orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date();
      const validTill = dto.validTill ? new Date(dto.validTill) : null;

      const created = await tx.purchaseOrder.create({
        data: {
          organizationId: tenant.organizationId,
          companyId,
          branchId: tenant.branchId || null,
          financialYearId: tenant.financialYearId || null,
          partyId: dto.partyId,
          orderNumber,
          orderDate: isNaN(orderDate.getTime()) ? new Date() : orderDate,
          validTill: validTill && !isNaN(validTill.getTime()) ? validTill : null,
          status: dto.status || "OPEN",
          placeOfSupply: dto.placeOfSupply || null,
          taxableAmount: Number(dto.taxableAmount || 0),
          cgstAmount: Number(dto.cgstAmount || 0),
          sgstAmount: Number(dto.sgstAmount || 0),
          igstAmount: Number(dto.igstAmount || 0),
          freightAmount: Number(dto.freightAmount || 0),
          overallDiscount: Number(dto.overallDiscount || 0),
          additionalCharges: dto.additionalCharges || [],
          grandTotal: Number(dto.grandTotal || 0),
          notes: dto.notes?.trim() || null,
          termsAndConditions: dto.termsAndConditions?.trim() || null,
          createdBy: tenant.userId || null,
          items: {
            create: dto.items.map((it) => ({
              itemId: it.itemId && validItemIds.has(it.itemId) ? it.itemId : null,
              name: it.name || "Item",
              hsnCode: it.hsnCode || null,
              unit: it.unit || null,
              quantity: Math.max(0.0001, Number(it.quantity) || 1),
              rate: Math.max(0, Number(it.rate) || 0),
              discountPercent: Math.max(0, Number(it.discountPercent) || 0),
              taxRate: Math.max(0, Number(it.taxRate) || 0),
              taxableAmount: Number(it.taxableAmount || 0),
              totalAmount: Number(it.totalAmount || 0),
            })),
          },
        },
        include: {
          party: { select: { id: true, name: true, phone: true, gstin: true } },
          items: true,
        },
      });

      return this.mapOrder(created);
    });
  }

  async update(id: string, dto: Partial<CreatePurchaseOrderDto>, tenant: TenantContext) {
    const companyId = this.requireCompany(tenant);
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({
        where: { id, companyId },
      });
      if (!existing) {
        throw new NotFoundException("Purchase order not found.");
      }
      if (existing.status === "CANCELLED" || existing.status === "CONVERTED") {
        throw new BadRequestException(
          `Cannot edit a purchase order in ${existing.status} state.`,
        );
      }

      if (dto.partyId) {
        const party = await tx.party.findFirst({
          where: { id: dto.partyId, companyId },
          select: { id: true },
        });
        if (!party) {
          throw new BadRequestException("Invalid supplier party for this company.");
        }
      }

      if (dto.orderNumber && dto.orderNumber.trim() !== existing.orderNumber) {
        const dup = await tx.purchaseOrder.findFirst({
          where: {
            companyId,
            orderNumber: dto.orderNumber.trim(),
            id: { not: id },
          },
          select: { id: true },
        });
        if (dup) {
          throw new ConflictException(
            `Purchase order number ${dto.orderNumber.trim()} already exists.`,
          );
        }
      }

      const validItemIds = new Set<string>();
      if (dto.items && Array.isArray(dto.items)) {
        const requestedIds = dto.items
          .map((it) => it.itemId)
          .filter((itemId): itemId is string => Boolean(itemId));
        if (requestedIds.length > 0) {
          const dbItems = await tx.item.findMany({
            where: { id: { in: requestedIds }, companyId },
            select: { id: true },
          });
          dbItems.forEach((i: any) => validItemIds.add(i.id));
        }
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      }

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(dto.partyId ? { partyId: dto.partyId } : {}),
          ...(dto.orderNumber ? { orderNumber: dto.orderNumber.trim() } : {}),
          ...(dto.orderDate ? { orderDate: new Date(dto.orderDate) } : {}),
          ...(dto.validTill !== undefined
            ? { validTill: dto.validTill ? new Date(dto.validTill) : null }
            : {}),
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.placeOfSupply !== undefined ? { placeOfSupply: dto.placeOfSupply } : {}),
          ...(dto.taxableAmount !== undefined ? { taxableAmount: Number(dto.taxableAmount || 0) } : {}),
          ...(dto.cgstAmount !== undefined ? { cgstAmount: Number(dto.cgstAmount || 0) } : {}),
          ...(dto.sgstAmount !== undefined ? { sgstAmount: Number(dto.sgstAmount || 0) } : {}),
          ...(dto.igstAmount !== undefined ? { igstAmount: Number(dto.igstAmount || 0) } : {}),
          ...(dto.freightAmount !== undefined ? { freightAmount: Number(dto.freightAmount || 0) } : {}),
          ...(dto.overallDiscount !== undefined ? { overallDiscount: Number(dto.overallDiscount || 0) } : {}),
          ...(dto.additionalCharges !== undefined ? { additionalCharges: dto.additionalCharges } : {}),
          ...(dto.grandTotal !== undefined ? { grandTotal: Number(dto.grandTotal || 0) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
          ...(dto.termsAndConditions !== undefined
            ? { termsAndConditions: dto.termsAndConditions?.trim() || null }
            : {}),
          ...(dto.items && Array.isArray(dto.items)
            ? {
                items: {
                  create: dto.items.map((it) => ({
                    itemId: it.itemId && validItemIds.has(it.itemId) ? it.itemId : null,
                    name: it.name || "Item",
                    hsnCode: it.hsnCode || null,
                    unit: it.unit || null,
                    quantity: Math.max(0.0001, Number(it.quantity) || 1),
                    rate: Math.max(0, Number(it.rate) || 0),
                    discountPercent: Math.max(0, Number(it.discountPercent) || 0),
                    taxRate: Math.max(0, Number(it.taxRate) || 0),
                    taxableAmount: Number(it.taxableAmount || 0),
                    totalAmount: Number(it.totalAmount || 0),
                  })),
                },
              }
            : {}),
        },
        include: {
          party: { select: { id: true, name: true, phone: true, gstin: true } },
          items: true,
        },
      });

      return this.mapOrder(updated);
    });
  }

  async updateStatus(id: string, status: string, tenant: TenantContext) {
    const companyId = this.requireCompany(tenant);
    const allowed = new Set(["OPEN", "CLOSED", "CANCELLED", "CONVERTED"]);
    const nextStatus = String(status || "").toUpperCase();
    if (!allowed.has(nextStatus)) {
      throw new BadRequestException(`Invalid purchase order status: ${status}`);
    }
    const validTransitions: Record<string, Set<string>> = {
      OPEN: new Set(["OPEN", "CLOSED", "CANCELLED", "CONVERTED"]),
      CLOSED: new Set(["CLOSED", "OPEN", "CANCELLED"]),
      CANCELLED: new Set(["CANCELLED"]),
      CONVERTED: new Set(["CONVERTED"]),
    };
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({ where: { id, companyId } });
      if (!existing) throw new NotFoundException("Purchase order not found.");
      const allowedNext = validTransitions[existing.status] || new Set<string>();
      if (!allowedNext.has(nextStatus)) {
        throw new BadRequestException(
          `Invalid state transition from ${existing.status} to ${nextStatus}.`,
        );
      }
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: nextStatus },
        include: {
          party: { select: { id: true, name: true, phone: true, gstin: true } },
          items: true,
        },
      });
      return this.mapOrder(updated);
    });
  }

  async remove(id: string, tenant: TenantContext) {
    const companyId = this.requireCompany(tenant);
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const existing = await tx.purchaseOrder.findFirst({ where: { id, companyId } });
      if (!existing) throw new NotFoundException("Purchase order not found.");
      await tx.purchaseOrder.delete({ where: { id } });
      return { deleted: true, id };
    });
  }

  async migrateLocal(orders: CreatePurchaseOrderDto[], tenant: TenantContext) {
    const companyId = this.requireCompany(tenant);
    const results = { migrated: 0, skipped: 0, errors: [] as string[] };
    for (const o of orders || []) {
      try {
        if (!o.partyId || !o.orderNumber) {
          results.skipped++;
          continue;
        }
        const exists = await this.prisma.executeInTenantContext(tenant, async (tx) =>
          tx.purchaseOrder.findFirst({
            where: { companyId, orderNumber: o.orderNumber!.trim() },
            select: { id: true },
          }),
        );
        if (exists) {
          results.skipped++;
          continue;
        }
        await this.create(o, tenant);
        results.migrated++;
      } catch (err: any) {
        results.errors.push(`${o.orderNumber || "PO"}: ${err?.message || "Migration failed"}`);
      }
    }
    return results;
  }
}
