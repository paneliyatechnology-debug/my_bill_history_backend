import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
  Logger,
} from "@nestjs/common";
import {
  TenantContext,
  InvoiceCategory,
  InvoiceStatus,
  PaymentMode,
  StockTransactionType,
  VoucherType,
  AccountNature,
} from "@billing/shared-types";
import {
  Decimal,
  toDecimal,
  toMoney,
  calculateSalesInvoiceTaxes,
  validateJournalLines,
  validatePeriodAccess,
  buildReversalVoucherPlan,
  applyTransactionToBalance,
  costMovingAverageIssue,
} from "@billing/accounting-core";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { LedgersService } from "../ledgers/ledgers.service";
import {
  CreateSalesInvoiceDto,
  CreateSalesInvoiceItemDto,
} from "./dto/create-sales-invoice.dto";
import { PosCheckoutDto } from "./dto/pos-checkout.dto";
import { PosSyncDto } from "./dto/pos-sync.dto";
import { CancelInvoiceDto } from "./dto/cancel-invoice.dto";
import { QueryInvoicesDto } from "./dto/query-invoices.dto";
import { RecordInvoicePaymentDto } from "./dto/record-payment.dto";
import { QueryStockTransactionsDto } from "./dto/query-stock.dto";
import { CreateSalesReturnDto } from "./dto/create-sales-return.dto";
import { QuerySalesReturnsDto } from "./dto/query-sales-returns.dto";
import { buildInvoiceUrls } from "../invoice-print/invoice-url.helper";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationType } from "@prisma/client";

function parseStartOfDay(dateStr?: string): Date | undefined {
  if (!dateStr) return undefined;
  if (dateStr.includes("T")) return new Date(dateStr);
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function parseEndOfDay(dateStr?: string): Date | undefined {
  if (!dateStr) return undefined;
  if (dateStr.includes("T")) return new Date(dateStr);
  return new Date(`${dateStr}T23:59:59.999Z`);
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(id?: string | null): boolean {
  return typeof id === "string" && UUID_REGEX.test(id.trim());
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
    private readonly ledgersService: LedgersService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Concurrency-safe, idempotent creation of sales invoice with atomic inventory dispatch
   * and double-entry general ledger voucher posting.
   */
  async createSalesInvoice(
    dto: CreateSalesInvoiceDto,
    tenant: TenantContext,
    idempotencyKey?: string,
  ): Promise<any> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        "Invoice must contain at least one line item.",
      );
    }

    const offlineUuid = dto.clientOfflineUuid || idempotencyKey || null;

    try {
      const result = await this.prisma.executeInTenantContext(tenant, async (tx) => {
        // 1. Idempotency Check: return existing invoice if clientOfflineUuid already processed
        if (offlineUuid) {
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(hashtext(${`idemp_${tenant.companyId}_${offlineUuid}`})::bigint)
          `;

          const existingInvoice = await tx.salesInvoice.findFirst({
            where: {
              companyId: tenant.companyId,
              clientOfflineUuid: offlineUuid,
            },
            include: {
              items: true,
              party: true,
            },
          });
          if (existingInvoice) {
            this.assertMatchingIdempotentSale(existingInvoice, dto);

            const voucher = await tx.voucher.findFirst({
              where: {
                companyId: tenant.companyId,
                sourceDocument: "SALES_INVOICE",
                sourceEntityId: existingInvoice.id,
                isCancelled: false,
              },
            });

            return {
              ...existingInvoice,
              voucher: voucher
                ? {
                    id: voucher.id,
                    voucherNumber: voucher.voucherNumber,
                    balanced: true,
                  }
                : null,
            };
          }
        }

        // 2. Fetch Company details (stateCode, allowNegativeStock, etc.)
        const company = await tx.company.findUnique({
          where: { id: tenant.companyId },
        });
        if (!company) {
          throw new NotFoundException(`Company ${tenant.companyId} not found.`);
        }

        // 3. Resolve and Validate Financial Year & Period Lock
        const invoiceDate = dto.invoiceDate
          ? new Date(dto.invoiceDate)
          : new Date();
        let fy = await tx.financialYear.findFirst({
          where: {
            companyId: tenant.companyId,
            startDate: { lte: invoiceDate },
            endDate: { gte: invoiceDate },
          },
        });
        if (!fy) {
          // Fallback to current financial year
          fy = await tx.financialYear.findFirst({
            where: { companyId: tenant.companyId, isCurrent: true },
          });
        }
        if (!fy) {
          throw new NotFoundException(
            `No open financial year found for company ${tenant.companyId} on ${invoiceDate.toISOString().split("T")[0]}.`,
          );
        }

        const periodCheck = validatePeriodAccess(
          invoiceDate,
          tenant.companyId,
          fy,
        );
        if (!periodCheck.isAllowed) {
          throw new BadRequestException(periodCheck.reason);
        }

        // 4. Resolve Branch
        let branchId = dto.branchId || tenant.branchId || null;
        if (!branchId) {
          const branch = await tx.branch.findFirst({
            where: { companyId: tenant.companyId },
          });
          branchId = branch ? branch.id : null;
        }
        if (!branchId) {
          throw new BadRequestException(
            "No valid branch found for sales invoice.",
          );
        }

        // 5. Resolve or Create Party
        let party: any;
        if (dto.partyId) {
          if (!isValidUuid(dto.partyId)) {
            throw new BadRequestException({
              statusCode: 400,
              message: `Invalid partyId "${dto.partyId}". Must be a valid UUID. Please use real party IDs from GET /api/v1/parties.`,
              messageGujarati: `અમાન્ય Party ID "${dto.partyId}". માન્ય UUID હોવું જરૂરી છે. તમારા સાચા Parties માટે GET /api/v1/parties જુઓ.`,
            });
          }
          party = await tx.party.findFirst({
            where: { id: dto.partyId, companyId: tenant.companyId },
            include: { ledgerAccount: true },
          });
          if (!party) {
            throw new NotFoundException(
              `Party ${dto.partyId} not found in this company.`,
            );
          }
          if (!party.isActive) {
            throw new BadRequestException(`Party "${party.name}" is inactive.`);
          }
        } else if (dto.customerPhone || dto.customerName) {
          const phone = dto.customerPhone?.trim() || "9999999999";
          const name = dto.customerName?.trim() || "Retail Cash Customer";
          party = await tx.party.findFirst({
            where: { companyId: tenant.companyId, phone },
            include: { ledgerAccount: true },
          });
          if (!party) {
            party = await tx.party.create({
              data: {
                organizationId: tenant.organizationId,
                companyId: tenant.companyId,
                type: "CUSTOMER",
                name,
                phone,
                stateCode: company.stateCode || "24",
                billingAddress: {
                  city: company.city || "Ahmedabad",
                  pincode: company.pincode || "380001",
                },
                isActive: true,
              },
              include: { ledgerAccount: true },
            });
          }
        } else {
          // Walk-in retail customer fallback
          party = await tx.party.findFirst({
            where: {
              companyId: tenant.companyId,
              name: "Walk-in Retail Cash Customer",
            },
            include: { ledgerAccount: true },
          });
          if (!party) {
            party = await tx.party.create({
              data: {
                organizationId: tenant.organizationId,
                companyId: tenant.companyId,
                type: "CUSTOMER",
                name: "Walk-in Retail Cash Customer",
                nameGujarati: "રિટેલ રોકડ ગ્રાહક",
                phone: "9999999999",
                stateCode: company.stateCode,
                billingAddress: {
                  city: company.city,
                  pincode: company.pincode,
                },
                isActive: true,
              },
              include: { ledgerAccount: true },
            });
          }
        }

        // 6. Resolve Items & Check Stock
        if (!dto.items || !Array.isArray(dto.items) || dto.items.length === 0) {
          throw new BadRequestException("At least one item is required in the invoice.");
        }
        for (const line of dto.items) {
          if (!isValidUuid(line.itemId)) {
            throw new BadRequestException({
              statusCode: 400,
              message: `Invalid itemId "${line.itemId}". It must be a valid 36-character UUID. Do not use placeholder strings like "clyitem...". Please fetch real item IDs using GET /api/v1/items.`,
              messageGujarati: `અમાન્ય Item ID "${line.itemId}". માન્ય UUID આપવો જરૂરી છે. તમારી કંપનીના સાચા Items મેળવવા માટે GET /api/v1/items API નો ઉપયોગ કરો.`,
            });
          }
        }
        const itemIds = dto.items.map((i) => i.itemId);
        const items = await tx.item.findMany({
          where: {
            id: { in: itemIds },
            companyId: tenant.companyId,
          },
        });
        if (items.length !== new Set(itemIds).size) {
          throw new BadRequestException(
            "One or more referenced items do not exist in this company.",
          );
        }
        const itemMap = new Map(items.map((i) => [i.id, i]));
        for (const line of dto.items) {
          const it = itemMap.get(line.itemId)!;
          if (!it.isActive) {
            throw new BadRequestException(`Item "${it.name}" is inactive.`);
          }
          if (Number(line.quantity) <= 0) {
            throw new BadRequestException(
              `Quantity for "${it.name}" must be greater than zero.`,
            );
          }
        }

        const isDraft =
          dto.isDraft === true ||
          dto.status === InvoiceStatus.DRAFT ||
          dto.category === InvoiceCategory.PROFORMA_INVOICE;

        // 7. Resolve Warehouse for physical items
        const hasPhysicalItems = dto.items.some(
          (i) => itemMap.get(i.itemId)?.type !== "SERVICE",
        );
        let warehouse: any = null;
        if (hasPhysicalItems) {
          if (dto.warehouseId && isValidUuid(dto.warehouseId)) {
            warehouse = await tx.warehouse.findFirst({
              where: { id: dto.warehouseId, companyId: tenant.companyId },
            });
          }
          if (!warehouse) {
            warehouse = await tx.warehouse.findFirst({
              where: { companyId: tenant.companyId },
            });
          }
          if (!warehouse) {
            warehouse = await tx.warehouse.create({
              data: {
                organizationId: tenant.organizationId,
                companyId: tenant.companyId,
                branchId,
                name: "Main Warehouse",
                isDefault: true,
              },
            });
          }
          if (!warehouse) {
            throw new BadRequestException(
              "No valid warehouse found for physical stock dispatch.",
            );
          }

          // Validate stock levels if negative stock is disallowed (and not a draft)
          if (!isDraft && !company.allowNegativeStock) {
            for (const line of dto.items) {
              const it = itemMap.get(line.itemId)!;
              if (it.type === "SERVICE") continue;

              const stockLockKey = `stock_${tenant.companyId}_${warehouse.id}_${it.id}`;
              await tx.$executeRaw`
              SELECT pg_advisory_xact_lock(hashtext(${stockLockKey})::bigint)
            `;

              const stockAgg = await tx.stockTransaction.aggregate({
                where: {
                  companyId: tenant.companyId,
                  warehouseId: warehouse.id,
                  itemId: it.id,
                },
                _sum: {
                  quantity: true,
                },
              });
              const currentStock = toDecimal(stockAgg._sum.quantity || 0);
              const reqQty = toDecimal(line.quantity);
              if (currentStock.lessThan(reqQty)) {
                throw new BadRequestException(
                  `Insufficient stock for item "${it.name}". Available: ${currentStock.toString()}, Requested: ${reqQty.toString()}.`,
                );
              }
            }
          }
        }

        const category = dto.category || InvoiceCategory.TAX_INVOICE;
        let invoiceNumber: string;

        if (isDraft) {
          if (dto.invoiceNumber && dto.invoiceNumber.trim() !== "") {
            invoiceNumber = dto.invoiceNumber.trim();
          } else {
            invoiceNumber = `DFT-${Date.now().toString(36).toUpperCase()}-${Math.floor(
              Math.random() * 1000,
            )
              .toString()
              .padStart(3, "0")}`;
          }
        } else {
          // 8. Concurrency-Safe Legal Invoice Numbering using Transaction Advisory Lock
          const fyStart = new Date(fy.startDate);
          const fyEnd = new Date(fy.endDate);
          const fyCode = `${fyStart.getFullYear().toString().slice(-2)}-${fyEnd.getFullYear().toString().slice(-2)}`;
          const prefix =
            category === InvoiceCategory.PROFORMA_INVOICE
              ? `QTN/${fyCode}/`
              : category === InvoiceCategory.DELIVERY_CHALLAN
                ? `DC/${fyCode}/`
                : `INV/${fyCode}/`;

          // Acquire exclusive transaction advisory lock for this company and FY
          const lockKey = `seq_${tenant.companyId}_${fy.id}_${category}`;
          await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)
        `;

          let seq = await tx.invoiceSequence.findFirst({
            where: {
              companyId: tenant.companyId,
              financialYearId: fy.id,
              category: category as any,
              prefix,
            },
          });

          let nextNum = 1;
          if (!seq) {
            seq = await tx.invoiceSequence.create({
              data: {
                companyId: tenant.companyId,
                financialYearId: fy.id,
                branchId,
                prefix,
                currentNumber: 1,
                padding: 4,
                category: category as any,
              },
            });
            nextNum = 1;
          } else {
            nextNum = seq.currentNumber + 1;
            await tx.invoiceSequence.update({
              where: { id: seq.id },
              data: { currentNumber: nextNum },
            });
          }

          invoiceNumber = `${seq.prefix}${String(nextNum).padStart(
            seq.padding || 4,
            "0",
          )}`;
        }

        // 9. Exact Decimal Statutory Tax & Line Calculations
        const placeOfSupply =
          dto.placeOfSupply?.trim() ||
          party.stateCode?.trim() ||
          company.stateCode;

        const taxCalc = calculateSalesInvoiceTaxes(
          company.stateCode,
          placeOfSupply,
          dto.items.map((i) => ({
            itemId: i.itemId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            discountPercent: i.discountPercent,
            discountAmount: i.discountAmount,
            taxRate: i.taxRate,
            isTaxInclusive: i.isTaxInclusive,
            supplyCategory:
              (itemMap.get(i.itemId) as any)?.supplyCategory || "TAXABLE",
          })),
        );

        // 10. Payment and Status Resolution
        let paymentMode = this.normalizePaymentMode(dto.paymentMode);
        if (dto.tenderedSplit) {
          paymentMode = PaymentMode.SPLIT;
        }

        let validatedSplit: any = null;
        if (paymentMode === PaymentMode.SPLIT) {
          validatedSplit = this.validateAndNormalizeSplitTender(
            dto.tenderedSplit,
            taxCalc.grandTotal,
          );
        } else if (
          paymentMode !== PaymentMode.UNPAID_CREDIT &&
          dto.receivedAmount !== undefined &&
          dto.receivedAmount !== null
        ) {
          const recAmt = Number(dto.receivedAmount);
          if (!Number.isFinite(recAmt) || recAmt < 0) {
            throw new BadRequestException(
              "Received amount must be a non-negative number.",
            );
          }
          if (toMoney(recAmt).lessThan(taxCalc.grandTotal)) {
            throw new BadRequestException(
              `Received amount (₹${recAmt}) is less than invoice grand total (₹${taxCalc.grandTotal.toFixed(2)}).`,
            );
          }
        }

        const isUnpaidCredit = paymentMode === PaymentMode.UNPAID_CREDIT;
        const paidAmount =
          isDraft || isUnpaidCredit ? 0 : taxCalc.grandTotal.toNumber();
        const balanceAmount =
          isDraft || isUnpaidCredit ? taxCalc.grandTotal.toNumber() : 0;
        const status = isDraft
          ? InvoiceStatus.DRAFT
          : isUnpaidCredit
            ? InvoiceStatus.ISSUED
            : InvoiceStatus.PAID;

        // 11. Create SalesInvoice Header
        const invoice = await tx.salesInvoice.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            branchId,
            financialYearId: fy.id,
            partyId: party.id,
            category: category as any,
            invoiceNumber,
            invoiceDate,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
            status: status as any,
            paymentMode: paymentMode as any,
            isB2B: dto.isB2B ?? (party.gstin ? true : false),
            isReverseCharge: dto.isReverseCharge ?? false,
            placeOfSupply,
            billingAddress: party.billingAddress || {
              city: company.city,
              pincode: company.pincode,
            },
            shippingAddress: party.shippingAddress || null,
            subTotal: taxCalc.subTotal.toNumber(),
            discountTotal: taxCalc.discountTotal.toNumber(),
            taxableAmount: taxCalc.taxableAmount.toNumber(),
            cgstAmount: taxCalc.cgstAmount.toNumber(),
            sgstAmount: taxCalc.sgstAmount.toNumber(),
            igstAmount: taxCalc.igstAmount.toNumber(),
            utgstAmount: taxCalc.utgstAmount.toNumber(),
            cessAmount: taxCalc.cessAmount.toNumber(),
            roundOff: taxCalc.roundOff.toNumber(),
            grandTotal: taxCalc.grandTotal.toNumber(),
            paidAmount,
            balanceAmount,
            termsAndConditions: dto.termsAndConditions || null,
            notes: dto.notes || null,
            clientOfflineUuid: offlineUuid,
            provisionalCostReconciled: true,
          },
        });

        // 12. Create SalesInvoiceItem Lines & Append-Only Stock Movements
        const createdItems: any[] = [];
        for (let i = 0; i < dto.items.length; i++) {
          const lineDto = dto.items[i];
          const computedLine = taxCalc.items[i];
          const it = itemMap.get(lineDto.itemId)!;

          const invItem = await tx.salesInvoiceItem.create({
            data: {
              invoiceId: invoice.id,
              itemId: it.id,
              batchId: lineDto.batchId || null,
              description: lineDto.description || it.name,
              hsnCode: lineDto.hsnCode || it.hsnCode || "9999",
              quantity: computedLine.quantity.toNumber(),
              unitPrice: computedLine.unitPrice.toNumber(),
              discountPercent: computedLine.discountPercent.toNumber(),
              discountAmount: computedLine.discountAmount.toNumber(),
              taxableAmount: computedLine.taxableAmount.toNumber(),
              taxRate: computedLine.taxRate.toNumber(),
              cgstAmount: computedLine.cgstAmount.toNumber(),
              sgstAmount: computedLine.sgstAmount.toNumber(),
              igstAmount: computedLine.igstAmount.toNumber(),
              utgstAmount: computedLine.utgstAmount.toNumber(),
              cessAmount: computedLine.cessAmount.toNumber(),
              supplyCategory: computedLine.supplyCategory,
              totalAmount: computedLine.totalAmount.toNumber(),
            },
          });
          createdItems.push(invItem);

          // Append-only stock dispatch for physical items (only for issued/non-draft invoices)
          if (!isDraft && it.type !== "SERVICE" && warehouse) {
            const issue = await this.calculateMovingAverageDispatch(
              tx,
              tenant,
              warehouse.id,
              it,
              computedLine.quantity,
              computedLine.unitPrice,
            );
            await tx.stockTransaction.create({
              data: {
                organizationId: tenant.organizationId,
                companyId: tenant.companyId,
                warehouseId: warehouse.id,
                itemId: it.id,
                batchId: lineDto.batchId || null,
                transactionType: StockTransactionType.SALES_DISPATCH as any,
                transactionDate: invoiceDate,
                quantity: computedLine.quantity.negated().toNumber(), // Negative for dispatch
                valuationRate: issue.rate.toNumber(),
                totalValuation: issue.value.toNumber(),
                isProvisionalCost: issue.provisionalQuantity.gt(0),
                costVariance: 0,
                referenceDocType: "SALES_INVOICE",
                referenceDocId: invoice.id,
              },
            });
          }
        }

        // 13. If DRAFT, skip voucher posting & stock deduction, return draft invoice
        if (isDraft) {
          await this.audit.record(
            {
              organizationId: tenant.organizationId,
              companyId: tenant.companyId,
              userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
              action: "CREATE_DRAFT_INVOICE",
              entityName: "SalesInvoice",
              entityId: invoice.id,
              newState: {
                invoiceNumber,
                grandTotal: invoice.grandTotal,
                status: InvoiceStatus.DRAFT,
              },
            },
            tx,
          );

          return {
            ...invoice,
            grandTotalWords: taxCalc.grandTotalWords,
            grandTotalWordsGujarati: taxCalc.grandTotalWordsGujarati,
            items: createdItems,
            voucher: null,
            ...buildInvoiceUrls(invoice.id),
          };
        }

        // 14. Double-Entry General Ledger Voucher Posting
        const voucher = await this.postSalesInvoiceVoucher(
          tx,
          tenant,
          invoice.id,
          invoiceNumber,
          party,
          fy.id,
          taxCalc,
          paymentMode,
          invoiceDate,
          validatedSplit,
        );

        // 15. Audit Log (atomic with invoice & voucher transaction)
        await this.audit.record(
          {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
            action: "CREATE_SALES_INVOICE",
            entityName: "SalesInvoice",
            entityId: invoice.id,
            newState: {
              invoiceNumber,
              grandTotal: invoice.grandTotal,
              voucherId: voucher.id,
            },
          },
          tx,
        );

        return {
          ...invoice,
          party,
          grandTotalWords: taxCalc.grandTotalWords,
          grandTotalWordsGujarati: taxCalc.grandTotalWordsGujarati,
          items: createdItems,
          voucher: {
            id: voucher.id,
            voucherNumber: voucher.voucherNumber,
            balanced: true,
          },
          ...buildInvoiceUrls(invoice.id),
        };
      });

      if (
        result &&
        result.dueDate &&
        Number(result.balanceAmount) > 0 &&
        result.status !== InvoiceStatus.DRAFT
      ) {
        try {
          await this.notificationsService.triggerInvoiceDueReminder({
            id: result.id,
            invoiceNumber: result.invoiceNumber,
            dueDate: result.dueDate,
            balanceAmount: result.balanceAmount,
            partyName: (result as any).party?.name,
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            userId: tenant.userId,
          });
        } catch (notifErr: any) {
          this.logger.warn(
            `Failed to dispatch invoice due reminder: ${notifErr?.message}`,
          );
        }
      }

      return result;
    } catch (err: any) {
      if (
        offlineUuid &&
        (err?.code === "P2002" ||
          err?.message?.includes("client_offline_uuid") ||
          err?.message?.includes("Unique constraint failed"))
      ) {
        const existing = await this.prisma.salesInvoice.findFirst({
          where: {
            companyId: tenant.companyId,
            clientOfflineUuid: offlineUuid,
          },
          include: {
            items: true,
            party: true,
          },
        });
        if (existing) {
          this.assertMatchingIdempotentSale(existing, dto);
          const voucher = await this.prisma.voucher.findFirst({
            where: {
              companyId: tenant.companyId,
              sourceDocument: "SALES_INVOICE",
              sourceEntityId: existing.id,
              isCancelled: false,
            },
          });
          return {
            ...existing,
            voucher: voucher
              ? {
                  id: voucher.id,
                  voucherNumber: voucher.voucherNumber,
                  balanced: true,
                }
              : null,
            ...buildInvoiceUrls(existing.id),
          };
        } else {
          throw new ConflictException(
            "The clientOfflineUuid or idempotency key conflicts with an existing record.",
          );
        }
      }
      throw err;
    }
  }

  /**
   * Fast POS retail checkout with cash or split tender
   */
  async posCheckout(
    dto: PosCheckoutDto,
    tenant: TenantContext,
    idempotencyKey?: string,
  ): Promise<any> {
    const finalOfflineUuid = dto.clientOfflineUuid || idempotencyKey || null;

    const finalPaymentMode = dto.tenderedSplit
      ? PaymentMode.SPLIT
      : this.normalizePaymentMode(dto.paymentMode, PaymentMode.CASH);

    const notes =
      dto.notes ||
      (dto.offlineBillNumber
        ? `Offline Bill: ${dto.offlineBillNumber}`
        : undefined);

    const invoiceDto: CreateSalesInvoiceDto = {
      category: InvoiceCategory.TAX_INVOICE,
      clientOfflineUuid: finalOfflineUuid || undefined,
      partyId: dto.partyId,
      customerPhone: dto.customerPhone,
      customerName: dto.customerName,
      invoiceDate: new Date().toISOString().split("T")[0],
      paymentMode: finalPaymentMode,
      tenderedSplit: dto.tenderedSplit,
      receivedAmount: dto.receivedAmount,
      items: dto.items,
      warehouseId: dto.warehouseId,
      branchId: dto.branchId,
      notes,
    };

    return await this.createSalesInvoice(
      invoiceDto,
      tenant,
      finalOfflineUuid || undefined,
    );
  }

  /**
   * Batch sync for offline POS IndexedDB data with deduplication
   */
  async posSync(dto: PosSyncDto, tenant: TenantContext): Promise<any> {
    let processedCount = 0;
    let failedCount = 0;
    const results: any[] = [];

    for (const inv of dto.invoices) {
      try {
        const finalPaymentMode = inv.tenderedSplit
          ? PaymentMode.SPLIT
          : this.normalizePaymentMode(inv.paymentMode, PaymentMode.CASH);

        const createDto: CreateSalesInvoiceDto = {
          category: InvoiceCategory.TAX_INVOICE,
          clientOfflineUuid: inv.clientOfflineUuid,
          invoiceDate: inv.createdAt
            ? new Date(inv.createdAt).toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0],
          paymentMode: finalPaymentMode,
          tenderedSplit: inv.tenderedSplit,
          receivedAmount: inv.receivedAmount,
          items: inv.items,
          notes: inv.offlineBillNumber
            ? `Offline Bill: ${inv.offlineBillNumber} | Terminal: ${dto.terminalId}`
            : `Terminal: ${dto.terminalId}`,
        };

        const result = await this.createSalesInvoice(
          createDto,
          tenant,
          inv.clientOfflineUuid,
        );
        processedCount++;
        results.push({
          clientOfflineUuid: inv.clientOfflineUuid,
          status: "SYNCED",
          serverInvoiceId: result.id,
          assignedInvoiceNumber: result.invoiceNumber,
        });
      } catch (err: any) {
        this.logger.error(
          `Failed to sync offline POS invoice ${inv.clientOfflineUuid}: ${err.message}`,
        );
        failedCount++;
        results.push({
          clientOfflineUuid: inv.clientOfflineUuid,
          status: "FAILED",
          error: err.message,
        });
      }
    }

    return {
      processedCount,
      failedCount,
      results,
    };
  }

  /**
   * Statutory Sales Invoice Cancellation:
   * - Marks invoice as CANCELLED
   * - Atomically reverses Sales Voucher (contra entries)
   * - Appends stock restoration (SALES_CANCELLATION)
   */
  async cancelSalesInvoice(
    id: string,
    dto: CancelInvoiceDto,
    tenant: TenantContext,
    idempotencyKey?: string,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      // Concurrency lock on this specific invoice
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`cancel_${id}`})::bigint)
      `;

      const invoice = await tx.salesInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          items: true,
          eInvoiceRecord: true,
        },
      });

      if (!invoice) {
        throw new NotFoundException(`Sales invoice ${id} not found.`);
      }

      if (invoice.status === InvoiceStatus.CANCELLED) {
        if (idempotencyKey) {
          // Idempotent retry: invoice already cancelled
          return invoice;
        }
        throw new BadRequestException("Invoice is already cancelled.");
      }

      // Statutory IRN 24-hour limit check
      if (invoice.eInvoiceRecord?.irn && invoice.eInvoiceRecord.ackDate) {
        const elapsedHours =
          (Date.now() - new Date(invoice.eInvoiceRecord.ackDate).getTime()) /
          (1000 * 60 * 60);
        if (elapsedHours > 24) {
          throw new UnprocessableEntityException({
            type: "https://api.billing.in/errors/irn-cancel-window-expired",
            title: "IRN Cancellation Window Expired",
            status: 422,
            detail:
              "E-Invoices can only be cancelled on the IRP within 24 hours of generation. Please issue a Credit Note instead.",
            detailGujarati:
              "IRP પોર્ટલ પર ઈ-ઈનવોઈસ ફક્ત ૨૪ કલાકમાં જ રદ થઈ શકે છે. મહેરબાની કરીને ક્રેડિટ નોટ (જમા ચિઠ્ઠી) બનાવો.",
          });
        }
      }

      // 1. Mark Invoice CANCELLED and reset outstanding balance
      const updatedInvoice = await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.CANCELLED,
          balanceAmount: 0,
          notes: invoice.notes
            ? `${invoice.notes}\nCancellation Reason: ${dto.cancellationReason}`
            : `Cancellation Reason: ${dto.cancellationReason}`,
        },
      });

      // 2. Reverse Double-Entry Sales Voucher
      const voucher = await tx.voucher.findFirst({
        where: {
          companyId: tenant.companyId,
          sourceDocument: "SALES_INVOICE",
          sourceEntityId: invoice.id,
          isCancelled: false,
        },
        include: {
          journalEntries: true,
        },
      });

      if (voucher) {
        const reversalPlan = buildReversalVoucherPlan(
          {
            id: voucher.id,
            voucherNumber: voucher.voucherNumber,
            voucherDate: voucher.voucherDate,
            journalEntries: voucher.journalEntries,
          },
          `Cancellation of invoice #${invoice.invoiceNumber}: ${dto.cancellationReason}`,
        );

        const revVoucherNumber = `REV/${voucher.voucherNumber}`;
        const revVoucher = await tx.voucher.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            financialYearId: voucher.financialYearId,
            voucherType: voucher.voucherType,
            voucherNumber: revVoucherNumber,
            voucherDate: new Date(),
            referenceNo: voucher.voucherNumber,
            narration: reversalPlan.narration,
            narrationGujarati: `રદ્દીકરણ બિલ નં. ${invoice.invoiceNumber}`,
            totalAmount: voucher.totalAmount,
            isAutoGenerated: true,
            isCancelled: false,
            sourceDocument: "SALES_INVOICE",
            sourceEntityId: invoice.id,
          },
        });

        for (const rLine of reversalPlan.lines) {
          await tx.journalEntry.create({
            data: {
              voucherId: revVoucher.id,
              accountId: rLine.accountId,
              debitAmount: rLine.debitAmount,
              creditAmount: rLine.creditAmount,
              lineNarration: rLine.lineNarration,
              sequenceOrder: rLine.sequenceOrder,
            },
          });

          const acc = await tx.ledgerAccount.findUnique({
            where: { id: rLine.accountId },
            include: { group: true },
          });
          if (acc) {
            const newBal = applyTransactionToBalance(
              acc.group.nature as any,
              acc.currentBalance.toString(),
              toMoney(rLine.debitAmount),
              toMoney(rLine.creditAmount),
            );
            await tx.ledgerAccount.update({
              where: { id: acc.id },
              data: { currentBalance: newBal.toNumber() },
            });
          }
        }

        // Mark original voucher as cancelled
        await tx.voucher.update({
          where: { id: voucher.id },
          data: { isCancelled: true },
        });
      }

      // 3. Append-Only Stock Restoration
      const stockDispatches = await tx.stockTransaction.findMany({
        where: {
          companyId: tenant.companyId,
          referenceDocType: "SALES_INVOICE",
          referenceDocId: invoice.id,
          transactionType: StockTransactionType.SALES_DISPATCH as any,
        },
      });

      for (const st of stockDispatches) {
        await tx.stockTransaction.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            warehouseId: st.warehouseId,
            itemId: st.itemId,
            batchId: st.batchId,
            transactionType: StockTransactionType.SALES_CANCELLATION as any,
            transactionDate: new Date(),
            quantity: Math.abs(Number(st.quantity)), // Positive quantity restoring stock
            valuationRate: st.valuationRate,
            totalValuation: st.totalValuation,
            isProvisionalCost: false,
            costVariance: 0,
            referenceDocType: "SALES_INVOICE",
            referenceDocId: invoice.id,
          },
        });
      }

      // 4. Audit Log (atomic with cancellation & stock restoration)
      await this.audit.record(
        {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
          action: "CANCEL_SALES_INVOICE",
          entityName: "SalesInvoice",
          entityId: invoice.id,
          newState: {
            invoiceNumber: invoice.invoiceNumber,
            status: InvoiceStatus.CANCELLED,
            reason: dto.cancellationReason,
          },
        },
        tx,
      );

      return updatedInvoice;
    });
  }

  /**
   * List sales invoices with pagination, date range, and search
   */
  async listSalesInvoices(
    query: QueryInvoicesDto,
    tenant: TenantContext,
  ): Promise<any> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const where: any = {
        companyId: tenant.companyId,
      };

      if (query.partyId) {
        const rawPartyId =
          typeof query.partyId === "string"
            ? query.partyId.trim()
            : String(query.partyId || "").trim();
        const uuidRegex =
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

        // If partyId is empty, undefined/null string, or not a valid UUID format,
        // return blank response instead of throwing a database syntax error.
        if (
          !rawPartyId ||
          rawPartyId === "null" ||
          rawPartyId === "undefined" ||
          !uuidRegex.test(rawPartyId)
        ) {
          return {
            items: [],
            data: [],
            total: 0,
            page,
            limit,
            totalPages: 0,
          };
        }

        // Proactively verify party existence for the tenant company.
        // If party is not found, return blank response instead of error.
        const partyExists = await tx.party.findFirst({
          where: {
            id: rawPartyId,
            companyId: tenant.companyId,
          },
          select: { id: true },
        });

        if (!partyExists) {
          return {
            items: [],
            data: [],
            total: 0,
            page,
            limit,
            totalPages: 0,
          };
        }

        where.partyId = rawPartyId;
      }
      if (query.status) where.status = query.status;
      if (query.category) where.category = query.category;
      const targetFyId = (query as any)?.financialYearId || tenant.financialYearId;
      if (targetFyId) {
        where.financialYearId = targetFyId;
      }
      if (query.startDate || query.endDate) {
        where.invoiceDate = {};
        if (query.startDate)
          where.invoiceDate.gte = parseStartOfDay(query.startDate);
        if (query.endDate) where.invoiceDate.lte = parseEndOfDay(query.endDate);
      }
      if (query.search) {
        where.invoiceNumber = { contains: query.search, mode: "insensitive" };
      }

      const [items, total] = await Promise.all([
        tx.salesInvoice.findMany({
          where,
          include: {
            party: {
              select: { id: true, name: true, gstin: true, phone: true },
            },
            items: {
              include: {
                item: true,
                returnItems: true,
              },
            },
            returns: {
              select: {
                id: true,
                returnNumber: true,
                grandTotal: true,
                status: true,
                createdAt: true,
                items: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          skip: (query as any).availableForReturnOnly ? undefined : skip,
          take: (query as any).availableForReturnOnly ? undefined : limit,
        }),
        tx.salesInvoice.count({ where }),
      ]);

      let mappedItems = items.map((inv: any) => {
        const returnedAmount = (inv.returns || [])
          .filter((r: any) => r.status !== "CANCELLED")
          .reduce((sum: number, r: any) => sum + Number(r.grandTotal || 0), 0);

        let totalOriginalQty = 0;
        let totalReturnedQty = 0;

        const itemsWithReturnStatus = (inv.items || []).map((line: any) => {
          const originalQty = Number(line.quantity || 0);
          const returnedQty = (line.returnItems || []).reduce(
            (sum: number, retItem: any) => sum + Number(retItem.quantity || 0),
            0,
          );
          const remainingQty = Math.max(0, originalQty - returnedQty);
          totalOriginalQty += originalQty;
          totalReturnedQty += returnedQty;

          return {
            ...line,
            returnedQuantity: returnedQty,
            remainingQuantity: remainingQty,
            isFullyReturned: remainingQty <= 0.0001,
          };
        });

        const totalRemainingQty = Math.max(0, totalOriginalQty - totalReturnedQty);
        const grandTotalNum = Number(inv.grandTotal || 0);
        const isFullyReturned =
          (totalOriginalQty > 0 && totalRemainingQty <= 0.0001) ||
          returnedAmount >= grandTotalNum - 0.01;

        const outstandingBalance = Math.max(0, Number(inv.balanceAmount || 0));
        const netGrandTotal = Math.max(0, grandTotalNum - returnedAmount);

        return {
          ...inv,
          items: itemsWithReturnStatus,
          returnedAmount,
          netGrandTotal,
          outstandingBalance,
          isFullyReturned,
          totalRemainingQty,
          ...buildInvoiceUrls(inv.id),
        };
      });

      if (
        (query as any).availableForReturnOnly === "true" ||
        (query as any).availableForReturnOnly === true
      ) {
        mappedItems = mappedItems.filter(
          (inv: any) => !inv.isFullyReturned && inv.totalRemainingQty > 0.0001,
        );
      }

      return {
        items: mappedItems,
        data: mappedItems,
        total: (query as any).availableForReturnOnly ? mappedItems.length : total,
        page,
        limit,
        totalPages: (query as any).availableForReturnOnly
          ? 1
          : Math.ceil(total / limit),
      };
    });
  }

  /**
   * Get sales invoice by ID with items, party, and double-entry voucher
   */
  async getSalesInvoiceById(id: string, tenant: TenantContext): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoice = await tx.salesInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          party: true,
          branch: true,
          financialYear: true,
          eWayBillRecord: true,
          eInvoiceRecord: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      });

      if (!invoice) {
        const voucher = await tx.voucher.findFirst({
          where: {
            companyId: tenant.companyId,
            sourceEntityId: id,
          },
          include: {
            journalEntries: {
              include: { account: true },
            },
          },
        });
        if (voucher) {
          const stockTxs = await tx.stockTransaction.findMany({
            where: {
              companyId: tenant.companyId,
              referenceDocId: id,
            },
            include: { item: true },
          });
          const branch = await tx.branch.findFirst({
            where: { companyId: tenant.companyId },
          });
          const finYear = await tx.financialYear.findFirst({
            where: { id: voucher.financialYearId },
          });
          const partyName = voucher.narration?.replace(/^Sales Bill No\.\s+[^\s]+\s+to\s+/i, "") || "Walk-in Retail Cash Customer";
          return {
            id,
            companyId: tenant.companyId,
            invoiceNumber: voucher.referenceNo || voucher.voucherNumber,
            invoiceDate: voucher.voucherDate.toISOString(),
            status: "PAID",
            paymentMode: voucher.paymentMode || "CASH",
            placeOfSupply: "24",
            isB2B: false,
            taxableAmount: Number(voucher.totalAmount),
            cgstAmount: 0,
            sgstAmount: 0,
            igstAmount: 0,
            roundOff: 0,
            grandTotal: Number(voucher.totalAmount),
            paidAmount: Number(voucher.totalAmount),
            balanceAmount: 0,
            outstandingBalance: 0,
            branch,
            financialYear: finYear,
            party: {
              id: "historical-party",
              name: partyName,
              stateCode: "24",
            },
            items: stockTxs.map((st) => ({
              id: st.id,
              invoiceId: id,
              itemId: st.itemId,
              description: st.item?.name || "Product",
              hsnCode: st.item?.hsnCode || "9999",
              quantity: Math.abs(Number(st.quantity)),
              unitPrice: Number(st.valuationRate),
              taxRate: 0,
              taxableAmount: Number(st.totalValuation),
              cgstAmount: 0,
              sgstAmount: 0,
              igstAmount: 0,
              totalAmount: Number(st.totalValuation),
              item: st.item,
            })),
            voucher,
            ...buildInvoiceUrls(id),
          };
        }
        throw new NotFoundException(`Sales invoice ${id} not found.`);
      }

      const voucher = await tx.voucher.findFirst({
        where: {
          companyId: tenant.companyId,
          sourceDocument: "SALES_INVOICE",
          sourceEntityId: invoice.id,
        },
        include: {
          journalEntries: {
            include: { account: true },
          },
        },
      });

      return {
        ...invoice,
        outstandingBalance: Number(invoice.balanceAmount),
        voucher,
        ...buildInvoiceUrls(invoice.id),
      };
    });
  }

  /**
   * Issue a DRAFT sales invoice:
   * - Validates DRAFT status and period lock
   * - Reserves legal sequential invoice number via pg_advisory_xact_lock
   * - Validates physical stock and creates append-only dispatch stock movements
   * - Posts balanced double-entry General Ledger voucher
   * - Updates status to ISSUED or PAID
   */
  async issueDraftInvoice(
    id: string,
    tenant: TenantContext,
    idempotencyKey?: string,
    allowNegativeStockOverride?: boolean,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      // Concurrency lock on this specific invoice
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`issue_${id}`})::bigint)
      `;

      const invoice = await tx.salesInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          items: {
            include: { item: true },
          },
          party: true,
        },
      });

      if (!invoice) {
        throw new NotFoundException(`Sales invoice ${id} not found.`);
      }

      if (invoice.status !== InvoiceStatus.DRAFT) {
        if (
          idempotencyKey &&
          (invoice.status === InvoiceStatus.ISSUED ||
            invoice.status === InvoiceStatus.PAID)
        ) {
          // Idempotent retry: invoice has already been issued
          return invoice;
        }
        throw new BadRequestException(
          `Only DRAFT invoices can be issued. Current status: ${invoice.status}.`,
        );
      }

      const company = await tx.company.findUnique({
        where: { id: tenant.companyId },
      });
      if (!company) {
        throw new NotFoundException(`Company ${tenant.companyId} not found.`);
      }

      const fy = await tx.financialYear.findUnique({
        where: { id: invoice.financialYearId },
      });
      if (!fy) {
        throw new NotFoundException(
          `Financial year ${invoice.financialYearId} not found.`,
        );
      }

      const periodCheck = validatePeriodAccess(
        invoice.invoiceDate,
        tenant.companyId,
        fy,
      );
      if (!periodCheck.isAllowed) {
        throw new BadRequestException(periodCheck.reason);
      }

      // Warehouse
      let warehouse = await tx.warehouse.findFirst({
        where: { companyId: tenant.companyId, isDefault: true },
      });
      if (!warehouse) {
        warehouse = await tx.warehouse.findFirst({
          where: { companyId: tenant.companyId },
        });
      }

      // Check stock availability
      const permitNegative =
        company.allowNegativeStock || allowNegativeStockOverride === true;
      if (!permitNegative && warehouse) {
        for (const line of invoice.items) {
          if (line.item?.type === "SERVICE") continue;

          const stockLockKey = `stock_${tenant.companyId}_${warehouse.id}_${line.itemId}`;
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(hashtext(${stockLockKey})::bigint)
          `;

          const stockAgg = await tx.stockTransaction.aggregate({
            where: {
              companyId: tenant.companyId,
              warehouseId: warehouse.id,
              itemId: line.itemId,
            },
            _sum: { quantity: true },
          });
          const currentStock = toDecimal(stockAgg._sum.quantity || 0);
          const reqQty = toDecimal(line.quantity);
          if (currentStock.lessThan(reqQty)) {
            throw new BadRequestException(
              `Insufficient stock for item "${line.item?.name || line.description}". Available: ${currentStock.toString()}, Requested: ${reqQty.toString()}. [INSUFFICIENT_STOCK]`,
            );
          }
        }
      }

      // Concurrency-Safe Legal Invoice Numbering using Transaction Advisory Lock
      const fyStart = new Date(fy.startDate);
      const fyEnd = new Date(fy.endDate);
      const fyCode = `${fyStart.getFullYear().toString().slice(-2)}-${fyEnd.getFullYear().toString().slice(-2)}`;
      const prefix = `INV/${fyCode}/`;
      const category =
        invoice.category === InvoiceCategory.PROFORMA_INVOICE ||
        invoice.category === InvoiceCategory.DELIVERY_CHALLAN
          ? InvoiceCategory.TAX_INVOICE
          : invoice.category;

      const lockKey = `seq_${tenant.companyId}_${fy.id}_${category}`;
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)
      `;

      let seq = await tx.invoiceSequence.findFirst({
        where: {
          companyId: tenant.companyId,
          financialYearId: fy.id,
          category: category as any,
          prefix,
        },
      });

      let nextNum = 1;
      if (!seq) {
        seq = await tx.invoiceSequence.create({
          data: {
            companyId: tenant.companyId,
            financialYearId: fy.id,
            branchId: invoice.branchId,
            prefix,
            currentNumber: 1,
            padding: 4,
            category: category as any,
          },
        });
        nextNum = 1;
      } else {
        nextNum = seq.currentNumber + 1;
        await tx.invoiceSequence.update({
          where: { id: seq.id },
          data: { currentNumber: nextNum },
        });
      }

      const legalInvoiceNumber = `${seq.prefix}${String(nextNum).padStart(
        seq.padding || 4,
        "0",
      )}`;

      // Append-only stock dispatch for physical items
      if (warehouse) {
        for (const line of invoice.items) {
          if (line.item?.type === "SERVICE") continue;
          const issue = await this.calculateMovingAverageDispatch(
            tx,
            tenant,
            warehouse.id,
            line.item || {
              id: line.itemId,
              name: "Item",
              purchaseRate: line.unitPrice,
            },
            toDecimal(line.quantity),
          );
          await tx.stockTransaction.create({
            data: {
              organizationId: tenant.organizationId,
              companyId: tenant.companyId,
              warehouseId: warehouse.id,
              itemId: line.itemId,
              batchId: line.batchId || null,
              transactionType: StockTransactionType.SALES_DISPATCH as any,
              transactionDate: invoice.invoiceDate,
              quantity: toDecimal(line.quantity).negated().toNumber(),
              valuationRate: issue.rate.toNumber(),
              totalValuation: issue.value.toNumber(),
              isProvisionalCost: issue.provisionalQuantity.gt(0),
              costVariance: 0,
              referenceDocType: "SALES_INVOICE",
              referenceDocId: invoice.id,
            },
          });
        }
      }

      // Reconstruct tax calculations for voucher
      const taxCalc = calculateSalesInvoiceTaxes(
        company.stateCode,
        invoice.placeOfSupply,
        invoice.items.map((line: any) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          discountAmount: line.discountAmount,
          taxRate: line.taxRate,
          isTaxInclusive: false,
          supplyCategory: line.supplyCategory || "TAXABLE",
        })),
      );

      const isUnpaidCredit = invoice.paymentMode === PaymentMode.UNPAID_CREDIT;
      const paidAmount = isUnpaidCredit ? 0 : taxCalc.grandTotal.toNumber();
      const balanceAmount = isUnpaidCredit ? taxCalc.grandTotal.toNumber() : 0;
      const status = isUnpaidCredit ? InvoiceStatus.ISSUED : InvoiceStatus.PAID;

      // Post Voucher
      const voucher = await this.postSalesInvoiceVoucher(
        tx,
        tenant,
        invoice.id,
        legalInvoiceNumber,
        invoice.party,
        fy.id,
        taxCalc,
        isUnpaidCredit,
        invoice.invoiceDate,
      );

      // Update invoice
      const updatedInvoice = await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          category: category as any,
          invoiceNumber: legalInvoiceNumber,
          status: status as any,
          taxableAmount: taxCalc.taxableAmount.toNumber(),
          cgstAmount: taxCalc.cgstAmount.toNumber(),
          sgstAmount: taxCalc.sgstAmount.toNumber(),
          utgstAmount: taxCalc.utgstAmount.toNumber(),
          igstAmount: taxCalc.igstAmount.toNumber(),
          roundOff: taxCalc.roundOff.toNumber(),
          grandTotal: taxCalc.grandTotal.toNumber(),
          paidAmount,
          balanceAmount,
        },
        include: {
          items: true,
          party: true,
        },
      });

      // Audit Log (atomic with draft issue & legal number assignment)
      await this.audit.record(
        {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
          action: "ISSUE_DRAFT_INVOICE",
          entityName: "SalesInvoice",
          entityId: invoice.id,
          newState: {
            invoiceNumber: legalInvoiceNumber,
            grandTotal: invoice.grandTotal,
            voucherId: voucher.id,
            status,
          },
        },
        tx,
      );

      return {
        ...updatedInvoice,
        voucher: {
          id: voucher.id,
          voucherNumber: voucher.voucherNumber,
          balanced: true,
        },
        ...buildInvoiceUrls(updatedInvoice.id),
      };
    });
  }

  /**
   * Record payment directly against a specific Sales Invoice
   */
  async recordInvoicePayment(
    invoiceId: string,
    dto: RecordInvoicePaymentDto,
    tenant: TenantContext,
    idempotencyKey?: string,
  ): Promise<any> {
    const result = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      // Concurrency lock on payments for this specific invoice
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`pay_${invoiceId}`})::bigint)
      `;

      const refKey = idempotencyKey || dto.referenceNo;
      if (refKey) {
        const existingVoucher = await tx.voucher.findFirst({
          where: {
            companyId: tenant.companyId,
            sourceDocument: "SALES_INVOICE",
            sourceEntityId: invoiceId,
            referenceNo: refKey,
            isCancelled: false,
          },
          include: { allocations: true },
        });
        if (existingVoucher) {
          const freshInvoice = await tx.salesInvoice.findUnique({
            where: { id: invoiceId },
          });
          return {
            invoice: freshInvoice,
            allocation: existingVoucher.allocations[0] || null,
            voucher: existingVoucher,
          };
        }
      }

      const invoice = await tx.salesInvoice.findFirst({
        where: { id: invoiceId, companyId: tenant.companyId },
        include: { party: true, financialYear: true },
      });

      if (!invoice) {
        throw new NotFoundException(`Sales invoice ${invoiceId} not found.`);
      }

      if (invoice.status === InvoiceStatus.DRAFT) {
        throw new BadRequestException(
          "Cannot record payment against a draft invoice.",
        );
      }

      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException(
          "Cannot record payment against a cancelled invoice.",
        );
      }

      const payAmount = toMoney(dto.amount);
      if (payAmount.lessThanOrEqualTo(0)) {
        throw new BadRequestException(
          "Payment amount must be greater than zero.",
        );
      }

      const discountAmount = toMoney(dto.cashDiscount || 0);
      if (discountAmount.lessThan(0)) {
        throw new BadRequestException("Cash discount cannot be negative.");
      }

      const totalSettled = payAmount.plus(discountAmount);
      const currentBalance = toMoney(invoice.balanceAmount);

      if (currentBalance.lessThanOrEqualTo(0)) {
        throw new BadRequestException("Invoice is already fully settled.");
      }

      if (totalSettled.greaterThan(currentBalance)) {
        throw new BadRequestException(
          `Settlement amount of ₹${totalSettled.toString()} exceeds outstanding invoice balance of ₹${currentBalance.toString()}. Overpayments must be recorded as customer advances.`,
        );
      }

      const paymentDate = dto.paymentDate
        ? new Date(dto.paymentDate)
        : new Date();
      const periodCheck = validatePeriodAccess(
        paymentDate,
        tenant.companyId,
        invoice.financialYear,
      );
      if (!periodCheck.isAllowed) {
        throw new BadRequestException(periodCheck.reason);
      }

      await this.ensureRequiredLedgerAccounts(tx, tenant, invoice.party);

      // Resolve Debit Account (Cash/Bank)
      let debitAccount: any;
      if (dto.depositToAccountId) {
        debitAccount = await tx.ledgerAccount.findFirst({
          where: { id: dto.depositToAccountId, companyId: tenant.companyId },
          include: { group: true },
        });
      } else {
        const mode = this.normalizePaymentMode(
          dto.paymentMode,
          PaymentMode.CASH,
        );
        const isBank = [
          PaymentMode.BANK_TRANSFER,
          PaymentMode.UPI_QR,
          PaymentMode.CHEQUE,
        ].includes(mode as any);
        const accName = isBank ? "Bank Account" : "Cash Account";
        debitAccount = await tx.ledgerAccount.findFirst({
          where: { companyId: tenant.companyId, name: accName },
          include: { group: true },
        });
        if (!debitAccount) {
          debitAccount = await this.findAccountByName(
            tx,
            tenant.companyId,
            "Cash Account",
          );
        }
      }

      if (!debitAccount) {
        throw new NotFoundException("Deposit account not found in company.");
      }

      // Customer Account
      const partyLedgerAcc = await this.getOrCreatePartyLedgerAccount(
        tx,
        tenant,
        invoice.party,
      );

      // Build Receipt Voucher Lines
      const voucherLines: Array<{
        accountId: string;
        debitAmount: number;
        creditAmount: number;
        lineNarration: string;
      }> = [];

      // DR Cash/Bank
      voucherLines.push({
        accountId: debitAccount.id,
        debitAmount: payAmount.toNumber(),
        creditAmount: 0,
        lineNarration: `Receipt against #${invoice.invoiceNumber}`,
      });

      // DR Discount Allowed (if any)
      if (discountAmount.greaterThan(0)) {
        let discountAcc = await tx.ledgerAccount.findFirst({
          where: { companyId: tenant.companyId, name: "Discount Allowed" },
        });
        if (!discountAcc) {
          discountAcc = await tx.ledgerAccount.findFirst({
            where: {
              companyId: tenant.companyId,
              name: "Cash Discount Allowed",
            },
          });
        }
        if (discountAcc) {
          voucherLines.push({
            accountId: discountAcc.id,
            debitAmount: discountAmount.toNumber(),
            creditAmount: 0,
            lineNarration: `Cash discount on #${invoice.invoiceNumber}`,
          });
        }
      }

      // CR Customer Account
      voucherLines.push({
        accountId: partyLedgerAcc.id,
        debitAmount: 0,
        creditAmount: totalSettled.toNumber(),
        lineNarration: `Settlement for Bill #${invoice.invoiceNumber}`,
      });

      const validation = validateJournalLines(voucherLines);
      if (!validation.isValid) {
        throw new BadRequestException(
          `Receipt voucher double-entry invariant failure: ${validation.errors.join("; ")}`,
        );
      }

      const receiptVoucherNumber = `REC/${invoice.invoiceNumber}/${Date.now().toString(36).toUpperCase()}`;
      const voucher = await tx.voucher.create({
        data: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          financialYearId: invoice.financialYearId,
          voucherType: "RECEIPT" as any,
          voucherNumber: receiptVoucherNumber,
          voucherDate: paymentDate,
          referenceNo: refKey || dto.referenceNo || invoice.invoiceNumber,
          narration:
            dto.notes ||
            `Receipt against #${invoice.invoiceNumber} from ${invoice.party.name}`,
          narrationGujarati: `રસીદ બિલ નં. ${invoice.invoiceNumber} - ${invoice.party.nameGujarati || invoice.party.name}`,
          totalAmount: totalSettled.toNumber(),
          paymentMode: dto.paymentMode ? String(dto.paymentMode) : null,
          isAutoGenerated: true,
          isCancelled: false,
          sourceDocument: "SALES_INVOICE",
          sourceEntityId: invoice.id,
        },
      });

      for (let idx = 0; idx < voucherLines.length; idx++) {
        const vl = voucherLines[idx];
        await tx.journalEntry.create({
          data: {
            voucherId: voucher.id,
            accountId: vl.accountId,
            debitAmount: vl.debitAmount,
            creditAmount: vl.creditAmount,
            lineNarration: vl.lineNarration,
            sequenceOrder: idx + 1,
          },
        });

        const acc = await tx.ledgerAccount.findUnique({
          where: { id: vl.accountId },
          include: { group: true },
        });
        if (acc) {
          const newBal = applyTransactionToBalance(
            acc.group.nature as any,
            acc.currentBalance.toString(),
            toMoney(vl.debitAmount),
            toMoney(vl.creditAmount),
          );
          await tx.ledgerAccount.update({
            where: { id: acc.id },
            data: { currentBalance: newBal.toNumber() },
          });
        }
      }

      // Create PaymentAllocation
      const allocation = await tx.paymentAllocation.create({
        data: {
          voucherId: voucher.id,
          invoiceId: invoice.id,
          allocatedAmount: payAmount.toNumber(),
          cashDiscount: discountAmount.toNumber(),
        },
      });

      // Update SalesInvoice balances and status
      const newPaid = toDecimal(invoice.paidAmount).plus(totalSettled);
      const newBal = currentBalance.minus(totalSettled);
      const newStatus = newBal.isZero()
        ? InvoiceStatus.PAID
        : InvoiceStatus.PARTIALLY_PAID;

      const updatedInvoice = await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newPaid.toNumber(),
          balanceAmount: newBal.toNumber(),
          status: newStatus as any,
        },
      });

      await this.audit.record(
        {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
          action: "RECORD_INVOICE_PAYMENT",
          entityName: "SalesInvoice",
          entityId: invoice.id,
          newState: {
            invoiceNumber: invoice.invoiceNumber,
            paidAmount: newPaid.toNumber(),
            balanceAmount: newBal.toNumber(),
            status: newStatus,
            receiptVoucherId: voucher.id,
          },
        },
        tx,
      );

      return {
        invoice: updatedInvoice,
        party: invoice.party,
        allocation,
        voucher,
      };
    });

    // Post-commit persistent notification dispatch
    try {
      const partyName = (result as any).party?.name || "Customer";
      const payAmountNum = Number(result.allocation?.allocatedAmount || dto.amount);
      const balAmountNum = Number(result.invoice?.balanceAmount || 0);
      await this.notificationsService.createNotification({
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        type: NotificationType.PAYMENT_RECEIVED,
        title: "Payment Received",
        message: `Payment Received: ₹${payAmountNum.toLocaleString("en-IN", { minimumFractionDigits: 2 })} received from ${partyName} against Invoice ${result.invoice?.invoiceNumber}. Remaining balance: ₹${balAmountNum.toLocaleString("en-IN", { minimumFractionDigits: 2 })}.`,
        entityType: "SALES_PAYMENT",
        entityId: result.voucher?.id || result.invoice?.id,
        data: {
          amount: payAmountNum,
          currency: "INR",
          partyName,
          paymentDate: dto.paymentDate || new Date().toISOString().split("T")[0],
          paymentMode: dto.paymentMode || "CASH",
          referenceNumber: result.invoice?.invoiceNumber,
          invoiceId: result.invoice?.id,
          balanceAmount: balAmountNum,
          action: "OPEN_PAYMENT",
        },
        deepLink: `/sales/payment-in/${result.voucher?.id || result.invoice?.id}`,
      });
    } catch (notifErr: any) {
      this.logger.error(`Notification dispatch failed post-commit: ${notifErr.message}`);
    }

    return result;
  }

  /**
   * Get payment allocations history for an invoice
   */
  async getInvoiceAllocations(
    invoiceId: string,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoice = await tx.salesInvoice.findFirst({
        where: { id: invoiceId, companyId: tenant.companyId },
      });
      if (!invoice) {
        throw new NotFoundException(`Sales invoice ${invoiceId} not found.`);
      }

      return await tx.paymentAllocation.findMany({
        where: { invoiceId },
        include: {
          voucher: {
            include: {
              journalEntries: {
                include: { account: true },
              },
            },
          },
        },
        orderBy: { allocationDate: "desc" },
      });
    });
  }

  /**
   * List stock ledger movements with pagination and filters
   */
  async getStockMovements(
    query: QueryStockTransactionsDto,
    tenant: TenantContext,
  ): Promise<any> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const where: any = { companyId: tenant.companyId };
      if (query.itemId) where.itemId = query.itemId;
      if (query.warehouseId) where.warehouseId = query.warehouseId;
      if (query.transactionType) where.transactionType = query.transactionType;
      if (query.startDate || query.endDate) {
        where.transactionDate = {};
        if (query.startDate)
          where.transactionDate.gte = parseStartOfDay(query.startDate);
        if (query.endDate)
          where.transactionDate.lte = parseEndOfDay(query.endDate);
      }

      const [items, total] = await Promise.all([
        tx.stockTransaction.findMany({
          where,
          include: {
            item: { select: { id: true, name: true, sku: true } },
            warehouse: { select: { id: true, name: true, isDefault: true } },
          },
          orderBy: { transactionDate: "desc" },
          skip,
          take: limit,
        }),
        tx.stockTransaction.count({ where }),
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

  /**
   * Get append-only stock ledger movements and current balance for a specific item
   */
  async getItemStockMovements(
    itemId: string,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const item = await tx.item.findFirst({
        where: { id: itemId, companyId: tenant.companyId },
      });
      if (!item) {
        throw new NotFoundException(`Item ${itemId} not found.`);
      }

      const movements = await tx.stockTransaction.findMany({
        where: { itemId, companyId: tenant.companyId },
        include: {
          warehouse: { select: { id: true, name: true, isDefault: true } },
        },
        orderBy: { transactionDate: "desc" },
      });

      const stockAgg = await tx.stockTransaction.aggregate({
        where: { itemId, companyId: tenant.companyId },
        _sum: { quantity: true },
      });

      const currentStock = toDecimal(stockAgg._sum.quantity || 0).toNumber();

      return {
        item: {
          id: item.id,
          name: item.name,
          sku: item.sku,
          type: item.type,
        },
        currentStock,
        movements,
      };
    });
  }

  // --- Internal Account Helpers ---

  private async postSalesInvoiceVoucher(
    tx: any,
    tenant: TenantContext,
    invoiceId: string,
    invoiceNumber: string,
    party: any,
    financialYearId: string,
    taxCalc: any,
    paymentModeOrIsCredit: PaymentMode | boolean,
    voucherDate: Date,
    validatedSplit?: any,
  ): Promise<any> {
    await this.ensureRequiredLedgerAccounts(tx, tenant, party);

    let paymentMode: PaymentMode;
    let isUnpaidCredit: boolean;
    if (typeof paymentModeOrIsCredit === "boolean") {
      isUnpaidCredit = paymentModeOrIsCredit;
      paymentMode = isUnpaidCredit
        ? PaymentMode.UNPAID_CREDIT
        : PaymentMode.CASH;
    } else {
      paymentMode = paymentModeOrIsCredit;
      isUnpaidCredit = paymentMode === PaymentMode.UNPAID_CREDIT;
    }

    const salesAccountName = taxCalc.isIntraState
      ? "General Sales Account"
      : "Inter-State Sales Account";
    const salesAccount = await this.findAccountByName(
      tx,
      tenant.companyId,
      salesAccountName,
    );

    const voucherLines: Array<{
      accountId: string;
      debitAmount: number;
      creditAmount: number;
      lineNarration: string;
    }> = [];

    // DR Posting based on Payment Mode & Split Tender
    if (isUnpaidCredit) {
      const partyAcc = await this.getOrCreatePartyLedgerAccount(
        tx,
        tenant,
        party,
      );
      voucherLines.push({
        accountId: partyAcc.id,
        debitAmount: taxCalc.grandTotal.toNumber(),
        creditAmount: 0,
        lineNarration: `Sales Bill #${invoiceNumber} (Credit)`,
      });
    } else if (paymentMode === PaymentMode.SPLIT && validatedSplit) {
      // Split tender multi-debit posting
      if (validatedSplit.cash && validatedSplit.cash.greaterThan(0)) {
        const cashAcc = await this.resolvePaymentLedgerAccount(
          tx,
          tenant,
          "CASH",
        );
        voucherLines.push({
          accountId: cashAcc.id,
          debitAmount: validatedSplit.cash.toNumber(),
          creditAmount: 0,
          lineNarration: `Sales Bill #${invoiceNumber} (Split: Cash)`,
        });
      }
      if (validatedSplit.upiQr && validatedSplit.upiQr.greaterThan(0)) {
        const upiAcc = await this.resolvePaymentLedgerAccount(
          tx,
          tenant,
          "UPI",
        );
        voucherLines.push({
          accountId: upiAcc.id,
          debitAmount: validatedSplit.upiQr.toNumber(),
          creditAmount: 0,
          lineNarration: `Sales Bill #${invoiceNumber} (Split: UPI)`,
        });
      }
      if (
        validatedSplit.bankTransfer &&
        validatedSplit.bankTransfer.greaterThan(0)
      ) {
        const bankAcc = await this.resolvePaymentLedgerAccount(
          tx,
          tenant,
          "BANK",
        );
        voucherLines.push({
          accountId: bankAcc.id,
          debitAmount: validatedSplit.bankTransfer.toNumber(),
          creditAmount: 0,
          lineNarration: `Sales Bill #${invoiceNumber} (Split: Bank Transfer)`,
        });
      }
      if (validatedSplit.card && validatedSplit.card.greaterThan(0)) {
        const cardAcc = await this.resolvePaymentLedgerAccount(
          tx,
          tenant,
          "CARD",
        );
        voucherLines.push({
          accountId: cardAcc.id,
          debitAmount: validatedSplit.card.toNumber(),
          creditAmount: 0,
          lineNarration: `Sales Bill #${invoiceNumber} (Split: Card)`,
        });
      }
      if (validatedSplit.cheque && validatedSplit.cheque.greaterThan(0)) {
        const chequeAcc = await this.resolvePaymentLedgerAccount(
          tx,
          tenant,
          "BANK",
        );
        voucherLines.push({
          accountId: chequeAcc.id,
          debitAmount: validatedSplit.cheque.toNumber(),
          creditAmount: 0,
          lineNarration: `Sales Bill #${invoiceNumber} (Split: Cheque)`,
        });
      }
    } else if (paymentMode === PaymentMode.UPI_QR) {
      const upiAcc = await this.resolvePaymentLedgerAccount(tx, tenant, "UPI");
      voucherLines.push({
        accountId: upiAcc.id,
        debitAmount: taxCalc.grandTotal.toNumber(),
        creditAmount: 0,
        lineNarration: `Sales Bill #${invoiceNumber} (UPI)`,
      });
    } else if (
      paymentMode === PaymentMode.BANK_TRANSFER ||
      paymentMode === PaymentMode.CHEQUE
    ) {
      const bankAcc = await this.resolvePaymentLedgerAccount(
        tx,
        tenant,
        "BANK",
      );
      voucherLines.push({
        accountId: bankAcc.id,
        debitAmount: taxCalc.grandTotal.toNumber(),
        creditAmount: 0,
        lineNarration: `Sales Bill #${invoiceNumber} (${paymentMode})`,
      });
    } else {
      // CASH or other cash-like tender
      const cashAcc = await this.resolvePaymentLedgerAccount(
        tx,
        tenant,
        "CASH",
      );
      voucherLines.push({
        accountId: cashAcc.id,
        debitAmount: taxCalc.grandTotal.toNumber(),
        creditAmount: 0,
        lineNarration: `Sales Bill #${invoiceNumber} (Cash)`,
      });
    }

    // CR Sales Account for Taxable Amount
    voucherLines.push({
      accountId: salesAccount.id,
      debitAmount: 0,
      creditAmount: taxCalc.taxableAmount.toNumber(),
      lineNarration: `Taxable sales #${invoiceNumber}`,
    });

    // CR Taxes
    if (taxCalc.cgstAmount.greaterThan(0)) {
      const cgstAcc = await this.findAccountByName(
        tx,
        tenant.companyId,
        "Output CGST",
      );
      voucherLines.push({
        accountId: cgstAcc.id,
        debitAmount: 0,
        creditAmount: taxCalc.cgstAmount.toNumber(),
        lineNarration: `CGST Output #${invoiceNumber}`,
      });
    }

    if (taxCalc.sgstAmount.greaterThan(0)) {
      const sgstAcc = await this.findAccountByName(
        tx,
        tenant.companyId,
        "Output SGST",
      );
      voucherLines.push({
        accountId: sgstAcc.id,
        debitAmount: 0,
        creditAmount: taxCalc.sgstAmount.toNumber(),
        lineNarration: `SGST Output #${invoiceNumber}`,
      });
    }

    if (taxCalc.utgstAmount?.greaterThan(0)) {
      const utgstAcc = await this.findOrCreateOutputUtgst(tx, tenant);
      voucherLines.push({
        accountId: utgstAcc.id,
        debitAmount: 0,
        creditAmount: taxCalc.utgstAmount.toNumber(),
        lineNarration: `UTGST Output #${invoiceNumber}`,
      });
    }

    if (taxCalc.igstAmount.greaterThan(0)) {
      const igstAcc = await this.findAccountByName(
        tx,
        tenant.companyId,
        "Output IGST",
      );
      voucherLines.push({
        accountId: igstAcc.id,
        debitAmount: 0,
        creditAmount: taxCalc.igstAmount.toNumber(),
        lineNarration: `IGST Output #${invoiceNumber}`,
      });
    }

    // CR/DR Round Off
    if (!taxCalc.roundOff.isZero()) {
      const roundOffAcc = await this.findAccountByName(
        tx,
        tenant.companyId,
        "Round Off Account",
      );
      if (taxCalc.roundOff.greaterThan(0)) {
        voucherLines.push({
          accountId: roundOffAcc.id,
          debitAmount: 0,
          creditAmount: taxCalc.roundOff.toNumber(),
          lineNarration: `Round off #${invoiceNumber}`,
        });
      } else {
        voucherLines.push({
          accountId: roundOffAcc.id,
          debitAmount: taxCalc.roundOff.abs().toNumber(),
          creditAmount: 0,
          lineNarration: `Round off #${invoiceNumber}`,
        });
      }
    }

    const validation = validateJournalLines(voucherLines);
    if (!validation.isValid) {
      throw new BadRequestException(
        `Voucher double-entry invariant failure: ${validation.errors.join("; ")}`,
      );
    }

    const voucherNumber = `SL/${invoiceNumber}`;
    const voucher = await tx.voucher.create({
      data: {
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        financialYearId,
        voucherType: "SALES" as any,
        voucherNumber,
        voucherDate,
        referenceNo: invoiceNumber,
        narration: `Sales Bill No. ${invoiceNumber} to ${party.name}`,
        narrationGujarati: `વેચાણ બિલ નં. ${invoiceNumber} - ${party.nameGujarati || party.name}`,
        totalAmount: taxCalc.grandTotal.toNumber(),
        isAutoGenerated: true,
        isCancelled: false,
        sourceDocument: "SALES_INVOICE",
        sourceEntityId: invoiceId,
      },
    });

    for (let idx = 0; idx < voucherLines.length; idx++) {
      const vl = voucherLines[idx];
      await tx.journalEntry.create({
        data: {
          voucherId: voucher.id,
          accountId: vl.accountId,
          debitAmount: vl.debitAmount,
          creditAmount: vl.creditAmount,
          lineNarration: vl.lineNarration,
          sequenceOrder: idx + 1,
        },
      });

      const acc = await tx.ledgerAccount.findUnique({
        where: { id: vl.accountId },
        include: { group: true },
      });
      if (acc) {
        const newBal = applyTransactionToBalance(
          acc.group.nature as any,
          acc.currentBalance.toString(),
          toMoney(vl.debitAmount),
          toMoney(vl.creditAmount),
        );
        await tx.ledgerAccount.update({
          where: { id: acc.id },
          data: { currentBalance: newBal.toNumber() },
        });
      }
    }

    return voucher;
  }

  private async ensureRequiredLedgerAccounts(
    tx: any,
    tenant: TenantContext,
    party: any,
  ): Promise<void> {
    // Check if Chart of Accounts has already been seeded for this company
    const cashAcc = await tx.ledgerAccount.findFirst({
      where: { companyId: tenant.companyId, name: "Cash Account" },
    });
    if (!cashAcc) {
      await this.ledgersService.seedStandardChartOfAccounts(tenant);
    }
  }

  private async resolvePaymentLedgerAccount(
    tx: any,
    tenant: TenantContext,
    paymentType: "CASH" | "BANK" | "UPI" | "CARD",
  ): Promise<any> {
    if (paymentType === "CASH") {
      let cashAcc = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          name: "Cash Account",
          isActive: true,
        },
      });
      if (!cashAcc) {
        cashAcc = await tx.ledgerAccount.findFirst({
          where: {
            companyId: tenant.companyId,
            isCashLedger: true,
            isActive: true,
          },
        });
      }
      if (cashAcc) return cashAcc;

      const group = await tx.ledgerGroup.findFirst({
        where: { companyId: tenant.companyId, name: "Cash-in-hand" },
      });
      if (!group) {
        throw new UnprocessableEntityException(
          "No Cash ledger account found, and 'Cash-in-hand' group is missing.",
        );
      }
      try {
        return await tx.ledgerAccount.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            groupId: group.id,
            name: "Cash Account",
            nameGujarati: "રોકડ ખાતું",
            code: "1010",
            isCashLedger: true,
            isBankLedger: false,
            isTaxLedger: false,
            openingBalance: 0.0,
            openingType: "DR",
            currentBalance: 0.0,
            isActive: true,
          },
        });
      } catch {
        return await tx.ledgerAccount.findFirst({
          where: { companyId: tenant.companyId, name: "Cash Account" },
        });
      }
    }

    if (paymentType === "UPI") {
      // 1. Look for explicit UPI Account
      const upiAcc = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          isActive: true,
          OR: [{ name: "UPI Account" }, { name: "UPI Clearing Account" }],
        },
      });
      if (upiAcc) return upiAcc;

      // 2. Look for any active bank account with "UPI" in name
      const upiBank = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          isActive: true,
          isBankLedger: true,
          name: { contains: "UPI", mode: "insensitive" },
        },
      });
      if (upiBank) return upiBank;

      // 3. Look for standard "Bank Account" or active isBankLedger
      const bankAcc = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          isActive: true,
          OR: [{ name: "Bank Account" }, { isBankLedger: true }],
        },
      });
      if (bankAcc) return bankAcc;

      // 4. Auto-provision under "Bank Accounts" group if group exists
      const bankGroup = await tx.ledgerGroup.findFirst({
        where: { companyId: tenant.companyId, name: "Bank Accounts" },
      });
      if (!bankGroup) {
        throw new UnprocessableEntityException(
          "No Bank or UPI ledger account found, and 'Bank Accounts' group is missing in chart of accounts.",
        );
      }
      try {
        return await tx.ledgerAccount.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            groupId: bankGroup.id,
            name: "UPI Account",
            nameGujarati: "યુપીઆઇ ખાતું",
            code: "1040",
            isBankLedger: true,
            isCashLedger: false,
            isTaxLedger: false,
            openingBalance: 0.0,
            openingType: "DR",
            currentBalance: 0.0,
            isActive: true,
          },
        });
      } catch {
        return await tx.ledgerAccount.findFirst({
          where: { companyId: tenant.companyId, name: "UPI Account" },
        });
      }
    }

    if (paymentType === "BANK" || paymentType === "CARD") {
      const preferredName =
        paymentType === "CARD" ? "Card Account" : "Bank Account";
      // 1. Look for preferred name
      const namedAcc = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          name: preferredName,
          isActive: true,
        },
      });
      if (namedAcc) return namedAcc;

      // 2. Look for "Bank Account"
      if (paymentType === "CARD") {
        const bankNamed = await tx.ledgerAccount.findFirst({
          where: {
            companyId: tenant.companyId,
            name: "Bank Account",
            isActive: true,
          },
        });
        if (bankNamed) return bankNamed;
      }

      // 3. Look for any active isBankLedger
      const bankLedger = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          isBankLedger: true,
          isActive: true,
        },
      });
      if (bankLedger) return bankLedger;

      // 4. Auto-provision under "Bank Accounts" group
      const bankGroup = await tx.ledgerGroup.findFirst({
        where: { companyId: tenant.companyId, name: "Bank Accounts" },
      });
      if (!bankGroup) {
        throw new UnprocessableEntityException(
          "No Bank ledger account found, and 'Bank Accounts' group is missing in chart of accounts.",
        );
      }
      try {
        return await tx.ledgerAccount.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            groupId: bankGroup.id,
            name: "Bank Account",
            nameGujarati: "બેંક ખાતું",
            code: "1030",
            isBankLedger: true,
            isCashLedger: false,
            isTaxLedger: false,
            openingBalance: 0.0,
            openingType: "DR",
            currentBalance: 0.0,
            isActive: true,
          },
        });
      } catch {
        return await tx.ledgerAccount.findFirst({
          where: { companyId: tenant.companyId, name: "Bank Account" },
        });
      }
    }

    throw new UnprocessableEntityException(
      `Unsupported payment ledger type: ${paymentType}`,
    );
  }

  private validateAndNormalizeSplitTender(
    tenderedSplit: any,
    grandTotal: Decimal,
  ): {
    cash: Decimal;
    upiQr: Decimal;
    bankTransfer: Decimal;
    card: Decimal;
    cheque: Decimal;
  } {
    if (!tenderedSplit || typeof tenderedSplit !== "object") {
      throw new BadRequestException(
        "Split tender payment requires a valid tenderedSplit breakdown.",
      );
    }

    const parseAmount = (val: any, fieldName: string): Decimal => {
      if (val === undefined || val === null) return toDecimal(0);
      const num = Number(val);
      if (!Number.isFinite(num) || num < 0) {
        throw new BadRequestException(
          `Tender amount for '${fieldName}' must be a non-negative, finite number.`,
        );
      }
      return toMoney(num);
    };

    const cash = parseAmount(tenderedSplit.cash, "cash");
    const upiQr = parseAmount(
      tenderedSplit.upiQr ?? tenderedSplit.upi,
      "upiQr",
    );
    const bankTransfer = parseAmount(
      tenderedSplit.bankTransfer,
      "bankTransfer",
    );
    const card = parseAmount(tenderedSplit.card, "card");
    const cheque = parseAmount(tenderedSplit.cheque, "cheque");

    const totalSplit = cash
      .plus(upiQr)
      .plus(bankTransfer)
      .plus(card)
      .plus(cheque);

    if (totalSplit.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        "At least one tender amount in split payment must be greater than zero.",
      );
    }

    if (!totalSplit.equals(grandTotal)) {
      throw new BadRequestException(
        `Split tender total (₹${totalSplit.toFixed(2)}) does not match invoice grand total (₹${grandTotal.toFixed(2)}).`,
      );
    }

    return { cash, upiQr, bankTransfer, card, cheque };
  }

  private assertMatchingIdempotentSale(
    existing: any,
    dto: CreateSalesInvoiceDto,
  ): void {
    if (dto.partyId && existing.partyId && dto.partyId !== existing.partyId) {
      throw new ConflictException(
        `Conflicting idempotency key reuse: existing invoice belongs to party ${existing.partyId}, but request specified ${dto.partyId}.`,
      );
    }

    const existingItems = existing.items || [];
    if (!dto.items || dto.items.length !== existingItems.length) {
      throw new ConflictException(
        `Conflicting idempotency key reuse: line item count mismatch (existing: ${existingItems.length}, requested: ${dto.items?.length || 0}).`,
      );
    }

    for (const reqItem of dto.items) {
      const match = existingItems.find(
        (ei: any) =>
          ei.itemId === reqItem.itemId &&
          Math.abs(Number(ei.quantity) - Number(reqItem.quantity)) < 0.0001,
      );
      if (!match) {
        throw new ConflictException(
          `Conflicting idempotency key reuse: item details do not match previously created invoice.`,
        );
      }
    }
  }

  private normalizePaymentMode(
    mode?: any,
    defaultMode: PaymentMode = PaymentMode.UNPAID_CREDIT,
  ): PaymentMode {
    if (!mode) return defaultMode;
    const str = String(mode).toUpperCase().trim();
    if (str === "CREDIT" || str === "UNPAID_CREDIT")
      return PaymentMode.UNPAID_CREDIT;
    if (str === "UPI" || str === "UPI_QR") return PaymentMode.UPI_QR;
    if (str === "CASH") return PaymentMode.CASH;
    if (str === "BANK_TRANSFER" || str === "CARD" || str === "NETBANKING")
      return PaymentMode.BANK_TRANSFER;
    if (str === "CHEQUE") return PaymentMode.CHEQUE;
    if (str === "CREDIT_NOTE") return PaymentMode.CREDIT_NOTE;
    if (str === "SPLIT") return PaymentMode.SPLIT;
    return defaultMode;
  }

  private async findOrCreateOutputUtgst(tx: any, tenant: TenantContext) {
    const existing = await tx.ledgerAccount.findFirst({
      where: { companyId: tenant.companyId, name: "Output UTGST" },
    });
    if (existing) return existing;
    const group = await tx.ledgerGroup.findFirst({
      where: { companyId: tenant.companyId, name: "Duties & Taxes" },
    });
    if (!group) {
      throw new NotFoundException(
        "Duties & Taxes ledger group is required before UTGST can be posted.",
      );
    }
    return tx.ledgerAccount.create({
      data: {
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        groupId: group.id,
        name: "Output UTGST",
        nameGujarati: "ચૂકવવાપાત્ર UTGST",
        code: "2140",
        isTaxLedger: true,
        openingType: "CR",
      },
    });
  }

  private async findAccountByName(
    tx: any,
    companyId: string,
    name: string,
  ): Promise<any> {
    let acc = await tx.ledgerAccount.findFirst({
      where: { companyId, name },
    });
    if (!acc) {
      const isSales = name.includes("Sales");
      const isTax =
        name.includes("CGST") ||
        name.includes("SGST") ||
        name.includes("IGST") ||
        name.includes("Tax");
      const isRoundOff = name.includes("Round");

      const groupNature = isSales
        ? "INCOME"
        : isTax
          ? "LIABILITY"
          : isRoundOff
            ? "EXPENSE"
            : "ASSET";
      const groupName = isSales
        ? "Sales Accounts"
        : isTax
          ? "Duties & Taxes"
          : isRoundOff
            ? "Indirect Expenses"
            : "Current Assets";

      let group = await tx.ledgerGroup.findFirst({
        where: { companyId, name: groupName },
      });
      if (!group) {
        group = await tx.ledgerGroup.findFirst({
          where: { companyId, nature: groupNature },
        });
      }
      if (!group) {
        const comp = await tx.company.findUnique({
          where: { id: companyId },
          select: { organizationId: true },
        });
        group = await tx.ledgerGroup.create({
          data: {
            organizationId:
              comp?.organizationId || "00000000-0000-0000-0000-000000000000",
            companyId,
            name: groupName,
            nature: groupNature as any,
            isSystem: true,
          },
        });
      }

      acc = await tx.ledgerAccount.create({
        data: {
          organizationId: group.organizationId,
          companyId,
          groupId: group.id,
          name,
          code: isSales ? "3010" : isTax ? "2010" : "4010",
          isTaxLedger: isTax,
          isCashLedger: false,
          isBankLedger: false,
          openingBalance: 0,
          currentBalance: 0,
          isActive: true,
        },
      });
    }
    return acc;
  }

  private async getOrCreatePartyLedgerAccount(
    tx: any,
    tenant: TenantContext,
    party: any,
  ): Promise<any> {
    if (party.ledgerAccountId) {
      const acc = await tx.ledgerAccount.findUnique({
        where: { id: party.ledgerAccountId },
      });
      if (acc) return acc;
    }

    // Check by partyId
    let acc = await tx.ledgerAccount.findFirst({
      where: { companyId: tenant.companyId, partyId: party.id },
    });
    if (acc) return acc;

    // Check by name
    acc = await tx.ledgerAccount.findFirst({
      where: { companyId: tenant.companyId, name: party.name },
    });
    if (acc) {
      await tx.ledgerAccount.update({
        where: { id: acc.id },
        data: { partyId: party.id, isPartyLedger: true },
      });
      return acc;
    }

    // Create under Sundry Debtors
    let sundryDebtors = await tx.ledgerGroup.findFirst({
      where: { companyId: tenant.companyId, name: "Sundry Debtors" },
    });
    if (!sundryDebtors) {
      sundryDebtors = await tx.ledgerGroup.findFirst({
        where: { companyId: tenant.companyId, nature: "ASSET" },
      });
    }
    if (!sundryDebtors) {
      sundryDebtors = await tx.ledgerGroup.create({
        data: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          name: "Sundry Debtors",
          nameGujarati: "ગ્રાહકો / દેવાદારો",
          nature: "ASSET",
          isSystem: true,
        },
      });
    }

    acc = await tx.ledgerAccount.create({
      data: {
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        groupId: sundryDebtors.id,
        name: party.name,
        nameGujarati: party.nameGujarati,
        isPartyLedger: true,
        partyId: party.id,
        openingType: "DR",
        currentBalance: 0,
      },
    });

    return acc;
  }

  private async calculateMovingAverageDispatch(
    tx: any,
    tenant: TenantContext,
    warehouseId: string,
    item: { id: string; name?: string; purchaseRate?: any; retailPrice?: any },
    issueQuantity: Decimal,
    lineUnitPrice?: any,
  ) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`stock_${warehouseId}_${item.id}`})::bigint)
    `;

    const movements = await tx.stockTransaction.findMany({
      where: {
        companyId: tenant.companyId,
        warehouseId,
        itemId: item.id,
      },
      select: {
        quantity: true,
        totalValuation: true,
      },
    });

    let onHandQty = new Decimal(0);
    let onHandVal = new Decimal(0);
    for (const m of movements) {
      const q = toDecimal(m.quantity);
      onHandQty = onHandQty.plus(q);
      const v = toDecimal(m.totalValuation).abs();
      onHandVal = onHandVal.plus(q.isNegative() ? v.negated() : v);
    }

    let provisionalRate: any = null;
    if (item.purchaseRate && Number(item.purchaseRate) > 0) {
      provisionalRate = item.purchaseRate;
    } else if (item.retailPrice && Number(item.retailPrice) > 0) {
      provisionalRate = item.retailPrice;
    } else if (lineUnitPrice && Number(lineUnitPrice) > 0) {
      provisionalRate = lineUnitPrice;
    } else {
      provisionalRate = new Decimal(0);
    }

    return costMovingAverageIssue({
      onHandQuantity: onHandQty,
      onHandValue: onHandVal,
      issueQuantity,
      provisionalRate,
    });
  }

  /**
   * Complete Production-Ready Sales Return / Credit Note Engine
   */
  async createSalesReturn(
    invoiceId: string,
    dto: CreateSalesReturnDto,
    tenant: TenantContext,
  ): Promise<any> {
    const isAmountBased = dto.creditNoteType === "AMOUNT_BASED";
    if (!isAmountBased && (!dto.items || dto.items.length === 0)) {
      throw new BadRequestException(
        "Sales return / credit note must contain at least one line item.",
      );
    }
    if (isAmountBased && (!dto.items || dto.items.length === 0) && !dto.amount) {
      throw new BadRequestException(
        "Amount-based credit note must specify an adjustment amount.",
      );
    }

    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      // 1. Transactional advisory lock on this specific sales invoice and company return sequence
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`sales_return_${invoiceId}`})::bigint)
      `;
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`sales_return_seq_${tenant.companyId}`})::bigint)
      `;

      // 2. Fetch sales invoice and company
      const [company, invoice] = await Promise.all([
        tx.company.findUnique({
          where: { id: tenant.companyId },
          select: { id: true, stateCode: true, legalName: true },
        }),
        tx.salesInvoice.findFirst({
          where: { id: invoiceId, companyId: tenant.companyId },
          include: {
            items: {
              include: { item: true },
            },
            party: {
              include: { ledgerAccount: true },
            },
            branch: true,
            financialYear: true,
            returns: {
              include: { items: true },
            },
          },
        }),
      ]);

      if (!company) {
        throw new NotFoundException("Company context not found.");
      }
      if (!invoice) {
        throw new NotFoundException(
          `Sales invoice with ID ${invoiceId} not found.`,
        );
      }

      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException(
          "Cannot create a sales return for a cancelled invoice.",
        );
      }
      if (invoice.status === InvoiceStatus.DRAFT) {
        throw new BadRequestException(
          "Cannot create a sales return for a draft invoice.",
        );
      }

      const returnDate = dto.returnDate ? new Date(dto.returnDate) : new Date();

      // 3. Financial Year validation
      const fy =
        (await tx.financialYear.findFirst({
          where: {
            companyId: tenant.companyId,
            startDate: { lte: returnDate },
            endDate: { gte: returnDate },
          },
        })) || invoice.financialYear;

      if (!fy) {
        throw new BadRequestException(
          "No active financial year found for this return date.",
        );
      }
      if (fy.isLocked) {
        throw new BadRequestException(
          "Cannot create sales return in a locked financial year.",
        );
      }

      // 4. Calculate previously returned quantities per line item
      const returnedQtyMap = new Map<string, Decimal>();
      for (const ret of invoice.returns) {
        for (const itm of ret.items) {
          if (!itm.salesItemId) continue;
          const prev = returnedQtyMap.get(itm.salesItemId) || new Decimal(0);
          returnedQtyMap.set(
            itm.salesItemId,
            prev.plus(toDecimal(itm.quantity)),
          );
        }
      }

      // 5. Line items verification and calculation
      const isIntraState = invoice.placeOfSupply
        ? invoice.placeOfSupply === company.stateCode
        : true;
      let sumTaxable = new Decimal(0);
      let sumCgst = new Decimal(0);
      let sumSgst = new Decimal(0);
      let sumIgst = new Decimal(0);

      const returnItemsData: Array<{
        salesItemId?: string;
        itemId?: string;
        description?: string;
        quantity: Decimal;
        unitPrice: Decimal;
        taxableAmount: Decimal;
        taxRate: Decimal;
        cgstAmount: Decimal;
        sgstAmount: Decimal;
        igstAmount: Decimal;
        totalAmount: Decimal;
        disposition?: string;
      }> = [];

      const isCommercial = dto.gstCategory === "COMMERCIAL";

      if (isAmountBased) {
        const rawAmount = toDecimal(
          dto.amount || (dto.items && dto.items[0]?.taxableAmount) || 0,
        );
        if (rawAmount.lte(0)) {
          throw new BadRequestException(
            "Adjustment amount must be strictly greater than 0.",
          );
        }

        const taxRate = isCommercial
          ? new Decimal(0)
          : toDecimal(dto.taxRate || (dto.items && dto.items[0]?.taxRate) || 0);

        sumTaxable = rawAmount;
        if (!isCommercial && taxRate.gt(0)) {
          const taxAmount = sumTaxable
            .times(taxRate)
            .dividedBy(100)
            .toDecimalPlaces(2);
          if (isIntraState) {
            sumCgst = taxAmount.dividedBy(2).toDecimalPlaces(2);
            sumSgst = taxAmount.minus(sumCgst);
          } else {
            sumIgst = taxAmount;
          }
        }

        const totalAmount = sumTaxable.plus(sumCgst).plus(sumSgst).plus(sumIgst);
        if (totalAmount.gt(toDecimal(invoice.grandTotal))) {
          throw new BadRequestException(
            `Credit amount ${totalAmount.toFixed(2)} exceeds original invoice total ${invoice.grandTotal}.`,
          );
        }

        returnItemsData.push({
          salesItemId: invoice.items[0]?.id,
          itemId: invoice.items[0]?.itemId,
          description:
            dto.reason ||
            (dto.items && dto.items[0]?.description) ||
            "Credit Note Adjustment",
          quantity: new Decimal(1),
          unitPrice: sumTaxable,
          taxableAmount: sumTaxable,
          taxRate,
          cgstAmount: sumCgst,
          sgstAmount: sumSgst,
          igstAmount: sumIgst,
          totalAmount,
        });
      } else {
        for (const line of dto.items || []) {
          const qty = toDecimal(line.quantity !== undefined ? line.quantity : 1);
          if (qty.lte(0)) {
            throw new BadRequestException(
              "Return quantity must be strictly greater than 0.",
            );
          }

          const targetId = line.salesItemId || line.invoiceItemId;
          const origLine = invoice.items.find((i) => i.id === targetId);
          if (!origLine) {
            throw new BadRequestException(
              `Sales line item ${targetId} not found in this invoice.`,
            );
          }

          const alreadyReturned =
            returnedQtyMap.get(origLine.id) || new Decimal(0);
          const originalQty = toDecimal(origLine.quantity);
          const availableQty = originalQty.minus(alreadyReturned);

          if (availableQty.lte(0)) {
            throw new BadRequestException(
              `Item ${origLine.item.name} has already been fully returned.`,
            );
          }

          if (qty.gt(availableQty)) {
            throw new BadRequestException(
              `Return quantity ${qty.toFixed(2)} exceeds remaining returnable quantity ${availableQty.toFixed(2)} for item ${origLine.item.name}.`,
            );
          }

          // Update running tracker in case DTO has duplicate lines for same item
          returnedQtyMap.set(origLine.id, alreadyReturned.plus(qty));

          const unitPrice = toDecimal(
            line.unitPrice !== undefined ? line.unitPrice : origLine.unitPrice,
          );
          const taxable = qty.times(unitPrice).toDecimalPlaces(2);
          const taxRate = isCommercial
            ? new Decimal(0)
            : toDecimal(line.taxRate !== undefined ? line.taxRate : origLine.taxRate);
          const taxAmount = isCommercial
            ? new Decimal(0)
            : taxable
                .times(taxRate)
                .dividedBy(100)
                .toDecimalPlaces(2);

          let cgst = new Decimal(0);
          let sgst = new Decimal(0);
          let igst = new Decimal(0);

          if (!isCommercial) {
            const lineIsIntra =
              origLine.cgstAmount.gt(0) ||
              origLine.sgstAmount.gt(0) ||
              isIntraState;
            if (lineIsIntra && !origLine.igstAmount.gt(0)) {
              cgst = taxAmount.dividedBy(2).toDecimalPlaces(2);
              sgst = taxAmount.minus(cgst);
            } else {
              igst = taxAmount;
            }
          }

          const totalAmount = taxable.plus(cgst).plus(sgst).plus(igst);

          sumTaxable = sumTaxable.plus(taxable);
          sumCgst = sumCgst.plus(cgst);
          sumSgst = sumSgst.plus(sgst);
          sumIgst = sumIgst.plus(igst);

          returnItemsData.push({
            salesItemId: origLine.id,
            itemId: origLine.itemId,
            description:
              line.description || origLine.description || origLine.item?.name,
            quantity: qty,
            unitPrice,
            taxableAmount: taxable,
            taxRate,
            cgstAmount: cgst,
            sgstAmount: sgst,
            igstAmount: igst,
            totalAmount,
            disposition: line.disposition || dto.disposition,
          });
        }
      }

      const grandTotal = sumTaxable.plus(sumCgst).plus(sumSgst).plus(sumIgst);

      // 6. Resolve Warehouse
      let warehouseId = dto.warehouseId;
      if (!warehouseId) {
        const origStockTx = await tx.stockTransaction.findFirst({
          where: {
            companyId: tenant.companyId,
            referenceDocType: "SALES_INVOICE",
            referenceDocId: invoice.id,
          },
        });
        if (origStockTx) {
          warehouseId = origStockTx.warehouseId;
        } else {
          const defaultWh = await tx.warehouse.findFirst({
            where: { companyId: tenant.companyId, isDefault: true },
          });
          warehouseId =
            defaultWh?.id ||
            (
              await tx.warehouse.findFirst({
                where: { companyId: tenant.companyId },
              })
            )?.id;

          if (!warehouseId) {
            const resolvedBranchId = invoice.branchId || tenant.branchId;
            if (resolvedBranchId) {
              const newWh = await tx.warehouse.create({
                data: {
                  organizationId: tenant.organizationId,
                  companyId: tenant.companyId,
                  branchId: resolvedBranchId,
                  name: "Main Warehouse",
                  isDefault: true,
                },
              });
              warehouseId = newWh.id;
            }
          }
        }
      }

      // 7. Generate guaranteed-unique Return Number (Credit Note number)
      const existingReturns = await tx.salesReturn.findMany({
        where: { companyId: tenant.companyId },
        select: { returnNumber: true },
      });
      const existingSet = new Set(
        existingReturns
          .map((r) => r.returnNumber?.trim().toUpperCase())
          .filter(Boolean) as string[],
      );

      const docType = dto.docType || "SALES_RETURN";
      const year = returnDate.getFullYear();
      const defaultPrefix =
        docType === "CREDIT_NOTE"
          ? `CN-${year}-`
          : dto.returnNumber?.startsWith("SR-")
            ? `SR-${year}-`
            : `CN-${year}-`;

      let maxSeq = 0;
      for (const r of existingReturns) {
        if (!r.returnNumber) continue;
        const raw = r.returnNumber.trim();
        if (raw.startsWith(defaultPrefix)) {
          const num = parseInt(raw.slice(defaultPrefix.length), 10);
          if (!isNaN(num) && num > maxSeq) {
            maxSeq = num;
          }
        } else {
          const match = raw.match(/(\d+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > maxSeq) {
              maxSeq = num;
            }
          }
        }
      }

      let returnNumber = dto.returnNumber?.trim();
      if (returnNumber) {
        if (existingSet.has(returnNumber.toUpperCase())) {
          // If custom returnNumber already exists, auto-generate next sequential candidate
          let nextSeq = Math.max(maxSeq + 1, existingReturns.length + 1);
          let generated = `${defaultPrefix}${String(nextSeq).padStart(4, "0")}`;
          while (existingSet.has(generated.toUpperCase())) {
            nextSeq++;
            generated = `${defaultPrefix}${String(nextSeq).padStart(4, "0")}`;
          }
          returnNumber = generated;
        }
      } else {
        let nextSeq = Math.max(maxSeq + 1, existingReturns.length + 1);
        let generated = `${defaultPrefix}${String(nextSeq).padStart(4, "0")}`;
        while (existingSet.has(generated.toUpperCase())) {
          nextSeq++;
          generated = `${defaultPrefix}${String(nextSeq).padStart(4, "0")}`;
        }
        returnNumber = generated;
      }

      const settlementMode = dto.settlementMode || "CUSTOMER_CREDIT";
      let refundAmount = new Decimal(0);
      let allocatedAmount = new Decimal(0);
      let remainingCredit = grandTotal;

      if (settlementMode === "REFUND_CASH" || settlementMode === "REFUND_BANK") {
        refundAmount = grandTotal;
        remainingCredit = new Decimal(0);
      } else if (settlementMode === "ADJUST_OUTSTANDING") {
        allocatedAmount = grandTotal;
        remainingCredit = new Decimal(0);
      }

      // 8. Create SalesReturn and SalesReturnItem records
      const salesReturn = await tx.salesReturn.create({
        data: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          branchId: invoice.branchId,
          financialYearId: fy.id,
          salesInvoiceId: invoice.id,
          partyId: invoice.partyId,
          returnNumber,
          returnDate,
          reason:
            dto.reason ||
            (docType === "CREDIT_NOTE"
              ? "Credit note adjustment"
              : "Goods returned by customer"),
          reasonGujarati:
            dto.reasonGujarati ||
            (docType === "CREDIT_NOTE"
              ? "ક્રેડિટ નોટ જારી કરી"
              : "ગ્રાહક દ્વારા માલ પરત મળ્યો"),
          taxableAmount: sumTaxable.toFixed(2),
          cgstAmount: sumCgst.toFixed(2),
          sgstAmount: sumSgst.toFixed(2),
          igstAmount: sumIgst.toFixed(2),
          grandTotal: grandTotal.toFixed(2),
          status: "ISSUED",
          docType,
          creditNoteType:
            dto.creditNoteType || (isAmountBased ? "AMOUNT_BASED" : "ITEM_BASED"),
          gstCategory: dto.gstCategory || "SECTION_34",
          disposition: dto.disposition || "SELLABLE",
          warehouseId,
          linkedReturnId: dto.linkedReturnId || null,
          settlementMode,
          refundAmount: refundAmount.toFixed(2),
          allocatedAmount: allocatedAmount.toFixed(2),
          remainingCredit: remainingCredit.toFixed(2),
          notes: dto.notes || null,
          items: {
            create: returnItemsData.map((item) => ({
              salesItemId: item.salesItemId || null,
              itemId: item.itemId || null,
              description: item.description || null,
              quantity: item.quantity.toFixed(4),
              unitPrice: item.unitPrice.toFixed(4),
              taxableAmount: item.taxableAmount.toFixed(2),
              taxRate: item.taxRate.toFixed(2),
              cgstAmount: item.cgstAmount.toFixed(2),
              sgstAmount: item.sgstAmount.toFixed(2),
              igstAmount: item.igstAmount.toFixed(2),
              totalAmount: item.totalAmount.toFixed(2),
            })),
          },
        },
        include: {
          items: {
            include: { item: true, salesItem: true },
          },
          party: true,
          salesInvoice: true,
          warehouse: true,
        },
      });

      // 9. Stock Restoration (SALES_RETURN) if accepted and warehouse available
      // Note: Credit Note must NEVER modify physical stock!
      const shouldRestore =
        docType !== "CREDIT_NOTE" && dto.restoreStock !== false;
      if (shouldRestore && warehouseId) {
        for (const line of returnItemsData) {
          if (!line.itemId) continue;
          if (
            line.disposition === "DAMAGED" ||
            line.disposition === "SCRAPPED"
          ) {
            continue;
          }
          // Restore stock at original dispatch valuation rate (cost of sales), not customer selling price
          const origDispatch = await tx.stockTransaction.findFirst({
            where: {
              companyId: tenant.companyId,
              referenceDocType: "SALES_INVOICE",
              referenceDocId: invoice.id,
              itemId: line.itemId,
              transactionType: StockTransactionType.SALES_DISPATCH as any,
            },
            orderBy: { createdAt: "desc" },
          });
          const origLine = invoice.items.find((i) => i.id === line.salesItemId);
          const restoredRate = origDispatch
            ? toDecimal(origDispatch.valuationRate)
            : toDecimal(origLine?.item?.purchaseRate || line.unitPrice);
          const restoredValuation = line.quantity.mul(restoredRate);

          await tx.stockTransaction.create({
            data: {
              organizationId: tenant.organizationId,
              companyId: tenant.companyId,
              warehouseId,
              itemId: line.itemId,
              transactionType: StockTransactionType.SALES_RETURN as any,
              transactionDate: returnDate,
              quantity: line.quantity.toFixed(4), // Positive for inward stock restoration
              valuationRate: restoredRate.toFixed(4),
              totalValuation: restoredValuation.toFixed(2),
              isProvisionalCost: false,
              costVariance: 0,
              referenceDocType: "SALES_RETURN",
              referenceDocId: salesReturn.id,
            },
          });
        }
      }

      // 10. Credit Note Voucher Posting
      // Reverse the exact sales ledger account credited on the original invoice
      let salesAccount: any = null;
      const origVoucher = await tx.voucher.findFirst({
        where: {
          companyId: tenant.companyId,
          sourceEntityId: invoice.id,
          voucherType: VoucherType.SALES,
        },
        include: {
          journalEntries: {
            include: {
              account: { include: { group: true } },
            },
            orderBy: { sequenceOrder: "asc" },
          },
        },
      });

      if (origVoucher) {
        const origSalesEntry = origVoucher.journalEntries.find(
          (je: any) =>
            je.account?.group?.nature === AccountNature.INCOME &&
            toDecimal(je.creditAmount).gt(0),
        );
        if (origSalesEntry) {
          salesAccount = origSalesEntry.account;
        }
      }

      if (!salesAccount) {
        const salesAccountName = isIntraState
          ? "General Sales Account"
          : "Inter-State Sales Account";

        salesAccount = await tx.ledgerAccount.findFirst({
          where: {
            companyId: tenant.companyId,
            OR: [
              { name: salesAccountName },
              { name: { contains: "Sales", mode: "insensitive" } },
              { code: "4010" },
            ],
          },
        });
      }

      const outputCgstAccount = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          OR: [
            { name: "Output CGST" },
            { name: { contains: "Output CGST", mode: "insensitive" } },
            { code: "2110" },
          ],
        },
      });

      const outputSgstAccount = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          OR: [
            { name: "Output SGST" },
            { name: { contains: "Output SGST", mode: "insensitive" } },
            { code: "2120" },
          ],
        },
      });

      const outputIgstAccount = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          OR: [
            { name: "Output IGST" },
            { name: { contains: "Output IGST", mode: "insensitive" } },
            { code: "2130" },
          ],
        },
      });

      let customerAccount = invoice.party.ledgerAccount;
      if (!customerAccount) {
        customerAccount = await this.getOrCreatePartyLedgerAccount(
          tx,
          tenant,
          invoice.party,
        );
      }

      if (salesAccount && customerAccount) {
        // Concurrency lock for credit note voucher sequence in this company & FY
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`seq_${tenant.companyId}_${fy.id}_voucher_CREDIT_NOTE`})::bigint)
        `;

        const existingCreditNoteVouchers = await tx.voucher.findMany({
          where: {
            companyId: tenant.companyId,
            financialYearId: fy.id,
            voucherType: VoucherType.CREDIT_NOTE,
          },
          select: { voucherNumber: true },
        });

        const existingVoucherSet = new Set(
          existingCreditNoteVouchers
            .map((v) => v.voucherNumber?.trim().toUpperCase())
            .filter(Boolean) as string[],
        );

        const vYear = returnDate.getFullYear();
        const vPrefix = `V-CN-${vYear}-`;

        let maxVSeq = 0;
        for (const v of existingCreditNoteVouchers) {
          if (!v.voucherNumber) continue;
          const raw = v.voucherNumber.trim();
          if (raw.toUpperCase().startsWith(vPrefix.toUpperCase())) {
            const num = parseInt(raw.slice(vPrefix.length), 10);
            if (!isNaN(num) && num > maxVSeq) {
              maxVSeq = num;
            }
          } else {
            const match = raw.match(/(\d+)$/);
            if (match) {
              const num = parseInt(match[1], 10);
              if (!isNaN(num) && num > maxVSeq) {
                maxVSeq = num;
              }
            }
          }
        }

        let nextVSeq = Math.max(maxVSeq + 1, existingCreditNoteVouchers.length + 1);
        let voucherNumber = `${vPrefix}${String(nextVSeq).padStart(4, "0")}`;
        while (existingVoucherSet.has(voucherNumber.toUpperCase())) {
          nextVSeq++;
          voucherNumber = `${vPrefix}${String(nextVSeq).padStart(4, "0")}`;
        }

        const journalLines: Array<{
          accountId: string;
          debitAmount: Decimal;
          creditAmount: Decimal;
          lineNarration: string;
          sequenceOrder: number;
        }> = [];

        let seq = 1;

        if (isCommercial) {
          // Commercial Credit Note: Debit Commercial Discounts & Rebates, Credit Customer Account
          let commDiscountAcc = await tx.ledgerAccount.findFirst({
            where: {
              companyId: tenant.companyId,
              OR: [
                { name: "Commercial Discounts & Rebates" },
                { name: { contains: "Commercial Discount", mode: "insensitive" } },
                { code: "5150" },
              ],
            },
          });
          if (!commDiscountAcc) {
            let expGroup = await tx.ledgerGroup.findFirst({
              where: { companyId: tenant.companyId, nature: "EXPENSE" },
            });
            if (!expGroup) {
              expGroup = await tx.ledgerGroup.create({
                data: {
                  organizationId: tenant.organizationId,
                  companyId: tenant.companyId,
                  name: "Indirect Expenses",
                  nature: "EXPENSE",
                  isSystem: true,
                },
              });
            }
            commDiscountAcc = await tx.ledgerAccount.create({
              data: {
                organizationId: tenant.organizationId,
                companyId: tenant.companyId,
                groupId: expGroup.id,
                name: "Commercial Discounts & Rebates",
                code: "5150",
                openingType: "DR",
                openingBalance: "0.00",
                currentBalance: "0.00",
              },
            });
          }

          journalLines.push({
            accountId: commDiscountAcc.id,
            debitAmount: grandTotal,
            creditAmount: new Decimal(0),
            lineNarration: `Commercial discount on credit note ${returnNumber}`,
            sequenceOrder: seq++,
          });

          journalLines.push({
            accountId: customerAccount.id,
            debitAmount: new Decimal(0),
            creditAmount: grandTotal,
            lineNarration: `Commercial credit note against invoice ${invoice.invoiceNumber} (${invoice.party.name})`,
            sequenceOrder: seq++,
          });
        } else {
          // GST Section 34 / Sales Return: Reverse Sales and Output GST
          // Dr: Sales Account (reducing sales revenue)
          journalLines.push({
            accountId: salesAccount.id,
            debitAmount: sumTaxable,
            creditAmount: new Decimal(0),
            lineNarration: `Sales return/adjustment against invoice ${invoice.invoiceNumber}`,
            sequenceOrder: seq++,
          });

          // Dr: Output CGST Reversal
          if (sumCgst.gt(0)) {
            const acc =
              outputCgstAccount ||
              (await tx.ledgerAccount.findFirst({
                where: {
                  companyId: tenant.companyId,
                  OR: [
                    { name: { contains: "Output CGST", mode: "insensitive" } },
                    { code: "2110" },
                  ],
                },
              }));
            if (acc) {
              journalLines.push({
                accountId: acc.id,
                debitAmount: sumCgst,
                creditAmount: new Decimal(0),
                lineNarration: `CGST Output reversal on credit note ${returnNumber}`,
                sequenceOrder: seq++,
              });
            }
          }

          // Dr: Output SGST Reversal
          if (sumSgst.gt(0)) {
            const acc =
              outputSgstAccount ||
              (await tx.ledgerAccount.findFirst({
                where: {
                  companyId: tenant.companyId,
                  OR: [
                    { name: { contains: "Output SGST", mode: "insensitive" } },
                    { code: "2120" },
                  ],
                },
              }));
            if (acc) {
              journalLines.push({
                accountId: acc.id,
                debitAmount: sumSgst,
                creditAmount: new Decimal(0),
                lineNarration: `SGST Output reversal on credit note ${returnNumber}`,
                sequenceOrder: seq++,
              });
            }
          }

          // Dr: Output IGST Reversal
          if (sumIgst.gt(0)) {
            const acc =
              outputIgstAccount ||
              (await tx.ledgerAccount.findFirst({
                where: {
                  companyId: tenant.companyId,
                  OR: [
                    { name: { contains: "Output IGST", mode: "insensitive" } },
                    { code: "2130" },
                  ],
                },
              }));
            if (acc) {
              journalLines.push({
                accountId: acc.id,
                debitAmount: sumIgst,
                creditAmount: new Decimal(0),
                lineNarration: `IGST Output reversal on credit note ${returnNumber}`,
                sequenceOrder: seq++,
              });
            }
          }

          // Cr: Customer Account (reducing accounts receivable asset)
          journalLines.push({
            accountId: customerAccount.id,
            debitAmount: new Decimal(0),
            creditAmount: grandTotal,
            lineNarration: `Credit Note against invoice ${invoice.invoiceNumber} (${invoice.party.name})`,
            sequenceOrder: seq++,
          });
        }

        // Validate double-entry debits == credits invariant
        const validation = validateJournalLines(
          journalLines.map((jl) => ({
            accountId: jl.accountId,
            debitAmount: jl.debitAmount.toNumber(),
            creditAmount: jl.creditAmount.toNumber(),
            lineNarration: jl.lineNarration,
          })),
        );
        if (!validation.isValid) {
          throw new BadRequestException(
            `Credit Note double-entry invariant failure: ${validation.errors.join("; ")}`,
          );
        }

        const voucher = await tx.voucher.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            financialYearId: fy.id,
            voucherType: VoucherType.CREDIT_NOTE,
            voucherNumber,
            voucherDate: returnDate,
            referenceNo: returnNumber,
            narration: `${docType === "CREDIT_NOTE" ? "Credit note" : "Sales return"} ${returnNumber} against invoice ${invoice.invoiceNumber}`,
            narrationGujarati: `${docType === "CREDIT_NOTE" ? "ક્રેડિટ નોટ" : "વેચાણ પરત"} ${returnNumber} - ઇનવોઇસ ${invoice.invoiceNumber} સામે`,
            totalAmount: grandTotal.toFixed(2),
            isAutoGenerated: true,
            sourceDocument: docType === "CREDIT_NOTE" ? "CREDIT_NOTE" : "SALES_RETURN",
            sourceEntityId: salesReturn.id,
            journalEntries: {
              create: journalLines.map((jl) => ({
                accountId: jl.accountId,
                debitAmount: jl.debitAmount.toFixed(2),
                creditAmount: jl.creditAmount.toFixed(2),
                lineNarration: jl.lineNarration,
                sequenceOrder: jl.sequenceOrder,
              })),
            },
          },
        });

        // Update Account Balances
        for (const jl of journalLines) {
          const acc = await tx.ledgerAccount.findUnique({
            where: { id: jl.accountId },
            include: { group: true },
          });
          if (acc) {
            const newBal = applyTransactionToBalance(
              acc.group.nature as any,
              acc.currentBalance.toString(),
              jl.debitAmount,
              jl.creditAmount,
            );
            await tx.ledgerAccount.update({
              where: { id: acc.id },
              data: { currentBalance: newBal.toNumber() },
            });
          }
        }

        await tx.salesReturn.update({
          where: { id: salesReturn.id },
          data: { voucherId: voucher.id },
        });
        salesReturn.voucherId = voucher.id;

        // If settlementMode is REFUND_CASH or REFUND_BANK, post refund voucher
        if (settlementMode === "REFUND_CASH" || settlementMode === "REFUND_BANK") {
          const searchKeyword = settlementMode === "REFUND_CASH" ? "Cash" : "Bank";
          const refundAssetAcc = await tx.ledgerAccount.findFirst({
            where: {
              companyId: tenant.companyId,
              OR: [
                { name: { contains: searchKeyword, mode: "insensitive" } },
                { code: settlementMode === "REFUND_CASH" ? "1010" : "1020" },
              ],
            },
          });
          if (refundAssetAcc) {
            const refundVoucherNumber = `REF-${returnNumber}`;
            await tx.voucher.create({
              data: {
                organizationId: tenant.organizationId,
                companyId: tenant.companyId,
                financialYearId: fy.id,
                voucherType: VoucherType.PAYMENT,
                voucherNumber: refundVoucherNumber,
                voucherDate: returnDate,
                referenceNo: returnNumber,
                narration: `Refund (${settlementMode === "REFUND_CASH" ? "Cash" : "Bank"}) for ${docType} ${returnNumber}`,
                totalAmount: grandTotal.toFixed(2),
                isAutoGenerated: true,
                sourceDocument: "SALES_RETURN_REFUND",
                sourceEntityId: salesReturn.id,
                journalEntries: {
                  create: [
                    {
                      accountId: customerAccount.id,
                      debitAmount: grandTotal.toFixed(2),
                      creditAmount: "0.00",
                      lineNarration: `Refund payment to customer for ${returnNumber}`,
                      sequenceOrder: 1,
                    },
                    {
                      accountId: refundAssetAcc.id,
                      debitAmount: "0.00",
                      creditAmount: grandTotal.toFixed(2),
                      lineNarration: `Payout from ${refundAssetAcc.name} for ${returnNumber}`,
                      sequenceOrder: 2,
                    },
                  ],
                },
              },
            });

            // Update ledger account balances for refund
            const custBal = applyTransactionToBalance(
              AccountNature.ASSET,
              customerAccount.currentBalance.toString(),
              grandTotal,
              new Decimal(0),
            );
            await tx.ledgerAccount.update({
              where: { id: customerAccount.id },
              data: { currentBalance: custBal.toNumber() },
            });

            const assetAccDetail = await tx.ledgerAccount.findUnique({
              where: { id: refundAssetAcc.id },
              include: { group: true },
            });
            if (assetAccDetail?.group) {
              const assetBal = applyTransactionToBalance(
                assetAccDetail.group.nature as any,
                assetAccDetail.currentBalance.toString(),
                new Decimal(0),
                grandTotal,
              );
              await tx.ledgerAccount.update({
                where: { id: refundAssetAcc.id },
                data: { currentBalance: assetBal.toNumber() },
              });
            }
          }
        }
      }

      // 11. Reconcile Sales Invoice Balance & Status.
      // A return larger than the unpaid balance is a credit owed to the customer.
      const currentBalance = toDecimal(invoice.balanceAmount);
      const newBalance = currentBalance.minus(grandTotal);

      let newStatus = invoice.status;
      if (newBalance.lte(0)) {
        newStatus = InvoiceStatus.PAID;
      }

      await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          balanceAmount: newBalance.toFixed(2),
          status: newStatus,
        },
      });

      // 12. Audit Log
      await this.audit.record({
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId || "",
        action: "CREATE_SALES_RETURN",
        entityName: "SalesReturn",
        entityId: salesReturn.id,
        newState: {
          returnNumber,
          salesInvoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          partyId: invoice.partyId,
          partyName: invoice.party.name,
          grandTotal: grandTotal.toFixed(2),
          itemsCount: returnItemsData.length,
        },
      });

      return salesReturn;
    });
  }

  async getSalesReturnsForInvoice(
    invoiceId: string,
    tenant: TenantContext,
  ): Promise<any[]> {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.salesReturn.findMany({
        where: {
          companyId: tenant.companyId,
          salesInvoiceId: invoiceId,
        },
        include: {
          items: {
            include: { item: true, salesItem: true },
          },
          party: true,
        },
        orderBy: { returnDate: "desc" },
      });
    });
  }

  async getSalesReturns(
    dto: QuerySalesReturnsDto,
    tenant: TenantContext,
  ): Promise<{ data: any[]; total: number; limit: number; offset: number; nextNumber?: string }> {
    const limit = Math.min(Number(dto.limit) || 50, 100);
    const offset = Number(dto.offset) || 0;

    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const where: any = {
        companyId: tenant.companyId,
      };

      if (dto.docType) {
        where.docType = dto.docType;
      }
      if (dto.warehouseId) {
        where.warehouseId = dto.warehouseId;
      }
      if (dto.settlementMode) {
        where.settlementMode = dto.settlementMode;
      }
      if (dto.gstCategory) {
        where.gstCategory = dto.gstCategory;
      }
      if (dto.disposition) {
        where.disposition = dto.disposition;
      }
      if (dto.partyId) {
        where.partyId = dto.partyId;
      }
      if (dto.salesInvoiceId) {
        where.salesInvoiceId = dto.salesInvoiceId;
      }
      if (dto.startDate || dto.endDate) {
        where.returnDate = {};
        if (dto.startDate) where.returnDate.gte = new Date(dto.startDate);
        if (dto.endDate) where.returnDate.lte = new Date(dto.endDate);
      }
      if (dto.search) {
        where.OR = [
          { returnNumber: { contains: dto.search, mode: "insensitive" } },
          {
            salesInvoice: {
              invoiceNumber: { contains: dto.search, mode: "insensitive" },
            },
          },
          { party: { name: { contains: dto.search, mode: "insensitive" } } },
        ];
      }

      const [data, total] = await Promise.all([
        tx.salesReturn.findMany({
          where,
          include: {
            party: {
              select: {
                id: true,
                name: true,
                nameGujarati: true,
                gstin: true,
                phone: true,
              },
            },
            salesInvoice: {
              select: {
                id: true,
                invoiceNumber: true,
                invoiceDate: true,
                grandTotal: true,
                status: true,
              },
            },
            branch: {
              select: { id: true, name: true },
            },
            financialYear: {
              select: { id: true, name: true },
            },
            warehouse: {
              select: { id: true, name: true },
            },
            items: {
              include: {
                item: {
                  select: { id: true, name: true, sku: true, hsnCode: true },
                },
              },
            },
          },
          orderBy: { returnDate: "desc" },
          take: limit,
          skip: offset,
        }),
        tx.salesReturn.count({ where }),
      ]);

      // Calculate next available sequence return number
      const docType = dto.docType || "SALES_RETURN";
      const prefix =
        docType === "CREDIT_NOTE"
          ? `CN-${new Date().getFullYear()}-`
          : `SR-${new Date().getFullYear()}-`;
      const existingReturns = await tx.salesReturn.findMany({
        where: { companyId: tenant.companyId },
        select: { returnNumber: true },
      });
      let maxSeq = 0;
      const existingSet = new Set<string>();
      for (const r of existingReturns) {
        if (r.returnNumber) {
          existingSet.add(r.returnNumber.trim().toUpperCase());
          const raw = r.returnNumber.trim();
          if (raw.startsWith(prefix)) {
            const num = parseInt(raw.slice(prefix.length), 10);
            if (!isNaN(num) && num > maxSeq) maxSeq = num;
          } else {
            const match = raw.match(/(\d+)$/);
            if (match) {
              const num = parseInt(match[1], 10);
              if (!isNaN(num) && num > maxSeq) maxSeq = num;
            }
          }
        }
      }
      let nextSeq = Math.max(maxSeq + 1, total + 1);
      let nextNumber = `${prefix}${String(nextSeq).padStart(4, "0")}`;
      while (existingSet.has(nextNumber.toUpperCase())) {
        nextSeq++;
        nextNumber = `${prefix}${String(nextSeq).padStart(4, "0")}`;
      }

      return { data, total, limit, offset, nextNumber };
    });
  }

  async getSalesReturnById(id: string, tenant: TenantContext) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const salesReturn = await tx.salesReturn.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          party: true,
          salesInvoice: {
            include: {
              items: {
                include: { item: true },
              },
            },
          },
          items: {
            include: {
              item: {
                include: { primaryUom: true },
              },
              salesItem: true,
            },
          },
          branch: true,
          financialYear: true,
          warehouse: true,
        },
      });

      if (!salesReturn) {
        throw new NotFoundException(`Sales return with ID ${id} not found.`);
      }

      return salesReturn;
    });
  }

  async createCreditNoteFromSalesReturn(
    returnId: string,
    tenant: TenantContext,
  ): Promise<any> {
    const salesReturn = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.salesReturn.findFirst({
        where: { id: returnId, companyId: tenant.companyId },
        include: {
          items: true,
          salesInvoice: true,
          party: true,
        },
      });
    });

    if (!salesReturn) {
      throw new NotFoundException(`Sales return with ID ${returnId} not found.`);
    }

    if (salesReturn.docType === "CREDIT_NOTE") {
      throw new BadRequestException("Document is already a Credit Note.");
    }

    // Check if a linked credit note already exists
    const existingLinkedNote = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.salesReturn.findFirst({
        where: {
          companyId: tenant.companyId,
          docType: "CREDIT_NOTE",
          linkedReturnId: salesReturn.id,
        },
      });
    });

    if (existingLinkedNote) {
      throw new BadRequestException(
        `Credit Note #${existingLinkedNote.returnNumber} has already been issued for this Sales Return.`,
      );
    }

    // Create linked Credit Note with restoreStock = false
    const creditNoteDto: CreateSalesReturnDto = {
      salesInvoiceId: salesReturn.salesInvoiceId,
      returnDate: new Date().toISOString(),
      docType: "CREDIT_NOTE",
      creditNoteType: "ITEM_BASED",
      gstCategory: "SECTION_34",
      reason: `Credit Note for Sales Return #${salesReturn.returnNumber}`,
      reasonGujarati: `ક્રેડિટ નોટ - વેચાણ પરત #${salesReturn.returnNumber}`,
      restoreStock: false, // Physical inventory was already restored by Sales Return
      linkedReturnId: salesReturn.id,
      items: salesReturn.items.map((i) => ({
        salesItemId: i.salesItemId || undefined,
        itemId: i.itemId || undefined,
        description: i.description || undefined,
        quantity: i.quantity.toNumber(),
        unitPrice: i.unitPrice.toNumber(),
        taxRate: i.taxRate.toNumber(),
        taxableAmount: i.taxableAmount.toNumber(),
        cgstAmount: i.cgstAmount.toNumber(),
        sgstAmount: i.sgstAmount.toNumber(),
        igstAmount: i.igstAmount.toNumber(),
        totalAmount: i.totalAmount.toNumber(),
      })),
    };

    const creditNote = await this.createSalesReturn(
      salesReturn.salesInvoiceId,
      creditNoteDto,
      tenant,
    );

    // Link both documents
    await this.prisma.executeInTenantContext(tenant, async (tx) => {
      await tx.salesReturn.update({
        where: { id: salesReturn.id },
        data: { linkedReturnId: creditNote.id },
      });
    });

    return creditNote;
  }

  /**
   * Reverses ledger account impacts and deletes accounting vouchers and journal entries.
   */
  private async reverseAndDeleteVouchers(tx: any, vouchers: any[]) {
    for (const voucher of vouchers) {
      if (voucher.journalEntries && voucher.journalEntries.length > 0) {
        for (const entry of voucher.journalEntries) {
          const acc = await tx.ledgerAccount.findUnique({
            where: { id: entry.accountId },
            include: { group: true },
          });
          if (acc && acc.group) {
            const reversedBalance = applyTransactionToBalance(
              acc.group.nature as any,
              acc.currentBalance.toString(),
              entry.creditAmount, // swap credit as debit to revert
              entry.debitAmount,  // swap debit as credit to revert
            );
            await tx.ledgerAccount.update({
              where: { id: acc.id },
              data: { currentBalance: reversedBalance.toNumber() },
            });
          }
        }
      }
      await tx.journalEntry.deleteMany({
        where: { voucherId: voucher.id },
      });
      await tx.voucher.deleteMany({
        where: { id: voucher.id },
      });
    }
  }

  async deleteSalesReturn(id: string, tenant: TenantContext) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const salesReturn = await tx.salesReturn.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          items: true,
          salesInvoice: true,
        },
      });

      if (!salesReturn) {
        throw new NotFoundException(`Sales return with ID ${id} not found.`);
      }

      // 1. Revert invoice balance if linked
      if (salesReturn.salesInvoiceId && salesReturn.grandTotal) {
        const inv = await tx.salesInvoice.findUnique({
          where: { id: salesReturn.salesInvoiceId },
        });
        if (inv) {
          const currentBal = toDecimal(inv.balanceAmount);
          const restoredBal = currentBal.add(toDecimal(salesReturn.grandTotal));
          await tx.salesInvoice.update({
            where: { id: inv.id },
            data: { balanceAmount: restoredBal.toFixed(2) },
          });
        }
      }

      // 2. Remove accounting voucher and entries if posted and reverse ledger balances
      const returnVouchers = await tx.voucher.findMany({
        where: {
          companyId: tenant.companyId,
          OR: [
            salesReturn.voucherId ? { id: salesReturn.voucherId } : null,
            { sourceDocument: "SALES_RETURN", sourceEntityId: salesReturn.id },
          ].filter(Boolean) as any,
        },
        include: { journalEntries: true },
      });
      await this.reverseAndDeleteVouchers(tx, returnVouchers);

      // 3. Remove stock transactions created for this return
      await tx.stockTransaction.deleteMany({
        where: {
          companyId: tenant.companyId,
          referenceDocType: "SALES_RETURN",
          referenceDocId: salesReturn.id,
        },
      });

      // 4. Delete return items
      await tx.salesReturnItem.deleteMany({
        where: { returnId: salesReturn.id },
      });

      // 5. Delete sales return
      await tx.salesReturn.delete({
        where: { id: salesReturn.id },
      });

      // 6. Audit log
      await this.audit.record(
        {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
          action: "DELETE_SALES_RETURN",
          entityName: "SalesReturn",
          entityId: salesReturn.id,
          newState: {
            deleted: true,
            returnNumber: salesReturn.returnNumber,
            salesInvoiceId: salesReturn.salesInvoiceId,
            grandTotal: salesReturn.grandTotal ? String(salesReturn.grandTotal) : "0",
          },
        },
        tx,
      );

      return { success: true, message: "Sales return deleted successfully." };
    });
  }

  async updateSalesInvoice(
    id: string,
    dto: CreateSalesInvoiceDto,
    tenant: TenantContext,
  ) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        "Invoice must contain at least one line item.",
      );
    }

    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const existing = await tx.salesInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
        include: { items: true, party: true },
      });

      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Sales invoice with ID '${id}' not found.`,
          messageGujarati: `વેચાણ બિલ મળેલ નથી.`,
        });
      }

      if (existing.status === "CANCELLED") {
        throw new BadRequestException("Cancelled invoices cannot be edited.");
      }

      const company = await tx.company.findUnique({
        where: { id: tenant.companyId },
      });
      if (!company) {
        throw new NotFoundException(`Company ${tenant.companyId} not found.`);
      }

      // 1. Resolve Financial Year & Invoice Date
      const invoiceDate = dto.invoiceDate
        ? new Date(dto.invoiceDate)
        : existing.invoiceDate;

      let fy = await tx.financialYear.findFirst({
        where: {
          companyId: tenant.companyId,
          startDate: { lte: invoiceDate },
          endDate: { gte: invoiceDate },
        },
      });
      if (!fy) {
        fy = await tx.financialYear.findFirst({
          where: { companyId: tenant.companyId, isCurrent: true },
        });
      }
      if (!fy) {
        throw new NotFoundException(
          `No open financial year found for company.`,
        );
      }

      // 2. Resolve Party
      let party: any = existing.party;
      if (dto.partyId && dto.partyId !== existing.partyId) {
        party = await tx.party.findFirst({
          where: { id: dto.partyId, companyId: tenant.companyId },
          include: { ledgerAccount: true },
        });
        if (!party) {
          throw new NotFoundException(
            `Party ${dto.partyId} not found in this company.`,
          );
        }
      }

      // 3. Resolve Items
      const itemIds = dto.items.map((i) => i.itemId);
      const items = await tx.item.findMany({
        where: {
          id: { in: itemIds },
          companyId: tenant.companyId,
        },
      });
      if (items.length !== new Set(itemIds).size) {
        throw new BadRequestException(
          "One or more referenced items do not exist.",
        );
      }
      const itemMap = new Map(items.map((i) => [i.id, i]));

      for (const line of dto.items) {
        const it = itemMap.get(line.itemId)!;
        if (!it.isActive) {
          throw new BadRequestException(`Item "${it.name}" is inactive.`);
        }
        if (Number(line.quantity) <= 0) {
          throw new BadRequestException(
            `Quantity for "${it.name}" must be greater than zero.`,
          );
        }
      }

      // 4. Exact Decimal Statutory Tax & Line Calculations
      const placeOfSupply =
        dto.placeOfSupply?.trim() ||
        party?.stateCode?.trim() ||
        company.stateCode;

      const taxCalc = calculateSalesInvoiceTaxes(
        company.stateCode,
        placeOfSupply,
        dto.items.map((i) => ({
          itemId: i.itemId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discountPercent: i.discountPercent,
          discountAmount: i.discountAmount,
          taxRate: i.taxRate,
          isTaxInclusive: i.isTaxInclusive,
          supplyCategory:
            (itemMap.get(i.itemId) as any)?.supplyCategory || "TAXABLE",
        })),
      );

      // 5. Clean up old stock transactions and old items
      await tx.stockTransaction.deleteMany({
        where: {
          referenceDocType: "SALES_INVOICE",
          referenceDocId: id,
        },
      });

      await tx.salesInvoiceItem.deleteMany({
        where: { invoiceId: id },
      });

      const grandTotalNum = taxCalc.grandTotal.toNumber();
      const currentPaid = Number(existing.paidAmount || 0);
      const balanceAmount = Math.max(0, grandTotalNum - currentPaid);
      let updatedStatus = existing.status;
      if (existing.status !== "DRAFT") {
        if (balanceAmount === 0 && grandTotalNum > 0) {
          updatedStatus = InvoiceStatus.PAID;
        } else if (currentPaid > 0) {
          updatedStatus = InvoiceStatus.PARTIALLY_PAID;
        } else {
          updatedStatus = InvoiceStatus.ISSUED;
        }
      }

      // 6. Update SalesInvoice Header
      const updatedInvoice = await tx.salesInvoice.update({
        where: { id },
        data: {
          partyId: party.id,
          category: (dto.category as any) || existing.category,
          invoiceDate,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : existing.dueDate,
          status: updatedStatus as any,
          paymentMode: dto.paymentMode
            ? (this.normalizePaymentMode(dto.paymentMode) as any)
            : existing.paymentMode,
          placeOfSupply,
          subTotal: taxCalc.subTotal.toNumber(),
          discountTotal: taxCalc.discountTotal.toNumber(),
          taxableAmount: taxCalc.taxableAmount.toNumber(),
          cgstAmount: taxCalc.cgstAmount.toNumber(),
          sgstAmount: taxCalc.sgstAmount.toNumber(),
          igstAmount: taxCalc.igstAmount.toNumber(),
          utgstAmount: taxCalc.utgstAmount.toNumber(),
          cessAmount: taxCalc.cessAmount.toNumber(),
          roundOff: taxCalc.roundOff.toNumber(),
          grandTotal: grandTotalNum,
          balanceAmount,
          notes: dto.notes !== undefined ? dto.notes : existing.notes,
          termsAndConditions:
            dto.termsAndConditions !== undefined
              ? dto.termsAndConditions
              : existing.termsAndConditions,
        },
      });

      // 7. Create Updated Items & Re-record stock movements
      const createdItems: any[] = [];
      for (let i = 0; i < dto.items.length; i++) {
        const lineDto = dto.items[i];
        const computedLine = taxCalc.items[i];
        const it = itemMap.get(lineDto.itemId)!;

        const invItem = await tx.salesInvoiceItem.create({
          data: {
            invoiceId: id,
            itemId: it.id,
            batchId: lineDto.batchId || null,
            description: lineDto.description || it.name,
            hsnCode: lineDto.hsnCode || it.hsnCode || "9999",
            quantity: computedLine.quantity.toNumber(),
            unitPrice: computedLine.unitPrice.toNumber(),
            discountPercent: computedLine.discountPercent.toNumber(),
            discountAmount: computedLine.discountAmount.toNumber(),
            taxRate: computedLine.taxRate.toNumber(),
            taxableAmount: computedLine.taxableAmount.toNumber(),
            cgstAmount: computedLine.cgstAmount.toNumber(),
            sgstAmount: computedLine.sgstAmount.toNumber(),
            igstAmount: computedLine.igstAmount.toNumber(),
            utgstAmount: computedLine.utgstAmount.toNumber(),
            supplyCategory: computedLine.supplyCategory,
            totalAmount: computedLine.totalAmount.toNumber(),
          },
        });
        createdItems.push(invItem);

        if (it.type !== "SERVICE" && updatedStatus !== InvoiceStatus.DRAFT) {
          const warehouse = await tx.warehouse.findFirst({
            where: { companyId: tenant.companyId },
          });
          if (warehouse) {
            await tx.stockTransaction.create({
              data: {
                organizationId: tenant.organizationId,
                companyId: tenant.companyId,
                warehouseId: warehouse.id,
                itemId: it.id,
                batchId: lineDto.batchId || null,
                transactionType: StockTransactionType.SALES_DISPATCH as any,
                transactionDate: invoiceDate,
                quantity: -Math.abs(computedLine.quantity.toNumber()),
                valuationRate: Number(it.purchaseRate || it.retailPrice || 0),
                totalValuation:
                  Math.abs(computedLine.quantity.toNumber()) *
                  Number(it.purchaseRate || it.retailPrice || 0),
                isProvisionalCost: false,
                costVariance: 0,
                referenceDocType: "SALES_INVOICE",
                referenceDocId: id,
              },
            });
          }
        }
      }

      // 8. Re-balance double-entry accounting vouchers
      if (updatedStatus !== InvoiceStatus.DRAFT) {
        const existingVouchers = await tx.voucher.findMany({
          where: {
            companyId: tenant.companyId,
            sourceDocument: "SALES_INVOICE",
            sourceEntityId: id,
          },
        });
        for (const v of existingVouchers) {
          await tx.voucher.delete({ where: { id: v.id } });
        }

        try {
          await this.postSalesInvoiceVoucher(
            tx,
            tenant,
            id,
            existing.invoiceNumber,
            party,
            fy.id,
            taxCalc,
            updatedInvoice.paymentMode as any,
            invoiceDate,
          );
        } catch (e: any) {
          console.warn("Voucher re-posting warning during update:", e.message);
        }
      }

      // 9. Audit log
      await this.audit.record(
        {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
          action: "UPDATE_SALES_INVOICE",
          entityName: "SalesInvoice",
          entityId: id,
          newState: {
            invoiceNumber: existing.invoiceNumber,
            grandTotal: grandTotalNum,
            status: updatedStatus,
          },
        },
        tx,
      );

      return {
        ...updatedInvoice,
        items: createdItems,
        party,
        ...buildInvoiceUrls(updatedInvoice.id),
      };
    });
  }

  async deleteSalesInvoice(id: string, tenant: TenantContext) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const existing = await tx.salesInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
      });

      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Sales invoice with ID '${id}' not found.`,
          messageGujarati: `વેચાણ બિલ મળેલ નથી.`,
        });
      }

      // 1. Process and remove linked sales returns and their vouchers/stock/items
      const linkedReturns = await tx.salesReturn.findMany({
        where: { salesInvoiceId: id },
      });
      for (const ret of linkedReturns) {
        const retVouchers = await tx.voucher.findMany({
          where: {
            companyId: tenant.companyId,
            OR: [
              ret.voucherId ? { id: ret.voucherId } : null,
              { sourceDocument: "SALES_RETURN", sourceEntityId: ret.id },
            ].filter(Boolean) as any,
          },
          include: { journalEntries: true },
        });
        await this.reverseAndDeleteVouchers(tx, retVouchers);

        await tx.stockTransaction.deleteMany({
          where: {
            companyId: tenant.companyId,
            referenceDocType: "SALES_RETURN",
            referenceDocId: ret.id,
          },
        });
        await tx.salesReturnItem.deleteMany({
          where: { returnId: ret.id },
        });
        await tx.salesReturn.delete({
          where: { id: ret.id },
        });
      }

      // 2. Process and remove linked outward debit notes
      const linkedDebitNotes = await tx.outwardDebitNote.findMany({
        where: { salesInvoiceId: id },
      });
      for (const note of linkedDebitNotes) {
        const noteVouchers = await tx.voucher.findMany({
          where: {
            companyId: tenant.companyId,
            OR: [
              note.voucherId ? { id: note.voucherId } : null,
              { sourceDocument: "OUTWARD_DEBIT_NOTE", sourceEntityId: note.id },
            ].filter(Boolean) as any,
          },
          include: { journalEntries: true },
        });
        await this.reverseAndDeleteVouchers(tx, noteVouchers);

        await tx.outwardDebitNoteItem.deleteMany({
          where: { noteId: note.id },
        });
        await tx.outwardDebitNote.delete({
          where: { id: note.id },
        });
      }

      // 3. Remove payment allocations
      await tx.paymentAllocation.deleteMany({
        where: { invoiceId: id },
      });

      // 4. Remove advance adjustments
      await tx.advanceAdjustment.deleteMany({
        where: { salesInvoiceId: id },
      });

      // 5. Remove e-invoice and e-way bill records
      await tx.eInvoiceRecord.deleteMany({
        where: { invoiceId: id },
      });
      await tx.eWayBillRecord.deleteMany({
        where: { invoiceId: id },
      });

      // 6. Unlink converted delivery challans
      await tx.deliveryChallan.updateMany({
        where: { convertedInvoiceId: id },
        data: { convertedInvoiceId: null },
      });

      // 7. Unlink automated billing runs
      await tx.automatedBillingRun.updateMany({
        where: { invoiceId: id },
        data: { invoiceId: null },
      });

      // 8. Remove stock transactions
      await tx.stockTransaction.deleteMany({
        where: {
          companyId: tenant.companyId,
          referenceDocType: "SALES_INVOICE",
          referenceDocId: id,
        },
      });

      // 9. Revert & delete vouchers created for this sales invoice
      const invoiceVouchers = await tx.voucher.findMany({
        where: {
          companyId: tenant.companyId,
          OR: [
            { sourceDocument: "SALES_INVOICE", sourceEntityId: id },
            { referenceNo: existing.invoiceNumber },
          ],
        },
        include: { journalEntries: true },
      });
      await this.reverseAndDeleteVouchers(tx, invoiceVouchers);

      // 10. Remove items
      await tx.salesInvoiceItem.deleteMany({
        where: { invoiceId: id },
      });

      // 11. Remove sales invoice
      await tx.salesInvoice.delete({
        where: { id },
      });

      // 12. Audit log
      await this.audit.record(
        {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
          action: "DELETE_SALES_INVOICE",
          entityName: "SalesInvoice",
          entityId: existing.id,
          newState: {
            deleted: true,
            invoiceNumber: existing.invoiceNumber,
            grandTotal: String(existing.grandTotal),
          },
        },
        tx,
      );

      return {
        success: true,
        message: `Sales invoice '${existing.invoiceNumber}' deleted successfully.`,
        messageGujarati: `વેચાણ બિલ '${existing.invoiceNumber}' સફળતાપૂર્વક કાઢી નાખવામાં આવ્યું છે.`,
      };
    });
  }

  async bulkDeleteSalesInvoices(ids: string[], tenant: TenantContext) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: "No sales invoice IDs provided for deletion.",
        messageGujarati: "કાઢી નાખવા માટે કોઈ વેચાણ બિલ પસંદ કરેલ નથી.",
      });
    }

    let deletedCount = 0;
    for (const id of ids) {
      try {
        await this.deleteSalesInvoice(id, tenant);
        deletedCount++;
      } catch {
        // continue
      }
    }

    return {
      success: true,
      count: ids.length,
      deletedCount,
      message: `${deletedCount} sales invoices deleted successfully.`,
      messageGujarati: `${deletedCount} વેચાણ બિલો સફળતાપૂર્વક કાઢી નાખવામાં આવ્યા છે.`,
    };
  }

  async getNextInvoiceNumber(
    category: string | undefined,
    tenant: TenantContext,
  ): Promise<{ nextNumber: string }> {
    const cat = category || InvoiceCategory.TAX_INVOICE;
    const fy = await this.prisma.financialYear.findFirst({
      where: { companyId: tenant.companyId, isLocked: false },
      orderBy: { startDate: "desc" },
    });
    const fyStart = fy ? new Date(fy.startDate) : new Date();
    const fyEnd = fy ? new Date(fy.endDate) : new Date();
    const fyCode = fy
      ? `${fyStart.getFullYear().toString().slice(-2)}-${fyEnd.getFullYear().toString().slice(-2)}`
      : "26-27";
    const prefix =
      cat === InvoiceCategory.PROFORMA_INVOICE
        ? `QTN/${fyCode}/`
        : cat === InvoiceCategory.DELIVERY_CHALLAN
          ? `DC/${fyCode}/`
          : `INV/${fyCode}/`;
    const seq = fy
      ? await this.prisma.invoiceSequence.findFirst({
          where: {
            companyId: tenant.companyId,
            financialYearId: fy.id,
            category: cat as any,
            prefix,
          },
        })
      : null;
    const nextNum = seq ? seq.currentNumber + 1 : 1;
    return {
      nextNumber: `${prefix}${String(nextNum).padStart(seq?.padding || 4, "0")}`,
    };
  }
}

