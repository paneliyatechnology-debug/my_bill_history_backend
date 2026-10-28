import { INDIAN_STATES } from "@billing/shared-types";

export const BUSINESS_TYPES = [
  { id: "MANUFACTURER", label: "Manufacturer" },
  { id: "WHOLESALER", label: "Wholesaler" },
  { id: "DISTRIBUTOR", label: "Distributor" },
  { id: "RETAILER", label: "Retailer" },
  { id: "SERVICE_PROVIDER", label: "Service Provider" },
  { id: "IMPORTER", label: "Importer" },
  { id: "EXPORTER", label: "Exporter" },
];

export const INDUSTRY_TYPES = [
  { id: "RETAIL", label: "Retail / Shop" },
  { id: "WHOLESALE", label: "Wholesale Trading" },
  { id: "MANUFACTURING", label: "Manufacturing" },
  { id: "PHARMA", label: "Pharmacy / Healthcare" },
  { id: "FMCG", label: "FMCG / Grocery" },
  { id: "TEXTILE", label: "Textile / Garments" },
  { id: "ELECTRONICS", label: "Electronics" },
  { id: "AUTOMOBILE", label: "Automobile" },
  { id: "RESTAURANT", label: "Restaurant / Food" },
  { id: "CONSTRUCTION", label: "Construction" },
  { id: "SERVICES", label: "Professional Services" },
  { id: "OTHER", label: "Other" },
];

export const REGISTRATION_TYPES = [
  { id: "PROPRIETORSHIP", label: "Proprietorship" },
  { id: "PARTNERSHIP", label: "Partnership" },
  { id: "LLP", label: "LLP" },
  { id: "PRIVATE_LIMITED", label: "Private Limited Company" },
  { id: "PUBLIC_LIMITED", label: "Public Limited Company" },
  { id: "OPC", label: "One Person Company" },
  { id: "HUF", label: "HUF" },
  { id: "TRUST", label: "Trust" },
  { id: "SOCIETY", label: "Society" },
  { id: "OTHER", label: "Other" },
];

export const EXTRA_DETAIL_KEYS = [
  { id: "Website", label: "Website", placeholder: "www.website.com" },
  { id: "MSME", label: "MSME number", placeholder: "UDYAM-XX-00-0000000" },
  { id: "CIN", label: "CIN" },
  { id: "LUT", label: "LUT number" },
  { id: "FSSAI", label: "FSSAI" },
  { id: "DrugLicense", label: "Drug License" },
];

export const INDIAN_STATE_OPTIONS = Object.entries(INDIAN_STATES)
  .filter(([code]) => !["96", "97", "99", "28"].includes(code))
  .map(([code, st]) => ({ code, name: st.name, nameGujarati: st.nameGujarati }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function matchIndianStateCode(stateName: string): string | null {
  const n = String(stateName || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z]/g, "");
  if (!n) return null;
  for (const st of INDIAN_STATE_OPTIONS) {
    const m = st.name.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");
    if (m === n || m.includes(n) || n.includes(m)) return st.code;
  }
  return null;
}

export function companySettingsCatalog() {
  return {
    businessTypes: BUSINESS_TYPES,
    industryTypes: INDUSTRY_TYPES,
    registrationTypes: REGISTRATION_TYPES,
    extraDetailKeys: EXTRA_DETAIL_KEYS,
    indianStates: INDIAN_STATE_OPTIONS,
    logo: { maxMb: 5, types: ["image/png", "image/jpeg"] },
    signature: { maxMb: 2, types: ["image/png", "image/jpeg"] },
  };
}
