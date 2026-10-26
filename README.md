# Billing & ERP Backend

Standalone NestJS + Prisma + PostgreSQL backend API for Indian GST Billing & Invoicing ERP.

## Features
- Multi-tenant architecture with PostgreSQL RLS & fallback
- Complete Billing & Accounting engine (Sales, Purchases, Vouchers, Ledgers, Reports)
- GST Compliance (GSTIN Verification, E-Way Bill, E-Invoice, GSTR-2B)
- Data Import System (Excel / CSV bulk import with schema validation & error reports)
- AI Purchase Bill Scanner (OCR + Gemini integration)

## Getting Started

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Environment Setup
Copy `.env.example` to `.env` and fill in your database credentials:
```bash
cp .env.example .env
```

### 3. Generate Prisma Client & Run Migrations
```bash
npx prisma generate
npx prisma migrate deploy
```

### 4. Build and Start
```bash
# Build
pnpm build

# Start production server
pnpm start

# Development mode
pnpm dev
```
