export interface UpdateCustomerCallingPreferenceDto {
  isOptedOut?: boolean;
  optOutReason?: string;
  preferredLanguage?: "gujarati" | "hindi" | "english" | string;
  preferredCallTime?: "MORNING" | "AFTERNOON" | "EVENING" | string;
  doNotCallBefore?: string;
  doNotCallAfter?: string;
}

