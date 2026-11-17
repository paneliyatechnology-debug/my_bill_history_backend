-- CreateTable
CREATE TABLE IF NOT EXISTS "invoice_themes" (
    "id" VARCHAR(100) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "category" VARCHAR(50) NOT NULL DEFAULT 'festive',
    "festival_name" VARCHAR(150),
    "description" TEXT,
    "primary_color" VARCHAR(30) NOT NULL DEFAULT '#F97316',
    "badge" VARCHAR(50),
    "thumbnail" TEXT NOT NULL,
    "variants" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_themes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "invoice_themes_is_active_sort_order_idx" ON "invoice_themes"("is_active", "sort_order");

