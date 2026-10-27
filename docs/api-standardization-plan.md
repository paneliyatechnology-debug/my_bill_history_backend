# MyBill History — API Standardization & Migration Plan

## 1. Executive Summary
This document establishes the official API endpoint standardization architecture for the **MyBill History** SaaS application.
The goal is to align backend API endpoint naming strictly with frontend modules, pages, navigation menus, and screens, while guaranteeing:
1. **100% Zero Breaking Changes**: All existing endpoints are preserved via non-breaking route aliases and dual controllers.
2. **Elimination of 404s**: Endpoints previously called or expected by the frontend (such as `/expenses`, `/bank-accounts`, `/masters/units`, `/ledgers/accounts`) are fully implemented and supported.
3. **Domain & Security Integrity**: Multi-tenant company isolation, Row-Level Security (RLS), RBAC role guards, and double-entry accounting invariances remain strictly enforced.

---

## 2. Target API Naming Standards

### Global Rules:
- Global prefix: `/api/v1`
- URL casing: `kebab-case` for resources and multi-word action segments
- REST conventions:
  - `GET`: Safe retrieval, query filtering, pagination, sorting
  - `POST`: Resource creation or state-transition business actions (e.g. `issue`, `cancel`, `reverse`, `seed`, `bulk-delete`)
  - `PUT` / `PATCH`: Resource updates
  - `DELETE`: Soft-deletions or deactivations where allowed by accounting rules

---

## 3. Module-by-Module Route Mapping & Standardization

### A. Dashboard Module
| Current Route | Standardized Route | Controller / Service | Action / Compatibility Strategy |
|---|---|---|---|
| `GET /reports/financial-summary` | `GET /dashboard/summary` & `GET /reports/financial-summary` | ReportsService | Dual alias. Dashboard cards (To Collect, To Pay, Cash/Bank) |
| *(404 previously)* | `GET /expenses` | ExpensesController | **Implemented**. Provides recent expense payment vouchers with categories and amounts. |
| *(404 previously)* | `GET /bank-accounts` | BankAccountsController | **Implemented**. Returns active bank and cash accounts with current balances. |
| `GET /invoices` | `GET /invoices` & `GET /sales/invoices` | InvoicesController | Dual alias. Latest sales transactions widget. |
| `GET /purchases` | `GET /purchases` & `GET /purchases/invoices` | PurchasesController | Dual alias. Latest purchase invoices widget. |

### B. Masters Module
| Frontend Page | Current Route | Standardized Route | Controller / Service | Compatibility Note |
|---|---|---|---|---|
| Parties (`/masters/parties`) | `/parties` | `/masters/parties` & `/parties` | PartiesController | Both prefixes supported |
| Items & Products (`/masters/items`) | `/items` | `/masters/items` & `/items` | ItemsController | Both prefixes supported |
| Categories (`/masters/categories`) | `/categories` | `/masters/categories` & `/categories` | CategoriesController | Both prefixes supported |
| Units of Measure (`/masters/units`) | `/units` | `/masters/units` & `/units` | UnitsController | Both prefixes supported |
| HSN / SAC Codes (`/masters/hsn`) | `/hsn` | `/masters/hsn` & `/hsn` | HsnController | Both prefixes supported |
| Warehouses (`/masters/warehouses`) | `/warehouses` | `/masters/warehouses` & `/tenants/warehouses` & `/warehouses` | WarehousesController | All 3 prefixes supported |

### C. Sales Module
| Frontend Page | Current Route | Standardized Route | Controller / Service | Compatibility Note |
|---|---|---|---|---|
| Sales Invoices (`/sales/invoices`) | `/invoices` & `/invoices/sales` | `/sales/invoices` & `/sales` & `/invoices` | InvoicesController | All aliases supported |
| Credit Notes (`/sales/credit-note`) | `/sales-returns` | `/credit-notes` & `/sales-returns` | SalesReturnsController | Both aliases supported |
| Payment In (`/sales/payment-in`) | `/vouchers/receipts` | `/payment-in` & `/vouchers/receipts` | VouchersController | Both aliases supported |
| Delivery Challans (`/sales/delivery-challan`) | `/distribution/challans` | `/sales/challans` & `/distribution/challans` | DeliveryChallansController | Both aliases supported |
| POS Checkout & Sync (`/sales/pos`) | `/invoices/pos-checkout`, `/pos-sync` | `/sales/pos-checkout`, `/pos-sync` | InvoicesController | Both aliases supported |

### D. Purchases Module
| Frontend Page | Current Route | Standardized Route | Controller / Service | Compatibility Note |
|---|---|---|---|---|
| Purchase Invoices (`/purchases`) | `/purchases` | `/purchases/invoices` & `/purchases` | PurchasesController | Both aliases supported |
| Debit Notes (`/purchases/debit-note`) | `/purchase-returns` | `/debit-notes` & `/purchase-returns` | PurchaseReturnsController | Both aliases supported |
| Payment Out (`/purchases/payment-out`) | `/vouchers/payments-out` | `/payment-out` & `/vouchers/payments-out` | VouchersController | Both aliases supported |
| Purchase Bill Scanner (`/purchases/scan`) | `/purchases/scans` | `/purchases/scans` | PurchaseScansController | Supported |

### E. Inventory & Stock Module
| Frontend Page | Current Route | Standardized Route | Controller / Service | Compatibility Note |
|---|---|---|---|---|
| Stock Movements (`/inventory/movements`) | `/invoices/stock/transactions` | `/inventory/stock-movements` & `/invoices/stock/transactions` | InvoicesController | Supported |
| Stock Transfers (`/inventory/transfers`) | `/distribution/transfers` | `/inventory/transfers` & `/distribution/transfers` | StockTransfersController | Supported |
| Inventory Reconciliation (`/inventory/reconciliation`) | `/reconciliation` | `/inventory/reconciliation` & `/reconciliation` | ReconciliationController | Supported |
| Item Batches (`/inventory/batches`) | `/batches` | `/inventory/batches` & `/batches` | BatchesController | Supported |

### F. Accounting & Finance Module
| Frontend Page | Current Route | Standardized Route | Controller / Service | Compatibility Note |
|---|---|---|---|---|
| Chart of Accounts (`/accounting/chart-of-accounts`) | `/ledger-groups` | `/accounting/groups` & `/ledger-groups` | LedgersController | Supported |
| General Ledgers (`/accounting/ledgers`) | `/ledgers` | `/accounting/ledgers` & `/ledgers` | LedgersController | Supported |
| Cash & Bank (`/finance/cash-bank`) | `/ledgers` | `/bank-accounts` & `/banking/accounts` | BankAccountsController | **Dedicated controller implemented** |
| Expenses (`/finance/expenses`) | `/vouchers` | `/expenses` | ExpensesController | **Dedicated controller implemented** |
| Vouchers (`/finance/vouchers`) | `/vouchers` | `/accounting/vouchers` & `/vouchers` | VouchersController | Supported |

### G. Reports Module
| Frontend Page | Current Route | Standardized Route | Controller / Service | Compatibility Note |
|---|---|---|---|---|
| Financial Summary (`/reports`) | `/reports/financial-summary` | `/reports/financial-summary` | ReportsController | Unchanged |
| Profit & Loss | `/reports/profit-and-loss` | `/reports/profit-and-loss` | ReportsController | Unchanged |
| Balance Sheet | `/reports/balance-sheet` | `/reports/balance-sheet` | ReportsController | Unchanged |
| Trial Balance | `/reports/trial-balance` | `/reports/trial-balance` | ReportsController | Unchanged |
| General Ledger | `/reports/general-ledger` | `/reports/general-ledger` | ReportsController | Unchanged |
| Day Book (Rojmel) | `/reports/daybook` | `/reports/daybook` | ReportsController | Unchanged |
| GSTR-1 & GSTR-3B | `/reports/gstr-1`, `/reports/gstr-3b` | `/reports/gstr-1`, `/reports/gstr-3b` | ReportsController | Unchanged |

---

## 4. Execution Sequence & Phasing
1. **Audit Phase**: Inventory all controllers, DTOs, route prefixes, and frontend consumption points. (Complete)
2. **Backend Standardization**: Introduce module aliases and new dedicated controllers (`ExpensesController`, `BankAccountsController`). (Complete)
3. **AppModule Registration**: Ensure modules are globally loaded without dependency injection errors. (Complete)
4. **Build & Verify**: Compile TypeScript bundle with `tsc-alias` and verify 0 syntax/typing errors. (Complete)
5. **Frontend Alignment**: Align `src/app/page.tsx` and centralized API clients to standard names. (Complete)
6. **Documentation & Reporting**: Generate `api-endpoint-inventory.md`, `api-standardization-plan.md`, `api-module-map.md`, and `api-migration-report.md`. (In progress)
