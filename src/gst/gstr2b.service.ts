import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { TenantContext } from "@billing/shared-types";
import {
  Gstr2bDocumentType,
  Gstr2bMatchStatus,
  ItcReviewDecision,
  Prisma,
} from "@billing/database";
import {
  assertItcReview,
  matchGstr2bDocuments,
  normalizeInvoiceNumber,
  parseGstr2bFile,
  returnPeriodBounds,
  ReconDocument,
} from "@billing/gst-provider";
import { isValidGstinChecksum } from "../common/validators/gstin.validator";
import { DatabaseService } from "../database/database.service";

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function asDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

@Injectable()
export class Gstr2bService {
  constructor(private readonly prisma: DatabaseService) {}

  async importFile(
    tenant: TenantContext,
    input: { fileName: string; content: string; returnPeriod: string },
  ) {
    let bounds: { from: string; to: string };
    try {
      bounds = returnPeriodBounds(input.returnPeriod);
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
    const parsed = parseGstr2bFile(input.content, input.fileName);
    parsed.lines.forEach((line, index) => {
      if (!isValidGstinChecksum(line.supplierGstin)) {
        parsed.errors.push(`Line ${index + 1}: GSTIN ${line.supplierGstin} failed the checksum check.`);
        parsed.ok = false;
      }
    });
    if (!parsed.ok) {
      throw new BadRequestException({
        message: "GSTR-2B file failed validation. Nothing was imported.",
        errors: parsed.errors,
        warnings: parsed.warnings,
      });
    }

    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const company = await tx.company.findUnique({ where: { id: tenant.companyId } });
      if (!company) throw new NotFoundException("Company not found.");
      if (!company.gstin) {
        throw new BadRequestException("Company GSTIN is required before importing GSTR-2B.");
      }
      if (parsed.recipientGstin && parsed.recipientGstin !== company.gstin.toUpperCase()) {
        throw new BadRequestException(
          `File GSTIN ${parsed.recipientGstin} does not match company GSTIN ${company.gstin}.`,
        );
      }
      if (parsed.returnPeriod && parsed.returnPeriod !== input.returnPeriod) {
        throw new BadRequestException(
          `File period ${parsed.returnPeriod} does not match requested period ${input.returnPeriod}.`,
        );
      }

      const sourceSha256 = createHash("sha256").update(input.content).digest("hex");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenant.companyId}:${sourceSha256}`}))`;
      const existing = await tx.gstr2bImport.findUnique({
        where: {
          companyId_sourceSha256: { companyId: tenant.companyId, sourceSha256 },
        },
      });
      const imported =
        existing ??
        (await tx.gstr2bImport.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            returnPeriod: input.returnPeriod,
            sourceFileName: input.fileName,
            sourceSha256,
            recipientGstin: company.gstin.toUpperCase(),
            warnings: parsed.warnings,
            importedById: tenant.userId,
            lines: {
              create: parsed.lines.map((line) => ({
                organizationId: tenant.organizationId,
                companyId: tenant.companyId,
                supplierGstin: line.supplierGstin,
                supplierName: line.supplierName,
                documentType: line.documentType as Gstr2bDocumentType,
                invoiceNumber: line.invoiceNumber,
                normalizedInvoiceNumber: line.normalizedInvoiceNumber,
                invoiceDate: asDate(line.invoiceDate),
                taxableValue: line.taxableValue,
                cgstAmount: line.cgst,
                sgstAmount: line.sgst,
                igstAmount: line.igst,
                cessAmount: line.cess,
                invoiceValue: line.invoiceValue,
                portalItcFlag: line.portalItcFlag,
                sourceSection: line.sourceSection,
              })),
            },
          },
        }));

      const summary = await this.reconcilePeriod(tx, tenant, input.returnPeriod, bounds);
      return {
        importId: imported.id,
        duplicateFile: Boolean(existing),
        returnPeriod: input.returnPeriod,
        lineCount: parsed.lines.length,
        warnings: parsed.warnings,
        unsupportedSections: parsed.unsupportedSections,
        summary,
        itcPolicy:
          "Importing or matching a row does not claim input tax credit. Review decisions stay UNREVIEWED until a user records one.",
      };
    });
  }

  async listReconciliations(
    tenant: TenantContext,
    query: { returnPeriod: string; status?: string; itcDecision?: string },
  ) {
    const bounds = returnPeriodBounds(query.returnPeriod);
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      await this.reconcilePeriod(tx, tenant, query.returnPeriod, bounds);
      const rows = await tx.gstr2bReconciliation.findMany({
        where: {
          companyId: tenant.companyId,
          returnPeriod: query.returnPeriod,
          ...(query.status ? { status: query.status as Gstr2bMatchStatus } : {}),
          ...(query.itcDecision
            ? { itcDecision: query.itcDecision as ItcReviewDecision }
            : {}),
        },
        include: {
          purchaseInvoice: { include: { party: true } },
          purchaseReturn: { include: { party: true } },
          gstr2bLine: true,
        },
        orderBy: { matchKey: "asc" },
      });
      return {
        returnPeriod: query.returnPeriod,
        rules: this.ruleSummary(),
        rows: rows.map((row) => this.presentRow(row)),
      };
    });
  }

  async summary(tenant: TenantContext, returnPeriod: string) {
    const bounds = returnPeriodBounds(returnPeriod);
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      return this.reconcilePeriod(tx, tenant, returnPeriod, bounds);
    });
  }

  async exportCsv(tenant: TenantContext, returnPeriod: string): Promise<string> {
    const listed = await this.listReconciliations(tenant, { returnPeriod });
    const header = [
      "status",
      "itc_decision",
      "supplier_gstin",
      "books_number",
      "portal_number",
      "books_taxable",
      "portal_taxable",
      "books_cgst",
      "portal_cgst",
      "books_sgst",
      "portal_sgst",
      "books_igst",
      "portal_igst",
      "explanation",
    ];
    const lines = listed.rows.map((row) =>
      [
        row.status,
        row.itcDecision,
        row.supplierGstin,
        row.books?.documentNumber ?? "",
        row.portal?.invoiceNumber ?? "",
        row.books?.taxableValue ?? "",
        row.portal?.taxableValue ?? "",
        row.books?.cgst ?? "",
        row.portal?.cgst ?? "",
        row.books?.sgst ?? "",
        row.portal?.sgst ?? "",
        row.books?.igst ?? "",
        row.portal?.igst ?? "",
        (row.explanation?.rules ?? []).join(" | "),
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(","),
    );
    return [header.join(","), ...lines].join("\n");
  }

  async review(
    tenant: TenantContext,
    reconciliationId: string,
    input: { itcDecision: string; status?: string; reason: string },
  ) {
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 10) {
      throw new BadRequestException("A review reason of at least 10 characters is required.");
    }
    const decisions = Object.values(ItcReviewDecision);
    if (!decisions.includes(input.itcDecision as ItcReviewDecision)) {
      throw new BadRequestException(`ITC decision must be one of ${decisions.join(", ")}.`);
    }
    if (input.status && !Object.values(Gstr2bMatchStatus).includes(input.status as Gstr2bMatchStatus)) {
      throw new BadRequestException("Match status is not a supported reconciliation status.");
    }
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const row = await tx.gstr2bReconciliation.findFirst({
        where: { id: reconciliationId, companyId: tenant.companyId },
      });
      if (!row) throw new NotFoundException("Reconciliation row not found.");
      const nextStatus = (input.status as Gstr2bMatchStatus) || row.status;
      const reviewError = assertItcReview(nextStatus, input.itcDecision);
      if (reviewError) throw new BadRequestException(reviewError);
      const updated = await tx.gstr2bReconciliation.update({
        where: { id: row.id },
        data: {
          status: nextStatus,
          itcDecision: input.itcDecision as ItcReviewDecision,
          userOverridden: true,
        },
      });
      await tx.gstr2bAdjustment.create({
        data: {
          reconciliationId: row.id,
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          userId: tenant.userId,
          previousStatus: row.status,
          newStatus: nextStatus,
          previousDecision: row.itcDecision,
          newDecision: input.itcDecision,
          reason,
        },
      });
      return {
        id: updated.id,
        status: updated.status,
        itcDecision: updated.itcDecision,
        accountingPosting: "NONE",
        message:
          "The review was stored. No ledger voucher was posted and no ITC was auto-claimed beyond this review flag.",
      };
    });
  }

  async history(tenant: TenantContext, reconciliationId: string) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const row = await tx.gstr2bReconciliation.findFirst({
        where: { id: reconciliationId, companyId: tenant.companyId },
        include: { adjustments: { orderBy: { createdAt: "asc" } } },
      });
      if (!row) throw new NotFoundException("Reconciliation row not found.");
      return {
        id: row.id,
        status: row.status,
        systemStatus: row.systemStatus,
        itcDecision: row.itcDecision,
        adjustments: row.adjustments,
      };
    });
  }

  private async reconcilePeriod(
    tx: Prisma.TransactionClient,
    tenant: TenantContext,
    returnPeriod: string,
    bounds: { from: string; to: string },
  ) {
    const lines = await tx.gstr2bLine.findMany({
      where: {
        companyId: tenant.companyId,
        import: { returnPeriod },
      },
    });
    const portalDocs: ReconDocument[] = lines.map((line) => ({
      id: line.id,
      supplierGstin: line.supplierGstin,
      documentNumber: line.invoiceNumber,
      documentDate: isoDate(line.invoiceDate),
      documentType: line.documentType,
      taxableValue: line.taxableValue.toString(),
      cgst: line.cgstAmount.toString(),
      sgst: line.sgstAmount.toString(),
      igst: line.igstAmount.toString(),
      cess: line.cessAmount.toString(),
    }));
    const portalKeys = new Set(
      portalDocs.map(
        (doc) =>
          `${doc.documentType}|${doc.supplierGstin}|${normalizeInvoiceNumber(doc.documentNumber)}`,
      ),
    );

    const purchases = await tx.purchaseInvoice.findMany({
      where: { companyId: tenant.companyId },
      include: { party: true },
    });
    const returns = await tx.purchaseReturn.findMany({
      where: { companyId: tenant.companyId },
      include: { party: true },
    });
    const inPeriod = (value: Date) => {
      const day = isoDate(value);
      return day >= bounds.from && day <= bounds.to;
    };
    const bookDocs: ReconDocument[] = [];
    const bookMeta = new Map<string, { purchaseInvoiceId?: string; purchaseReturnId?: string }>();

    for (const invoice of purchases) {
      const doc: ReconDocument = {
        id: invoice.id,
        supplierGstin: invoice.party.gstin || "",
        documentNumber: invoice.vendorInvoiceNumber,
        documentDate: isoDate(invoice.invoiceDate),
        documentType: "INVOICE",
        taxableValue: invoice.taxableAmount.toString(),
        cgst: invoice.cgstAmount.toString(),
        sgst: invoice.sgstAmount.toString(),
        igst: invoice.igstAmount.toString(),
        cess: invoice.cessAmount.toString(),
      };
      const key = `INVOICE|${doc.supplierGstin.toUpperCase()}|${normalizeInvoiceNumber(doc.documentNumber)}`;
      if (!doc.supplierGstin) continue;
      if (inPeriod(invoice.invoiceDate) || portalKeys.has(key)) {
        bookDocs.push(doc);
        bookMeta.set(invoice.id, { purchaseInvoiceId: invoice.id });
      }
    }
    for (const purchaseReturn of returns) {
      const doc: ReconDocument = {
        id: purchaseReturn.id,
        supplierGstin: purchaseReturn.party.gstin || "",
        documentNumber: purchaseReturn.returnNumber,
        documentDate: isoDate(purchaseReturn.returnDate),
        documentType: "CREDIT_NOTE",
        taxableValue: purchaseReturn.taxableAmount.toString(),
        cgst: purchaseReturn.cgstAmount.toString(),
        sgst: purchaseReturn.sgstAmount.toString(),
        igst: purchaseReturn.igstAmount.toString(),
      };
      const key = `CREDIT_NOTE|${doc.supplierGstin.toUpperCase()}|${normalizeInvoiceNumber(doc.documentNumber)}`;
      if (!doc.supplierGstin) continue;
      if (inPeriod(purchaseReturn.returnDate) || portalKeys.has(key)) {
        bookDocs.push(doc);
        bookMeta.set(purchaseReturn.id, { purchaseReturnId: purchaseReturn.id });
      }
    }

    const matches = matchGstr2bDocuments(bookDocs, portalDocs);
    const existing = await tx.gstr2bReconciliation.findMany({
      where: { companyId: tenant.companyId, returnPeriod },
    });
    const existingByKey = new Map(existing.map((row) => [row.matchKey, row]));
    const freshKeys = new Set(matches.map((match) => match.matchKey));

    for (const row of existing) {
      if (freshKeys.has(row.matchKey)) continue;
      if (row.userOverridden) {
        await tx.gstr2bReconciliation.update({
          where: { id: row.id },
          data: {
            explanation: {
              ...(row.explanation as object),
              stale: true,
              rules: [
                ...(((row.explanation as any)?.rules as string[]) ?? []),
                "A later import no longer produces this match key. The user decision was kept.",
              ],
            },
          },
        });
      } else {
        await tx.gstr2bReconciliation.delete({ where: { id: row.id } });
      }
    }

    for (const match of matches) {
      const meta = match.bookId ? bookMeta.get(match.bookId) : undefined;
      const current = existingByKey.get(match.matchKey);
      const data = {
        systemStatus: match.status as Gstr2bMatchStatus,
        explanation: match.explanation as unknown as Prisma.InputJsonValue,
        purchaseInvoiceId: meta?.purchaseInvoiceId ?? null,
        purchaseReturnId: meta?.purchaseReturnId ?? null,
        gstr2bLineId: match.portalId ?? null,
      };
      if (!current) {
        await tx.gstr2bReconciliation.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            returnPeriod,
            matchKey: match.matchKey,
            status: match.status as Gstr2bMatchStatus,
            itcDecision: ItcReviewDecision.UNREVIEWED,
            ...data,
          },
        });
      } else if (current.userOverridden) {
        await tx.gstr2bReconciliation.update({
          where: { id: current.id },
          data,
        });
      } else {
        await tx.gstr2bReconciliation.update({
          where: { id: current.id },
          data: { ...data, status: match.status as Gstr2bMatchStatus },
        });
      }
    }

    const rows = await tx.gstr2bReconciliation.findMany({
      where: { companyId: tenant.companyId, returnPeriod },
    });
    const counts: Record<string, number> = {};
    const decisions: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      decisions[row.itcDecision] = (decisions[row.itcDecision] ?? 0) + 1;
    }
    return {
      returnPeriod,
      from: bounds.from,
      to: bounds.to,
      counts,
      itcDecisions: decisions,
      matchedDoesNotClaimItc: true,
      rules: this.ruleSummary(),
    };
  }

  private presentRow(row: any) {
    const books = row.purchaseInvoice
      ? {
          documentNumber: row.purchaseInvoice.vendorInvoiceNumber,
          documentDate: isoDate(row.purchaseInvoice.invoiceDate),
          taxableValue: row.purchaseInvoice.taxableAmount.toString(),
          cgst: row.purchaseInvoice.cgstAmount.toString(),
          sgst: row.purchaseInvoice.sgstAmount.toString(),
          utgst: row.purchaseInvoice.utgstAmount.toString(),
          igst: row.purchaseInvoice.igstAmount.toString(),
          supplierGstin: row.purchaseInvoice.party?.gstin ?? "",
        }
      : row.purchaseReturn
        ? {
            documentNumber: row.purchaseReturn.returnNumber,
            documentDate: isoDate(row.purchaseReturn.returnDate),
            taxableValue: row.purchaseReturn.taxableAmount.toString(),
            cgst: row.purchaseReturn.cgstAmount.toString(),
          sgst: row.purchaseReturn.sgstAmount.toString(),
          utgst: row.purchaseReturn.utgstAmount.toString(),
          igst: row.purchaseReturn.igstAmount.toString(),
            supplierGstin: row.purchaseReturn.party?.gstin ?? "",
          }
        : null;
    const portal = row.gstr2bLine
      ? {
          invoiceNumber: row.gstr2bLine.invoiceNumber,
          invoiceDate: isoDate(row.gstr2bLine.invoiceDate),
          taxableValue: row.gstr2bLine.taxableValue.toString(),
          cgst: row.gstr2bLine.cgstAmount.toString(),
          sgst: row.gstr2bLine.sgstAmount.toString(),
          igst: row.gstr2bLine.igstAmount.toString(),
          portalItcFlag: row.gstr2bLine.portalItcFlag,
        }
      : null;
    return {
      id: row.id,
      status: row.status,
      systemStatus: row.systemStatus,
      itcDecision: row.itcDecision,
      userOverridden: row.userOverridden,
      supplierGstin: books?.supplierGstin || row.gstr2bLine?.supplierGstin || "",
      books,
      portal,
      explanation: row.explanation,
    };
  }

  private ruleSummary() {
    return [
      "Normalize invoice numbers to uppercase and remove spaces and / - . _ before comparison.",
      "MATCHED requires the same supplier GSTIN, document type, normalized number, invoice date, and amounts within ₹1.00.",
      "PARTIAL_MATCH allows a date difference of up to 3 days and an amount difference up to the larger of ₹10.00 or 1% of books taxable value.",
      "MISMATCH keeps the same identity but falls outside that band.",
      "MISSING_IN_BOOKS and MISSING_IN_GSTR2B are one-sided rows.",
      "DUPLICATE means more than one row shares the identity and is not auto-paired.",
      "The portal ITC flag is stored for reference and is not treated as an eligibility decision.",
    ];
  }
}
