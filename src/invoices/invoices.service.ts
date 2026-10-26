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

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
    private readonly ledgersService: LedgersService,
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
      return await this.prisma.executeInTenantContext(tenant, async (tx) => {
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
          if (dto.warehouseId) {
            warehouse = await tx.warehouse.findFirst({
              where: { id: dto.warehouseId, companyId: tenant.companyId },
            });
          } else {
            warehouse = await tx.warehouse.findFirst({
              where: { companyId: tenant.companyId },
            });
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
          grandTotalWords: taxCalc.grandTotalWords,
          grandTotalWordsGujarati: taxCalc.grandTotalWordsGujarati,
          items: createdItems,
          voucher: {
            id: voucher.id,
            voucherNumber: voucher.voucherNumber,
            balanced: true,
          },
        };
      });
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

      if (query.partyId) where.partyId = query.partyId;
      if (query.status) where.status = query.status;
      if (query.category) where.category = query.category;
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
            items: true,
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        tx.salesInvoice.count({ where }),
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
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
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
        allocation,
        voucher,
      };
    });
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
    const acc = await tx.ledgerAccount.findFirst({
      where: { companyId, name },
    });
    if (!acc) {
      throw new NotFoundException(
        `Required statutory ledger account "${name}" not found.`,
      );
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

    const provisionalRate = item.purchaseRate ?? item.retailPrice ?? null;
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
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        "Sales return must contain at least one line item.",
      );
    }

    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      // 1. Transactional advisory lock on this specific sales invoice
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`sales_return_${invoiceId}`})::bigint)
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
        salesItemId: string;
        itemId: string;
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

      for (const line of dto.items) {
        const qty = toDecimal(line.quantity);
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

        const unitPrice = toDecimal(origLine.unitPrice);
        const taxable = qty.times(unitPrice).toDecimalPlaces(2);
        const taxRate = toDecimal(origLine.taxRate);
        const taxAmount = taxable
          .times(taxRate)
          .dividedBy(100)
          .toDecimalPlaces(2);

        let cgst = new Decimal(0);
        let sgst = new Decimal(0);
        let igst = new Decimal(0);

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

        const totalAmount = taxable.plus(cgst).plus(sgst).plus(igst);

        sumTaxable = sumTaxable.plus(taxable);
        sumCgst = sumCgst.plus(cgst);
        sumSgst = sumSgst.plus(sgst);
        sumIgst = sumIgst.plus(igst);

        returnItemsData.push({
          salesItemId: origLine.id,
          itemId: origLine.itemId,
          quantity: qty,
          unitPrice,
          taxableAmount: taxable,
          taxRate,
          cgstAmount: cgst,
          sgstAmount: sgst,
          igstAmount: igst,
          totalAmount,
          disposition: line.disposition,
        });
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
        }
      }

      // 7. Generate Return Number (Credit Note number)
      const returnCount = await tx.salesReturn.count({
        where: { companyId: tenant.companyId },
      });
      const returnNumber = `CN-${returnDate.getFullYear()}-${String(returnCount + 1).padStart(4, "0")}`;

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
          reason: dto.reason || "Goods returned by customer",
          reasonGujarati: dto.reasonGujarati || "ગ્રાહક દ્વારા માલ પરત મળ્યો",
          taxableAmount: sumTaxable.toFixed(2),
          cgstAmount: sumCgst.toFixed(2),
          sgstAmount: sumSgst.toFixed(2),
          igstAmount: sumIgst.toFixed(2),
          grandTotal: grandTotal.toFixed(2),
          status: "ISSUED",
          items: {
            create: returnItemsData.map((item) => ({
              salesItemId: item.salesItemId,
              itemId: item.itemId,
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
        },
      });

      // 9. Stock Restoration (SALES_RETURN) if accepted and warehouse available
      const shouldRestore = dto.restoreStock !== false;
      if (shouldRestore && warehouseId) {
        for (const line of returnItemsData) {
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
      const salesAccountName = isIntraState
        ? "General Sales Account"
        : "Inter-State Sales Account";

      const salesAccount = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          OR: [
            { name: salesAccountName },
            { name: { contains: "Sales", mode: "insensitive" } },
            { code: "4010" },
          ],
        },
      });

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
        const voucherCount = await tx.voucher.count({
          where: {
            companyId: tenant.companyId,
            financialYearId: fy.id,
            voucherType: VoucherType.CREDIT_NOTE,
          },
        });
        const voucherNumber = `V-CN-${returnDate.getFullYear()}-${String(voucherCount + 1).padStart(4, "0")}`;

        const journalLines: Array<{
          accountId: string;
          debitAmount: Decimal;
          creditAmount: Decimal;
          lineNarration: string;
          sequenceOrder: number;
        }> = [];

        let seq = 1;

        // Dr: Sales Account (reducing sales revenue)
        journalLines.push({
          accountId: salesAccount.id,
          debitAmount: sumTaxable,
          creditAmount: new Decimal(0),
          lineNarration: `Sales return against invoice ${invoice.invoiceNumber}`,
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
            narration: `Credit note ${returnNumber} for return against invoice ${invoice.invoiceNumber}`,
            narrationGujarati: `ક્રેડિટ નોટ ${returnNumber} - ઇનવોઇસ ${invoice.invoiceNumber} સામે વેચાણ પરત`,
            totalAmount: grandTotal.toFixed(2),
            isAutoGenerated: true,
            sourceDocument: "SALES_RETURN",
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
      }

      // 11. Reconcile Sales Invoice Balance.
      // A return larger than the unpaid balance is a credit owed to the customer.
      // Clamping at zero hid that credit from outstanding while the ledger still recorded it.
      const currentBalance = toDecimal(invoice.balanceAmount);
      const newBalance = currentBalance.minus(grandTotal);

      await tx.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          balanceAmount: newBalance.toFixed(2),
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
    return this.prisma.salesReturn.findMany({
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
  }

  async getSalesReturns(
    dto: QuerySalesReturnsDto,
    tenant: TenantContext,
  ): Promise<{ data: any[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(Number(dto.limit) || 50, 100);
    const offset = Number(dto.offset) || 0;

    const where: any = {
      companyId: tenant.companyId,
    };

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
      this.prisma.salesReturn.findMany({
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
      this.prisma.salesReturn.count({ where }),
    ]);

    return { data, total, limit, offset };
  }

  async getSalesReturnById(id: string, tenant: TenantContext) {
    const salesReturn = await this.prisma.salesReturn.findFirst({
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
      },
    });

    if (!salesReturn) {
      throw new NotFoundException(`Sales return with ID ${id} not found.`);
    }

    return salesReturn;
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

      // 2. Remove accounting voucher and entries if posted
      if (salesReturn.voucherId) {
        await tx.journalEntry.deleteMany({
          where: { voucherId: salesReturn.voucherId },
        });
        await tx.voucher.deleteMany({
          where: { id: salesReturn.voucherId },
        });
      }

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

      // 1. Remove outward debit notes / sales returns
      await tx.salesReturnItem.deleteMany({
        where: { returnDoc: { salesInvoiceId: id } },
      });
      await tx.salesReturn.deleteMany({
        where: { salesInvoiceId: id },
      });
      await tx.outwardDebitNoteItem.deleteMany({
        where: { note: { salesInvoiceId: id } },
      });
      await tx.outwardDebitNote.deleteMany({
        where: { salesInvoiceId: id },
      });

      // 2. Remove payment allocations
      await tx.paymentAllocation.deleteMany({
        where: { invoiceId: id },
      });

      // 3. Remove e-invoice and e-way bill records
      await tx.eInvoiceRecord.deleteMany({
        where: { invoiceId: id },
      });
      await tx.eWayBillRecord.deleteMany({
        where: { invoiceId: id },
      });

      // 4. Remove stock transactions
      await tx.stockTransaction.deleteMany({
        where: {
          referenceDocType: "SALES_INVOICE",
          referenceDocId: id,
        },
      });

      // 5. Remove items
      await tx.salesInvoiceItem.deleteMany({
        where: { invoiceId: id },
      });

      // 6. Remove sales invoice
      await tx.salesInvoice.delete({
        where: { id },
      });

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
}
