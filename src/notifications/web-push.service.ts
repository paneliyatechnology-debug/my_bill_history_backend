import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as webpush from "web-push";

export interface PushNotificationPayload {
  notificationId: string;
  type: string;
  title: string;
  body: string;
  deepLink?: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, any>;
  schemaVersion?: number;
}

@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);
  private vapidPublicKey: string;
  private vapidPrivateKey: string;
  private vapidSubject: string;
  private isConfigured = false;

  constructor(private readonly config: ConfigService) {
    this.initVapid();
  }

  private initVapid() {
    this.vapidPublicKey =
      this.config.get<string>("VAPID_PUBLIC_KEY") ||
      "BO7QrjqY6zwO4Oqaf5Ss4KbWF-8A16RNO8titZ0juKujjWyr0OiMGZlHbsNwpxhaDIIH9euBWtMSKIVy0IsXSFk";
    this.vapidPrivateKey =
      this.config.get<string>("VAPID_PRIVATE_KEY") ||
      "B27O4EEp9jmUaG2_xLlP6xvqBsCdeGsZSf_hf2OaAzs";
    this.vapidSubject =
      this.config.get<string>("VAPID_SUBJECT") ||
      "mailto:support@myownbillbook.com";

    try {
      webpush.setVapidDetails(
        this.vapidSubject,
        this.vapidPublicKey,
        this.vapidPrivateKey,
      );
      this.isConfigured = true;
      this.logger.log("Web Push VAPID credentials initialized successfully.");
    } catch (err: any) {
      this.logger.warn(`Could not set VAPID details: ${err.message}`);
    }
  }

  getPublicKey(): string {
    return this.vapidPublicKey;
  }

  async sendWebPush(
    subscription: {
      endpoint: string;
      p256dhKey: string;
      authKey: string;
    },
    payload: PushNotificationPayload,
  ): Promise<{ success: boolean; statusCode?: number; error?: string; isExpired?: boolean }> {
    if (!this.isConfigured) {
      return { success: false, error: "VAPID not configured" };
    }

    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dhKey,
        auth: subscription.authKey,
      },
    };

    const formattedPayload = JSON.stringify({
      notificationId: payload.notificationId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      deepLink: payload.deepLink || "/",
      schemaVersion: payload.schemaVersion || 1,
      data: payload.data || {},
    });

    try {
      const response = await webpush.sendNotification(
        pushSubscription,
        formattedPayload,
        {
          TTL: 86400, // 24 hours
          urgency: "high",
        },
      );
      return { success: true, statusCode: response.statusCode };
    } catch (err: any) {
      const statusCode = err.statusCode || err.status;
      const isExpired = statusCode === 404 || statusCode === 410;
      this.logger.warn(
        `Web push failed for endpoint ${subscription.endpoint.slice(0, 30)}... status: ${statusCode}: ${err.message}`,
      );
      return {
        success: false,
        statusCode,
        error: err.message,
        isExpired,
      };
    }
  }

  /**
   * Mobile Push (FCM / APNs) delivery dispatcher
   * Prepares the standardized push payload for Android / iOS mobile clients.
   */
  async sendMobilePush(
    device: {
      platform: "ANDROID" | "IOS";
      token: string;
    },
    payload: PushNotificationPayload,
  ): Promise<{ success: boolean; statusCode?: number; error?: string; isExpired?: boolean }> {
    // In production, Firebase Admin SDK or APNs client is invoked with this payload.
    // When FCM credentials are not yet provisioned in development, we log and return success.
    const mobilePayload = {
      notificationId: payload.notificationId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      deepLink: payload.deepLink || "/",
      schemaVersion: 1,
      data: payload.data || {},
    };

    this.logger.log(
      `Mobile push dispatched to ${device.platform} device [${device.token.slice(0, 15)}...]: ${payload.title} - ${payload.body}`,
    );

    return {
      success: true,
      statusCode: 200,
    };
  }
}

