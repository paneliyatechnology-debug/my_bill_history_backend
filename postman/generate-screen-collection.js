#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const id = () => crypto.randomUUID();

const tenantHeaders = [
  { key: "x-organization-id", value: "{{organizationId}}" },
  { key: "x-company-id", value: "{{companyId}}" },
  { key: "x-branch-id", value: "{{branchId}}" },
  { key: "x-financial-year-id", value: "{{financialYearId}}" },
];

const bearerAuth = {
  type: "bearer",
  bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }],
};

const authCaptureTests = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      "if (pm.response.code >= 200 && pm.response.code < 300) {",
      "  const json = pm.response.json();",
      "  const token = json.accessToken || json.token || (json.data && json.data.accessToken);",
      "  if (token) pm.collectionVariables.set('accessToken', token);",
      "  const ctx = json.defaultContext || json.context || (json.data && json.data.defaultContext) || {};",
      "  if (ctx.organizationId) pm.collectionVariables.set('organizationId', ctx.organizationId);",
      "  if (ctx.companyId) pm.collectionVariables.set('companyId', ctx.companyId);",
      "  if (ctx.branchId) pm.collectionVariables.set('branchId', ctx.branchId);",
      "  if (ctx.financialYearId) pm.collectionVariables.set('financialYearId', ctx.financialYearId);",
      "}",
    ],
  },
};

function q(params) {
  if (!params) return undefined;
  return Object.entries(params).map(([key, value]) => ({
    key,
    value: String(value),
  }));
}

function item({
  name,
  method,
  urlPath,
  description,
  body,
  query,
  auth,
  extraHeaders = [],
  formdata,
  tests,
  rawMode,
}) {
  const headers = [];
  if (body && !formdata) {
    headers.push({ key: "Content-Type", value: "application/json" });
  }
  if (auth !== false) {
    headers.push(...tenantHeaders);
  }
  headers.push(...extraHeaders);

  const request = {
    method,
    header: headers,
    url: {
      raw: `{{baseUrl}}/${urlPath}`,
      host: ["{{baseUrl}}"],
      path: urlPath.split("/").filter(Boolean),
    },
    description,
  };

  if (query) {
    request.url.query = q(query);
    const qs = Object.entries(query)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    request.url.raw = `{{baseUrl}}/${urlPath}?${qs}`;
  }

  if (auth === false) {
    request.auth = { type: "noauth" };
  }

  if (formdata) {
    request.body = { mode: "formdata", formdata };
  } else if (body !== undefined) {
    request.body = {
      mode: "raw",
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: rawMode || "json" } },
    };
  }

  const out = { name, request };
  if (tests) out.event = [tests];
  return out;
}

function folder(name, description, items) {
  return {
    name,
    description,
    item: items,
  };
}

const dateRange = { fromDate: "2026-04-01", toDate: "2027-03-31" };
const startEnd = { startDate: "2026-04-01", endDate: "2027-03-31" };
const page = { page: "1", limit: "20" };

const collection = {
  info: {
    _postman_id: id(),
    name: "MyOwnBillBook — Screen-wise API Collection",
    description: [
      "Screen-wise Billing API collection. Folders = app screens. Request names = what that API does.",
      "",
      "How to use:",
      "1. Import this file in Postman.",
      "2. Open Login, type your phone and password in that request body, Send.",
      "3. Token is saved automatically. Other requests then work.",
      "4. IDs (party, item, invoice...) are written inside each request. After you Create, copy the real id from the response and paste it in Get/Update/Delete of that same screen.",
      "",
      "Only these collection values are used: baseUrl, accessToken, organizationId, companyId, branchId, financialYearId.",
    ].join("\n"),
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  auth: bearerAuth,
  variable: [
    { key: "baseUrl", value: "http://localhost:4000/api/v1" },
    { key: "accessToken", value: "" },
    { key: "organizationId", value: "" },
    { key: "companyId", value: "" },
    { key: "branchId", value: "" },
    { key: "financialYearId", value: "" },
  ],
  item: [
    folder("00. Health Check", "Server uptime checks. No login required.", [
      item({
        name: "API Health",
        method: "GET",
        urlPath: "health",
        description: "Is the billing API running?",
        auth: false,
      }),
      item({
        name: "Liveness",
        method: "GET",
        urlPath: "health/liveness",
        description: "Process is alive.",
        auth: false,
      }),
      item({
        name: "Readiness (database connected)",
        method: "GET",
        urlPath: "health/readiness",
        description: "API plus PostgreSQL are ready.",
        auth: false,
      }),
    ]),

    folder("01. Login & Account", "Sign up, login, OTP, password, profile, switch company.", [
      item({
        name: "Register new company",
        method: "POST",
        urlPath: "auth/register",
        description: "Create organization, first company, and admin user. Saves token after success.",
        auth: false,
        tests: authCaptureTests,
        body: {
          fullName: "Jaydeep Patel",
          phone: "9898990001",
          email: "owner@example.com",
          otp: "123456",
          password: "YourPassword123",
          organizationName: "Demo Traders",
          companyLegalName: "Demo Traders Pvt Ltd",
          tradeName: "Demo Traders",
          gstin: "24AAAAA0000A1Z5",
          stateCode: "24",
          preferredLang: "en",
        },
      }),
      item({
        name: "Send OTP (register / forgot password)",
        method: "POST",
        urlPath: "auth/otp/send",
        description: "purpose must be REGISTER or PASSWORD_RESET.",
        auth: false,
        body: {
          email: "owner@example.com",
          phone: "9898990001",
          purpose: "REGISTER",
        },
      }),
      item({
        name: "Login",
        method: "POST",
        urlPath: "auth/login",
        description: "Sign in with phone or email. Saves accessToken and company IDs.",
        auth: false,
        tests: authCaptureTests,
        body: {
          identifier: "9898990001",
          password: "YourPassword123",
        },
      }),
      item({
        name: "Get my profile",
        method: "GET",
        urlPath: "auth/me",
        description: "Currently logged-in user.",
      }),
      item({
        name: "Live session status",
        method: "GET",
        urlPath: "auth/live-status",
        description: "Quick check that the session is still active.",
      }),
      item({
        name: "Switch company / branch",
        method: "POST",
        urlPath: "auth/switch-context",
        description: "Change working company (and optional branch).",
        body: { companyId: "{{companyId}}", branchId: "{{branchId}}" },
      }),
      item({
        name: "Update profile",
        method: "PATCH",
        urlPath: "auth/profile",
        description: "Change name or email (email change needs OTP).",
        body: { fullName: "Jaydeep Patel", email: "owner@example.com", otp: "123456" },
      }),
      item({
        name: "Send OTP to change email",
        method: "POST",
        urlPath: "auth/email/send-otp",
        body: { email: "new-email@example.com" },
      }),
      item({
        name: "Change password",
        method: "POST",
        urlPath: "auth/password/change",
        body: { currentPassword: "YourPassword123", newPassword: "NewPass@123" },
      }),
      item({
        name: "Reset password with OTP",
        method: "POST",
        urlPath: "auth/password/reset",
        description: "Forgot password flow. No login required.",
        auth: false,
        body: {
          email: "owner@example.com",
          otp: "123456",
          newPassword: "NewPass@123",
        },
      }),
      item({
        name: "Logout",
        method: "POST",
        urlPath: "auth/logout",
        description: "End current session.",
        body: {},
      }),
    ]),

    folder("02. Dashboard", "Home screen cards: summary, latest bills, sales chart, bank balances.", [
      item({
        name: "Dashboard summary",
        method: "GET",
        urlPath: "dashboard/summary",
        description: "To collect, to pay, sales, cash and bank totals.",
        query: { asOfDate: "2026-10-28" },
      }),
      item({
        name: "Latest transactions",
        method: "GET",
        urlPath: "dashboard/latest-transactions",
        query: { limit: "10" },
      }),
      item({
        name: "Sales overview chart",
        method: "GET",
        urlPath: "dashboard/sales-overview",
        query: { days: "30" },
      }),
      item({
        name: "Bank & cash on dashboard",
        method: "GET",
        urlPath: "dashboard/bank-accounts",
      }),
    ]),

    folder("03. Invoice Settings", "Theme, color, GST copies and print options — same as Invoice Settings screen.", [
      item({
        name: "List themes, colors and print options",
        method: "GET",
        urlPath: "invoice-settings/themes",
      }),
      item({
        name: "Get saved invoice settings",
        method: "GET",
        urlPath: "invoice-settings",
      }),
      item({
        name: "Save invoice settings",
        method: "PUT",
        urlPath: "invoice-settings",
        body: {
          themeId: "advanced_gst_tally",
          accentColor: "#111111",
          paperSize: "A4",
          printCopies: ["ORIGINAL_FOR_RECIPIENT"],
          showPartyBalance: false,
          enableFreeItemQuantity: false,
          showItemDescription: true,
          showAlternateUnit: true,
          showPhoneNumber: true,
          showEmojis: false,
          printHistory: false,
          autoApplyLuxuryForSharing: false,
          showDueDate: true,
          showPoNumber: false,
          showEwayBillNumber: false,
          showVehicleNumber: false,
          showHsn: true,
          showDiscount: true,
          showTaxColumn: true,
          showTaxBreakup: true,
          showNotes: true,
          showTerms: true,
          showAmountInWords: true,
          showReceivedAmount: true,
        },
      }),
      item({
        name: "Preview Advanced GST (Tally)",
        method: "GET",
        urlPath: "invoice-settings/preview",
        query: { themeId: "advanced_gst_tally", copy: "ORIGINAL_FOR_RECIPIENT", category: "TAX_INVOICE" },
      }),
      item({
        name: "Preview Luxury",
        method: "GET",
        urlPath: "invoice-settings/preview",
        query: { themeId: "luxury", accentColor: "#C9A227", copy: "ORIGINAL_FOR_RECIPIENT" },
      }),
      item({
        name: "Preview Stylish",
        method: "GET",
        urlPath: "invoice-settings/preview",
        query: { themeId: "stylish", copy: "ORIGINAL_FOR_RECIPIENT" },
      }),
    ]),

    folder("04. Sales Invoice", "Create, list, print, collect payment, issue, cancel sales bills.", [
      item({
        name: "Get next invoice number",
        method: "GET",
        urlPath: "invoices/next-number",
        query: { category: "TAX_INVOICE" },
      }),
      item({
        name: "List sales invoices",
        method: "GET",
        urlPath: "invoices",
        query: { ...page, search: "", status: "", category: "", startDate: "2026-04-01", endDate: "2027-03-31" },
      }),
      item({
        name: "Create sales invoice",
        method: "POST",
        urlPath: "invoices",
        description: "New tax invoice. Set invoiceId from the response.",
        extraHeaders: [{ key: "idempotency-key", value: "sample-idempotency-key-001" }],
        body: {
          category: "TAX_INVOICE",
          partyId: "clyparty00000000000000001",
          invoiceDate: "2026-10-28",
          dueDate: "2026-11-27",
          paymentMode: "CREDIT",
          placeOfSupply: "24",
          isB2B: true,
          warehouseId: "clywarehouse000000000001",
          notes: "Thank you for your business.",
          items: [
            {
              itemId: "clyitem000000000000000001",
              quantity: 10,
              unitPrice: 100,
              taxRate: 18,
              discountPercent: 0,
            },
          ],
        },
      }),
      item({
        name: "Get sales invoice by ID",
        method: "GET",
        urlPath: "invoices/clyinvoice00000000000001",
      }),
      item({
        name: "Print sales invoice (HTML)",
        method: "GET",
        urlPath: "invoices/clyinvoice00000000000001/print",
        query: { copy: "ORIGINAL_FOR_RECIPIENT" },
      }),
      item({
        name: "Update sales invoice",
        method: "PUT",
        urlPath: "invoices/clyinvoice00000000000001",
        body: {
          partyId: "clyparty00000000000000001",
          invoiceDate: "2026-10-28",
          placeOfSupply: "24",
          items: [
            { itemId: "clyitem000000000000000001", quantity: 12, unitPrice: 100, taxRate: 18 },
          ],
        },
      }),
      item({
        name: "Issue draft invoice",
        method: "POST",
        urlPath: "invoices/clyinvoice00000000000001/issue",
        extraHeaders: [{ key: "idempotency-key", value: "sample-idempotency-key-001" }],
        body: { allowNegativeStock: false },
      }),
      item({
        name: "Record payment on invoice",
        method: "POST",
        urlPath: "invoices/clyinvoice00000000000001/payments",
        extraHeaders: [{ key: "idempotency-key", value: "sample-idempotency-key-001" }],
        body: {
          amount: 1180,
          paymentMode: "UPI",
          paymentDate: "2026-10-28",
          referenceNo: "UPI123",
          depositToAccountId: "clycashacc0000000000001",
        },
      }),
      item({
        name: "Get invoice payment allocations",
        method: "GET",
        urlPath: "invoices/clyinvoice00000000000001/allocations",
      }),
      item({
        name: "Create return against this invoice",
        method: "POST",
        urlPath: "invoices/clyinvoice00000000000001/returns",
        body: {
          returnDate: "2026-10-28",
          reason: "Damaged goods",
          restoreStock: true,
          items: [{ quantity: 1, reason: "Damaged" }],
        },
      }),
      item({
        name: "List returns for this invoice",
        method: "GET",
        urlPath: "invoices/clyinvoice00000000000001/returns",
      }),
      item({
        name: "Cancel sales invoice",
        method: "POST",
        urlPath: "invoices/clyinvoice00000000000001/cancel",
        extraHeaders: [{ key: "idempotency-key", value: "sample-idempotency-key-001" }],
        body: { cancellationReason: "Entered by mistake", remarks: "" },
      }),
      item({
        name: "Delete sales invoice",
        method: "DELETE",
        urlPath: "invoices/clyinvoice00000000000001",
      }),
      item({
        name: "Bulk delete sales invoices",
        method: "POST",
        urlPath: "invoices/bulk-delete",
        body: { ids: ["clyinvoice00000000000001"] },
      }),
    ]),

    folder("05. POS Billing", "Counter / quick bill checkout and offline sync.", [
      item({
        name: "POS checkout",
        method: "POST",
        urlPath: "invoices/pos-checkout",
        extraHeaders: [{ key: "idempotency-key", value: "sample-idempotency-key-001" }],
        body: {
          customerPhone: "9898990002",
          customerName: "Walk-in Customer",
          paymentMode: "CASH",
          receivedAmount: 118,
          items: [
            { itemId: "clyitem000000000000000001", quantity: 1, unitPrice: 100, taxRate: 18 },
          ],
          warehouseId: "clywarehouse000000000001",
        },
      }),
      item({
        name: "POS offline sync",
        method: "POST",
        urlPath: "invoices/pos-sync",
        body: {
          terminalId: "COUNTER-1",
          syncTimestamp: "2026-10-28T10:00:00.000Z",
          invoices: [
            {
              clientOfflineUuid: "sample-idempotency-key-001",
              offlineBillNumber: "POS-001",
              customerName: "Walk-in",
              paymentMode: "CASH",
              receivedAmount: 118,
              items: [
                { itemId: "clyitem000000000000000001", quantity: 1, unitPrice: 100, taxRate: 18 },
              ],
            },
          ],
        },
      }),
    ]),

    folder("06. Sales Return (Credit Note)", "Credit notes against sales invoices.", [
      item({
        name: "List sales returns",
        method: "GET",
        urlPath: "sales-returns",
        query: page,
      }),
      item({
        name: "Create sales return",
        method: "POST",
        urlPath: "sales-returns",
        body: {
          salesInvoiceId: "clyinvoice00000000000001",
          returnDate: "2026-10-28",
          reason: "Customer returned items",
          restoreStock: true,
          items: [{ quantity: 1, reason: "Wrong item" }],
        },
      }),
      item({
        name: "Get sales return by ID",
        method: "GET",
        urlPath: "sales-returns/clysalesreturn0000000001",
      }),
      item({
        name: "Delete sales return",
        method: "DELETE",
        urlPath: "sales-returns/clysalesreturn0000000001",
      }),
    ]),

    folder("07. Delivery Challan", "Goods delivery without invoice (or with later invoice).", [
      item({
        name: "Next challan number",
        method: "GET",
        urlPath: "distribution/challans/next-number",
      }),
      item({
        name: "List delivery challans",
        method: "GET",
        urlPath: "distribution/challans",
      }),
      item({
        name: "Create delivery challan",
        method: "POST",
        urlPath: "distribution/challans",
        body: {
          warehouseId: "clywarehouse000000000001",
          partyId: "clyparty00000000000000001",
          challanDate: "2026-10-28",
          challanType: "DELIVERY",
          placeOfSupply: "24",
          vehicleNumber: "GJ01AB1234",
          items: [
            { itemId: "clyitem000000000000000001", quantity: 5, unitPrice: 100, taxRate: 18 },
          ],
        },
      }),
      item({
        name: "Get delivery challan",
        method: "GET",
        urlPath: "distribution/challans/clychallan0000000000001",
      }),
      item({
        name: "Issue challan (dispatch goods)",
        method: "POST",
        urlPath: "distribution/challans/clychallan0000000000001/issue",
        body: { vehicleNumber: "GJ01AB1234", notes: "Dispatched" },
      }),
      item({
        name: "Close challan",
        method: "POST",
        urlPath: "distribution/challans/clychallan0000000000001/close",
        body: {},
      }),
      item({
        name: "Cancel challan",
        method: "POST",
        urlPath: "distribution/challans/clychallan0000000000001/cancel",
        body: { reason: "Order cancelled" },
      }),
      item({
        name: "Prepare e-Way Bill payload for challan",
        method: "POST",
        urlPath: "distribution/challans/clychallan0000000000001/eway-bill",
        body: {
          vehicleNumber: "GJ01AB1234",
          distanceKm: 120,
          transporterName: "Local Transport",
        },
      }),
    ]),

    folder("08. Payment In (Receipt)", "Money received from customers.", [
      item({
        name: "List receipts",
        method: "GET",
        urlPath: "sales/payment-in",
        query: page,
      }),
      item({
        name: "Create payment in",
        method: "POST",
        urlPath: "sales/payment-in",
        body: {
          partyId: "clyparty00000000000000001",
          voucherDate: "2026-10-28",
          depositToAccountId: "clycashacc0000000000001",
          receivedAmount: 1180,
          paymentMode: "UPI",
          paymentReference: "UPI123",
          narration: "Against bill",
          allocations: [{ invoiceId: "clyinvoice00000000000001", settledAmount: 1180 }],
        },
      }),
      item({
        name: "Get receipt by ID",
        method: "GET",
        urlPath: "sales/payment-in/clyvoucher00000000000001",
      }),
      item({
        name: "Reverse receipt",
        method: "POST",
        urlPath: "sales/payment-in/clyvoucher00000000000001/reverse",
        body: { reason: "Entered twice" },
      }),
    ]),

    folder("09. Purchase Invoice", "Purchase bills from suppliers.", [
      item({
        name: "List purchase invoices",
        method: "GET",
        urlPath: "purchases",
        query: { search: "", startDate: "2026-04-01", endDate: "2027-03-31", limit: "20", offset: "0" },
      }),
      item({
        name: "Create purchase invoice",
        method: "POST",
        urlPath: "purchases",
        body: {
          partyId: "clysupplier0000000000001",
          vendorInvoiceNumber: "SUP-INV-001",
          invoiceDate: "2026-10-28",
          placeOfSupply: "24",
          warehouseId: "clywarehouse000000000001",
          items: [
            { itemId: "clyitem000000000000000001", quantity: 50, unitPrice: 80, taxRate: 18 },
          ],
        },
      }),
      item({
        name: "Get purchase invoice",
        method: "GET",
        urlPath: "purchases/clypurchase0000000000001",
      }),
      item({
        name: "Record supplier payment (any bills)",
        method: "POST",
        urlPath: "purchases/payments",
        extraHeaders: [{ key: "idempotency-key", value: "sample-idempotency-key-001" }],
        body: {
          amount: 4720,
          paymentMode: "BANK_TRANSFER",
          paidFromAccountId: "clybankacc0000000000001",
          paymentDate: "2026-10-28",
          allocations: [{ purchaseInvoiceId: "clypurchase0000000000001", amount: 4720 }],
        },
      }),
      item({
        name: "List payments on this purchase",
        method: "GET",
        urlPath: "purchases/clypurchase0000000000001/payments",
      }),
      item({
        name: "Pay this purchase bill",
        method: "POST",
        urlPath: "purchases/clypurchase0000000000001/payments",
        extraHeaders: [{ key: "idempotency-key", value: "sample-idempotency-key-001" }],
        body: {
          amount: 4720,
          paymentMode: "CASH",
          paymentDate: "2026-10-28",
        },
      }),
      item({
        name: "Create return against this purchase",
        method: "POST",
        urlPath: "purchases/clypurchase0000000000001/returns",
        body: {
          returnDate: "2026-10-28",
          reason: "Damaged stock",
          items: [{ purchaseItemId: "clyitem000000000000000001", quantity: 2 }],
        },
      }),
      item({
        name: "List returns for this purchase",
        method: "GET",
        urlPath: "purchases/clypurchase0000000000001/returns",
      }),
      item({
        name: "Delete purchase invoice",
        method: "DELETE",
        urlPath: "purchases/clypurchase0000000000001",
      }),
      item({
        name: "Bulk delete purchase invoices",
        method: "POST",
        urlPath: "purchases/bulk-delete",
        body: { ids: ["clypurchase0000000000001"] },
      }),
    ]),

    folder("10. Purchase Bill Scanner", "Upload supplier bill (photo/PDF), review OCR, confirm as purchase.", [
      item({
        name: "List scanned bills",
        method: "GET",
        urlPath: "purchases/scans",
        query: { status: "", search: "", page: "1", limit: "20" },
      }),
      item({
        name: "Upload bill (base64 JSON)",
        method: "POST",
        urlPath: "purchases/scans/upload",
        description: "Send fileBase64 of PDF or image. Also supports multipart file upload.",
        body: {
          fileBase64: "JVBERi0xLjQK",
          fileName: "supplier-bill.pdf",
          mimeType: "application/pdf",
          async: true,
        },
      }),
      item({
        name: "Get scanned bill",
        method: "GET",
        urlPath: "purchases/scans/clyscan00000000000000001",
      }),
      item({
        name: "Download original file",
        method: "GET",
        urlPath: "purchases/scans/clyscan00000000000000001/file",
      }),
      item({
        name: "Retry OCR",
        method: "POST",
        urlPath: "purchases/scans/clyscan00000000000000001/retry",
        query: { provider: "" },
        body: {},
      }),
      item({
        name: "Update scan draft",
        method: "PATCH",
        urlPath: "purchases/scans/clyscan00000000000000001",
        body: {
          vendorInvoiceNumber: "SUP-INV-001",
          invoiceDate: "2026-10-28",
        },
      }),
      item({
        name: "Confirm scan as purchase invoice",
        method: "POST",
        urlPath: "purchases/scans/clyscan00000000000000001/confirm",
        body: {
          partyId: "clysupplier0000000000001",
          warehouseId: "clywarehouse000000000001",
        },
      }),
      item({
        name: "Discard scanned bill",
        method: "DELETE",
        urlPath: "purchases/scans/clyscan00000000000000001",
      }),
    ]),

    folder("11. Purchase Return (Debit Note)", "Return goods to supplier.", [
      item({
        name: "List purchase returns",
        method: "GET",
        urlPath: "purchase-returns",
        query: page,
      }),
      item({
        name: "Create purchase return",
        method: "POST",
        urlPath: "purchase-returns",
        body: {
          purchaseInvoiceId: "clypurchase0000000000001",
          returnDate: "2026-10-28",
          reason: "Defective",
          items: [{ purchaseItemId: "clyitem000000000000000001", quantity: 1 }],
        },
      }),
      item({
        name: "Get purchase return",
        method: "GET",
        urlPath: "purchase-returns/clypurchreturn0000000001",
      }),
      item({
        name: "Update purchase return",
        method: "PUT",
        urlPath: "purchase-returns/clypurchreturn0000000001",
        body: {
          returnDate: "2026-10-28",
          reason: "Defective — updated",
          items: [{ purchaseItemId: "clyitem000000000000000001", quantity: 2 }],
        },
      }),
      item({
        name: "Delete purchase return",
        method: "DELETE",
        urlPath: "purchase-returns/clypurchreturn0000000001",
      }),
    ]),

    folder("12. Payment Out", "Money paid to suppliers.", [
      item({
        name: "List payments out",
        method: "GET",
        urlPath: "purchases/payment-out",
        query: page,
      }),
      item({
        name: "Create payment out",
        method: "POST",
        urlPath: "purchases/payment-out",
        body: {
          partyId: "clysupplier0000000000001",
          voucherDate: "2026-10-28",
          paidFromAccountId: "clybankacc0000000000001",
          amount: 4720,
          paymentMode: "BANK_TRANSFER",
          referenceNo: "NEFT001",
          allocations: [{ purchaseInvoiceId: "clypurchase0000000000001", amount: 4720 }],
        },
      }),
      item({
        name: "Get payment out",
        method: "GET",
        urlPath: "purchases/payment-out/clyvoucher00000000000001",
      }),
      item({
        name: "Update payment out",
        method: "PUT",
        urlPath: "purchases/payment-out/clyvoucher00000000000001",
        body: {
          partyId: "clysupplier0000000000001",
          voucherDate: "2026-10-28",
          amount: 4720,
          paymentMode: "CASH",
        },
      }),
      item({
        name: "Cancel payment out",
        method: "DELETE",
        urlPath: "purchases/payment-out/clyvoucher00000000000001",
      }),
    ]),

    folder("13. Expenses", "Business expense vouchers.", [
      item({
        name: "List expenses",
        method: "GET",
        urlPath: "expenses",
        query: { ...page, search: "", startDate: "2026-04-01", endDate: "2027-03-31" },
      }),
      item({
        name: "Create expense",
        method: "POST",
        urlPath: "expenses",
        body: {
          expenseAccountId: "clyexpenseacc0000000001",
          paidFromAccountId: "clycashacc0000000000001",
          amount: 500,
          voucherDate: "2026-10-28",
          narration: "Office tea & snacks",
        },
      }),
      item({
        name: "Get expense",
        method: "GET",
        urlPath: "expenses/clyvoucher00000000000001",
      }),
      item({
        name: "Update expense",
        method: "PUT",
        urlPath: "expenses/clyvoucher00000000000001",
        body: {
          expenseAccountId: "clyexpenseacc0000000001",
          paidFromAccountId: "clycashacc0000000000001",
          amount: 550,
          narration: "Updated",
        },
      }),
      item({
        name: "Delete / reverse expense",
        method: "DELETE",
        urlPath: "expenses/clyvoucher00000000000001",
      }),
    ]),

    folder("14. Parties (Customers & Suppliers)", "Master — customers, suppliers, both.", [
      item({
        name: "List parties",
        method: "GET",
        urlPath: "parties",
        query: { search: "", type: "", page: "1", limit: "20", isActive: "true" },
      }),
      item({
        name: "Lookup GSTIN",
        method: "GET",
        urlPath: "parties/lookup/gstin/24AAAAA0000A1Z5",
        description: "Fill party form from GSTIN.",
      }),
      item({
        name: "Create party",
        method: "POST",
        urlPath: "parties",
        body: {
          type: "CUSTOMER",
          name: "Aman Traders",
          phone: "9876543210",
          email: "aman@example.com",
          gstin: "24AAAAA0000A1Z5",
          gstType: "REGULAR",
          stateCode: "24",
          billingAddress: {
            line1: "Shop 12, Ring Road",
            city: "Ahmedabad",
            state: "Gujarat",
            pincode: "380001",
          },
          creditDays: 30,
        },
      }),
      item({
        name: "Get party",
        method: "GET",
        urlPath: "parties/clyparty00000000000000001",
      }),
      item({
        name: "Update party",
        method: "PUT",
        urlPath: "parties/clyparty00000000000000001",
        body: { name: "Aman Traders", phone: "9876543210", creditDays: 45 },
      }),
      item({
        name: "Archive party",
        method: "PATCH",
        urlPath: "parties/clyparty00000000000000001/archive",
        body: {},
      }),
      item({
        name: "Delete party",
        method: "DELETE",
        urlPath: "parties/clyparty00000000000000001",
        query: { force: "false" },
      }),
      item({
        name: "Bulk delete parties",
        method: "POST",
        urlPath: "parties/bulk-delete",
        body: { ids: ["clyparty00000000000000001"], force: false },
      }),
    ]),

    folder("15. Items (Inventory)", "Item master, stock lookup, adjust stock.", [
      item({
        name: "List items",
        method: "GET",
        urlPath: "items",
        query: { search: "", type: "", page: "1", limit: "20", isActive: "true" },
      }),
      item({
        name: "Lookup item by code / barcode / SKU",
        method: "GET",
        urlPath: "items/lookup",
        query: { code: "ITEM-001" },
      }),
      item({
        name: "Create item",
        method: "POST",
        urlPath: "items",
        body: {
          type: "PRODUCT",
          name: "Cotton Shirt",
          sku: "SHIRT-001",
          hsnCode: "6105",
          primaryUomId: "clyunit000000000000000001",
          categoryId: "clycategory000000000001",
          taxRate: 5,
          purchaseRate: 400,
          retailPrice: 799,
          mrp: 999,
          openingStock: 20,
          warehouseId: "clywarehouse000000000001",
          trackBatches: false,
        },
      }),
      item({
        name: "Get item",
        method: "GET",
        urlPath: "items/clyitem000000000000000001",
      }),
      item({
        name: "Update item",
        method: "PUT",
        urlPath: "items/clyitem000000000000000001",
        body: { name: "Cotton Shirt", retailPrice: 849, taxRate: 5 },
      }),
      item({
        name: "Adjust stock",
        method: "POST",
        urlPath: "items/clyitem000000000000000001/adjust-stock",
        body: {
          quantity: 5,
          type: "ADD",
          warehouseId: "clywarehouse000000000001",
          date: "2026-10-28",
          remarks: "Physical count extra",
        },
      }),
      item({
        name: "Item stock movements",
        method: "GET",
        urlPath: "invoices/items/clyitem000000000000000001/stock-movements",
      }),
      item({
        name: "Archive item",
        method: "PATCH",
        urlPath: "items/clyitem000000000000000001/archive",
        body: {},
      }),
      item({
        name: "Delete item",
        method: "DELETE",
        urlPath: "items/clyitem000000000000000001",
        query: { force: "false" },
      }),
      item({
        name: "Bulk delete items",
        method: "POST",
        urlPath: "items/bulk-delete",
        body: { ids: ["clyitem000000000000000001"], force: false },
      }),
    ]),

    folder("16. Stock Movements", "All inventory in/out transactions.", [
      item({
        name: "List stock movements",
        method: "GET",
        urlPath: "invoices/stock-movements",
        query: { page: "1", limit: "20" },
      }),
    ]),

    folder("17. Batches", "Batch / expiry tracking for items.", [
      item({
        name: "List batches",
        method: "GET",
        urlPath: "batches",
        query: { itemId: "clyitem000000000000000001" },
      }),
      item({
        name: "Create batch",
        method: "POST",
        urlPath: "batches",
        body: {
          itemId: "clyitem000000000000000001",
          batchNumber: "B-2026-01",
          mfgDate: "2026-04-01",
          expiryDate: "2027-03-31",
          mrp: 999,
          salePrice: 799,
        },
      }),
      item({
        name: "Get batch",
        method: "GET",
        urlPath: "batches/clybatch0000000000000001",
      }),
    ]),

    folder("18. Warehouses", "Godown / store locations.", [
      item({
        name: "List warehouses",
        method: "GET",
        urlPath: "warehouses",
      }),
      item({
        name: "Create warehouse",
        method: "POST",
        urlPath: "warehouses",
        body: {
          name: "Main Godown",
          isDefault: false,
          address: "Naroda, Ahmedabad",
          branchId: "{{branchId}}",
        },
      }),
      item({
        name: "Update warehouse",
        method: "PUT",
        urlPath: "warehouses/clywarehouse000000000001",
        body: { name: "Main Godown", isDefault: true },
      }),
      item({
        name: "Delete warehouse",
        method: "DELETE",
        urlPath: "warehouses/clywarehouse000000000001",
      }),
    ]),

    folder("19. Stock Transfer", "Move stock between warehouses.", [
      item({
        name: "List stock transfers",
        method: "GET",
        urlPath: "distribution/transfers",
      }),
      item({
        name: "Create stock transfer",
        method: "POST",
        urlPath: "distribution/transfers",
        body: {
          fromWarehouseId: "clywarehouse000000000001",
          toWarehouseId: "clywarehouse000000000002",
          transferDate: "2026-10-28",
          notes: "Replenish branch",
          items: [{ itemId: "clyitem000000000000000001", quantity: 10 }],
        },
      }),
      item({
        name: "Get stock transfer",
        method: "GET",
        urlPath: "distribution/transfers/clytransfer000000000001",
      }),
      item({
        name: "Transfer reconciliation",
        method: "GET",
        urlPath: "distribution/transfers/clytransfer000000000001/reconciliation",
      }),
      item({
        name: "Update draft transfer",
        method: "PUT",
        urlPath: "distribution/transfers/clytransfer000000000001",
        body: { notes: "Updated notes" },
      }),
      item({
        name: "Dispatch transfer",
        method: "POST",
        urlPath: "distribution/transfers/clytransfer000000000001/dispatch",
        body: { vehicleNumber: "GJ01AB1234", notes: "On the way" },
      }),
      item({
        name: "Receive transfer",
        method: "POST",
        urlPath: "distribution/transfers/clytransfer000000000001/receive",
        body: {
          items: [
            {
              itemId: "clyitem000000000000000001",
              receivedQuantity: 10,
              shortageQuantity: 0,
              damageQuantity: 0,
            },
          ],
        },
      }),
      item({
        name: "Cancel transfer",
        method: "POST",
        urlPath: "distribution/transfers/clytransfer000000000001/cancel",
        body: { reason: "Not required" },
      }),
    ]),

    folder("20. Categories", "Item categories.", [
      item({ name: "List categories", method: "GET", urlPath: "categories" }),
      item({
        name: "Create category",
        method: "POST",
        urlPath: "categories",
        body: { name: "Apparel", nameGujarati: "વસ્ત્ર" },
      }),
      item({ name: "Get category", method: "GET", urlPath: "categories/clycategory000000000001" }),
      item({
        name: "Update category",
        method: "PUT",
        urlPath: "categories/clycategory000000000001",
        body: { name: "Apparel" },
      }),
      item({ name: "Delete category", method: "DELETE", urlPath: "categories/clycategory000000000001" }),
      item({
        name: "Bulk delete categories",
        method: "POST",
        urlPath: "categories/bulk-delete",
        body: { ids: ["clycategory000000000001"] },
      }),
    ]),

    folder("21. Units of Measure", "PCS, KG, BOX, etc.", [
      item({ name: "List units", method: "GET", urlPath: "units" }),
      item({
        name: "Create unit",
        method: "POST",
        urlPath: "units",
        body: { name: "Piece", symbol: "PCS", uqcCode: "NOS", decimalPlaces: 0 },
      }),
      item({ name: "Get unit", method: "GET", urlPath: "units/clyunit000000000000000001" }),
      item({
        name: "Update unit",
        method: "PUT",
        urlPath: "units/clyunit000000000000000001",
        body: { name: "Piece", symbol: "PCS", uqcCode: "NOS" },
      }),
      item({ name: "Delete unit", method: "DELETE", urlPath: "units/clyunit000000000000000001" }),
      item({
        name: "Bulk delete units",
        method: "POST",
        urlPath: "units/bulk-delete",
        body: { ids: ["clyunit000000000000000001"] },
      }),
    ]),

    folder("22. HSN / SAC", "GST HSN and SAC codes.", [
      item({
        name: "List HSN codes",
        method: "GET",
        urlPath: "hsn",
        query: { search: "", type: "HSN", page: "1", limit: "20", isActive: "true" },
      }),
      item({
        name: "Search HSN",
        method: "GET",
        urlPath: "hsn/search",
        query: { q: "cotton", limit: "10" },
      }),
      item({
        name: "Create HSN",
        method: "POST",
        urlPath: "hsn",
        body: {
          code: "6105",
          description: "Men's or boys' shirts, knitted",
          type: "HSN",
          gstRate: 5,
        },
      }),
      item({ name: "Get HSN", method: "GET", urlPath: "hsn/clyhsn0000000000000000001" }),
      item({
        name: "Update HSN",
        method: "PUT",
        urlPath: "hsn/clyhsn0000000000000000001",
        body: { description: "Men's shirts", gstRate: 5 },
      }),
      item({
        name: "Toggle HSN active status",
        method: "PATCH",
        urlPath: "hsn/clyhsn0000000000000000001/status",
        body: { isActive: true },
      }),
      item({ name: "Delete HSN", method: "DELETE", urlPath: "hsn/clyhsn0000000000000000001" }),
    ]),

    folder("23. Bank Accounts", "Cash and bank ledgers shown on banking screen.", [
      item({ name: "List bank & cash accounts", method: "GET", urlPath: "bank-accounts" }),
      item({
        name: "Create bank account",
        method: "POST",
        urlPath: "bank-accounts",
        body: {
          name: "HDFC Current",
          bankName: "HDFC Bank",
          bankAccountNo: "50100012345678",
          openingBalance: 10000,
          openingType: "DR",
        },
      }),
      item({ name: "Get bank account", method: "GET", urlPath: "bank-accounts/clybankacc0000000000001" }),
      item({
        name: "Update bank account",
        method: "PUT",
        urlPath: "bank-accounts/clybankacc0000000000001",
        body: { name: "HDFC Current A/c" },
      }),
      item({ name: "Delete bank account", method: "DELETE", urlPath: "bank-accounts/clybankacc0000000000001" }),
    ]),

    folder("24. Chart of Accounts", "Ledger groups and ledger accounts.", [
      item({
        name: "Seed standard groups",
        method: "POST",
        urlPath: "ledger-groups/seed",
        description: "Create default Indian accounting groups if missing.",
        body: {},
      }),
      item({ name: "List ledger groups", method: "GET", urlPath: "ledger-groups" }),
      item({
        name: "Create ledger group",
        method: "POST",
        urlPath: "ledger-groups",
        body: { name: "Indirect Expenses", nature: "EXPENSE" },
      }),
      item({
        name: "List ledger accounts",
        method: "GET",
        urlPath: "ledgers",
        query: { search: "" },
      }),
      item({
        name: "Create ledger account",
        method: "POST",
        urlPath: "ledgers",
        body: {
          groupId: "clygroup0000000000000001",
          name: "Office Rent",
          openingBalance: 0,
          openingType: "DR",
        },
      }),
      item({ name: "Get ledger account", method: "GET", urlPath: "ledgers/clyledger000000000000001" }),
      item({
        name: "Update ledger account",
        method: "PATCH",
        urlPath: "ledgers/clyledger000000000000001",
        body: { name: "Office Rent" },
      }),
      item({ name: "Deactivate ledger account", method: "DELETE", urlPath: "ledgers/clyledger000000000000001" }),
    ]),

    folder("25. Journal Vouchers", "Manual journal, receipts, payments, reverse posted vouchers.", [
      item({
        name: "List all vouchers",
        method: "GET",
        urlPath: "vouchers",
        query: page,
      }),
      item({
        name: "Create journal voucher",
        method: "POST",
        urlPath: "vouchers",
        body: {
          voucherType: "JOURNAL",
          voucherNumber: "JV-001",
          voucherDate: "2026-10-28",
          narration: "Adjustment",
          lines: [
            { accountId: "clyledger000000000000001", debitAmount: 1000, creditAmount: 0 },
            { accountId: "clycashacc0000000000001", debitAmount: 0, creditAmount: 1000 },
          ],
        },
      }),
      item({
        name: "Create receipt voucher",
        method: "POST",
        urlPath: "vouchers/receipt",
        body: {
          partyId: "clyparty00000000000000001",
          voucherDate: "2026-10-28",
          receivedAmount: 500,
          paymentMode: "CASH",
        },
      }),
      item({
        name: "Create expense voucher",
        method: "POST",
        urlPath: "vouchers/expense",
        body: {
          expenseAccountId: "clyexpenseacc0000000001",
          paidFromAccountId: "clycashacc0000000000001",
          amount: 200,
          voucherDate: "2026-10-28",
          narration: "Petrol",
        },
      }),
      item({
        name: "Update expense voucher",
        method: "PUT",
        urlPath: "vouchers/expense/clyvoucher00000000000001",
        body: { amount: 250, narration: "Petrol updated" },
      }),
      item({
        name: "List receipts (from vouchers)",
        method: "GET",
        urlPath: "vouchers/receipts",
        query: page,
      }),
      item({
        name: "List payments out (from vouchers)",
        method: "GET",
        urlPath: "vouchers/payments-out",
        query: page,
      }),
      item({
        name: "Create payment-out voucher",
        method: "POST",
        urlPath: "vouchers/payment-out",
        body: {
          partyId: "clysupplier0000000000001",
          voucherDate: "2026-10-28",
          amount: 1000,
          paymentMode: "CASH",
        },
      }),
      item({ name: "Get voucher", method: "GET", urlPath: "vouchers/clyvoucher00000000000001" }),
      item({
        name: "Reverse voucher",
        method: "POST",
        urlPath: "vouchers/clyvoucher00000000000001/reverse",
        body: { reason: "Wrong entry" },
      }),
    ]),

    folder("26. Company Settings", "Business profile like myBillBook — logo, GST, e-invoice, TDS/TCS, extra details, close year.", [
      item({ name: "Get current company (active profile)", method: "GET", urlPath: "tenants/company" }),
      item({ name: "Settings dropdown options", method: "GET", urlPath: "tenants/company/settings-options" }),
      item({
        name: "Save business profile",
        method: "PATCH",
        urlPath: "tenants/company",
        body: {
          tradeName: "JK Enterprise",
          legalName: "JK Enterprise",
          phone: "8238812890",
          email: "jk@example.com",
          addressLine1: "Commercial Market Center",
          city: "Ahmedabad",
          pincode: "380001",
          stateCode: "24",
          gstRegistered: true,
          gstin: "24ABCDEF1234F1Z5",
          pan: "ABCDEF1234F",
          eInvoiceApplicable: true,
          enableTds: false,
          enableTcs: false,
          businessTypes: ["RETAILER"],
          industryType: "RETAIL",
          registrationType: "PRIVATE_LIMITED",
          bankName: "State Bank of India",
          bankAccountNo: "123456789012",
          bankIfsc: "SBIN0001234",
          upiVpa: "business@okaxis",
          signatoryName: "Jaydeep Patel",
          signatoryDesignation: "Authorised Signatory",
        },
      }),
      item({
        name: "Upload logo (base64 PNG/JPG max 5MB)",
        method: "POST",
        urlPath: "tenants/company/logo",
        body: { fileBase64: "", fileName: "logo.png" },
      }),
      item({ name: "Get logo image", method: "GET", urlPath: "tenants/company/logo" }),
      item({
        name: "Upload signature",
        method: "POST",
        urlPath: "tenants/company/signature",
        body: { fileBase64: "", fileName: "sign.png" },
      }),
      item({
        name: "Add extra detail (MSME / Website)",
        method: "POST",
        urlPath: "tenants/company/extra-details",
        body: { key: "Website", value: "www.website.com" },
      }),
      item({ name: "Export masters to Tally JSON", method: "GET", urlPath: "tenants/company/tally-export" }),
      item({ name: "List companies (All Companies tab)", method: "GET", urlPath: "tenants/companies" }),
      item({
        name: "Create new business",
        method: "POST",
        urlPath: "tenants/companies",
        body: {
          legalName: "Second Company",
          tradeName: "Second Co",
          gstRegistered: false,
          stateCode: "24",
          city: "Ahmedabad",
          phone: "9898990002",
          branchName: "Main",
          branchCode: "MAIN",
        },
      }),
    ]),

    folder("27. Branches", "Company branches.", [
      item({ name: "List branches", method: "GET", urlPath: "tenants/branches" }),
      item({
        name: "Create branch",
        method: "POST",
        urlPath: "tenants/branches",
        body: { name: "SG Highway Branch", code: "SGH", address: "Ahmedabad" },
      }),
    ]),

    folder("28. Financial Years", "Accounting years for the company.", [
      item({ name: "List financial years", method: "GET", urlPath: "tenants/financial-years" }),
      item({
        name: "Close financial year",
        method: "POST",
        urlPath: "tenants/financial-years/clyfyear00000000000000001/close",
        description: "Locks the year and opens the next FY as current. Paste real financial year id in the URL.",
        body: {},
      }),
    ]),

    folder("29. Users & Activity", "Staff users of this organization.", [
      item({ name: "List users", method: "GET", urlPath: "tenants/users" }),
      item({
        name: "Invite / create user",
        method: "POST",
        urlPath: "tenants/users",
        body: {
          name: "Cashier One",
          phone: "9898990003",
          email: "cashier@example.com",
          role: "CASHIER",
          branchId: "{{branchId}}",
        },
      }),
      item({
        name: "Update user",
        method: "PATCH",
        urlPath: "tenants/users/clyuser00000000000000001",
        body: { name: "Cashier One", role: "CASHIER", isActive: true },
      }),
      item({ name: "Delete user", method: "DELETE", urlPath: "tenants/users/clyuser00000000000000001" }),
      item({ name: "Activity log", method: "GET", urlPath: "tenants/activities" }),
    ]),

    folder("30. Subscription", "Plan upgrade and billing history.", [
      item({ name: "Billing history", method: "GET", urlPath: "tenants/billing-history" }),
      item({
        name: "Upgrade subscription",
        method: "POST",
        urlPath: "tenants/subscription/upgrade",
        body: { tier: "PREMIUM", billingCycle: "1year" },
      }),
    ]),

    folder("31. GST — Verify, Documents, Portal", "GSTIN check, portal config, outward documents.", [
      item({
        name: "Verify GSTIN",
        method: "POST",
        urlPath: "gst/verify-gstin",
        body: { gstin: "24AAAAA0000A1Z5", forceRefresh: false },
      }),
      item({ name: "Get GST portal integration", method: "GET", urlPath: "gst/integration" }),
      item({
        name: "Save GST portal credentials",
        method: "PUT",
        urlPath: "gst/integration",
        body: {
          gstin: "24AAAAA0000A1Z5",
          username: "portal-user",
          password: "",
          environment: "SANDBOX",
        },
      }),
      item({ name: "Sandbox ping", method: "POST", urlPath: "gst/integration/sandbox-ping", body: {} }),
      item({
        name: "List GST documents",
        method: "GET",
        urlPath: "gst/documents",
        query: dateRange,
      }),
      item({ name: "GST audit log", method: "GET", urlPath: "gst/audit" }),
      item({
        name: "Create GST debit note",
        method: "POST",
        urlPath: "gst/debit-notes",
        body: { purchaseInvoiceId: "clypurchase0000000000001", reason: "Rate difference", amount: 100 },
      }),
      item({
        name: "Create GST advance",
        method: "POST",
        urlPath: "gst/advances",
        body: { partyId: "clyparty00000000000000001", amount: 1000, voucherDate: "2026-10-28" },
      }),
      item({
        name: "Adjust GST advance",
        method: "POST",
        urlPath: "gst/advances/clyvoucher00000000000001/adjustments",
        body: { invoiceId: "clyinvoice00000000000001", amount: 500 },
      }),
    ]),

    folder("32. GST — e-Invoice", "Generate / cancel IRN on sales invoice.", [
      item({
        name: "Generate e-Invoice (IRN)",
        method: "POST",
        urlPath: "gst/einvoice/clyinvoice00000000000001/generate",
        extraHeaders: [{ key: "x-idempotency-key", value: "sample-idempotency-key-001" }],
        body: {},
      }),
      item({ name: "e-Invoice status", method: "GET", urlPath: "gst/einvoice/clyinvoice00000000000001" }),
      item({
        name: "Cancel e-Invoice",
        method: "POST",
        urlPath: "gst/einvoice/clyinvoice00000000000001/cancel",
        extraHeaders: [{ key: "x-idempotency-key", value: "sample-idempotency-key-001" }],
        body: { reasonCode: "1", remarks: "Data entry error" },
      }),
    ]),

    folder("33. GST — e-Way Bill", "Generate, link, cancel, update vehicle.", [
      item({
        name: "List e-Way Bills",
        method: "GET",
        urlPath: "gst/eway-bills",
        query: { status: "", search: "", ...dateRange },
      }),
      item({
        name: "Generate e-Way Bill for invoice",
        method: "POST",
        urlPath: "gst/eway-bills/invoices/clyinvoice00000000000001/generate",
        extraHeaders: [{ key: "x-idempotency-key", value: "sample-idempotency-key-001" }],
        body: {
          vehicleNumber: "GJ01AB1234",
          distanceKm: 120,
          transporterName: "Local Transport",
        },
      }),
      item({
        name: "Generate e-Way Bill for challan",
        method: "POST",
        urlPath: "gst/eway-bills/challans/clychallan0000000000001/generate",
        extraHeaders: [{ key: "x-idempotency-key", value: "sample-idempotency-key-001" }],
        body: { vehicleNumber: "GJ01AB1234", distanceKm: 80 },
      }),
      item({
        name: "Link existing e-Way Bill",
        method: "POST",
        urlPath: "gst/eway-bills/link",
        body: {
          invoiceId: "clyinvoice00000000000001",
          ewbNumber: "111222333444",
          distanceKm: 120,
          vehicleNumber: "GJ01AB1234",
        },
      }),
      item({
        name: "e-Way Bill details",
        method: "GET",
        urlPath: "gst/eway-bills/111222333444/details",
      }),
      item({
        name: "e-Way Bill status",
        method: "GET",
        urlPath: "gst/eway-bills/111222333444",
      }),
      item({
        name: "Cancel e-Way Bill",
        method: "POST",
        urlPath: "gst/eway-bills/111222333444/cancel",
        body: { reasonCode: "1", remarks: "Duplicate" },
      }),
      item({
        name: "Update vehicle on e-Way Bill",
        method: "POST",
        urlPath: "gst/eway-bills/111222333444/vehicle",
        body: {
          vehicleNumber: "GJ01CD5678",
          reasonCode: "1",
          remarks: "Vehicle breakdown",
          fromPlace: "Ahmedabad",
        },
      }),
    ]),

    folder("34. GST — GSTR-2B", "Import 2B JSON, reconcile ITC.", [
      item({
        name: "Import GSTR-2B file (JSON content)",
        method: "POST",
        urlPath: "gst/gstr-2b/imports",
        body: {
          fileName: "gstr2b.json",
          returnPeriod: "202604",
          content: "{}",
        },
      }),
      item({
        name: "GSTR-2B summary",
        method: "GET",
        urlPath: "gst/gstr-2b/summary",
        query: { returnPeriod: "202604" },
      }),
      item({
        name: "List reconciliations",
        method: "GET",
        urlPath: "gst/gstr-2b/reconciliations",
        query: { returnPeriod: "202604", status: "", itcDecision: "" },
      }),
      item({
        name: "Export GSTR-2B CSV",
        method: "GET",
        urlPath: "gst/gstr-2b/export",
        query: { returnPeriod: "202604" },
      }),
      item({
        name: "Review reconciliation row",
        method: "POST",
        urlPath: "gst/gstr-2b/reconciliations/clygstr2b00000000000001/review",
        body: { itcDecision: "ACCEPT", status: "REVIEWED", reason: "Matched" },
      }),
      item({
        name: "Reconciliation history",
        method: "GET",
        urlPath: "gst/gstr-2b/reconciliations/clygstr2b00000000000001/history",
      }),
    ]),

    folder("35. Reports", "All report screens — sales, purchase, GST, stock, accounts.", [
      folder("Dashboard reports", "", [
        item({
          name: "Financial summary",
          method: "GET",
          urlPath: "reports/financial-summary",
          query: { asOfDate: "2026-10-28" },
        }),
        item({
          name: "Dashboard summary (reports)",
          method: "GET",
          urlPath: "reports/dashboard-summary",
          query: { asOfDate: "2026-10-28" },
        }),
      ]),
      folder("Sales reports", "", [
        item({ name: "Sales register", method: "GET", urlPath: "reports/sales-register", query: dateRange }),
        item({ name: "Export sales register CSV", method: "GET", urlPath: "reports/sales-register/export", query: dateRange }),
        item({ name: "GST sales with HSN", method: "GET", urlPath: "reports/gst-sales-hsn", query: dateRange }),
        item({ name: "Item-wise sales", method: "GET", urlPath: "reports/item-sales-report", query: dateRange }),
        item({ name: "Party-wise sales", method: "GET", urlPath: "reports/party-sales-report", query: dateRange }),
        item({ name: "Sales returns report", method: "GET", urlPath: "reports/sales-returns", query: dateRange }),
        item({ name: "Quotations report", method: "GET", urlPath: "reports/quotations-report", query: dateRange }),
        item({ name: "Delivery challans report", method: "GET", urlPath: "reports/delivery-challans-report", query: dateRange }),
        item({ name: "Bill-wise profit", method: "GET", urlPath: "reports/bill-wise-profit", query: dateRange }),
        item({ name: "HSN-wise sales summary", method: "GET", urlPath: "reports/hsn-sales-summary", query: dateRange }),
      ]),
      folder("Purchase reports", "", [
        item({ name: "Purchase register", method: "GET", urlPath: "reports/purchase-register", query: dateRange }),
        item({ name: "GST purchase with HSN", method: "GET", urlPath: "reports/gst-purchase-hsn", query: dateRange }),
        item({ name: "Item-wise purchase", method: "GET", urlPath: "reports/item-purchase-report", query: dateRange }),
        item({ name: "Party-wise purchase", method: "GET", urlPath: "reports/party-purchase-report", query: dateRange }),
        item({ name: "Purchase returns report", method: "GET", urlPath: "reports/purchase-returns", query: dateRange }),
      ]),
      folder("Accounts reports", "", [
        item({ name: "Receipt / payment register", method: "GET", urlPath: "reports/receipt-payment-register", query: dateRange }),
        item({ name: "Outstanding balances", method: "GET", urlPath: "reports/outstanding-balances", query: { asOfDate: "2026-10-28" } }),
        item({ name: "Party aging", method: "GET", urlPath: "reports/party-aging", query: { asOfDate: "2026-10-28", partyId: "clyparty00000000000000001" } }),
        item({ name: "Party ledger (Khata)", method: "GET", urlPath: "reports/party-ledger", query: { partyId: "clyparty00000000000000001", ...dateRange } }),
        item({ name: "General ledger", method: "GET", urlPath: "reports/general-ledger", query: { accountId: "clyledger000000000000001", ...dateRange } }),
        item({ name: "Trial balance", method: "GET", urlPath: "reports/trial-balance", query: { financialYearId: "{{financialYearId}}" } }),
        item({ name: "Profit and loss", method: "GET", urlPath: "reports/profit-and-loss", query: { financialYearId: "{{financialYearId}}" } }),
        item({ name: "Balance sheet", method: "GET", urlPath: "reports/balance-sheet", query: { financialYearId: "{{financialYearId}}" } }),
        item({ name: "Daybook (Rojmel)", method: "GET", urlPath: "reports/daybook", query: { date: "2026-10-28" } }),
        item({ name: "Cash flow", method: "GET", urlPath: "reports/cash-flow", query: { financialYearId: "{{financialYearId}}" } }),
        item({ name: "Expense category report", method: "GET", urlPath: "reports/expense-category-report", query: dateRange }),
        item({ name: "Audit trail", method: "GET", urlPath: "reports/audit-trail", query: dateRange }),
      ]),
      folder("Stock reports", "", [
        item({ name: "Stock summary", method: "GET", urlPath: "reports/stock-summary", query: { warehouseId: "clywarehouse000000000001" } }),
        item({ name: "Stock movement", method: "GET", urlPath: "reports/stock-movement", query: { itemId: "clyitem000000000000000001", ...dateRange } }),
        item({ name: "Batch expiry", method: "GET", urlPath: "reports/batch-expiry-report", query: dateRange }),
        item({ name: "Low stock alert", method: "GET", urlPath: "reports/low-stock-alert" }),
      ]),
      folder("GST reports", "", [
        item({ name: "GSTR-1", method: "GET", urlPath: "reports/gstr-1", query: { month: "10", year: "2026" } }),
        item({ name: "GST summary", method: "GET", urlPath: "reports/gst-summary", query: { month: "10", year: "2026" } }),
        item({ name: "GSTR-3B", method: "GET", urlPath: "reports/gstr-3b", query: { month: "10", year: "2026" } }),
      ]),
    ]),

    folder("36. Manufacturing — BOM", "Bill of materials for finished goods.", [
      item({ name: "List BOMs", method: "GET", urlPath: "manufacturing/boms" }),
      item({
        name: "Create BOM",
        method: "POST",
        urlPath: "manufacturing/boms",
        body: {
          finishedItemId: "clyitem000000000000000001",
          bomName: "Shirt BOM",
          batchYieldQty: 1,
          laborCostEst: 20,
          overheadCostEst: 10,
          items: [{ rawItemId: "clyitem000000000000000001", quantity: 1.1, wastagePercent: 5 }],
        },
      }),
      item({ name: "Get BOM", method: "GET", urlPath: "manufacturing/boms/clybom000000000000000001" }),
      item({
        name: "Update BOM",
        method: "PUT",
        urlPath: "manufacturing/boms/clybom000000000000000001",
        body: { bomName: "Shirt BOM v2", batchYieldQty: 1 },
      }),
      item({ name: "Delete BOM", method: "DELETE", urlPath: "manufacturing/boms/clybom000000000000000001" }),
    ]),

    folder("37. Manufacturing — Production Orders", "Start and complete production.", [
      item({ name: "List production orders", method: "GET", urlPath: "manufacturing/orders" }),
      item({
        name: "Create production order",
        method: "POST",
        urlPath: "manufacturing/orders",
        body: {
          bomId: "clybom000000000000000001",
          targetQuantity: 10,
          startDate: "2026-10-28",
        },
      }),
      item({ name: "Get production order", method: "GET", urlPath: "manufacturing/orders/clyprodorder00000000001" }),
      item({
        name: "Start production",
        method: "POST",
        urlPath: "manufacturing/orders/clyprodorder00000000001/start",
        body: { sourceWarehouseId: "clywarehouse000000000001" },
      }),
      item({
        name: "Complete production",
        method: "POST",
        urlPath: "manufacturing/orders/clyprodorder00000000001/complete",
        body: {
          targetWarehouseId: "clywarehouse000000000001",
          actualProducedQty: 10,
          scrapQuantity: 0,
          batchNumber: "PROD-001",
          mfgDate: "2026-10-28",
        },
      }),
      item({
        name: "Cancel production order",
        method: "POST",
        urlPath: "manufacturing/orders/clyprodorder00000000001/cancel",
        body: { reason: "Not required" },
      }),
    ]),

    folder("38. Inventory Reconciliation", "Physical stock vs books, in-transit, manufacturing cost.", [
      item({
        name: "Stock vs GL",
        method: "GET",
        urlPath: "reconciliation/stock-gl",
        query: { asOfDate: "2026-10-28", warehouseId: "clywarehouse000000000001" },
      }),
      item({
        name: "In-transit valuation",
        method: "GET",
        urlPath: "reconciliation/in-transit",
        query: { asOfDate: "2026-10-28" },
      }),
      item({
        name: "Manufacturing cost reconciliation",
        method: "GET",
        urlPath: "reconciliation/manufacturing-cost",
      }),
      item({
        name: "Post manufacturing journal",
        method: "POST",
        urlPath: "reconciliation/post-manufacturing-journal",
        body: {
          journalType: "MANUFACTURING_COMPLETION",
          productionOrderId: "clyprodorder00000000001",
          voucherDate: "2026-10-28",
        },
      }),
      item({
        name: "Post transit loss journal",
        method: "POST",
        urlPath: "reconciliation/post-transit-loss-journal",
        body: {
          journalType: "TRANSIT_LOSS_WRITEOFF",
          stockTransferId: "clytransfer000000000001",
          voucherDate: "2026-10-28",
        },
      }),
      item({
        name: "Reverse inventory journal",
        method: "POST",
        urlPath: "reconciliation/vouchers/clyvoucher00000000000001/reverse",
        body: { reason: "Correction" },
      }),
    ]),

    folder("39. Import Data", "Excel / CSV import for parties, items, etc.", [
      item({
        name: "List import modules",
        method: "GET",
        urlPath: "imports/modules",
        description: "Which screens can be imported. No login required.",
        auth: false,
      }),
      item({
        name: "Get module schema",
        method: "GET",
        urlPath: "imports/parties/schema",
        auth: false,
      }),
      item({
        name: "Download template",
        method: "GET",
        urlPath: "imports/parties/template",
        query: { format: "xlsx" },
        auth: false,
      }),
      item({
        name: "Parse uploaded file (base64)",
        method: "POST",
        urlPath: "imports/parse",
        body: {
          module: "parties",
          fileName: "parties.xlsx",
          fileBase64: "",
        },
      }),
      item({
        name: "Validate column mapping",
        method: "POST",
        urlPath: "imports/validate",
        body: {
          jobId: "clyimportjob00000000001",
          module: "parties",
          mapping: { name: "Name", phone: "Phone", type: "Type" },
          mode: "CREATE",
        },
      }),
      item({
        name: "Execute import",
        method: "POST",
        urlPath: "imports/execute",
        body: {
          jobId: "clyimportjob00000000001",
          module: "parties",
          mapping: { name: "Name", phone: "Phone", type: "Type" },
          mode: "CREATE",
          errorPolicy: "SKIP",
        },
      }),
      item({ name: "Import job history", method: "GET", urlPath: "imports/jobs" }),
      item({ name: "Get import job", method: "GET", urlPath: "imports/jobs/clyimportjob00000000001" }),
      item({
        name: "Download import errors",
        method: "GET",
        urlPath: "imports/jobs/clyimportjob00000000001/errors",
        query: { format: "xlsx" },
      }),
    ]),

    folder("40. Mail & Support", "Send email and contact support.", [
      item({
        name: "Send email",
        method: "POST",
        urlPath: "mail/send",
        body: {
          to: "customer@example.com",
          subject: "Your invoice",
          text: "Please find your invoice attached.",
          heading: "Invoice",
        },
      }),
      item({
        name: "Contact support",
        method: "POST",
        urlPath: "mail/support",
        body: {
          name: "Jaydeep",
          phone: "9898990001",
          email: "owner@example.com",
          subject: "Need help with GST",
          text: "e-Invoice is failing for one bill.",
        },
      }),
    ]),

    folder("41. Super Admin", "Platform admin only. Use super-admin login token.", [
      item({
        name: "Platform stats",
        method: "GET",
        urlPath: "super-admin/stats",
      }),
      item({
        name: "List tenants",
        method: "GET",
        urlPath: "super-admin/tenants",
        query: { search: "", tier: "", status: "", page: "1", limit: "20" },
      }),
      item({
        name: "Create tenant",
        method: "POST",
        urlPath: "super-admin/tenants",
        body: {
          organizationName: "New Tenant",
          legalName: "New Tenant Pvt Ltd",
          primaryPhone: "9898990099",
          primaryEmail: "admin@newtenant.test",
          password: "TempPass@123",
        },
      }),
      item({ name: "Get tenant", method: "GET", urlPath: "super-admin/tenants/clytenant00000000000001" }),
      item({
        name: "Update tenant",
        method: "PATCH",
        urlPath: "super-admin/tenants/clytenant00000000000001",
        body: { isActive: true, subscriptionTier: "PREMIUM", extendDays: 30 },
      }),
      item({ name: "Delete tenant", method: "DELETE", urlPath: "super-admin/tenants/clytenant00000000000001" }),
      item({
        name: "Bulk delete tenants",
        method: "POST",
        urlPath: "super-admin/tenants/bulk-delete",
        body: { tenantIds: ["clytenant00000000000001"] },
      }),
      item({
        name: "Bulk activate / deactivate tenants",
        method: "POST",
        urlPath: "super-admin/tenants/bulk-status",
        body: { tenantIds: ["clytenant00000000000001"], isActive: false },
      }),
      item({
        name: "List all users",
        method: "GET",
        urlPath: "super-admin/users",
        query: { search: "", role: "", status: "", page: "1", limit: "20" },
      }),
      item({
        name: "Update user (role / password / active)",
        method: "PATCH",
        urlPath: "super-admin/users/clyuser00000000000000001",
        body: { role: "COMPANY_ADMIN", isActive: true },
      }),
      item({
        name: "Audit logs",
        method: "GET",
        urlPath: "super-admin/audit-logs",
        query: { limit: "50", action: "" },
      }),
      item({
        name: "All invoices (cross-tenant)",
        method: "GET",
        urlPath: "super-admin/invoices",
        query: { search: "", status: "", page: "1", limit: "20" },
      }),
      item({ name: "Diagnostics", method: "GET", urlPath: "super-admin/diagnostics" }),
      item({
        name: "Impersonate company (support login)",
        method: "POST",
        urlPath: "super-admin/impersonate",
        body: { companyId: "{{companyId}}", reason: "Support ticket" },
      }),
      item({
        name: "Exit impersonation",
        method: "POST",
        urlPath: "super-admin/impersonate/exit",
        body: { companyId: "{{companyId}}" },
      }),
    ]),
  ],
};

function countRequests(items) {
  let n = 0;
  for (const it of items) {
    if (it.item) n += countRequests(it.item);
    else n += 1;
  }
  return n;
}

const outPath = path.join(__dirname, "MyOwnBillBook_Screen_Wise_API_Collection.json");
fs.writeFileSync(outPath, JSON.stringify(collection, null, 2));
console.log(`Wrote ${outPath}`);
console.log(`Folders: ${collection.item.length}`);
console.log(`Requests: ${countRequests(collection.item)}`);
