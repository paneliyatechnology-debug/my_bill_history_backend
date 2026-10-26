import { PartyType, GstRegistrationType } from "@billing/shared-types";
import { PartyAddressDto, BankDetailsDto } from "./create-party.dto";

export interface UpdatePartyDto {
  type?: PartyType;
  name?: string;
  nameGujarati?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
  gstType?: GstRegistrationType;
  stateCode?: string;
  billingAddress?: PartyAddressDto;
  shippingAddress?: PartyAddressDto;
  creditLimit?: number;
  creditDays?: number;
  interestRate?: number;
  defaultDiscount?: number;
  bankDetails?: BankDetailsDto;
  isActive?: boolean;
}

export interface QueryPartiesDto {
  search?: string;
  type?: PartyType;
  isActive?: boolean | string;
  stateCode?: string;
  page?: number | string;
  limit?: number | string;
}
