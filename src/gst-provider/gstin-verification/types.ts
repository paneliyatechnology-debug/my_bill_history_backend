export type GstRegistrationStatus =
  "ACTIVE" | "CANCELLED" | "SUSPENDED" | "INACTIVE" | "UNKNOWN";

export interface GstinVerificationAddress {
  line1: string | null;
  line2?: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
}

export interface GstinVerificationResult {
  success: boolean;
  isValid: boolean;
  gstin: string;
  legalName: string | null;
  tradeName: string | null;
  registrationStatus: GstRegistrationStatus;
  registrationDate: string | null;
  taxpayerType: string | null;
  constitutionOfBusiness: string | null;
  pan: string | null;
  stateCode: string | null;
  stateName: string | null;
  stateNameGujarati?: string | null;
  address: GstinVerificationAddress;
  verifiedAt: string;
  source:
    | "LIVE_API"
    | "CACHE"
    | "INTERNAL_DATABASE"
    | "STATUTORY_DERIVATION"
    | "REGISTRY";
  rawStatusText?: string;
  message?: string;
  messageGujarati?: string;
  creditsRemaining?: number;
  errorCode?: string;
}

export interface GstinProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface IGstVerificationProvider {
  readonly providerName: string;
  verifyGstin(
    gstin: string,
    options?: { signal?: AbortSignal },
  ): Promise<GstinVerificationResult>;
}
