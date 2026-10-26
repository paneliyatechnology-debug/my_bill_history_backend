import { StockTransactionType } from "@billing/shared-types";

export interface QueryStockTransactionsDto {
  itemId?: string;
  warehouseId?: string;
  transactionType?: StockTransactionType;
  startDate?: string;
  endDate?: string;
  page?: string;
  limit?: string;
}
