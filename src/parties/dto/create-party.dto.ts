import { PartyType, GstRegistrationType } from "@billing/shared-types";

export interface PartyAddressDto {
  line1: string;
  line2?: string;
  city: string;
  district?: string;
  state?: string;
  pincode: string;
}

export interface BankDetailsDto {
  bankName?: string;
  accountNo?: string;
  ifsc?: string;
  branch?: string;
  upiVpa?: string;
}

export interface CreatePartyDto {
  type: PartyType; // CUSTOMER | SUPPLIER | BOTH | BROKER | JOB_WORKER
  name: string;
  nameGujarati?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
  gstType?: GstRegistrationType;
  stateCode?: string; // 2-digit Indian state code, e.g. "24"
  billingAddress?: PartyAddressDto;
  shippingAddress?: PartyAddressDto;
  creditLimit?: number;
  creditDays?: number;
  interestRate?: number;
  defaultDiscount?: number;
  bankDetails?: BankDetailsDto;
}
