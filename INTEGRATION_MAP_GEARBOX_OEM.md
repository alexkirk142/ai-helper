# Карта точек интеграции — Gearbox OEM by VIN/FRAME + tag verification

Аудит репозитория: где что лежит (без кода, только локализация).

---

## 1) Обработка входящих сообщений каналов

### Telegram Personal
- **`server/routes/telegram-webhook.ts`** — вебхук для **бота** Telegram (TELEGRAM_CHANNEL_ENABLED): проверка подписи, парсинг апдейта через `telegramAdapter.parseIncomingMessage`, аудит, ответ 200. **Не сохраняет в БД и не вызывает AI** (бот-канал).
- **`server/services/telegram-client-manager.ts`** — **личный** канал: при получении сообщения (MTProto) вызывает `processIncomingMessageFull(tenantId, parsed)` (импорт из `inbound-message-handler`). Точка входа в общий пайплайн «сохранить сообщение + запустить AI».

### WhatsApp Personal
- **`server/routes/whatsapp-webhook.ts`** — вебхук для **WhatsApp Business API** (WHATSAPP_CHANNEL_ENABLED): verify challenge, парсинг через `whatsappAdapter.parseIncomingMessage`, аудит, ответ 200. **Не сохраняет в БД и не вызывает AI** (канал API).
- **`server/services/whatsapp-personal-adapter.ts`** — **личный** канал (Baileys): в обработчиках входящих сообщений (и история) вызывается `processIncomingMessageFull(tenantId, parsed)` (импорт из `inbound-message-handler`). Несколько мест вызова (~396, 450, 616, 670). Единая точка входа в пайплайн «сохранить + AI».

### MAX (бот и личный)
- **`server/routes/max-webhook.ts`** — роутер: `POST /` — вебхук для канала **MAX (бот)** (MAX_CHANNEL_ENABLED): проверка секрета, `processInboundMessage("max", payload)` из `channel-adapter`, дедуп по id, аудит, ответ 200. **Не вызывает handleIncomingMessage** — только парсинг, сохранение в БД и AI для MAX бота здесь не делаются.
- **`server/routes.ts`** — `POST /api/max-personal/incoming` — входящие от **MAX Personal** (Python-сервис): проверка `x-internal-secret`, валидация tenant, парсинг через `MaxPersonalAdapter.parseIncomingMessage`, вызов `processIncomingMessageFull(tenant_id, parsed)`. Единая точка входа для личного MAX.

### Общий пайплайн (сохранение + AI)
- **`server/services/inbound-message-handler.ts`**
  - **`handleIncomingMessage(tenantId, parsed)`** — поиск/создание customer по (tenantId, channel, externalUserId), поиск/создание conversation, дедуп сообщений, создание message в БД, обновление unreadCount, broadcast по WebSocket. Возвращает `{ conversationId, messageId, isNew }`.
  - **`processIncomingMessageFull(tenantId, parsed)`** — вызывает `handleIncomingMessage`, затем `triggerAiSuggestion(conversationId)`.
  - **`triggerAiSuggestion(conversationId)`** — загрузка диалога, тенанта, последнего сообщения клиента; RAG (docs + products); память клиента; вызов **Decision Engine** `generateWithDecisionEngine(...)`; создание записи AI suggestion в БД; broadcast новой подсказки; инкремент frequent_topics; при необходимости — генерация саммари; при AUTO_SEND — лог. Точка, где **всегда** вызывается генерация подсказки и классификация интента (внутри Decision Engine).

Итог по п.1: для **Personal**-каналов входящие входят через адаптеры (Telegram/WhatsApp в Node, MAX — через POST `/api/max-personal/incoming`), далее везде сходятся в **`inbound-message-handler.ts`** (`processIncomingMessageFull` → `handleIncomingMessage` + `triggerAiSuggestion`).

---

## 2) AI suggestion generation и intent classification

- **`server/routes.ts`** — `POST /api/conversations/:id/generate-suggestion` — ручной запрос подсказки из UI: загрузка диалога, последнего сообщения клиента, RAG (docs + products), история; вызов **`generateWithDecisionEngine`** из `./services/decision-engine`; сохранение подсказки в БД (включая intent, decision, confidence и т.д.); аудит.
- **`server/services/inbound-message-handler.ts`** — функция **`triggerAiSuggestion(conversationId)`**: вызывается после сохранения входящего сообщения; собирает контекст (conversation, tenant, last customer message, RAG, customerMemory); вызывает **`generateWithDecisionEngine`** из `./services/decision-engine`; создаёт запись в `ai_suggestions` (intent, confidence, decision, explanations, penalties, autosendEligible и т.д.); при необходимости триггерит customer summary.

Генерация текста ответа и классификация интента выполняются **внутри** Decision Engine.

- **`server/services/decision-engine.ts`** — основной сервис: **`generateWithDecisionEngine(context)`** — RAG-контекст, few-shot, промпт, вызов OpenAI (chat completions); парсинг ответа (reply + intent + confidence breakdown + self-check); решение AUTO_SEND / NEED_APPROVAL / ESCALATE по порогам и правилам; тройная блокировка для autosend; возврат `SuggestionResponse` (replyText, intent, confidence, decision, needsApproval, needsHandoff, usedSources, explanations, penalties, autosendEligible, autosendBlockReason, selfCheckNeedHandoff, selfCheckReasons). Intent classification зашита в промпт/парсинг ответа модели здесь же.
- **`server/services/rag-retrieval.ts`** — используется Decision Engine для `retrieveContext`, `formatContextForPrompt` (источники для подсказки).
- **`server/services/few-shot-builder.ts`** — выбор примеров по интенту, сборка блока few-shot для промпта (используется в Decision Engine).

Итог по п.2: вызов генерации подсказки и интента — **`routes.ts`** (ручной generate-suggestion) и **`inbound-message-handler.ts`** (triggerAiSuggestion); логика генерации и интента — **`server/services/decision-engine.ts`**; RAG и few-shot — **`rag-retrieval.ts`**, **`few-shot-builder.ts`**.

---

## 3) Decision Engine (AUTO_SEND / NEED_APPROVAL / ESCALATE), как подключается

- **`server/services/decision-engine.ts`** — единственное место реализации:
  - Пороги `tAuto`, `tEscalate`, настройки `autosendAllowed`, `intentsAutosendAllowed`, `intentsForceHandoff`.
  - Функции принятия решения и проверки autosend eligibility (в т.ч. экспорт для тестов `_testing`).
  - **`generateWithDecisionEngine(context)`** — полный пайплайн: генерация ответа, интент, confidence, self-check, решение (AUTO_SEND / NEED_APPROVAL / ESCALATE), тройная блокировка для autosend.
- Подключение:
  - **`server/services/inbound-message-handler.ts`** — в `triggerAiSuggestion` динамический импорт `generateWithDecisionEngine` и вызов после сохранения входящего сообщения.
  - **`server/routes.ts`** — в обработчике `POST /api/conversations/:id/generate-suggestion` динамический импорт `generateWithDecisionEngine` и вызов.
- Настройки Decision Engine по тенанту хранятся в БД (таблица **decision_settings**), читаются в decision-engine (через storage или передачу контекста). Схема и типы — **`shared/schema.ts`** (decisionSettings, DecisionSettings).
- Feature flags: **`server/services/feature-flags.ts`** — флаги DECISION_ENGINE_ENABLED, AI_AUTOSEND_ENABLED используются в decision-engine для kill-switch и разрешения автоотправки.

Итог по п.3: Decision Engine живёт в **`server/services/decision-engine.ts`**; подключается только из **`inbound-message-handler.ts`** (авто при входящем) и **`routes.ts`** (ручная кнопка generate-suggestion). Настройки — БД (decision_settings) + feature flags.

---

## 4) Conversation / customer metadata: Drizzle schema и сервисы

### Схема (Drizzle)
- **`shared/schema.ts`**:
  - **customers** — id, tenantId, channelId, channel, externalId, name, phone, email, tags, **metadata** (jsonb), createdAt, updatedAt.
  - **conversations** — id, tenantId, customerId, channelId, status, mode, lastMessageAt, unreadCount, createdAt (отдельного поля metadata нет; контекст — связь с customer и messages).
  - **messages** — id, conversationId, role, content, attachments, **metadata** (jsonb), createdAt.
  - **customer_memory** — tenantId, customerId, preferences (jsonb), frequentTopics (jsonb), lastSummaryText, updatedAt.
  - **customer_notes** — заметки оператора по клиенту.
  - Типы/экспорты: Customer, Conversation, Message, ConversationWithCustomer, ConversationDetail и др.

### Хранение и доступ (сервисы)
- **`server/storage.ts`** — интерфейс **IStorage**: методы для tenants, channels, users, customers (getCustomer, getCustomerByExternalId, createCustomer, updateCustomer, getCustomerMemory, …), conversations (getConversation, getConversationWithCustomer, getConversationDetail, getConversationsByTenant, createConversation, updateConversation), messages (createMessage, getMessagesByConversation), и остальные сущности. В конце файла — экспорт синглтона **`storage`**.
- **`server/database-storage.ts`** — класс **DatabaseStorage** реализует IStorage поверх Drizzle/PostgreSQL; используется как реализация: `export const storage = new DatabaseStorage()` в **`server/storage.ts`**.

Итог по п.4: схема сущностей и metadata (customers.metadata, messages.metadata и т.д.) — **`shared/schema.ts`**; API доступа к данным — **`server/storage.ts`** (интерфейс + экспорт storage); реализация — **`server/database-storage.ts`**.

---

## 5) Интеграции / внешние сервисы, как добавлять новый tool/service

### Каналы (адаптеры мессенджеров)
- **`server/services/channel-adapter.ts`**:
  - Интерфейс **ChannelAdapter** (name, sendMessage, parseIncomingMessage, опционально sendTypingStart/Stop, verifyWebhook).
  - **ChannelRegistry** — регистрация адаптеров по имени канала; **CHANNEL_FLAG_MAP** — привязка типа канала к feature flag.
  - **processInboundMessage(channelType, rawPayload, tenantId?)** — получение адаптера по channelType, парсинг, возврат ParsedIncomingMessage (используется вебхуком MAX бота; для Personal каналов не используется как точка сохранения — они идут через processIncomingMessageFull).
  - **processOutboundMessage(...)** — отправка через адаптер (sendMessage, опционально typing).
  - В конце файла регистрируются адаптеры: MockChannelAdapter, TelegramAdapter, whatsappAdapter, MaxAdapter, **WhatsAppPersonalAdapter**. **Telegram Personal** не регистрируется как ChannelAdapter в registry (он работает через telegram-client-manager и напрямую вызывает processIncomingMessageFull). **MAX Personal** вызывается из routes и max-personal-adapter по tenantId, а не через registry по channelType для входящих.
- Добавление нового канала: реализовать класс с интерфейсом **ChannelAdapter**; при необходимости добавить тип в **shared/schema.ts** (CHANNEL_TYPES) и флаг в **feature-flags** и CHANNEL_FLAG_MAP; зарегистрировать в **channel-adapter.ts**; для входящих либо вебхук → processInboundMessage + вызов handleIncomingMessage/processIncomingMessageFull, либо свой менеджер (как Telegram/WhatsApp Personal) с вызовом **processIncomingMessageFull**.

### Внешние HTTP-сервисы (пример — MAX Personal Python)
- **`server/services/max-personal-adapter.ts`** — клиент к Python-сервису: **MAX_SERVICE_URL** (по умолчанию `http://localhost:8100`); методы вызывают `fetch(MAX_SERVICE_URL/start-auth|check-auth|send-message|logout|status|...)`. Добавление нового внешнего сервиса по аналогии: свой адаптер/клиент с base URL из env и вызовами fetch; при необходимости новый роут в **routes.ts** (например внутренний endpoint для входящих от этого сервиса).

### Feature flags для каналов и AI
- **`server/services/feature-flags.ts`** — конфиг флагов (в т.ч. TELEGRAM_PERSONAL_CHANNEL_ENABLED, WHATSAPP_PERSONAL_CHANNEL_ENABLED, MAX_PERSONAL_CHANNEL_ENABLED, DECISION_ENGINE_ENABLED, AI_AUTOSEND_ENABLED и др.); при добавлении нового канала/поведения — добавить флаг и учесть в CHANNEL_FLAG_MAP или в логике Decision Engine.

Итог по п.5: каналы и их контракт — **`server/services/channel-adapter.ts`** (интерфейс + registry + processInbound/Outbound); новый канал — новый адаптер, регистрация, при необходимости новый тип в schema и feature flag; внешние HTTP-сервисы — отдельные адаптеры/клиенты (как **max-personal-adapter.ts**) и при необходимости роуты в **routes.ts**.

---

## 6) MAX Python Playwright сервис (FastAPI), как Node его вызывает

### Где лежит Python-сервис
- **`max_personal_service.py`** (корень репозитория) — FastAPI-приложение: SESSIONS_DIR, NODE_BACKEND_URL (env, по умолчанию `http://localhost:5000`), INTERNAL_SECRET (MAX_INTERNAL_SECRET или SESSION_SECRET); эндпоинты start-auth, send-message, check-status, logout и др.; при входящем сообщении из Max вызывается **forward_message_to_node** — POST на **`{NODE_BACKEND_URL}/api/max-personal/incoming`** с телом `{ tenant_id, message }` и заголовком (в коде Python передаётся секрет для проверки на Node). Запуск: uvicorn (порт 8100 по умолчанию).

### Как Node запускает и вызывает Python
- **`server/index.ts`** — функция **startMaxPersonalService()**: проверка наличия `./max_personal_service.py`, spawn `python3` с этим скриптом, в env передаётся **NODE_BACKEND_URL: `http://localhost:${PORT || 5000}`**. При старте сервера Node при необходимости запускает Python-процесс; общение обратное — Python шлёт входящие сообщения на Node.
- **`server/routes.ts`** — **POST /api/max-personal/incoming** — принимает запросы от Python: проверка заголовка **x-internal-secret** (ожидается MAX_INTERNAL_SECRET или SESSION_SECRET); валидация tenant_id и наличия активной сессии MAX Personal; **MaxPersonalAdapter.parseIncomingMessage(message)**; **processIncomingMessageFull(tenant_id, parsed)**.
- **`server/services/max-personal-adapter.ts`** — Node как **клиент** Python: **MAX_SERVICE_URL** = `process.env.MAX_SERVICE_URL || "http://localhost:8100"`; вызовы **fetch(MAX_SERVICE_URL/start-auth|send-message|check-auth|logout|status|...)** для авторизации, отправки сообщений, статуса. Исходящие из Node в MAX идут через этот адаптер; входящие из MAX в Node идут с Python на **/api/max-personal/incoming**.

Итог по п.6: Python-сервис — **`max_personal_service.py`** (корень); Node запускает его из **`server/index.ts`** (startMaxPersonalService), передаёт NODE_BACKEND_URL; Node принимает входящие от Python в **`server/routes.ts`** (POST /api/max-personal/incoming); Node вызывает Python по HTTP в **`server/services/max-personal-adapter.ts`** (MAX_SERVICE_URL, fetch к эндпоинтам FastAPI).

---

## 7) Поиск запчастей — Podzamenu Lookup (VIN/FRAME → КПП → OEM → Цены)

Полностью реализованная подсистема поиска запчастей по VIN/FRAME коду через парсинг podzamenu.ru и prof-rf (для китайских авто). Включает кэширование результатов, кейсы поиска и автоматический поиск цен по OEM.

### Архитектура и поток данных

```
API запрос                    BullMQ очередь               Python Playwright
POST /api/conversations/      vehicle_lookup_queue          podzamenu_lookup_service.py
  :id/vehicle-lookup-case  →  (Redis, concurrency: 1)   →  POST /lookup
                                    ↓                            ↓
                              vehicle-lookup.worker.ts      Браузер → podzamenu.ru / prof-rf
                                    ↓                            ↓
                              Кэш + Case + Suggestion       Парсинг КПП, OEM, модель
                                    ↓
                              (если confidence ≥ 0.85 и OEM найден)
                                    ↓
                              price_lookup_queue → price-lookup.worker.ts → price_snapshots
```

### 7.1) Python-сервис парсинга: `podzamenu_lookup_service.py`

- **Расположение:** корень репозитория
- **Фреймворк:** FastAPI, порт 8200 (env `PODZAMENU_LOOKUP_SERVICE_URL`)
- **Браузер:** Playwright Chromium, semaphore (макс. 2 параллельных lookup'а)

**Endpoint:** `POST /lookup`
- Вход: `{ idType: "VIN" | "FRAME", value: string }`
- Выход: `{ vehicleMeta, gearbox, evidence }` — модель КПП, OEM-коды, статус, источник
- Ошибки: 400 (невалидный ввод), 404 (NOT_FOUND), 500 (ошибка парсинга)

**Стратегия выбора источника** (`SOURCE_STRATEGY` env):
- `"auto"` (по умолчанию): VIN → сначала podzamenu.ru, при неудаче → prof-rf; FRAME → только podzamenu
- `"podzamenu"`: только podzamenu.ru
- `"prof_rf"`: только prof-rf (китайские VIN)

**Логика парсинга podzamenu.ru:**
1. Переход на страницу поиска с VIN/FRAME
2. Ожидание результатов
3. Извлечение модели КПП из HTML (несколько стратегий)
4. Клик на ссылку «Коробка передач» / «КПП»
5. Парсинг таблицы OEM (фильтрация по include/exclude паттернам)
6. Возврат структурированного результата с OEM-кандидатами

**Логика парсинга prof-rf:**
1. Переход на страницу поиска
2. Извлечение OEM из заголовков типа «Коробка передач 3043001600»
3. Парсинг блоков: Оригинал, Аналоги, Копии
4. Фильтрация и приоритизация OEM-кандидатов

### 7.2) Node HTTP-клиент: `server/services/podzamenu-lookup-client.ts`

- **`lookupByVehicleId(request)`** — HTTP POST к `PODZAMENU_LOOKUP_SERVICE_URL/lookup`
- Таймаут: 30 секунд
- Обработка ошибок: NOT_FOUND (404), таймауты, невалидные ответы
- Возвращает `LookupResponse` с `vehicleMeta`, `gearbox`, `evidence`

### 7.3) Очередь и воркеры

**Очередь vehicle lookup:** `server/services/vehicle-lookup-queue.ts`
- Queue name: `vehicle_lookup_queue` (BullMQ + Redis)
- 3 попытки с экспоненциальной задержкой (1 с)
- Хранение: 100 выполненных, 50 проваленных
- Job data: `{ caseId, tenantId, conversationId, idType, normalizedValue }`

**Worker vehicle lookup:** `server/workers/vehicle-lookup.worker.ts`
- Concurrency: 1 (последовательная обработка)
- Алгоритм:
  1. Обновляет case status → `RUNNING`
  2. Вызывает `lookupByVehicleId()` через HTTP-клиент
  3. Вычисляет confidence (0–1):
     - База: 0.5
     - +0.3 если OEM найден
     - +0.1 если источник podzamenu
     - +0.1 если есть OEM-кандидаты
     - −0.2 если OEM status = NOT_AVAILABLE
     - −0.2 если только модель (без OEM)
  4. Сохраняет результат в `vehicle_lookup_cache`
  5. Связывает case с кэшем
  6. Обновляет case status → `COMPLETED` или `FAILED`
  7. Создаёт AI suggestion с результатом (используя шаблоны тенанта: gearboxLookupFound, gearboxLookupModelOnly, gearboxTagRequest)
  8. Broadcast через WebSocket
  9. **Авто-триггер поиска цен:** если confidence ≥ 0.85 и OEM найден → ставит задачу в `price_lookup_queue`
- Защита от дублей: не создаёт suggestion если такой уже есть за последние 2 минуты

**Очередь price lookup:** `server/services/price-lookup-queue.ts`
- Queue name: `price_lookup_queue` (BullMQ + Redis)
- 3 попытки с экспоненциальной задержкой
- Удаляет завершённые задачи (`removeOnComplete: true`)

**Worker price lookup:** `server/workers/price-lookup.worker.ts`
- Concurrency: 1
- Алгоритм:
  1. Проверяет кэш (макс. возраст: 60 минут)
  2. Если в кэше → использует кэшированные цены
  3. Если нет → mock-цены (1000–1500 ₽, средняя 1200)
  4. Создаёт `price_snapshot` в БД
  5. Генерирует suggestion: «Найдены ориентировочные цены по OEM {oem}: {min}–{max} (средняя {avg}). Обновлено: {время}. Источник: {source}.»
  6. Broadcast через WebSocket

### 7.4) API endpoint

**`POST /api/conversations/:id/vehicle-lookup-case`** — `server/routes.ts`
- Auth: requireAuth + MANAGE_CONVERSATIONS
- Body: `{ idType: "VIN" | "FRAME", value: string }`
- Валидация и нормализация VIN/FRAME
- Создаёт `vehicle_lookup_case` (status: `PENDING`)
- Ставит задачу в `vehicle_lookup_queue`
- Возвращает: `{ caseId: string }`

### 7.5) Схема БД (Drizzle) — `shared/schema.ts`

**Таблица `vehicle_lookup_cache`:**
| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID PK | |
| lookupKey | text, unique | Нормализованный ключ (VIN/FRAME) |
| idType | text | "VIN" / "FRAME" |
| rawValue | text | Оригинальный ввод |
| normalizedValue | text, indexed | Нормализованное значение |
| result | jsonb | Полный результат с confidence |
| source | text | "podzamenu" / "prof_rf" |
| expiresAt | timestamp | Срок годности кэша |
| createdAt, updatedAt | timestamp | |

**Таблица `vehicle_lookup_cases`:**
| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID PK | |
| tenantId | FK → tenants | |
| conversationId | FK → conversations | |
| messageId | FK → messages (опц.) | |
| idType | text | "VIN" / "FRAME" |
| rawValue, normalizedValue | text | |
| status | text | PENDING / RUNNING / COMPLETED / FAILED |
| verificationStatus | text | NEED_TAG_OPTIONAL / UNVERIFIED_OEM / VERIFIED_MATCH / MISMATCH / NONE |
| cacheId | FK → cache (опц.) | Ссылка на кэш |
| error | text (опц.) | Текст ошибки |
| createdAt, updatedAt | timestamp | |
| Индексы | | (tenantId, conversationId), status, normalizedValue |

**Таблица `price_snapshots`:**
| Поле | Тип | Описание |
|------|-----|----------|
| id | UUID PK | |
| tenantId | FK → tenants | |
| oem | text | OEM-код |
| source | text | "mock" (в будущем: avito, exist) |
| currency | text | По умолчанию "RUB" |
| minPrice, maxPrice, avgPrice | integer | Цены в валюте |
| raw | jsonb | Сырые данные |
| createdAt | timestamp | |
| Индексы | | (tenantId, oem, createdAt), (oem, createdAt) |

### 7.6) Storage-методы — `server/database-storage.ts`

**Кэш:**
- `getVehicleLookupCacheByKey(lookupKey)` — получить запись из кэша
- `upsertVehicleLookupCache(data)` — вставить/обновить (конфликт по lookupKey)
- `linkCaseToCache(caseId, cacheId)` — связать кейс с записью кэша

**Кейсы:**
- `createVehicleLookupCase(data)` — создать кейс
- `getVehicleLookupCaseById(caseId)` — получить по ID
- `getLatestVehicleLookupCaseByConversation(tenantId, conversationId)` — последний кейс в диалоге
- `findActiveVehicleLookupCase(tenantId, conversationId, normalizedValue)` — найти активный кейс за 5 минут
- `updateVehicleLookupCaseStatus(caseId, patch)` — обновить status, verificationStatus, error, cacheId

**Цены:**
- `createPriceSnapshot(data)` — создать снимок цен
- `getLatestPriceSnapshot(tenantId, oem, maxAgeMinutes)` — получить из кэша (если не старше N минут)

### 7.7) Статус реализации

| Компонент | Статус |
|-----------|--------|
| Парсинг podzamenu.ru (Playwright) | ✅ Реализован |
| Парсинг prof-rf (китайские VIN) | ✅ Реализован |
| Очередь vehicle lookup (BullMQ) | ✅ Реализован |
| Кэширование результатов | ✅ Реализован |
| Кейсы поиска по диалогам | ✅ Реализован |
| AI-suggestions с результатом | ✅ Реализован |
| Автоматический поиск цен по OEM | ✅ Реализован (mock-данные) |
| Price snapshots | ✅ Реализован |
| Реальные источники цен (Avito, Exist) | ❌ Не реализован (mock) |
| API для чтения кейсов/кэша | ❌ Нет GET endpoints |
| Очистка просроченного кэша | ❌ Не реализован |
| Ручное обновление verificationStatus | ❌ Не реализован |

Итог по п.7: Подсистема поиска запчастей работает end-to-end: API → BullMQ → Worker → Python Playwright-сервис → Кэш → AI Suggestions. Python-сервис — **`podzamenu_lookup_service.py`** (порт 8200); Node HTTP-клиент — **`server/services/podzamenu-lookup-client.ts`**; очереди — **`vehicle-lookup-queue.ts`** и **`price-lookup-queue.ts`**; воркеры — **`server/workers/vehicle-lookup.worker.ts`** и **`price-lookup.worker.ts`**; схема — **`shared/schema.ts`** (vehicle_lookup_cache, vehicle_lookup_cases, price_snapshots); storage — **`server/database-storage.ts`**; API — **`server/routes.ts`** (POST /api/conversations/:id/vehicle-lookup-case).