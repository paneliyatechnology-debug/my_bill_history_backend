export interface GenerateInvoicePdfDto {
  invoiceId?: string;
  id?: string;
  copy?: string;
  share?: boolean | string;
  themeId?: string;
  accentColor?: string;
}
