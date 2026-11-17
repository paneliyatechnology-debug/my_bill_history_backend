-- CreateTable
CREATE TABLE "ai_collection_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "assistant_name" VARCHAR(100) NOT NULL DEFAULT 'Maya',
    "business_intro" VARCHAR(255) NOT NULL DEFAULT 'Payment Reminder Assistant',
    "default_language" VARCHAR(20) NOT NULL DEFAULT 'gujarati',
    "calling_window_start" VARCHAR(10) NOT NULL DEFAULT '09:30',
    "calling_window_end" VARCHAR(10) NOT NULL DEFAULT '19:00',
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "retry_interval_minutes" INTEGER NOT NULL DEFAULT 120,
    "follow_up_after_days" INTEGER NOT NULL DEFAULT 3,
    "max_calls_per_customer_per_day" INTEGER NOT NULL DEFAULT 2,
    "max_calls_per_campaign" INTEGER NOT NULL DEFAULT 50,
    "voice_provider" VARCHAR(50) NOT NULL DEFAULT 'twilio',
    "provider_api_key" TEXT,
    "provider_api_secret" TEXT,
    "provider_account_sid" VARCHAR(255),
    "provider_virtual_number" VARCHAR(50),
    "webhook_secret" VARCHAR(255),
    "telephony_status" VARCHAR(50) NOT NULL DEFAULT 'CONFIGURED',
    "ai_model" VARCHAR(100) NOT NULL DEFAULT 'gemini-2.5-flash',
    "stt_provider" VARCHAR(50) NOT NULL DEFAULT 'google',
    "tts_provider" VARCHAR(50) NOT NULL DEFAULT 'google',
    "voice_gender" VARCHAR(20) NOT NULL DEFAULT 'FEMALE',
    "response_speed" DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    "conversation_timeout_seconds" INTEGER NOT NULL DEFAULT 300,
    "max_duration_seconds" INTEGER NOT NULL DEFAULT 600,
    "fallback_response" TEXT,
    "bank_name" VARCHAR(100),
    "bank_account_number" VARCHAR(50),
    "bank_ifsc" VARCHAR(20),
    "bank_account_holder" VARCHAR(150),
    "upi_id" VARCHAR(100),
    "share_bank_details_on_call" BOOLEAN NOT NULL DEFAULT true,
    "send_whatsapp_followup" BOOLEAN NOT NULL DEFAULT true,
    "send_sms_followup" BOOLEAN NOT NULL DEFAULT true,
    "auto_schedule_calls" BOOLEAN NOT NULL DEFAULT true,
    "auto_follow_up_calls" BOOLEAN NOT NULL DEFAULT true,
    "stop_calls_when_invoice_paid" BOOLEAN NOT NULL DEFAULT true,
    "stop_calls_when_customer_opts_out" BOOLEAN NOT NULL DEFAULT true,
    "require_human_approval" BOOLEAN NOT NULL DEFAULT false,
    "notify_staff_on_dispute" BOOLEAN NOT NULL DEFAULT true,
    "record_consent_audit" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_collection_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_collection_campaigns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
    "total_customers" INTEGER NOT NULL DEFAULT 0,
    "total_calls" INTEGER NOT NULL DEFAULT 0,
    "successful_calls" INTEGER NOT NULL DEFAULT 0,
    "total_outstanding" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "total_recovered" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "scheduled_for" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_collection_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_collection_queues" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID,
    "party_id" UUID NOT NULL,
    "invoice_ids" JSONB NOT NULL DEFAULT '[]',
    "total_outstanding" DECIMAL(15,2) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" VARCHAR(50) NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "locked_at" TIMESTAMP(3),
    "locked_by" VARCHAR(100),
    "last_error" TEXT,
    "call_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_collection_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_collection_calls" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID,
    "queue_id" UUID,
    "party_id" UUID NOT NULL,
    "party_name" VARCHAR(200) NOT NULL,
    "party_phone" VARCHAR(30) NOT NULL,
    "invoice_id" UUID,
    "invoice_number" VARCHAR(100),
    "invoice_ids" JSONB NOT NULL DEFAULT '[]',
    "outstanding_amount" DECIMAL(15,2) NOT NULL,
    "discussed_amount" DECIMAL(15,2),
    "status" VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
    "provider" VARCHAR(50) NOT NULL DEFAULT 'twilio',
    "provider_call_sid" VARCHAR(255),
    "direction" VARCHAR(20) NOT NULL DEFAULT 'outbound',
    "language" VARCHAR(20) NOT NULL DEFAULT 'gujarati',
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "recording_url" TEXT,
    "recording_duration" INTEGER,
    "customer_intent" VARCHAR(100),
    "customer_response" TEXT,
    "promised_amount" DECIMAL(15,2),
    "promised_date" TIMESTAMP(3),
    "payment_reference" VARCHAR(100),
    "summary" TEXT,
    "next_action" VARCHAR(100),
    "next_follow_up_date" TIMESTAMP(3),
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_collection_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_collection_conversations" (
    "id" UUID NOT NULL,
    "call_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "language" VARCHAR(20),
    "turn_index" INTEGER NOT NULL DEFAULT 0,
    "confidence" DECIMAL(5,4),
    "raw_provider_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_collection_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_collection_commitments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "call_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "invoice_id" UUID,
    "promised_amount" DECIMAL(15,2) NOT NULL,
    "promised_date" TIMESTAMP(3) NOT NULL,
    "payment_method" VARCHAR(50),
    "payment_reference" VARCHAR(100),
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    "fulfilled_amount" DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    "fulfilled_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_collection_commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_collection_follow_ups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "call_id" UUID,
    "commitment_id" UUID,
    "scheduled_date" TIMESTAMP(3) NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "action_type" VARCHAR(50) NOT NULL DEFAULT 'CALL',
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "completed_at" TIMESTAMP(3),
    "assigned_to_user_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_collection_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_collection_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "call_id" UUID,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_collection_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_calling_preferences" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "is_opted_out" BOOLEAN NOT NULL DEFAULT false,
    "opted_out_at" TIMESTAMP(3),
    "opt_out_reason" TEXT,
    "opt_out_source" VARCHAR(100),
    "preferred_language" VARCHAR(20) NOT NULL DEFAULT 'gujarati',
    "preferred_call_time" VARCHAR(20) NOT NULL DEFAULT 'MORNING',
    "do_not_call_before" VARCHAR(10) NOT NULL DEFAULT '09:30',
    "do_not_call_after" VARCHAR(10) NOT NULL DEFAULT '19:00',
    "consent_recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_call_at" TIMESTAMP(3),
    "total_calls_received" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_calling_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_collection_staff_tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "party_id" UUID NOT NULL,
    "call_id" UUID,
    "assigned_user_id" UUID,
    "task_type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'HIGH',
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "resolution_notes" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_collection_staff_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_collection_settings_company_id_key" ON "ai_collection_settings"("company_id");

-- CreateIndex
CREATE INDEX "ai_collection_settings_organization_id_company_id_idx" ON "ai_collection_settings"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "ai_collection_campaigns_organization_id_company_id_status_idx" ON "ai_collection_campaigns"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "ai_collection_queues_organization_id_company_id_status_idx" ON "ai_collection_queues"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "ai_collection_queues_party_id_idx" ON "ai_collection_queues"("party_id");

-- CreateIndex
CREATE INDEX "ai_collection_queues_scheduled_at_status_idx" ON "ai_collection_queues"("scheduled_at", "status");

-- CreateIndex
CREATE INDEX "ai_collection_calls_organization_id_company_id_status_idx" ON "ai_collection_calls"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "ai_collection_calls_party_id_idx" ON "ai_collection_calls"("party_id");

-- CreateIndex
CREATE INDEX "ai_collection_calls_provider_call_sid_idx" ON "ai_collection_calls"("provider_call_sid");

-- CreateIndex
CREATE INDEX "ai_collection_calls_created_at_idx" ON "ai_collection_calls"("created_at");

-- CreateIndex
CREATE INDEX "ai_collection_conversations_call_id_turn_index_idx" ON "ai_collection_conversations"("call_id", "turn_index");

-- CreateIndex
CREATE INDEX "ai_collection_commitments_organization_id_company_id_status_idx" ON "ai_collection_commitments"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "ai_collection_commitments_party_id_idx" ON "ai_collection_commitments"("party_id");

-- CreateIndex
CREATE INDEX "ai_collection_commitments_promised_date_idx" ON "ai_collection_commitments"("promised_date");

-- CreateIndex
CREATE INDEX "ai_collection_follow_ups_organization_id_company_id_status_idx" ON "ai_collection_follow_ups"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "ai_collection_follow_ups_party_id_idx" ON "ai_collection_follow_ups"("party_id");

-- CreateIndex
CREATE INDEX "ai_collection_follow_ups_scheduled_date_idx" ON "ai_collection_follow_ups"("scheduled_date");

-- CreateIndex
CREATE INDEX "ai_collection_events_organization_id_company_id_event_type_idx" ON "ai_collection_events"("organization_id", "company_id", "event_type");

-- CreateIndex
CREATE INDEX "ai_collection_events_call_id_idx" ON "ai_collection_events"("call_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_calling_preferences_party_id_key" ON "customer_calling_preferences"("party_id");

-- CreateIndex
CREATE INDEX "customer_calling_preferences_organization_id_company_id_idx" ON "customer_calling_preferences"("organization_id", "company_id");

-- CreateIndex
CREATE INDEX "customer_calling_preferences_party_id_idx" ON "customer_calling_preferences"("party_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_calling_preferences_company_id_party_id_key" ON "customer_calling_preferences"("company_id", "party_id");

-- CreateIndex
CREATE INDEX "ai_collection_staff_tasks_organization_id_company_id_status_idx" ON "ai_collection_staff_tasks"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "ai_collection_staff_tasks_party_id_idx" ON "ai_collection_staff_tasks"("party_id");

-- CreateIndex
CREATE INDEX "ai_collection_staff_tasks_assigned_user_id_idx" ON "ai_collection_staff_tasks"("assigned_user_id");

-- AddForeignKey
ALTER TABLE "ai_collection_settings" ADD CONSTRAINT "ai_collection_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_campaigns" ADD CONSTRAINT "ai_collection_campaigns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_queues" ADD CONSTRAINT "ai_collection_queues_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_queues" ADD CONSTRAINT "ai_collection_queues_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_queues" ADD CONSTRAINT "ai_collection_queues_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ai_collection_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_calls" ADD CONSTRAINT "ai_collection_calls_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_calls" ADD CONSTRAINT "ai_collection_calls_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_calls" ADD CONSTRAINT "ai_collection_calls_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_calls" ADD CONSTRAINT "ai_collection_calls_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "ai_collection_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_conversations" ADD CONSTRAINT "ai_collection_conversations_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "ai_collection_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_commitments" ADD CONSTRAINT "ai_collection_commitments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_commitments" ADD CONSTRAINT "ai_collection_commitments_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "ai_collection_calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_commitments" ADD CONSTRAINT "ai_collection_commitments_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_commitments" ADD CONSTRAINT "ai_collection_commitments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_follow_ups" ADD CONSTRAINT "ai_collection_follow_ups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_follow_ups" ADD CONSTRAINT "ai_collection_follow_ups_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_follow_ups" ADD CONSTRAINT "ai_collection_follow_ups_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "ai_collection_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_events" ADD CONSTRAINT "ai_collection_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_calling_preferences" ADD CONSTRAINT "customer_calling_preferences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_calling_preferences" ADD CONSTRAINT "customer_calling_preferences_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_staff_tasks" ADD CONSTRAINT "ai_collection_staff_tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_staff_tasks" ADD CONSTRAINT "ai_collection_staff_tasks_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_staff_tasks" ADD CONSTRAINT "ai_collection_staff_tasks_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "ai_collection_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_collection_staff_tasks" ADD CONSTRAINT "ai_collection_staff_tasks_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

