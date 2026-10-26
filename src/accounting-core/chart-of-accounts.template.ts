import { AccountNature, AccountOpeningType } from "@billing/shared-types";

export interface TemplateLedgerGroup {
  name: string;
  nameGujarati?: string;
  nature: AccountNature;
  parentName?: string;
  isSystem: boolean;
}

export interface TemplateLedgerAccount {
  name: string;
  nameGujarati?: string;
  groupName: string;
  code?: string;
  isBankLedger?: boolean;
  isCashLedger?: boolean;
  isTaxLedger?: boolean;
  taxRate?: number;
  openingType: AccountOpeningType;
}

/**
 * Standard Indian SME Chart of Accounts Groups Hierarchy
 * Parent groups are defined before child groups to guarantee hierarchical insertion order.
 */
export const STANDARD_SME_GROUPS: TemplateLedgerGroup[] = [
  // Primary Head: ASSET
  {
    name: "Current Assets",
    nameGujarati: "ચાલુ મિલકતો",
    nature: AccountNature.ASSET,
    isSystem: true,
  },
  {
    name: "Fixed Assets",
    nameGujarati: "કાયમી મિલકતો",
    nature: AccountNature.ASSET,
    isSystem: true,
  },
  // Sub-groups of Current Assets
  {
    name: "Cash-in-hand",
    nameGujarati: "રોકડ સિલક",
    nature: AccountNature.ASSET,
    parentName: "Current Assets",
    isSystem: true,
  },
  {
    name: "Bank Accounts",
    nameGujarati: "બેંક ખાતાઓ",
    nature: AccountNature.ASSET,
    parentName: "Current Assets",
    isSystem: true,
  },
  {
    name: "Sundry Debtors",
    nameGujarati: "દેવાદારો (ગ્રાહકો)",
    nature: AccountNature.ASSET,
    parentName: "Current Assets",
    isSystem: true,
  },
  {
    name: "Stock-in-hand",
    nameGujarati: "આખર સ્ટોક",
    nature: AccountNature.ASSET,
    parentName: "Current Assets",
    isSystem: true,
  },
  {
    name: "Duties & Taxes (ITC)",
    nameGujarati: "ઇનપુટ ટેક્સ ક્રેડિટ",
    nature: AccountNature.ASSET,
    parentName: "Current Assets",
    isSystem: true,
  },

  // Primary Head: LIABILITY
  {
    name: "Current Liabilities",
    nameGujarati: "ચાલુ દેવાં",
    nature: AccountNature.LIABILITY,
    isSystem: true,
  },
  {
    name: "Loans & Borrowings",
    nameGujarati: "લોન અને ધિરાણ",
    nature: AccountNature.LIABILITY,
    isSystem: true,
  },
  // Sub-groups of Current Liabilities
  {
    name: "Sundry Creditors",
    nameGujarati: "લેણદારો (વેપારીઓ)",
    nature: AccountNature.LIABILITY,
    parentName: "Current Liabilities",
    isSystem: true,
  },
  {
    name: "Duties & Taxes",
    nameGujarati: "કરવેરા અને ડ્યુટી",
    nature: AccountNature.LIABILITY,
    parentName: "Current Liabilities",
    isSystem: true,
  },

  // Primary Head: EQUITY
  {
    name: "Capital Account",
    nameGujarati: "મૂડી ખાતું",
    nature: AccountNature.EQUITY,
    isSystem: true,
  },
  {
    name: "Reserves & Surplus",
    nameGujarati: "અનામત અને વધારો",
    nature: AccountNature.EQUITY,
    isSystem: true,
  },

  // Primary Head: INCOME
  {
    name: "Direct Income",
    nameGujarati: "વેચાણ / સીધી આવક",
    nature: AccountNature.INCOME,
    isSystem: true,
  },
  {
    name: "Indirect Income",
    nameGujarati: "અન્ય આવક",
    nature: AccountNature.INCOME,
    isSystem: true,
  },

  // Primary Head: EXPENSE
  {
    name: "Direct Expenses",
    nameGujarati: "ખરીદી અને સીધા ખર્ચા",
    nature: AccountNature.EXPENSE,
    isSystem: true,
  },
  {
    name: "Indirect Expenses",
    nameGujarati: "ઓફિસ અને પરચૂરણ ખર્ચા",
    nature: AccountNature.EXPENSE,
    isSystem: true,
  },
];

/**
 * Standard Indian SME Default Nominal and Real Accounts (Opening balance strictly 0.00)
 */
export const STANDARD_SME_ACCOUNTS: TemplateLedgerAccount[] = [
  // Cash
  {
    name: "Cash Account",
    nameGujarati: "રોકડ ખાતું",
    groupName: "Cash-in-hand",
    code: "1010",
    isCashLedger: true,
    openingType: "DR",
  },
  {
    name: "Petty Cash Account",
    nameGujarati: "પરચૂરણ રોકડ",
    groupName: "Cash-in-hand",
    code: "1020",
    isCashLedger: true,
    openingType: "DR",
  },

  // Sales (Income)
  {
    name: "General Sales Account",
    nameGujarati: "સામાન્ય વેચાણ",
    groupName: "Direct Income",
    code: "4010",
    openingType: "CR",
  },
  {
    name: "Inter-State Sales Account",
    nameGujarati: "રાજ્ય બહાર વેચાણ",
    groupName: "Direct Income",
    code: "4020",
    openingType: "CR",
  },

  // Purchases (Expenses)
  {
    name: "General Purchases Account",
    nameGujarati: "સામાન્ય ખરીદી",
    groupName: "Direct Expenses",
    code: "5010",
    openingType: "DR",
  },
  {
    name: "Freight & Cartage Inward",
    nameGujarati: "આવક માલ ભાડું",
    groupName: "Direct Expenses",
    code: "5020",
    openingType: "DR",
  },

  // GST Output (Duties & Taxes - Liability)
  {
    name: "Output CGST",
    nameGujarati: "ચૂકવવાપાત્ર CGST",
    groupName: "Duties & Taxes",
    code: "2110",
    isTaxLedger: true,
    openingType: "CR",
  },
  {
    name: "Output SGST",
    nameGujarati: "ચૂકવવાપાત્ર SGST",
    groupName: "Duties & Taxes",
    code: "2120",
    isTaxLedger: true,
    openingType: "CR",
  },
  {
    name: "Output IGST",
    nameGujarati: "ચૂકવવાપાત્ર IGST",
    groupName: "Duties & Taxes",
    code: "2130",
    isTaxLedger: true,
    openingType: "CR",
  },
  {
    name: "Output UTGST",
    nameGujarati: "ચૂકવવાપાત્ર UTGST",
    groupName: "Duties & Taxes",
    code: "2140",
    isTaxLedger: true,
    openingType: "CR",
  },

  // GST Input (Duties & Taxes ITC - Asset)
  {
    name: "Input CGST (ITC)",
    nameGujarati: "ઇનપુટ CGST ક્રેડિટ",
    groupName: "Duties & Taxes (ITC)",
    code: "1110",
    isTaxLedger: true,
    openingType: "DR",
  },
  {
    name: "Input SGST (ITC)",
    nameGujarati: "ઇનપુટ SGST ક્રેડિટ",
    groupName: "Duties & Taxes (ITC)",
    code: "1120",
    isTaxLedger: true,
    openingType: "DR",
  },
  {
    name: "Input IGST (ITC)",
    nameGujarati: "ઇનપુટ IGST ક્રેડિટ",
    groupName: "Duties & Taxes (ITC)",
    code: "1130",
    isTaxLedger: true,
    openingType: "DR",
  },
  {
    name: "Input UTGST (ITC)",
    nameGujarati: "ઇનપુટ UTGST ક્રેડિટ",
    groupName: "Duties & Taxes (ITC)",
    code: "1140",
    isTaxLedger: true,
    openingType: "DR",
  },

  // Round Off & Discounts
  {
    name: "Round Off Account",
    nameGujarati: "રાઉન્ડ ઓફ ખાતું",
    groupName: "Indirect Income",
    code: "4990",
    openingType: "CR",
  },
  {
    name: "Discount Allowed",
    nameGujarati: "આપેલ વટાવ",
    groupName: "Indirect Expenses",
    code: "5110",
    openingType: "DR",
  },
  {
    name: "Discount Received",
    nameGujarati: "મળેલ વટાવ",
    groupName: "Indirect Income",
    code: "4110",
    openingType: "CR",
  },

  // Operating Expenses
  {
    name: "Rent Expense",
    nameGujarati: "દુકાન/ગોડાઉન ભાડું",
    groupName: "Indirect Expenses",
    code: "5210",
    openingType: "DR",
  },
  {
    name: "Salary & Wages",
    nameGujarati: "પગાર અને વેતન",
    groupName: "Indirect Expenses",
    code: "5220",
    openingType: "DR",
  },
  {
    name: "Electricity & Utilities",
    nameGujarati: "લાઈટ બિલ ખર્ચ",
    groupName: "Indirect Expenses",
    code: "5230",
    openingType: "DR",
  },
  {
    name: "Bank Charges & Commission",
    nameGujarati: "બેંક ચાર્જીસ",
    groupName: "Indirect Expenses",
    code: "5240",
    openingType: "DR",
  },

  // Capital / Equity
  {
    name: "Proprietor Capital Account",
    nameGujarati: "માલિકનું મૂડી ખાતું",
    groupName: "Capital Account",
    code: "3010",
    openingType: "CR",
  },
];
