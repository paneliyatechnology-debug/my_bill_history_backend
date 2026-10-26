import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import {
  TenantContext,
  InvoiceStatus,
  InvoiceCategory,
  VoucherType,
  PartyType,
  AccountNature,
} from "@billing/shared-types";
import {
  Decimal,
  toDecimal,
  toMoney,
  isPositive,
  isZero,
  formatAccountingBalance,
  calculateTrialBalanceTotals,
  calculateProfitAndLoss,
  calculateBalanceSheetTotals,
  calculatePartyAging,
  formatCurrencyIndian,
} from "@billing/accounting-core";
import {
  buildGstr1,
  buildGstr3b,
  resolveReportPeriod,
} from "@billing/gst-provider";
import { DatabaseService } from "../database/database.service";
import { QuerySalesRegisterDto } from "./dto/query-sales-register.dto";
import {
  QueryReceiptPaymentRegisterDto,
  QueryOutstandingBalancesDto,
  QueryPartyAgingDto,
  QueryPartyLedgerDto,
  QueryGeneralLedgerDto,
  QueryFinancialStatementDto,
  QueryDaybookDto,
  QueryStockSummaryDto,
  QueryStockMovementReportDto,
  QueryGstr1ReportDto,
  QueryFinancialSummaryDto,
  type FinancialSummaryDto,
} from "./dto/query-reports.dto";

/**
 * Escapes a string cell for CSV export per RFC 4180
 */
export function formatCsvCell(val: any): string {
  if (val === null || val === undefined) {
    return '""';
  }
  const str = String(val);
  if (
    str.includes('"') ||
    str.includes(",") ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

export function generateCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const headerLine = headers.map(formatCsvCell).join(",");
  const rowLines = rows.map((r) => r.map(formatCsvCell).join(","));
  return [headerLine, ...rowLines].join("\r\n");
}

export function parseStartOfDay(dateStr?: string): Date | undefined {
  if (!dateStr) return undefined;
  const d = dateStr.includes("T")
    ? new Date(dateStr)
    : new Date(`${dateStr}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? undefined : d;
}

export function parseEndOfDay(dateStr?: string): Date | undefined {
  if (!dateStr) return undefined;
  const d = dateStr.includes("T")
    ? new Date(dateStr)
    : new Date(`${dateStr}T23:59:59.999Z`);
  return isNaN(d.getTime()) ? undefined : d;
}

export const GST_STATE_CODE_TO_NAME: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export function resolveGstState(
  pos?: string | null,
  gstin?: string | null,
  companyStateCode?: string | null,
): { stateCode: string; stateName: string } {
  let code = "";
  if (pos && typeof pos === "string") {
    const trimmed = pos.trim();
    const match = trimmed.match(/^(\d{2})/);
    if (match) {
      code = match[1];
    } else if (trimmed.length === 2 && /^\d+$/.test(trimmed)) {
      code = trimmed;
    }
  }
  if (!code && gstin && typeof gstin === "string") {
    const trimmed = gstin.trim();
    const match = trimmed.match(/^(\d{2})/);
    if (match) {
      code = match[1];
    }
  }
  if (!code && companyStateCode && typeof companyStateCode === "string") {
    const trimmed = companyStateCode.trim();
    const match = trimmed.match(/^(\d{2})/);
    if (match) {
      code = match[1];
    }
  }
  const stateName =
    GST_STATE_CODE_TO_NAME[code] || (code ? `State ${code}` : "—");
  return {
    stateCode: code || "—",
    stateName: code ? stateName : "—",
  };
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: DatabaseService) {}

  // --------------------------------------------------------------------------
  // 1. SALES REGISTER & INVOICE SUMMARIES
  // --------------------------------------------------------------------------
  async getSalesRegister(
    query: QuerySalesRegisterDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const where: any = {
        companyId: tenant.companyId,
      };

      if (query.branchId) {
        where.branchId = query.branchId;
      }
      if (query.partyId) {
        where.partyId = query.partyId;
      }
      if (query.category) {
        where.category = query.category;
      }
      if (query.status) {
        where.status = query.status;
      }

      const fromDate = query.fromDate || (query as any).startDate;
      const toDate = query.toDate || (query as any).endDate;
      if (fromDate || toDate) {
        where.invoiceDate = {};
        if (fromDate) {
          where.invoiceDate.gte = parseStartOfDay(fromDate);
        }
        if (toDate) {
          where.invoiceDate.lte = parseEndOfDay(toDate);
        }
      }

      const page = Number(query.page) || 1;
      const limit = Number(query.limit) || 50;
      const skip = (page - 1) * limit;

      const [invoices, totalCount, allInvoices] = await Promise.all([
        tx.salesInvoice.findMany({
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
            branch: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
          skip,
          take: limit,
        }),
        tx.salesInvoice.count({ where }),
        // Query full dataset aggregates without pagination for exact statistical totals
        tx.salesInvoice.findMany({
          where,
          select: {
            status: true,
            taxableAmount: true,
            cgstAmount: true,
            sgstAmount: true,
            igstAmount: true,
            cessAmount: true,
            roundOff: true,
            grandTotal: true,
            paidAmount: true,
            balanceAmount: true,
          },
        }),
      ]);

      // Calculate exact Decimal totals
      let totalTaxable = new Decimal(0);
      let totalCgst = new Decimal(0);
      let totalSgst = new Decimal(0);
      let totalIgst = new Decimal(0);
      let totalCess = new Decimal(0);
      let totalRoundOff = new Decimal(0);
      let totalGrandTotal = new Decimal(0);
      let totalPaid = new Decimal(0);
      let totalBalance = new Decimal(0);
      let validCount = 0;
      let cancelledCount = 0;

      for (const inv of allInvoices) {
        if (inv.status === InvoiceStatus.CANCELLED) {
          cancelledCount++;
          continue; // Statutory totals exclude cancelled invoices
        }
        validCount++;
        totalTaxable = totalTaxable.plus(toMoney(inv.taxableAmount));
        totalCgst = totalCgst.plus(toMoney(inv.cgstAmount));
        totalSgst = totalSgst.plus(toMoney(inv.sgstAmount));
        totalIgst = totalIgst.plus(toMoney(inv.igstAmount));
        totalCess = totalCess.plus(toMoney(inv.cessAmount));
        totalRoundOff = totalRoundOff.plus(toMoney(inv.roundOff));
        totalGrandTotal = totalGrandTotal.plus(toMoney(inv.grandTotal));
        totalPaid = totalPaid.plus(toMoney(inv.paidAmount));
        totalBalance = totalBalance.plus(toMoney(inv.balanceAmount));
      }

      return {
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
        summary: {
          totalInvoices: totalCount,
          validInvoices: validCount,
          cancelledInvoices: cancelledCount,
          totalTaxable: totalTaxable.toFixed(2),
          totalCgst: totalCgst.toFixed(2),
          totalSgst: totalSgst.toFixed(2),
          totalIgst: totalIgst.toFixed(2),
          totalCess: totalCess.toFixed(2),
          totalRoundOff: totalRoundOff.toFixed(2),
          totalGrandTotal: totalGrandTotal.toFixed(2),
          totalPaid: totalPaid.toFixed(2),
          totalBalance: totalBalance.toFixed(2),
        },
        items: invoices.map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate.toISOString().split("T")[0],
          category: inv.category,
          status: inv.status,
          partyId: inv.partyId,
          partyName: inv.party.name,
          partyNameGujarati: inv.party.nameGujarati,
          partyGstin: inv.party.gstin,
          branchName: inv.branch.name,
          placeOfSupply: inv.placeOfSupply,
          paymentMode: inv.paymentMode,
          taxableAmount: toMoney(inv.taxableAmount).toFixed(2),
          cgstAmount: toMoney(inv.cgstAmount).toFixed(2),
          sgstAmount: toMoney(inv.sgstAmount).toFixed(2),
          igstAmount: toMoney(inv.igstAmount).toFixed(2),
          cessAmount: toMoney(inv.cessAmount).toFixed(2),
          roundOff: toMoney(inv.roundOff).toFixed(2),
          grandTotal: toMoney(inv.grandTotal).toFixed(2),
          paidAmount: toMoney(inv.paidAmount).toFixed(2),
          balanceAmount: toMoney(inv.balanceAmount).toFixed(2),
        })),
      };
    });
  }

  async exportSalesRegisterCsv(
    query: QuerySalesRegisterDto,
    tenant: TenantContext,
  ): Promise<string> {
    const report = await this.getSalesRegister(
      { ...query, page: 1, limit: 500 },
      tenant,
    );
    const headers = [
      "Invoice Number",
      "Date",
      "Category",
      "Status",
      "Customer Name",
      "Customer GSTIN",
      "Branch",
      "Place of Supply",
      "Payment Mode",
      "Taxable Amount (INR)",
      "CGST (INR)",
      "SGST (INR)",
      "IGST (INR)",
      "Cess (INR)",
      "Round Off (INR)",
      "Grand Total (INR)",
      "Paid Amount (INR)",
      "Balance Amount (INR)",
    ];

    const rows = report.items.map((i: any) => [
      i.invoiceNumber,
      i.invoiceDate,
      i.category,
      i.status,
      i.partyName,
      i.partyGstin || "N/A",
      i.branchName,
      i.placeOfSupply,
      i.paymentMode,
      i.taxableAmount,
      i.cgstAmount,
      i.sgstAmount,
      i.igstAmount,
      i.cessAmount,
      i.roundOff,
      i.grandTotal,
      i.paidAmount,
      i.balanceAmount,
    ]);

    // Append summary row
    rows.push([
      "TOTAL",
      "",
      "",
      `Valid: ${report.summary.validInvoices}`,
      "",
      "",
      "",
      "",
      "",
      report.summary.totalTaxable,
      report.summary.totalCgst,
      report.summary.totalSgst,
      report.summary.totalIgst,
      report.summary.totalCess,
      report.summary.totalRoundOff,
      report.summary.totalGrandTotal,
      report.summary.totalPaid,
      report.summary.totalBalance,
    ]);

    return generateCsv(headers, rows);
  }

  // --------------------------------------------------------------------------
  // 2. PURCHASE REGISTER (DEFERRED NOTICE & FALLBACK AGGREGATOR)
  // --------------------------------------------------------------------------
  async getPurchaseRegister(
    tenant: TenantContext,
    query: { fromDate?: string; toDate?: string } = {},
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoiceDate: { gte?: Date; lte?: Date } = {};
      if (query.fromDate)
        invoiceDate.gte = new Date(`${query.fromDate}T00:00:00.000Z`);
      if (query.toDate)
        invoiceDate.lte = new Date(`${query.toDate}T00:00:00.000Z`);
      const invoices = await tx.purchaseInvoice.findMany({
        where: {
          companyId: tenant.companyId,
          ...(query.fromDate || query.toDate ? { invoiceDate } : {}),
        },
        include: { party: true, items: true },
        orderBy: { invoiceDate: "asc" },
      });
      const returns = await tx.purchaseReturn.findMany({
        where: {
          companyId: tenant.companyId,
          ...(query.fromDate || query.toDate
            ? { returnDate: invoiceDate }
            : {}),
        },
        include: { party: true },
      });
      let taxable = new Decimal(0);
      let cgst = new Decimal(0);
      let sgst = new Decimal(0);
      let igst = new Decimal(0);
      let utgst = new Decimal(0);
      let grand = new Decimal(0);
      const items = invoices.map((invoice) => {
        taxable = taxable.plus(toMoney(invoice.taxableAmount));
        cgst = cgst.plus(toMoney(invoice.cgstAmount));
        sgst = sgst.plus(toMoney(invoice.sgstAmount));
        igst = igst.plus(toMoney(invoice.igstAmount));
        utgst = utgst.plus(toMoney(invoice.utgstAmount));
        grand = grand.plus(toMoney(invoice.grandTotal));
        return {
          id: invoice.id,
          documentType: "PURCHASE_INVOICE",
          vendorInvoiceNumber: invoice.vendorInvoiceNumber,
          invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
          supplierName: invoice.party.name,
          supplierGstin: invoice.party.gstin,
          taxableAmount: toMoney(invoice.taxableAmount).toFixed(2),
          cgstAmount: toMoney(invoice.cgstAmount).toFixed(2),
          sgstAmount: toMoney(invoice.sgstAmount).toFixed(2),
          utgstAmount: toMoney(invoice.utgstAmount).toFixed(2),
          igstAmount: toMoney(invoice.igstAmount).toFixed(2),
          cessAmount: toMoney(invoice.cessAmount).toFixed(2),
          grandTotal: toMoney(invoice.grandTotal).toFixed(2),
          itcEligibility: invoice.itcEligibility,
          itcClaimed: false,
        };
      });
      for (const purchaseReturn of returns) {
        taxable = taxable.minus(toMoney(purchaseReturn.taxableAmount));
        cgst = cgst.minus(toMoney(purchaseReturn.cgstAmount));
        sgst = sgst.minus(toMoney(purchaseReturn.sgstAmount));
        igst = igst.minus(toMoney(purchaseReturn.igstAmount));
        utgst = utgst.minus(toMoney(purchaseReturn.utgstAmount));
        grand = grand.minus(toMoney(purchaseReturn.grandTotal));
        items.push({
          id: purchaseReturn.id,
          documentType: "PURCHASE_RETURN",
          vendorInvoiceNumber: purchaseReturn.returnNumber,
          invoiceDate: purchaseReturn.returnDate.toISOString().slice(0, 10),
          supplierName: purchaseReturn.party.name,
          supplierGstin: purchaseReturn.party.gstin,
          taxableAmount: toMoney(purchaseReturn.taxableAmount)
            .negated()
            .toFixed(2),
          cgstAmount: toMoney(purchaseReturn.cgstAmount).negated().toFixed(2),
          sgstAmount: toMoney(purchaseReturn.sgstAmount).negated().toFixed(2),
          utgstAmount: toMoney(purchaseReturn.utgstAmount).negated().toFixed(2),
          igstAmount: toMoney(purchaseReturn.igstAmount).negated().toFixed(2),
          cessAmount: "0.00",
          grandTotal: toMoney(purchaseReturn.grandTotal).negated().toFixed(2),
          itcEligibility: "REVERSAL",
          itcClaimed: false,
        });
      }
      return {
        isDeferred: false,
        status: "READY",
        message:
          "Purchase register lists posted bills and purchase returns. ITC eligibility is shown as recorded and is not treated as claimed.",
        totalCount: items.length,
        items,
        totals: {
          totalTaxable: taxable.toFixed(2),
          totalCgst: cgst.toFixed(2),
          totalSgst: sgst.toFixed(2),
          totalUtgst: utgst.toFixed(2),
          totalIgst: igst.toFixed(2),
          totalGrandTotal: grand.toFixed(2),
        },
      };
    });
  }

  // --------------------------------------------------------------------------
  // 2A. GST PURCHASE (WITH HSN)
  // --------------------------------------------------------------------------
  async getGstPurchaseHsn(
    tenant: TenantContext,
    query: { fromDate?: string; toDate?: string } = {},
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoiceDate: { gte?: Date; lte?: Date } = {};
      if (query.fromDate)
        invoiceDate.gte = new Date(`${query.fromDate}T00:00:00.000Z`);
      if (query.toDate)
        invoiceDate.lte = new Date(`${query.toDate}T00:00:00.000Z`);
      const invoices = await tx.purchaseInvoice.findMany({
        where: {
          companyId: tenant.companyId,
          ...(query.fromDate || query.toDate ? { invoiceDate } : {}),
        },
        include: {
          party: true,
          items: {
            include: {
              item: {
                include: {
                  primaryUom: true,
                },
              },
            },
          },
        },
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      });

      const items: any[] = [];
      let totalAmount = new Decimal(0);
      let totalSgst = new Decimal(0);
      let totalCgst = new Decimal(0);
      let totalIgst = new Decimal(0);

      invoices.forEach((inv, invIdx) => {
        const invNum = (invIdx + 1).toString();
        const origInvNum = inv.vendorInvoiceNumber || "-";
        const dateStr = inv.invoiceDate.toISOString().slice(0, 10);
        const partyGstin = inv.party?.gstin || "-";
        const partyName = inv.party?.name || "-";

        if (!inv.items || inv.items.length === 0) {
          const amt = toMoney(inv.grandTotal);
          totalAmount = totalAmount.plus(amt);
          totalSgst = totalSgst.plus(toMoney(inv.sgstAmount));
          totalCgst = totalCgst.plus(toMoney(inv.cgstAmount));
          totalIgst = totalIgst.plus(toMoney(inv.igstAmount));
          items.push({
            id: inv.id,
            date: dateStr,
            invoiceNumber: invNum,
            originalInvoiceNumber: origInvNum,
            partyGstin,
            partyName,
            itemName: "-",
            hsnCode: "-",
            quantity: 0,
            unit: "",
            pricePerUnit: "0.00",
            sgstAmount: toMoney(inv.sgstAmount).toNumber() > 0 ? toMoney(inv.sgstAmount).toFixed(2) : "-",
            sgstRate: 0,
            cgstAmount: toMoney(inv.cgstAmount).toNumber() > 0 ? toMoney(inv.cgstAmount).toFixed(2) : "-",
            cgstRate: 0,
            igstAmount: toMoney(inv.igstAmount).toNumber() > 0 ? toMoney(inv.igstAmount).toFixed(2) : "-",
            igstRate: 0,
            amount: amt.toFixed(2),
          });
        } else {
          inv.items.forEach((item) => {
            const lineAmt = toMoney(item.totalAmount);
            totalAmount = totalAmount.plus(lineAmt);
            totalSgst = totalSgst.plus(toMoney(item.sgstAmount));
            totalCgst = totalCgst.plus(toMoney(item.cgstAmount));
            totalIgst = totalIgst.plus(toMoney(item.igstAmount));
            const taxRate = Number(item.taxRate || 0);
            const halfRate = taxRate / 2;
            const unitName = (item.item as any)?.primaryUom?.symbol || (item.item as any)?.primaryUom?.name || "BOX";

            items.push({
              id: item.id,
              date: dateStr,
              invoiceNumber: invNum,
              originalInvoiceNumber: origInvNum,
              partyGstin,
              partyName,
              itemName: item.item?.name || "-",
              hsnCode: item.hsnCode || item.item?.hsnCode || "-",
              quantity: Number(item.quantity || 0),
              unit: unitName,
              pricePerUnit: toMoney(item.unitPrice).toFixed(2),
              sgstAmount: toMoney(item.sgstAmount).toNumber() > 0 ? toMoney(item.sgstAmount).toFixed(2) : "-",
              sgstRate: halfRate,
              cgstAmount: toMoney(item.cgstAmount).toNumber() > 0 ? toMoney(item.cgstAmount).toFixed(2) : "-",
              cgstRate: halfRate,
              igstAmount: toMoney(item.igstAmount).toNumber() > 0 ? toMoney(item.igstAmount).toFixed(2) : "-",
              igstRate: taxRate,
              amount: lineAmt.toFixed(2),
            });
          });
        }
      });

      return {
        totalCount: items.length,
        items,
        totals: {
          totalAmount: totalAmount.toFixed(2),
          totalSgst: totalSgst.toFixed(2),
          totalCgst: totalCgst.toFixed(2),
          totalIgst: totalIgst.toFixed(2),
        },
      };
    });
  }

  // --------------------------------------------------------------------------
  // 2B. GST SALES (WITH HSN)
  // --------------------------------------------------------------------------
  async getGstSalesHsn(
    tenant: TenantContext,
    query: { fromDate?: string; toDate?: string } = {},
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoiceDate: { gte?: Date; lte?: Date } = {};
      if (query.fromDate)
        invoiceDate.gte = new Date(`${query.fromDate}T00:00:00.000Z`);
      if (query.toDate)
        invoiceDate.lte = new Date(`${query.toDate}T00:00:00.000Z`);
      const invoices = await tx.salesInvoice.findMany({
        where: {
          companyId: tenant.companyId,
          status: { not: "CANCELLED" },
          ...(query.fromDate || query.toDate ? { invoiceDate } : {}),
        },
        include: {
          party: true,
          items: {
            include: {
              item: {
                include: {
                  primaryUom: true,
                },
              },
            },
          },
        },
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      });

      const items: any[] = [];
      let totalAmount = new Decimal(0);
      let totalSgst = new Decimal(0);
      let totalCgst = new Decimal(0);
      let totalIgst = new Decimal(0);

      invoices.forEach((inv) => {
        const dateStr = inv.invoiceDate.toISOString().slice(0, 10);
        const partyGstin = inv.party?.gstin || "-";
        const partyName = inv.party?.name || "-";
        const invNum = inv.invoiceNumber;

        if (!inv.items || inv.items.length === 0) {
          const amt = toMoney(inv.grandTotal);
          totalAmount = totalAmount.plus(amt);
          totalSgst = totalSgst.plus(toMoney(inv.sgstAmount));
          totalCgst = totalCgst.plus(toMoney(inv.cgstAmount));
          totalIgst = totalIgst.plus(toMoney(inv.igstAmount));
          items.push({
            id: inv.id,
            date: dateStr,
            invoiceNumber: invNum,
            customerGstin: partyGstin,
            customerName: partyName,
            itemName: "-",
            hsnCode: "-",
            quantity: 0,
            unit: "",
            pricePerUnit: "0.00",
            sgstAmount: toMoney(inv.sgstAmount).toNumber() > 0 ? toMoney(inv.sgstAmount).toFixed(2) : "-",
            sgstRate: 0,
            cgstAmount: toMoney(inv.cgstAmount).toNumber() > 0 ? toMoney(inv.cgstAmount).toFixed(2) : "-",
            cgstRate: 0,
            igstAmount: toMoney(inv.igstAmount).toNumber() > 0 ? toMoney(inv.igstAmount).toFixed(2) : "-",
            igstRate: 0,
            amount: amt.toFixed(2),
          });
        } else {
          inv.items.forEach((item) => {
            const lineAmt = toMoney(item.totalAmount);
            totalAmount = totalAmount.plus(lineAmt);
            totalSgst = totalSgst.plus(toMoney(item.sgstAmount));
            totalCgst = totalCgst.plus(toMoney(item.cgstAmount));
            totalIgst = totalIgst.plus(toMoney(item.igstAmount));
            const taxRate = Number(item.taxRate || 0);
            const halfRate = taxRate / 2;
            const unitName = (item.item as any)?.primaryUom?.symbol || (item.item as any)?.primaryUom?.name || "PCS";

            items.push({
              id: item.id,
              date: dateStr,
              invoiceNumber: invNum,
              customerGstin: partyGstin,
              customerName: partyName,
              itemName: item.item?.name || item.description || "-",
              hsnCode: item.hsnCode || item.item?.hsnCode || "-",
              quantity: Number(item.quantity || 0),
              unit: unitName,
              pricePerUnit: toMoney(item.unitPrice).toFixed(2),
              sgstAmount: toMoney(item.sgstAmount).toNumber() > 0 ? toMoney(item.sgstAmount).toFixed(2) : "-",
              sgstRate: halfRate,
              cgstAmount: toMoney(item.cgstAmount).toNumber() > 0 ? toMoney(item.cgstAmount).toFixed(2) : "-",
              cgstRate: halfRate,
              igstAmount: toMoney(item.igstAmount).toNumber() > 0 ? toMoney(item.igstAmount).toFixed(2) : "-",
              igstRate: taxRate,
              amount: lineAmt.toFixed(2),
            });
          });
        }
      });

      return {
        totalCount: items.length,
        items,
        totals: {
          totalAmount: totalAmount.toFixed(2),
          totalSgst: totalSgst.toFixed(2),
          totalCgst: totalCgst.toFixed(2),
          totalIgst: totalIgst.toFixed(2),
        },
      };
    });
  }

  // --------------------------------------------------------------------------
  // 3. RECEIPT & PAYMENT REGISTER
  // --------------------------------------------------------------------------
  async getReceiptPaymentRegister(
    query: QueryReceiptPaymentRegisterDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const where: any = {
        companyId: tenant.companyId,
        isCancelled: false,
      };

      if (query.voucherType) {
        where.voucherType = query.voucherType;
      } else {
        where.voucherType = {
          in: [VoucherType.RECEIPT, VoucherType.PAYMENT, VoucherType.CONTRA],
        };
      }

      if (query.fromDate || query.toDate) {
        where.voucherDate = {};
        if (query.fromDate) {
          where.voucherDate.gte = parseStartOfDay(query.fromDate);
        }
        if (query.toDate) {
          where.voucherDate.lte = parseEndOfDay(query.toDate);
        }
      }

      const page = Number(query.page) || 1;
      const limit = Number(query.limit) || 50;
      const skip = (page - 1) * limit;

      const [vouchers, totalCount, allVouchers] = await Promise.all([
        tx.voucher.findMany({
          where,
          include: {
            allocations: {
              include: {
                salesInvoice: {
                  select: {
                    invoiceNumber: true,
                  },
                },
              },
            },
            journalEntries: {
              include: {
                account: {
                  select: {
                    name: true,
                    nameGujarati: true,
                    isBankLedger: true,
                    isCashLedger: true,
                    isPartyLedger: true,
                  },
                },
              },
              orderBy: { sequenceOrder: "asc" },
            },
          },
          orderBy: [{ voucherDate: "desc" }, { createdAt: "desc" }],
          skip,
          take: limit,
        }),
        tx.voucher.count({ where }),
        tx.voucher.findMany({
          where,
          select: {
            voucherType: true,
            totalAmount: true,
          },
        }),
      ]);

      let totalReceipts = new Decimal(0);
      let totalPayments = new Decimal(0);
      let totalContra = new Decimal(0);

      for (const v of allVouchers) {
        const amt = toMoney(v.totalAmount);
        if (v.voucherType === VoucherType.RECEIPT) {
          totalReceipts = totalReceipts.plus(amt);
        } else if (v.voucherType === VoucherType.PAYMENT) {
          totalPayments = totalPayments.plus(amt);
        } else if (v.voucherType === VoucherType.CONTRA) {
          totalContra = totalContra.plus(amt);
        }
      }

      return {
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
        summary: {
          totalReceipts: totalReceipts.toFixed(2),
          totalPayments: totalPayments.toFixed(2),
          totalContra: totalContra.toFixed(2),
          netCashMovement: totalReceipts.minus(totalPayments).toFixed(2),
        },
        items: vouchers.map((v) => {
          // Identify counterpart party or bank ledger for user-friendly display
          const partyLine = v.journalEntries.find(
            (je) => je.account.isPartyLedger,
          );
          const bankCashLine = v.journalEntries.find(
            (je) => je.account.isBankLedger || je.account.isCashLedger,
          );

          return {
            id: v.id,
            voucherNumber: v.voucherNumber,
            voucherType: v.voucherType,
            voucherDate: v.voucherDate.toISOString().split("T")[0],
            referenceNo: v.referenceNo,
            totalAmount: toMoney(v.totalAmount).toFixed(2),
            narration: v.narration,
            narrationGujarati: v.narrationGujarati,
            partyOrAccountName:
              partyLine?.account.name ||
              bankCashLine?.account.name ||
              "General Entry",
            bankCashAccount: bankCashLine?.account.name || "N/A",
            allocatedInvoices: v.allocations.map((a) => ({
              invoiceNumber: a.salesInvoice?.invoiceNumber,
              allocatedAmount: toMoney(a.allocatedAmount).toFixed(2),
              cashDiscount: toMoney(a.cashDiscount).toFixed(2),
            })),
          };
        }),
      };
    });
  }

  // --------------------------------------------------------------------------
  // 3b. LIVE FINANCIAL SUMMARY (TO COLLECT, TO PAY, CASH + BANK)
  // --------------------------------------------------------------------------
  async getFinancialSummary(
    tenant: TenantContext,
    query?: QueryFinancialSummaryDto,
  ): Promise<FinancialSummaryDto> {
    if (
      !tenant?.companyId ||
      typeof tenant.companyId !== "string" ||
      tenant.companyId.trim() === ""
    ) {
      throw new BadRequestException(
        "Company context is required for dashboard summary.",
      );
    }

    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(tenant.companyId)) {
      throw new BadRequestException(
        "Invalid company context identifier. Must be a valid UUID.",
      );
    }

    let asOfDateObj: Date | null = null;
    if (query?.asOfDate) {
      const parsed = parseEndOfDay(query.asOfDate);
      if (!parsed || isNaN(parsed.getTime())) {
        throw new BadRequestException(
          `Invalid asOfDate format: '${query.asOfDate}'. Expected valid ISO-8601 or YYYY-MM-DD date.`,
        );
      }
      asOfDateObj = parsed;
    }

    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      // 1. To Collect (Customer Receivables)
      const customerParties = await tx.party.findMany({
        where: {
          companyId: tenant.companyId,
          isActive: true,
          type: { in: [PartyType.CUSTOMER, PartyType.BOTH] },
        },
        select: {
          id: true,
          type: true,
          ledgerAccount: {
            select: {
              id: true,
              openingBalance: true,
              openingType: true,
              currentBalance: true,
            },
          },
          salesInvoices: {
            where: {
              status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT] },
              balanceAmount: { not: 0 },
              ...(asOfDateObj ? { invoiceDate: { lte: asOfDateObj } } : {}),
            },
            select: {
              balanceAmount: true,
            },
          },
        },
      });

      let totalReceivables = new Decimal(0);
      for (const p of customerParties) {
        let invoiceBal = new Decimal(0);
        for (const inv of p.salesInvoices) {
          invoiceBal = invoiceBal.plus(toMoney(inv.balanceAmount));
        }

        if (invoiceBal.gt(0)) {
          totalReceivables = totalReceivables.plus(invoiceBal);
        } else if (p.ledgerAccount) {
          const ledgerBal = toMoney(p.ledgerAccount.currentBalance);
          if (ledgerBal.gt(0)) {
            totalReceivables = totalReceivables.plus(ledgerBal);
          }
        }
      }

      // 2. To Pay (Supplier Payables)
      const supplierParties = await tx.party.findMany({
        where: {
          companyId: tenant.companyId,
          isActive: true,
          type: { in: [PartyType.SUPPLIER, PartyType.BOTH] },
        },
        select: {
          id: true,
          type: true,
          ledgerAccount: {
            select: {
              id: true,
              openingBalance: true,
              openingType: true,
              currentBalance: true,
            },
          },
          purchaseInvoices: {
            where: {
              balanceAmount: { not: 0 },
              ...(asOfDateObj ? { invoiceDate: { lte: asOfDateObj } } : {}),
            },
            select: {
              balanceAmount: true,
            },
          },
        },
      });

      let totalPayables = new Decimal(0);
      for (const p of supplierParties) {
        let purchaseBal = new Decimal(0);
        for (const pinv of p.purchaseInvoices || []) {
          purchaseBal = purchaseBal.plus(toMoney(pinv.balanceAmount));
        }

        if (purchaseBal.gt(0)) {
          totalPayables = totalPayables.plus(purchaseBal);
        } else if (p.ledgerAccount) {
          const ledgerBal = toMoney(p.ledgerAccount.currentBalance);
          if (ledgerBal.gt(0)) {
            totalPayables = totalPayables.plus(ledgerBal);
          }
        }
      }

      // 3. Cash & Bank Balances (Posted uncancelled journal entries + opening balances)
      const cashBankAccounts = await tx.ledgerAccount.findMany({
        where: {
          companyId: tenant.companyId,
          isActive: true,
          OR: [{ isCashLedger: true }, { isBankLedger: true }],
        },
        select: {
          id: true,
          name: true,
          code: true,
          isCashLedger: true,
          isBankLedger: true,
          openingBalance: true,
          openingType: true,
        },
      });

      let totalCash = new Decimal(0);
      let totalBank = new Decimal(0);

      if (cashBankAccounts.length > 0) {
        const accountIds = cashBankAccounts.map((a) => a.id);

        const journalTotals: Array<{
          accountId: string;
          totalDebit: string | number;
          totalCredit: string | number;
        }> = asOfDateObj
          ? await tx.$queryRaw`
              SELECT 
                je.account_id AS "accountId",
                COALESCE(SUM(je.debit_amount), 0)::text AS "totalDebit",
                COALESCE(SUM(je.credit_amount), 0)::text AS "totalCredit"
              FROM journal_entries je
              JOIN vouchers v ON v.id = je.voucher_id
              WHERE v.company_id = ${tenant.companyId}::uuid
                AND v.is_cancelled = false
                AND v.voucher_date <= ${asOfDateObj}
                AND je.account_id = ANY(${accountIds}::uuid[])
              GROUP BY je.account_id
            `
          : await tx.$queryRaw`
              SELECT 
                je.account_id AS "accountId",
                COALESCE(SUM(je.debit_amount), 0)::text AS "totalDebit",
                COALESCE(SUM(je.credit_amount), 0)::text AS "totalCredit"
              FROM journal_entries je
              JOIN vouchers v ON v.id = je.voucher_id
              WHERE v.company_id = ${tenant.companyId}::uuid
                AND v.is_cancelled = false
                AND je.account_id = ANY(${accountIds}::uuid[])
              GROUP BY je.account_id
            `;

        const journalMap = new Map<string, { dr: Decimal; cr: Decimal }>();
        for (const row of journalTotals) {
          journalMap.set(row.accountId, {
            dr: toMoney(row.totalDebit),
            cr: toMoney(row.totalCredit),
          });
        }

        for (const acc of cashBankAccounts) {
          const openBal = toMoney(acc.openingBalance);
          let accBalance =
            acc.openingType === "CR" ? openBal.negated() : openBal;

          const jTotals = journalMap.get(acc.id);
          if (jTotals) {
            accBalance = accBalance.plus(jTotals.dr).minus(jTotals.cr);
          }

          if (acc.isCashLedger) {
            totalCash = totalCash.plus(accBalance);
          } else if (acc.isBankLedger) {
            totalBank = totalBank.plus(accBalance);
          }
        }
      }

      const totalCashBank = totalCash.plus(totalBank);

      return {
        toCollect: totalReceivables.toFixed(2),
        toPay: totalPayables.toFixed(2),
        cashBalance: totalCash.toFixed(2),
        bankBalance: totalBank.toFixed(2),
        totalCashBankBalance: totalCashBank.toFixed(2),
        currency: "INR",
        asOf: (asOfDateObj ?? new Date()).toISOString(),
      };
    });
  }

  // --------------------------------------------------------------------------
  // 4. OUTSTANDING BALANCES & PARTY AGING
  // --------------------------------------------------------------------------
  async getOutstandingBalances(
    query: QueryOutstandingBalancesDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const where: any = {
        companyId: tenant.companyId,
        isActive: true,
      };

      if (query.partyType && query.partyType !== ("ALL" as any)) {
        where.type = query.partyType;
      }

      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: "insensitive" } },
          { phone: { contains: query.search } },
          { gstin: { contains: query.search, mode: "insensitive" } },
        ];
      }

      const parties = await tx.party.findMany({
        where,
        include: {
          ledgerAccount: true,
          salesInvoices: {
            where: {
              status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT] },
              balanceAmount: { not: 0 },
            },
            select: {
              id: true,
              invoiceNumber: true,
              invoiceDate: true,
              dueDate: true,
              grandTotal: true,
              balanceAmount: true,
            },
          },
          purchaseInvoices: {
            where: {
              balanceAmount: { not: 0 },
            },
            select: {
              id: true,
              vendorInvoiceNumber: true,
              invoiceDate: true,
              grandTotal: true,
              balanceAmount: true,
            },
          },
        },
        orderBy: { name: "asc" },
      });

      let totalReceivables = new Decimal(0);
      let totalPayables = new Decimal(0);

      const items = parties.map((p) => {
        // Compute unpaid sales invoice balance
        let invoiceBalance = new Decimal(0);
        for (const inv of p.salesInvoices) {
          invoiceBalance = invoiceBalance.plus(toMoney(inv.balanceAmount));
        }

        // Compute unpaid purchase invoice balance
        let purchaseBalance = new Decimal(0);
        for (const pinv of p.purchaseInvoices || []) {
          purchaseBalance = purchaseBalance.plus(toMoney(pinv.balanceAmount));
        }

        const isSupplier = p.type === PartyType.SUPPLIER;
        const isBoth = p.type === PartyType.BOTH;

        // Effective invoice balance: for BOTH, net of sales and purchases
        let effectiveInvoiceBal: Decimal;
        if (isSupplier) {
          effectiveInvoiceBal = purchaseBalance;
        } else if (isBoth) {
          effectiveInvoiceBal = invoiceBalance.minus(purchaseBalance);
        } else {
          effectiveInvoiceBal = invoiceBalance;
        }

        // Ledger current balance
        const ledgerBal = p.ledgerAccount
          ? toMoney(p.ledgerAccount.currentBalance)
          : effectiveInvoiceBal;

        // Sign convention:
        // Customer (Asset): positive is DR (receivable), negative is CR (customer advance/credit)
        // Supplier (Liability): positive is CR (payable), negative is DR (supplier debit/advance)
        // Both: positive is DR (net receivable), negative is CR (net payable)
        let balanceType: "DR" | "CR" = "DR";
        if (isSupplier) {
          balanceType = ledgerBal.isNegative() ? "DR" : "CR";
        } else {
          balanceType = ledgerBal.isNegative() ? "CR" : "DR";
        }

        if (p.type === PartyType.CUSTOMER) {
          if (invoiceBalance.gt(0)) {
            totalReceivables = totalReceivables.plus(invoiceBalance);
          } else if (
            p.ledgerAccount &&
            toMoney(p.ledgerAccount.currentBalance).gt(0)
          ) {
            totalReceivables = totalReceivables.plus(
              toMoney(p.ledgerAccount.currentBalance),
            );
          }
        } else if (p.type === PartyType.SUPPLIER) {
          if (purchaseBalance.gt(0)) {
            totalPayables = totalPayables.plus(purchaseBalance);
          } else if (
            p.ledgerAccount &&
            toMoney(p.ledgerAccount.currentBalance).gt(0)
          ) {
            totalPayables = totalPayables.plus(
              toMoney(p.ledgerAccount.currentBalance),
            );
          }
        } else if (p.type === PartyType.BOTH) {
          if (invoiceBalance.gt(0)) {
            totalReceivables = totalReceivables.plus(invoiceBalance);
          } else if (
            p.ledgerAccount &&
            toMoney(p.ledgerAccount.currentBalance).gt(0)
          ) {
            totalReceivables = totalReceivables.plus(
              toMoney(p.ledgerAccount.currentBalance),
            );
          }
          if (purchaseBalance.gt(0)) {
            totalPayables = totalPayables.plus(purchaseBalance);
          } else if (
            p.ledgerAccount &&
            toMoney(p.ledgerAccount.currentBalance).gt(0)
          ) {
            totalPayables = totalPayables.plus(
              toMoney(p.ledgerAccount.currentBalance),
            );
          }
        }

        const diff = effectiveInvoiceBal.minus(ledgerBal).abs();

        return {
          partyId: p.id,
          name: p.name,
          nameGujarati: p.nameGujarati,
          phone: p.phone,
          gstin: p.gstin,
          partyType: p.type,
          creditLimit: toMoney(p.creditLimit).toFixed(2),
          creditDays: p.creditDays,
          interestRate: toMoney(p.interestRate).toFixed(2),
          unpaidInvoicesCount: isSupplier
            ? p.purchaseInvoices?.length || 0
            : isBoth
              ? p.salesInvoices.length + (p.purchaseInvoices?.length || 0)
              : p.salesInvoices.length,
          salesOutstanding: invoiceBalance.toFixed(2),
          purchaseOutstanding: purchaseBalance.toFixed(2),
          invoiceOutstanding: effectiveInvoiceBal.toFixed(2),
          ledgerBalance: ledgerBal.toFixed(2),
          balanceType,
          difference: diff.toFixed(2),
          isReconciled: diff.isZero(),
        };
      });

      const customerCount = items.filter(
        (p) =>
          p.partyType === PartyType.CUSTOMER || p.partyType === PartyType.BOTH,
      ).length;
      const supplierCount = items.filter(
        (p) =>
          p.partyType === PartyType.SUPPLIER || p.partyType === PartyType.BOTH,
      ).length;

      const summary = {
        totalReceivables: totalReceivables.toFixed(2),
        totalPayables: totalPayables.toFixed(2),
        netOutstanding: totalReceivables.minus(totalPayables).toFixed(2),
        totalParties: parties.length,
      };

      const totals = {
        totalCustomerOutstanding: totalReceivables.toFixed(2),
        totalSupplierOutstanding: totalPayables.toFixed(2),
        totalNetReceivable: totalReceivables.minus(totalPayables).toFixed(2),
        customerCount,
        supplierCount,
      };

      return {
        summary,
        totals,
        parties: items,
      };
    });
  }

  async getPartyAging(
    query: QueryPartyAgingDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const where: any = {
        companyId: tenant.companyId,
        isActive: true,
      };

      if (query.partyId) {
        where.id = query.partyId;
      }

      const parties = await tx.party.findMany({
        where,
        include: {
          salesInvoices: {
            where: {
              status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT] },
              balanceAmount: { gt: 0 },
            },
            select: {
              id: true,
              invoiceNumber: true,
              invoiceDate: true,
              dueDate: true,
              grandTotal: true,
              balanceAmount: true,
            },
          },
        },
      });

      const asOfDate = query.asOfDate ? new Date(query.asOfDate) : new Date();

      let summaryTotalReceivable = new Decimal(0);
      let summaryNotDue = new Decimal(0);
      let summary0to30 = new Decimal(0);
      let summary31to60 = new Decimal(0);
      let summary61to90 = new Decimal(0);
      let summary90Plus = new Decimal(0);
      let summaryAccruedInterest = new Decimal(0);

      const partyResults = [];

      for (const p of parties) {
        if (p.salesInvoices.length === 0) {
          continue;
        }

        const aging = calculatePartyAging(
          p.salesInvoices.map((inv) => ({
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: inv.invoiceDate,
            dueDate: inv.dueDate,
            grandTotal: inv.grandTotal,
            balanceAmount: inv.balanceAmount,
            creditDays: p.creditDays,
          })),
          p.interestRate,
          asOfDate,
        );

        summaryTotalReceivable = summaryTotalReceivable.plus(
          toMoney(aging.totalOutstanding),
        );
        summaryNotDue = summaryNotDue.plus(toMoney(aging.notDue));
        summary0to30 = summary0to30.plus(toMoney(aging.overdue0to30));
        summary31to60 = summary31to60.plus(toMoney(aging.overdue31to60));
        summary61to90 = summary61to90.plus(toMoney(aging.overdue61to90));
        summary90Plus = summary90Plus.plus(toMoney(aging.overdue90Plus));
        summaryAccruedInterest = summaryAccruedInterest.plus(
          toMoney(aging.accruedInterest),
        );

        partyResults.push({
          partyId: p.id,
          partyName: p.name,
          partyNameGujarati: p.nameGujarati,
          phone: p.phone,
          creditLimit: toMoney(p.creditLimit).toFixed(2),
          creditDays: p.creditDays,
          totalDue: aging.totalOutstanding,
          notDue: aging.notDue,
          overdue0to30: aging.overdue0to30,
          overdue31to60: aging.overdue31to60,
          overdue61to90: aging.overdue61to90,
          overdue90Plus: aging.overdue90Plus,
          overdueDays: aging.overdueDaysMax,
          accruedInterest: aging.accruedInterest,
        });
      }

      return {
        asOfDate: asOfDate.toISOString().split("T")[0],
        summary: {
          totalReceivable: summaryTotalReceivable.toFixed(2),
          notDue: summaryNotDue.toFixed(2),
          overdue0to30: summary0to30.toFixed(2),
          overdue31to60: summary31to60.toFixed(2),
          overdue61to90: summary61to90.toFixed(2),
          overdue90Plus: summary90Plus.toFixed(2),
          totalAccruedInterest: summaryAccruedInterest.toFixed(2),
        },
        parties: partyResults,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 5. PARTY LEDGER (STATEMENT OF ACCOUNT / KHATA)
  // --------------------------------------------------------------------------
  async getPartyLedger(
    query: QueryPartyLedgerDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const party = await tx.party.findUnique({
        where: { id: query.partyId },
        include: { ledgerAccount: true },
      });

      if (!party || party.companyId !== tenant.companyId) {
        throw new NotFoundException(
          `Party with ID ${query.partyId} not found.`,
        );
      }

      let partyLedgerAccount = party.ledgerAccount;
      if (!partyLedgerAccount) {
        partyLedgerAccount = await tx.ledgerAccount.findFirst({
          where: { companyId: tenant.companyId, partyId: party.id },
        });
      }

      const fromDate = query.fromDate
        ? new Date(query.fromDate)
        : new Date("2020-01-01");
      const toDate = query.toDate ? new Date(query.toDate) : new Date();

      if (!partyLedgerAccount) {
        const isSupplier = party.type === PartyType.SUPPLIER;
        return {
          party: {
            id: party.id,
            name: party.name,
            nameGujarati: party.nameGujarati,
            phone: party.phone,
            gstin: party.gstin,
            accountId: null,
            accountName: party.name,
          },
          period: {
            fromDate: fromDate.toISOString().split("T")[0],
            toDate: toDate.toISOString().split("T")[0],
          },
          openingBalance: {
            amount: "0.00",
            type: isSupplier ? "CR" : "DR",
          },
          transactions: [],
          totalDebit: "0.00",
          totalCredit: "0.00",
          closingBalance: {
            amount: "0.00",
            type: isSupplier ? "CR" : "DR",
          },
        };
      }

      const accountId = partyLedgerAccount.id;

      // 1. Calculate opening balance as of fromDate
      // All journal entries before fromDate
      const priorEntries = await tx.journalEntry.findMany({
        where: {
          accountId,
          voucher: {
            companyId: tenant.companyId,
            voucherDate: { lt: fromDate },
          },
        },
        select: {
          debitAmount: true,
          creditAmount: true,
        },
      });

      let openingBal = toMoney(partyLedgerAccount.openingBalance);
      if (partyLedgerAccount.openingType === "CR") {
        openingBal = openingBal.negated();
      }

      for (const pe of priorEntries) {
        openingBal = openingBal
          .plus(toMoney(pe.debitAmount))
          .minus(toMoney(pe.creditAmount));
      }

      // 2. Fetch period journal entries
      const entries = await tx.journalEntry.findMany({
        where: {
          accountId,
          voucher: {
            companyId: tenant.companyId,
            voucherDate: { gte: fromDate, lte: toDate },
          },
        },
        include: {
          voucher: {
            select: {
              voucherNumber: true,
              voucherType: true,
              voucherDate: true,
              referenceNo: true,
              narration: true,
              narrationGujarati: true,
            },
          },
        },
        orderBy: [
          { voucher: { voucherDate: "asc" } },
          { voucher: { createdAt: "asc" } },
          { sequenceOrder: "asc" },
        ],
      });

      let runningBalance = openingBal;
      let totalDebit = new Decimal(0);
      let totalCredit = new Decimal(0);

      const items = entries.map((e) => {
        const dr = toMoney(e.debitAmount);
        const cr = toMoney(e.creditAmount);

        totalDebit = totalDebit.plus(dr);
        totalCredit = totalCredit.plus(cr);

        runningBalance = runningBalance.plus(dr).minus(cr);

        return {
          id: e.id,
          date: e.voucher.voucherDate.toISOString().split("T")[0],
          voucherNumber: e.voucher.voucherNumber,
          voucherType: e.voucher.voucherType,
          referenceNo: e.voucher.referenceNo,
          narration: e.lineNarration || e.voucher.narration,
          narrationGujarati: e.voucher.narrationGujarati,
          debit: dr.toFixed(2),
          credit: cr.toFixed(2),
          runningBalance: runningBalance.abs().toFixed(2),
          balanceType: runningBalance.isNegative() ? "CR" : "DR",
        };
      });

      return {
        party: {
          id: party.id,
          name: party.name,
          nameGujarati: party.nameGujarati,
          phone: party.phone,
          gstin: party.gstin,
          accountId: partyLedgerAccount.id,
          accountName: partyLedgerAccount.name,
        },
        period: {
          fromDate: fromDate.toISOString().split("T")[0],
          toDate: toDate.toISOString().split("T")[0],
        },
        openingBalance: {
          amount: openingBal.abs().toFixed(2),
          type: openingBal.isNegative() ? "CR" : "DR",
        },
        transactions: items,
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        closingBalance: {
          amount: runningBalance.abs().toFixed(2),
          type: runningBalance.isNegative() ? "CR" : "DR",
        },
      };
    });
  }

  // --------------------------------------------------------------------------
  // 6. GENERAL LEDGER (KHATAVAHI)
  // --------------------------------------------------------------------------
  async getGeneralLedger(
    query: QueryGeneralLedgerDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const account = await tx.ledgerAccount.findUnique({
        where: { id: query.accountId },
        include: { group: true },
      });

      if (!account || account.companyId !== tenant.companyId) {
        throw new NotFoundException(
          `Ledger account with ID ${query.accountId} not found.`,
        );
      }

      const fromDate = query.fromDate
        ? new Date(query.fromDate)
        : new Date("2020-01-01");
      const toDate = query.toDate ? new Date(query.toDate) : new Date();

      // Opening balance prior to fromDate
      const priorEntries = await tx.journalEntry.findMany({
        where: {
          accountId: account.id,
          voucher: {
            companyId: tenant.companyId,
            voucherDate: { lt: fromDate },
          },
        },
        select: {
          debitAmount: true,
          creditAmount: true,
        },
      });

      let openingBal = toMoney(account.openingBalance);
      if (account.openingType === "CR") {
        openingBal = openingBal.negated();
      }

      for (const pe of priorEntries) {
        openingBal = openingBal
          .plus(toMoney(pe.debitAmount))
          .minus(toMoney(pe.creditAmount));
      }

      // Period entries
      const entries = await tx.journalEntry.findMany({
        where: {
          accountId: account.id,
          voucher: {
            companyId: tenant.companyId,
            voucherDate: { gte: fromDate, lte: toDate },
          },
        },
        include: {
          voucher: {
            select: {
              voucherNumber: true,
              voucherType: true,
              voucherDate: true,
              referenceNo: true,
              narration: true,
            },
          },
        },
        orderBy: [
          { voucher: { voucherDate: "asc" } },
          { voucher: { createdAt: "asc" } },
          { sequenceOrder: "asc" },
        ],
      });

      let runningBalance = openingBal;
      let totalDebit = new Decimal(0);
      let totalCredit = new Decimal(0);

      const items = entries.map((e) => {
        const dr = toMoney(e.debitAmount);
        const cr = toMoney(e.creditAmount);

        totalDebit = totalDebit.plus(dr);
        totalCredit = totalCredit.plus(cr);

        runningBalance = runningBalance.plus(dr).minus(cr);

        return {
          id: e.id,
          date: e.voucher.voucherDate.toISOString().split("T")[0],
          voucherNumber: e.voucher.voucherNumber,
          voucherType: e.voucher.voucherType,
          referenceNo: e.voucher.referenceNo,
          narration: e.lineNarration || e.voucher.narration,
          debit: dr.toFixed(2),
          credit: cr.toFixed(2),
          runningBalance: runningBalance.abs().toFixed(2),
          balanceType: runningBalance.isNegative() ? "CR" : "DR",
        };
      });

      return {
        account: {
          id: account.id,
          name: account.name,
          nameGujarati: account.nameGujarati,
          code: account.code,
          nature: account.group.nature,
          groupName: account.group.name,
        },
        period: {
          fromDate: fromDate.toISOString().split("T")[0],
          toDate: toDate.toISOString().split("T")[0],
        },
        openingBalance: {
          amount: openingBal.abs().toFixed(2),
          type: openingBal.isNegative() ? "CR" : "DR",
        },
        entries: items,
        totalDebit: totalDebit.toFixed(2),
        totalCredit: totalCredit.toFixed(2),
        closingBalance: {
          amount: runningBalance.abs().toFixed(2),
          type: runningBalance.isNegative() ? "CR" : "DR",
        },
      };
    });
  }

  // --------------------------------------------------------------------------
  // 7. TRIAL BALANCE (KACHU SARVAIYU)
  // --------------------------------------------------------------------------
  async getTrialBalance(
    query: QueryFinancialStatementDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const accounts = await tx.ledgerAccount.findMany({
        where: {
          companyId: tenant.companyId,
          isActive: true,
        },
        include: {
          group: true,
          journalEntries: {
            where: {
              voucher: {
                ...(query.fromDate || query.toDate
                  ? {
                      voucherDate: {
                        ...(query.fromDate
                          ? { gte: new Date(query.fromDate) }
                          : {}),
                        ...(query.toDate
                          ? { lte: new Date(query.toDate) }
                          : {}),
                      },
                    }
                  : {}),
              },
            },
            select: {
              debitAmount: true,
              creditAmount: true,
            },
          },
        },
        orderBy: [
          { group: { nature: "asc" } },
          { group: { name: "asc" } },
          { name: "asc" },
        ],
      });

      const trialBalanceItems = accounts.map((acc) => {
        let periodDr = new Decimal(0);
        let periodCr = new Decimal(0);

        for (const je of acc.journalEntries) {
          periodDr = periodDr.plus(toMoney(je.debitAmount));
          periodCr = periodCr.plus(toMoney(je.creditAmount));
        }

        // Net account balance
        const netBal = periodDr.minus(periodCr);
        let closingDr = new Decimal(0);
        let closingCr = new Decimal(0);

        if (netBal.isPositive()) {
          closingDr = netBal;
        } else if (netBal.isNegative()) {
          closingCr = netBal.abs();
        }

        return {
          accountId: acc.id,
          accountName: acc.name,
          accountNameGujarati: acc.nameGujarati,
          accountCode: acc.code,
          nature: acc.group.nature as any,
          groupName: acc.group.name,
          openingDebit: "0.00",
          openingCredit: "0.00",
          periodDebit: periodDr.toFixed(2),
          periodCredit: periodCr.toFixed(2),
          closingDebit: closingDr.toFixed(2),
          closingCredit: closingCr.toFixed(2),
        };
      });

      const summary = calculateTrialBalanceTotals(trialBalanceItems);

      return {
        isBalanced: summary.isBalanced,
        difference: summary.difference,
        totals: {
          totalPeriodDebit: summary.totalPeriodDebit,
          totalPeriodCredit: summary.totalPeriodCredit,
          totalClosingDebit: summary.totalClosingDebit,
          totalClosingCredit: summary.totalClosingCredit,
        },
        accounts: trialBalanceItems,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 8. PROFIT & LOSS STATEMENT (NAFANUKSAN KHATU)
  // --------------------------------------------------------------------------
  async getProfitAndLoss(
    query: QueryFinancialStatementDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const accounts = await tx.ledgerAccount.findMany({
        where: {
          companyId: tenant.companyId,
          isActive: true,
          group: {
            nature: { in: [AccountNature.INCOME, AccountNature.EXPENSE] },
          },
        },
        include: {
          group: true,
          journalEntries: {
            where: {
              voucher: {
                ...(query.fromDate || query.toDate
                  ? {
                      voucherDate: {
                        ...(query.fromDate
                          ? { gte: new Date(query.fromDate) }
                          : {}),
                        ...(query.toDate
                          ? { lte: new Date(query.toDate) }
                          : {}),
                      },
                    }
                  : {}),
              },
            },
            select: {
              debitAmount: true,
              creditAmount: true,
            },
          },
        },
      });

      let directIncome = new Decimal(0);
      let directExpenses = new Decimal(0);
      let indirectIncome = new Decimal(0);
      let indirectExpenses = new Decimal(0);

      const incomeDetails = [];
      const expenseDetails = [];

      for (const acc of accounts) {
        let dr = new Decimal(0);
        let cr = new Decimal(0);
        for (const je of acc.journalEntries) {
          dr = dr.plus(toMoney(je.debitAmount));
          cr = cr.plus(toMoney(je.creditAmount));
        }

        const isDirect =
          acc.group.name.toLowerCase().includes("direct") ||
          acc.group.name.toLowerCase().includes("sales") ||
          acc.group.name.toLowerCase().includes("purchase");

        if (acc.group.nature === AccountNature.INCOME) {
          // Income accounts have normal Credit balance (Credit - Debit)
          const net = cr.minus(dr);
          if (isDirect) {
            directIncome = directIncome.plus(net);
          } else {
            indirectIncome = indirectIncome.plus(net);
          }
          incomeDetails.push({
            id: acc.id,
            name: acc.name,
            groupName: acc.group.name,
            amount: net.toFixed(2),
            isDirect,
          });
        } else {
          // Expense accounts have normal Debit balance (Debit - Credit)
          const net = dr.minus(cr);
          if (isDirect) {
            directExpenses = directExpenses.plus(net);
          } else {
            indirectExpenses = indirectExpenses.plus(net);
          }
          expenseDetails.push({
            id: acc.id,
            name: acc.name,
            groupName: acc.group.name,
            amount: net.toFixed(2),
            isDirect,
          });
        }
      }

      const pnl = calculateProfitAndLoss({
        directIncome,
        directExpenses,
        indirectIncome,
        indirectExpenses,
      });

      // Calculate Physical Closing Stock Valuation & SME Trading Account metrics
      const stockSummary = await this.getStockSummary(
        { asOfDate: query.toDate },
        tenant,
      );
      const closingStockValuation = toMoney(
        stockSummary.totals.grandStockValuation,
      );
      const cogs = Decimal.max(0, directExpenses.minus(closingStockValuation));
      const tradingGrossProfit = directIncome.minus(cogs);
      const tradingNetProfit = tradingGrossProfit
        .plus(indirectIncome)
        .minus(indirectExpenses);

      return {
        summary: pnl,
        directIncome: {
          total: pnl.directIncome,
          accounts: incomeDetails.filter((i) => i.isDirect),
        },
        directExpenses: {
          total: pnl.directExpenses,
          accounts: expenseDetails.filter((e) => e.isDirect),
        },
        grossProfit: pnl.grossProfit,
        isGrossLoss: pnl.isGrossLoss,
        indirectIncome: {
          total: pnl.indirectIncome,
          accounts: incomeDetails.filter((i) => !i.isDirect),
        },
        indirectExpenses: {
          total: pnl.indirectExpenses,
          accounts: expenseDetails.filter((e) => !e.isDirect),
        },
        netProfit: pnl.netProfit,
        isNetLoss: pnl.isNetLoss,
        tradingAccount: {
          closingStockValuation: closingStockValuation.toFixed(2),
          costOfGoodsSold: cogs.toFixed(2),
          tradingGrossProfit: tradingGrossProfit.toFixed(2),
          tradingNetProfit: tradingNetProfit.toFixed(2),
        },
      };
    });
  }

  // --------------------------------------------------------------------------
  // 9. BALANCE SHEET (PAKU SARVAIYU)
  // --------------------------------------------------------------------------
  async getBalanceSheet(
    query: QueryFinancialStatementDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      // 1. Get Net Profit/Loss from P&L
      const pnl = await this.getProfitAndLoss(query, tenant);
      const netProfitOrLoss = pnl.summary.netProfit;

      // 2. Fetch Balance Sheet accounts (Asset, Liability, Equity)
      const accounts = await tx.ledgerAccount.findMany({
        where: {
          companyId: tenant.companyId,
          isActive: true,
          group: {
            nature: {
              in: [
                AccountNature.ASSET,
                AccountNature.LIABILITY,
                AccountNature.EQUITY,
              ],
            },
          },
        },
        include: {
          group: true,
          journalEntries: {
            where: {
              voucher: {
                ...(query.asOfDate
                  ? { voucherDate: { lte: new Date(query.asOfDate) } }
                  : {}),
              },
            },
            select: {
              debitAmount: true,
              creditAmount: true,
            },
          },
        },
        orderBy: [{ group: { nature: "asc" } }, { group: { name: "asc" } }],
      });

      let totalAssets = new Decimal(0);
      let totalLiabilities = new Decimal(0);
      let totalEquity = new Decimal(0);

      const assetAccounts = [];
      const liabilityAccounts = [];
      const equityAccounts = [];

      for (const acc of accounts) {
        let dr = new Decimal(0);
        let cr = new Decimal(0);
        for (const je of acc.journalEntries) {
          dr = dr.plus(toMoney(je.debitAmount));
          cr = cr.plus(toMoney(je.creditAmount));
        }

        if (acc.group.nature === AccountNature.ASSET) {
          const bal = dr.minus(cr);
          totalAssets = totalAssets.plus(bal);
          assetAccounts.push({
            id: acc.id,
            name: acc.name,
            groupName: acc.group.name,
            amount: bal.toFixed(2),
          });
        } else if (acc.group.nature === AccountNature.LIABILITY) {
          const bal = cr.minus(dr);
          totalLiabilities = totalLiabilities.plus(bal);
          liabilityAccounts.push({
            id: acc.id,
            name: acc.name,
            groupName: acc.group.name,
            amount: bal.toFixed(2),
          });
        } else if (acc.group.nature === AccountNature.EQUITY) {
          const bal = cr.minus(dr);
          totalEquity = totalEquity.plus(bal);
          equityAccounts.push({
            id: acc.id,
            name: acc.name,
            groupName: acc.group.name,
            amount: bal.toFixed(2),
          });
        }
      }

      const bs = calculateBalanceSheetTotals({
        totalAssets,
        totalLiabilities,
        totalEquity,
        netProfitOrLoss,
      });

      return {
        asOfDate: query.asOfDate || new Date().toISOString().split("T")[0],
        isBalanced: bs.isBalanced,
        difference: bs.difference,
        assets: {
          total: bs.totalAssets,
          accounts: assetAccounts,
        },
        liabilities: {
          total: bs.totalLiabilities,
          accounts: liabilityAccounts,
        },
        equity: {
          total: bs.totalEquity,
          netProfitOrLoss: bs.netProfitOrLoss,
          accounts: equityAccounts,
        },
        totalLiabilitiesAndEquity: bs.totalLiabilitiesAndEquity,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 10. DAY BOOK (ROJMEL / AAVAD)
  // --------------------------------------------------------------------------
  async getDaybook(
    query: QueryDaybookDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const targetDate = query.date ? new Date(query.date) : new Date();
      targetDate.setUTCHours(0, 0, 0, 0);

      // 1. Compute cash balance as of start of day
      const cashAccounts = await tx.ledgerAccount.findMany({
        where: {
          companyId: tenant.companyId,
          isCashLedger: true,
        },
        include: {
          journalEntries: {
            where: {
              voucher: {
                voucherDate: { lt: targetDate },
              },
            },
            select: {
              debitAmount: true,
              creditAmount: true,
            },
          },
        },
      });

      let openingCash = new Decimal(0);
      for (const ca of cashAccounts) {
        openingCash = openingCash.plus(toMoney(ca.openingBalance));
        for (const je of ca.journalEntries) {
          openingCash = openingCash
            .plus(toMoney(je.debitAmount))
            .minus(toMoney(je.creditAmount));
        }
      }

      // 2. Fetch Day's Vouchers
      const vouchers = await tx.voucher.findMany({
        where: {
          companyId: tenant.companyId,
          voucherDate: targetDate,
        },
        include: {
          journalEntries: {
            include: {
              account: {
                select: {
                  name: true,
                  nameGujarati: true,
                  isCashLedger: true,
                  isBankLedger: true,
                },
              },
            },
          },
        },
        orderBy: [{ createdAt: "asc" }],
      });

      let totalUdhar = new Decimal(0);
      let totalJama = new Decimal(0);

      const entries = vouchers.map((v) => {
        let drAmt = new Decimal(0);
        let crAmt = new Decimal(0);

        for (const je of v.journalEntries) {
          drAmt = drAmt.plus(toMoney(je.debitAmount));
          crAmt = crAmt.plus(toMoney(je.creditAmount));
        }

        totalUdhar = totalUdhar.plus(drAmt);
        totalJama = totalJama.plus(crAmt);

        return {
          voucherNumber: v.voucherNumber,
          voucherType: v.voucherType,
          totalAmount: toMoney(v.totalAmount).toFixed(2),
          narration: v.narration,
          narrationGujarati: v.narrationGujarati,
          debit: drAmt.toFixed(2),
          credit: crAmt.toFixed(2),
          type: v.voucherType === VoucherType.RECEIPT ? "JAMA" : "UDHAR",
        };
      });

      const closingCash = openingCash.plus(totalJama).minus(totalUdhar);

      return {
        date: targetDate.toISOString().split("T")[0],
        openingCashBalance: openingCash.toFixed(2),
        totalUdhar: totalUdhar.toFixed(2),
        totalJama: totalJama.toFixed(2),
        closingCashBalance: closingCash.toFixed(2),
        entries,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 11. STOCK SUMMARY & STOCK MOVEMENT
  // --------------------------------------------------------------------------
  async getStockSummary(
    query: QueryStockSummaryDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const whereItem: any = {
        companyId: tenant.companyId,
        isActive: true,
      };

      if (query.categoryId) {
        whereItem.categoryId = query.categoryId;
      }
      if (query.search) {
        whereItem.OR = [
          { name: { contains: query.search, mode: "insensitive" } },
          { sku: { contains: query.search, mode: "insensitive" } },
          { barcode: { contains: query.search } },
        ];
      }

      const items = await tx.item.findMany({
        where: whereItem,
        include: {
          category: { select: { name: true } },
          primaryUom: { select: { symbol: true } },
          stockTransactions: {
            where: {
              companyId: tenant.companyId,
              ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
              ...(query.asOfDate
                ? { transactionDate: { lte: new Date(query.asOfDate) } }
                : {}),
            },
            select: {
              quantity: true,
              valuationRate: true,
              totalValuation: true,
            },
          },
        },
        orderBy: { name: "asc" },
      });

      let grandStockQuantity = new Decimal(0);
      let grandStockValuation = new Decimal(0);

      const summaryItems = items.map((item) => {
        let onHandQty = new Decimal(0);
        let valuation = new Decimal(0);

        for (const st of item.stockTransactions) {
          const qty = toDecimal(st.quantity);
          onHandQty = onHandQty.plus(qty);
          const stVal = toMoney(st.totalValuation).abs();
          valuation = valuation.plus(
            qty.isNegative() ? stVal.negated() : stVal,
          );
        }

        if (onHandQty.lte(0)) {
          valuation = new Decimal(0);
        }

        grandStockQuantity = grandStockQuantity.plus(onHandQty);
        grandStockValuation = grandStockValuation.plus(valuation);

        const minStock = toDecimal(item.minStockLevel || 0);

        return {
          id: item.id,
          itemId: item.id,
          name: item.name,
          nameGujarati: item.nameGujarati,
          sku: item.sku,
          barcode: item.barcode,
          categoryName: item.category?.name || "Uncategorized",
          uomSymbol: item.primaryUom.symbol,
          purchaseRate: toMoney(item.purchaseRate).toFixed(2),
          retailPrice: toMoney(item.retailPrice).toFixed(2),
          currentStockQuantity: onHandQty.toFixed(4),
          currentStock: onHandQty.toFixed(1),
          totalValuation: valuation.toFixed(2),
          valuation: valuation.toFixed(2),
          minStockLevel: minStock.toFixed(4),
          isLowStock:
            (minStock.gt(0) && onHandQty.lte(minStock)) || onHandQty.lte(0),
          costingMethod: "MOVING_AVERAGE",
        };
      });

      return {
        totals: {
          totalItems: items.length,
          grandStockQuantity: grandStockQuantity.toFixed(4),
          grandStockValuation: grandStockValuation.toFixed(2),
          costingMethod: "MOVING_AVERAGE",
        },
        summary: {
          totalItems: items.length,
          totalQuantity: grandStockQuantity.toNumber(),
          totalValuation: grandStockValuation.toNumber(),
        },
        items: summaryItems,
      };
    });
  }

  async getStockMovement(
    query: QueryStockMovementReportDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      if (!query.itemId) {
        const fromDate = query.fromDate
          ? new Date(query.fromDate)
          : new Date("2020-01-01");
        const toDate = query.toDate ? new Date(query.toDate) : new Date();

        const periodTx = await tx.stockTransaction.findMany({
          where: {
            companyId: tenant.companyId,
            ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
            transactionDate: { gte: fromDate, lte: toDate },
          },
          include: {
            item: {
              select: { id: true, name: true, sku: true, primaryUom: true },
            },
            warehouse: { select: { name: true } },
          },
          orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
          take: 100,
        });

        return {
          openingStock: 0,
          openingValuation: 0,
          closingStock: 0,
          totalInward: 0,
          totalOutward: 0,
          transactions: periodTx.map((t) => ({
            id: t.id,
            date: t.transactionDate,
            docType: t.referenceDocType,
            docId: t.referenceDocId,
            warehouse: t.warehouse?.name || "Main Godown",
            item: t.item?.name || "Item",
            quantity: Number(t.quantity),
            rate: Number(t.valuationRate),
            valuation: Number(t.totalValuation),
          })),
        };
      }

      const item = await tx.item.findUnique({
        where: { id: query.itemId },
        include: { primaryUom: true },
      });

      if (!item || item.companyId !== tenant.companyId) {
        throw new NotFoundException(`Item with ID ${query.itemId} not found.`);
      }

      const fromDate = query.fromDate
        ? new Date(query.fromDate)
        : new Date("2020-01-01");
      const toDate = query.toDate ? new Date(query.toDate) : new Date();

      // Opening stock prior to fromDate
      const priorTx = await tx.stockTransaction.findMany({
        where: {
          itemId: item.id,
          companyId: tenant.companyId,
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
          transactionDate: { lt: fromDate },
        },
        select: {
          quantity: true,
          totalValuation: true,
        },
      });

      let openingQty = new Decimal(0);
      let openingVal = new Decimal(0);
      for (const pt of priorTx) {
        openingQty = openingQty.plus(toDecimal(pt.quantity));
        openingVal = openingVal.plus(toMoney(pt.totalValuation));
      }

      // Period transactions
      const periodTx = await tx.stockTransaction.findMany({
        where: {
          itemId: item.id,
          companyId: tenant.companyId,
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
          transactionDate: { gte: fromDate, lte: toDate },
        },
        include: {
          warehouse: { select: { name: true } },
        },
        orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
      });

      let runningQty = openingQty;
      let totalIn = new Decimal(0);
      let totalOut = new Decimal(0);

      const items = periodTx.map((tx) => {
        const qty = toDecimal(tx.quantity);
        runningQty = runningQty.plus(qty);

        if (qty.isPositive()) {
          totalIn = totalIn.plus(qty);
        } else {
          totalOut = totalOut.plus(qty.abs());
        }

        return {
          id: tx.id,
          date: tx.transactionDate.toISOString().split("T")[0],
          transactionType: tx.transactionType,
          referenceDocType: tx.referenceDocType,
          referenceDocId: tx.referenceDocId,
          warehouseName: tx.warehouse.name,
          inQuantity: qty.isPositive() ? qty.toFixed(4) : "0.0000",
          outQuantity: qty.isNegative() ? qty.abs().toFixed(4) : "0.0000",
          runningQuantity: runningQty.toFixed(4),
          valuationRate: toDecimal(tx.valuationRate).toFixed(4),
          totalValuation: toMoney(tx.totalValuation).toFixed(2),
        };
      });

      return {
        item: {
          id: item.id,
          name: item.name,
          sku: item.sku,
          uomSymbol: item.primaryUom.symbol,
        },
        period: {
          fromDate: fromDate.toISOString().split("T")[0],
          toDate: toDate.toISOString().split("T")[0],
        },
        openingQuantity: openingQty.toFixed(4),
        totalIn: totalIn.toFixed(4),
        totalOut: totalOut.toFixed(4),
        closingQuantity: runningQty.toFixed(4),
        transactions: items,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 12. GSTR-1 SUMMARY & RETURN PREPARATION DATA
  // --------------------------------------------------------------------------
  async getGstr1Report(
    query: QueryGstr1ReportDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: tenant.companyId },
      });
      if (!company) {
        throw new NotFoundException(`Company ${tenant.companyId} not found.`);
      }

      const where: any = {
        companyId: tenant.companyId,
        status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
        category: InvoiceCategory.TAX_INVOICE,
      };

      if (query.financialYearId) {
        where.financialYearId = query.financialYearId;
      }

      const period = resolveReportPeriod(query);
      if (period.from || period.to || query.fromDate || query.toDate) {
        const from = period.from || query.fromDate;
        const to = period.to || query.toDate;
        where.invoiceDate = {};
        if (from) where.invoiceDate.gte = new Date(`${from}T00:00:00.000Z`);
        if (to) where.invoiceDate.lte = new Date(`${to}T23:59:59.999Z`);
      }

      const invoices = await tx.salesInvoice.findMany({
        where,
        include: {
          party: true,
          items: true,
        },
        orderBy: { invoiceDate: "asc" },
      });

      // Also get cancelled count for Document Summary (Table 13)
      const cancelledCount = await tx.salesInvoice.count({
        where: {
          companyId: tenant.companyId,
          status: InvoiceStatus.CANCELLED,
          category: InvoiceCategory.TAX_INVOICE,
          ...(where.invoiceDate ? { invoiceDate: where.invoiceDate } : {}),
        },
      });

      const salesReturns = await tx.salesReturn.findMany({
        where: {
          companyId: tenant.companyId,
          status: "ISSUED",
          ...(where.invoiceDate ? { returnDate: where.invoiceDate } : {}),
        },
        include: {
          party: true,
          items: { include: { item: true } },
          salesInvoice: true,
        },
      });
      const debitNotes = await tx.outwardDebitNote.findMany({
        where: {
          companyId: tenant.companyId,
          ...(where.invoiceDate ? { noteDate: where.invoiceDate } : {}),
        },
        include: { party: true, items: true, salesInvoice: true },
      });
      const advances = await tx.advanceReceipt.findMany({
        where: {
          companyId: tenant.companyId,
          ...(where.invoiceDate ? { receiptDate: where.invoiceDate } : {}),
        },
      });

      const toDoc = (inv: any) => ({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
        grandTotal: inv.grandTotal.toString(),
        taxableAmount: inv.taxableAmount.toString(),
        cgstAmount: inv.cgstAmount.toString(),
        sgstAmount: inv.sgstAmount.toString(),
        utgstAmount: (inv.utgstAmount ?? 0).toString(),
        igstAmount: inv.igstAmount.toString(),
        cessAmount: inv.cessAmount.toString(),
        roundOff: inv.roundOff.toString(),
        placeOfSupply: inv.placeOfSupply,
        isReverseCharge: inv.isReverseCharge,
        partyGstin: inv.party?.gstin ?? null,
        items: inv.items.map((item: any) => ({
          hsnCode: item.hsnCode || item.item?.hsnCode || "999999",
          description: item.description,
          quantity: item.quantity.toString(),
          taxableAmount: item.taxableAmount.toString(),
          taxRate: item.taxRate.toString(),
          cgstAmount: item.cgstAmount.toString(),
          sgstAmount: item.sgstAmount.toString(),
          utgstAmount: (item.utgstAmount ?? 0).toString(),
          igstAmount: item.igstAmount.toString(),
          cessAmount: (item.cessAmount ?? 0).toString(),
          totalAmount: item.totalAmount.toString(),
          supplyCategory: item.supplyCategory || "TAXABLE",
        })),
      });

      const prepared = buildGstr1({
        companyStateCode: company.stateCode,
        invoices: invoices.map(toDoc),
        creditNotes: salesReturns.map((note) => ({
          ...toDoc({
            ...note,
            invoiceNumber:
              note.salesInvoice?.invoiceNumber || note.returnNumber,
            invoiceDate: note.returnDate,
            grandTotal: note.grandTotal,
            cessAmount: 0,
            roundOff: 0,
            placeOfSupply:
              note.salesInvoice?.placeOfSupply || company.stateCode,
            isReverseCharge: note.salesInvoice?.isReverseCharge ?? false,
          }),
          noteNumber: note.returnNumber,
          noteDate: note.returnDate.toISOString().slice(0, 10),
          originalInvoiceNumber: note.salesInvoice?.invoiceNumber,
          originalInvoiceDate: note.salesInvoice?.invoiceDate
            ? note.salesInvoice.invoiceDate.toISOString().slice(0, 10)
            : undefined,
          noteType: "C" as const,
        })),
        debitNotes: debitNotes.map((note) => ({
          ...toDoc({
            ...note,
            invoiceNumber: note.salesInvoice?.invoiceNumber || note.noteNumber,
            invoiceDate: note.noteDate,
            cessAmount: 0,
            roundOff: 0,
            isReverseCharge: false,
          }),
          noteNumber: note.noteNumber,
          noteDate: note.noteDate.toISOString().slice(0, 10),
          originalInvoiceNumber: note.salesInvoice?.invoiceNumber,
          originalInvoiceDate: note.salesInvoice?.invoiceDate
            ? note.salesInvoice.invoiceDate.toISOString().slice(0, 10)
            : undefined,
          noteType: "D" as const,
        })),
        advances: advances.map((advance) => ({
          receiptNumber: advance.receiptNumber,
          receiptDate: advance.receiptDate.toISOString().slice(0, 10),
          supplyKind: advance.supplyKind,
          placeOfSupply: advance.placeOfSupply,
          taxableAmount: advance.taxableAmount.toString(),
          cgstAmount: advance.cgstAmount.toString(),
          sgstAmount: advance.sgstAmount.toString(),
          utgstAmount: advance.utgstAmount.toString(),
          igstAmount: advance.igstAmount.toString(),
          adjustedTaxable: advance.adjustedTaxable.toString(),
        })),
        period: query,
      });

      // Build individual invoice rows itemized by tax rate (matching statutory GST & billing software format)
      const salesInvoicesList: any[] = [];
      for (const inv of invoices) {
        const stateInfo = resolveGstState(
          inv.placeOfSupply,
          inv.party?.gstin,
          company.stateCode,
        );
        const partyGstin = inv.party?.gstin || "";
        const customerName = inv.party?.name || "Cash Customer";
        const invDateStr = inv.invoiceDate
          ? new Date(inv.invoiceDate).toISOString().slice(0, 10)
          : "";
        const invValue = Number(inv.grandTotal);

        if (!inv.items || inv.items.length === 0) {
          salesInvoicesList.push({
            id: inv.id,
            invoiceId: inv.id,
            gstin: partyGstin,
            customerName,
            stateCode: stateInfo.stateCode,
            stateName: stateInfo.stateName,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: invDateStr,
            invoiceValue: invValue,
            taxRate: 0,
            taxableValue: Number(inv.taxableAmount),
            cgst: Number(inv.cgstAmount),
            sgst: Number(inv.sgstAmount ?? inv.utgstAmount ?? 0),
            igst: Number(inv.igstAmount),
            cess: Number(inv.cessAmount ?? 0),
            invoiceType: partyGstin
              ? "B2B"
              : invValue > 250000 && stateInfo.stateCode !== company.stateCode
                ? "B2CL"
                : "B2CS",
          });
        } else {
          // Group items by taxRate
          const rateMap = new Map<
            number,
            {
              taxable: number;
              cgst: number;
              sgst: number;
              igst: number;
              cess: number;
            }
          >();
          for (const it of inv.items) {
            const r = Number(it.taxRate ?? 0);
            const curr = rateMap.get(r) || {
              taxable: 0,
              cgst: 0,
              sgst: 0,
              igst: 0,
              cess: 0,
            };
            curr.taxable += Number(it.taxableAmount ?? 0);
            curr.cgst += Number(it.cgstAmount ?? 0);
            curr.sgst += Number(it.sgstAmount ?? it.utgstAmount ?? 0);
            curr.igst += Number(it.igstAmount ?? 0);
            curr.cess += Number(it.cessAmount ?? 0);
            rateMap.set(r, curr);
          }

          for (const [rate, vals] of rateMap.entries()) {
            salesInvoicesList.push({
              id: `${inv.id}-${rate}`,
              invoiceId: inv.id,
              gstin: partyGstin,
              customerName,
              stateCode: stateInfo.stateCode,
              stateName: stateInfo.stateName,
              invoiceNumber: inv.invoiceNumber,
              invoiceDate: invDateStr,
              invoiceValue: invValue,
              taxRate: rate,
              taxableValue: Number(vals.taxable.toFixed(2)),
              cgst: Number(vals.cgst.toFixed(2)),
              sgst: Number(vals.sgst.toFixed(2)),
              igst: Number(vals.igst.toFixed(2)),
              cess: Number(vals.cess.toFixed(2)),
              invoiceType: partyGstin
                ? "B2B"
                : invValue > 250000 && stateInfo.stateCode !== company.stateCode
                  ? "B2CL"
                  : "B2CS",
            });
          }
        }
      }

      // Build Credit Notes (Sales Returns)
      const creditNotesList: any[] = [];
      for (const note of salesReturns) {
        const stateInfo = resolveGstState(
          note.salesInvoice?.placeOfSupply,
          note.party?.gstin,
          company.stateCode,
        );
        const partyGstin = note.party?.gstin || "";
        const customerName = note.party?.name || "Cash Customer";
        const noteDateStr = note.returnDate
          ? new Date(note.returnDate).toISOString().slice(0, 10)
          : "";
        const noteVal = Number(note.grandTotal);
        const taxableVal = Number(note.taxableAmount);
        const cgstVal = Number(note.cgstAmount);
        const sgstVal = Number(note.sgstAmount ?? note.utgstAmount ?? 0);
        const igstVal = Number(note.igstAmount);
        const taxRate =
          taxableVal > 0
            ? Math.round(((cgstVal + sgstVal + igstVal) / taxableVal) * 100)
            : 0;

        creditNotesList.push({
          id: note.id,
          gstin: partyGstin,
          customerName,
          stateCode: stateInfo.stateCode,
          stateName: stateInfo.stateName,
          noteNumber: note.returnNumber,
          noteDate: noteDateStr,
          originalInvoiceNumber: note.salesInvoice?.invoiceNumber || "—",
          noteValue: noteVal,
          taxRate,
          taxableValue: taxableVal,
          cgst: cgstVal,
          sgst: sgstVal,
          igst: igstVal,
          cess: 0,
          noteType: "Credit Note",
        });
      }

      // Build Debit Notes (Outward Debit Notes / Purchase Returns)
      const debitNotesList: any[] = [];
      for (const note of debitNotes) {
        const stateInfo = resolveGstState(
          note.placeOfSupply,
          note.party?.gstin,
          company.stateCode,
        );
        const partyGstin = note.party?.gstin || "";
        const customerName = note.party?.name || "Supplier / Party";
        const noteDateStr = note.noteDate
          ? new Date(note.noteDate).toISOString().slice(0, 10)
          : "";
        const noteVal = Number(note.grandTotal);
        const taxableVal = Number(note.taxableAmount);
        const cgstVal = Number(note.cgstAmount);
        const sgstVal = Number(note.sgstAmount ?? note.utgstAmount ?? 0);
        const igstVal = Number(note.igstAmount);
        const taxRate =
          taxableVal > 0
            ? Math.round(((cgstVal + sgstVal + igstVal) / taxableVal) * 100)
            : 0;

        debitNotesList.push({
          id: note.id,
          gstin: partyGstin,
          customerName,
          supplierName: customerName,
          stateCode: stateInfo.stateCode,
          stateName: stateInfo.stateName,
          noteNumber: note.noteNumber,
          noteDate: noteDateStr,
          originalInvoiceNumber: note.salesInvoice?.invoiceNumber || "—",
          noteValue: noteVal,
          taxRate,
          taxableValue: taxableVal,
          cgst: cgstVal,
          sgst: sgstVal,
          igst: igstVal,
          cess: 0,
          noteType: "Debit Note",
        });
      }

      // Statutory Government Portal JSON Payload (per GST Offline Tool schema)
      const jsonPayload = {
        gstin: company.gstin || "",
        fp:
          query.financialYearId ||
          (query.fromDate
            ? query.fromDate.slice(5, 7) + query.fromDate.slice(0, 4)
            : ""),
        gt: Number(prepared.grossTurnover || 0),
        cur_gt: Number(prepared.grossTurnover || 0),
        b2b: prepared.b2b || [],
        b2cl: prepared.b2cl || [],
        b2cs: prepared.b2cs || [],
        cdnr: prepared.cdnr || [],
        cdnur: prepared.cdnur || [],
        exp: [],
        nil: prepared.nil || { inv: [] },
        hsn: prepared.hsn || { data: [] },
        doc_issue: {
          doc_det: [
            {
              doc_num: 1,
              doc_typ: "Invoices for outward supply",
              from: invoices[0]?.invoiceNumber || "1",
              to: invoices[invoices.length - 1]?.invoiceNumber || "1",
              totnum: invoices.length,
              canc: cancelledCount,
              net_issue: invoices.length,
            },
          ],
        },
      };

      return {
        disclaimer:
          "Statutory Notice: This summary compiles return preparation data per Section 37 of CGST Act. Direct JSON filing requires GSP integration. filingStatus NOT_FILED means this system has not received a filing acknowledgement.",
        filingStatus: prepared.filingStatus,
        gstin: company.gstin || "UNREGISTERED",
        companyName: company.tradeName,
        grossTurnover: prepared.grossTurnover,
        totalTaxable: prepared.totalTaxable,
        totalCgst: prepared.totalCgst,
        totalSgst: prepared.totalSgst,
        totalUtgst: prepared.totalUtgst,
        totalIgst: prepared.totalIgst,
        totalCess: prepared.totalCess,
        totalRoundOff: prepared.totalRoundOff,
        b2b: prepared.b2b,
        b2cl: prepared.b2cl,
        b2cs: prepared.b2cs,
        nil: prepared.nil,
        cdnr: prepared.cdnr,
        cdnur: prepared.cdnur,
        hsn: prepared.hsn,
        table11Advances: prepared.table11Advances,
        statutoryAssumptions: prepared.statutoryAssumptions,
        docSummary: {
          fromInvoice: invoices[0]?.invoiceNumber || "N/A",
          toInvoice: invoices[invoices.length - 1]?.invoiceNumber || "N/A",
          totalIssued: invoices.length,
          cancelledCount,
          netValidCount: invoices.length,
          totalCreditNotes: salesReturns.length,
        },
        summary: {
          totalInvoices: invoices.length,
          totalSalesRows: salesInvoicesList.length,
          grossTurnover: prepared.grossTurnover,
          totalTaxable: prepared.totalTaxable,
          totalCgst: prepared.totalCgst,
          totalSgst: prepared.totalSgst,
          totalIgst: prepared.totalIgst,
          totalTax: (
            Number(prepared.totalCgst || 0) +
            Number(prepared.totalSgst || 0) +
            Number(prepared.totalIgst || 0) +
            Number(prepared.totalCess || 0)
          ).toFixed(2),
          totalCreditNotes: creditNotesList.length,
          totalDebitNotes: debitNotesList.length,
        },
        salesInvoices: salesInvoicesList,
        creditNotes: creditNotesList,
        debitNotes: debitNotesList,
        jsonPayload,
      };
    });
  }

  // 13. Cash Flow Statement (Direct Method)
  async getCashFlow(
    query: QueryFinancialStatementDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: tenant.companyId },
      });
      if (!company) {
        throw new NotFoundException(`Company ${tenant.companyId} not found.`);
      }

      let fromDate: Date | null = query.fromDate
        ? new Date(query.fromDate)
        : null;
      let toDate: Date | null = query.toDate ? new Date(query.toDate) : null;

      if (!fromDate && !toDate && query.financialYearId) {
        const fy = await tx.financialYear.findUnique({
          where: { id: query.financialYearId },
        });
        if (fy) {
          fromDate = new Date(fy.startDate);
          toDate = new Date(fy.endDate);
        }
      }

      // 1. Identify all Cash & Bank Accounts
      const cashBankAccounts = await tx.ledgerAccount.findMany({
        where: {
          companyId: tenant.companyId,
          OR: [{ isCashLedger: true }, { isBankLedger: true }],
        },
        select: {
          id: true,
          name: true,
          code: true,
          isCashLedger: true,
          isBankLedger: true,
          openingBalance: true,
        },
      });

      const cashBankIds = new Set(cashBankAccounts.map((a) => a.id));

      // 2. Compute Opening Cash & Bank Balance before fromDate
      let openingCash = new Decimal(0);
      for (const acc of cashBankAccounts) {
        openingCash = openingCash.plus(toMoney(acc.openingBalance));
      }

      if (fromDate) {
        const preEntries = await tx.journalEntry.findMany({
          where: {
            accountId: { in: Array.from(cashBankIds) },
            voucher: {
              companyId: tenant.companyId,
              voucherDate: { lt: fromDate },
            },
          },
          select: {
            debitAmount: true,
            creditAmount: true,
          },
        });
        for (const pe of preEntries) {
          openingCash = openingCash
            .plus(toMoney(pe.debitAmount))
            .minus(toMoney(pe.creditAmount));
        }
      }

      // 3. Query all Vouchers affecting Cash/Bank in the period
      const voucherWhere: any = {
        companyId: tenant.companyId,
        journalEntries: {
          some: {
            accountId: { in: Array.from(cashBankIds) },
          },
        },
      };

      if (fromDate || toDate) {
        voucherWhere.voucherDate = {};
        if (fromDate) voucherWhere.voucherDate.gte = fromDate;
        if (toDate) voucherWhere.voucherDate.lte = toDate;
      }

      const vouchers = await tx.voucher.findMany({
        where: voucherWhere,
        include: {
          journalEntries: {
            include: {
              account: {
                include: {
                  group: true,
                },
              },
            },
          },
        },
        orderBy: { voucherDate: "asc" },
      });

      let receiptsFromCustomers = new Decimal(0);
      let cashSales = new Decimal(0);
      let otherOperatingInflows = new Decimal(0);

      let paymentsToSuppliers = new Decimal(0);
      let cashPurchases = new Decimal(0);
      let operatingExpenses = new Decimal(0);
      let otherOperatingOutflows = new Decimal(0);

      let investingInflows = new Decimal(0);
      let investingOutflows = new Decimal(0);

      let financingInflows = new Decimal(0);
      let financingOutflows = new Decimal(0);

      for (const v of vouchers) {
        let voucherNetCash = new Decimal(0);
        for (const je of v.journalEntries) {
          if (cashBankIds.has(je.accountId)) {
            voucherNetCash = voucherNetCash
              .plus(toMoney(je.debitAmount))
              .minus(toMoney(je.creditAmount));
          }
        }

        // If net cash is zero, it's an internal transfer (contra)
        if (voucherNetCash.isZero()) {
          continue;
        }

        const opposingLines = v.journalEntries.filter(
          (je) => !cashBankIds.has(je.accountId),
        );

        if (voucherNetCash.greaterThan(0)) {
          const inflowAmt = voucherNetCash;
          if (v.voucherType === VoucherType.RECEIPT) {
            receiptsFromCustomers = receiptsFromCustomers.plus(inflowAmt);
          } else if (v.voucherType === VoucherType.SALES) {
            cashSales = cashSales.plus(inflowAmt);
          } else {
            const hasCapital = opposingLines.some(
              (l) =>
                l.account.group.nature === AccountNature.EQUITY ||
                l.account.group.nature === AccountNature.LIABILITY,
            );
            const hasAsset = opposingLines.some(
              (l) => l.account.group.nature === AccountNature.ASSET,
            );
            if (hasCapital) {
              financingInflows = financingInflows.plus(inflowAmt);
            } else if (hasAsset) {
              investingInflows = investingInflows.plus(inflowAmt);
            } else {
              otherOperatingInflows = otherOperatingInflows.plus(inflowAmt);
            }
          }
        } else {
          const outflowAmt = voucherNetCash.abs();
          if (v.voucherType === VoucherType.PAYMENT) {
            paymentsToSuppliers = paymentsToSuppliers.plus(outflowAmt);
          } else if (v.voucherType === VoucherType.PURCHASE) {
            cashPurchases = cashPurchases.plus(outflowAmt);
          } else {
            const hasExpense = opposingLines.some(
              (l) => l.account.group.nature === AccountNature.EXPENSE,
            );
            const hasAsset = opposingLines.some(
              (l) => l.account.group.nature === AccountNature.ASSET,
            );
            const hasCapital = opposingLines.some(
              (l) =>
                l.account.group.nature === AccountNature.EQUITY ||
                l.account.group.nature === AccountNature.LIABILITY,
            );

            if (hasExpense) {
              operatingExpenses = operatingExpenses.plus(outflowAmt);
            } else if (hasAsset) {
              investingOutflows = investingOutflows.plus(outflowAmt);
            } else if (hasCapital) {
              financingOutflows = financingOutflows.plus(outflowAmt);
            } else {
              otherOperatingOutflows = otherOperatingOutflows.plus(outflowAmt);
            }
          }
        }
      }

      const totalOperatingInflow = receiptsFromCustomers
        .plus(cashSales)
        .plus(otherOperatingInflows);
      const totalOperatingOutflow = paymentsToSuppliers
        .plus(cashPurchases)
        .plus(operatingExpenses)
        .plus(otherOperatingOutflows);
      const netOperatingCashFlow = totalOperatingInflow.minus(
        totalOperatingOutflow,
      );

      const netInvestingCashFlow = investingInflows.minus(investingOutflows);
      const netFinancingCashFlow = financingInflows.minus(financingOutflows);

      const netChangeInCash = netOperatingCashFlow
        .plus(netInvestingCashFlow)
        .plus(netFinancingCashFlow);
      const closingCash = openingCash.plus(netChangeInCash);

      return {
        companyName: company.tradeName,
        fromDate: fromDate ? fromDate.toISOString().split("T")[0] : null,
        toDate: toDate ? toDate.toISOString().split("T")[0] : null,
        openingCashAndBank: openingCash.toFixed(2),
        operatingActivities: {
          inflows: {
            receiptsFromCustomers: receiptsFromCustomers.toFixed(2),
            cashSales: cashSales.toFixed(2),
            otherOperatingInflows: otherOperatingInflows.toFixed(2),
            totalInflows: totalOperatingInflow.toFixed(2),
          },
          outflows: {
            paymentsToSuppliers: paymentsToSuppliers.toFixed(2),
            cashPurchases: cashPurchases.toFixed(2),
            operatingExpenses: operatingExpenses.toFixed(2),
            otherOperatingOutflows: otherOperatingOutflows.toFixed(2),
            totalOutflows: totalOperatingOutflow.toFixed(2),
          },
          netOperatingCashFlow: netOperatingCashFlow.toFixed(2),
        },
        investingActivities: {
          inflows: investingInflows.toFixed(2),
          outflows: investingOutflows.toFixed(2),
          netInvestingCashFlow: netInvestingCashFlow.toFixed(2),
        },
        financingActivities: {
          inflows: financingInflows.toFixed(2),
          outflows: financingOutflows.toFixed(2),
          netFinancingCashFlow: netFinancingCashFlow.toFixed(2),
        },
        netChangeInCashAndBank: netChangeInCash.toFixed(2),
        closingCashAndBank: closingCash.toFixed(2),
      };
    });
  }

  // 14. GSTR-3B Return Summary (Table 3.1, 4, 6.1)
  async getGstr3bReport(
    query: QueryFinancialStatementDto,
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: tenant.companyId },
      });
      if (!company) {
        throw new NotFoundException(`Company ${tenant.companyId} not found.`);
      }

      const period = resolveReportPeriod(query);
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (period.from)
        dateFilter.gte = new Date(`${period.from}T00:00:00.000Z`);
      if (period.to) dateFilter.lte = new Date(`${period.to}T23:59:59.999Z`);
      const hasDate = Boolean(period.from || period.to);

      const salesInvoices = await tx.salesInvoice.findMany({
        where: {
          companyId: tenant.companyId,
          status: { notIn: [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED] },
          category: InvoiceCategory.TAX_INVOICE,
          ...(hasDate ? { invoiceDate: dateFilter } : {}),
        },
        include: { party: true, items: true },
      });
      const salesReturns = await tx.salesReturn.findMany({
        where: {
          companyId: tenant.companyId,
          status: "ISSUED",
          ...(hasDate ? { returnDate: dateFilter } : {}),
        },
        include: {
          party: true,
          items: { include: { item: true } },
          salesInvoice: true,
        },
      });
      const purchaseInvoices = await tx.purchaseInvoice.findMany({
        where: {
          companyId: tenant.companyId,
          ...(hasDate ? { invoiceDate: dateFilter } : {}),
        },
      });
      const purchaseReturns = await tx.purchaseReturn.findMany({
        where: {
          companyId: tenant.companyId,
          ...(hasDate ? { returnDate: dateFilter } : {}),
        },
        include: { purchaseInvoice: true },
      });
      const accepted = await tx.gstr2bReconciliation.findMany({
        where: {
          companyId: tenant.companyId,
          itcDecision: "ACCEPTED",
          ...(period.from && period.to
            ? {
                returnPeriod: `${period.from.slice(5, 7)}${period.from.slice(0, 4)}`,
              }
            : {}),
        },
      });

      const toSales = (inv: any) => ({
        invoiceNumber: inv.invoiceNumber || inv.returnNumber,
        invoiceDate: (inv.invoiceDate || inv.returnDate)
          .toISOString()
          .slice(0, 10),
        grandTotal: inv.grandTotal.toString(),
        taxableAmount: inv.taxableAmount.toString(),
        cgstAmount: inv.cgstAmount.toString(),
        sgstAmount: inv.sgstAmount.toString(),
        utgstAmount: (inv.utgstAmount ?? 0).toString(),
        igstAmount: inv.igstAmount.toString(),
        cessAmount: (inv.cessAmount ?? 0).toString(),
        roundOff: (inv.roundOff ?? 0).toString(),
        placeOfSupply:
          inv.placeOfSupply ||
          inv.salesInvoice?.placeOfSupply ||
          company.stateCode,
        isReverseCharge:
          inv.isReverseCharge ?? inv.salesInvoice?.isReverseCharge ?? false,
        partyGstin: inv.party?.gstin ?? null,
        items: (inv.items || []).map((item: any) => ({
          hsnCode: item.hsnCode || item.item?.hsnCode || "999999",
          quantity: item.quantity.toString(),
          taxableAmount: item.taxableAmount.toString(),
          taxRate: item.taxRate.toString(),
          cgstAmount: item.cgstAmount.toString(),
          sgstAmount: item.sgstAmount.toString(),
          utgstAmount: (item.utgstAmount ?? 0).toString(),
          igstAmount: item.igstAmount.toString(),
          supplyCategory: item.supplyCategory || "TAXABLE",
          cessAmount: (item.cessAmount ?? 0).toString(),
          totalAmount: item.totalAmount.toString(),
        })),
      });

      const prepared = buildGstr3b({
        invoices: salesInvoices.map(toSales),
        creditNotes: salesReturns.map((note) => ({
          ...toSales(note),
          noteNumber: note.returnNumber,
          noteDate: note.returnDate.toISOString().slice(0, 10),
          noteType: "C" as const,
        })),
        debitNotes: (
          await tx.outwardDebitNote.findMany({
            where: {
              companyId: tenant.companyId,
              ...(hasDate ? { noteDate: dateFilter } : {}),
            },
            include: { party: true, items: true, salesInvoice: true },
          })
        ).map((note) => ({
          ...toSales({
            ...note,
            invoiceNumber: note.noteNumber,
            invoiceDate: note.noteDate,
            cessAmount: 0,
            roundOff: 0,
            placeOfSupply: note.placeOfSupply,
            isReverseCharge: false,
          }),
          noteNumber: note.noteNumber,
          noteDate: note.noteDate.toISOString().slice(0, 10),
          noteType: "D" as const,
        })),
        purchases: purchaseInvoices.map((invoice) => ({
          id: invoice.id,
          invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
          taxableAmount: invoice.taxableAmount.toString(),
          cgstAmount: invoice.cgstAmount.toString(),
          sgstAmount: invoice.sgstAmount.toString(),
          utgstAmount: invoice.utgstAmount.toString(),
          igstAmount: invoice.igstAmount.toString(),
          cessAmount: invoice.cessAmount.toString(),
          itcEligibility: invoice.itcEligibility,
        })),
        purchaseReturns: purchaseReturns.map((invoice) => ({
          id: invoice.id,
          invoiceDate: invoice.returnDate.toISOString().slice(0, 10),
          taxableAmount: invoice.taxableAmount.toString(),
          cgstAmount: invoice.cgstAmount.toString(),
          sgstAmount: invoice.sgstAmount.toString(),
          utgstAmount: (invoice.utgstAmount ?? 0).toString(),
          igstAmount: invoice.igstAmount.toString(),
          itcEligibility: invoice.purchaseInvoice?.itcEligibility || "INPUT",
        })),
        acceptedPurchaseIds: accepted
          .map((row) => row.purchaseInvoiceId)
          .filter(Boolean) as string[],
        acceptedReturnIds: accepted
          .map((row) => row.purchaseReturnId)
          .filter(Boolean) as string[],
        period: query,
      });

      const ledgerTieOut = await this.compareOutputTaxLedgers(
        tx,
        tenant.companyId,
        dateFilter,
        prepared.sourceDocumentNet,
      );

      return {
        companyName: company.tradeName,
        gstin: company.gstin || "UNREGISTERED",
        fromDate: period.from ?? null,
        toDate: period.to ?? null,
        filingStatus: prepared.filingStatus,
        claimPolicy: prepared.claimPolicy,
        table3_1_outwardSupplies: prepared.table3_1_outwardSupplies,
        table3_1_nilRated: prepared.table3_1_nilRated,
        table3_1_exempt: prepared.table3_1_exempt,
        table3_1_nonGst: prepared.table3_1_nonGst,
        table3_1_reverseChargeOutward: prepared.table3_1_reverseChargeOutward,
        table3_1_inwardReverseCharge: prepared.table3_1_inwardReverseCharge,
        sourceDocumentNet: prepared.sourceDocumentNet,
        ledgerTieOut,
        table4_eligibleItc: prepared.table4_eligibleItc,
        table6_itcUtilization: prepared.table6_itcUtilization,
        table6_1_paymentOfTax: prepared.table6_1_paymentOfTax,
        statutoryAssumptions: prepared.statutoryAssumptions,
      };
    });
  }

  private async compareOutputTaxLedgers(
    tx: any,
    companyId: string,
    dateFilter: { gte?: Date; lte?: Date },
    sourceNet: { cgst: string; sgst: string; igst: string },
  ) {
    const names = [
      ["Output CGST", "cgst"],
      ["Output SGST", "sgst"],
      ["Output IGST", "igst"],
    ] as const;
    const components: Record<
      string,
      { ledgerNet: string; documentNet: string; variance: string }
    > = {};
    for (const [name, key] of names) {
      const accounts = await tx.ledgerAccount.findMany({
        where: { companyId, name: { startsWith: name } },
        select: { id: true },
      });
      const entries = accounts.length
        ? await tx.journalEntry.findMany({
            where: {
              accountId: {
                in: accounts.map((account: { id: string }) => account.id),
              },
              voucher: {
                companyId,
                isCancelled: false,
                ...(dateFilter.gte || dateFilter.lte
                  ? { voucherDate: dateFilter }
                  : {}),
              },
            },
            select: { debitAmount: true, creditAmount: true },
          })
        : [];
      let net = new Decimal(0);
      for (const entry of entries) {
        net = net
          .plus(toMoney(entry.creditAmount))
          .minus(toMoney(entry.debitAmount));
      }
      const documentNet = new Decimal((sourceNet as any)[key]);
      components[key] = {
        ledgerNet: net.toFixed(2),
        documentNet: documentNet.toFixed(2),
        variance: net.minus(documentNet).toFixed(2),
      };
    }
    return {
      basis:
        "Output tax ledgers are credit-normal. Document net is non-cancelled tax invoices minus issued credit notes, including nil and reverse-charge rows.",
      components,
    };
  }

  // --------------------------------------------------------------------------
  // 15. BILL WISE PROFIT & MARGIN REPORT
  // --------------------------------------------------------------------------
  async getBillWiseProfit(
    query: {
      fromDate?: string;
      toDate?: string;
      startDate?: string;
      endDate?: string;
    },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const fromDate = query.fromDate || query.startDate;
      const toDate = query.toDate || query.endDate;
      const where: any = {
        companyId: tenant.companyId,
        status: { not: InvoiceStatus.CANCELLED },
      };
      if (fromDate || toDate) {
        where.invoiceDate = {};
        if (fromDate) where.invoiceDate.gte = parseStartOfDay(fromDate);
        if (toDate) where.invoiceDate.lte = parseEndOfDay(toDate);
      }

      const invoices = await tx.salesInvoice.findMany({
        where,
        include: {
          party: { select: { name: true, nameGujarati: true, phone: true } },
          items: {
            include: {
              item: {
                select: { purchaseRate: true, retailPrice: true, name: true },
              },
            },
          },
        },
        orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      });

      let totalRevenue = new Decimal(0);
      let totalCogs = new Decimal(0);
      let totalGrossProfit = new Decimal(0);

      const items = invoices.map((inv) => {
        const invTotal = toMoney(inv.grandTotal);
        let cogs = new Decimal(0);
        for (const it of inv.items) {
          const qty = toMoney(it.quantity);
          const cost = toMoney(it.item?.purchaseRate || 0);
          cogs = cogs.plus(qty.times(cost));
        }
        const grossProfit = invTotal.minus(cogs);
        const marginPct = invTotal.gt(0)
          ? grossProfit.dividedBy(invTotal).times(100).toFixed(2)
          : "0.00";

        totalRevenue = totalRevenue.plus(invTotal);
        totalCogs = totalCogs.plus(cogs);
        totalGrossProfit = totalGrossProfit.plus(grossProfit);

        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
          partyName: inv.party?.name || "Cash Customer",
          partyNameGujarati: inv.party?.nameGujarati,
          partyPhone: inv.party?.phone,
          status: inv.status,
          taxableAmount: toMoney(inv.taxableAmount).toFixed(2),
          invoiceTotal: invTotal.toFixed(2),
          costOfGoodsSold: cogs.toFixed(2),
          grossProfit: grossProfit.toFixed(2),
          marginPercentage: marginPct,
          itemsCount: inv.items.length,
        };
      });

      const avgMarginPct = totalRevenue.gt(0)
        ? totalGrossProfit.dividedBy(totalRevenue).times(100).toFixed(2)
        : "0.00";

      return {
        summary: {
          totalInvoices: invoices.length,
          totalRevenue: totalRevenue.toFixed(2),
          totalCogs: totalCogs.toFixed(2),
          totalGrossProfit: totalGrossProfit.toFixed(2),
          avgMarginPercentage: avgMarginPct,
        },
        invoices: items,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 16. ITEM-WISE SALES REPORT
  // --------------------------------------------------------------------------
  async getItemSalesReport(
    query: {
      fromDate?: string;
      toDate?: string;
      startDate?: string;
      endDate?: string;
    },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const fromDate = query.fromDate || query.startDate;
      const toDate = query.toDate || query.endDate;
      const invWhere: any = {
        companyId: tenant.companyId,
        status: { not: InvoiceStatus.CANCELLED },
      };
      if (fromDate || toDate) {
        invWhere.invoiceDate = {};
        if (fromDate) invWhere.invoiceDate.gte = parseStartOfDay(fromDate);
        if (toDate) invWhere.invoiceDate.lte = parseEndOfDay(toDate);
      }

      const invoiceItems = await tx.salesInvoiceItem.findMany({
        where: { invoice: invWhere },
        include: {
          item: {
            include: {
              category: true,
              primaryUom: true,
            },
          },
          invoice: {
            select: { invoiceDate: true, invoiceNumber: true },
          },
        },
      });

      const map = new Map<string, any>();
      let totalQty = new Decimal(0);
      let totalTaxable = new Decimal(0);
      let totalTax = new Decimal(0);
      let totalSales = new Decimal(0);

      for (const row of invoiceItems) {
        const itemId = row.itemId || row.id;
        const itemName = row.item?.name || (row as any).description || "Item";
        const itemCode = row.item?.sku || row.item?.barcode || "-";
        const hsnCode = row.item?.hsnCode || "-";
        const uom = row.item?.primaryUom?.symbol || "PCS";
        const category = row.item?.category?.name || "General";

        const qty = toMoney(row.quantity);
        const taxable = toMoney(row.taxableAmount);
        const tax = toMoney(row.cgstAmount)
          .plus(toMoney(row.sgstAmount))
          .plus(toMoney(row.igstAmount));
        const total = toMoney((row as any).totalAmount || taxable.plus(tax));

        totalQty = totalQty.plus(qty);
        totalTaxable = totalTaxable.plus(taxable);
        totalTax = totalTax.plus(tax);
        totalSales = totalSales.plus(total);

        if (!map.has(itemId)) {
          map.set(itemId, {
            itemId,
            itemName,
            itemNameGujarati: row.item?.nameGujarati,
            itemCode,
            hsnCode,
            category,
            uom,
            totalQuantity: new Decimal(0),
            totalTaxable: new Decimal(0),
            totalTax: new Decimal(0),
            totalSales: new Decimal(0),
            invoiceCount: 0,
          });
        }

        const entry = map.get(itemId);
        entry.totalQuantity = entry.totalQuantity.plus(qty);
        entry.totalTaxable = entry.totalTaxable.plus(taxable);
        entry.totalTax = entry.totalTax.plus(tax);
        entry.totalSales = entry.totalSales.plus(total);
        entry.invoiceCount += 1;
      }

      const items = Array.from(map.values())
        .map((entry) => ({
          ...entry,
          avgRate: entry.totalQuantity.gt(0)
            ? entry.totalSales.dividedBy(entry.totalQuantity).toFixed(2)
            : "0.00",
          totalQuantity: entry.totalQuantity.toFixed(2),
          totalTaxable: entry.totalTaxable.toFixed(2),
          totalTax: entry.totalTax.toFixed(2),
          totalSales: entry.totalSales.toFixed(2),
        }))
        .sort((a, b) => Number(b.totalSales) - Number(a.totalSales));

      return {
        summary: {
          totalUniqueItems: items.length,
          totalQuantity: totalQty.toFixed(2),
          totalTaxable: totalTaxable.toFixed(2),
          totalTax: totalTax.toFixed(2),
          totalSales: totalSales.toFixed(2),
        },
        items,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 17. PARTY-WISE SALES REPORT
  // --------------------------------------------------------------------------
  async getPartySalesReport(
    query: {
      fromDate?: string;
      toDate?: string;
      startDate?: string;
      endDate?: string;
    },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const fromDate = query.fromDate || query.startDate;
      const toDate = query.toDate || query.endDate;
      const where: any = {
        companyId: tenant.companyId,
        status: { not: InvoiceStatus.CANCELLED },
      };
      if (fromDate || toDate) {
        where.invoiceDate = {};
        if (fromDate) where.invoiceDate.gte = parseStartOfDay(fromDate);
        if (toDate) where.invoiceDate.lte = parseEndOfDay(toDate);
      }

      const invoices = await tx.salesInvoice.findMany({
        where,
        include: {
          party: true,
        },
      });

      const map = new Map<string, any>();
      let totalSales = new Decimal(0);
      let totalPaid = new Decimal(0);
      let totalBalance = new Decimal(0);

      for (const inv of invoices) {
        const partyId = inv.partyId || "cash";
        const partyName = inv.party?.name || "Cash / Direct Customer";
        const partyNameGujarati = inv.party?.nameGujarati;
        const phone = inv.party?.phone || "-";
        const gstin = inv.party?.gstin || "-";

        const grand = toMoney(inv.grandTotal);
        const paid = toMoney(inv.paidAmount);
        const balance = toMoney(inv.balanceAmount);

        totalSales = totalSales.plus(grand);
        totalPaid = totalPaid.plus(paid);
        totalBalance = totalBalance.plus(balance);

        if (!map.has(partyId)) {
          map.set(partyId, {
            partyId,
            partyName,
            partyNameGujarati,
            phone,
            gstin,
            invoiceCount: 0,
            totalSales: new Decimal(0),
            totalPaid: new Decimal(0),
            balanceDue: new Decimal(0),
          });
        }

        const entry = map.get(partyId);
        entry.invoiceCount += 1;
        entry.totalSales = entry.totalSales.plus(grand);
        entry.totalPaid = entry.totalPaid.plus(paid);
        entry.balanceDue = entry.balanceDue.plus(balance);
      }

      const parties = Array.from(map.values())
        .map((e) => ({
          ...e,
          totalSales: e.totalSales.toFixed(2),
          totalPaid: e.totalPaid.toFixed(2),
          balanceDue: e.balanceDue.toFixed(2),
        }))
        .sort((a, b) => Number(b.totalSales) - Number(a.totalSales));

      return {
        summary: {
          totalParties: parties.length,
          totalInvoices: invoices.length,
          totalSales: totalSales.toFixed(2),
          totalPaid: totalPaid.toFixed(2),
          totalBalance: totalBalance.toFixed(2),
        },
        parties,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 18. SALES RETURNS (CREDIT NOTES) REPORT
  // --------------------------------------------------------------------------
  async getSalesReturnsReport(
    query: {
      fromDate?: string;
      toDate?: string;
      startDate?: string;
      endDate?: string;
    },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const fromDate = query.fromDate || query.startDate;
      const toDate = query.toDate || query.endDate;
      const where: any = { companyId: tenant.companyId };
      if (fromDate || toDate) {
        where.returnDate = {};
        if (fromDate) where.returnDate.gte = parseStartOfDay(fromDate);
        if (toDate) where.returnDate.lte = parseEndOfDay(toDate);
      }

      const returns = await tx.salesReturn.findMany({
        where,
        include: {
          party: {
            select: {
              name: true,
              nameGujarati: true,
              phone: true,
              gstin: true,
            },
          },
          items: true,
        },
        orderBy: { returnDate: "desc" },
      });

      let totalTaxable = new Decimal(0);
      let totalTax = new Decimal(0);
      let grandTotal = new Decimal(0);

      const items = returns.map((r) => {
        const taxable = toMoney(r.taxableAmount);
        const tax = toMoney(r.cgstAmount)
          .plus(toMoney(r.sgstAmount))
          .plus(toMoney(r.igstAmount));
        const grand = toMoney(r.grandTotal);

        totalTaxable = totalTaxable.plus(taxable);
        totalTax = totalTax.plus(tax);
        grandTotal = grandTotal.plus(grand);

        return {
          id: r.id,
          creditNoteNumber: r.returnNumber,
          returnDate: r.returnDate.toISOString().slice(0, 10),
          partyName: r.party?.name || "Direct Customer",
          partyNameGujarati: r.party?.nameGujarati,
          phone: r.party?.phone,
          gstin: r.party?.gstin,
          reason: r.reason || "Sales Return",
          taxableAmount: taxable.toFixed(2),
          totalTax: tax.toFixed(2),
          grandTotal: grand.toFixed(2),
          itemsCount: r.items.length,
        };
      });

      return {
        summary: {
          totalReturns: returns.length,
          totalTaxable: totalTaxable.toFixed(2),
          totalTax: totalTax.toFixed(2),
          grandTotal: grandTotal.toFixed(2),
        },
        returns: items,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 19. ITEM-WISE PURCHASE REPORT
  // --------------------------------------------------------------------------
  async getItemPurchaseReport(
    query: {
      fromDate?: string;
      toDate?: string;
      startDate?: string;
      endDate?: string;
    },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const fromDate = query.fromDate || query.startDate;
      const toDate = query.toDate || query.endDate;
      const invWhere: any = { companyId: tenant.companyId };
      if (fromDate || toDate) {
        invWhere.invoiceDate = {};
        if (fromDate) invWhere.invoiceDate.gte = parseStartOfDay(fromDate);
        if (toDate) invWhere.invoiceDate.lte = parseEndOfDay(toDate);
      }

      const items = await tx.purchaseInvoiceItem.findMany({
        where: { invoice: invWhere },
        include: {
          item: {
            include: {
              category: true,
              primaryUom: true,
            },
          },
          invoice: {
            select: { invoiceDate: true, vendorInvoiceNumber: true },
          },
        },
      });

      const map = new Map<string, any>();
      let totalQty = new Decimal(0);
      let totalPurchases = new Decimal(0);

      for (const row of items) {
        const itemId = row.itemId || row.id;
        const itemName = row.item?.name || (row as any).description || "Item";
        const itemCode = row.item?.sku || row.item?.barcode || "-";
        const uom = row.item?.primaryUom?.symbol || "PCS";
        const category = row.item?.category?.name || "General";

        const qty = toMoney(row.quantity);
        const taxable = toMoney(row.taxableAmount);
        const tax = toMoney(row.cgstAmount)
          .plus(toMoney(row.sgstAmount))
          .plus(toMoney(row.igstAmount));
        const total = toMoney((row as any).totalAmount || taxable.plus(tax));

        totalQty = totalQty.plus(qty);
        totalPurchases = totalPurchases.plus(total);

        if (!map.has(itemId)) {
          map.set(itemId, {
            itemId,
            itemName,
            itemNameGujarati: row.item?.nameGujarati,
            itemCode,
            uom,
            category,
            totalQuantity: new Decimal(0),
            totalTaxable: new Decimal(0),
            totalPurchases: new Decimal(0),
            billCount: 0,
          });
        }

        const entry = map.get(itemId);
        entry.totalQuantity = entry.totalQuantity.plus(qty);
        entry.totalTaxable = entry.totalTaxable.plus(taxable);
        entry.totalPurchases = entry.totalPurchases.plus(total);
        entry.billCount += 1;
      }

      const list = Array.from(map.values())
        .map((entry) => ({
          ...entry,
          avgRate: entry.totalQuantity.gt(0)
            ? entry.totalPurchases.dividedBy(entry.totalQuantity).toFixed(2)
            : "0.00",
          totalQuantity: entry.totalQuantity.toFixed(2),
          totalTaxable: entry.totalTaxable.toFixed(2),
          totalPurchases: entry.totalPurchases.toFixed(2),
        }))
        .sort((a, b) => Number(b.totalPurchases) - Number(a.totalPurchases));

      return {
        summary: {
          totalUniqueItems: list.length,
          totalQuantity: totalQty.toFixed(2),
          totalPurchases: totalPurchases.toFixed(2),
        },
        items: list,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 20. PARTY-WISE PURCHASE REPORT
  // --------------------------------------------------------------------------
  async getPartyPurchaseReport(
    query: {
      fromDate?: string;
      toDate?: string;
      startDate?: string;
      endDate?: string;
    },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const fromDate = query.fromDate || query.startDate;
      const toDate = query.toDate || query.endDate;
      const where: any = { companyId: tenant.companyId };
      if (fromDate || toDate) {
        where.invoiceDate = {};
        if (fromDate) where.invoiceDate.gte = parseStartOfDay(fromDate);
        if (toDate) where.invoiceDate.lte = parseEndOfDay(toDate);
      }

      const invoices = await tx.purchaseInvoice.findMany({
        where,
        include: {
          party: true,
        },
      });

      const map = new Map<string, any>();
      let totalPurchases = new Decimal(0);
      let totalPaid = new Decimal(0);
      let totalPayable = new Decimal(0);

      for (const inv of invoices) {
        const partyId = inv.partyId;
        const partyName = inv.party?.name || "Direct Vendor";
        const phone = inv.party?.phone || "-";
        const gstin = inv.party?.gstin || "-";

        const grand = toMoney(inv.grandTotal);
        const paid = toMoney(inv.paidAmount);
        const balance = toMoney(inv.balanceAmount);

        totalPurchases = totalPurchases.plus(grand);
        totalPaid = totalPaid.plus(paid);
        totalPayable = totalPayable.plus(balance);

        if (!map.has(partyId)) {
          map.set(partyId, {
            partyId,
            partyName,
            phone,
            gstin,
            billCount: 0,
            totalPurchases: new Decimal(0),
            totalPaid: new Decimal(0),
            balancePayable: new Decimal(0),
          });
        }

        const entry = map.get(partyId);
        entry.billCount += 1;
        entry.totalPurchases = entry.totalPurchases.plus(grand);
        entry.totalPaid = entry.totalPaid.plus(paid);
        entry.balancePayable = entry.balancePayable.plus(balance);
      }

      const parties = Array.from(map.values())
        .map((e) => ({
          ...e,
          totalPurchases: e.totalPurchases.toFixed(2),
          totalPaid: e.totalPaid.toFixed(2),
          balancePayable: e.balancePayable.toFixed(2),
        }))
        .sort((a, b) => Number(b.totalPurchases) - Number(a.totalPurchases));

      return {
        summary: {
          totalSuppliers: parties.length,
          totalBills: invoices.length,
          totalPurchases: totalPurchases.toFixed(2),
          totalPaid: totalPaid.toFixed(2),
          totalPayable: totalPayable.toFixed(2),
        },
        parties,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 21. PURCHASE RETURNS (DEBIT NOTES) REPORT
  // --------------------------------------------------------------------------
  async getPurchaseReturnsReport(
    query: {
      fromDate?: string;
      toDate?: string;
      startDate?: string;
      endDate?: string;
    },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const fromDate = query.fromDate || query.startDate;
      const toDate = query.toDate || query.endDate;
      const where: any = { companyId: tenant.companyId };
      if (fromDate || toDate) {
        where.returnDate = {};
        if (fromDate) where.returnDate.gte = parseStartOfDay(fromDate);
        if (toDate) where.returnDate.lte = parseEndOfDay(toDate);
      }

      const returns = await tx.purchaseReturn.findMany({
        where,
        include: {
          party: true,
          items: true,
        },
        orderBy: { returnDate: "desc" },
      });

      let totalTaxable = new Decimal(0);
      let grandTotal = new Decimal(0);

      const items = returns.map((r) => {
        const taxable = toMoney(r.taxableAmount);
        const grand = toMoney(r.grandTotal);
        totalTaxable = totalTaxable.plus(taxable);
        grandTotal = grandTotal.plus(grand);

        return {
          id: r.id,
          debitNoteNumber: r.returnNumber,
          returnDate: r.returnDate.toISOString().slice(0, 10),
          partyName: r.party?.name || "Direct Vendor",
          gstin: r.party?.gstin,
          reason: r.reason || "Purchase Return",
          taxableAmount: taxable.toFixed(2),
          grandTotal: grand.toFixed(2),
          itemsCount: r.items.length,
        };
      });

      return {
        summary: {
          totalReturns: returns.length,
          totalTaxable: totalTaxable.toFixed(2),
          grandTotal: grandTotal.toFixed(2),
        },
        returns: items,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 22. QUOTATIONS / ESTIMATES REPORT
  // --------------------------------------------------------------------------
  async getQuotationsReport(
    query: {
      fromDate?: string;
      toDate?: string;
      startDate?: string;
      endDate?: string;
    },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const fromDate = query.fromDate || query.startDate;
      const toDate = query.toDate || query.endDate;
      const where: any = {
        companyId: tenant.companyId,
        category: InvoiceCategory.PROFORMA_INVOICE,
      };
      if (fromDate || toDate) {
        where.invoiceDate = {};
        if (fromDate) where.invoiceDate.gte = parseStartOfDay(fromDate);
        if (toDate) where.invoiceDate.lte = parseEndOfDay(toDate);
      }

      const quotes = await tx.salesInvoice.findMany({
        where,
        include: {
          party: true,
        },
        orderBy: { invoiceDate: "desc" },
      });

      let totalValue = new Decimal(0);
      const items = quotes.map((q) => {
        const val = toMoney(q.grandTotal);
        totalValue = totalValue.plus(val);
        return {
          id: q.id,
          quoteNumber: q.invoiceNumber,
          date: q.invoiceDate.toISOString().slice(0, 10),
          partyName: q.party?.name || "Customer",
          phone: q.party?.phone,
          status: q.status,
          totalAmount: val.toFixed(2),
        };
      });

      return {
        summary: {
          totalQuotations: quotes.length,
          totalValue: totalValue.toFixed(2),
        },
        quotations: items,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 23. DELIVERY CHALLANS REPORT
  // --------------------------------------------------------------------------
  async getDeliveryChallansReport(
    query: {
      fromDate?: string;
      toDate?: string;
      startDate?: string;
      endDate?: string;
    },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const fromDate = query.fromDate || query.startDate;
      const toDate = query.toDate || query.endDate;
      const where: any = { companyId: tenant.companyId };
      if (fromDate || toDate) {
        where.challanDate = {};
        if (fromDate) where.challanDate.gte = parseStartOfDay(fromDate);
        if (toDate) where.challanDate.lte = parseEndOfDay(toDate);
      }

      const challans = await tx.deliveryChallan.findMany({
        where,
        include: {
          party: true,
          items: true,
        },
        orderBy: { challanDate: "desc" },
      });

      const items = challans.map((c) => ({
        id: c.id,
        challanNumber: c.challanNumber,
        date: c.challanDate.toISOString().slice(0, 10),
        partyName: c.party?.name || "Customer",
        phone: c.party?.phone,
        status: c.status,
        itemsCount: c.items.length,
      }));

      return {
        summary: {
          totalChallans: challans.length,
        },
        challans: items,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 24. ITEM BATCH & EXPIRY REPORT
  // --------------------------------------------------------------------------
  async getItemBatchReport(
    query: { fromDate?: string; toDate?: string },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const batches = await tx.itemBatch.findMany({
        where: {
          item: { companyId: tenant.companyId },
        },
        include: {
          item: {
            include: { primaryUom: true, category: true },
          },
          stockTransactions: {
            select: { quantity: true },
          },
        },
      });

      const now = new Date();
      let totalBatches = batches.length;
      let expiredCount = 0;
      let expiringSoonCount = 0;

      const items = batches.map((b) => {
        let currentStock = new Decimal(0);
        for (const st of b.stockTransactions) {
          currentStock = currentStock.plus(toMoney(st.quantity));
        }

        let status = "ACTIVE";
        let daysToExpiry = null;
        if (b.expiryDate) {
          const diffMs = new Date(b.expiryDate).getTime() - now.getTime();
          daysToExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          if (daysToExpiry < 0) {
            status = "EXPIRED";
            expiredCount++;
          } else if (daysToExpiry <= 30) {
            status = "EXPIRING_SOON";
            expiringSoonCount++;
          }
        }

        return {
          id: b.id,
          batchNumber: b.batchNumber,
          itemName: b.item.name,
          itemNameGujarati: b.item.nameGujarati,
          itemCode: b.item.sku || b.item.barcode || "-",
          uom: b.item.primaryUom?.symbol || "PCS",
          mfgDate: b.mfgDate ? b.mfgDate.toISOString().slice(0, 10) : "-",
          expiryDate: b.expiryDate
            ? b.expiryDate.toISOString().slice(0, 10)
            : "-",
          daysToExpiry,
          purchaseRate: toMoney(b.purchaseRate).toFixed(2),
          salePrice: toMoney(b.salePrice).toFixed(2),
          currentStock: currentStock.toFixed(2),
          valuation: currentStock.times(toMoney(b.purchaseRate)).toFixed(2),
          status,
        };
      });

      return {
        summary: {
          totalBatches,
          expiredCount,
          expiringSoonCount,
        },
        batches: items,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 25. LOW STOCK ALERT REPORT
  // --------------------------------------------------------------------------
  async getLowStockAlertReport(
    query: { fromDate?: string; toDate?: string },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const items = await tx.item.findMany({
        where: {
          companyId: tenant.companyId,
          isActive: true,
        },
        include: {
          category: true,
          primaryUom: true,
          stockTransactions: {
            select: { quantity: true },
          },
        },
      });

      const lowStockItems: any[] = [];
      for (const item of items) {
        let currentStock = new Decimal(0);
        for (const st of item.stockTransactions) {
          currentStock = currentStock.plus(toMoney(st.quantity));
        }

        const minLevel = toMoney(item.minStockLevel);
        if (minLevel.gt(0) && currentStock.lte(minLevel)) {
          const deficit = minLevel.minus(currentStock);
          lowStockItems.push({
            id: item.id,
            name: item.name,
            nameGujarati: item.nameGujarati,
            sku: item.sku || "-",
            category: item.category?.name || "General",
            uom: item.primaryUom?.symbol || "PCS",
            currentStock: currentStock.toFixed(2),
            minStockLevel: minLevel.toFixed(2),
            deficit: deficit.toFixed(2),
            reorderQuantity: toMoney(item.reorderQuantity || deficit).toFixed(
              2,
            ),
            purchaseRate: toMoney(item.purchaseRate).toFixed(2),
          });
        }
      }

      return {
        summary: {
          totalLowStockCount: lowStockItems.length,
        },
        items: lowStockItems,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 26. EXPENSE CATEGORY REPORT
  // --------------------------------------------------------------------------
  async getExpenseCategoryReport(
    query: {
      fromDate?: string;
      toDate?: string;
      startDate?: string;
      endDate?: string;
    },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const fromDate = query.fromDate || query.startDate;
      const toDate = query.toDate || query.endDate;

      const accounts = await tx.ledgerAccount.findMany({
        where: {
          companyId: tenant.companyId,
          isActive: true,
          group: { nature: AccountNature.EXPENSE },
        },
        include: {
          group: true,
          journalEntries: {
            where: {
              voucher: {
                ...(fromDate || toDate
                  ? {
                      voucherDate: {
                        ...(fromDate ? { gte: parseStartOfDay(fromDate) } : {}),
                        ...(toDate ? { lte: parseEndOfDay(toDate) } : {}),
                      },
                    }
                  : {}),
              },
            },
            include: {
              voucher: true,
            },
          },
        },
      });

      let grandTotalExpense = new Decimal(0);
      const categories: any[] = [];

      for (const acc of accounts) {
        let totalDebit = new Decimal(0);
        let totalCredit = new Decimal(0);

        for (const je of acc.journalEntries) {
          totalDebit = totalDebit.plus(toMoney(je.debitAmount));
          totalCredit = totalCredit.plus(toMoney(je.creditAmount));
        }

        const netExpense = totalDebit.minus(totalCredit);
        if (netExpense.gt(0) || acc.journalEntries.length > 0) {
          grandTotalExpense = grandTotalExpense.plus(netExpense);
          categories.push({
            id: acc.id,
            categoryName: acc.name,
            categoryNameGujarati: acc.nameGujarati,
            groupName: acc.group.name,
            voucherCount: acc.journalEntries.length,
            totalAmount: netExpense.toFixed(2),
          });
        }
      }

      categories.sort((a, b) => Number(b.totalAmount) - Number(a.totalAmount));

      return {
        summary: {
          totalCategories: categories.length,
          totalExpenseAmount: grandTotalExpense.toFixed(2),
        },
        categories,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 27. AUDIT TRAIL REPORT
  // --------------------------------------------------------------------------
  async getAuditTrailReport(
    query: {
      fromDate?: string;
      toDate?: string;
      startDate?: string;
      endDate?: string;
    },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const fromDate = query.fromDate || query.startDate;
      const toDate = query.toDate || query.endDate;
      const where: any = { companyId: tenant.companyId };
      if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) where.createdAt.gte = parseStartOfDay(fromDate);
        if (toDate) where.createdAt.lte = parseEndOfDay(toDate);
      }

      const logs = await tx.auditLog.findMany({
        where,
        include: {
          user: { select: { fullName: true, phone: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      const items = logs.map((l) => ({
        id: l.id,
        timestamp: l.createdAt.toISOString(),
        userName: l.user?.fullName || "System Admin",
        phone: l.user?.phone,
        action: l.action,
        entityName: l.entityName,
        entityId: l.entityId,
        ipAddress: l.ipAddress || "-",
      }));

      return {
        summary: {
          totalLogs: logs.length,
        },
        logs: items,
      };
    });
  }

  // --------------------------------------------------------------------------
  // 28. HSN WISE SALES SUMMARY (TABLE 12)
  // --------------------------------------------------------------------------
  async getHsnWiseSalesReport(
    query: {
      fromDate?: string;
      toDate?: string;
      startDate?: string;
      endDate?: string;
    },
    tenant: TenantContext,
  ): Promise<any> {
    return await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const fromDate = query.fromDate || query.startDate;
      const toDate = query.toDate || query.endDate;
      const invWhere: any = {
        companyId: tenant.companyId,
        status: { not: InvoiceStatus.CANCELLED },
      };
      if (fromDate || toDate) {
        invWhere.invoiceDate = {};
        if (fromDate) invWhere.invoiceDate.gte = parseStartOfDay(fromDate);
        if (toDate) invWhere.invoiceDate.lte = parseEndOfDay(toDate);
      }

      const items = await tx.salesInvoiceItem.findMany({
        where: { invoice: invWhere },
        include: {
          item: { include: { primaryUom: true } },
        },
      });

      const map = new Map<string, any>();
      let totalQty = new Decimal(0);
      let totalTaxable = new Decimal(0);
      let totalTax = new Decimal(0);
      let totalValue = new Decimal(0);

      for (const row of items) {
        const hsn = row.item?.hsnCode || (row as any).hsnCode || "Other";
        const desc = row.item?.name || "Goods/Services";
        const uom = row.item?.primaryUom?.symbol || "PCS";
        const qty = toMoney(row.quantity);
        const taxable = toMoney(row.taxableAmount);
        const cgst = toMoney(row.cgstAmount);
        const sgst = toMoney(row.sgstAmount);
        const igst = toMoney(row.igstAmount);
        const tax = cgst.plus(sgst).plus(igst);
        const val = toMoney((row as any).totalAmount || taxable.plus(tax));

        totalQty = totalQty.plus(qty);
        totalTaxable = totalTaxable.plus(taxable);
        totalTax = totalTax.plus(tax);
        totalValue = totalValue.plus(val);

        if (!map.has(hsn)) {
          map.set(hsn, {
            hsnCode: hsn,
            description: desc,
            uom,
            totalQuantity: new Decimal(0),
            totalTaxable: new Decimal(0),
            cgstAmount: new Decimal(0),
            sgstAmount: new Decimal(0),
            igstAmount: new Decimal(0),
            totalTax: new Decimal(0),
            totalValue: new Decimal(0),
          });
        }

        const e = map.get(hsn);
        e.totalQuantity = e.totalQuantity.plus(qty);
        e.totalTaxable = e.totalTaxable.plus(taxable);
        e.cgstAmount = e.cgstAmount.plus(cgst);
        e.sgstAmount = e.sgstAmount.plus(sgst);
        e.igstAmount = e.igstAmount.plus(igst);
        e.totalTax = e.totalTax.plus(tax);
        e.totalValue = e.totalValue.plus(val);
      }

      const list = Array.from(map.values()).map((e) => ({
        ...e,
        totalQuantity: e.totalQuantity.toFixed(2),
        totalTaxable: e.totalTaxable.toFixed(2),
        cgstAmount: e.cgstAmount.toFixed(2),
        sgstAmount: e.sgstAmount.toFixed(2),
        igstAmount: e.igstAmount.toFixed(2),
        totalTax: e.totalTax.toFixed(2),
        totalValue: e.totalValue.toFixed(2),
      }));

      return {
        summary: {
          totalHsns: list.length,
          totalQuantity: totalQty.toFixed(2),
          totalTaxable: totalTaxable.toFixed(2),
          totalTax: totalTax.toFixed(2),
          totalValue: totalValue.toFixed(2),
        },
        records: list,
      };
    });
  }
}
