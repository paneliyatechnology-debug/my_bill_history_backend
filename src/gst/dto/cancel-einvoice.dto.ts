export class CancelEInvoiceDto {
  reasonCode!: string; // "1": Duplicate, "2": Data entry mistake, "3": Order Cancelled, "4": Others
  remarks!: string;
}

