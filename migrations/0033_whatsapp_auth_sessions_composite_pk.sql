-- Migrate whatsapp_auth_sessions to composite PK (tenant_id, account_id)
-- to support multiple WhatsApp accounts per tenant.
-- Existing rows are preserved with account_id = 'default'.

-- 1. Add account_id column (DEFAULT ensures existing rows get 'default')
ALTER TABLE "whatsapp_auth_sessions"
  ADD COLUMN IF NOT EXISTS "account_id" varchar NOT NULL DEFAULT 'default';

-- 2. Drop old single-column primary key
ALTER TABLE "whatsapp_auth_sessions"
  DROP CONSTRAINT IF EXISTS "whatsapp_auth_sessions_pkey";

-- 3. Add composite primary key
ALTER TABLE "whatsapp_auth_sessions"
  ADD CONSTRAINT "whatsapp_auth_sessions_pkey" PRIMARY KEY ("tenant_id", "account_id");
