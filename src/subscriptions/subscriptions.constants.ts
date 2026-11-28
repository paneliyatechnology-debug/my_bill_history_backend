import { SubscriptionTier } from "../shared-types";

export const TIER_RANKS: Record<string, number> = {
  [SubscriptionTier.TRIAL]: 0,
  [SubscriptionTier.RETAIL_BASIC]: 1,
  [SubscriptionTier.WHOLESALE_PRO]: 3,
  [SubscriptionTier.DISTRIBUTION_ENTERPRISE]: 3,
  [SubscriptionTier.MANUFACTURING_SUITE]: 4,
};

export interface PlanPricing {
  tier: SubscriptionTier;
  id: string; // "starter" | "professional" | "enterprise"
  name: string;
  nameGujarati: string;
  monthlyPrice: number; // in INR
  yearlyPrice: number; // in INR per month when billed annually
  annualTotal: number; // yearlyPrice * 12
  monthlyPaise: number; // monthlyPrice * 100
  yearlyPaise: number; // annualTotal * 100
  maxCompanies: number;
  maxInvoicesPerYear: number;
  features: string[];
  featuresGujarati: string[];
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionTier, PlanPricing> = {
  [SubscriptionTier.RETAIL_BASIC]: {
    tier: SubscriptionTier.RETAIL_BASIC,
    id: "starter",
    name: "Starter Plan",
    nameGujarati: "સ્ટાર્ટર પ્લાન (Starter)",
    monthlyPrice: 499,
    yearlyPrice: 399,
    annualTotal: 399 * 12, // 4,788
    monthlyPaise: 499 * 100, // 49,900
    yearlyPaise: 399 * 12 * 100, // 478,800
    maxCompanies: 1,
    maxInvoicesPerYear: 3000,
    features: [
      "1 Business Company Profile",
      "Up to 3,000 Invoices per year",
      "Standard B2B & B2C GST Invoicing",
      "A4 Laser & 58/80mm Thermal Print",
      "Basic Sales & Cash Reports",
      "Standard Chat & Email Support",
    ],
    featuresGujarati: [
      "૧ કંપની અથવા દુકાન પ્રોફાઇલ",
      "વર્ષે ૩,૦૦૦ ઇન્વૉઇસ સુધી",
      "સ્ટાન્ડર્ડ B2B અને B2C GST બિલિંગ",
      "A4 લેસર અને ૫૮mm/૮૦mm થર્મલ પ્રિન્ટ",
      "લાઇવ વેચાણ ચાર્ટ અને રોકડ રિપોર્ટ્સ",
      "સ્ટાન્ડર્ડ ચેટ અને ઇમેઇલ હેલ્પડેસ્ક",
    ],
  },
  [SubscriptionTier.WHOLESALE_PRO]: {
    tier: SubscriptionTier.WHOLESALE_PRO,
    id: "professional",
    name: "Professional Plan",
    nameGujarati: "પ્રોફેશનલ પ્લાન (Professional)",
    monthlyPrice: 999,
    yearlyPrice: 799,
    annualTotal: 799 * 12, // 9,588
    monthlyPaise: 999 * 100, // 99,900
    yearlyPaise: 799 * 12 * 100, // 958,800
    maxCompanies: 3,
    maxInvoicesPerYear: -1, // Unlimited
    features: [
      "Up to 3 Business Companies",
      "Unlimited Invoices & E-Way Bills",
      "Purchase Bill AI Camera Scanner (OCR)",
      "Multi-Godown Stock Sync & Transfer Slips",
      "Automated WhatsApp Reminders & Statements",
      "GSTR-1, 3B & 2B Return Preparation",
      "Priority Phone & Remote Support",
    ],
    featuresGujarati: [
      "૩ કંપનીઓ અથવા બ્રાન્ચ સુધી",
      "અનલિમિટેડ ઇન્વૉઇસ અને e-Way Bills",
      "ખરીદી બિલ AI કેમેરા સ્કેનર (OCR)",
      "બહુ-ગોડાઉન સ્ટોક સિન્ક & ટ્રાન્સફર",
      "WhatsApp ઓટોમેટિક રિમાઇન્ડર્સ",
      "GSTR-1, 3B અને 2B તૈયાર ફાઈલો",
      "પ્રાથમિક ફોન અને રિમોટ સપોર્ટ",
    ],
  },
  [SubscriptionTier.DISTRIBUTION_ENTERPRISE]: {
    tier: SubscriptionTier.DISTRIBUTION_ENTERPRISE,
    id: "enterprise",
    name: "Enterprise Plan",
    nameGujarati: "એન્ટરપ્રાઇઝ પ્લાન (Enterprise)",
    monthlyPrice: 1999,
    yearlyPrice: 1599,
    annualTotal: 1599 * 12, // 19,188
    monthlyPaise: 1999 * 100, // 199,900
    yearlyPaise: 1599 * 12 * 100, // 1,918,800
    maxCompanies: 9999, // Unlimited
    maxInvoicesPerYear: -1, // Unlimited
    features: [
      "Unlimited Companies, Warehouses & Branches",
      "Unlimited Staff Logins with Role Permissions",
      "Direct Government E-Invoicing API Integration",
      "Real-time Multi-Branch Cloud Data Sync",
      "Dedicated Relationship Support Manager",
      "Custom Branded Print Templates & Ledgers",
      "24/7 Priority Dedicated Helpline",
    ],
    featuresGujarati: [
      "અનલિમિટેડ કંપનીઓ અને ગોડાઉન",
      "અનલિમિટેડ સ્ટાફ લોગિન & રોલ પરમિશન",
      "સરકારી e-Invoice સીધો API ઇન્ટિગ્રેશન",
      "મલ્ટી-બ્રાન્ચ રિયલ-ટાઇમ ક્લાઉડ સિન્ક",
      "ડેડિકેટેડ એકાઉન્ટિંગ મેનેજર સપોર્ટ",
      "કસ્ટમ પ્રિન્ટ થીમ્સ અને બિલ ફોર્મેટ્સ",
      "૨૪/૭ પ્રાથમિક હેલ્પલાઇન સપોર્ટ",
    ],
  },
  [SubscriptionTier.MANUFACTURING_SUITE]: {
    tier: SubscriptionTier.MANUFACTURING_SUITE,
    id: "manufacturing",
    name: "Manufacturing Suite",
    nameGujarati: "મેન્યુફેક્ચરિંગ સ્યુટ",
    monthlyPrice: 2499,
    yearlyPrice: 1999,
    annualTotal: 1999 * 12, // 23,988
    monthlyPaise: 2499 * 100,
    yearlyPaise: 1999 * 12 * 100,
    maxCompanies: 9999,
    maxInvoicesPerYear: -1,
    features: [
      "Complete Manufacturing BoM & Batch Production",
      "Unlimited Companies, Warehouses & Branches",
      "Raw Material Scrap & Job Work Tracking",
      "Enterprise Multi-Godown Logistics",
    ],
    featuresGujarati: [
      "સંપૂર્ણ મેન્યુફેક્ચરિંગ BoM અને બેચ ઉત્પાદન",
      "અનલિમિટેડ કંપનીઓ અને ગોડાઉન",
    ],
  },
  [SubscriptionTier.TRIAL]: {
    tier: SubscriptionTier.TRIAL,
    id: "trial",
    name: "Free Trial (14 Days)",
    nameGujarati: "ટ્રાયલ પ્લાન (૧૪ દિવસ)",
    monthlyPrice: 0,
    yearlyPrice: 0,
    annualTotal: 0,
    monthlyPaise: 0,
    yearlyPaise: 0,
    maxCompanies: 1,
    maxInvoicesPerYear: 50,
    features: [
      "14-Day Full Access Trial",
      "1 Business Profile",
      "Up to 50 GST Invoices",
    ],
    featuresGujarati: ["૧૪ દિવસની ફ્રી ટ્રાયલ", "૧ બિઝનેસ પ્રોફાઇલ"],
  },
};
