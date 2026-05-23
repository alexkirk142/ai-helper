-- CRM Leads table: tracks all incoming leads (Marquiz, Universal, manual)
-- Replaces the implicit "failed leads" pattern (conversations with status=failed_delivery)
-- with a proper first-class CRM entity that survives across the full lead lifecycle.

CREATE TABLE IF NOT EXISTS "leads" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id"),
  "status" text NOT NULL DEFAULT 'new',
  "source" text NOT NULL DEFAULT 'marquiz',
  "name" text,
  "phone" text,
  "email" text,
  "telegram_username" text,
  "preferred_channel" text,
  "quiz_name" text,
  "failure_reason" text,
  "conversation_id" varchar REFERENCES "conversations"("id"),
  "metadata" jsonb DEFAULT '{}',
  "notes" text,
  "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_leads_tenant_id" ON "leads" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_leads_tenant_status" ON "leads" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_leads_tenant_created_at" ON "leads" ("tenant_id", "created_at" DESC);
