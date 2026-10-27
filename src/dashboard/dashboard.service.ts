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
  ): Promise<{ transactions: DashboardTransaction[]; total: number }> {
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 5));

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      // 1. Fetch recent sales invoices
      const invoices = await tx.salesInvoice.findMany({
        where: {
          companyId: tenant.companyId,
          status: { not: "CANCELLED" },
        },
        take: safeLimit,
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        include: {
          party: { select: { id: true, name: true } },
        },
      });

      // 2. Fetch recent purchase invoices
      const purchases = await tx.purchaseInvoice.findMany({
        where: {
          companyId: tenant.companyId,
        },
        take: safeLimit,
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
        include: {
          party: { select: { id: true, name: true } },
        },
      });

      // 3. Fetch recent expenses (payment vouchers)
      const expenses = await tx.voucher.findMany({
        where: {
          companyId: tenant.companyId,
          voucherType: "PAYMENT",
          isCancelled: false,
        },
        take: safeLimit,
        orderBy: [{ voucherDate: "desc" }, { createdAt: "desc" }],
        include: {
          journalEntries: {
            include: {
              account: {
                select: {
                  id: true,
                  name: true,
                  group: { select: { name: true } },
                },
              },
            },
            orderBy: { sequenceOrder: "asc" },
          },
        },
      });

      const list: DashboardTransaction[] = [];

      for (const inv of invoices) {
        const d = inv.invoiceDate || inv.createdAt;
        list.push({
          id: inv.id,
          type: "Sales Invoice",
          txnNo: inv.invoiceNumber,
          partyName: inv.party?.name || "-",
          amount: Number(inv.grandTotal || 0),
          date: d ? new Date(d).toISOString() : new Date().toISOString(),
          rawDate: d ? new Date(d).toISOString() : new Date().toISOString(),
          link: `/sales/invoices/${inv.id}`,
        });
      }

      for (const p of purchases) {
        const d = p.invoiceDate || p.createdAt;
        list.push({
          id: p.id,
          type: "Purchase Invoice",
          txnNo: p.vendorInvoiceNumber || p.id.slice(0, 8),
          partyName: p.party?.name || "-",
          amount: Number(p.grandTotal || 0),
          date: d ? new Date(d).toISOString() : new Date().toISOString(),
          rawDate: d ? new Date(d).toISOString() : new Date().toISOString(),
          link: `/purchases/${p.id}`,
        });
      }

      for (const e of expenses) {
        const d = e.voucherDate || e.createdAt;
        const debitLine = e.journalEntries?.find((j) => Number(j.debitAmount) > 0);
        const expenseAccName =
          debitLine?.account?.name ||
          debitLine?.account?.group?.name ||
          e.narration ||
          "Expense";

        list.push({
          id: e.id,
          type: "Expenses",
          txnNo: e.voucherNumber || `EXP-${e.id.slice(0, 6)}`,
          partyName: expenseAccName,
          amount: Number(e.totalAmount || 0),
          date: d ? new Date(d).toISOString() : new Date().toISOString(),
          rawDate: d ? new Date(d).toISOString() : new Date().toISOString(),
          link: `/finance/expenses`,
        });
      }

      // Sort merged transactions by date desc and take top safeLimit
      list.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );

      const topTransactions = list.slice(0, safeLimit);

      return {
        transactions: topTransactions,
        total: topTransactions.length,
      };
    });
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
}
