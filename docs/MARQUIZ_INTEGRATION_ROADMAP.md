# Marquiz Integration — Roadmap & Future Improvements

Текущая реализация (MVP) — единый webhook-endpoint без разделения по тенантам и квизам.
Этот документ описывает что нужно доработать по мере роста.

> **MVP реализован:** `POST /webhooks/marquiz` — один общий endpoint, hardcoded `tenantId` из env,
> ротация MAX-аккаунтов через Redis round-robin, шаблонный автоответ.

---

## Этап 2 — Мультитенантность (приоритет: ВЫСОКИЙ)

**Проблема:** Сейчас все заявки из всех квизов идут на один тенант.
При появлении второго клиента/пользователя платформы — заявки будут смешиваться.

**Решение:** Уникальный URL на тенанта + квиз, по аналогии с MAX Personal:

```
/webhooks/marquiz/:tenantId/:quizId
```

Пример:
```
https://домен.app/webhooks/marquiz/tenant-abc123/kpp
https://домен.app/webhooks/marquiz/tenant-xyz456/kpp
```

**Что нужно сделать:**

1. Изменить маршрут с `/webhooks/marquiz` на `/webhooks/marquiz/:tenantId/:quizId`
2. Валидировать `tenantId` по таблице `tenants`
3. Передавать `quizId` в метаданные conversation
4. Каждый тенант настраивает свой URL в Marquiz

**Файлы для изменения:**
- `server/routes/marquiz-webhook.ts` — параметры маршрута
- `server/workers/marquiz-lead.worker.ts` — передача tenantId из URL

---

## Этап 3 — Таблица конфигураций квизов (приоритет: СРЕДНИЙ)

**Проблема:** Шаблон автоответа зашит в коде. Нельзя изменить без деплоя.
Разные квизы требуют разных шаблонов.

**Решение:** Таблица `marquiz_quiz_configs` в БД.

**Схема таблицы (добавить в `shared/schema.ts`):**

```typescript
export const marquizQuizConfigs = pgTable("marquiz_quiz_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  quizId: varchar("quiz_id").notNull(),           // slug: "kpp", "buyout", etc.
  quizName: text("quiz_name"),                    // "Квиз КПП" — для отображения в UI
  messageTemplate: text("message_template"),      // шаблон с плейсхолдерами
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("marquiz_quiz_configs_tenant_idx").on(table.tenantId),
  uniqueIndex("marquiz_quiz_configs_tenant_quiz_unique").on(table.tenantId, table.quizId),
]);
```

**Плейсхолдеры в шаблоне:**
- `{name}` — имя клиента
- `{phone}` — телефон
- `{gearbox_type}` — тип КПП
- `{car}` — марка и год авто
- `{vin}` — VIN-код
- `{city}` — город

**Пример шаблона:**
```
Здравствуйте{name}! Получили вашу заявку на подбор КПП.

🚗 Автомобиль: {car}
⚙️ Тип КПП: {gearbox_type}
📍 Город: {city}

Подбираем варианты, свяжемся в течение 15 минут!
```

**Файлы для создания/изменения:**
- `shared/schema.ts` — добавить таблицу
- `migrations/` — создать миграцию
- `server/routes/marquiz-webhook.ts` — загружать шаблон из БД
- UI страница для управления квизами (опционально)

---

## Этап 4 — Fallback на Telegram (приоритет: СРЕДНИЙ)

**Проблема:** Если клиент не оставил MAX-номер или аккаунт не найден — заявка теряется молча.

**Решение:** Fallback-цепочка каналов.

```
MAX (поле "max" из квиза)
  ↓ не найден / ошибка отправки
Telegram (gramjs — поиск по номеру телефона)
  ↓ не найден
Уведомить оператора в UI (WebSocket)
```

**Как определить наличие Telegram по номеру:**
- gramjs `ImportContacts` → проверить есть ли `userId` в ответе
- Если есть — отправить через Telegram Personal adapter

**Файлы для изменения:**
- `server/workers/marquiz-lead.worker.ts` — добавить fallback логику
- `server/services/max-personal-adapter.ts` — возможно вынести логику поиска

---

## Этап 5 — UI управления Marquiz-интеграцией (приоритет: НИЗКИЙ)

Страница в админке тенанта:

- Список квизов и их webhook URL (с кнопкой "скопировать")
- Редактор шаблона ответа для каждого квиза
- Статистика: количество заявок, успешных отправок, ошибок
- Журнал последних заявок (имя, телефон, статус доставки)
- Включить/выключить автоответ для квиза

---

## Этап 6 — Защита webhook (приоритет: СРЕДНИЙ)

**Проблема:** Сейчас endpoint открыт — любой может слать POST-запросы.

**Решение:** Верификация подписи Marquiz.

Marquiz отправляет заголовок `X-Marquiz-Sign` — HMAC-SHA256 подпись тела запроса.

```typescript
import crypto from "crypto";

function verifyMarquizSignature(body: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}
```

`secret` хранить в `integration_secrets` (таблица уже есть в схеме) или в env.

---

## Этап 7 — Умная детекция мессенджера (приоритет: НИЗКИЙ)

Если клиент не заполнил поле MAX — автоматически проверять оба мессенджера:

1. **GREEN-API** (`/checkWhatsapp` endpoint) — проверить есть ли номер в MAX
2. **gramjs** (`ImportContacts`) — проверить есть ли номер в Telegram
3. Отправить в тот, где нашли (или в оба)

---

## Текущее состояние MVP

| Функция | Статус |
|---------|--------|
| Webhook endpoint `/webhooks/marquiz` | ✅ Реализовано |
| Парсинг payload Marquiz | ✅ Реализовано |
| Ротация MAX-аккаунтов (Redis round-robin) | ✅ Реализовано |
| Создание customer + conversation в БД | ✅ Реализовано |
| Отправка через MAX Personal (GREEN-API) | ✅ Реализовано |
| Шаблонный автоответ | ✅ Реализовано |
| Разделение по тенантам (`:tenantId` в URL) | ⏳ Этап 2 |
| Конфигурация квизов в БД | ⏳ Этап 3 |
| Fallback на Telegram | ⏳ Этап 4 |
| UI управления | ⏳ Этап 5 |
| Верификация подписи Marquiz | ⏳ Этап 6 |
| Автодетекция мессенджера | ⏳ Этап 7 |
