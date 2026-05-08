# Project Map — AI Sales Operator

> Навигация по файлам проекта. Актуально на май 2026.
> Граф зависимостей: **308 файлов**, **1 369 рёбер**, **1 циклическая зависимость**.

---

## Корень проекта

```
ai-helper/
├── client/                          # React 18 + Vite frontend
├── server/                          # Express.js + TypeScript backend
├── shared/                          # Общие типы, схема БД
├── migrations/                      # SQL миграции Drizzle
├── docs/                            # Документация (этот файл)
├── scripts/                         # Deploy / update скрипты
├── script/
│   └── build.ts                     # esbuild + Vite сборка
├── package.json                     # Node зависимости
├── tsconfig.json                    # TypeScript (strict, ESNext, path aliases)
├── vite.config.ts                   # Vite: aliases @/* → client/src/*, @shared/* → shared/*
├── drizzle.config.ts                # PostgreSQL, schema: shared/schema.ts, out: ./migrations
├── tailwind.config.ts               # Tailwind dark mode (class), shadcn тема
├── ecosystem.config.cjs             # PM2: aisales + worker-price-lookup + podzamenu-service
├── nixpacks.toml                    # Node 20 деплой
├── Dockerfile                       # node:20-alpine
├── pyproject.toml                   # Python >= 3.11 зависимости
├── feature_flags.json               # 16 feature flags с дефолтами
├── .env.example                     # Все env переменные задокументированы
├── start.sh                         # drizzle-kit migrate && node dist/index.cjs
├── podzamenu_lookup_service.py      # Python FastAPI + Playwright: VIN→КПП парсер
└── test_regression_iter4.py         # Регрессионные тесты Podzamenu-сервиса
```

---

## shared/ — Общий код (схема + типы)

```
shared/
├── schema.ts                        # ★ ЦЕНТРАЛЬНЫЙ ФАЙЛ: 49 таблиц, Zod-схемы, TypeScript-типы
│                                    #   Зависимостей входящих: 115 (самый связный файл после storage.ts)
└── models/
    ├── auth.ts                      # sessions + auth_users таблицы (express-session + OIDC)
    └── chat.ts                      # legacy chat-схема (упрощённые conversations/messages)
```

---

## server/ — Backend

### Точки входа

```
server/
├── index.ts                         # ★ Entry point: middleware, routes, WS, session restore, Python spawn
├── routes.ts                        # ★ Центральная регистрация всех роутеров (100+ эндпоинтов)
├── db.ts                            # PostgreSQL Pool + Drizzle instance (47 входящих зависимостей)
├── storage.ts                       # ★ IStorage интерфейс (80+ методов) + re-export DatabaseStorage
│                                    #   125 входящих зависимостей — самый связный файл проекта
├── database-storage.ts              # Полная реализация IStorage на PostgreSQL + Drizzle
├── config.ts                        # Zod-валидация всех env переменных
├── session.ts                       # express-session (connect-pg-simple, TTL 7д)
└── static.ts                        # SPA fallback для production
```

### server/routes/ — Роутеры (34 файла)

#### Домен-роутеры (бизнес-логика)

| Файл | Префикс | Описание |
|------|---------|----------|
| `auth.ts` | `/auth` | Login, signup, invite, forgot/reset password, email verify |
| `auth-api.ts` | `/api/auth` | GET /user, сессионные данные |
| `customer.routes.ts` | `/api/customers` | CRUD клиентов, поиск, удаление (GDPR) |
| `conversation.routes.ts` | `/api/conversations` | CRUD диалогов, статусы, режимы |
| `message.routes.ts` | `/api/messages` | Отправка сообщений, история |
| `suggestion.routes.ts` | `/api/suggestions` | AI-подсказки: approve/reject/edit |
| `escalation.routes.ts` | `/api/escalations` | Эскалации |
| `product.routes.ts` | `/api/products` | Каталог товаров |
| `knowledge-base.routes.ts` | `/api/knowledge-docs`, `/api/admin/rag` | База знаний, RAG-эмбеддинги |
| `analytics.routes.ts` | `/api/analytics`, `/api/dashboard` | Метрики, CSAT, конверсии, потерянные лиды |
| `onboarding.routes.ts` | `/api/onboarding` | Онбординг-визард (6 шагов) |
| `billing.routes.ts` | `/api/billing` | CryptoBot/Stripe, статус подписки |
| `vehicle-lookup.routes.ts` | `/api/vehicle-lookup`, `/api/price-settings` | VIN-lookup, поиск цен КПП |
| `tenant-config.routes.ts` | `/api/tenant`, `/api/message-templates`, `/api/payment-methods`, `/api/agent-settings` | Настройки тенанта |
| `settings.routes.ts` | `/api/settings` | Decision-настройки, human-delay |
| `feature-flags.routes.ts` | `/api/feature-flags` | Управление флагами |
| `admin.ts` | `/api/admin` | Platform admin: tenants, users, secrets, proxies, grants, updates |
| `phase0.ts` | `/api/health`, `/api/metrics`, `/api/routes` | Health check, метрики, реестр роутов |

#### Канальные роутеры

| Файл | Префикс | Описание |
|------|---------|----------|
| `channel-management.routes.ts` | `/api/channels` | CRUD каналов, статус |
| `channels/telegram-bot.routes.ts` | `/api/telegram` | Telegram Bot API управление |
| `channels/telegram-personal.routes.ts` | `/api/telegram-personal` | MTProto: QR/phone auth, аккаунты |
| `channels/whatsapp-personal.routes.ts` | `/api/whatsapp-personal` | Baileys: QR auth, сессии |
| `channels/max.routes.ts` | `/api/max` | MAX Personal (GREEN-API) управление |

#### Вебхук-роутеры

| Файл | Путь | Описание |
|------|------|----------|
| `webhooks.routes.ts` | — | Агрегатор вебхуков |
| `telegram-webhook.ts` | `/webhook/telegram` | Telegram Bot API вебхук |
| `whatsapp-webhook.ts` | `/webhook/whatsapp` | WhatsApp вебхук |
| `max-webhook.ts` | `/webhook/max` | MAX Bot вебхук |
| `max-personal-webhook.ts` | `/webhook/max-personal` | GREEN-API вебхук для MAX Personal |
| `marquiz-webhook.ts` | `/webhook/marquiz` | Marquiz лид-форма вебхук |
| `marquiz-debug.ts` | `/api/marquiz-debug` | Отладка Marquiz |

#### Тест/отладка

| Файл | Описание |
|------|----------|
| `test.routes.ts` | Тестовые эндпоинты (только не-production) |

---

### server/services/ — Сервисы (85 файлов)

#### AI / Decision Engine

| Файл | Описание |
|------|----------|
| `decision-engine.ts` | ★ Главный AI-движок: RAG + few-shot + GPT + self-check + autosend |
| `rag-retrieval.ts` | Retrieval: cosine similarity по эмбеддингам из PostgreSQL |
| `rag-indexer.ts` | Индексирование документов/товаров в rag_chunks |
| `embedding-service.ts` | OpenAI text-embedding-3-small (1536 dims), batching |
| `few-shot-builder.ts` | Few-shot примеры из БД + BUILTIN_FEW_SHOT_EXAMPLES |
| `onboarding-templates.ts` | GPT генерация черновиков базы знаний |
| `document-chunking-service.ts` | Разбивка документов на чанки для RAG |
| `human-delay-engine.ts` | «Человекоподобная» задержка перед autosend |

#### Каналы — Telegram

| Файл | Описание |
|------|----------|
| `telegram-adapter.ts` | Telegram Bot API: parse updates, send messages |
| `telegram-personal-adapter.ts` | MTProto через gramjs: QR/phone/2FA auth |
| `telegram-client-manager.ts` | Управление активными MTProto-соединениями, reconnect |
| `telegram-session-crypto.ts` | Шифрование session string в БД |

#### Каналы — WhatsApp

| Файл | Описание |
|------|----------|
| `whatsapp-adapter.ts` | WhatsApp Bot API (вебхук) |
| `whatsapp-personal-adapter.ts` | Baileys: QR, сессии на диске, send/receive |

#### Каналы — MAX

| Файл | Описание |
|------|----------|
| `max-adapter.ts` | MAX Bot (вебхук-интеграция) |
| `max-personal-adapter.ts` | Обёртка над GREEN-API для MAX Personal |
| `max-green-api-adapter.ts` | HTTP-клиент к GREEN-API (state, QR, send, webhook) |
| `channel-adapter.ts` | Единый channel dispatcher (channelRegistry) |
| `channel-adapter.types.ts` | Интерфейсы ChannelAdapter, ParsedIncomingMessage |

#### Auto Parts — VIN / Price

| Файл | Описание |
|------|----------|
| `podzamenu-lookup-client.ts` | HTTP-клиент к Python-сервису (VIN→КПП OEM) |
| `partsapi-vin-decoder.ts` | PartsAPI декодер VIN → make/model/year/gearbox |
| `vehicle-data-extractor.ts` | GPT-4o-mini: извлечение driveType + gearboxType из rawData |
| `transmission-identifier.ts` | OEM → market model name (кэш в БД, GPT-fallback) |
| `price-searcher.ts` | Yandex + GPT web_search → min/max/avg цена КПП |
| `price-lookup-queue.ts` | BullMQ очередь для price-lookup worker |
| `vehicle-lookup-queue.ts` | BullMQ очередь для vehicle-lookup worker |
| `gearbox-templates.ts` | Шаблоны текста для результатов КПП |
| `gearbox/gearbox-kind.ts` | Канонический тип GearboxKind + конвертеры |
| `price-sources/yandex-source.ts` | Yandex Search API клиент |
| `price-sources/avito-source.ts` | Avito парсер |
| `price-sources/drom-source.ts` | Drom парсер |
| `price-sources/web-source.ts` | Playwright page fetcher |
| `price-sources/mock-source.ts` | Mock-источник для тестов |
| `playwright-fetcher.ts` | HTTP → Python playwright-сервис → HTML |
| `vin-ocr.service.ts` | OCR: извлечение VIN/FRAME из фото |
| `detection/candidate-detector.ts` | Определение VIN/FRAME/gearbox-тегов в тексте |

#### Биллинг

| Файл | Описание |
|------|----------|
| `cryptobot-billing.ts` | CryptoBot: создание инвойса, webhook, активация |
| `billing-service.ts` | Stripe: создание сессии, webhook, статус |

#### Аутентификация / Безопасность

| Файл | Описание |
|------|----------|
| `auth-service.ts` | Signup/login/invite/reset-password логика |
| `secret-store.ts` | AES-256-GCM шифрование/дешифрование |
| `secret-resolver.ts` | Получение секретов из integration_secrets |
| `fraud-detection-service.ts` | Fingerprint + fraud_flags |
| `security-readiness.ts` | Security readiness scoring |
| `admin-action-service.ts` | Логирование admin-действий с idempotency |
| `owner-bootstrap.ts` | Первичная настройка platform owner |

#### Аналитика / Мониторинг

| Файл | Описание |
|------|----------|
| `audit-log.ts` | Запись в audit_events |
| `csat-service.ts` | CSAT расчёт |
| `conversion-service.ts` | Конверсии |
| `lost-deals-service.ts` | Потерянные лиды |
| `intent-analytics-service.ts` | Аналитика по интентам |
| `learning-score-service.ts` | Learning score для AI |
| `training-sample-service.ts` | Управление training samples |
| `readiness-score-service.ts` | Readiness score тенанта |
| `smoke-test-service.ts` | Smoke-тест перед production |
| `observability/metrics.ts` | In-memory счётчики (incr) |

#### Инфраструктура

| Файл | Описание |
|------|----------|
| `feature-flags.ts` | Feature flags: чтение из БД, per-tenant overrides |
| `websocket-server.ts` | WebSocket (RealtimeService): broadcast новых сообщений/подсказок |
| `message-bus.ts` | Внутренняя шина событий |
| `message-queue.ts` | BullMQ + IORedis конфигурация |
| `inbound-message-handler.ts` | Обработчик входящих: customer+conversation, dedup, AI trigger |
| `route-registry.ts` | Авторегистрация роутов в реестр для /api/routes |
| `email-provider.ts` | Email отправка (SMTP) |
| `proxy-service.ts` | Управление прокси-пулом |
| `update-service.ts` | Загрузка и применение ZIP-обновлений |
| `onboarding-service.ts` | Онбординг-логика (шаги, readiness) |
| `customer-summary-service.ts` | Саммари клиента для AI-контекста |
| `customer-data-deletion-service.ts` | GDPR: удаление данных клиента |
| `template-renderer.ts` | Рендер `{{variable}}` шаблонов |
| `escalation-bot.ts` | Telegram-бот для эскалаций |
| `no-reply-check-queue.ts` | Очередь проверки «нет ответа» |
| `marquiz-lead-queue.ts` | Очередь обработки Marquiz-лидов |

---

### server/middleware/

```
server/middleware/
├── rbac.ts                          # ★ RBAC: requireAuth, requirePermission, extractUserRole
│                                    #   36 входящих зависимостей
├── csrf.ts                          # CSRF защита (doubleCsrf)
├── webhook-security.ts              # HMAC-подпись для вебхуков
└── request-context.ts               # requestId, audit context в AsyncLocalStorage
```

### server/workers/

```
server/workers/
├── vehicle-lookup.worker.ts         # BullMQ: VIN → OEM → КПП (Podzamenu + PartsAPI)
└── price-lookup.worker.ts           # BullMQ: OEM → поиск цены (Yandex + GPT)
```

### server/tests/ и server/__tests__/

```
server/tests/                        # Vitest интеграционные тесты
├── decision-engine-e2e.test.ts      # E2E Decision Engine (mock OpenAI)
├── integration.test.ts              # API интеграционные тесты
├── rbac.test.ts                     # RBAC тесты
├── route-registry.test.ts           # Route registry тесты
└── real-endpoint-protection.test.ts # Защита реальных эндпоинтов

server/__tests__/                    # Unit тесты
├── onboarding.test.ts
├── onboarding-templates.test.ts
├── price-regression-cases.test.ts
├── readiness-gating.integration.test.ts
├── smoke-test.test.ts
└── rag-retrieval.test.ts
```

---

## client/ — Frontend

### Точки входа

```
client/
├── index.html                       # HTML shell
└── src/
    ├── main.tsx                     # React entry
    └── App.tsx                      # ★ Router, AuthGuard, layout
                                     #   70 входящих зависимостей
```

### client/src/pages/ — Страницы (роутинг через Wouter)

| Файл | Путь | Доступ | Описание |
|------|------|--------|----------|
| `auth.tsx` | `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password` | Публичный | Аутентификация |
| `dashboard.tsx` | `/` | Auth | Дашборд: метрики, эскалации, активные диалоги |
| `conversations.tsx` | `/conversations` | Auth | Список + чат-интерфейс, ChannelTabs |
| `customer-profile.tsx` | `/customers/:id` | Auth | Профиль клиента, заметки, память AI |
| `knowledge-base.tsx` | `/knowledge-base` | Auth | Документы KB, RAG-статус |
| `products.tsx` | `/products` | Auth | Каталог товаров |
| `escalations.tsx` | `/escalations` | Auth | Список эскалаций |
| `failed-leads.tsx` | `/failed-leads` | Auth | Потерянные лиды |
| `analytics.tsx` | `/analytics` | Auth | CSAT, конверсии, интент-аналитика |
| `settings.tsx` | `/settings` | Auth (owner/admin) | Все настройки (~4600 строк). Вкладки: **Компания** (валюта, часовой пояс, рабочие дни/часы), **Поведение AI** (CompanyAgentCard, стиль общения, скрипты, факты-textarea, системный промпт в Collapsible), **Автоматизация** (DecisionEngineSettings с таблицей интентов + isDirty, HumanDelaySettings + isDirty, Скидки, Бот эскалаций), **Обучение** (TrainingPoliciesSettings), **Шаблоны** (TemplatesTab + PaymentMethodsTab), **Каналы** (ChannelSettings) |
| `onboarding.tsx` | `/onboarding` | Auth | Wizard 6 шагов |
| `billing.tsx` | — | Auth | Подписка, paywall |
| `security-status.tsx` | `/admin/security` | PlatformAdmin | Readiness report |
| `admin-billing.tsx` | `/admin/billing` | PlatformAdmin | Биллинг тенантов |
| `admin-secrets.tsx` | `/admin/secrets` | PlatformAdmin | Секреты (API ключи) |
| `admin-users.tsx` | `/admin/users` | PlatformAdmin | Пользователи платформы |
| `admin-proxies.tsx` | `/admin/proxies` | PlatformAdmin | Прокси-пул |
| `admin-tenants.tsx` | `/admin/tenants` | PlatformAdmin | Тенанты |
| `owner-login.tsx` | `/owner/login` | Публичный | Вход platform owner |
| `owner-dashboard.tsx` | `/owner` | PlatformOwner | Dashboard платформы |
| `owner-updates.tsx` | `/owner/updates` | PlatformOwner | Загрузка обновлений |
| `not-found.tsx` | `*` | — | 404 |

### client/src/components/

```
client/src/components/
├── ui/                              # shadcn/ui компоненты (40+ файлов)
├── app-sidebar.tsx                  # Боковая навигация
├── chat-interface.tsx               # Чат-интерфейс + AI-подсказки
├── conversation-list.tsx            # Список диалогов
├── customer-card.tsx                # Карточка клиента в чате
├── channel-tabs.tsx                 # Фильтр по каналам
├── metrics-card.tsx                 # Карточка метрики
├── subscription-paywall.tsx         # Paywall при неактивной подписке
└── theme-toggle.tsx                 # Переключатель темы
```

### client/src/hooks/

| Файл | Описание |
|------|----------|
| `use-auth.ts` | Auth state (polls GET /api/auth/user, logout) |
| `use-billing.ts` | Billing state + checkout + cancel |
| `use-notifications.ts` | Browser Notification API |
| `use-mobile.tsx` | Mobile breakpoint (768px) |
| `use-toast.ts` | Toast уведомления |

### client/src/lib/

| Файл | Описание |
|------|----------|
| `queryClient.ts` | TanStack Query client + apiRequest() fetch wrapper |
| `websocket.ts` | ★ WS клиент (/ws): reconnect, cache invalidation по событиям |
|                 | ⚠️ Циклическая зависимость с use-notifications.ts |
| `theme-provider.tsx` | Тема (light/dark) через Context |
| `utils.ts` | cn() для Tailwind class merging |

---

## migrations/ — SQL миграции

```
migrations/
├── 0000_*.sql … 0023_*.sql          # Последовательные миграции (0000 → 0023)
├── manual/                          # Ручные миграции (вне авто-нумерации)
└── meta/
    ├── _journal.json                # Реестр применённых миграций
    └── NNNN_snapshot.json           # Снапшоты схемы для каждой миграции
```

---

## Граф зависимостей — ключевые метрики

| Метрика | Значение |
|---------|---------|
| Всего файлов | 308 |
| Рёбер зависимостей | 1 369 |
| Среднее зависимостей/файл | 4.4 |
| Циклических зависимостей | **1** |
| Орфанных файлов | 18 |

### Топ-10 самых связных файлов

| Файл | Соединений |
|------|-----------|
| `server/storage.ts` | 125 |
| `shared/schema.ts` | 115 |
| `client/src/App.tsx` | 70 |
| `server/routes/channels/telegram-personal.routes.ts` | 56 |
| `client/src/lib/utils.ts` | 49 |
| `server/routes.ts` | 48 |
| `server/db.ts` | 47 |
| `server/__tests__/smoke-test.test.ts` | 38 |
| `server/middleware/rbac.ts` | 36 |
| `server/services/telegram-client-manager.ts` | 35 |

### Циклическая зависимость

```
client/src/hooks/use-notifications.ts
  → client/src/lib/websocket.ts
  → client/src/hooks/use-notifications.ts
```
