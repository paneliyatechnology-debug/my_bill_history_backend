export interface CreateProductionOrderDto {
  bomId: string;
  orderNumber?: string;
  targetQuantity: number;
  startDate?: string;
  idempotencyKey?: string;
}
