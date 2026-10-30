export function getApiBaseUrl(): string {
  if (process.env.API_BASE_URL) {
    return process.env.API_BASE_URL.replace(/\/$/, "");
  }
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, "");
  }
  if (process.env.NODE_ENV === "production") {
    return "https://api.myownbillbook.com";
  }
  const port = process.env.PORT || 4000;
  return `http://localhost:${port}`;
}

export function buildInvoiceUrls(invoiceId: string) {
  const base = getApiBaseUrl();
  return {
    printUrl: `${base}/api/v1/invoices/${invoiceId}/print`,
    previewUrl: `${base}/api/v1/invoices/${invoiceId}/print`,
    pdfUrl: `${base}/api/v1/invoices/${invoiceId}/pdf`,
  };
}

export function buildInvoicePdfDetails(invoiceId: string) {
  const base = getApiBaseUrl();
  return {
    previewUrl: `${base}/api/v1/invoices/${invoiceId}/print`,
    pdfUrl: `${base}/api/v1/invoices/${invoiceId}/pdf`,
  };
}

