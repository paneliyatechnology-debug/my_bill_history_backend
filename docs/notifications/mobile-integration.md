# MyOwnBillBook Mobile Developer Integration Guide

This guide is designed for Flutter, React Native, iOS (Swift), and Android (Kotlin) developers building mobile applications that connect to the MyOwnBillBook notification backend.

---

## 1. Device Token Registration Lifecycle

```
[Mobile App Launch]
        │
        ▼
[Request Push Permission (FCM / APNs)]
        │
        ├─ Permission Denied ──> Store local flag (Push disabled)
        │
        ▼ (Permission Granted)
[Obtain Device Push Token]
        │
        ▼
[User Authenticated with JWT & Tenant Headers]
        │
        ▼
[POST /api/v1/notifications/devices]
  - platform: "ANDROID" | "IOS"
  - provider: "FCM" | "APNS"
  - token: <push_token>
  - deviceId: <unique_hardware_id>
  - deviceName: <device_model>
        │
        ▼
[Store device.id in Secure Storage]
```

### 1.1 Token Refresh
Whenever FCM or APNs triggers a `onTokenRefresh` / `messaging().onTokenRefresh` callback:
1. Re-call `POST /api/v1/notifications/devices` with the new token.
2. The server handles this idempotently by updating the existing device record for the authenticated user and setting `lastSeenAt = now()`.

### 1.2 User Logout / Tenant Switch
When the user logs out:
1. Call `DELETE /api/v1/notifications/devices/:deviceId` to deactivate the device registration.
2. Clear the stored `deviceId` from local secure storage.

---

## 2. Notification Reception & States

### 2.1 State Handling Matrix
| App State | Push Behavior | Deep Linking Action |
| :--- | :--- | :--- |
| **Foreground** | App receives push in background/foreground handler; displays an in-app banner or toast. Refresh unread badge via `GET /api/v1/notifications/unread-count`. | Tapping in-app toast triggers navigation to `deepLink`. |
| **Background** | OS displays system notification from notification tray. | Tapping tray notification launches app, reads `data.deepLink` from payload, and pushes screen to navigation stack. |
| **Terminated (Killed)** | OS displays notification tray alert. | Tapping alert cold-starts app. Native initial notification listener retrieves payload and navigates once main router is ready. |

---

## 3. Deep Link Route Mapping

Mobile routers must support the following standard routes matching the web application:

| `entityType` | `deepLink` Pattern | Target Mobile Screen |
| :--- | :--- | :--- |
| `SALES_PAYMENT` | `/sales/payment-in/:id` | Receipt / Payment In Details Screen |
| `SALES_INVOICE` | `/sales/invoices/:id` | Sales Invoice Preview Screen |
| `PURCHASE_PAYMENT` | `/purchases/payment-out/:id` | Payment Out Details Screen |
| `PURCHASE_INVOICE` | `/purchases/:id` | Purchase Bill Preview Screen |
| `STAFF_PAYMENT` | `/payroll` | Staff Payroll & Advance Screen |
| `EXPENSE_VOUCHER` | `/expenses/:id` | Expense Details Screen |
| `VOUCHER` | `/accounting/vouchers` | Vouchers List / Audit Screen |

---

## 4. Code Snippets for Mobile Frameworks

### 4.1 React Native (Firebase Messaging)
```typescript
import messaging from '@react-native-firebase/messaging';
import axios from 'axios';

// 1. Register device after user login
export async function registerPushDevice(authToken: string, companyId: string, orgId: string) {
  const authStatus = await messaging().requestPermission();
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL;

  if (!enabled) return;

  const token = await messaging().getToken();

  const response = await axios.post(
    'https://api.myownbillbook.com/api/v1/notifications/devices',
    {
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
      provider: 'FCM',
      token,
      deviceName: `${Platform.OS} Mobile App`,
      appVersion: '1.0.0',
    },
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'x-organization-id': orgId,
        'x-company-id': companyId,
      },
    }
  );

  return response.data;
}

// 2. Handle background & notification click
messaging().onNotificationOpenedApp(remoteMessage => {
  const deepLink = remoteMessage.data?.deepLink;
  if (deepLink) {
    navigateFromDeepLink(deepLink);
  }
});
```

### 4.2 Flutter (firebase_messaging)
```dart
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'dart:io';

Future<void> registerDeviceWithBackend({
  required String authToken,
  required String orgId,
  required String companyId,
}) async {
  FirebaseMessaging messaging = FirebaseMessaging.instance;
  NotificationSettings settings = await messaging.requestPermission(
    alert: true,
    badge: true,
    sound: true,
  );

  if (settings.authorizationStatus != AuthorizationStatus.authorized) return;

  String? token = await messaging.getToken();
  if (token == null) return;

  final response = await http.post(
    Uri.parse('https://api.myownbillbook.com/api/v1/notifications/devices'),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $authToken',
      'x-organization-id': orgId,
      'x-company-id': companyId,
    },
    body: jsonEncode({
      'platform': Platform.isIOS ? 'IOS' : 'ANDROID',
      'provider': 'FCM',
      'token': token,
      'appVersion': '1.0.0',
    }),
  );
}
```

---

## 5. Testing & Debugging

1. **Check device registration in DB**:
   Query `notification_devices` table for `userId` to confirm `isActive = true` and `lastSeenAt` is recent.
2. **Simulate a payment received event**:
   Post a payment receipt via Web UI or `POST /api/v1/invoices/:id/payments`.
3. **Verify push delivery logs**:
   Query `notification_deliveries` table to inspect the delivery attempt status (`SENT` / `FAILED`) and `lastErrorMessage`.

