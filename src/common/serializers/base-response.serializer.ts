import { toNumber } from "../utils/response.mapper";

export interface PartySummaryDto {
  id: string;
  name: string;
  nameGujarati?: string | null;
  phone?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  type?: string;
}

export interface PartyDetailRefDto extends PartySummaryDto {
  email?: string | null;
  gstType?: string | null;
  billingAddress?: any;
  shippingAddress?: any;
}

export interface DocumentRefSummaryDto {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date | string;
  status: string;
  grandTotal: number;
}

export abstract class BaseResponseSerializer<TSource, TTarget> {
  abstract serialize(source: TSource): TTarget;

  serializeMany(sources: TSource[]): TTarget[] {
    return sources.map((source) => this.serialize(source));
  }
}

export function serializePartySummary(party: any): PartySummaryDto | null {
  if (!party) return null;
  return {
    id: party.id,
    name: party.name,
    ...(party.nameGujarati ? { nameGujarati: party.nameGujarati } : {}),
    phone: party.phone ?? null,
    gstin: party.gstin ?? null,
    ...(party.stateCode !== undefined ? { stateCode: party.stateCode ?? null } : {}),
    ...(party.type !== undefined ? { type: party.type } : {}),
  };
}

export function serializePartyDetailRef(party: any): PartyDetailRefDto | null {
  if (!party) return null;
  return {
    id: party.id,
    name: party.name,
    ...(party.nameGujarati ? { nameGujarati: party.nameGujarati } : {}),
    phone: party.phone ?? null,
    email: party.email ?? null,
    gstin: party.gstin ?? null,
    gstType: party.gstType ?? null,
    stateCode: party.stateCode ?? null,
    type: party.type,
    billingAddress: party.billingAddress ?? null,
    shippingAddress: party.shippingAddress ?? null,
  };
}

export function serializeDocumentRef(doc: any): DocumentRefSummaryDto | null {
  if (!doc) return null;
  return {
    id: doc.id,
    invoiceNumber: doc.invoiceNumber,
    invoiceDate: doc.invoiceDate,
    status: doc.status,
    grandTotal: toNumber(doc.grandTotal),
  };
}
