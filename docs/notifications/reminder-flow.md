# Automated Due-Date Reminder Engine (T-3 Days)

This document specifies the technical design, execution flow, edge-case suppression rules, and anti-duplication mechanisms for the automated invoice payment reminder system in MyOwnBillBook.

---

## 1. Business Logic & Timeline

Indian commercial trade credit agreements conventionally mandate that invoices are paid within agreed credit terms (e.g. Net 15, Net 30). Sending payment reminders **3 calendar days before the due date** gives customers adequate time to initiate NEFT/RTGS clearing and finance teams time to schedule payments.

```
Invoice Issued (Day 0)
        │
        ▼
   Credit Period
        │
        ▼
[Due Date - 3 Days] ───────> Automated Scanner triggers T-3 Reminder Alert
        │                    (In-App Bell + Web Push + Mobile Push)
        ▼
   Payment Made?
   ├─ YES: Balance = ₹0.00 ──> No further reminders; marked settled.
   │
   ▼ NO (Balance > ₹0.00)
[Due Date (T-0)]
        │
        ▼
[Due Date + 1 Day] ─────────> Overdue Notification Triggered
```

---

## 2. Trigger Mechanics

### 2.1 Daily Scheduled Cron
- **Schedule**: Every morning at **08:00 AM server local time** (`0 8 * * *`).
- **Service**: `ReminderSchedulerService` via NestJS `@Cron(CronExpression.EVERY_DAY_AT_8AM)`.
- **Target Date**: Calculated dynamically as `Current Date + 3 Days` (00:00:00 to 23:59:59.999).

### 2.2 On-Demand Admin Trigger
- Available for integration testing and administrator audit runs via `POST /api/v1/notifications/reminders/scan`.
- Supports targeting an individual company (`targetCompanyId`) or all active companies.

---

## 3. Database Scanning Query Specifications

### 3.1 Sales Invoice Reminders (Receivables)
The scheduler selects invoices meeting all of the following strict criteria:
```sql
SELECT i.id, i.invoice_number, i.balance_amount, i.due_date, p.name AS customer_name
FROM sales_invoices i
JOIN parties p ON i.party_id = p.id
WHERE i.company_id = :companyId
  AND i.due_date >= :targetDayStart AND i.due_date <= :targetDayEnd
  AND i.balance_amount > 0
  AND i.status NOT IN ('CANCELLED', 'PAID', 'DRAFT')
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_reminder_logs log
    WHERE log.company_id = :companyId
      AND log.entity_type = 'SALES_INVOICE'
      AND log.entity_id = i.id
      AND log.reminder_type = 'T3_REMINDER'
      AND log.target_date = :targetDateOnly
  );
```

### 3.2 Purchase Invoice Reminders (Payables)
The scheduler selects purchase invoices meeting all of the following criteria:
```sql
SELECT b.id, b.vendor_invoice_number, b.balance_amount, b.due_date, p.name AS supplier_name
FROM purchase_invoices b
JOIN parties p ON b.party_id = p.id
WHERE b.company_id = :companyId
  AND b.due_date >= :targetDayStart AND b.due_date <= :targetDayEnd
  AND b.balance_amount > 0
  AND b.status NOT IN ('CANCELLED', 'PAID')
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_reminder_logs log
    WHERE log.company_id = :companyId
      AND log.entity_type = 'PURCHASE_INVOICE'
      AND log.entity_id = b.id
      AND log.reminder_type = 'T3_REMINDER'
      AND log.target_date = :targetDateOnly
  );
```

---

## 4. Anti-Duplication & Idempotency Guarantee

To ensure an invoice reminder is never dispatched multiple times if the scheduler restarts or runs concurrently:

1. **Relational Table**: `scheduled_reminder_logs`
2. **Composite Unique Constraint**:
   ```sql
   CONSTRAINT "scheduled_reminder_logs_company_entity_type_target_key" 
   UNIQUE ("company_id", "entity_type", "entity_id", "reminder_type", "target_date")
   ```
3. **Execution Guard**:
   Before creating the notification, an atomic log record is inserted. If a log record already exists for the invoice on that specific target date, insertion is skipped.
4. **In-Flight Lock**:
   A concurrent execution mutex flag `isRunning` prevents overlapping cron jobs from executing simultaneously.

---

## 5. Edge-Case Suppression Rules

| Scenario | Behavior | Reason |
| :--- | :--- | :--- |
| **Fully Paid Bill** (`balance_amount <= 0`) | **Suppressed** | No reminder necessary if the party has already settled the invoice. |
| **Partially Paid Bill** (`0 < balance < total`) | **Dispatched with actual balance** | Reminder clearly quotes the exact remaining balance (e.g. "₹12,400 remaining of ₹50,000"). |
| **Cancelled Invoice** (`status = CANCELLED`) | **Suppressed** | Voided bills must never trigger collection reminders. |
| **Customer Opt-Out** (`invoiceDueReminder = false`) | **Suppressed** | Evaluated against `notification_preferences` for the recipient user. |
| **Multiple Bills for Same Party** | **Distinct Notifications** | Each bill carries its own due date and statutory reference number. |

