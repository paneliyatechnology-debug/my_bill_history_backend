export interface UpdateAiCollectionSettingsDto {
  isEnabled?: boolean;
  assistantName?: string;
  businessIntro?: string;
  defaultLanguage?: "gujarati" | "hindi" | "english" | string;
  callingWindowStart?: string;
  callingWindowEnd?: string;
  timezone?: string;
  maxRetries?: number;
  retryIntervalMinutes?: number;
  followUpAfterDays?: number;
  maxCallsPerCustomerPerDay?: number;
  maxCallsPerCampaign?: number;

  voiceProvider?: "twilio" | "exotel" | "knowlarity" | "simulator" | string;
  providerApiKey?: string;
  providerApiSecret?: string;
  providerAccountSid?: string;
  providerVirtualNumber?: string;
  webhookSecret?: string;

  aiModel?: string;
  sttProvider?: string;
  ttsProvider?: string;
  voiceGender?: string;
  responseSpeed?: number;
  fallbackResponse?: string;

  bankName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankAccountHolder?: string;
  upiId?: string;
  shareBankDetailsOnCall?: boolean;
  sendWhatsappFollowup?: boolean;
  sendSmsFollowup?: boolean;

  autoScheduleCalls?: boolean;
  autoFollowUpCalls?: boolean;
  stopCallsWhenInvoicePaid?: boolean;
  stopCallsWhenCustomerOptsOut?: boolean;
  requireHumanApproval?: boolean;
  notifyStaffOnDispute?: boolean;
  recordConsentAudit?: boolean;
}

export class TestCallDto {
  phoneNumber!: string;
  language?: "gujarati" | "hindi" | "english" | string;
  scenario?: string;
  customerName?: string;
}


