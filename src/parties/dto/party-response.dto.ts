import { toNumber } from "../../common/utils/response.mapper";

export interface PartyListItemDto {
  id: string;
  name: string;
  nameGujarati?: string | null;
  type: string;
  phone: string | null;
  gstin: string | null;
  gstType: string | null;
  stateCode: string | null;
  isActive: boolean;
  billingAddress: any;
  balance: number;
  returnableInvoicesCount?: number;
}

export interface PartyDetailResponseDto extends PartyListItemDto {
  email: string | null;
  contactPerson: string | null;
  pan: string | null;
  creditLimit: number;
  creditDays: number;
  shippingAddress: any;
  notes: Array<{
    id: string;
    title: string | null;
    description: string | null;
    descriptions: string | null;
    createdAt: Date | string;
  }>;
  appointments: Array<{
    id: string;
    title: string | null;
    description: string | null;
    descriptions: string | null;
    date: Date | string;
    status: string | null;
  }>;
}

export function mapPartyListItem(
  p: any,
  balance: number,
  returnableInvoicesCount?: number,
): PartyListItemDto {
  return {
    id: p.id,
    name: p.name,
    ...(p.nameGujarati ? { nameGujarati: p.nameGujarati } : {}),
    type: p.type,
    phone: p.phone ?? null,
    gstin: p.gstin ?? null,
    gstType: p.gstType ?? null,
    stateCode: p.stateCode ?? null,
    isActive: Boolean(p.isActive),
    billingAddress: p.billingAddress ?? null,
    balance,
    ...(returnableInvoicesCount !== undefined
      ? { returnableInvoicesCount }
      : {}),
  };
}

export function mapPartyDetail(
  p: any,
  balance: number,
  notes: any[],
  appointments: any[],
): PartyDetailResponseDto {
  return {
    ...mapPartyListItem(p, balance),
    email: p.email ?? null,
    contactPerson: p.contactPerson ?? null,
    pan: p.pan ?? null,
    creditLimit: toNumber(p.creditLimit),
    creditDays: toNumber(p.creditDays),
    shippingAddress: p.shippingAddress ?? null,
    notes: notes.map((n: any) => ({
      id: n.id,
      title: n.title ?? null,
      description: n.description ?? null,
      descriptions: n.description ?? null,
      createdAt: n.createdAt,
    })),
    appointments: appointments.map((a: any) => ({
      id: a.id,
      title: a.title ?? null,
      description: a.description ?? null,
      descriptions: a.description ?? null,
      date: a.date,
      status: a.status ?? null,
    })),
  };
}
