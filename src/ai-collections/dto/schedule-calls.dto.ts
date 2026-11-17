export interface ScheduleCallsDto {
  partyIds: string[];
  scheduledAt?: string; // ISO date string or HH:mm
  campaignName?: string;
  notes?: string;
  priority?: number;
}

export interface ScheduleIndividualCallDto {
  partyId: string;
  invoiceId?: string;
  scheduledAt?: string;
  notes?: string;
}

