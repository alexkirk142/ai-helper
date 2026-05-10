# Руководство: Удаление ценового поиска

> Цель: убрать поиск цен (Яндекс, Avito, Drom, Playwright, GPT web_search)
> не затронув идентификацию коробки передач по VIN/FRAME/маркировке.

---

## Промпт 0 — Контекст (вставлять в начало каждого шага)

```
Проект: AI Sales Operator (Node.js + TypeScript + Express + Drizzle ORM + PostgreSQL + BullMQ).

ВАЖНО: Мы удаляем ТОЛЬКО ценовой поиск. Всё что связано с
идентификацией коробки передач по VIN/FRAME/маркировке —
ТРОГАТЬ НЕЛЬЗЯ. Это разные системы.

Что НЕЛЬЗЯ трогать:
- server/services/detection/candidate-detector.ts
- server/services/vin-ocr.service.ts
- server/services/vehicle-lookup-queue.ts
- server/workers/vehicle-lookup.worker.ts (только модифицировать)
- server/services/podzamenu-lookup-client.ts
- server/services/partsapi-vin-decoder.ts
- server/services/transmission-identifier.ts
- server/services/gearbox-templates.ts
- server/services/gearbox/gearbox-kind.ts
- server/services/vehicle-data-extractor.ts
- server/services/price-sources/types.ts (используется в vehicle-lookup.worker.ts!)
```

---

## Шаг 1 — Удаление файлов ценового поиска

```
[Вставь Промпт 0]

ШАГ 1: Удалить только файлы ценового поиска.

Удалить следующие файлы полностью:
- server/services/price-searcher.ts
- server/services/price-lookup-queue.ts
- server/services/playwright-fetcher.ts
- server/services/price-sources/yandex-source.ts
- server/services/price-sources/avito-source.ts
- server/services/price-sources/drom-source.ts
- server/services/price-sources/web-source.ts
- server/services/price-sources/mock-source.ts
- server/workers/price-lookup.worker.ts
- podzamenu_lookup_service.py

ВНИМАНИЕ: server/services/price-sources/types.ts НЕ УДАЛЯТЬ.
Из него используется функция detectGearboxType() в файле
server/workers/vehicle-lookup.worker.ts — она нужна для
определения типа коробки (АКПП/МКПП/вариатор) из текста клиента.

После удаления проверь что TypeScript компилируется без ошибок.
Исправь только import-ошибки от удалённых файлов — больше ничего не меняй.
```

---

## Шаг 2 — Модификация vehicle-lookup.worker.ts

```
[Вставь Промпт 0]

ШАГ 2: Модифицировать server/workers/vehicle-lookup.worker.ts

Нужно убрать из этого файла ТОЛЬКО части связанные с запуском
ценового поиска. Логика идентификации коробки должна остаться.

Конкретно — удалить:

1. Функцию tryFallbackPriceLookup() целиком.

2. В функции processVehicleLookup() удалить секцию
   "Price lookup routing" в конце (после createResultSuggestionIfNeeded):
   - Блок if (isModelOnly) { enqueuePriceLookup(...) }
   - Блок else if (lookupConfidence >= 0.80 ...) { enqueuePriceLookup(...) }
   - Блок else if (gearbox.oemStatus !== "FOUND" ...) { tryFallbackPriceLookup(...) }

3. В catch-блоке — удалить вызов tryFallbackPriceLookup()
   (оставить только обновление статуса FAILED и return).

4. Удалить импорты которые больше не нужны после этих удалений:
   - импорт enqueuePriceLookup из price-lookup-queue
   - импорт toPriceSearchGearboxType, fromVehicleContextGearboxType из gearbox-kind
     (только если они больше нигде в файле не используются)

5. Функцию getLastCustomerMessageText() удалить если она
   использовалась только в tryFallbackPriceLookup.

ОСТАВИТЬ без изменений:
- computeLookupConfidence()
- buildResultSuggestionText()
- createResultSuggestionIfNeeded()
- isValidTransmissionModel()
- idTypeToLabel()
- Весь блок извлечения vehicleContext (PartsAPI + Podzamenu)
- Вызов identifyTransmissionByOem() для определения model name
- Вызов createResultSuggestionIfNeeded() — он создаёт подсказку
  оператору с найденной моделью коробки

После изменений проверь компиляцию TypeScript.
```

---

## Шаг 3 — Модификация inbound-message-handler.ts

```
[Вставь Промпт 0]

ШАГ 3: Модифицировать server/services/inbound-message-handler.ts

Удалить ТОЛЬКО шаг 9 из функции processIncomingMessageFull().
Это блок с комментарием "── 9. Transmission code path (score >= 0.70)":

    if (
      autoPartsEnabled &&
      best &&
      (best.type === "TRANSMISSION_CODE" || best.type === "OCR_TRANSMISSION_CODE") &&
      best.score >= 0.70
    ) {
      incr("detector.route_price_lookup", { kind: "transmissionCode" });
      const { enqueuePriceLookup } = await import("./price-lookup-queue");
      await enqueuePriceLookup({...});
      return;
    }

После удаления шага 9 сообщения с маркировкой КПП будут
падать в шаг 12 (Fallback) → triggerAiSuggestion() → Decision Engine.
Это правильное поведение — агент ответит сам.

Всё остальное в файле НЕ ТРОГАТЬ:
- Шаг 8 (VIN/FRAME path) — оставить
- Шаг 10 (Gearbox type only) — оставить
- Шаг 11 (Medium-confidence clarification) — оставить
- Шаг 12 (Fallback) — оставить

Проверь компиляцию TypeScript после изменений.
```

---

## Шаг 4 — Модификация decision-engine.ts

```
[Вставь Промпт 0]

ШАГ 4: Модифицировать server/services/decision-engine.ts

Удалить блок инжекции price snapshot в функции generateWithDecisionEngine().
Это блок который начинается с комментария:
"// Inject fresh price snapshot if available for this conversation"

Конкретно удалить:
1. Переменную priceSnapshotBlock и весь try/catch блок где она заполняется.
2. Строку: if (priceSnapshotBlock) { contextParts.unshift(priceSnapshotBlock); }

Также удалить неиспользуемые импорты типов если появятся:
- PriceSnapshot (если больше не используется)
- VehicleLookupCase (если больше не используется)

Функцию generateWithDecisionEngine() оставить полностью —
убрать только этот один блок внутри неё.

Проверь компиляцию TypeScript после изменений.
```

---

## Шаг 5 — Удаление ценовых feature flags

```
[Вставь Промпт 0]

ШАГ 5: Убрать ценовые feature flags.

В файле server/services/feature-flags.ts в константе DEFAULT_FLAGS
удалить следующие записи:
- AI_PRICE_ESTIMATE_ENABLED
- GPT_WEB_SEARCH_ENABLED
- PRICE_ESCALATION_ENABLED
- YANDEX_PREFER_MODELNAME
- OUTLIER_GUARD_SMALL_SAMPLE
- INTL_PRICE_CAP_ENABLED
- INTL_PRICE_DISCOUNT_ENABLED

В файле shared/schema.ts найти тип FeatureFlagName
(это union строковых литералов) и удалить из него те же 7 названий.

Оставить все остальные флаги без изменений:
- AUTO_PARTS_ENABLED
- AI_SUGGESTIONS_ENABLED
- DECISION_ENGINE_ENABLED
- AI_AUTOSEND_ENABLED
- RAG_ENABLED
- FEW_SHOT_LEARNING
- HUMAN_DELAY_ENABLED
- GEARBOX_TAG_MINLEN_4
- и все остальные каналы

Проверь компиляцию TypeScript после изменений.
```

---

## Шаг 6 — Финальная проверка

```
[Вставь Промпт 0]

ШАГ 6: Финальная проверка после всех изменений.

1. Запусти TypeScript компилятор:
   npx tsc --noEmit
   Исправь все оставшиеся ошибки компиляции.

2. Проверь что нигде в коде не осталось импортов из удалённых файлов:
   - price-searcher
   - price-lookup-queue
   - playwright-fetcher
   - price-sources/yandex-source
   - price-sources/avito-source
   - price-sources/drom-source
   - price-sources/mock-source

3. Проверь что vehicle-lookup.worker.ts всё ещё импортирует
   и использует detectGearboxType из price-sources/types.ts —
   этот файл должен остаться нетронутым.

4. Запусти сервер и убедись что он стартует без ошибок:
   npm run dev

5. Проверь что входящее сообщение с VIN обрабатывается корректно:
   - должна создаться suggestion с моделью коробки
   - не должно быть попыток поиска цены
   - ошибок в логах быть не должно
```

---

## Справка: что остаётся, что уходит

### Удаляется (ценовой поиск)
| Файл | Причина |
|------|---------|
| server/services/price-searcher.ts | Поиск цен Яндекс + GPT |
| server/services/price-lookup-queue.ts | BullMQ очередь цен |
| server/services/playwright-fetcher.ts | Браузер для парсинга |
| server/services/price-sources/yandex-source.ts | Яндекс парсер |
| server/services/price-sources/avito-source.ts | Avito парсер |
| server/services/price-sources/drom-source.ts | Drom парсер |
| server/services/price-sources/web-source.ts | Web парсер |
| server/services/price-sources/mock-source.ts | Mock данные |
| server/workers/price-lookup.worker.ts | Воркер поиска цен |
| podzamenu_lookup_service.py | Python сервис |

### Остаётся (идентификация коробки)
| Файл | Причина |
|------|---------|
| server/services/detection/candidate-detector.ts | Детектор VIN/КПП из текста |
| server/services/vin-ocr.service.ts | OCR фото через GPT-4o |
| server/services/vehicle-lookup-queue.ts | BullMQ очередь поиска авто |
| server/workers/vehicle-lookup.worker.ts | Воркер поиска авто (изменён) |
| server/services/podzamenu-lookup-client.ts | Поиск коробки по VIN |
| server/services/partsapi-vin-decoder.ts | Декодер VIN |
| server/services/transmission-identifier.ts | GPT идентификация модели КПП |
| server/services/gearbox-templates.ts | Шаблоны ответов про КПП |
| server/services/gearbox/gearbox-kind.ts | Тип КПП (AT/MT/CVT) |
| server/services/price-sources/types.ts | detectGearboxType() нужен! |
| server/services/vehicle-data-extractor.ts | Извлечение данных авто |
