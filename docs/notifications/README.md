# MyOwnBillBook Notifications & Real-Time Alert Engine

Production-grade, multi-channel notification architecture powering the MyOwnBillBook web application, backend microservices, and mobile applications (Android / iOS).

---

## 1. Architectural Overview

```
                      +---------------------------------------+
                      |         Real Business Events          |
                      |  - Payment Received (Receipt / Cash)  |
                      |  - Payment Sent (Supplier / Expense)  |
                      |  - Salary & Staff Advances Disbursed  |
                      |  - Automated T-3 Day Due Reminders    |
                      +-------------------+-------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |      Authoritative Backend Tx         |
                      |   (Committed Accounting Vouchers)     |
                      +-------------------+-------------------+
                                          |
                                          v  (Post-Commit Async Dispatch)
                      +---------------------------------------+
                      |      Notifications Engine Service     |
                      |   - Idempotency & Tenant RLS Guard    |
                      |   - Recipient & Preference Filtering  |
                      |   - Persistent PostgreSQL Store       |
                      +----+--------------+---------------+---+
                           |              |               |
             +-------------+              |               +-------------+
             v                            v                             v
  +--------------------+       +--------------------+        +--------------------+
  | In-App Bell Center |       |   Web Push VAPID   |        |  Mobile Push GW    |
  | (Real-time Dropdown|       |   (W3C Standard    |        |  (Firebase FCM &   |
  |  & Activity Feed)  |       |   Service Worker)  |        |   Apple APNs)      |
  +--------------------+       +--------------------+        +--------------------+
```

### Core Design Principles
1. **Zero Mock Data & Real Accounting Integrity**: Every notification is linked to authoritative PostgreSQL ledger accounts, vouchers, and invoice records.
2. **Post-Commit Dispatch**: Notifications are dispatched strictly *after* atomic database transaction commits. Notification or push failure never aborts or rolls back a valid financial entry.
3. **Multi-Tenant Isolation**: Strict enforcement of PostgreSQL Row-Level Security (RLS) and Organization/Company context scoping across all queries and mutations.
4. **Channel Redundancy**: Seamless multi-channel delivery across In-App Notification Center, Web Push (VAPID / Service Worker), and Mobile Push (Android FCM / iOS APNs).
5. **Smart Anti-Duplication**: Automatic suppression of duplicate notifications within 3-minute event windows, combined with a composite primary constraint in `scheduled_reminder_logs` preventing duplicate due-date reminders.

---

## 2. Supported Notification Event Types

| Event Type Enum | Trigger Source | Business Context | Default Deep Link |
| :--- | :--- | :--- | :--- |
| `PAYMENT_RECEIVED` | Sales Receipt Voucher / Invoice Payment | Customer settled sales bill | `/sales/payment-in/:id` |
| `PAYMENT_SENT` | Payment Out Voucher / Purchase Bill | Disbursed funds to supplier | `/purchases/payment-out/:id` |
| `SALARY_PAID` | Staff Payroll Voucher | Salary or advance paid to employee | `/payroll` |
| `DUE_DATE_REMINDER_T3` | Automated Daily Cron (08:00 AM) | Invoice due in 3 days with balance > 0 | `/sales/invoices/:id` or `/purchases/:id` |
| `OVERDUE_INVOICE` | Automated Scanner | Invoice past due date with balance > 0 | `/sales/invoices/:id` |
| `SALES_INVOICE_GENERATED` | Sales Billing Engine | New invoice issued to customer | `/sales/invoices/:id` |
| `PURCHASE_BILL_RECORDED` | Purchase Inward Engine | New vendor bill recorded | `/purchases/:id` |
| `PAYMENT_REVERSED` | Double-Entry Contra Correction | Voucher reversed or cancelled | `/accounting/vouchers` |

---

## 3. Database Schema Overview

The notification infrastructure is governed by 5 relational tables in PostgreSQL:

1. **`notifications`**: Persistent store for in-app alert logs with unread state, tenant isolation, and deep-link routing.
2. **`notification_devices`**: Device registry capturing FCM device tokens, APNs device tokens, and Web Push browser endpoints.
3. **`notification_deliveries`**: Delivery attempts, channel statuses (`PENDING`, `SENT`, `FAILED`), and audit retry timestamps.
4. **`notification_preferences`**: User-configurable push and in-app alert toggles per company.
5. **`scheduled_reminder_logs`**: Idempotent audit log ensuring zero duplicate reminders for any invoice across cron runs.

---

## 4. Documentation Directory

- **[API Contract Reference](./api-contract.md)**: Full REST API specification with endpoints, query params, request bodies, and responses.
- **[Mobile App Developer Integration Guide](./mobile-integration.md)**: Native & cross-platform guide (React Native, Flutter, Kotlin, Swift) for device registration and deep linking.
- **[Push Payloads Specification](./push-payloads.md)**: Standardized FCM and APNs payload JSON structures with sound, channel IDs, and metadata.
- **[Automated Due-Date Reminder Flow](./reminder-flow.md)**: Detailed breakdown of the T-3 days due date scanning engine, edge cases, and suppression rules.

