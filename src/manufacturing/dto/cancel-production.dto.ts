export interface CancelProductionDto {
  reason?: string;
  idempotencyKey?: string;
}
