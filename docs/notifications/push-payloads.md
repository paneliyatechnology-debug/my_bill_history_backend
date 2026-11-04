# Standard Push Payloads Specification

This document defines the exact push notification payload format dispatched to Web Push, Android (FCM), and iOS (APNs).

---

## 1. Top-Level Payload Schema

Every mobile push delivery is packaged as a standardized JSON structure with high priority and notification channels configured.

### Common Structure
```json
{
  "notification": {
    "title": "Payment Received",
    "body": "Payment Received: ₹15,000.00 from Ramesh Textiles.",
    "sound": "default"
  },
  "data": {
    "notificationId": "e93297a7-59d4-4a57-8173-10d9cebc1748",
    "type": "PAYMENT_RECEIVED",
    "title": "Payment Received",
    "body": "Payment Received: ₹15,000.00 from Ramesh Textiles.",
    "deepLink": "/sales/payment-in/e93297a7-59d4-4a57-8173-10d9cebc1748",
    "entityType": "SALES_PAYMENT",
    "entityId": "a1f9a2e8-46dc-4089-a5fe-00f81d4a0441",
    "schemaVersion": "1",
    "amount": "15000",
    "currency": "INR",
    "partyName": "Ramesh Textiles",
    "paymentMode": "BANK_TRANSFER"
  },
  "android": {
    "priority": "high",
    "notification": {
      "channel_id": "payments_channel",
      "sound": "default",
      "default_vibrate_timings": true,
      "click_action": "FLUTTER_NOTIFICATION_CLICK"
    }
  },
  "apns": {
    "payload": {
      "aps": {
        "sound": "default",
        "badge": 1,
        "content-available": 1
      }
    }
  }
}
```

---

## 2. Event Payload Samples

### 2.1 Event: PAYMENT_RECEIVED
Dispatched when a customer payment is recorded against an invoice or via receipt voucher.

```json
{
  "title": "Payment Received",
  "body": "Payment Received: ₹45,000.00 received from Arjun Vyas Hardware against Invoice INV/26-27/0088.",
  "data": {
    "type": "PAYMENT_RECEIVED",
    "notificationId": "0381ea62-bdf4-46f3-a170-ccf02cba6781",
    "entityType": "SALES_PAYMENT",
    "entityId": "34bf54c7-8bb0-4d83-9b8e-d90c9b0e14d2",
    "deepLink": "/sales/payment-in/34bf54c7-8bb0-4d83-9b8e-d90c9b0e14d2",
    "amount": "45000",
    "currency": "INR",
    "partyName": "Arjun Vyas Hardware",
    "invoiceNumber": "INV/26-27/0088",
    "remainingBalance": "0.00",
    "paymentMode": "UPI",
    "referenceNumber": "UPI-771829",
    "action": "OPEN_PAYMENT"
  }
}
```

---

### 2.2 Event: PAYMENT_SENT
Dispatched when funds are paid to a vendor or supplier.

```json
{
  "title": "Payment Sent",
  "body": "Payment Sent: ₹32,000.00 paid to Amul Dairy Distributor against Purchase Bill PB-1029.",
  "data": {
    "type": "PAYMENT_SENT",
    "notificationId": "87e38f12-21de-4ff4-bf91-44df0e10cc12",
    "entityType": "PURCHASE_PAYMENT",
    "entityId": "50c411a1-94cb-4235-8ea5-6807e324ef19",
    "deepLink": "/purchases/payment-out/50c411a1-94cb-4235-8ea5-6807e324ef19",
    "amount": "32000",
    "currency": "INR",
    "partyName": "Amul Dairy Distributor",
    "referenceNumber": "PB-1029",
    "paymentMode": "BANK_TRANSFER",
    "action": "OPEN_PAYMENT"
  }
}
```

---

### 2.3 Event: SALARY_PAID
Dispatched when staff salary or advance is disbursed.

```json
{
  "title": "Salary Disbursed",
  "body": "Salary Disbursed: ₹28,000.00 paid to Rajesh Sharma.",
  "data": {
    "type": "SALARY_PAID",
    "notificationId": "9b12c8e3-0542-4f45-bb7c-2bce564d8a11",
    "entityType": "STAFF_PAYMENT",
    "entityId": "a24326f5-081b-4171-872e-0658fa232742",
    "deepLink": "/payroll",
    "amount": "28000",
    "currency": "INR",
    "staffName": "Rajesh Sharma",
    "paymentType": "SALARY",
    "paymentMode": "BANK_TRANSFER",
    "action": "OPEN_PAYROLL"
  }
}
```

---

### 2.4 Event: DUE_DATE_REMINDER_T3
Dispatched automatically 3 calendar days before sales or purchase invoice due dates.

```json
{
  "title": "Payment Due in 3 Days",
  "body": "Due in 3 days: ₹65,200.00 from National Traders for Invoice INV/26-27/0054 due on 07/11/2026.",
  "data": {
    "type": "DUE_DATE_REMINDER_T3",
    "notificationId": "41804d9a-1152-4467-93e1-5e929b05f231",
    "entityType": "SALES_INVOICE",
    "entityId": "893c8378-0112-42fe-bd1a-c71c4c95f190",
    "deepLink": "/sales/invoices/893c8378-0112-42fe-bd1a-c71c4c95f190",
    "invoiceNumber": "INV/26-27/0054",
    "partyName": "National Traders",
    "balanceAmount": "65200",
    "dueDate": "2026-11-07",
    "action": "OPEN_INVOICE"
  }
}
```

---

### 2.5 Event: PAYMENT_REVERSED
Dispatched when an accounting voucher is reversed with double-entry contra lines.

```json
{
  "title": "Voucher Reversal",
  "body": "Voucher #JRN-2026-0012 posted reversing Voucher #RC/26-27/0001. Reason: Cheque bounced by clearing house.",
  "data": {
    "type": "PAYMENT_REVERSED",
    "notificationId": "ef92c431-7501-44a3-9be1-3a059b15e341",
    "entityType": "VOUCHER",
    "entityId": "730cb19a-9e12-48f1-ae93-01cf4a187b22",
    "deepLink": "/accounting/vouchers",
    "originalVoucherId": "c4791e84-1823-42e5-bc09-0a56fe134110",
    "reversalVoucherNumber": "JRN-2026-0012",
    "reason": "Cheque bounced by clearing house",
    "action": "OPEN_VOUCHERS"
  }
}
```

---

## 3. Android Notification Channels

Mobile Android apps must create the following Notification Channels on startup (`NotificationManager.createNotificationChannel`):

| Channel ID | Name | Importance | Sound | Vibration |
| :--- | :--- | :--- | :--- | :--- |
| `payments_channel` | Payments & Collections | HIGH | Default | Yes (200ms, 100ms, 200ms) |
| `reminders_channel` | Due Date Reminders | DEFAULT | Default | Yes (100ms) |
| `general_channel` | General Billing & Invoices | DEFAULT | Default | No |

