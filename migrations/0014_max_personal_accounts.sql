-- MAX Personal (GREEN-API) accounts — one per tenant, managed by platform admin only
CREATE TABLE IF NOT EXISTS "max_personal_accounts" (
  "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" VARCHAR NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "id_instance" VARCHAR NOT NULL,
  "api_token_instance" VARCHAR NOT NULL,
  "display_name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'unknown',
  "webhook_registered" BOOLEAN DEFAULT false,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "max_personal_accounts_tenant_idx"
  ON "max_personal_accounts" ("tenant_id");
