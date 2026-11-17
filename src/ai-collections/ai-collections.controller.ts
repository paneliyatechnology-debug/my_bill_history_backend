import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  Res,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { TenantContext, UserRole } from "@billing/shared-types";
import { Roles } from "../common/decorators/roles.decorator";
import { Public } from "../common/decorators/public.decorator";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { AiCollectionsService } from "./ai-collections.service";
import {
  UpdateAiCollectionSettingsDto,
  TestCallDto,
} from "./dto/ai-collection-settings.dto";
import { ScheduleCallsDto } from "./dto/schedule-calls.dto";
import { QueryCallsDto, QueryPendingDuesDto } from "./dto/query-calls.dto";
import { UpdateCustomerCallingPreferenceDto } from "./dto/customer-preference.dto";
import { CreateFollowUpDto, UpdateFollowUpDto } from "./dto/follow-up.dto";

@Controller("ai-collections")
@Roles(
  UserRole.SUPER_ADMIN,
  UserRole.ORG_ADMIN,
  UserRole.COMPANY_ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.AUDITOR,
  UserRole.BRANCH_MANAGER,
)
export class AiCollectionsController {
  constructor(private readonly service: AiCollectionsService) {}

  // ==========================================================================
  // Overview
  // ==========================================================================
  @Get("overview")
  async getOverview(@CurrentTenant() ctx: TenantContext) {
    return this.service.getOverview(ctx);
  }

  // ==========================================================================
  // Pending Dues
  // ==========================================================================
  @Get("pending-dues")
  async getPendingDues(
    @CurrentTenant() ctx: TenantContext,
    @Query() query: QueryPendingDuesDto,
  ) {
    return this.service.getPendingDues(ctx, query);
  }

  // ==========================================================================
  // Scheduling & Queue
  // ==========================================================================
  @Post("schedule")
  @HttpCode(HttpStatus.OK)
  async scheduleCalls(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: ScheduleCallsDto,
  ) {
    return this.service.scheduleCalls(ctx, dto);
  }

  @Get("queue")
  async getQueue(@CurrentTenant() ctx: TenantContext) {
    return this.service.getQueue(ctx);
  }

  @Patch("queue/:id/cancel")
  async cancelQueueItem(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.service.cancelQueueItem(ctx, id);
  }

  // ==========================================================================
  // Calls & Call History
  // ==========================================================================
  @Get("calls")
  async getCalls(
    @CurrentTenant() ctx: TenantContext,
    @Query() query: QueryCallsDto,
  ) {
    return this.service.getCalls(ctx, query);
  }

  @Get("calls/:id")
  async getCallById(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.service.getCallById(ctx, id);
  }

  @Post("calls/:id/retry")
  @HttpCode(HttpStatus.OK)
  async retryCall(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
  ) {
    return this.service.retryCall(ctx, id);
  }

  // ==========================================================================
  // Settings
  // ==========================================================================
  @Get("settings")
  async getSettings(@CurrentTenant() ctx: TenantContext) {
    return this.service.getSettings(ctx);
  }

  @Put("settings")
  async updateSettings(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: UpdateAiCollectionSettingsDto,
  ) {
    return this.service.updateSettings(ctx, dto);
  }

  @Post("settings/test-connection")
  @HttpCode(HttpStatus.OK)
  async testConnection(@CurrentTenant() ctx: TenantContext) {
    return this.service.testTelephonyConnection(ctx);
  }

  @Post("settings/test-call")
  @HttpCode(HttpStatus.OK)
  async testCall(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: TestCallDto,
  ) {
    return this.service.initiateTestCall(ctx, dto);
  }

  // ==========================================================================
  // Customer Preferences
  // ==========================================================================
  @Get("customers/:customerId/preferences")
  async getCustomerPreference(
    @CurrentTenant() ctx: TenantContext,
    @Param("customerId") customerId: string,
  ) {
    return this.service.getCustomerPreference(ctx, customerId);
  }

  @Patch("customers/:customerId/preferences")
  async updateCustomerPreference(
    @CurrentTenant() ctx: TenantContext,
    @Param("customerId") customerId: string,
    @Body() dto: UpdateCustomerCallingPreferenceDto,
  ) {
    return this.service.updateCustomerPreference(ctx, customerId, dto);
  }

  // ==========================================================================
  // Follow-ups
  // ==========================================================================
  @Get("follow-ups")
  async getFollowUps(@CurrentTenant() ctx: TenantContext) {
    return this.service.getFollowUps(ctx);
  }

  @Post("follow-ups")
  async createFollowUp(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: CreateFollowUpDto,
  ) {
    return this.service.createFollowUp(ctx, dto);
  }

  @Patch("follow-ups/:id")
  async updateFollowUp(
    @CurrentTenant() ctx: TenantContext,
    @Param("id") id: string,
    @Body() dto: UpdateFollowUpDto,
  ) {
    return this.service.updateFollowUp(ctx, id, dto);
  }

  // ==========================================================================
  // Webhooks (Public endpoints for provider status and speech turns)
  // ==========================================================================
  @Public()
  @Post("webhooks/:provider")
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Param("provider") provider: string,
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
    @Query() query: Record<string, any>,
  ) {
    return this.service.handleWebhook(provider, payload || {}, headers || {}, query || {});
  }

  @Public()
  @Post("webhooks/:provider/status")
  @HttpCode(HttpStatus.OK)
  async handleWebhookStatus(
    @Param("provider") provider: string,
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
    @Query() query: Record<string, any>,
  ) {
    return this.service.handleWebhook(provider, payload || {}, headers || {}, query || {});
  }

  @Public()
  @Post("webhooks/:provider/recording")
  @HttpCode(HttpStatus.OK)
  async handleWebhookRecording(
    @Param("provider") provider: string,
    @Body() payload: any,
    @Headers() headers: Record<string, string>,
    @Query() query: Record<string, any>,
  ) {
    return this.service.handleWebhook(provider, payload || {}, headers || {}, query || {});
  }

  @Public()
  @Post("webhooks/:provider/voice")
  async handleIncomingVoice(
    @Param("provider") provider: string,
    @Body() payload: any,
    @Query("callId") callId: string,
    @Res() reply: FastifyReply,
  ) {
    const responseContent = await this.service.handleSpeechTurn(
      provider,
      payload || {},
      callId,
    );

    if (responseContent.trim().startsWith("<?xml")) {
      reply.type("text/xml").send(responseContent);
    } else {
      reply.type("application/json").send(responseContent);
    }
  }

  @Public()
  @Post("webhooks/:provider/speech")
  async handleSpeechTurn(
    @Param("provider") provider: string,
    @Body() payload: any,
    @Query("callId") callId: string,
    @Res() reply: FastifyReply,
  ) {
    const responseContent = await this.service.handleSpeechTurn(
      provider,
      payload || {},
      callId,
    );

    if (responseContent.trim().startsWith("<?xml")) {
      reply.type("text/xml").send(responseContent);
    } else {
      reply.type("application/json").send(responseContent);
    }
  }
}

