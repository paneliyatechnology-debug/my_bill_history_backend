import {
  GstinProviderConfig,
  GstinVerificationResult,
  GstRegistrationStatus,
  IGstVerificationProvider,
} from "./types";

export class GstinApiProvider implements IGstVerificationProvider {
  readonly providerName = "gstinapi";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: GstinProviderConfig = {}) {
    this.apiKey = config.apiKey || "";
    this.baseUrl = (config.baseUrl || "https://api.gstinapi.in/v1").replace(
      /\/+$/,
      "",
    );
    this.timeoutMs = config.timeoutMs ?? 10000;
  }

  async verifyGstin(
    gstin: string,
    options?: { signal?: AbortSignal },
  ): Promise<GstinVerificationResult> {
    const cleanGstin = gstin.trim().toUpperCase();

    if (!this.apiKey) {
      throw new Error("GSTINAPI API key is unconfigured.");
    }

    const endpoint = `${this.baseUrl}/gstin/${encodeURIComponent(cleanGstin)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    if (options?.signal) {
      options.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "x-api-key": this.apiKey,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const rawJson: any = await response.json().catch(() => null);

      if (!response.ok || !rawJson?.data) {
        if (response.status === 401 || response.status === 403) {
          const err = new Error("GSTINAPI authentication failed.");
          (err as any).statusCode = 502;
          (err as any).errorCode = "PROVIDER_AUTH_FAILED";
          throw err;
        }

        return {
          success: false,
          isValid: false,
          gstin: cleanGstin,
          legalName: null,
          tradeName: null,
          registrationStatus: "UNKNOWN",
          registrationDate: null,
          taxpayerType: null,
          constitutionOfBusiness: null,
          pan: cleanGstin.length >= 12 ? cleanGstin.substring(2, 12) : null,
          stateCode: cleanGstin.length >= 2 ? cleanGstin.substring(0, 2) : null,
          stateName: null,
          address: {
            line1: null,
            city: null,
            district: null,
            state: null,
            stateCode: null,
            pincode: null,
          },
          verifiedAt: new Date().toISOString(),
          source: "LIVE_API",
          message: `Taxpayer with GSTIN '${cleanGstin}' was not found.`,
          errorCode: "GSTIN_NOT_FOUND",
        };
      }

      const d = rawJson.data;
      const pradr = d.pradr || {};
      const addr = pradr.addr || {};
      const addressParts = [addr.bno, addr.bnm, addr.st, addr.loc].filter(
        Boolean,
      );
      const normalizedStatus = this.normalizeStatus(d.status);

      return {
        success: true,
        isValid: true,
        gstin: d.gstin || cleanGstin,
        legalName: d.legal_name || d.trade_name || null,
        tradeName: d.trade_name || d.legal_name || null,
        registrationStatus: normalizedStatus,
        registrationDate: d.registration_date || null,
        taxpayerType: d.taxpayer_type || null,
        constitutionOfBusiness: d.constitution || null,
        pan:
          d.pan ||
          (cleanGstin.length >= 12 ? cleanGstin.substring(2, 12) : null),
        stateCode:
          addr.stcd ||
          (cleanGstin.length >= 2 ? cleanGstin.substring(0, 2) : null),
        stateName: addr.stcd || d.state || null,
        address: {
          line1: addressParts.join(", ") || null,
          city: addr.dst || d.city || null,
          district: addr.dst || null,
          state: addr.stcd || d.state || null,
          stateCode: addr.stcd || null,
          pincode: addr.pncd || d.pincode || null,
        },
        verifiedAt: new Date().toISOString(),
        source: "LIVE_API",
        rawStatusText: d.status,
        message: "Taxpayer details verified successfully.",
      };
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === "AbortError" || controller.signal.aborted) {
        const timeoutErr = new Error(
          `Request timed out after ${this.timeoutMs}ms.`,
        );
        (timeoutErr as any).statusCode = 504;
        throw timeoutErr;
      }
      throw err;
    }
  }

  private normalizeStatus(rawStatus?: string): GstRegistrationStatus {
    if (!rawStatus) return "UNKNOWN";
    const clean = rawStatus.trim().toUpperCase();
    if (clean === "ACTIVE") return "ACTIVE";
    if (clean.includes("CANCEL")) return "CANCELLED";
    if (clean.includes("SUSPEND")) return "SUSPENDED";
    if (clean.includes("INACTIVE")) return "INACTIVE";
    return "UNKNOWN";
  }
}
