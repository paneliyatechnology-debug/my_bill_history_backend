import { SubscriptionTier } from "../../shared-types";

export interface VerifyPaymentDto {
  orderId: string;
  paymentId: string;
  signature: string;
  tier: SubscriptionTier;
  billingCycle: "monthly" | "yearly";
}
