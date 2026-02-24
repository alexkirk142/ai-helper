-- Migration: 0010_add_tenant_agent_settings
-- Adds the tenant_agent_settings table that stores per-tenant AI agent
-- configuration: company identity, response scripts, and an optional
-- custom system prompt. One row per tenant (UNIQUE on tenant_id).

CREATE TABLE IF NOT EXISTS "tenant_agent_settings" (
  "id"                  varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"           varchar NOT NULL REFERENCES "tenants"("id"),
  "company_name"        text,
  "specialization"      text,
  "warehouse_city"      text,
  "warranty_months"     integer,
  "warranty_km"         integer,
  "install_days"        integer,
  "qr_discount_percent" integer,
  "system_prompt"       text,
  "objection_payment"   text,
  "objection_online"    text,
  "closing_script"      text,
  "custom_facts"        jsonb DEFAULT '{}',
  "updated_at"          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_agent_settings_tenant_id_unique" UNIQUE ("tenant_id")
);

CREATE INDEX IF NOT EXISTS "tenant_agent_settings_tenant_idx"
  ON "tenant_agent_settings" ("tenant_id");
