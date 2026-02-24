# Database Schema

## Table of Contents

- [Overview](#overview)
- [Tables](#tables)
  - [tenants](#tenants)
  - [channels](#channels)
  - [users](#users)
  - [user_invites](#user_invites)
  - [email_tokens](#email_tokens)
  - [admin_actions](#admin_actions)
  - [sessions](#sessions)
  - [customers](#customers)
  - [customer_notes](#customer_notes)
  - [customer_memory](#customer_memory)
  - [conversations](#conversations)
  - [messages](#messages)
  - [products](#products)
  - [knowledge_docs](#knowledge_docs)
  - [knowledge_doc_chunks](#knowledge_doc_chunks)
  - [rag_documents](#rag_documents)
  - [rag_chunks](#rag_chunks)
  - [ai_suggestions](#ai_suggestions)
  - [human_actions](#human_actions)
  - [ai_training_samples](#ai_training_samples)
  - [ai_training_policies](#ai_training_policies)
  - [learning_queue](#learning_queue)
  - [escalation_events](#escalation_events)
  - [response_templates](#response_templates)
  - [decision_settings](#decision_settings)
  - [human_delay_settings](#human_delay_settings)
  - [feature_flags](#feature_flags)
  - [audit_events](#audit_events)
  - [onboarding_state](#onboarding_state)
  - [readiness_reports](#readiness_reports)
  - [csat_ratings](#csat_ratings)
  - [conversions](#conversions)
  - [lost_deals](#lost_deals)
  - [plans](#plans)
  - [subscriptions](#subscriptions)
  - [subscription_grants](#subscription_grants)
  - [channel_fingerprints](#channel_fingerprints)
  - [fraud_flags](#fraud_flags)
  - [integration_secrets](#integration_secrets)
  - [telegram_sessions](#telegram_sessions)
  - [update_history](#update_history)
  - [proxies](#proxies)
  - [vehicle_lookup_cache](#vehicle_lookup_cache)
  - [vehicle_lookup_cases](#vehicle_lookup_cases)
  - [price_snapshots](#price_snapshots)
  - [internal_prices](#internal_prices)
  - [message_templates](#message_templates)
  - [payment_methods](#payment_methods)
  - [tenant_agent_settings](#tenant_agent_settings)
  - [max_personal_accounts](#max_personal_accounts)
  - [transmission_identity_cache](#transmission_identity_cache)
- [Relationships](#relationships)
- [Indexes](#indexes)
- [Migrations History](#migrations-history)
- [Drizzle Schema Location](#drizzle-schema-location)

---

## Overview

| Property | Value |
|----------|-------|
| Database | PostgreSQL |
| ORM | Drizzle ORM (`drizzle-orm` + `node-postgres`) |
| Schema file | `shared/schema.ts` (~1600 lines) |
| Additional models | `shared/models/auth.ts`, `shared/models/chat.ts` (legacy) |
| Migrations directory | `./migrations` |
| Config file | `drizzle.config.ts` |
| Connection | `DATABASE_URL` environment variable |
| Primary key strategy | UUID (`gen_random_uuid()`) for all tables |
| Total tables | **49** (defined in `shared/schema.ts`) |

---

## Tables

### tenants

Multi-tenant root table. Each business is a tenant.

> **Price settings** (`GET/PUT /api/price-settings`) are NOT stored in a separate table. They are stored inside `tenants.templates` JSONB under the key `priceSettings`: `{ marginPct, roundTo, priceNote, showMarketPrice }`. Default: `{ marginPct: -25, roundTo: 100, priceNote: "", showMarketPrice: false }`.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Tenant UUID |
| name | text | NO | — | — | Business name |
| language | text | NO | `'ru'` | — | UI/AI language code |
| tone | text | NO | `'formal'` | — | AI tone: `formal` or `friendly` |
| address_style | text | NO | `'vy'` | — | Customer address style: `vy` (formal) or `ty` (informal) |
| currency | text | NO | `'RUB'` | — | Default currency |
| timezone | text | NO | `'Europe/Moscow'` | — | IANA timezone |
| working_hours_start | text | YES | `'09:00'` | — | Working hours start (HH:mm) |
| working_hours_end | text | YES | `'18:00'` | — | Working hours end (HH:mm) |
| working_days | text[] | YES | `['mon','tue','wed','thu','fri']` | — | Working days array |
| auto_reply_outside_hours | boolean | YES | `true` | — | Auto-reply outside working hours |
| escalation_email | text | YES | — | — | Email for escalations |
| escalation_telegram | text | YES | — | — | Telegram handle for escalations |
| allow_discounts | boolean | YES | `false` | — | Whether AI can offer discounts |
| max_discount_percent | integer | YES | `0` | — | Max discount percentage |
| status | text | NO | `'active'` | — | `active` or `restricted` |
| templates | jsonb | YES | `'{}'` | — | Tenant-specific text templates |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### channels

Communication channels configured per tenant.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Channel UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| type | text | NO | — | — | Channel type (whatsapp, telegram, max, etc.) |
| name | text | NO | — | — | Display name |
| config | jsonb | YES | `'{}'` | — | Channel-specific configuration |
| is_active | boolean | YES | `true` | — | Whether channel is active |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### users

Application users (operators, admins, owners).

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | User UUID |
| tenant_id | varchar | YES | — | FK → tenants.id | Associated tenant (nullable for platform admins) |
| username | text | NO | — | UNIQUE | Unique username |
| password | text | NO | — | — | bcrypt hash |
| role | text | NO | `'operator'` | — | `owner`, `admin`, `operator`, `viewer`, `guest` |
| email | text | YES | — | — | Email address |
| email_verified_at | timestamp | YES | — | — | When email was verified |
| auth_provider | text | YES | `'local'` | — | `local`, `oidc`, `mixed` |
| oidc_id | text | YES | — | — | OIDC provider subject ID |
| password_updated_at | timestamp | YES | — | — | Last password change |
| last_login_at | timestamp | YES | — | — | Last successful login |
| failed_login_attempts | integer | YES | `0` | — | Failed login counter |
| locked_until | timestamp | YES | — | — | Account locked until this time |
| is_platform_admin | boolean | NO | `false` | — | Platform-level admin flag |
| is_platform_owner | boolean | NO | `false` | — | Platform-level owner flag |
| is_disabled | boolean | NO | `false` | — | Account disabled by admin |
| disabled_at | timestamp | YES | — | — | When account was disabled |
| disabled_reason | text | YES | — | — | Reason for disabling |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

**Indexes:**
- `users_email_unique_lower_idx` — UNIQUE on `LOWER(email)` WHERE `email IS NOT NULL`

---

### user_invites

Team invitation tokens.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Invite UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Target tenant |
| email | text | NO | — | — | Invitee email |
| role | text | NO | `'operator'` | — | Role to assign on signup |
| token_hash | text | NO | — | UNIQUE | SHA-256 hash of invite token |
| invited_by | varchar | YES | — | FK → users.id | Inviting user |
| expires_at | timestamp | NO | — | — | Expiration time |
| used_at | timestamp | YES | — | — | When the invite was used (null = unused) |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### email_tokens

Email verification and password reset tokens.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Token UUID |
| user_id | varchar | NO | — | FK → users.id (CASCADE DELETE) | Token owner |
| token_hash | text | NO | — | UNIQUE | SHA-256 hash |
| type | text | NO | — | — | `email_verification` or `password_reset` |
| expires_at | timestamp | NO | — | — | Expiration time |
| used_at | timestamp | YES | — | — | When used (null = unused) |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### admin_actions

Audit log for platform admin actions.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Action UUID |
| action_type | text | NO | — | — | Action type enum (see AdminActionType) |
| target_type | text | NO | — | — | `tenant`, `user`, or `grant` |
| target_id | varchar | NO | — | — | ID of the affected entity |
| admin_id | varchar | NO | — | FK → users.id | Admin who performed the action |
| reason | text | NO | — | — | Required reason string |
| previous_state | jsonb | YES | — | — | State before the change |
| metadata | jsonb | YES | — | — | Additional context |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Action timestamp |

---

### sessions

Express session storage (managed by `connect-pg-simple`).

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| sid | varchar | NO | — | PRIMARY KEY | Session ID |
| sess | jsonb | NO | — | — | Session data (userId, tenantId, role) |
| expire | timestamp | NO | — | — | Expiration time |

**Indexes:**
- `IDX_session_expire` on `expire`

---

### customers

End customers (people who message the business via channels).

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Customer UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| channel_id | varchar | YES | — | FK → channels.id | Channel through which customer arrived |
| channel | text | YES | — | — | Channel type string |
| external_id | text | YES | — | — | Platform-specific ID (Telegram user ID, WhatsApp number, etc.) |
| name | text | YES | — | — | Display name |
| phone | text | YES | — | — | Phone number |
| email | text | YES | — | — | Email address |
| tags | jsonb | YES | `'[]'` | — | Array of string tags |
| metadata | jsonb | YES | `'{}'` | — | Arbitrary metadata |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update timestamp |

**Indexes:**
- `customers_tenant_channel_external_idx` — UNIQUE on `(tenant_id, channel, external_id)`

---

### customer_notes

Operator notes on customers.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Note UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| customer_id | varchar | NO | — | FK → customers.id | Subject customer |
| author_user_id | varchar | YES | — | FK → users.id | Author |
| note_text | text | NO | — | — | Note content (max 2048 chars enforced at API level) |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### customer_memory

AI memory per customer — preferences, frequent topics, summary.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Memory UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| customer_id | varchar | NO | — | FK → customers.id | Subject customer |
| preferences | jsonb | YES | `'{}'` | — | Structured preferences (city, delivery, payment) |
| frequent_topics | jsonb | YES | `'{}'` | — | Intent → count map |
| last_summary_text | text | YES | — | — | AI-generated summary of interactions |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update timestamp |

**Indexes:**
- `customer_memory_tenant_customer_idx` — UNIQUE on `(tenant_id, customer_id)`

---

### conversations

Chat conversations between customers and the business.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Conversation UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| customer_id | varchar | NO | — | FK → customers.id | Customer |
| channel_id | varchar | YES | — | FK → channels.id | Channel |
| status | text | NO | `'active'` | — | `active`, `waiting_customer`, `waiting_operator`, `escalated`, `resolved` |
| mode | text | NO | `'learning'` | — | `learning`, `semi-auto`, `auto` |
| last_message_at | timestamp | YES | `CURRENT_TIMESTAMP` | — | Timestamp of last message |
| unread_count | integer | YES | `0` | — | Unread message count |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

**Status Transitions:**

```
active → waiting_customer, waiting_operator, escalated, resolved
waiting_customer → active, escalated, resolved
waiting_operator → active, escalated, resolved
escalated → active, resolved
resolved → active (reopen)
```

---

### messages

Individual messages within conversations.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Message UUID |
| conversation_id | varchar | NO | — | FK → conversations.id | Parent conversation |
| role | text | NO | — | — | `customer`, `assistant`, `owner` |
| content | text | NO | — | — | Message text |
| attachments | jsonb | YES | `'[]'` | — | Array of attachment objects |
| metadata | jsonb | YES | `'{}'` | — | Arbitrary metadata |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### products

Product catalog.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Product UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| sku | text | YES | — | — | Stock keeping unit |
| name | text | NO | — | — | Product name |
| description | text | YES | — | — | Product description |
| price | real | YES | — | — | Price |
| currency | text | YES | `'RUB'` | — | Currency code |
| category | text | YES | — | — | Category |
| in_stock | boolean | YES | `true` | — | Availability |
| stock_quantity | integer | YES | — | — | Stock count |
| variants | jsonb | YES | `'[]'` | — | Product variants |
| images | text[] | YES | `ARRAY[]::text[]` | — | Image URLs |
| delivery_info | text | YES | — | — | Delivery information |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### knowledge_docs

Knowledge base documents used for RAG context.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Document UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| title | text | NO | — | — | Document title |
| content | text | NO | — | — | Document content (max 50000 chars at API level) |
| category | text | YES | — | — | `faq`, `policy`, `shipping`, `returns`, `general` |
| doc_type | text | YES | — | — | `policy`, `faq`, `delivery`, `returns` |
| tags | text[] | YES | `ARRAY[]::text[]` | — | Tags array |
| is_active | boolean | YES | `true` | — | Whether document is active |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### knowledge_doc_chunks

Chunked segments of knowledge docs for RAG processing.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Chunk UUID |
| doc_id | varchar | NO | — | FK → knowledge_docs.id (CASCADE) | Parent document |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| chunk_index | integer | NO | — | — | Position within the document |
| content | text | NO | — | — | Chunk text |
| token_count | integer | NO | — | — | Token count |
| metadata | jsonb | YES | `'{}'` | — | `{ title, docType, headings: string[] }` |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### rag_documents

RAG document registry — maps products and knowledge docs to RAG index.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | RAG doc UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| type | text | NO | — | — | `PRODUCT` or `DOC` |
| source_id | varchar | NO | — | — | Product ID or knowledge doc ID |
| content | text | NO | — | — | Indexed content |
| metadata | jsonb | YES | `'{}'` | — | `{ category, sku, tags }` |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### rag_chunks

RAG chunks with embeddings for semantic search.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Chunk UUID |
| rag_document_id | varchar | NO | — | FK → rag_documents.id (CASCADE) | Parent RAG document |
| chunk_text | text | NO | — | — | Chunk text |
| chunk_index | integer | NO | — | — | Position within document |
| token_count | integer | NO | — | — | Token count |
| embedding | text | YES | — | — | Vector embedding stored as text |
| metadata | jsonb | YES | `'{}'` | — | Additional metadata |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### ai_suggestions

AI-generated reply suggestions.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Suggestion UUID |
| conversation_id | varchar | NO | — | FK → conversations.id | Target conversation |
| message_id | varchar | YES | — | FK → messages.id | Triggering customer message |
| suggested_reply | text | NO | — | — | Generated reply text |
| intent | text | YES | — | — | Classified intent |
| confidence | real | YES | `0` | — | Overall confidence score |
| needs_approval | boolean | YES | `true` | — | Requires human approval |
| needs_handoff | boolean | YES | `false` | — | Needs operator handoff |
| questions_to_ask | text[] | YES | `ARRAY[]::text[]` | — | Follow-up questions |
| used_sources | jsonb | YES | `'[]'` | — | Array of `{ type, id, title, quote, similarity }` |
| status | text | YES | `'pending'` | — | `pending`, `approved`, `edited`, `rejected` |
| similarity_score | real | YES | — | — | RAG similarity score |
| intent_score | real | YES | — | — | Intent classification confidence |
| self_check_score | real | YES | — | — | Self-validation score |
| decision | text | YES | — | — | `AUTO_SEND`, `NEED_APPROVAL`, `ESCALATE` |
| explanations | jsonb | YES | `'[]'` | — | Decision explanation strings |
| penalties | jsonb | YES | `'[]'` | — | Array of `{ code, message, value }` |
| source_conflicts | boolean | YES | `false` | — | Sources contain contradictions |
| missing_fields | jsonb | YES | `'[]'` | — | Fields AI could not resolve |
| autosend_eligible | boolean | YES | `false` | — | Eligible for auto-send |
| autosend_block_reason | text | YES | — | — | `FLAG_OFF`, `SETTING_OFF`, `INTENT_NOT_ALLOWED` |
| self_check_need_handoff | boolean | YES | `false` | — | Self-check flagged for handoff |
| self_check_reasons | jsonb | YES | `'[]'` | — | Self-check handoff reasons |
| escalation_data | jsonb | YES | — | — | Structured operator escalation payload: `{type, reason, searchContext, operatorHints}` (added via 0019) |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### human_actions

Records of human operator actions on AI suggestions.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Action UUID |
| suggestion_id | varchar | NO | — | FK → ai_suggestions.id | Related suggestion |
| user_id | varchar | YES | — | FK → users.id | Acting user |
| action | text | NO | — | — | `approve`, `edit`, `reject`, `escalate` |
| original_text | text | YES | — | — | Original suggestion text (for edits) |
| edited_text | text | YES | — | — | Edited text |
| reason | text | YES | — | — | Rejection reason |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Action timestamp |

---

### ai_training_samples

Collected training data from operator feedback.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Sample UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| conversation_id | varchar | NO | — | FK → conversations.id | Source conversation |
| user_message | text | NO | — | — | Customer message |
| ai_suggestion | text | NO | — | — | AI's original suggestion |
| final_answer | text | YES | — | — | Final sent answer (null for rejections) |
| intent | text | YES | — | — | Classified intent |
| decision | text | YES | — | — | Decision type |
| outcome | text | NO | — | — | `APPROVED`, `EDITED`, `REJECTED` |
| rejection_reason | text | YES | — | — | Why it was rejected |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### ai_training_policies

Per-tenant training and escalation policies.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| tenant_id | varchar | NO | — | PRIMARY KEY, FK → tenants.id | Tenant ID |
| always_escalate_intents | text[] | YES | `ARRAY[]::text[]` | — | Intents that always escalate |
| forbidden_topics | text[] | YES | `ARRAY[]::text[]` | — | Topics AI must never discuss (max 100) |
| disabled_learning_intents | text[] | YES | `ARRAY[]::text[]` | — | Intents excluded from learning |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |

---

### learning_queue

Conversations flagged for review and learning.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Queue item UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| conversation_id | varchar | NO | — | FK → conversations.id | Flagged conversation |
| learning_score | integer | NO | `0` | — | Priority score |
| reasons | text[] | YES | `ARRAY[]::text[]` | — | Reason codes (ESCALATED, EDITED, LOW_SIMILARITY, etc.) |
| status | text | NO | `'pending'` | — | `pending`, `reviewed`, `exported`, `dismissed` |
| reviewed_by | varchar | YES | — | FK → users.id | Reviewer |
| reviewed_at | timestamp | YES | — | — | Review timestamp |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### escalation_events

Escalation events when AI cannot handle a conversation.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Event UUID |
| conversation_id | varchar | NO | — | FK → conversations.id | Escalated conversation |
| reason | text | NO | — | — | Escalation reason |
| summary | text | YES | — | — | AI summary of the issue |
| suggested_response | text | YES | — | — | AI suggested response for operator |
| clarification_needed | text | YES | — | — | What info is needed from the customer |
| status | text | YES | `'pending'` | — | `pending`, `handled`, `dismissed` |
| handled_by | varchar | YES | — | FK → users.id | Who handled it |
| handled_at | timestamp | YES | — | — | When it was handled |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Event timestamp |

---

### response_templates

Reusable response templates.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Template UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| name | text | NO | — | — | Template name |
| content | text | NO | — | — | Template content |
| category | text | YES | — | — | Category |
| triggers | text[] | YES | `ARRAY[]::text[]` | — | Trigger keywords |
| is_active | boolean | YES | `true` | — | Active flag |
| usage_count | integer | YES | `0` | — | Times used |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### decision_settings

Per-tenant decision engine thresholds.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| tenant_id | varchar | NO | — | PRIMARY KEY, FK → tenants.id | Tenant ID |
| t_auto | real | NO | `0.80` | — | Confidence threshold for AUTO_SEND |
| t_escalate | real | NO | `0.40` | — | Confidence threshold for ESCALATE (below this) |
| autosend_allowed | boolean | NO | `false` | — | Whether auto-send is permitted |
| intents_autosend_allowed | jsonb | YES | `["price","availability","shipping","other"]` | — | Intents eligible for auto-send |
| intents_force_handoff | jsonb | YES | `["discount","complaint"]` | — | Intents that always need a human |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |

---

### human_delay_settings

Per-tenant human-like typing delay settings.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| tenant_id | varchar | NO | — | PRIMARY KEY, FK → tenants.id | Tenant ID |
| enabled | boolean | NO | `false` | — | Enable delay simulation |
| delay_profiles | jsonb | YES | see below | — | `{ SHORT, MEDIUM, LONG }` profile configs |
| night_mode | text | NO | `'DELAY'` | — | `AUTO_REPLY`, `DELAY`, `DISABLE` |
| night_delay_multiplier | real | NO | `3.0` | — | Night-time delay multiplier |
| night_auto_reply_text | text | YES | `'Спасибо за сообщение! ...'` | — | Auto-reply text for night mode |
| min_delay_ms | integer | NO | `3000` | — | Minimum delay (ms) |
| max_delay_ms | integer | NO | `120000` | — | Maximum delay (ms) |
| typing_indicator_enabled | boolean | NO | `true` | — | Send typing indicator |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |

Default delay profiles:

```json
{
  "SHORT":  { "baseMin": 2000, "baseMax": 4000, "typingSpeed": 40, "jitter": 500 },
  "MEDIUM": { "baseMin": 4000, "baseMax": 8000, "typingSpeed": 35, "jitter": 1000 },
  "LONG":   { "baseMin": 8000, "baseMax": 15000, "typingSpeed": 30, "jitter": 2000 }
}
```

---

### feature_flags

Feature flags (global or per-tenant).

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Flag UUID |
| name | text | NO | — | UNIQUE | Flag name (e.g., `AI_SUGGESTIONS_ENABLED`) |
| description | text | YES | — | — | Human-readable description |
| enabled | boolean | NO | `false` | — | Whether enabled |
| tenant_id | varchar | YES | — | FK → tenants.id | Null = global; set = tenant-specific |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |

Known flag names: `AI_SUGGESTIONS_ENABLED`, `DECISION_ENGINE_ENABLED`, `AI_AUTOSEND_ENABLED`, `HUMAN_DELAY_ENABLED`, `RAG_ENABLED`, `FEW_SHOT_LEARNING`, `TELEGRAM_CHANNEL_ENABLED`, `TELEGRAM_PERSONAL_CHANNEL_ENABLED`, `WHATSAPP_CHANNEL_ENABLED`, `WHATSAPP_PERSONAL_CHANNEL_ENABLED`, `MAX_CHANNEL_ENABLED`, `MAX_PERSONAL_CHANNEL_ENABLED`, `AUTO_PARTS_ENABLED`

**Partial unique indexes** (added migration 0013):
- `feature_flags_global_unique` — UNIQUE on `name` WHERE `tenant_id IS NULL` (global flags)
- `feature_flags_tenant_unique` — UNIQUE on `(name, tenant_id)` WHERE `tenant_id IS NOT NULL` (per-tenant overrides)

**Flag storage in `feature_flags.json`:** All flags in this file are keyed as `global:<FLAG_NAME>` (e.g., `global:AI_SUGGESTIONS_ENABLED`). They serve as defaults seeded into the database at startup.

---

### audit_events

Comprehensive audit trail.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Event UUID |
| tenant_id | varchar | YES | — | FK → tenants.id | Tenant (nullable for system events) |
| actor | text | NO | — | — | Actor ID (user_id, `system`, `ai`) |
| actor_type | text | NO | — | — | `user`, `system`, `ai` |
| action | text | NO | — | — | Action type (see Audit Actions below) |
| entity_type | text | NO | — | — | `conversation`, `suggestion`, `escalation`, etc. |
| entity_id | varchar | NO | — | — | Affected entity ID |
| metadata | jsonb | YES | `'{}'` | — | Additional context |
| request_id | varchar | YES | — | — | Request ID for tracing |
| ip_address | text | YES | — | — | Client IP |
| user_agent | text | YES | — | — | Client User-Agent |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Event timestamp |

Audit actions: `suggestion_generated`, `suggestion_approved`, `suggestion_edited`, `suggestion_rejected`, `message_sent`, `conversation_created`, `conversation_status_changed`, `conversation_escalated`, `escalation_resolved`, `escalation_dismissed`, `product_created`, `product_updated`, `product_deleted`, `knowledge_doc_created`, `knowledge_doc_updated`, `knowledge_doc_deleted`, `tenant_updated`, `feature_flag_toggled`, `customer_data_deleted`, `webhook_verification_failed`, `rate_limit_exceeded`

---

### onboarding_state

Per-tenant onboarding progress.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| tenant_id | varchar | NO | — | PRIMARY KEY, FK → tenants.id | Tenant ID |
| status | text | NO | `'NOT_STARTED'` | — | `NOT_STARTED`, `IN_PROGRESS`, `DONE` |
| current_step | text | NO | `'BUSINESS'` | — | Current step |
| completed_steps | text[] | YES | `ARRAY[]::text[]` | — | Completed steps |
| answers | jsonb | YES | `'{}'` | — | Step answers |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |

Steps: `BUSINESS` → `CHANNELS` → `PRODUCTS` → `POLICIES` → `KB` → `REVIEW` → `DONE`

---

### readiness_reports

Readiness assessment snapshots.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Report UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| score | integer | NO | `0` | — | Readiness score (0–100) |
| checks | jsonb | YES | `'[]'` | — | Array of `{ code, status, message, weight }` |
| recommendations | text[] | YES | `ARRAY[]::text[]` | — | Improvement recommendations |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### csat_ratings

Customer satisfaction ratings per conversation.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Rating UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| conversation_id | varchar | NO | — | FK → conversations.id | Rated conversation |
| rating | integer | NO | — | — | 1–5 star rating |
| comment | text | YES | — | — | Optional feedback text |
| intent | text | YES | — | — | Conversation's last known intent |
| decision | text | YES | — | — | Decision type at time of rating |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Rating timestamp |

**Indexes:**
- `csat_ratings_conversation_idx` — UNIQUE on `conversation_id` (one rating per conversation)

---

### conversions

Recorded sales/conversions from conversations.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Conversion UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| conversation_id | varchar | NO | — | FK → conversations.id | Conversation that converted |
| amount | real | NO | — | — | Purchase amount |
| currency | text | NO | `'RUB'` | — | Currency |
| intent | text | YES | — | — | Intent at conversion time |
| decision | text | YES | — | — | Decision type at conversion time |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Conversion timestamp |

**Indexes:**
- `conversions_conversation_idx` — UNIQUE on `conversation_id` (one conversion per conversation)

---

### lost_deals

Recorded lost deals and their reasons.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Lost deal UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| conversation_id | varchar | NO | — | FK → conversations.id | Related conversation |
| reason | text | NO | — | — | `NO_STOCK`, `PRICE_TOO_HIGH`, `ESCALATED_NO_RESPONSE`, `AI_ERROR`, `OTHER` |
| detected_automatically | boolean | YES | `true` | — | Auto-detected vs manual |
| notes | text | YES | — | — | Operator notes |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### plans

Subscription plans.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Plan UUID |
| name | text | NO | — | — | Plan name |
| stripe_price_id | text | YES | — | — | Stripe price ID |
| stripe_product_id | text | YES | — | — | Stripe product ID |
| amount | integer | NO | — | — | Amount in cents |
| currency | text | NO | `'usd'` | — | Currency |
| crypto_amount | text | YES | — | — | Crypto amount (e.g., "50" for 50 USDT) |
| crypto_asset | text | YES | `'USDT'` | — | Crypto asset: BTC, TON, ETH, USDT |
| interval | text | NO | `'month'` | — | `month` or `year` |
| is_active | boolean | YES | `true` | — | Available for purchase |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

---

### subscriptions

Tenant subscriptions.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Subscription UUID |
| tenant_id | varchar | NO | — | FK → tenants.id, UNIQUE | One subscription per tenant |
| plan_id | varchar | YES | — | FK → plans.id | Subscribed plan |
| stripe_customer_id | text | YES | — | — | Stripe customer ID |
| stripe_subscription_id | text | YES | — | UNIQUE | Stripe subscription ID |
| crypto_invoice_id | text | YES | — | — | CryptoBot invoice ID |
| payment_provider | text | YES | `'cryptobot'` | — | `stripe` or `cryptobot` |
| status | text | NO | `'incomplete'` | — | See status enum below |
| current_period_start | timestamp | YES | — | — | Current billing period start |
| current_period_end | timestamp | YES | — | — | Current billing period end |
| cancel_at_period_end | boolean | YES | `false` | — | Cancel at end of period |
| canceled_at | timestamp | YES | — | — | When cancellation was requested |
| trial_started_at | timestamp | YES | — | — | Trial start time |
| trial_ends_at | timestamp | YES | — | — | Trial end time (72h from start) |
| trial_end | timestamp | YES | — | — | Legacy trial end field |
| had_trial | boolean | YES | `false` | — | Whether tenant ever had a trial |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |

Subscription statuses: `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `incomplete`, `paused`, `expired`

---

### subscription_grants

Admin-granted temporary access periods.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Grant UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Recipient tenant |
| starts_at | timestamp | NO | — | — | Grant start |
| ends_at | timestamp | NO | — | — | Grant end |
| granted_by_user_id | varchar | NO | — | FK → users.id | Granting admin |
| reason | text | NO | — | — | Grant reason |
| revoked_at | timestamp | YES | — | — | Null = active; set = revoked |
| revoked_by_user_id | varchar | YES | — | FK → users.id | Revoking admin |
| revoked_reason | text | YES | — | — | Revocation reason |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

**Indexes:**
- `subscription_grants_active_lookup_idx` on `(tenant_id, revoked_at, ends_at, starts_at)`

---

### channel_fingerprints

Channel identity fingerprints for fraud detection.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Fingerprint UUID |
| channel_type | text | NO | — | — | `telegram`, `whatsapp_business`, `whatsapp_personal`, `max` |
| fingerprint_hash | text | NO | — | — | SHA-256 hash of the channel identity |
| tenant_id | varchar | NO | — | FK → tenants.id | Associated tenant |
| first_seen_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | First seen |
| last_seen_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last seen |
| is_blocked | boolean | YES | `false` | — | Blocked flag |

---

### fraud_flags

Fraud detection flags.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Flag UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Flagged tenant |
| reason | text | NO | — | — | `CHANNEL_REUSE`, `MULTI_TRIAL_ATTEMPT`, `SUSPICIOUS_ACTIVITY` |
| metadata | jsonb | YES | `'{}'` | — | Additional context |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Flag timestamp |
| resolved_at | timestamp | YES | — | — | Null = unresolved |
| resolved_by | varchar | YES | — | FK → users.id | Resolving admin |

---

### integration_secrets

Encrypted integration secrets (API keys, tokens).

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Secret UUID |
| scope | text | NO | — | — | `global` or `tenant` |
| tenant_id | varchar | YES | — | FK → tenants.id | Null for global secrets |
| key_name | text | NO | — | — | Secret key name (3–64 chars, uppercase) |
| encrypted_value | text | NO | — | — | AES-256-GCM encrypted value |
| encryption_meta | jsonb | NO | — | — | `{ iv, tag, algorithm }` |
| last_4 | text | YES | — | — | Last 4 chars of plaintext (for display) |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |
| rotated_at | timestamp | YES | — | — | When last rotated |
| revoked_at | timestamp | YES | — | — | Null = active; set = revoked |
| created_by_admin_id | varchar | NO | — | FK → users.id | Creating admin |

**Indexes:**
- `integration_secrets_active_unique_idx` — UNIQUE on `(scope, COALESCE(tenant_id, ''), key_name)` WHERE `revoked_at IS NULL`
- `integration_secrets_tenant_key_idx` on `(tenant_id, key_name)`

---

### telegram_sessions

Telegram personal account sessions (MTProto).

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Session UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| channel_id | varchar | YES | — | FK → channels.id | Associated channel |
| phone_number | text | YES | — | — | Phone number |
| session_string | text | YES | — | — | Encrypted session string |
| phone_code_hash | text | YES | — | — | Telegram phone code hash |
| status | text | NO | `'pending'` | — | `pending`, `awaiting_code`, `awaiting_2fa`, `active`, `error`, `disconnected` |
| last_error | text | YES | — | — | Last error message |
| user_id | text | YES | — | — | Telegram user ID |
| username | text | YES | — | — | Telegram username |
| first_name | text | YES | — | — | User first name |
| last_name | text | YES | — | — | User last name |
| auth_method | text | YES | — | — | `qr` or `phone` |
| is_enabled | boolean | NO | `true` | — | Account enabled |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |

**Indexes:**
- `telegram_sessions_tenant_idx` on `tenant_id`

---

### update_history

System update packages and their application history.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Update UUID |
| version | text | NO | — | — | Version string |
| filename | text | NO | — | — | Upload filename |
| file_size | integer | NO | — | — | File size in bytes |
| checksum | text | NO | — | — | SHA-256 checksum |
| changelog | text | YES | — | — | Changelog text |
| status | text | NO | `'pending'` | — | `pending`, `applied`, `failed`, `rolled_back` |
| backup_path | text | YES | — | — | Path to pre-update backup |
| applied_at | timestamp | YES | — | — | When applied |
| applied_by_id | varchar | YES | — | FK → users.id | Who applied it |
| error_message | text | YES | — | — | Error if failed |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Upload timestamp |

---

### proxies

Proxy pool for channel connections.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Proxy UUID |
| host | text | NO | — | — | Proxy host |
| port | integer | NO | — | — | Proxy port (1–65535) |
| protocol | text | NO | `'socks5'` | — | `http`, `https`, `socks4`, `socks5` |
| username | text | YES | — | — | Auth username |
| password | text | YES | — | — | Auth password (encrypted) |
| country | text | YES | — | — | Country code (RU, US, NL, etc.) |
| label | text | YES | — | — | Friendly name |
| status | text | NO | `'available'` | — | `available`, `assigned`, `disabled`, `failed` |
| assigned_tenant_id | varchar | YES | — | FK → tenants.id | Assigned tenant |
| assigned_channel_id | varchar | YES | — | FK → channels.id | Assigned channel |
| last_checked_at | timestamp | YES | — | — | Last health check |
| last_error_message | text | YES | — | — | Last error |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |

**Indexes:**
- `proxies_status_idx` on `status`
- `proxies_tenant_idx` on `assigned_tenant_id`
- `proxies_channel_idx` on `assigned_channel_id`

---

### vehicle_lookup_cache

Cached vehicle lookup results.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Cache entry UUID |
| lookup_key | text | NO | — | UNIQUE | Lookup cache key |
| id_type | text | NO | — | — | `VIN` or `FRAME` |
| raw_value | text | NO | — | — | Original input value |
| normalized_value | text | NO | — | — | Normalized value |
| result | jsonb | NO | — | — | Full lookup result |
| source | text | NO | — | — | Data source |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |
| expires_at | timestamp | YES | — | — | Cache expiration |

**Indexes:**
- `vehicle_lookup_cache_normalized_value_idx` on `normalized_value`

---

### vehicle_lookup_cases

Individual vehicle lookup requests tied to conversations.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Case UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| conversation_id | varchar | NO | — | FK → conversations.id | Related conversation |
| message_id | varchar | YES | — | FK → messages.id | Triggering message |
| id_type | text | NO | — | — | `VIN` or `FRAME` |
| raw_value | text | NO | — | — | Original input |
| normalized_value | text | NO | — | — | Normalized value |
| status | text | NO | — | — | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED` |
| verification_status | text | NO | — | — | `NEED_TAG_OPTIONAL`, `UNVERIFIED_OEM`, `VERIFIED_MATCH`, `MISMATCH`, `NONE` |
| cache_id | varchar | YES | — | FK → vehicle_lookup_cache.id | Linked cache entry |
| error | text | YES | — | — | Error message if failed |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |

**Indexes:**
- `vehicle_lookup_cases_tenant_conversation_idx` on `(tenant_id, conversation_id)`
- `vehicle_lookup_cases_status_idx` on `status`
- `vehicle_lookup_cases_normalized_value_idx` on `normalized_value`

---

### price_snapshots

Global price cache per OEM. Entries with `tenant_id = NULL` are shared across all tenants (7-day TTL via `expires_at`). Tenant-scoped entries (fallback/no-OEM mode) use `tenant_id` with 24h TTL.

**Migration:** `0011_update_price_snapshots.sql` — made `tenant_id` nullable, added new columns.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Snapshot UUID |
| tenant_id | varchar | **YES** | — | FK → tenants.id | Owning tenant; `NULL` = global cache entry |
| oem | text | NO | — | — | OEM part number |
| source | text | NO | — | — | `internal`, `avito`, `drom`, `web`, `openai_web_search`, `not_found`, `mock`, `ai_estimate`; planned: `yandex`, `escalation` |
| currency | text | NO | `'RUB'` | — | Currency |
| min_price | integer | YES | — | — | Minimum found price |
| max_price | integer | YES | — | — | Maximum found price |
| avg_price | integer | YES | — | — | Average price |
| market_min_price | integer | YES | — | — | Market minimum (fallback mode) |
| market_max_price | integer | YES | — | — | Market maximum (fallback mode) |
| market_avg_price | integer | YES | — | — | Market average (fallback mode) |
| sale_price | integer | YES | — | — | Calculated sale price (fallback mode) |
| margin_pct | integer | YES | `0` | — | Applied margin percentage |
| price_note | text | YES | — | — | Price display note |
| search_key | text | YES | — | — | Search key (composite: `oem::make::model` lowercase) |
| model_name | text | YES | — | — | Transmission model name, e.g. "JATCO JF011E" |
| manufacturer | text | YES | — | — | Manufacturer name, e.g. "JATCO", "Aisin", "ZF" |
| origin | text | YES | — | — | Production origin: `japan`, `europe`, `korea`, `usa`, `unknown` |
| mileage_min | integer | YES | — | — | Lowest mileage found across listings (km) |
| mileage_max | integer | YES | — | — | Highest mileage found across listings (km) |
| listings_count | integer | YES | `0` | — | Number of valid listings found |
| search_query | text | YES | — | — | Query string used for price search |
| expires_at | timestamp | YES | — | — | Cache expiry: 7d (found) / 24h (not_found) / 2h (ai_estimate) |
| raw | jsonb | YES | `'{}'` | — | Raw response data + identification result; `raw.listings[]` holds per-listing data |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Snapshot timestamp |
| stage | text | YES | — | — | Pipeline stage that produced this snapshot: `'yandex'`, `'openai_web_search'`, `'not_found'` (added via 0017) |
| urls | text[] | YES | — | — | URLs opened via Playwright in Stage 1 (added via 0017) |
| domains | text[] | YES | — | — | Unique domains found across listings (added via 0017) |

**Indexes:**
- `price_snapshots_tenant_oem_created_idx` on `(tenant_id, oem, created_at DESC)`
- `price_snapshots_oem_created_idx` on `(oem, created_at DESC)`
- `price_snapshots_search_key_idx` on `(tenant_id, search_key)`
- `idx_price_snapshots_oem_expires` on `(oem, expires_at DESC)` — fast global cache lookup

**Cache logic:**
- OEM lookup → `getGlobalPriceSnapshot(cacheKey)` checks `expires_at > now` globally (no tenant filter); `cacheKey = oem::make::model`
- Fallback mode → `getPriceSnapshotsByOem(tenantId, searchKey)` (tenant-scoped, existing behavior)
- Mock results are **never** saved to this table

---

### internal_prices

Internal price catalog (tenant's own prices).

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Price UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| oem | text | NO | — | — | OEM part number |
| price | integer | NO | — | — | Price |
| currency | text | NO | `'RUB'` | — | Currency |
| condition | text | YES | — | — | `used`, `new`, `contract`, etc. |
| supplier | text | YES | — | — | Supplier name |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |

**Indexes:**
- `internal_prices_tenant_oem_condition_supplier_idx` — UNIQUE on `(tenant_id, oem, condition, supplier)`
- `internal_prices_tenant_oem_idx` on `(tenant_id, oem)`

---

### message_templates

Custom message templates with `{{variable}}` placeholders. Used by the price-lookup worker for formatted price replies and payment option suggestions.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Template UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| type | text | NO | — | — | `price_result`, `payment_options`, `tag_request`, `not_found` |
| name | text | NO | — | — | Display name |
| content | text | NO | — | — | Template text with `{{variables}}` |
| is_active | boolean | NO | `true` | — | Active flag |
| order | integer | NO | `0` | — | Display order |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update |

**Indexes:**
- `message_templates_tenant_type_idx` on `(tenant_id, type)`
- `message_templates_tenant_active_idx` on `(tenant_id, is_active)`

---

### payment_methods

Payment method list shown to customers after price suggestions.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Payment method UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| title | text | NO | — | — | Method title (e.g. "Перевод по СБП") |
| description | text | YES | — | — | Optional description |
| is_active | boolean | NO | `true` | — | Active flag |
| order | integer | NO | `0` | — | Display order |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |

**Indexes:**
- `payment_methods_tenant_idx` on `tenant_id`
- `payment_methods_tenant_active_idx` on `(tenant_id, is_active)`

---

### tenant_agent_settings

Per-tenant AI agent configuration. One row per tenant. Allows operators to customise agent identity, response scripts, and the system prompt without changing code.

Added in migration `0010_add_tenant_agent_settings.sql`. Mileage tier columns added in `0012_add_mileage_tiers.sql`.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Settings UUID |
| tenant_id | varchar | NO | — | FK → tenants.id, UNIQUE | One row per tenant |
| company_name | text | YES | — | — | Company display name used in AI facts block |
| specialization | text | YES | — | — | What the company does |
| warehouse_city | text | YES | — | — | City where the warehouse is located |
| warranty_months | integer | YES | — | — | Warranty period in months |
| warranty_km | integer | YES | — | — | Warranty period in kilometers |
| install_days | integer | YES | — | — | Days allowed for installation after delivery |
| qr_discount_percent | integer | YES | — | — | Discount percentage for QR/SBP payments |
| system_prompt | text | YES | — | — | Custom system prompt; if set, replaces `DEFAULT_SYSTEM_PROMPT` |
| objection_payment | text | YES | — | — | Script for "can I pay on delivery?" objection |
| objection_online | text | YES | — | — | Script for "online payment is risky" objection |
| closing_script | text | YES | — | — | Script sent when client is ready to buy |
| custom_facts | jsonb | YES | `'{}'` | — | Extra company facts (arbitrary key-value) |
| mileage_low | integer | YES | — | — | Mileage threshold for quality tier (≤ this = low mileage / expensive). Default 60 000 km |
| mileage_mid | integer | YES | — | — | Mileage threshold for mid tier (≤ this = mid, > this = budget). Default 90 000 km |
| mileage_high | integer | YES | — | — | Informational upper bound for budget tier display. Default 90 000 km |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update timestamp |

**Indexes:**
- `tenant_agent_settings_tenant_idx` on `tenant_id`

**Mileage tier logic (used in price-lookup.worker.ts):**
- `quality tier`: `mileage ≤ mileage_low` — expensive, low mileage listings
- `mid tier`: `mileage_low < mileage ≤ mileage_mid` — average listings
- `budget tier`: `mileage > mileage_mid` — cheap, high mileage listings

---

### max_personal_accounts

MAX Personal (GREEN-API) accounts. Supports multiple accounts per tenant. Added in migrations `0014_max_personal_accounts.sql` + `0015_max_personal_multiaccount.sql`.

Each account corresponds to one GREEN-API instance (phone number registered on the GREEN-API.com platform).

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Account UUID |
| tenant_id | varchar | NO | — | FK → tenants.id | Owning tenant |
| account_id | text | YES | — | — | Stable public identifier (added in 0015) |
| id_instance | text | NO | — | — | GREEN-API instance ID |
| api_token_instance | text | NO | — | — | GREEN-API API token (encrypted at rest) |
| label | text | YES | — | — | Friendly name for the account |
| display_name | text | YES | — | — | Display name shown in UI |
| status | text | NO | `'pending'` | — | Account status |
| webhook_registered | boolean | YES | `false` | — | Whether webhook is registered with GREEN-API |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Creation timestamp |
| updated_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last update timestamp |

**Indexes:**
- `max_personal_accounts_tenant_instance_unique` — UNIQUE on `(tenant_id, id_instance)` (added in 0015, replacing old unique on tenant_id)
- `max_personal_accounts_tenant_idx` on `tenant_id`

**Note:** Early migration (0014) created this table with a single-account-per-tenant constraint. Migration 0015 dropped that constraint to allow multiple accounts per tenant, matching the Telegram Personal model.

---

### transmission_identity_cache

OEM-to-model-name cache populated by `identifyTransmissionByOem()` (GPT-4o-mini). Prevents repeated
GPT calls for the same OEM code across conversations and tenants. Keyed by normalised OEM string.

Added in migration `0016_transmission_identity_cache.sql`. TTL column added in `0018`.

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| id | varchar | NO | `gen_random_uuid()` | PRIMARY KEY | Cache entry UUID |
| oem | text | NO | — | — | Original OEM code as submitted |
| normalized_oem | text | NO | — | UNIQUE | Lowercased, trimmed OEM code (lookup key) |
| model_name | text | YES | — | — | Market/commercial transmission model name (e.g. "JF011E", "U660E") |
| manufacturer | text | YES | — | — | Manufacturer name (e.g. "JATCO", "Aisin", "ZF") |
| origin | text | YES | — | — | `japan`, `europe`, `korea`, `usa`, `unknown` |
| confidence | text | NO | `'high'` | — | `high`, `medium`, `low` — GPT confidence |
| hit_count | integer | NO | `1` | — | Number of times this entry was retrieved |
| last_seen_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Last cache hit timestamp |
| created_at | timestamp | NO | `CURRENT_TIMESTAMP` | — | Initial population timestamp |
| expires_at | timestamp | YES | — | — | Cache expiry — `created_at + 30 days`; backfilled for existing rows via migration 0018 |

**Indexes:**
- `transmission_identity_cache_normalized_oem_unique` — UNIQUE on `normalized_oem`
- `transmission_identity_cache_oem_idx` on `oem`

**Storage methods:**
```typescript
getTransmissionIdentity(normalizedOem: string): Promise<TransmissionIdentityCache | undefined>
saveTransmissionIdentity(data: InsertTransmissionIdentityCache): Promise<TransmissionIdentityCache>
incrementTransmissionIdentityHit(normalizedOem: string): Promise<void>
```

**Cache behaviour:** On OEM lookup in `price-lookup.worker.ts`, if `normalizedOem` hit found and `expires_at` is in the future (or NULL), `hit_count` is incremented and cached identity is returned — no GPT call.

---

## Relationships

```
tenants
 ├── channels              (tenant_id → tenants.id)
 ├── users                 (tenant_id → tenants.id)
 ├── user_invites          (tenant_id → tenants.id)
 ├── customers             (tenant_id → tenants.id)
 │    ├── customer_notes   (customer_id → customers.id)
 │    ├── customer_memory  (customer_id → customers.id)
 │    └── conversations    (customer_id → customers.id)
 │         ├── messages             (conversation_id → conversations.id)
 │         ├── ai_suggestions       (conversation_id → conversations.id)
 │         │    └── human_actions   (suggestion_id → ai_suggestions.id)
 │         ├── escalation_events    (conversation_id → conversations.id)
 │         ├── ai_training_samples  (conversation_id → conversations.id)
 │         ├── learning_queue       (conversation_id → conversations.id)
 │         ├── csat_ratings         (conversation_id → conversations.id)  [1:1]
 │         ├── conversions          (conversation_id → conversations.id)  [1:1]
 │         ├── lost_deals           (conversation_id → conversations.id)
 │         ├── vehicle_lookup_cases (conversation_id → conversations.id)
 │         └── audit_events         (entity_id, polymorphic)
 ├── products              (tenant_id → tenants.id)
 ├── knowledge_docs        (tenant_id → tenants.id)
 │    └── knowledge_doc_chunks (doc_id → knowledge_docs.id, CASCADE)
 ├── rag_documents         (tenant_id → tenants.id)
 │    └── rag_chunks       (rag_document_id → rag_documents.id, CASCADE)
 ├── response_templates    (tenant_id → tenants.id)
 ├── ai_training_policies  (tenant_id → tenants.id)  [1:1]
 ├── decision_settings     (tenant_id → tenants.id)  [1:1]
 ├── human_delay_settings  (tenant_id → tenants.id)  [1:1]
 ├── onboarding_state      (tenant_id → tenants.id)  [1:1]
 ├── readiness_reports     (tenant_id → tenants.id)
 ├── feature_flags         (tenant_id → tenants.id, nullable)
 ├── subscriptions         (tenant_id → tenants.id)  [1:1]
 │    └── plans            (plan_id → plans.id)
 ├── subscription_grants   (tenant_id → tenants.id)
 ├── channel_fingerprints  (tenant_id → tenants.id)
 ├── fraud_flags           (tenant_id → tenants.id)
 ├── integration_secrets   (tenant_id → tenants.id, nullable)
 ├── telegram_sessions     (tenant_id → tenants.id)
 ├── price_snapshots       (tenant_id → tenants.id)
 ├── internal_prices       (tenant_id → tenants.id)
 ├── message_templates     (tenant_id → tenants.id)
 ├── payment_methods       (tenant_id → tenants.id)
 ├── tenant_agent_settings (tenant_id → tenants.id)  [1:1]
 ├── max_personal_accounts (tenant_id → tenants.id)
 └── proxies               (assigned_tenant_id → tenants.id)

users
 ├── admin_actions         (admin_id → users.id)
 ├── customer_notes        (author_user_id → users.id)
 ├── human_actions         (user_id → users.id)
 ├── email_tokens          (user_id → users.id, CASCADE)
 ├── user_invites          (invited_by → users.id)
 ├── learning_queue        (reviewed_by → users.id)
 ├── escalation_events     (handled_by → users.id)
 ├── subscription_grants   (granted_by_user_id / revoked_by_user_id → users.id)
 ├── fraud_flags           (resolved_by → users.id)
 ├── integration_secrets   (created_by_admin_id → users.id)
 └── update_history        (applied_by_id → users.id)

vehicle_lookup_cache
 └── vehicle_lookup_cases  (cache_id → vehicle_lookup_cache.id)
```

---

## Indexes

### Unique Indexes

| Index | Table | Columns | Condition |
|-------|-------|---------|-----------|
| `users_email_unique_lower_idx` | users | `LOWER(email)` | `WHERE email IS NOT NULL` |
| `customers_tenant_channel_external_idx` | customers | `(tenant_id, channel, external_id)` | — |
| `customer_memory_tenant_customer_idx` | customer_memory | `(tenant_id, customer_id)` | — |
| `csat_ratings_conversation_idx` | csat_ratings | `conversation_id` | — |
| `conversions_conversation_idx` | conversions | `conversation_id` | — |
| `integration_secrets_active_unique_idx` | integration_secrets | `(scope, COALESCE(tenant_id,''), key_name)` | `WHERE revoked_at IS NULL` |
| `internal_prices_tenant_oem_condition_supplier_idx` | internal_prices | `(tenant_id, oem, condition, supplier)` | — |
| (built-in) | users | `username` | — |
| (built-in) | user_invites | `token_hash` | — |
| (built-in) | email_tokens | `token_hash` | — |
| (built-in) | feature_flags | `name` | — |
| (built-in) | subscriptions | `tenant_id` | — |
| (built-in) | subscriptions | `stripe_subscription_id` | — |
| (built-in) | vehicle_lookup_cache | `lookup_key` | — |

### Regular Indexes

| Index | Table | Columns |
|-------|-------|---------|
| `IDX_session_expire` | sessions | `expire` |
| `telegram_sessions_tenant_idx` | telegram_sessions | `tenant_id` |
| `subscription_grants_active_lookup_idx` | subscription_grants | `(tenant_id, revoked_at, ends_at, starts_at)` |
| `integration_secrets_tenant_key_idx` | integration_secrets | `(tenant_id, key_name)` |
| `proxies_status_idx` | proxies | `status` |
| `proxies_tenant_idx` | proxies | `assigned_tenant_id` |
| `proxies_channel_idx` | proxies | `assigned_channel_id` |
| `vehicle_lookup_cache_normalized_value_idx` | vehicle_lookup_cache | `normalized_value` |
| `vehicle_lookup_cases_tenant_conversation_idx` | vehicle_lookup_cases | `(tenant_id, conversation_id)` |
| `vehicle_lookup_cases_status_idx` | vehicle_lookup_cases | `status` |
| `vehicle_lookup_cases_normalized_value_idx` | vehicle_lookup_cases | `normalized_value` |
| `price_snapshots_tenant_oem_created_idx` | price_snapshots | `(tenant_id, oem, created_at DESC)` |
| `price_snapshots_oem_created_idx` | price_snapshots | `(oem, created_at DESC)` |
| `price_snapshots_search_key_idx` | price_snapshots | `(tenant_id, search_key)` |
| `internal_prices_tenant_oem_idx` | internal_prices | `(tenant_id, oem)` |

---

## Migrations History

| # | File | Description |
|---|------|-------------|
| 0 | `0000_pre_migration_check_duplicates.sql` | Pre-flight query to detect duplicate emails before creating unique index. No schema changes. |
| 1a | `0001a_normalize_emails.sql` | Normalizes existing emails to `LOWER(TRIM(email))`. Idempotent data migration. |
| 1b | `0001b_create_email_unique_index.sql` *(manual)* | Creates `users_email_unique_lower_idx` using `CONCURRENTLY` (cannot run in transaction). Copy from `migrations/manual/`. |
| 2 | `0002_subscription_grants_indexes.sql` | Creates `subscription_grants_active_lookup_idx` for fast grant lookups. |
| 3 | `0003_vehicle_lookup_tables.sql` | Creates `vehicle_lookup_cache` and `vehicle_lookup_cases` tables with indexes. |
| 4 | `0004_tenants_templates.sql` | Adds `templates` (JSONB) column to `tenants`. |
| 5 | `0005_price_snapshots.sql` | Creates `price_snapshots` table with `(tenant_id, oem, created_at)` indexes. |
| 6a | `0006_internal_prices.sql` | Creates `internal_prices` table with composite unique index. |
| 6b | `0006_telegram_multiaccount.sql` | Makes `phone_number` nullable in `telegram_sessions`; adds `auth_method`, `is_enabled`, and tenant index. |
| 7 | `0007_price_commercial.sql` | Adds market price columns (`market_min_price`, `market_max_price`, `market_avg_price`, `sale_price`, `margin_pct`, `price_note`) to `price_snapshots`. |
| 8 | `0008_price_snapshot_search_key.sql` | Adds `search_key` column to `price_snapshots` with index and backfill (`search_key = oem`). |
| 9 | `0009_add_templates_and_payment_methods.sql` | Creates `message_templates` and `payment_methods` tables with indexes. |
| 10 | `0010_add_tenant_agent_settings.sql` | Creates `tenant_agent_settings` table with UNIQUE constraint on `tenant_id` and index. |
| 11 | `0011_update_price_snapshots.sql` | Makes `tenant_id` nullable (global cache), adds `model_name`, `manufacturer`, `origin`, `mileage_min`, `mileage_max`, `listings_count`, `search_query`, `expires_at`. Adds `idx_price_snapshots_oem_expires` index. |
| 12 | `0012_add_mileage_tiers.sql` | Adds `mileage_low`, `mileage_mid`, `mileage_high` integer columns to `tenant_agent_settings` for two-step price dialog tier splitting. |
| 13 | `0013_feature_flags_composite_unique.sql` | Fixes feature_flags uniqueness to support per-tenant overrides. Drops old column-level unique. Creates two partial unique indexes: `feature_flags_global_unique` (name WHERE tenant_id IS NULL) and `feature_flags_tenant_unique` (name, tenant_id WHERE tenant_id IS NOT NULL). |
| 14 | `0014_max_personal_accounts.sql` | Creates `max_personal_accounts` table for MAX Personal (GREEN-API) integration. Initial version: single account per tenant. |
| 15 | `0015_max_personal_multiaccount.sql` | Drops single-account-per-tenant constraint. Adds `account_id` column (stable public identifier) and `label` column. Creates new unique constraint on `(tenant_id, id_instance)` to allow multiple accounts per tenant. |
| 16 | `0016_transmission_identity_cache.sql` | Creates `transmission_identity_cache` table with UNIQUE index on `normalized_oem` and regular index on `oem`. Caches GPT-4o-mini OEM identification results. |
| 17 | `0017_price_snapshots_stage.sql` | Adds `stage TEXT`, `urls TEXT[]`, `domains TEXT[]` to `price_snapshots` for the Yandex+Playwright price pipeline. |
| 18 | `0018_transmission_identity_cache_ttl.sql` | Adds `expires_at TIMESTAMP` to `transmission_identity_cache`. Backfills `expires_at = created_at + interval '30 days'` for all existing rows. |
| 19 | `0019_ai_suggestions_escalation.sql` | Adds `escalation_data JSONB` to `ai_suggestions` for structured operator escalation payload (manual price search context, ready queries, suggested sites). |

---

## Drizzle Schema Location

| Item | Path |
|------|------|
| **Main schema** | `shared/schema.ts` — defines all 49 tables, insert schemas, types, enums, and constants |
| **Auth models** | `shared/models/auth.ts` — `sessions` and `auth_users` tables (express-session store and OIDC profiles) |
| **Chat models** | `shared/models/chat.ts` — legacy chat schema (serial IDs, simplified conversations/messages) |
| **Drizzle config** | `drizzle.config.ts` — `dialect: "postgresql"`, `schema: "./shared/schema.ts"`, `out: "./migrations"` |
| **DB connection** | `server/db.ts` — creates `Pool` from `pg` and Drizzle instance with all schema tables |
| **Migrations** | `./migrations/` — SQL migration files, applied in numeric order |

The main schema file (`shared/schema.ts`) at ~1564 lines is the single source of truth for all database entities. Tables are defined using Drizzle's `pgTable()`, insert schemas are generated via `createInsertSchema()` from `drizzle-zod`, and TypeScript types are inferred using `$inferSelect` / `$inferInsert`.
