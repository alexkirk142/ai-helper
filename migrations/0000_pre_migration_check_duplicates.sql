-- Migration 0000: Bootstrap core schema for fresh databases
--
-- The repository historically assumed an existing database schema. On Railway
-- and other fresh environments, later migrations referenced tables that were
-- not yet created (e.g. users/subscription_grants/feature_flags/ai_suggestions).
-- This migration bootstraps the core tables so `drizzle-kit migrate` can run on
-- an empty PostgreSQL database.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- Core multi-tenant tables
-- =========================

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ru',
  tone TEXT NOT NULL DEFAULT 'formal',
  address_style TEXT NOT NULL DEFAULT 'vy',
  currency TEXT NOT NULL DEFAULT 'RUB',
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  working_hours_start TEXT DEFAULT '09:00',
  working_hours_end TEXT DEFAULT '18:00',
  working_days TEXT[] DEFAULT ARRAY['mon','tue','wed','thu','fri'],
  auto_reply_outside_hours BOOLEAN DEFAULT true,
  escalation_email TEXT,
  escalation_telegram TEXT,
  allow_discounts BOOLEAN DEFAULT false,
  max_discount_percent INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  templates JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR NOT NULL REFERENCES tenants (id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR REFERENCES tenants (id),
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator',
  email TEXT,
  email_verified_at TIMESTAMP,
  auth_provider TEXT DEFAULT 'local',
  oidc_id TEXT,
  password_updated_at TIMESTAMP,
  last_login_at TIMESTAMP,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP,
  is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  is_platform_owner BOOLEAN NOT NULL DEFAULT false,
  is_disabled BOOLEAN NOT NULL DEFAULT false,
  disabled_at TIMESTAMP,
  disabled_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Case-insensitive unique email index (allows NULL)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_lower_idx
  ON users (LOWER(email))
  WHERE email IS NOT NULL;

-- =========================
-- Auth/session storage
-- =========================

CREATE TABLE IF NOT EXISTS sessions (
  sid VARCHAR PRIMARY KEY,
  sess JSONB NOT NULL,
  expire TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire);

CREATE TABLE IF NOT EXISTS auth_users (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  email VARCHAR UNIQUE,
  first_name VARCHAR,
  last_name VARCHAR,
  profile_image_url VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- CRM: customers + conversations
-- =========================

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR NOT NULL REFERENCES tenants (id),
  channel_id VARCHAR REFERENCES channels (id),
  channel TEXT,
  external_id TEXT,
  name TEXT,
  phone TEXT,
  email TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_channel_external_idx
  ON customers (tenant_id, channel, external_id);

CREATE TABLE IF NOT EXISTS customer_notes (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR NOT NULL REFERENCES tenants (id),
  customer_id VARCHAR NOT NULL REFERENCES customers (id),
  author_user_id VARCHAR REFERENCES users (id),
  note_text TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_memory (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR NOT NULL REFERENCES tenants (id),
  customer_id VARCHAR NOT NULL REFERENCES customers (id),
  preferences JSONB DEFAULT '{}'::jsonb,
  frequent_topics JSONB DEFAULT '{}'::jsonb,
  last_summary_text TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_memory_tenant_customer_idx
  ON customer_memory (tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR NOT NULL REFERENCES tenants (id),
  customer_id VARCHAR NOT NULL REFERENCES customers (id),
  channel_id VARCHAR REFERENCES channels (id),
  status TEXT NOT NULL DEFAULT 'active',
  mode TEXT NOT NULL DEFAULT 'learning',
  last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  unread_count INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  conversation_id VARCHAR NOT NULL REFERENCES conversations (id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- AI suggestions + audit (core)
-- =========================

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  conversation_id VARCHAR NOT NULL REFERENCES conversations (id),
  message_id VARCHAR REFERENCES messages (id),
  suggested_reply TEXT NOT NULL,
  intent TEXT,
  confidence REAL DEFAULT 0,
  needs_approval BOOLEAN DEFAULT true,
  needs_handoff BOOLEAN DEFAULT false,
  questions_to_ask TEXT[] DEFAULT ARRAY[]::text[],
  used_sources JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'pending',
  similarity_score REAL,
  intent_score REAL,
  self_check_score REAL,
  decision TEXT,
  explanations JSONB DEFAULT '[]'::jsonb,
  penalties JSONB DEFAULT '[]'::jsonb,
  source_conflicts BOOLEAN DEFAULT false,
  missing_fields JSONB DEFAULT '[]'::jsonb,
  autosend_eligible BOOLEAN DEFAULT false,
  autosend_block_reason TEXT,
  self_check_need_handoff BOOLEAN DEFAULT false,
  self_check_reasons JSONB DEFAULT '[]'::jsonb,
  escalation_data JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR REFERENCES tenants (id),
  actor TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id VARCHAR NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  request_id VARCHAR,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- Feature flags (Phase 0)
-- =========================

CREATE TABLE IF NOT EXISTS feature_flags (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  tenant_id VARCHAR REFERENCES tenants (id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_global_unique
  ON feature_flags (name)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_tenant_unique
  ON feature_flags (name, tenant_id)
  WHERE tenant_id IS NOT NULL;

-- =========================
-- Telegram Personal sessions (used at startup)
-- =========================

CREATE TABLE IF NOT EXISTS telegram_sessions (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR NOT NULL REFERENCES tenants (id),
  channel_id VARCHAR REFERENCES channels (id),
  phone_number TEXT,
  session_string TEXT,
  phone_code_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  user_id TEXT,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  auth_method TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS telegram_sessions_tenant_idx
  ON telegram_sessions (tenant_id);

-- =========================
-- Billing tables required by app (minimal)
-- =========================

CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  name TEXT NOT NULL,
  stripe_price_id TEXT,
  stripe_product_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  crypto_amount TEXT,
  crypto_asset TEXT DEFAULT 'USDT',
  interval TEXT NOT NULL DEFAULT 'month',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR NOT NULL REFERENCES tenants (id) UNIQUE,
  plan_id VARCHAR REFERENCES plans (id),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  crypto_invoice_id TEXT,
  payment_provider TEXT DEFAULT 'cryptobot',
  status TEXT NOT NULL DEFAULT 'incomplete',
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT false,
  canceled_at TIMESTAMP,
  trial_started_at TIMESTAMP,
  trial_ends_at TIMESTAMP,
  trial_end TIMESTAMP,
  had_trial BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscription_grants (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR NOT NULL REFERENCES tenants (id),
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  granted_by_user_id VARCHAR NOT NULL REFERENCES users (id),
  reason TEXT NOT NULL,
  revoked_at TIMESTAMP,
  revoked_by_user_id VARCHAR REFERENCES users (id),
  revoked_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
