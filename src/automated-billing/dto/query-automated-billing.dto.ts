export interface QueryAutomatedBillingDto {
  status?: string; // ALL, ACTIVE, PAUSED, STOPPED, COMPLETED
  search?: string;
  partyId?: string;
  page?: string | number;
  limit?: string | number;
}
