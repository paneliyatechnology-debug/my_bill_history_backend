export interface CreateFollowUpDto {
  partyId: string;
  callId?: string;
  commitmentId?: string;
  scheduledDate: string; // ISO string
  reason: string;
  actionType?: "CALL" | "WHATSAPP" | "SMS" | "STAFF_REVIEW";
  notes?: string;
  assignedToUserId?: string;
}

export interface UpdateFollowUpDto {
  status?: "PENDING" | "COMPLETED" | "CANCELLED" | "SKIPPED";
  notes?: string;
  completedAt?: string;
}

