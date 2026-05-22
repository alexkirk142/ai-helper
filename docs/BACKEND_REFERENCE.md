# BACKEND_REFERENCE.md — AI Sales Operator

> Исчерпывающий справочник по серверной части проекта.  
> Обновлён: 2026-05-22. Основан на SocratiCode-анализе индекса (2684 чанков, 308 файлов).

---

## Содержание

1. [Обзор архитектуры](#1-обзор-архитектуры)
2. [Стек технологий](#2-стек-технологий)
3. [Структура директорий](#3-структура-директорий)
4. [Точка входа и инициализация](#4-точка-входа-и-инициализация)
5. [Middleware стек](#5-middleware-стек)
6. [Маршруты API](#6-маршруты-api)
7. [Каналы и адаптеры](#7-каналы-и-адаптеры)
8. [Очереди и воркеры (BullMQ)](#8-очереди-и-воркеры-bullmq)
9. [AI/ML пайплайн](#9-aiml-пайплайн)
10. [Пайплайн входящих сообщений](#10-пайплайн-входящих-сообщений)
11. [Пайплайн лидов (Marquiz / Universal)](#11-пайплайн-лидов-marquiz--universal)
12. [Слой хранения (Storage)](#12-слой-хранения-storage)
13. [База данных — схема (49 таблиц)](#13-база-данных--схема-49-таблиц)
14. [RBAC — роли и разрешения](#14-rbac--роли-и-разрешения)
15. [Безопасность](#15-безопасность)
16. [Feature Flags](#16-feature-flags)
17. [Python-сервисы](#17-python-сервисы)
18. [Deployment и инфраструктура](#18-deployment-и-инфраструктура)
19. [Переменные окружения](#19-переменные-окружения)
20. [Граф зависимостей](#20-граф-зависимостей)
21. [Тестирование](#21-тестирование)
22. [Критические ограничения](#22-критические-ограничения)

---

## 1. Обзор архитектуры

**AI Sales Operator** — мультитенантный B2B SaaS для автоматизации клиентского сервиса.

```
┌─────────────────────────────────────────────────────────────────┐
│                        КЛИЕНТ (браузер)                         │
│         React 18 + Vite SPA  ←→  WebSocket /ws                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP / WS
┌──────────────────────────▼──────────────────────────────────────┐
│                   Node.js + Express (server/)                    │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────────┐   │
│  │  routes.ts │  │  middleware/ │  │  services/             │   │
│  │ (100+ end.)│  │  rbac, csrf, │  │  decision-engine,      │   │
│  │            │  │  rate-limit, │  │  inbound-handler,      │   │
│  │  routes/   │  │  validation  │  │  channel-adapter, ...  │   │
│  └────────────┘  └──────────────┘  └────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  workers/  (BullMQ) — 5 воркеров, 6 очередей           │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────┬───────────┬──────────────┬──────────────┬────────────────┘
       │           │              │              │
  PostgreSQL    Redis          OpenAI       Внешние API
  (49 таблиц)  (BullMQ +      (GPT-4o-mini  (Telegram MTProto,
               rate-limit)     embeddings)   Baileys WA,
                                             GREEN-API MAX,
                                             Yandex Search,
                                             CryptoBot)
       │
  Python-сервисы
  podzamenu_lookup_service.py  — порт 8200 (VIN/FRAME + Playwright)
  max_personal_service.py      — порт 8100 (legacy, DEPRECATED — заменён GREEN-API)
```

**Мультитенантность:** каждый тенант изолирован по `tenantId`. Любой запрос к БД требует `tenantId`.

---

## 2. Стек технологий

| Слой | Технологии |
|------|-----------|
| Runtime | Node.js 20 + TypeScript 5.6.3 (ESM, `"type": "module"`) |
| HTTP | Express 4.21.2 |
| ORM | Drizzle ORM 0.39.3 + drizzle-kit 0.31.8 |
| БД | PostgreSQL (49 таблиц) |
| Кэш / Очереди | Redis + ioredis 5.9.0 + BullMQ 5.66.4 |
| AI | OpenAI 6.15.0 — GPT-4o-mini (решения, идентификация) + text-embedding-3-large 3072 dim (RAG) |
| Telegram | gramjs 2.26.22 (MTProto Personal) + Bot API |
| WhatsApp | @whiskeysockets/baileys 7.0.0-rc.9 (Personal) + Meta Business API |
| MAX | GREEN-API (HTTP, прямая интеграция) |
| Парсинг | cheerio 1.2.0 (Avito/Drom HTML) |
| Аутентификация | express-session + connect-pg-simple, bcrypt 6.0.0 |
| Валидация | Zod 3.25.76 |
| Логирование | pino 10.1.0 |
| Билинг | CryptoBot (primary, 50 USDT/мес) + Stripe (legacy) |
| Сборка | esbuild → `dist/index.cjs`, Vite → `dist/public/` |

---

## 3. Структура директорий

```
server/
├── index.ts                     # Точка входа: Express + WS + сессии + запуск воркеров
├── routes.ts                    # Центральная регистрация всех роутеров
├── db.ts                        # PostgreSQL пул + Drizzle instance (max: 10 conn)
├── config.ts                    # Zod-валидация env-переменных
├── storage.ts                   # IStorage интерфейс (80+ методов)
├── database-storage.ts          # PostgreSQL реализация IStorage (Drizzle)
├── session.ts                   # Express session (connect-pg-simple, TTL 7 дней)
├── redis-client.ts              # ioredis синглтон (rate-limiter)
├── static.ts                    # SPA fallback для production
├── vite.ts                      # Vite dev-сервер HMR middleware
│
├── routes/                      # HTTP роутеры
│   ├── auth.ts                  # /auth/* — signup, login, logout, invite, email, reset
│   ├── auth-api.ts              # GET /api/auth/user
│   ├── admin.ts                 # /api/admin/* — платформенный admin (131 connections!)
│   ├── phase0.ts                # Feature flags + audit log
│   ├── health.ts                # /health, /ready, /metrics
│   ├── conversation.routes.ts   # /api/conversations/*
│   ├── message.routes.ts        # /api/conversations/:id/messages
│   ├── suggestion.routes.ts     # /api/suggestions/* + generate-suggestion
│   ├── escalation.routes.ts     # /api/escalations/* + CSAT
│   ├── customer.routes.ts       # /api/customers/*
│   ├── product.routes.ts        # /api/products/*
│   ├── knowledge-base.routes.ts # /api/knowledge-docs/* + /api/rag/index
│   ├── analytics.routes.ts      # /api/analytics/*
│   ├── billing.routes.ts        # /api/billing/*
│   ├── onboarding.routes.ts     # /api/onboarding/*
│   ├── vehicle-lookup.routes.ts # /api/vehicle-lookup/*
│   ├── tenant-config.routes.ts  # /api/templates/* + /api/payment-methods/* + /api/agent-settings/*
│   ├── settings.routes.ts       # /api/settings/*
│   ├── feature-flags.routes.ts  # /api/feature-flags/*
│   ├── channel-management.routes.ts  # /api/channels/* (конфиг, connect/disconnect)
│   ├── response-templates.routes.ts  # /api/response-templates/*
│   ├── test.routes.ts           # dev/test endpoints (non-production)
│   ├── webhooks.routes.ts       # Центральный роутер всех webhook'ов
│   ├── telegram-webhook.ts      # POST /webhooks/telegram (Bot API)
│   ├── whatsapp-webhook.ts      # GET+POST /webhooks/whatsapp (Business API)
│   ├── max-webhook.ts           # /webhooks/max (MAX Bot API)
│   ├── max-personal-webhook.ts  # /webhooks/max-personal/:tenantId/:accountId (GREEN-API)
│   ├── marquiz-webhook.ts       # /webhooks/marquiz/:tenantId (Marquiz квизы)
│   ├── marquiz-debug.ts         # /api/debug/marquiz (dev-отладка)
│   ├── lead-webhook.ts          # /webhooks/lead/:tenantId (универсальный лид)
│   ├── notify-bot-webhook.ts    # /webhooks/notify-bot (Telegram-бот рассылок)
│   └── channels/
│       ├── telegram-bot.routes.ts      # /api/channels/telegram/* (Bot настройки)
│       ├── telegram-personal.routes.ts # /api/telegram/sessions/* (MTProto управление)
│       ├── whatsapp-personal.routes.ts # /api/whatsapp/sessions/* (Baileys управление)
│       └── max.routes.ts               # /api/channels/max-personal/* (GREEN-API управление)
│
├── services/                    # Бизнес-логика
│   ├── inbound-message-handler.ts   # ЦЕНТРАЛЬНЫЙ ПАЙПЛАЙН входящих сообщений
│   ├── decision-engine.ts           # AI генерация — НЕ ТРОГАТЬ без веской причины
│   ├── channel-adapter.ts           # ChannelAdapter интерфейс + реестр
│   ├── channel-adapter.types.ts     # Shared типы (ParsedIncomingMessage, ChannelSendResult)
│   ├── telegram-client-manager.ts   # Мультиаккаунт Telegram (ключ: tenantId:accountId)
│   ├── telegram-personal-adapter.ts # MTProto auth (QR/код/2FA) + send/receive
│   ├── telegram-session-crypto.ts   # AES-256-GCM шифрование Telegram-сессий
│   ├── telegram-adapter.ts          # Telegram Bot API адаптер
│   ├── whatsapp-personal-adapter.ts # Baileys auth + send/receive (44 connections)
│   ├── whatsapp-adapter.ts          # WhatsApp Business API адаптер
│   ├── max-personal-adapter.ts      # GREEN-API адаптер (multi-account по accountId)
│   ├── max-green-api-adapter.ts     # HTTP-клиент к GREEN-API (sendMessage, checkWhatsapp, setWebhook)
│   ├── max-gateway-client.ts        # Клиент MAX Gateway (checkPhone, альтернативный роутинг)
│   ├── max-adapter.ts               # MAX Bot API адаптер
│   ├── vehicle-lookup-queue.ts      # BullMQ очередь: vehicle_lookup_queue
│   ├── price-lookup-queue.ts        # BullMQ очередь: price_lookup_queue (отдельный процесс)
│   ├── message-queue.ts             # BullMQ очередь: message_send_queue + утилиты
│   ├── marquiz-lead-queue.ts        # BullMQ очередь: marquiz_leads
│   ├── no-reply-check-queue.ts      # BullMQ очередь: no_reply_check (15 мин задержка)
│   ├── podzamenu-lookup-client.ts   # HTTP-клиент Python Podzamenu (порт 8200)
│   ├── transmission-identifier.ts  # GPT-4o-mini: OEM → model/manufacturer/origin + кэш
│   ├── price-searcher.ts            # Оркестратор цен: Yandex+Playwright Stage1, GPT fallback
│   ├── playwright-fetcher.ts        # Node→Python Playwright bridge: POST /fetch-page
│   ├── gearbox-templates.ts         # 5 шаблонов ответов для gearbox lookup
│   ├── price-sources/
│   │   ├── types.ts                 # PriceSource, PriceResult, GearboxType, detectGearboxType()
│   │   ├── yandex-source.ts         # Yandex Cloud Search API v2 (основной source)
│   │   ├── avito-source.ts          # Avito HTML (cheerio; AVITO_ENABLED=true)
│   │   ├── drom-source.ts           # Drom HTML (cheerio; DROM_ENABLED=true)
│   │   ├── web-source.ts            # SerpAPI — DEPRECATED
│   │   └── mock-source.ts           # Фиксированный fallback (НЕ сохраняется в БД)
│   ├── rag-retrieval.ts             # RAG: embed → cosine similarity → top chunks
│   ├── rag-indexer.ts               # RAG: products/docs → chunks + SHA-256 хэши
│   ├── embedding-service.ts         # OpenAI text-embedding-3-large (3072 dim)
│   ├── few-shot-builder.ts          # Few-shot промпт: DB samples + BUILTIN fallback
│   ├── template-renderer.ts         # {{variable}} рендерер шаблонов
│   ├── feature-flags.ts             # In-memory + JSON file feature flags
│   ├── websocket-server.ts          # WS на /ws — broadcasts событий
│   ├── auth-service.ts              # Signup, login (lockout 5 попыток), password reset
│   ├── owner-bootstrap.ts           # Создание platform owner из env при старте
│   ├── billing-service.ts           # Stripe billing (legacy)
│   ├── cryptobot-billing.ts         # CryptoBot billing (primary — 50 USDT/мес)
│   ├── audit-log.ts                 # Батч-запись в audit_events (500ms flush, ALS контекст)
│   ├── secret-store.ts              # AES-256-GCM шифрование секретов
│   ├── secret-resolver.ts           # Каскад: env → DB secrets, с кэшем
│   ├── fraud-detection-service.ts   # Fingerprinting каналов + eligibility триала
│   ├── human-delay-engine.ts        # Расчёт human-like задержки печати
│   ├── csat-service.ts              # CSAT 1-5 + аналитика
│   ├── conversion-service.ts        # Трекинг конверсий
│   ├── lost-deals-service.ts        # Автодетект потерянных сделок
│   ├── intent-analytics-service.ts  # Аналитика по намерениям
│   ├── customer-summary-service.ts  # GPT-4o-mini сводки по клиентам
│   ├── learning-score-service.ts    # Скоринг learning queue
│   ├── learning-queue-processor.ts  # Обработка learning queue (пакетами)
│   ├── training-sample-service.ts   # Тренировочные примеры из human feedback
│   ├── onboarding-service.ts        # 6-шаговый wizard онбординга
│   ├── onboarding-templates.ts      # GPT-4o генерация policy/FAQ при онбординге
│   ├── document-chunking-service.ts # Разбивка knowledge docs на chunks
│   ├── readiness-score-service.ts   # 7 проверок готовности тенанта
│   ├── smoke-test-service.ts        # Smoke-тест: round-trip AI suggestion
│   ├── security-readiness.ts        # Проверки безопасности конфигурации
│   ├── proxy-service.ts             # Управление proxy-пулом
│   ├── update-service.ts            # Файлы системных обновлений
│   ├── admin-action-service.ts      # Логирование admin-действий + идемпотентность
│   ├── email-provider.ts            # Отправка email (SMTP абстракция)
│   ├── customer-data-deletion-service.ts  # GDPR-совместимое удаление данных
│   ├── route-registry.ts            # Автообнаружение зарегистрированных Express-маршрутов
│   ├── escalation-bot.ts            # Telegram-бот эскалаций (notifyNoReply, notifyFailedLead)
│   ├── vehicle-data-extractor.ts    # GPT-4o-mini: извлечение driveType/gearboxType из raw JSON
│   ├── partsapi-vin-decoder.ts      # PartsAPI VIN-декодер (с retry)
│   ├── transmission-identifier.ts   # GPT-4o-mini: OEM → brand/model/origin
│   └── utils/
│       └── dedup-cache.ts           # LRU dedup-кэш (10k записей)
│
├── workers/                     # BullMQ воркеры
│   ├── vehicle-lookup.worker.ts # VIN/FRAME → Python → cache → suggestion → price trigger
│   ├── price-lookup.worker.ts   # OEM: Yandex+Playwright → GPT fallback → escalation → snapshot
│   ├── message-send.worker.ts   # Отложенная отправка сообщений через channel adapters (concurrency: 5)
│   ├── marquiz-lead.worker.ts   # Обработка лидов Marquiz: отправить сообщение в MAX/TG/WA
│   ├── no-reply-check.worker.ts # Проверка ответа клиента через 15 мин → Telegram-уведомление
│   └── learning-queue.worker.ts # Пакетная обработка learning queue (каждые 24ч)
│
├── middleware/
│   ├── rbac.ts                  # 5 ролей, 16 разрешений, requireAuth/requirePermission
│   ├── rate-limiter.ts          # in-memory rate-limiting (global + per-tenant + webhook)
│   ├── validation.ts            # validateBody / validateQuery / validateParams (Zod)
│   ├── error-handler.ts         # Центральный обработчик ошибок (Zod→400)
│   ├── webhook-security.ts      # HMAC-SHA256 верификация webhook'ов
│   ├── subscription.ts          # requireActiveSubscription guard
│   ├── fraud-protection.ts      # requireActiveTenant (блокировка restricted тенантов)
│   ├── platform-admin.ts        # requirePlatformAdmin guard
│   ├── platform-owner.ts        # requirePlatformOwner guard
│   ├── csrf.ts                  # CSRF защита (csrf-csrf, double-submit cookie)
│   └── request-context.ts       # X-Request-Id / UUID, audit ALS context
│
├── utils/
│   └── sanitizer.ts             # PII маскировка (API-ключи, JWT, email, телефон, карты)
│
├── batch/
│   ├── index.ts                 # Re-exports
│   └── utils.ts                 # Пакетная обработка: p-limit + p-retry
│
├── scripts/
│   └── migrate.ts               # Standalone migration runner
│
├── config/
│   └── business-constants.ts    # SUBSCRIPTION_PRICE_USDT и другие бизнес-константы
│
├── types/
│   └── vendor.d.ts              # Ambient type declarations
│
├── __tests__/                   # 25 unit-тестов (Vitest)
│   └── helpers/
│       └── mem-storage.ts       # In-memory IStorage mock
│
└── tests/                       # 24 интеграционных/e2e теста
    ├── decision-engine.test.ts
    ├── decision-engine-e2e.test.ts
    ├── webhook-security.integration.test.ts
    ├── route-registry.test.ts
    ├── rbac.test.ts
    └── ...
```

---

## 4. Точка входа и инициализация

**Файл:** `server/index.ts`

Порядок инициализации при старте:

```
1. express.json({ limit: "10mb", verify: rawBody })
2. express.urlencoded({ extended: false, limit: "10mb" })
3. requestContextMiddleware  — X-Request-Id, audit ALS context
4. apiRateLimiter на /api
5. registerHealthRoutes(app)  — /health, /ready, /metrics (до аутентификации)
6. registerRoutes(httpServer, app):
   a. getSession()            — express-session (connect-pg-simple)
   b. cookieParser()          — после session, до csrf
   c. GET /api/csrf-token     — без CSRF-guard (safe method)
   d. csrfProtection          — применяется ко всем небезопасным методам
   e. registerAuthRoutes      — /auth/*
   f. Domain routers          — customerRouter, conversationRouter, ...
   g. Channel routers         — telegramPersonalRouter, whatsappPersonalRouter, maxRouter
   h. webhooksRouter          — все /webhooks/* и /api/webhook/*
   i. registerPhase0Routes    — feature flags, audit log
   j. adminRouter             — /api/admin/*
7. WebSocket сервер на /ws
8. BullMQ воркеры:
   - createVehicleLookupWorker
   - createMessageSendWorker
   - startMarquizLeadWorker
   - startNoReplyCheckWorker
   - startLearningQueueWorker
9. Restore сессий мессенджеров:
   - telegramClientManager.restoreAllSessions()
   - WhatsAppPersonalAdapter.restoreAllSessions()
10. ownerBootstrap() — создание platform owner из OWNER_EMAIL/OWNER_PASSWORD
11. static.ts — SPA fallback в production
12. gracefulShutdown handlers (SIGTERM, SIGINT)
```

**Graceful shutdown** (`server/index.ts:gracefulShutdown`):
1. Stop accepting new HTTP connections (5s drain)
2. Disconnect Telegram Personal sessions
3. Close BullMQ workers (vehicle, message-send, marquiz)
4. Close BullMQ queues (message, vehicle, no-reply)
5. Close WebSocket server
6. Close PostgreSQL pool
7. Close rate-limiter Redis

---

## 5. Middleware стек

### Порядок применения

```
request
  → express.json / urlencoded
  → requestContextMiddleware       — requestId, ALS
  → apiRateLimiter                 — 100 req/15min/IP на /api
  → getSession()                   — express-session
  → cookieParser()
  → csrfProtection                 — double-submit cookie
  → requireAuth                    — проверка сессии
  → requirePermission("PERM")      — RBAC матрица
  → requireActiveSubscription      — активная подписка
  → requireActiveTenant            — не restricted
  → validateBody(schema)           — Zod валидация тела
  → route handler
  → error-handler                  — Zod→400, generic→500
```

### Ключевые middleware

| Файл | Функция |
|------|---------|
| `middleware/rbac.ts` | `requireAuth`, `requirePermission`, `requireAdmin`, `requireOperator` |
| `middleware/csrf.ts` | `csrfProtection`, `generateCsrfToken` (csrf-csrf double-submit) |
| `middleware/rate-limiter.ts` | `apiRateLimiter` (global), `tenantAiLimiter`, `aiRateLimiter`, `webhookRateLimiter` |
| `middleware/validation.ts` | `validateBody(schema)`, `validateQuery(schema)`, `validateParams(schema)` |
| `middleware/webhook-security.ts` | `createWebhookSecurityMiddleware({channel})` — HMAC-SHA256 |
| `middleware/subscription.ts` | `requireActiveSubscription` |
| `middleware/fraud-protection.ts` | `requireActiveTenant` |
| `middleware/platform-admin.ts` | `requirePlatformAdmin()` |
| `middleware/platform-owner.ts` | `requirePlatformOwner()` |
| `middleware/request-context.ts` | `requestContextMiddleware` |

---

## 6. Маршруты API

### Auth (`server/routes/auth.ts` + `auth-api.ts`)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/auth/signup` | Создание тенанта + owner-пользователя |
| POST | `/auth/login` | Логин (lockout после 5 неудач) |
| POST | `/auth/logout` | Выход |
| GET | `/auth/verify-email` | Верификация email-токена |
| POST | `/auth/forgot-password` | Запрос сброса пароля |
| POST | `/auth/reset-password` | Сброс пароля по токену |
| POST | `/api/auth/invite` | Отправка командного инвайта |
| POST | `/api/auth/accept-invite` | Принятие инвайта |
| GET | `/api/auth/user` | Текущий авторизованный пользователь |
| GET | `/api/csrf-token` | CSRF-токен (без guard, GET = safe) |

### Conversations (`routes/conversation.routes.ts`, `message.routes.ts`, `suggestion.routes.ts`, `escalation.routes.ts`)

| Метод | Путь | Разрешение |
|-------|------|-----------|
| GET | `/api/conversations` | VIEW_CONVERSATIONS |
| POST | `/api/conversations` | MANAGE_CONVERSATIONS |
| GET | `/api/conversations/:id` | VIEW_CONVERSATIONS |
| PATCH | `/api/conversations/:id/status` | MANAGE_CONVERSATIONS |
| PATCH | `/api/conversations/:id/mode` | MANAGE_CONVERSATIONS |
| GET | `/api/conversations/:id/messages` | VIEW_CONVERSATIONS |
| POST | `/api/conversations/:id/messages` | MANAGE_CONVERSATIONS |
| GET | `/api/conversations/:id/suggestions` | VIEW_CONVERSATIONS |
| POST | `/api/conversations/:id/generate-suggestion` | MANAGE_CONVERSATIONS |
| POST | `/api/suggestions/:id/approve` | MANAGE_CONVERSATIONS |
| POST | `/api/suggestions/:id/reject` | MANAGE_CONVERSATIONS |
| POST | `/api/suggestions/:id/edit` | MANAGE_CONVERSATIONS |
| GET | `/api/conversations/:id/audit` | VIEW_AUDIT_LOGS |
| POST | `/api/conversations/:id/csat` | — |
| GET | `/api/escalations` | VIEW_CONVERSATIONS |
| PATCH | `/api/escalations/:id/resolve` | MANAGE_CONVERSATIONS |
| PATCH | `/api/messages/:id/read` | MANAGE_CONVERSATIONS |

### Customers (`routes/customer.routes.ts`)

| Метод | Путь |
|-------|------|
| GET | `/api/customers/:id` |
| PATCH | `/api/customers/:id` |
| DELETE | `/api/customers/:id` (GDPR) |
| GET | `/api/customers/:id/notes` |
| POST | `/api/customers/:id/notes` |
| GET | `/api/customers/:id/memory` |
| PATCH | `/api/customers/:id/memory` |

### Products & Knowledge Base

| Метод | Путь |
|-------|------|
| GET/POST | `/api/products` |
| PATCH/DELETE | `/api/products/:id` |
| GET/POST | `/api/knowledge-docs` |
| PATCH/DELETE | `/api/knowledge-docs/:id` |
| POST | `/api/rag/index` — перестройка RAG-индекса |

### Analytics (`routes/analytics.routes.ts`)

| Метод | Путь |
|-------|------|
| GET | `/api/analytics/csat` |
| GET | `/api/analytics/conversions` |
| GET | `/api/analytics/intents` |
| GET | `/api/analytics/lost-deals` |
| POST | `/api/csat` |

### Billing (`routes/billing.routes.ts`)

| Метод | Путь |
|-------|------|
| GET | `/api/billing/status` |
| POST | `/api/billing/checkout` — CryptoBot invoice |
| POST | `/api/billing/cancel` |
| POST | `/api/billing/cryptobot/webhook` |

### Tenant Config (`routes/tenant-config.routes.ts`)

| Метод | Путь | Разрешение |
|-------|------|-----------|
| GET | `/api/templates` | VIEW_CONVERSATIONS |
| POST | `/api/templates` | MANAGE_TENANT_SETTINGS |
| POST | `/api/templates/preview` | VIEW_CONVERSATIONS |
| PATCH | `/api/templates/:id` | MANAGE_TENANT_SETTINGS |
| DELETE | `/api/templates/:id` | MANAGE_TENANT_SETTINGS |
| GET | `/api/payment-methods` | VIEW_CONVERSATIONS |
| POST | `/api/payment-methods` | MANAGE_TENANT_SETTINGS |
| PATCH | `/api/payment-methods/reorder` | MANAGE_TENANT_SETTINGS |
| PATCH | `/api/payment-methods/:id` | MANAGE_TENANT_SETTINGS |
| DELETE | `/api/payment-methods/:id` | MANAGE_TENANT_SETTINGS |
| GET | `/api/agent-settings` | MANAGE_TENANT_SETTINGS |
| PUT | `/api/agent-settings` | MANAGE_TENANT_SETTINGS |

### Vehicle Lookup (`routes/vehicle-lookup.routes.ts`)

| Метод | Путь |
|-------|------|
| GET | `/api/vehicle-lookup/cases` |
| GET | `/api/vehicle-lookup/cases/:id` |
| POST | `/api/vehicle-lookup/tag-confirm` |

### Onboarding (`routes/onboarding.routes.ts`)

| Метод | Путь |
|-------|------|
| GET | `/api/onboarding/state` |
| POST | `/api/onboarding/step` |
| POST | `/api/onboarding/complete` |
| GET | `/api/readiness` |

### Telegram Personal (`routes/channels/telegram-personal.routes.ts`)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/telegram/sessions` | Список сессий |
| POST | `/api/telegram/auth/send-code` | SMS/звонок код |
| POST | `/api/telegram/auth/verify-code` | Верификация кода |
| POST | `/api/telegram/auth/verify-password` | 2FA пароль |
| POST | `/api/telegram/auth/start-qr` | Начать QR-авторизацию |
| GET | `/api/telegram/auth/check-qr/:sessionId` | Статус QR |
| POST | `/api/telegram/auth/verify-qr-2fa` | QR + 2FA |
| POST | `/api/telegram/sessions/:id/disconnect` | Отключить |
| DELETE | `/api/telegram/sessions/:id` | Удалить |
| GET | `/api/telegram/sessions/:id/dialogs` | Список диалогов |

### WhatsApp Personal (`routes/channels/whatsapp-personal.routes.ts`)

| Метод | Путь |
|-------|------|
| GET | `/api/whatsapp/sessions` |
| POST | `/api/whatsapp/auth/start` |
| GET | `/api/whatsapp/auth/qr/:sessionId` |
| POST | `/api/whatsapp/sessions/:id/disconnect` |

### MAX Personal (`routes/channels/max.routes.ts`)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/channels/max-personal/accounts` | Список аккаунтов |
| GET | `/api/channels/max-personal/:accountId/status` | Статус аккаунта |
| POST | `/api/channels/max-personal/:accountId/reregister-webhook` | Перерегистрировать webhook |
| POST | `/api/channels/max-personal/:accountId/send-test` | Тестовое сообщение |

### Channel Management (`routes/channel-management.routes.ts`)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/channels` | Список всех каналов тенанта |
| POST | `/api/channels/:channel/config` | Сохранить конфиг + fraud check |
| POST | `/api/channels/:channel/connect` | Подключить канал |
| POST | `/api/channels/:channel/disconnect` | Отключить |
| POST | `/api/channels/:channel/test` | Тест-отправка |

### Webhooks (`routes/webhooks.routes.ts`)

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/webhooks/telegram` | Telegram Bot API |
| POST | `/api/webhook/telegram` | (дублирующий путь) |
| GET/POST | `/webhooks/whatsapp` | WhatsApp Business (GET = verify) |
| GET/POST | `/api/webhook/whatsapp` | (дублирующий путь) |
| `*` | `/webhooks/max` | MAX Bot API |
| GET | `/webhooks/max-personal/ping` | Health probe |
| `*` | `/webhooks/max-personal` | GREEN-API `:tenantId/:accountId` |
| `*` | `/webhooks/marquiz` | Marquiz квизы `:tenantId` |
| `*` | `/api/debug/marquiz` | Dev-отладка лидов |
| `*` | `/webhooks/lead` | Универсальный лид `:tenantId` |
| POST | `/webhooks/notify-bot` | Telegram-бот рассылок |

### Admin (`routes/admin.ts`) — 52 соединения, только platrofmAdmin/platformOwner

| Группа | Примеры путей |
|--------|--------------|
| Тенанты | `GET /api/admin/tenants`, `POST /api/admin/tenants/:id/restrict` |
| Пользователи | `GET /api/admin/users`, `POST /api/admin/users/:id/disable` |
| Секреты | `GET/POST/DELETE /api/admin/secrets` |
| Proxies | `GET/POST/PATCH/DELETE /api/admin/proxies` |
| Гранты | `POST /api/admin/grants`, `DELETE /api/admin/grants/:id` |
| MAX Personal | `GET/POST/DELETE /users/:userId/max-personal`, `GET .../status`, `POST .../register-webhook` |
| Обновления | `POST /api/owner/updates/upload`, `POST /api/owner/updates/apply` |
| Рассылки | `POST /notify/broadcast` |

### Health

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe (DB + Redis) |
| GET | `/metrics` | Простые метрики |

---

## 7. Каналы и адаптеры

### Интерфейс ChannelAdapter (`services/channel-adapter.types.ts`)

```typescript
interface ChannelAdapter {
  readonly name: ChannelType;
  sendMessage(externalConversationId, text, options?): Promise<ChannelSendResult>;
  parseIncomingMessage(rawPayload): ParsedIncomingMessage | null;
  sendTypingStart?(externalConversationId): Promise<void>;    // optional
  sendTypingStop?(externalConversationId): Promise<void>;     // optional
  verifyWebhook?(headers, body, secret?): WebhookVerifyResult; // optional
}
```

> **Важно:** `channel-adapter.types.ts` выделен отдельно для предотвращения циклических зависимостей.

### Реестр каналов

| ChannelType | Адаптер | Feature Flag | Статус |
|-------------|---------|-------------|--------|
| `telegram_personal` | `TelegramPersonalAdapter` (gramjs MTProto) | `TELEGRAM_PERSONAL_CHANNEL_ENABLED` | **Активен** |
| `whatsapp_personal` | `WhatsAppPersonalAdapter` (Baileys) | `WHATSAPP_PERSONAL_CHANNEL_ENABLED` | **Активен** |
| `max_personal` | `MaxPersonalAdapter` (GREEN-API HTTP) | `MAX_PERSONAL_CHANNEL_ENABLED` | **Активен** |
| `telegram` | `TelegramAdapter` (Bot API) | `TELEGRAM_CHANNEL_ENABLED` | Неактивен |
| `whatsapp` | `WhatsAppAdapter` (Business API) | `WHATSAPP_CHANNEL_ENABLED` | Неактивен |
| `max` | `MaxAdapter` (Bot API) | `MAX_CHANNEL_ENABLED` | Неактивен |
| `mock` | `MockChannelAdapter` | — | dev/тест |

### MAX Personal — GREEN-API архитектура

**Аккаунты:** до 5 на тенант, хранятся в `max_personal_accounts`. Управляются только platform admin.

**Webhook URL:** `/webhooks/max-personal/:tenantId/:accountId`  
Идентифицирует аккаунт по обоим параметрам → защита от cross-tenant spoofing.

**Типы webhook'ов GREEN-API:**
- `incomingMessageReceived` — входящее сообщение (→ `processIncomingMessageFull`)
- `outgoingAPIMessageReceived` — подтверждение исходящего (→ обновление `maxInternalId` клиента)
- `statusInstanceChanged` — смена статуса инстанса

**ChatId нормализация:**
- `79991234567@c.us` — номер телефона (10+ цифр → добавить `@c.us`)
- `41837581` — внутренний MAX userId (< 10 цифр → оставить as-is)
- `-1001234567890` — группа

### WhatsApp Personal — LID ↔ Phone маппинг

При отправке через `sendMessage` предварительно кэшируется маппинг phone JID ↔ LID в Redis (TTL 30 дней).  
При входящем от `@lid`-контакта — авто-мёрж с существующим phone-клиентом.  
Ключи Redis: `wa:lidmap:{tenantId}:{jid}`.

---

## 8. Очереди и воркеры (BullMQ)

### Все очереди

| Очередь | Файл очереди | Воркер | Назначение |
|---------|-------------|--------|-----------|
| `vehicle_lookup_queue` | `services/vehicle-lookup-queue.ts` | `workers/vehicle-lookup.worker.ts` | VIN/FRAME → Python → OEM → цена |
| `price_lookup_queue` | `services/price-lookup-queue.ts` | `workers/price-lookup.worker.ts` | Поиск цены (Yandex/GPT) |
| `message_send_queue` | `services/message-queue.ts` | `workers/message-send.worker.ts` | Отложенная отправка сообщений |
| `marquiz_leads` | `services/marquiz-lead-queue.ts` | `workers/marquiz-lead.worker.ts` | Обработка лидов Marquiz/Universal |
| `no_reply_check` | `services/no-reply-check-queue.ts` | `workers/no-reply-check.worker.ts` | Проверка ответа клиента (15 мин) |
| `learning_queue_batch` | — | `workers/learning-queue.worker.ts` | Пакетная обработка (раз в 24ч) |

### Параметры очередей

| Очередь | attempts | backoff | removeOnComplete | concurrency |
|---------|---------|---------|-----------------|------------|
| vehicle_lookup | 3 | exponential 1s | 100 | 1 |
| price_lookup | — | — | — | — |
| message_send | 3 | — | 100 | **5** (rate: 100/min) |
| marquiz_leads | 3 | exponential 2s | 100 | 1 |
| no_reply_check | 2 | fixed 5s | 200 | 5 |
| learning_queue_batch | — | — | 10 | — |

### Воркер: `vehicle-lookup.worker.ts`

```
Вход: { caseId, tenantId, conversationId, idType: "VIN"|"FRAME", normalizedValue }

1. lookupByVehicleId() → Python Podzamenu (порт 8200)
2. Кэш: vehicle_lookup_cache (проверка перед запросом)
3. extractVehicleContextFromRawData() — GPT-4o-mini: driveType, gearboxType
4. decodeVinPartsApiWithRetry() — PartsAPI VIN-декодер
5. fillGearboxTemplate() → создать AI suggestion (gearbox reply)
6. enqueuePriceLookup() — если есть OEM
```

### Воркер: `price-lookup.worker.ts` (OEM flow)

```
1. getGlobalPriceSnapshot(cacheKey) — глобальный кэш (expiresAt, 7d TTL)
2. [cache miss] identifyTransmissionByOem(oem, vehicleContext) — GPT-4o-mini
   → кэш: transmission_identity_cache (30d TTL)

Stage 1 — Yandex + Playwright:
3. buildYandexQueries() — до 3 запросов
4. POST https://searchapi.yandex.net/v2/web/search (parallel)
5. Дедупликация URL по domain-priority score, top 5
6. POST /fetch-page (Python Playwright) — fallback: native fetch()
7. parseListingsFromHtml() + filterListingsByTitle() + IQR outlier removal
8. SUCCESS: ≥3 listings OR ≥2 domains → source="yandex"

Stage 2 (если not_found + PRICE_ESCALATION_ENABLED=true):
9. createEscalationSuggestion() → intent="escalation", escalation_data JSONB

Stage 3 (если not_found + escalation disabled + AI_PRICE_ESTIMATE_ENABLED=true):
10. estimatePriceFromAI() → confidence 0.5, TTL 2h

Stage 4 (всё выключено):
11. createNotFoundSuggestion() — шаблон или "Уточним стоимость..."

12. Сохранить в global price_snapshots (tenantId=null, stage, urls[], domains[])
13. getTenantAgentSettings() → createPriceSuggestions():
    - price_options (3 тира по пробегу: budget/mid/quality)
    - или price_result (одиночный результат)
14. maybeCreatePaymentMethodsSuggestion() — всегда
```

### Воркер: `marquiz-lead.worker.ts`

```
Вход: { tenantId, quizName, phone, maxPhone, telegramUsername, preferredChannel, ... }

1. Загрузить тенант (рабочие часы, timezone)
2. Проверить skipAutoResponseForExisting (защита от дублей)
3. Попытки отправки по приоритету (или по preferredChannel если указан):
   a. MAX Personal (gateway):
      - checkPhone() — если { registered: false } → сразу noAccount, не создавать записи в БД
      - если { registered: true } → chatId = String(userId), создать customer+conv → sendMessage
      - если sendMessage → USER_RESTRICTED → удалить conv, → saveFailedLead
   b. Telegram Personal (telegramClientManager → find user by username → sendMessage)
   c. WhatsApp Personal (Baileys → send)
4. SUCCESS → scheduleNoReplyCheck(15 мин)
5. FAIL → saveFailedLead() → создать conversation status="failed_delivery"
   + notifyFailedLead() → Telegram escalation bot

Fallback без Redis: processMarquizLeadDirect() — синхронная обработка
```

### MAX Gateway — коды ошибок send-эндпоинтов

| HTTP | code | Исключение | Причина |
|------|------|-----------|---------|
| 404 | `PHONE_NOT_REGISTERED` | `GatewayPhoneNotRegisteredError` | Номер не зарегистрирован в MAX |
| 403 | `USER_RESTRICTED` | `GatewayUserRestrictedError` | Аккаунт найден, но ограничен — нельзя начать диалог |
| 500 | — | `Error` | Другая техническая ошибка |

Оба класса экспортируются из `services/max-gateway-client.ts`.
`max-personal-adapter.ts` перехватывает их и возвращает `{ success: false, error: "noAccount" | "USER_RESTRICTED" }`.
`start-conversation` при `USER_RESTRICTED` удаляет только что созданный разговор и возвращает HTTP 403 с текстом «Начать диалог не получится — возможности профиля этого пользователя ограничены».

### Воркер: `no-reply-check.worker.ts`

```
Вход: { conversationId, tenantId, channel }
Задержка: 15 минут

1. Загрузить tenant, получить botToken + escalationChatId
2. Проверить статус conversation (skip если failed_delivery/closed)
3. Проверить: есть ли customer-сообщение ПОСЛЕ первого assistant-сообщения?
4. Нет ответа → notifyNoReply() → Telegram escalation bot
```

---

## 9. AI/ML пайплайн

### Decision Engine (`services/decision-engine.ts`)

> **НЕ ИЗМЕНЯТЬ** без явного запроса. Это ядро AI.

```
1. Загрузить tenant_agent_settings (companyName, specialization, warehouseCity,
   objectionPayment, objectionOnline, closingScript, systemPrompt)

2. RAG контекст: retrieveContext() → embedQuery → cosine similarity → top chunks
   (если RAG_ENABLED=true, иначе fallback на products/docs)

3. Few-shot примеры: selectFewShotExamples() из DB + BUILTIN_FEW_SHOT_EXAMPLES fallback
   (если FEW_SHOT_LEARNING=true)

4. buildSystemPrompt(tenant, agentSettings):
   - base = agentSettings.systemPrompt ?? DEFAULT_SYSTEM_PROMPT
   - + ДАННЫЕ КОМПАНИИ блок
   - + СКРИПТЫ ОТВЕТОВ блок
   - + INTENT_GUIDE (17 intents для GPT классификации)

5. GPT-4o-mini: generate reply + intent + intent_probability
   response_format: json_object, max_tokens: 1024

6. Penalties (снижают confidence):
   - stale_data (устаревшие источники)
   - missing_price (цена упомянута, но нет в источниках)
   - missing_availability
   - other

7. Финальный score = intentScore * similarityScore * (1 - penalties)

8. Self-check: отдельный GPT вызов → self_check_score, need_handoff
   (performSelfCheck)

9. Decision:
   - AUTO_SEND: finalScore >= tAuto AND NOT need_handoff
   - ESCALATE: finalScore < tEscalate OR need_handoff
   - NEED_APPROVAL: иначе

10. Autosend triple lock:
    - AI_AUTOSEND_ENABLED (feature flag)
    - tenant.autosendAllowed (настройка тенанта)
    - intent NOT IN intentsForceHandoff (default: discount, complaint, photo_request,
      needs_manual_quote, want_visit)
```

### RAG пайплайн

- **Индексирование** (`rag-indexer.ts`): products + knowledge_docs → chunks → SHA-256 хэш → `rag_chunks` таблица
- **Поиск** (`rag-retrieval.ts`): embed query (text-embedding-3-large, 3072 dim) → cosine similarity → top N chunks
- **Форматирование** (`formatContextForPrompt`): структурированный блок для system prompt
- **Модель**: `text-embedding-3-large`, 3072 измерений (pgvector в PostgreSQL)
- **Триггер**: `POST /api/rag/index` или автоматически при изменении products/docs

### Идентификация трансмиссии (`transmission-identifier.ts`)

```typescript
identifyTransmissionByOem(oem: string, context?: VehicleContext): Promise<TransmissionIdentification>
// Результат: { modelName, manufacturer, origin, confidence, notes }
// Кэш: transmission_identity_cache (UNIQUE на normalizedOem, TTL 30d, hitCount++)
// Валидация: isValidTransmissionModel() — отклоняет если 4+ цифр подряд или длина > 12
```

### Шаблонный рендерер (`template-renderer.ts`)

```typescript
renderTemplate(content: string, variables: Record<string, string | number>): string
// Неизвестные переменные оставляются as-is (не заменяются пустотой)

// Типы шаблонов: price_result, price_options, payment_options, tag_request, not_found
// 3 шаблона по умолчанию создаются при онбординге тенанта
```

---

## 10. Пайплайн входящих сообщений

**ЕДИНСТВЕННАЯ точка входа:** `processIncomingMessageFull(tenantId, parsed)` в `services/inbound-message-handler.ts`

> Все личные каналы ОБЯЗАНЫ использовать эту функцию. Никаких альтернативных пайплайнов.

```
Channel → processIncomingMessageFull(tenantId, parsed: ParsedIncomingMessage)
  │
  ├── handleIncomingMessage():
  │   ├── Дедупликация по externalMessageId
  │   ├── find/create Customer (по tenantId + channel + externalId)
  │   │   └── WhatsApp LID: авто-мёрж orphan phone-клиента
  │   ├── find/create Conversation
  │   ├── Сохранить Message в БД
  │   └── WS broadcast: new_message, conversation_update
  │
  ├── detectVehicleIdFromText() [если AUTO_PARTS_ENABLED=true]:
  │   ├── Нормализация VIN/FRAME
  │   ├── Regex детектор
  │   ├── Создать vehicle_lookup_case
  │   └── enqueueVehicleLookup() → vehicle_lookup_queue
  │
  └── triggerAiSuggestion() [если AI_SUGGESTIONS_ENABLED=true]:
      ├── Проверить: нет ли pending suggestion
      ├── generateAiSuggestion() → Decision Engine
      ├── Сохранить ai_suggestion в БД
      └── WS broadcast: new_suggestion
```

### Источники входящих по каналам

| Канал | Точка входа |
|-------|------------|
| Telegram Personal | `telegram-client-manager.ts` (MTProto event) → `processIncomingMessageFull` |
| WhatsApp Personal | `whatsapp-personal-adapter.ts` (Baileys event) → `processIncomingMessageFull` |
| MAX Personal | `routes/max-personal-webhook.ts` (typeWebhook=incomingMessageReceived) → `processIncomingMessageFull` |
| Telegram Bot | `routes/telegram-webhook.ts` — только парсинг+аудит, **не** вызывает AI |
| WhatsApp Business | `routes/whatsapp-webhook.ts` — только парсинг+аудит, **не** вызывает AI |
| MAX Bot | `routes/max-webhook.ts` — только парсинг+аудит, **не** вызывает AI |

---

## 11. Пайплайн лидов (Marquiz / Universal)

### Marquiz webhook (`routes/marquiz-webhook.ts`)

**Endpoint:** `POST /webhooks/marquiz/:tenantId`

1. Извлечь phone, telegramUsername, preferredChannel из Marquiz payload
2. Валидировать: нужен phone ИЛИ telegram
3. `enqueueMarquizLead()` → `marquiz_leads` очередь (если Redis доступен)  
   или `processMarquizLeadDirect()` (если Redis недоступен)

### Universal Lead webhook (`routes/lead-webhook.ts`)

**Endpoint:** `POST /webhooks/lead/:tenantId`

Принимает любой JSON (Tilda, кастомные формы, flat JSON, вложенные fields).  
Извлекает: Phone/Name/Telegram под распространёнными именами полей.  
Использует ту же очередь `marquiz_leads`.

### Escalation Bot (`services/escalation-bot.ts`)

Telegram-бот на `TELEGRAM_ESCALATION_BOT_TOKEN`.  
Каждый тенант настраивает свой `escalationChatId` в настройках.

Уведомления:
- `notifyFailedLead()` — клиент недоступен ни в одном мессенджере
- `notifyNoReply()` — клиент не ответил за 15 минут

### Notification Bot (`routes/notify-bot-webhook.ts`)

**Endpoint:** `POST /webhooks/notify-bot`

Telegram-бот подписок (рассылки платформы).  
Хранит подписчиков в таблице `notify_bot_subscribers` (raw SQL, вне Drizzle).  
Команды: `/start` — подписаться, `/stop` — отписаться.  
Broadcast: `POST /notify/broadcast` (только platformOwner).

---

## 12. Слой хранения (Storage)

### Структура

```
server/storage.ts           — IStorage интерфейс (80+ методов)
server/database-storage.ts  — DatabaseStorage: полная реализация на Drizzle ORM
```

**Правило:** Никогда не вызывать `db` напрямую из роутов — только через `storage`.

### Паттерн доступа

```typescript
import { storage } from "./storage";

// В роуте:
const user = await storage.getUser(req.userId!);
if (!user?.tenantId) return res.status(403).json({ error: "..." });
const data = await storage.getSomething(user.tenantId);
```

### Категории методов IStorage

| Категория | Примеры методов |
|-----------|----------------|
| Тенанты | `getTenant`, `createTenant`, `updateTenant` |
| Пользователи | `getUser`, `createUser`, `updateUser`, `getUserByEmail` |
| Каналы | `getChannel`, `createChannel`, `updateChannel`, `getChannelsByTenant` |
| Клиенты | `getCustomer`, `createCustomer`, `updateCustomer`, `getCustomerByExternalId`, `findOrphanedPhoneCustomer` |
| Разговоры | `getConversation`, `createConversation`, `updateConversation`, `getConversationsByTenant` |
| Сообщения | `getMessage`, `createMessage`, `getMessagesByConversation` |
| AI | `createAiSuggestion`, `updateAiSuggestion`, `getAiSuggestionsByConversation` |
| VIN/Price | `getGlobalPriceSnapshot`, `createPriceSnapshot`, `getVehicleLookupCase` |
| RAG | `createRagChunk`, `getRagChunksByDocument`, `deleteRagChunksByDocument` |
| Шаблоны | `getMessageTemplatesByTenant`, `createMessageTemplate`, `updateMessageTemplate` |
| Методы оплаты | `getPaymentMethodsByTenant`, `createPaymentMethod`, `reorderPaymentMethods` |
| Настройки агента | `getTenantAgentSettings`, `upsertTenantAgentSettings` |
| Биллинг | `getSubscription`, `createSubscription`, `updateSubscription` |
| Аудит | `createAuditEvent`, `getAuditEventsByConversation` |

---

## 13. База данных — схема (49 таблиц)

**Файл:** `shared/schema.ts` (125 connections — второй по связанности файл)

### Core Tenant & User

| Таблица | Описание |
|---------|----------|
| `tenants` | Мультитенантный корень. tone, currency, timezone, working hours, templates JSONB |
| `users` | Операторы/владельцы. 5 ролей, bcrypt пароли, lockout, platform flags |
| `user_invites` | Токены инвайтов (SHA-256 hash, one-use) |
| `admin_actions` | Платформенный admin audit log |
| `email_tokens` | Верификация email + password reset (SHA-256 хэши) |

### Messaging

| Таблица | Описание |
|---------|----------|
| `channels` | Конфиги каналов (whatsapp, telegram, max + personal variants) |
| `customers` | Конечные пользователи. UNIQUE (tenantId, channel, externalId) |
| `customer_notes` | Заметки операторов |
| `customer_memory` | Долгосрочная память: предпочтения + частые темы |
| `conversations` | Треды. Статусы: active, waiting_customer, waiting_operator, escalated, resolved, **failed_delivery** |
| `messages` | Сообщения. Роли: customer, assistant, owner |
| `escalation_events` | Эскалации с suggested responses |

### AI & Learning

| Таблица | Описание |
|---------|----------|
| `ai_suggestions` | Decision Engine: confidence, decision, penalties, autosend triple-lock, `escalation_data JSONB` |
| `human_actions` | approve/edit/reject/escalate трекинг |
| `ai_training_samples` | Датасет few-shot обучения |
| `ai_training_policies` | Per-tenant конфиг обучения |
| `learning_queue` | Разговоры на review |
| `response_templates` | Быстрые ответы операторов |
| `decision_settings` | Per-tenant пороги (tAuto, tEscalate, autosend). `intentsForceHandoff` |
| `human_delay_settings` | Профили human-like задержки |

### Knowledge Base & RAG

| Таблица | Описание |
|---------|----------|
| `products` | Каталог товаров |
| `knowledge_docs` | Политики/FAQ/доставка/возвраты |
| `knowledge_doc_chunks` | Чанки документов |
| `rag_documents` | Унифицированный RAG-индекс (PRODUCT или DOC) |
| `rag_chunks` | RAG-чанки с векторными эмбеддингами (pgvector, 3072 dim) |

### Analytics

| Таблица | Описание |
|---------|----------|
| `csat_ratings` | Рейтинги 1-5 на разговор |
| `conversions` | Трекинг покупок |
| `lost_deals` | Потерянные сделки с кодами причин |
| `feature_flags` | DB-персистированные feature flags |
| `audit_events` | Детальный audit trail |
| `readiness_reports` | Снимки проверки готовности тенанта |

### Auth & Sessions

| Таблица | Описание |
|---------|----------|
| `sessions` | express-session (connect-pg-simple) |
| `auth_users` | OIDC профили (опционально) |
| `telegram_sessions` | MTProto сессии (AES-256-GCM зашифрованы) |
| `whatsapp_auth_sessions` | Baileys сессии (base64 файлы, зашифрованы) |
| `onboarding_state` | Прогресс 6-шагового wizard |

### Billing & Anti-Fraud

| Таблица | Описание |
|---------|----------|
| `plans` | Планы подписки (50 USDT/мес) |
| `subscriptions` | Одна на тенант (CryptoBot или Stripe) |
| `subscription_grants` | Ручное продление от platform admin |
| `channel_fingerprints` | SHA-256 хэши идентификаторов каналов |
| `fraud_flags` | Обнаруженные fraud-попытки |

### Infrastructure

| Таблица | Описание |
|---------|----------|
| `integration_secrets` | AES-256-GCM зашифрованные API-ключи |
| `update_history` | История файлов системных обновлений |
| `proxies` | Пул proxy (socks5/http/https) |

### Vehicle & Price Lookup

| Таблица | Описание |
|---------|----------|
| `vehicle_lookup_cache` | Кэш результатов VIN/FRAME |
| `vehicle_lookup_cases` | Кейсы поиска на разговор |
| `price_snapshots` | Глобальный кэш цен (tenantId=null). TTL: 7d / 24h (not_found) / 2h (ai_estimate). Поля: stage, urls[], domains[] |
| `internal_prices` | Собственный прайс-лист тенанта по OEM |
| `transmission_identity_cache` | OEM → model name (GPT-4o-mini). TTL 30d, hitCount |

### Tenant Configuration

| Таблица | Описание |
|---------|----------|
| `message_templates` | Шаблоны с `{{variable}}`. Типы: price_result, price_options, payment_options, tag_request, not_found |
| `payment_methods` | Способы оплаты (title, description, order, active) |
| `tenant_agent_settings` | AI конфиг тенанта: companyFacts, scripts, systemPrompt, mileage tiers |

### MAX Personal

| Таблица | Описание |
|---------|----------|
| `max_personal_accounts` | GREEN-API аккаунты. До 5 на тенант. Поля: idInstance, apiTokenInstance, apiUrl, mediaUrl, accountId (для webhook URL), status, webhookRegistered, autoReplyEnabled |

### (Вне Drizzle — raw SQL)

| Таблица | Описание |
|---------|----------|
| `notify_bot_subscribers` | Подписчики Telegram notification-бота |

---

## 14. RBAC — роли и разрешения

**Файл:** `server/middleware/rbac.ts`

### Иерархия ролей

```
owner → admin → operator → viewer → guest
```

### Матрица разрешений

| Разрешение | owner | admin | operator | viewer |
|-----------|-------|-------|----------|--------|
| VIEW_CONVERSATIONS | ✓ | ✓ | ✓ | ✓ |
| MANAGE_CONVERSATIONS | ✓ | ✓ | ✓ | — |
| VIEW_CUSTOMERS | ✓ | ✓ | ✓ | ✓ |
| MANAGE_CUSTOMERS | ✓ | ✓ | ✓ | — |
| DELETE_CUSTOMER_DATA | ✓ | ✓ | — | — |
| VIEW_ANALYTICS | ✓ | ✓ | ✓ | — |
| MANAGE_PRODUCTS | ✓ | ✓ | ✓ | — |
| MANAGE_KNOWLEDGE_BASE | ✓ | ✓ | ✓ | — |
| MANAGE_AUTOSEND | ✓ | ✓ | — | — |
| MANAGE_POLICIES | ✓ | ✓ | — | — |
| MANAGE_TRAINING | ✓ | ✓ | — | — |
| EXPORT_TRAINING_DATA | ✓ | ✓ | — | — |
| MANAGE_CHANNELS | ✓ | ✓ | — | — |
| MANAGE_TENANT_SETTINGS | ✓ | ✓ | — | — |
| MANAGE_USERS | ✓ | — | — | — |
| VIEW_AUDIT_LOGS | ✓ | ✓ | — | — |

### Platform-уровни

- `requirePlatformAdmin()` — флаг `isPlatformAdmin` в `users` таблице
- `requirePlatformOwner()` — флаг `isPlatformOwner` в `users` таблице

---

## 15. Безопасность

### Хранение секретов

| Данные | Метод |
|--------|-------|
| Пароли пользователей | bcrypt 6.0.0 |
| API-ключи / токены | AES-256-GCM (`secret-store.ts`), мастер-ключ из `INTEGRATION_SECRETS_MASTER_KEY` |
| Telegram MTProto сессии | AES-256-GCM (`telegram-session-crypto.ts`) |
| Email/password-reset токены | SHA-256 хэш (не хранится plaintext) |
| Invite токены | SHA-256 хэш |
| 2FA пароли | **ТОЛЬКО в памяти** — никогда в БД / Redis |

### Webhook безопасность

**Файл:** `middleware/webhook-security.ts`

| Канал | Метод верификации |
|-------|-----------------|
| Telegram Bot | `X-Telegram-Bot-Api-Secret-Token` header match |
| WhatsApp Business | `X-Hub-Signature-256` HMAC-SHA256 |
| GREEN-API MAX Personal | tenantId + accountId в URL (+ DB lookup) |

### CSRF

Double-submit cookie паттерн (`csrf-csrf`).  
GET `/api/csrf-token` — без guard (safe method).  
Все POST/PATCH/DELETE — проверяются.

### Rate Limiting

| Лимитер | Ограничение |
|---------|------------|
| `apiRateLimiter` | 100 req / 15 min / IP на `/api` |
| `aiRateLimiter` | Тонкий лимит на AI endpoints |
| `tenantAiLimiter` | Per-tenant AI лимит |
| `webhookRateLimiter` | На `/webhooks/*` |
| Auth login | redis-based (express-rate-limit + RedisStore) |

### Fraud Detection

`services/fraud-detection-service.ts`:
- Fingerprinting по каналу (SHA-256 → `channel_fingerprints`)
- Проверка eligibility для триала
- `validateChannelConnection()` при подключении канала

---

## 16. Feature Flags

**Файл конфига:** `feature_flags.json`  
**Сервис:** `services/feature-flags.ts` (in-memory + JSON + DB override)  
**Проверка:** `featureFlagService.isEnabled("FLAG_NAME", tenantId?)`

| Флаг | Default | Управляет |
|------|---------|----------|
| `AI_SUGGESTIONS_ENABLED` | false | `triggerAiSuggestion` |
| `DECISION_ENGINE_ENABLED` | false | Advanced Decision Engine |
| `AI_AUTOSEND_ENABLED` | false | Автоотправка без одобрения |
| `HUMAN_DELAY_ENABLED` | false | Human-like задержка |
| `RAG_ENABLED` | true | RAG-контекст |
| `FEW_SHOT_LEARNING` | true | Few-shot примеры в промптах |
| `TELEGRAM_PERSONAL_CHANNEL_ENABLED` | true | MTProto канал |
| `WHATSAPP_PERSONAL_CHANNEL_ENABLED` | true | Baileys канал |
| `MAX_PERSONAL_CHANNEL_ENABLED` | true | GREEN-API MAX |
| `TELEGRAM_CHANNEL_ENABLED` | false | Bot API (неактивен) |
| `WHATSAPP_CHANNEL_ENABLED` | false | Business API (неактивен) |
| `MAX_CHANNEL_ENABLED` | false | Bot API (неактивен) |
| `AUTO_PARTS_ENABLED` | true | VIN/FRAME детектор в inbound |
| `AI_PRICE_ESTIMATE_ENABLED` | false | GPT-оценка цен (риск hallucination) |
| `PRICE_ESCALATION_ENABLED` | true | Эскалация при нехватке данных по цене |
| `GPT_WEB_SEARCH_ENABLED` | true | GPT web_search fallback (Stage 2) |

---

## 17. Python-сервисы

### `podzamenu_lookup_service.py` (порт 8200)

**Назначение:** VIN/FRAME lookup через Playwright (Podzamenu.ru) + `/fetch-page` для price pipeline.

**Эндпоинты:**
- `POST /lookup` — поиск по VIN/FRAME → OEM коды
- `POST /fetch-page` — Playwright-загрузка страниц (для price pipeline)
- `GET /health` — health probe

**Интеграция:**
- Node → `services/podzamenu-lookup-client.ts`
- Node → `services/playwright-fetcher.ts` (только `/fetch-page`)
- Запуск через PM2: `podzamenu-service` процесс

### `max_personal_service.py` (порт 8100)

**Статус:** DEPRECATED — функциональность перенесена на GREEN-API прямую интеграцию.  
Файл остаётся в репозитории для обратной совместимости, но не используется в основном потоке.

---

## 18. Deployment и инфраструктура

### PM2 (`ecosystem.config.cjs`)

| Процесс | Точка входа | Memory | Описание |
|---------|------------|--------|----------|
| `aisales` | `dist/index.cjs` | 1G | Основное Express-приложение |
| `worker-price-lookup` | Отдельный процесс | 512M | Price lookup worker |
| `podzamenu-service` | Python uvicorn | — | Playwright VIN/price сервис |

### Сборка

```bash
npm run build    # → script/build.ts
                 #   esbuild: server/index.ts → dist/index.cjs (CJS, bundle, node20)
                 #   vite build: client/ → dist/public/
npm run dev      # tsx server/index.ts + Vite HMR middleware
```

### Контейнеризация

- **Dockerfile:** `node:20-alpine`
- **Nixpacks:** `nixpacks.toml` (Node 20) — для Railway/Nixpacks деплоя

### Startup script (`start.sh`)

```bash
npx drizzle-kit migrate   # Применить pending миграции
node dist/index.cjs       # Запустить сервер
```

---

## 19. Переменные окружения

### Обязательные

| Переменная | Назначение |
|-----------|-----------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session secret (min 32 chars) |
| `INTEGRATION_SECRETS_MASTER_KEY` | AES-256-GCM мастер-ключ (32 bytes, base64) |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API ключ |
| `REDIS_URL` | Redis (BullMQ + rate-limiting) |

### Опциональные

| Переменная | Default | Назначение |
|-----------|---------|-----------|
| `TELEGRAM_API_ID` + `TELEGRAM_API_HASH` | — | MTProto (my.telegram.org) |
| `CRYPTOBOT_API_TOKEN` | — | CryptoBot billing |
| `PODZAMENU_LOOKUP_SERVICE_URL` | `http://localhost:8200` | Python VIN сервис |
| `YANDEX_SEARCH_API_KEY` | — | Yandex Cloud Search API v2 |
| `YANDEX_FOLDER_ID` | — | Yandex Cloud folder |
| `OPENAI_WEB_SEARCH_MODEL` | `gpt-4.1` | GPT модель для price web search |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | — | Custom OpenAI base URL |
| `OWNER_EMAIL` + `OWNER_PASSWORD` | — | Platform owner bootstrap |
| `APP_URL` | auto-detect | Публичный URL (для webhook регистрации) |
| `RAILWAY_PUBLIC_DOMAIN` | — | Railway.app домен (для APP_URL) |
| `AVITO_ENABLED` | false | Avito price source |
| `DROM_ENABLED` | false | Drom price source |
| `SERP_API_KEY` | — | SerpAPI — DEPRECATED |
| `TELEGRAM_ESCALATION_BOT_TOKEN` | — | Escalation/notification bot |
| `TELEGRAM_WEBHOOK_SECRET` | — | Telegram Bot webhook secret |
| `WHATSAPP_APP_SECRET` | — | WhatsApp HMAC верификация |
| `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` | — | WhatsApp Business API |
| `MARQUIZ_TENANT_ID` | — | Legacy tenant для старых Marquiz webhook'ов |

---

## 20. Граф зависимостей

### Самые связанные файлы (топ 10)

| Файл | Connections | Роль |
|------|------------|------|
| `server/storage.ts` | **131** | Интерфейс хранилища — импортируется везде |
| `shared/schema.ts` | **125** | Схема БД + типы — импортируется везде |
| `client/src/App.tsx` | 80 | Frontend root (не относится к бэкенду) |
| `server/db.ts` | **58** | Drizzle instance |
| `server/routes/admin.ts` | **52** | Платформенный admin |
| `server/routes/channels/telegram-personal.routes.ts` | **51** | Telegram Personal роуты |
| `server/routes.ts` | **49** | Центральный роутер |
| `server/routes/channels/max.routes.ts` | **46** | MAX роуты |
| `server/services/whatsapp-personal-adapter.ts` | **44** | Baileys адаптер |

### Циклические зависимости

Обнаружено **2 цикла** (только во frontend-коде):
1. `client/src/hooks/use-notifications.ts` ↔ `client/src/lib/websocket.ts`
2. `client/src/App.tsx` ↔ `client/src/pages/settings.tsx`

> В бэкенде циклических зависимостей нет. `channel-adapter.types.ts` выделен именно для их предотвращения.

### Изолированные файлы (orphan, без зависимостей)

- `drizzle.config.ts`, `ecosystem.config.cjs`, `postcss.config.js`
- `server/scripts/migrate.ts`, `server/types/vendor.d.ts`
- `scripts/deploy-vps.sh`, `start.sh`
- Некоторые тест-файлы и конфиги

---

## 21. Тестирование

**Фреймворк:** Vitest 4.0.16  
**Конфиг:** `vitest.config.server.ts`

| Директория | Файлов | Тип |
|-----------|--------|-----|
| `server/__tests__/` | 25 | Unit тесты |
| `server/tests/` | 24 | Integration / E2E тесты |

### Ключевые файлы тестов

| Файл | Тест |
|------|------|
| `tests/decision-engine.test.ts` | Decision Engine логика |
| `tests/decision-engine-e2e.test.ts` | E2E Decision Engine с моком OpenAI |
| `tests/webhook-security.integration.test.ts` | HMAC верификация всех каналов |
| `tests/route-registry.test.ts` | Реестр маршрутов + RBAC coverage |
| `tests/rbac.test.ts` | Матрица разрешений |
| `tests/real-endpoint-protection.test.ts` | Реальные эндпоинты — 403 без auth |
| `__tests__/few-shot-builder.test.ts` | Few-shot builder |
| `__tests__/rag-retrieval.test.ts` | RAG поиск |
| `__tests__/price-regression-cases.test.ts` | Регрессия цен (48 VIN) |
| `__tests__/training-policies.test.ts` | Политики обучения |

**Mock storage:** `server/__tests__/helpers/mem-storage.ts` — in-memory IStorage реализация.

---

## 22. Критические ограничения

1. **НЕ** изменять `shared/schema.ts` без создания миграции
2. **НЕ** хардкодить API-ключи/токены — только env-переменные
3. **НЕ** создавать дублирующие типы — импортировать из `@shared/schema`
4. **НЕ** игнорировать `feature_flags.json` — проверять флаги перед условными фичами
5. **НЕ** добавлять npm/pip зависимости без проверки эквивалентов
6. **НЕ** изменять `server/services/decision-engine.ts` без явного запроса
7. **НЕ** изменять интерфейс `processIncomingMessageFull` и не создавать альтернативные пайплайны
8. **НЕ** изменять интерфейс `enqueuePriceLookup`
9. **НЕ** хранить 2FA пароли в БД или Redis (только в памяти)
10. **НЕ** делать DB-запросы без `tenantId` (нарушение мультитенантности)
11. **НЕ** сохранять результаты mock price source в `internal_prices`
12. **НЕ** добавлять синхронную AI генерацию или отправку сообщений в HTTP handlers — использовать BullMQ
13. **НЕ** перезаписывать зашифрованные сессии мессенджеров при каждом запросе
14. **НЕ** использовать `drizzle-kit push --force` — молча дропает колонки
15. **НЕ** обходить `storage` слой с прямыми `db` запросами в роутах

### Checklist изменения схемы

1. Добавить таблицу в `shared/schema.ts`
2. Экспортировать типы: `export type X = typeof x.$inferSelect` + insert type
3. Создать Zod insert схему: `createInsertSchema(x).omit({ id: true, createdAt: true })`
4. Добавить методы в `IStorage` (`server/storage.ts`)
5. Реализовать в `DatabaseStorage` (`server/database-storage.ts`)
6. Сгенерировать миграцию: `npx drizzle-kit generate`
7. В dev: `npm run db:push`
8. В prod: `npm run db:migrate` ТОЛЬКО

### Паттерны схемы

```typescript
// PK
id: varchar("id").primaryKey().default(sql`gen_random_uuid()`)

// tenantId — обязателен на каждой tenant-scoped таблице
tenantId: varchar("tenant_id").notNull().references(() => tenants.id)

// Timestamps
createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull()

// JSONB
config: jsonb("config").default({})
```

---

*Этот документ создан на основе автоматического анализа SocratiCode (2684 чанков, 308 файлов, 1531 зависимость).*  
*Для поддержания актуальности — обновлять при добавлении новых сервисов, роутов, воркеров, таблиц.*
