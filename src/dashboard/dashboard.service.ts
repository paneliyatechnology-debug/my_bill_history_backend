import { Injectable, Logger } from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import { DatabaseService } from "../database/database.service";
import { ReportsService } from "../reports/reports.service";

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
  ) {}

  async getSummary(tenant: TenantContext, query?: any) {
    return await this.reportsService.getFinancialSummary(tenant, query);
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
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoices = await tx.salesInvoice.findMany({
        where: {
          companyId: tenant.companyId,
          status: { not: "CANCELLED" },
          invoiceDate: { gte: startDate },
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
        const d = new Date(now);
        d.setDate(now.getDate() - i);
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
      page?: number;
      limit?: number;
      sortBy?: "date" | "amount";
      sortOrder?: "asc" | "desc";
    },
  ) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query?.limit) || 50));
    const skip = (page - 1) * limit;

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const dateFilter: any = {};
      if (query?.startDate) {
        dateFilter.gte = new Date(query.startDate);
      }
      if (query?.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      const hasDateFilter = Boolean(query?.startDate || query?.endDate);

      // 1. Sales Invoices
      const salesWhere: any = { companyId: tenant.companyId };
      if (hasDateFilter) salesWhere.invoiceDate = dateFilter;

      const salesPromise = tx.salesInvoice.findMany({
        where: salesWhere,
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        include: { party: { select: { id: true, name: true, phone: true } } },
        take: 300,
      });

      // 2. Purchase Invoices
      const purchaseWhere: any = { companyId: tenant.companyId };
      if (hasDateFilter) purchaseWhere.invoiceDate = dateFilter;

      const purchasePromise = tx.purchaseInvoice.findMany({
        where: purchaseWhere,
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        include: { party: { select: { id: true, name: true, phone: true } } },
        take: 300,
      });

      // 3. Vouchers (Payment In, Payment Out, Expenses, Journal, Contra)
      const voucherWhere: any = { companyId: tenant.companyId, isCancelled: false };
      if (hasDateFilter) voucherWhere.voucherDate = dateFilter;

      const voucherPromise = tx.voucher.findMany({
        where: voucherWhere,
        orderBy: [{ voucherDate: "desc" }, { createdAt: "desc" }],
        include: {
          journalEntries: {
            include: {
              account: {
                select: { id: true, name: true, group: { select: { name: true } } },
              },
            },
            orderBy: { sequenceOrder: "asc" },
          },
        },
        take: 300,
      });

      // 4. Delivery Challans
      const challanWhere: any = { companyId: tenant.companyId };
      if (hasDateFilter) challanWhere.challanDate = dateFilter;

      const challanPromise = tx.deliveryChallan.findMany({
        where: challanWhere,
        orderBy: [{ challanDate: "desc" }, { createdAt: "desc" }],
        include: { party: { select: { id: true, name: true, phone: true } } },
        take: 100,
      });

      const [sales, purchases, vouchers, challans] = await Promise.all([
        salesPromise,
        purchasePromise,
        voucherPromise,
        challanPromise,
      ]);

      const allItems: any[] = [];

      // Map Sales Invoices
      for (const s of sales) {
        const d = s.invoiceDate || s.createdAt;
        const grand = Number(s.grandTotal || 0);
        const paid = Number(s.paidAmount || 0);
        const unpaid = Math.max(0, grand - paid);

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
          link: `/sales/invoices/${s.id}`,
          hasSharedLedgerBadge: Boolean(s.partyId),
        });
      }

      // Map Purchase Invoices
      for (const p of purchases) {
        const d = p.invoiceDate || p.createdAt;
        const grand = Number(p.grandTotal || 0);
        const paid = Number(p.paidAmount || 0);
        const unpaid = Math.max(0, grand - paid);

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
          link: `/purchases/${p.id}`,
          hasSharedLedgerBadge: Boolean(p.partyId),
        });
      }

      // Map Vouchers
      for (const v of vouchers) {
        const d = v.voucherDate || v.createdAt;
        const amt = Number(v.totalAmount || 0);

        let typeLabel = "Payment In";
        let partyName = "-";

        if (v.voucherType === "RECEIPT") {
          typeLabel = "Payment In";
          const creditLine = v.journalEntries?.find((j) => Number(j.creditAmount) > 0);
          partyName = creditLine?.account?.name || v.narration || "-";
        } else if (v.voucherType === "PAYMENT") {
          if (v.sourceDocument === "PAYMENT_OUT") {
            typeLabel = "Payment Out";
            const debitLine = v.journalEntries?.find((j) => Number(j.debitAmount) > 0);
            partyName = debitLine?.account?.name || v.narration || "-";
          } else {
            typeLabel = "Expenses";
            const debitLine = v.journalEntries?.find((j) => Number(j.debitAmount) > 0);
            partyName = debitLine?.account?.name || debitLine?.account?.group?.name || v.narration || "Expense";
          }
        } else if (v.voucherType === "CONTRA") {
          typeLabel = "Add Money";
          partyName = "-";
        } else {
          typeLabel = "Journal Entry";
          partyName = v.narration || "-";
        }

        allItems.push({
          id: v.id,
          rawType: v.voucherType,
          type: typeLabel,
          transactionNumber: v.voucherNumber || v.id.slice(0, 8),
          txnNo: v.voucherNumber || v.id.slice(0, 8),
          partyName,
          amount: amt,
          paidAmount: amt,
          unpaidAmount: 0,
          status: "Completed",
          date: d ? new Date(d).toISOString().slice(0, 10) : "",
          rawDate: d ? new Date(d).getTime() : 0,
          link: `/finance/vouchers`,
          hasSharedLedgerBadge: false,
        });
      }

      // Map Delivery Challans
      for (const c of challans) {
        const d = c.challanDate || c.createdAt;
        const amt = Number(c.totalAmount || 0);

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
          link: `/sales/delivery-challan`,
          hasSharedLedgerBadge: Boolean(c.partyId),
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
            String(it.amount).includes(s),
        );
      }

      // Filter by Type
      if (query?.type && query.type !== "ALL") {
        const t = query.type.toLowerCase();
        filtered = filtered.filter((it) => it.type.toLowerCase().includes(t));
      }

      // Sort
      const sortBy = query?.sortBy || "date";
      const sortOrder = query?.sortOrder || "desc";
      filtered.sort((a, b) => {
        let diff = 0;
        if (sortBy === "amount") {
          diff = a.amount - b.amount;
        } else {
          diff = a.rawDate - b.rawDate;
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
   * Delete or Cancel any transaction by ID (Sales Invoice, Purchase Invoice, Voucher, Delivery Challan)
   */
  async deleteTransaction(tenant: TenantContext, id: string, reason?: string) {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      // 1. Try Sales Invoice
      const sales = await tx.salesInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (sales) {
        await tx.salesInvoice.update({
          where: { id },
          data: {
            status: "CANCELLED",
            notes: reason ? `${sales.notes || ""}\nCancelled: ${reason}` : sales.notes,
          },
        });
        return {
          success: true,
          type: "Sales Invoice",
          id,
          message: `Sales invoice #${sales.invoiceNumber} cancelled successfully.`,
          messageGujarati: `વેચાણ બિલ #${sales.invoiceNumber} સફળતાપૂર્વક રદ કરવામાં આવ્યું.`,
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
        await tx.purchaseInvoice.delete({ where: { id } });
        return {
          success: true,
          type: "Purchase Invoice",
          id,
          message: `Purchase invoice #${purchase.vendorInvoiceNumber} deleted successfully.`,
          messageGujarati: `ખરીદી બિલ #${purchase.vendorInvoiceNumber} સફળતાપૂર્વક ડિલીટ કરવામાં આવ્યું.`,
        };
      }

      // 3. Try Voucher (Payment In, Payment Out, Expense, Contra)
      const voucher = await tx.voucher.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (voucher) {
        await tx.voucher.update({
          where: { id },
          data: { isCancelled: true },
        });
        return {
          success: true,
          type: voucher.voucherType,
          id,
          message: `Voucher #${voucher.voucherNumber} cancelled successfully.`,
          messageGujarati: `વાઉચર #${voucher.voucherNumber} સફળતાપૂર્વક રદ કરવામાં આવ્યું.`,
        };
      }

      // 4. Try Delivery Challan
      const challan = await tx.deliveryChallan.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (challan) {
        await tx.deliveryChallan.update({
          where: { id },
          data: { status: "CANCELLED" },
        });
        return {
          success: true,
          type: "Delivery Challan",
          id,
          message: `Delivery challan #${challan.challanNumber} cancelled successfully.`,
          messageGujarati: `ડિલિવરી ચલણ #${challan.challanNumber} સફળતાપૂર્વક રદ કરવામાં આવ્યું.`,
        };
      }

      throw new Error(`Transaction with ID ${id} not found.`);
    });
  }

  /**
   * Update notes / reference or status for any transaction by ID
   */
  async updateTransaction(
    tenant: TenantContext,
    id: string,
    dto: { narration?: string; referenceNo?: string; notes?: string },
  ) {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      // 1. Try Sales Invoice
      const sales = await tx.salesInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (sales) {
        const updated = await tx.salesInvoice.update({
          where: { id },
          data: { notes: dto.notes ?? dto.narration ?? sales.notes },
        });
        return {
          success: true,
          type: "Sales Invoice",
          id,
          updated,
          message: "Sales invoice updated successfully.",
        };
      }

      // 2. Try Voucher (Expense, Payment In, Payment Out)
      const voucher = await tx.voucher.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (voucher) {
        const updated = await tx.voucher.update({
          where: { id },
          data: {
            narration: dto.narration ?? voucher.narration,
            referenceNo: dto.referenceNo ?? voucher.referenceNo,
          },
        });
        return {
          success: true,
          type: "Voucher",
          id,
          updated,
          message: "Voucher updated successfully.",
        };
      }

      // 3. Try Delivery Challan
      const challan = await tx.deliveryChallan.findFirst({
        where: { id, companyId: tenant.companyId },
      });
      if (challan) {
        const updated = await tx.deliveryChallan.update({
          where: { id },
          data: { notes: dto.notes ?? challan.notes },
        });
        return {
          success: true,
          type: "Delivery Challan",
          id,
          updated,
          message: "Delivery challan updated successfully.",
        };
      }

      throw new Error(`Transaction with ID ${id} not found.`);
    });
  }
}
