# Architecture — AI Sales Operator

> Актуально на май 2026.

---

## Обзор продукта

**AI Sales Operator** — B2B SaaS для автоматизации клиентской поддержки в e-commerce.

- Входящие сообщения из Telegram / WhatsApp / MAX → AI генерирует ответ → оператор одобряет/правит/отклоняет → отправка клиенту
- Мультитенантность: каждый бизнес — отдельный тенант со своими каналами, базой знаний, настройками
- Подписка: 50 USDT/мес через CryptoBot, 3-дневный триал

---

## Технологический стек

| Слой | Технологии |
|------|-----------|
| **Frontend** | React 18, Vite 7, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, Wouter |
| **Backend** | Node.js 20, Express.js, TypeScript |
| **База данных** | PostgreSQL (Drizzle ORM), connect-pg-simple (sessions) |
| **Очереди** | BullMQ + Redis (IORedis) |
| **AI** | OpenAI GPT-4o-mini (генерация/self-check/GPT-extractor), text-embedding-3-small (RAG) |
| **Каналы** | gramjs (MTProto), Baileys (WhatsApp), GREEN-API (MAX), Telegram Bot API |
| **Python-сервис** | FastAPI + Playwright + Chromium (Podzamenu VIN-парсер, порт 8200) |
| **Деплой** | PM2, Nixpacks, Docker (node:20-alpine) |
| **Безопасность** | bcrypt, AES-256-GCM, HMAC-SHA256, CSRF (doubleCsrf), session fixation protection |

---

## Высокоуровневая архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                         КЛИЕНТСКИЕ КАНАЛЫ                        │
│  Telegram Personal  │  WhatsApp Personal  │  MAX Personal        │
│  (MTProto/gramjs)   │  (Baileys)          │  (GREEN-API HTTP)    │
└────────────┬────────┴──────────┬──────────┴──────────┬──────────┘
             │ WebSocket/events  │ events              │ HTTP webhook
             ▼                  ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXPRESS.JS BACKEND (Node.js 20)               │
│                                                                  │
│  ┌─────────────────┐   ┌─────────────────┐   ┌───────────────┐ │
│  │  inbound-message │   │  decision-engine │   │  websocket-   │ │
│  │  -handler.ts    │──▶│  .ts (AI)        │   │  server.ts    │ │
│  └─────────────────┘   └────────┬────────┘   └───────────────┘ │
│           │                     │                     ▲          │
│           │              ┌──────┴──────┐              │          │
│           │         ┌────┤ RAG Retrieval├────┐        │          │
│           │         │    └─────────────┘    │        │          │
│           │         ▼                       ▼        │          │
│           │   rag_chunks table        OpenAI API     │ broadcast │
│           │   (cosine similarity)     (GPT-4o-mini)  │          │
│           │                                          │          │
│  ┌────────▼──────────────────────────────────────────┴────────┐ │
│  │                    PostgreSQL (Drizzle ORM)                  │ │
│  │  49 таблиц: tenants, users, conversations, messages,        │ │
│  │  rag_chunks, ai_suggestions, subscriptions, ...             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────────────┐   ┌─────────────────────────────┐ │
│  │      BullMQ Workers       │   │     Python Podzamenu        │ │
│  │  vehicle-lookup.worker   │──▶│     Service (port 8200)     │ │
│  │  price-lookup.worker     │   │   FastAPI + Playwright       │ │
│  └──────────────────────────┘   └─────────────────────────────┘ │
│                    ▲                                             │
│                    │ Redis (BullMQ queues)                       │
└─────────────────────────────────────────────────────────────────┘
             ▲
             │ HTTPS + WebSocket
             │
┌────────────┴────────────────────────────────────────────────────┐
│                    REACT FRONTEND (Vite SPA)                      │
│  Dashboard │ Conversations │ Analytics │ Settings │ Admin         │
│  TanStack Query (REST) + WebSocket client (real-time)            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Мультитенантность

Каждый объект в БД имеет `tenant_id`. Изоляция обеспечивается:

1. **Middleware `requireTenant`** — устанавливает `req.tenantId` из сессии
2. **Все storage-методы** принимают `tenantId` и добавляют `WHERE tenant_id = ?`
3. **WebSocket** — при подключении tenantId берётся из сессии; попытка смены через `set_tenant` блокируется

### Роли пользователей

| Роль | Права |
|------|-------|
| `owner` | Все права тенанта, управление командой |
| `admin` | Все права тенанта, кроме критичных настроек |
| `operator` | Работа с диалогами, одобрение AI-подсказок |
| `viewer` | Только чтение |
| `guest` | Нет доступа (дефолт при отсутствии сессии) |
| `isPlatformAdmin` | Суперадмин платформы (все тенанты) |
| `isPlatformOwner` | Владелец платформы (обновления, bootstrap) |

---

## Жизненный цикл входящего сообщения

```
1. Канал получает сообщение (MTProto event / Baileys event / HTTP webhook)
   └─ channel-adapter.ts → processIncomingMessageFull()

2. inbound-message-handler.ts:
   a) Найти или создать customer (dedup по externalId)
   b) Найти или создать conversation
   c) Сохранить message в БД
   d) WebSocket broadcast → frontend обновляет UI

3. Если AUTO_PARTS_ENABLED:
   └─ detectVehicleIdFromText() → при нахождении VIN/FRAME → enqueue vehicle-lookup

4. triggerAiSuggestion():
   a) Проверить нет ли pending suggestion
   b) Проверить feature flag AI_SUGGESTIONS_ENABLED
   c) Вызвать generateWithDecisionEngine()
   d) Сохранить ai_suggestion в БД
   e) WebSocket broadcast new_suggestion → frontend показывает подсказку

5. Decision Engine (decision-engine.ts):
   a) Загрузить tenant_agent_settings
   b) RAG retrieval (rag-retrieval.ts) → топ-N чанков по cosine similarity
   c) Few-shot builder → примеры из ai_training_samples
   d) Сформировать system prompt + user message
   e) Вызвать OpenAI GPT-4o-mini (chat.completions.create, json_object)
   f) Self-check: отдельный GPT-вызов → score 0-1, need_handoff
   g) Применить тройную блокировку autosend
   h) Вернуть SuggestionResponse {reply_text, intent, confidence, decision}
```

---

## Autosend — «Тройная блокировка»

Все три условия должны быть true для AUTO_SEND:

```
Lock 1: feature flag AI_AUTOSEND_ENABLED = true (глобальный)
Lock 2: tenant.autosendAllowed = true (настройка тенанта)
Lock 3: intent входит в intentsAutosendAllowed[] (белый список интентов)
         И intent НЕ входит в intentsForceHandoff[] (чёрный список)
```

Если хотя бы один lock не проходит → `NEED_APPROVAL` (решение возвращается как autosendEligible=false с причиной).

---

## WebSocket — реальное время

**Сервер:** `server/services/websocket-server.ts` (RealtimeService)

**Аутентификация:** при upgrade сессия читается из cookie → `tenantId` берётся из БД → привязывается к клиенту. Попытка переопределить через `set_tenant` блокируется с ошибкой.

**События сервер → клиент:**

| Событие | Когда |
|---------|-------|
| `new_message` | Новое сообщение в разговоре |
| `conversation_update` | Изменение статуса/режима разговора |
| `new_conversation` | Создан новый разговор |
| `new_suggestion` | AI сгенерировал подсказку |
| `pong` | Ответ на ping |

**Клиент:** `client/src/lib/websocket.ts` — reconnect с экспоненциальным backoff (5 попыток), invalidation TanStack Query кэша.

⚠️ **Известная проблема:** циклическая зависимость `use-notifications.ts ↔ websocket.ts`

---

## Биллинг

### Провайдеры

| Провайдер | Файл | Статус |
|-----------|------|--------|
| **CryptoBot** | `server/services/cryptobot-billing.ts` | Активен (50 USDT/мес) |
| **Stripe** | `server/services/billing-service.ts` | Код есть, не активен в prod |

### Жизненный цикл подписки

```
Новый тенант → subscription.status = "incomplete"
→ POST /api/billing/create-invoice → CryptoBot invoice
→ Клиент оплачивает
→ POST /webhook/cryptobot → handleWebhookEvent()
→ subscription.status = "active", currentPeriodEnd = now + 30 дней

Триал: POST /api/billing/start-trial → status = "trialing", trialEndsAt = now + 72ч
       hadTrial = true (повторный триал невозможен)

Middleware requireActiveSubscription:
  canAccess = status ∈ {active, trialing, past_due, canceled (до конца периода)}
           OR activeGrant существует (ручная выдача)
```

---

## Auto Parts — система поиска цен КПП

Специализированный модуль (включается флагом `AUTO_PARTS_ENABLED`):

```
Клиент пишет VIN → detectVehicleIdFromText() → vehicle-lookup BullMQ queue
  → vehicle-lookup.worker.ts:
      1. PartsAPI: VIN → make/model/year/gearboxType
      2. Podzamenu (Python): VIN → OEM номер КПП
      3. transmission-identifier.ts + GPT: OEM → market model name (кэш 30 дней)
      4. Enqueue price-lookup

  → price-lookup.worker.ts:
      Stage 1: Yandex Search API + Playwright → HTML парсинг → объявления
               (≥3 объявлений OR ≥2 доменов → success)
      Stage 2: OpenAI GPT-4o-mini web_search fallback
      Stage 3: PRICE_ESCALATION_ENABLED → escalation suggestion
      Stage 4: AI_PRICE_ESTIMATE_ENABLED → GPT estimate (confidence 0.5)
      Stage 5: createNotFoundSuggestion()

      → createAiSuggestion() → WS broadcast → оператор видит цену
```

---

## Безопасность

| Механизм | Реализация |
|----------|-----------|
| Пароли | bcrypt (salt rounds: 10) |
| Сессии | express-session → PostgreSQL, TTL 7д, HttpOnly+Secure+SameSite=Lax |
| Session fixation | session.regenerate() при логине |
| CSRF | doubleCsrf (cookie + header токен) |
| Rate limiting | express-rate-limit: 5 login/15мин, 3 signup/ч, 5 forgot/15мин |
| Account lockout | 5 неудачных → lockout до 15 мин |
| API ключи | AES-256-GCM шифрование в integration_secrets |
| Webhook HMAC | HMAC-SHA256 подпись для CryptoBot, Telegram |
| Tenant isolation | tenantId в каждом запросе + middleware |
| Audit log | audit_events таблица, 25+ типов действий |
| Fraud detection | channel_fingerprints + fraud_flags |
| Anti-enumeration | Одинаковый ответ для несуществующих email |

---

## Feature Flags

Флаги хранятся в `feature_flags` таблице (+ дефолты из `feature_flags.json`). Поддерживают per-tenant override.

| Флаг | Дефолт | Описание |
|------|--------|----------|
| `AI_SUGGESTIONS_ENABLED` | true | Генерация AI-подсказок |
| `DECISION_ENGINE_ENABLED` | false | Advanced decision engine |
| `AI_AUTOSEND_ENABLED` | false | Автоотправка без одобрения |
| `HUMAN_DELAY_ENABLED` | false | Человекоподобная задержка |
| `RAG_ENABLED` | true | RAG-ретривал |
| `FEW_SHOT_LEARNING` | true | Few-shot примеры |
| `TELEGRAM_PERSONAL_CHANNEL_ENABLED` | false | Telegram MTProto |
| `WHATSAPP_PERSONAL_CHANNEL_ENABLED` | false | WhatsApp Baileys |
| `MAX_PERSONAL_CHANNEL_ENABLED` | false | MAX GREEN-API |
| `AUTO_PARTS_ENABLED` | false | VIN-lookup + поиск цен |
| `AI_PRICE_ESTIMATE_ENABLED` | true | GPT fallback для цены |
| `PRICE_ESCALATION_ENABLED` | true | Эскалация при ненайденной цене |

---

## PM2 конфигурация (ecosystem.config.cjs)

| Приложение | Описание |
|-----------|----------|
| `aisales` | Основной Node.js сервер |
| `worker-price-lookup` | BullMQ worker для поиска цен |
| `podzamenu-service` | Python FastAPI VIN-парсер (порт 8200) |
