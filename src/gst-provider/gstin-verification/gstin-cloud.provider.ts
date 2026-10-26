import {
  GstinProviderConfig,
  GstinVerificationResult,
  GstRegistrationStatus,
  IGstVerificationProvider,
} from "./types";

export class GstinCloudProvider implements IGstVerificationProvider {
  readonly providerName = "gstin_cloud";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: GstinProviderConfig = {}) {
    this.apiKey = config.apiKey || "";
    this.baseUrl = (config.baseUrl || "https://gstin.cloud/api/v1").replace(
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
      throw new Error(
        "GSTIN.cloud API key is unconfigured. Please set GSTIN_CLOUD_API_KEY in the environment.",
      );
    }

    const endpoint = `${this.baseUrl}/verify/${encodeURIComponent(cleanGstin)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    // If caller provided an abort signal, chain it
    if (options?.signal) {
      options.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "X-API-Key": this.apiKey,
          Accept: "application/json",
          "User-Agent": "MyBillHistory-Billing/1.0",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const rawJson: any = await response.json().catch(() => null);

      if (!response.ok) {
        const errorMsg =
          rawJson?.error ||
          `GSTIN.cloud responded with status ${response.status}`;

        if (response.status === 401 || response.status === 403) {
          const err = new Error(
            `GST provider authentication failed: ${errorMsg}`,
          );
          (err as any).statusCode = 502;
          (err as any).errorCode = "PROVIDER_AUTH_FAILED";
          throw err;
        }

        if (response.status === 404) {
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
            stateCode:
              cleanGstin.length >= 2 ? cleanGstin.substring(0, 2) : null,
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
            message: `Taxpayer with GSTIN '${cleanGstin}' was not found on the GST portal.`,
            messageGujarati: `GST પોર્ટલ પર GSTIN '${cleanGstin}' વાળો કરદાતા મળ્યો નથી.`,
            errorCode: "GSTIN_NOT_FOUND",
          };
        }

        if (response.status === 429) {
          const err = new Error(
            `GST verification rate limit exceeded (60 req/min). Please try again shortly. (${errorMsg})`,
          );
          (err as any).statusCode = 429;
          (err as any).errorCode = "RATE_LIMIT_EXCEEDED";
          throw err;
        }

        const err = new Error(errorMsg);
        (err as any).statusCode = response.status;
        (err as any).errorCode = "PROVIDER_ERROR";
        throw err;
      }

      if (!rawJson || rawJson.success === false) {
        const errorMsg = rawJson?.error || "GSTIN lookup failed";
        const err = new Error(errorMsg);
        (err as any).statusCode = 400;
        (err as any).errorCode = "LOOKUP_FAILED";
        throw err;
      }

      const d = rawJson.data || {};
      const normalizedStatus = this.normalizeStatus(d.status);

      let warningMessage = "";
      let warningMessageGujarati = "";
      if (normalizedStatus === "CANCELLED") {
        warningMessage = "Warning: This GSTIN registration has been CANCELLED.";
        warningMessageGujarati =
          "ચેતવણી: આ GSTIN રજીસ્ટ્રેશન રદ (Cancelled) કરવામાં આવ્યું છે.";
      } else if (normalizedStatus === "SUSPENDED") {
        warningMessage =
          "Warning: This GSTIN registration is currently SUSPENDED.";
        warningMessageGujarati =
          "ચેતવણી: આ GSTIN રજીસ્ટ્રેશન હાલમાં સ્થગિત (Suspended) છે.";
      }

      return {
        success: true,
        isValid: true,
        gstin: d.gstin || cleanGstin,
        legalName: d.legal_name || null,
        tradeName: d.trade_name || d.legal_name || null,
        registrationStatus: normalizedStatus,
        registrationDate: d.registration_date || null,
        taxpayerType: d.taxpayer_type || null,
        constitutionOfBusiness: d.constitution || null,
        pan:
          d.pan ||
          (cleanGstin.length >= 12 ? cleanGstin.substring(2, 12) : null),
        stateCode:
          d.state_code ||
          (cleanGstin.length >= 2 ? cleanGstin.substring(0, 2) : null),
        stateName: d.state || null,
        address: {
          line1: d.address || null,
          city: d.district || null,
          district: d.district || null,
          state: d.state || null,
          stateCode: d.state_code || null,
          pincode: d.pincode || null,
        },
        verifiedAt: new Date().toISOString(),
        source: "LIVE_API",
        rawStatusText: d.status,
        message:
          warningMessage ||
          "Taxpayer details verified successfully from GST portal.",
        messageGujarati:
          warningMessageGujarati ||
          "જીએસટી પોર્ટલ પરથી કરદાતાની વિગતો સફળતાપૂર્વક ચકાસવામાં આવી.",
        creditsRemaining: rawJson.credits_remaining,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === "AbortError" || controller.signal.aborted) {
        const timeoutErr = new Error(
          `GST verification request timed out after ${this.timeoutMs}ms.`,
        );
        (timeoutErr as any).statusCode = 504;
        (timeoutErr as any).errorCode = "GATEWAY_TIMEOUT";
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
