CREATE TABLE "max_personal_accounts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"account_id" varchar DEFAULT gen_random_uuid() NOT NULL,
	"id_instance" varchar NOT NULL,
	"api_token_instance" varchar NOT NULL,
	"api_url" text,
	"media_url" text,
	"label" text,
	"display_name" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"webhook_registered" boolean DEFAULT false,
	"auto_reply_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transmission_identity_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oem" text NOT NULL,
	"normalized_oem" text NOT NULL,
	"model_name" text,
	"manufacturer" text,
	"origin" text,
	"confidence" text DEFAULT 'high' NOT NULL,
	"hit_count" integer DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "feature_flags" DROP CONSTRAINT "feature_flags_name_unique";--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD COLUMN "escalation_data" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "is_muted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD COLUMN "urls" text[];--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD COLUMN "domains" text[];--> statement-breakpoint
ALTER TABLE "telegram_sessions" ADD COLUMN "tg_role" text DEFAULT 'both' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "template_gearbox_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "template_engine_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "template_tires_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "escalation_chat_id" text;--> statement-breakpoint
ALTER TABLE "user_invites" ADD COLUMN "email_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_invites" ADD COLUMN "email_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "max_personal_accounts" ADD CONSTRAINT "max_personal_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "max_personal_accounts_tenant_idx" ON "max_personal_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "max_personal_accounts_tenant_instance_unique" ON "max_personal_accounts" USING btree ("tenant_id","id_instance");--> statement-breakpoint
CREATE UNIQUE INDEX "transmission_identity_cache_normalized_oem_unique" ON "transmission_identity_cache" USING btree ("normalized_oem");--> statement-breakpoint
CREATE INDEX "transmission_identity_cache_oem_idx" ON "transmission_identity_cache" USING btree ("oem");--> statement-breakpoint
CREATE INDEX "idx_ai_suggestions_conversation_id" ON "ai_suggestions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_tenant_id" ON "conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_customer_id" ON "conversations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_escalation_events_conversation_id" ON "escalation_events" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_global_unique" ON "feature_flags" USING btree ("name") WHERE "feature_flags"."tenant_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_tenant_unique" ON "feature_flags" USING btree ("name","tenant_id") WHERE "feature_flags"."tenant_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_learning_queue_conversation_id" ON "learning_queue" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation_id" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_rag_chunks_rag_document_id" ON "rag_chunks" USING btree ("rag_document_id");