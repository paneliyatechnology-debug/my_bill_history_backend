import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import { DatabaseService } from "../database/database.service";
import { ReportsService } from "../reports/reports.service";
import { VouchersService } from "../vouchers/vouchers.service";
import { buildInvoiceUrls } from "../invoice-print/invoice-url.helper";

export interface DashboardTransaction {
  id: string;
  type: "Sales Invoice" | "Purchase Invoice" | "Expenses";
  txnNo: string;
  partyName: string;
  amount: number;
  date: string;
  rawDate: string;
  link: string;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly reportsService: ReportsService,
    private readonly vouchersService: VouchersService,
  ) { }

  async getSummary(tenant: TenantContext, query?: any) {
    return await this.reportsService.getFinancialSummary(tenant, query);
  }

  /**
   * Retrieves upcoming and overdue invoices due within the given horizon (default: next 3 days).
   * Supports filtering by SALES, PURCHASES, or ALL.
   */
  async getUpcomingDues(
    tenant: TenantContext,
    daysAhead: number = 3,
    typeFilter: "ALL" | "SALES" | "PURCHASES" = "ALL",
  ) {
    const today = new Date();
    // Midnight UTC today for consistent date comparisons against @db.Date columns
    const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

    const targetDays = Number(daysAhead) > 0 ? Number(daysAhead) : 3;
    const horizonDate = new Date(todayUtc);
    horizonDate.setUTCDate(horizonDate.getUTCDate() + targetDays);
    horizonDate.setUTCHours(23, 59, 59, 999);

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      let fyRecord: { id: string; startDate: Date; endDate: Date } | null = null;
      if (tenant.financialYearId) {
        fyRecord = await tx.financialYear.findFirst({
          where: { id: tenant.financialYearId, companyId: tenant.companyId },
          select: { id: true, startDate: true, endDate: true },
        });
      }

      const dues: any[] = [];
      let totalOverdueAmount = 0;
      let totalDueSoonAmount = 0;

      // 1. Sales Invoices (Receivables / Collections)
      if (typeFilter === "ALL" || typeFilter === "SALES") {
        const salesWhere: any = {
          companyId: tenant.companyId,
          balanceAmount: { gt: 0 },
          status: { notIn: ["CANCELLED", "DRAFT", "PAID"] },
          dueDate: { not: null, lte: horizonDate },
        };
        if (fyRecord) {
          salesWhere.OR = [
            { financialYearId: fyRecord.id },
            { invoiceDate: { gte: fyRecord.startDate, lte: fyRecord.endDate } },
          ];
        }

        const salesInvoices = await tx.salesInvoice.findMany({
          where: salesWhere,
          include: {
            party: {
              select: { id: true, name: true, phone: true },
            },
          },
          orderBy: [{ dueDate: "asc" }, { invoiceDate: "asc" }],
        });

        for (const inv of salesInvoices) {
          if (!inv.dueDate) continue;
          const rawDue = new Date(inv.dueDate);
          const dueUtc = new Date(Date.UTC(rawDue.getUTCFullYear(), rawDue.getUTCMonth(), rawDue.getUTCDate()));
          const diffDays = Math.round((dueUtc.getTime() - todayUtc.getTime()) / (1000 * 60 * 60 * 24));
          const dueDateStr = rawDue.toISOString().split("T")[0];

          let urgencyStatus: "OVERDUE" | "DUE_TODAY" | "DUE_SOON";
          if (diffDays < 0) {
            urgencyStatus = "OVERDUE";
            totalOverdueAmount += Number(inv.balanceAmount);
          } else if (diffDays === 0) {
            urgencyStatus = "DUE_TODAY";
            totalDueSoonAmount += Number(inv.balanceAmount);
          } else {
            urgencyStatus = "DUE_SOON";
            totalDueSoonAmount += Number(inv.balanceAmount);
          }

          dues.push({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: inv.invoiceDate.toISOString().split("T")[0],
            dueDate: dueDateStr,
            hasExplicitDueDate: true,
            daysRemaining: diffDays,
            urgencyStatus,
            partyId: inv.party?.id,
            partyName: inv.party?.name || "Customer",
            partyPhone: inv.party?.phone || "",
            grandTotal: Number(inv.grandTotal),
            paidAmount: Number(inv.paidAmount),
            balanceAmount: Number(inv.balanceAmount),
            type: "SALES_INVOICE",
            deepLink: `/sales/invoices/${inv.id}`,
            actionLink: `/sales/payment-in/new?partyId=${inv.party?.id || ""}&invoiceId=${inv.id}&amount=${inv.balanceAmount}`,
            actionLabel: "Collect Payment",
          });
        }
      }

      // 2. Purchase Invoices (Payables / Supplier Bills)
      if (typeFilter === "ALL" || typeFilter === "PURCHASES") {
        const purchaseWhere: any = {
          companyId: tenant.companyId,
          balanceAmount: { gt: 0 },
          dueDate: { not: null, lte: horizonDate },
        };
        if (fyRecord) {
          purchaseWhere.OR = [
            { financialYearId: fyRecord.id },
            { invoiceDate: { gte: fyRecord.startDate, lte: fyRecord.endDate } },
          ];
        }

        const purchaseInvoices = await tx.purchaseInvoice.findMany({
          where: purchaseWhere,
          include: {
            party: {
              select: { id: true, name: true, phone: true },
            },
          },
          orderBy: [{ dueDate: "asc" }, { invoiceDate: "asc" }],
        });

        for (const bill of purchaseInvoices) {
          if (!bill.dueDate) continue;
          const rawDue = new Date(bill.dueDate);
          const dueUtc = new Date(Date.UTC(rawDue.getUTCFullYear(), rawDue.getUTCMonth(), rawDue.getUTCDate()));
          const diffDays = Math.round((dueUtc.getTime() - todayUtc.getTime()) / (1000 * 60 * 60 * 24));
          const dueDateStr = rawDue.toISOString().split("T")[0];

          let urgencyStatus: "OVERDUE" | "DUE_TODAY" | "DUE_SOON";
          if (diffDays < 0) {
            urgencyStatus = "OVERDUE";
            totalOverdueAmount += Number(bill.balanceAmount);
          } else if (diffDays === 0) {
            urgencyStatus = "DUE_TODAY";
            totalDueSoonAmount += Number(bill.balanceAmount);
          } else {
            urgencyStatus = "DUE_SOON";
            totalDueSoonAmount += Number(bill.balanceAmount);
          }

          dues.push({
            id: bill.id,
            invoiceNumber: bill.vendorInvoiceNumber || "Bill",
            invoiceDate: bill.invoiceDate.toISOString().split("T")[0],
            dueDate: dueDateStr,
            hasExplicitDueDate: true,
            daysRemaining: diffDays,
            urgencyStatus,
            partyId: bill.party?.id,
            partyName: bill.party?.name || "Supplier",
            partyPhone: bill.party?.phone || "",
            grandTotal: Number(bill.grandTotal),
            paidAmount: Number(bill.paidAmount),
            balanceAmount: Number(bill.balanceAmount),
            type: "PURCHASE_INVOICE",
            deepLink: `/purchases/${bill.id}`,
            actionLink: `/purchases/payment-out/new?partyId=${bill.party?.id || ""}&billId=${bill.id}&amount=${bill.balanceAmount}`,
            actionLabel: "Pay Bill",
          });
        }
      }

      // Sort by urgency: most overdue first (negative diffDays), then due today, then upcoming
      dues.sort((a, b) => a.daysRemaining - b.daysRemaining);

      const salesDues = dues.filter((d) => d.type === "SALES_INVOICE");
      const purchaseDues = dues.filter((d) => d.type === "PURCHASE_INVOICE");

      return {
        dues,
        totalSalesDueAmount: salesDues.reduce((sum, d) => sum + d.balanceAmount, 0),
        totalPurchaseDueAmount: purchaseDues.reduce((sum, d) => sum + d.balanceAmount, 0),
        salesCount: salesDues.length,
        purchaseCount: purchaseDues.length,
        totalOverdueAmount,
        totalDueSoonAmount,
        totalDueAmount: totalOverdueAmount + totalDueSoonAmount,
        count: dues.length,
      };
    });
  }

  async getLatestTransactions(
    tenant: TenantContext,
    limit: number = 5,
  ): Promise<{ transactions: any[]; items: any[]; total: number }> {
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 5));
    const res = await this.getAllTransactions(tenant, {
      page: 1,
      limit: safeLimit,
      sortBy: "date",
      sortOrder: "desc",
    });
    return {
      transactions: res.items,
      items: res.items,
      total: res.total,
    };
  }

  async getSalesOverview(tenant: TenantContext, daysCount: number = 7) {
    const days = Math.min(30, Math.max(1, Number(daysCount) || 7));

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      let anchorDate = new Date();
      let fyRecord: { id: string; startDate: Date; endDate: Date } | null = null;
      if (tenant.financialYearId) {
        fyRecord = await tx.financialYear.findFirst({
          where: { id: tenant.financialYearId, companyId: tenant.companyId },
          select: { id: true, startDate: true, endDate: true },
        });
        if (fyRecord) {
          const fyEnd = new Date(fyRecord.endDate);
          const fyStart = new Date(fyRecord.startDate);
          if (anchorDate > fyEnd) {
            anchorDate = fyEnd;
          } else if (anchorDate < fyStart) {
            anchorDate = fyStart;
          }
        }
      }

      const startDate = new Date(anchorDate);
      startDate.setDate(anchorDate.getDate() - (days - 1));
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(anchorDate);
      endDate.setHours(23, 59, 59, 999);

      const invoices = await tx.salesInvoice.findMany({
        where: {
          companyId: tenant.companyId,
          status: { not: "CANCELLED" },
          invoiceDate: { gte: startDate, lte: endDate },
          ...(fyRecord
            ? {
                OR: [
                  { financialYearId: fyRecord.id },
                  { invoiceDate: { gte: fyRecord.startDate, lte: fyRecord.endDate } },
                ],
              }
            : {}),
        },
        select: {
          invoiceDate: true,
          grandTotal: true,
        },
      });

      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const chartDays: { dayLabel: string; dateIso: string; sales: number }[] = [];
      let sevenDaysSales = 0;
      let invoicesCount = invoices.length;

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(anchorDate);
        d.setDate(anchorDate.getDate() - i);
        const dayLabel = dayNames[d.getDay()];
        const dateIso = d.toISOString().slice(0, 10);

        const dayInvoices = invoices.filter((inv) =>
          inv.invoiceDate ? new Date(inv.invoiceDate).toISOString().startsWith(dateIso) : false,
        );
        const daySum = dayInvoices.reduce(
          (acc, cur) => acc + Number(cur.grandTotal || 0),
          0,
        );

        sevenDaysSales += daySum;

        chartDays.push({
          dayLabel,
          dateIso,
          sales: daySum,
        });
      }

      return {
        chartDays,
        sevenDaysSales,
        invoicesCount,
      };
    });
  }

  async getBankAccounts(tenant: TenantContext) {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const accounts = await tx.ledgerAccount.findMany({
        where: {
          companyId: tenant.companyId,
          isActive: true,
          OR: [
            { isBankLedger: true },
            { isCashLedger: true },
            {
              group: {
                name: {
                  in: [
                    "Bank Accounts",
                    "Bank OD A/c",
                    "Bank OD/OCC",
                    "Cash-in-hand",
                  ],
                },
              },
            },
          ],
        },
        include: {
          group: { select: { id: true, name: true, nature: true } },
        },
        orderBy: [{ isBankLedger: "desc" }, { name: "asc" }],
      });

      const company = await tx.company.findUnique({
        where: { id: tenant.companyId },
        select: {
          bankName: true,
          bankAccountNo: true,
          bankIfsc: true,
          bankBranch: true,
          bankAccountBarcode: true,
        },
      });

      const data = accounts.map((acc) => ({
        id: acc.id,
        name: acc.name,
        nameGujarati: acc.nameGujarati,
        code: acc.code,
        bankAccountNo: company?.bankAccountNo || acc.code || "",
        bankName: company?.bankName || acc.name,
        bankIfsc: company?.bankIfsc || "",
        bankBranch: company?.bankBranch || "",
        currentBalance: Number(acc.currentBalance),
        openingBalance: Number(acc.openingBalance),
        openingType: acc.openingType,
        isBankLedger: acc.isBankLedger,
        isCashLedger: acc.isCashLedger,
        group: acc.group,
      }));

      return {
        data,
        total: data.length,
        companyBank: company || null,
      };
    });
  }

  /**
   * Complete All Transactions list across Sales, Purchases, Payments, Expenses, Delivery Challans
   * Matching MyBillBook /app/home/vouchers/all_transactions
   */
  async getAllTransactions(
    tenant: TenantContext,
    query?: {
      startDate?: string;
      endDate?: string;
      search?: string;
      type?: string;
      rawType?: string;
      partyId?: string;
      status?: string;
      minAmount?: number;
      maxAmount?: number;
      page?: number;
      limit?: number;
      sortBy?: "date" | "amount";
      sortOrder?: "asc" | "desc";
      itemId?: string;
      item_id?: string;
      id?: string;
      sku?: string;
      itemCode?: string;
      item?: string;
      itemWise?: boolean | string;
    },
  ) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query?.limit) || 50));
    const skip = (page - 1) * limit;

    if (!tenant?.companyId) {
      throw new BadRequestException("Company context is required.");
    }

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      let fyRecord: { id: string; startDate: Date; endDate: Date } | null = null;
      const targetFyId = (query as any)?.financialYearId || tenant.financialYearId;
      if (targetFyId) {
        fyRecord = await tx.financialYear.findFirst({
          where: { id: targetFyId, companyId: tenant.companyId },
          select: { id: true, startDate: true, endDate: true },
        });
      }

      const dateFilter: any = {};
      if (query?.startDate) {
        dateFilter.gte = new Date(query.startDate);
      } else if (fyRecord?.startDate) {
        dateFilter.gte = new Date(fyRecord.startDate);
      }

      if (query?.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      } else if (fyRecord?.endDate) {
        const end = new Date(fyRecord.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      const hasDateFilter = Boolean(query?.startDate || query?.endDate || fyRecord);

      // Item filter setup (itemId, sku, itemCode, or item search)
      const rawItemId =
        query?.itemId ||
        query?.item_id ||
        query?.id ||
        (query?.itemWise &&
          String(query.itemWise) !== "true" &&
          String(query.itemWise) !== "false"
          ? String(query.itemWise).trim()
          : undefined);

      const rawSku = query?.sku || query?.itemCode;
      const targetItemSearch = query?.item;

      const isUuid = (val?: string): boolean =>
        Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val).trim()));

      // Prioritize itemId. If rawSku is actually a UUID, treat it as itemId as well!
      let targetItemId: string | undefined = undefined;
      let targetSku: string | undefined = undefined;

      if (rawItemId) {
        targetItemId = String(rawItemId).trim();
      } else if (rawSku && isUuid(rawSku)) {
        targetItemId = String(rawSku).trim();
      } else if (rawSku) {
        targetSku = String(rawSku).trim();
      }

      const hasItemFilter = Boolean(targetItemId || targetSku || targetItemSearch);

      let itemClause: any = null;
      if (targetItemId) {
        if (isUuid(targetItemId)) {
          itemClause = {
            OR: [
              { itemId: targetItemId },
              { item: { id: targetItemId } },
            ],
          };
        } else {
          itemClause = {
            OR: [
              { item: { sku: { equals: targetItemId, mode: "insensitive" } } },
              { item: { name: { contains: targetItemId, mode: "insensitive" } } },
            ],
          };
        }
      } else if (targetSku) {
        itemClause = {
          item: { sku: { equals: targetSku, mode: "insensitive" } },
        };
      } else if (targetItemSearch) {
        itemClause = {
          OR: [
            ...(isUuid(targetItemSearch) ? [{ itemId: targetItemSearch }] : []),
            { item: { sku: { equals: targetItemSearch, mode: "insensitive" } } },
            { item: { name: { contains: targetItemSearch, mode: "insensitive" } } },
          ],
        };
      }

      const itemInclude = {
        include: {
          item: {
            select: {
              id: true,
              name: true,
              sku: true,
              hsnCode: true,
              primaryUom: { select: { id: true, name: true, symbol: true } },
            },
          },
        },
      };

      // 1. Sales Invoices
      const salesWhere: any = {
        companyId: tenant.companyId,
        status: { not: "CANCELLED" },
      };
      if (hasDateFilter) salesWhere.invoiceDate = dateFilter;
      if (fyRecord) {
        salesWhere.OR = [
          { financialYearId: fyRecord.id },
          { invoiceDate: { gte: fyRecord.startDate, lte: fyRecord.endDate } },
        ];
      }
      if (itemClause) salesWhere.items = { some: itemClause };

      const salesPromise = tx.salesInvoice.findMany({
        where: salesWhere,
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        include: {
          party: { select: { id: true, name: true, phone: true } },
          items: itemInclude,
        },
        take: 300,
      });

      // 2. Purchase Invoices
      const purchaseWhere: any = { companyId: tenant.companyId };
      if (hasDateFilter) purchaseWhere.invoiceDate = dateFilter;
      if (fyRecord) {
        purchaseWhere.OR = [
          { financialYearId: fyRecord.id },
          { invoiceDate: { gte: fyRecord.startDate, lte: fyRecord.endDate } },
        ];
      }
      if (itemClause) purchaseWhere.items = { some: itemClause };

      const purchasePromise = tx.purchaseInvoice.findMany({
        where: purchaseWhere,
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        include: {
          party: { select: { id: true, name: true, phone: true } },
          items: itemInclude,
        },
        take: 300,
      });

      // 3. Vouchers (Payment In, Payment Out, Expenses, Journal, Contra)
      // Exclude auto-generated invoice accounting vouchers (SALES & PURCHASE)
      // Vouchers are omitted if item-specific filter is requested
      const voucherWhere: any = {
        companyId: tenant.companyId,
        isCancelled: false,
        voucherType: { in: ["RECEIPT", "PAYMENT", "CONTRA", "JOURNAL"] },
        NOT: [
          { voucherNumber: { startsWith: "SL/" } },
          { voucherNumber: { startsWith: "PUR/" } },
        ],
      };
      if (hasDateFilter) voucherWhere.voucherDate = dateFilter;
      if (fyRecord) {
        voucherWhere.OR = [
          { financialYearId: fyRecord.id },
          { voucherDate: { gte: fyRecord.startDate, lte: fyRecord.endDate } },
        ];
      }

      const voucherPromise = hasItemFilter
        ? Promise.resolve([])
        : tx.voucher.findMany({
          where: voucherWhere,
          orderBy: [{ voucherDate: "desc" }, { createdAt: "desc" }],
          include: {
            journalEntries: {
              include: {
                account: {
                  select: {
                    id: true,
                    name: true,
                    partyId: true,
                    isPartyLedger: true,
                    isCashLedger: true,
                    isBankLedger: true,
                    party: { select: { id: true, name: true, phone: true } },
                    group: { select: { id: true, name: true, nature: true } },
                  },
                },
              },
              orderBy: { sequenceOrder: "asc" },
            },
            allocations: {
              include: {
                salesInvoice: { select: { id: true, invoiceNumber: true, party: { select: { id: true, name: true } } } },
                purchaseInvoice: { select: { id: true, vendorInvoiceNumber: true, party: { select: { id: true, name: true } } } },
              },
            },
          },
          take: 300,
        });

      // 4. Delivery Challans
      const challanWhere: any = {
        companyId: tenant.companyId,
        status: { not: "CANCELLED" },
      };
      if (hasDateFilter) challanWhere.challanDate = dateFilter;
      if (itemClause) challanWhere.items = { some: itemClause };

      const challanPromise = tx.deliveryChallan.findMany({
        where: challanWhere,
        orderBy: [{ challanDate: "desc" }, { createdAt: "desc" }],
        include: {
          party: { select: { id: true, name: true, phone: true } },
          items: itemInclude,
        },
        take: 100,
      });

      // 5. Sales Returns (Credit Notes)
      const salesReturnWhere: any = { companyId: tenant.companyId };
      if (hasDateFilter) salesReturnWhere.returnDate = dateFilter;
      if (itemClause) {
        salesReturnWhere.items = {
          some: {
            OR: [
              ...(targetItemId && isUuid(targetItemId) ? [{ itemId: targetItemId }] : []),
              { salesItem: itemClause },
            ],
          },
        };
      }

      const salesReturnPromise = tx.salesReturn.findMany({
        where: salesReturnWhere,
        orderBy: [{ returnDate: "desc" }, { createdAt: "desc" }],
        include: {
          party: { select: { id: true, name: true, phone: true } },
          items: {
            include: {
              item: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  hsnCode: true,
                  primaryUom: { select: { id: true, name: true, symbol: true } },
                },
              },
              salesItem: {
                include: {
                  item: {
                    select: {
                      id: true,
                      name: true,
                      sku: true,
                      hsnCode: true,
                      primaryUom: { select: { id: true, name: true, symbol: true } },
                    },
                  },
                },
              },
            },
          },
        },
        take: 100,
      });

      // 6. Purchase Returns (Debit Notes)
      const purchaseReturnWhere: any = { companyId: tenant.companyId };
      if (hasDateFilter) purchaseReturnWhere.returnDate = dateFilter;
      if (itemClause) {
        purchaseReturnWhere.items = {
          some: {
            OR: [
              ...(targetItemId && isUuid(targetItemId) ? [{ itemId: targetItemId }] : []),
              { purchaseItem: itemClause },
            ],
          },
        };
      }

      const purchaseReturnPromise = tx.purchaseReturn.findMany({
        where: purchaseReturnWhere,
        orderBy: [{ returnDate: "desc" }, { createdAt: "desc" }],
        include: {
          party: { select: { id: true, name: true, phone: true } },
          items: {
            include: {
              item: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  hsnCode: true,
                  primaryUom: { select: { id: true, name: true, symbol: true } },
                },
              },
              purchaseItem: {
                include: {
                  item: {
                    select: {
                      id: true,
                      name: true,
                      sku: true,
                      hsnCode: true,
                      primaryUom: { select: { id: true, name: true, symbol: true } },
                    },
                  },
                },
              },
            },
          },
        },
        take: 100,
      });

      const [sales, purchases, vouchers, challans, salesReturns, purchaseReturns] = await Promise.all([
        salesPromise,
        purchasePromise,
        voucherPromise,
        challanPromise,
        salesReturnPromise,
        purchaseReturnPromise,
      ]);

      const allItems: any[] = [];

      const mapLineItem = (it: any) => {
        const itemObj = it.item || it.salesItem?.item || it.purchaseItem?.item;
        return {
          id: it.id,
          itemId: it.itemId || itemObj?.id,
          name: itemObj?.name || it.description || "-",
          itemName: itemObj?.name || it.description || "-",
          sku: itemObj?.sku || null,
          hsnCode: it.hsnCode || itemObj?.hsnCode || null,
          quantity: Number(it.quantity || 0),
          unitPrice: Number(it.unitPrice || 0),
          totalAmount: Number(it.totalAmount || 0),
          unit: itemObj?.primaryUom?.shortName || itemObj?.primaryUom?.name || "BOX",
        };
      };

      const findMatchingLine = (lines: any[]) => {
        if (!hasItemFilter) return lines[0] || null;
        return lines.find((it: any) => {
          if (targetItemId) {
            if (it.itemId === targetItemId) return true;
            if (!isUuid(targetItemId) && (it.sku?.toLowerCase() === targetItemId.toLowerCase() || it.name?.toLowerCase().includes(targetItemId.toLowerCase()))) {
              return true;
            }
          }
          if (targetSku && it.sku?.toLowerCase() === targetSku.toLowerCase()) {
            return true;
          }
          if (targetItemSearch && (it.name?.toLowerCase().includes(targetItemSearch.toLowerCase()) || it.sku?.toLowerCase().includes(targetItemSearch.toLowerCase()))) {
            return true;
          }
          return false;
        }) || lines[0] || null;
      };

      // Map Sales Invoices
      for (const s of sales) {
        const d = s.invoiceDate || s.createdAt;
        const grand = Number(s.grandTotal || 0);
        const paid = Number(s.paidAmount || 0);
        const unpaid = Math.max(0, grand - paid);
        const lineItems = (s.items || []).map(mapLineItem);
        const matchingLine = findMatchingLine(lineItems);

        allItems.push({
          id: s.id,
          rawType: "SALES_INVOICE",
          type: "Sales Invoices",
          transactionNumber: s.invoiceNumber || s.id.slice(0, 8),
          txnNo: s.invoiceNumber || s.id.slice(0, 8),
          partyName: s.party?.name || "Cash Sale",
          partyId: s.partyId,
          amount: grand,
          paidAmount: paid,
          unpaidAmount: unpaid,
          status: s.status === "CANCELLED" ? "Cancelled" : unpaid === 0 ? "Paid" : unpaid < grand ? "Partial" : "Unpaid",
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          createdAt: s.createdAt,
          rawCreatedAt: s.createdAt ? new Date(s.createdAt).getTime() : 0,
          link: `/sales/invoices/${s.id}`,
          ...buildInvoiceUrls(s.id),
          hasSharedLedgerBadge: Boolean(s.partyId),
          items: lineItems,
          itemDetails: lineItems,
          ...(matchingLine ? {
            itemId: matchingLine.itemId,
            itemName: matchingLine.name,
            itemSku: matchingLine.sku,
            itemQuantity: matchingLine.quantity,
            itemUnitPrice: matchingLine.unitPrice,
            itemTotalAmount: matchingLine.totalAmount,
            unit: matchingLine.unit,
          } : {}),
        });
      }

      // Map Purchase Invoices
      for (const p of purchases) {
        const d = p.invoiceDate || p.createdAt;
        const grand = Number(p.grandTotal || 0);
        const paid = Number(p.paidAmount || 0);
        const unpaid = Math.max(0, grand - paid);
        const lineItems = (p.items || []).map(mapLineItem);
        const matchingLine = findMatchingLine(lineItems);

        allItems.push({
          id: p.id,
          rawType: "PURCHASE_INVOICE",
          type: "Purchase Invoices",
          transactionNumber: p.vendorInvoiceNumber || p.id.slice(0, 8),
          txnNo: p.vendorInvoiceNumber || p.id.slice(0, 8),
          partyName: p.party?.name || "-",
          partyId: p.partyId,
          amount: grand,
          paidAmount: paid,
          unpaidAmount: unpaid,
          status: unpaid === 0 ? "Paid" : unpaid < grand ? "Partial" : "Unpaid",
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          createdAt: p.createdAt,
          rawCreatedAt: p.createdAt ? new Date(p.createdAt).getTime() : 0,
          link: `/purchases/${p.id}`,
          hasSharedLedgerBadge: Boolean(p.partyId),
          items: lineItems,
          itemDetails: lineItems,
          ...(matchingLine ? {
            itemId: matchingLine.itemId,
            itemName: matchingLine.name,
            itemSku: matchingLine.sku,
            itemQuantity: matchingLine.quantity,
            itemUnitPrice: matchingLine.unitPrice,
            itemTotalAmount: matchingLine.totalAmount,
            unit: matchingLine.unit,
          } : {}),
        });
      }

      // Map Vouchers
      for (const v of vouchers) {
        const d = v.voucherDate || v.createdAt;
        const amt = Number(v.totalAmount || 0);

        let typeLabel = "Payment In";
        let rawType: string = v.voucherType;
        let partyName = "-";
        let partyId: string | null = null;
        let link = "/finance/vouchers";

        if (v.voucherType === "RECEIPT") {
          typeLabel = "Payment In";
          rawType = "RECEIPT";
          link = `/sales/payment-in/${v.id}`;

          const allocParty = v.allocations?.find((a: any) => a.salesInvoice?.party)?.salesInvoice?.party;
          const partyEntry = v.journalEntries?.find(
            (j: any) =>
              Number(j.creditAmount) > 0 &&
              (j.account?.partyId || j.account?.isPartyLedger || j.account?.party),
          );
          const anyCredit = v.journalEntries?.find((j: any) => Number(j.creditAmount) > 0);

          if (allocParty) {
            partyName = allocParty.name;
            partyId = allocParty.id;
          } else if (partyEntry) {
            partyName = partyEntry.account?.party?.name || partyEntry.account?.name || "-";
            partyId = partyEntry.account?.partyId || partyEntry.account?.party?.id || null;
          } else if (anyCredit?.account?.name) {
            partyName = anyCredit.account.name;
            partyId = anyCredit.account.partyId || null;
          } else if (v.narration) {
            partyName = v.narration.replace(/^Receipt from\s+/i, "").trim() || "-";
          }
        } else if (v.voucherType === "PAYMENT") {
          const allocParty = v.allocations?.find((a: any) => a.purchaseInvoice?.party)?.purchaseInvoice?.party;
          const partyDebit = v.journalEntries?.find(
            (j: any) =>
              Number(j.debitAmount) > 0 &&
              (j.account?.partyId ||
                j.account?.isPartyLedger ||
                j.account?.party ||
                j.account?.group?.name?.toLowerCase().includes("creditor") ||
                j.account?.group?.name?.toLowerCase().includes("payable")),
          );
          const isPaymentOut = Boolean(
            v.sourceDocument === "PAYMENT_OUT" ||
            allocParty ||
            partyDebit ||
            (v.narration && /payment\s+(to|out)/i.test(v.narration)),
          );

          if (isPaymentOut) {
            typeLabel = "Payment Out";
            rawType = "PAYMENT_OUT";
            link = `/purchases/payment-out/${v.id}`;
            if (allocParty) {
              partyName = allocParty.name;
              partyId = allocParty.id;
            } else if (partyDebit) {
              partyName = partyDebit.account?.party?.name || partyDebit.account?.name || "-";
              partyId = partyDebit.account?.partyId || partyDebit.account?.party?.id || null;
            } else if (v.narration) {
              partyName = v.narration.replace(/^Payment to\s+/i, "").trim() || "-";
            }
          } else {
            typeLabel = "Expenses";
            rawType = "EXPENSE";
            link = `/finance/expenses`;
            const debitLine = v.journalEntries?.find((j: any) => Number(j.debitAmount) > 0);
            partyName = debitLine?.account?.name || debitLine?.account?.group?.name || v.narration || "Expense";
          }
        } else if (v.voucherType === "CONTRA") {
          typeLabel = "Add Money";
          rawType = "CONTRA";
          partyName = v.narration || "Bank/Cash Transfer";
          link = `/finance/cash-bank`;
        } else {
          typeLabel = "Journal Entry";
          rawType = "JOURNAL";
          partyName = v.narration || "-";
          link = `/accounting/vouchers`;
        }

        allItems.push({
          id: v.id,
          rawType,
          type: typeLabel,
          transactionNumber: v.voucherNumber || v.id.slice(0, 8),
          txnNo: v.voucherNumber || v.id.slice(0, 8),
          partyName,
          partyId,
          amount: amt,
          paidAmount: amt,
          unpaidAmount: 0,
          status: v.isCancelled ? "Cancelled" : "Completed",
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          createdAt: v.createdAt,
          rawCreatedAt: v.createdAt ? new Date(v.createdAt).getTime() : 0,
          link,
          paymentMode: v.paymentMode || null,
          referenceNo: v.referenceNo || null,
          narration: v.narration || null,
          hasSharedLedgerBadge: Boolean(partyId),
          items: [],
          itemDetails: [],
        });
      }

      // Map Delivery Challans
      for (const c of challans) {
        const d = c.challanDate || c.createdAt;
        const amt = Number(c.totalAmount || 0);
        const lineItems = (c.items || []).map(mapLineItem);
        const matchingLine = findMatchingLine(lineItems);

        allItems.push({
          id: c.id,
          rawType: "DELIVERY_CHALLAN",
          type: "Delivery Challan",
          transactionNumber: c.challanNumber || c.id.slice(0, 8),
          txnNo: c.challanNumber || c.id.slice(0, 8),
          partyName: c.party?.name || "-",
          partyId: c.partyId,
          amount: amt,
          paidAmount: 0,
          unpaidAmount: amt,
          status: c.status === "CLOSED" ? "Completed" : c.status === "CANCELLED" ? "Cancelled" : "Issued",
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          createdAt: c.createdAt,
          rawCreatedAt: c.createdAt ? new Date(c.createdAt).getTime() : 0,
          link: `/sales/delivery-challan`,
          hasSharedLedgerBadge: Boolean(c.partyId),
          items: lineItems,
          itemDetails: lineItems,
          ...(matchingLine ? {
            itemId: matchingLine.itemId,
            itemName: matchingLine.name,
            itemSku: matchingLine.sku,
            itemQuantity: matchingLine.quantity,
            itemUnitPrice: matchingLine.unitPrice,
            itemTotalAmount: matchingLine.totalAmount,
            unit: matchingLine.unit,
          } : {}),
        });
      }

      // Map Sales Returns (Credit Notes)
      for (const sr of salesReturns) {
        const d = sr.returnDate || sr.createdAt;
        const amt = Number(sr.grandTotal || 0);
        const lineItems = (sr.items || []).map(mapLineItem);
        const matchingLine = findMatchingLine(lineItems);

        allItems.push({
          id: sr.id,
          rawType: "SALES_RETURN",
          type: "Sales Return",
          transactionNumber: sr.returnNumber || sr.id.slice(0, 8),
          txnNo: sr.returnNumber || sr.id.slice(0, 8),
          partyName: sr.party?.name || "-",
          partyId: sr.partyId,
          amount: amt,
          paidAmount: amt,
          unpaidAmount: 0,
          status: sr.status === "CANCELLED" ? "Cancelled" : "Completed",
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          createdAt: sr.createdAt,
          rawCreatedAt: sr.createdAt ? new Date(sr.createdAt).getTime() : 0,
          link: `/sales/sales-returns/${sr.id}`,
          hasSharedLedgerBadge: Boolean(sr.partyId),
          items: lineItems,
          itemDetails: lineItems,
          ...(matchingLine ? {
            itemId: matchingLine.itemId,
            itemName: matchingLine.name,
            itemSku: matchingLine.sku,
            itemQuantity: matchingLine.quantity,
            itemUnitPrice: matchingLine.unitPrice,
            itemTotalAmount: matchingLine.totalAmount,
            unit: matchingLine.unit,
          } : {}),
        });
      }

      // Map Purchase Returns (Debit Notes)
      for (const pr of purchaseReturns) {
        const d = pr.returnDate || pr.createdAt;
        const amt = Number(pr.grandTotal || 0);
        const lineItems = (pr.items || []).map(mapLineItem);
        const matchingLine = findMatchingLine(lineItems);

        allItems.push({
          id: pr.id,
          rawType: "PURCHASE_RETURN",
          type: "Purchase Return",
          transactionNumber: pr.returnNumber || pr.id.slice(0, 8),
          txnNo: pr.returnNumber || pr.id.slice(0, 8),
          partyName: pr.party?.name || "-",
          partyId: pr.partyId,
          amount: amt,
          paidAmount: amt,
          unpaidAmount: 0,
          status: "Completed",
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          createdAt: pr.createdAt,
          rawCreatedAt: pr.createdAt ? new Date(pr.createdAt).getTime() : 0,
          link: `/purchases/returns/${pr.id}`,
          hasSharedLedgerBadge: Boolean(pr.partyId),
          items: lineItems,
          itemDetails: lineItems,
          ...(matchingLine ? {
            itemId: matchingLine.itemId,
            itemName: matchingLine.name,
            itemSku: matchingLine.sku,
            itemQuantity: matchingLine.quantity,
            itemUnitPrice: matchingLine.unitPrice,
            itemTotalAmount: matchingLine.totalAmount,
            unit: matchingLine.unit,
          } : {}),
        });
      }

      // Filter by Search Query
      let filtered = allItems;
      if (query?.search && query.search.trim()) {
        const s = query.search.trim().toLowerCase();
        filtered = filtered.filter(
          (it) =>
            it.transactionNumber.toLowerCase().includes(s) ||
            it.partyName.toLowerCase().includes(s) ||
            it.type.toLowerCase().includes(s) ||
            String(it.amount).includes(s) ||
            (it.id && it.id.toLowerCase().includes(s)) ||
            (it.items && it.items.some((itItem: any) =>
              (itItem.name && itItem.name.toLowerCase().includes(s)) ||
              (itItem.sku && itItem.sku.toLowerCase().includes(s))
            )),
        );
      }

      // Filter by Type
      if (query?.type && query.type !== "ALL") {
        const t = query.type.toLowerCase().replace(/[-_]/g, " ").trim();
        filtered = filtered.filter((it) => {
          const itemType = it.type.toLowerCase().replace(/[-_]/g, " ");
          const itemRaw = String(it.rawType || "").toLowerCase().replace(/[-_]/g, " ");
          return (
            itemType.includes(t) ||
            itemRaw.includes(t) ||
            (t === "payment in" && (itemType.includes("payment in") || itemRaw === "receipt")) ||
            (t === "payment out" && (itemType.includes("payment out") || itemRaw === "payment out"))
          );
        });
      }

      // Filter by Raw Type
      if (query?.rawType && query.rawType !== "ALL") {
        const rt = query.rawType.toUpperCase().replace(/-/g, "_");
        filtered = filtered.filter((it) => {
          const itemRaw = String(it.rawType || "").toUpperCase();
          const itemType = String(it.type || "").toUpperCase();
          if (rt === "PAYMENT_IN" || rt === "RECEIPT") {
            return itemRaw === "PAYMENT_IN" || itemRaw === "RECEIPT" || itemType === "PAYMENT IN";
          }
          if (rt === "PAYMENT_OUT") {
            return itemRaw === "PAYMENT_OUT" || itemType === "PAYMENT OUT";
          }
          return itemRaw === rt;
        });
      }

      // Filter by Party ID
      if (query?.partyId) {
        filtered = filtered.filter((it) => it.partyId === query.partyId);
      }

      // Filter by Status
      if (query?.status && query.status !== "ALL") {
        const st = query.status.toLowerCase();
        filtered = filtered.filter((it) => it.status.toLowerCase() === st);
      }

      // Filter by Min Amount
      if (query?.minAmount !== undefined && query.minAmount !== null && String(query.minAmount).trim() !== "") {
        const min = Number(query.minAmount);
        if (!isNaN(min)) {
          filtered = filtered.filter((it) => it.amount >= min);
        }
      }

      // Filter by Max Amount
      if (query?.maxAmount !== undefined && query.maxAmount !== null && String(query.maxAmount).trim() !== "") {
        const max = Number(query.maxAmount);
        if (!isNaN(max)) {
          filtered = filtered.filter((it) => it.amount <= max);
        }
      }

      // Sort
      const sortBy = query?.sortBy || "date";
      const sortOrder = query?.sortOrder || "desc";
      filtered.sort((a, b) => {
        let diff = 0;
        if (sortBy === "amount") {
          diff = a.amount - b.amount;
        } else {
          diff = (a.rawDate || 0) - (b.rawDate || 0);
          if (diff === 0) {
            diff = (a.rawCreatedAt || 0) - (b.rawCreatedAt || 0);
          }
        }
        return sortOrder === "asc" ? diff : -diff;
      });

      const total = filtered.length;
      const paginated = filtered.slice(skip, skip + limit);

      return {
        items: paginated,
        transactions: paginated,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  /**
   * Get complete transaction details by ID across Sales, Purchases, Vouchers, Challans, and Returns.
   * Formatted consistently with getAllTransactions, enriched with items, party, and links.
   */
  async getTransactionById(tenant: TenantContext, id: string) {
    if (!id || typeof id !== "string") {
      throw new BadRequestException("Transaction ID is required.");
    }
    if (!tenant?.companyId) {
      throw new BadRequestException("Company context is required to view transaction.");
    }

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      // 1. Try Sales Invoice
      const sales = await tx.salesInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          party: true,
          branch: true,
          items: {
            include: {
              item: {
                include: {
                  primaryUom: true,
                  secondaryUom: true,
                },
              },
            },
          },
          returns: true,
        },
      });

      if (sales) {
        const d = sales.invoiceDate || sales.createdAt;
        const grand = Number(sales.grandTotal || 0);
        const paid = Number(sales.paidAmount || 0);
        const unpaid = Math.max(0, grand - paid);

        return {
          id: sales.id,
          rawType: "SALES_INVOICE",
          type: "Sales Invoices",
          transactionNumber: sales.invoiceNumber || sales.id.slice(0, 8),
          txnNo: sales.invoiceNumber || sales.id.slice(0, 8),
          partyName: sales.party?.name || "Cash Sale",
          partyId: sales.partyId,
          party: sales.party,
          amount: grand,
          paidAmount: paid,
          unpaidAmount: unpaid,
          status: sales.status === "CANCELLED" ? "Cancelled" : unpaid === 0 ? "Paid" : unpaid < grand ? "Partial" : "Unpaid",
          rawStatus: sales.status,
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          link: `/sales/invoices/${sales.id}`,
          ...buildInvoiceUrls(sales.id),
          hasSharedLedgerBadge: Boolean(sales.partyId),
          branch: sales.branch,
          items: sales.items,
          returns: sales.returns,
          notes: sales.notes,
          termsAndConditions: sales.termsAndConditions,
          taxableAmount: Number(sales.taxableAmount || 0),
          cgstAmount: Number(sales.cgstAmount || 0),
          sgstAmount: Number(sales.sgstAmount || 0),
          igstAmount: Number(sales.igstAmount || 0),
          roundOff: Number(sales.roundOff || 0),
          createdAt: sales.createdAt,
          updatedAt: sales.updatedAt,
        };
      }

      // 2. Try Purchase Invoice
      const purchase = await tx.purchaseInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          party: true,
          branch: true,
          items: {
            include: {
              item: {
                include: {
                  primaryUom: true,
                  secondaryUom: true,
                },
              },
            },
          },
          returns: true,
        },
      });

      if (purchase) {
        const d = purchase.invoiceDate || purchase.createdAt;
        const grand = Number(purchase.grandTotal || 0);
        const paid = Number(purchase.paidAmount || 0);
        const unpaid = Math.max(0, grand - paid);

        return {
          id: purchase.id,
          rawType: "PURCHASE_INVOICE",
          type: "Purchase Invoices",
          transactionNumber: purchase.vendorInvoiceNumber || purchase.id.slice(0, 8),
          txnNo: purchase.vendorInvoiceNumber || purchase.id.slice(0, 8),
          partyName: purchase.party?.name || "-",
          partyId: purchase.partyId,
          party: purchase.party,
          amount: grand,
          paidAmount: paid,
          unpaidAmount: unpaid,
          status: unpaid === 0 ? "Paid" : unpaid < grand ? "Partial" : "Unpaid",
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          link: `/purchases/${purchase.id}`,
          hasSharedLedgerBadge: Boolean(purchase.partyId),
          branch: purchase.branch,
          items: purchase.items,
          returns: purchase.returns,
          placeOfSupply: purchase.placeOfSupply,
          itcEligibility: purchase.itcEligibility,
          taxableAmount: Number(purchase.taxableAmount || 0),
          cgstAmount: Number(purchase.cgstAmount || 0),
          sgstAmount: Number(purchase.sgstAmount || 0),
          igstAmount: Number(purchase.igstAmount || 0),
          createdAt: purchase.createdAt,
        };
      }

      // 3. Try Voucher (Receipt, Payment, Expense, Contra, Journal)
      const voucher = await tx.voucher.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          journalEntries: {
            include: {
              account: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                  partyId: true,
                  party: true,
                  group: { select: { id: true, name: true } },
                },
              },
            },
            orderBy: { sequenceOrder: "asc" },
          },
          allocations: {
            include: {
              salesInvoice: {
                select: { id: true, invoiceNumber: true, partyId: true, party: { select: { id: true, name: true, phone: true } } },
              },
              purchaseInvoice: {
                select: { id: true, vendorInvoiceNumber: true, partyId: true, party: { select: { id: true, name: true, phone: true } } },
              },
            },
          },
        },
      });

      if (voucher) {
        const d = voucher.voucherDate || voucher.createdAt;
        const amt = Number(voucher.totalAmount || 0);

        let typeLabel = "Payment In";
        let rawType: string = voucher.voucherType;
        let partyName = "-";
        let partyId: string | null = null;
        let party: any = null;
        let link = "/finance/vouchers";

        if (voucher.voucherType === "RECEIPT") {
          typeLabel = "Payment In";
          rawType = "RECEIPT";
          link = `/sales/payment-in/${voucher.id}`;

          const allocParty = voucher.allocations?.find((a: any) => a.salesInvoice?.party)?.salesInvoice?.party;
          const partyEntry = voucher.journalEntries?.find(
            (j: any) =>
              Number(j.creditAmount) > 0 &&
              (j.account?.partyId || (j.account as any)?.isPartyLedger || j.account?.party),
          );
          const anyCredit = voucher.journalEntries?.find((j: any) => Number(j.creditAmount) > 0);

          if (allocParty) {
            partyName = allocParty.name;
            partyId = allocParty.id;
            party = allocParty;
          } else if (partyEntry) {
            partyName = partyEntry.account?.party?.name || partyEntry.account?.name || "-";
            partyId = partyEntry.account?.partyId || partyEntry.account?.party?.id || null;
            party = partyEntry.account?.party || null;
          } else if (anyCredit?.account?.name) {
            partyName = anyCredit.account.name;
            partyId = anyCredit.account.partyId || null;
            party = anyCredit.account.party || null;
          } else if (voucher.narration) {
            partyName = voucher.narration.replace(/^Receipt from\s+/i, "").trim() || "-";
          }
        } else if (voucher.voucherType === "PAYMENT") {
          const allocParty = voucher.allocations?.find((a: any) => a.purchaseInvoice?.party)?.purchaseInvoice?.party;
          const partyDebit = voucher.journalEntries?.find(
            (j: any) =>
              Number(j.debitAmount) > 0 &&
              (j.account?.partyId ||
                (j.account as any)?.isPartyLedger ||
                j.account?.party ||
                j.account?.group?.name?.toLowerCase().includes("creditor") ||
                j.account?.group?.name?.toLowerCase().includes("payable")),
          );
          const isPaymentOut = Boolean(
            voucher.sourceDocument === "PAYMENT_OUT" ||
            allocParty ||
            partyDebit ||
            (voucher.narration && /payment\s+(to|out)/i.test(voucher.narration)),
          );

          if (isPaymentOut) {
            typeLabel = "Payment Out";
            rawType = "PAYMENT_OUT";
            link = `/purchases/payment-out/${voucher.id}`;
            if (allocParty) {
              partyName = allocParty.name;
              partyId = allocParty.id;
              party = allocParty;
            } else if (partyDebit) {
              partyName = partyDebit.account?.party?.name || partyDebit.account?.name || "-";
              partyId = partyDebit.account?.partyId || partyDebit.account?.party?.id || null;
              party = partyDebit.account?.party || null;
            } else if (voucher.narration) {
              partyName = voucher.narration.replace(/^Payment to\s+/i, "").trim() || "-";
            }
          } else {
            typeLabel = "Expenses";
            rawType = "EXPENSE";
            link = `/finance/expenses`;
            const debitLine = voucher.journalEntries?.find((j: any) => Number(j.debitAmount) > 0);
            partyName = debitLine?.account?.name || debitLine?.account?.group?.name || voucher.narration || "Expense";
          }
        } else if (voucher.voucherType === "CONTRA") {
          typeLabel = "Add Money";
          rawType = "CONTRA";
          partyName = voucher.narration || "Bank/Cash Transfer";
          link = `/finance/cash-bank`;
        } else {
          typeLabel = "Journal Entry";
          rawType = "JOURNAL";
          partyName = voucher.narration || "-";
          link = `/accounting/vouchers`;
        }

        return {
          id: voucher.id,
          rawType,
          type: typeLabel,
          transactionNumber: voucher.voucherNumber || voucher.id.slice(0, 8),
          txnNo: voucher.voucherNumber || voucher.id.slice(0, 8),
          partyName,
          partyId,
          party,
          amount: amt,
          paidAmount: amt,
          unpaidAmount: 0,
          status: voucher.isCancelled ? "Cancelled" : "Completed",
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          link,
          hasSharedLedgerBadge: Boolean(partyId),
          paymentMode: (voucher as any).paymentMode || null,
          narration: voucher.narration,
          referenceNo: voucher.referenceNo,
          isCancelled: voucher.isCancelled,
          journalEntries: voucher.journalEntries,
          allocations: voucher.allocations,
          createdAt: voucher.createdAt,
          updatedAt: voucher.updatedAt,
        };
      }

      // 4. Try Delivery Challan
      const challan = await tx.deliveryChallan.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          party: true,
          branch: true,
          items: {
            include: {
              item: {
                include: {
                  primaryUom: true,
                  secondaryUom: true,
                },
              },
            },
          },
        },
      });

      if (challan) {
        const d = challan.challanDate || challan.createdAt;
        const amt = Number(challan.totalAmount || 0);

        return {
          id: challan.id,
          rawType: "DELIVERY_CHALLAN",
          type: "Delivery Challan",
          transactionNumber: challan.challanNumber || challan.id.slice(0, 8),
          txnNo: challan.challanNumber || challan.id.slice(0, 8),
          partyName: challan.party?.name || "-",
          partyId: challan.partyId,
          party: challan.party,
          amount: amt,
          paidAmount: 0,
          unpaidAmount: amt,
          status: challan.status === "CLOSED" ? "Completed" : challan.status === "CANCELLED" ? "Cancelled" : "Issued",
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          link: `/sales/delivery-challan`,
          hasSharedLedgerBadge: Boolean(challan.partyId),
          branch: challan.branch,
          items: challan.items,
          notes: challan.notes,
          createdAt: challan.createdAt,
          updatedAt: challan.updatedAt,
        };
      }

      // 5. Try Sales Return (Credit Note)
      const salesReturn = await tx.salesReturn.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          party: true,
          branch: true,
          items: {
            include: {
              item: {
                include: {
                  primaryUom: true,
                  secondaryUom: true,
                },
              },
            },
          },
          salesInvoice: { select: { id: true, invoiceNumber: true } },
        },
      });

      if (salesReturn) {
        const d = salesReturn.returnDate || salesReturn.createdAt;
        const amt = Number(salesReturn.grandTotal || 0);

        return {
          id: salesReturn.id,
          rawType: "SALES_RETURN",
          type: "Sales Return",
          transactionNumber: salesReturn.returnNumber || salesReturn.id.slice(0, 8),
          txnNo: salesReturn.returnNumber || salesReturn.id.slice(0, 8),
          partyName: salesReturn.party?.name || "-",
          partyId: salesReturn.partyId,
          party: salesReturn.party,
          amount: amt,
          paidAmount: amt,
          unpaidAmount: 0,
          status: salesReturn.status === "CANCELLED" ? "Cancelled" : "Completed",
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          link: `/sales/sales-returns/${salesReturn.id}`,
          hasSharedLedgerBadge: Boolean(salesReturn.partyId),
          branch: salesReturn.branch,
          salesInvoice: salesReturn.salesInvoice,
          items: salesReturn.items,
          reason: salesReturn.reason,
          reasonGujarati: salesReturn.reasonGujarati,
          taxableAmount: Number(salesReturn.taxableAmount || 0),
          cgstAmount: Number(salesReturn.cgstAmount || 0),
          sgstAmount: Number(salesReturn.sgstAmount || 0),
          igstAmount: Number(salesReturn.igstAmount || 0),
          createdAt: salesReturn.createdAt,
        };
      }

      // 6. Try Purchase Return (Debit Note)
      const purchaseReturn = await tx.purchaseReturn.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          party: true,
          branch: true,
          items: {
            include: {
              item: {
                include: {
                  primaryUom: true,
                  secondaryUom: true,
                },
              },
            },
          },
          purchaseInvoice: { select: { id: true, vendorInvoiceNumber: true } },
        },
      });

      if (purchaseReturn) {
        const d = purchaseReturn.returnDate || purchaseReturn.createdAt;
        const amt = Number(purchaseReturn.grandTotal || 0);

        return {
          id: purchaseReturn.id,
          rawType: "PURCHASE_RETURN",
          type: "Purchase Return",
          transactionNumber: purchaseReturn.returnNumber || purchaseReturn.id.slice(0, 8),
          txnNo: purchaseReturn.returnNumber || purchaseReturn.id.slice(0, 8),
          partyName: purchaseReturn.party?.name || "-",
          partyId: purchaseReturn.partyId,
          party: purchaseReturn.party,
          amount: amt,
          paidAmount: amt,
          unpaidAmount: 0,
          status: "Completed",
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          link: `/purchases/returns/${purchaseReturn.id}`,
          hasSharedLedgerBadge: Boolean(purchaseReturn.partyId),
          branch: purchaseReturn.branch,
          purchaseInvoice: purchaseReturn.purchaseInvoice,
          items: purchaseReturn.items,
          reason: purchaseReturn.reason,
          reasonGujarati: purchaseReturn.reasonGujarati,
          taxableAmount: Number(purchaseReturn.taxableAmount || 0),
          cgstAmount: Number(purchaseReturn.cgstAmount || 0),
          sgstAmount: Number(purchaseReturn.sgstAmount || 0),
          igstAmount: Number(purchaseReturn.igstAmount || 0),
          createdAt: purchaseReturn.createdAt,
        };
      }

      throw new NotFoundException(`Transaction with ID ${id} not found.`);
    });
  }

  /**
   * Delete or Cancel any transaction by ID (Sales Invoice, Purchase Invoice, Voucher, Delivery Challan)
   */
  async deleteTransaction(tenant: TenantContext, id: string, reason?: string) {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      // 1. Try Sales Invoice
      const sales = await tx.salesInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (sales) {
        // Remove returns & debit notes
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

        // Remove allocations
        await tx.paymentAllocation.deleteMany({ where: { invoiceId: id } });

        // Remove e-records
        await tx.eInvoiceRecord.deleteMany({ where: { invoiceId: id } });
        await tx.eWayBillRecord.deleteMany({ where: { invoiceId: id } });

        // Remove stock transactions
        await tx.stockTransaction.deleteMany({
          where: { referenceDocType: "SALES_INVOICE", referenceDocId: id },
        });

        // Remove items
        await tx.salesInvoiceItem.deleteMany({ where: { invoiceId: id } });

        // Remove linked vouchers & journal entries (SL/INV/...)
        const linkedVouchers = await tx.voucher.findMany({
          where: {
            companyId: tenant.companyId,
            OR: [
              { sourceDocument: "SALES_INVOICE", sourceEntityId: id },
              { voucherNumber: `SL/${sales.invoiceNumber}` },
            ],
          },
        });
        for (const v of linkedVouchers) {
          await tx.paymentAllocation.deleteMany({ where: { voucherId: v.id } });
          await tx.journalEntry.deleteMany({ where: { voucherId: v.id } });
          await tx.voucher.delete({ where: { id: v.id } });
        }

        // Delete the sales invoice record
        await tx.salesInvoice.delete({ where: { id } });

        return {
          success: true,
          type: "Sales Invoice",
          id,
          message: `Sales invoice #${sales.invoiceNumber} deleted successfully.`,
          messageGujarati: `વેચાણ બિલ #${sales.invoiceNumber} સફળતાપૂર્વક ડિલીટ કરવામાં આવ્યું.`,
        };
      }

      // 2. Try Purchase Invoice
      const purchase = await tx.purchaseInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (purchase) {
        await tx.stockTransaction.deleteMany({
          where: { referenceDocType: "PURCHASE_INVOICE", referenceDocId: id },
        });
        await tx.paymentAllocation.deleteMany({ where: { purchaseInvoiceId: id } });
        await tx.purchaseInvoiceItem.deleteMany({ where: { invoiceId: id } });

        // Remove linked purchase vouchers
        const linkedVouchers = await tx.voucher.findMany({
          where: {
            companyId: tenant.companyId,
            OR: [
              { sourceDocument: "PURCHASE_INVOICE", sourceEntityId: id },
              { voucherNumber: `PL/${purchase.vendorInvoiceNumber}` },
            ],
          },
        });
        for (const v of linkedVouchers) {
          await tx.paymentAllocation.deleteMany({ where: { voucherId: v.id } });
          await tx.journalEntry.deleteMany({ where: { voucherId: v.id } });
          await tx.voucher.delete({ where: { id: v.id } });
        }

        await tx.purchaseInvoice.delete({ where: { id } });
        return {
          success: true,
          type: "Purchase Invoice",
          id,
          message: `Purchase invoice #${purchase.vendorInvoiceNumber} deleted successfully.`,
          messageGujarati: `ખરીદી બિલ #${purchase.vendorInvoiceNumber} સફળતાપૂર્વક ડિલીટ કરવામાં આવ્યું.`,
        };
      }

      // 3. Try Voucher (Payment In, Payment Out, Expense, Contra, Journal)
      const voucher = await tx.voucher.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (voucher) {
        await tx.paymentAllocation.deleteMany({ where: { voucherId: id } });
        await tx.journalEntry.deleteMany({ where: { voucherId: id } });
        await tx.voucher.delete({ where: { id } });
        return {
          success: true,
          type: voucher.voucherType,
          id,
          message: `Voucher #${voucher.voucherNumber} deleted successfully.`,
          messageGujarati: `વાઉચર #${voucher.voucherNumber} સફળતાપૂર્વક ડિલીટ કરવામાં આવ્યું.`,
        };
      }

      // 4. Try Delivery Challan
      const challan = await tx.deliveryChallan.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (challan) {
        await tx.deliveryChallanItem.deleteMany({ where: { challanId: id } });
        await tx.deliveryChallan.delete({ where: { id } });
        return {
          success: true,
          type: "Delivery Challan",
          id,
          message: `Delivery challan #${challan.challanNumber} deleted successfully.`,
          messageGujarati: `ડિલિવરી ચલણ #${challan.challanNumber} સફળતાપૂર્વક ડિલીટ કરવામાં આવ્યું.`,
        };
      }

      throw new Error(`Transaction with ID ${id} not found.`);
    });
  }

  /**
   * Update transaction by ID with full editing capability
   * Supports Payment In (Receipt), Payment Out, Sales Invoice, Delivery Challan, etc.
   */
  async updateTransaction(
    tenant: TenantContext,
    id: string,
    dto: any,
  ) {
    // 1. Try Voucher (Payment In / Receipt, Payment Out, Expense, etc.)
    const voucher = await this.prisma.voucher.findFirst({
      where: { id, companyId: tenant.companyId },
    });
    if (voucher) {
      if (voucher.voucherType === "RECEIPT") {
        return await this.vouchersService.updateReceiptVoucher(id, dto, tenant);
      }
      if (voucher.voucherType === "PAYMENT") {
        return await this.vouchersService.updatePaymentOutVoucher(id, dto, tenant);
      }

      // General voucher (Expense, Journal, Contra)
      return await this.prisma.executeInTenantContext(tenant, async (tx) => {
        const updated = await tx.voucher.update({
          where: { id },
          data: {
            narration: dto.narration ?? dto.notes ?? voucher.narration,
            referenceNo: dto.referenceNo ?? dto.paymentReference ?? voucher.referenceNo,
            voucherNumber: dto.voucherNumber ?? dto.paymentNumber ?? voucher.voucherNumber,
            voucherDate: dto.voucherDate || dto.date ? new Date(dto.voucherDate || dto.date) : voucher.voucherDate,
            paymentMode: dto.paymentMode ?? voucher.paymentMode,
          },
        });
        return {
          success: true,
          type: voucher.voucherType,
          id,
          updated,
          message: `${voucher.voucherType} updated successfully.`,
        };
      });
    }

    // 2. Try Sales Invoice
    const sales = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId: tenant.companyId },
    });
    if (sales) {
      return await this.prisma.executeInTenantContext(tenant, async (tx) => {
        const updated = await tx.salesInvoice.update({
          where: { id },
          data: {
            notes: dto.notes ?? dto.narration ?? sales.notes,
          },
        });
        return {
          success: true,
          type: "Sales Invoice",
          id,
          updated,
          message: "Sales invoice updated successfully.",
        };
      });
    }

    // 3. Try Delivery Challan
    const challan = await this.prisma.deliveryChallan.findFirst({
      where: { id, companyId: tenant.companyId },
    });
    if (challan) {
      return await this.prisma.executeInTenantContext(tenant, async (tx) => {
        const updated = await tx.deliveryChallan.update({
          where: { id },
          data: { notes: dto.notes ?? dto.narration ?? challan.notes },
        });
        return {
          success: true,
          type: "Delivery Challan",
          id,
          updated,
          message: "Delivery challan updated successfully.",
        };
      });
    }

    throw new NotFoundException(`Transaction with ID ${id} not found.`);
  }
}
