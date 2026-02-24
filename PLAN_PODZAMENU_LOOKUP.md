# План интеграции: Podzamenu Lookup (VIN/FRAME) через Playwright

Минимальный план без кода: архитектура, файлы, порядок шагов.

---

## 1) Рекомендуемая архитектура

### Кто вызывает lookup
- **Инициатор:** API endpoint (например `POST /api/lookup/vin` или внутренний вызов из сервиса по правилу «сообщение содержит VIN»). Вызов не блокирует ответ: ставит задачу в очередь и возвращает `caseId` / `conversationId`.
- **Исполнитель:** отдельный **BullMQ Worker** (Node), который обрабатывает очередь lookup-задач. Worker дергает **Playwright-сервис** по HTTP (аналогично MAX Personal: отдельный Python/FastAPI процесс с Playwright) либо встроенный в Node вызов Playwright (через `playwright` npm или child process к скрипту). Рекомендация: **отдельный Python/FastAPI сервис с Playwright** (как `max_personal_service.py`) и Node Worker только ставит задачу и вызывает этот сервис по HTTP — так изоляция браузера и перезапуск не трогают основной процесс.
- **Альтернатива без Python:** один Node Worker с очередью BullMQ сам запускает Playwright (через `playwright` в Node); тогда отдельный процесс не нужен, но браузер живёт в процессе воркера.

Итого: **Backend Node** — API + очередь BullMQ; **исполнитель** — либо Node Worker → HTTP к Playwright-сервису (Python), либо Node Worker с Playwright напрямую.

### Кэш
- **Отдельная таблица** в PostgreSQL (Drizzle): кэш по ключу lookup (нормализованный VIN/FRAME), результат (jsonb), TTL (`expires_at`). Так можно делать единый кэш на всех тенантов, инвалидировать по времени и не засорять conversation metadata.

### Статус кейса
- **Отдельная таблица** «lookup case» (или «vin_lookup_case»): привязка к `conversationId` (и опционально `messageId`), идентификатор запроса (VIN/FRAME, опционально tag), статус (pending / running / completed / failed), ссылка на кэш (id записи кэша или snapshot результата), таймстампы. Так можно фильтровать диалоги по статусу lookup и не расширять схему `conversations` (сейчас у conversations нет поля metadata). Если позже понадобится «быстрый доступ со стороны диалога» — в `conversations` можно добавить `metadata` jsonb и дублировать туда только последний caseId для текущего диалога; минимально достаточно отдельной таблицы.

### Rate limit
- **BullMQ + Redis:** одна очередь для lookup-задач, у Worker'а **concurrency: 1** (или 2), чтобы не открывать много браузеров одновременно — это и есть глобальный rate на исполнение.
- **Дополнительно:** лимит «N запросов на тенанта в минуту» — либо middleware на API (как уже есть `aiRateLimiter`, `tenantAiLimiter` в `server/middleware/rate-limiter.ts`), либо проверка в сервисе перед `queue.add()`, считая по Redis (ключ типа `lookup:tenant:{tenantId}:minute` с TTL 60s) или по БД (число записей case за последнюю минуту по tenantId). Существующий rate-limiter в проекте — in-memory Map в `server/middleware/rate-limiter.ts`; для кросс-процессного лимита по тенанту нужен Redis или БД.

Итого по rate: **очередь BullMQ с concurrency 1–2** уже ограничивает параллельные lookup'ы; при необходимости добавить **per-tenant limit** через Redis или БД в месте постановки задачи.

---

## 2) Точные файлы для изменений/добавления

### Схема и миграции
| Действие | Путь |
|----------|------|
| Таблица кэша (VIN/FRAME → результат, TTL) | **`shared/schema.ts`** — новая таблица, например `vinLookupCache` или `podzamenuLookupCache` (id, tenantId или global, key нормализованный, result jsonb, expiresAt). |
| Таблица статуса кейса | **`shared/schema.ts`** — новая таблица, например `vinLookupCase` или `podzamenuLookupCase` (id, conversationId, messageId опционально, tenantId, vin/frame, tag опционально, status, cacheId или resultSnapshot, createdAt, updatedAt, error опционально). |
| Миграция БД | **`migrations/`** — новый файл миграции (SQL или Drizzle push), например `XXXX_add_vin_lookup_tables.sql` или через `drizzle-kit generate` после правок schema. |

### Storage
| Действие | Путь |
|----------|------|
| Интерфейс IStorage | **`server/storage.ts`** — методы для кэша (get/set/delete по ключу или id, invalidation по TTL) и для case (create, getById, getByConversation, updateStatus). |
| Реализация | **`server/database-storage.ts`** — реализация этих методов через Drizzle. |

### Очередь и Worker (BullMQ)
| Действие | Путь |
|----------|------|
| Очередь lookup (типы, создание очереди, add job) | **`server/services/lookup-queue.ts`** (новый) — аналог `message-queue.ts`: getRedisConnectionConfig переиспользовать из `server/services/message-queue.ts` или вынести в общий `server/services/redis-connection.ts`; своя Queue с именем типа `vin_lookup_queue`, JobData (conversationId, messageId?, tenantId, vin, frame?, tag?, caseId). |
| Worker обработки lookup | **`server/workers/vin-lookup.worker.ts`** (новый) — аналог `message-send.worker.ts`: Worker с concurrency 1 (или 2), в процессе job — вызов Playwright-сервиса по HTTP (или локальный Playwright); по успеху — запись в кэш, обновление case status; при ошибке — retry и обновление case в failed. |
| Запуск Worker в PM2 | **`ecosystem.config.cjs`** — добавить второй app (worker) с entry point в скомпилированный worker (например `dist/workers/vin-lookup.worker.cjs` или через tsx в dev). Либо отдельный скрипт в `package.json` для запуска воркера. |

### Playwright-сервис (внешний по отношению к основному приложению)
| Действие | Путь |
|----------|------|
| Сервис на Python (предпочтительно) | **`podzamenu_lookup_service.py`** (корень репозитория или отдельная папка, например `services/podzamenu-lookup/`) — FastAPI, один endpoint типа `POST /lookup` (body: vin, frame?, tag?); внутри — Playwright, переход на podzamenu, ввод VIN/FRAME, опционально проверка тега, парсинг результата; ответ — JSON. Node Worker вызывает этот endpoint по HTTP (localhost или env URL). |
| Или Node + Playwright | Если не использовать Python: логику браузера держать в **`server/services/podzamenu-lookup-runner.ts`** (новый) и вызывать её только из Worker'а; зависимость `playwright` в package.json. |

### API и интеграция в флоу
| Действие | Путь |
|----------|------|
| API постановки lookup в очередь | **`server/routes.ts`** — новый route, например `POST /api/conversations/:id/lookup-vin` (или `/api/lookup/vin`) с body { vin, frame?, tag? }; проверка прав (requireAuth, requirePermission на MANAGE_CONVERSATIONS или отдельное право); создание записи case (pending), добавление job в lookup-queue, возврат caseId. Либо вызов постановки в очередь из **`server/services/inbound-message-handler.ts`** по правилу «последнее сообщение — VIN/запрос по VIN» (тогда создание case и add job там). |
| Чтение статуса / результата | **`server/routes.ts`** — например `GET /api/conversations/:id/lookup-status` или `GET /api/lookup/cases/:caseId` — возврат статуса и при completed — результат из кэша или из case. |

### Rate limit (per-tenant)
| Действие | Путь |
|----------|------|
| Лимит запросов lookup на тенанта | Вариант A: **`server/middleware/rate-limiter.ts`** — новый лимитер по категории `lookup` (как `ai`, `conversation`) и вешать на route постановки lookup. Вариант B: в **`server/services/lookup-queue.ts`** перед `queue.add()` — проверка через Redis (ключ + TTL) или через storage (подсчёт case за последнюю минуту по tenantId); при превышении — 429 или отказ в постановке. |

### Конфиг и env
| Действие | Путь |
|----------|------|
| URL Playwright-сервиса, лимиты | **`.env.example`** и **`server/config.ts`** (если есть централизованная валидация) — переменные типа `PODZAMENU_LOOKUP_SERVICE_URL`, `VIN_LOOKUP_RATE_PER_TENANT_PER_MIN`. |

---

## 3) Порядок шагов 1..N

1. **Схема** — В **`shared/schema.ts`** добавить таблицы кэша (vinLookupCache или аналог) и кейса (vinLookupCase). Экспортировать типы (Insert*, Select*).
2. **Миграция** — Создать миграцию в **`migrations/`** и применить (drizzle-kit push или SQL).
3. **Storage** — В **`server/storage.ts`** добавить в IStorage методы для кэша и case; в **`server/database-storage.ts`** реализовать их.
4. **Redis/очередь** — В **`server/services/lookup-queue.ts`** (новый файл) определить JobData, получить конфиг Redis (из message-queue или общий модуль), создать Queue с именем `vin_lookup_queue`, функцию `enqueueVinLookup(data)` (создаёт case в БД со статусом pending, добавляет job, возвращает caseId).
5. **Worker** — Создать **`server/workers/vin-lookup.worker.ts`**: Worker с concurrency 1, в handler — вызов Playwright-сервиса по HTTP (или вызов runner'а на Node); обновление case (running → completed/failed), запись в кэш при успехе; при ошибке — обновление case, retry по настройкам BullMQ.
6. **Playwright-сервис** — Реализовать **`podzamenu_lookup_service.py`** (или Node runner в `server/services/podzamenu-lookup-runner.ts`): один endpoint lookup по VIN/FRAME (+ tag), логика браузера, возврат структурированного результата.
7. **API** — В **`server/routes.ts`** добавить POST для постановки lookup (создание case, enqueueVinLookup, возврат caseId) и GET для статуса/результата; при необходимости middleware rate limit для lookup.
8. **Rate limit** — Либо новый лимитер в **`server/middleware/rate-limiter.ts`** для категории lookup и назначение на route, либо проверка в **lookup-queue.ts** перед add (Redis/БД по tenantId).
9. **Запуск Worker** — Настроить **`package.json`** (скрипт типа `worker:lookup`) и при необходимости **`ecosystem.config.cjs`** для второго процесса (vin-lookup worker).
10. **Опционально: авто-триггер по сообщению** — В **`server/services/inbound-message-handler.ts`** после сохранения сообщения (или в **decision-engine** по контенту) правило «если в сообщении распознан VIN/запрос по VIN» — создание case и вызов enqueueVinLookup без отдельного запроса с фронта.

После шага 10 интеграция с текущим флоу (входящее сообщение → диалог → при необходимости lookup → статус/результат в том же диалоге) замыкается; UI для отображения статуса и результата — отдельно на фронте по существующим эндпоинтам.
