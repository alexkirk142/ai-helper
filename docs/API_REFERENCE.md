# API Reference — AI Sales Operator

> Актуально на май 2026. Источник: `server/routes/` (34 файла).

---

## Аутентификация

**Тип:** Session-based (express-session → PostgreSQL `sessions` таблица)

| Параметр | Значение |
|---------|---------|
| TTL | 7 дней |
| Cookie | `HttpOnly`, `Secure` (prod), `SameSite=Lax` |
| Secret | `SESSION_SECRET` env (≥32 символа) |
| CSRF | doubleCsrf — нужен заголовок `x-csrf-token` для мутирующих запросов |

### Получить CSRF-токен
```
GET /api/csrf-token
→ { "token": "string" }
```
Cache-Control: no-store. Токен передаётся в заголовке `x-csrf-token`.

---

## RBAC — Разрешения

| Роль | Права |
|------|-------|
| `owner` | Все, включая управление командой и настройками |
| `admin` | Почти всё, кроме критичных настроек безопасности |
| `operator` | Работа с диалогами, одобрение AI |
| `viewer` | Только чтение |

**Middleware:** `requireAuth`, `requirePermission("PERMISSION_NAME")`, `requireActiveSubscription`, `requireActiveTenant`

---

## Health & Metrics

### GET `/api/health`
Статус сервера.
- **Auth:** Нет
- **Response 200:** `{ "status": "ok", "timestamp": "ISO" }`

### GET `/api/metrics`
In-memory метрики.
- **Auth:** Нет

### GET `/api/routes`
Реестр всех зарегистрированных роутов.
- **Auth:** Нет

---

## Auth

### POST `/auth/signup`
Регистрация нового пользователя. С `inviteToken` → присоединение к тенанту. Без него → создание нового тенанта.
- **Rate limit:** 3/час
- **Body:** `{ email, password, username, inviteToken? }`
- **Response 200:** `{ success: true }` + session cookie

### POST `/auth/login`
Вход с email/password.
- **Rate limit:** 5/15мин (по IP + email)
- **Security:** блокировка после 5 неудачных попыток, anti-enumeration
- **Body:** `{ email, password }`
- **Response 200:** `{ success: true, user: {...} }`
- **Response 401:** `{ error, code: "INVALID_CREDENTIALS" }`
- **Response 423:** `{ error, code: "ACCOUNT_LOCKED" }`

### POST `/auth/logout`
Уничтожить сессию.
- **Response 200:** `{ success: true }`

### GET `/auth/me`
Текущее состояние сессии.
- **Response 200:** `{ authenticated: bool, user?, tenantId?, role? }`

### GET `/api/auth/user`
Полные данные аутентифицированного пользователя.
- **Auth:** Session required
- **Response 200:** `{ id, username, email, role, tenantId, isPlatformAdmin, isPlatformOwner, authProvider }`

### POST `/auth/invite`
Создать инвайт для нового члена команды.
- **Auth:** `requireAuth`, `requirePermission("MANAGE_USERS")`
- **Body:** `{ email, role: "admin|operator|viewer" }`
- **Response 201:** `{ success: true, inviteLink, expiresAt }`

### POST `/auth/send-verification`
Отправить письмо для верификации email.
- **Auth:** `requireAuth`

### POST `/auth/verify-email`
Верифицировать email по токену.
- **Body:** `{ token }`

### POST `/auth/forgot-password`
Запрос сброса пароля (anti-enumeration: всегда 200).
- **Rate limit:** 5/15мин
- **Body:** `{ email }`

### POST `/auth/reset-password`
Сбросить пароль по токену.
- **Body:** `{ token, password }`

---

## Tenant

### GET `/api/tenant`
Получить данные тенанта.
- **Auth:** `requireAuth`, `VIEW_CONVERSATIONS`

### PATCH `/api/tenant`
Обновить настройки тенанта.
- **Auth:** `requireAuth`, `MANAGE_TENANT_SETTINGS`

---

## Onboarding

### GET `/api/onboarding/state`
Прогресс онбординга (шаги: BUSINESS→CHANNELS→PRODUCTS→POLICIES→KB→REVIEW→DONE).

### POST `/api/onboarding/complete-step`
Отметить шаг выполненным.
- **Body:** `{ step, answers: {} }`
- **Response 200:** `{ ...state, completedStep, nextStep }`

### POST `/api/onboarding/generate-templates`
GPT генерирует черновики базы знаний по ответам онбординга.
- **Rate limit:** onboardingRateLimiter
- **Body:** `{ answers: { BUSINESS, POLICIES } }`
- **Response 200:** `{ drafts: [{ title, content, docType }] }`

### POST `/api/onboarding/apply-templates`
Применить черновики в базу знаний + запустить RAG индексацию.

### GET `/api/onboarding/readiness`
Readiness score тенанта (0–100, порог 70).
- **Response 200:** `{ score, checks, recommendations, threshold, ready }`

---

## Customers

### GET `/api/customers`
Список клиентов с поиском.
- **Query:** `?q=search&limit=20&offset=0`

### GET `/api/customers/:id`
Профиль клиента.

### PATCH `/api/customers/:id`
Обновить данные клиента.
- **Body:** `{ name?, email?, phone?, tags? }`

### DELETE `/api/customers/:id`
GDPR: удалить данные клиента.
- **Auth:** `requirePermission("MANAGE_TENANT_SETTINGS")`

---

## Conversations

### GET `/api/conversations`
Список диалогов.
- **Query:** `?status=active|waiting|escalated|resolved&channelId=&q=`

### GET `/api/conversations/:id`
Детали диалога с сообщениями и AI-подсказкой.

### PATCH `/api/conversations/:id`
Обновить статус/режим диалога.
- **Body:** `{ status?, mode?, isMuted? }`

### POST `/api/conversations/:id/mark-read`
Сбросить счётчик непрочитанных.

---

## Messages

### GET `/api/conversations/:id/messages`
История сообщений диалога.

### POST `/api/messages`
Отправить сообщение оператором.
- **Auth:** `requirePermission("MANAGE_CONVERSATIONS")`
- **Body:** `{ conversationId, content, attachments? }`

---

## AI Suggestions

### GET `/api/conversations/:id/suggestion`
Текущая AI-подсказка для диалога.

### POST `/api/suggestions/:id/approve`
Одобрить и отправить подсказку.

### POST `/api/suggestions/:id/edit`
Редактировать и отправить.
- **Body:** `{ editedText }`

### POST `/api/suggestions/:id/reject`
Отклонить подсказку.
- **Body:** `{ reason? }`

### POST `/api/suggestions/regenerate`
Перегенерировать подсказку.
- **Body:** `{ conversationId }`

---

## Products

### GET `/api/products`
Список товаров.
- **Query:** `?q=&category=&limit=`

### POST `/api/products`
Создать товар (→ автоматически запускает RAG indexing).

### PATCH `/api/products/:id`
Обновить товар.

### DELETE `/api/products/:id`
Удалить товар.

### POST `/api/products/bulk`
Массовый импорт товаров.

---

## Knowledge Base

### GET `/api/knowledge-docs`
Список документов базы знаний.

### POST `/api/knowledge-docs`
Создать документ (→ автоматически RAG indexing).

### PATCH `/api/knowledge-docs/:id`
Обновить документ.

### DELETE `/api/knowledge-docs/:id`
Удалить документ.

### GET `/api/admin/rag/status`
Статус RAG индекса: pendingChunks, staleChunks, model.
- **Auth:** `MANAGE_KNOWLEDGE_BASE`

### POST `/api/admin/rag/regenerate-embeddings`
Перегенерировать эмбеддинги для чанков без embedding.
- **Query:** `?limit=50&batchSize=10&concurrency=3&includeStale=false`

### POST `/api/admin/rag/invalidate-stale`
Инвалидировать устаревшие эмбеддинги.

---

## Escalations

### GET `/api/escalations`
- **Query:** `?status=recent|pending`

### PATCH `/api/escalations/:id`
- **Body:** `{ status: "pending|handled|dismissed" }`

---

## Analytics & Dashboard

### GET `/api/dashboard/metrics`
Сводные метрики для дашборда.
- **Response:** `{ totalConversations, activeConversations, escalatedConversations, resolvedToday⚠️, avgResponseTime⚠️, aiAccuracy, pendingSuggestions, productsCount, knowledgeDocsCount }`
- ⚠️ `resolvedToday=0`, `avgResponseTime=null` — заглушки

### GET `/api/analytics/intents`
Intent performance аналитика.

### GET `/api/analytics/csat`
CSAT аналитика.

### GET `/api/analytics/conversions`
Аналитика конверсий.

### GET `/api/analytics/lost-deals`
Аналитика потерянных лидов.

---

## Settings

### GET/PATCH `/api/settings/decision`
Decision Engine настройки тенанта (пороги, autosend).

**⚠️ Gating:** включение autosend требует readiness score ≥ 80 (иначе 409).

### GET/PATCH `/api/settings/human-delay`
Настройки задержки.

---

## Agent Settings

### GET/PATCH `/api/agent-settings`
Per-tenant настройки AI-агента: company_facts, scripts, custom_system_prompt, autosend настройки.

---

## Message Templates

### GET `/api/message-templates`
Список шаблонов сообщений.

### POST/PATCH/DELETE `/api/message-templates/:id`
CRUD шаблонов.

### PATCH `/api/message-templates/reorder`
Изменить порядок шаблонов.

---

## Payment Methods

### GET/POST/PATCH/DELETE `/api/payment-methods`
CRUD способов оплаты клиентам.

---

## Channel Management

### GET `/api/channels`
Список каналов тенанта.

### POST `/api/channels`
Создать канал.

### PATCH/DELETE `/api/channels/:id`
Обновить/удалить канал.

### GET `/api/channels/:id/status`
Статус подключения канала.

### POST `/api/channels/:id/test`
Тест-отправка сообщения.

---

## Telegram Personal

### Аутентификация по QR

### POST `/api/telegram-personal/accounts/start-qr`
Начать QR авторизацию.
- **Auth:** `requireAuth`, `MANAGE_CHANNELS`, `requireActiveSubscription`, `requireActiveTenant`
- **Response:** `{ accountId, sessionId, qrImageDataUrl, qrUrl, expiresAt }`

### POST `/api/telegram-personal/accounts/check-qr`
Проверить статус QR.
- **Body:** `{ sessionId, accountId }`
- **Response:** `{ status: "authorized|pending|expired|needs_2fa", ... }`

### POST `/api/telegram-personal/accounts/verify-qr-2fa`
Ввести 2FA пароль при QR авторизации.

### Аутентификация по телефону

### POST `/api/telegram-personal/accounts/start-phone`
- **Body:** `{ phoneNumber }`

### POST `/api/telegram-personal/accounts/verify-code`
- **Body:** `{ accountId, sessionId, phoneNumber, code }`

### POST `/api/telegram-personal/accounts/verify-password`
- **Body:** `{ accountId, sessionId, password }`

### Управление аккаунтами

### GET `/api/telegram-personal/accounts`
Список Telegram аккаунтов.

### DELETE `/api/telegram-personal/accounts/:id`
Отключить аккаунт.

### GET `/api/telegram-personal/status`
Статус Telegram Personal канала.

---

## WhatsApp Personal

### GET `/api/whatsapp-personal/qr`
Получить QR для WhatsApp.

### GET `/api/whatsapp-personal/status`
Статус подключения.

### POST `/api/whatsapp-personal/logout`
Отключиться.

---

## MAX Personal

*(Управляется только платформ-администраторами через `/api/admin/users/:userId/max-personal`)*

### GET `/api/max/status`
Статус MAX Personal канала.

---

## Billing

### GET `/api/billing/status`
Статус подписки тенанта.
- **Response:** `{ hasSubscription, status, plan, currentPeriodEnd, canAccess, isTrial, trialEndsAt, trialDaysRemaining, hasActiveGrant }`

### POST `/api/billing/create-invoice`
Создать CryptoBot invoice на оплату.
- **Response:** `{ invoiceUrl, invoiceId }`

### POST `/api/billing/start-trial`
Активировать 3-дневный триал (72ч, только один раз).
- **Response:** `{ success, trialEndsAt }`

### POST `/api/billing/cancel`
Отменить подписку (cancel_at_period_end = true).

---

## Feature Flags

### GET `/api/feature-flags`
Список флагов тенанта.

### PATCH `/api/feature-flags/:name`
Включить/выключить флаг.
- **Auth:** `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Body:** `{ enabled: boolean, tenantId? }`

---

## Vehicle Lookup

### POST `/api/vehicle-lookup/start`
Запустить VIN/FRAME lookup.
- **Body:** `{ vehicleId, idType: "VIN"|"FRAME", conversationId }`

### GET `/api/vehicle-lookup/status/:conversationId`
Статус lookup для диалога.

### GET/PUT `/api/price-settings`
Настройки ценового модуля (из tenants.templates.priceSettings).
- `{ marginPct: -25, roundTo: 100, priceNote: "", showMarketPrice: false }`

---

## Audit Events

### GET `/api/audit-events`
Список событий аудита.
- **Auth:** `requirePermission("VIEW_ANALYTICS")`
- **Query:** `?entityType=&action=&limit=50`

---

## Platform Admin

*(Только `isPlatformAdmin = true`)*

### GET `/api/admin/tenants`
Список всех тенантов.

### PATCH `/api/admin/tenants/:id`
Изменить статус тенанта (active/restricted).

### GET `/api/admin/users`
Список всех пользователей платформы.
- **Query:** `?q=&limit=20&offset=0`

### PATCH `/api/admin/users/:id/disable`
### PATCH `/api/admin/users/:id/enable`
Блокировка/разблокировка пользователя.

### POST `/api/admin/grants`
Выдать ручной грант доступа тенанту.

### DELETE `/api/admin/grants/:id`
Отозвать грант.

### GET/POST/PATCH/DELETE `/api/admin/secrets`
Управление integration_secrets (AES-256-GCM).

### GET/POST/DELETE `/api/admin/proxies`
Управление прокси-пулом.

### GET `/api/admin/users/:userId/max-personal`
Список MAX Personal аккаунтов пользователя.

### POST `/api/admin/users/:userId/max-personal`
Добавить MAX Personal аккаунт.

### GET `/api/admin/users/:userId/max-personal/:accountId/qr`
QR для MAX Personal авторизации через GREEN-API.

### DELETE `/api/admin/users/:userId/max-personal/:accountId`
Удалить аккаунт (+ очистить webhook на GREEN-API).

### POST `/api/admin/updates/upload`
Загрузить ZIP-обновление.

### POST `/api/admin/updates/:id/apply`
Применить обновление.

---

## Webhooks

### POST `/webhook/telegram`
Telegram Bot API вебхук. HMAC-SHA256 подпись.

### POST `/webhook/whatsapp`
WhatsApp вебхук.

### POST `/webhook/max`
MAX Bot вебхук.

### POST `/webhook/max-personal`
GREEN-API вебхук для MAX Personal.
- **Body:** GREEN-API webhook payload
- **Verif:** `x-green-api-token` header

### POST `/webhook/cryptobot`
CryptoBot платёж. HMAC-SHA256 подпись.
- Обрабатывает `invoice_paid` → активирует подписку

### POST `/webhook/marquiz`
Marquiz лид-форма.

---

## WebSocket

**URL:** `ws://host/ws` (wss:// в prod)
**Auth:** cookie сессии при upgrade → tenantId берётся из БД

### Client → Server

| Event | Payload | Описание |
|-------|---------|----------|
| `subscribe` | `{ conversationId }` | Подписаться на обновления диалога |
| `set_tenant` | `{ tenantId }` | ⚠️ Игнорируется если сессия аутентифицирована |
| `ping` | — | Keepalive |

### Server → Client

| Event | Когда |
|-------|-------|
| `new_message` | Новое сообщение в тенанте |
| `conversation_update` | Изменение статуса/режима |
| `new_conversation` | Создан новый диалог |
| `new_suggestion` | AI сгенерировал подсказку |
| `pong` | Ответ на ping |

**Reconnect (клиент):** 5 попыток с экспоненциальным backoff (2s, 4s, 6s, 8s, 10s).
