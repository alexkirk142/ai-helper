-- Migration: 0009_add_templates_and_payment_methods
-- Adds message_templates and payment_methods tables for tenant-level configuration.

-- ============================================================
-- MESSAGE TEMPLATES
-- ============================================================

CREATE TABLE IF NOT EXISTS "message_templates" (
  "id"         varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"  varchar NOT NULL REFERENCES "tenants"("id"),
  "type"       text NOT NULL,        -- 'price_result' | 'payment_options' | 'tag_request' | 'not_found'
  "name"       text NOT NULL,
  "content"    text NOT NULL,
  "is_active"  boolean NOT NULL DEFAULT true,
  "order"      integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "message_templates_tenant_type_idx"
  ON "message_templates" ("tenant_id", "type");

CREATE INDEX IF NOT EXISTS "message_templates_tenant_active_idx"
  ON "message_templates" ("tenant_id", "is_active");

-- ============================================================
-- PAYMENT METHODS
-- ============================================================

CREATE TABLE IF NOT EXISTS "payment_methods" (
  "id"          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"   varchar NOT NULL REFERENCES "tenants"("id"),
  "title"       text NOT NULL,
  "description" text,
  "is_active"   boolean NOT NULL DEFAULT true,
  "order"       integer NOT NULL DEFAULT 0,
  "created_at"  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "payment_methods_tenant_idx"
  ON "payment_methods" ("tenant_id");

CREATE INDEX IF NOT EXISTS "payment_methods_tenant_active_idx"
  ON "payment_methods" ("tenant_id", "is_active");
