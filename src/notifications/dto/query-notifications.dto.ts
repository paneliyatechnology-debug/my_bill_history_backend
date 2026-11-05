export interface QueryNotificationsDto {
  page?: number | string;
  limit?: number | string;
  status?: "all" | "read" | "unread" | string;
  unreadOnly?: boolean | string;
  readOnly?: boolean | string;
  isRead?: boolean | string;
  read?: boolean | string;
  type?: string;
  from?: string;
  to?: string;
}
