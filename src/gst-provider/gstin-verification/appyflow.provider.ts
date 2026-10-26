import {
  GstinProviderConfig,
  GstinVerificationResult,
  GstRegistrationStatus,
  IGstVerificationProvider,
} from "./types";

export class AppyflowProvider implements IGstVerificationProvider {
  readonly providerName = "appyflow";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: GstinProviderConfig = {}) {
    this.apiKey = config.apiKey || "";
    this.baseUrl = (config.baseUrl || "https://appyflow.in/api").replace(
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
      throw new Error("Appyflow API key is unconfigured.");
    }

    const endpoint = `${this.baseUrl}/verifyGST?gstNo=${encodeURIComponent(cleanGstin)}&key_secret=${encodeURIComponent(this.apiKey)}`;
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
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const rawJson: any = await response.json().catch(() => null);

      if (!response.ok || !rawJson?.taxpayerInfo) {
        if (response.status === 401 || response.status === 403) {
          const err = new Error("Appyflow authentication failed.");
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

      const tp = rawJson.taxpayerInfo;
      const addr = tp.pradr?.addr || {};
      const addressParts = [addr.bno, addr.bnm, addr.st, addr.loc].filter(
        Boolean,
      );
      const normalizedStatus = this.normalizeStatus(tp.sts);

      return {
        success: true,
        isValid: true,
        gstin: tp.gstin || cleanGstin,
        legalName: tp.lgnm || tp.tradeNam || null,
        tradeName: tp.tradeNam || tp.lgnm || null,
        registrationStatus: normalizedStatus,
        registrationDate: tp.rgdt || null,
        taxpayerType: tp.dty || null,
        constitutionOfBusiness: tp.ctb || null,
        pan: cleanGstin.length >= 12 ? cleanGstin.substring(2, 12) : null,
        stateCode:
          addr.stcd ||
          (cleanGstin.length >= 2 ? cleanGstin.substring(0, 2) : null),
        stateName: addr.stcd || null,
        address: {
          line1: addressParts.join(", ") || null,
          city: addr.dst || addr.city || null,
          district: addr.dst || null,
          state: addr.stcd || null,
          stateCode: addr.stcd || null,
          pincode: addr.pncd || null,
        },
        verifiedAt: new Date().toISOString(),
        source: "LIVE_API",
        rawStatusText: tp.sts,
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
