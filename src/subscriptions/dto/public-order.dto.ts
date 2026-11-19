import { SubscriptionTier } from "../../shared-types";

export interface PublicOrderDto {
  tier: SubscriptionTier;
  billingCycle: "monthly" | "yearly";
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}
