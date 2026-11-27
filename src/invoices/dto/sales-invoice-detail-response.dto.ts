import {
  DocumentRefSummaryDto,
  PartyDetailRefDto,
  serializeDocumentRef,
  serializePartyDetailRef,
} from "../../common/serializers/base-response.serializer";
import { toNumber } from "../../common/utils/response.mapper";

export interface SalesInvoiceDetailItemDto {
  id: string;
  itemId: string;
  name: string;
  nameGujarati?: string | null;
  sku?: string | null;
  hsnCode?: string | null;
  description?: string | null;
  unit?: string | null;
  quantity: number;
  unitPrice?: number;
  rate: number;
  discountPercent: number;
  discountAmount: number;
  taxRate: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  utgstAmount: number;
  cessAmount: number;
  totalAmount: number;
  batchId?: string | null;
  item?: {
    id: string;
    name: string;
    nameGujarati?: string | null;
    sku?: string | null;
    hsnCode?: string | null;
    unit?: string | null;
  } | null;
}

export interface SalesInvoiceDetailResponseDto {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date | string;
  dueDate: Date | string | null;
  category: string;
  status: string;
  isB2B: boolean;
  placeOfSupply: string | null;
  paymentMode: string | null;
  taxableAmount: number;
  discountTotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  utgstAmount: number;
  cessAmount: number;
  roundOff: number;
  freightAmount: number;
  freight: number;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
  outstandingBalance: number;
  notes: string | null;
  termsAndConditions: string | null;
  billingAddress: any;
  shippingAddress: any;
  party: PartyDetailRefDto | null;
  items: SalesInvoiceDetailItemDto[];
  returns?: Array<{
    id: string;
    returnNumber: string;
    returnDate: string | Date;
    items: Array<{ id: string; salesItemId: string | null; quantity: number }>;
  }>;
  convertedInvoice: DocumentRefSummaryDto | null;
  convertedInvoiceId: string | null;
  sourceQuotation: DocumentRefSummaryDto | null;
  quotationNumber: string | null;
  quotationId: string | null;
  eInvoiceRecord: any | null;
  eWayBillRecord: any | null;
  voucher: {
    id: string;
    voucherNumber: string;
    voucherType: string;
    balanced: boolean;
    journalEntries: Array<{
      id: string;
      accountId: string;
      debitAmount: number;
      creditAmount: number;
      account: { id: string; name: string; code: string | null } | null;
    }>;
  } | null;
  printUrl: string;
  pdfUrl: string;
}

export function mapSalesInvoiceDetail(
  invoice: any,
  extras: {
    finalFreight: number;
    sourceQuotation: any;
    voucher: any;
    returns?: any[];
    printUrl: string;
    pdfUrl: string;
  },
): SalesInvoiceDetailResponseDto {
  const mappedItems: SalesInvoiceDetailItemDto[] = (invoice.items || []).map(
    (line: any) => {
      const unit =
        line.unit ||
        line.item?.primaryUom?.symbol ||
        line.item?.primaryUom?.name ||
        null;
      return {
        id: line.id,
        itemId: line.itemId,
        name: line.item?.name || line.description || "",
        ...(line.item?.nameGujarati
          ? { nameGujarati: line.item.nameGujarati }
          : {}),
        sku: line.item?.sku ?? null,
        hsnCode: line.hsnCode ?? line.item?.hsnCode ?? null,
        description: line.description ?? null,
        unit,
        quantity: toNumber(line.quantity),
        unitPrice: toNumber(line.unitPrice ?? line.rate),
        rate: toNumber(line.unitPrice ?? line.rate),
        discountPercent: toNumber(line.discountPercent),
        discountAmount: toNumber(line.discountAmount),
        taxRate: toNumber(line.taxRate),
        taxableAmount: toNumber(line.taxableAmount),
        cgstAmount: toNumber(line.cgstAmount),
        sgstAmount: toNumber(line.sgstAmount),
        igstAmount: toNumber(line.igstAmount),
        utgstAmount: toNumber(line.utgstAmount),
        cessAmount: toNumber(line.cessAmount),
        totalAmount: toNumber(line.totalAmount),
        ...(line.batchId ? { batchId: line.batchId } : {}),
        item: line.item
          ? {
              id: line.item.id,
              name: line.item.name,
              ...(line.item.nameGujarati
                ? { nameGujarati: line.item.nameGujarati }
                : {}),
              sku: line.item.sku ?? null,
              hsnCode: line.item.hsnCode ?? null,
              unit,
            }
          : null,
      };
    },
  );

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate ?? null,
    category: invoice.category,
    status: invoice.status,
    isB2B: Boolean(invoice.isB2B),
    placeOfSupply: invoice.placeOfSupply ?? null,
    paymentMode: invoice.paymentMode ?? null,
    taxableAmount: toNumber(invoice.taxableAmount),
    discountTotal: toNumber(invoice.discountTotal),
    cgstAmount: toNumber(invoice.cgstAmount),
    sgstAmount: toNumber(invoice.sgstAmount),
    igstAmount: toNumber(invoice.igstAmount),
    utgstAmount: toNumber(invoice.utgstAmount),
    cessAmount: toNumber(invoice.cessAmount),
    roundOff: toNumber(invoice.roundOff),
    freightAmount: extras.finalFreight,
    freight: extras.finalFreight,
    grandTotal: toNumber(invoice.grandTotal),
    paidAmount: toNumber(invoice.paidAmount),
    balanceAmount: toNumber(invoice.balanceAmount),
    outstandingBalance: toNumber(invoice.balanceAmount),
    notes: invoice.notes ?? null,
    termsAndConditions: invoice.termsAndConditions ?? null,
    billingAddress: invoice.billingAddress ?? null,
    shippingAddress: invoice.shippingAddress ?? null,
    party: serializePartyDetailRef(invoice.party),
    items: mappedItems,
    returns: (extras.returns || []).map((r: any) => ({
      id: r.id,
      returnNumber: r.returnNumber,
      returnDate: r.returnDate,
      items: (r.items || []).map((ri: any) => ({
        id: ri.id,
        salesItemId: ri.salesItemId ?? null,
        quantity: toNumber(ri.quantity),
      })),
    })),
    convertedInvoice: serializeDocumentRef(invoice.convertedInvoice),
    convertedInvoiceId: invoice.convertedInvoice?.id ?? invoice.convertedInvoiceId ?? null,
    sourceQuotation: serializeDocumentRef(extras.sourceQuotation),
    quotationNumber: extras.sourceQuotation?.invoiceNumber ?? null,
    quotationId:
      extras.sourceQuotation?.id ?? invoice.quotationId ?? null,
    eInvoiceRecord: invoice.eInvoiceRecord ?? null,
    eWayBillRecord: invoice.eWayBillRecord ?? null,
    voucher: extras.voucher
      ? {
          id: extras.voucher.id,
          voucherNumber: extras.voucher.voucherNumber,
          voucherType: extras.voucher.voucherType,
          balanced: extras.voucher.balanced ?? true,
          journalEntries: (extras.voucher.journalEntries || []).map((j: any) => ({
            id: j.id,
            accountId: j.accountId,
            debitAmount: toNumber(j.debitAmount),
            creditAmount: toNumber(j.creditAmount),
            account: j.account ?? null,
          })),
        }
      : null,
    printUrl: extras.printUrl,
    pdfUrl: extras.pdfUrl,
  };
}
