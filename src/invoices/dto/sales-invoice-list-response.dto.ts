import {
  DocumentRefSummaryDto,
  PartySummaryDto,
  serializeDocumentRef,
} from "../../common/serializers/base-response.serializer";
import { toNumber } from "../../common/utils/response.mapper";

export interface SalesInvoiceListItemLineDto {
  id: string;
  itemId: string;
  name: string;
  hsnCode?: string | null;
  unit?: string | null;
  quantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
  isFullyReturned: boolean;
  rate: number;
  taxRate: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
}

export interface SalesInvoiceListItemDto {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date | string;
  dueDate: Date | string | null;
  category: string;
  status: string;
  isB2B: boolean;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
  party: PartySummaryDto | null;
  returnedAmount?: number;
  netGrandTotal?: number;
  isFullyReturned?: boolean;
  convertedInvoice?: DocumentRefSummaryDto | null;
  sourceQuotation?: DocumentRefSummaryDto | null;
  quotationNumber?: string | null;
  quotationId?: string | null;
  items?: SalesInvoiceListItemLineDto[];
  returns?: Array<{
    id: string;
    returnNumber: string;
    grandTotal: number;
    status: string;
  }>;
}

export function computeSalesInvoiceReturnSummary(inv: any) {
  const returnedAmount = (inv.returns || [])
    .filter((r: any) => r.status !== "CANCELLED")
    .reduce((sum: number, r: any) => sum + toNumber(r.grandTotal), 0);

  let totalOriginalQty = 0;
  let totalReturnedQty = 0;

  if (Array.isArray(inv.items)) {
    for (const line of inv.items) {
      const originalQty = toNumber(line.quantity);
      const returnedQty = (line.returnItems || []).reduce(
        (sum: number, retItem: any) => sum + toNumber(retItem.quantity),
        0,
      );
      totalOriginalQty += originalQty;
      totalReturnedQty += returnedQty;
    }
  }

  const totalRemainingQty = Math.max(0, totalOriginalQty - totalReturnedQty);
  const grandTotalNum = toNumber(inv.grandTotal);
  const isFullyReturned =
    (totalOriginalQty > 0 && totalRemainingQty <= 0.0001) ||
    returnedAmount >= grandTotalNum - 0.01;

  return { returnedAmount, totalRemainingQty, isFullyReturned, grandTotalNum };
}

export function mapSalesInvoiceListItem(
  inv: any,
  options?: { includeItems?: boolean; includeReturns?: boolean },
): SalesInvoiceListItemDto {
  const { returnedAmount, isFullyReturned, grandTotalNum } =
    computeSalesInvoiceReturnSummary(inv);

  const mappedItems: SalesInvoiceListItemLineDto[] | undefined =
    options?.includeItems && Array.isArray(inv.items)
      ? inv.items.map((line: any) => {
          const originalQty = toNumber(line.quantity);
          const returnedQty = (line.returnItems || []).reduce(
            (sum: number, retItem: any) => sum + toNumber(retItem.quantity),
            0,
          );
          const remainingQty = Math.max(0, originalQty - returnedQty);

          return {
            id: line.id,
            itemId: line.itemId,
            name: line.item?.name || line.description || "",
            hsnCode: line.hsnCode ?? line.item?.hsnCode ?? null,
            unit: line.item?.primaryUom?.symbol || line.item?.primaryUom?.name || null,
            quantity: originalQty,
            returnedQuantity: returnedQty,
            remainingQuantity: remainingQty,
            isFullyReturned: remainingQty <= 0.0001,
            rate: toNumber(line.unitPrice ?? line.rate),
            taxRate: toNumber(line.taxRate),
            taxableAmount: toNumber(line.taxableAmount),
            cgstAmount: toNumber(line.cgstAmount),
            sgstAmount: toNumber(line.sgstAmount),
            igstAmount: toNumber(line.igstAmount),
            totalAmount: toNumber(line.totalAmount),
          };
        })
      : undefined;

  const balanceAmount = toNumber(inv.balanceAmount);
  const netGrandTotal = Math.max(0, grandTotalNum - returnedAmount);
  const convertedInvoice = serializeDocumentRef(inv.convertedInvoice);
  const sourceQuotation = serializeDocumentRef(inv.sourceQuotationForInvoice);

  const party: PartySummaryDto | null = inv.party
    ? {
        id: inv.party.id,
        name: inv.party.name,
        ...(inv.party.phone ? { phone: inv.party.phone } : {}),
        ...(inv.party.gstin ? { gstin: inv.party.gstin } : {}),
      }
    : null;

  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate ?? null,
    category: inv.category,
    status: inv.status,
    isB2B: Boolean(inv.isB2B),
    grandTotal: grandTotalNum,
    paidAmount: toNumber(inv.paidAmount),
    balanceAmount,
    party,
    ...(returnedAmount > 0 ? { returnedAmount, netGrandTotal } : {}),
    ...(isFullyReturned ? { isFullyReturned } : {}),
    ...(convertedInvoice ? { convertedInvoice } : {}),
    ...(sourceQuotation
      ? {
          sourceQuotation,
          quotationNumber: sourceQuotation.invoiceNumber,
          quotationId: sourceQuotation.id,
        }
      : inv.quotationId
        ? { quotationId: inv.quotationId }
        : {}),
    ...(mappedItems !== undefined ? { items: mappedItems } : {}),
    ...(options?.includeReturns && Array.isArray(inv.returns) && inv.returns.length > 0
      ? {
          returns: inv.returns.map((r: any) => ({
            id: r.id,
            returnNumber: r.returnNumber,
            grandTotal: toNumber(r.grandTotal),
            status: r.status,
          })),
        }
      : {}),
  };
}
