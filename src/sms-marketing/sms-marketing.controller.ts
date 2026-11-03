import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { SmsMarketingService } from "./sms-marketing.service";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { TenantContext } from "@billing/shared-types";
import {
  CreateCampaignDto,
  TestSmsDto,
  PartyGreetingSettingsDto,
} from "./dto/create-campaign.dto";

@Controller()
export class SmsMarketingController {
  constructor(private readonly smsService: SmsMarketingService) {}

  // =========================================================================
  // 1. myBillBook Web App Endpoints (exact matches to /web/* routes)
  // =========================================================================

  @Get(["web/templates", "sms-marketing/templates"])
  async getTemplates(@Query("category") category?: string) {
    return this.smsService.getTemplates(category);
  }

  @Get(["web/templates/reminder_templates", "sms-marketing/reminder-templates"])
  async getReminderTemplates(@Query() query: any) {
    return this.smsService.getReminderTemplates(query);
  }

  @Get(["web/campaigns", "sms-marketing/campaigns", "campaigns"])
  async getCampaigns(
    @CurrentTenant() ctx: TenantContext,
    @Query("sort_order") sortOrder?: "ASC" | "DESC",
  ) {
    return this.smsService.getCampaigns(ctx, sortOrder || "DESC");
  }

  @Post(["web/campaigns", "sms-marketing/campaigns", "campaigns"])
  @HttpCode(HttpStatus.CREATED)
  async createCampaign(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.smsService.createCampaign(ctx, dto);
  }

  @Get([
    "web/campaigns/:id/show_campaign_recipients",
    "sms-marketing/campaigns/:id/recipients",
    "campaigns/:id/recipients",
  ])
  async getCampaignRecipients(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.smsService.getCampaignRecipients(ctx, id);
  }

  @Post([
    "web/campaigns/:id/test_campaign",
    "sms-marketing/campaigns/:id/test",
    "sms-marketing/test",
  ])
  async testCampaign(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: TestSmsDto,
  ) {
    return this.smsService.testCampaign(ctx, id, dto);
  }

  @Get([
    "web/campaigns/:id/check_sample_campaign_quota",
    "sms-marketing/test-quota",
  ])
  async getTestSmsQuota(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.smsService.getTestSmsQuota(ctx, id);
  }

  // =========================================================================
  // 2. Quota & Company Settings Endpoints
  // =========================================================================

  @Get("sms-marketing/quota")
  async getQuota(@CurrentTenant() ctx: TenantContext) {
    return this.smsService.getQuota(ctx);
  }

  @Get(["sms-marketing/party-settings", "settings/smart-greetings"])
  async getPartyGreetingSettings(@CurrentTenant() ctx: TenantContext) {
    return this.smsService.getPartyGreetingSettings(ctx);
  }

  @Put(["sms-marketing/party-settings", "settings/smart-greetings"])
  async updatePartyGreetingSettings(
    @CurrentTenant() ctx: TenantContext,
    @Body() settings: PartyGreetingSettingsDto,
  ) {
    return this.smsService.updatePartyGreetingSettings(ctx, settings);
  }

  @Put("company_settings")
  async updateCompanySettings(
    @CurrentTenant() ctx: TenantContext,
    @Body() body: any,
  ) {
    // If party settings are passed under body.party or body
    const partyData = body.party || body;
    return this.smsService.updatePartyGreetingSettings(ctx, partyData);
  }
}
