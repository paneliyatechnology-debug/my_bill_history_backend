import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/database/database.service";
import { NotificationsService } from "../src/notifications/notifications.service";
import { ReminderSchedulerService } from "../src/notifications/reminder-scheduler.service";
import { DashboardService } from "../src/dashboard/dashboard.service";
import { NotificationType, DevicePlatform, PushProvider } from "@prisma/client";
import { TenantContext } from "@billing/shared-types";

describe("Notifications & Reminders Test Suite", () => {
  let prisma: DatabaseService;
  let notificationsService: NotificationsService;
  let reminderScheduler: ReminderSchedulerService;
  let dashboardService: DashboardService;

  // Real company in the database: JK
  const companyId = "92967a06-d488-4794-bae1-e6188e8fb47d";
  const organizationId = "3127cc52-2797-4dc2-a9d3-55ba236c8d55";
  const branchId = "96ceb02c-5439-4144-b323-e0d7748c3db0";
  const userId = "ec46866d-7d8e-4119-bba5-0044d0fce8de";

  const tenant: TenantContext = {
    userId,
    organizationId,
    companyId,
    branchId,
  };

  const otherTenant: TenantContext = {
    userId: "00000000-0000-0000-0000-000000000099",
    organizationId: "00000000-0000-0000-0000-000000000098",
    companyId: "00000000-0000-0000-0000-000000000097",
    branchId: "00000000-0000-0000-0000-000000000096",
  };

  let testNotificationId: string;
  let testDeviceId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    prisma = moduleRef.get(DatabaseService);
    notificationsService = moduleRef.get(NotificationsService);
    reminderScheduler = moduleRef.get(ReminderSchedulerService);
    dashboardService = moduleRef.get(DashboardService);

    // Reset preferences for clean test run
    await prisma.notificationPreference.deleteMany({
      where: { companyId, userId },
    });
  });

  afterAll(async () => {
    // Clean up created test notifications and devices
    try {
      if (testDeviceId) {
        await prisma.notificationDevice.deleteMany({ where: { id: testDeviceId } });
      }
      if (testNotificationId) {
        await prisma.notificationDelivery.deleteMany({ where: { notificationId: testNotificationId } });
        await prisma.notification.deleteMany({ where: { id: testNotificationId } });
      }
      await prisma.notification.deleteMany({
        where: {
          title: { in: ["Test Payment Received", "Test Payment Sent", "Test Due Reminder"] },
        },
      });
    } catch (_) {}
  });

  it("1. Should create a persistent in-app PAYMENT_RECEIVED notification with real company context", async () => {
    const [notif] = await notificationsService.createNotification({
      organizationId,
      companyId,
      userId,
      type: NotificationType.PAYMENT_RECEIVED,
      title: "Test Payment Received",
      message: "Payment Received: ₹15,000.00 from Test Customer via NEFT.",
      entityType: "SALES_PAYMENT",
      entityId: "11111111-1111-1111-1111-111111111111",
      data: {
        amount: 15000,
        partyName: "Test Customer",
        paymentMode: "BANK_TRANSFER",
      },
      deepLink: "/sales/payment-in/11111111-1111-1111-1111-111111111111",
    });

    expect(notif).toBeDefined();
    expect(notif.id).toBeDefined();
    expect(notif.type).toBe(NotificationType.PAYMENT_RECEIVED);
    expect(notif.isRead).toBe(false);
    expect(notif.companyId).toBe(companyId);
    testNotificationId = notif.id;
  });

  it("2. Should retrieve unread count and paginated list with real database query", async () => {
    const { unreadCount } = await notificationsService.getUnreadCount(tenant);
    expect(unreadCount).toBeGreaterThanOrEqual(1);

    const result = await notificationsService.getNotifications(
      { page: 1, limit: 10, isRead: false },
      tenant,
    );
    expect(result.data).toBeDefined();
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    expect(result.unreadCount).toBeGreaterThanOrEqual(1);

    const found = result.data.find((n: any) => n.id === testNotificationId);
    expect(found).toBeDefined();
    expect(found?.title).toBe("Test Payment Received");
  });

  it("3. Should mark single notification as read and update unread count", async () => {
    const updated = await notificationsService.markAsRead(testNotificationId, tenant);
    expect(updated.isRead).toBe(true);
    expect(updated.readAt).toBeDefined();

    // Verify through unread count query
    const res = await notificationsService.getNotifications(
      { page: 1, limit: 10, isRead: true },
      tenant,
    );
    const marked = res.data.find((n: any) => n.id === testNotificationId);
    expect(marked?.isRead).toBe(true);
  });

  it("4. Should mark all notifications as read for current user and company", async () => {
    // Create another unread notification first
    await notificationsService.createNotification({
      organizationId,
      companyId,
      userId,
      type: NotificationType.PAYMENT_SENT,
      title: "Test Payment Sent",
      message: "Payment Sent: ₹8,000.00 to Test Vendor.",
      entityType: "PURCHASE_PAYMENT",
    });

    const result = await notificationsService.markAllAsRead(tenant);
    expect(result.count).toBeGreaterThanOrEqual(1);

    const { unreadCount: unreadAfter } = await notificationsService.getUnreadCount(tenant);
    expect(unreadAfter).toBe(0);
  });

  it("5. Should register device for web push and mobile push", async () => {
    const device = await notificationsService.registerDevice(
      {
        token: "test-fcm-device-token-abc123xyz",
        platform: DevicePlatform.ANDROID,
        provider: PushProvider.FCM,
        deviceName: "Test Android Device Pixel 8",
        appVersion: "1.0.0",
      },
      tenant,
    );

    expect(device).toBeDefined();
    expect(device.id).toBeDefined();
    expect(device.token).toBe("test-fcm-device-token-abc123xyz");
    expect(device.isActive).toBe(true);
    testDeviceId = device.id;

    // Re-registering same token updates lastSeenAt without duplicate
    const reRegistered = await notificationsService.registerDevice(
      {
        token: "test-fcm-device-token-abc123xyz",
        platform: DevicePlatform.ANDROID,
        provider: PushProvider.FCM,
      },
      tenant,
    );
    expect(reRegistered.id).toBe(device.id);
  });

  it("6. Should update notification preferences for user", async () => {
    const prefs = await notificationsService.updatePreferences(
      {
        paymentReceivedPush: true,
        paymentSentPush: false,
        dueReminderT3Push: true,
        dueReminderOverduePush: true,
      },
      tenant,
    );

    expect(prefs).toBeDefined();
    expect(prefs.paymentReceivedPush).toBe(true);
    expect(prefs.paymentSentPush).toBe(false);

    const fetchedPrefs = await notificationsService.getPreferences(tenant);
    expect(fetchedPrefs.paymentSentPush).toBe(false);
  });

  it("7. Should scan due dates (T-3 days) with duplicate prevention log", async () => {
    const scanResult = await reminderScheduler.runDueRemindersScan();
    expect(scanResult).toBeDefined();
    expect(typeof scanResult.salesRemindersCreated).toBe("number");
    expect(typeof scanResult.purchaseRemindersCreated).toBe("number");

    // Second immediate scan on same day must be idempotent (0 new duplicates created)
    const scanResult2 = await reminderScheduler.runDueRemindersScan();
    expect(scanResult2.salesRemindersCreated).toBe(0);
    expect(scanResult2.purchaseRemindersCreated).toBe(0);
  });

  it("8. Strict Multi-Tenant Isolation: other tenant cannot see or mutate notifications", async () => {
    const otherList = await notificationsService.getNotifications(
      { page: 1, limit: 10 },
      otherTenant,
    );
    const leaked = (otherList.data || []).find((n: any) => n.id === testNotificationId);
    expect(leaked).toBeUndefined();

    const { unreadCount: otherUnread } = await notificationsService.getUnreadCount(otherTenant);
    expect(otherUnread).toBe(0);

    // Cannot mark another company's notification as read
    await expect(
      notificationsService.markAsRead(testNotificationId, otherTenant),
    ).rejects.toThrow();
  });

  it("9. Should query upcoming dues (next 3 days & overdue) via dashboard service", async () => {
    // 1. ALL dues (both sales and purchases)
    const res = await dashboardService.getUpcomingDues(tenant, 3, "ALL");
    expect(res).toBeDefined();
    expect(Array.isArray(res.dues)).toBe(true);
    expect(typeof res.totalOverdueAmount).toBe("number");
    expect(typeof res.totalDueSoonAmount).toBe("number");
    expect(typeof res.totalDueAmount).toBe("number");
    expect(typeof res.count).toBe("number");
    expect(res.salesCount).toBeGreaterThanOrEqual(2);
    expect(res.purchaseCount).toBeGreaterThanOrEqual(2);
    expect(res.count).toBe(res.salesCount + res.purchaseCount);

    // All items returned must have daysRemaining <= 3 and balanceAmount > 0
    for (const due of res.dues) {
      expect(due.daysRemaining).toBeLessThanOrEqual(3);
      expect(due.balanceAmount).toBeGreaterThan(0);
      expect(due.partyName).toBeDefined();
      expect(due.deepLink).toBeDefined();
      expect(["SALES_INVOICE", "PURCHASE_INVOICE"]).toContain(due.type);
    }

    // 2. SALES only filter
    const salesRes = await dashboardService.getUpcomingDues(tenant, 3, "SALES");
    expect(salesRes.dues.every((d) => d.type === "SALES_INVOICE")).toBe(true);
    expect(salesRes.purchaseCount).toBe(0);
    expect(salesRes.count).toBe(salesRes.salesCount);

    // 3. PURCHASES only filter
    const purchaseRes = await dashboardService.getUpcomingDues(tenant, 3, "PURCHASES");
    expect(purchaseRes.dues.every((d) => d.type === "PURCHASE_INVOICE")).toBe(true);
    expect(purchaseRes.salesCount).toBe(0);
    expect(purchaseRes.count).toBe(purchaseRes.purchaseCount);
  });

  it("10. Unified listing API: should return both read & unread with counts and supports status/string query filters", async () => {
    // Create one unread notification
    const [unreadNotif] = await notificationsService.createNotification({
      organizationId,
      companyId,
      userId,
      type: NotificationType.PAYMENT_RECEIVED,
      title: "Test Payment Received For Read/Unread Test",
      message: "Unread notification test message.",
    });

    // Create a notification and mark it as read
    const [readNotif] = await notificationsService.createNotification({
      organizationId,
      companyId,
      userId,
      type: NotificationType.PAYMENT_RECEIVED,
      title: "Test Payment Received For Read Notif",
      message: "Read notification test message.",
    });
    await notificationsService.markAsRead(readNotif.id, tenant);

    // 1. Single API call returns both read and unread lists and respective counts
    const allRes = await notificationsService.getNotifications(tenant, { page: 1, limit: 50 });
    expect(allRes.items).toBeDefined();
    expect(allRes.data).toBeDefined();
    expect(Array.isArray(allRes.unread)).toBe(true);
    expect(Array.isArray(allRes.read)).toBe(true);
    expect(allRes.unreadCount).toBeGreaterThanOrEqual(1);
    expect(allRes.readCount).toBeGreaterThanOrEqual(1);
    expect(allRes.total).toBeGreaterThanOrEqual(2);
    expect(allRes.unread.some((n: any) => n.id === unreadNotif.id)).toBe(true);
    expect(allRes.read.some((n: any) => n.id === readNotif.id)).toBe(true);

    // 2. Query with status="unread"
    const unreadRes = await notificationsService.getNotifications(tenant, { status: "unread" });
    expect(unreadRes.items.every((n: any) => n.isRead === false)).toBe(true);
    expect(unreadRes.items.some((n: any) => n.id === unreadNotif.id)).toBe(true);
    expect(unreadRes.items.some((n: any) => n.id === readNotif.id)).toBe(false);

    // 3. Query with string isRead="false" (from HTTP query param)
    const isReadFalseRes = await notificationsService.getNotifications(tenant, { isRead: "false" as any });
    expect(isReadFalseRes.items.every((n: any) => n.isRead === false)).toBe(true);
    expect(isReadFalseRes.items.some((n: any) => n.id === unreadNotif.id)).toBe(true);
    expect(isReadFalseRes.items.some((n: any) => n.id === readNotif.id)).toBe(false);

    // 4. Query with status="read"
    const readRes = await notificationsService.getNotifications(tenant, { status: "read" });
    expect(readRes.items.every((n: any) => n.isRead === true)).toBe(true);
    expect(readRes.items.some((n: any) => n.id === readNotif.id)).toBe(true);
    expect(readRes.items.some((n: any) => n.id === unreadNotif.id)).toBe(false);

    // 5. Query with string isRead="true" (from HTTP query param)
    const isReadTrueRes = await notificationsService.getNotifications(tenant, { isRead: "true" as any });
    expect(isReadTrueRes.items.every((n: any) => n.isRead === true)).toBe(true);
    expect(isReadTrueRes.items.some((n: any) => n.id === readNotif.id)).toBe(true);
    expect(isReadTrueRes.items.some((n: any) => n.id === unreadNotif.id)).toBe(false);

    // Clean up
    await prisma.notification.deleteMany({
      where: { id: { in: [unreadNotif.id, readNotif.id] } },
    });
  });

  it("11. Should mark notification as unread and update via unified updateNotification endpoint", async () => {
    // Create a notification
    const [notif] = await notificationsService.createNotification({
      organizationId,
      companyId,
      userId,
      type: NotificationType.PAYMENT_RECEIVED,
      title: "Test Toggle Read/Unread",
      message: "Testing toggle status.",
    });

    // Mark as read
    const markedRead = await notificationsService.markAsRead(notif.id, tenant);
    expect(markedRead.isRead).toBe(true);
    expect(markedRead.readAt).not.toBeNull();

    // Mark as unread using markAsUnread
    const markedUnread = await notificationsService.markAsUnread(notif.id, tenant);
    expect(markedUnread.isRead).toBe(false);
    expect(markedUnread.readAt).toBeNull();

    // Update using unified updateNotification({ isRead: true })
    const updatedToRead = await notificationsService.updateNotification(
      notif.id,
      { isRead: true },
      tenant,
    );
    expect(updatedToRead.isRead).toBe(true);
    expect(updatedToRead.readAt).not.toBeNull();

    // Update using unified updateNotification({ isRead: false })
    const updatedToUnread = await notificationsService.updateNotification(
      notif.id,
      { isRead: false },
      tenant,
    );
    expect(updatedToUnread.isRead).toBe(false);
    expect(updatedToUnread.readAt).toBeNull();

    // Mark all as read then mark all as unread
    await notificationsService.markAllAsRead(tenant);
    const unreadCountAfterReadAll = await notificationsService.getUnreadCount(tenant);
    expect(unreadCountAfterReadAll.unreadCount).toBe(0);

    const markAllUnreadRes = await notificationsService.markAllAsUnread(tenant);
    expect(markAllUnreadRes.success).toBe(true);
    expect(markAllUnreadRes.count).toBeGreaterThanOrEqual(1);

    const unreadCountAfterUnreadAll = await notificationsService.getUnreadCount(tenant);
    expect(unreadCountAfterUnreadAll.unreadCount).toBeGreaterThanOrEqual(1);

    // Clean up
    await prisma.notification.deleteMany({
      where: { id: notif.id },
    });
  });
});
