import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { TenantContext } from "@billing/shared-types";
import { WebPushService } from "./web-push.service";
import { QueryNotificationsDto } from "./dto/query-notifications.dto";
import { RegisterDeviceDto } from "./dto/register-device.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { UpdateNotificationDto } from "./dto/update-notification.dto";
import {
  NotificationType,
  DevicePlatform,
  PushProvider,
  NotificationChannel,
  DeliveryStatus,
} from "@prisma/client";

import { randomUUID } from "crypto";

export interface CreateNotificationParams {
  organizationId: string;
  companyId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
  data?: Record<string, any>;
  targetUserIds?: string[];
  deepLink?: string;
  idempotencyKey?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: DatabaseService,
    private readonly webPush: WebPushService,
  ) {}

  /**
   * Resolves relevant user recipients for a business event within a company.
   */
  async resolveCompanyRecipients(
    organizationId: string,
    companyId: string,
    explicitUserIds?: string[],
  ): Promise<string[]> {
    if (explicitUserIds && explicitUserIds.length > 0) {
      // Validate that all explicit user IDs belong to the organization
      const validUsers = await this.prisma.user.findMany({
        where: {
          id: { in: explicitUserIds },
          organizationId,
          isActive: true,
        },
        select: { id: true },
      });
      return validUsers.map((u) => u.id);
    }

    // Find users assigned to branches of this company
    const assignedUsers = await this.prisma.userBranchAssignment.findMany({
      where: {
        branch: { companyId },
        user: { isActive: true },
      },
      select: { userId: true },
    });

    const userIds = new Set<string>(assignedUsers.map((a) => a.userId));

    // Also include organization admins and super admins
    const admins = await this.prisma.user.findMany({
      where: {
        organizationId,
        isActive: true,
        role: { in: ["SUPER_ADMIN", "ORG_ADMIN", "COMPANY_ADMIN"] },
      },
      select: { id: true },
    });

    for (const admin of admins) {
      userIds.add(admin.id);
    }

    return Array.from(userIds);
  }

  /**
   * Dispatches a persistent business notification across in-app, Web Push, and Mobile Push.
   */
  async createNotification(params: CreateNotificationParams): Promise<any[]> {
    const {
      organizationId,
      companyId,
      type,
      title,
      message,
      data = {},
      deepLink,
    } = params;

    const safeEntityType = params.entityType || "SYSTEM";
    const isUuid = (val?: string) =>
      typeof val === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
    const safeEntityId = isUuid(params.entityId) ? params.entityId! : randomUUID();

    // Idempotency check: prevent duplicate notifications within 3 minutes for identical entity & event
    if (params.entityId && isUuid(params.entityId)) {
      const recentDuplicate = await this.prisma.notification.findFirst({
        where: {
          companyId,
          entityType: safeEntityType,
          entityId: safeEntityId,
          type,
          title: params.title,
          createdAt: { gte: new Date(Date.now() - 3 * 60 * 1000) },
        },
      });

      if (recentDuplicate) {
        this.logger.warn(
          `Duplicate notification suppressed for ${type} on ${safeEntityType}:${safeEntityId}`,
        );
        (recentDuplicate as any).isRead = recentDuplicate.readAt !== null;
        return [recentDuplicate];
      }
    }

    const explicitTargets = [...(params.targetUserIds || [])];
    if (params.userId && !explicitTargets.includes(params.userId)) {
      explicitTargets.push(params.userId);
    }

    const recipientUserIds = await this.resolveCompanyRecipients(
      organizationId,
      companyId,
      explicitTargets.length > 0 ? explicitTargets : undefined,
    );

    if (recipientUserIds.length === 0) {
      this.logger.warn(
        `No eligible recipients found for notification ${type} in company ${companyId}`,
      );
      return [];
    }

    // Resolve user preferences for recipients
    const preferences = await this.prisma.notificationPreference.findMany({
      where: {
        companyId,
        userId: { in: recipientUserIds },
      },
    });

    const prefMap = new Map<string, any>(preferences.map((p) => [p.userId, p]));

    const createdNotifications: any[] = [];

    for (const userId of recipientUserIds) {
      const userPref = prefMap.get(userId);

      // Check category-specific preference
      let isCategoryEnabled = true;
      if (userPref) {
        if (type === NotificationType.PAYMENT_RECEIVED && !userPref.paymentReceived) {
          isCategoryEnabled = false;
        } else if (type === NotificationType.PAYMENT_SENT && !userPref.paymentSent) {
          isCategoryEnabled = false;
        } else if (
          type === NotificationType.INVOICE_DUE_REMINDER &&
          !userPref.invoiceDueReminder
        ) {
          isCategoryEnabled = false;
        } else if (
          type === NotificationType.PURCHASE_DUE_REMINDER &&
          !userPref.purchaseDueReminder
        ) {
          isCategoryEnabled = false;
        } else if (
          type === NotificationType.OVERDUE_INVOICE &&
          !userPref.overdueReminder
        ) {
          isCategoryEnabled = false;
        }
      }

      if (!isCategoryEnabled) {
        continue;
      }

      const inAppEnabled = userPref ? userPref.inAppEnabled : true;
      const pushEnabled = userPref ? userPref.pushEnabled : true;

      if (!inAppEnabled && !pushEnabled) {
        continue;
      }

      // Persist In-App Notification record
      const notification = await this.prisma.notification.create({
        data: {
          organizationId,
          companyId,
          recipientUserId: userId,
          type,
          title,
          message,
          entityType: safeEntityType,
          entityId: safeEntityId,
          data: {
            ...data,
            deepLink: deepLink || this.resolveDefaultDeepLink(safeEntityType, safeEntityId),
          },
        },
      });

      (notification as any).isRead = notification.readAt !== null;
      createdNotifications.push(notification);

      // Asynchronously trigger Web Push & Mobile Push if user has opted in
      if (pushEnabled) {
        this.dispatchPushDeliveries(notification, userId, deepLink).catch((err) => {
          this.logger.error(`Error delivering push for notification ${notification.id}: ${err.message}`);
        });
      }
    }

    return createdNotifications;
  }

  /**
   * Resolves default frontend application deep link based on entity type.
   */
  resolveDefaultDeepLink(entityType: string, entityId: string): string {
    switch (entityType) {
      case "SALES_PAYMENT":
      case "PAYMENT_RECEIPT":
        return `/sales/payment-in/${entityId}`;
      case "SALES_INVOICE":
        return `/sales/invoices/${entityId}`;
      case "PURCHASE_PAYMENT":
      case "PAYMENT_OUT":
        return `/purchases/payment-out/${entityId}`;
      case "PURCHASE_INVOICE":
        return `/purchases/${entityId}`;
      case "STAFF_PAYMENT":
        return `/payroll`;
      case "EXPENSE_VOUCHER":
        return `/expenses/${entityId}`;
      case "VOUCHER":
        return `/accounting/vouchers`;
      default:
        return "/";
    }
  }

  /**
   * Dispatches Push Deliveries to registered Web and Mobile devices.
   */
  private async dispatchPushDeliveries(
    notification: any,
    userId: string,
    deepLink?: string,
  ) {
    const devices = await this.prisma.notificationDevice.findMany({
      where: {
        userId,
        isActive: true,
      },
    });

    if (devices.length === 0) return;

    for (const device of devices) {
      const channel: NotificationChannel =
        device.platform === "WEB"
          ? NotificationChannel.WEB_PUSH
          : device.platform === "IOS"
            ? NotificationChannel.APNS
            : NotificationChannel.FCM;

      const delivery = await this.prisma.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          deviceId: device.id,
          channel,
          status: DeliveryStatus.PENDING,
          attemptCount: 1,
        },
      });

      const pushPayload = {
        notificationId: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.message,
        deepLink:
          deepLink ||
          this.resolveDefaultDeepLink(
            notification.entityType,
            notification.entityId,
          ),
        entityType: notification.entityType,
        entityId: notification.entityId,
        data: (notification.data as any) || {},
        schemaVersion: 1,
      };

      if (device.platform === "WEB" && device.endpoint && device.p256dhKey && device.authKey) {
        const res = await this.webPush.sendWebPush(
          {
            endpoint: device.endpoint,
            p256dhKey: device.p256dhKey,
            authKey: device.authKey,
          },
          pushPayload,
        );

        if (res.success) {
          await this.prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: DeliveryStatus.SENT,
              sentAt: new Date(),
            },
          });
        } else {
          await this.prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: DeliveryStatus.FAILED,
              lastErrorCode: res.statusCode ? String(res.statusCode) : "SEND_ERROR",
              lastErrorMessage: res.error,
            },
          });

          if (res.isExpired) {
            await this.prisma.notificationDevice.update({
              where: { id: device.id },
              data: { isActive: false },
            });
            this.logger.log(`Deactivated expired web push subscription ${device.id}`);
          }
        }
      } else if (device.token && (device.platform === "ANDROID" || device.platform === "IOS")) {
        const res = await this.webPush.sendMobilePush(
          {
            platform: device.platform,
            token: device.token,
          },
          pushPayload,
        );

        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: res.success ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
            sentAt: res.success ? new Date() : undefined,
            lastErrorMessage: res.error,
          },
        });
      }
    }
  }

  /**
   * Retrieves paginated notifications for the authenticated user.
   * Supports listing read, unread, or both (all) in a single API.
   * Returns items, data, unread list, read list, total count, unreadCount, and readCount.
   */
  async getNotifications(arg1: any, arg2?: any) {
    let tenant: TenantContext;
    let query: QueryNotificationsDto;

    // Detect if arg1 is tenantContext (has userId and organizationId and companyId)
    if (arg1 && typeof arg1 === "object" && "organizationId" in arg1 && "companyId" in arg1 && "userId" in arg1) {
      tenant = arg1;
      query = (arg2 || {}) as QueryNotificationsDto;
    } else if (arg2 && typeof arg2 === "object" && "organizationId" in arg2 && "companyId" in arg2 && "userId" in arg2) {
      tenant = arg2;
      query = (arg1 || {}) as QueryNotificationsDto;
    } else {
      tenant = ((arg1 && arg1.companyId) ? arg1 : (arg2 && arg2.companyId) ? arg2 : arg1) as TenantContext;
      query = ((arg1 && !arg1.companyId) ? arg1 : (arg2 && !arg2.companyId) ? arg2 : (arg2 || arg1 || {})) as QueryNotificationsDto;
    }

    try {
      if (tenant?.companyId) {
        await this.syncDueRemindersForCompany(tenant.companyId, tenant.organizationId);
      }
    } catch (syncErr: any) {
      this.logger.warn(`Reminder sync in getNotifications: ${syncErr?.message}`);
    }

    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {
      organizationId: tenant.organizationId,
      companyId: tenant.companyId,
      recipientUserId: tenant.userId,
      dismissedAt: null,
    };

    // Parse status and read/unread flags flexibly across all standard query conventions
    let statusParam: string | undefined;
    if (typeof query?.status === "string") {
      statusParam = query.status.trim().toLowerCase();
    } else if (Array.isArray(query?.status)) {
      const lowerArr = (query.status as any[]).map((s) =>
        String(s).toLowerCase().trim(),
      );
      statusParam =
        lowerArr.includes("unread") && lowerArr.includes("read")
          ? "all"
          : lowerArr[0];
    }
    const unreadOnlyVal = query?.unreadOnly;
    const readOnlyVal = query?.readOnly;
    const isReadVal = (query as any)?.isRead;
    const readVal = (query as any)?.read;

    const wantsUnread =
      statusParam === "unread" ||
      unreadOnlyVal === true ||
      unreadOnlyVal === "true" ||
      (unreadOnlyVal as any) === 1 ||
      unreadOnlyVal === "1" ||
      isReadVal === false ||
      isReadVal === "false" ||
      (isReadVal as any) === 0 ||
      isReadVal === "0" ||
      readVal === false ||
      readVal === "false" ||
      (readVal as any) === 0 ||
      readVal === "0";

    const wantsRead =
      statusParam === "read" ||
      readOnlyVal === true ||
      readOnlyVal === "true" ||
      (readOnlyVal as any) === 1 ||
      readOnlyVal === "1" ||
      isReadVal === true ||
      isReadVal === "true" ||
      (isReadVal as any) === 1 ||
      isReadVal === "1" ||
      readVal === true ||
      readVal === "true" ||
      (readVal as any) === 1 ||
      readVal === "1";

    if (wantsUnread && !wantsRead) {
      where.readAt = null;
    } else if (wantsRead && !wantsUnread) {
      where.readAt = { not: null };
    }
    // If statusParam === "all" or both or neither, where.readAt remains unset -> returns all

    if (query?.type && query.type !== "ALL") {
      where.type = query.type as NotificationType;
    }

    if (query?.from || query?.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const baseTenantWhere = {
      organizationId: tenant.organizationId,
      companyId: tenant.companyId,
      recipientUserId: tenant.userId,
      dismissedAt: null,
    };

    const [items, total, unreadCount, readCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: {
          ...baseTenantWhere,
          readAt: null,
        },
      }),
      this.prisma.notification.count({
        where: {
          ...baseTenantWhere,
          readAt: { not: null },
        },
      }),
    ]);

    const itemsWithIsRead = items.map((n) => ({
      ...n,
      isRead: n.readAt !== null,
    }));

    const unreadItems = itemsWithIsRead.filter((n) => !n.isRead);
    const readItems = itemsWithIsRead.filter((n) => n.isRead);

    return {
      items: itemsWithIsRead,
      data: itemsWithIsRead,
      unread: unreadItems,
      read: readItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      unreadCount,
      readCount,
    };
  }

  /**
   * Returns current user's unread notification count.
   */
  async getUnreadCount(tenant: TenantContext): Promise<{ unreadCount: number }> {
    const count = await this.prisma.notification.count({
      where: {
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        recipientUserId: tenant.userId,
        readAt: null,
        dismissedAt: null,
      },
    });

    return { unreadCount: count };
  }

  /**
   * Retrieves a single notification by ID.
   */
  async getNotificationById(id: string, tenant: TenantContext) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id,
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        recipientUserId: tenant.userId,
        dismissedAt: null,
      },
    });

    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found.`);
    }

    return notification;
  }

  /**
   * Marks a notification as read.
   */
  async markAsRead(id: string, tenant: TenantContext) {
    const existing = await this.prisma.notification.findFirst({
      where: {
        id,
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        recipientUserId: tenant.userId,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Notification ${id} not found.`);
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });

    return {
      ...updated,
      isRead: true,
    };
  }

  /**
   * Marks a notification as unread.
   */
  async markAsUnread(id: string, tenant: TenantContext) {
    const existing = await this.prisma.notification.findFirst({
      where: {
        id,
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        recipientUserId: tenant.userId,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Notification ${id} not found.`);
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: null },
    });

    return {
      ...updated,
      isRead: false,
    };
  }

  /**
   * Unified single API endpoint handler to manage notification status across:
   * 1. Mark single notification as Read ({ id, isRead: true })
   * 2. Mark single notification as Unread ({ id, isRead: false })
   * 3. Mark ALL notifications as Read ({ all: true, isRead: true })
   * 4. Mark ALL notifications as Unread ({ all: true, isRead: false })
   * Supports parameters via body, query, and path params.
   */
  async manageNotificationStatus(
    dto: UpdateNotificationDto = {},
    tenant: TenantContext,
    id?: string,
    query?: any,
  ) {
    const rawId = (id || dto?.id || query?.id || "").trim();
    const rawAll = dto?.all !== undefined ? dto.all : query?.all;
    const isAllFlag =
      rawAll === true ||
      rawAll === "true" ||
      (rawAll as any) === 1 ||
      rawAll === "1" ||
      (typeof dto?.action === "string" && dto.action.toUpperCase().includes("ALL")) ||
      rawId.toLowerCase() === "all" ||
      rawId.toLowerCase() === "read-all" ||
      rawId.toLowerCase() === "unread-all" ||
      (!rawId && !id);

    const isUnread =
      dto?.isRead === false ||
      dto?.isRead === "false" ||
      (dto?.isRead as any) === 0 ||
      dto?.isRead === "0" ||
      dto?.read === false ||
      dto?.read === "false" ||
      (dto?.read as any) === 0 ||
      dto?.read === "0" ||
      (typeof dto?.status === "string" && dto.status.trim().toUpperCase() === "UNREAD") ||
      (typeof dto?.action === "string" && dto.action.trim().toUpperCase().includes("UNREAD")) ||
      query?.isRead === false ||
      query?.isRead === "false" ||
      query?.isRead === 0 ||
      query?.isRead === "0" ||
      (typeof query?.status === "string" && query.status.trim().toUpperCase() === "UNREAD");

    if (isAllFlag) {
      if (isUnread) {
        const res = await this.markAllAsUnread(tenant);
        return {
          success: true,
          isRead: false,
          all: true,
          updatedCount: res.count,
          message: "All notifications marked as unread",
        };
      } else {
        const res = await this.markAllAsRead(tenant);
        return {
          success: true,
          isRead: true,
          all: true,
          updatedCount: res.count,
          message: "All notifications marked as read",
        };
      }
    }

    // Single notification update
    if (isUnread) {
      const res = await this.markAsUnread(rawId, tenant);
      return {
        ...res,
        message: "Notification marked as unread",
      };
    } else {
      const res = await this.markAsRead(rawId, tenant);
      return {
        ...res,
        message: "Notification marked as read",
      };
    }
  }

  /**
   * Updates notification read/unread status from a payload (delegates to unified manageNotificationStatus).
   */
  async updateNotification(
    id: string,
    dto: UpdateNotificationDto,
    tenant: TenantContext,
  ) {
    return await this.manageNotificationStatus(dto, tenant, id);
  }

  /**
   * Marks all eligible notifications as read for current user.
   */
  async markAllAsRead(tenant: TenantContext) {
    const res = await this.prisma.notification.updateMany({
      where: {
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        recipientUserId: tenant.userId,
        readAt: null,
        dismissedAt: null,
      },
      data: { readAt: new Date() },
    });

    return { success: true, count: res.count };
  }

  /**
   * Marks all eligible notifications as unread for current user.
   */
  async markAllAsUnread(tenant: TenantContext) {
    const res = await this.prisma.notification.updateMany({
      where: {
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        recipientUserId: tenant.userId,
        readAt: { not: null },
        dismissedAt: null,
      },
      data: { readAt: null },
    });

    return { success: true, count: res.count };
  }

  /**
   * Dismisses a notification from the user's view without deleting transaction audit history.
   */
  async dismissNotification(id: string, tenant: TenantContext) {
    const existing = await this.prisma.notification.findFirst({
      where: {
        id,
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        recipientUserId: tenant.userId,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Notification ${id} not found.`);
    }

    await this.prisma.notification.update({
      where: { id },
      data: { dismissedAt: new Date() },
    });

    return { success: true };
  }

  /**
   * Registers a browser Web Push subscription or mobile FCM/APNs device token.
   */
  async registerDevice(dto: RegisterDeviceDto, tenant: TenantContext) {
    const { platform, provider, token, endpoint, keys, deviceId, appVersion } = dto;

    if (!tenant.userId) {
      throw new ForbiddenException("Authentication required for device registration.");
    }

    if (platform === "WEB") {
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        throw new BadRequestException("Web Push registration requires endpoint, p256dh key, and auth key.");
      }

      // Upsert web device by endpoint
      const existing = await this.prisma.notificationDevice.findFirst({
        where: {
          userId: tenant.userId,
          endpoint,
        },
      });

      if (existing) {
        return await this.prisma.notificationDevice.update({
          where: { id: existing.id },
          data: {
            p256dhKey: keys.p256dh,
            authKey: keys.auth,
            isActive: true,
            lastSeenAt: new Date(),
            deviceId,
            appVersion,
            companyId: tenant.companyId,
          },
        });
      }

      return await this.prisma.notificationDevice.create({
        data: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          userId: tenant.userId,
          platform: DevicePlatform.WEB,
          provider: PushProvider.WEB_PUSH,
          endpoint,
          p256dhKey: keys.p256dh,
          authKey: keys.auth,
          deviceId,
          appVersion,
          isActive: true,
        },
      });
    }

    // Mobile registration (ANDROID / IOS)
    if (!token) {
      throw new BadRequestException("Mobile device registration requires a valid push token.");
    }

    const existing = await this.prisma.notificationDevice.findFirst({
      where: {
        userId: tenant.userId,
        token,
      },
    });

    if (existing) {
      return await this.prisma.notificationDevice.update({
        where: { id: existing.id },
        data: {
          platform: platform === "IOS" ? DevicePlatform.IOS : DevicePlatform.ANDROID,
          provider: provider === "APNS" ? PushProvider.APNS : PushProvider.FCM,
          isActive: true,
          lastSeenAt: new Date(),
          deviceId,
          appVersion,
          companyId: tenant.companyId,
        },
      });
    }

    return await this.prisma.notificationDevice.create({
      data: {
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId,
        platform: platform === "IOS" ? DevicePlatform.IOS : DevicePlatform.ANDROID,
        provider: provider === "APNS" ? PushProvider.APNS : PushProvider.FCM,
        token,
        deviceId,
        appVersion,
        isActive: true,
      },
    });
  }

  /**
   * Unregisters a device belonging to the authenticated user.
   */
  async unregisterDevice(deviceId: string, tenant: TenantContext) {
    const device = await this.prisma.notificationDevice.findFirst({
      where: {
        id: deviceId,
        userId: tenant.userId,
      },
    });

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found.`);
    }

    await this.prisma.notificationDevice.update({
      where: { id: deviceId },
      data: { isActive: false },
    });

    return { success: true };
  }

  private formatPreferences(pref: any) {
    if (!pref) return null;
    return {
      ...pref,
      paymentReceivedPush: pref.paymentReceived,
      paymentSentPush: pref.paymentSent,
      dueReminderT3Push: pref.invoiceDueReminder,
      dueReminderOverduePush: pref.overdueReminder,
    };
  }

  /**
   * Retrieves notification preferences for the user in the active company.
   */
  async getPreferences(tenant: TenantContext) {
    let pref = await this.prisma.notificationPreference.findUnique({
      where: {
        companyId_userId: {
          companyId: tenant.companyId,
          userId: tenant.userId || "00000000-0000-0000-0000-000000000000",
        },
      },
    });

    if (!pref) {
      return this.formatPreferences({
        paymentReceived: true,
        paymentSent: true,
        invoiceDueReminder: true,
        purchaseDueReminder: true,
        overdueReminder: true,
        pushEnabled: true,
        inAppEnabled: true,
      });
    }

    return this.formatPreferences(pref);
  }

  /**
   * Updates notification preferences.
   */
  async updatePreferences(dto: any, tenant: TenantContext) {
    if (!tenant.userId) {
      throw new ForbiddenException("Authentication required to update preferences.");
    }

    const paymentReceived = dto.paymentReceived ?? dto.paymentReceivedPush;
    const paymentSent = dto.paymentSent ?? dto.paymentSentPush;
    const invoiceDueReminder = dto.invoiceDueReminder ?? dto.dueReminderT3Push;
    const purchaseDueReminder = dto.purchaseDueReminder ?? dto.dueReminderT3Push;
    const overdueReminder = dto.overdueReminder ?? dto.dueReminderOverduePush;
    const pushEnabled = dto.pushEnabled;
    const inAppEnabled = dto.inAppEnabled;

    const upserted = await this.prisma.notificationPreference.upsert({
      where: {
        companyId_userId: {
          companyId: tenant.companyId,
          userId: tenant.userId,
        },
      },
      create: {
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        userId: tenant.userId,
        paymentReceived: paymentReceived ?? true,
        paymentSent: paymentSent ?? true,
        invoiceDueReminder: invoiceDueReminder ?? true,
        purchaseDueReminder: purchaseDueReminder ?? true,
        overdueReminder: overdueReminder ?? true,
        pushEnabled: pushEnabled ?? true,
        inAppEnabled: inAppEnabled ?? true,
      },
      update: {
        ...(paymentReceived !== undefined && { paymentReceived }),
        ...(paymentSent !== undefined && { paymentSent }),
        ...(invoiceDueReminder !== undefined && { invoiceDueReminder }),
        ...(purchaseDueReminder !== undefined && { purchaseDueReminder }),
        ...(overdueReminder !== undefined && { overdueReminder }),
        ...(pushEnabled !== undefined && { pushEnabled }),
        ...(inAppEnabled !== undefined && { inAppEnabled }),
      },
    });

    return this.formatPreferences(upserted);
  }

  /**
   * Returns public VAPID key for browser Push API registration.
   */
  getVapidPublicKey(): { publicKey: string } {
    return { publicKey: this.webPush.getPublicKey() };
  }

  /**
   * Real business event activity feed near the top of the dashboard.
   */
  async getRecentActivity(tenant: TenantContext, limit = 10) {
    const take = Math.min(50, Math.max(1, Number(limit) || 10));

    // Combine recent sales invoices, vouchers (receipts & payments), and reminders
    const [invoices, vouchers, reminders] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where: {
          companyId: tenant.companyId,
          status: { not: "CANCELLED" },
        },
        include: { party: true },
        orderBy: { createdAt: "desc" },
        take,
      }),
      this.prisma.voucher.findMany({
        where: {
          companyId: tenant.companyId,
          isCancelled: false,
          voucherType: { in: ["RECEIPT", "PAYMENT"] },
        },
        orderBy: { createdAt: "desc" },
        take,
      }),
      this.prisma.scheduledReminderLog.findMany({
        where: { companyId: tenant.companyId },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const activities: any[] = [];

    // Format sales invoices
    for (const inv of invoices) {
      activities.push({
        id: `inv-${inv.id}`,
        type: "INVOICE_ISSUED",
        category: "SALES",
        title: `Invoice #${inv.invoiceNumber}`,
        description: `Issued to ${inv.party?.name || "Customer"}`,
        amount: Number(inv.grandTotal),
        currency: "INR",
        partyName: inv.party?.name || "Customer",
        timestamp: inv.createdAt,
        status: inv.status,
        entityType: "SALES_INVOICE",
        entityId: inv.id,
        deepLink: `/sales/invoices/${inv.id}`,
      });
    }

    // Format vouchers
    for (const vch of vouchers) {
      const isReceipt = vch.voucherType === "RECEIPT";
      activities.push({
        id: `vch-${vch.id}`,
        type: isReceipt ? "PAYMENT_RECEIVED" : "PAYMENT_SENT",
        category: "PAYMENT",
        title: isReceipt
          ? `Payment Received #${vch.voucherNumber}`
          : `Payment Sent #${vch.voucherNumber}`,
        description: vch.narration || (isReceipt ? "Customer Payment" : "Supplier Payment"),
        amount: Number(vch.totalAmount),
        currency: "INR",
        partyName: isReceipt ? "Customer" : "Payee",
        timestamp: vch.createdAt,
        status: "COMPLETED",
        entityType: isReceipt ? "SALES_PAYMENT" : "PURCHASE_PAYMENT",
        entityId: vch.id,
        deepLink: isReceipt
          ? `/sales/payment-in/${vch.id}`
          : `/purchases/payment-out/${vch.id}`,
      });
    }

    // Format reminders
    for (const rem of reminders) {
      const isSales = rem.entityType === "SALES_INVOICE";
      activities.push({
        id: `rem-${rem.id}`,
        type: isSales ? "INVOICE_DUE_REMINDER" : "PURCHASE_DUE_REMINDER",
        category: "REMINDER",
        title: isSales ? "Sales Invoice Due in 3 Days" : "Purchase Bill Due in 3 Days",
        description: `Outstanding balance of ₹${Number(rem.outstandingAmount).toLocaleString("en-IN")}`,
        amount: Number(rem.outstandingAmount),
        currency: "INR",
        partyName: isSales ? "Customer" : "Supplier",
        timestamp: rem.createdAt,
        status: rem.status,
        entityType: rem.entityType,
        entityId: rem.entityId,
        deepLink: isSales ? `/sales/invoices/${rem.entityId}` : `/purchases/${rem.entityId}`,
      });
    }

    // Sort combined feed by timestamp newest first
    activities.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    return activities.slice(0, take);
  }

  /**
   * Evaluates due date on creation or update of a sales invoice and sends immediate notification if due within 7 days or today.
   */
  async triggerInvoiceDueReminder(invoice: {
    id: string;
    invoiceNumber: string;
    dueDate: Date | string;
    balanceAmount: number | string | any;
    partyName?: string;
    organizationId: string;
    companyId: string;
  }) {
    const outstanding = Number(invoice.balanceAmount);
    if (outstanding <= 0 || !invoice.dueDate) return null;

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const rawDue = new Date(invoice.dueDate);
    const dueUtc = new Date(Date.UTC(rawDue.getUTCFullYear(), rawDue.getUTCMonth(), rawDue.getUTCDate()));
    const diffDays = Math.round((dueUtc.getTime() - todayUtc.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0 || diffDays > 7) {
      return null;
    }

    const reminderType = diffDays === 0 ? "DUE_TODAY" : (diffDays <= 3 ? "T_MINUS_3" : "T_MINUS_7");
    const existingLog = await this.prisma.scheduledReminderLog.findUnique({
      where: {
        companyId_entityType_entityId_reminderType_dueDate: {
          companyId: invoice.companyId,
          entityType: "SALES_INVOICE",
          entityId: invoice.id,
          reminderType,
          dueDate: dueUtc,
        },
      },
    });

    if (existingLog) return null;

    const partyName = invoice.partyName || "Customer";
    const formattedAmount = `₹${outstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
    const dueDateString = dueUtc.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const title = diffDays === 0 ? "Invoice Due Today" : `Invoice Due in ${diffDays} Day(s)`;
    const message = diffDays === 0
      ? `Invoice Due Today: ${partyName} — ${invoice.invoiceNumber} — Outstanding ${formattedAmount} — Due Today (${dueDateString}).`
      : `Invoice Due in ${diffDays} Day(s): ${partyName} — ${invoice.invoiceNumber} — Outstanding ${formattedAmount} — Due ${dueDateString}.`;

    const created = await this.createNotification({
      organizationId: invoice.organizationId,
      companyId: invoice.companyId,
      type: NotificationType.INVOICE_DUE_REMINDER,
      title,
      message,
      entityType: "SALES_INVOICE",
      entityId: invoice.id,
      data: {
        invoiceNumber: invoice.invoiceNumber,
        partyName,
        outstandingAmount: outstanding,
        currency: "INR",
        dueDate: invoice.dueDate,
        reminderType,
        daysRemaining: diffDays,
        action: "OPEN_INVOICE",
      },
      deepLink: `/sales/invoices/${invoice.id}`,
    });

    await this.prisma.scheduledReminderLog.create({
      data: {
        organizationId: invoice.organizationId,
        companyId: invoice.companyId,
        entityType: "SALES_INVOICE",
        entityId: invoice.id,
        reminderType,
        dueDate: dueUtc,
        status: "SENT",
        outstandingAmount: outstanding,
        notificationId: created[0]?.id || null,
      },
    });

    return created;
  }

  /**
   * Evaluates due date on creation or update of a purchase bill and sends immediate notification if due within 7 days or today.
   */
  async triggerPurchaseDueReminder(bill: {
    id: string;
    vendorInvoiceNumber: string;
    dueDate: Date | string;
    balanceAmount: number | string | any;
    partyName?: string;
    organizationId: string;
    companyId: string;
  }) {
    const outstanding = Number(bill.balanceAmount);
    if (outstanding <= 0 || !bill.dueDate) return null;

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const rawDue = new Date(bill.dueDate);
    const dueUtc = new Date(Date.UTC(rawDue.getUTCFullYear(), rawDue.getUTCMonth(), rawDue.getUTCDate()));
    const diffDays = Math.round((dueUtc.getTime() - todayUtc.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0 || diffDays > 7) {
      return null;
    }

    const reminderType = diffDays === 0 ? "DUE_TODAY" : (diffDays <= 3 ? "T_MINUS_3" : "T_MINUS_7");
    const existingLog = await this.prisma.scheduledReminderLog.findUnique({
      where: {
        companyId_entityType_entityId_reminderType_dueDate: {
          companyId: bill.companyId,
          entityType: "PURCHASE_INVOICE",
          entityId: bill.id,
          reminderType,
          dueDate: dueUtc,
        },
      },
    });

    if (existingLog) return null;

    const partyName = bill.partyName || "Supplier";
    const formattedAmount = `₹${outstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
    const dueDateString = dueUtc.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const title = diffDays === 0 ? "Purchase Bill Due Today" : `Purchase Bill Due in ${diffDays} Day(s)`;
    const message = diffDays === 0
      ? `Purchase Bill Due Today: ${partyName} — ${bill.vendorInvoiceNumber} — Payable ${formattedAmount} — Due Today (${dueDateString}).`
      : `Purchase Bill Due in ${diffDays} Day(s): ${partyName} — ${bill.vendorInvoiceNumber} — Payable ${formattedAmount} — Due ${dueDateString}.`;

    const created = await this.createNotification({
      organizationId: bill.organizationId,
      companyId: bill.companyId,
      type: NotificationType.PURCHASE_DUE_REMINDER,
      title,
      message,
      entityType: "PURCHASE_INVOICE",
      entityId: bill.id,
      data: {
        vendorInvoiceNumber: bill.vendorInvoiceNumber,
        partyName,
        payableAmount: outstanding,
        currency: "INR",
        dueDate: bill.dueDate,
        reminderType,
        daysRemaining: diffDays,
        action: "OPEN_PURCHASE_BILL",
      },
      deepLink: `/purchases/${bill.id}`,
    });

    await this.prisma.scheduledReminderLog.create({
      data: {
        organizationId: bill.organizationId,
        companyId: bill.companyId,
        entityType: "PURCHASE_INVOICE",
        entityId: bill.id,
        reminderType,
        dueDate: dueUtc,
        status: "SENT",
        outstandingAmount: outstanding,
        notificationId: created[0]?.id || null,
      },
    });

    return created;
  }

  /**
   * Scans company's sales invoices and purchase bills for pending dues:
   * - DUE_TODAY (0 days remaining)
   * - T_MINUS_3 (3 days remaining)
   * - T_MINUS_7 (7 days remaining)
   * Ensures separate notifications are generated when due date reaches today even if previously notified at 7 or 3 days.
   */
  async syncDueRemindersForCompany(
    companyId: string,
    organizationId?: string,
  ): Promise<{
    salesRemindersCreated: number;
    purchaseRemindersCreated: number;
  }> {
    let salesRemindersCreated = 0;
    let purchaseRemindersCreated = 0;

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const horizon7Days = new Date(todayUtc);
    horizon7Days.setUTCDate(horizon7Days.getUTCDate() + 7);
    horizon7Days.setUTCHours(23, 59, 59, 999);

    let resolvedOrgId = organizationId;
    if (!resolvedOrgId) {
      const comp = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { organizationId: true },
      });
      resolvedOrgId = comp?.organizationId;
    }
    if (!resolvedOrgId) return { salesRemindersCreated: 0, purchaseRemindersCreated: 0 };

    // 1. Sales Invoices
    const salesInvoices = await this.prisma.salesInvoice.findMany({
      where: {
        companyId,
        status: { notIn: ["CANCELLED", "DRAFT", "PAID"] },
        balanceAmount: { gt: 0 },
        dueDate: {
          not: null,
          gte: todayUtc,
          lte: horizon7Days,
        },
      },
      include: { party: true },
    });

    for (const inv of salesInvoices) {
      const outstanding = Number(inv.balanceAmount);
      if (outstanding <= 0 || !inv.dueDate) continue;

      const rawDue = new Date(inv.dueDate);
      const dueUtc = new Date(Date.UTC(rawDue.getUTCFullYear(), rawDue.getUTCMonth(), rawDue.getUTCDate()));
      const diffDays = Math.round((dueUtc.getTime() - todayUtc.getTime()) / (1000 * 60 * 60 * 24));

      // Handle Today (0), in 3 days (3), or in 7 days (7)
      if (diffDays !== 0 && diffDays !== 3 && diffDays !== 7) continue;

      const reminderType = diffDays === 0 ? "DUE_TODAY" : (diffDays === 3 ? "T_MINUS_3" : "T_MINUS_7");

      const existingLog = await this.prisma.scheduledReminderLog.findUnique({
        where: {
          companyId_entityType_entityId_reminderType_dueDate: {
            companyId,
            entityType: "SALES_INVOICE",
            entityId: inv.id,
            reminderType,
            dueDate: dueUtc,
          },
        },
      });

      if (existingLog) continue;

      const partyName = inv.party?.name || "Customer";
      const formattedAmount = `₹${outstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
      const dueDateString = dueUtc.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      const title = diffDays === 0 ? "Invoice Due Today" : `Invoice Due in ${diffDays} Days`;
      const message = diffDays === 0
        ? `Invoice Due Today: ${partyName} — ${inv.invoiceNumber} — Outstanding ${formattedAmount} — Due Today (${dueDateString}).`
        : `Invoice Due in ${diffDays} Days: ${partyName} — ${inv.invoiceNumber} — Outstanding ${formattedAmount} — Due ${dueDateString}.`;

      const created = await this.createNotification({
        organizationId: resolvedOrgId,
        companyId,
        type: NotificationType.INVOICE_DUE_REMINDER,
        title,
        message,
        entityType: "SALES_INVOICE",
        entityId: inv.id,
        data: {
          invoiceNumber: inv.invoiceNumber,
          partyName,
          outstandingAmount: outstanding,
          currency: "INR",
          dueDate: inv.dueDate,
          reminderType,
          daysRemaining: diffDays,
          action: "OPEN_INVOICE",
        },
        deepLink: `/sales/invoices/${inv.id}`,
      });

      await this.prisma.scheduledReminderLog.create({
        data: {
          organizationId: resolvedOrgId,
          companyId,
          entityType: "SALES_INVOICE",
          entityId: inv.id,
          reminderType,
          dueDate: dueUtc,
          status: "SENT",
          outstandingAmount: outstanding,
          notificationId: created[0]?.id || null,
        },
      });

      salesRemindersCreated++;
    }

    // 2. Purchase Invoices
    const purchaseInvoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        balanceAmount: { gt: 0 },
        dueDate: {
          not: null,
          gte: todayUtc,
          lte: horizon7Days,
        },
      },
      include: { party: true },
    });

    for (const bill of purchaseInvoices) {
      const outstanding = Number(bill.balanceAmount);
      if (outstanding <= 0 || !bill.dueDate) continue;

      const rawDue = new Date(bill.dueDate);
      const dueUtc = new Date(Date.UTC(rawDue.getUTCFullYear(), rawDue.getUTCMonth(), rawDue.getUTCDate()));
      const diffDays = Math.round((dueUtc.getTime() - todayUtc.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays !== 0 && diffDays !== 3 && diffDays !== 7) continue;

      const reminderType = diffDays === 0 ? "DUE_TODAY" : (diffDays === 3 ? "T_MINUS_3" : "T_MINUS_7");

      const existingLog = await this.prisma.scheduledReminderLog.findUnique({
        where: {
          companyId_entityType_entityId_reminderType_dueDate: {
            companyId,
            entityType: "PURCHASE_INVOICE",
            entityId: bill.id,
            reminderType,
            dueDate: dueUtc,
          },
        },
      });

      if (existingLog) continue;

      const partyName = bill.party?.name || "Supplier";
      const formattedAmount = `₹${outstanding.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
      const dueDateString = dueUtc.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      const title = diffDays === 0 ? "Purchase Bill Due Today" : `Purchase Bill Due in ${diffDays} Days`;
      const message = diffDays === 0
        ? `Purchase Bill Due Today: ${partyName} — ${bill.vendorInvoiceNumber} — Payable ${formattedAmount} — Due Today (${dueDateString}).`
        : `Purchase Bill Due in ${diffDays} Days: ${partyName} — ${bill.vendorInvoiceNumber} — Payable ${formattedAmount} — Due ${dueDateString}.`;

      const created = await this.createNotification({
        organizationId: resolvedOrgId,
        companyId,
        type: NotificationType.PURCHASE_DUE_REMINDER,
        title,
        message,
        entityType: "PURCHASE_INVOICE",
        entityId: bill.id,
        data: {
          vendorInvoiceNumber: bill.vendorInvoiceNumber,
          partyName,
          payableAmount: outstanding,
          currency: "INR",
          dueDate: bill.dueDate,
          reminderType,
          daysRemaining: diffDays,
          action: "OPEN_PURCHASE_BILL",
        },
        deepLink: `/purchases/${bill.id}`,
      });

      await this.prisma.scheduledReminderLog.create({
        data: {
          organizationId: resolvedOrgId,
          companyId,
          entityType: "PURCHASE_INVOICE",
          entityId: bill.id,
          reminderType,
          dueDate: dueUtc,
          status: "SENT",
          outstandingAmount: outstanding,
          notificationId: created[0]?.id || null,
        },
      });

      purchaseRemindersCreated++;
    }

    return { salesRemindersCreated, purchaseRemindersCreated };
  }
}
