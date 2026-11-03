export interface RecipientInputDto {
  partyId?: string;
  partyName: string;
  mobileNumber: string;
}

export interface CreateCampaignDto {
  name?: string;
  category: "festival" | "discount" | "stock_update" | "business_promotion" | string;
  template_id?: string;
  message: string;
  variables?: Record<string, string>;
  recipients?: RecipientInputDto[];
  partyIds?: string[];
  sort_order?: "ASC" | "DESC";
}

export interface TestSmsDto {
  mobile_number: string;
  message?: string;
  template_id?: string;
}

export interface PartyGreetingSettingsDto {
  invoice_milestone?: {
    enabled: boolean;
    template_id: string;
    example?: string;
  };
  birthday_reminder?: {
    enabled: boolean;
    template_id: string;
    example?: string;
  };
  additional_settings?: Array<{
    id?: string;
    key: string;
    label?: string;
    value?: string;
  }>;
}
