import { CreateAutomatedBillingLineDto } from "./create-automated-billing.dto";

export interface UpdateAutomatedBillingDto {
  scheduleName?: string;
  partyId?: string;
  startDate?: string;
  endDate?: string;
  frequency?: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval?: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  paymentTerms?: string;
  dueDays?: number;
  notes?: string;
  termsAndConditions?: string;
  lines?: CreateAutomatedBillingLineDto[];
}

