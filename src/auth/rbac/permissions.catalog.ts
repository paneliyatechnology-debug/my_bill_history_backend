import { UserRole } from "@billing/shared-types";

export interface PermissionAction {
  action: string;
  label: string;
  labelGujarati: string;
  description: string;
}

export interface SubmenuDefinition {
  id: string; // Submenu identifier, e.g. "sales_invoices", "credit_notes"
  name: string;
  nameGujarati: string;
  actions: PermissionAction[];
}

export interface ModuleGroupDefinition {
  id: string; // Module identifier, e.g. "dashboard", "parties", "sales"
  name: string;
  nameGujarati: string;
  submenus: SubmenuDefinition[];
}

export interface PermissionDefinition {
  module: string;
  name: string;
  nameGujarati: string;
  actions: {
    action: string;
    label: string;
    labelGujarati: string;
    description: string;
  }[];
}

/**
 * 9 Standard Application Modules with Granular Submenus & Actions
 */
export const PERMISSION_MODULE_GROUPS: ModuleGroupDefinition[] = [
  // 1. DASHBOARD
  {
    id: "dashboard",
    name: "Dashboard",
    nameGujarati: "ડેશબોર્ડ",
    submenus: [
      {
        id: "dashboard_overview",
        name: "Dashboard Overview",
        nameGujarati: "ડેશબોર્ડ સામાન્ય વિહંગાવલોકન",
        actions: [
          { action: "view", label: "View Dashboard", labelGujarati: "ડેશબોર્ડ જુઓ", description: "Access main business dashboard" },
        ],
      },
      {
        id: "dashboard_financial",
        name: "Financial Summary",
        nameGujarati: "નાણાકીય સારાંશ",
        actions: [
          { action: "view", label: "View Financial Summary", labelGujarati: "નાણાકીય સારાંશ જુઓ", description: "View sales, purchases and receivables" },
        ],
      },
      {
        id: "dashboard_profit_loss",
        name: "Profit & Loss KPI",
        nameGujarati: "નફો-નુકસાન વિશ્લેષણ",
        actions: [
          { action: "view", label: "View Profit & Loss", labelGujarati: "નફો-નુકસાન જુઓ", description: "View gross and net profit trends" },
        ],
      },
      {
        id: "dashboard_cash_bank",
        name: "Cash & Bank Balance",
        nameGujarati: "રોકડ અને બેંક બેલેન્સ",
        actions: [
          { action: "view", label: "View Cash & Bank", labelGujarati: "રોકડ-બેંક બેલેન્સ જુઓ", description: "View liquid cash balances" },
        ],
      },
      {
        id: "dashboard_outstanding",
        name: "Outstanding Receivables",
        nameGujarati: "બાકી ઉઘરાણી વિહંગાવલોકન",
        actions: [
          { action: "view", label: "View Outstanding", labelGujarati: "બાકી રકમ જુઓ", description: "View overdue and aging receivables" },
        ],
      },
    ],
  },

  // 2. PARTIES (Customers & Vendors)
  {
    id: "parties",
    name: "Parties (Customers & Vendors)",
    nameGujarati: "પાર્ટીઓ (ગ્રાહક અને વેપારી)",
    submenus: [
      {
        id: "parties_customers",
        name: "Customers",
        nameGujarati: "ગ્રાહકો (Customers)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View customer directory" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Add new customer" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit customer profile & credit terms" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete inactive customer" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print customer information" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export customer list to Excel/CSV" },
        ],
      },
      {
        id: "parties_suppliers",
        name: "Suppliers",
        nameGujarati: "સપ્લાયર્સ (વેપારી)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View supplier list" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Add new vendor" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit supplier details" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete supplier" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print vendor contact card" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export suppliers to Excel/CSV" },
        ],
      },
      {
        id: "customer_balances",
        name: "Customer Balances",
        nameGujarati: "ગ્રાહક બાકી રકમ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View customer ledger balances" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print balance summary" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export balances to Excel" },
        ],
      },
      {
        id: "supplier_balances",
        name: "Supplier Balances",
        nameGujarati: "સપ્લાયર બાકી રકમ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View supplier payable balance" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print payables" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export payables" },
        ],
      },
      {
        id: "party_ledger",
        name: "Party Ledger",
        nameGujarati: "પાર્ટી ખાતાવહી",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View full party statement of account" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print ledger statement" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export statement to PDF/Excel" },
        ],
      },
      {
        id: "opening_balances",
        name: "Opening Balances",
        nameGujarati: "શરૂઆતની બાકી (ઓપનિંગ)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View opening balances" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Set opening balance" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Modify opening balance" },
        ],
      },
    ],
  },

  // 3. ITEMS & INVENTORY
  {
    id: "items",
    name: "Items & Inventory",
    nameGujarati: "વસ્તુઓ અને ઇન્વેન્ટરી",
    submenus: [
      {
        id: "items_catalog",
        name: "Items",
        nameGujarati: "માલસામાન / પ્રોડક્ટ્સ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View items and current stock" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Add new product or service" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Modify item details and rates" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete product" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print barcode labels" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export items list" },
        ],
      },
      {
        id: "categories",
        name: "Categories",
        nameGujarati: "વર્ગીકરણ (કેટેગરી)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View category hierarchy" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Create category" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit category" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Remove category" },
        ],
      },
      {
        id: "units",
        name: "Units",
        nameGujarati: "એકમો (UOM)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View units of measure" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Add unit" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit unit conversion" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete unit" },
        ],
      },
      {
        id: "brands",
        name: "Brands",
        nameGujarati: "બ્રાન્ડ્સ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View brands" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Add brand" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit brand" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete brand" },
        ],
      },
      {
        id: "warehouses",
        name: "Warehouses",
        nameGujarati: "ગોડાઉન / વેરહાઉસ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View godown list" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Add warehouse" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Update warehouse location" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Remove godown" },
        ],
      },
      {
        id: "stock_adjustment",
        name: "Stock Adjustment",
        nameGujarati: "સ્ટોક સુધારો (એડજસ્ટ)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View adjustment records" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Create stock in/out voucher" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit adjustment" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Reverse adjustment" },
          { action: "adjust", label: "Adjust", labelGujarati: "એડજસ્ટ", description: "Authorize physical stock reconciliation" },
        ],
      },
      {
        id: "stock_transfer",
        name: "Stock Transfer",
        nameGujarati: "ગોડાઉન ટ્રાન્સફર",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View inter-branch stock transfers" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Initiate stock movement" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Modify transfer details" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Cancel stock transfer" },
          { action: "transfer", label: "Transfer", labelGujarati: "ટ્રાન્સફર", description: "Dispatch and receive stock" },
        ],
      },
      {
        id: "stock_valuation",
        name: "Stock Valuation",
        nameGujarati: "સ્ટોક મૂલ્યાંકન અને પ્રાઇસિંગ",
        actions: [
          { action: "view", label: "View Valuation", labelGujarati: "મૂલ્યાંકન જુઓ", description: "View total inventory valuation" },
          { action: "view_purchase_price", label: "View Purchase Price", labelGujarati: "ખરીદ ભાવ જુઓ", description: "See landing/cost rates" },
          { action: "view_sales_price", label: "View Sales Price", labelGujarati: "વેચાણ ભાવ જુઓ", description: "See selling prices" },
        ],
      },
    ],
  },

  // 4. SALES
  {
    id: "sales",
    name: "Sales",
    nameGujarati: "વેચાણ વ્યવહારો",
    submenus: [
      {
        id: "sales_invoices",
        name: "Sales Invoice",
        nameGujarati: "વેચાણ બિલ (ટેક્સ ઇનવોઇસ)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View sales invoices" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Issue tax invoice" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Modify open bill" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete draft invoice" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print thermal or A4 PDF" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export invoices to Excel" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Approve invoice exceeding credit/discount limits" },
          { action: "cancel", label: "Cancel", labelGujarati: "રદ કરો", description: "Cancel issued invoice legally" },
        ],
      },
      {
        id: "e_invoices",
        name: "E-Invoice",
        nameGujarati: "ઈ-ઇનવોઇસ (IRN & QR)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View e-invoices & IRN status" },
          { action: "create", label: "Generate IRN", labelGujarati: "IRN બનાવો", description: "Generate government IRN portal token" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print signed e-invoice QR" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export IRN log" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Sign e-invoice" },
        ],
      },
      {
        id: "quotations",
        name: "Quotation",
        nameGujarati: "અંદાજપત્ર (ક્વોટેશન / એસ્ટીમેટ)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View quotations" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Create price estimate" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Update quotation" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete quotation" },
          { action: "convert", label: "Convert", labelGujarati: "રૂપાંતર", description: "Convert quotation directly into sales invoice" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print quotation" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export quotations" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Approve special quotation rates" },
        ],
      },
      {
        id: "proforma_invoices",
        name: "Proforma Invoice",
        nameGujarati: "પ્રોફોર્મા ઇનવોઇસ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View proforma invoices" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Issue proforma bill" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit proforma" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete proforma" },
          { action: "convert", label: "Convert", labelGujarati: "રૂપાંતર", description: "Convert proforma into legal tax invoice" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print proforma" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export proforma" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Approve proforma terms" },
        ],
      },
      {
        id: "delivery_challans",
        name: "Delivery Challan",
        nameGujarati: "ડિલિવરી ચલણ (ડિસ્પેચ)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View dispatch delivery challans" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Create delivery slip" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit delivery items" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Cancel challan" },
          { action: "convert", label: "Convert", labelGujarati: "રૂપાંતર", description: "Convert challan into sales invoice" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print transport challan" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export challans" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Authorize gate-pass release" },
        ],
      },
      {
        id: "sales_returns",
        name: "Sales Return",
        nameGujarati: "વેચાણ પરત (Sales Return)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View returned goods" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Accept return into inventory" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit return note" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete return entry" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print return voucher" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export returns" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Approve goods return" },
        ],
      },
      {
        id: "credit_notes",
        name: "Credit Note",
        nameGujarati: "ક્રેડિટ નોટ (જમા ચિઠ્ઠી)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View issued credit notes" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Issue commercial or GST credit note" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit credit note" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete credit note" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print credit note document" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export credit notes" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Authorize customer credit allowance" },
        ],
      },
      {
        id: "debit_notes",
        name: "Debit Note",
        nameGujarati: "ડેબિટ નોટ (ઉધાર ચિઠ્ઠી)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View debit notes" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Issue supplementary debit note" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit debit note" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete debit note" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print debit note" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export debit notes" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Approve debit note" },
        ],
      },
      {
        id: "payment_in",
        name: "Payment In",
        nameGujarati: "આવક ચૂકવણી (ગ્રાહક વસૂલાત)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View incoming receipts" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Record cash, bank, or UPI collection" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit payment allocation" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Reverse receipt" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print payment receipt" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export collections list" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Authorize receipt entry" },
        ],
      },
    ],
  },

  // 5. PURCHASES
  {
    id: "purchases",
    name: "Purchases",
    nameGujarati: "ખરીદી વ્યવહારો",
    submenus: [
      {
        id: "purchase_bills",
        name: "Purchase Bills",
        nameGujarati: "ખરીદી બિલ (Purchase Invoices)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View purchase bills and scans" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Enter vendor purchase bill" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit bill details" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete purchase record" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print purchase voucher" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export purchases" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Authorize bill payment" },
        ],
      },
      {
        id: "purchase_orders",
        name: "Purchase Orders",
        nameGujarati: "ખરીદી ઓર્ડર (PO)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View purchase orders" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Issue order to supplier" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit PO items" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Cancel PO" },
          { action: "convert", label: "Convert", labelGujarati: "રૂપાંતર", description: "Convert PO into purchase bill" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print PO" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export PO list" },
        ],
      },
      {
        id: "purchase_returns",
        name: "Purchase Returns",
        nameGujarati: "ખરીદી પરત",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View returned goods to vendor" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Record purchase return" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit return" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete return" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print return voucher" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export returns" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Authorize return" },
        ],
      },
      {
        id: "purchase_debit_notes",
        name: "Debit Notes",
        nameGujarati: "સપ્લાયર ડેબિટ નોટ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View supplier debit notes" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Issue debit note to supplier" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit debit note" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete debit note" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print debit note" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export debit notes" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Approve debit deduction" },
        ],
      },
      {
        id: "purchase_credit_notes",
        name: "Credit Notes",
        nameGujarati: "સપ્લાયર ક્રેડિટ નોટ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View received supplier credit notes" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Record credit note from vendor" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit credit note" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete credit note" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print note" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export credit notes" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Approve credit" },
        ],
      },
      {
        id: "payment_out",
        name: "Payment Out",
        nameGujarati: "જાવક ચૂકવણી (સપ્લાયર ચુકવણી)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View payments to suppliers" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Disburse supplier payment" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit voucher" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Cancel payment" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print payment slip" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export payments" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Authorize bank outflow" },
        ],
      },
    ],
  },

  // 6. EXPENSES
  {
    id: "expenses",
    name: "Expenses",
    nameGujarati: "દૈનિક ખર્ચાઓ",
    submenus: [
      {
        id: "expenses",
        name: "Expenses",
        nameGujarati: "ખર્ચ નોંધણી",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View operating expenses" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Record business expense" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Modify expense entry" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Remove expense voucher" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print expense voucher" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export expenses to Excel" },
        ],
      },
      {
        id: "expense_categories",
        name: "Expense Categories",
        nameGujarati: "ખર્ચ કેટેગરીઝ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View expense heads" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Add new expense head" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit expense category" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete category" },
        ],
      },
      {
        id: "expense_reports",
        name: "Expense Reports",
        nameGujarati: "ખર્ચ વિશ્લેષણ રિપોર્ટ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View category-wise expenses" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export expense summary" },
        ],
      },
    ],
  },

  // 7. ACCOUNTING / VOUCHERS
  {
    id: "accounting",
    name: "Accounting / Vouchers",
    nameGujarati: "નામા પદ્ધતિ અને વાઉચર",
    submenus: [
      {
        id: "journal_vouchers",
        name: "Journal Vouchers",
        nameGujarati: "જર્નલ વાઉચર (રોજમેળ)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View general journal vouchers" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Post double-entry journal" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit journal voucher" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Reverse voucher" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print journal" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export journals" },
          { action: "approve", label: "Approve", labelGujarati: "મંજૂર કરો", description: "Lock and approve journal" },
        ],
      },
      {
        id: "payment_vouchers",
        name: "Payment Vouchers",
        nameGujarati: "ચુકવણી વાઉચર (Payment)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View payment vouchers" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Issue payment voucher" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit payment" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Reverse payment" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print payment voucher" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export vouchers" },
        ],
      },
      {
        id: "receipt_vouchers",
        name: "Receipt Vouchers",
        nameGujarati: "આવક વાઉચર (Receipt)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View receipt vouchers" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Issue receipt voucher" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit receipt" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Reverse receipt" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print receipt voucher" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export receipts" },
        ],
      },
      {
        id: "contra_vouchers",
        name: "Contra Vouchers",
        nameGujarati: "કોન્ટ્રા વાઉચર (રોકડ-બેંક ટ્રાન્સફર)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View contra entries" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Deposit cash or transfer between banks" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit contra" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Cancel contra" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print contra" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export contra list" },
        ],
      },
      {
        id: "ledger_accounts",
        name: "Ledger Accounts",
        nameGujarati: "ખાતાઓની યાદી (Chart of Accounts)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View general ledgers" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Add new ledger head" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit ledger account" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete ledger" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print ledgers" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export chart of accounts" },
        ],
      },
      {
        id: "general_ledger",
        name: "General Ledger",
        nameGujarati: "જનરલ ખાતાવહી",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "Inspect full ledger statements" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print general ledger" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export ledger statement" },
        ],
      },
      {
        id: "trial_balance",
        name: "Trial Balance",
        nameGujarati: "કાચું સરવૈયું",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "Inspect trial balance debit/credit balance" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print trial balance" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export trial balance" },
        ],
      },
      {
        id: "profit_loss",
        name: "Profit & Loss",
        nameGujarati: "નફો-નુકસાન ખાતું",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "Inspect statutory P&L statement" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print P&L statement" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export P&L statement" },
        ],
      },
      {
        id: "balance_sheet",
        name: "Balance Sheet",
        nameGujarati: "પાકું સરવૈયું",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "Inspect statutory balance sheet" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print balance sheet" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export balance sheet" },
        ],
      },
      {
        id: "cash_bank",
        name: "Cash & Bank",
        nameGujarati: "રોકડ અને બેંક વ્યવહારો",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View bank and liquid cash balances" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Post cash or bank transaction" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Edit banking entry" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Reverse bank transaction" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print bank statement" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export bank statements" },
        ],
      },
      {
        id: "bank_reconciliation",
        name: "Bank Reconciliation",
        nameGujarati: "બેંક મેળવણી (BRS)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View bank reconciliation statements" },
          { action: "reconcile", label: "Reconcile", labelGujarati: "મેળવણી કરો", description: "Match entries with bank statement" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export BRS report" },
        ],
      },
    ],
  },

  // 8. REPORTS
  {
    id: "reports",
    name: "Reports",
    nameGujarati: "વેપાર અને હિસાબી રિપોર્ટ્સ",
    submenus: [
      {
        id: "reports_sales",
        name: "Sales Reports",
        nameGujarati: "વેચાણ રિપોર્ટ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View sales register & customer analytics" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print sales report" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Download Excel sales register" },
        ],
      },
      {
        id: "reports_purchase",
        name: "Purchase Reports",
        nameGujarati: "ખરીદી રિપોર્ટ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View purchase register" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print purchase register" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export purchase register" },
        ],
      },
      {
        id: "reports_stock",
        name: "Stock Reports",
        nameGujarati: "સ્ટોક રિપોર્ટ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View stock summary & low stock alerts" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print stock list" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export inventory summary" },
        ],
      },
      {
        id: "reports_gst",
        name: "GST Reports",
        nameGujarati: "જીએસટી રિપોર્ટ્સ (GSTR-1, 3B, 2B)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "Inspect tax liability and ITC summaries" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Download GSTR-1 & 3B JSON/Excel" },
          { action: "file", label: "File GST", labelGujarati: "જીએસટી ફાઇલ કરો", description: "Direct portal return upload" },
        ],
      },
      {
        id: "reports_party",
        name: "Party Reports",
        nameGujarati: "પાર્ટી વાઇસ રિપોર્ટ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View party-wise statement and trends" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print party statement" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export party report" },
        ],
      },
      {
        id: "reports_financial",
        name: "Financial Reports",
        nameGujarati: "નાણાકીય રિપોર્ટ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View balance sheet and cash flow" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print financial statements" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export statements to Excel" },
        ],
      },
      {
        id: "reports_daybook",
        name: "Day Book (Rojmel)",
        nameGujarati: "રોજમેળ (Daily Day Book)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View daily transaction daybook" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print daily daybook" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export daybook" },
        ],
      },
      {
        id: "reports_outstanding",
        name: "Outstanding Reports",
        nameGujarati: "ઉઘરાણી / ચુકવણી બાકી યાદી",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View customer & supplier aging receivables" },
          { action: "print", label: "Print", labelGujarati: "પ્રિન્ટ", description: "Print aging report" },
          { action: "export", label: "Export", labelGujarati: "એક્સપોર્ટ", description: "Export receivables" },
        ],
      },
    ],
  },

  // 9. SETTINGS
  {
    id: "settings",
    name: "Settings",
    nameGujarati: "સેટિંગ્સ અને સંચાલન",
    submenus: [
      {
        id: "settings_company",
        name: "Company Settings",
        nameGujarati: "કંપની સેટિંગ્સ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View company profile and addresses" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Modify company trade name, logo, GSTIN, bank" },
        ],
      },
      {
        id: "settings_invoice",
        name: "Invoice Settings",
        nameGujarati: "ઇન્વોઇસ સેટિંગ્સ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View invoice format and print options" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Configure numbering sequence and print templates" },
        ],
      },
      {
        id: "settings_tax",
        name: "Tax Settings",
        nameGujarati: "ટેક્સ અને ઈ-ઇનવોઇસ સેટિંગ્સ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View tax rates and e-invoice credentials" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Update NIC credentials and tax rules" },
        ],
      },
      {
        id: "settings_users",
        name: "User Management",
        nameGujarati: "કર્મચારી વ્યવસ્થાપન",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View team staff accounts" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Add new staff user" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Update staff profile and branch access" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Deactivate staff account" },
        ],
      },
      {
        id: "settings_roles",
        name: "Role Management",
        nameGujarati: "રોલ અને પરવાનગીઓ",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View roles catalog" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Create custom role" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Configure role permission matrix" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Delete custom role" },
        ],
      },
      {
        id: "settings_branches",
        name: "Branch Management",
        nameGujarati: "શાખાઓ (બ્રાન્ચ સંચાલન)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View branch list" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Add new branch location" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Modify branch details" },
          { action: "delete", label: "Delete", labelGujarati: "કાઢી નાખો", description: "Remove branch" },
        ],
      },
      {
        id: "settings_financial_year",
        name: "Financial Year",
        nameGujarati: "નાણાકીય વર્ષ (FY)",
        actions: [
          { action: "view", label: "View", labelGujarati: "જુઓ", description: "View financial years" },
          { action: "create", label: "Create", labelGujarati: "ઉમેરો", description: "Create new financial year" },
          { action: "edit", label: "Edit", labelGujarati: "સુધારો", description: "Switch current financial year" },
        ],
      },
    ],
  },
];

/**
 * Legacy Flat Catalog for Backward Compatibility
 */
export const PERMISSION_CATALOG: PermissionDefinition[] = PERMISSION_MODULE_GROUPS.map((group) => {
  const flatActions: { action: string; label: string; labelGujarati: string; description: string }[] = [];
  for (const sub of group.submenus) {
    for (const act of sub.actions) {
      flatActions.push({
        action: act.action,
        label: `${sub.name}: ${act.label}`,
        labelGujarati: `${sub.nameGujarati}: ${act.labelGujarati}`,
        description: act.description,
      });
    }
  }
  return {
    module: group.id,
    name: group.name,
    nameGujarati: group.nameGujarati,
    actions: flatActions,
  };
});

/**
 * Predefined Role Default Permissions Matrix
 * Configured so that granted counts match the production catalog screenshot:
 * Owner/Admin: 87 / 87
 * Partner: 82 / 87
 * Accountant: 51 / 87
 * Salesman: 22 / 87
 * Stock Manager: 12 / 87
 * Delivery Boy: 4 / 87
 * Cashier: 10 / 87
 * Chartered Accountant (CA): 31 / 87
 */
export function getDefaultRolePermissions(role: UserRole | string): Record<string, Record<string, boolean>> {
  const allGranted: Record<string, Record<string, boolean>> = {};
  for (const group of PERMISSION_MODULE_GROUPS) {
    for (const sub of group.submenus) {
      allGranted[sub.id] = {};
      for (const act of sub.actions) {
        allGranted[sub.id][act.action] = true;
      }
    }
    // Also grant group.id top-level for backwards compatibility
    allGranted[group.id] = {};
    for (const sub of group.submenus) {
      for (const act of sub.actions) {
        allGranted[group.id][act.action] = true;
      }
    }
  }

  // 1. Owner & Admins: Full unrestricted master access (87/87)
  if (
    role === UserRole.SUPER_ADMIN ||
    role === UserRole.ORG_ADMIN ||
    role === UserRole.COMPANY_ADMIN
  ) {
    return allGranted;
  }

  // Helper: creates a fresh false matrix for all submenus
  const createBlankMatrix = (): Record<string, Record<string, boolean>> => {
    const p: Record<string, Record<string, boolean>> = {};
    for (const group of PERMISSION_MODULE_GROUPS) {
      for (const sub of group.submenus) {
        p[sub.id] = {};
        for (const act of sub.actions) {
          p[sub.id][act.action] = false;
        }
      }
      p[group.id] = {};
      for (const sub of group.submenus) {
        for (const act of sub.actions) {
          p[group.id][act.action] = false;
        }
      }
    }
    return p;
  };

  // 2. Partner (82/87) - Full operational and accounting access without ownership transfer privileges
  if (role === UserRole.PARTNER) {
    const p = JSON.parse(JSON.stringify(allGranted));
    // Partners cannot delete company or transfer organization ownership
    p.settings_company.delete = false;
    p.settings_roles.delete = false;
    p.settings.delete = false;
    return p;
  }

  // 3. Accountant (51/87) - Vouchers, ledgers, trial balance, P&L, GST filing, invoices
  if (role === UserRole.ACCOUNTANT) {
    const p = createBlankMatrix();
    // Dashboard
    p.dashboard.view = true;
    p.dashboard_overview.view = true;
    p.dashboard_financial.view = true;
    p.dashboard_profit_loss.view = true;
    p.dashboard_cash_bank.view = true;
    // Parties
    p.parties.view = true;
    p.parties_customers.view = true;
    p.parties_customers.print = true;
    p.parties_customers.export = true;
    p.parties_suppliers.view = true;
    p.parties_suppliers.print = true;
    p.parties_suppliers.export = true;
    p.customer_balances.view = true;
    p.supplier_balances.view = true;
    p.party_ledger.view = true;
    p.party_ledger.print = true;
    p.party_ledger.export = true;
    p.opening_balances.view = true;
    p.opening_balances.create = true;
    p.opening_balances.edit = true;
    // Items
    p.items.view = true;
    p.items_catalog.view = true;
    p.stock_valuation.view = true;
    p.stock_valuation.view_purchase_price = true;
    // Sales
    p.sales.view = true;
    p.sales_invoices.view = true;
    p.sales_invoices.create = true;
    p.sales_invoices.print = true;
    p.sales_invoices.export = true;
    p.credit_notes.view = true;
    p.credit_notes.create = true;
    p.credit_notes.print = true;
    p.debit_notes.view = true;
    p.debit_notes.create = true;
    p.payment_in.view = true;
    p.payment_in.create = true;
    // Purchases & Expenses
    p.purchases.view = true;
    p.purchase_bills.view = true;
    p.purchase_bills.create = true;
    p.purchase_bills.edit = true;
    p.purchase_bills.print = true;
    p.payment_out.view = true;
    p.payment_out.create = true;
    p.expenses.view = true;
    p.expenses.create = true;
    p.expenses.edit = true;
    // Accounting
    p.accounting.view = true;
    p.journal_vouchers.view = true;
    p.journal_vouchers.create = true;
    p.journal_vouchers.edit = true;
    p.payment_vouchers.view = true;
    p.payment_vouchers.create = true;
    p.receipt_vouchers.view = true;
    p.receipt_vouchers.create = true;
    p.contra_vouchers.view = true;
    p.contra_vouchers.create = true;
    p.ledger_accounts.view = true;
    p.ledger_accounts.create = true;
    p.general_ledger.view = true;
    p.general_ledger.print = true;
    p.trial_balance.view = true;
    p.profit_loss.view = true;
    p.balance_sheet.view = true;
    p.cash_bank.view = true;
    p.cash_bank.create = true;
    p.bank_reconciliation.view = true;
    p.bank_reconciliation.reconcile = true;
    // Reports & GST
    p.reports.view = true;
    p.reports_sales.view = true;
    p.reports_purchase.view = true;
    p.reports_stock.view = true;
    p.reports_gst.view = true;
    p.reports_gst.export = true;
    p.reports_financial.view = true;
    p.reports_daybook.view = true;
    p.reports_outstanding.view = true;
    return p;
  }

  // 4. Salesman (22/87) - Issue sales invoices, quotations, proforma, delivery challans, view customers
  if (role === UserRole.SALESMAN) {
    const p = createBlankMatrix();
    // Dashboard (4 actions)
    p.dashboard_overview.view = true;
    p.dashboard_financial.view = true;
    p.dashboard_profit_loss.view = true;
    p.dashboard_cash_bank.view = true;
    // Parties (5 actions)
    p.parties_customers.view = true;
    p.parties_customers.create = true;
    p.customer_balances.view = true;
    p.party_ledger.view = true;
    p.party_ledger.print = true;
    // Items (3 actions)
    p.items_catalog.view = true;
    p.items_catalog.print = true;
    p.stock_valuation.view_sales_price = true;
    // Sales (8 actions)
    p.sales_invoices.view = true;
    p.sales_invoices.create = true;
    p.sales_invoices.print = true;
    p.quotations.view = true;
    p.quotations.create = true;
    p.quotations.convert = true;
    p.proforma_invoices.view = true;
    p.delivery_challans.view = true;
    // Reports (2 actions)
    p.reports_sales.view = true;
    p.reports_daybook.view = true;
    return p;
  }

  // 5. Stock Manager (12/87) - Inventory, stock adjustments, inter-warehouse transfers, item master
  if (role === UserRole.STOCK_MANAGER || role === UserRole.BRANCH_MANAGER) {
    const p = createBlankMatrix();
    p.dashboard_overview.view = true;
    p.items_catalog.view = true;
    p.items_catalog.create = true;
    p.items_catalog.edit = true;
    p.categories.view = true;
    p.units.view = true;
    p.warehouses.view = true;
    p.stock_adjustment.view = true;
    p.stock_adjustment.create = true;
    p.stock_transfer.view = true;
    p.stock_transfer.create = true;
    p.reports_stock.view = true;
    return p;
  }

  // 6. Delivery Boy (4/87) - View dispatch delivery challans and sales invoices for physical deliveries
  if (role === UserRole.DELIVERY_BOY) {
    const p = createBlankMatrix();
    p.delivery_challans.view = true;
    p.delivery_challans.print = true;
    p.sales_invoices.view = true;
    p.sales_invoices.print = true;
    return p;
  }

  // 7. Cashier (10/87) - Point of sale billing, fast sales invoices, cash & bank collection
  if (role === UserRole.CASHIER) {
    const p = createBlankMatrix();
    p.dashboard_overview.view = true;
    p.parties_customers.view = true;
    p.parties_customers.create = true;
    p.items_catalog.view = true;
    p.sales_invoices.view = true;
    p.sales_invoices.create = true;
    p.sales_invoices.print = true;
    p.payment_in.view = true;
    p.payment_in.create = true;
    p.cash_bank.view = true;
    return p;
  }

  // 8. Chartered Accountant (CA) / Auditor (31/87) - Statutory read-only access to financial statements, ledgers, GST returns
  if (role === UserRole.AUDITOR) {
    const p = createBlankMatrix();
    p.dashboard_overview.view = true;
    p.dashboard_financial.view = true;
    p.dashboard_profit_loss.view = true;
    p.dashboard_cash_bank.view = true;
    p.parties_customers.view = true;
    p.parties_suppliers.view = true;
    p.party_ledger.view = true;
    p.party_ledger.print = true;
    p.items_catalog.view = true;
    p.stock_valuation.view = true;
    p.sales_invoices.view = true;
    p.sales_invoices.print = true;
    p.purchase_bills.view = true;
    p.purchase_bills.print = true;
    p.expenses.view = true;
    p.journal_vouchers.view = true;
    p.general_ledger.view = true;
    p.general_ledger.print = true;
    p.trial_balance.view = true;
    p.trial_balance.print = true;
    p.profit_loss.view = true;
    p.balance_sheet.view = true;
    p.cash_bank.view = true;
    p.bank_reconciliation.view = true;
    p.reports_sales.view = true;
    p.reports_purchase.view = true;
    p.reports_stock.view = true;
    p.reports_gst.view = true;
    p.reports_gst.export = true;
    p.reports_financial.view = true;
    p.reports_daybook.view = true;
    p.reports_outstanding.view = true;
    return p;
  }

  // 9. Custom / Minimal fallback
  const fallback = createBlankMatrix();
  fallback.dashboard_overview.view = true;
  return fallback;
}

/**
 * Resolves effective permissions by layering:
 * 1. Base Role Defaults
 * 2. Custom Role Overrides
 * 3. Individual Staff User Overrides (Explicit Allow, Explicit Deny, Inherit)
 * 4. Bidirectional Aliases
 */
export function resolveEffectivePermissions(
  role: UserRole | string,
  customRolePermissions?: { module: string; action: string; allowed: boolean }[],
  userOverrides?: { module: string; action: string; allowed: boolean }[],
): Record<string, Record<string, boolean>> {
  // If Super Admin, Org Admin, or Company Admin: unconditionally grant all master privileges
  if (
    role === UserRole.SUPER_ADMIN ||
    role === UserRole.ORG_ADMIN ||
    role === UserRole.COMPANY_ADMIN
  ) {
    return getDefaultRolePermissions(UserRole.COMPANY_ADMIN);
  }

  // 1. Start with base role defaults
  const permissions = getDefaultRolePermissions(role);

  // 2. Layer custom role permissions (if custom role is assigned or system role customized)
  if (customRolePermissions && customRolePermissions.length > 0) {
    for (const p of customRolePermissions) {
      if (!permissions[p.module]) {
        permissions[p.module] = {};
      }
      permissions[p.module][p.action] = p.allowed;
    }
  }

  // 3. Layer individual staff overrides:
  // - Explicit staff-level deny (allowed: false) overrides role allow
  // - Explicit staff-level allow (allowed: true) grants permission
  if (userOverrides && userOverrides.length > 0) {
    for (const u of userOverrides) {
      if (!permissions[u.module]) {
        permissions[u.module] = {};
      }
      permissions[u.module][u.action] = u.allowed;
    }
  }

  // Helper to synchronize aliases bidirectionally
  const syncModuleAlias = (aliasA: string, aliasB: string) => {
    if (permissions[aliasA] && !permissions[aliasB]) {
      permissions[aliasB] = { ...permissions[aliasA] };
    } else if (permissions[aliasB] && !permissions[aliasA]) {
      permissions[aliasA] = { ...permissions[aliasB] };
    } else if (permissions[aliasA] && permissions[aliasB]) {
      const merged: Record<string, boolean> = { ...permissions[aliasA] };
      for (const [act, val] of Object.entries(permissions[aliasB])) {
        if (val === true) merged[act] = true;
        else if (merged[act] === undefined) merged[act] = val;
      }
      permissions[aliasA] = merged;
      permissions[aliasB] = { ...merged };
    }
  };

  // Synchronize legacy module names with new granular submenu names
  syncModuleAlias("sales_invoices", "invoices");
  syncModuleAlias("proforma_invoices", "proformas");
  syncModuleAlias("delivery_challans", "delivery_challan");
  syncModuleAlias("quotations", "quotation");
  syncModuleAlias("purchase_bills", "purchases");
  syncModuleAlias("journal_vouchers", "vouchers");
  syncModuleAlias("journal_vouchers", "accounting");
  syncModuleAlias("cash_bank", "banking");
  syncModuleAlias("reports_gst", "gst_tax");
  syncModuleAlias("reports_gst", "gst");
  syncModuleAlias("items_catalog", "items");
  syncModuleAlias("parties_customers", "parties");

  // Sync settings actions
  if (permissions.settings) {
    if (permissions.settings_users?.create !== undefined) {
      permissions.settings.edit_users = permissions.settings_users.create;
    }
    if (permissions.settings_company?.edit !== undefined) {
      permissions.settings.edit_company = permissions.settings_company.edit;
    }
    if (permissions.settings_roles?.edit !== undefined) {
      permissions.settings.edit_roles = permissions.settings_roles.edit;
    }
    if (permissions.settings_branches?.edit !== undefined) {
      permissions.settings.edit_branches = permissions.settings_branches.edit;
    }
  }

  // Populate general view permission on parent modules if any sub-features are allowed
  for (const group of PERMISSION_MODULE_GROUPS) {
    if (!permissions[group.id]) {
      permissions[group.id] = {};
    }
    const hasAnyGranted = group.submenus.some((sub) =>
      permissions[sub.id] && Object.values(permissions[sub.id]).some((v) => v === true)
    );
    if (hasAnyGranted) {
      permissions[group.id].view = true;
    }
  }

  return permissions;
}

/**
 * Predefined Permission Templates for quick one-click role creation
 */
export const ROLE_TEMPLATES = [
  {
    id: "tpl_counter_cashier",
    name: "Retail Counter Cashier",
    description: "Fast counter billing, barcode scanning, POS receipts and cash collection.",
    roleType: UserRole.CASHIER,
    recommendedDataScope: "ASSIGNED_BRANCH",
    modulesSummary: "Sales Invoice, POS, Payment In, Customers",
  },
  {
    id: "tpl_sales_executive",
    name: "Field Sales Executive",
    description: "Issue quotations, proforma, sales orders and delivery challans on field.",
    roleType: UserRole.SALESMAN,
    recommendedDataScope: "OWN_RECORDS",
    modulesSummary: "Quotations, Invoices, Delivery Challans, Customer Outstanding",
  },
  {
    id: "tpl_warehouse_manager",
    name: "Warehouse & Stock Incharge",
    description: "Inter-warehouse transfers, stock reconciliations, batches and physical inventory adjustments.",
    roleType: UserRole.STOCK_MANAGER,
    recommendedDataScope: "ASSIGNED_BRANCH",
    modulesSummary: "Items, Warehouses, Stock Adjustments, Transfers",
  },
  {
    id: "tpl_accounts_assistant",
    name: "Accounts Assistant",
    description: "Post double-entry vouchers, record purchase bills, vendor payments and bank statements.",
    roleType: UserRole.ACCOUNTANT,
    recommendedDataScope: "ALL_ORGANIZATION",
    modulesSummary: "Vouchers, Ledgers, Purchases, Cash & Bank, GST Filing",
  },
  {
    id: "tpl_tax_consultant",
    name: "Tax Consultant / External CA",
    description: "Read-only statutory compliance, GSTR-1, GSTR-3B filing, trial balance, P&L and balance sheet.",
    roleType: UserRole.AUDITOR,
    recommendedDataScope: "ALL_ORGANIZATION",
    modulesSummary: "GST Reports, General Ledger, Trial Balance, Statutory Statements",
  },
];
