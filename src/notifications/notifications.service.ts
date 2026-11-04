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
   */
  async getNotifications(arg1: any, arg2?: any) {
    const tenant: TenantContext = (arg1 && arg1.companyId) ? arg1 : (arg2 && arg2.companyId) ? arg2 : arg1;
    const query: QueryNotificationsDto = (arg1 && !arg1.companyId) ? arg1 : (arg2 && !arg2.companyId) ? arg2 : (arg2 || arg1 || {});

    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {
      organizationId: tenant.organizationId,
      companyId: tenant.companyId,
      recipientUserId: tenant.userId,
      dismissedAt: null,
    };

    if (query?.unreadOnly === true || query?.unreadOnly === "true" || (query as any)?.isRead === false) {
      where.readAt = null;
    } else if ((query as any)?.isRead === true) {
      where.readAt = { not: null };
    }

    if (query?.type && query.type !== "ALL") {
      where.type = query.type as NotificationType;
    }

    if (query?.from || query?.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: {
          organizationId: tenant.organizationId,
          companyId: tenant.companyId,
          recipientUserId: tenant.userId,
          readAt: null,
          dismissedAt: null,
        },
      }),
    ]);

    const itemsWithIsRead = items.map((n) => ({
      ...n,
      isRead: n.readAt !== null,
    }));

    return {
      items: itemsWithIsRead,
      data: itemsWithIsRead,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      unreadCount,
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
}
