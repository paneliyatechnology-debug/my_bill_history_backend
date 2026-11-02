import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import { DatabaseService } from "../database/database.service";
import { GstPortalService } from "./gst-portal.service";
import { InvoicePrintService } from "../invoice-print/invoice-print.service";
import { QueryEInvoicesDto } from "./dto/query-einvoices.dto";
import { CancelEInvoiceDto } from "./dto/cancel-einvoice.dto";
import { UpdateEInvoiceSettingsDto } from "./dto/update-einvoice-settings.dto";

export interface EInvoiceValidationError {
  field: string;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface EInvoiceValidationResult {
  valid: boolean;
  status: "READY" | "DRAFT";
  errors: EInvoiceValidationError[];
  warnings: EInvoiceValidationError[];
  summary: {
    documentNumber: string;
    documentDate: string;
    documentType: string;
    partyName: string;
    partyGstin: string;
    placeOfSupply: string;
    totalItems: number;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    cessAmount: number;
    roundOff: number;
    grandTotal: number;
  };
}

const VALID_STATE_CODES = new Set([
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "21", "22", "23", "24", "25", "26", "27", "28", "29", "30",
  "31", "32", "33", "34", "35", "36", "37", "38", "97", "99",
]);

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PIN_REGEX = /^[1-9][0-9]{5}$/;
const DOC_NUM_REGEX = /^[A-Za-z0-9][A-Za-z0-9/-]{0,15}$/;

@Injectable()
export class EInvoicesService {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly portal: GstPortalService,
    private readonly printService: InvoicePrintService,
  ) {}

  validateInvoiceData(invoice: any): EInvoiceValidationResult {
    const errors: EInvoiceValidationError[] = [];
    const warnings: EInvoiceValidationError[] = [];

    // 1. Document details
    if (!invoice.invoiceNumber) {
      errors.push({
        field: "invoiceNumber",
        code: "DOC_NO_REQUIRED",
        message: "Invoice document number is required.",
        severity: "error",
      });
    } else if (invoice.invoiceNumber.length > 16) {
      errors.push({
        field: "invoiceNumber",
        code: "DOC_NO_TOO_LONG",
        message: "IRP document number must not exceed 16 characters.",
        severity: "error",
      });
    } else if (!DOC_NUM_REGEX.test(invoice.invoiceNumber)) {
      errors.push({
        field: "invoiceNumber",
        code: "DOC_NO_INVALID_CHARS",
        message: "Invoice number must be alphanumeric and may only contain / or - (cannot start with / or -).",
        severity: "error",
      });
    }

    if (!invoice.invoiceDate) {
      errors.push({
        field: "invoiceDate",
        code: "DOC_DATE_REQUIRED",
        message: "Invoice date is required.",
        severity: "error",
      });
    } else {
      const invDate = new Date(invoice.invoiceDate);
      const now = new Date();
      const diffDays = (now.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > 30) {
        warnings.push({
          field: "invoiceDate",
          code: "REPORTING_WINDOW_WARNING",
          message: "Document date is older than 30 days. Businesses with AATO >= ₹10 Cr must report invoices within 30 days under GST advisory rules.",
          severity: "warning",
        });
      }
    }

    // 2. Supplier details
    const company = invoice.company || {};
    const supplierGstin = company.gstin ? String(company.gstin).trim() : "";
    if (!supplierGstin) {
      errors.push({
        field: "supplier.gstin",
        code: "SUPPLIER_GSTIN_REQUIRED",
        message: "Company GSTIN is missing. Please configure your GSTIN in company settings.",
        severity: "error",
      });
    } else if (!GSTIN_REGEX.test(supplierGstin)) {
      errors.push({
        field: "supplier.gstin",
        code: "SUPPLIER_GSTIN_INVALID",
        message: `Supplier GSTIN "${supplierGstin}" format is invalid.`,
        severity: "error",
      });
    }

    const supplierState = String(company.stateCode || "").padStart(2, "0");
    if (!VALID_STATE_CODES.has(supplierState)) {
      errors.push({
        field: "supplier.stateCode",
        code: "SUPPLIER_STATE_INVALID",
        message: `Supplier state code "${supplierState}" is invalid. Must be a valid 2-digit GST state code.`,
        severity: "error",
      });
    } else if (supplierGstin && supplierGstin.slice(0, 2) !== supplierState) {
      errors.push({
        field: "supplier.stateCode",
        code: "SUPPLIER_STATE_MISMATCH",
        message: `Supplier state code "${supplierState}" does not match the first 2 digits of supplier GSTIN "${supplierGstin.slice(0, 2)}".`,
        severity: "error",
      });
    }

    if (!company.addressLine1 || company.addressLine1.trim().length < 3) {
      errors.push({
        field: "supplier.addressLine1",
        code: "SUPPLIER_ADDR_REQUIRED",
        message: "Supplier registered address is required (minimum 3 characters).",
        severity: "error",
      });
    }

    const supplierPin = String(company.pincode || "").trim();
    if (!PIN_REGEX.test(supplierPin)) {
      errors.push({
        field: "supplier.pincode",
        code: "SUPPLIER_PIN_INVALID",
        message: `Supplier PIN code "${supplierPin}" must be a valid 6-digit postal code.`,
        severity: "error",
      });
    }

    // 3. Buyer details
    const party = invoice.party || {};
    const buyerGstin = party.gstin ? String(party.gstin).trim() : "";
    const isExport = invoice.category === "EXPORT_INVOICE" || invoice.isExport;

    if (!buyerGstin) {
      if (!isExport) {
        errors.push({
          field: "buyer.gstin",
          code: "BUYER_GSTIN_REQUIRED",
          message: "Recipient GSTIN is required for B2B e-invoicing. If unregistered, provide 'URP' or select appropriate supply type.",
          severity: "error",
        });
      }
    } else if (buyerGstin !== "URP" && !GSTIN_REGEX.test(buyerGstin)) {
      errors.push({
        field: "buyer.gstin",
        code: "BUYER_GSTIN_INVALID",
        message: `Recipient GSTIN "${buyerGstin}" format is invalid.`,
        severity: "error",
      });
    }

    const buyerName = party.name || party.tradeName || "";
    if (!buyerName || buyerName.trim().length < 2) {
      errors.push({
        field: "buyer.name",
        code: "BUYER_NAME_REQUIRED",
        message: "Recipient legal or trade name is required.",
        severity: "error",
      });
    }

    const billingAddress = invoice.billingAddress || party.billingAddress || {};
    const buyerAddrLine = typeof billingAddress === "string" ? billingAddress : billingAddress.line1 || billingAddress.address || billingAddress.addressLine1 || "";
    if (!buyerAddrLine || buyerAddrLine.trim().length < 2) {
      errors.push({
        field: "buyer.billingAddress",
        code: "BUYER_ADDR_REQUIRED",
        message: "Recipient billing address line is required.",
        severity: "error",
      });
    }

    const buyerPin = String(billingAddress.pincode || billingAddress.pin || party.pincode || "").trim();
    if (isExport) {
      if (buyerPin && buyerPin !== "999999" && !PIN_REGEX.test(buyerPin)) {
        warnings.push({
          field: "buyer.pincode",
          code: "EXPORT_PIN_NOTICE",
          message: "For export recipients, PIN code should be 999999.",
          severity: "warning",
        });
      }
    } else if (!PIN_REGEX.test(buyerPin)) {
      errors.push({
        field: "buyer.pincode",
        code: "BUYER_PIN_INVALID",
        message: `Recipient PIN code "${buyerPin}" must be a 6-digit postal code.`,
        severity: "error",
      });
    }

    const pos = String(invoice.placeOfSupply || party.stateCode || "").padStart(2, "0");
    if (!VALID_STATE_CODES.has(pos)) {
      errors.push({
        field: "placeOfSupply",
        code: "POS_INVALID",
        message: `Place of supply "${pos}" is invalid. Must be a valid 2-digit GST state code.`,
        severity: "error",
      });
    }

    // 4. Line items
    const items: any[] = invoice.items || [];
    if (items.length === 0) {
      errors.push({
        field: "items",
        code: "ITEMS_REQUIRED",
        message: "At least one item line is required for e-invoice generation.",
        severity: "error",
      });
    }

    let calculatedTaxable = 0;
    let calculatedCgst = 0;
    let calculatedSgst = 0;
    let calculatedIgst = 0;

    items.forEach((item, index) => {
      const lineNo = index + 1;
      const desc = item.description || item.item?.name || "";
      if (!desc || desc.trim().length === 0) {
        errors.push({
          field: `items[${index}].description`,
          code: "ITEM_DESC_REQUIRED",
          message: `Line ${lineNo}: Item description is required.`,
          severity: "error",
        });
      }

      const hsn = String(item.hsnCode || item.item?.hsnCode || "").trim();
      if (!hsn) {
        errors.push({
          field: `items[${index}].hsnCode`,
          code: "ITEM_HSN_REQUIRED",
          message: `Line ${lineNo}: HSN/SAC code is required.`,
          severity: "error",
        });
      } else if (!/^[0-9]{4,8}$/.test(hsn)) {
        errors.push({
          field: `items[${index}].hsnCode`,
          code: "ITEM_HSN_INVALID",
          message: `Line ${lineNo}: HSN/SAC code "${hsn}" must be between 4 and 8 digits.`,
          severity: "error",
        });
      }

      const qty = Number(item.quantity || 0);
      if (qty <= 0) {
        errors.push({
          field: `items[${index}].quantity`,
          code: "ITEM_QTY_POSITIVE",
          message: `Line ${lineNo}: Quantity must be greater than zero.`,
          severity: "error",
        });
      }

      const rate = Number(item.unitPrice || 0);
      if (rate < 0) {
        errors.push({
          field: `items[${index}].unitPrice`,
          code: "ITEM_RATE_NEGATIVE",
          message: `Line ${lineNo}: Unit price cannot be negative.`,
          severity: "error",
        });
      }

      const taxable = Number(item.taxableAmount || 0);
      calculatedTaxable += taxable;
      calculatedCgst += Number(item.cgstAmount || 0);
      calculatedSgst += Number(item.sgstAmount || 0);
      calculatedIgst += Number(item.igstAmount || 0);
    });

    // 5. Tax Math Reconciliation
    const isIntraState = supplierState === pos;
    const invoiceIgst = Number(invoice.igstAmount || 0);
    const invoiceCgst = Number(invoice.cgstAmount || 0);
    const invoiceSgst = Number(invoice.sgstAmount || 0);

    if (isIntraState) {
      if (invoiceIgst > 0.05) {
        errors.push({
          field: "igstAmount",
          code: "TAX_INTRA_IGST_DISALLOWED",
          message: `Intra-state supply (Supplier State ${supplierState} = Place of Supply ${pos}) must not have IGST. Found ₹${invoiceIgst}.`,
          severity: "error",
        });
      }
      if (Math.abs(invoiceCgst - invoiceSgst) > 0.05) {
        errors.push({
          field: "taxMismatch",
          code: "CGST_SGST_MISMATCH",
          message: `CGST (₹${invoiceCgst}) and SGST (₹${invoiceSgst}) must be equal for intra-state supply.`,
          severity: "error",
        });
      }
    } else {
      if (invoiceCgst > 0.05 || invoiceSgst > 0.05) {
        errors.push({
          field: "cgstAmount",
          code: "TAX_INTER_CGST_SGST_DISALLOWED",
          message: `Inter-state supply (Supplier State ${supplierState} != Place of Supply ${pos}) must charge IGST only. Found CGST: ₹${invoiceCgst}, SGST: ₹${invoiceSgst}.`,
          severity: "error",
        });
      }
    }

    const totalInvoiceVal = Number(invoice.grandTotal || 0);
    const componentSum =
      Number(invoice.taxableAmount || 0) +
      invoiceCgst +
      invoiceSgst +
      Number(invoice.utgstAmount || 0) +
      invoiceIgst +
      Number(invoice.cessAmount || 0) +
      Number(invoice.roundOff || 0);

    if (Math.abs(componentSum - totalInvoiceVal) > 0.05) {
      errors.push({
        field: "grandTotal",
        code: "TOTAL_SUM_MISMATCH",
        message: `Invoice components (Taxable: ₹${Number(invoice.taxableAmount || 0).toFixed(2)}, Taxes: ₹${(invoiceCgst + invoiceSgst + invoiceIgst).toFixed(2)}, Cess: ₹${Number(invoice.cessAmount || 0).toFixed(2)}, RoundOff: ₹${Number(invoice.roundOff || 0).toFixed(2)}) sum to ₹${componentSum.toFixed(2)}, but Grand Total is ₹${totalInvoiceVal.toFixed(2)}.`,
        severity: "error",
      });
    }

    const valid = errors.length === 0;
    return {
      valid,
      status: valid ? "READY" : "DRAFT",
      errors,
      warnings,
      summary: {
        documentNumber: invoice.invoiceNumber,
        documentDate: invoice.invoiceDate ? new Date(invoice.invoiceDate).toISOString().slice(0, 10) : "",
        documentType: invoice.category || "TAX_INVOICE",
        partyName: buyerName,
        partyGstin: buyerGstin,
        placeOfSupply: pos,
        totalItems: items.length,
        taxableAmount: Number(invoice.taxableAmount || 0),
        cgstAmount: invoiceCgst,
        sgstAmount: invoiceSgst,
        igstAmount: invoiceIgst,
        cessAmount: Number(invoice.cessAmount || 0),
        roundOff: Number(invoice.roundOff || 0),
        grandTotal: totalInvoiceVal,
      },
    };
  }

  async listEInvoices(tenant: TenantContext, query: QueryEInvoicesDto) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const page = Math.max(1, Number(query.page || 1));
      const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
      const skip = (page - 1) * limit;

      const where: any = {
        companyId: tenant.companyId,
      };

      if (query.documentType) {
        where.category = query.documentType;
      }

      if (query.partyId) {
        where.partyId = query.partyId;
      }

      if (query.fromDate || query.toDate) {
        where.invoiceDate = {};
        if (query.fromDate) {
          where.invoiceDate.gte = new Date(`${query.fromDate.slice(0, 10)}T00:00:00.000Z`);
        }
        if (query.toDate) {
          where.invoiceDate.lte = new Date(`${query.toDate.slice(0, 10)}T23:59:59.999Z`);
        }
      }

      if (query.search && query.search.trim()) {
        const s = query.search.trim();
        where.OR = [
          { invoiceNumber: { contains: s, mode: "insensitive" } },
          { party: { name: { contains: s, mode: "insensitive" } } },
          { party: { gstin: { contains: s, mode: "insensitive" } } },
        ];
      }

      // Fetch all invoices to compute accurate summary metrics and filter by computed status
      const [allInvoices, recentLogs] = await Promise.all([
        tx.salesInvoice.findMany({
          where,
          include: {
            party: true,
            items: true,
            company: true,
            eInvoiceRecord: true,
          },
          orderBy: { invoiceDate: "desc" },
        }),
        tx.gstApiAuditLog.findMany({
          where: {
            companyId: tenant.companyId,
            operation: "EINVOICE_GENERATE",
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
      ]);

      const logMap = new Map<string, any>();
      for (const log of recentLogs) {
        if (log.documentId && !logMap.has(log.documentId)) {
          logMap.set(log.documentId, log);
        }
      }

      let summary = {
        total: allInvoices.length,
        registered: 0,
        ready: 0,
        draft: 0,
        rejected: 0,
        reconcile: 0,
        cancelled: 0,
      };

      const enrichedRows = allInvoices.map((inv) => {
        let status = "DRAFT";
        const eInv = inv.eInvoiceRecord;
        const lastLog = logMap.get(inv.id);

        if (eInv) {
          if (eInv.status === "ACT") {
            status = "REGISTERED";
            summary.registered++;
          } else if (eInv.status === "CNL") {
            status = "CANCELLED";
            summary.cancelled++;
          }
        } else if (lastLog?.outcome === "PENDING" || lastLog?.outcome === "UNKNOWN") {
          status = "UNKNOWN_RECONCILE";
          summary.reconcile++;
        } else if (lastLog?.outcome === "FAILED" || lastLog?.outcome === "VALIDATION_FAILED") {
          status = "REJECTED";
          summary.rejected++;
        } else {
          const val = this.validateInvoiceData(inv);
          if (val.valid) {
            status = "READY";
            summary.ready++;
          } else {
            status = "DRAFT";
            summary.draft++;
          }
        }

        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
          category: inv.category,
          status: inv.status,
          einvoiceStatus: status,
          partyName: inv.party?.name || "Cash Customer",
          party: {
            id: inv.party?.id,
            name: inv.party?.name || "Cash Customer",
            gstin: inv.party?.gstin || null,
          },
          placeOfSupply: inv.placeOfSupply,
          isIntraState: (inv.placeOfSupply || "").padStart(2, "0") === (inv.company?.stateCode || "").padStart(2, "0"),
          canGenerate: status === "READY" || status === "REJECTED" || status === "DRAFT",
          canCancel: status === "REGISTERED",
          taxableAmount: Number(inv.taxableAmount || 0),
          cgstAmount: Number(inv.cgstAmount || 0),
          sgstAmount: Number(inv.sgstAmount || 0),
          igstAmount: Number(inv.igstAmount || 0),
          cessAmount: Number(inv.cessAmount || 0),
          grandTotal: Number(inv.grandTotal || 0),
          eInvoice: eInv
            ? {
                id: eInv.id,
                irn: eInv.irn,
                ackNo: eInv.ackNo,
                ackDate: eInv.ackDate.toISOString(),
                status: eInv.status,
                cancelReason: eInv.cancelReason,
                cancelledAt: eInv.cancelledAt?.toISOString(),
                environment: eInv.environment,
              }
            : null,
          lastAttempt: lastLog
            ? {
                outcome: lastLog.outcome,
                errorCode: lastLog.errorCode,
                errorMessage: lastLog.errorMessage,
                createdAt: lastLog.createdAt.toISOString(),
              }
            : null,
        };
      });

      // Filter by requested einvoiceStatus if specified
      let filtered = enrichedRows;
      if (query.status && query.status !== "ALL") {
        filtered = enrichedRows.filter((r) => r.einvoiceStatus === query.status);
      }

      const totalFiltered = filtered.length;
      const paginatedItems = filtered.slice(skip, skip + limit);

      return {
        items: paginatedItems,
        total: totalFiltered,
        page,
        limit,
        totalPages: Math.ceil(totalFiltered / limit),
        summary,
      };
    });
  }

  async getEInvoiceDetails(tenant: TenantContext, id: string) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoice = await tx.salesInvoice.findFirst({
        where: { id, companyId: tenant.companyId },
        include: {
          party: true,
          items: {
            include: {
              item: true,
            },
          },
          company: true,
          eInvoiceRecord: true,
        },
      });

      if (!invoice) {
        throw new NotFoundException(`Sales invoice ${id} not found.`);
      }

      const [auditLogs, printSettings] = await Promise.all([
        tx.gstApiAuditLog.findMany({
          where: {
            companyId: tenant.companyId,
            documentId: id,
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        tx.companyInvoicePrintSettings.findUnique({
          where: { companyId: tenant.companyId },
        }),
      ]);

      const validation = this.validateInvoiceData(invoice);

      return {
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
          dueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : null,
          category: invoice.category,
          status: invoice.status,
          paymentMode: invoice.paymentMode,
          placeOfSupply: invoice.placeOfSupply,
          isB2B: invoice.isB2B,
          isReverseCharge: invoice.isReverseCharge,
          subTotal: Number(invoice.subTotal),
          discountTotal: Number(invoice.discountTotal),
          taxableAmount: Number(invoice.taxableAmount),
          cgstAmount: Number(invoice.cgstAmount),
          sgstAmount: Number(invoice.sgstAmount),
          utgstAmount: Number(invoice.utgstAmount),
          igstAmount: Number(invoice.igstAmount),
          cessAmount: Number(invoice.cessAmount),
          roundOff: Number(invoice.roundOff),
          grandTotal: Number(invoice.grandTotal),
          paidAmount: Number(invoice.paidAmount),
          balanceAmount: Number(invoice.balanceAmount),
          billingAddress: invoice.billingAddress,
          shippingAddress: invoice.shippingAddress,
          termsAndConditions: invoice.termsAndConditions,
          notes: invoice.notes,
          party: invoice.party,
          items: invoice.items,
        },
        company: {
          id: invoice.company.id,
          legalName: invoice.company.legalName,
          tradeName: invoice.company.tradeName,
          gstin: invoice.company.gstin,
          stateCode: invoice.company.stateCode,
          addressLine1: invoice.company.addressLine1,
          city: invoice.company.city,
          pincode: invoice.company.pincode,
          phone: invoice.company.phone,
          email: invoice.company.email,
        },
        eInvoice: invoice.eInvoiceRecord
          ? {
              id: invoice.eInvoiceRecord.id,
              irn: invoice.eInvoiceRecord.irn,
              ackNo: invoice.eInvoiceRecord.ackNo,
              ackDate: invoice.eInvoiceRecord.ackDate.toISOString(),
              status: invoice.eInvoiceRecord.status,
              cancelReason: invoice.eInvoiceRecord.cancelReason,
              cancelledAt: invoice.eInvoiceRecord.cancelledAt?.toISOString(),
              signedInvoice: invoice.eInvoiceRecord.signedInvoice,
              signedQrCode: invoice.eInvoiceRecord.signedQrCode,
              environment: invoice.eInvoiceRecord.environment,
              providerName: invoice.eInvoiceRecord.providerName,
              createdAt: invoice.eInvoiceRecord.createdAt.toISOString(),
            }
          : null,
        auditLogs: auditLogs.map((log) => ({
          id: log.id,
          operation: log.operation,
          environment: log.environment,
          outcome: log.outcome,
          errorCode: log.errorCode,
          errorMessage: log.errorMessage,
          idempotencyKey: log.idempotencyKey,
          createdAt: log.createdAt.toISOString(),
        })),
        validation,
      };
    });
  }

  async validateInvoice(tenant: TenantContext, invoiceId: string) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoice = await tx.salesInvoice.findFirst({
        where: { id: invoiceId, companyId: tenant.companyId },
        include: {
          party: true,
          items: { include: { item: true } },
          company: true,
        },
      });

      if (!invoice) {
        throw new NotFoundException(`Sales invoice ${invoiceId} not found.`);
      }

      return this.validateInvoiceData(invoice);
    });
  }

  async generateEInvoice(tenant: TenantContext, invoiceId: string, idempotencyKey?: string) {
    const validation = await this.validateInvoice(tenant, invoiceId);
    if (!validation.valid) {
      throw new BadRequestException({
        message: "Invoice data failed statutory GST e-invoice schema validation.",
        errors: validation.errors,
      });
    }

    return this.portal.generateIrn(tenant, invoiceId, idempotencyKey);
  }

  async reconcileEInvoice(tenant: TenantContext, invoiceId: string) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoice = await tx.salesInvoice.findFirst({
        where: { id: invoiceId, companyId: tenant.companyId },
        include: { items: true, party: true, company: true, eInvoiceRecord: true },
      });

      if (!invoice) {
        throw new NotFoundException(`Sales invoice ${invoiceId} not found.`);
      }

      if (invoice.eInvoiceRecord?.status === "ACT") {
        return {
          outcome: "SUCCEEDED",
          message: "Invoice already has an active, confirmed IRN registered on IRP.",
          record: {
            irn: invoice.eInvoiceRecord.irn,
            ackNo: invoice.eInvoiceRecord.ackNo,
            ackDate: invoice.eInvoiceRecord.ackDate.toISOString(),
            status: invoice.eInvoiceRecord.status,
          },
        };
      }

      const config = await tx.gstIntegrationConfig.findUnique({
        where: { companyId: tenant.companyId },
      });

      // Prepare draft
      const docType: "INV" | "CRN" | "DBN" =
        (invoice.category as any) === "CREDIT_NOTE" ? "CRN" : (invoice.category as any) === "DEBIT_NOTE" ? "DBN" : "INV";
      const docDateStr = invoice.invoiceDate.toISOString().slice(0, 10);
      const [year, month, day] = docDateStr.split("-");
      const nicDate = `${day}/${month}/${year}`;

      // Call provider getIrnByDocDetails
      const resolved = (this.portal as any).resolveFor(invoice.company.gstin, config);
      if (!resolved.ok || !resolved.credentials) {
        return {
          outcome: resolved.code || "CREDENTIALS_UNAVAILABLE",
          message: resolved.message || "Provider credentials not available for reconciliation.",
        };
      }

      const provider = (this.portal as any).provider;
      const prior = await provider.getIrnByDocDetails(
        docType,
        invoice.invoiceNumber,
        nicDate,
        resolved.credentials,
      );

      if (prior.outcome === "SUCCEEDED" && prior.irn && prior.signedQrCode) {
        const record = await tx.eInvoiceRecord.upsert({
          where: { invoiceId },
          create: {
            invoiceId,
            irn: prior.irn,
            ackNo: prior.ackNo || "RECONCILED",
            ackDate: prior.ackDate ? new Date(prior.ackDate) : new Date(),
            signedInvoice: prior.signedInvoice || "",
            signedQrCode: prior.signedQrCode,
            status: "ACT",
            environment: resolved.credentials.environment,
            providerName: "NIC",
            requestHash: "reconciled",
          },
          update: {
            irn: prior.irn,
            ackNo: prior.ackNo || "RECONCILED",
            ackDate: prior.ackDate ? new Date(prior.ackDate) : new Date(),
            signedInvoice: prior.signedInvoice || "",
            signedQrCode: prior.signedQrCode,
            status: "ACT",
            environment: resolved.credentials.environment,
            providerName: "NIC",
            requestHash: "reconciled",
          },
        });

        await tx.gstApiAuditLog.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            operation: "EINVOICE_RECONCILE",
            environment: resolved.credentials.environment,
            idempotencyKey: `einvoice-reconcile:${invoiceId}:${Date.now()}`,
            requestHash: "reconciled",
            outcome: "SUCCEEDED",
            externalDocumentNumber: prior.irn,
            documentId: invoiceId,
          },
        });

        return {
          outcome: "RECOVERED",
          message: "Successfully verified and recovered IRN registration from IRP.",
          record: {
            irn: record.irn,
            ackNo: record.ackNo,
            ackDate: record.ackDate.toISOString(),
            status: record.status,
          },
        };
      } else if (prior.outcome === "NOT_FOUND") {
        return {
          outcome: "NOT_FOUND",
          message: "IRP confirms no IRN exists for this document. You may safely validate and submit.",
        };
      }

      return {
        outcome: prior.outcome || "FAILED",
        message: prior.errorMessage || "Status lookup with IRP could not be completed.",
      };
    });
  }

  async cancelEInvoice(
    tenant: TenantContext,
    invoiceId: string,
    dto: CancelEInvoiceDto,
    idempotencyKey?: string,
  ) {
    if (!dto.reasonCode || !/^[1-4]$/.test(dto.reasonCode)) {
      throw new BadRequestException("Cancellation reason code must be 1 (Duplicate), 2 (Data entry mistake), 3 (Order Cancelled), or 4 (Others).");
    }
    if (!dto.remarks || dto.remarks.trim().length < 10) {
      throw new BadRequestException("Cancellation remarks must be at least 10 characters explaining the reason.");
    }

    return this.portal.cancelIrn(tenant, invoiceId, dto, idempotencyKey);
  }

  async getEInvoicePdf(tenant: TenantContext, invoiceId: string, copyType?: string) {
    return this.printService.generateInvoicePdf(tenant, invoiceId, copyType);
  }

  async getSettings(tenant: TenantContext) {
    const [config, company] = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return Promise.all([
        this.portal.getConfig(tenant),
        tx.company.findUnique({
          where: { id: tenant.companyId },
          select: {
            id: true,
            legalName: true,
            tradeName: true,
            gstin: true,
            stateCode: true,
            addressLine1: true,
            city: true,
            pincode: true,
          },
        }),
      ]);
    });

    return {
      ...config,
      company,
    };
  }

  async saveSettings(tenant: TenantContext, dto: UpdateEInvoiceSettingsDto) {
    return this.portal.saveConfig(tenant, dto);
  }

  async getAuditLogs(tenant: TenantContext, query?: { limit?: number }) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const take = Math.min(100, Math.max(1, Number(query?.limit || 50)));
      const rows = await tx.gstApiAuditLog.findMany({
        where: {
          companyId: tenant.companyId,
          operation: { in: ["EINVOICE_GENERATE", "EINVOICE_CANCEL", "EINVOICE_RECONCILE", "EINVOICE_VALIDATE"] },
        },
        orderBy: { createdAt: "desc" },
        take,
      });

      return { rows };
    });
  }
}
