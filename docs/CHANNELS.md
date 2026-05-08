# Channels — Интеграции мессенджеров

> Актуально на май 2026.

---

## Обзор

Все каналы управляются через единый интерфейс `ChannelAdapter` и обрабатываются через `processIncomingMessageFull()`.

**Типы каналов:** `mock`, `telegram`, `telegram_personal`, `whatsapp`, `whatsapp_personal`, `max`, `max_personal`

**Включение:** каждый канал управляется feature flag (все выключены по умолчанию).

---

## Inbound Message Pipeline

Все входящие сообщения должны проходить через единую точку:

```typescript
// server/services/inbound-message-handler.ts
processIncomingMessageFull(tenantId, parsedMessage)
  1. handleIncomingMessage():
     - Найти/создать customer (dedup по tenantId + channel + externalId)
     - Найти/создать conversation
     - Сохранить message в БД
     - WebSocket broadcast → обновить UI
  2. Если AUTO_PARTS_ENABLED:
     - detectVehicleIdFromText() → VIN/FRAME → vehicle-lookup BullMQ queue
  3. triggerAiSuggestion():
     - Проверить pending suggestion
     - Вызвать generateWithDecisionEngine()
     - Сохранить ai_suggestion
     - WebSocket broadcast new_suggestion
```

---

## Telegram Personal (MTProto)

**Технология:** gramjs (MTProto API)
**Feature flag:** `TELEGRAM_PERSONAL_CHANNEL_ENABLED`
**Файлы:**
- `server/services/telegram-personal-adapter.ts` — auth flow (QR/phone/2FA)
- `server/services/telegram-client-manager.ts` — управление соединениями
- `server/routes/channels/telegram-personal.routes.ts` — 56 входящих зависимостей

### Аутентификация

**Способ 1: QR-код**
```
POST /api/telegram-personal/accounts/start-qr
  → TelegramPersonalAdapter.startQrAuth(sessionId)
  → gramjs.signInUserWithQrCode()
  → URL: tg://login?token=...
  → QR Image (data:image/png;base64)

POST /api/telegram-personal/accounts/check-qr (polling)
  → status: "pending" | "authorized" | "expired" | "needs_2fa"
  → При authorized: session.save() → сохранить в telegram_sessions
                  + telegramClientManager.connect()
                  + syncDialogs()

POST /api/telegram-personal/accounts/verify-qr-2fa  ← 2FA при QR
```

**Способ 2: Телефон + код**
```
POST /api/telegram-personal/accounts/start-phone
POST /api/telegram-personal/accounts/verify-code
POST /api/telegram-personal/accounts/verify-password  ← 2FA
```

### Лимиты
- Максимум **5 аккаунтов** на тенант
- `tgRole`: `resolver` (поиск по номеру) / `sender` (отправка) / `both`

### Хранение сессий
- Session string хранится в `telegram_sessions.session_string`
- Восстановление при старте: `telegramClientManager.restoreAllSessions()`
- Шифрование: `telegram-session-crypto.ts`

### Reconnect логика
- `autoReconnect: false` в gramjs (чтобы избежать `AUTH_KEY_DUPLICATED`)
- Кастомный `scheduleReconnect()` с экспоненциальным backoff
- При `AUTH_KEY_DUPLICATED` → полный переконнект

### Sync диалогов
```typescript
telegramClientManager.syncDialogs(tenantId, channelId, { limit: 5, messageLimit: 20 })
```
Создаёт customers + conversations из истории Telegram.

---

## WhatsApp Personal (Baileys)

**Технология:** Baileys (WhatsApp Web reverse engineering)
**Feature flag:** `WHATSAPP_PERSONAL_CHANNEL_ENABLED`
**Файл:** `server/services/whatsapp-personal-adapter.ts`

### Аутентификация
```
GET /api/whatsapp-personal/qr
  → WhatsAppPersonalAdapter.startAuth(tenantId)
  → Baileys QR → base64 PNG

POST /api/whatsapp-personal/logout
```

### Хранение сессий
⚠️ **Сессии хранятся на диске** в `./auth_sessions/{tenantId}/` (Baileys файлы).
При деплое на новый сервер или в Docker сессии **теряются**.

### Восстановление
```typescript
WhatsAppPersonalAdapter.restoreSession(tenantId)
```
Вызывается при старте сервера для всех тенантов с активными WhatsApp-каналами.

---

## MAX Personal (GREEN-API)

**Технология:** GREEN-API HTTP API
**Feature flag:** `MAX_PERSONAL_CHANNEL_ENABLED`
**Файлы:**
- `server/services/max-green-api-adapter.ts` — HTTP-клиент к GREEN-API
- `server/services/max-personal-adapter.ts` — обёртка
- `server/routes/max-personal-webhook.ts` — вебхук для входящих

### Архитектура
GREEN-API — облачный прокси, который принимает сообщения из MAX и пересылает на наш webhook.

```
Клиент пишет в MAX
  → GREEN-API instance (idInstance + apiTokenInstance)
  → POST /webhook/max-personal
  → processIncomingMessageFull()
```

### Управление аккаунтами
Аккаунты управляются **только платформ-администраторами** (`/api/admin/users/:userId/max-personal`).
Тенанты не могут самостоятельно добавлять аккаунты.

### Аутентификация через QR
```
GET /api/admin/users/:userId/max-personal/:accountId/qr
  → maxGreenApiAdapter.getQR(idInstance, token)
  → GREEN-API /qr/{token}
```

### Отправка сообщений
```typescript
maxGreenApiAdapter.sendMessage(idInstance, token, chatId, message)
// chatId форматы:
// "79991234567@c.us"  — номер телефона
// "41837581"          — MAX internal user_id (без суффикса!)
// "-1001234567890"    — group_id
```

### Cluster URL
GREEN-API использует cluster-specific субдомены:
```
idInstance = "3100525112"
cluster = "3100"
URL = "https://3100.api.green-api.com"
```

---

## Telegram Bot API

**Технология:** Telegram Bot API (webhook)
**Feature flag:** `TELEGRAM_CHANNEL_ENABLED`
**Файлы:**
- `server/services/telegram-adapter.ts` — парсинг updates, отправка
- `server/routes/channels/telegram-bot.routes.ts` — управление
- `server/routes/telegram-webhook.ts` — webhook

### Вебхук
```
POST /webhook/telegram
  → HMAC-SHA256 подпись
  → parseUpdate() → ParsedIncomingMessage
  → processIncomingMessageFull()
```

---

## WhatsApp Bot

**Технология:** WhatsApp Business API (webhook)
**Feature flag:** `WHATSAPP_CHANNEL_ENABLED`
**Файлы:**
- `server/services/whatsapp-adapter.ts`
- `server/routes/whatsapp-webhook.ts`

---

## MAX Bot

**Технология:** MAX Bot API (webhook)
**Feature flag:** `MAX_CHANNEL_ENABLED`
**Файлы:**
- `server/services/max-adapter.ts`
- `server/routes/max-webhook.ts`

---

## Channel Dispatcher

**Файл:** `server/services/channel-adapter.ts`

```typescript
// channelRegistry — Map<ChannelType, ChannelAdapter>
// Зарегистрированные каналы:
"mock", "telegram", "whatsapp", "max", "whatsapp_personal", "max_personal"
// (telegram_personal не в реестре — работает через client manager напрямую)
```

Диспетчер маршрутизирует `sendMessage()` к нужному адаптеру по типу канала.

---

## Прокси

**Файл:** `server/services/proxy-service.ts`

Прокси-пул управляется платформ-администраторами. Поддерживаемые протоколы: `socks5`, `http`, `https`.

Назначение прокси каналу → `proxies.assigned_channel_id`.

---

## Marquiz Webhook

**Файл:** `server/routes/marquiz-webhook.ts`

Получает лиды из Marquiz квизов и обрабатывает их через BullMQ.

```
POST /webhook/marquiz
  → marquiz-lead-queue.ts → BullMQ
  → Создать customer + conversation + message
  → triggerAiSuggestion()
```

---

## Escalation Bot

**Файл:** `server/services/escalation-bot.ts`

Telegram-бот для уведомлений об эскалациях. Отправляет summary диалога в `tenant.escalation_chat_id`.

---

## Сравнение каналов

| Канал | Auth | Сессии | Управление |
|-------|------|--------|-----------|
| Telegram Personal | QR или phone/2FA | PostgreSQL (зашифровано) | Тенант |
| WhatsApp Personal | QR | Диск (`./auth_sessions/`) ⚠️ | Тенант |
| MAX Personal | QR через GREEN-API | GREEN-API cloud | Только платформ-админ |
| Telegram Bot | Webhook token | Нет | Тенант |
| WhatsApp Bot | Webhook | Нет | Тенант |
| MAX Bot | Webhook | Нет | Тенант |
