export type GstEnvironmentName = "SANDBOX" | "PRODUCTION";

export const OFFICIAL_GST_ENDPOINTS = {
  SANDBOX: {
    einvoice: "https://einv-apisandbox.nic.in",
    eway: "https://einv-apisandbox.nic.in",
  },
  PRODUCTION: {
    einvoice: "https://api.einvoice1.gst.gov.in",
    eway: "https://api.ewaybillgst.gov.in",
  },
} as const;

export interface GstRuntimeCredentials {
  environment: GstEnvironmentName;
  gstin: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  einvoiceBaseUrl: string;
  ewayBaseUrl: string;
}

export interface CredentialResolution {
  ok: boolean;
  code?: "CREDENTIALS_UNAVAILABLE" | "PRODUCTION_NOT_ENABLED" | "PRODUCTION_URL_BLOCKED";
  message?: string;
  credentials?: GstRuntimeCredentials;
  secretsPresent: {
    einvoiceClientSecret: boolean;
    einvoicePassword: boolean;
    ewayClientSecret: boolean;
    ewayPassword: boolean;
  };
}

export function resolveGstCredentials(input: {
  environment: GstEnvironmentName;
  productionEnabled: boolean;
  gstin: string;
  clientId?: string | null;
  username?: string | null;
  clientSecret?: string | null;
  password?: string | null;
  ewayClientId?: string | null;
  ewayUsername?: string | null;
  ewayClientSecret?: string | null;
  ewayPassword?: string | null;
  einvoiceBaseUrl?: string | null;
  ewayBaseUrl?: string | null;
}): CredentialResolution {
  const secretsPresent = {
    einvoiceClientSecret: Boolean(input.clientSecret),
    einvoicePassword: Boolean(input.password),
    ewayClientSecret: Boolean(input.ewayClientSecret || input.clientSecret),
    ewayPassword: Boolean(input.ewayPassword || input.password),
  };
  if (input.environment === "PRODUCTION" && !input.productionEnabled) {
    return {
      ok: false,
      code: "PRODUCTION_NOT_ENABLED",
      message:
        "Production GST calls are blocked until production mode is explicitly enabled and onboarding credentials are in place.",
      secretsPresent,
    };
  }
  const defaults = OFFICIAL_GST_ENDPOINTS[input.environment];
  const einvoiceBaseUrl = input.einvoiceBaseUrl || defaults.einvoice;
  const ewayBaseUrl = input.ewayBaseUrl || defaults.eway;
  if (input.environment === "SANDBOX" && /ewaybillgst\.gov\.in|einvoice1\.gst\.gov\.in/i.test(`${einvoiceBaseUrl}${ewayBaseUrl}`)) {
    return {
      ok: false,
      code: "PRODUCTION_URL_BLOCKED",
      message: "Sandbox mode cannot use production GST host names.",
      secretsPresent,
    };
  }
  const clientId = input.clientId?.trim();
  const username = input.username?.trim();
  if (!input.gstin || !clientId || !input.clientSecret || !username || !input.password) {
    return {
      ok: false,
      code: "CREDENTIALS_UNAVAILABLE",
      message:
        "E-invoice or e-way bill credentials are incomplete. Client secrets and passwords are read from environment variables and are not stored in the database.",
      secretsPresent,
    };
  }
  return {
    ok: true,
    secretsPresent,
    credentials: {
      environment: input.environment,
      gstin: input.gstin,
      clientId,
      clientSecret: input.clientSecret,
      username,
      password: input.password,
      einvoiceBaseUrl: einvoiceBaseUrl.replace(/\/$/, ""),
      ewayBaseUrl: ewayBaseUrl.replace(/\/$/, ""),
    },
  };
}
