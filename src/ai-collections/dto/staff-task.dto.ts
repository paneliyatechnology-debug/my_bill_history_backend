export interface CreateStaffTaskDto {
  partyId: string;
  callId?: string;
  assignedUserId?: string;
  taskType:
    | "DISPUTE_REVIEW"
    | "CALLBACK_REQUEST"
    | "UNVERIFIED_PAYMENT"
    | "HIGH_VALUE_FOLLOWUP";
  title: string;
  description: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
}

export interface UpdateStaffTaskDto {
  status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "DISMISSED";
  resolutionNotes?: string;
  assignedUserId?: string;
}

