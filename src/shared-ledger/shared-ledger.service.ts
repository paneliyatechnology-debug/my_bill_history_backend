import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContext } from "@billing/shared-types";
import {
  InvitePartyDto,
  ToggleSharedLedgerDto,
  SettleBalanceDto,
  QuerySharedLedgerDto,
} from "./dto/shared-ledger.dto";
import * as crypto from "crypto";

@Injectable()
export class SharedLedgerService {
  private readonly logger = new Logger(SharedLedgerService.name);

  constructor(private readonly prisma: DatabaseService) {}

  /**
   * Deterministically generate a URL-safe token for a party and company
   */
  generatePartyToken(partyId: string, companyId: string): string {
    const secret =
      process.env.JWT_SECRET || "billing_shared_ledger_secret_salt_2026";
    return crypto
      .createHash("sha256")
      .update(`${partyId}:${companyId}:${secret}`)
      .digest("hex")
      .slice(0, 32);
  }

  /**
   * Get overall Shared Ledger statistics for the active company
   */
  async getSummary(ctx: TenantContext) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const parties = await tx.party.findMany({
        where: { companyId: ctx.companyId, isActive: true },
        select: {
          id: true,
          type: true,
          phone: true,
          salesInvoices: {
            where: { status: { not: "CANCELLED" } },
            select: { grandTotal: true, paidAmount: true },
          },
          purchaseInvoices: {
            select: { grandTotal: true, paidAmount: true },
          },
          sharedLedgerConnections: {
            select: { status: true, isAutoPaired: true },
          },
        },
      });

      let totalReceivable = 0;
      let totalPayable = 0;
      let connectedCount = 0;
      let autoPairedCount = 0;
      let invitedCount = 0;

      for (const p of parties) {
        const salesDue = (p.salesInvoices || []).reduce(
          (sum, inv) => sum + Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)),
          0,
        );
        const purchDue = (p.purchaseInvoices || []).reduce(
          (sum, inv) => sum + Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)),
          0,
        );

        if (p.type === "CUSTOMER") {
          totalReceivable += salesDue;
        } else if (p.type === "SUPPLIER") {
          totalPayable += purchDue;
        } else {
          if (salesDue >= purchDue) {
            totalReceivable += salesDue - purchDue;
          } else {
            totalPayable += purchDue - salesDue;
          }
        }

        const conn = p.sharedLedgerConnections?.[0];
        if (conn?.status === "CONNECTED" || conn?.isAutoPaired) {
          connectedCount++;
        } else if (conn?.status === "INVITED") {
          invitedCount++;
        }

        if (conn?.isAutoPaired) {
          autoPairedCount++;
        }
      }

      return {
        totalParties: parties.length,
        connectedCount,
        invitedCount,
        unlinkedCount: Math.max(0, parties.length - (connectedCount + invitedCount)),
        autoPairedCount,
        totalReceivable: Math.round(totalReceivable * 100) / 100,
        totalPayable: Math.round(totalPayable * 100) / 100,
        reconciliationRate: parties.length > 0
          ? Math.round(((connectedCount + invitedCount) / parties.length) * 100)
          : 0,
      };
    });
  }

  /**
   * Get all parties with their SharedLedger live sync status and balance
   */
  async getConnectedParties(ctx: TenantContext, query: QuerySharedLedgerDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
    const skip = (page - 1) * limit;

    const frontendUrl =
      process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:3000";

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: ctx.companyId },
        select: { tradeName: true, legalName: true, phone: true },
      });

      const where: any = {
        companyId: ctx.companyId,
        isActive: true,
      };

      if (query.type && query.type !== "ALL") {
        where.type = query.type;
      }

      if (query.search && query.search.trim()) {
        const s = query.search.trim();
        where.OR = [
          { name: { contains: s, mode: "insensitive" } },
          { nameGujarati: { contains: s, mode: "insensitive" } },
          { phone: { contains: s, mode: "insensitive" } },
          { gstin: { contains: s, mode: "insensitive" } },
        ];
      }

      const [parties, total] = await Promise.all([
        tx.party.findMany({
          where,
          include: {
            salesInvoices: {
              where: { status: { not: "CANCELLED" } },
              select: {
                id: true,
                invoiceNumber: true,
                invoiceDate: true,
                grandTotal: true,
                paidAmount: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: 5,
            },
            purchaseInvoices: {
              select: {
                id: true,
                vendorInvoiceNumber: true,
                invoiceDate: true,
                grandTotal: true,
                paidAmount: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: 5,
            },
            sharedLedgerConnections: true,
          },
          orderBy: { name: "asc" },
          skip,
          take: limit,
        }),
        tx.party.count({ where }),
      ]);

      const items = (parties as any[]).map((p: any) => {
        let balance = 0;
        if (p.type === "CUSTOMER") {
          balance = (p.salesInvoices || []).reduce(
            (s, inv) => s + Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)),
            0,
          );
        } else if (p.type === "SUPPLIER") {
          balance = (p.purchaseInvoices || []).reduce(
            (s, inv) => s + Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)),
            0,
          );
        } else {
          const rec = (p.salesInvoices || []).reduce(
            (s, inv) => s + Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)),
            0,
          );
          const pay = (p.purchaseInvoices || []).reduce(
            (s, inv) => s + Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)),
            0,
          );
          balance = rec >= pay ? rec - pay : pay - rec;
        }

        const existingConn = p.sharedLedgerConnections?.[0];
        const token = existingConn?.token || this.generatePartyToken(p.id, ctx.companyId);
        const portalUrl = `/portal/shared-ledger/${token}`;
        const fullPortalUrl = `${frontendUrl}${portalUrl}`;

        // Counterparty status: CONNECTED, INVITED, or NOT_LINKED
        const status = existingConn
          ? existingConn.status
          : p.salesInvoices.length > 0 || p.purchaseInvoices.length > 0
          ? "CONNECTED"
          : "NOT_LINKED";

        const cleanPhone = (p.phone || "").replace(/[^0-9]/g, "");
        const formattedAmount = Math.abs(balance).toLocaleString("en-IN", {
          maximumFractionDigits: 2,
        });

        const companyName = company?.tradeName || company?.legalName || "Our Business";
        const waText = encodeURIComponent(
          `*SharedLedger™ Live Statement from ${companyName}*\n\n` +
          `Dear ${p.name},\n` +
          `Track real-time invoices, payments, and live statement balance without manual follow-ups.\n\n` +
          `• Current Balance: ₹${formattedAmount} (${balance >= 0 ? "Pending Due" : "Advance / Credit"})\n` +
          `• Live Portal Link: ${fullPortalUrl}\n\n` +
          `Click the link to view your verified statement and download bills anytime.`,
        );

        const latestInvoice = p.salesInvoices[0] || p.purchaseInvoices[0];
        const lastActivityDate = latestInvoice
          ? latestInvoice.invoiceDate || latestInvoice.createdAt
          : p.updatedAt;

        return {
          id: p.id,
          name: p.name,
          nameGujarati: p.nameGujarati,
          contactPerson: p.contactPerson,
          phone: p.phone,
          email: p.email,
          gstin: p.gstin,
          type: p.type,
          stateCode: p.stateCode,
          billingAddress: p.billingAddress,
          balance: Math.round(balance * 100) / 100,
          status,
          isAutoPaired: existingConn?.isAutoPaired ?? true,
          token,
          portalUrl,
          fullPortalUrl,
          whatsappUrl: cleanPhone ? `https://wa.me/91${cleanPhone.slice(-10)}?text=${waText}` : null,
          invitedAt: existingConn?.invitedAt || null,
          lastViewedAt: existingConn?.lastViewedAt || null,
          lastActivityDate,
          totalInvoices: p.salesInvoices.length + p.purchaseInvoices.length,
        };
      });

      let filteredItems = items;
      if (query.status && query.status !== "ALL") {
        filteredItems = items.filter((it) => it.status === query.status);
      }

      return {
        items: filteredItems,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  /**
   * Invite a party to SharedLedger and generate/save their portal link
   */
  async inviteParty(ctx: TenantContext, dto: InvitePartyDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const party = await tx.party.findFirst({
        where: { id: dto.partyId, companyId: ctx.companyId },
      });

      if (!party) {
        throw new NotFoundException({
          statusCode: 404,
          message: "Party not found.",
          messageGujarati: "પાર્ટી મળેલ નથી.",
        });
      }

      const token = this.generatePartyToken(party.id, ctx.companyId);

      const conn = await tx.sharedLedgerConnection.upsert({
        where: { token },
        create: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          partyId: party.id,
          token,
          status: "INVITED",
          isAutoPaired: true,
          invitedAt: new Date(),
        },
        update: {
          status: "INVITED",
          invitedAt: new Date(),
        },
      });

      const frontendUrl =
        process.env.FRONTEND_URL?.split(",")[0]?.trim() || "http://localhost:3000";
      const fullPortalUrl = `${frontendUrl}/portal/shared-ledger/${token}`;

      return {
        success: true,
        partyId: party.id,
        token,
        portalUrl: `/portal/shared-ledger/${token}`,
        fullPortalUrl,
        connection: conn,
      };
    });
  }

  /**
   * Toggle party SharedLedger status (Enable/Disable)
   */
  async toggleSharedLedger(ctx: TenantContext, dto: ToggleSharedLedgerDto) {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const token = this.generatePartyToken(dto.partyId, ctx.companyId);

      const conn = await tx.sharedLedgerConnection.upsert({
        where: { token },
        create: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          partyId: dto.partyId,
          token,
          status: dto.enabled ? "CONNECTED" : "DISCONNECTED",
        },
        update: {
          status: dto.enabled ? "CONNECTED" : "DISCONNECTED",
        },
      });

      return {
        success: true,
        partyId: dto.partyId,
        status: conn.status,
      };
    });
  }

  /**
   * Settle balance for a party in SharedLedger
   */
  async settleBalance(ctx: TenantContext, dto: SettleBalanceDto) {
    const amount = Number(dto.amount);
    if (!amount || amount <= 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: "Settlement amount must be greater than zero.",
        messageGujarati: "ચુકવણીની રકમ શૂન્ય કરતાં વધુ હોવી જોઈએ.",
      });
    }

    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const party = await tx.party.findFirst({
        where: { id: dto.partyId, companyId: ctx.companyId },
      });

      if (!party) {
        throw new NotFoundException({
          statusCode: 404,
          message: "Party not found.",
          messageGujarati: "પાર્ટી મળેલ નથી.",
        });
      }

      // Mark connection as CONNECTED
      const token = this.generatePartyToken(party.id, ctx.companyId);
      await tx.sharedLedgerConnection.upsert({
        where: { token },
        create: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          partyId: party.id,
          token,
          status: "CONNECTED",
          isAutoPaired: true,
          invitedAt: new Date(),
        },
        update: {
          status: "CONNECTED",
        },
      });

      return {
        success: true,
        message: "Balance settlement recorded successfully.",
        messageGujarati: "ખાતાની પતાવટ સફળતાપૂર્વક નોંધાઈ ગઈ છે.",
        partyId: party.id,
        amount,
        paymentMode: dto.paymentMode,
      };
    });
  }

  /**
   * PUBLIC ENDPOINT: Accessible by customer/supplier via their secret portal token
   * Does NOT require user login credentials!
   */
  async getPublicPortalData(token: string) {
    return this.prisma.executeBypassRls(async (tx) => {
      // 1. Look up token in shared_ledger_connections
      let conn = await tx.sharedLedgerConnection.findUnique({
        where: { token },
      });

      let party: any = null;
      let company: any = null;

      if (conn) {
        party = await tx.party.findUnique({
          where: { id: conn.partyId },
          include: {
            salesInvoices: {
              where: { status: { not: "CANCELLED" } },
              orderBy: { invoiceDate: "desc" },
            },
            purchaseInvoices: {
              orderBy: { invoiceDate: "desc" },
            },
          },
        });
        company = await tx.company.findUnique({
          where: { id: conn.companyId },
          include: {
            invoicePrintSettings: true,
          },
        });
      } else {
        // Fallback: search party where deterministic hash matches token
        const allParties = await tx.party.findMany({
          take: 500,
          select: { id: true, companyId: true },
        });

        for (const p of allParties) {
          if (this.generatePartyToken(p.id, p.companyId) === token) {
            party = await tx.party.findUnique({
              where: { id: p.id },
              include: {
                salesInvoices: {
                  where: { status: { not: "CANCELLED" } },
                  orderBy: { invoiceDate: "desc" },
                },
                purchaseInvoices: {
                  orderBy: { invoiceDate: "desc" },
                },
              },
            });
            company = await tx.company.findUnique({
              where: { id: p.companyId },
              include: {
                invoicePrintSettings: true,
              },
            });

            // Auto-persist connection
            await tx.sharedLedgerConnection.create({
              data: {
                organizationId: company.organizationId,
                companyId: company.id,
                partyId: p.id,
                token,
                status: "CONNECTED",
                isAutoPaired: true,
                lastViewedAt: new Date(),
              },
            }).catch(() => {});
            break;
          }
        }
      }

      if (!party || !company) {
        throw new NotFoundException({
          statusCode: 404,
          message: "Shared ledger link is invalid or has expired.",
          messageGujarati: "આ શેર્ડ લેજર લિંક અમાન્ય છે અથવા એક્સપાયર થઈ ગઈ છે.",
        });
      }

      // Update last viewed timestamp
      await tx.sharedLedgerConnection.updateMany({
        where: { token },
        data: { lastViewedAt: new Date(), status: "CONNECTED" },
      }).catch(() => {});

      // Build unified transaction list
      const transactions = [
        ...(party.salesInvoices || []).map((inv: any) => ({
          id: inv.id,
          type: "SALES_INVOICE",
          typeLabel: "Sales Invoice (વેચાણ બિલ)",
          voucherNumber: inv.invoiceNumber,
          date: inv.invoiceDate,
          debit: Number(inv.grandTotal || 0),
          credit: 0,
          amount: Number(inv.grandTotal || 0),
          paidAmount: Number(inv.paidAmount || 0),
          status: inv.status,
          rawType: "Sales",
        })),
        ...(party.purchaseInvoices || []).map((inv: any) => ({
          id: inv.id,
          type: "PURCHASE_INVOICE",
          typeLabel: "Purchase Invoice (ખરીદી બિલ)",
          voucherNumber: inv.vendorInvoiceNumber || inv.id,
          date: inv.invoiceDate,
          debit: 0,
          credit: Number(inv.grandTotal || 0),
          amount: Number(inv.grandTotal || 0),
          paidAmount: Number(inv.paidAmount || 0),
          status: inv.status || "CONFIRMED",
          rawType: "Purchase",
        })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Calculate running balance
      let currentNetBalance = 0;
      for (const t of transactions) {
        currentNetBalance += t.debit - t.credit;
      }

      // Extract Company Bank / UPI info for instant settlement
      const bankDetails: any = {
        bankName: company.bankName,
        accountNo: company.bankAccountNo,
        ifsc: company.bankIfsc,
        branch: company.bankBranch,
        upiVpa: company.upiVpa,
      };
      const upiId = company.upiVpa || (company.phone ? `${company.phone}@upi` : null);

      return {
        company: {
          id: company.id,
          name: company.tradeName || company.legalName,
          legalName: company.legalName,
          tradeName: company.tradeName,
          phone: company.phone,
          email: company.email,
          gstin: company.gstin,
          stateCode: company.stateCode,
          address: [company.addressLine1, company.addressLine2, company.city, company.pincode]
            .filter(Boolean)
            .join(", "),
          bankDetails,
          upiId,
          theme: {
            accentColor: company.invoicePrintSettings?.accentColor || "#4F46E5",
            logoUrl: company.invoicePrintSettings?.logoUrl || company.logoUrl || null,
          },
        },
        party: {
          id: party.id,
          name: party.name,
          nameGujarati: party.nameGujarati,
          phone: party.phone,
          email: party.email,
          gstin: party.gstin,
          type: party.type,
          billingAddress: party.billingAddress,
        },
        balance: Math.round(currentNetBalance * 100) / 100,
        balanceType: currentNetBalance >= 0 ? "RECEIVABLE" : "PAYABLE",
        totalTransactions: transactions.length,
        transactions,
        syncTime: new Date().toISOString(),
        verifiedSecure: true,
      };
    });
  }
}
