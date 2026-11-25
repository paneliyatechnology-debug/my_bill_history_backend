import {
  PartyDetailRefDto,
  serializePartyDetailRef,
} from "../../common/serializers/base-response.serializer";
import { toNumber } from "../../common/utils/response.mapper";

export interface PurchaseInvoiceDetailItemDto {
  id: string;
  itemId: string;
  name: string;
  nameGujarati?: string | null;
  sku?: string | null;
  hsnCode?: string | null;
  unit?: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  discountAmount: number;
  taxRate: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  item?: {
    id: string;
    name: string;
    nameGujarati?: string | null;
    sku?: string | null;
    hsnCode?: string | null;
  } | null;
}

export interface PurchaseInvoiceDetailResponseDto {
  id: string;
  vendorInvoiceNumber: string;
  invoiceDate: Date | string;
  dueDate: Date | string | null;
  placeOfSupply: string | null;
  itcEligibility: string | null;
  notes: string | null;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  roundOff: number;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
  party: PartyDetailRefDto | null;
  items: PurchaseInvoiceDetailItemDto[];
  returns: Array<{
    id: string;
    returnNumber: string;
    returnDate: Date | string;
    grandTotal: number;
    items: Array<{
      id: string;
      itemId: string;
      name: string;
      quantity: number;
      totalAmount: number;
    }>;
  }>;
}

export function mapPurchaseInvoiceDetail(
  invoice: any,
): PurchaseInvoiceDetailResponseDto {
  return {
    id: invoice.id,
    vendorInvoiceNumber: invoice.vendorInvoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate ?? null,
    placeOfSupply: invoice.placeOfSupply ?? null,
    itcEligibility: invoice.itcEligibility ?? null,
    notes: invoice.notes ?? null,
    taxableAmount: toNumber(invoice.taxableAmount),
    cgstAmount: toNumber(invoice.cgstAmount),
    sgstAmount: toNumber(invoice.sgstAmount),
    igstAmount: toNumber(invoice.igstAmount),
    roundOff: toNumber(invoice.roundOff),
    grandTotal: toNumber(invoice.grandTotal),
    paidAmount: toNumber(invoice.paidAmount),
    balanceAmount: toNumber(invoice.balanceAmount),
    party: serializePartyDetailRef(invoice.party),
    items: (invoice.items || []).map((line: any) => ({
      id: line.id,
      itemId: line.itemId,
      name: line.item?.name || "",
      ...(line.item?.nameGujarati
        ? { nameGujarati: line.item.nameGujarati }
        : {}),
      sku: line.item?.sku ?? null,
      hsnCode: line.hsnCode ?? line.item?.hsnCode ?? null,
      unit:
        line.item?.primaryUom?.symbol ||
        line.item?.primaryUom?.name ||
        null,
      quantity: toNumber(line.quantity),
      unitPrice: toNumber(line.unitPrice),
      discountPercent: toNumber(line.discountPercent),
      discountAmount: toNumber(line.discountAmount),
      taxRate: toNumber(line.taxRate),
      taxableAmount: toNumber(line.taxableAmount),
      cgstAmount: toNumber(line.cgstAmount),
      sgstAmount: toNumber(line.sgstAmount),
      igstAmount: toNumber(line.igstAmount),
      totalAmount: toNumber(line.totalAmount),
      item: line.item
        ? {
            id: line.item.id,
            name: line.item.name,
            ...(line.item.nameGujarati
              ? { nameGujarati: line.item.nameGujarati }
              : {}),
            sku: line.item.sku ?? null,
            hsnCode: line.item.hsnCode ?? null,
          }
        : null,
    })),
    returns: (invoice.returns || []).map((ret: any) => ({
      id: ret.id,
      returnNumber: ret.returnNumber,
      returnDate: ret.returnDate,
      grandTotal: toNumber(ret.grandTotal),
      items: (ret.items || []).map((ri: any) => ({
        id: ri.id,
        itemId: ri.itemId,
        name: ri.item?.name || "",
        quantity: toNumber(ri.quantity),
        totalAmount: toNumber(ri.totalAmount),
      })),
    })),
  };
}
