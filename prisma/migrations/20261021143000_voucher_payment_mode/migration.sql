-- Payment mode for receipt vouchers shown on Payment In.
ALTER TABLE "vouchers"
  ADD COLUMN IF NOT EXISTS "payment_mode" VARCHAR(30);
