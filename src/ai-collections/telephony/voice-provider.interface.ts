export interface ProviderCredentials {
  apiKey?: string | null;
  apiSecret?: string | null;
  accountSid?: string | null;
  virtualNumber?: string | null;
  webhookSecret?: string | null;
}

export interface InitiateCallParams {
  callId: string;
  tenantId: string;
  companyId: string;
  customerName: string;
  customerPhone: string;
  invoiceNumber?: string | null;
  outstandingAmount: number;
  language: string; // "gujarati" | "hindi" | "english"
  credentials: ProviderCredentials;
  callbackUrl: string;
  actionUrl: string;
  greetingText?: string;
}

export interface InitiateCallResult {
  success: boolean;
  providerCallSid: string;
  provider: string;
  status: string; // "queued", "initiated", "ringing", etc.
  message?: string;
  rawResponse?: any;
}

export interface WebhookCallEvent {
  provider: string;
  providerCallSid: string;
  callId?: string;
  eventType:
    | "INITIATED"
    | "RINGING"
    | "ANSWERED"
    | "IN_PROGRESS"
    | "SPEECH_RESULT"
    | "COMPLETED"
    | "FAILED"
    | "BUSY"
    | "NO_ANSWER"
    | "CANCELED";
  speechResult?: string;
  confidence?: number;
  durationSeconds?: number;
  recordingUrl?: string;
  recordingDuration?: number;
  rawPayload: any;
}

export interface ConnectionTestResult {
  success: boolean;
  provider: string;
  message: string;
  accountSid?: string;
  accountName?: string;
  accountStatus?: string;
  accountType?: "Trial" | "Full" | string;
  trialRestrictions?: boolean;
  availableNumbers?: Array<{
    phoneNumber: string;
    friendlyName?: string;
    voice: boolean;
    sms: boolean;
  }>;
  configuredNumber?: string;
  configuredNumberVoiceCapable?: boolean;
  verifiedCallerIds?: string[];
  geoPermissionsNotes?: string;
  publicApiUrlStatus?: {
    configured: boolean;
    isHttps: boolean;
    url?: string;
    recommendation?: string;
  };
  details?: Record<string, any>;
  timestamp: string;
}

export interface IVoiceProvider {
  readonly name: string;

  initiateCall(params: InitiateCallParams): Promise<InitiateCallResult>;

  testConnection?(credentials: ProviderCredentials): Promise<ConnectionTestResult>;

  verifyWebhook(
    signature: string,
    url: string,
    payload: any,
    secret: string,
  ): boolean;

  parseWebhookEvent(
    payload: any,
    headers?: Record<string, string>,
  ): WebhookCallEvent;

  generateSpeechResponse?(options: {
    speechText: string;
    isFinalTurn?: boolean;
    language: string;
    callId: string;
    actionUrl: string;
  }): string;
}

