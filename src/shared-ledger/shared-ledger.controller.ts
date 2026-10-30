import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { SharedLedgerService } from "./shared-ledger.service";
import {
  InvitePartyDto,
  ToggleSharedLedgerDto,
  SettleBalanceDto,
  QuerySharedLedgerDto,
  SharedLedgerSettingsDto,
  ConvertToPurchaseDto,
  QueryPartyTransactionsDto,
} from "./dto/shared-ledger.dto";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { Public } from "../common/decorators/public.decorator";
import { TenantContext } from "@billing/shared-types";

@SkipThrottle()
@Controller("shared-ledger")
export class SharedLedgerController {
  constructor(private readonly sharedLedgerService: SharedLedgerService) {}

  @Get("summary")
  async getSummary(@CurrentTenant() ctx: TenantContext) {
    return this.sharedLedgerService.getSummary(ctx);
  }

  @Get("parties")
  async getConnectedParties(
    @CurrentTenant() ctx: TenantContext,
    @Query() query: QuerySharedLedgerDto,
  ) {
    return this.sharedLedgerService.getConnectedParties(ctx, query);
  }

  @Get("settings")
  async getSettings(@CurrentTenant() ctx: TenantContext) {
    return this.sharedLedgerService.getSettings(ctx);
  }

  @Post("settings")
  @HttpCode(HttpStatus.OK)
  async updateSettings(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: SharedLedgerSettingsDto,
  ) {
    return this.sharedLedgerService.updateSettings(ctx, dto);
  }

  @Get("parties/:partyId/transactions")
  async getPartyTransactions(
    @CurrentTenant() ctx: TenantContext,
    @Param("partyId") partyId: string,
    @Query() query: QueryPartyTransactionsDto,
  ) {
    return this.sharedLedgerService.getPartyTransactions(ctx, partyId, query);
  }

  @Post("convert-to-purchase")
  @HttpCode(HttpStatus.OK)
  async convertToPurchase(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: ConvertToPurchaseDto,
  ) {
    return this.sharedLedgerService.convertToPurchase(ctx, dto);
  }

  @Post("invite")
  @HttpCode(HttpStatus.OK)
  async inviteParty(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: InvitePartyDto,
  ) {
    return this.sharedLedgerService.inviteParty(ctx, dto);
  }

  @Post("toggle")
  @HttpCode(HttpStatus.OK)
  async toggleSharedLedger(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: ToggleSharedLedgerDto,
  ) {
    return this.sharedLedgerService.toggleSharedLedger(ctx, dto);
  }

  @Post("settle")
  @HttpCode(HttpStatus.OK)
  async settleBalance(
    @CurrentTenant() ctx: TenantContext,
    @Body() dto: SettleBalanceDto,
  ) {
    return this.sharedLedgerService.settleBalance(ctx, dto);
  }

  /**
   * Public portal endpoint accessed by party via their secret link
   */
  @Get("public/:token")
  @Public()
  async getPublicPortalData(@Param("token") token: string) {
    return this.sharedLedgerService.getPublicPortalData(token);
  }
}
