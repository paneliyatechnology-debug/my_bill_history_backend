export const INVOICE_PAPER_SIZES = ["A4", "A5", "THERMAL_80", "THERMAL_58"] as const;

export const INVOICE_COPY_LABELS: Record<string, string> = {
  ORIGINAL_FOR_RECIPIENT: "ORIGINAL FOR RECIPIENT",
  DUPLICATE_FOR_TRANSPORTER: "DUPLICATE FOR TRANSPORTER",
  TRIPLICATE_FOR_SUPPLIER: "TRIPLICATE FOR SUPPLIER",
};

export const DEFAULT_DOCUMENT_TITLES: Record<string, string> = {
  TAX_INVOICE: "TAX INVOICE",
  BILL_OF_SUPPLY: "BILL OF SUPPLY",
  EXPORT_INVOICE: "EXPORT INVOICE",
  PROFORMA_INVOICE: "QUOTATION",
  DELIVERY_CHALLAN: "DELIVERY CHALLAN",
  CREDIT_NOTE: "CREDIT NOTE",
};

export const THEME_COLORS = [
  { id: "black", hex: "#111111" },
  { id: "green", hex: "#2E7D32" },
  { id: "teal", hex: "#00897B" },
  { id: "blue", hex: "#1565C0" },
  { id: "purple", hex: "#6A1B9A" },
  { id: "red", hex: "#C62828" },
  { id: "violet", hex: "#8E24AA" },
  { id: "gold", hex: "#C9A227" },
  { id: "orange", hex: "#EF6C00" },
];

export const INVOICE_THEMES = [
  { id: "navratri", name: "Navratri", group: "festival", paper: "A4", layout: "luxury" },
  { id: "durga_puja", name: "Durga Puja", group: "festival", paper: "A4", layout: "luxury" },
  { id: "dussehra", name: "Dussehra", group: "festival", paper: "A4", layout: "luxury" },
  { id: "dhanteras", name: "Dhanteras", group: "festival", paper: "A4", layout: "luxury" },
  { id: "diwali", name: "Diwali", group: "festival", paper: "A4", layout: "luxury" },
  { id: "uttarayan", name: "Uttarayan", group: "festival", paper: "A4", layout: "luxury" },
  { id: "independence", name: "Independence", group: "festival", paper: "A4", layout: "luxury" },
  { id: "ganesh_chaturthi", name: "Ganesh Chaturthi", group: "festival", paper: "A4", layout: "luxury" },
  {
    id: "advanced_gst_tally",
    name: "Advanced GST (Tally)",
    group: "standard",
    paper: "A4",
    layout: "tally",
    description: "Boxed GST invoice with HSN summary, like Tally.",
  },
  {
    id: "luxury",
    name: "Luxury",
    group: "standard",
    paper: "A4",
    layout: "luxury",
    description: "Ornate border, premium header, tax column.",
  },
  {
    id: "stylish",
    name: "Stylish",
    group: "standard",
    paper: "A4",
    layout: "stylish",
    description: "Clean modern bill without heavy boxes.",
  },
  {
    id: "advanced_gst",
    name: "Advanced GST",
    group: "standard",
    paper: "A4",
    layout: "tally",
    description: "GST-ready with HSN, taxable value and tax breakup.",
  },
  {
    id: "tallybook",
    name: "TallyBook",
    group: "standard",
    paper: "A4",
    layout: "tally",
  },
  {
    id: "advanced_compact",
    name: "Advanced compact",
    group: "standard",
    paper: "A5",
    layout: "tally",
  },
  {
    id: "tallybook_lite",
    name: "TallyBook Lite",
    group: "standard",
    paper: "A4",
    layout: "tally",
  },
  {
    id: "modern",
    name: "Modern",
    group: "standard",
    paper: "A4",
    layout: "stylish",
  },
  {
    id: "simple",
    name: "Simple",
    group: "standard",
    paper: "A4",
    layout: "stylish",
  },
  {
    id: "billbook",
    name: "Billbook",
    group: "standard",
    paper: "A4",
    layout: "stylish",
  },
];

export function themeLayout(themeId: string): "tally" | "luxury" | "stylish" {
  const theme = INVOICE_THEMES.find((t) => t.id === themeId);
  return (theme?.layout as any) || "tally";
}

type Field = { key: string; label: string; value: boolean };

function flag(s: any, key: string, fallback = false): boolean {
  return s?.[key] === undefined ? fallback : Boolean(s[key]);
}

export function buildInvoiceSettingsScreen(s: any) {
  const themeSettings: Field[] = [
    { key: "showPartyBalance", label: "Show party balance in Invoice", value: flag(s, "showPartyBalance") },
    { key: "enableFreeItemQuantity", label: "Enable free item quantity", value: flag(s, "enableFreeItemQuantity") },
    { key: "showItemDescription", label: "Show item description in Invoice", value: flag(s, "showItemDescription", true) },
    { key: "showAlternateUnit", label: "Show Alternate Unit in Invoice", value: flag(s, "showAlternateUnit", true) },
    { key: "showPhoneNumber", label: "Show phone number on Invoice", value: flag(s, "showPhoneNumber", true) },
    { key: "showEmojis", label: "Show Emojis on Invoices", value: flag(s, "showEmojis") },
    { key: "printHistory", label: "Print History", value: flag(s, "printHistory") },
    {
      key: "autoApplyLuxuryForSharing",
      label: "Auto apply luxury theme for sharing",
      value: flag(s, "autoApplyLuxuryForSharing"),
    },
  ];

  return {
    saveLabel: "Save Changes",
    themeStore: {
      title: "ThemeStore",
      items: INVOICE_THEMES.filter((t) => t.group === "festival"),
    },
    themes: {
      title: "Themes",
      seeAllLabel: "See All",
      createCustomTheme: {
        enabled: true,
        label: "Create Custom Theme",
        cta: "Create your own theme",
      },
      items: INVOICE_THEMES.filter((t) => t.group === "standard"),
    },
    colors: THEME_COLORS,
    themeSettings: {
      title: "Theme Settings",
      badge: "New",
      items: themeSettings,
    },
    sections: [
      {
        id: "invoiceDetails",
        title: "Invoice Details",
        fields: [
          { key: "showDueDate", label: "Due Date", value: flag(s, "showDueDate", true) },
          { key: "showPoNumber", label: "PO Number", value: flag(s, "showPoNumber") },
          { key: "showEwayBillNumber", label: "E-Way Bill Number", value: flag(s, "showEwayBillNumber") },
          { key: "showVehicleNumber", label: "Vehicle Number", value: flag(s, "showVehicleNumber") },
        ],
        customFields: s?.invoiceCustomFields || [],
      },
      {
        id: "partyDetails",
        title: "Party Details",
        fields: [
          { key: "showShippingAddress", label: "Ship To", value: flag(s, "showShippingAddress", true) },
          { key: "showPhoneNumber", label: "Mobile", value: flag(s, "showPhoneNumber", true) },
          { key: "showGstin", label: "GSTIN", value: flag(s, "showGstin", true) },
          { key: "showPlaceOfSupply", label: "Place of Supply", value: flag(s, "showPlaceOfSupply", true) },
          { key: "showPartyBalance", label: "Party Balance", value: flag(s, "showPartyBalance") },
        ],
        customFields: s?.partyCustomFields || [],
      },
      {
        id: "itemTableColumns",
        title: "Item Table Columns",
        fields: [
          { key: "showHsn", label: "HSN", value: flag(s, "showHsn", true) },
          { key: "showItemDescription", label: "Item description", value: flag(s, "showItemDescription", true) },
          { key: "enableFreeItemQuantity", label: "Free quantity", value: flag(s, "enableFreeItemQuantity") },
          { key: "showAlternateUnit", label: "Alternate Unit", value: flag(s, "showAlternateUnit", true) },
          { key: "showDiscount", label: "Discount", value: flag(s, "showDiscount", true) },
          { key: "showTaxColumn", label: "Tax", value: flag(s, "showTaxColumn", true) },
          { key: "showBatch", label: "Batch", value: flag(s, "showBatch") },
          { key: "showExpiry", label: "Expiry", value: flag(s, "showExpiry") },
          { key: "showSku", label: "SKU", value: flag(s, "showSku") },
        ],
      },
      {
        id: "miscellaneousDetails",
        title: "Miscellaneous Details",
        badge: "New",
        fields: [
          { key: "showNotes", label: "Notes", value: flag(s, "showNotes", true) },
          { key: "showTerms", label: "Terms and Conditions", value: flag(s, "showTerms", true) },
          { key: "showAmountInWords", label: "Amount in words", value: flag(s, "showAmountInWords", true) },
          { key: "showReceivedAmount", label: "Received Amount", value: flag(s, "showReceivedAmount", true) },
          { key: "showBankDetails", label: "Bank Details", value: flag(s, "showBankDetails", true) },
          { key: "showUpiQr", label: "UPI / QR", value: flag(s, "showUpiQr", true) },
          { key: "showSignature", label: "Signature", value: flag(s, "showSignature", true) },
          { key: "showPan", label: "PAN", value: flag(s, "showPan", true) },
          { key: "showEmail", label: "Email", value: flag(s, "showEmail", true) },
        ],
      },
    ],
  };
}
