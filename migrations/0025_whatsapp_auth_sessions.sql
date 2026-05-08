-- WhatsApp Personal auth sessions: persist Baileys credentials in DB
-- so sessions survive container restarts and redeployments.
CREATE TABLE IF NOT EXISTS "whatsapp_auth_sessions" (
  "tenant_id" varchar PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "auth_data" text NOT NULL,
  "phone_number" text,
  "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
