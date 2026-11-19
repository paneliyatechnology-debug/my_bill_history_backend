import { SubscriptionTier } from "../../shared-types";

export interface CreateOrderDto {
  tier: SubscriptionTier;
  billingCycle: "monthly" | "yearly";
}
