# PROJECT_MAP.md — AI Sales Operator

> **Read this file at the start of every non-trivial task.**
> Last updated: 2026-02-24 (Phase 1-3: Yandex+Playwright price pipeline, escalation, feature flags)

---

## Overview

Multi-tenant B2B SaaS for automating customer service via Telegram / WhatsApp / MAX.
Domain: contract gearboxes (KPP). AI agent detects VIN/FRAME, looks up OEM codes, fetches prices,
renders message templates, and suggests replies to operators.

---

## Tech Stack

### Frontend
- React 18.3.1 + Vite 7.3.0
- TypeScript 5.6.3 (strict mode, `noEmit`)
- Tailwind CSS 3.4.17 + shadcn/ui (new-york style, neutral base, CSS variables)
- TanStack React Query 5.60.5 (`staleTime: Infinity`, no auto-refetch)
- wouter 3.3.5 (routing — NOT react-router)
- react-hook-form 7.55.0 + @hookform/resolvers 3.10.0
- recharts 2.15.2, framer-motion 11.13.1
- lucide-react 0.453.0, cmdk 1.1.1
- 40+ Radix UI primitives in `client/src/components/ui/`

### Backend
- Node.js + Express 4.21.2
- TypeScript 5.6.3 (ESM, `"type": "module"`)
- Drizzle ORM 0.39.3 + drizzle-kit 0.31.8 (PostgreSQL)
- Zod 3.25.76 (validation everywhere)
- BullMQ 5.66.4 (queues: vehicle_lookup_queue, price_lookup_queue, message_send_queue)
- ioredis 5.9.0 (Redis client)
- OpenAI 6.15.0 (GPT-4o-mini for Decision Engine, text-embedding-3-large for RAG)
- telegram 2.26.22 (gramjs — MTProto Personal)
- @whiskeysockets/baileys 7.0.0-rc.9 (WhatsApp Personal)
- cheerio 1.2.0 (Avito/Drom HTML parsing)
- bcrypt 6.0.0, passport 0.7.0
- pino 10.1.0, p-limit 7.2.0, p-retry 7.1.1
- ws 8.18.0 (WebSocket server)

### Python Services
- Python >= 3.11
- FastAPI >= 0.128.0 + uvicorn >= 0.40.0
- Playwright >= 1.57.0 (browser automation)
- pydantic >= 2.12.5, httpx >= 0.28.1, aiohttp >= 3.13.3
- Deps in `pyproject.toml`

### Infrastructure
- PostgreSQL (49 tables, via Drizzle ORM)
- Redis (BullMQ + caching)
- PM2 (`ecosystem.config.cjs`)
- Docker (node:20-alpine) / Nixpacks (Node 20)
- esbuild (server -> dist/index.cjs), Vite (client -> dist/public/)

---

## Directory Structure

```
ai-sales/
├── client/                          # React frontend (Vite SPA)
│   ├── index.html                   # Entry HTML
│   └── src/
│       ├── App.tsx                  # Root: wouter routing, auth guard, sidebar shell
│       ├── main.tsx                 # React mount into #root
│       ├── index.css                # Tailwind base + dark/light CSS variables
│       ├── components/
│       │   ├── ui/                  # 40+ shadcn/ui primitives (DO NOT edit manually)
│       │   ├── app-sidebar.tsx      # Navigation with unread/escalation badges
│       │   ├── chat-interface.tsx   # Chat: messages, AI suggestions, manual input
│       │   ├── conversation-list.tsx
│       │   ├── customer-card.tsx    # Customer info + tags + channel icons
│       │   ├── metrics-card.tsx     # Dashboard metric card with trend
│       │   ├── csat-dialog.tsx      # 1-5 star CSAT rating
│       │   ├── subscription-paywall.tsx
│       │   └── theme-toggle.tsx
│       ├── pages/                   # 20 page components
│       │   ├── dashboard.tsx        # Overview metrics + recent escalations
│       │   ├── conversations.tsx    # Conversation list + chat (main working view)
│       │   ├── settings.tsx         # All config: 8 tabs — Business, Communication, Working Hours, Escalation, AI Behavior, Шаблоны, Оплата, Channels (~4500 lines)
│       │   ├── analytics.tsx        # CSAT, conversion, intent, lost-deal charts
│       │   ├── billing.tsx          # CryptoBot checkout, 50 USDT/month
│       │   ├── auth.tsx             # Login/Signup/Verify/Forgot/Reset
│       │   ├── onboarding.tsx       # 6-step wizard
│       │   ├── escalations.tsx      # Escalation management
│       │   ├── knowledge-base.tsx   # Knowledge base documents
│       │   ├── products.tsx         # Product catalog
│       │   ├── customer-profile.tsx # Customer detail view
│       │   ├── security-status.tsx  # Security readiness panel
│       │   ├── admin-billing.tsx    # Platform admin: billing
│       │   ├── admin-proxies.tsx    # Platform admin: proxy management
│       │   ├── admin-secrets.tsx    # Platform admin: secrets
│       │   ├── admin-users.tsx      # Platform admin: users
│       │   ├── owner-dashboard.tsx  # Platform owner dashboard
│       │   ├── owner-login.tsx      # Platform owner login
│       │   ├── owner-updates.tsx    # Platform owner: system updates
│       │   └── not-found.tsx        # 404
│       ├── hooks/
│       │   ├── use-auth.ts          # Auth state (polls GET /api/auth/user)
│       │   ├── use-billing.ts       # Billing state + checkout + cancel
│       │   ├── use-mobile.tsx       # Mobile breakpoint (768px)
│       │   └── use-toast.ts
│       └── lib/
│           ├── queryClient.ts       # TanStack Query client + apiRequest() fetch wrapper
│           ├── websocket.ts         # WS client (/ws), invalidates Query caches
│           ├── theme-provider.tsx   # Theme context
│           ├── auth-utils.ts        # Unauthorized redirect
│           └── utils.ts             # cn() for Tailwind class merging
│
├── server/                          # Express.js backend
│   ├── index.ts                     # Entry: middleware, routes, WS, session restore, Python spawn
│   ├── routes.ts                    # Central route registration (100+ endpoints)
│   ├── db.ts                        # PostgreSQL pool + Drizzle instance
│   ├── config.ts                    # Zod-based env validation
│   ├── storage.ts                   # IStorage interface (80+ methods) + DatabaseStorage export
│   ├── database-storage.ts          # Full PostgreSQL IStorage implementation
│   ├── session.ts                   # Express session (connect-pg-simple, 7-day TTL)
│   ├── static.ts                    # SPA fallback for production
│   ├── vite.ts                      # Vite dev server HMR middleware
│   ├── redis-client.ts              # ioredis client singleton
│   ├── routes/                      # Sub-routers (mounted in routes.ts)
│   │   ├── auth.ts                  # /auth/* — signup, login, logout, invite, email verify, password reset
│   │   ├── auth-api.ts              # GET /api/auth/user
│   │   ├── admin.ts                 # /api/admin/* — tenants, users, secrets, proxies, billing
│   │   ├── phase0.ts                # Feature flags CRUD + audit log
│   │   ├── health.ts                # /health, /ready, /metrics
│   │   ├── conversation.routes.ts   # /api/conversations/* CRUD + status changes
│   │   ├── customer.routes.ts       # /api/customers/* CRUD + notes + memory
│   │   ├── product.routes.ts        # /api/products/* CRUD
│   │   ├── knowledge-base.routes.ts # /api/knowledge-docs/*
│   │   ├── analytics.routes.ts      # /api/analytics/* (CSAT, conversion, intent, lost-deals)
│   │   ├── billing.routes.ts        # /api/billing/* (CryptoBot checkout, subscription)
│   │   ├── onboarding.routes.ts     # /api/onboarding/* (6-step wizard state)
│   │   ├── vehicle-lookup.routes.ts # /api/vehicle-lookup/*
│   │   ├── tenant-config.routes.ts  # /api/templates/* + /api/payment-methods/* + /api/agent-settings/* (NEW)
│   │   ├── telegram-webhook.ts      # Telegram Bot API webhook
│   │   ├── whatsapp-webhook.ts      # WhatsApp Business webhook
│   │   └── max-webhook.ts           # MAX Bot webhook
│   ├── services/                    # Business logic layer
│   │   ├── inbound-message-handler.ts   # CENTRAL PIPELINE — all Personal channels converge here
│   │   ├── decision-engine.ts           # AI generation — DO NOT MODIFY without strong reason
│   │   ├── template-renderer.ts         # {{variable}} template renderer (NEW)
│   │   ├── channel-adapter.ts           # ChannelAdapter interface + registry + stub adapters
│   │   ├── telegram-client-manager.ts   # Multi-account Telegram (key: tenantId:accountId)
│   │   ├── telegram-personal-adapter.ts # MTProto auth + send/receive
│   │   ├── telegram-session-crypto.ts   # AES-256-GCM encryption for Telegram sessions
│   │   ├── telegram-adapter.ts          # Telegram Bot API adapter
│   │   ├── whatsapp-personal-adapter.ts # Baileys auth + send/receive
│   │   ├── whatsapp-adapter.ts          # WhatsApp Business API adapter
│   │   ├── max-personal-adapter.ts      # HTTP client to Python MAX service (port 8100)
│   │   ├── max-adapter.ts               # MAX Bot API adapter
│   │   ├── vehicle-lookup-queue.ts      # BullMQ queue for VIN/FRAME lookups
│   │   ├── podzamenu-lookup-client.ts   # HTTP client to Python Podzamenu (port 8200)
│   │   ├── gearbox-templates.ts         # 5 Russian templates for gearbox lookup replies
│   │   ├── price-lookup-queue.ts        # BullMQ queue for price lookups
│   │   ├── transmission-identifier.ts   # GPT-4o-mini: identify model/manufacturer/origin from OEM (NEW)
│   │   ├── price-searcher.ts            # Price search orchestrator: Stage 1 Yandex+Playwright; GPT web_search fallback (GPT_WEB_SEARCH_ENABLED)
│   │   ├── playwright-fetcher.ts        # Node.js → Python Playwright bridge: POST /fetch-page; fetch() fallback if service down
│   │   ├── price-sources/               # Price source adapters (OEM fallback / no-OEM mode)
│   │   │   ├── types.ts                 # PriceSource, PriceResult, GearboxType, detectGearboxType(), ListingItem (city, sourceUrl added)
│   │   │   ├── avito-source.ts          # Avito HTML parsing (cheerio; disabled — AVITO_ENABLED=true to enable)
│   │   │   ├── drom-source.ts           # Drom HTML parsing (cheerio; disabled — DROM_ENABLED=true to enable)
│   │   │   ├── web-source.ts            # SerpAPI adapter — DEPRECATED, superseded by yandex-source.ts
│   │   │   ├── yandex-source.ts         # Yandex Cloud Search API v2 client; domain priority scoring; excluded domains
│   │   │   └── mock-source.ts           # Fixed fallback (never saved to internal_prices or price_snapshots)
│   │   ├── rag-retrieval.ts             # RAG: embed query -> cosine similarity -> top results
│   │   ├── rag-indexer.ts               # RAG: products/docs -> chunks with SHA-256 hashes
│   │   ├── embedding-service.ts         # OpenAI text-embedding-3-large (3072 dimensions)
│   │   ├── few-shot-builder.ts          # Few-shot prompt builder: DB samples + BUILTIN_FEW_SHOT_EXAMPLES fallback
│   │   ├── feature-flags.ts             # In-memory + JSON file feature flag service
│   │   ├── message-queue.ts             # BullMQ message_send_queue (delayed sending)
│   │   ├── websocket-server.ts          # WS on /ws — broadcasts events
│   │   ├── billing-service.ts           # Stripe billing
│   │   ├── cryptobot-billing.ts         # CryptoBot billing (primary — 50 USDT/month)
│   │   ├── auth-service.ts              # Signup, login (lockout after 5 fails), password reset
│   │   ├── owner-bootstrap.ts           # Platform owner creation from env vars at startup
│   │   ├── audit-log.ts                 # Batched write to `audit_events` table (500ms flush, ALS context)
│   │   ├── secret-store.ts              # AES-256-GCM encryption for secrets
│   │   ├── secret-resolver.ts           # Secret resolution (env -> DB secrets cascade)
│   │   ├── fraud-detection-service.ts   # Channel fingerprinting + trial eligibility
│   │   ├── human-delay-engine.ts        # Human-like typing delay calculation
│   │   ├── csat-service.ts              # CSAT 1-5 ratings + analytics
│   │   ├── conversion-service.ts        # Conversion tracking
│   │   ├── lost-deals-service.ts        # Auto-detect lost deals
│   │   ├── intent-analytics-service.ts  # Per-intent analytics
│   │   ├── customer-summary-service.ts  # GPT-4o-mini customer summaries
│   │   ├── learning-score-service.ts    # Learning queue scoring
│   │   ├── training-sample-service.ts   # Training samples from human feedback
│   │   ├── onboarding-templates.ts      # GPT-4o policy/FAQ generation during onboarding
│   │   ├── document-chunking-service.ts # Splits knowledge docs into chunks
│   │   ├── readiness-score-service.ts   # Tenant readiness scoring (7 checks)
│   │   ├── smoke-test-service.ts        # Smoke test: AI suggestion round-trip
│   │   ├── security-readiness.ts        # Security configuration checks
│   │   ├── proxy-service.ts             # Proxy assignment and management
│   │   ├── update-service.ts            # System update file handling
│   │   ├── admin-action-service.ts      # Admin action logging + idempotency
│   │   ├── email-provider.ts            # Email sending (SMTP abstraction)
│   │   ├── customer-data-deletion-service.ts  # GDPR-compliant data deletion
│   │   └── route-registry.ts            # Auto-discovery of registered Express routes
│   ├── workers/                     # BullMQ workers (separate processes or inline)
│   │   ├── vehicle-lookup.worker.ts # VIN/FRAME -> Python -> cache -> suggestion -> price trigger
│   │   ├── price-lookup.worker.ts   # OEM mode: cache → identify → Yandex+Playwright pipeline → escalation (PRICE_ESCALATION_ENABLED) → not_found
│   │   │                            # Fallback/no-OEM mode: Avito → Drom → GPT web search → mock
│   │   │                            # Renders price_result / price_options template + payment methods suggestion
│   │   └── message-send.worker.ts   # Delayed message sending via channel adapters
│   ├── middleware/
│   │   ├── rbac.ts                  # 5 roles, 16 permissions
│   │   ├── rate-limiter.ts          # In-memory rate limiting (global + per-tenant)
│   │   ├── validation.ts            # validateBody / validateQuery / validateParams
│   │   ├── error-handler.ts         # Central error handler (Zod->400)
│   │   ├── webhook-security.ts      # HMAC-SHA256 webhook verification
│   │   ├── subscription.ts          # requireActiveSubscription guard
│   │   ├── fraud-protection.ts      # Block restricted tenants
│   │   ├── platform-admin.ts        # isPlatformAdmin guard
│   │   ├── platform-owner.ts        # isPlatformOwner guard
│   │   ├── csrf.ts                  # CSRF protection
│   │   └── request-context.ts       # Request ID (X-Request-Id or UUID)
│   ├── utils/
│   │   └── sanitizer.ts             # PII masking (API keys, JWT, email, phone, cards)
│   ├── batch/
│   │   ├── index.ts                 # Re-exports
│   │   └── utils.ts                 # Batch processing with p-limit + p-retry
│   ├── scripts/
│   │   └── migrate.ts               # Standalone migration runner
│   ├── __tests__/                   # Vitest unit tests (25 files)
│   │   └── helpers/
│   │       └── mem-storage.ts       # In-memory IStorage mock for tests
│   └── tests/                       # Vitest integration/e2e tests (24 files)
│
├── shared/                          # Shared between client and server
│   ├── schema.ts                    # 49 Drizzle tables, all enums/constants, Zod schemas, types
│   └── models/
│       ├── auth.ts                  # Session table + authUsers (OIDC profiles)
│       └── chat.ts                  # Legacy chat schema (unused)
│
├── migrations/                      # Drizzle SQL migrations
│   ├── 0000_pre_migration_check_duplicates.sql
│   ├── 0001a_normalize_emails.sql
│   ├── 0002_subscription_grants_indexes.sql
│   ├── 0003_vehicle_lookup_tables.sql
│   ├── 0004_tenants_templates.sql
│   ├── 0005_price_snapshots.sql
│   ├── 0006_internal_prices.sql
│   ├── 0006_telegram_multiaccount.sql   # Two files share prefix 0006 — apply carefully
│   ├── 0007_price_commercial.sql
│   ├── 0008_price_snapshot_search_key.sql
│   ├── 0009_add_templates_and_payment_methods.sql  # message_templates + payment_methods
│   ├── 0010_add_tenant_agent_settings.sql          # tenant_agent_settings table
│   ├── 0011_update_price_snapshots.sql             # global cache: nullable tenant_id, new columns, expiresAt
│   ├── 0012_add_mileage_tiers.sql                  # mileage_low/mid/high columns in tenant_agent_settings
│   ├── 0013_feature_flags_composite_unique.sql     # partial unique indexes for per-tenant flag overrides
│   ├── 0014_max_personal_accounts.sql              # max_personal_accounts table (GREEN-API)
│   ├── 0015_max_personal_multiaccount.sql          # multi-account: account_id + label, new unique constraint
│   ├── 0016_transmission_identity_cache.sql        # transmission_identity_cache table (OEM → model name cache)
│   ├── 0017_price_snapshots_stage.sql              # stage TEXT, urls TEXT[], domains TEXT[] on price_snapshots
│   ├── 0018_transmission_identity_cache_ttl.sql    # expires_at TIMESTAMP + 30-day TTL backfill on transmission_identity_cache
│   ├── 0019_ai_suggestions_escalation.sql          # escalation_data JSONB on ai_suggestions
│   └── manual/
│       ├── 0001b_create_email_unique_index.sql
│       └── README.md
│
├── max_personal_service.py          # Python: MAX Personal auth via Playwright (port 8100)
├── podzamenu_lookup_service.py      # Python: VIN/FRAME lookup via Playwright (port 8200) + POST /fetch-page (price pipeline)
├── test_regression_iter4.py         # Python: Regression test for 48 VINs
│
├── script/
│   └── build.ts                     # esbuild server + Vite client build script
│
├── .cursor/
│   ├── agents/                      # Specialist agent definitions
│   └── prompts/                     # Reusable AI prompt templates
│
├── docs/
│   ├── API_REFERENCE.md
│   ├── DATABASE_SCHEMA.md
│   ├── CONVENTIONS.md
│   └── AUDIT_AND_IMPROVEMENTS.md
│
├── package.json                     # Node deps + scripts
├── tsconfig.json                    # Strict TS, ESNext, paths: @/* -> client/src/*, @shared/* -> shared/*
├── vite.config.ts                   # React plugin, aliases (@, @shared, @assets)
├── drizzle.config.ts                # PostgreSQL, schema: shared/schema.ts, out: ./migrations
├── tailwind.config.ts               # Dark mode (class), shadcn theme
├── postcss.config.js
├── components.json                  # shadcn/ui config
├── ecosystem.config.cjs             # PM2: aisales + worker-price-lookup
├── nixpacks.toml                    # Node 20 deployment
├── Dockerfile                       # node:20-alpine
├── pyproject.toml                   # Python >= 3.11 deps
├── feature_flags.json               # 12 feature flags with defaults
├── .env.example                     # All env vars documented
└── start.sh                         # drizzle-kit migrate && node dist/index.cjs
```

---

## Database Schema (48 tables in shared/schema.ts)

### Core Tenant & User
| Table | Description |
|-------|-------------|
| `tenants` | Multi-tenant root. Holds tone, currency, timezone, working hours, templates JSONB |
| `users` | Operators/owners. 5 roles, bcrypt passwords, lockout, platform flags |
| `user_invites` | Team invite tokens (SHA-256 hash, single-use) |
| `admin_actions` | Platform admin audit log |
| `email_tokens` | Email verification + password reset tokens (SHA-256 hashes only) |

### Messaging
| Table | Description |
|-------|-------------|
| `channels` | Channel configs (whatsapp, telegram, max + personal variants) |
| `customers` | End users. Unique on (tenantId, channel, externalId) |
| `customer_notes` | Operator notes on customers |
| `customer_memory` | Long-term memory: preferences + frequent topics |
| `conversations` | Conversation threads. Statuses: active, waiting_customer, waiting_operator, escalated, resolved |
| `messages` | Individual messages. Roles: customer, assistant, owner |
| `escalation_events` | Escalation records with suggested responses |

### AI & Learning
| Table | Description |
|-------|-------------|
| `ai_suggestions` | Extended for Decision Engine: confidence, decision, penalties, autosend triple-lock, `escalation_data JSONB` (operator manual search payload, added via 0019) |
| `human_actions` | approve/edit/reject/escalate tracking |
| `ai_training_samples` | Dataset for few-shot learning |
| `ai_training_policies` | Per-tenant learning config |
| `learning_queue` | Conversations needing review |
| `response_templates` | Operator quick-reply templates |
| `decision_settings` | Per-tenant thresholds (tAuto, tEscalate, autosend). `intentsForceHandoff` defaults: discount, complaint, photo_request, needs_manual_quote, want_visit |
| `human_delay_settings` | Human-like delay profiles per tenant |

### Knowledge Base & RAG
| Table | Description |
|-------|-------------|
| `products` | Product catalog |
| `knowledge_docs` | Policy/FAQ/delivery/returns documents |
| `knowledge_doc_chunks` | Document chunks for retrieval |
| `rag_documents` | Unified RAG index (PRODUCT or DOC) |
| `rag_chunks` | RAG chunks with text embeddings |

### Analytics
| Table | Description |
|-------|-------------|
| `csat_ratings` | 1-5 star ratings per conversation |
| `conversions` | Purchase tracking |
| `lost_deals` | Lost deal events with reason codes |
| `feature_flags` | DB-persisted feature flags |
| `audit_events` | Fine-grained audit trail |
| `readiness_reports` | Tenant readiness check snapshots |

### Auth & Sessions
| Table | Description |
|-------|-------------|
| `telegram_sessions` | MTProto sessions (AES-256-GCM encrypted) |
| `onboarding_state` | 6-step wizard progress |

### Billing & Anti-Fraud
| Table | Description |
|-------|-------------|
| `plans` | Subscription plans (50 USDT/month) |
| `subscriptions` | One per tenant (CryptoBot or Stripe) |
| `subscription_grants` | Manual comping by platform admins |
| `channel_fingerprints` | SHA-256 hashes of channel identifiers |
| `fraud_flags` | Detected fraud attempts |

### Infrastructure
| Table | Description |
|-------|-------------|
| `integration_secrets` | AES-256-GCM encrypted API keys |
| `update_history` | System update file history |
| `proxies` | Proxy pool (socks5/http/https) |

### Vehicle & Price Lookup
| Table | Description |
|-------|-------------|
| `vehicle_lookup_cache` | VIN/FRAME lookup results cache |
| `vehicle_lookup_cases` | Per-conversation lookup cases |
| `price_snapshots` | Global price cache per OEM (`tenantId = null`). Columns: model, manufacturer, origin, mileage range, listingsCount, expiresAt, searchQuery, raw JSONB, `stage TEXT` (yandex/openai_web_search/not_found), `urls TEXT[]` (Playwright URLs), `domains TEXT[]` (unique domains). TTL: 7d / 24h (not_found) / 2h (ai_estimate) |
| `internal_prices` | Tenant's own price list per OEM |
| `transmission_identity_cache` | OEM → transmission model name cache (GPT-4o-mini). Fields: normalizedOem (UNIQUE), modelName, manufacturer, origin, confidence, hitCount, lastSeenAt, createdAt, `expires_at TIMESTAMP` (30-day TTL, backfilled via 0018) |

### Tenant Configuration (NEW in migrations 0009–0010)
| Table | Description |
|-------|-------------|
| `message_templates` | Custom message templates with `{{variable}}` placeholders. Types: `price_result`, `price_options`, `payment_options`, `tag_request`, `not_found`. Ordered, activatable per tenant |
| `payment_methods` | Payment method list shown after price suggestions. Title + description, ordered, activatable |
| `tenant_agent_settings` | Per-tenant AI agent configuration (0010 + 0012). One row per tenant. Stores company facts, response scripts, optional custom system prompt, and mileage tier thresholds (`mileage_low`, `mileage_mid`, `mileage_high`) for two-step price dialog |

---

## API Endpoints

Routes are registered in `server/routes.ts` via `registerRoutes(httpServer, app)`.
Sub-routers are mounted via `app.use(...)`.

### Auth (`server/routes/auth.ts` + `auth-api.ts`)
- `POST /auth/signup` — new tenant + owner user
- `POST /auth/login` — session login (lockout after 5 fails)
- `POST /auth/logout`
- `GET  /auth/verify-email` — email token verification
- `POST /auth/forgot-password`, `POST /auth/reset-password`
- `POST /api/auth/invite` — send team invite
- `POST /api/auth/accept-invite`
- `GET  /api/auth/user` — current session user

### Conversations (`server/routes/conversation.routes.ts`)
- `GET  /api/conversations`
- `POST /api/conversations`
- `GET  /api/conversations/:id`
- `PATCH /api/conversations/:id/status`
- `GET  /api/conversations/:id/messages`
- `POST /api/conversations/:id/messages`
- `GET  /api/conversations/:id/suggestions`
- `POST /api/suggestions/:id/approve`
- `POST /api/suggestions/:id/reject`

### Customers (`server/routes/customer.routes.ts`)
- `GET  /api/customers/:id`
- `PATCH /api/customers/:id`
- `GET  /api/customers/:id/notes`
- `POST /api/customers/:id/notes`
- `GET  /api/customers/:id/memory`
- `PATCH /api/customers/:id/memory`

### Products (`server/routes/product.routes.ts`)
- `GET  /api/products`
- `POST /api/products`
- `PATCH /api/products/:id`
- `DELETE /api/products/:id`

### Knowledge Base (`server/routes/knowledge-base.routes.ts`)
- `GET  /api/knowledge-docs`
- `POST /api/knowledge-docs`
- `PATCH /api/knowledge-docs/:id`
- `DELETE /api/knowledge-docs/:id`
- `POST /api/rag/index` — trigger RAG re-indexing

### Analytics (`server/routes/analytics.routes.ts`)
- `GET /api/analytics/csat`
- `GET /api/analytics/conversions`
- `GET /api/analytics/intents`
- `GET /api/analytics/lost-deals`
- `POST /api/csat` — submit CSAT rating

### Billing (`server/routes/billing.routes.ts`)
- `GET  /api/billing/status`
- `POST /api/billing/checkout` — CryptoBot invoice creation
- `POST /api/billing/cancel`
- `POST /api/billing/cryptobot/webhook`

### Onboarding (`server/routes/onboarding.routes.ts`)
- `GET  /api/onboarding/state`
- `POST /api/onboarding/step`
- `POST /api/onboarding/complete`
- `GET  /api/readiness`

### Vehicle Lookup (`server/routes/vehicle-lookup.routes.ts`)
- `GET  /api/vehicle-lookup/cases`
- `GET  /api/vehicle-lookup/cases/:id`
- `POST /api/vehicle-lookup/tag-confirm`

### Message Templates (`server/routes/tenant-config.routes.ts`) — NEW
- `GET    /api/templates` — list all templates for tenant
- `POST   /api/templates` — create template (MANAGE_TENANT_SETTINGS)
- `POST   /api/templates/preview` — render template with sample data (VIEW_CONVERSATIONS)
- `PATCH  /api/templates/:id` — update template (MANAGE_TENANT_SETTINGS)
- `DELETE /api/templates/:id` — delete template (MANAGE_TENANT_SETTINGS)

### Payment Methods (`server/routes/tenant-config.routes.ts`) — NEW
- `GET    /api/payment-methods` — list all for tenant
- `POST   /api/payment-methods` — create (MANAGE_TENANT_SETTINGS)
- `PATCH  /api/payment-methods/reorder` — bulk reorder (MANAGE_TENANT_SETTINGS)
- `PATCH  /api/payment-methods/:id` — update (MANAGE_TENANT_SETTINGS)
- `DELETE /api/payment-methods/:id` — delete (MANAGE_TENANT_SETTINGS)

### Agent Settings (`server/routes/tenant-config.routes.ts`) — NEW
- `GET  /api/agent-settings` — get current tenant's agent settings (MANAGE_TENANT_SETTINGS)
- `PUT  /api/agent-settings` — create/update agent settings (MANAGE_TENANT_SETTINGS)

### Phase 0 / Feature Flags (`server/routes/phase0.ts`)
- `GET  /api/feature-flags`
- `POST /api/feature-flags`
- `PATCH /api/feature-flags/:name`
- `GET  /api/audit-log`

### Telegram Personal (`server/routes.ts` — inline)
- `GET  /api/telegram/sessions`
- `POST /api/telegram/auth/send-code`
- `POST /api/telegram/auth/verify-code`
- `POST /api/telegram/auth/verify-password`
- `POST /api/telegram/auth/start-qr`
- `GET  /api/telegram/auth/check-qr/:sessionId`
- `POST /api/telegram/auth/verify-qr-2fa`
- `POST /api/telegram/sessions/:id/disconnect`
- `DELETE /api/telegram/sessions/:id`
- `GET  /api/telegram/sessions/:id/dialogs`

### WhatsApp Personal (`server/routes.ts` — inline)
- `GET  /api/whatsapp/sessions`
- `POST /api/whatsapp/auth/start`
- `GET  /api/whatsapp/auth/qr/:sessionId`
- `POST /api/whatsapp/sessions/:id/disconnect`

### Admin (`server/routes/admin.ts`)
- `GET  /api/admin/tenants`
- `GET  /api/admin/tenants/:id`
- `POST /api/admin/tenants/:id/restrict`
- `POST /api/admin/tenants/:id/unrestrict`
- `GET  /api/admin/users`
- `POST /api/admin/users/:id/disable`
- `POST /api/admin/users/:id/enable`
- `GET  /api/admin/secrets`
- `POST /api/admin/secrets`
- `DELETE /api/admin/secrets/:id`
- `GET  /api/admin/proxies`
- `POST /api/admin/proxies`
- `PATCH /api/admin/proxies/:id`
- `DELETE /api/admin/proxies/:id`
- `POST /api/admin/grants` — manual subscription comp
- `DELETE /api/admin/grants/:id`
- `POST /api/owner/updates/upload`
- `POST /api/owner/updates/apply`

### Health (`server/routes/health.ts`)
- `GET /health`, `GET /ready`, `GET /metrics`

### Webhooks
- `POST /webhook/telegram` — Telegram Bot API
- `POST /webhook/whatsapp` — WhatsApp Business
- `POST /webhook/max` — MAX Bot

---

## New Services Added in Last Session

### `server/services/template-renderer.ts` (UPDATED)

Renders `{{variable_name}}` placeholders in template strings.

```typescript
export type TemplateType = "price_result" | "price_options" | "payment_options" | "tag_request" | "not_found";
export const TEMPLATE_VARIABLES: Record<TemplateType, string[]>   // documented variables per type
export const TEMPLATE_SAMPLE_VALUES: Record<string, string>       // sample values for preview
export const DEFAULT_TEMPLATES: Array<{...}>                      // 3 default templates seeded per tenant

export function renderTemplate(content: string, variables: Record<string, string | number>): string
// Unknown variables are left as-is (not blanked out)
```

**Template variables for `price_result`:**
`{{transmission_model}}`, `{{oem}}`, `{{min_price}}`, `{{max_price}}`, `{{avg_price}}`,
`{{origin}}`, `{{manufacturer}}`, `{{car_brand}}`, `{{date}}`,
`{{mileage_min}}`, `{{mileage_max}}`, `{{mileage_range}}`, `{{listings_count}}`

**Template variables for `price_options`** (two-step price dialog — Step 1):
`{{transmission_model}}`, `{{oem}}`, `{{manufacturer}}`, `{{origin}}`, `{{date}}`,
`{{budget_price}}`, `{{budget_mileage}}`, `{{mid_price}}`, `{{mid_mileage}}`,
`{{quality_price}}`, `{{quality_mileage}}`, `{{listings_count}}`

### `server/services/transmission-identifier.ts`

Identifies a transmission model from an OEM/part number using GPT-4o-mini (no web search).
Results are cached in `transmission_identity_cache` table (keyed by normalised OEM, hit-counted).

```typescript
export interface TransmissionIdentification {
  modelName: string | null;    // e.g. "JATCO JF011E" — market name, NOT internal catalog code
  manufacturer: string | null; // e.g. "JATCO", "Aisin", "ZF"
  origin: "japan" | "europe" | "korea" | "usa" | "unknown";
  confidence: "high" | "medium" | "low";
  notes: string;
}
export interface VehicleContext {
  make?: string | null; model?: string | null; year?: string | null;
  engine?: string | null; body?: string | null; driveType?: string | null;
  gearboxType?: "MT" | "AT" | "CVT" | null;
  gearboxModelHint?: string | null; factoryCode?: string | null;
}

export async function identifyTransmissionByOem(
  oem: string,
  context?: VehicleContext
): Promise<TransmissionIdentification>
```

GPT prompt instructs model to return market/commercial codes (`F4A42`, `U660E`) not internal catalog numbers.
`isValidTransmissionModel()` guard rejects strings with 4+ consecutive digits or length > 12.

### `server/services/price-searcher.ts`

**3-stage pipeline** — Yandex+Playwright first, GPT web_search as opt-out fallback.

```typescript
export interface PriceSearchResult {
  minPrice: number; maxPrice: number; avgPrice: number;
  mileageMin: number | null; mileageMax: number | null;
  currency: "RUB";
  source: "openai_web_search" | "yandex" | "not_found" | "ai_estimate" | "mock";
  listingsCount: number;
  listings: PriceSearchListing[];
  searchQuery: string;
  filteredOutCount: number;
  urlsChecked?: string[];   // URLs opened via Playwright (Stage 1)
}

export async function searchUsedTransmissionPrice(
  oem: string,
  modelName: string | null,
  origin: "japan" | "europe" | "korea" | "usa" | "unknown",
  make?: string | null,
  vehicleContext?: VehicleContext | null,
  tenantId?: string | null   // for GPT_WEB_SEARCH_ENABLED flag check
): Promise<PriceSearchResult>

export async function searchWithYandex(
  oem: string,
  modelName: string | null,
  make?: string | null,
  model?: string | null,
  gearboxType?: string | null
): Promise<{ listings: ParsedListing[]; urlsChecked: string[] }>
```

**Stage 1 — Yandex + Playwright:**
- `buildYandexQueries()`: up to 3 queries using gearboxLabel + OEM + make/model/modelName
- `searchYandex()` from `yandex-source.ts`: POST to `https://searchapi.yandex.net/v2/web/search`
- Deduplicate by URL, sort by domain priority score, take top 8
- `fetchPageViaPlaywright()`: POST to Python `/fetch-page`; falls back to native `fetch()` if service unavailable
- `parseListingsFromHtml()`: cheerio — structured selectors for drom/farpost + universal text fallback
- `filterListingsByTitle()`: `LISTING_INCLUDE_KEYWORDS` + `LISTING_EXCLUDE_KEYWORDS`
- Dedup by URL + outlier removal (IQR)
- **SUCCESS** (≥3 listings OR ≥2 domains) → return `source: "yandex"`

**Stage 2 (GPT fallback):** controlled by `GPT_WEB_SEARCH_ENABLED` flag (default `true`).
Existing GPT `runSearch()` logic unchanged. If flag is `false`, returns `source: "not_found"` immediately.

`LISTING_INCLUDE_KEYWORDS`: "в сборе", "коробка", "мкпп", "акпп", "вариатор", "контрактная", "б/у"…
`LISTING_EXCLUDE_KEYWORDS`: "гидроблок", "насос", "сальник", "дефект", "на запчасти"…

### `server/workers/price-lookup.worker.ts`

**OEM flow:**
1. `getGlobalPriceSnapshot(cacheKey)` — global cache check (expiresAt-based, any tenant)
2. `identifyTransmissionByOem(oem, vehicleContext)` — GPT-4o-mini (skipped if `oemModelHint` valid)
3. `searchUsedTransmissionPrice(..., tenantId)` — Yandex+Playwright Stage 1; GPT fallback if `GPT_WEB_SEARCH_ENABLED`
4. `not_found` → escalation if `PRICE_ESCALATION_ENABLED` (default true): `createEscalationSuggestion()`
5. `not_found` + escalation disabled → `estimatePriceFromAI()` if `AI_PRICE_ESTIMATE_ENABLED` (confidence 0.5)
6. Save to global cache (`tenantId = null`; TTL: 7d / 24h not_found / 2h ai_estimate)
   - Includes: `stage`, `urls[]` (Playwright URLs), `domains[]` (unique domains)
7. `createPriceSuggestions()` (price_options tiers or single price_result) + payment methods

**Fallback flow (no OEM):** Avito → Drom → GPT web search → mock (mock NOT saved to DB)

**Key rules:**
- Mock source results are NEVER saved to `price_snapshots`
- `not_found` + `ai_estimate` ARE saved (short TTL) to prevent repeated re-searches
- `source` accepted values: `"yandex"`, `"openai_web_search"`, `"not_found"`, `"ai_estimate"`, `"mock"`, `"avito"`, `"drom"`, `"web"`, `"internal"`
- Worker routes all three — `"yandex" || "openai_web_search" || "not_found"` — through the same snapshot-save path

---

## Storage Methods (IStorage additions for last session)

The following methods were added to `IStorage` in `server/storage.ts` and implemented in
`server/database-storage.ts`:

### Message Templates
```typescript
getMessageTemplatesByTenant(tenantId: string): Promise<MessageTemplate[]>
getMessageTemplate(id: string): Promise<MessageTemplate | undefined>
getActiveMessageTemplateByType(tenantId: string, type: string): Promise<MessageTemplate | undefined>
createMessageTemplate(data: InsertMessageTemplate): Promise<MessageTemplate>
updateMessageTemplate(id: string, data: Partial<InsertMessageTemplate>): Promise<MessageTemplate>
deleteMessageTemplate(id: string): Promise<boolean>
```

### Payment Methods
```typescript
getPaymentMethodsByTenant(tenantId: string): Promise<PaymentMethod[]>
getPaymentMethod(id: string): Promise<PaymentMethod | undefined>
getActivePaymentMethods(tenantId: string): Promise<PaymentMethod[]>
createPaymentMethod(data: InsertPaymentMethod): Promise<PaymentMethod>
updatePaymentMethod(id: string, data: Partial<InsertPaymentMethod>): Promise<PaymentMethod>
deletePaymentMethod(id: string): Promise<boolean>
reorderPaymentMethods(tenantId: string, items: Array<{id: string; order: number}>): Promise<void>
```

### Tenant Agent Settings
```typescript
getTenantAgentSettings(tenantId: string): Promise<TenantAgentSettings | null>
upsertTenantAgentSettings(tenantId: string, data: Partial<InsertTenantAgentSettings>): Promise<TenantAgentSettings>
```

---

## Critical Data Flows

### Incoming Message Pipeline (ALL Personal channels)
```
Channel adapter -> processIncomingMessageFull(tenantId, parsed)
  1. handleIncomingMessage(): find/create customer+conversation, dedup, save, WS broadcast
  2. detectVehicleIdFromText(): normalize -> VIN/FRAME regex -> create case -> enqueue lookup
  3. triggerAiSuggestion(): check no pending -> Decision Engine -> save suggestion -> WS broadcast
```
**NEVER create alternative message pipelines. All Personal channels MUST flow through `processIncomingMessageFull`.**

### VIN/FRAME -> Price -> Template Suggestion (UPDATED)
```
vehicle_lookup_queue worker
  -> Python Podzamenu (port 8200)
  -> cache (vehicle_lookup_cache)
  -> AI suggestion (gearbox reply)
  -> price_lookup_queue.enqueuePriceLookup()

price_lookup_queue worker (OEM mode):
  -> getGlobalPriceSnapshot(cacheKey) — global cache check (expiresAt-based, 7-day TTL)
  -> [cache miss] identifyTransmissionByOem(oem, vehicleContext) — GPT-4o-mini

  Stage 1 — searchWithYandex() via searchUsedTransmissionPrice():
    -> buildYandexQueries() → 3 parallel POST https://searchapi.yandex.net/v2/web/search
    -> score/deduplicate URLs by domain priority; open top 5 via POST /fetch-page (Python Playwright)
    -> parseListingsFromHtml() + filterListingsByTitle() + dedup + IQR outlier removal
    -> if validListings ≥ 3 OR unique domains ≥ 2: source="yandex" → save snapshot → suggestion → DONE
    -> else: GPT fallback if GPT_WEB_SEARCH_ENABLED (default true)

  Stage 2 — if not_found and PRICE_ESCALATION_ENABLED (default true):
    -> createEscalationSuggestion(): readyQueries (RU+EN), suggestedSites, urlsAlreadyChecked
    -> intent="escalation", escalation_data JSONB stored in ai_suggestions

  Stage 3 — if not_found + escalation disabled + AI_PRICE_ESTIMATE_ENABLED:
    -> estimatePriceFromAI() (conf: 0.5) → save ai_estimate snapshot (2h TTL)

  Stage 4 — if all disabled: createNotFoundSuggestion() (template or default "Уточним стоимость…")

  -> save global snapshot (tenantId=null, stage, urls[], domains[])
  -> getTenantAgentSettings() → createPriceSuggestions():
       quality tier / mid tier / budget tier by mileage; price_options or price_result template
       -> maybeCreatePaymentMethodsSuggestion() (always)

price_lookup_queue worker (FALLBACK/MODEL_ONLY mode — no OEM):
  -> tenant-scoped snapshot check
  -> Avito -> Drom cascade -> GPT web search fallback -> mock (mock NOT saved to DB)
  -> createAiSuggestion() + payment methods suggestion
```

### Decision Engine Flow
```
1. Load tenant_agent_settings from DB (company facts + scripts + custom system prompt)
2. RAG context retrieval (embeddings + cosine similarity)
3. Few-shot examples: DB approved samples + BUILTIN_FEW_SHOT_EXAMPLES fallback
4. Build system prompt via buildSystemPrompt(tenant, agentSettings):
   - base = agentSettings.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
   - Append ДАННЫЕ КОМПАНИИ block (companyName, specialization, warehouseCity, etc.)
   - Append СКРИПТЫ ОТВЕТОВ block (objectionPayment, objectionOnline, closingScript)
   - Append INTENT_GUIDE (17 intent descriptions for GPT classification)
5. GPT-4o-mini: generate response + intent + confidence
6. Penalties (stale data, missing fields, price mentions)
7. Decision: AUTO_SEND (conf >= tAuto) / NEED_APPROVAL / ESCALATE (conf < tEscalate)
8. Self-check: separate GPT call for quality gate
9. Autosend eligibility (triple lock: FLAG + SETTING + INTENT_NOT_ALLOWED)
```

---

## Feature Flags (`feature_flags.json`)

| Flag | Default | Controls |
|------|---------|----------|
| `AI_SUGGESTIONS_ENABLED` | true | Gates `triggerAiSuggestion` |
| `DECISION_ENGINE_ENABLED` | false | Advanced decision engine |
| `AI_AUTOSEND_ENABLED` | false | Auto-send without approval |
| `HUMAN_DELAY_ENABLED` | false | Human-like delay |
| `RAG_ENABLED` | true | RAG context retrieval |
| `FEW_SHOT_LEARNING` | true | Few-shot examples in prompts |
| `TELEGRAM_PERSONAL_CHANNEL_ENABLED` | true | MTProto channel |
| `WHATSAPP_PERSONAL_CHANNEL_ENABLED` | true | Baileys channel |
| `MAX_PERSONAL_CHANNEL_ENABLED` | true | GREEN-API MAX Personal channel |
| `TELEGRAM_CHANNEL_ENABLED` | false | Bot API (inactive) |
| `WHATSAPP_CHANNEL_ENABLED` | false | Business API (inactive) |
| `MAX_CHANNEL_ENABLED` | false | Bot API (inactive) |
| `AUTO_PARTS_ENABLED` | false | VIN/FRAME auto-detection pipeline in inbound handler |
| `AI_PRICE_ESTIMATE_ENABLED` | true | GPT web_search AI estimate when both Yandex and escalation are disabled |
| `PRICE_ESCALATION_ENABLED` | true | Structured escalation suggestion to operator when Yandex returns insufficient results |
| `GPT_WEB_SEARCH_ENABLED` | true | GPT web_search fallback when Yandex Stage 1 is insufficient (set false to skip to escalation) |

Check via `featureFlagService.isEnabled("FLAG_NAME")` or `featureFlagService.isEnabled("FLAG_NAME", tenantId)`.

---

## RBAC System

5 roles: `owner` -> `admin` -> `operator` -> `viewer` -> `guest`
16 permissions in `server/middleware/rbac.ts`.
Guards: `requireAuth`, `requirePermission("PERMISSION_NAME")`, `requireAdmin`, `requireOperator`.
Platform-level: `requirePlatformAdmin`, `requirePlatformOwner`.

Key permissions used by tenant-config routes:
- `VIEW_CONVERSATIONS` — GET endpoints (list/preview)
- `MANAGE_TENANT_SETTINGS` — POST/PATCH/DELETE endpoints

---

## Code Patterns

### Route Pattern
```typescript
app.get("/api/resource", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) return res.status(403).json({ error: "User not associated with a tenant" });
    const data = await storage.getSomething(user.tenantId);
    res.json(data);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to fetch" });
  }
});
```

### Storage Layer
- `server/storage.ts` defines `IStorage` interface (80+ methods).
- `server/database-storage.ts` implements it with Drizzle queries.
- Access via `import { storage } from "./storage"`.
- **NEVER call `db` directly from routes — always go through `storage`.**

### React Data Fetching
```typescript
const { data, isLoading } = useQuery<Type[]>({ queryKey: ["/api/resource"] });

const mutation = useMutation({
  mutationFn: async (data: InputType) => {
    const res = await apiRequest("POST", "/api/resource", data);
    return res.json();
  },
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/resource"] }),
});
```

### Validation
- Env: `server/config.ts` (`envSchema`)
- Routes: `server/middleware/validation.ts` or inline `z.object({}).parse(req.body)`
- DB inserts: `createInsertSchema()` in `shared/schema.ts`

### WebSocket Events
Server: `server/services/websocket-server.ts` on `/ws`.
Client: `client/src/lib/websocket.ts` — `wsClient` singleton.
Events: `new_message`, `conversation_update`, `new_conversation`, `new_suggestion`.

### Testing
Framework: Vitest 4.0.16.
49 test files across `server/__tests__/` (25) and `server/tests/` (24).
Mock storage: `MemStorage` from `server/__tests__/helpers/mem-storage.ts`.

---

## Schema Modification Checklist

1. Edit `shared/schema.ts` — add table definition
2. Export new types: `export type X = typeof x.$inferSelect` + insert type
3. Create Zod insert schema: `createInsertSchema(x).omit({ id: true, createdAt: true })`
4. Add IStorage methods to `server/storage.ts`
5. Implement in `server/database-storage.ts`
6. Generate migration: `npx drizzle-kit generate` (review the generated SQL)
7. Apply in dev: `npm run db:push` (direct sync)
8. Apply in production: `npm run db:migrate` ONLY

**Key schema patterns:**
- PK: `varchar("id").primaryKey().default(sql\`gen_random_uuid()\`)`
- `tenantId` on every tenant-scoped table with `.references(() => tenants.id)`
- Timestamps: `timestamp("created_at").default(sql\`CURRENT_TIMESTAMP\`).notNull()`
- JSONB: `jsonb("config").default({})`

---

## Deployment

### Environment Variables (Required)
```
AI_INTEGRATIONS_OPENAI_API_KEY     # OpenAI API key
SESSION_SECRET                     # Express session secret (min 32 chars)
INTEGRATION_SECRETS_MASTER_KEY     # AES-256-GCM master key (32 bytes, base64)
DATABASE_URL                       # PostgreSQL connection URL
```

### Optional
```
TELEGRAM_API_ID / TELEGRAM_API_API_HASH    # MTProto (from my.telegram.org)
CRYPTOBOT_API_TOKEN                        # CryptoBot billing
PODZAMENU_LOOKUP_SERVICE_URL               # Python Podzamenu service URL (default: http://localhost:8200)
PODZAMENU_SERVICE_PORT                     # Port for Node→Python Playwright bridge (default: 8200)
AVITO_ENABLED / DROM_ENABLED               # Price sources (fallback/no-OEM mode; disabled by default)
YANDEX_SEARCH_API_KEY                      # Yandex Cloud Search API key (Stage 1 price search; skipped if unset)
YANDEX_FOLDER_ID                           # Yandex Cloud folder ID (required with YANDEX_SEARCH_API_KEY)
SERP_API_KEY                               # Legacy SerpAPI — DEPRECATED, superseded by Yandex Search API
OPENAI_WEB_SEARCH_MODEL                    # GPT model for price web search (default: gpt-4.1)
OWNER_EMAIL / OWNER_PASSWORD               # Platform owner bootstrap
REDIS_URL                                  # Redis (required for BullMQ workers)
```

### PM2 (`ecosystem.config.cjs`)
- `aisales`: main app (`dist/index.cjs`), 1 instance, 1G memory limit
- `worker-price-lookup`: separate process, 512M memory limit
- `podzamenu-service`: Python Podzamenu Playwright service (port 8200)

### Build
- `npm run build` -> `script/build.ts` -> esbuild (server) + Vite (client)
- `npm run dev` -> `tsx server/index.ts` with Vite dev middleware

---

## Prohibitions

1. **DO NOT** change `shared/schema.ts` without creating a migration
2. **DO NOT** hardcode API keys/tokens — use env vars
3. **DO NOT** create duplicate types — always import from `@shared/schema`
4. **DO NOT** ignore `feature_flags.json` — check flags before conditional features
5. **DO NOT** add npm/pip dependencies without checking if equivalent exists
6. **DO NOT** modify `server/services/decision-engine.ts` without explicit request
7. **DO NOT** modify `processIncomingMessageFull` interface or create alternative pipelines
8. **DO NOT** change `enqueuePriceLookup` interface
9. **DO NOT** store 2FA passwords in DB or Redis (memory only)
10. **DO NOT** make DB queries without `tenantId` (multi-tenancy violation)
11. **DO NOT** manually edit `client/src/components/ui/` files (shadcn/ui managed)
12. **DO NOT** use `react-router` — this project uses `wouter`
13. **DO NOT** use `axios` — use native `fetch` via `apiRequest()`
14. **DO NOT** bypass `storage` layer with direct `db` queries in routes
15. **DO NOT** save mock price source results to `internal_prices`
16. **DO NOT** add synchronous AI generation or message sending in HTTP handlers — use BullMQ queues
17. **DO NOT** overwrite encrypted messenger sessions on every request
18. **DO NOT** use `drizzle-kit push --force` — it silently drops columns/types without review
