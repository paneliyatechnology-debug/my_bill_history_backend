import { PartySummaryDto } from "../../common/serializers/base-response.serializer";
import { toNumber } from "../../common/utils/response.mapper";

export interface PurchaseInvoiceListItemLineDto {
  id: string;
  itemId: string;
  name: string;
  nameGujarati?: string | null;
  hsnCode?: string | null;
  quantity: number;
  returnedQuantity: number;
  remainingQuantity: number;
  isFullyReturned: boolean;
  unitPrice: number;
  taxRate: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
}

export interface PurchaseInvoiceListItemDto {
  id: string;
  vendorInvoiceNumber: string;
  invoiceDate: Date | string;
  dueDate: Date | string | null;
  itcEligibility: string | null;
  taxableAmount: number;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
  party: PartySummaryDto | null;
  returnedAmount?: number;
  netGrandTotal?: number;
  isFullyReturned?: boolean;
  items?: PurchaseInvoiceListItemLineDto[];
  returns?: Array<{
    id: string;
    returnNumber: string;
    grandTotal: number;
  }>;
}

export function computePurchaseReturnSummary(inv: any) {
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

export function mapPurchaseInvoiceListItem(
  inv: any,
  options?: { includeItems?: boolean },
): PurchaseInvoiceListItemDto {
  const { returnedAmount, isFullyReturned, grandTotalNum } =
    computePurchaseReturnSummary(inv);

  const mappedItems: PurchaseInvoiceListItemLineDto[] | undefined =
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
            name: line.item?.name || "",
            ...(line.item?.nameGujarati
              ? { nameGujarati: line.item.nameGujarati }
              : {}),
            hsnCode: line.hsnCode ?? null,
            quantity: originalQty,
            returnedQuantity: returnedQty,
            remainingQuantity: remainingQty,
            isFullyReturned: remainingQty <= 0.0001,
            unitPrice: toNumber(line.unitPrice),
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

  const party: PartySummaryDto | null = inv.party
    ? {
        id: inv.party.id,
        name: inv.party.name,
        ...(inv.party.nameGujarati ? { nameGujarati: inv.party.nameGujarati } : {}),
        ...(inv.party.phone ? { phone: inv.party.phone } : {}),
        ...(inv.party.gstin ? { gstin: inv.party.gstin } : {}),
      }
    : null;

  return {
    id: inv.id,
    vendorInvoiceNumber: inv.vendorInvoiceNumber,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate ?? null,
    itcEligibility: inv.itcEligibility ?? null,
    taxableAmount: toNumber(inv.taxableAmount),
    grandTotal: grandTotalNum,
    paidAmount: toNumber(inv.paidAmount),
    balanceAmount,
    party,
    ...(returnedAmount > 0 ? { returnedAmount, netGrandTotal } : {}),
    ...(isFullyReturned ? { isFullyReturned } : {}),
    ...(mappedItems !== undefined ? { items: mappedItems } : {}),
    ...(options?.includeItems && Array.isArray(inv.returns) && inv.returns.length > 0
      ? {
          returns: inv.returns.map((r: any) => ({
            id: r.id,
            returnNumber: r.returnNumber,
            grandTotal: toNumber(r.grandTotal),
          })),
        }
      : {}),
  };
}
