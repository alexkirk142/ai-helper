# Database Schema — AI Sales Operator

> Источник истины: `shared/schema.ts` (~1554 строк). Актуально на май 2026.
> Инструмент миграций: Drizzle Kit. Папка: `migrations/` (0000–0023).

---

## Обзор: 49 таблиц

### Группировка по доменам

| Домен | Таблицы |
|-------|---------|
| **Tenant & Users** | `tenants`, `channels`, `users`, `user_invites`, `admin_actions`, `email_tokens` |
| **Customers & Messaging** | `customers`, `customer_notes`, `customer_memory`, `conversations`, `messages` |
| **Products & Knowledge** | `products`, `knowledge_docs`, `knowledge_doc_chunks` |
| **RAG** | `rag_documents`, `rag_chunks` |
| **AI** | `ai_suggestions`, `human_actions`, `ai_training_samples`, `ai_training_policies`, `learning_queue` |
| **Settings** | `escalation_events`, `response_templates`, `decision_settings`, `human_delay_settings` |
| **Onboarding** | `onboarding_state`, `readiness_reports` |
| **Analytics** | `csat_ratings`, `conversions`, `lost_deals` |
| **Billing** | `plans`, `subscriptions`, `subscription_grants` |
| **Security** | `channel_fingerprints`, `fraud_flags`, `integration_secrets` |
| **Infrastructure** | `feature_flags`, `audit_events`, `sessions`, `auth_users` |
| **Telegram** | `telegram_sessions` |
| **MAX Personal** | `max_personal_accounts` |
| **Auto Parts** | `vehicle_lookup_cache`, `vehicle_lookup_cases`, `price_snapshots`, `internal_prices`, `transmission_identity_cache` |
| **Tenant Config** | `message_templates`, `payment_methods`, `tenant_agent_settings` |
| **System** | `update_history`, `proxies` |

---

## Таблицы

### tenants

Корневая таблица мультитенантности. Каждый бизнес — один тенант.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | varchar PK | UUID |
| `name` | text NOT NULL | Название бизнеса |
| `language` | text | Язык (`ru`) |
| `tone` | text | Тональность (`formal`, `friendly`) |
| `address_style` | text | Обращение (`vy`, `ty`) |
| `currency` | text | Валюта (`RUB`) |
| `timezone` | text | Часовой пояс |
| `working_hours_start/end` | text | Рабочие часы (`HH:mm`) |
| `working_days` | text[] | Рабочие дни (`mon`…`sun`) |
| `auto_reply_outside_hours` | boolean | Автоответ вне часов |
| `escalation_email/telegram` | text | Куда слать эскалации |
| `escalation_chat_id` | text | Chat ID для Telegram-бота эскалаций |
| `allow_discounts` | boolean | Разрешены ли скидки |
| `max_discount_percent` | integer | Максимальный % скидки |
| `status` | text | `active`, `restricted` |
| `templates` | jsonb | Шаблоны текста (gearboxLookupFound и др.) |
| `template_gearbox/engine/tires_enabled` | boolean | Переключатели авто-шаблонов (Marquiz) |
| `created_at` | timestamp | — |

---

### channels

Конфигурации каналов связи для тенанта.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | varchar PK | UUID |
| `tenant_id` | varchar FK→tenants | — |
| `type` | text | `mock`, `telegram`, `telegram_personal`, `whatsapp`, `whatsapp_personal`, `max`, `max_personal` |
| `name` | text | Человекочитаемое имя |
| `config` | jsonb | API-ключи, webhook URL, sessionData |
| `is_active` | boolean | — |
| `created_at` | timestamp | — |

---

### users

Операторы и владельцы тенантов.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | varchar PK | UUID |
| `tenant_id` | varchar FK→tenants | null для platform staff |
| `username` | text UNIQUE | — |
| `password` | text | bcrypt hash |
| `role` | text | `owner`, `admin`, `operator`, `viewer`, `guest` |
| `email` | text | (case-insensitive unique index) |
| `email_verified_at` | timestamp | null = не верифицирован |
| `auth_provider` | text | `local`, `oidc`, `mixed` |
| `last_login_at` | timestamp | — |
| `failed_login_attempts` | integer | Счётчик неудачных попыток |
| `locked_until` | timestamp | Блокировка аккаунта |
| `is_platform_admin` | boolean | Суперадмин платформы |
| `is_platform_owner` | boolean | Владелец платформы |
| `is_disabled` | boolean | Отключён администратором |
| `created_at` | timestamp | — |

**Индексы:** `users_email_unique_lower_idx` (LOWER(email), WHERE NOT NULL)

---

### user_invites

Инвайты для новых членов команды.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `token_hash` | text UNIQUE | SHA-256 хэш токена (plaintext никогда не хранится) |
| `email` | text | Адресат инвайта |
| `role` | text | Роль при принятии |
| `expires_at` | timestamp | TTL 72 часа |
| `used_at` | timestamp | null = не использован |
| `email_status` | text | `pending`, `sent`, `failed` |

---

### email_tokens

Токены для верификации email и сброса пароля.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `token_hash` | text UNIQUE | SHA-256 хэш (plaintext не хранится) |
| `type` | text | `email_verification`, `password_reset` |
| `expires_at` | timestamp | — |
| `used_at` | timestamp | Одноразовый токен |

---

### customers

Клиенты (конечные пользователи, пишущие в мессенджеры).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `tenant_id` | varchar FK→tenants | — |
| `channel` | text | `whatsapp_personal`, `telegram`, `max`, etc. |
| `external_id` | text | Идентификатор на платформе канала |
| `name`, `phone`, `email` | text | Контактные данные |
| `tags` | jsonb | `string[]` — теги оператора |
| `metadata` | jsonb | Произвольные данные |

**Индексы:** UNIQUE `(tenant_id, channel, external_id)` — dedup при создании

---

### customer_memory

Долгосрочная память AI о клиенте.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `preferences` | jsonb | `{ city, delivery, payment }` |
| `frequent_topics` | jsonb | `{ intent → count }` |
| `last_summary_text` | text | Последний GPT-саммари клиента |

---

### conversations

Диалоги с клиентами.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `status` | text | `active`, `waiting_customer`, `waiting_operator`, `escalated`, `resolved` |
| `mode` | text | `learning`, `semi-auto`, `auto` |
| `is_muted` | boolean | — |
| `last_message_at` | timestamp | Для сортировки списка |
| `unread_count` | integer | Счётчик непрочитанных |

**State machine переходы:** active ↔ waiting_customer, waiting_operator → escalated → resolved → active

---

### messages

Сообщения в диалогах.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `role` | text | `customer`, `assistant`, `owner` |
| `content` | text | Текст сообщения |
| `attachments` | jsonb | `[{type, url, name}]` |
| `metadata` | jsonb | Произвольные данные (externalId и т.д.) |

---

### products

Каталог товаров тенанта.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `sku` | text | Артикул |
| `name` | text | Название |
| `description` | text | Описание (используется в RAG) |
| `price` | real | Цена |
| `category` | text | Категория |
| `in_stock` | boolean | Наличие |
| `stock_quantity` | integer | Количество |
| `variants` | jsonb | Варианты товара |
| `images` | text[] | URLs изображений |
| `delivery_info` | text | Информация о доставке |

---

### knowledge_docs

Документы базы знаний (FAQ, политики, доставка, возврат).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `title` | text | Заголовок |
| `content` | text | Полный текст (Markdown) |
| `category` | text | `faq`, `policy`, `shipping`, `returns`, `general` |
| `doc_type` | text | `policy`, `faq`, `delivery`, `returns` |
| `tags` | text[] | — |
| `is_active` | boolean | — |

---

### rag_documents + rag_chunks

Единый RAG-индекс (продукты + документы KB).

**rag_documents** — реестр источников для RAG:

| Колонка | Тип | Описание |
|---------|-----|----------|
| `type` | text | `PRODUCT` или `DOC` |
| `source_id` | varchar | productId или knowledgeDocId |
| `content` | text | Контент для индексации |
| `metadata` | jsonb | `{ category, sku, tags }` |

**rag_chunks** — чанки с эмбеддингами:

| Колонка | Тип | Описание |
|---------|-----|----------|
| `rag_document_id` | varchar FK→rag_documents | — |
| `chunk_text` | text | Текст чанка |
| `chunk_index` | integer | Порядковый номер в документе |
| `token_count` | integer | — |
| `embedding` | text | **JSON-сериализованный float[] (1536 dims)**. `NULL` = ещё не проиндексирован. ⚠️ Хранится как TEXT, не как vector — это ограничение производительности. |
| `metadata` | jsonb | `{ sourceType, sourceId, category, sku }` |

---

### ai_suggestions

AI-подсказки для операторов.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `suggested_reply` | text | Предложенный ответ |
| `intent` | text | Классифицированный интент |
| `confidence` | real | Итоговый confidence score (0–1) |
| `needs_approval` | boolean | — |
| `needs_handoff` | boolean | — |
| `status` | text | `pending`, `approved`, `edited`, `rejected` |
| `decision` | text | `AUTO_SEND`, `NEED_APPROVAL`, `ESCALATE` |
| `similarity_score` | real | RAG similarity |
| `intent_score` | real | Intent confidence |
| `self_check_score` | real | Self-check score |
| `autosend_eligible` | boolean | Прошла ли тройная блокировка |
| `autosend_block_reason` | text | `FLAG_OFF`, `SETTING_OFF`, `INTENT_NOT_ALLOWED` |
| `escalation_data` | jsonb | Данные для эскалации (readyQueries, suggestedSites) |
| `penalties` | jsonb | `[{code, message, value}]` |
| `used_sources` | jsonb | `[{type, id, title, quote, similarity}]` |

---

### decision_settings

Настройки Decision Engine для тенанта (PK = tenant_id).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `t_auto` | real | Порог для AUTO_SEND (default 0.80) |
| `t_escalate` | real | Порог для ESCALATE (default 0.40) |
| `autosend_allowed` | boolean | Lock 2 тройной блокировки |
| `intents_autosend_allowed` | jsonb | `string[]` — белый список интентов |
| `intents_force_handoff` | jsonb | `string[]` — чёрный список интентов |

---

### human_delay_settings

Настройки «человекоподобной» задержки для тенанта (PK = tenant_id).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `enabled` | boolean | — |
| `delay_profiles` | jsonb | SHORT/MEDIUM/LONG: `{baseMin, baseMax, typingSpeed, jitter}` |
| `night_mode` | text | `AUTO_REPLY`, `DELAY`, `DISABLE` |
| `night_delay_multiplier` | real | Множитель ночной задержки (default 3.0) |
| `min_delay_ms/max_delay_ms` | integer | 3000ms–120000ms |
| `typing_indicator_enabled` | boolean | — |

---

### telegram_sessions

MTProto-сессии для Telegram Personal (до 5 на тенант).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `phone_number` | text | — |
| `session_string` | text | gramjs StringSession |
| `status` | text | `pending`, `awaiting_code`, `awaiting_2fa`, `active`, `error`, `disconnected` |
| `auth_method` | text | `qr`, `phone` |
| `tg_role` | text | `resolver`, `sender`, `both` |
| `is_enabled` | boolean | — |

---

### subscriptions

Подписки тенантов (одна на тенант, UNIQUE).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `plan_id` | varchar FK→plans | — |
| `stripe_customer_id` | text | Для Stripe (необязательно) |
| `crypto_invoice_id` | text | CryptoBot invoice ID |
| `payment_provider` | text | `cryptobot`, `stripe` |
| `status` | text | `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `incomplete`, `paused`, `expired` |
| `current_period_start/end` | timestamp | Текущий период |
| `trial_started_at/ends_at` | timestamp | Период триала (72ч) |
| `had_trial` | boolean | Предотвращает повторный триал |
| `cancel_at_period_end` | boolean | Отмена в конце периода |

---

### subscription_grants

Ручная выдача доступа платформ-администратором.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `starts_at/ends_at` | timestamp | Период гранта |
| `granted_by_user_id` | varchar FK→users | Кто выдал |
| `reason` | text | — |
| `revoked_at` | timestamp | null = активен |

---

### integration_secrets

AES-256-GCM зашифрованные API-ключи.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `scope` | text | `global`, `tenant` |
| `tenant_id` | varchar FK | null для глобальных |
| `key_name` | text | Название секрета |
| `encrypted_value` | text | AES-256-GCM зашифровано |
| `encryption_meta` | jsonb | `{iv, authTag, keyVersion}` |
| `last_4` | text | Последние 4 символа для UI |
| `revoked_at` | timestamp | null = активен |

---

### audit_events

Полный audit trail (25+ типов действий).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `actor` | text | user_id, `system`, `ai` |
| `actor_type` | text | `user`, `system`, `ai` |
| `action` | text | Тип действия (см. AUDIT_ACTIONS в schema.ts) |
| `entity_type` | text | `conversation`, `suggestion`, `escalation`, etc. |
| `entity_id` | varchar | ID сущности |
| `request_id` | varchar | Для трейсинга |
| `ip_address/user_agent` | text | — |

**Типы действий:** `suggestion_generated`, `suggestion_approved`, `suggestion_edited`, `suggestion_rejected`, `message_sent`, `conversation_created`, `conversation_status_changed`, `escalation_resolved`, `product_created/updated/deleted`, `knowledge_doc_created/updated/deleted`, `tenant_updated`, `feature_flag_toggled`, `customer_data_deleted`, `webhook_verification_failed`, `rate_limit_exceeded`

---

### feature_flags

Feature flags с поддержкой per-tenant override.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `name` | text | Имя флага |
| `enabled` | boolean | — |
| `tenant_id` | varchar FK | null = глобальный флаг |

**Индексы:** partial UNIQUE на (name) WHERE tenant_id IS NULL + на (name, tenant_id) WHERE tenant_id IS NOT NULL

---

### proxies

Прокси-пул для каналов.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `host/port` | text/integer | — |
| `protocol` | text | `socks5`, `http`, `https` |
| `username/password` | text | Авторизация |
| `status` | text | `available`, `busy`, `error` |
| `assigned_tenant_id` | varchar FK | null = свободен |
| `assigned_channel_id` | varchar FK | null = свободен |

---

### vehicle_lookup_cache + vehicle_lookup_cases

VIN/FRAME lookup кэш и кейсы.

**vehicle_lookup_cache** — результаты парсинга:

| Колонка | Тип | Описание |
|---------|-----|----------|
| `lookup_key` | text UNIQUE | — |
| `id_type` | text | `VIN`, `FRAME` |
| `result` | jsonb | Результат (make, model, year, gearboxInfo, OEM) |
| `source` | text | `podzamenu`, `partsapi` |
| `expires_at` | timestamp | TTL |

---

### price_snapshots

Глобальный кэш цен на КПП (tenantId=null).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `oem` | text | OEM номер |
| `model_name` | text | Market model name |
| `min_price/max_price/avg_price` | integer | Цены в RUB |
| `listings_count` | integer | Количество объявлений |
| `stage` | text | `yandex`, `openai_web_search`, `ai_estimate`, `not_found` |
| `urls` | text[] | Проверенные URL |
| `expires_at` | timestamp | 7д (yandex) / 24ч (not_found) / 2ч (ai_estimate) |

---

### tenant_agent_settings

Настройки AI-агента для тенанта (PK = tenant_id).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `company_facts` | text | Факты о компании для system prompt |
| `company_scripts` | text | Скрипты продаж |
| `custom_system_prompt` | text | Кастомный system prompt |
| `autosend_allowed` | boolean | Разрешение autosend |
| `intents_autosend_allowed` | jsonb | `string[]` |
| `intents_force_handoff` | jsonb | `string[]` |

---

### message_templates

Шаблоны сообщений с переменными (`{{variable}}`).

| Колонка | Тип | Описание |
|---------|-----|----------|
| `type` | text | `price_result`, `price_options`, `payment_options`, `tag_request`, `not_found` |
| `content` | text | Шаблон с `{{variable}}` |
| `is_active` | boolean | — |
| `order` | integer | Порядок отображения |

---

### max_personal_accounts

Аккаунты MAX Personal (GREEN-API). Управляются только платформ-администраторами.

| Колонка | Тип | Описание |
|---------|-----|----------|
| `tenant_id` | varchar FK→tenants | — |
| `account_id` | text | Идентификатор аккаунта |
| `id_instance` | text | GREEN-API idInstance |
| `api_token_instance` | text | GREEN-API apiTokenInstance |
| `status` | text | Статус подключения |

---

## Интенты AI (VALID_INTENTS)

```typescript
"price", "availability", "shipping", "return", "discount", "complaint", "other",
"photo_request", "price_objection", "ready_to_buy", "needs_manual_quote",
"invalid_vin", "marking_provided", "payment_blocked", "warranty_question",
"want_visit", "what_included", "mileage_preference"
```

## Penalty codes (штрафы confidence)

| Код | Значение | Описание |
|-----|---------|----------|
| `NO_SOURCES` | -0.30 | Источники не найдены |
| `PRICE_NOT_FOUND` | -0.25 | Цена не найдена |
| `AVAILABILITY_NOT_FOUND` | -0.20 | Наличие не подтверждено |
| `CONFLICTING_SOURCES` | -0.20 | Противоречивые данные |
| `NEGATIVE_SENTIMENT` | -0.15 | Негативный настрой |
| `SELF_CHECK_LOW` | -0.15 | Низкий self-check |
| `OUT_OF_SCOPE` | -0.40 | Вне компетенции |
| `STALE_DATA` | -0.35 | Устаревшие данные |
| `LOW_SIMILARITY` | -0.25 | Низкая релевантность RAG |
| `INTENT_FORCE_HANDOFF` | 0 | Интент требует оператора |

---

## Conventions

- Все PK — `gen_random_uuid()` в формате `varchar`
- Все timestamp — `CURRENT_TIMESTAMP`, NOT NULL если обязательное
- Tenant isolation — `tenant_id` есть в каждой таблице с бизнес-данными
- Soft delete через `revoked_at` / `is_active` / `used_at`
- Zod insert-схемы генерируются через `createInsertSchema` из `drizzle-zod`
- TypeScript типы: `$inferSelect` / `$inferInsert`
