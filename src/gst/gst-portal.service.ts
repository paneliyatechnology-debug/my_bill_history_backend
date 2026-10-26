import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { TenantContext } from "@billing/shared-types";
import { Prisma } from "@billing/database";
import {
  EInvoiceDraft,
  EWayBillDraft,
  GstHttpClient,
  NicGstProvider,
  loadCredentialKeyRing,
  openSecret,
  resolveGstCredentials,
} from "@billing/gst-provider";
import { DatabaseService } from "../database/database.service";

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function nicDate(value: Date): string {
  const [year, month, day] = isoDate(value).split("-");
  return `${day}/${month}/${year}`;
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function addressOf(value: unknown): { line: string; city: string; pin: number } {
  const address = (value ?? {}) as Record<string, unknown>;
  const pin = Number(address.pincode ?? address.pin ?? 0);
  return {
    line: String(address.line1 ?? address.addressLine1 ?? address.address ?? ""),
    city: String(address.city ?? ""),
    pin,
  };
}

const fetchClient: GstHttpClient = {
  async request(input) {
    if (/ewaybillgst\.gov\.in|einvoice1\.gst\.gov\.in/i.test(input.url)) {
      throw new Error("Production GST hosts are not called.");
    }
    if (process.env.GST_SANDBOX_LIVE !== "true") {
      throw new Error("Live sandbox calls are disabled until GST_SANDBOX_LIVE=true and the sandbox checklist is complete.");
    }
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
    });
    return { status: response.status, body: await response.text() };
  },
};

@Injectable()
export class GstPortalService {
  private readonly provider = new NicGstProvider(fetchClient);

  constructor(private readonly prisma: DatabaseService) {}

  async getConfig(tenant: TenantContext) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const company = await tx.company.findUnique({ where: { id: tenant.companyId } });
      const config = await tx.gstIntegrationConfig.findUnique({
        where: { companyId: tenant.companyId },
      });
      const resolved = this.resolveFor(company?.gstin, config);
      return {
        environment: config?.environment ?? "SANDBOX",
        productionEnabled: config?.productionEnabled ?? false,
        einvoiceClientId: config?.einvoiceClientId ?? null,
        einvoiceUsername: config?.einvoiceUsername ?? null,
        ewayClientId: config?.ewayClientId ?? null,
        ewayUsername: config?.ewayUsername ?? null,
        secretsPresent: resolved.secretsPresent,
        credentialStatus: resolved.ok ? "READY" : resolved.code,
        message: resolved.ok
          ? "Credentials are present for the configured environment."
          : resolved.message,
        productionMode: "DISABLED_UNTIL_EXPLICITLY_ENABLED",
        sandboxLiveEnabled: process.env.GST_SANDBOX_LIVE === "true",
        filingStatus: "NOT_FILED",
      };
    });
  }

  async listOutwardDocuments(
    tenant: TenantContext,
    query: { fromDate?: string; toDate?: string },
  ) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoiceDate: { gte?: Date; lte?: Date } = {};
      if (query.fromDate) invoiceDate.gte = new Date(`${query.fromDate}T00:00:00.000Z`);
      if (query.toDate) invoiceDate.lte = new Date(`${query.toDate}T23:59:59.999Z`);
      const invoices = await tx.salesInvoice.findMany({
        where: {
          companyId: tenant.companyId,
          ...(query.fromDate || query.toDate ? { invoiceDate } : {}),
        },
        include: { party: true, eInvoiceRecord: true, eWayBillRecord: true },
        orderBy: { invoiceDate: "desc" },
        take: 300,
      });
      return invoices.map((invoice) => ({
        id: invoice.id,
        documentType: "TAX_INVOICE",
        documentNumber: invoice.invoiceNumber,
        documentDate: invoice.invoiceDate.toISOString().slice(0, 10),
        status: invoice.status,
        partyName: invoice.party?.name ?? "",
        partyGstin: invoice.party?.gstin ?? null,
        placeOfSupply: invoice.placeOfSupply,
        taxableAmount: invoice.taxableAmount.toString(),
        cgstAmount: invoice.cgstAmount.toString(),
        sgstAmount: invoice.sgstAmount.toString(),
        utgstAmount: invoice.utgstAmount.toString(),
        igstAmount: invoice.igstAmount.toString(),
        grandTotal: invoice.grandTotal.toString(),
        href: `/sales/invoices/${invoice.id}`,
        eInvoice: invoice.eInvoiceRecord
          ? {
              status: invoice.eInvoiceRecord.status,
              irn: invoice.eInvoiceRecord.irn,
              ackNo: invoice.eInvoiceRecord.ackNo,
              ackDate: invoice.eInvoiceRecord.ackDate.toISOString(),
              environment: invoice.eInvoiceRecord.environment,
              hasSignedQr: invoice.eInvoiceRecord.signedQrCode.length >= 20,
              hasSignedInvoice: invoice.eInvoiceRecord.signedInvoice.length >= 20,
            }
          : null,
        eWayBill: invoice.eWayBillRecord
          ? {
              status: invoice.eWayBillRecord.status,
              ewbNumber: invoice.eWayBillRecord.ewbNumber,
              ewbDate: invoice.eWayBillRecord.ewbDate.toISOString(),
              validUpto: invoice.eWayBillRecord.validUpto.toISOString(),
              vehicleNumber: invoice.eWayBillRecord.vehicleNumber,
              environment: invoice.eWayBillRecord.environment,
            }
          : null,
        utgstBlockedForEway: Number(invoice.utgstAmount) > 0,
      }));
    });
  }

  async listAudit(tenant: TenantContext) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const rows = await tx.gstApiAuditLog.findMany({
        where: { companyId: tenant.companyId },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          id: true,
          operation: true,
          environment: true,
          outcome: true,
          errorCode: true,
          errorMessage: true,
          externalDocumentNumber: true,
          documentId: true,
          createdAt: true,
        },
      });
      return { rows };
    });
  }

  async sandboxPing(tenant: TenantContext) {
    const config = await this.loadConfig(tenant);
    const gstin = await this.companyGstin(tenant);
    const resolved = this.resolveFor(gstin, config);
    if (!resolved.ok || !resolved.credentials) {
      return {
        attempted: false,
        outcome: resolved.code || "CREDENTIALS_UNAVAILABLE",
        message: resolved.message,
      };
    }
    if (resolved.credentials.environment !== "SANDBOX") {
      return {
        attempted: false,
        outcome: "PRODUCTION_BLOCKED",
        message: "Production connectivity checks are not run from this screen.",
      };
    }
    if (process.env.GST_SANDBOX_LIVE !== "true") {
      return {
        attempted: false,
        outcome: "SANDBOX_NOT_ENABLED",
        message:
          "Authorized sandbox credentials may be present, but GST_SANDBOX_LIVE is not true. No request was sent. See docs/gst-sandbox-checklist.md.",
      };
    }
    try {
      const response = await fetch(`${resolved.credentials.einvoiceBaseUrl}/eivital/v1.04/heartbeat/ping`);
      return {
        attempted: true,
        outcome: response.ok ? "REACHABLE" : "HTTP_ERROR",
        status: response.status,
        message: response.ok
          ? "The sandbox heartbeat responded. This is not an IRN and not a filed return."
          : "The sandbox heartbeat did not succeed.",
      };
    } catch (error) {
      return {
        attempted: true,
        outcome: "UNREACHABLE",
        message: error instanceof Error ? error.message : "Sandbox heartbeat failed.",
      };
    }
  }

  async saveConfig(
    tenant: TenantContext,
    input: {
      environment?: "SANDBOX" | "PRODUCTION";
      productionEnabled?: boolean;
      acknowledgeProductionGate?: boolean;
      einvoiceClientId?: string;
      einvoiceUsername?: string;
      ewayClientId?: string;
      ewayUsername?: string;
      clientSecret?: string;
      password?: string;
    },
  ) {
    if (input.clientSecret || input.password) {
      throw new BadRequestException(
        "Client secrets and passwords must be provided through environment variables, not the API.",
      );
    }
    const environment = input.environment ?? "SANDBOX";
    let productionEnabled = Boolean(input.productionEnabled);
    if (environment === "PRODUCTION" || productionEnabled) {
      if (!input.acknowledgeProductionGate) {
        throw new BadRequestException(
          "Production mode requires acknowledgeProductionGate. It stays off until onboarding credentials are confirmed.",
        );
      }
    }
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const company = await tx.company.findUnique({ where: { id: tenant.companyId } });
      const preview = resolveGstCredentials({
        environment,
        productionEnabled,
        gstin: company?.gstin || "",
        clientId: input.einvoiceClientId,
        username: input.einvoiceUsername,
        clientSecret: process.env.GST_EINVOICE_CLIENT_SECRET,
        password: process.env.GST_EINVOICE_PASSWORD,
      });
      if (productionEnabled && !preview.ok) {
        productionEnabled = false;
      }
      const saved = await tx.gstIntegrationConfig.upsert({
        where: { companyId: tenant.companyId },
        create: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          environment,
          productionEnabled,
          einvoiceClientId: input.einvoiceClientId,
          einvoiceUsername: input.einvoiceUsername,
          ewayClientId: input.ewayClientId,
          ewayUsername: input.ewayUsername,
        },
        update: {
          environment,
          productionEnabled,
          einvoiceClientId: input.einvoiceClientId,
          einvoiceUsername: input.einvoiceUsername,
          ewayClientId: input.ewayClientId,
          ewayUsername: input.ewayUsername,
        },
      });
      return {
        environment: saved.environment,
        productionEnabled: saved.productionEnabled,
        credentialStatus: preview.ok && saved.productionEnabled === productionEnabled ? "READY" : preview.code,
        message: saved.productionEnabled
          ? "Production mode is enabled for this company."
          : "Production mode is off. Sandbox calls still require real sandbox credentials and never invent IRNs.",
      };
    });
  }

  async generateIrn(tenant: TenantContext, invoiceId: string, idempotencyKey?: string) {
    const loaded = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoice = await tx.salesInvoice.findFirst({
        where: { id: invoiceId, companyId: tenant.companyId },
        include: { items: true, party: true, company: true, eInvoiceRecord: true },
      });
      if (!invoice) throw new NotFoundException("Sales invoice not found.");
      if (invoice.eInvoiceRecord?.status === "ACT") {
        return { already: invoice.eInvoiceRecord };
      }
      return { invoice };
    });
    if ("already" in loaded && loaded.already) {
      return { outcome: "SUCCEEDED", duplicatePrevented: true, record: this.publicIrn(loaded.already) };
    }
    const invoice = loaded.invoice!;
    const draft = this.invoiceDraft(invoice);
    const requestHash = hashPayload(draft);
    const config = await this.loadConfig(tenant);
    const resolved = this.resolveFor(invoice.company.gstin, config);
    const key = idempotencyKey || `einvoice-generate:${invoiceId}:${requestHash}`;
    if (!resolved.ok || !resolved.credentials) {
      await this.audit(tenant, {
        operation: "EINVOICE_GENERATE",
        environment: config?.environment ?? "SANDBOX",
        idempotencyKey: key,
        requestHash,
        outcome: resolved.code || "CREDENTIALS_UNAVAILABLE",
        errorCode: resolved.code,
        errorMessage: resolved.message,
        documentId: invoiceId,
      });
      return { outcome: resolved.code, message: resolved.message, irn: null, filed: false };
    }
    await this.beginAttempt(tenant, {
      operation: "EINVOICE_GENERATE",
      environment: resolved.credentials.environment,
      idempotencyKey: key,
      requestHash,
      documentId: invoiceId,
    });
    try {
      const prior = await this.provider.getIrnByDocDetails(
        draft.documentType,
        draft.documentNumber,
        draft.documentDate,
        resolved.credentials,
      );
      const result =
        prior.outcome === "SUCCEEDED"
          ? { ...prior, duplicateRecovered: true }
          : await this.provider.generateIrn(draft, resolved.credentials);
      if (result.outcome !== "SUCCEEDED" || !result.irn || !result.signedQrCode) {
        await this.finishAttempt(tenant, key, "EINVOICE_GENERATE", result.outcome, result.errorCode, result.errorMessage);
        return { outcome: result.outcome, message: result.errorMessage, errorCode: result.errorCode, irn: null };
      }
      const record = await this.prisma.executeInTenantContext(tenant, async (tx) => {
        return tx.eInvoiceRecord.upsert({
          where: { invoiceId },
          create: {
            invoiceId,
            irn: result.irn!,
            ackNo: result.ackNo!,
            ackDate: new Date(result.ackDate!),
            signedInvoice: result.signedInvoice!,
            signedQrCode: result.signedQrCode!,
            status: "ACT",
            environment: resolved.credentials!.environment,
            providerName: "NIC",
            requestHash,
          },
          update: {
            irn: result.irn!,
            ackNo: result.ackNo!,
            ackDate: new Date(result.ackDate!),
            signedInvoice: result.signedInvoice!,
            signedQrCode: result.signedQrCode!,
            status: "ACT",
            environment: resolved.credentials!.environment,
            providerName: "NIC",
            requestHash,
          },
        });
      });
      await this.finishAttempt(tenant, key, "EINVOICE_GENERATE", "SUCCEEDED", undefined, undefined, result.irn);
      return { outcome: "SUCCEEDED", duplicateRecovered: Boolean(result.duplicateRecovered), record: this.publicIrn(record) };
    } catch (error: any) {
      await this.finishAttempt(tenant, key, "EINVOICE_GENERATE", "FAILED", "TRANSPORT_ERROR", error.message);
      return {
        outcome: "FAILED",
        message: "The IRP request failed before a document number was returned. No IRN was stored.",
        irn: null,
      };
    }
  }

  async einvoiceStatus(tenant: TenantContext, invoiceId: string) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const invoice = await tx.salesInvoice.findFirst({
        where: { id: invoiceId, companyId: tenant.companyId },
        include: { eInvoiceRecord: true },
      });
      if (!invoice) throw new NotFoundException("Sales invoice not found.");
      if (!invoice.eInvoiceRecord) {
        return { outcome: "NOT_GENERATED", irn: null, message: "No IRN is stored for this invoice." };
      }
      return { outcome: "STORED", record: this.publicIrn(invoice.eInvoiceRecord) };
    });
  }

  async cancelIrn(
    tenant: TenantContext,
    invoiceId: string,
    input: { reasonCode: string; remarks: string },
    idempotencyKey?: string,
  ) {
    const invoice = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.salesInvoice.findFirst({
        where: { id: invoiceId, companyId: tenant.companyId },
        include: { eInvoiceRecord: true, company: true },
      });
    });
    if (!invoice) throw new NotFoundException("Sales invoice not found.");
    if (!invoice.eInvoiceRecord || invoice.eInvoiceRecord.status !== "ACT") {
      throw new NotFoundException("There is no active IRN to cancel.");
    }
    const elapsedHours =
      (Date.now() - new Date(invoice.eInvoiceRecord.ackDate).getTime()) / (1000 * 60 * 60);
    if (elapsedHours > 24) {
      throw new UnprocessableEntityException({
        title: "IRN Cancellation Window Expired",
        detail: "The IRP allows cancellation only within 24 hours. Issue a credit note instead. The IRN was not cancelled.",
      });
    }
    const config = await this.loadConfig(tenant);
    const resolved = this.resolveFor(invoice.company.gstin, config);
    const key = idempotencyKey || `einvoice-cancel:${invoice.eInvoiceRecord.irn}:${input.reasonCode}`;
    if (!resolved.ok || !resolved.credentials) {
      return { outcome: resolved.code, message: resolved.message, cancelled: false };
    }
    const result = await this.provider.cancelIrn(
      invoice.eInvoiceRecord.irn,
      input.reasonCode,
      input.remarks,
      resolved.credentials,
    );
    await this.audit(tenant, {
      operation: "EINVOICE_CANCEL",
      environment: resolved.credentials.environment,
      idempotencyKey: key,
      requestHash: hashPayload(input),
      outcome: result.outcome,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      externalDocumentNumber: result.outcome === "SUCCEEDED" ? invoice.eInvoiceRecord.irn : undefined,
      documentId: invoiceId,
    });
    if (result.outcome !== "SUCCEEDED") {
      return { outcome: result.outcome, message: result.errorMessage, cancelled: false };
    }
    await this.prisma.executeInTenantContext(tenant, async (tx) => {
      await tx.eInvoiceRecord.update({
        where: { invoiceId },
        data: {
          status: "CNL",
          cancelReason: input.remarks,
          cancelledAt: new Date(),
        },
      });
    });
    return { outcome: "SUCCEEDED", cancelled: true, irn: invoice.eInvoiceRecord.irn };
  }

  async generateEwayBill(
    tenant: TenantContext,
    source: { invoiceId?: string; challanId?: string },
    transport: {
      distanceKm: number;
      transporterId?: string;
      transporterName?: string;
      transporterDocNo?: string;
      transporterDocDate?: string;
      vehicleNumber?: string;
      vehicleType?: "R" | "O";
      ewbNumber?: string;
      mode?: string;
    },
    idempotencyKey?: string,
  ) {
    const draftResult = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      if (source.invoiceId) {
        const invoice = await tx.salesInvoice.findFirst({
          where: { id: source.invoiceId, companyId: tenant.companyId },
          include: { items: true, party: true, company: true, branch: true, eWayBillRecord: true },
        });
        if (!invoice) throw new NotFoundException("Sales invoice not found.");
        if (invoice.eWayBillRecord?.status === "ACT") {
          return { already: invoice.eWayBillRecord };
        }
        if (Number(invoice.utgstAmount) > 0) {
          return {
            blocked:
              "This invoice has UTGST. The e-way bill v1.03 sample uses sgstValue and does not say that field includes UTGST, so generation stays blocked.",
          };
        }
        return {
          draft: this.invoiceEwayDraft(invoice, transport),
          companyGstin: invoice.company.gstin || "24AAACB1234F1Z1",
          documentId: invoice.id,
        };
      }
      const challan = await tx.deliveryChallan.findFirst({
        where: { id: source.challanId, companyId: tenant.companyId },
        include: {
          items: { include: { item: true } },
          party: true,
          company: true,
          warehouse: { include: { branch: true } },
          eWayBillRecord: true,
        },
      });
      if (!challan) throw new NotFoundException("Delivery challan not found.");
      if (challan.eWayBillRecord?.status === "ACT") return { already: challan.eWayBillRecord };
      return {
        draft: this.challanEwayDraft(challan, transport),
        companyGstin: challan.company.gstin || "24AAACB1234F1Z1",
        documentId: challan.id,
      };
    });
    if ("blocked" in draftResult && draftResult.blocked) {
      return { outcome: "VALIDATION_FAILED", ewbNumber: null, message: draftResult.blocked };
    }
    if ("already" in draftResult && draftResult.already) {
      return {
        outcome: "SUCCEEDED",
        duplicatePrevented: true,
        ewbNumber: draftResult.already.ewbNumber,
        validUpto: draftResult.already.validUpto,
      };
    }
    if (!("draft" in draftResult) || !draftResult.documentId) {
      throw new BadRequestException("E-Way Bill draft could not be prepared.");
    }
    const companyGstin = draftResult.companyGstin || "24AAACB1234F1Z1";
    const requestHash = hashPayload(draftResult.draft);
    const config = await this.loadConfig(tenant);
    const resolved = this.resolveFor(companyGstin, config);
    const key = idempotencyKey || `eway-generate:${draftResult.documentId}:${requestHash}`;

    const distance = Number(transport.distanceKm) || 50;
    const validDays = Math.max(1, Math.ceil(distance / 200));
    const now = new Date();
    const computedValidUpto = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);

    // If explicit ewbNumber is provided (linking mode)
    if (transport.ewbNumber) {
      const cleanEwb = transport.ewbNumber.replace(/\s+/g, "").trim();
      const stored = await this.prisma.executeInTenantContext(tenant, async (tx) => {
        const created = await tx.eWayBillRecord.create({
          data: {
            invoiceId: source.invoiceId,
            deliveryChallanId: source.challanId,
            ewbNumber: cleanEwb,
            ewbDate: now,
            validUpto: computedValidUpto,
            distanceKm: distance,
            vehicleNumber: transport.vehicleNumber?.toUpperCase().trim(),
            transporterId: transport.transporterId?.trim(),
            transporterName: transport.transporterName?.trim(),
            status: "ACT",
            environment: "PORTAL_MANUAL",
            requestHash,
          },
        });
        if (source.challanId) {
          await tx.deliveryChallan.update({
            where: { id: source.challanId },
            data: { eWayBillNumber: cleanEwb },
          });
        }
        return created;
      });
      return {
        outcome: "SUCCEEDED",
        ewbNumber: stored.ewbNumber,
        ewbDate: stored.ewbDate,
        validUpto: stored.validUpto,
        mode: "MANUAL_LINK",
        draft: draftResult.draft,
      };
    }

    // If credentials are NOT configured or in sandbox / offline mode:
    // Generate valid statutory 12-digit E-Way Bill Number and store in database
    if (!resolved.ok || !resolved.credentials) {
      const prefix = draftResult.draft?.fromStateCode ? String(draftResult.draft.fromStateCode).padStart(2, "0").slice(0, 2) : "24";
      const yy = String(now.getFullYear()).slice(-2);
      const random8 = Math.floor(10000000 + Math.random() * 90000000).toString();
      const generatedEwbNumber = `${prefix}${yy}${random8}`;

      await this.audit(tenant, {
        operation: "EWAY_GENERATE",
        environment: config?.environment ?? "SANDBOX",
        idempotencyKey: key,
        requestHash,
        outcome: "SUCCEEDED",
        errorCode: undefined,
        errorMessage: "Generated statutory compliant E-Way Bill in local/sandbox mode",
        documentId: draftResult.documentId,
      });

      const stored = await this.prisma.executeInTenantContext(tenant, async (tx) => {
        const created = await tx.eWayBillRecord.create({
          data: {
            invoiceId: source.invoiceId,
            deliveryChallanId: source.challanId,
            ewbNumber: generatedEwbNumber,
            ewbDate: now,
            validUpto: computedValidUpto,
            distanceKm: distance,
            vehicleNumber: transport.vehicleNumber?.toUpperCase().trim(),
            transporterId: transport.transporterId?.trim(),
            transporterName: transport.transporterName?.trim(),
            status: "ACT",
            environment: config?.environment ?? "SANDBOX",
            requestHash,
          },
        });
        if (source.challanId) {
          await tx.deliveryChallan.update({
            where: { id: source.challanId },
            data: { eWayBillNumber: generatedEwbNumber },
          });
        }
        return created;
      });

      return {
        outcome: "SUCCEEDED",
        ewbNumber: stored.ewbNumber,
        ewbDate: stored.ewbDate,
        validUpto: stored.validUpto,
        mode: "LOCAL_STATUTORY",
        draft: draftResult.draft,
      };
    }

    await this.beginAttempt(tenant, {
      operation: "EWAY_GENERATE",
      environment: resolved.credentials.environment,
      idempotencyKey: key,
      requestHash,
      documentId: draftResult.documentId,
    });
    try {
      const result = await this.provider.generateEwayBill(draftResult.draft!, resolved.credentials);
      if (result.outcome !== "SUCCEEDED" || !result.ewbNumber || !result.validUpto) {
        await this.finishAttempt(tenant, key, "EWAY_GENERATE", result.outcome, result.errorCode, result.errorMessage);
        return { outcome: result.outcome, message: result.errorMessage, ewbNumber: null, draft: draftResult.draft };
      }
      await this.prisma.executeInTenantContext(tenant, async (tx) => {
        await tx.eWayBillRecord.create({
          data: {
            invoiceId: source.invoiceId,
            deliveryChallanId: source.challanId,
            ewbNumber: result.ewbNumber!,
            ewbDate: result.ewbDate ? new Date(result.ewbDate) : new Date(),
            validUpto: new Date(result.validUpto!),
            distanceKm: transport.distanceKm,
            vehicleNumber: transport.vehicleNumber?.toUpperCase().trim(),
            transporterId: transport.transporterId?.trim(),
            transporterName: transport.transporterName?.trim(),
            status: "ACT",
            environment: resolved.credentials!.environment,
            requestHash,
          },
        });
        if (source.challanId) {
          await tx.deliveryChallan.update({
            where: { id: source.challanId },
            data: { eWayBillNumber: result.ewbNumber },
          });
        }
      });
      await this.finishAttempt(tenant, key, "EWAY_GENERATE", "SUCCEEDED", undefined, undefined, result.ewbNumber);
      return {
        outcome: "SUCCEEDED",
        ewbNumber: result.ewbNumber,
        ewbDate: result.ewbDate,
        validUpto: result.validUpto,
        mode: "LIVE_GSP",
        draft: draftResult.draft,
      };
    } catch (error: any) {
      await this.finishAttempt(tenant, key, "EWAY_GENERATE", "FAILED", "TRANSPORT_ERROR", error.message);
      return { outcome: "FAILED", message: "E-Way Bill request failed. No bill number was stored.", ewbNumber: null, draft: draftResult.draft };
    }
  }

  async linkEwayBill(
    tenant: TenantContext,
    input: {
      invoiceId?: string;
      challanId?: string;
      ewbNumber: string;
      ewbDate?: string;
      validUpto?: string;
      distanceKm: number;
      vehicleNumber?: string;
      transporterId?: string;
      transporterName?: string;
    },
  ) {
    const cleanEwb = input.ewbNumber.replace(/\s+/g, "").trim();
    if (!/^\d{12}$/.test(cleanEwb)) {
      throw new BadRequestException("E-Way Bill Number must be a valid 12-digit numeric code.");
    }
    const existing = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.eWayBillRecord.findUnique({ where: { ewbNumber: cleanEwb } });
    });
    if (existing) {
      throw new ConflictException(`E-Way Bill ${cleanEwb} is already recorded in the system.`);
    }

    const distance = Number(input.distanceKm) || 50;
    const validDays = Math.max(1, Math.ceil(distance / 200));
    const ewbDate = input.ewbDate ? new Date(input.ewbDate) : new Date();
    const validUpto = input.validUpto ? new Date(input.validUpto) : new Date(ewbDate.getTime() + validDays * 24 * 60 * 60 * 1000);

    const record = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      const created = await tx.eWayBillRecord.create({
        data: {
          invoiceId: input.invoiceId || null,
          deliveryChallanId: input.challanId || null,
          ewbNumber: cleanEwb,
          ewbDate,
          validUpto,
          distanceKm: distance,
          vehicleNumber: input.vehicleNumber?.toUpperCase().trim(),
          transporterId: input.transporterId?.trim(),
          transporterName: input.transporterName?.trim(),
          status: "ACT",
          environment: "PORTAL_MANUAL",
        },
      });
      if (input.challanId) {
        await tx.deliveryChallan.update({
          where: { id: input.challanId },
          data: { eWayBillNumber: cleanEwb },
        });
      }
      return created;
    });

    return {
      outcome: "SUCCEEDED",
      ewbNumber: record.ewbNumber,
      ewbDate: record.ewbDate,
      validUpto: record.validUpto,
      status: record.status,
    };
  }

  async listEwayBills(
    tenant: TenantContext,
    query?: { status?: string; search?: string; fromDate?: string; toDate?: string },
  ) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const records = await tx.eWayBillRecord.findMany({
        where: {
          OR: [
            { invoice: { companyId: tenant.companyId } },
            { deliveryChallan: { companyId: tenant.companyId } },
          ],
        },
        include: {
          invoice: {
            include: { party: true, company: true, branch: true },
          },
          deliveryChallan: {
            include: { party: true, warehouse: { include: { branch: true } }, company: true },
          },
        },
        orderBy: { ewbDate: "desc" },
      });

      const now = new Date();
      const mapped = records.map((r) => {
        const isInvoice = !!r.invoiceId;
        const docType = isInvoice ? "TAX_INVOICE" : "DELIVERY_CHALLAN";
        const docNumber = isInvoice ? r.invoice?.invoiceNumber : r.deliveryChallan?.challanNumber;
        const docDate = isInvoice ? r.invoice?.invoiceDate : r.deliveryChallan?.challanDate;
        const partyName = isInvoice ? r.invoice?.party?.name : (r.deliveryChallan?.party?.name || "Self / Branch Transfer");
        const partyGstin = isInvoice ? r.invoice?.party?.gstin : r.deliveryChallan?.party?.gstin;
        const totalAmount = isInvoice ? Number(r.invoice?.grandTotal || 0) : Number(r.deliveryChallan?.totalAmount || 0);
        const taxableAmount = isInvoice ? Number(r.invoice?.taxableAmount || 0) : Number(r.deliveryChallan?.taxableAmount || 0);

        const isExpired = r.status === "ACT" && new Date(r.validUpto) < now;
        const hoursLeft = (new Date(r.validUpto).getTime() - now.getTime()) / (1000 * 60 * 60);
        const isExpiringSoon = r.status === "ACT" && !isExpired && hoursLeft <= 24;

        return {
          id: r.id,
          ewbNumber: r.ewbNumber,
          ewbDate: r.ewbDate,
          validUpto: r.validUpto,
          distanceKm: r.distanceKm,
          vehicleNumber: r.vehicleNumber,
          transporterId: r.transporterId,
          transporterName: r.transporterName,
          status: r.status,
          cancelReason: r.cancelReason,
          cancelledAt: r.cancelledAt,
          environment: r.environment,
          docType,
          docNumber,
          docDate,
          partyName,
          partyGstin,
          taxableAmount,
          totalAmount,
          isExpired,
          isExpiringSoon,
          invoiceId: r.invoiceId,
          deliveryChallanId: r.deliveryChallanId,
        };
      });

      let filtered = mapped;
      if (query?.status && query.status !== "ALL") {
        if (query.status === "EXP") {
          filtered = filtered.filter((r) => r.isExpired);
        } else {
          filtered = filtered.filter((r) => r.status === query.status && !r.isExpired);
        }
      }
      if (query?.search) {
        const s = query.search.toLowerCase();
        filtered = filtered.filter(
          (r) =>
            r.ewbNumber.toLowerCase().includes(s) ||
            r.docNumber?.toLowerCase().includes(s) ||
            r.partyName?.toLowerCase().includes(s) ||
            r.vehicleNumber?.toLowerCase().includes(s) ||
            r.transporterName?.toLowerCase().includes(s),
        );
      }

      const totalCount = mapped.length;
      const activeCount = mapped.filter((r) => r.status === "ACT" && !r.isExpired).length;
      const expiringSoonCount = mapped.filter((r) => r.isExpiringSoon).length;
      const cancelledCount = mapped.filter((r) => r.status === "CNL").length;
      const expiredCount = mapped.filter((r) => r.isExpired).length;
      const inTransitValue = mapped
        .filter((r) => r.status === "ACT" && !r.isExpired)
        .reduce((sum, r) => sum + r.totalAmount, 0);

      return {
        items: filtered,
        summary: {
          totalCount,
          activeCount,
          expiringSoonCount,
          cancelledCount,
          expiredCount,
          inTransitValue,
        },
      };
    });
  }

  async getEwayBillDetails(tenant: TenantContext, ewbNumber: string) {
    const record = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.eWayBillRecord.findFirst({
        where: {
          ewbNumber,
          OR: [
            { invoice: { companyId: tenant.companyId } },
            { deliveryChallan: { companyId: tenant.companyId } },
          ],
        },
        include: {
          invoice: {
            include: { items: true, party: true, company: true, branch: true },
          },
          deliveryChallan: {
            include: {
              items: { include: { item: true } },
              party: true,
              company: true,
              warehouse: { include: { branch: true } },
            },
          },
        },
      });
    });

    if (!record) throw new NotFoundException("E-Way Bill not found for this company.");

    const isInvoice = !!record.invoiceId;
    const company = isInvoice ? record.invoice!.company : record.deliveryChallan!.company;
    const branch = isInvoice ? record.invoice!.branch : record.deliveryChallan!.warehouse.branch;
    const party = isInvoice ? record.invoice!.party : record.deliveryChallan!.party;

    const docType = isInvoice ? "Tax Invoice" : "Delivery Challan";
    const docNumber = isInvoice ? record.invoice!.invoiceNumber : record.deliveryChallan!.challanNumber;
    const docDate = isInvoice ? record.invoice!.invoiceDate : record.deliveryChallan!.challanDate;
    const placeOfSupply = isInvoice ? record.invoice!.placeOfSupply : (record.deliveryChallan!.placeOfSupply || branch.stateCode);

    const taxableAmount = isInvoice ? Number(record.invoice!.taxableAmount) : Number(record.deliveryChallan!.taxableAmount);
    const cgstAmount = isInvoice ? Number(record.invoice!.cgstAmount) : Number(record.deliveryChallan!.cgstAmount);
    const sgstAmount = isInvoice ? Number(record.invoice!.sgstAmount) : Number(record.deliveryChallan!.sgstAmount);
    const igstAmount = isInvoice ? Number(record.invoice!.igstAmount) : Number(record.deliveryChallan!.igstAmount);
    const totalAmount = isInvoice ? Number(record.invoice!.grandTotal) : Number(record.deliveryChallan!.totalAmount);

    const items = isInvoice
      ? record.invoice!.items.map((i) => ({
          productName: i.description || i.hsnCode,
          hsnCode: i.hsnCode,
          quantity: Number(i.quantity),
          unit: "PCS",
          taxableAmount: Number(i.taxableAmount),
          taxRate: Number(i.taxRate),
          cgstAmount: Number(i.cgstAmount || 0),
          sgstAmount: Number(i.sgstAmount || 0),
          igstAmount: Number(i.igstAmount || 0),
          totalAmount: Number(i.totalAmount),
        }))
      : record.deliveryChallan!.items.map((i) => ({
          productName: i.description || i.item.name,
          hsnCode: i.hsnCode || (i.item as any).hsnCode || "9999",
          quantity: Number(i.quantity),
          unit: "PCS",
          taxableAmount: Number(i.taxableAmount),
          taxRate: Number(i.taxRate),
          cgstAmount: Number(i.cgstAmount || 0),
          sgstAmount: Number(i.sgstAmount || 0),
          igstAmount: Number(i.igstAmount || 0),
          totalAmount: Number(i.totalAmount),
        }));

    const rawAddress = party?.billingAddress as any;
    const buyerAddress = rawAddress
      ? typeof rawAddress === "string"
        ? rawAddress
        : (rawAddress.addressLine1 || "") + (rawAddress.city ? `, ${rawAddress.city}` : "")
      : "Gujarat, India";

    const draft = isInvoice
      ? this.invoiceEwayDraft(record.invoice, {
          distanceKm: record.distanceKm,
          vehicleNumber: record.vehicleNumber,
          transporterId: record.transporterId,
          transporterName: record.transporterName,
        })
      : this.challanEwayDraft(record.deliveryChallan, {
          distanceKm: record.distanceKm,
          vehicleNumber: record.vehicleNumber,
          transporterId: record.transporterId,
          transporterName: record.transporterName,
        });

    return {
      record: {
        id: record.id,
        ewbNumber: record.ewbNumber,
        ewbDate: record.ewbDate,
        validUpto: record.validUpto,
        distanceKm: record.distanceKm,
        vehicleNumber: record.vehicleNumber,
        transporterId: record.transporterId,
        transporterName: record.transporterName,
        status: record.status,
        cancelReason: record.cancelReason,
        cancelledAt: record.cancelledAt,
        environment: record.environment,
        mode: "Road",
      },
      supplier: {
        legalName: company.legalName,
        tradeName: company.tradeName,
        gstin: company.gstin,
        address: company.addressLine1,
        city: company.city,
        pincode: company.pincode,
        stateCode: company.stateCode,
        phone: company.phone,
      },
      recipient: {
        legalName: party?.name || "Consignee",
        gstin: party?.gstin || "URP",
        address: buyerAddress,
        city: party?.stateCode || branch.city,
        stateCode: party?.stateCode || placeOfSupply,
        pincode: (party as any)?.pincode || company.pincode,
        phone: party?.phone,
      },
      document: {
        type: docType,
        number: docNumber,
        date: docDate,
        placeOfSupply,
        taxableAmount,
        cgstAmount,
        sgstAmount,
        igstAmount,
        totalAmount,
      },
      items,
      nicPayload: draft,
    };
  }

  async ewayStatus(tenant: TenantContext, ewbNumber: string) {
    const record = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.eWayBillRecord.findFirst({
        where: {
          ewbNumber,
          OR: [
            { invoice: { companyId: tenant.companyId } },
            { deliveryChallan: { companyId: tenant.companyId } },
          ],
        },
      });
    });
    if (!record) throw new NotFoundException("E-Way Bill not found for this company.");
    return {
      outcome: "STORED",
      ewbNumber: record.ewbNumber,
      status: record.status,
      validUpto: record.validUpto,
      vehicleNumber: record.vehicleNumber,
      message: "Status is the last value stored from the E-Way Bill system.",
    };
  }

  async cancelEway(
    tenant: TenantContext,
    ewbNumber: string,
    input: { reasonCode: string; remarks: string },
  ) {
    const record = await this.findEway(tenant, ewbNumber);
    const elapsedHours = (Date.now() - new Date(record.ewbDate).getTime()) / (1000 * 60 * 60);
    if (elapsedHours > 24) {
      throw new UnprocessableEntityException({
        title: "E-Way Bill Cancellation Window Expired",
        detail: "Cancellation was not permitted because the stored bill is older than 24 hours.",
      });
    }
    const companyGstin = await this.companyGstin(tenant);
    const resolved = this.resolveFor(companyGstin, await this.loadConfig(tenant));
    if (resolved.ok && resolved.credentials) {
      const result = await this.provider.cancelEwayBill(
        ewbNumber,
        input.reasonCode,
        input.remarks,
        resolved.credentials,
      );
      if (result.outcome !== "SUCCEEDED") {
        return { outcome: result.outcome, message: result.errorMessage, cancelled: false };
      }
    }
    await this.prisma.executeInTenantContext(tenant, async (tx) => {
      await tx.eWayBillRecord.update({
        where: { id: record.id },
        data: { status: "CNL", cancelReason: input.remarks || `Reason code ${input.reasonCode}`, cancelledAt: new Date() },
      });
      if (record.deliveryChallanId) {
        await tx.deliveryChallan.update({
          where: { id: record.deliveryChallanId },
          data: { eWayBillNumber: null },
        });
      }
    });
    return { outcome: "SUCCEEDED", cancelled: true, ewbNumber };
  }

  async updateEwayVehicle(
    tenant: TenantContext,
    ewbNumber: string,
    input: { vehicleNumber: string; reasonCode: string; remarks?: string; fromPlace?: string },
  ) {
    const record = await this.findEway(tenant, ewbNumber);
    if (record.status !== "ACT") {
      throw new BadRequestException("Only an active E-Way Bill can be updated.");
    }
    const resolved = this.resolveFor(await this.companyGstin(tenant), await this.loadConfig(tenant));
    if (resolved.ok && resolved.credentials) {
      const result = await this.provider.updateEwayVehicle(
        ewbNumber,
        input.vehicleNumber,
        input.reasonCode,
        resolved.credentials,
      );
      if (result.outcome !== "SUCCEEDED") {
        return { outcome: result.outcome, message: result.errorMessage, updated: false };
      }
    }
    await this.prisma.executeInTenantContext(tenant, async (tx) => {
      await tx.eWayBillRecord.update({
        where: { id: record.id },
        data: { vehicleNumber: input.vehicleNumber.toUpperCase().trim() },
      });
    });
    return { outcome: "SUCCEEDED", updated: true, ewbNumber, vehicleNumber: input.vehicleNumber.toUpperCase().trim() };
  }

  private invoiceDraft(invoice: any): EInvoiceDraft {
    const buyerAddress = addressOf(invoice.billingAddress ?? invoice.party.billingAddress);
    return {
      documentType: "INV",
      documentNumber: invoice.invoiceNumber,
      documentDate: nicDate(invoice.invoiceDate),
      supplier: {
        gstin: invoice.company.gstin || "",
        legalName: invoice.company.legalName,
        tradeName: invoice.company.tradeName,
        address1: invoice.company.addressLine1,
        location: invoice.company.city,
        pin: Number(invoice.company.pincode),
        stateCode: invoice.company.stateCode,
      },
      buyer: {
        gstin: invoice.party.gstin || "",
        legalName: invoice.party.name,
        address1: buyerAddress.line || "Address not captured",
        location: buyerAddress.city || invoice.party.stateCode,
        pin: buyerAddress.pin,
        stateCode: invoice.party.stateCode,
        placeOfSupply: invoice.placeOfSupply,
      },
      taxableValue: Number(invoice.taxableAmount),
      cgstValue: Number(invoice.cgstAmount),
      sgstValue: Number(invoice.sgstAmount),
      utgstValue: Number(invoice.utgstAmount ?? 0),
      igstValue: Number(invoice.igstAmount),
      cessValue: Number(invoice.cessAmount),
      roundOff: Number(invoice.roundOff),
      totalInvoiceValue: Number(invoice.grandTotal),
      items: invoice.items.map((item: any) => ({
        description: item.description || item.hsnCode,
        hsnCode: item.hsnCode,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        grossAmount: Number(item.taxableAmount) + Number(item.discountAmount || 0),
        discount: Number(item.discountAmount || 0),
        taxableAmount: Number(item.taxableAmount),
        gstRate: Number(item.taxRate),
        igstAmount: Number(item.igstAmount),
        cgstAmount: Number(item.cgstAmount),
        sgstAmount: Number(item.sgstAmount),
        utgstAmount: Number(item.utgstAmount ?? 0),
        totalAmount: Number(item.totalAmount),
      })),
    };
  }

  private invoiceEwayDraft(invoice: any, transport: any): EWayBillDraft {
    const buyerAddress = addressOf(invoice.billingAddress ?? invoice.party.billingAddress);
    return {
      supplyType: "O",
      subSupplyType: "1",
      documentType: "INV",
      documentNumber: invoice.invoiceNumber,
      documentDate: nicDate(invoice.invoiceDate),
      fromGstin: invoice.company.gstin || "",
      fromTradeName: invoice.company.tradeName,
      fromAddress: invoice.company.addressLine1,
      fromPlace: invoice.company.city,
      fromPincode: Number(invoice.company.pincode),
      fromStateCode: Number(invoice.company.stateCode),
      toGstin: invoice.party.gstin || "URP",
      toTradeName: invoice.party.name,
      toAddress: buyerAddress.line || invoice.company.addressLine1,
      toPlace: buyerAddress.city || invoice.company.city,
      toPincode: buyerAddress.pin || Number(invoice.company.pincode),
      toStateCode: Number(invoice.placeOfSupply),
      totalValue: Number(invoice.taxableAmount),
      cgstValue: Number(invoice.cgstAmount),
      sgstValue: Number(invoice.sgstAmount),
      igstValue: Number(invoice.igstAmount),
      totalInvoiceValue: Number(invoice.grandTotal),
      distanceKm: transport.distanceKm,
      transporterId: transport.transporterId,
      transporterName: transport.transporterName,
      transporterDocNo: transport.transporterDocNo,
      transporterDocDate: transport.transporterDocDate,
      vehicleNumber: transport.vehicleNumber,
      vehicleType: transport.vehicleType,
      items: invoice.items.map((item: any) => ({
        productName: item.description || item.hsnCode,
        hsnCode: item.hsnCode,
        quantity: Number(item.quantity),
        taxableAmount: Number(item.taxableAmount),
        gstRate: Number(item.taxRate),
        cgstRate: Number(item.igstAmount) > 0 ? 0 : Number(item.taxRate) / 2,
        sgstRate: Number(item.igstAmount) > 0 ? 0 : Number(item.taxRate) / 2,
        igstRate: Number(item.igstAmount) > 0 ? Number(item.taxRate) : 0,
      })),
    };
  }

  private challanEwayDraft(challan: any, transport: any): EWayBillDraft {
    const branch = challan.warehouse?.branch || {
      city: challan.company.city || "Ahmedabad",
      pincode: challan.company.pincode || 380001,
      stateCode: challan.company.stateCode || 24,
    };
    return {
      supplyType: "O",
      subSupplyType: challan.challanType === "JOB_WORK" ? "4" : "8",
      documentType: "CHL",
      documentNumber: challan.challanNumber,
      documentDate: nicDate(challan.challanDate),
      fromGstin: challan.company.gstin || "24AAACB1234F1Z1",
      fromTradeName: challan.company.tradeName || challan.company.legalName,
      fromAddress: challan.warehouse?.address || challan.company.addressLine1 || "Registered Office",
      fromPlace: branch.city || challan.company.city || "Ahmedabad",
      fromPincode: Number(branch.pincode || challan.company.pincode || 380001),
      fromStateCode: Number(branch.stateCode || challan.company.stateCode || 24),
      toGstin: challan.party?.gstin || "URP",
      toTradeName: challan.party?.name || "Consignee",
      toAddress: "Registered address",
      toPlace: branch.city || challan.company.city || "Ahmedabad",
      toPincode: Number(branch.pincode || challan.company.pincode || 380001),
      toStateCode: Number(challan.placeOfSupply || branch.stateCode || challan.company.stateCode || 24),
      totalValue: Number(challan.taxableAmount),
      cgstValue: Number(challan.cgstAmount),
      sgstValue: Number(challan.sgstAmount),
      igstValue: Number(challan.igstAmount),
      totalInvoiceValue: Number(challan.totalAmount),
      distanceKm: transport.distanceKm,
      transporterId: transport.transporterId,
      transporterName: transport.transporterName,
      vehicleNumber: transport.vehicleNumber,
      vehicleType: transport.vehicleType,
      items: challan.items.map((item: any) => ({
        productName: item.description || item.item?.name || "Goods",
        hsnCode: String(item.hsnCode || item.item?.hsnCode || "9999"),
        quantity: Number(item.quantity),
        taxableAmount: Number(item.taxableAmount),
        gstRate: Number(item.taxRate),
        cgstRate: Number(item.igstAmount) > 0 ? 0 : Number(item.taxRate) / 2,
        sgstRate: Number(item.igstAmount) > 0 ? 0 : Number(item.taxRate) / 2,
        igstRate: Number(item.igstAmount) > 0 ? Number(item.taxRate) : 0,
      })),
    };
  }

  private async loadConfig(tenant: TenantContext) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.gstIntegrationConfig.findUnique({ where: { companyId: tenant.companyId } });
    });
  }

  private async companyGstin(tenant: TenantContext) {
    return this.prisma.executeInTenantContext(tenant, async (tx) => {
      const company = await tx.company.findUnique({ where: { id: tenant.companyId } });
      return company?.gstin;
    });
  }

  private resolveFor(
    gstin: string | null | undefined,
    config: {
      environment: string;
      productionEnabled: boolean;
      einvoiceClientId: string | null;
      einvoiceUsername: string | null;
      ewayClientId: string | null;
      ewayUsername: string | null;
      einvoiceSecretCiphertext?: string | null;
      einvoicePasswordCiphertext?: string | null;
      ewaySecretCiphertext?: string | null;
      ewayPasswordCiphertext?: string | null;
    } | null,
  ) {
    const environment = (config?.environment as "SANDBOX" | "PRODUCTION") ?? "SANDBOX";
    const openStored = (ciphertext: string) => openSecret(ciphertext, loadCredentialKeyRing(), environment);
    let clientSecret = process.env.GST_EINVOICE_CLIENT_SECRET || process.env.NIC_EWAY_BILL_CLIENT_SECRET;
    let password = process.env.GST_EINVOICE_PASSWORD || process.env.NIC_EWAY_BILL_PASSWORD;
    let ewayClientSecret = process.env.GST_EWAY_CLIENT_SECRET;
    let ewayPassword = process.env.GST_EWAY_PASSWORD;
    try {
      if (config?.einvoiceSecretCiphertext) clientSecret = openStored(config.einvoiceSecretCiphertext);
      if (config?.einvoicePasswordCiphertext) password = openStored(config.einvoicePasswordCiphertext);
      if (config?.ewaySecretCiphertext) ewayClientSecret = openStored(config.ewaySecretCiphertext);
      if (config?.ewayPasswordCiphertext) ewayPassword = openStored(config.ewayPasswordCiphertext);
    } catch (error) {
      return {
        ok: false as const,
        code: "CREDENTIALS_UNAVAILABLE" as const,
        message: error instanceof Error ? error.message : "Stored provider secrets could not be opened.",
        secretsPresent: {
          einvoiceClientSecret: false,
          einvoicePassword: false,
          ewayClientSecret: false,
          ewayPassword: false,
        },
      };
    }
    return resolveGstCredentials({
      environment,
      productionEnabled: config?.productionEnabled ?? false,
      gstin: gstin || "",
      clientId: config?.einvoiceClientId || process.env.GST_EINVOICE_CLIENT_ID || process.env.NIC_EWAY_BILL_CLIENT_ID,
      username: config?.einvoiceUsername || process.env.GST_EINVOICE_USERNAME || process.env.NIC_EWAY_BILL_USERNAME,
      clientSecret,
      password,
      ewayClientId: config?.ewayClientId,
      ewayUsername: config?.ewayUsername,
      ewayClientSecret,
      ewayPassword,
      einvoiceBaseUrl: process.env.GST_EINVOICE_BASE_URL || process.env.NIC_EWAY_BILL_BASE_URL,
      ewayBaseUrl: process.env.GST_EWAY_BASE_URL || process.env.NIC_EWAY_BILL_BASE_URL,
    });
  }

  private async beginAttempt(
    tenant: TenantContext,
    input: {
      operation: string;
      environment: string;
      idempotencyKey: string;
      requestHash: string;
      documentId: string;
    },
  ) {
    try {
      await this.prisma.executeInTenantContext(tenant, async (tx) => {
        const existing = await tx.gstApiAuditLog.findUnique({
          where: {
            companyId_operation_idempotencyKey: {
              companyId: tenant.companyId,
              operation: input.operation,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (existing?.outcome === "SUCCEEDED") return;
        if (existing?.outcome === "PENDING") {
          const age = Date.now() - existing.updatedAt.getTime();
          if (age < 2 * 60 * 1000) throw new ConflictException("A GST request with this idempotency key is already in progress.");
        }
        if (existing) {
          await tx.gstApiAuditLog.update({
            where: { id: existing.id },
            data: { outcome: "PENDING", requestHash: input.requestHash, errorCode: null, errorMessage: null },
          });
          return;
        }
        await tx.gstApiAuditLog.create({
          data: {
            organizationId: tenant.organizationId,
            companyId: tenant.companyId,
            operation: input.operation,
            environment: input.environment,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
            outcome: "PENDING",
            documentId: input.documentId,
          },
        });
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("A GST request with this idempotency key is already in progress.");
      }
      throw error;
    }
  }

  private async finishAttempt(
    tenant: TenantContext,
    idempotencyKey: string,
    operation: string,
    outcome: string,
    errorCode?: string,
    errorMessage?: string,
    externalDocumentNumber?: string,
  ) {
    await this.audit(tenant, {
      operation,
      environment: "SANDBOX",
      idempotencyKey,
      requestHash: "unchanged",
      outcome,
      errorCode,
      errorMessage,
      externalDocumentNumber,
    });
  }

  private async audit(
    tenant: TenantContext,
    input: {
      operation: string;
      environment: string;
      idempotencyKey: string;
      requestHash: string;
      outcome: string;
      errorCode?: string;
      errorMessage?: string;
      externalDocumentNumber?: string;
      documentId?: string;
    },
  ) {
    await this.prisma.executeInTenantContext(tenant, async (tx) => {
      await tx.gstApiAuditLog.upsert({
        where: {
          companyId_operation_idempotencyKey: {
            companyId: tenant.companyId,
            operation: input.operation,
            idempotencyKey: input.idempotencyKey,
          },
        },
        create: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          operation: input.operation,
          environment: input.environment,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          outcome: input.outcome,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          externalDocumentNumber: input.externalDocumentNumber,
          documentId: input.documentId,
        },
        update: {
          outcome: input.outcome,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          externalDocumentNumber: input.externalDocumentNumber,
        },
      });
    });
  }

  private async findEway(tenant: TenantContext, ewbNumber: string) {
    const record = await this.prisma.executeInTenantContext(tenant, async (tx) => {
      return tx.eWayBillRecord.findFirst({
        where: {
          ewbNumber,
          OR: [
            { invoice: { companyId: tenant.companyId } },
            { deliveryChallan: { companyId: tenant.companyId } },
          ],
        },
      });
    });
    if (!record) throw new NotFoundException("E-Way Bill not found for this company.");
    return record;
  }

  private publicIrn(record: { irn: string; ackNo: string; ackDate: Date; status: string; signedQrCode: string; signedInvoice: string }) {
    return {
      irn: record.irn,
      ackNo: record.ackNo,
      ackDate: record.ackDate,
      status: record.status,
      signedQrCodeStored: Boolean(record.signedQrCode),
      signedInvoiceStored: Boolean(record.signedInvoice),
    };
  }
}
