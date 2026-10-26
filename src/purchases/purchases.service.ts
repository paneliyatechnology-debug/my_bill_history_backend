import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import {
  TenantContext,
  StockTransactionType,
  VoucherType,
  PaymentMode,
} from "@billing/shared-types";
import {
  Decimal,
  toDecimal,
  toMoney,
  applyTransactionToBalance,
  resolveInwardSupply,
  splitInwardLineTax,
  validateJournalLines,
  validatePeriodAccess,
} from "@billing/accounting-core";
import { DatabaseService } from "../database/database.service";
import { AuditService } from "../audit/audit.service";
import { Prisma, ItemType } from "@billing/database";
import { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto";
import { QueryPurchasesDto } from "./dto/query-purchases.dto";
import { CreatePurchaseReturnDto } from "./dto/create-purchase-return.dto";
import { QueryPurchaseReturnsDto } from "./dto/query-purchase-returns.dto";
import { RecordPurchasePaymentDto } from "./dto/record-purchase-payment.dto";
import { isValidGstinChecksum } from "../common/validators/gstin.validator";

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
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records a purchase bill/invoice with atomic inward inventory receipts
   * and double-entry voucher postings to the general ledger.
   */
  async createPurchaseInvoice(
    dto: CreatePurchaseInvoiceDto,
    tenant: TenantContext,
    callerTx?: Prisma.TransactionClient,
  ): Promise<any> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        "Purchase invoice must contain at least one line item.",
      );
    }
    if (!dto.vendorInvoiceNumber || dto.vendorInvoiceNumber.trim() === "") {
      throw new BadRequestException("Vendor invoice number is required.");
    }
    if (!dto.partyId) {
      throw new BadRequestException("Supplier party ID is required.");
    }

    const executeWork = async (tx: Prisma.TransactionClient) => {
      // 1. Verify Company & Supplier Party
      const [company, party] = await Promise.all([
        tx.company.findUnique({
          where: { id: tenant.companyId },
          select: { id: true, stateCode: true, legalName: true },
        }),
        tx.party.findFirst({
          where: { id: dto.partyId, companyId: tenant.companyId },
          include: { ledgerAccount: true },
        }),
      ]);

      if (!company) {
        throw new NotFoundException("Company context not found.");
      }
      if (!party) {
        throw new NotFoundException("Supplier party not found.");
      }
      if (party.type === "CUSTOMER") {
        await tx.party.update({
          where: { id: party.id },
          data: { type: "BOTH" },
        });
      }

      // Check unique vendor invoice number per company & supplier
      const existing = await tx.purchaseInvoice.findUnique({
        where: {
          companyId_partyId_vendorInvoiceNumber: {
            companyId: tenant.companyId,
            partyId: dto.partyId,
            vendorInvoiceNumber: dto.vendorInvoiceNumber.trim(),
          },
        },
      });
      if (existing) {
        throw new ConflictException(
          `Purchase invoice with vendor invoice number '${dto.vendorInvoiceNumber}' already exists for this supplier.`,
        );
      }

      // 2. Resolve Warehouse (provided or company default, or auto-create)
      let warehouseId = dto.warehouseId;
      if (!warehouseId) {
        const defaultWh = await tx.warehouse.findFirst({
          where: { companyId: tenant.companyId, isDefault: true },
        });
        if (defaultWh) {
          warehouseId = defaultWh.id;
        } else {
          const anyWh = await tx.warehouse.findFirst({
            where: { companyId: tenant.companyId },
          });
          if (anyWh) {
            warehouseId = anyWh.id;
          } else {
            let resolvedBranchId = tenant.branchId;
            if (!resolvedBranchId) {
              const branch = await tx.branch.findFirst({
                where: { companyId: tenant.companyId },
              });
              if (branch) {
                resolvedBranchId = branch.id;
              } else {
                const newBranch = await tx.branch.create({
                  data: {
                    organizationId: tenant.organizationId,
                    companyId: tenant.companyId,
                    name: "Main Branch",
                    code: "MAIN",
                    isMainBranch: true,
                    addressLine1: "Main Office",
                    city: "Ahmedabad",
                    pincode: "380001",
                    stateCode: company.stateCode || "24",
                    phone: "9999999999",
                  },
                });
                resolvedBranchId = newBranch.id;
              }
            }
            const createdWh = await tx.warehouse.create({
              data: {
                organizationId: tenant.organizationId,
                companyId: tenant.companyId,
                branchId: resolvedBranchId,
                name: "Main Warehouse",
                isDefault: true,
              },
            });
            warehouseId = createdWh.id;
          }
        }
      }

      // 3. Tax follows the supplier GSTIN state and place of supply, not the buyer alone.
      let supplyDecision;
      try {
        const hasValidGstin = Boolean(party.gstin && isValidGstinChecksum(party.gstin.trim()));
        const validSupplierGstin = hasValidGstin && party.gstin ? party.gstin.trim().toUpperCase() : null;
        const supplierState = party.stateCode || (validSupplierGstin ? validSupplierGstin.substring(0, 2) : (company.stateCode || "24"));

        supplyDecision = resolveInwardSupply({
          supplierGstin: validSupplierGstin,
          supplierStateCode: supplierState,
          placeOfSupply: dto.placeOfSupply || supplierState || company.stateCode || "24",
          recipientStateCode: company.stateCode || "24",
        });
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : "Purchase tax could not be classified.");
      }
      const placeOfSupply = supplyDecision.placeOfSupply;

      let sumTaxable = new Decimal(0);
      let sumCgst = new Decimal(0);
      let sumSgst = new Decimal(0);
      let sumUtgst = new Decimal(0);
      let sumIgst = new Decimal(0);

      const itemIds = dto.items.map((i) => i.itemId);
      const dbItems = await tx.item.findMany({
        where: { id: { in: itemIds }, companyId: tenant.companyId },
      });
      const dbItemMap = new Map(dbItems.map((item) => [item.id, item]));

      const lineItemsData: Array<{
        itemId: string;
        hsnCode: string;
        quantity: Decimal;
        unitPrice: Decimal;
        taxableAmount: Decimal;
        taxRate: Decimal;
        cgstAmount: Decimal;
        sgstAmount: Decimal;
        utgstAmount: Decimal;
        igstAmount: Decimal;
        supplyCategory: string;
        totalAmount: Decimal;
      }> = [];

      for (const line of dto.items) {
        const dbItem = dbItemMap.get(line.itemId);
        if (!dbItem) {
          throw new BadRequestException(
            `Item with ID ${line.itemId} not found in this company.`,
          );
        }

        const qty = toDecimal(line.quantity);
        if (qty.lte(0)) {
          throw new BadRequestException(
            `Line quantity must be positive for item ${dbItem.name}.`,
          );
        }
        const unitPrice = toDecimal(line.unitPrice);
        if (unitPrice.isNegative()) {
          throw new BadRequestException(`Unit price cannot be negative.`);
        }

        const taxable = qty.times(unitPrice).toDecimalPlaces(2);
        const split = splitInwardLineTax({
          taxableAmount: taxable,
          taxRate: toDecimal(line.taxRate ?? dbItem.taxRate),
          supplyCategory: (dbItem.supplyCategory as any) || "TAXABLE",
          taxKind: supplyDecision.taxKind,
        });
        const lineTotal = taxable.plus(split.cgst).plus(split.sgst).plus(split.utgst).plus(split.igst);

        sumTaxable = sumTaxable.plus(taxable);
        sumCgst = sumCgst.plus(split.cgst);
        sumSgst = sumSgst.plus(split.sgst);
        sumUtgst = sumUtgst.plus(split.utgst);
        sumIgst = sumIgst.plus(split.igst);

        lineItemsData.push({
          itemId: line.itemId,
          hsnCode: line.hsnCode || dbItem.hsnCode || "0000",
          quantity: qty,
          unitPrice,
          taxableAmount: taxable,
          taxRate: split.taxRate,
          cgstAmount: split.cgst,
          sgstAmount: split.sgst,
          utgstAmount: split.utgst,
          igstAmount: split.igst,
          supplyCategory: split.supplyCategory,
          totalAmount: lineTotal,
        });
      }

      const grandTotal = sumTaxable.plus(sumCgst).plus(sumSgst).plus(sumUtgst).plus(sumIgst);
      const invoiceDate = dto.invoiceDate
        ? new Date(dto.invoiceDate)
        : new Date();

      // Resolve Branch
      let branchId = tenant.branchId;
      if (!branchId) {
        const branch = await tx.branch.findFirst({
          where: { companyId: tenant.companyId },
        });
        if (!branch) {
          throw new BadRequestException("No branch found for this company.");
        }
        branchId = branch.id;
      }

      // Resolve Financial Year
      let financialYearId = tenant.financialYearId;
      if (!financialYearId) {
        const fy = await tx.financialYear.findFirst({
          where: { companyId: tenant.companyId, isCurrent: true },
        });
        if (!fy) {
          throw new BadRequestException(
            "No active financial year found for this company.",
          );
        }
        financialYearId = fy.id;
      }

      // 4. Create PurchaseInvoice & items
      const purchaseInvoice = await tx.purchaseInvoice.create({
        data: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          branchId,
          financialYearId,
          partyId: dto.partyId,
          vendorInvoiceNumber: dto.vendorInvoiceNumber.trim(),
          invoiceDate,
          placeOfSupply,
          taxableAmount: sumTaxable.toFixed(2),
          cgstAmount: sumCgst.toFixed(2),
          sgstAmount: sumSgst.toFixed(2),
          utgstAmount: sumUtgst.toFixed(2),
          igstAmount: sumIgst.toFixed(2),
          cessAmount: "0.00",
          grandTotal: grandTotal.toFixed(2),
          paidAmount: "0.00",
          balanceAmount: grandTotal.toFixed(2),
          itcEligibility: dto.itcEligibility || "INPUT",
          items: {
            create: lineItemsData.map((item) => ({
              itemId: item.itemId,
              hsnCode: item.hsnCode,
              quantity: item.quantity.toFixed(4),
              unitPrice: item.unitPrice.toFixed(4),
              taxableAmount: item.taxableAmount.toFixed(2),
              taxRate: item.taxRate.toFixed(2),
              cgstAmount: item.cgstAmount.toFixed(2),
              sgstAmount: item.sgstAmount.toFixed(2),
              utgstAmount: item.utgstAmount.toFixed(2),
              igstAmount: item.igstAmount.toFixed(2),
              supplyCategory: item.supplyCategory as any,
              totalAmount: item.totalAmount.toFixed(2),
            })),
          },
        },
        include: {
          items: {
            include: { item: true },
          },
          party: true,
        },
      });

      // 5. Create Inward Stock Transactions (PURCHASE_RECEIPT) - Physical goods only
      for (const line of lineItemsData) {
        const itemRecord = dbItemMap.get(line.itemId);
        // Distinguish goods from services: Service invoices must not create stock movements
        if (itemRecord?.type === ItemType.SERVICE) {
          continue;
        }

        await tx.stockTransaction.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            warehouseId,
            itemId: line.itemId,
            transactionType: StockTransactionType.PURCHASE_RECEIPT,
            transactionDate: invoiceDate,
            quantity: line.quantity.toFixed(4), // Positive for inward stock
            valuationRate: line.unitPrice.toFixed(4),
            totalValuation: line.taxableAmount.toFixed(2),
            referenceDocType: "PURCHASE_INVOICE",
            referenceDocId: purchaseInvoice.id,
          },
        });
      }

      // 6. Double-Entry General Ledger Voucher Posting
      // Accounts Lookup
      let purchaseAccount = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          OR: [
            { name: { contains: "Purchase", mode: "insensitive" } },
            { code: "5010" },
          ],
        },
      });

      if (!purchaseAccount) {
        let expenseGroup = await tx.ledgerGroup.findFirst({
          where: {
            companyId: tenant.companyId,
            name: { contains: "Expense", mode: "insensitive" },
          },
        });
        if (!expenseGroup) {
          expenseGroup = await tx.ledgerGroup.create({
            data: {
              organizationId: tenant.organizationId,
              companyId: tenant.companyId,
              name: "Direct Expenses",
              nature: "EXPENSE",
              isSystem: true,
            },
          });
        }
        purchaseAccount = await tx.ledgerAccount.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            groupId: expenseGroup.id,
            name: "General Purchases Account",
            nameGujarati: "સામાન્ય ખરીદી",
            code: "5010",
            openingType: "DR",
          },
        });
      }

      const getOrCreateItcAccount = async (
        taxType: "CGST" | "SGST" | "IGST" | "UTGST",
        code: string,
      ) => {
        let acc = await tx.ledgerAccount.findFirst({
          where: {
            companyId: tenant.companyId,
            OR: [
              { name: { contains: `Input ${taxType}`, mode: "insensitive" } },
              { code },
            ],
          },
        });
        if (!acc) {
          let itcGroup = await tx.ledgerGroup.findFirst({
            where: {
              companyId: tenant.companyId,
              OR: [
                { name: { contains: "Duties & Taxes", mode: "insensitive" } },
                { nature: "ASSET" },
              ],
            },
          });
          if (!itcGroup) {
            itcGroup = await tx.ledgerGroup.create({
              data: {
                organizationId: tenant.organizationId,
                companyId: tenant.companyId,
                name: "Duties & Taxes (ITC)",
                nameGujarati: "ડ્યુટી અને ટેક્સ (ઇનપુટ)",
                nature: "ASSET",
                isSystem: true,
              },
            });
          }
          acc = await tx.ledgerAccount.create({
            data: {
              organizationId: tenant.organizationId,
              companyId: tenant.companyId,
              groupId: itcGroup.id,
              name: `Input ${taxType} (ITC)`,
              nameGujarati: `ઇનપુટ ${taxType} ક્રેડિટ`,
              code,
              isTaxLedger: true,
              openingType: "DR",
              openingBalance: "0.00",
              currentBalance: "0.00",
            },
          });
        }
        return acc;
      };

      let itcCgstAccount = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          OR: [
            { name: { contains: "Input CGST", mode: "insensitive" } },
            { code: "1110" },
          ],
        },
      });

      let itcSgstAccount = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          OR: [
            { name: { contains: "Input SGST", mode: "insensitive" } },
            { code: "1120" },
          ],
        },
      });

      let itcIgstAccount = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          OR: [
            { name: { contains: "Input IGST", mode: "insensitive" } },
            { code: "1130" },
          ],
        },
      });

      // Supplier account (party's ledger account or automatically created under Sundry Creditors)
      let supplierAccount = party.ledgerAccount;
      if (!supplierAccount) {
        supplierAccount = await tx.ledgerAccount.findFirst({
          where: {
            companyId: tenant.companyId,
            OR: [{ partyId: party.id }, { name: party.name }],
          },
        });
        if (!supplierAccount) {
          let creditorGroup = await tx.ledgerGroup.findFirst({
            where: {
              companyId: tenant.companyId,
              OR: [
                { name: { contains: "Creditor", mode: "insensitive" } },
                { nature: "LIABILITY" },
              ],
            },
          });
          if (!creditorGroup) {
            creditorGroup = await tx.ledgerGroup.create({
              data: {
                organizationId: tenant.organizationId,
                companyId: tenant.companyId,
                name: "Sundry Creditors",
                nameGujarati: "પરચૂરણ લેણદારો",
                nature: "LIABILITY",
                isSystem: true,
              },
            });
          }
          supplierAccount = await tx.ledgerAccount.create({
            data: {
              organizationId: tenant.organizationId,
              companyId: tenant.companyId,
              groupId: creditorGroup.id,
              name: party.name,
              nameGujarati: party.nameGujarati,
              partyId: party.id,
              isPartyLedger: true,
              openingType: "CR",
              openingBalance: "0.00",
              currentBalance: "0.00",
            },
          });
        }
      }

      if (purchaseAccount && supplierAccount) {
        const voucherCount = await tx.voucher.count({
          where: {
            companyId: tenant.companyId,
            financialYearId: tenant.financialYearId,
            voucherType: VoucherType.PURCHASE,
          },
        });
        const voucherNumber = `PUR-${new Date().getFullYear()}-${String(voucherCount + 1).padStart(4, "0")}`;

        const journalLines: Array<{
          accountId: string;
          debitAmount: Decimal;
          creditAmount: Decimal;
          lineNarration: string;
          sequenceOrder: number;
        }> = [];

        let seq = 1;
        // Dr: Purchases
        journalLines.push({
          accountId: purchaseAccount.id,
          debitAmount: sumTaxable,
          creditAmount: new Decimal(0),
          lineNarration: `Purchases against bill ${dto.vendorInvoiceNumber}`,
          sequenceOrder: seq++,
        });

        // Dr: Input CGST
        if (sumCgst.gt(0)) {
          if (!itcCgstAccount) {
            itcCgstAccount = await getOrCreateItcAccount("CGST", "1110");
          }
          journalLines.push({
            accountId: itcCgstAccount.id,
            debitAmount: sumCgst,
            creditAmount: new Decimal(0),
            lineNarration: `Input CGST on bill ${dto.vendorInvoiceNumber}`,
            sequenceOrder: seq++,
          });
        }

        // Dr: Input SGST
        if (sumSgst.gt(0)) {
          if (!itcSgstAccount) {
            itcSgstAccount = await getOrCreateItcAccount("SGST", "1120");
          }
          journalLines.push({
            accountId: itcSgstAccount.id,
            debitAmount: sumSgst,
            creditAmount: new Decimal(0),
            lineNarration: `Input SGST on bill ${dto.vendorInvoiceNumber}`,
            sequenceOrder: seq++,
          });
        }

        if (sumUtgst.gt(0)) {
          const itcUtgstAccount = await getOrCreateItcAccount("UTGST", "1140");
          journalLines.push({
            accountId: itcUtgstAccount.id,
            debitAmount: sumUtgst,
            creditAmount: new Decimal(0),
            lineNarration: `Input UTGST on bill ${dto.vendorInvoiceNumber}`,
            sequenceOrder: seq++,
          });
        }

        // Dr: Input IGST
        if (sumIgst.gt(0)) {
          if (!itcIgstAccount) {
            itcIgstAccount = await getOrCreateItcAccount("IGST", "1130");
          }
          journalLines.push({
            accountId: itcIgstAccount.id,
            debitAmount: sumIgst,
            creditAmount: new Decimal(0),
            lineNarration: `Input IGST on bill ${dto.vendorInvoiceNumber}`,
            sequenceOrder: seq++,
          });
        }

        // Cr: Supplier Account
        journalLines.push({
          accountId: supplierAccount.id,
          debitAmount: new Decimal(0),
          creditAmount: grandTotal,
          lineNarration: `Bill ${dto.vendorInvoiceNumber} from ${party.name}`,
          sequenceOrder: seq++,
        });

        await tx.voucher.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            financialYearId,
            voucherType: VoucherType.PURCHASE,
            voucherNumber,
            voucherDate: invoiceDate,
            referenceNo: dto.vendorInvoiceNumber,
            narration: `Purchase from ${party.name} (Invoice: ${dto.vendorInvoiceNumber})`,
            narrationGujarati: `ખરીદી - ${party.nameGujarati || party.name} (બિલ: ${dto.vendorInvoiceNumber})`,
            totalAmount: grandTotal.toFixed(2),
            isAutoGenerated: true,
            sourceDocument: "PURCHASE_INVOICE",
            sourceEntityId: purchaseInvoice.id,
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
      }

      // 7. Audit Log
      await this.audit.record({
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId || "",
        action: "CREATE_PURCHASE_INVOICE",
        entityName: "PurchaseInvoice",
        entityId: purchaseInvoice.id,
        newState: {
          vendorInvoiceNumber: dto.vendorInvoiceNumber,
          partyId: dto.partyId,
          partyName: party.name,
          grandTotal: grandTotal.toFixed(2),
          itemsCount: lineItemsData.length,
        },
      });

      return purchaseInvoice;
    };

    if (callerTx) {
      return executeWork(callerTx);
    }
    return this.prisma.executeInTenantContext(tenant, executeWork);
  }

  /**
   * Retrieves purchase invoices with filters for party, date range, search and pagination.
   */
  async getPurchaseInvoices(dto: QueryPurchasesDto, tenant: TenantContext) {
    const where: any = {
      companyId: tenant.companyId,
    };

    if (dto.partyId) {
      where.partyId = dto.partyId;
    }
    if (dto.search && dto.search.trim() !== "") {
      where.OR = [
        {
          vendorInvoiceNumber: {
            contains: dto.search.trim(),
            mode: "insensitive",
          },
        },
        {
          party: { name: { contains: dto.search.trim(), mode: "insensitive" } },
        },
      ];
    }
    if (dto.startDate || dto.endDate) {
      where.invoiceDate = {};
      if (dto.startDate) {
        where.invoiceDate.gte = parseStartOfDay(dto.startDate);
      }
      if (dto.endDate) {
        where.invoiceDate.lte = parseEndOfDay(dto.endDate);
      }
    }

    const [invoices, total] = await Promise.all([
      this.prisma.purchaseInvoice.findMany({
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
          items: {
            include: {
              item: { select: { id: true, name: true, nameGujarati: true } },
            },
          },
        },
        orderBy: { invoiceDate: "desc" },
        take: dto.limit ? Number(dto.limit) : 50,
        skip: dto.offset ? Number(dto.offset) : 0,
      }),
      this.prisma.purchaseInvoice.count({ where }),
    ]);

    return {
      items: invoices,
      total,
      limit: dto.limit ? Number(dto.limit) : 50,
      offset: dto.offset ? Number(dto.offset) : 0,
    };
  }

  /**
   * Retrieves single purchase invoice details by ID.
   */
  /**
   * Retrieves single purchase invoice details by ID.
   */
  async getPurchaseInvoiceById(id: string, tenant: TenantContext) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: {
        id,
        companyId: tenant.companyId,
      },
      include: {
        party: true,
        items: {
          include: {
            item: true,
          },
        },
        branch: true,
        returns: {
          include: {
            items: {
              include: { item: true },
            },
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException(`Purchase invoice with ID ${id} not found.`);
    }

    return invoice;
  }

  /**
   * Creates a purchase return / debit note against an eligible supplier invoice.
   * Atomically:
   * 1. Validates invoice existence and tenant authorization.
   * 2. Acquires transactional advisory lock to prevent concurrent over-returns.
   * 3. Validates financial year is open (not locked).
   * 4. Validates line items and verifies return quantity <= remaining returnable quantity.
   * 5. Creates PurchaseReturn and PurchaseReturnItem records.
   * 6. Posts outward stock transaction (PURCHASE_RETURN) to stock ledger.
   * 7. Creates balanced double-entry Debit Note voucher (DEBIT_NOTE):
   *    Dr: Supplier Account (gross return)
   *    Cr: General Purchases Account (taxable)
   *    Cr: Input CGST/SGST/IGST Accounts (tax reversal)
   * 8. Reconciles purchase invoice balanceAmount.
   * 9. Records audit trail.
   */
  async createPurchaseReturn(
    purchaseId: string,
    dto: CreatePurchaseReturnDto,
    tenant: TenantContext,
  ): Promise<any> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        "Purchase return must contain at least one line item.",
      );
    }

    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      // 1. Transactional advisory lock on this specific purchase invoice
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`purchase_return_${purchaseId}`})::bigint)
      `;

      // 2. Fetch purchase invoice and company
      const [company, invoice] = await Promise.all([
        tx.company.findUnique({
          where: { id: tenant.companyId },
          select: { id: true, stateCode: true, legalName: true },
        }),
        tx.purchaseInvoice.findFirst({
          where: { id: purchaseId, companyId: tenant.companyId },
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
          `Purchase invoice with ID ${purchaseId} not found.`,
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
          "Cannot create purchase return in a locked financial year.",
        );
      }

      // 4. Calculate previously returned quantities per line item
      const returnedQtyMap = new Map<string, Decimal>();
      for (const ret of invoice.returns) {
        for (const itm of ret.items) {
          const prev = returnedQtyMap.get(itm.purchaseItemId) || new Decimal(0);
          returnedQtyMap.set(
            itm.purchaseItemId,
            prev.plus(toDecimal(itm.quantity)),
          );
        }
      }

      // 5. Reverse the tax stored on the original bill, in the same SGST or UTGST ledger.
      let sumTaxable = new Decimal(0);
      let sumCgst = new Decimal(0);
      let sumSgst = new Decimal(0);
      let sumUtgst = new Decimal(0);
      let sumIgst = new Decimal(0);

      const returnItemsData: Array<{
        purchaseItemId: string;
        itemId: string;
        quantity: Decimal;
        unitPrice: Decimal;
        taxableAmount: Decimal;
        taxRate: Decimal;
        cgstAmount: Decimal;
        sgstAmount: Decimal;
        utgstAmount: Decimal;
        igstAmount: Decimal;
        totalAmount: Decimal;
      }> = [];

      for (const line of dto.items) {
        const qty = toDecimal(line.quantity);
        if (qty.lte(0)) {
          throw new BadRequestException(
            "Return quantity must be strictly greater than 0.",
          );
        }

        const origLine = invoice.items.find(
          (i) => i.id === line.purchaseItemId,
        );
        if (!origLine) {
          throw new BadRequestException(
            `Purchase line item ${line.purchaseItemId} not found in this invoice.`,
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
        const ratio = qty.dividedBy(originalQty);
        const portion = (amount: Decimal | string | number) =>
          toDecimal(amount).times(ratio).toDecimalPlaces(2);
        const cgst = portion(origLine.cgstAmount);
        const sgst = portion(origLine.sgstAmount);
        const utgst = portion(origLine.utgstAmount ?? 0);
        const igst = portion(origLine.igstAmount);
        const totalAmount = taxable.plus(cgst).plus(sgst).plus(utgst).plus(igst);

        sumTaxable = sumTaxable.plus(taxable);
        sumCgst = sumCgst.plus(cgst);
        sumSgst = sumSgst.plus(sgst);
        sumUtgst = sumUtgst.plus(utgst);
        sumIgst = sumIgst.plus(igst);

        returnItemsData.push({
          purchaseItemId: origLine.id,
          itemId: origLine.itemId,
          quantity: qty,
          unitPrice,
          taxableAmount: taxable,
          taxRate,
          cgstAmount: cgst,
          sgstAmount: sgst,
          utgstAmount: utgst,
          igstAmount: igst,
          totalAmount,
        });
      }

      const grandTotal = sumTaxable.plus(sumCgst).plus(sumSgst).plus(sumUtgst).plus(sumIgst);

      // 6. Resolve Warehouse
      let warehouseId = dto.warehouseId;
      if (!warehouseId) {
        const origStockTx = await tx.stockTransaction.findFirst({
          where: {
            referenceDocType: "PURCHASE_INVOICE",
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

      if (!warehouseId) {
        throw new BadRequestException(
          "Warehouse is required for stock deduction.",
        );
      }

      // 7. Generate Return Number (Debit Note number)
      const returnCount = await tx.purchaseReturn.count({
        where: { companyId: tenant.companyId },
      });
      const returnNumber =
        dto.returnNumber ||
        `DN-${returnDate.getFullYear()}-${String(returnCount + 1).padStart(4, "0")}`;

      // 8. Create PurchaseReturn and PurchaseReturnItem records
      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          branchId: invoice.branchId,
          financialYearId: fy.id,
          purchaseInvoiceId: invoice.id,
          partyId: invoice.partyId,
          returnNumber,
          returnDate,
          reason: dto.reason || "Goods returned to supplier",
          reasonGujarati: dto.reasonGujarati || "માલ સપ્લાયરને પરત કર્યો",
          taxableAmount: sumTaxable.toFixed(2),
          cgstAmount: sumCgst.toFixed(2),
          sgstAmount: sumSgst.toFixed(2),
          utgstAmount: sumUtgst.toFixed(2),
          igstAmount: sumIgst.toFixed(2),
          grandTotal: grandTotal.toFixed(2),
          items: {
            create: returnItemsData.map((item) => ({
              purchaseItemId: item.purchaseItemId,
              itemId: item.itemId,
              quantity: item.quantity.toFixed(4),
              unitPrice: item.unitPrice.toFixed(4),
              taxableAmount: item.taxableAmount.toFixed(2),
              taxRate: item.taxRate.toFixed(2),
              cgstAmount: item.cgstAmount.toFixed(2),
              sgstAmount: item.sgstAmount.toFixed(2),
              utgstAmount: item.utgstAmount.toFixed(2),
              igstAmount: item.igstAmount.toFixed(2),
              totalAmount: item.totalAmount.toFixed(2),
            })),
          },
        },
        include: {
          items: {
            include: { item: true, purchaseItem: true },
          },
          party: true,
          purchaseInvoice: true,
        },
      });

      // 9. Stock-out movements (PURCHASE_RETURN)
      for (const line of returnItemsData) {
        await tx.stockTransaction.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            warehouseId,
            itemId: line.itemId,
            transactionType: StockTransactionType.PURCHASE_RETURN,
            transactionDate: returnDate,
            quantity: line.quantity.negated().toFixed(4), // Negative for outward deduction
            valuationRate: line.unitPrice.toFixed(4),
            totalValuation: line.taxableAmount.toFixed(2),
            referenceDocType: "PURCHASE_RETURN",
            referenceDocId: purchaseReturn.id,
          },
        });
      }

      // 10. Debit Note Voucher Posting
      // Dr: Supplier Account (Creditor) for grandTotal
      // Cr: General Purchases Account for sumTaxable
      // Cr: Input CGST for sumCgst
      // Cr: Input SGST for sumSgst
      // Cr: Input IGST for sumIgst
      const purchaseAccount = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          OR: [
            { name: { contains: "Purchase", mode: "insensitive" } },
            { code: "5010" },
          ],
        },
      });

      const itcCgstAccount = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          OR: [
            { name: { contains: "Input CGST", mode: "insensitive" } },
            { code: "1110" },
          ],
        },
      });

      const itcSgstAccount = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          OR: [
            { name: { contains: "Input SGST", mode: "insensitive" } },
            { code: "1120" },
          ],
        },
      });

      const itcIgstAccount = await tx.ledgerAccount.findFirst({
        where: {
          companyId: tenant.companyId,
          OR: [
            { name: { contains: "Input IGST", mode: "insensitive" } },
            { code: "1130" },
          ],
        },
      });

      let supplierAccount = invoice.party.ledgerAccount;
      if (!supplierAccount) {
        supplierAccount = await tx.ledgerAccount.findFirst({
          where: {
            companyId: tenant.companyId,
            OR: [{ partyId: invoice.party.id }, { name: invoice.party.name }],
          },
        });
      }

      if (purchaseAccount && supplierAccount) {
        const voucherCount = await tx.voucher.count({
          where: {
            companyId: tenant.companyId,
            financialYearId: fy.id,
            voucherType: VoucherType.DEBIT_NOTE,
          },
        });
        const voucherNumber = `V-DN-${returnDate.getFullYear()}-${String(voucherCount + 1).padStart(4, "0")}`;

        const journalLines: Array<{
          accountId: string;
          debitAmount: Decimal;
          creditAmount: Decimal;
          lineNarration: string;
          sequenceOrder: number;
        }> = [];

        let seq = 1;
        // Dr: Supplier Account (reducing accounts payable liability)
        journalLines.push({
          accountId: supplierAccount.id,
          debitAmount: grandTotal,
          creditAmount: new Decimal(0),
          lineNarration: `Debit Note against bill ${invoice.vendorInvoiceNumber} (${invoice.party.name})`,
          sequenceOrder: seq++,
        });

        // Cr: Purchases (reversing purchase expense)
        journalLines.push({
          accountId: purchaseAccount.id,
          debitAmount: new Decimal(0),
          creditAmount: sumTaxable,
          lineNarration: `Purchase return against bill ${invoice.vendorInvoiceNumber}`,
          sequenceOrder: seq++,
        });

        // Cr: Input CGST Reversal
        if (sumCgst.gt(0)) {
          const acc =
            itcCgstAccount ||
            (await tx.ledgerAccount.findFirst({
              where: {
                companyId: tenant.companyId,
                OR: [
                  { name: { contains: "Input CGST", mode: "insensitive" } },
                  { code: "1110" },
                ],
              },
            }));
          if (acc) {
            journalLines.push({
              accountId: acc.id,
              debitAmount: new Decimal(0),
              creditAmount: sumCgst,
              lineNarration: `ITC CGST Reversal on return ${returnNumber}`,
              sequenceOrder: seq++,
            });
          }
        }

        // Cr: Input SGST Reversal
        if (sumSgst.gt(0)) {
          const acc =
            itcSgstAccount ||
            (await tx.ledgerAccount.findFirst({
              where: {
                companyId: tenant.companyId,
                OR: [
                  { name: { contains: "Input SGST", mode: "insensitive" } },
                  { code: "1120" },
                ],
              },
            }));
          if (acc) {
            journalLines.push({
              accountId: acc.id,
              debitAmount: new Decimal(0),
              creditAmount: sumSgst,
              lineNarration: `ITC SGST Reversal on return ${returnNumber}`,
              sequenceOrder: seq++,
            });
          }
        }

        if (sumUtgst.gt(0)) {
          let utgstAccount = await tx.ledgerAccount.findFirst({
            where: {
              companyId: tenant.companyId,
              OR: [
                { name: { contains: "Input UTGST", mode: "insensitive" } },
                { code: "1140" },
              ],
            },
          });
          if (!utgstAccount) {
            const group = await tx.ledgerGroup.findFirst({
              where: { companyId: tenant.companyId, name: { contains: "Duties & Taxes", mode: "insensitive" } },
            });
            if (!group) {
              throw new BadRequestException("Duties & Taxes ledger group is required to reverse Input UTGST.");
            }
            utgstAccount = await tx.ledgerAccount.create({
              data: {
                organizationId: tenant.organizationId,
                companyId: tenant.companyId,
                groupId: group.id,
                name: "Input UTGST (ITC)",
                code: "1140",
                isTaxLedger: true,
                openingType: "DR",
              },
            });
          }
          journalLines.push({
            accountId: utgstAccount.id,
            debitAmount: new Decimal(0),
            creditAmount: sumUtgst,
            lineNarration: `ITC UTGST Reversal on return ${returnNumber}`,
            sequenceOrder: seq++,
          });
        }

        // Cr: Input IGST Reversal
        if (sumIgst.gt(0)) {
          const acc =
            itcIgstAccount ||
            (await tx.ledgerAccount.findFirst({
              where: {
                companyId: tenant.companyId,
                OR: [
                  { name: { contains: "Input IGST", mode: "insensitive" } },
                  { code: "1130" },
                ],
              },
            }));
          if (acc) {
            journalLines.push({
              accountId: acc.id,
              debitAmount: new Decimal(0),
              creditAmount: sumIgst,
              lineNarration: `ITC IGST Reversal on return ${returnNumber}`,
              sequenceOrder: seq++,
            });
          }
        }

        await tx.voucher.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            financialYearId: fy.id,
            voucherType: VoucherType.DEBIT_NOTE,
            voucherNumber,
            voucherDate: returnDate,
            referenceNo: returnNumber,
            narration: `Debit note ${returnNumber} for return against bill ${invoice.vendorInvoiceNumber}`,
            narrationGujarati: `ડેબિટ નોટ ${returnNumber} - બિલ ${invoice.vendorInvoiceNumber} સામે ખરીદી પરત`,
            totalAmount: grandTotal.toFixed(2),
            isAutoGenerated: true,
            sourceDocument: "PURCHASE_RETURN",
            sourceEntityId: purchaseReturn.id,
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
      }

      // 11. Reconcile Purchase Invoice Balance.
      // A return larger than the unpaid balance is a credit owed by the supplier.
      const currentBalance = toDecimal(invoice.balanceAmount);
      const newBalance = currentBalance.minus(grandTotal);
      await tx.purchaseInvoice.update({
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
        action: "CREATE_PURCHASE_RETURN",
        entityName: "PurchaseReturn",
        entityId: purchaseReturn.id,
        newState: {
          returnNumber,
          purchaseInvoiceId: invoice.id,
          vendorInvoiceNumber: invoice.vendorInvoiceNumber,
          partyId: invoice.partyId,
          partyName: invoice.party.name,
          grandTotal: grandTotal.toFixed(2),
          itemsCount: returnItemsData.length,
        },
      });

      return purchaseReturn;
    });
  }

  /**
   * Retrieves purchase returns for a specific purchase invoice.
   */
  async getPurchaseReturnsForInvoice(
    purchaseId: string,
    tenant: TenantContext,
  ) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: {
        id: purchaseId,
        companyId: tenant.companyId,
      },
    });

    if (!invoice) {
      throw new NotFoundException(
        `Purchase invoice with ID ${purchaseId} not found.`,
      );
    }

    return this.prisma.purchaseReturn.findMany({
      where: {
        purchaseInvoiceId: purchaseId,
        companyId: tenant.companyId,
      },
      include: {
        party: true,
        items: {
          include: {
            item: true,
            purchaseItem: true,
          },
        },
      },
      orderBy: { returnDate: "desc" },
    });
  }

  /**
   * Retrieves all purchase returns across the company with filtering and pagination.
   */
  async getPurchaseReturns(
    dto: QueryPurchaseReturnsDto,
    tenant: TenantContext,
  ) {
    const where: any = {
      companyId: tenant.companyId,
    };

    if (dto.partyId) {
      where.partyId = dto.partyId;
    }
    if (dto.purchaseInvoiceId) {
      where.purchaseInvoiceId = dto.purchaseInvoiceId;
    }
    if (dto.search && dto.search.trim() !== "") {
      const q = dto.search.trim();
      where.OR = [
        { returnNumber: { contains: q, mode: "insensitive" } },
        { party: { name: { contains: q, mode: "insensitive" } } },
        {
          purchaseInvoice: {
            vendorInvoiceNumber: { contains: q, mode: "insensitive" },
          },
        },
      ];
    }
    if (dto.startDate || dto.endDate) {
      where.returnDate = {};
      if (dto.startDate) {
        where.returnDate.gte = new Date(dto.startDate);
      }
      if (dto.endDate) {
        where.returnDate.lte = new Date(dto.endDate);
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.purchaseReturn.findMany({
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
          purchaseInvoice: {
            select: {
              id: true,
              vendorInvoiceNumber: true,
              invoiceDate: true,
              grandTotal: true,
              balanceAmount: true,
            },
          },
          items: {
            include: {
              item: { select: { id: true, name: true, nameGujarati: true } },
            },
          },
        },
        orderBy: { returnDate: "desc" },
        take: dto.limit ? Number(dto.limit) : 50,
        skip: dto.offset ? Number(dto.offset) : 0,
      }),
      this.prisma.purchaseReturn.count({ where }),
    ]);

    return {
      items,
      total,
      limit: dto.limit ? Number(dto.limit) : 50,
      offset: dto.offset ? Number(dto.offset) : 0,
    };
  }

  /**
   * Retrieves single purchase return details by ID.
   */
  async getPurchaseReturnById(id: string, tenant: TenantContext) {
    const purchaseReturn = await this.prisma.purchaseReturn.findFirst({
      where: {
        id,
        companyId: tenant.companyId,
      },
      include: {
        party: true,
        purchaseInvoice: {
          include: {
            items: { include: { item: true } },
          },
        },
        items: {
          include: {
            item: true,
            purchaseItem: true,
          },
        },
        branch: true,
      },
    });

    if (!purchaseReturn) {
      throw new NotFoundException(`Purchase return with ID ${id} not found.`);
    }

    return purchaseReturn;
  }

  async deletePurchaseReturn(id: string, tenant: TenantContext) {
    const purchaseReturn = await this.prisma.purchaseReturn.findFirst({
      where: {
        id,
        companyId: tenant.companyId,
      },
    });

    if (!purchaseReturn) {
      throw new NotFoundException(`Purchase return with ID ${id} not found.`);
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Delete associated stock transactions
      await tx.stockTransaction.deleteMany({
        where: {
          companyId: tenant.companyId,
          referenceDocId: id,
        },
      });

      // 2. Revert account balances and delete associated vouchers
      const vouchers = await tx.voucher.findMany({
        where: {
          companyId: tenant.companyId,
          sourceEntityId: id,
        },
        include: { journalEntries: true },
      });

      for (const voucher of vouchers) {
        for (const entry of voucher.journalEntries) {
          const acc = await tx.ledgerAccount.findUnique({
            where: { id: entry.accountId },
            include: { group: true },
          });
          if (acc) {
            const reversedBalance = applyTransactionToBalance(
              acc.group.nature as any,
              acc.currentBalance.toString(),
              entry.creditAmount,
              entry.debitAmount,
            );
            await tx.ledgerAccount.update({
              where: { id: acc.id },
              data: { currentBalance: reversedBalance.toFixed(2) },
            });
          }
        }
      }

      if (vouchers.length > 0) {
        await tx.voucher.deleteMany({
          where: {
            companyId: tenant.companyId,
            sourceEntityId: id,
          },
        });
      }

      // 3. Restore purchase invoice balance if linked
      if (purchaseReturn.purchaseInvoiceId) {
        const inv = await tx.purchaseInvoice.findUnique({
          where: { id: purchaseReturn.purchaseInvoiceId },
        });
        if (inv) {
          const restoredBalance = toDecimal(inv.balanceAmount).plus(
            toDecimal(purchaseReturn.grandTotal),
          );
          await tx.purchaseInvoice.update({
            where: { id: inv.id },
            data: { balanceAmount: restoredBalance.toFixed(2) },
          });
        }
      }

      // 4. Delete return items
      await tx.purchaseReturnItem.deleteMany({
        where: { returnId: id },
      });

      // 5. Delete return document
      const deleted = await tx.purchaseReturn.delete({
        where: { id },
      });

      await this.audit.record({
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId || "",
        action: "DELETE_PURCHASE_RETURN",
        entityName: "PurchaseReturn",
        entityId: id,
        newState: {
          returnNumber: purchaseReturn.returnNumber,
          grandTotal: purchaseReturn.grandTotal?.toString(),
        },
      });

      return { success: true, message: "Purchase return deleted successfully", deleted };
    });
  }

  async updatePurchaseReturn(
    id: string,
    dto: CreatePurchaseReturnDto & { purchaseInvoiceId?: string; returnNumber?: string },
    tenant: TenantContext,
  ) {
    const existing = await this.prisma.purchaseReturn.findFirst({
      where: { id, companyId: tenant.companyId },
    });
    if (!existing) {
      throw new NotFoundException(`Purchase return with ID ${id} not found.`);
    }

    // 1. Delete previous return records, stock, and ledger atomically
    await this.deletePurchaseReturn(id, tenant);

    // 2. Re-create with the updated items and preserve returnNumber
    const purchaseId = dto.purchaseInvoiceId || existing.purchaseInvoiceId;
    return await this.createPurchaseReturn(
      purchaseId,
      {
        ...dto,
        returnNumber: dto.returnNumber || existing.returnNumber,
      },
      tenant,
    );
  }

  async recordPurchasePayment(
    purchaseId: string,
    dto: RecordPurchasePaymentDto,
    tenant: TenantContext,
    idempotencyKey?: string,
  ) {
    return this.recordSupplierPayment(
      {
        ...dto,
        allocations: [
          {
            purchaseInvoiceId: purchaseId,
            amount: dto.amount ?? 0,
            cashDiscount: dto.cashDiscount,
          },
        ],
      },
      tenant,
      idempotencyKey,
    );
  }

  async recordSupplierPayment(
    dto: RecordPurchasePaymentDto,
    tenant: TenantContext,
    idempotencyKey?: string,
  ) {
    const allocations = dto.allocations || [];
    if (allocations.length === 0) {
      throw new BadRequestException("Allocate the payment to at least one purchase bill.");
    }
    const seen = new Set<string>();
    for (const row of allocations) {
      if (!row.purchaseInvoiceId || seen.has(row.purchaseInvoiceId)) {
        throw new BadRequestException("Each purchase bill can appear once in a payment.");
      }
      seen.add(row.purchaseInvoiceId);
    }

    const replayKey = (idempotencyKey || dto.referenceNo || "").trim();
    try {
      return await this.prisma.executeInTenantContext(tenant, async (tx) => {
        if (replayKey) {
          const lockKey = `purchase_pay_key_${tenant.companyId}_${replayKey}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
          const existing = await tx.voucher.findFirst({
            where: {
              companyId: tenant.companyId,
              voucherType: VoucherType.PAYMENT,
              sourceDocument: "PURCHASE_PAYMENT",
              referenceNo: replayKey,
              isCancelled: false,
            },
            include: {
              allocations: true,
              journalEntries: true,
            },
          });
          if (existing) {
            return { replayed: true, voucher: existing, allocations: existing.allocations };
          }
        }

        const ids = [...seen].sort();
        for (const id of ids) {
          const lockKey = `purchase_pay_bill_${tenant.companyId}_${id}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;
        }

        const bills = await tx.purchaseInvoice.findMany({
          where: { id: { in: ids }, companyId: tenant.companyId },
          include: { party: { include: { ledgerAccount: true } }, financialYear: true },
        });
        if (bills.length !== ids.length) {
          throw new NotFoundException("One or more purchase bills were not found for this company.");
        }

        const partyId = bills[0].partyId;
        if (bills.some((bill) => bill.partyId !== partyId)) {
          throw new BadRequestException("One payment can settle bills from only one supplier.");
        }
        if (bills[0].party.type === "CUSTOMER") {
          await tx.party.update({
            where: { id: partyId },
            data: { type: "BOTH" },
          });
        }

        const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
        if (Number.isNaN(paymentDate.getTime())) {
          throw new BadRequestException("Payment date is invalid.");
        }
        let financialYear = await tx.financialYear.findFirst({
          where: {
            companyId: tenant.companyId,
            startDate: { lte: paymentDate },
            endDate: { gte: paymentDate },
          },
        });
        if (!financialYear) financialYear = bills[0].financialYear;
        const periodCheck = validatePeriodAccess(paymentDate, tenant.companyId, financialYear);
        if (!periodCheck.isAllowed) {
          throw new BadRequestException(periodCheck.reason);
        }

        const byId = new Map(bills.map((bill) => [bill.id, bill]));
        let cashTotal = new Decimal(0);
        let discountTotal = new Decimal(0);
        const settledRows: Array<{ bill: (typeof bills)[number]; cash: Decimal; discount: Decimal }> = [];
        for (const row of allocations) {
          const bill = byId.get(row.purchaseInvoiceId)!;
          const cash = toMoney(row.amount || 0);
          const discount = toMoney(row.cashDiscount || 0);
          if (cash.lessThanOrEqualTo(0)) {
            throw new BadRequestException("Payment amount must be greater than zero.");
          }
          if (discount.lessThan(0)) {
            throw new BadRequestException("Cash discount cannot be negative.");
          }
          const outstanding = toMoney(bill.balanceAmount);
          if (outstanding.lessThanOrEqualTo(0)) {
            throw new BadRequestException(
              `Bill ${bill.vendorInvoiceNumber} has no remaining payable. Supplier advances are not recorded on this screen.`,
            );
          }
          const settled = cash.plus(discount);
          if (settled.greaterThan(outstanding)) {
            throw new BadRequestException(
              `Settlement of ₹${settled.toFixed(2)} exceeds the remaining payable of ₹${outstanding.toFixed(2)} on ${bill.vendorInvoiceNumber}.`,
            );
          }
          cashTotal = cashTotal.plus(cash);
          discountTotal = discountTotal.plus(discount);
          settledRows.push({ bill, cash, discount });
        }
        if (dto.amount !== undefined && dto.amount !== null && String(dto.amount) !== "") {
          const declared = toMoney(dto.amount);
          if (!declared.equals(cashTotal)) {
            throw new BadRequestException("The payment amount must equal the sum of the bill allocations.");
          }
        }

        const mode = dto.paymentMode || PaymentMode.CASH;
        let creditAccount = dto.paidFromAccountId
          ? await tx.ledgerAccount.findFirst({
              where: { id: dto.paidFromAccountId, companyId: tenant.companyId, isActive: true },
              include: { group: true },
            })
          : null;
        if (!creditAccount && mode === PaymentMode.CASH) {
          creditAccount = await tx.ledgerAccount.findFirst({
            where: { companyId: tenant.companyId, name: "Cash Account", isActive: true },
            include: { group: true },
          });
        }
        if (!creditAccount) {
          throw new NotFoundException("Choose an active cash or bank account for this payment.");
        }

        let supplierAccount = bills[0].party.ledgerAccount;
        if (!supplierAccount) {
          supplierAccount = await tx.ledgerAccount.findFirst({
            where: { companyId: tenant.companyId, partyId },
            include: { group: true },
          });
        }
        if (!supplierAccount) {
          throw new NotFoundException("The supplier ledger account was not found.");
        }

        let discountAccount: { id: string } | null = null;
        if (discountTotal.greaterThan(0)) {
          discountAccount = await tx.ledgerAccount.findFirst({
            where: { companyId: tenant.companyId, name: "Discount Received", isActive: true },
          });
          if (!discountAccount) {
            throw new BadRequestException("Discount Received ledger is required before a cash discount can be posted.");
          }
        }

        const supplierDebit = cashTotal.plus(discountTotal);
        const journalLines = [
          {
            accountId: supplierAccount.id,
            debitAmount: supplierDebit.toNumber(),
            creditAmount: 0,
            lineNarration: `Payment to ${bills[0].party.name}`,
          },
          {
            accountId: creditAccount.id,
            debitAmount: 0,
            creditAmount: cashTotal.toNumber(),
            lineNarration: `Paid from ${creditAccount.name}`,
          },
        ];
        if (discountAccount) {
          journalLines.push({
            accountId: discountAccount.id,
            debitAmount: 0,
            creditAmount: discountTotal.toNumber(),
            lineNarration: "Discount received on supplier payment",
          });
        }
        const validation = validateJournalLines(journalLines);
        if (!validation.isValid) {
          throw new BadRequestException(validation.errors.join("; "));
        }

        const voucherNumber = replayKey
          ? `PAY/${replayKey.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "REF"}`
          : `PAY-${Date.now().toString(36).toUpperCase()}`;

        for (const row of settledRows) {
          const nextPaid = toMoney(row.bill.paidAmount).plus(row.cash).plus(row.discount);
          const nextBalance = toMoney(row.bill.balanceAmount).minus(row.cash).minus(row.discount);
          await tx.purchaseInvoice.update({
            where: { id: row.bill.id },
            data: {
              paidAmount: nextPaid.toFixed(2),
              balanceAmount: nextBalance.toFixed(2),
            },
          });
        }

        const voucher = await tx.voucher.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            financialYearId: financialYear.id,
            voucherType: VoucherType.PAYMENT,
            voucherNumber,
            voucherDate: paymentDate,
            referenceNo: replayKey || dto.referenceNo || null,
            narration: dto.notes || `Payment to ${bills[0].party.name}`,
            narrationGujarati: `ચુકવણી - ${bills[0].party.nameGujarati || bills[0].party.name}`,
            totalAmount: supplierDebit.toFixed(2),
            isAutoGenerated: true,
            sourceDocument: "PURCHASE_PAYMENT",
            sourceEntityId: partyId,
            journalEntries: {
              create: journalLines.map((line, index) => ({
                accountId: line.accountId,
                debitAmount: line.debitAmount,
                creditAmount: line.creditAmount,
                lineNarration: line.lineNarration,
                sequenceOrder: index + 1,
              })),
            },
          },
          include: { journalEntries: true },
        });

        for (const line of journalLines) {
          const account = await tx.ledgerAccount.findUnique({
            where: { id: line.accountId },
            include: { group: true },
          });
          if (!account) continue;
          const nextBalance = applyTransactionToBalance(
            account.group.nature as any,
            account.currentBalance.toString(),
            toMoney(line.debitAmount),
            toMoney(line.creditAmount),
          );
          await tx.ledgerAccount.update({
            where: { id: account.id },
            data: { currentBalance: nextBalance.toFixed(2) },
          });
        }

        const createdAllocations = [];
        for (const row of settledRows) {
          createdAllocations.push(
            await tx.paymentAllocation.create({
              data: {
                voucherId: voucher.id,
                purchaseInvoiceId: row.bill.id,
                allocatedAmount: row.cash.toFixed(2),
                cashDiscount: row.discount.toFixed(2),
                allocationDate: paymentDate,
              },
            }),
          );
        }

        await this.audit.record(
          {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
            action: "POST_PURCHASE_PAYMENT",
            entityName: "Voucher",
            entityId: voucher.id,
            newState: {
              voucherNumber: voucher.voucherNumber,
              supplier: bills[0].party.name,
              cashPaid: cashTotal.toFixed(2),
              discount: discountTotal.toFixed(2),
              billIds: ids,
            },
          },
          tx,
        );

        const updatedBills = await tx.purchaseInvoice.findMany({
          where: { id: { in: ids }, companyId: tenant.companyId },
          select: {
            id: true,
            vendorInvoiceNumber: true,
            grandTotal: true,
            paidAmount: true,
            balanceAmount: true,
          },
        });
        return { replayed: false, voucher, allocations: createdAllocations, bills: updatedBills };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(
          "This payment reference is already used by another voucher. The purchase bill balances were not changed.",
        );
      }
      throw error;
    }
  }

  async listPurchasePayments(purchaseId: string, tenant: TenantContext) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const bill = await tx.purchaseInvoice.findFirst({
        where: { id: purchaseId, companyId: tenant.companyId },
        select: {
          id: true,
          vendorInvoiceNumber: true,
          grandTotal: true,
          paidAmount: true,
          balanceAmount: true,
          party: { select: { id: true, name: true, nameGujarati: true } },
        },
      });
      if (!bill) throw new NotFoundException("Purchase bill not found.");
      const payments = await tx.paymentAllocation.findMany({
        where: { purchaseInvoiceId: purchaseId },
        include: {
          voucher: {
            select: {
              id: true,
              voucherNumber: true,
              voucherDate: true,
              referenceNo: true,
              narration: true,
              isCancelled: true,
            },
          },
        },
        orderBy: { allocationDate: "asc" },
      });
      return { bill, payments };
    });
  }

  async deletePurchaseInvoice(id: string, tenant: TenantContext) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const existing = await tx.purchaseInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
      });

      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          message: `Purchase bill with ID '${id}' not found.`,
          messageGujarati: `ખરીદી બિલ મળેલ નથી.`,
        });
      }

      // 1. Delete associated stock transactions
      await tx.stockTransaction.deleteMany({
        where: {
          referenceDocType: "PURCHASE_INVOICE",
          referenceDocId: id,
        },
      });

      // 2. Delete payment allocations
      await tx.paymentAllocation.deleteMany({
        where: { purchaseInvoiceId: id },
      });

      // 3. Delete purchase return items and returns
      await tx.purchaseReturnItem.deleteMany({
        where: { returnDoc: { purchaseInvoiceId: id } },
      });
      await tx.purchaseReturn.deleteMany({
        where: { purchaseInvoiceId: id },
      });

      // 4. Delete gstr2b reconciliation links and scans
      await tx.gstr2bReconciliation.deleteMany({
        where: { purchaseInvoiceId: id },
      });
      await tx.purchaseBillScan.deleteMany({
        where: { purchaseInvoiceId: id },
      });

      // 5. Delete items
      await tx.purchaseInvoiceItem.deleteMany({
        where: { invoiceId: id },
      });

      // 6. Delete invoice
      await tx.purchaseInvoice.delete({
        where: { id },
      });

      return {
        success: true,
        message: `Purchase bill '${existing.vendorInvoiceNumber}' deleted successfully.`,
        messageGujarati: `ખરીદી બિલ '${existing.vendorInvoiceNumber}' સફળતાપૂર્વક કાઢી નાખવામાં આવ્યું છે.`,
      };
    });
  }

  async bulkDeletePurchaseInvoices(ids: string[], tenant: TenantContext) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: "No purchase invoice IDs provided for deletion.",
        messageGujarati: "કાઢી નાખવા માટે કોઈ ખરીદી બિલ પસંદ કરેલ નથી.",
      });
    }

    let deletedCount = 0;
    for (const id of ids) {
      try {
        await this.deletePurchaseInvoice(id, tenant);
        deletedCount++;
      } catch {
        // continue
      }
    }

    return {
      success: true,
      count: ids.length,
      deletedCount,
      message: `${deletedCount} purchase bills deleted successfully.`,
      messageGujarati: `${deletedCount} ખરીદી બિલો સફળતાપૂર્વક કાઢી નાખવામાં આવ્યા છે.`,
    };
  }
}
