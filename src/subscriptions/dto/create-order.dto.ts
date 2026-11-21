import { SubscriptionTier } from "../../shared-types";

export interface CreateOrderDto {
  tier: SubscriptionTier;
  billingCycle: "monthly" | "yearly";
  couponCode?: string;
}

export interface ValidateCouponDto {
  code: string;
  tier: string;
  billingCycle?: "monthly" | "yearly";
  subtotal?: number;
}
