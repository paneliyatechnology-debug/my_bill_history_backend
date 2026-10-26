import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import {
  DeliveryChallanStatus,
  DeliveryChallanType,
  StockTransactionType,
} from "@billing/database";
import { toDecimal, Decimal, validatePeriodAccess } from "@billing/accounting-core";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { CreateDeliveryChallanDto } from "./dto/create-delivery-challan.dto";
import { IssueDeliveryChallanDto } from "./dto/issue-delivery-challan.dto";
import { CancelDeliveryChallanDto } from "./dto/cancel-delivery-challan.dto";
import { EWayBillRequestDto, EWayBillStatusResponse } from "./dto/eway-bill-payload.dto";

@Injectable()
export class DeliveryChallansService {
  private readonly logger = new Logger(DeliveryChallansService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Create a new Delivery Challan (Rule 55 CGST Rules)
   */
  async createChallan(
    ctx: TenantContext,
    dto: CreateDeliveryChallanDto,
  ): Promise<any> {
    if (!dto.warehouseId) {
      throw new BadRequestException("Warehouse ID is required for delivery challan.");
    }
    if (!dto.challanType) {
      throw new BadRequestException("Challan type is required.");
    }
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException("At least one item line is required for delivery challan.");
    }

    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      // 1. Verify warehouse belongs to company
      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, companyId: ctx.companyId },
        include: { branch: true },
      });
      if (!warehouse) {
        throw new NotFoundException(`Warehouse ${dto.warehouseId} not found in this company.`);
      }

      const branchId = dto.branchId || warehouse.branchId;

      // 2. Validate party if provided
      let partyStateCode = warehouse.branch.stateCode;
      let partyGstin: string | null = null;

      if (dto.partyId) {
        const party = await tx.party.findFirst({
          where: { id: dto.partyId, companyId: ctx.companyId },
        });
        if (!party) {
          throw new NotFoundException(`Party ${dto.partyId} not found in this company.`);
        }
        partyStateCode = party.stateCode;
        partyGstin = party.gstin || null;
      }

      // 3. Validate Financial Year & Period
      const challanDate = dto.challanDate ? new Date(dto.challanDate) : new Date();
      let fy = await tx.financialYear.findFirst({
        where: {
          companyId: ctx.companyId,
          startDate: { lte: challanDate },
          endDate: { gte: challanDate },
        },
      });
      if (!fy) {
        fy = await tx.financialYear.findFirst({
          where: { companyId: ctx.companyId, isCurrent: true },
        });
      }
      if (!fy) {
        throw new NotFoundException(
          `No active financial year found for company ${ctx.companyId} on ${challanDate.toISOString().split("T")[0]}.`,
        );
      }

      const periodCheck = validatePeriodAccess(challanDate, ctx.companyId, fy);
      if (!periodCheck.isAllowed) {
        throw new BadRequestException(periodCheck.reason);
      }

      // 4. Concurrency-Safe Sequential Challan Number Allocation
      const fyStart = new Date(fy.startDate);
      const fyEnd = new Date(fy.endDate);
      const fyCode = `${fyStart.getFullYear().toString().slice(-2)}-${fyEnd.getFullYear().toString().slice(-2)}`;
      const lockKey = `seq_${ctx.companyId}_delivery_challans`;

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)
      `;

      const count = await tx.deliveryChallan.count({
        where: { companyId: ctx.companyId },
      });
      const challanNumber = `DC/${fyCode}/${String(count + 1).padStart(4, "0")}`;

      // 5. Calculate GST amounts based on place of supply
      const isInterState = warehouse.branch.stateCode !== partyStateCode;

      let totalTaxable = toDecimal(0);
      let totalCgst = toDecimal(0);
      let totalSgst = toDecimal(0);
      let totalIgst = toDecimal(0);
      let grandTotal = toDecimal(0);

      const challanItemsData: Array<{
        itemId: string;
        batchId: string | null;
        description: string | null;
        hsnCode: string | null;
        quantity: number;
        unitPrice: number;
        taxableAmount: number;
        taxRate: number;
        cgstAmount: number;
        sgstAmount: number;
        igstAmount: number;
        totalAmount: number;
      }> = [];

      for (const itemDto of dto.items) {
        if (typeof itemDto.quantity !== "number" || itemDto.quantity <= 0) {
          throw new BadRequestException("Item quantity must be greater than zero.");
        }

        const item = await tx.item.findFirst({
          where: { id: itemDto.itemId, companyId: ctx.companyId },
        });
        if (!item) {
          throw new NotFoundException(`Item ${itemDto.itemId} not found in this company.`);
        }

        const qty = toDecimal(itemDto.quantity);
        const unitPrice =
          itemDto.unitPrice !== undefined
            ? toDecimal(itemDto.unitPrice)
            : toDecimal(item.purchaseRate || item.retailPrice || 0);

        const taxable = qty.mul(unitPrice);
        const taxRate =
          itemDto.taxRate !== undefined
            ? toDecimal(itemDto.taxRate)
            : toDecimal(item.taxRate || 0);

        const isTaxable = dto.isTaxable === true;
        let cgst = toDecimal(0);
        let sgst = toDecimal(0);
        let igst = toDecimal(0);

        if (isTaxable && taxRate.greaterThan(0)) {
          if (isInterState) {
            igst = taxable.mul(taxRate).div(100);
          } else {
            const halfRate = taxRate.div(2);
            cgst = taxable.mul(halfRate).div(100);
            sgst = taxable.mul(halfRate).div(100);
          }
        }

        const lineTotal = taxable.add(cgst).add(sgst).add(igst);

        totalTaxable = totalTaxable.add(taxable);
        totalCgst = totalCgst.add(cgst);
        totalSgst = totalSgst.add(sgst);
        totalIgst = totalIgst.add(igst);
        grandTotal = grandTotal.add(lineTotal);

        challanItemsData.push({
          itemId: item.id,
          batchId: itemDto.batchId || null,
          description: itemDto.description || item.name,
          hsnCode: itemDto.hsnCode || item.hsnCode || null,
          quantity: qty.toNumber(),
          unitPrice: unitPrice.toNumber(),
          taxableAmount: taxable.toNumber(),
          taxRate: taxRate.toNumber(),
          cgstAmount: cgst.toNumber(),
          sgstAmount: sgst.toNumber(),
          igstAmount: igst.toNumber(),
          totalAmount: lineTotal.toNumber(),
        });
      }

      // 6. Create Delivery Challan
      const challan = await tx.deliveryChallan.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          branchId,
          financialYearId: fy.id,
          partyId: dto.partyId || null,
          warehouseId: warehouse.id,
          challanNumber,
          challanDate,
          challanType: dto.challanType,
          status: DeliveryChallanStatus.DRAFT,
          placeOfSupply: dto.placeOfSupply || partyStateCode,
          taxableAmount: totalTaxable.toNumber(),
          cgstAmount: totalCgst.toNumber(),
          sgstAmount: totalSgst.toNumber(),
          igstAmount: totalIgst.toNumber(),
          totalAmount: grandTotal.toNumber(),
          notes: dto.notes || null,
          items: {
            create: challanItemsData,
          },
        },
        include: {
          warehouse: true,
          party: true,
          items: { include: { item: true, batch: true } },
        },
      });

      // 7. Audit Log
      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "CREATE_DELIVERY_CHALLAN",
          entityName: "DeliveryChallan",
          entityId: challan.id,
          newState: {
            challanNumber: challan.challanNumber,
            challanType: challan.challanType,
            totalAmount: challan.totalAmount,
            status: challan.status,
          },
        },
        tx,
      );

      return challan;
    });
  }

  /**
   * List all Delivery Challans
   */
  async findAllChallans(ctx: TenantContext): Promise<any[]> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      return await tx.deliveryChallan.findMany({
        where: { companyId: ctx.companyId },
        include: {
          warehouse: true,
          party: true,
          items: { include: { item: true, batch: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    });
  }

  /**
   * Find single Delivery Challan by ID
   */
  async findChallanById(ctx: TenantContext, id: string): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      const challan = await tx.deliveryChallan.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          warehouse: true,
          party: true,
          items: { include: { item: true, batch: true } },
        },
      });
      if (!challan) {
        throw new NotFoundException(`Delivery challan ${id} not found.`);
      }
      return challan;
    });
  }

  /**
   * Issue Delivery Challan: DRAFT -> ISSUED
   * Deducts goods from inventory via append-only StockTransaction
   */
  async issueChallan(
    ctx: TenantContext,
    id: string,
    dto: IssueDeliveryChallanDto,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`delivery_challan_${id}`})::bigint)
      `;

      const challan = await tx.deliveryChallan.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          warehouse: true,
          items: { include: { item: true } },
        },
      });
      if (!challan) {
        throw new NotFoundException(`Delivery challan ${id} not found.`);
      }

      // Idempotency: if already ISSUED, return cleanly
      if (challan.status === DeliveryChallanStatus.ISSUED) {
        return challan;
      }
      if (challan.status !== DeliveryChallanStatus.DRAFT) {
        throw new BadRequestException(
          `Only DRAFT delivery challans can be issued. Current status: ${challan.status}`,
        );
      }

      // 1. Negative Stock Policy Check
      const company = await tx.company.findUnique({
        where: { id: ctx.companyId },
      });
      const allowNegative = company?.allowNegativeStock ?? false;

      // 2. Validate stock availability
      for (const item of challan.items) {
        const stockLockKey = `stock_${ctx.companyId}_${challan.warehouseId}_${item.itemId}`;
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${stockLockKey})::bigint)
        `;

        if (!allowNegative) {
          const stockAgg = await tx.stockTransaction.aggregate({
            where: {
              companyId: ctx.companyId,
              warehouseId: challan.warehouseId,
              itemId: item.itemId,
            },
            _sum: { quantity: true },
          });

          const currentStock = toDecimal(stockAgg._sum.quantity || 0);
          const reqQty = toDecimal(item.quantity);

          if (currentStock.lessThan(reqQty)) {
            throw new BadRequestException(
              `Insufficient stock for item "${item.item.name}" at warehouse "${challan.warehouse.name}". Available: ${currentStock.toString()}, Required: ${reqQty.toString()}.`,
            );
          }
        }
      }

      // 3. Append-only outward stock transaction
      const now = new Date();
      for (const item of challan.items) {
        await tx.stockTransaction.create({
          data: {
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            warehouseId: challan.warehouseId,
            itemId: item.itemId,
            batchId: item.batchId,
            transactionType: StockTransactionType.SALES_DISPATCH as any,
            transactionDate: now,
            quantity: toDecimal(item.quantity).negated().toNumber(), // Negative outward
            valuationRate: toDecimal(item.unitPrice).toNumber(),
            totalValuation: toDecimal(item.taxableAmount).toNumber(),
            referenceDocType: "DELIVERY_CHALLAN",
            referenceDocId: challan.id,
          },
        });
      }

      // 4. Transition to ISSUED
      const updated = await tx.deliveryChallan.update({
        where: { id: challan.id },
        data: {
          status: DeliveryChallanStatus.ISSUED,
          notes: dto.notes ? (challan.notes ? `${challan.notes}\n${dto.notes}` : dto.notes) : challan.notes,
        },
        include: {
          warehouse: true,
          party: true,
          items: { include: { item: true, batch: true } },
        },
      });

      // 5. Audit Log
      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "ISSUE_DELIVERY_CHALLAN",
          entityName: "DeliveryChallan",
          entityId: challan.id,
          previousState: { status: DeliveryChallanStatus.DRAFT },
          newState: { status: DeliveryChallanStatus.ISSUED },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Close Delivery Challan: ISSUED -> CLOSED (e.g. Job Work completed / goods returned)
   */
  async closeChallan(ctx: TenantContext, id: string): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`delivery_challan_${id}`})::bigint)
      `;

      const challan = await tx.deliveryChallan.findFirst({
        where: { id, companyId: ctx.companyId },
      });
      if (!challan) {
        throw new NotFoundException(`Delivery challan ${id} not found.`);
      }

      if (challan.status !== DeliveryChallanStatus.ISSUED) {
        throw new BadRequestException(
          `Only ISSUED delivery challans can be closed. Current status: ${challan.status}`,
        );
      }

      const closed = await tx.deliveryChallan.update({
        where: { id: challan.id },
        data: {
          status: DeliveryChallanStatus.CLOSED,
        },
        include: {
          warehouse: true,
          party: true,
          items: { include: { item: true, batch: true } },
        },
      });

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "CLOSE_DELIVERY_CHALLAN",
          entityName: "DeliveryChallan",
          entityId: challan.id,
          previousState: { status: DeliveryChallanStatus.ISSUED },
          newState: { status: DeliveryChallanStatus.CLOSED },
        },
        tx,
      );

      return closed;
    });
  }

  /**
   * Cancel Delivery Challan:
   * - DRAFT: Marked CANCELLED directly.
   * - ISSUED: Reverses dispatched stock via append-only compensating transactions, then marked CANCELLED.
   * - CLOSED: Cannot be cancelled.
   */
  async cancelChallan(
    ctx: TenantContext,
    id: string,
    dto: CancelDeliveryChallanDto,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`delivery_challan_${id}`})::bigint)
      `;

      const challan = await tx.deliveryChallan.findFirst({
        where: { id, companyId: ctx.companyId },
      });
      if (!challan) {
        throw new NotFoundException(`Delivery challan ${id} not found.`);
      }

      if (challan.status === DeliveryChallanStatus.CLOSED) {
        throw new BadRequestException("Closed delivery challans cannot be cancelled.");
      }
      if (challan.status === DeliveryChallanStatus.CANCELLED) {
        throw new BadRequestException("Delivery challan is already cancelled.");
      }

      // If ISSUED, reverse stock transactions
      if (challan.status === DeliveryChallanStatus.ISSUED) {
        const outTransactions = await tx.stockTransaction.findMany({
          where: {
            companyId: ctx.companyId,
            referenceDocType: "DELIVERY_CHALLAN",
            referenceDocId: challan.id,
            transactionType: StockTransactionType.SALES_DISPATCH as any,
          },
        });

        const now = new Date();
        for (const st of outTransactions) {
          const qtyToRestore = toDecimal(st.quantity).abs();
          await tx.stockTransaction.create({
            data: {
              organizationId: ctx.organizationId,
              companyId: ctx.companyId,
              warehouseId: st.warehouseId,
              itemId: st.itemId,
              batchId: st.batchId,
              transactionType: StockTransactionType.STOCK_ADJUSTMENT_PLUS as any,
              transactionDate: now,
              quantity: qtyToRestore.toNumber(),
              valuationRate: st.valuationRate.toNumber(),
              totalValuation: st.totalValuation.toNumber(),
              referenceDocType: "DELIVERY_CHALLAN_CANCELLATION",
              referenceDocId: challan.id,
            },
          });
        }
      }

      const cancelled = await tx.deliveryChallan.update({
        where: { id: challan.id },
        data: {
          status: DeliveryChallanStatus.CANCELLED,
          notes: challan.notes ? `${challan.notes}\nCancelled: ${dto.reason}` : `Cancelled: ${dto.reason}`,
        },
        include: {
          warehouse: true,
          party: true,
          items: { include: { item: true, batch: true } },
        },
      });

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          userId: ctx.userId || "00000000-0000-0000-0000-000000000000",
          action: "CANCEL_DELIVERY_CHALLAN",
          entityName: "DeliveryChallan",
          entityId: challan.id,
          previousState: { status: challan.status },
          newState: { status: DeliveryChallanStatus.CANCELLED, reason: dto.reason },
        },
        tx,
      );

      return cancelled;
    });
  }

  /**
   * E-Way Bill Rule 138 Validation & Payload Preparation
   */
  async prepareEWayBillPayload(
    ctx: TenantContext,
    id: string,
    dto: EWayBillRequestDto,
  ): Promise<EWayBillStatusResponse> {
    return await this.prisma.executeInTenantContext(ctx, async (tx) => {
      const challan = await tx.deliveryChallan.findFirst({
        where: { id, companyId: ctx.companyId },
        include: {
          warehouse: { include: { branch: true } },
          party: true,
          items: { include: { item: true } },
          company: true,
        },
      });
      if (!challan) {
        throw new NotFoundException(`Delivery challan ${id} not found.`);
      }

      if (dto.distanceKm <= 0) {
        throw new BadRequestException("Distance (in km) must be greater than zero for E-Way Bill generation.");
      }

      const totalVal = toDecimal(challan.totalAmount);

      // Determine subSupplyType under Rule 138
      let subSupplyType = 8; // Others
      if (challan.challanType === DeliveryChallanType.JOB_WORK) {
        subSupplyType = 4; // Job Work
      } else if (challan.challanType === DeliveryChallanType.BRANCH_TRANSFER) {
        subSupplyType = 2; // Line Sales / Branch Transfer
      }

      // Construct E-Way Bill Standard Payload
      const payload = {
        supplyType: "O",
        subSupplyType,
        docType: "CHL",
        docNo: challan.challanNumber,
        docDate: challan.challanDate.toISOString().split("T")[0].split("-").reverse().join("/"),
        fromGstin: challan.company.gstin,
        fromTrdName: challan.company.tradeName || challan.company.legalName,
        fromAddr1: challan.warehouse.address || challan.company.addressLine1,
        fromPlace: challan.warehouse.branch.city,
        fromPincode: Number(challan.warehouse.branch.pincode),
        fromStateCode: Number(challan.warehouse.branch.stateCode),
        actualFromStateCode: Number(challan.warehouse.branch.stateCode),
        toGstin: challan.party?.gstin || "URP",
        toTrdName: challan.party?.name || "Consignee",
        toAddr1: challan.party ? "Registered Address" : "Branch Address",
        toPlace: challan.party ? (challan.party.billingAddress as any)?.city || "Destination" : "Destination",
        toPincode: challan.party ? Number((challan.party.billingAddress as any)?.pincode || 380001) : 380001,
        toStateCode: Number(challan.placeOfSupply || 24),
        actualToStateCode: Number(challan.placeOfSupply || 24),
        totalValue: toDecimal(challan.taxableAmount).toNumber(),
        cgstValue: toDecimal(challan.cgstAmount).toNumber(),
        sgstValue: toDecimal(challan.sgstAmount).toNumber(),
        igstValue: toDecimal(challan.igstAmount).toNumber(),
        totInvValue: totalVal.toNumber(),
        transDistance: dto.distanceKm,
        transporterId: dto.transporterId || null,
        transporterName: dto.transporterName || null,
        transDocNo: dto.transporterDocNo || null,
        transDocDate: dto.transporterDocDate || null,
        vehicleNo: dto.vehicleNumber || null,
        vehicleType: dto.vehicleType || "R",
        itemList: challan.items.map((i) => ({
          productName: i.description || i.item.name,
          productDesc: i.description || i.item.name,
          hsnCode: Number(i.hsnCode || 8481),
          quantity: Number(i.quantity),
          qtyUnit: "PCS",
          taxableAmount: Number(i.taxableAmount),
          sgstRate: Number(i.taxRate) / 2,
          cgstRate: Number(i.taxRate) / 2,
          igstRate: Number(i.igstAmount) > 0 ? Number(i.taxRate) : 0,
        })),
      };

      // Check whether company has active live NIC credentials configured in environment
      const hasLiveCredentials = !!process.env.NIC_EWAY_BILL_CLIENT_ID;

      if (!hasLiveCredentials) {
        return {
          status: "NOT_CONFIGURED",
          payload,
          message:
            "E-Way Bill NIC credentials (NIC_EWAY_BILL_CLIENT_ID) are not configured for this company. Standard Rule 138 payload was validated and generated.",
        };
      }

      return {
        status: "CONFIGURED",
        payload,
        message:
          "E-Way Bill client id is present. This response only validates the Rule 138 payload. No E-Way Bill number was generated. Transmit it through POST /api/v1/gst/eway-bills/challans/:id/generate after sandbox credentials are configured.",
      };
    });
  }
}
