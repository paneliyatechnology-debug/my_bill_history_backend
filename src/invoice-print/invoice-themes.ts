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

export type InvoiceLayout =
  | "tally"
  | "gst"
  | "tallybook"
  | "lite"
  | "compact"
  | "luxury"
  | "stylish"
  | "modern"
  | "simple"
  | "billbook"
  | "festival";

export const INVOICE_THEMES: Array<{
  id: string;
  name: string;
  group: "festival" | "standard";
  paper: string;
  layout: InvoiceLayout;
  description?: string;
}> = [
  { id: "your_logo", name: "Your logo", group: "festival", paper: "A4", layout: "festival", description: "Logo-first invoice with a clean brand frame." },
  { id: "navratri", name: "Navratri", group: "festival", paper: "A4", layout: "festival", description: "Nine-colour garba band and festive frame." },
  { id: "durga_puja", name: "Durga Puja", group: "festival", paper: "A4", layout: "festival", description: "Red and gold Durga Puja border." },
  { id: "dussehra", name: "Dussehra", group: "festival", paper: "A4", layout: "festival", description: "Vijayadashami saffron victory frame." },
  { id: "dhanteras", name: "Dhanteras", group: "festival", paper: "A4", layout: "festival", description: "Gold coin border for Dhanteras." },
  { id: "diwali", name: "Diwali", group: "festival", paper: "A4", layout: "festival", description: "Diya row and deep festive frame." },
  { id: "uttarayan", name: "Uttarayan", group: "festival", paper: "A4", layout: "festival", description: "Kite sky frame for Uttarayan." },
  { id: "independence", name: "Independence", group: "festival", paper: "A4", layout: "festival", description: "Tricolour band invoice." },
  { id: "ganesh_chaturthi", name: "Ganesh Chaturthi", group: "festival", paper: "A4", layout: "festival", description: "Saffron Ganesh Chaturthi frame." },
  {
    id: "advanced_gst_tally",
    name: "Advanced GST (Tally)",
    group: "standard",
    paper: "A4",
    layout: "tally",
    description: "Full-height ruled GST invoice with rate lines and HSN summary, like Tally.",
  },
  {
    id: "luxury",
    name: "Luxury",
    group: "standard",
    paper: "A4",
    layout: "luxury",
    description: "Ornate double border, premium header, tax column.",
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
    layout: "gst",
    description: "Colour banner GST invoice with tax column and HSN table.",
  },
  {
    id: "tallybook",
    name: "TallyBook",
    group: "standard",
    paper: "A4",
    layout: "tallybook",
    description: "Classic black Tally boxes, no filled header.",
  },
  {
    id: "advanced_compact",
    name: "Advanced compact",
    group: "standard",
    paper: "A5",
    layout: "compact",
    description: "Tight A5 GST layout.",
  },
  {
    id: "tallybook_lite",
    name: "TallyBook Lite",
    group: "standard",
    paper: "A4",
    layout: "lite",
    description: "Light outer frame, open rows, GST totals.",
  },
  {
    id: "modern",
    name: "Modern",
    group: "standard",
    paper: "A4",
    layout: "modern",
    description: "Accent rail, pill meta bar, open item table.",
  },
  {
    id: "simple",
    name: "Simple",
    group: "standard",
    paper: "A4",
    layout: "simple",
    description: "Hairline rules only. No colour blocks.",
  },
  {
    id: "billbook",
    name: "Billbook",
    group: "standard",
    paper: "A4",
    layout: "billbook",
    description: "Large trade name with a solid colour footer.",
  },
];

export const FESTIVE_SKINS: Record<
  string,
  { title: string; border: string; ink: string; wash: string; band: string[]; motif: string }
> = {
  your_logo: { title: "YOUR LOGO", border: "#111111", ink: "#111111", wash: "#ffffff", band: ["#111111", "#5346F5"], motif: "logo" },
  navratri: { title: "SHUBH NAVRATRI", border: "#9A3412", ink: "#9A3412", wash: "#FFF7ED", band: ["#E11D48", "#F97316", "#EAB308", "#22C55E", "#0EA5E9", "#6366F1", "#A855F7", "#EC4899", "#F43F5E"], motif: "dots" },
  durga_puja: { title: "SHUBHO DURGA PUJA", border: "#9F1239", ink: "#9F1239", wash: "#FFF1F2", band: ["#BE123C", "#FBBF24", "#BE123C"], motif: "arch" },
  dussehra: { title: "VIJAYADASHAMI", border: "#C2410C", ink: "#9A3412", wash: "#FFF7ED", band: ["#EA580C", "#FACC15", "#EA580C"], motif: "bow" },
  dhanteras: { title: "SHUBH DHANTERAS", border: "#A16207", ink: "#854D0E", wash: "#FEFCE8", band: ["#CA8A04", "#FDE68A", "#CA8A04"], motif: "coins" },
  diwali: { title: "HAPPY DIWALI", border: "#6B21A8", ink: "#6B21A8", wash: "#FAF5FF", band: ["#7E22CE", "#F59E0B", "#7E22CE"], motif: "diya" },
  uttarayan: { title: "UTTARAYAN", border: "#0369A1", ink: "#0C4A6E", wash: "#F0F9FF", band: ["#0284C7", "#F97316", "#EAB308", "#22C55E"], motif: "kites" },
  independence: { title: "INDEPENDENCE DAY", border: "#166534", ink: "#14532D", wash: "#F8FAFC", band: ["#FF9933", "#FFFFFF", "#138808"], motif: "flag" },
  ganesh_chaturthi: { title: "GANESH CHATURTHI", border: "#B45309", ink: "#92400E", wash: "#FFFBEB", band: ["#F59E0B", "#DC2626", "#F59E0B"], motif: "modak" },
};

export function themeLayout(themeId: string): InvoiceLayout {
  const theme = INVOICE_THEMES.find((t) => t.id === themeId);
  return theme?.layout || "tally";
}

export function festiveSkin(themeId: string) {
  return FESTIVE_SKINS[themeId] || FESTIVE_SKINS.navratri;
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
    { key: "showTimeOnInvoice", label: "Show time on Invoices", value: flag(s, "showTimeOnInvoice") },
    { key: "printHistory", label: "Price History", value: flag(s, "printHistory") },
    { key: "showEmojis", label: "Show Emojis on Invoices", value: flag(s, "showEmojis") },
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
          { key: "showPricePerItem", label: "Price/Item (₹)", value: flag(s, "showPricePerItem", true) },
          { key: "showQuantity", label: "Quantity", value: flag(s, "showQuantity", true) },
          { key: "showHsn", label: "HSN", value: flag(s, "showHsn", true) },
          { key: "showItemDescription", label: "Item description", value: flag(s, "showItemDescription", true) },
          { key: "enableFreeItemQuantity", label: "Free quantity", value: flag(s, "enableFreeItemQuantity") },
          { key: "showAlternateUnit", label: "Alternate Unit", value: flag(s, "showAlternateUnit", true) },
          { key: "showDiscount", label: "Discount", value: flag(s, "showDiscount", true) },
          { key: "showTaxColumn", label: "Tax", value: flag(s, "showTaxColumn", true) },
          { key: "showBatch", label: "Batch No.", value: flag(s, "showBatch") },
          { key: "showExpiry", label: "Exp. Date", value: flag(s, "showExpiry") },
          { key: "showMfgDate", label: "Mfg Date", value: flag(s, "showMfgDate") },
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
