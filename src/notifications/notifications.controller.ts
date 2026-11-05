import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { TenantContext } from "@billing/shared-types";
import { CurrentTenant } from "../common/decorators/current-tenant.decorator";
import { NotificationsService } from "./notifications.service";
import { ReminderSchedulerService } from "./reminder-scheduler.service";
import { QueryNotificationsDto } from "./dto/query-notifications.dto";
import { RegisterDeviceDto } from "./dto/register-device.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { UpdateNotificationDto } from "./dto/update-notification.dto";

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly reminderScheduler: ReminderSchedulerService,
  ) {}

  /**
   * GET /api/v1/notifications
   * Retrieve paginated notifications for the authenticated user.
   */
  @Get()
  async getNotifications(
    @Query() query: QueryNotificationsDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.notificationsService.getNotifications(tenant, query);
  }

  /**
   * GET /api/v1/notifications/unread-count
   * Retrieve unread notification count for the authenticated user.
   */
  @Get("unread-count")
  async getUnreadCount(@CurrentTenant() tenant: TenantContext) {
    return await this.notificationsService.getUnreadCount(tenant);
  }

  /**
   * GET /api/v1/notifications/vapid-public-key
   * Retrieve public VAPID key for Web Push subscription.
   */
  @Get("vapid-public-key")
  getVapidPublicKey() {
    return this.notificationsService.getVapidPublicKey();
  }

  /**
   * GET /api/v1/notifications/preferences
   * Retrieve notification preferences.
   */
  @Get("preferences")
  async getPreferences(@CurrentTenant() tenant: TenantContext) {
    return await this.notificationsService.getPreferences(tenant);
  }

  /**
   * PATCH /api/v1/notifications/preferences
   * Update notification preferences.
   */
  @Patch("preferences")
  async updatePreferences(
    @Body() dto: UpdatePreferencesDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.notificationsService.updatePreferences(dto, tenant);
  }

  /**
   * POST /api/v1/notifications/devices
   * Register a browser push subscription or mobile device token.
   */
  @Post("devices")
  async registerDevice(
    @Body() dto: RegisterDeviceDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.notificationsService.registerDevice(dto, tenant);
  }

  /**
   * DELETE /api/v1/notifications/devices/:id
   * Unregister a device belonging to the authenticated user.
   */
  @Delete("devices/:id")
  async unregisterDevice(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.notificationsService.unregisterDevice(id, tenant);
  }

  /**
   * PATCH /api/v1/notifications
   * Unified single API endpoint to manage notification read/unread status parameter-wise.
   * - Mark single as read: { id: "<ID>", isRead: true }
   * - Mark single as unread: { id: "<ID>", isRead: false }
   * - Mark all as read: { all: true, isRead: true }
   * - Mark all as unread: { all: true, isRead: false }
   * Also supports query parameters (?id=...&isRead=true or ?all=true&isRead=false).
   */
  @Patch()
  async manageNotificationStatus(
    @Body() dto: UpdateNotificationDto,
    @Query() query: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.notificationsService.manageNotificationStatus(
      dto,
      tenant,
      undefined,
      query,
    );
  }

  /**
   * PATCH /api/v1/notifications/read-all
   * Mark all eligible notifications as read.
   */
  @Patch("read-all")
  async markAllAsRead(@CurrentTenant() tenant: TenantContext) {
    return await this.notificationsService.markAllAsRead(tenant);
  }

  /**
   * PATCH /api/v1/notifications/unread-all
   * Mark all notifications as unread.
   */
  @Patch("unread-all")
  async markAllAsUnread(@CurrentTenant() tenant: TenantContext) {
    return await this.notificationsService.markAllAsUnread(tenant);
  }

  /**
   * POST /api/v1/notifications/reminders/trigger
   * Trigger the calendar days due-date reminder scan (DUE_TODAY, T-3, T-7).
   */
  @Post("reminders/trigger")
  @HttpCode(HttpStatus.OK)
  async triggerReminders(@CurrentTenant() tenant: TenantContext) {
    return await this.reminderScheduler.runDueRemindersScan(tenant.companyId);
  }

  /**
   * GET /api/v1/notifications/:id
   * Retrieve a single notification by ID.
   */
  @Get(":id")
  async getNotificationById(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.notificationsService.getNotificationById(id, tenant);
  }

  /**
   * PATCH /api/v1/notifications/:id
   * Unified endpoint to update notification read or unread state in one API.
   * Accepts { isRead: boolean } or { read: boolean }.
   */
  @Patch(":id")
  async updateNotification(
    @Param("id") id: string,
    @Body() dto: UpdateNotificationDto,
    @Query() query: any,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.notificationsService.manageNotificationStatus(
      dto,
      tenant,
      id,
      query,
    );
  }

  /**
   * PATCH /api/v1/notifications/:id/read
   * Mark a notification as read.
   */
  @Patch(":id/read")
  async markAsRead(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.notificationsService.markAsRead(id, tenant);
  }

  /**
   * PATCH /api/v1/notifications/:id/unread
   * Mark a notification as unread.
   */
  @Patch(":id/unread")
  async markAsUnread(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.notificationsService.markAsUnread(id, tenant);
  }

  /**
   * DELETE /api/v1/notifications/:id
   * Dismiss or hide a notification.
   */
  @Delete(":id")
  async dismissNotification(
    @Param("id") id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return await this.notificationsService.dismissNotification(id, tenant);
  }
}

