export interface QueryCallsDto {
  status?: string;
  search?: string;
  partyId?: string;
  intent?: string;
  startDate?: string;
  endDate?: string;
  page?: number | string;
  limit?: number | string;
}

export interface QueryPendingDuesDto {
  search?: string;
  overdueOnly?: boolean | string;
  overdueDays?: number | string;
  minAmount?: number | string;
  partyId?: string;
  page?: number | string;
  limit?: number | string;
}

