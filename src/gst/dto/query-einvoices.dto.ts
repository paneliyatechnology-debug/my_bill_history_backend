export class QueryEInvoicesDto {
  page?: string | number;
  limit?: string | number;
  search?: string;
  status?: string;
  documentType?: string;
  fromDate?: string;
  toDate?: string;
  partyId?: string;
}

