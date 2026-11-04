# MYOWN BILLBOOK — BEFORE-AND-AFTER ACCOUNTING RECONCILIATION REPORT
**Tenant:** Company JK (`92967a06-d488-4794-bae1-e6188e8fb47d`)  
**Organization:** `3127cc52-2797-4dc2-a9d3-55ba236c8d55`  
**Financial Year:** FY 2026-27 (`2f51002e-26c2-4a5b-8bae-bfab1a42b4c8`)  
**Audit Timestamp:** 2026-11-04 16:35:00 IST  
**Database Backup Reference:** `/home/dell/Jaydeep/billing_db_backup_master_exec_20261104_1630.sql`

---

## 1. Executive Reconciliation Summary

This document details the exact mathematical and accounting reconciliation between the initial audit state, the pre-cleanup state, and the final verified state. Every material change is reconciled to its authoritative source document or code correction.

| Financial Statement Metric | Initial Audit State | Intermediate State | Final Verified State | Net Variance | Primary Cause / Source Document |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Trial Balance Debit** | ₹7,71,375.75 | ₹7,71,375.75 | **₹6,78,175.75** | -₹93,200.00 | Purge of 10 confirmed demo accounts (DR balances) |
| **Trial Balance Credit** | ₹7,19,175.75 | ₹7,19,175.75 | **₹6,78,175.75** | -₹41,000.00 | Purge of 10 confirmed demo accounts (CR balances) |
| **Trial Balance Difference** | ₹52,200.00 (DR) | ₹52,200.00 (DR) | **₹0.00** | -₹52,200.00 | **Exact mathematical parity achieved** |
| **P&L Direct Income** | ₹5,57,289.29 | ₹5,57,289.29 | **₹5,57,289.29** | ₹0.00 | General Sales (₹5,68,993.29) - Sales Return (₹11,704.00) |
| **P&L Direct Expenses** | ₹6,889.40 | ₹3,455.00 | **₹3,455.00** | -₹3,434.40 | Bank Fee reclassified from Direct to Indirect Expenses |
| **P&L Gross Profit** | ₹5,50,399.89 | ₹5,53,834.29 | **₹5,53,834.29** | +₹3,434.40 | Revenue ₹5,57,289.29 − Procurement Expenses ₹3,455.00 |
| **P&L Indirect Income** | ₹11.45 | ₹11.45 | **₹11.45** | ₹0.00 | Discount Received (₹10.00) + Round Off (₹1.45 net) |
| **P&L Indirect Expenses** | ₹18,000.00 | ₹21,434.40 | **₹1,94,234.40** | +₹1,76,234.40 | +₹3,434.40 (Bank Fee) + ₹1,72,800.00 (EXP-12 Salary) |
| **P&L Net Profit** | **₹5,32,411.34** | **₹5,32,411.34** | **₹3,59,611.34** | **-₹1,72,800.00** | **Voucher EXP-12 posted on 2026-11-04 (6 staff @ ₹28,800)** |
| **Cost of Goods Sold (COGS)** | ₹2,09,057.13 | ₹2,05,622.73 | **₹2,05,622.73** | -₹3,434.40 | Bank Fee removed from procurement calculation |
| **Balance Sheet Assets** | ₹5,20,092.60 | ₹5,20,092.60 | **₹3,47,292.60** | -₹1,72,800.00 | SBI Bank asset reduced by ₹1,72,800.00 for EXP-12 disbursement |
| **Balance Sheet Liabilities** | ₹54,261.26 | ₹54,261.26 | **₹54,261.26** | ₹0.00 | Output GST ₹91,187.80 − параллел ITC balances |
| **Balance Sheet Equity** | ₹4,65,831.34 | ₹4,65,831.34 | **₹2,93,031.34** | -₹1,72,800.00 | Capital (-₹66,580.00) + Net Profit (₹3,59,611.34) |
| **Balance Sheet Difference** | ₹0.00 | ₹0.00 | **₹0.00** | ₹0.00 | **Exact mathematical balance preserved (Assets = Liab + Equity)** |

---

## 2. Forensic Breakdown of the ₹1,72,800.00 Net Profit Variance

### 2.1 The Discovery & Source Investigation
On 2026-11-04 at 10:36:10 UTC (16:06:10 IST), voucher **`EXP-12`** was posted into the system.
- **Voucher Number:** `EXP-12`
- **Voucher Type:** `PAYMENT`
- **Voucher ID:** `5c8cb65b-f6f8-454f-894b-896d0b7f336f`
- **Narration:** `Employee Salaries & Advances | Daily Office Expense (Qty: 6 @ ₹28800)`
- **Total Disbursed:** **₹1,72,800.00**
- **Disbursing Asset Account:** `State Bank of india` (`97890522-9b75-4a4a-bc75-99f7c2dad178`)
- **Debit Ledger Account:** `Employee Salaries & Advances` (`3370e24d-2e05-43c5-8c39-bfa4fc86aafb`)
- **Originating User:** `ec46866d-7d8e-4119-bba5-0044d0fce8de` (`audit_admin@example.local`, Company Admin)
- **Audit Log ID:** `90a30bf0-b896-41a7-a9c5-c7d3f0198b7e`

### 2.2 Impact on Core Statements
1. **Profit & Loss Impact:**
   - Previous Net Profit: **₹5,32,411.34**
   - New Operating Overhead (Indirect Expense): **₹1,72,800.00**
   - Resulting Net Profit: ₹5,32,411.34 − ₹1,72,800.00 = **₹3,59,611.34**.
2. **Balance Sheet Impact:**
   - Current Assets (State Bank of india) decreased by **₹1,72,800.00** (from ₹3,47,068.60 to ₹1,74,268.60).
   - Equity (Current Year Retained Profit) decreased by **₹1,72,800.00** (from ₹5,32,411.34 to ₹3,59,611.34).
   - Both sides reduced by identical ₹1,72,800.00, keeping Balance Sheet difference at **₹0.00**.
3. **Double-Counting Verification:**
   - Audit of all vouchers revealed zero other entries for this transaction. It is recorded exactly once.

---

## 3. Forensic Breakdown of the ₹3,434.40 COGS & Direct Expense Variance

### 3.1 Initial Calculation Defect
In the original software implementation:
- Any ledger account whose database `group_id` pointed to `Direct Expenses` was aggregated into Direct Expenses.
- The account `Bank Fee and Charges` (`8a0ff574-2f06-4ae3-8402-0ca8ab836689`), created via the expense voucher form for voucher `EXP-11` (₹3,434.40), had defaulted to the `Direct Expenses` group ID (`85400715-9fa0-4c80-a970-67a5d6c15f18`).
- Consequently, Direct Expenses were calculated as ₹3,455.00 (General Purchases) + ₹3,434.40 (Bank Fee) = **₹6,889.40**.
- This directly inflated COGS:
  $$\text{COGS} = \text{Opening Stock } (₹8,59,064.77) + \text{Direct Expenses } (₹6,889.40) - \text{Closing Stock } (₹6,56,897.04) = \mathbf{₹2,09,057.13}$$

### 3.2 Corrected Accounting Standard
- In accordance with standard accounting principles (Ind AS 2 / ICAI Guidance Notes on Inventories), bank transaction charges, POS gateway fees, and finance costs are operating overheads (**Indirect Expenses**), never procurement cost of goods sold.
- **Code Fix in `reports.service.ts`:** Explicit name and keyword filters were added to ensure that bank charges, fees, salaries, and office overheads are strictly routed to Indirect Expenses regardless of the underlying group name.
- **Database Alignment:** The `group_id` for `Bank Fee and Charges`, `Employee Salaries & Advances`, and `Office Expenses` was permanently updated in `ledger_accounts` to canonical `Indirect Expenses` (`6516e26a-c0c6-46fd-af3c-9046e7727d98`).
- **Reconciled COGS:**
  $$\text{COGS} = ₹8,59,064.77 + ₹3,455.00 - ₹6,56,897.04 = \mathbf{₹2,05,622.73}$$
- Variance of **₹3,434.40** is 100% accounted for by the relocation of bank charges from COGS to Indirect Expenses.

---

## 4. Forensic Breakdown of the ₹52,200.00 Demo Accounts Purge

### 4.1 Sample Import Contamination
In the pre-cleanup database, 10 dummy customer and supplier accounts existed from sample import batch `d43e0c8b-5706-4685-9908-8e6f6a5c9f1c` (`parties-import-50-sample-records.xlsx`).
- **Total Demo Debit Opening Balances:** ₹93,200.00
- **Total Demo Credit Opening Balances:** ₹41,000.00
- **Net Artificial Unbalance:** ₹93,200.00 − ₹41,000.00 = **₹52,200.00 DR**
- This was the sole root cause of the previous ₹52,200 Trial Balance discrepancy.

### 4.2 Deletion Verification
All 10 accounts were verified to have zero vouchers, zero journal entries, zero invoice items, and null `party_id`. They were deleted via an atomic transaction.
- **Pre-Cleanup Trial Balance Difference:** ₹52,200.00 DR
- **Post-Cleanup Trial Balance Difference:** **₹0.00** (`isBalanced: true`)

