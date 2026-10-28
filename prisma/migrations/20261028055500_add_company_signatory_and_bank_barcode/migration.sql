-- AlterTable
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "bank_account_barcode" VARCHAR(255);
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "signatory_designation" VARCHAR(100) DEFAULT 'Authorised Signatory';
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "signatory_name" VARCHAR(150);
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "signature_url" TEXT;

-- AlterEnum
ALTER TYPE "DbImportStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
ALTER TYPE "DbImportStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
