export interface RegisterDto {
  fullName: string;
  phone: string;
  email?: string;
  otp?: string;
  password: string;
  organizationName: string;
  companyLegalName?: string;
  tradeName?: string;
  gstin?: string;
  stateCode?: string; // e.g. "24" for Gujarat
  preferredLang?: string; // "en" | "gu"
}
