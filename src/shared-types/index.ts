/**
 * Tenancy and Request Context
 */
export interface TenantContext {
  organizationId: string;
  companyId: string;
  branchId?: string;
  financialYearId?: string;
  userId?: string;
  isSystemBypass?: boolean;
}

/**
 * User Roles
 */
export enum UserRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  ORG_ADMIN = "ORG_ADMIN",
  COMPANY_ADMIN = "COMPANY_ADMIN",
  ACCOUNTANT = "ACCOUNTANT",
  BRANCH_MANAGER = "BRANCH_MANAGER",
  CASHIER = "CASHIER",
  SALESMAN = "SALESMAN",
  AUDITOR = "AUDITOR",
}

/**
 * Subscription Tiers
 */
export enum SubscriptionTier {
  TRIAL = "TRIAL",
  RETAIL_BASIC = "RETAIL_BASIC",
  WHOLESALE_PRO = "WHOLESALE_PRO",
  DISTRIBUTION_ENTERPRISE = "DISTRIBUTION_ENTERPRISE",
  MANUFACTURING_SUITE = "MANUFACTURING_SUITE",
}

/**
 * Plan Entitlements & Subscription Policies
 */
export interface PlanEntitlements {
  tier: SubscriptionTier;
  name: string;
  nameGujarati: string;
  maxCompanies: number;
  maxBranchesPerCompany: number;
  maxUsers: number;
  features: {
    multiCompany: boolean;
    multiBranch: boolean;
    posCounter: boolean;
    manufacturing: boolean;
    distribution: boolean;
    gstrReconciliation: boolean;
    eInvoiceEWay: boolean;
  };
}

export const PLAN_ENTITLEMENTS: Record<SubscriptionTier, PlanEntitlements> = {
  [SubscriptionTier.TRIAL]: {
    tier: SubscriptionTier.TRIAL,
    name: "Trial Plan",
    nameGujarati: "ટ્રાયલ પ્લાન (મફત)",
    maxCompanies: 1,
    maxBranchesPerCompany: 1,
    maxUsers: 2,
    features: {
      multiCompany: false,
      multiBranch: false,
      posCounter: true,
      manufacturing: false,
      distribution: false,
      gstrReconciliation: true,
      eInvoiceEWay: false,
    },
  },
  [SubscriptionTier.RETAIL_BASIC]: {
    tier: SubscriptionTier.RETAIL_BASIC,
    name: "Retail Basic",
    nameGujarati: "રિટેલ બેસિક",
    maxCompanies: 1,
    maxBranchesPerCompany: 2,
    maxUsers: 3,
    features: {
      multiCompany: false,
      multiBranch: true,
      posCounter: true,
      manufacturing: false,
      distribution: false,
      gstrReconciliation: true,
      eInvoiceEWay: true,
    },
  },
  [SubscriptionTier.WHOLESALE_PRO]: {
    tier: SubscriptionTier.WHOLESALE_PRO,
    name: "Wholesale Pro",
    nameGujarati: "હોલસેલ પ્રો",
    maxCompanies: 2,
    maxBranchesPerCompany: 5,
    maxUsers: 10,
    features: {
      multiCompany: true,
      multiBranch: true,
      posCounter: true,
      manufacturing: false,
      distribution: true,
      gstrReconciliation: true,
      eInvoiceEWay: true,
    },
  },
  [SubscriptionTier.DISTRIBUTION_ENTERPRISE]: {
    tier: SubscriptionTier.DISTRIBUTION_ENTERPRISE,
    name: "Distribution Enterprise",
    nameGujarati: "ડિસ્ટ્રિબ્યુશન એન્ટરપ્રાઇઝ",
    maxCompanies: 5,
    maxBranchesPerCompany: 15,
    maxUsers: 25,
    features: {
      multiCompany: true,
      multiBranch: true,
      posCounter: true,
      manufacturing: true,
      distribution: true,
      gstrReconciliation: true,
      eInvoiceEWay: true,
    },
  },
  [SubscriptionTier.MANUFACTURING_SUITE]: {
    tier: SubscriptionTier.MANUFACTURING_SUITE,
    name: "Manufacturing Suite",
    nameGujarati: "મેન્યુફેક્ચરિંગ સ્યુટ",
    maxCompanies: 10,
    maxBranchesPerCompany: 30,
    maxUsers: 50,
    features: {
      multiCompany: true,
      multiBranch: true,
      posCounter: true,
      manufacturing: true,
      distribution: true,
      gstrReconciliation: true,
      eInvoiceEWay: true,
    },
  },
};

export function getPlanEntitlements(tier?: SubscriptionTier | string): PlanEntitlements {
  if (tier && tier in PLAN_ENTITLEMENTS) {
    return PLAN_ENTITLEMENTS[tier as SubscriptionTier];
  }
  return PLAN_ENTITLEMENTS[SubscriptionTier.TRIAL];
}

export function canCreateCompany(tier: SubscriptionTier | string | undefined, currentCompanyCount: number): boolean {
  const plan = getPlanEntitlements(tier);
  return currentCompanyCount < plan.maxCompanies;
}

/**
 * GST Registration Types
 */
export enum GstRegistrationType {
  REGULAR = "REGULAR",
  COMPOSITION = "COMPOSITION",
  UNREGISTERED = "UNREGISTERED",
  CONSUMER = "CONSUMER",
  OVERSEAS = "OVERSEAS",
  SPECIAL_ECONOMIC_ZONE = "SPECIAL_ECONOMIC_ZONE",
}

/**
 * Party Types
 */
export enum PartyType {
  CUSTOMER = "CUSTOMER",
  SUPPLIER = "SUPPLIER",
  BOTH = "BOTH",
  BROKER = "BROKER",
  JOB_WORKER = "JOB_WORKER",
}

/**
 * Item Types
 */
export enum ItemType {
  PRODUCT = "PRODUCT",
  SERVICE = "SERVICE",
}

/**
 * HSN Code Types (Goods vs Services)
 */
export enum HsnType {
  HSN = "HSN",
  SAC = "SAC",
}

/**
 * Inventory Costing Valuation Methods
 */
export enum ValuationMethod {
  FIFO = "FIFO",
  WEIGHTED_AVERAGE = "WEIGHTED_AVERAGE",
}

/**
 * Account Nature (Five fundamental heads of accounting)
 */
export enum AccountNature {
  ASSET = "ASSET",
  LIABILITY = "LIABILITY",
  EQUITY = "EQUITY",
  INCOME = "INCOME",
  EXPENSE = "EXPENSE",
}

/**
 * Standard Voucher Types
 */
export enum VoucherType {
  SALES = "SALES",
  PURCHASE = "PURCHASE",
  PAYMENT = "PAYMENT",
  RECEIPT = "RECEIPT",
  CONTRA = "CONTRA",
  JOURNAL = "JOURNAL",
  CREDIT_NOTE = "CREDIT_NOTE",
  DEBIT_NOTE = "DEBIT_NOTE",
}

/**
 * Account Opening & Balance Type
 */
export type AccountOpeningType = "DR" | "CR";

/**
 * Invoice Categories
 */
export enum InvoiceCategory {
  TAX_INVOICE = "TAX_INVOICE",
  BILL_OF_SUPPLY = "BILL_OF_SUPPLY",
  EXPORT_INVOICE = "EXPORT_INVOICE",
  PROFORMA_INVOICE = "PROFORMA_INVOICE",
  DELIVERY_CHALLAN = "DELIVERY_CHALLAN",
}

/**
 * Invoice Status
 */
export enum InvoiceStatus {
  DRAFT = "DRAFT",
  ISSUED = "ISSUED",
  PAID = "PAID",
  PARTIALLY_PAID = "PARTIALLY_PAID",
  OVERDUE = "OVERDUE",
  CANCELLED = "CANCELLED",
}

/**
 * Payment Modes
 */
export enum PaymentMode {
  CASH = "CASH",
  UPI_QR = "UPI_QR",
  BANK_TRANSFER = "BANK_TRANSFER",
  CHEQUE = "CHEQUE",
  CREDIT_NOTE = "CREDIT_NOTE",
  SPLIT = "SPLIT",
  UNPAID_CREDIT = "UNPAID_CREDIT",
}

/**
 * Stock Transaction Types
 */
export enum StockTransactionType {
  OPENING = "OPENING",
  PURCHASE_RECEIPT = "PURCHASE_RECEIPT",
  PURCHASE_RETURN = "PURCHASE_RETURN",
  SALES_DISPATCH = "SALES_DISPATCH",
  SALES_RETURN = "SALES_RETURN",
  SALES_CANCELLATION = "SALES_CANCELLATION",
  STOCK_TRANSFER_IN = "STOCK_TRANSFER_IN",
  STOCK_TRANSFER_OUT = "STOCK_TRANSFER_OUT",
  MANUFACTURING_CONSUMPTION = "MANUFACTURING_CONSUMPTION",
  MANUFACTURING_YIELD = "MANUFACTURING_YIELD",
  STOCK_ADJUSTMENT_PLUS = "STOCK_ADJUSTMENT_PLUS",
  STOCK_ADJUSTMENT_MINUS = "STOCK_ADJUSTMENT_MINUS",
}

/**
 * RFC 7807 Problem Details
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  detailGujarati?: string;
  instance?: string;
  invalidParams?: Array<{
    name: string;
    reason: string;
  }>;
  timestamp: string;
}

/**
 * Standard Paginated Response
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Scan Status
 */
export enum ScanStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  READY_FOR_REVIEW = "READY_FOR_REVIEW",
  CONFIRMED = "CONFIRMED",
  FAILED = "FAILED",
  DISCARDED = "DISCARDED",
}

export interface ExtractedBillItem {
  id?: string;
  description: string;
  rawText?: string;
  hsnCode?: string | null;
  quantity: number | string;
  unit?: string | null;
  unitPrice: number | string;
  discountAmount?: number | string;
  taxableAmount: number | string;
  taxRate: number | string;
  cgstAmount?: number | string;
  sgstAmount?: number | string;
  igstAmount?: number | string;
  cessAmount?: number | string;
  totalAmount: number | string;
  confidence: number;
  itemType?: "PRODUCT" | "SERVICE";
  isAmbiguous?: boolean;
  matchedItemId?: string | null;
  matchedItemName?: string | null;
  matchedItemScore?: number;
  matchType?: "BARCODE" | "SKU" | "EXACT_NAME" | "FUZZY_NAME" | "NEW_PRODUCT";
  suggestedItems?: Array<{
    id: string;
    name: string;
    sku?: string | null;
    score: number;
  }>;
}

export interface ExtractedBillData {
  currency?: string;
  exchangeRate?: number | null;
  sourceGrandTotal?: string | null;
  isRcm?: boolean;
  buyerGstin?: string | null;
  supplier: {
    name: string | null;
    gstin: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    confidence: number;
    matchedPartyId?: string | null;
    matchedPartyName?: string | null;
    matchedPartyGstin?: string | null;
    matchedPartyScore?: number;
    isNewSupplier?: boolean;
  };
  invoice: {
    invoiceNumber: string | null;
    invoiceDate: string | null;
    dueDate: string | null;
    placeOfSupply: string | null;
    paymentTerms?: string | null;
    confidence: number;
    isDuplicateWarning?: boolean;
  };
  financials: {
    subtotal: string | null;
    totalDiscount: string | null;
    taxableAmount: string | null;
    cgstAmount: string | null;
    sgstAmount: string | null;
    igstAmount: string | null;
    cessAmount: string | null;
    otherCharges: string | null;
    roundOff: string | null;
    grandTotal: string | null;
    isTaxMismatch?: boolean;
    taxMismatchReason?: string | null;
    confidence: number;
  };
  items: ExtractedBillItem[];
  documentMetadata: {
    fileName: string;
    pageCount: number;
    isMultiPage: boolean;
    overallConfidence: number;
    warnings: string[];
    engine?: string;
    isUnreadable?: boolean;
  };
}

export interface PurchaseBillScanRecord {
  id: string;
  organizationId: string;
  companyId: string;
  branchId?: string | null;
  fileName: string;
  fileMimeType: string;
  fileSizeBytes: number;
  fileStoragePath: string;
  fileSha256: string;
  status: ScanStatus;
  ocrProvider: string;
  extractedData?: ExtractedBillData | null;
  rawOcrText?: string | null;
  matchedPartyId?: string | null;
  matchedPartyScore?: number | null;
  purchaseInvoiceId?: string | null;
  errorMessage?: string | null;
  idempotencyKey?: string | null;
  createdAt: string;
  updatedAt: string;
  matchedParty?: {
    id: string;
    name: string;
    gstin?: string | null;
    phone?: string | null;
  } | null;
  purchaseInvoice?: {
    id: string;
    vendorInvoiceNumber: string;
    grandTotal: number | string;
    createdAt: string;
  } | null;
}

/**
 * Statutory Indian GST State Codes and Names
 */
export const INDIAN_STATES: Record<
  string,
  { name: string; nameGujarati: string }
> = {
  "01": { name: "Jammu & Kashmir", nameGujarati: "જમ્મુ અને કાશ્મીર" },
  "02": { name: "Himachal Pradesh", nameGujarati: "હિમાચલ પ્રદેશ" },
  "03": { name: "Punjab", nameGujarati: "પંજાબ" },
  "04": { name: "Chandigarh", nameGujarati: "ચંદીગઢ" },
  "05": { name: "Uttarakhand", nameGujarati: "ઉત્તરાખંડ" },
  "06": { name: "Haryana", nameGujarati: "હરિયાણા" },
  "07": { name: "Delhi", nameGujarati: "દિલ્હી" },
  "08": { name: "Rajasthan", nameGujarati: "રાજસ્થાન" },
  "09": { name: "Uttar Pradesh", nameGujarati: "ઉત્તર પ્રદેશ" },
  "10": { name: "Bihar", nameGujarati: "બિહાર" },
  "11": { name: "Sikkim", nameGujarati: "સિક્કિમ" },
  "12": { name: "Arunachal Pradesh", nameGujarati: "અરુણાચલ પ્રદેશ" },
  "13": { name: "Nagaland", nameGujarati: "નાગાલેન્ડ" },
  "14": { name: "Manipur", nameGujarati: "મણિપુર" },
  "15": { name: "Mizoram", nameGujarati: "મિઝોરમ" },
  "16": { name: "Tripura", nameGujarati: "ત્રિપુરા" },
  "17": { name: "Meghalaya", nameGujarati: "મેઘાલય" },
  "18": { name: "Assam", nameGujarati: "આસામ" },
  "19": { name: "West Bengal", nameGujarati: "પશ્ચિમ બંગાળ" },
  "20": { name: "Jharkhand", nameGujarati: "ઝારખંડ" },
  "21": { name: "Odisha", nameGujarati: "ઓડિશા" },
  "22": { name: "Chhattisgarh", nameGujarati: "છત્તીસગઢ" },
  "23": { name: "Madhya Pradesh", nameGujarati: "મધ્ય પ્રદેશ" },
  "24": { name: "Gujarat", nameGujarati: "ગુજરાત" },
  "25": {
    name: "Daman and Diu and Dadra and Nagar Haveli",
    nameGujarati: "દમણ, દીવ અને દાદરા નગર હવેલી",
  },
  "26": { name: "Dadra and Nagar Haveli", nameGujarati: "દાદરા અને નગર હવેલી" },
  "27": { name: "Maharashtra", nameGujarati: "મહારાષ્ટ્ર" },
  "28": { name: "Andhra Pradesh (Old)", nameGujarati: "આંધ્ર પ્રદેશ" },
  "29": { name: "Karnataka", nameGujarati: "કર્ણાટક" },
  "30": { name: "Goa", nameGujarati: "ગોવા" },
  "31": { name: "Lakshadweep", nameGujarati: "લક્ષદ્વીપ" },
  "32": { name: "Kerala", nameGujarati: "કેરળ" },
  "33": { name: "Tamil Nadu", nameGujarati: "તમિલનાડુ" },
  "34": { name: "Puducherry", nameGujarati: "પુડુચેરી" },
  "35": {
    name: "Andaman and Nicobar Islands",
    nameGujarati: "અંદામાન અને નિકોબાર દ્વીપસમૂહ",
  },
  "36": { name: "Telangana", nameGujarati: "તેલંગાણા" },
  "37": { name: "Andhra Pradesh (New)", nameGujarati: "આંધ્ર પ્રદેશ" },
  "38": { name: "Ladakh", nameGujarati: "લદ્દાખ" },
  "96": { name: "Other Countries", nameGujarati: "અન્ય દેશો" },
  "97": { name: "Other Territory", nameGujarati: "અન્ય કેન્દ્રશાસિત પ્રદેશ" },
  "99": { name: "Centre Jurisdiction", nameGujarati: "કેન્દ્ર ન્યાયક્ષેત્ર" },
};

/**
 * Financial Summary KPI Card Data for Dashboard
 */
export interface FinancialSummaryDto {
  toCollect: string;
  toPay: string;
  cashBalance: string;
  bankBalance: string;
  totalCashBankBalance: string;
  currency: string;
  asOf: string;
}

/**
 * =========================================================
 * DATA IMPORT SYSTEM TYPES & CONTRACTS
 * =========================================================
 */

export enum ImportModuleType {
  PARTIES = "parties",
  CUSTOMERS = "customers",
  SUPPLIERS = "suppliers",
  ITEMS = "items",
  SERVICES = "services",
  ITEM_CATEGORIES = "item_categories",
  CATEGORIES = "item_categories",
  UNITS_OF_MEASURE = "units_of_measure",
  UNITS = "units_of_measure",
  WAREHOUSES = "warehouses",
  ITEM_BATCHES = "item_batches",
  HSN_MASTERS = "hsn_masters",
  OPENING_STOCK = "opening_stock",
  SALES_INVOICES = "sales_invoices",
  PURCHASE_INVOICES = "purchase_invoices",
  DELIVERY_CHALLANS = "delivery_challans",
  SALES_RETURNS = "sales_returns",
  PURCHASE_RETURNS = "purchase_returns",
  LEDGER_GROUPS = "ledger_groups",
  LEDGER_ACCOUNTS = "ledger_accounts",
  JOURNAL_VOUCHERS = "journal_vouchers",
  BILL_OF_MATERIALS = "bill_of_materials",
}

export enum ImportMode {
  CREATE_ONLY = "CREATE_ONLY",
  SKIP_DUPLICATES = "SKIP_DUPLICATES",
  UPDATE_EXISTING = "UPDATE_EXISTING",
}

export enum ImportErrorPolicy {
  IMPORT_VALID_ONLY = "IMPORT_VALID_ONLY",
  ABORT_ON_ERROR = "ABORT_ON_ERROR",
}

export enum ImportStatus {
  PENDING = "PENDING",
  PARSING = "PARSING",
  VALIDATING = "VALIDATING",
  CONFIRMED = "CONFIRMED",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

export interface ImportFieldDefinition {
  key: string;
  label: string;
  labelGujarati: string;
  required: boolean;
  type: "string" | "number" | "date" | "boolean" | "enum";
  enumValues?: string[];
  synonyms: string[];
  description: string;
  descriptionGujarati: string;
  sampleValue: any;
  isIdentifier?: boolean;
}

export interface ImportModuleSchema {
  module: ImportModuleType;
  title: string;
  titleGujarati: string;
  category: "MASTERS" | "INVENTORY" | "SALES" | "PURCHASES" | "ACCOUNTING" | "MANUFACTURING";
  description: string;
  descriptionGujarati: string;
  routeHref: string;
  identifierField: string;
  supportsModes: ImportMode[];
  fields: ImportFieldDefinition[];
  notes?: string;
  notesGujarati?: string;
}

export interface ImportErrorRow {
  rowNumber: number;
  column?: string;
  field?: string;
  providedValue?: any;
  errorCode: string;
  errorMessage: string;
  errorMessageGujarati?: string;
  isBlocking: boolean;
  actionTaken?: "FAILED" | "SKIPPED" | "WARNING";
}

export interface ImportRowPreview {
  rowNumber: number;
  data: Record<string, any>;
  status: "VALID" | "WARNING" | "INVALID" | "DUPLICATE";
  action: "CREATE" | "UPDATE" | "SKIP" | "FAIL";
  messages: string[];
  matchedExistingId?: string;
  matchedExistingName?: string;
}

export interface ImportParseResult {
  jobId: string;
  fileName: string;
  fileFormat: string;
  fileSize: number;
  worksheets: string[];
  selectedWorksheet: string;
  headers: string[];
  detectedMapping: Record<string, string>;
  totalRows: number;
  sampleRows: Record<string, any>[];
}

export interface ImportPreviewResult {
  jobId: string;
  module: ImportModuleType;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  warningCount: number;
  rows: ImportRowPreview[];
  summary: {
    newRecords: number;
    updateRecords: number;
    skipRecords: number;
    failedRecords: number;
  };
}

export interface ImportJobDto {
  id: string;
  organizationId: string;
  companyId: string;
  userId?: string;
  module: ImportModuleType;
  fileName: string;
  fileSize: number;
  fileFormat: string;
  worksheetName?: string;
  status: ImportStatus;
  mode: ImportMode;
  errorPolicy: ImportErrorPolicy;
  totalRows: number;
  validRows: number;
  importedRows: number;
  updatedRows: number;
  skippedRows: number;
  failedRows: number;
  columnMapping?: Record<string, string>;
  errors?: ImportErrorRow[];
  summary?: {
    durationMs?: number;
    createdIds?: string[];
    updatedIds?: string[];
    affectedAccounts?: string[];
  };
  errorMessage?: string;
  idempotencyKey?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
