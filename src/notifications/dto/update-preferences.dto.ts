export interface UpdatePreferencesDto {
  paymentReceived?: boolean;
  paymentSent?: boolean;
  invoiceDueReminder?: boolean;
  purchaseDueReminder?: boolean;
  overdueReminder?: boolean;
  pushEnabled?: boolean;
  inAppEnabled?: boolean;
}

