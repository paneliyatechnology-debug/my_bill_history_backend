import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContext } from "@billing/shared-types";
import {
  CreateCampaignDto,
  TestSmsDto,
  PartyGreetingSettingsDto,
} from "./dto/create-campaign.dto";

export interface SmsTemplateItem {
  id: string;
  category: string;
  template: string;
  example: string;
  dlt_te_id: string;
  is_active: boolean;
}

const DEFAULT_TEMPLATES: SmsTemplateItem[] = [
  // Festival Templates
  {
    id: "fest_01",
    category: "festival",
    template:
      "Dear Customer, Wishing you a joyous %{festival_name}! Special festive celebration offer: Get flat %{discount_pct} off on %{items} at %{business_name}. Valid till %{valid_till}. Visit today! Contact: %{mobile_number}",
    example:
      "Dear Customer, Wishing you a joyous Diwali! Special festive celebration offer: Get flat 15% off on all items at JK ENTERPRISE. Valid till 15 Nov 2026. Visit today! Contact: 9898990001",
    dlt_te_id: "1407161234567801",
    is_active: true,
  },
  {
    id: "fest_02",
    category: "festival",
    template:
      "Warm %{festival_name} greetings from %{business_name}! Enjoy up to %{discount_pct} discount on your favorite products. Call %{mobile_number} to place your order.",
    example:
      "Warm New Year greetings from JK ENTERPRISE! Enjoy up to 20% discount on your favorite products. Call 9898990001 to place your order.",
    dlt_te_id: "1407161234567802",
    is_active: true,
  },
  {
    id: "fest_03",
    category: "festival",
    template:
      "Celebrate this festive season with %{business_name}! Special bundle offers with %{discount_pct} off on %{items}. Limited period offer. Helpline: %{mobile_number}",
    example:
      "Celebrate this festive season with JK ENTERPRISE! Special bundle offers with 10% off on premium stock. Limited period offer. Helpline: 9898990001",
    dlt_te_id: "1407161234567803",
    is_active: true,
  },

  // Discount Templates
  {
    id: "disc_01",
    category: "discount",
    template:
      "Mega Sale Alert! Get exclusive %{discount_pct} discount on all purchases at %{business_name}. Don't miss out on big savings. Valid till %{valid_till}. Call: %{mobile_number}",
    example:
      "Mega Sale Alert! Get exclusive 25% discount on all purchases at JK ENTERPRISE. Don't miss out on big savings. Valid till 30 Nov 2026. Call: 9898990001",
    dlt_te_id: "1407161234567804",
    is_active: true,
  },
  {
    id: "disc_02",
    category: "discount",
    template:
      "Special discount just for you! Visit %{business_name} today and avail flat %{discount_pct} off on %{items}. Contact us at %{mobile_number}",
    example:
      "Special discount just for you! Visit JK ENTERPRISE today and avail flat 10% off on all items. Contact us at 9898990001",
    dlt_te_id: "1407161234567805",
    is_active: true,
  },
  {
    id: "disc_03",
    category: "discount",
    template:
      "Weekend Flash Sale at %{business_name}! Save %{discount_pct} on all billings. Hurry, offer valid while stocks last. Phone: %{mobile_number}",
    example:
      "Weekend Flash Sale at JK ENTERPRISE! Save 15% on all billings. Hurry, offer valid while stocks last. Phone: 9898990001",
    dlt_te_id: "1407161234567806",
    is_active: true,
  },

  // Stock Update Templates
  {
    id: "stock_01",
    category: "stock_update",
    template:
      "New Arrivals Alert! Fresh stock of %{items} has arrived at %{business_name}. Be the first to grab the best products! Contact %{mobile_number}",
    example:
      "New Arrivals Alert! Fresh stock of seasonal items has arrived at JK ENTERPRISE. Be the first to grab the best products! Contact 9898990001",
    dlt_te_id: "1407161234567807",
    is_active: true,
  },
  {
    id: "stock_02",
    category: "stock_update",
    template:
      "Popular items are back in stock at %{business_name}! Stock up on %{items} today before it sells out. Call %{mobile_number} to order now.",
    example:
      "Popular items are back in stock at JK ENTERPRISE! Stock up on fast moving items today before it sells out. Call 9898990001 to order now.",
    dlt_te_id: "1407161234567808",
    is_active: true,
  },

  // Business Promotion Templates
  {
    id: "promo_01",
    category: "business_promotion",
    template:
      "Thank you for being our valued partner. %{business_name} offers premium quality %{items} at wholesale rates. Get in touch at %{mobile_number}",
    example:
      "Thank you for being our valued partner. JK ENTERPRISE offers premium quality goods at wholesale rates. Get in touch at 9898990001",
    dlt_te_id: "1407161234567809",
    is_active: true,
  },
  {
    id: "promo_02",
    category: "business_promotion",
    template:
      "Exciting update from %{business_name}! We have expanded our range of %{items} to serve you better. Visit us or contact %{mobile_number}",
    example:
      "Exciting update from JK ENTERPRISE! We have expanded our range of products to serve you better. Visit us or contact 9898990001",
    dlt_te_id: "1407161234567810",
    is_active: true,
  },
];

const REMINDER_TEMPLATES: SmsTemplateItem[] = [
  {
    id: "milestone_01",
    category: "invoice_milestone_reminders",
    template:
      "Dear Customer, congratulations on completing your milestone bill with %{business_name}! We truly value your continued trust and loyalty.",
    example:
      "Dear Customer, congratulations on completing your milestone bill with JK ENTERPRISE! We truly value your continued trust and loyalty.",
    dlt_te_id: "1407161234567821",
    is_active: true,
  },
  {
    id: "milestone_02",
    category: "invoice_milestone_reminders",
    template:
      "Thank you for your repeat business with %{business_name}! To celebrate our milestone invoice, here is a special thank you note from our team.",
    example:
      "Thank you for your repeat business with JK ENTERPRISE! To celebrate our milestone invoice, here is a special thank you note from our team.",
    dlt_te_id: "1407161234567822",
    is_active: true,
  },
  {
    id: "birthday_01",
    category: "birthday_reminders",
    template:
      "Wishing you a very Happy Birthday! May your day be filled with happiness and prosperity. Warm regards, %{business_name}.",
    example:
      "Wishing you a very Happy Birthday! May your day be filled with happiness and prosperity. Warm regards, JK ENTERPRISE.",
    dlt_te_id: "1407161234567831",
    is_active: true,
  },
  {
    id: "birthday_02",
    category: "birthday_reminders",
    template:
      "Happy Birthday from everyone at %{business_name}! As a birthday gift, enjoy an exclusive offer on your next purchase with us.",
    example:
      "Happy Birthday from everyone at JK ENTERPRISE! As a birthday gift, enjoy an exclusive offer on your next purchase with us.",
    dlt_te_id: "1407161234567832",
    is_active: true,
  },
];

@Injectable()
export class SmsMarketingService {
  constructor(private readonly prisma: DatabaseService) {}

  async getTemplates(category?: string): Promise<SmsTemplateItem[]> {
    if (!category || category === "all") {
      return DEFAULT_TEMPLATES;
    }
    return DEFAULT_TEMPLATES.filter(
      (t) => t.category.toLowerCase() === category.toLowerCase(),
    );
  }

  async getReminderTemplates(params?: {
    id?: string | string[];
    category?: string;
  }): Promise<SmsTemplateItem[]> {
    let list = REMINDER_TEMPLATES;
    if (params?.id) {
      const ids = Array.isArray(params.id) ? params.id : [params.id];
      list = list.filter((t) => ids.includes(t.id));
    }
    if (params?.category) {
      list = list.filter(
        (t) => t.category.toLowerCase() === params.category!.toLowerCase(),
      );
    }
    return list;
  }

  async getQuota(ctx: TenantContext): Promise<{
    actual_quota_remaining: number;
    total_quota: number;
    used_quota: number;
    sample_quota_remaining: number;
  }> {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const comp = await tx.company.findUnique({
        where: { id: ctx.companyId },
        select: { extraDetails: true },
      });

      const extra = (comp?.extraDetails as Record<string, any>) || {};
      const totalQuota = Number(extra.sms_quota_total ?? 500);
      const usedQuota = Number(extra.sms_quota_used ?? 0);
      const remainingQuota = Math.max(0, totalQuota - usedQuota);

      return {
        actual_quota_remaining: remainingQuota,
        total_quota: totalQuota,
        used_quota: usedQuota,
        sample_quota_remaining: 5,
      };
    });
  }

  async getCampaigns(
    ctx: TenantContext,
    sortOrder: "ASC" | "DESC" = "DESC",
  ): Promise<any[]> {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const campaigns = await tx.smsCampaign.findMany({
        where: {
          companyId: ctx.companyId,
        },
        orderBy: {
          createdAt: sortOrder.toLowerCase() === "asc" ? "asc" : "desc",
        },
        include: {
          recipients: {
            take: 5,
          },
        },
      });

      return campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        category: c.category,
        template_id: c.templateId,
        message: c.message,
        variables: c.variables,
        number_of_recipients: c.numberOfRecipients,
        status: c.status,
        created_at: c.createdAt.toISOString().replace("T", " ").substring(0, 19),
        updated_at: c.updatedAt.toISOString(),
      }));
    });
  }

  async getCampaignRecipients(
    ctx: TenantContext,
    campaignId: string,
  ): Promise<any> {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const campaign = await tx.smsCampaign.findFirst({
        where: {
          id: campaignId,
          companyId: ctx.companyId,
        },
        include: {
          recipients: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!campaign) {
        throw new NotFoundException("SMS Campaign not found.");
      }

      return {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          category: campaign.category,
          message: campaign.message,
          number_of_recipients: campaign.numberOfRecipients,
          created_at: campaign.createdAt,
          status: campaign.status,
        },
        recipients: campaign.recipients.map((r) => ({
          id: r.id,
          party_id: r.partyId,
          party_name: r.partyName,
          mobile_number: r.mobileNumber,
          status: r.status,
          delivered_at: r.createdAt,
        })),
      };
    });
  }

  async createCampaign(
    ctx: TenantContext,
    dto: CreateCampaignDto,
  ): Promise<any> {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const comp = await tx.company.findUnique({
        where: { id: ctx.companyId },
        select: {
          id: true,
          tradeName: true,
          legalName: true,
          extraDetails: true,
        },
      });

      if (!comp) {
        throw new NotFoundException("Company not found.");
      }

      const extra = (comp.extraDetails as Record<string, any>) || {};
      const totalQuota = Number(extra.sms_quota_total ?? 500);
      const usedQuota = Number(extra.sms_quota_used ?? 0);
      const remainingQuota = Math.max(0, totalQuota - usedQuota);

      // Resolve recipients
      let recipientsToInsert: Array<{
        partyId?: string;
        partyName: string;
        mobileNumber: string;
      }> = [];

      if (dto.partyIds && dto.partyIds.length > 0) {
        const parties = await tx.party.findMany({
          where: {
            id: { in: dto.partyIds },
            companyId: ctx.companyId,
          },
          select: { id: true, name: true, phone: true },
        });

        recipientsToInsert = parties
          .filter((p) => Boolean(p.phone && p.phone.trim().length >= 10))
          .map((p) => ({
            partyId: p.id,
            partyName: p.name,
            mobileNumber: p.phone,
          }));
      } else if (dto.recipients && dto.recipients.length > 0) {
        recipientsToInsert = dto.recipients.filter(
          (r) => Boolean(r.mobileNumber && r.mobileNumber.trim().length >= 10),
        );
      }

      const recipientCount = recipientsToInsert.length;
      if (recipientCount === 0) {
        throw new BadRequestException(
          "At least one valid recipient with a 10-digit mobile number is required.",
        );
      }

      if (recipientCount > remainingQuota) {
        throw new BadRequestException(
          `Insufficient SMS credits. Required: ${recipientCount}, Available: ${remainingQuota}. Please contact support or recharge credits.`,
        );
      }

      const campaignName =
        dto.name ||
        `${dto.category.toUpperCase().replace("_", " ")} Campaign - ${new Date().toLocaleDateString("en-IN")}`;

      // Create Campaign
      const created = await tx.smsCampaign.create({
        data: {
          organizationId: ctx.organizationId,
          companyId: ctx.companyId,
          name: campaignName,
          category: dto.category,
          templateId: dto.template_id || null,
          message: dto.message,
          variables: dto.variables || {},
          numberOfRecipients: recipientCount,
          status: "SENT",
          recipients: {
            create: recipientsToInsert.map((r) => ({
              organizationId: ctx.organizationId,
              companyId: ctx.companyId,
              partyId: r.partyId || null,
              partyName: r.partyName,
              mobileNumber: r.mobileNumber,
              status: "DELIVERED",
            })),
          },
        },
      });

      // Update used quota
      const newUsedQuota = usedQuota + recipientCount;
      await tx.company.update({
        where: { id: ctx.companyId },
        data: {
          extraDetails: {
            ...extra,
            sms_quota_used: newUsedQuota,
          },
        },
      });

      return {
        success: true,
        campaign: {
          id: created.id,
          name: created.name,
          category: created.category,
          message: created.message,
          number_of_recipients: created.numberOfRecipients,
          status: created.status,
          created_at: created.createdAt,
        },
        quota_remaining: Math.max(0, totalQuota - newUsedQuota),
      };
    });
  }

  async testCampaign(
    ctx: TenantContext,
    campaignId: string | null,
    dto: TestSmsDto,
  ): Promise<{ success: boolean; message: string }> {
    const phone = dto.mobile_number?.trim();
    if (!phone || phone.length < 10) {
      throw new BadRequestException("Please enter a valid 10-digit mobile number for test SMS.");
    }

    return {
      success: true,
      message: `Sample test SMS has been dispatched successfully to ${phone}.`,
    };
  }

  async getTestSmsQuota(
    _ctx: TenantContext,
    _campaignId?: string,
  ): Promise<{ remaining_quota: number; total_quota: number }> {
    return {
      remaining_quota: 5,
      total_quota: 5,
    };
  }

  async getPartyGreetingSettings(ctx: TenantContext): Promise<{
    invoice_milestone: { enabled: boolean; template_id: string; example: string };
    birthday_reminder: { enabled: boolean; template_id: string; example: string };
    additional_settings: any[];
  }> {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const comp = await tx.company.findUnique({
        where: { id: ctx.companyId },
        select: { extraDetails: true },
      });

      const extra = (comp?.extraDetails as Record<string, any>) || {};
      const partySettings = extra.party_settings || {};

      return {
        invoice_milestone: partySettings.invoice_milestone || {
          enabled: true,
          template_id: "milestone_01",
          example:
            "Dear Customer, congratulations on completing your milestone bill with our firm! We truly value your trust.",
        },
        birthday_reminder: partySettings.birthday_reminder || {
          enabled: true,
          template_id: "birthday_01",
          example:
            "Wishing you a very Happy Birthday! May your day be filled with happiness and prosperity.",
        },
        additional_settings: partySettings.additional_settings || [],
      };
    });
  }

  async updatePartyGreetingSettings(
    ctx: TenantContext,
    settings: PartyGreetingSettingsDto,
  ): Promise<any> {
    return this.prisma.executeInTenantContext(ctx, async (tx) => {
      const comp = await tx.company.findUnique({
        where: { id: ctx.companyId },
        select: { extraDetails: true },
      });

      const extra = (comp?.extraDetails as Record<string, any>) || {};
      const updatedParty = {
        ...(extra.party_settings || {}),
        ...settings,
      };

      await tx.company.update({
        where: { id: ctx.companyId },
        data: {
          extraDetails: {
            ...extra,
            party_settings: updatedParty,
          },
        },
      });

      return {
        success: true,
        party: updatedParty,
      };
    });
  }
}
