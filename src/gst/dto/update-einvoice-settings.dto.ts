export class UpdateEInvoiceSettingsDto {
  environment?: "SANDBOX" | "PRODUCTION";
  productionEnabled?: boolean;
  acknowledgeProductionGate?: boolean;
  einvoiceClientId?: string;
  einvoiceUsername?: string;
  ewayClientId?: string;
  ewayUsername?: string;
  clientSecret?: string;
  password?: string;
  ewayClientSecret?: string;
  ewayPassword?: string;
  einvoiceBaseUrl?: string;
  ewayBaseUrl?: string;
}
