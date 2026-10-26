import { GstRuntimeCredentials } from "./credentials";

export interface EInvoiceParty {
  gstin: string;
  legalName: string;
  tradeName?: string;
  address1: string;
  location: string;
  pin: number;
  stateCode: string;
  placeOfSupply?: string;
}

export interface EInvoiceLine {
  description: string;
  hsnCode: string;
  isService?: boolean;
  quantity: number;
  unit?: string;
  unitPrice: number;
  grossAmount: number;
  discount: number;
  taxableAmount: number;
  gstRate: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  utgstAmount?: number;
  totalAmount: number;
}

export interface EInvoiceDraft {
  documentType: "INV" | "CRN" | "DBN";
  documentNumber: string;
  documentDate: string;
  supplier: EInvoiceParty;
  buyer: EInvoiceParty;
  taxableValue: number;
  cgstValue: number;
  sgstValue: number;
  utgstValue?: number;
  igstValue: number;
  cessValue: number;
  roundOff: number;
  totalInvoiceValue: number;
  items: EInvoiceLine[];
}

export interface EInvoiceProviderResult {
  outcome:
    | "SUCCEEDED"
    | "VALIDATION_FAILED"
    | "CREDENTIALS_UNAVAILABLE"
    | "PRODUCTION_NOT_ENABLED"
    | "FAILED"
    | "NOT_FOUND"
    | "UNKNOWN";
  irn?: string;
  ackNo?: string;
  ackDate?: string;
  signedInvoice?: string;
  signedQrCode?: string;
  errorCode?: string;
  errorMessage?: string;
  duplicateRecovered?: boolean;
}

export interface EWayBillDraft {
  supplyType: "O" | "I";
  subSupplyType: string;
  documentType: "INV" | "CHL" | "BIL";
  documentNumber: string;
  documentDate: string;
  fromGstin: string;
  fromTradeName: string;
  fromAddress: string;
  fromPlace: string;
  fromPincode: number;
  fromStateCode: number;
  toGstin: string;
  toTradeName: string;
  toAddress: string;
  toPlace: string;
  toPincode: number;
  toStateCode: number;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  totalInvoiceValue: number;
  distanceKm: number;
  transporterId?: string;
  transporterName?: string;
  transporterDocNo?: string;
  transporterDocDate?: string;
  vehicleNumber?: string;
  vehicleType?: "R" | "O";
  items: Array<{
    productName: string;
    hsnCode: string;
    quantity: number;
    taxableAmount: number;
    gstRate: number;
    cgstRate: number;
    sgstRate: number;
    igstRate: number;
  }>;
}

export interface EWayProviderResult {
  outcome: EInvoiceProviderResult["outcome"];
  ewbNumber?: string;
  ewbDate?: string;
  validUpto?: string;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface GstHttpClient {
  request(input: {
    url: string;
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; body: string }>;
}

export function validateEInvoiceDraft(draft: EInvoiceDraft): string[] {
  const errors: string[] = [];
  if (!["INV", "CRN", "DBN"].includes(draft.documentType)) errors.push("Document type must be INV, CRN, or DBN.");
  if (!draft.documentNumber || draft.documentNumber.length > 16) {
    errors.push("IRP document number is required and must be at most 16 characters.");
  }
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(draft.documentDate)) {
    errors.push("Document date must be DD/MM/YYYY.");
  }
  for (const party of [
    ["Supplier", draft.supplier],
    ["Buyer", draft.buyer],
  ] as const) {
    if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(party[1].gstin)) errors.push(`${party[0]} GSTIN is invalid.`);
    if (!party[1].legalName) errors.push(`${party[0]} legal name is required.`);
    if (!party[1].address1) errors.push(`${party[0]} address is required.`);
    if (!party[1].location) errors.push(`${party[0]} location is required.`);
    if (!/^[1-9][0-9]{5}$/.test(String(party[1].pin))) errors.push(`${party[0]} PIN must be 6 digits.`);
    if (!/^\d{2}$/.test(party[1].stateCode)) errors.push(`${party[0]} state code is required.`);
  }
  if (draft.items.length === 0) errors.push("At least one item is required.");
  draft.items.forEach((item, index) => {
    if (!item.hsnCode) errors.push(`Item ${index + 1} HSN is required.`);
    if (item.quantity <= 0) errors.push(`Item ${index + 1} quantity must be positive.`);
  });
  const componentSum =
    draft.taxableValue +
    draft.cgstValue +
    draft.sgstValue +
    (draft.utgstValue ?? 0) +
    draft.igstValue +
    draft.cessValue +
    draft.roundOff;
  if (Math.abs(componentSum - draft.totalInvoiceValue) > 0.05) {
    errors.push("Taxable value, tax, cess, and round-off do not add up to the invoice total.");
  }
  return errors;
}

export function validateEWayDraft(draft: EWayBillDraft): string[] {
  const errors: string[] = [];
  if (!draft.documentNumber) errors.push("Document number is required.");
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(draft.documentDate)) errors.push("Document date must be DD/MM/YYYY.");
  if (!draft.fromGstin) errors.push("From GSTIN is required.");
  if (!draft.toGstin) errors.push("To GSTIN is required. Use URP for an unregistered recipient.");
  if (!Number.isFinite(draft.distanceKm) || draft.distanceKm <= 0) errors.push("Distance must be greater than zero.");
  if (!draft.transporterId && !draft.vehicleNumber) {
    errors.push("Either a transporter ID or a vehicle number is required.");
  }
  if (draft.items.length === 0) errors.push("At least one item is required.");
  draft.items.forEach((item, index) => {
    if (!item.hsnCode) errors.push(`Item ${index + 1} HSN is required.`);
  });
  return errors;
}

function toNicDate(isoOrDmy: string): string {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(isoOrDmy)) return isoOrDmy;
  const [year, month, day] = isoOrDmy.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function stateOrUtTax(sgst: number, utgst?: number): number {
  return Math.round((sgst + (utgst ?? 0)) * 100) / 100;
}

export function buildEInvoicePayload(draft: EInvoiceDraft) {
  return {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N" },
    DocDtls: { Typ: draft.documentType, No: draft.documentNumber, Dt: draft.documentDate },
    SellerDtls: {
      Gstin: draft.supplier.gstin,
      LglNm: draft.supplier.legalName,
      TrdNm: draft.supplier.tradeName || draft.supplier.legalName,
      Addr1: draft.supplier.address1,
      Loc: draft.supplier.location,
      Pin: draft.supplier.pin,
      Stcd: draft.supplier.stateCode,
    },
    BuyerDtls: {
      Gstin: draft.buyer.gstin,
      LglNm: draft.buyer.legalName,
      Pos: draft.buyer.placeOfSupply || draft.buyer.stateCode,
      Addr1: draft.buyer.address1,
      Loc: draft.buyer.location,
      Pin: draft.buyer.pin,
      Stcd: draft.buyer.stateCode,
    },
    ItemList: draft.items.map((item, index) => ({
      SlNo: String(index + 1),
      PrdDesc: item.description,
      IsServc: item.isService ? "Y" : "N",
      HsnCd: item.hsnCode,
      Qty: item.quantity,
      Unit: item.unit || "NOS",
      UnitPrice: item.unitPrice,
      TotAmt: item.grossAmount,
      Discount: item.discount,
      AssAmt: item.taxableAmount,
      GstRt: item.gstRate,
      IgstAmt: item.igstAmount,
      CgstAmt: item.cgstAmount,
      SgstAmt: stateOrUtTax(item.sgstAmount, item.utgstAmount),
      TotItemVal: item.totalAmount,
    })),
    ValDtls: {
      AssVal: draft.taxableValue,
      CgstVal: draft.cgstValue,
      SgstVal: stateOrUtTax(draft.sgstValue, draft.utgstValue),
      IgstVal: draft.igstValue,
      CesVal: draft.cessValue,
      RndOffAmt: draft.roundOff,
      TotInvVal: draft.totalInvoiceValue,
    },
  };
}

function parseJson(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function unwrapData(payload: any): any {
  if (!payload) return null;
  const data = payload.Data ?? payload.data ?? payload;
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return { raw: data };
    }
  }
  return data;
}

function readIrn(payload: any): EInvoiceProviderResult {
  const data = unwrapData(payload);
  const irn = data?.Irn ?? data?.irn;
  const signedInvoice = data?.SignedInvoice ?? data?.signedInvoice;
  const signedQrCode = data?.SignedQRCode ?? data?.signedQrCode ?? data?.SignedQrCode;
  const ackNo = data?.AckNo ?? data?.ackNo;
  const ackDate = data?.AckDt ?? data?.ackDate ?? data?.AckDate;
  const irnText = irn === undefined || irn === null ? "" : String(irn);
  const signedInvoiceText = signedInvoice === undefined || signedInvoice === null ? "" : String(signedInvoice);
  const signedQrText = signedQrCode === undefined || signedQrCode === null ? "" : String(signedQrCode);
  if (!/^[a-fA-F0-9]{64}$/.test(irnText) || signedInvoiceText.length < 20 || signedQrText.length < 20 || !ackNo || !ackDate) {
    const error = payload?.ErrorDetails?.[0] ?? payload?.error;
    return {
      outcome: "FAILED",
      errorCode: String(error?.ErrorCode ?? error?.errorCode ?? "INCOMPLETE_IRP_RESPONSE"),
      errorMessage:
        error?.ErrorMessage ??
        error?.errorMessage ??
        "IRP response did not include IRN, acknowledgement, signed invoice, and signed QR together.",
    };
  }
  return {
    outcome: "SUCCEEDED",
    irn: irnText,
    ackNo: String(ackNo),
    ackDate: String(ackDate),
    signedInvoice: signedInvoiceText,
    signedQrCode: signedQrText,
  };
}

export class NicGstProvider {
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly http: GstHttpClient) {}

  private async authenticate(creds: {
    einvoiceBaseUrl?: string;
    ewayBaseUrl?: string;
    gstin: string;
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
  }, kind: "einvoice" | "eway"): Promise<{ token?: string; error?: EInvoiceProviderResult }> {
    const base = kind === "einvoice" ? creds.einvoiceBaseUrl : creds.ewayBaseUrl;
    const cacheKey = `${kind}|${base}|${creds.gstin}|${creds.username}`;
    const cached = this.tokens.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { token: cached.token };
    const path = kind === "einvoice" ? "/eivital/v1.04/auth" : "/ewaybillapi/v1.03/auth";
    const response = await this.http.request({
      url: `${base}${path}`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        gstin: creds.gstin,
      },
      body: JSON.stringify({
        UserName: creds.username,
        Password: creds.password,
        AppKey: creds.clientSecret,
        ForceRefreshAccessToken: false,
      }),
    });
    const payload = parseJson(response.body);
    const data = unwrapData(payload);
    const token = data?.AuthToken ?? data?.authToken;
    if (response.status >= 400 || !token) {
      return {
        error: {
          outcome: "FAILED",
          errorCode: "AUTH_FAILED",
          errorMessage: "GST authentication did not return an AuthToken. No document number was generated.",
        },
      };
    }
    const expirySeconds = Number(data?.TokenExpiry ?? data?.expiry ?? 360 * 60);
    const ttlMs = Number.isFinite(expirySeconds) ? Math.max(60, expirySeconds - 300) * 1000 : 6 * 60 * 60 * 1000;
    this.tokens.set(cacheKey, { token: String(token), expiresAt: Date.now() + ttlMs });
    return { token: String(token) };
  }

  async generateIrn(
    draft: EInvoiceDraft,
    creds: GstRuntimeCredentials,
  ): Promise<EInvoiceProviderResult> {
    const errors = validateEInvoiceDraft(draft);
    if (errors.length > 0) {
      return { outcome: "VALIDATION_FAILED", errorCode: "SCHEMA_INVALID", errorMessage: errors.join(" ") };
    }
    const auth = await this.authenticate(creds, "einvoice");
    if (auth.error) return auth.error;
    const invoiceUrl = `${creds.einvoiceBaseUrl}/eicore/v1.03/Invoice`;
    const invoiceBody = JSON.stringify(buildEInvoicePayload(draft));
    let response: { status: number; body: string };
    try {
      response = await this.http.request({
        url: invoiceUrl,
        method: "POST",
        headers: this.authHeaders(creds, auth.token!),
        body: invoiceBody,
      });
    } catch {
      return this.recoverUnknownIrn(draft, creds, "The IRP generate call timed out before a response was received.");
    }
    if (response.status === 401 || response.status >= 500) {
      if (response.status === 401) {
        this.tokens.delete(`einvoice|${creds.einvoiceBaseUrl}|${creds.gstin}|${creds.username}`);
      }
      const retryAuth = response.status === 401 ? await this.authenticate(creds, "einvoice") : auth;
      if (retryAuth.error) return retryAuth.error;
      try {
        response = await this.http.request({
          url: invoiceUrl,
          method: "POST",
          headers: this.authHeaders(creds, retryAuth.token!),
          body: invoiceBody,
        });
      } catch {
        return this.recoverUnknownIrn(draft, creds, "The IRP generate retry timed out.");
      }
    }
    const payload = parseJson(response.body);
    const errorCode = String(payload?.ErrorDetails?.[0]?.ErrorCode ?? "");
    if (errorCode === "2150") {
      const existing = await this.getIrnByDocDetails(
        draft.documentType,
        draft.documentNumber,
        draft.documentDate,
        creds,
      );
      if (existing.outcome === "SUCCEEDED") {
        return { ...existing, duplicateRecovered: true };
      }
      return existing;
    }
    if (response.status >= 400) {
      return {
        outcome: "FAILED",
        errorCode: errorCode || `HTTP_${response.status}`,
        errorMessage: payload?.ErrorDetails?.[0]?.ErrorMessage || "IRP generate request failed.",
      };
    }
    return readIrn(payload);
  }

  private async recoverUnknownIrn(
    draft: EInvoiceDraft,
    creds: GstRuntimeCredentials,
    message: string,
  ): Promise<EInvoiceProviderResult> {
    try {
      const existing = await this.getIrnByDocDetails(
        draft.documentType,
        draft.documentNumber,
        draft.documentDate,
        creds,
      );
      if (existing.outcome === "SUCCEEDED") return { ...existing, duplicateRecovered: true };
      if (existing.outcome === "NOT_FOUND") {
        return {
          outcome: "UNKNOWN",
          errorCode: "IRP_TIMEOUT",
          errorMessage: `${message} A later lookup did not find an IRN. No IRN was stored and the invoice was not duplicated.`,
        };
      }
      return existing;
    } catch {
      return {
        outcome: "UNKNOWN",
        errorCode: "IRP_TIMEOUT",
        errorMessage: `${message} The status lookup also failed. No IRN was stored.`,
      };
    }
  }

  async getIrnByDocDetails(
    documentType: string,
    documentNumber: string,
    documentDate: string,
    creds: GstRuntimeCredentials,
  ): Promise<EInvoiceProviderResult> {
    const auth = await this.authenticate(creds, "einvoice");
    if (auth.error) return auth.error;
    const params = new URLSearchParams({
      doctype: documentType,
      docnum: documentNumber,
      docdate: toNicDate(documentDate),
    });
    const response = await this.http.request({
      url: `${creds.einvoiceBaseUrl}/eicore/v1.03/Invoice/irnbydocdetails?${params.toString()}`,
      method: "GET",
      headers: this.authHeaders(creds, auth.token!),
    });
    const payload = parseJson(response.body);
    if (response.status === 404) return { outcome: "NOT_FOUND", errorCode: "IRN_NOT_FOUND", errorMessage: "IRP has no IRN for this document." };
    if (response.status >= 400) {
      return { outcome: "FAILED", errorCode: `HTTP_${response.status}`, errorMessage: "IRP status lookup failed." };
    }
    return readIrn(payload);
  }

  async cancelIrn(
    irn: string,
    reasonCode: string,
    remarks: string,
    creds: GstRuntimeCredentials,
  ): Promise<EInvoiceProviderResult> {
    if (!/^[1-4]$/.test(reasonCode)) {
      return {
        outcome: "VALIDATION_FAILED",
        errorCode: "CANCEL_REASON_INVALID",
        errorMessage: "IRP cancellation reason must be 1, 2, 3, or 4.",
      };
    }
    const auth = await this.authenticate(creds, "einvoice");
    if (auth.error) return auth.error;
    const response = await this.http.request({
      url: `${creds.einvoiceBaseUrl}/eicore/v1.03/Invoice/Cancel`,
      method: "POST",
      headers: this.authHeaders(creds, auth.token!),
      body: JSON.stringify({ Irn: irn, CnlRsn: reasonCode, CnlRem: remarks }),
    });
    const payload = parseJson(response.body);
    const status = String(payload?.Status ?? payload?.status ?? "");
    if (response.status >= 400 || (status && status !== "1")) {
      return {
        outcome: "FAILED",
        errorCode: String(payload?.ErrorDetails?.[0]?.ErrorCode ?? `HTTP_${response.status}`),
        errorMessage:
          payload?.ErrorDetails?.[0]?.ErrorMessage || "IRP did not confirm cancellation. The local IRN remains active.",
      };
    }
    return { outcome: "SUCCEEDED", irn };
  }

  async generateEwayBill(draft: EWayBillDraft, creds: GstRuntimeCredentials): Promise<EWayProviderResult> {
    const errors = validateEWayDraft(draft);
    if (errors.length > 0) {
      return { outcome: "VALIDATION_FAILED", errorCode: "SCHEMA_INVALID", errorMessage: errors.join(" ") };
    }
    const auth = await this.authenticate(creds, "eway");
    if (auth.error) return auth.error;
    const response = await this.http.request({
      url: `${creds.ewayBaseUrl}/ewaybillapi/v1.03/ewayapi/genewaybill`,
      method: "POST",
      headers: this.authHeaders(creds, auth.token!),
      body: JSON.stringify({
        supplyType: draft.supplyType,
        subSupplyType: draft.subSupplyType,
        docType: draft.documentType,
        docNo: draft.documentNumber,
        docDate: draft.documentDate,
        fromGstin: draft.fromGstin,
        fromTrdName: draft.fromTradeName,
        fromAddr1: draft.fromAddress,
        fromPlace: draft.fromPlace,
        fromPincode: draft.fromPincode,
        fromStateCode: draft.fromStateCode,
        toGstin: draft.toGstin,
        toTrdName: draft.toTradeName,
        toAddr1: draft.toAddress,
        toPlace: draft.toPlace,
        toPincode: draft.toPincode,
        toStateCode: draft.toStateCode,
        totalValue: draft.totalValue,
        cgstValue: draft.cgstValue,
        sgstValue: draft.sgstValue,
        igstValue: draft.igstValue,
        totInvValue: draft.totalInvoiceValue,
        transDistance: draft.distanceKm,
        transporterId: draft.transporterId ?? "",
        transporterName: draft.transporterName ?? "",
        transDocNo: draft.transporterDocNo ?? "",
        transDocDate: draft.transporterDocDate ?? "",
        vehicleNo: draft.vehicleNumber ?? "",
        vehicleType: draft.vehicleType ?? "R",
        itemList: draft.items.map((item) => ({
          productName: item.productName,
          hsnCode: item.hsnCode,
          quantity: item.quantity,
          qtyUnit: "NOS",
          taxableAmount: item.taxableAmount,
          cgstRate: item.cgstRate,
          sgstRate: item.sgstRate,
          igstRate: item.igstRate,
        })),
      }),
    });
    const payload = parseJson(response.body);
    const data = unwrapData(payload);
    const ewbNumber = data?.ewayBillNo ?? data?.ewbNo;
    const validUpto = data?.validUpto;
    const ewbDate = data?.ewayBillDate ?? data?.ewbDate;
    if (response.status >= 400 || ewbNumber === undefined || ewbNumber === null || !/^\d{12}$/.test(String(ewbNumber)) || !validUpto) {
      return {
        outcome: "FAILED",
        errorCode: String(payload?.error?.errorCodes ?? `HTTP_${response.status}`),
        errorMessage: "E-Way Bill API did not return a bill number and validity. No number was stored.",
      };
    }
    return {
      outcome: "SUCCEEDED",
      ewbNumber: String(ewbNumber),
      ewbDate: ewbDate ? String(ewbDate) : undefined,
      validUpto: String(validUpto),
      status: "ACT",
    };
  }

  async cancelEwayBill(
    ewbNumber: string,
    reasonCode: string,
    remarks: string,
    creds: GstRuntimeCredentials,
  ): Promise<EWayProviderResult> {
    const auth = await this.authenticate(creds, "eway");
    if (auth.error) return auth.error;
    const response = await this.http.request({
      url: `${creds.ewayBaseUrl}/ewaybillapi/v1.03/ewayapi/canewb`,
      method: "POST",
      headers: this.authHeaders(creds, auth.token!),
      body: JSON.stringify({ ewbNo: ewbNumber, cancelRsnCode: reasonCode, cancelRmrk: remarks }),
    });
    const payload = parseJson(response.body);
    if (response.status >= 400 || String(payload?.status ?? payload?.Status ?? "1") === "0") {
      return {
        outcome: "FAILED",
        errorCode: "EWAY_CANCEL_FAILED",
        errorMessage: "E-Way Bill API did not confirm cancellation.",
      };
    }
    return { outcome: "SUCCEEDED", ewbNumber, status: "CNL" };
  }

  async updateEwayVehicle(
    ewbNumber: string,
    vehicleNumber: string,
    reasonCode: string,
    creds: GstRuntimeCredentials,
  ): Promise<EWayProviderResult> {
    if (!vehicleNumber) {
      return { outcome: "VALIDATION_FAILED", errorCode: "VEHICLE_REQUIRED", errorMessage: "Vehicle number is required." };
    }
    const auth = await this.authenticate(creds, "eway");
    if (auth.error) return auth.error;
    const response = await this.http.request({
      url: `${creds.ewayBaseUrl}/ewaybillapi/v1.03/ewayapi/vehewb`,
      method: "POST",
      headers: this.authHeaders(creds, auth.token!),
      body: JSON.stringify({ ewbNo: ewbNumber, vehicleNo: vehicleNumber, reasonCode, fromPlace: "", fromState: 0 }),
    });
    if (response.status >= 400) {
      return { outcome: "FAILED", errorCode: `HTTP_${response.status}`, errorMessage: "Vehicle update was not accepted." };
    }
    return { outcome: "SUCCEEDED", ewbNumber, status: "ACT" };
  }

  async getEwayBill(ewbNumber: string, creds: GstRuntimeCredentials): Promise<EWayProviderResult> {
    const auth = await this.authenticate(creds, "eway");
    if (auth.error) return auth.error;
    const response = await this.http.request({
      url: `${creds.ewayBaseUrl}/ewaybillapi/v1.03/ewayapi/getewaybill?ewbNo=${encodeURIComponent(ewbNumber)}`,
      method: "GET",
      headers: this.authHeaders(creds, auth.token!),
    });
    const payload = parseJson(response.body);
    const data = unwrapData(payload);
    const number = data?.ewbNo ?? data?.ewayBillNo;
    if (response.status >= 400 || !number) {
      return { outcome: "FAILED", errorCode: "EWAY_STATUS_FAILED", errorMessage: "E-Way Bill status lookup failed." };
    }
    return {
      outcome: "SUCCEEDED",
      ewbNumber: String(number),
      validUpto: data?.validUpto ? String(data.validUpto) : undefined,
      status: String(data?.status ?? "ACT"),
    };
  }

  private authHeaders(creds: GstRuntimeCredentials, token: string): Record<string, string> {
    return {
      "content-type": "application/json",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      gstin: creds.gstin,
      user_name: creds.username,
      authtoken: token,
    };
  }
}
