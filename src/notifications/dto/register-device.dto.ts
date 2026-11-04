export interface RegisterDeviceDto {
  platform: "WEB" | "ANDROID" | "IOS";
  provider: "WEB_PUSH" | "FCM" | "APNS";
  token?: string; // FCM/APNs mobile device token
  endpoint?: string; // Web Push subscription endpoint
  keys?: {
    p256dh: string;
    auth: string;
  };
  deviceId?: string;
  appVersion?: string;
}

