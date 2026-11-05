# MyOwnBillBook Notifications API Contract

This document provides the authoritative REST API specification for notifications, device registrations, user preferences, and dashboard activities in MyOwnBillBook.

---

## 1. Authentication & Common Headers

All notification endpoints require authentication via Bearer JWT token and tenant scoping headers.

```http
Authorization: Bearer <access_token>
x-organization-id: <organization_uuid>
x-company-id: <company_uuid>
x-branch-id: <branch_uuid> (optional)
Content-Type: application/json
```

---

## 2. Endpoints Reference

### 2.1 GET /api/v1/notifications
Retrieves paginated notifications for the authenticated user within the active company context.
Supports querying read, unread, or both in a single API call, returning separate `unread` and `read` arrays alongside total counts.

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `page` | integer | No | 1 | Page number (1-based) |
| `limit` | integer | No | 20 | Number of items per page (max 100) |
| `status` | string | No | `all` | Filter status: `unread`, `read`, or `all` |
| `isRead` | boolean / string | No | - | Filter by read state (`false` for unread, `true` for read) |
| `unreadOnly` | boolean / string | No | false | When `true`, filters to unread items only |
| `readOnly` | boolean / string | No | false | When `true`, filters to read items only |
| `type` | string | No | ALL | Event filter (`PAYMENT_RECEIVED`, `PAYMENT_SENT`, `DUE_DATE_REMINDER_T3`, etc.) |
| `from` | ISO date | No | - | Filter items created on or after date |
| `to` | ISO date | No | - | Filter items created on or before date |

**Success Response (200 OK):**
```json
{
  "items": [
    {
      "id": "e93297a7-59d4-4a57-8173-10d9cebc1748",
      "type": "PAYMENT_RECEIVED",
      "title": "Payment Received",
      "message": "Payment Received: ₹24,500.00 received from Patel Traders against Invoice INV-2026-0042. Remaining balance: ₹0.00.",
      "entityType": "SALES_PAYMENT",
      "entityId": "a1f9a2e8-46dc-4089-a5fe-00f81d4a0441",
      "data": {
        "amount": 24500,
        "currency": "INR",
        "partyName": "Patel Traders",
        "invoiceNumber": "INV-2026-0042",
        "remainingBalance": 0,
        "paymentMode": "BANK_TRANSFER",
        "referenceNumber": "NEFT-991204"
      },
      "deepLink": "/sales/payment-in/a1f9a2e8-46dc-4089-a5fe-00f81d4a0441",
      "readAt": null,
      "isRead": false,
      "createdAt": "2026-11-04T12:00:00.000Z"
    }
  ],
  "data": [ ... ],
  "unread": [ ... ],
  "read": [ ... ],
  "total": 45,
  "page": 1,
  "limit": 20,
  "totalPages": 3,
  "unreadCount": 4,
  "readCount": 41
}
```

---

### 2.2 GET /api/v1/notifications/unread-count
Returns the count of unread notifications for the active user. Highly lightweight for frequent badge polling.

**Success Response (200 OK):**
```json
{
  "unreadCount": 4
}
```

---

### 2.3 GET /api/v1/notifications/:id
Retrieves the details of a single notification.

**Success Response (200 OK):**
```json
{
  "id": "e93297a7-59d4-4a57-8173-10d9cebc1748",
  "type": "PAYMENT_RECEIVED",
  "title": "Payment Received",
  "message": "Payment Received: ₹24,500.00 received from Patel Traders against Invoice INV-2026-0042.",
  "entityType": "SALES_PAYMENT",
  "entityId": "a1f9a2e8-46dc-4089-a5fe-00f81d4a0441",
  "data": { ... },
  "deepLink": "/sales/payment-in/a1f9a2e8-46dc-4089-a5fe-00f81d4a0441",
  "readAt": null,
  "createdAt": "2026-11-04T12:00:00.000Z"
}
```

---

### 2.4 PATCH /api/v1/notifications/:id/read
Marks a single notification as read.

**Success Response (200 OK):**
```json
{
  "id": "e93297a7-59d4-4a57-8173-10d9cebc1748",
  "readAt": "2026-11-04T12:10:00.000Z",
  "isRead": true
}
```

---

### 2.5 PATCH /api/v1/notifications/:id/unread
Marks a single notification as unread (`readAt: null`).

**Success Response (200 OK):**
```json
{
  "id": "e93297a7-59d4-4a57-8173-10d9cebc1748",
  "readAt": null,
  "isRead": false
}
```

---

### 2.6 PATCH /api/v1/notifications/:id
Unified status update endpoint to toggle or explicitly set notification read or unread state in one API.

**Request Body:**
```json
{
  "isRead": false
}
```

**Success Response (200 OK):**
```json
{
  "id": "e93297a7-59d4-4a57-8173-10d9cebc1748",
  "readAt": null,
  "isRead": false
}
```

---

### 2.7 PATCH /api/v1/notifications/read-all
Marks all unread notifications as read for the user in the company.

**Success Response (200 OK):**
```json
{
  "success": true,
  "count": 4
}
```

---

### 2.8 PATCH /api/v1/notifications/unread-all
Marks all notifications as unread for the user in the company.

**Success Response (200 OK):**
```json
{
  "success": true,
  "count": 45
}
```

---

### 2.9 POST /api/v1/notifications/devices
Registers or refreshes a client device for Web Push (VAPID) or Mobile Push (FCM / APNs).

**Request Body (Mobile FCM / APNs):**
```json
{
  "platform": "ANDROID",
  "provider": "FCM",
  "token": "eXamPleFcmToKen1234567890abcdef...",
  "deviceId": "samsung-sm-g998b",
  "deviceName": "Samsung Galaxy S21 Ultra",
  "appVersion": "1.4.0"
}
```

**Request Body (Web Push):**
```json
{
  "platform": "WEB",
  "provider": "WEB_PUSH",
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "p256dh": "BNcRdreALRF...",
    "auth": "tBHItDa..."
  },
  "appVersion": "1.0.0"
}
```

**Success Response (201 Created):**
```json
{
  "id": "4a737f10-6712-4e4d-bfec-9d9df967a5bb",
  "platform": "ANDROID",
  "provider": "FCM",
  "token": "eXamPleFcmToKen1234567890abcdef...",
  "isActive": true,
  "lastSeenAt": "2026-11-04T12:00:00.000Z",
  "createdAt": "2026-11-04T12:00:00.000Z"
}
```

---

### 2.7 DELETE /api/v1/notifications/devices/:id
Unregisters / deactivates a device token (e.g. upon user logout).

**Success Response (200 OK):**
```json
{
  "success": true
}
```

---

### 2.8 GET /api/v1/notifications/preferences
Fetches the current user's notification preferences.

**Success Response (200 OK):**
```json
{
  "paymentReceived": true,
  "paymentSent": true,
  "invoiceDueReminder": true,
  "purchaseDueReminder": true,
  "overdueReminder": true,
  "pushEnabled": true,
  "inAppEnabled": true
}
```

---

### 2.9 PUT /api/v1/notifications/preferences
Updates the user's notification preferences.

**Request Body:**
```json
{
  "paymentReceived": true,
  "paymentSent": false,
  "invoiceDueReminder": true,
  "purchaseDueReminder": true,
  "overdueReminder": true,
  "pushEnabled": true,
  "inAppEnabled": true
}
```

**Success Response (200 OK):**
```json
{
  "paymentReceived": true,
  "paymentSent": false,
  "invoiceDueReminder": true,
  "purchaseDueReminder": true,
  "overdueReminder": true,
  "pushEnabled": true,
  "inAppEnabled": true
}
```

---

### 2.10 GET /api/v1/notifications/vapid-public-key
Returns the public VAPID key needed by browser `pushManager.subscribe()`.

**Success Response (200 OK):**
```json
{
  "publicKey": "BO7QrjqY6zwO4Oqaf5Ss4KbWF-8A16RNO8titZ0juKujjWyr0OiMGZlHbsNwpxhaDIIH9euBWtMSKIVy0IsXSFk"
}
```

---

### 2.11 GET /api/v1/dashboard/recent-activity
Retrieves real live business activity events (payments received, payments sent, salary disbursed, reminders) for the top dashboard feed.

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `limit` | integer | No | 10 | Max activity items to return (1-50) |

**Success Response (200 OK):**
```json
{
  "activities": [
    {
      "id": "e93297a7-59d4-4a57-8173-10d9cebc1748",
      "type": "PAYMENT_RECEIVED",
      "title": "Payment Received",
      "description": "Payment Received: ₹24,500.00 received from Patel Traders against Invoice INV-2026-0042.",
      "timestamp": "2026-11-04T12:00:00.000Z",
      "amount": 24500,
      "currency": "INR",
      "partyName": "Patel Traders",
      "referenceNumber": "NEFT-991204",
      "deepLink": "/sales/payment-in/a1f9a2e8-46dc-4089-a5fe-00f81d4a0441"
    }
  ]
}
```

