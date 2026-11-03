export interface CreateAutomatedBillingLineDto {
  itemId?: string;
  description: string;
  hsnCode?: string;
  quantity: number;
  unit?: string;
  rate: number;
  discountPercent?: number;
  taxRate?: number;
}

export interface CreateAutomatedBillingDto {
  scheduleName: string;
  partyId: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string;  // YYYY-MM-DD
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval?: number;
  dayOfWeek?: number; // 0-6
  dayOfMonth?: number; // 1-31
  paymentTerms?: string;
  dueDays?: number;
  notes?: string;
  termsAndConditions?: string;
  lines: CreateAutomatedBillingLineDto[];
}
