import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import Razorpay from "razorpay";
import { DatabaseService } from "../database/database.service";
import { SessionEventsService } from "../auth/session-events.service";
import { TenantContext, SubscriptionTier, getPlanEntitlements } from "../shared-types";
import { SUBSCRIPTION_PLANS, PlanPricing, TIER_RANKS } from "./subscriptions.constants";
import { CreateOrderDto, ValidateCouponDto } from "./dto/create-order.dto";
import { VerifyPaymentDto } from "./dto/verify-payment.dto";
import { PublicOrderDto } from "./dto/public-order.dto";

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private razorpayInstance: any = null;

  constructor(
    private readonly prisma: DatabaseService,
    private readonly configService: ConfigService,
    private readonly sessionEvents: SessionEventsService,
  ) {
    this.initRazorpay();
  }

  private initRazorpay() {
    const keyId =
      this.configService.get<string>("RAZORPAY_KEY_ID") ||
      process.env.RAZORPAY_KEY_ID ||
      "";
    const keySecret =
      this.configService.get<string>("RAZORPAY_KEY_SECRET") ||
      process.env.RAZORPAY_KEY_SECRET ||
      "";

    if (keyId && keySecret) {
      try {
        const RazorpayClass: any =
          (Razorpay as any)?.default || Razorpay || require("razorpay");
        this.razorpayInstance = new RazorpayClass({
          key_id: keyId,
          key_secret: keySecret,
        });
        this.logger.log(`Razorpay SDK initialized successfully with key: ${keyId.slice(0, 8)}...`);
      } catch (err: any) {
        try {
          const FallbackRazorpay = require("razorpay");
          this.razorpayInstance = new FallbackRazorpay({
            key_id: keyId,
            key_secret: keySecret,
          });
          this.logger.log(`Razorpay SDK initialized via require with key: ${keyId.slice(0, 8)}...`);
        } catch (innerErr: any) {
          this.logger.error(`Failed to initialize Razorpay SDK: ${innerErr?.message}`);
        }
      }
    } else {
      this.logger.warn("Razorpay credentials not fully configured; operating with sandbox simulation fallback.");
    }
  }

  private async getPlanConfig(tier: string): Promise<any> {
    try {
      const found = await this.prisma.executeBypassRls(async (tx) => {
        return tx.subscriptionPlan.findFirst({
          where: {
            OR: [
              { tier: tier?.toUpperCase() },
              { id: tier?.toLowerCase() },
            ],
          },
        });
      });
      if (found) {
        const monthlyPrice = Number(found.monthlyPrice) || 0;
        const yearlyPrice = Number(found.yearlyPrice) || 0;
        const annualTotal = Number(found.annualTotal) || yearlyPrice * 12;
        return {
          ...found,
          monthlyPrice,
          yearlyPrice,
          annualTotal,
          monthlyPaise: found.monthlyPaise || monthlyPrice * 100,
          yearlyPaise: found.yearlyPaise || annualTotal * 100,
        };
      }
    } catch (err: any) {
      this.logger.warn(`Error resolving plan config from database: ${err?.message}`);
    }
    return SUBSCRIPTION_PLANS[tier as SubscriptionTier] || null;
  }

  private async getBypassPlanRestrictions(): Promise<boolean> {
    try {
      const row = await this.prisma.executeBypassRls(async (tx) => {
        return tx.platformSetting.findUnique({
          where: { id: "default" },
        });
      });
      if (row && row.data) {
        return Boolean((row.data as any).bypassPlanRestrictions);
      }
    } catch {}
    return false;
  }

  private async getEntitlementsForTier(tier: string): Promise<Record<string, boolean>> {
    try {
      const found = await this.prisma.executeBypassRls(async (tx) => {
        return tx.subscriptionPlan.findFirst({
          where: {
            OR: [
              { tier: tier?.toUpperCase() },
              { id: tier?.toLowerCase() },
            ],
          },
        });
      });
      if (found && found.entitlements) {
        return found.entitlements as Record<string, boolean>;
      }
    } catch {}
    return {};
  }

  async getPlans(): Promise<any[]> {
    try {
      const dbPlans = await this.prisma.executeBypassRls(async (tx) => {
        return tx.subscriptionPlan.findMany({
          where: {
            isActive: true,
            tier: { not: "TRIAL" },
          },
          orderBy: { monthlyPrice: "asc" },
        });
      });
      if (dbPlans && dbPlans.length > 0) {
        return dbPlans.map((p) => ({
          ...p,
          monthlyPrice: Number(p.monthlyPrice),
          yearlyPrice: Number(p.yearlyPrice),
          annualTotal: Number(p.annualTotal),
        }));
      }
    } catch (e: any) {
      this.logger.warn(`Failed reading subscription plans from database: ${e?.message}`);
    }
    return Object.values(SUBSCRIPTION_PLANS).filter(
      (p) => p.tier !== SubscriptionTier.TRIAL,
    );
  }

  async getCoupons(): Promise<any[]> {
    try {
      return await this.prisma.executeBypassRls(async (tx) => {
        const rows = await tx.coupon.findMany({
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
        });
        return rows.map((c) => ({
          ...c,
          discountValue: Number(c.discountValue),
          minAmount: Number(c.minAmount),
          maxDiscount: Number(c.maxDiscount),
        }));
      });
    } catch (e: any) {
      this.logger.warn(`Failed reading coupons from database: ${e?.message}`);
    }
    return [];
  }

  async recordCouponUsage(code: string) {
    if (!code) return;
    try {
      await this.prisma.executeBypassRls(async (tx) => {
        const c = await tx.coupon.findUnique({
          where: { code: code.toUpperCase().trim() },
        });
        if (c) {
          await tx.coupon.update({
            where: { id: c.id },
            data: {
              usedCount: { increment: 1 },
              updatedAt: new Date(),
            },
          });
        }
      });
    } catch (err: any) {
      this.logger.warn(`Failed updating coupon usage in database: ${err?.message}`);
    }
  }

  async validateCoupon(dto: ValidateCouponDto) {
    const rawCode = (dto.code || "").toUpperCase().trim();
    if (!rawCode) {
      throw new BadRequestException("Please enter a valid coupon code.");
    }

    const coupons = await this.getCoupons();
    const coupon = coupons.find((c: any) => c.code?.toUpperCase() === rawCode);

    if (!coupon) {
      throw new BadRequestException(`Coupon code "${rawCode}" is invalid or does not exist.`);
    }

    if (coupon.isActive === false) {
      throw new BadRequestException(`Coupon code "${rawCode}" has been disabled.`);
    }

    if (coupon.validUntil && new Date(coupon.validUntil).getTime() < Date.now()) {
      throw new BadRequestException(`Coupon code "${rawCode}" has expired.`);
    }

    if (coupon.usageLimit && (coupon.usedCount || 0) >= coupon.usageLimit) {
      throw new BadRequestException(`Coupon code "${rawCode}" has reached its maximum usage limit.`);
    }

    const targetTier = (dto.tier || "").toUpperCase();
    if (
      Array.isArray(coupon.validTiers) &&
      coupon.validTiers.length > 0 &&
      !coupon.validTiers.map((t: string) => t.toUpperCase()).includes(targetTier)
    ) {
      throw new BadRequestException(
        `Coupon "${rawCode}" is not applicable to the ${targetTier} plan. Applicable tiers: ${coupon.validTiers.join(", ")}`,
      );
    }

    const subtotal = Math.max(0, Number(dto.subtotal) || 0);
    if (coupon.minAmount && subtotal > 0 && subtotal < coupon.minAmount) {
      throw new BadRequestException(
        `Minimum order amount of ₹${coupon.minAmount.toLocaleString("en-IN")} required to use "${rawCode}" (Current order: ₹${subtotal.toLocaleString("en-IN")}).`,
      );
    }

    let discountAmount = 0;
    if (coupon.discountType === "PERCENTAGE") {
      discountAmount = Math.round((subtotal * Number(coupon.discountValue || 0)) / 100);
      if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
        discountAmount = coupon.maxDiscount;
      }
    } else {
      discountAmount = Math.min(subtotal, Number(coupon.discountValue || 0));
    }

    // Ensure we don't discount 100% so at least ₹1 is charged for gateway
    if (subtotal > 1 && discountAmount >= subtotal) {
      discountAmount = subtotal - 1;
    }
    if (discountAmount < 0) discountAmount = 0;

    return {
      success: true,
      valid: true,
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discountAmount,
      maxDiscount: coupon.maxDiscount,
      minAmount: coupon.minAmount,
      message:
        coupon.discountType === "PERCENTAGE"
          ? `Coupon ${coupon.code} applied! ${coupon.discountValue}% discount (Saved ₹${discountAmount.toLocaleString("en-IN")}).`
          : `Coupon ${coupon.code} applied! Flat ₹${discountAmount.toLocaleString("en-IN")} discount.`,
    };
  }

  async getCurrentSubscription(ctx: TenantContext) {
    if (!ctx.organizationId) {
      throw new BadRequestException("Organization context is required.");
    }

    return await this.prisma.executeBypassRls(async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: ctx.organizationId },
        include: { tenant: true },
      });

      if (!org || !org.tenant) {
        throw new NotFoundException("Organization or Tenant not found.");
      }

      const tenant = org.tenant;
      const currentTier = tenant.subscriptionTier || SubscriptionTier.TRIAL;
      const planEntitlements = getPlanEntitlements(currentTier);
      const planConfig = await this.getPlanConfig(currentTier);
      const planPricing = planConfig || SUBSCRIPTION_PLANS[currentTier] || SUBSCRIPTION_PLANS[SubscriptionTier.RETAIL_BASIC];

      const currentCompanies = await tx.company.count({
        where: { organizationId: ctx.organizationId },
      });

      const currentYearInvoices = await tx.salesInvoice.count({
        where: {
          organizationId: ctx.organizationId,
          createdAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
        },
      });

      const ends = tenant.subscriptionEnds ? new Date(tenant.subscriptionEnds) : null;
      const isExpired = ends ? ends.getTime() < Date.now() : false;
      const daysRemaining = ends ? Math.ceil((ends.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
      const bypassPlanRestrictions = await this.getBypassPlanRestrictions();
      const isActive = bypassPlanRestrictions || (tenant.isActive && !isExpired);
      const granularEntitlements = await this.getEntitlementsForTier(currentTier);

      return {
        tenantId: tenant.id,
        organizationId: org.id,
        organizationName: org.name,
        currentTier,
        planName: planPricing?.name || planEntitlements.name,
        planNameGujarati: planPricing?.nameGujarati || planEntitlements.nameGujarati,
        subscriptionEnds: tenant.subscriptionEnds,
        isExpired,
        daysRemaining: Math.max(0, daysRemaining),
        isActive,
        maxCompanies: planPricing?.maxCompanies ?? planEntitlements.maxCompanies,
        currentCompanies,
        canAddCompany: bypassPlanRestrictions || currentCompanies < (planPricing?.maxCompanies ?? planEntitlements.maxCompanies),
        maxBranchesPerCompany: planEntitlements.maxBranchesPerCompany,
        maxUsers: planPricing?.maxUsers ?? planEntitlements.maxUsers,
        maxInvoicesPerYear: planPricing?.maxInvoicesPerYear ?? planEntitlements.maxInvoicesPerYear,
        currentInvoices: currentYearInvoices,
        features: planEntitlements.features,
        granularEntitlements,
        bypassPlanRestrictions,
        pricing: planPricing,
      };
    });
  }

  async createPublicOrder(dto: PublicOrderDto) {
    const plan = await this.getPlanConfig(dto.tier);
    if (!plan || dto.tier === SubscriptionTier.TRIAL) {
      throw new BadRequestException(`Invalid subscription tier: ${dto.tier}`);
    }

    // Pre-validate that phone/email is not already registered before accepting payment
    if (dto.customerEmail || dto.customerPhone) {
      const cleanPhone = (dto.customerPhone || "").replace(/\D/g, "");
      const cleanEmail = (dto.customerEmail || "").trim().toLowerCase();

      const conditions: any[] = [];
      if (cleanPhone) conditions.push({ phone: cleanPhone });
      if (cleanEmail) conditions.push({ email: { equals: cleanEmail, mode: "insensitive" } });

      if (conditions.length > 0) {
        const existing = await this.prisma.user.findFirst({
          where: { OR: conditions },
          select: { id: true, email: true, phone: true },
        });

        if (existing) {
          throw new ConflictException({
            statusCode: 409,
            errorCode: "USER_ALREADY_EXISTS",
            message:
              "A user with this phone number or email already exists. Please log in to your account to renew or upgrade your plan.",
            messageGujarati:
              "આ ફોન નંબર અથવા ઈમેલ ધરાવતો એકાઉન્ટ પહેલેથી હાજર છે. પ્લાન અપગ્રેડ કરવા માટે કૃપા કરીને તમારા એકાઉન્ટમાં લોગિન કરો.",
          });
        }
      }
    }

    const billingCycle = dto.billingCycle === "monthly" ? "monthly" : "yearly";
    const amountInPaise = billingCycle === "yearly" ? plan.yearlyPaise : plan.monthlyPaise;
    const amountInRupees = amountInPaise / 100;
    const receiptNo = `MBB-ONB-${Date.now().toString().slice(-8)}`;

    let orderId: string;

    if (this.razorpayInstance) {
      try {
        const rzpOrder = await this.razorpayInstance.orders.create({
          amount: amountInPaise,
          currency: "INR",
          receipt: receiptNo,
          notes: {
            tier: dto.tier,
            billingCycle,
            customerName: dto.customerName || "",
            customerEmail: dto.customerEmail || "",
            customerPhone: dto.customerPhone || "",
            isPreRegistration: "true",
          },
        });
        orderId = rzpOrder.id;
        this.logger.log(`Created Public Razorpay Order: ${orderId} for tier: ${dto.tier} (${billingCycle})`);
      } catch (err: any) {
        this.logger.warn(`Razorpay order API failed (${err?.message}). Falling back to simulation order.`);
        orderId = `order_sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      }
    } else {
      orderId = `order_sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    // Persist pending payment record in DB (tenantId is null until user registers)
    await this.prisma.executeBypassRls(async (tx) => {
      await tx.subscriptionPayment.create({
        data: {
          tenantId: null,
          organizationId: null,
          orderId,
          tier: dto.tier,
          billingCycle,
          amount: amountInRupees,
          currency: "INR",
          status: "PENDING",
          receiptNo,
          notes: {
            planName: plan.name,
            billingCycle,
            customerName: dto.customerName || "",
            customerEmail: dto.customerEmail || "",
            customerPhone: dto.customerPhone || "",
            createdVia: "PUBLIC_PRE_REGISTER_CHECKOUT",
          },
        },
      });
    });

    const keyId =
      this.configService.get<string>("RAZORPAY_KEY_ID") ||
      process.env.RAZORPAY_KEY_ID ||
      "";

    return {
      success: true,
      orderId,
      amount: amountInPaise,
      amountRupees: amountInRupees,
      currency: "INR",
      keyId,
      tier: dto.tier,
      planName: plan.name,
      billingCycle,
      receiptNo,
      customer: {
        name: dto.customerName || "",
        email: dto.customerEmail || "",
        phone: dto.customerPhone || "",
      },
    };
  }

  async createOrder(ctx: TenantContext, dto: CreateOrderDto) {
    if (!ctx.organizationId) {
      throw new BadRequestException("Organization context is required.");
    }

    const plan = await this.getPlanConfig(dto.tier);
    if (!plan || dto.tier === SubscriptionTier.TRIAL) {
      throw new BadRequestException(`Invalid subscription tier: ${dto.tier}`);
    }

    const org = await this.prisma.executeBypassRls(async (tx) => {
      return tx.organization.findUnique({
        where: { id: ctx.organizationId },
        include: { tenant: true },
      });
    });

    if (!org || !org.tenant) {
      throw new NotFoundException("Organization or Tenant not found.");
    }

    const tenant = org.tenant;
    const currentTier = (tenant.subscriptionTier || SubscriptionTier.TRIAL) as SubscriptionTier;
    const ends = tenant.subscriptionEnds ? new Date(tenant.subscriptionEnds) : null;
    const isExpired = ends ? ends.getTime() < Date.now() : true;
    const daysRemaining = ends && !isExpired ? Math.ceil((ends.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;

    const currentRank = TIER_RANKS[currentTier] ?? 0;
    const targetRank = TIER_RANKS[dto.tier] ?? 0;

    // 1. Prevent Downgrade during active subscription period
    if (!isExpired && daysRemaining > 0 && targetRank < currentRank) {
      throw new BadRequestException(
        `Downgrading from ${currentTier} to ${dto.tier} is not permitted during an active subscription period (${daysRemaining} days remaining). You may switch plans after your current billing period ends.`,
      );
    }

    // 2. Industry Standard Proration: calculate unused credit when upgrading mid-cycle
    const billingCycle = dto.billingCycle === "monthly" ? "monthly" : "yearly";
    const targetPlanBasePaise = billingCycle === "yearly" ? plan.yearlyPaise : plan.monthlyPaise;
    let unusedCreditPaise = 0;
    const isUpgrade = !isExpired && daysRemaining > 0 && targetRank > currentRank && currentTier !== SubscriptionTier.TRIAL;
    const isRenewal = targetRank === currentRank;

    if (isUpgrade) {
      const currentPlanConfig = await this.getPlanConfig(currentTier);
      const currentCyclePaise = currentPlanConfig
        ? (billingCycle === "yearly" ? (currentPlanConfig.yearlyPaise || (currentPlanConfig.annualTotal * 100)) : (currentPlanConfig.monthlyPaise || (currentPlanConfig.monthlyPrice * 100)))
        : 0;

      const totalDaysInCycle = billingCycle === "yearly" ? 365 : 30;
      const dailyRatePaise = currentCyclePaise > 0 ? (currentCyclePaise / totalDaysInCycle) : 0;
      unusedCreditPaise = Math.round(dailyRatePaise * daysRemaining);

      // Protect against over-crediting
      if (unusedCreditPaise >= targetPlanBasePaise) {
        unusedCreditPaise = targetPlanBasePaise - 100; // minimum ₹1 (100 paise) charge
      }
      if (unusedCreditPaise < 0) unusedCreditPaise = 0;
    }

    const priceAfterProrationPaise = Math.max(100, targetPlanBasePaise - unusedCreditPaise);
    let couponDiscountPaise = 0;
    let validatedCoupon: any = null;

    if (dto.couponCode) {
      const subtotalRupees = priceAfterProrationPaise / 100;
      validatedCoupon = this.validateCoupon({
        code: dto.couponCode,
        tier: dto.tier,
        billingCycle,
        subtotal: subtotalRupees,
      });

      if (validatedCoupon && validatedCoupon.valid) {
        couponDiscountPaise = Math.round(validatedCoupon.discountAmount * 100);
        if (priceAfterProrationPaise - couponDiscountPaise < 100) {
          couponDiscountPaise = priceAfterProrationPaise - 100; // minimum ₹1 (100 paise) charge
        }
        if (couponDiscountPaise < 0) couponDiscountPaise = 0;
      }
    }

    const finalAmountInPaise = Math.max(100, priceAfterProrationPaise - couponDiscountPaise);
    const amountInRupees = finalAmountInPaise / 100;

    const tenantShortId = tenant.id.replace(/-/g, "").slice(0, 6).toUpperCase();
    const receiptNo = `MBB-REC-${tenantShortId}-${Date.now().toString().slice(-6)}`;

    let orderId: string;

    if (this.razorpayInstance) {
      try {
        const rzpOrder = await this.razorpayInstance.orders.create({
          amount: finalAmountInPaise,
          currency: "INR",
          receipt: receiptNo,
          notes: {
            tenantId: tenant.id,
            organizationId: org.id,
            tier: dto.tier,
            billingCycle,
            isUpgrade: String(isUpgrade),
            isRenewal: String(isRenewal),
            previousTier: currentTier,
            daysRemaining: String(daysRemaining),
            originalAmountPaise: String(targetPlanBasePaise),
            unusedCreditPaise: String(unusedCreditPaise),
            couponCode: dto.couponCode ? String(dto.couponCode).toUpperCase().trim() : "",
            couponDiscountPaise: String(couponDiscountPaise),
          },
        });
        orderId = rzpOrder.id;
        this.logger.log(`Created Razorpay Order: ${orderId} for tier: ${dto.tier} (${billingCycle}). Net: ₹${amountInRupees} (Credit: ₹${unusedCreditPaise / 100}, Coupon: ₹${couponDiscountPaise / 100})`);
      } catch (err: any) {
        this.logger.warn(`Razorpay order API failed (${err?.message}). Falling back to simulation order.`);
        orderId = `order_sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      }
    } else {
      orderId = `order_sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    // Persist pending payment record in DB
    await this.prisma.executeBypassRls(async (tx) => {
      await tx.subscriptionPayment.create({
        data: {
          tenantId: tenant.id,
          organizationId: org.id,
          orderId,
          tier: dto.tier,
          billingCycle,
          amount: amountInRupees,
          currency: "INR",
          status: "PENDING",
          receiptNo,
          notes: {
            planName: plan.name,
            billingCycle,
            isUpgrade,
            isRenewal,
            previousTier: currentTier,
            daysRemaining,
            originalPriceRupees: targetPlanBasePaise / 100,
            unusedCreditRupees: unusedCreditPaise / 100,
            couponCode: dto.couponCode ? String(dto.couponCode).toUpperCase().trim() : null,
            couponDiscountRupees: couponDiscountPaise / 100,
            netPayableRupees: amountInRupees,
            createdVia: "WEB_CHECKOUT",
          },
        },
      });
    });

    const keyId =
      this.configService.get<string>("RAZORPAY_KEY_ID") ||
      process.env.RAZORPAY_KEY_ID ||
      "";

    return {
      success: true,
      orderId,
      amount: finalAmountInPaise,
      amountRupees: amountInRupees,
      originalAmountPaise: targetPlanBasePaise,
      originalAmountRupees: targetPlanBasePaise / 100,
      unusedCreditPaise,
      unusedCreditRupees: unusedCreditPaise / 100,
      couponCode: dto.couponCode ? String(dto.couponCode).toUpperCase().trim() : null,
      couponDiscountRupees: couponDiscountPaise / 100,
      daysRemaining,
      isUpgrade,
      isRenewal,
      currentTier,
      currency: "INR",
      keyId,
      tier: dto.tier,
      planName: plan.name,
      billingCycle,
      receiptNo,
      customer: {
        name: org.name,
        email: tenant.primaryEmail || "",
        phone: tenant.primaryPhone || "",
      },
    };
  }

  async verifyPayment(ctx: TenantContext, dto: VerifyPaymentDto) {
    if (!ctx.organizationId) {
      throw new BadRequestException("Organization context is required.");
    }

    const { orderId, paymentId, signature, tier, billingCycle } = dto;
    const plan = (await this.getPlanConfig(tier)) || SUBSCRIPTION_PLANS[tier as SubscriptionTier];
    if (!plan) {
      throw new BadRequestException(`Invalid subscription tier: ${tier}`);
    }

    // Cryptographic signature verification
    const keySecret =
      this.configService.get<string>("RAZORPAY_KEY_SECRET") ||
      process.env.RAZORPAY_KEY_SECRET ||
      "";

    const isSimulatedOrder = orderId.startsWith("order_sim_") || paymentId.startsWith("pay_sim_");

    if (!isSimulatedOrder && keySecret) {
      const generatedSignature = crypto
        .createHmac("sha256", keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");

      if (generatedSignature !== signature) {
        this.logger.error(`Signature verification failed for order: ${orderId}, payment: ${paymentId}`);
        throw new BadRequestException("Razorpay payment signature verification failed.");
      }
    }

    return await this.prisma.executeBypassRls(async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: ctx.organizationId },
        include: { tenant: true },
      });

      if (!org || !org.tenant) {
        throw new NotFoundException("Organization or Tenant not found.");
      }

      const tenant = org.tenant;
      const currentTier = (tenant.subscriptionTier || SubscriptionTier.TRIAL) as SubscriptionTier;
      const currentRank = TIER_RANKS[currentTier] ?? 0;
      const targetRank = TIER_RANKS[tier as SubscriptionTier] ?? 0;
      const isUpgrade = targetRank > currentRank;

      const daysToAdd = billingCycle === "yearly" ? 365 : 30;
      let newSubscriptionEnds: Date;

      if (isUpgrade) {
        // Upgrading with prorated credit starts fresh full period from today
        newSubscriptionEnds = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);
      } else {
        // Renewal extends existing end date if active, or starts from today
        const currentEnds = tenant.subscriptionEnds ? new Date(tenant.subscriptionEnds) : new Date();
        const baseDate = currentEnds.getTime() > Date.now() ? currentEnds : new Date();
        newSubscriptionEnds = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      }

      // Update or create payment record
      const existingPayment = await tx.subscriptionPayment.findUnique({
        where: { orderId },
      });

      if (existingPayment) {
        await tx.subscriptionPayment.update({
          where: { orderId },
          data: {
            paymentId,
            signature,
            status: "CAPTURED",
            paidAt: new Date(),
            tier,
            billingCycle,
          },
        });
        const couponUsed = (existingPayment.notes as any)?.couponCode;
        if (couponUsed) {
          await this.recordCouponUsage(couponUsed);
        }
      } else {
        const amountPaise = billingCycle === "yearly" ? plan.yearlyPaise : plan.monthlyPaise;
        await tx.subscriptionPayment.create({
          data: {
            tenantId: tenant.id,
            organizationId: org.id,
            orderId,
            paymentId,
            signature,
            tier,
            billingCycle,
            amount: amountPaise / 100,
            currency: "INR",
            status: "CAPTURED",
            receiptNo: `MBB-REC-${orderId.slice(-6)}`,
            paidAt: new Date(),
          },
        });
      }

      // Upgrade tenant subscription tier and validity
      const updatedTenant = await tx.tenant.update({
        where: { id: tenant.id },
        data: {
          subscriptionTier: tier,
          subscriptionEnds: newSubscriptionEnds,
          isActive: true,
        },
      });

      // Emit real-time session update to client tabs
      this.sessionEvents.emitAccessState({
        tenantId: updatedTenant.id,
        organizationId: org.id,
        isSuspended: false,
        subscriptionEnds: updatedTenant.subscriptionEnds,
        tier: updatedTenant.subscriptionTier,
      });

      this.logger.log(`Subscription successfully assigned: Tenant ${tenant.id} -> ${tier} until ${newSubscriptionEnds.toISOString()}`);

      const planEntitlements = getPlanEntitlements(updatedTenant.subscriptionTier);

      return {
        success: true,
        message: `Plan successfully upgraded to ${plan.name}! All tier features and limits unlocked.`,
        subscription: {
          tier: updatedTenant.subscriptionTier,
          planName: plan.name,
          planNameGujarati: plan.nameGujarati,
          subscriptionEnds: updatedTenant.subscriptionEnds,
          daysRemaining: Math.ceil((newSubscriptionEnds.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
          isActive: true,
          maxCompanies: planEntitlements.maxCompanies,
          features: planEntitlements.features,
        },
      };
    });
  }

  async getBillingHistory(ctx: TenantContext) {
    if (!ctx.organizationId) {
      throw new BadRequestException("Organization context is required.");
    }

    return await this.prisma.executeBypassRls(async (tx) => {
      const org = await tx.organization.findUnique({
        where: { id: ctx.organizationId },
        include: {
          tenant: {
            include: {
              subscriptionPayments: {
                orderBy: { createdAt: "desc" },
              },
            },
          },
        },
      });

      if (!org || !org.tenant) {
        throw new NotFoundException("Organization or Tenant not found.");
      }

      const company = await tx.company.findFirst({
        where: { organizationId: org.id },
        orderBy: { createdAt: "asc" },
      });

      const billedBy = {
        name: "myBillBook Technologies Private Limited",
        tradeName: "myBillBook Billing & ERP Services",
        gstin: "24AABCM9124P1ZX",
        sacCode: "998314",
        address: "402, Titanium City Centre, Satellite, Ahmedabad, Gujarat - 380015",
        supportEmail: "support@myownbillbook.com",
        supportPhone: "+91 82388 78965",
      };

      const payments = org.tenant.subscriptionPayments;

      const items = payments.map((p) => {
        const totalAmount = Number(p.amount);
        const taxable = Math.round((totalAmount / 1.18) * 100) / 100;
        const cgst = Math.round(((totalAmount - taxable) / 2) * 100) / 100;
        const sgst = Math.round((totalAmount - taxable - cgst) * 100) / 100;
        const plan = SUBSCRIPTION_PLANS[p.tier] || SUBSCRIPTION_PLANS[SubscriptionTier.RETAIL_BASIC];

        return {
          id: p.id,
          orderId: p.orderId,
          paymentId: p.paymentId || "N/A",
          receiptNo: p.receiptNo,
          planName: plan?.name || `${p.tier} Plan`,
          tier: p.tier,
          billingCycle: p.billingCycle,
          date: p.paidAt || p.createdAt,
          displayDate: new Date(p.paidAt || p.createdAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
          status: p.status,
          amount: totalAmount,
          formattedAmount: `₹ ${totalAmount.toLocaleString("en-IN")}`,
          taxableAmount: taxable,
          cgst,
          sgst,
          igst: 0,
          paymentMode: "Razorpay (Cards / UPI / NetBanking)",
          organizationName: org.name,
          companyName: company?.tradeName || company?.legalName || org.name,
          gstin: company?.gstin || "Unregistered",
          customerPhone: org.tenant.primaryPhone || company?.phone,
          customerEmail: org.tenant.primaryEmail || company?.email,
          billedBy,
        };
      });

      // Include free trial receipt if no captured payments yet
      if (items.length === 0) {
        const trialEnds = new Date(org.tenant.createdAt.getTime() + 14 * 24 * 60 * 60 * 1000);
        items.push({
          id: `TR-${org.tenant.id.slice(0, 8)}`,
          orderId: `order_trial_${org.tenant.id.slice(0, 8)}`,
          paymentId: "FREE_TRIAL",
          receiptNo: `MBB-TR-${org.tenant.id.slice(0, 6).toUpperCase()}`,
          planName: "Trial Plan (14 Days Free Access)",
          tier: SubscriptionTier.TRIAL,
          billingCycle: "trial",
          date: org.tenant.createdAt,
          displayDate: new Date(org.tenant.createdAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
          status: "CAPTURED",
          amount: 0,
          formattedAmount: "₹ 0",
          taxableAmount: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          paymentMode: "Free Trial Onboarding",
          organizationName: org.name,
          companyName: company?.tradeName || company?.legalName || org.name,
          gstin: company?.gstin || "Unregistered",
          customerPhone: org.tenant.primaryPhone || company?.phone,
          customerEmail: org.tenant.primaryEmail || company?.email,
          billedBy,
        });
      }

      return {
        tenantId: org.tenant.id,
        currentTier: org.tenant.subscriptionTier,
        subscriptionEnds: org.tenant.subscriptionEnds,
        items,
        history: items,
      };
    });
  }

  async handleWebhook(body: any, signature: string) {
    const webhookSecret =
      this.configService.get<string>("RAZORPAY_WEBHOOK_SECRET") ||
      process.env.RAZORPAY_WEBHOOK_SECRET ||
      "";

    if (webhookSecret && signature) {
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(JSON.stringify(body))
        .digest("hex");

      if (expectedSignature !== signature) {
        throw new UnauthorizedException("Invalid webhook signature.");
      }
    }

    const event = body.event;
    this.logger.log(`Received Razorpay webhook event: ${event}`);

    if (event === "payment.captured" || event === "order.paid") {
      const paymentEntity = body.payload?.payment?.entity;
      const orderId = paymentEntity?.order_id;
      const paymentId = paymentEntity?.id;

      if (orderId && paymentId) {
        await this.prisma.executeBypassRls(async (tx) => {
          const payment = await tx.subscriptionPayment.findUnique({
            where: { orderId },
          });

          if (payment && payment.status !== "CAPTURED") {
            const daysToAdd = payment.billingCycle === "monthly" ? 30 : 365;
            const newEnds = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000);

            await tx.subscriptionPayment.update({
              where: { orderId },
              data: {
                paymentId,
                status: "CAPTURED",
                paidAt: new Date(),
              },
            });

            await tx.tenant.update({
              where: { id: payment.tenantId },
              data: {
                subscriptionTier: payment.tier,
                subscriptionEnds: newEnds,
                isActive: true,
              },
            });

            this.logger.log(`Webhook captured payment ${paymentId} for order ${orderId}, upgraded tenant ${payment.tenantId}`);
          }
        });
      }
    }

    return { status: "ok" };
  }
}
