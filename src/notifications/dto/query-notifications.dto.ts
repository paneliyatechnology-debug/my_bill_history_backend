export interface QueryNotificationsDto {
  page?: number | string;
  limit?: number | string;
  unreadOnly?: boolean | string;
  type?: string;
  from?: string;
  to?: string;
}

