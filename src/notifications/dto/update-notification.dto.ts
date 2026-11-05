export interface UpdateNotificationDto {
  id?: string;
  isRead?: boolean | string;
  read?: boolean | string;
  status?: string; // "READ" | "UNREAD" | "read" | "unread"
  all?: boolean | string;
  action?: string; // "READ" | "UNREAD" | "MARK_ALL_READ" | "MARK_ALL_UNREAD"
}
