import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import {
  applyTransactionToBalance,
  calculateSalesInvoiceTaxes,
  toMoney,
  validateJournalLines,
  validatePeriodAccess,
} from "@billing/accounting-core";
import { DatabaseService } from "../database/database.service";

const GOODS_ADVANCE_NOTE =
  "Notification 66/2017-Central Tax: tax is not charged on an advance received for goods. No output-tax voucher is posted.";
const SERVICE_ADVANCE_NOTE =
  "Section 13 of the CGST Act can tax a service advance on receipt. The calculated tax is stored for GSTR-1 Table 11 only. No voucher is posted until a chartered accountant confirms the ledger entry, so the later invoice does not tax the same supply twice.";

@Injectable()
export class GstDocumentsService {
  constructor(private readonly prisma: DatabaseService) {}

  async createDebitNote(
    tenant: TenantContext,
    input: {
      salesInvoiceId: string;
      noteNumber: string;
      noteDate: string;
      reason: string;
      items: Array<{ itemId: string; quantity: number; unitPrice: number; taxRate: number; hsnCode?: string }>;
    },
  ) {
    if (!input.reason || input.reason.trim().length < 10) {
      throw new BadRequestException("A debit-note reason of at least 10 characters is required.");
    }
    if (!input.items?.length) throw new BadRequestException("A debit note needs at least one line.");
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoice = await tx.salesInvoice.findFirst({
        where: { id: input.salesInvoiceId, companyId: tenant.companyId },
        include: { party: true, items: true },
      });
      if (!invoice) throw new NotFoundException("Sales invoice not found.");
      const company = await tx.company.findUnique({ where: { id: tenant.companyId } });
      if (!company) throw new NotFoundException("Company not found.");
      const noteDate = new Date(`${input.noteDate.slice(0, 10)}T00:00:00.000Z`);
      const fy = await this.financialYear(tx, tenant.companyId, noteDate);
      const itemIds = input.items.map((line) => line.itemId);
      const masters = await tx.item.findMany({
        where: { companyId: tenant.companyId, id: { in: itemIds } },
      });
      const itemMap = new Map(masters.map((item) => [item.id, item]));
      const taxCalc = calculateSalesInvoiceTaxes(
        company.stateCode,
        invoice.placeOfSupply,
        input.items.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate,
          supplyCategory: (itemMap.get(line.itemId)?.supplyCategory as any) || "TAXABLE",
        })),
      );
      const note = await tx.outwardDebitNote.create({
        data: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          branchId: invoice.branchId,
          financialYearId: fy.id,
          salesInvoiceId: invoice.id,
          partyId: invoice.partyId,
          noteNumber: input.noteNumber.trim(),
          noteDate,
          placeOfSupply: invoice.placeOfSupply,
          taxableAmount: taxCalc.taxableAmount.toNumber(),
          cgstAmount: taxCalc.cgstAmount.toNumber(),
          sgstAmount: taxCalc.sgstAmount.toNumber(),
          utgstAmount: taxCalc.utgstAmount.toNumber(),
          igstAmount: taxCalc.igstAmount.toNumber(),
          grandTotal: taxCalc.grandTotal.toNumber(),
          reason: input.reason.trim(),
          items: {
            create: input.items.map((line, index) => {
              const computed = taxCalc.items[index];
              return {
                itemId: line.itemId,
                hsnCode: line.hsnCode || itemMap.get(line.itemId)?.hsnCode || "999999",
                quantity: computed.quantity.toNumber(),
                taxableAmount: computed.taxableAmount.toNumber(),
                taxRate: computed.taxRate.toNumber(),
                cgstAmount: computed.cgstAmount.toNumber(),
                sgstAmount: computed.sgstAmount.toNumber(),
                utgstAmount: computed.utgstAmount.toNumber(),
                igstAmount: computed.igstAmount.toNumber(),
                totalAmount: computed.totalAmount.toNumber(),
                supplyCategory: computed.supplyCategory,
              };
            }),
          },
        },
        include: { items: true },
      });
      const voucher = await this.postDebitVoucher(tx, tenant, note, invoice.party, taxCalc, fy.id);
      await tx.outwardDebitNote.update({
        where: { id: note.id },
        data: { voucherId: voucher.id },
      });
      return { ...note, voucherId: voucher.id, stockMovement: "NONE" };
    });
  }

  async createAdvance(
    tenant: TenantContext,
    input: {
      partyId: string;
      receiptNumber: string;
      receiptDate: string;
      supplyKind: "GOODS" | "SERVICES";
      placeOfSupply: string;
      taxableAmount: number;
      taxRate?: number;
    },
  ) {
    if (input.supplyKind !== "GOODS" && input.supplyKind !== "SERVICES") {
      throw new BadRequestException("Advance supply kind must be GOODS or SERVICES.");
    }
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const company = await tx.company.findUnique({ where: { id: tenant.companyId } });
      const party = await tx.party.findFirst({
        where: { id: input.partyId, companyId: tenant.companyId },
      });
      if (!company || !party) throw new NotFoundException("Company or party not found.");
      const branch = await tx.branch.findFirst({ where: { companyId: tenant.companyId } });
      if (!branch) throw new NotFoundException("A branch is required before an advance can be recorded.");
      const receiptDate = new Date(`${input.receiptDate.slice(0, 10)}T00:00:00.000Z`);
      const fy = await this.financialYear(tx, tenant.companyId, receiptDate);
      const goods = input.supplyKind === "GOODS";
      const taxCalc = calculateSalesInvoiceTaxes(company.stateCode, input.placeOfSupply, [
        {
          itemId: "advance",
          quantity: 1,
          unitPrice: input.taxableAmount,
          taxRate: goods ? 0 : input.taxRate ?? 0,
          supplyCategory: "TAXABLE",
        },
      ]);
      const receipt = await tx.advanceReceipt.create({
        data: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          branchId: branch.id,
          financialYearId: fy.id,
          partyId: party.id,
          receiptNumber: input.receiptNumber.trim(),
          receiptDate,
          supplyKind: input.supplyKind,
          placeOfSupply: input.placeOfSupply,
          taxableAmount: taxCalc.taxableAmount.toNumber(),
          cgstAmount: goods ? 0 : taxCalc.cgstAmount.toNumber(),
          sgstAmount: goods ? 0 : taxCalc.sgstAmount.toNumber(),
          utgstAmount: goods ? 0 : taxCalc.utgstAmount.toNumber(),
          igstAmount: goods ? 0 : taxCalc.igstAmount.toNumber(),
          grandTotal: goods ? taxCalc.taxableAmount.toNumber() : taxCalc.grandTotal.toNumber(),
          accountingPosting: "NOT_POSTED_PENDING_CA",
          statutoryNote: goods ? GOODS_ADVANCE_NOTE : SERVICE_ADVANCE_NOTE,
        },
      });
      return { ...receipt, voucherPosted: false };
    });
  }

  async adjustAdvance(
    tenant: TenantContext,
    advanceId: string,
    input: { adjustmentDate: string; taxableAmount: number; salesInvoiceId?: string; reason: string },
  ) {
    if (!input.reason || input.reason.trim().length < 10) {
      throw new BadRequestException("An advance adjustment reason of at least 10 characters is required.");
    }
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const advance = await tx.advanceReceipt.findFirst({
        where: { id: advanceId, companyId: tenant.companyId },
      });
      if (!advance) throw new NotFoundException("Advance receipt not found.");
      const remaining = Number(advance.taxableAmount) - Number(advance.adjustedTaxable);
      if (input.taxableAmount <= 0 || input.taxableAmount > remaining + 0.001) {
        throw new BadRequestException("Adjustment cannot exceed the unadjusted advance.");
      }
      const ratio = input.taxableAmount / Number(advance.taxableAmount);
      const adjustment = await tx.advanceAdjustment.create({
        data: {
          advanceId: advance.id,
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          salesInvoiceId: input.salesInvoiceId || null,
          adjustmentDate: new Date(`${input.adjustmentDate.slice(0, 10)}T00:00:00.000Z`),
          taxableAmount: input.taxableAmount,
          cgstAmount: Number(advance.cgstAmount) * ratio,
          sgstAmount: Number(advance.sgstAmount) * ratio,
          utgstAmount: Number(advance.utgstAmount) * ratio,
          igstAmount: Number(advance.igstAmount) * ratio,
          reason: input.reason.trim(),
        },
      });
      await tx.advanceReceipt.update({
        where: { id: advance.id },
        data: { adjustedTaxable: Number(advance.adjustedTaxable) + input.taxableAmount },
      });
      return { ...adjustment, voucherPosted: false, accountingPosting: advance.accountingPosting };
    });
  }

  private async financialYear(tx: any, companyId: string, date: Date) {
    const fy =
      (await tx.financialYear.findFirst({
        where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
      })) || (await tx.financialYear.findFirst({ where: { companyId, isCurrent: true } }));
    if (!fy) throw new NotFoundException("No financial year covers this document date.");
    const access = validatePeriodAccess(date, companyId, fy);
    if (!access.isAllowed) throw new BadRequestException(access.reason);
    return fy;
  }

  private async account(tx: any, companyId: string, name: string) {
    const acc = await tx.ledgerAccount.findFirst({ where: { companyId, name } });
    if (!acc) throw new NotFoundException(`Ledger account "${name}" was not found.`);
    return acc;
  }

  private async postDebitVoucher(tx: any, tenant: TenantContext, note: any, party: any, taxCalc: any, financialYearId: string) {
    let partyAccount = party.ledgerAccountId
      ? await tx.ledgerAccount.findUnique({ where: { id: party.ledgerAccountId } })
      : null;
    if (!partyAccount) {
      partyAccount = await tx.ledgerAccount.findFirst({
        where: { companyId: tenant.companyId, partyId: party.id },
      });
    }
    if (!partyAccount) throw new NotFoundException("The customer ledger account was not found.");
    const sales = await this.account(
      tx,
      tenant.companyId,
      taxCalc.isIntraState ? "General Sales Account" : "Inter-State Sales Account",
    );
    const lines: Array<{ accountId: string; debitAmount: number; creditAmount: number; lineNarration: string }> = [
      {
        accountId: partyAccount.id,
        debitAmount: taxCalc.grandTotal.toNumber(),
        creditAmount: 0,
        lineNarration: `Debit note ${note.noteNumber}`,
      },
      {
        accountId: sales.id,
        debitAmount: 0,
        creditAmount: taxCalc.taxableAmount.toNumber(),
        lineNarration: `Debit note taxable ${note.noteNumber}`,
      },
    ];
    const taxLedgers: Array<[string, { greaterThan: (n: number) => boolean; toNumber: () => number }]> = [
      ["Output CGST", taxCalc.cgstAmount],
      ["Output SGST", taxCalc.sgstAmount],
      ["Output IGST", taxCalc.igstAmount],
    ];
    for (const [name, amount] of taxLedgers) {
      if (amount.greaterThan(0)) {
        const acc = await this.account(tx, tenant.companyId, name);
        lines.push({
          accountId: acc.id,
          debitAmount: 0,
          creditAmount: amount.toNumber(),
          lineNarration: `${name} ${note.noteNumber}`,
        });
      }
    }
    if (taxCalc.utgstAmount.greaterThan(0)) {
      let utgst = await tx.ledgerAccount.findFirst({
        where: { companyId: tenant.companyId, name: "Output UTGST" },
      });
      if (!utgst) {
        const group = await tx.ledgerGroup.findFirst({
          where: { companyId: tenant.companyId, name: "Duties & Taxes" },
        });
        if (!group) throw new NotFoundException("Duties & Taxes ledger group was not found.");
        utgst = await tx.ledgerAccount.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            groupId: group.id,
            name: "Output UTGST",
            code: "2140",
            isTaxLedger: true,
            openingType: "CR",
          },
        });
      }
      lines.push({
        accountId: utgst.id,
        debitAmount: 0,
        creditAmount: taxCalc.utgstAmount.toNumber(),
        lineNarration: `Output UTGST ${note.noteNumber}`,
      });
    }
    if (!taxCalc.roundOff.isZero()) {
      const roundOff = await this.account(tx, tenant.companyId, "Round Off Account");
      lines.push({
        accountId: roundOff.id,
        debitAmount: taxCalc.roundOff.lessThan(0) ? taxCalc.roundOff.abs().toNumber() : 0,
        creditAmount: taxCalc.roundOff.greaterThan(0) ? taxCalc.roundOff.toNumber() : 0,
        lineNarration: `Round off ${note.noteNumber}`,
      });
    }
    const validation = validateJournalLines(lines);
    if (!validation.isValid) {
      throw new BadRequestException(`Debit note voucher is not balanced: ${validation.errors.join("; ")}`);
    }
    const voucher = await tx.voucher.create({
      data: {
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        financialYearId,
        voucherType: "SALES",
        voucherNumber: `DN/${note.noteNumber}`,
        voucherDate: note.noteDate,
        referenceNo: note.noteNumber,
        narration: `Outward debit note ${note.noteNumber}`,
        totalAmount: taxCalc.grandTotal.toNumber(),
        isAutoGenerated: true,
        sourceDocument: "OUTWARD_DEBIT_NOTE",
        sourceEntityId: note.id,
      },
    });
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      await tx.journalEntry.create({
        data: {
          voucherId: voucher.id,
          accountId: line.accountId,
          debitAmount: line.debitAmount,
          creditAmount: line.creditAmount,
          lineNarration: line.lineNarration,
          sequenceOrder: index + 1,
        },
      });
      const account = await tx.ledgerAccount.findUnique({
        where: { id: line.accountId },
        include: { group: true },
      });
      if (account) {
        const next = applyTransactionToBalance(
          account.group.nature,
          account.currentBalance.toString(),
          toMoney(line.debitAmount),
          toMoney(line.creditAmount),
        );
        await tx.ledgerAccount.update({
          where: { id: account.id },
          data: { currentBalance: next.toNumber() },
        });
      }
    }
    return voucher;
  }
}
