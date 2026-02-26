# Transmission Lookup Pipeline — File Map

> Справочник для имплементационных промптов. Не модифицировать вручную.
> Актуально на: 2026-02-27 (обновлено после Step 8 — Yandex anchor selection refactor)

---

## 1. Function → File Index

### Inbound Message Handling

| Function | File | Line |
|---|---|---|
| `processIncomingMessageFull()` | `server/services/inbound-message-handler.ts` | ~373 |
| `handleIncomingMessage()` | `server/services/inbound-message-handler.ts` | ~120 |
| `triggerAiSuggestion()` | `server/services/inbound-message-handler.ts` | ~220 |
| `detectVehicleIdFromText()` | `server/services/inbound-message-handler.ts` | ~62 (wrapper → candidate pipeline) |
| `detectGearboxMarkingFromText()` | `server/services/inbound-message-handler.ts` | ~41 (wrapper → candidate pipeline) |
| `detectGearboxType()` | `server/services/price-sources/types.ts` | 51 |
| `analyzeImages()` | `server/services/vin-ocr.service.ts` | (dynamic import) |

### Candidate Detection Pipeline (Step 2)

| Function | File | Notes |
|---|---|---|
| `extractCandidatesFromText()` | `server/services/detection/candidate-detector.ts` | Extracts all VIN/FRAME/TC/GearboxType candidates from text |
| `extractCandidatesFromOcr()` | `server/services/detection/candidate-detector.ts` | Converts analyzeImages() result to scored candidates; applies quality gate |
| `chooseBestCandidate()` | `server/services/detection/candidate-detector.ts` | Selects best with conflict detection |
| `normalizeVehicleIdText()` | `server/services/detection/candidate-detector.ts` | Cyrillic homoglyph + dash normalization |
| `normalizeCyrillicHomoglyphs()` | `server/services/detection/candidate-detector.ts` | Exported for reuse |
| `normalizeTransmissionCode()` | `server/services/detection/candidate-detector.ts` | Uppercase + Cyrillic normalization for TC |
| `classifyTransmissionStrength()` | `server/services/detection/candidate-detector.ts` | "strong" \| "weak" \| null |
| `maskVin()` / `maskCandidateValue()` | `server/services/detection/candidate-detector.ts` | Safe logging helpers |

### Vehicle Lookup Worker

| Function | File | Line |
|---|---|---|
| `processVehicleLookup()` | `server/workers/vehicle-lookup.worker.ts` | 216 |
| `createResultSuggestionIfNeeded()` | `server/workers/vehicle-lookup.worker.ts` | 75 |
| `buildResultSuggestionText()` | `server/workers/vehicle-lookup.worker.ts` | 49 |
| `tryFallbackPriceLookup()` | `server/workers/vehicle-lookup.worker.ts` | 139 |
| `computeLookupConfidence()` | `server/workers/vehicle-lookup.worker.ts` | 32 |
| `isValidTransmissionModel()` (worker copy) | `server/workers/vehicle-lookup.worker.ts` | 24 |
| `createVehicleLookupWorker()` | `server/workers/vehicle-lookup.worker.ts` | 590 |
| `startVehicleLookupWorker()` | `server/workers/vehicle-lookup.worker.ts` | 618 |

### Transmission Identification

| Function | File | Notes |
|---|---|---|
| `identifyTransmissionByTransmissionCode()` | `server/services/transmission-identifier.ts` | New (Step 4). For model codes: JF011E, 6HP19 |
| `identifyTransmissionByOemPartNumber()` | `server/services/transmission-identifier.ts` | New (Step 4). For OEM part numbers: 31020-3VX2D |
| `identifyTransmissionByOem()` | `server/services/transmission-identifier.ts` | @deprecated. Routes via `classifyOemInput()` heuristic |
| `classifyOemInput()` | `server/services/transmission-identifier.ts` | Pure. `"oemPartNumber"` if `/\d-\|-\d/`, else `"transmissionCode"` |
| `normalizeIdentityInput()` | `server/services/transmission-identifier.ts` | New (Step 5). Pure. trim → uppercase → remove spaces; dashes preserved |
| `buildIdentityCacheKey()` | `server/services/transmission-identifier.ts` | New (Step 5). Pure. `"tc:<N>"` for transmissionCode, `"pn:<N>"` for oemPartNumber |

### Price Lookup Worker

| Function | File | Line |
|---|---|---|
| `processPriceLookup()` | `server/workers/price-lookup.worker.ts` | 1018 |
| `lookupPricesByOem()` | `server/workers/price-lookup.worker.ts` | 461 |
| `lookupPricesByFallback()` | `server/workers/price-lookup.worker.ts` | 851 |
| `createPriceSuggestions()` | `server/workers/price-lookup.worker.ts` | 153 |
| `createPriceSuggestion()` | `server/workers/price-lookup.worker.ts` | 310 |
| `buildPriceReply()` | `server/workers/price-lookup.worker.ts` | 243 |
| `estimatePriceFromAI()` | `server/workers/price-lookup.worker.ts` | 346 |
| `createEscalationSuggestion()` | `server/workers/price-lookup.worker.ts` | 693 |
| `createNotFoundSuggestion()` | `server/workers/price-lookup.worker.ts` | 788 |
| `isValidTransmissionModel()` (worker copy) | `server/workers/price-lookup.worker.ts` | 444 |
| `createPriceLookupWorker()` | `server/workers/price-lookup.worker.ts` | 1039 |
| `startPriceLookupWorker()` | `server/workers/price-lookup.worker.ts` | 1067 |

### Price Search Logic

| Function | File | Line |
|---|---|---|
| `searchUsedTransmissionPrice()` | `server/services/price-searcher.ts` | 639 |
| `searchWithYandex()` | `server/services/price-searcher.ts` | 519 |
| `buildYandexQueries()` | `server/services/price-searcher.ts` | 389 |
| `isValidMarketModelName()` | `server/services/price-searcher.ts` | 152 |
| `selectYandexAnchor()` | `server/services/price-searcher.ts` | 173 |
| `buildPrimaryQuery()` | `server/services/price-searcher.ts` | 186 |
| `buildFallbackQuery()` | `server/services/price-searcher.ts` | 214 |
| `parseListingsFromResponse()` | `server/services/price-searcher.ts` | 313 |
| `parseListingsFromHtml()` | `server/services/price-searcher.ts` | 440 |
| `filterListingsByTitle()` | `server/services/price-searcher.ts` | 507 |
| `removeOutliers()` | `server/services/price-searcher.ts` | 269 |
| `validatePrices()` | `server/services/price-searcher.ts` | 283 |

### Vehicle Context Extraction

| Function | File | Line |
|---|---|---|
| `extractVehicleContextFromRawData()` | `server/services/vehicle-data-extractor.ts` | 34 |

### Queue Definitions & Enqueue Functions

| Function | File | Line |
|---|---|---|
| `enqueueVehicleLookup()` | `server/services/vehicle-lookup-queue.ts` | 46 |
| `getVehicleLookupQueue()` | `server/services/vehicle-lookup-queue.ts` | 16 |
| `enqueuePriceLookup()` | `server/services/price-lookup-queue.ts` | 57 |
| `getPriceLookupQueue()` | `server/services/price-lookup-queue.ts` | 27 |

### Gearbox Templates

| Function | File | Line |
|---|---|---|
| `DEFAULT_GEARBOX_TEMPLATES` (const) | `server/services/gearbox-templates.ts` | 6 |
| `getMergedGearboxTemplates()` | `server/services/gearbox-templates.ts` | 43 |
| `fillGearboxTemplate()` | `server/services/gearbox-templates.ts` | 75 |

### GearboxKind Converters (Step 3)

| Function | File | Notes |
|---|---|---|
| `fromVehicleContextGearboxType()` | `server/services/gearbox/gearbox-kind.ts` | `"AT"`/`"MT"`/`"CVT"` → `GearboxKind` |
| `fromPriceSearchGearboxType()` | `server/services/gearbox/gearbox-kind.ts` | `"акпп"`/`"мкпп"`/... → `GearboxKind` |
| `toPriceSearchGearboxType()` | `server/services/gearbox/gearbox-kind.ts` | `GearboxKind` → `GearboxType` ("акпп"/...) |
| `toHumanRu()` | `server/services/gearbox/gearbox-kind.ts` | `GearboxKind` → Russian display label |

---

## 2. Per-File Summary

### `server/services/inbound-message-handler.ts`
**Exports:** `handleIncomingMessage`, `triggerAiSuggestion`, `processIncomingMessageFull`, `detectVehicleIdFromText`, `detectGearboxMarkingFromText`, `VehicleIdDetection`
**Role:** Точка входа для каждого входящего сообщения с любого канала. Маршрутизирует входящие сообщения через кандидатный пайплайн обнаружения (Step 2) в нужную очередь или AI suggestion.

**Routing flow (12 steps) в `processIncomingMessageFull()`:**
1. `extractCandidatesFromText(text)` — все кандидаты из текста
2. Если текст пуст и есть изображения → разрешить Telegram media → `analyzeImages()` → `extractCandidatesFromOcr()` — кандидаты из OCR
3. `chooseBestCandidate(allCandidates)` → `{ best, alternates, conflicts }`
4. Структурированный лог (VIN маскируется: первые 3 + последние 3 символа)
5. OCR quality gate fail → suggestion «пришлите чёткое фото»
6. `best.meta.isIncompleteVin` → `INCOMPLETE_VIN_REPLY` suggestion
7. `conflicts` → clarification suggestion (список VIN/FRAME, вопрос какой верный)
8. `best` — VIN/FRAME/OCR_VIN/OCR_FRAME, score ≥ 0.80 → `createVehicleLookupCase` + `enqueueVehicleLookup` + `gearboxTagRequest`
9. `best` — TRANSMISSION_CODE/OCR_TRANSMISSION_CODE, score ≥ 0.70 → `enqueuePriceLookup({ transmissionCode, oem })`
10. `best` — GEARBOX_TYPE → `gearboxNoVin` suggestion
11. `best` — TRANSMISSION_CODE, score 0.55..0.69 → weak code clarification suggestion
12. Нет кандидатов / низкая уверенность → `triggerAiSuggestion()`

**Примечание:** `detectVehicleIdFromText` и `detectGearboxMarkingFromText` сохраняют прежние сигнатуры, но внутри делегируют к `extractCandidatesFromText()` из candidate-detector.ts.

### `server/services/detection/candidate-detector.ts`
**Exports:** `CandidateType`, `DetectionCandidate`, `BestCandidateResult`, `OcrAnalysisResult` (types); `extractCandidatesFromText`, `extractCandidatesFromOcr`, `chooseBestCandidate`, `normalizeVehicleIdText`, `normalizeCyrillicHomoglyphs`, `CYRILLIC_TO_LATIN`, `normalizeTransmissionCode`, `classifyTransmissionStrength`, `maskVin`, `maskCandidateValue`
**Role:** Кандидатный пайплайн обнаружения идентификаторов (Step 2). Реализует extract → score → choose вместо последовательного first-match-wins подхода. Не имеет зависимостей от DB, очередей или IO — только чистые функции.

### `server/services/vehicle-lookup-queue.ts`
**Exports:** `VehicleLookupJobData` (interface), `getVehicleLookupQueue`, `enqueueVehicleLookup`, `closeVehicleLookupQueue`
**Role:** BullMQ Queue factory и enqueue-хелпер для очереди `vehicle_lookup_queue`.

### `server/services/price-lookup-queue.ts`
**Exports:** `SearchFallback` (interface), `PriceLookupJobData` (interface), `getPriceLookupQueue`, `enqueuePriceLookup`, `closePriceLookupQueue`
**Role:** BullMQ Queue factory и enqueue-хелпер для очереди `price_lookup_queue`.

### `server/workers/vehicle-lookup.worker.ts`
**Exports:** `createVehicleLookupWorker`, `startVehicleLookupWorker`
**Role:** Консьюмер `vehicle_lookup_queue`. Запускает Podzamenu + PartsAPI параллельно, собирает VehicleContext, опционально вызывает GPT для определения модели КПП, создаёт suggestions, запускает price lookup.

**Step 3 (GearboxType boundary):** В MODEL_ONLY пути `processVehicleLookup()` при построении `SearchFallback`: если `detectGearboxType(lastMessage)` возвращает `"unknown"`, делает fallback на `vehicleContext.gearboxType` ("AT"/"MT"/"CVT") через конвертеры — `toPriceSearchGearboxType(fromVehicleContextGearboxType(vehicleContext.gearboxType))` — гарантируя, что `SearchFallback.gearboxType` всегда содержит корректный `GearboxType` ("акпп"/...).
`tryFallbackPriceLookup()` не изменялась — у неё нет `vehicleContext`, ранний возврат при `"unknown"` сохранён.

### `server/workers/price-lookup.worker.ts`
**Exports:** `createPriceLookupWorker`, `startPriceLookupWorker`
**Role:** Консьюмер `price_lookup_queue`. Выполняет OEM-поиск или fallback-поиск цены, управляет глобальным кешем price_snapshots, создаёт клиентские price suggestions.

**Step 4 (Identification routing):** `lookupPricesByOem` получила два опциональных параметра — `transmissionCode?` и `oemPartNumber?`. При наличии `transmissionCode` вызывается `identifyTransmissionByTransmissionCode`; при наличии `oemPartNumber` — `identifyTransmissionByOemPartNumber`; иначе — legacy `identifyTransmissionByOem` как fallback. `processPriceLookup` передаёт оба поля из нормализованного job payload.

### `server/services/observability/metrics.ts`
**Exports:** `MetricTags` (type), `incr`, `timing`
**Role:** Лёгкий no-op фасад для метрик. Вызовы `incr`/`timing` расставлены по пайплайну (Step 7); реальный бекенд (StatsD/Prometheus/Datadog) подключается заменой тел функций без изменения call-sites.

**API:**
```typescript
// Tag map — all values must be low-cardinality enum-like literals.
// Raw VINs, OEM part numbers, model names, and any user-supplied strings
// are NEVER allowed as tag values (privacy + cardinality constraint).
type MetricTags = Record<string, string | number | boolean | null | undefined>;

// Increment a counter metric by 1.
function incr(name: string, tags?: MetricTags): void

// Record a duration in milliseconds.
function timing(name: string, ms: number, tags?: MetricTags): void
```

**Wiring a real backend** (example — StatsD via `hot-shots`):
```typescript
import StatsD from "hot-shots";
const statsd = new StatsD({ host: process.env.STATSD_HOST });
// replace incr body:
export function incr(name: string, tags?: MetricTags): void {
  statsd.increment(name, 1, 1, flattenTags(tags));
}
```
No call-sites need to change — only the function bodies in this file.

### `server/services/transmission-identifier.ts`
**Exports:** `VehicleContext` (interface), `TransmissionIdentification` (interface), `TransmissionInputKind` (type), `identifyTransmissionByTransmissionCode`, `identifyTransmissionByOemPartNumber`, `identifyTransmissionByOem` (@deprecated), `classifyOemInput`, `normalizeIdentityInput`, `buildIdentityCacheKey`
**Role:** GPT-4.1 + web_search: конвертирует код КПП или OEM-номер запчасти в рыночное название (напр. JF011E). Проверяет/пишет DB-кеш `transmission_identity_cache`. Обе публичные функции делегируют к общей внутренней `_identifyTransmissionByInput(inputValue, inputKind, context)` — логика GPT не дублируется.

**Cache key scheme (Step 5):** `normalizedOem` в кеше теперь хранит ключи с префиксом: `tc:<NORMALIZED>` для `transmissionCode`, `pn:<NORMALIZED>` для `oemPartNumber`. Чтение: сначала prefixed ключ, затем fallback на legacy unprefixed ключ. Legacy hit → best-effort soft-migration upsert prefixed строки; legacy строка не удаляется. Новые GPT-результаты всегда пишутся только в prefixed ключ.

### `server/services/price-searcher.ts`
**Exports:** `PriceSearchListing` (interface), `PriceSearchResult` (interface), `searchUsedTransmissionPrice`, `searchWithYandex`
**Role:** Трёхстадийный поиск цены: Yandex+Playwright → GPT web_search (RU) → GPT web_search (международный с FX конвертацией). Возвращает `PriceSearchResult`.

### `server/services/vehicle-data-extractor.ts`
**Exports:** `VehicleContextExtract` (interface), `extractVehicleContextFromRawData`
**Role:** GPT-4o-mini fallback: извлекает `driveType` и `gearboxType` из любого сырого ответа PartsAPI, когда regex-парсинг `modifikaciya`/`opcii`/`kpp` не дал результата.

### `server/services/gearbox-templates.ts`
**Exports:** `DEFAULT_GEARBOX_TEMPLATES`, `GearboxTemplateKey`, `GearboxTemplates`, `MergedGearboxTemplates`, `FillParams`, `getMergedGearboxTemplates`, `fillGearboxTemplate`
**Role:** Шаблоны всех клиентских сообщений о КПП. Tenant-переопределения из DB мержатся с дефолтами в рантайме.

### `server/services/gearbox/gearbox-kind.ts`
**Exports:** `GearboxKind` (type), `fromVehicleContextGearboxType`, `fromPriceSearchGearboxType`, `toPriceSearchGearboxType`, `toHumanRu`
**Role:** Канонический тип КПП и конвертеры между двумя представлениями: VehicleContext ("AT"/"MT"/"CVT") и price-search GearboxType ("акпп"/"мкпп"/...). Только чистые функции, без зависимостей от DB или IO.

### `server/services/price-sources/types.ts`
**Exports:** `ListingItem`, `PriceResult`, `PriceSource`, `GearboxType`, `GEARBOX_TYPE_KEYWORDS`, `GEARBOX_TYPE_SEARCH_TERM`, `detectGearboxType`
**Role:** Общие типы для всех источников цен + `detectGearboxType()` — используется в inbound handler и воркерах.

### `server/services/podzamenu-lookup-client.ts`
**Exports:** `LookupRequest`, `GearboxOemCandidate`, `GearboxInfo`, `LookupResponse`, `PodzamenuLookupError`, `PODZAMENU_NOT_FOUND`, `lookupByVehicleId`
**Role:** HTTP-клиент к Podzamenu FastAPI (localhost:8200/lookup). Конвертирует VIN/FRAME в `GearboxInfo` с выбором лучшего OEM-кандидата через скоринг.

### `shared/schema.ts`
**Role:** Единственный источник правды для всех DB-таблиц и TypeScript-типов через Drizzle ORM. Релевантные экспорты — в разделе 4.

---

## 3. Поле `oem` — где определено и используется

### Определение в типах/интерфейсах

```typescript
// server/services/price-lookup-queue.ts
interface PriceLookupJobData {
  oem: string | null;  // null → активирует путь searchFallback
}

// server/services/podzamenu-lookup-client.ts
interface GearboxInfo {
  oem: string | null;           // лучший OEM-кандидат из Podzamenu
  oemCandidates: GearboxOemCandidate[];
  oemStatus: "FOUND" | "NOT_FOUND" | "NOT_AVAILABLE" | "MODEL_ONLY";
}

// shared/schema.ts — таблица priceSnapshots
oem: text("oem").notNull()       // ключ кеша

// shared/schema.ts — таблица transmissionIdentityCache
oem: text("oem").notNull()
normalizedOem: text("normalized_oem").notNull()  // Step 5: prefixed key — "tc:<UPPER>" or "pn:<UPPER>"
                                                 // Legacy rows: plain uppercase trimmed value (no prefix)

// shared/schema.ts — таблица internalPrices
oem: text("oem").notNull()
```

### Передача в очереди

```typescript
// inbound-message-handler.ts — прямое обнаружение кода КПП из текста/фото:
enqueuePriceLookup({
  tenantId,
  conversationId,
  transmissionCode: detectedMarking, // явное поле (Step 1)
  oem: detectedMarking,              // legacy alias для обратной совместимости
})

// vehicle-lookup.worker.ts — OEM из Podzamenu, высокая уверенность:
enqueuePriceLookup({
  tenantId,
  conversationId,
  oem: gearbox.oem,                  // legacy alias для обратной совместимости
  oemPartNumber: gearbox.oem,        // явное поле (Step 1)
  transmissionCode: gearboxModelHint ?? null, // явное поле (Step 1)
  oemModelHint: gearboxModelHint,
  vehicleContext,
})

// vehicle-lookup.worker.ts — OEM не найден (MODEL_ONLY или NOT_FOUND):
enqueuePriceLookup({ tenantId, conversationId, oem: null, searchFallback: { ... } })
```

### Использование в воркерах

```typescript
// price-lookup.worker.ts — диспетчеризация:
if (oem) → lookupPricesByOem(tenantId, oem, conversationId, oemModelHint, vehicleContext)
else     → lookupPricesByFallback(...)

// price-lookup.worker.ts — ключ кеша (Step 6):
// writeKey = buildPriceSnapshotKey(kind, normalize(value), make, model)
// формат: "tc::<v>::<make>::<model>" | "pn::<v>::<make>::<model>" | legacy "oem::make::model"
storage.getGlobalPriceSnapshot(prefixedKey)    // try prefixed first
storage.getGlobalPriceSnapshot(legacyCacheKey) // fallback

// price-lookup.worker.ts — GPT-идентификация:
identifyTransmissionByOem(oem, vehicleContext)

// price-lookup.worker.ts — сохранение snapshot:
storage.createPriceSnapshot({ oem, source, minPrice, ... })
```

### Normalization Layer (добавлено в Step 1)

Файл: `server/workers/price-lookup.worker.ts` — начало функции `processPriceLookup()`

Если вызывающая сторона не заполнила явные поля (`transmissionCode` / `oemPartNumber`), воркер автоматически выводит их из устаревшего поля `oem`:

```
OEM_PART_NUMBER_RE = /\d-|-\d/   (цифра рядом с дефисом)

if transmissionCode == undefined AND oemPartNumber == undefined AND oem != null:
  if OEM_PART_NUMBER_RE.test(oem):
    oemPartNumber = oem       // напр. "31020-3VX2D"
  else:
    transmissionCode = oem    // напр. "JF011E", "6HP19", "A245E"
```

Это сохраняет полную обратную совместимость: старые вызовы, передающие только `oem`, продолжают работать корректно.

### Использование в price-searcher

```typescript
// price-searcher.ts — выбор search term:
resolveSearchTerm(oem, modelName)
// → возвращает modelName если он валиден, иначе oem

// price-searcher.ts — построение Yandex-запросов:
buildYandexQueries(oem, modelName, make, model, gearboxType)
// → "АКПП {oem} купить", "АКПП {make} {model} {oem} контрактная"

// price-searcher.ts — построение GPT-промптов:
buildPrimaryQuery(oem, modelName, origin, gearboxLabel, make, vehicleDesc)
buildFallbackQuery(oem, modelName, gearboxLabel, make, vehicleDesc)
```

---

## 4. TypeScript Types Reference

### `VehicleContext`
Файл: `server/services/transmission-identifier.ts` : 5

```typescript
export interface VehicleContext {
  make?: string | null;
  model?: string | null;
  year?: string | null;
  engine?: string | null;
  body?: string | null;
  driveType?: string | null;
  gearboxModelHint?: string | null;   // рыночный код-хинт (напр. "JF011E")
  factoryCode?: string | null;        // factory/OEM код из Podzamenu
  gearboxType?: string | null;        // "AT" | "MT" | "CVT"
  displacement?: string | null;
  partsApiRawData?: Record<string, unknown> | null;
}
```

### `VehicleLookupCase`
Файл: `shared/schema.ts` : 1337 (Drizzle table), тип : 1363

```typescript
// DB columns:
id, tenantId, conversationId, messageId,
idType: "VIN" | "FRAME",
rawValue: string,         // оригинальный текст от клиента
normalizedValue: string,  // uppercase, без пробелов
status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED",
verificationStatus: "NEED_TAG_OPTIONAL" | "UNVERIFIED_OEM" | "VERIFIED_MATCH" | "MISMATCH" | "NONE",
cacheId: string | null,   // FK → vehicle_lookup_cache
error: string | null,
createdAt, updatedAt

export type VehicleLookupCase = typeof vehicleLookupCases.$inferSelect;
export type InsertVehicleLookupCase = typeof vehicleLookupCases.$inferInsert;
```

### `TransmissionIdentityCache`
Файл: `shared/schema.ts` : 1594 (table), тип : 1621

```typescript
// DB table: "transmission_identity_cache"
id,
oem: string,
normalizedOem: string,    // unique index; Step 5: "tc:<UPPER>" | "pn:<UPPER>" (legacy: plain UPPER)
modelName: string | null, // рыночное название, напр. "JF011E"
manufacturer: string | null,
origin: string | null,    // "japan" | "europe" | "korea" | "usa" | "unknown"
confidence: string,       // "high" | "medium" | "low"
hitCount: number,
lastSeenAt, createdAt, expiresAt

export type TransmissionIdentityCache = typeof transmissionIdentityCache.$inferSelect;
export type InsertTransmissionIdentityCache = typeof transmissionIdentityCache.$inferInsert;
```

### `PriceSnapshot`
Файл: `shared/schema.ts` : 1380 (table), тип : 1421

```typescript
// DB table: "price_snapshots"
// tenantId = null → глобальный кеш (7-дневный TTL, общий для всех тенантов)
id,
tenantId: string | null,
oem: string,
source: "internal"|"avito"|"drom"|"web"|"openai_web_search"|"not_found"|"mock"|"yandex"|"ai_estimate",
currency: string,
minPrice, maxPrice, avgPrice: number | null,
marketMinPrice, marketMaxPrice, marketAvgPrice: number | null,
salePrice: number | null,
marginPct: number,
searchKey: string | null, // Step 6: prefixed "tc::<v>::<make>::<model>" or "pn::<v>..."; legacy: "oem::make::model"
modelName: string | null, // напр. "JATCO JF011E"
manufacturer: string | null,
origin: string | null,
mileageMin, mileageMax: number | null,
listingsCount: number,
searchQuery: string | null,
expiresAt: timestamp | null,
stage: string | null,     // "yandex" | "escalation" | "not_found"
urls: string[] | null,
domains: string[] | null,
raw: jsonb,
createdAt

export type PriceSnapshot = typeof priceSnapshots.$inferSelect;
export type InsertPriceSnapshot = typeof priceSnapshots.$inferInsert;
```

### `PriceLookupJobData` (payload очереди)
Файл: `server/services/price-lookup-queue.ts` : 13

```typescript
export interface PriceLookupJobData {
  tenantId: string;
  conversationId: string;
  /** @deprecated Устаревший алиас. Новый код должен использовать transmissionCode или
   *  oemPartNumber. Воркер нормализует это поле при входе, если явные поля не заданы. */
  oem: string | null;            // null → путь searchFallback
  oemModelHint?: string | null;  // валидный рыночный код, пропускает GPT-идентификацию
  vehicleContext?: VehicleContext;
  searchFallback?: SearchFallback;
  isModelOnly?: boolean;         // true → путь VW Group MODEL_ONLY
  /** Код модели КПП: JF011E, 6HP19, A245E — используется как поисковый термин. */
  transmissionCode?: string | null;
  /** Настоящий OEM-номер запчасти: 31020-3VX2D — отличается от кода модели. */
  oemPartNumber?: string | null;
}

export interface SearchFallback {
  make: string | null;
  model: string | null;
  gearboxType: GearboxType;      // "акпп"|"мкпп"|"вариатор"|"dsg"|"ркпп"|"unknown"
  gearboxModel: string | null;
}
```

**Семантика новых полей:**

| Поле | Пример | Описание |
|---|---|---|
| `transmissionCode` | `JF011E`, `6HP19`, `A245E` | Рыночный код модели КПП — используется в поиске на маркетплейсах контрактных КПП |
| `oemPartNumber` | `31020-3VX2D` | OEM-номер детали, выданный автопроизводителем — идентифицирует конкретный SKU, а не семейство КПП |
| `oem` | любое | Устаревший алиас. Сохранён для обратной совместимости. Воркер автоматически переводит его в `transmissionCode` или `oemPartNumber`. |

### `VehicleLookupJobData` (payload очереди)
Файл: `server/services/vehicle-lookup-queue.ts` : 4

```typescript
export interface VehicleLookupJobData {
  caseId: string;           // FK → vehicle_lookup_cases.id
  tenantId: string;
  conversationId: string;
  idType: "VIN" | "FRAME";
  normalizedValue: string;  // uppercase, trimmed
}
```

### `TransmissionIdentification` (output GPT)
Файл: `server/services/transmission-identifier.ts` : 19

```typescript
export interface TransmissionIdentification {
  modelName: string | null;
  manufacturer: string | null;
  origin: "japan" | "europe" | "korea" | "usa" | "unknown";
  confidence: "high" | "medium" | "low";
  notes: string;
}
```

### `GearboxType`
Файл: `server/services/price-sources/types.ts` : 27

```typescript
export type GearboxType = "акпп" | "мкпп" | "вариатор" | "dsg" | "ркпп" | "unknown";
```

### `GearboxKind` (canonical bridge type) — добавлено в Step 3
Файл: `server/services/gearbox/gearbox-kind.ts`

```typescript
export type GearboxKind = "AT" | "MT" | "CVT" | "DCT" | "AMT" | "UNKNOWN";
```

Служит мостом между двумя несовместимыми представлениями. Используйте конвертеры при пересечении границы между `VehicleContext.gearboxType` и `SearchFallback.gearboxType`.

**Таблица конверсий:**

| `VehicleContext.gearboxType` | `GearboxKind` | `GearboxType` (price-search) | `toHumanRu()` |
|---|---|---|---|
| `"AT"` | `"AT"` | `"акпп"` | `"АКПП"` |
| `"MT"` | `"MT"` | `"мкпп"` | `"МКПП"` |
| `"CVT"` | `"CVT"` | `"вариатор"` | `"вариатор"` |
| `null` / unknown | `"UNKNOWN"` | `"unknown"` | `"КПП"` |
| *(нет в VehicleContext)* | `"DCT"` | `"dsg"` | `"DSG"` |
| *(нет в VehicleContext)* | `"AMT"` | `"ркпп"` | `"РКПП"` |

---

## 5. Важное: двойственность типов GearboxType

В кодовой базе существуют **два разных** типа для КПП:

| Контекст | Значения | Источник |
|---|---|---|
| `GearboxType` (price-sources/types.ts) | `"акпп"` `"мкпп"` `"вариатор"` `"dsg"` `"ркпп"` `"unknown"` | `detectGearboxType()` из текста клиента |
| `VehicleContext.gearboxType` | `"AT"` `"MT"` `"CVT"` | Парсинг PartsAPI `modifikaciya`/`kpp`/`opcii` |

Эти типы **не взаимозаменяемы**. Для конверсии между ними используется канонический тип `GearboxKind` и хелперы из `server/services/gearbox/gearbox-kind.ts` — см. таблицу конверсий в разделе 4 и историю изменений в разделе 8.

---

## 6. Transmission Identifier Refactor — Version 2 (2026-02-26)

### Что изменилось в Step 1

| Файл | Изменение |
|---|---|
| `server/services/price-lookup-queue.ts` | Добавлены поля `transmissionCode` и `oemPartNumber` в `PriceLookupJobData`; поле `oem` помечено как `@deprecated` |
| `server/workers/price-lookup.worker.ts` | Добавлен слой нормализации в начале `processPriceLookup()`: выводит `transmissionCode`/`oemPartNumber` из устаревшего `oem` |
| `server/workers/vehicle-lookup.worker.ts` | High-confidence Podzamenu путь теперь явно передаёт `oemPartNumber` и `transmissionCode` |
| `server/services/inbound-message-handler.ts` | Оба пути прямого обнаружения КПП (текст + OCR gearbox_tag) теперь явно передают `transmissionCode` |
| `server/services/transmission-identifier.ts` | Добавлен module-level комментарий с объяснением терминологии и планируемого разделения функции |

### Ключевые принципы Step 1

- **Обратная совместимость полная** — все существующие вызовы с `oem` продолжают работать без изменений.
- **Без изменений DB-схемы** — колонки `oem` в таблицах `price_snapshots`, `transmission_identity_cache`, `internalPrices` не затронуты.
- **Без переименований** — функции, queue names, cache keys не изменены.
- **Нормализация только на входе в воркер** — бизнес-логика `lookupPricesByOem` и `lookupPricesByFallback` по-прежнему использует `oem`.

### Что изменилось в Step 2

| Файл | Изменение |
|---|---|
| `server/services/detection/candidate-detector.ts` | **Новый файл.** Кандидатный пайплайн: типы, скоринг, extraction, `chooseBestCandidate` |
| `server/services/inbound-message-handler.ts` | Роутинг в `processIncomingMessageFull()` заменён на 12-шаговый кандидатный пайплайн; `detectVehicleIdFromText` и `detectGearboxMarkingFromText` стали тонкими обёртками |
| `server/services/__tests__/candidate-detector.test.ts` | **Новый файл.** Unit-тесты для всех чистых функций detection модуля |

### Ключевые принципы Step 2

- **Детекция отделена от роутинга** — `candidate-detector.ts` не знает ни о DB, ни об очередях, ни о suggestions.
- **Скоринг вместо первого совпадения** — каждый кандидат получает score 0..1 с явными `reasons`.
- **Conflict resolution** — два разных VIN/FRAME с score ≥ 0.80 вызывают clarification suggestion вместо молчаливого выбора первого.
- **OCR quality gate** — gearbox_tag с кодом короче 5 символов или < 70% alnum символов отклоняется; пользователю предлагается прислать более чёткое фото.
- **Check-digit gate (ISO 3779)** — checksum валидируется только когда `vin[8]` является цифрой или `X`; европейские/японские VIN с буквой на позиции 9 получают базовый score 0.80 без штрафа.
- **Слабые коды требуют контекста** — код класса «weak» (01M, DP0, 09G и т.п.) принимается только если в радиусе 50 символов есть ключевые слова КПП; без контекста score = 0.20 (игнорируется роутером).
- **Без изменений DB-схемы** — колонки, queue payload (кроме уже добавленных в Step 1 `transmissionCode`/`oemPartNumber`) и cache keys не затронуты.
- **Без изменений очередей** — `enqueuePriceLookup` по-прежнему получает `{ transmissionCode, oem }` (Step 1 структура).

### Ограничения (известные, Step 2)

- **Transmission code extractor возвращает только один кандидат** (highest-score) — multi-code conflict detection для кодов КПП не реализован. Если в тексте несколько кодов, возвращается лучший по score.
- Conflict detection работает только для VIN и FRAME (score ≥ 0.80). Конфликты между transmission codes не обнаруживаются.

### Следующие шаги (запланировано)

- **Step 3:** ~~Передавать `transmissionCode` внутри воркера в `lookupPricesByOem()` вместо `oem`, когда поле явно задано.~~ → **Выполнено в рамках Step 3 (Unify GearboxType Systems) — см. раздел 8.**
- **Step 4:** ~~Разделить `identifyTransmissionByOem()` на два метода: один для кода модели КПП, другой для OEM part number.~~ → **Выполнено — см. раздел 9.**
- **Step 5:** ~~Обновить cache key с учётом явного разделения полей.~~ → **Выполнено — см. раздел 10.**
- **Step 6:** ~~Price Snapshot Cache Key Isolation.~~ → **Выполнено — см. раздел 11.**

---

## 7. Step 2 — Identifier Detection Refactor (2026-02-26)

### Обзор

До Step 2 `processIncomingMessageFull()` использовал последовательный подход «первое совпадение побеждает»:
VIN → FRAME → OCR → `detectGearboxMarkingFromText` → `detectGearboxType` → fallback.

Это приводило к ложным срабатываниям на коротких кодах (01M, 6HP19 без контекста), невозможности обработать ситуацию «два VIN в одном сообщении» и применению OCR-результатов низкого качества без проверки.

Step 2 заменяет этот подход на трёхфазный кандидатный пайплайн.

### Новый модуль: `server/services/detection/candidate-detector.ts`

Только чистые функции. Нет зависимостей от DB, BullMQ, storage или любого IO.

#### Тип `DetectionCandidate`

```typescript
type CandidateType =
  | "VIN" | "FRAME" | "TRANSMISSION_CODE" | "GEARBOX_TYPE"
  | "OCR_VIN" | "OCR_FRAME" | "OCR_TRANSMISSION_CODE";

interface DetectionCandidate {
  type:    CandidateType;
  value:   string;      // normalized / autocorrected
  raw:     string;      // original substring
  score:   number;      // 0..1
  reasons: string[];    // e.g. ["checksum_valid", "context:vin"]
  source:  "text" | "ocr";
  meta?: {
    autocorrectEdits?: number;
    ocrConfidence?:   number;
    contextHits?:     string[];
    isIncompleteVin?: boolean;
  };
}
```

#### Скоринговая таблица

| Тип кандидата | Базовый score | Условие |
|---|---|---|
| VIN — checksum valid | 0.90 | `vin[8]` is digit/X (ISO 3779), checksum passes |
| VIN — 1 autocorrect edit | 0.85 | `tryAutoCorrectVin` сделал 1 подстановку |
| VIN — checksum invalid, uncorrectable | 0.25 | Checksum fails, single-char fix невозможен |
| VIN — no checksum applicable | 0.80 | `vin[8]` is letter (European/Asian VIN) |
| FRAME with dash | 0.85 | Pattern `[A-Z0-9]{3,6}-[0-9]{4,8}` |
| FRAME dashless | 0.80 | Pattern `[A-Z]{2,5}[0-9]{6,10}`, length 8–14 |
| OCR VIN/FRAME | ≤ 0.85 | Через `extractCandidatesFromOcr`, кап 0.85 |
| TRANSMISSION_CODE strong | 0.70 | Совпадает со strong OEM паттерном, длина ≥ 4 |
| TRANSMISSION_CODE strong + context | 0.75 | +0.05 при наличии ключевых слов КПП |
| TRANSMISSION_CODE weak + context | 0.55 | Требует ключевые слова в радиусе 50 символов |
| TRANSMISSION_CODE weak, no context | 0.20 | Игнорируется роутером |
| OCR gearbox_tag (strong) | 0.75 | После quality gate |
| GEARBOX_TYPE keyword | 0.30 | Из `detectGearboxType()` |
| Incomplete VIN (16 chars) | 0.15 | Флаг `meta.isIncompleteVin = true` |

**Context boost:** +0.05 за каждое ключевое слово, максимум +0.10. Применяется к VIN, FRAME и strong TC.

**VIN context keywords:** `vin`, `вин`, `vin:`, `номер кузова`, `рама`, `стс`, `sts`

**FRAME context keywords:** `frame`, `рама`, `кузов`, `номер кузова`

**Gearbox context keywords:** `акпп`, `кпп`, `короб`, `вариатор`, `trans`, `gearbox`, `automatic`, `dsg`

#### Check-digit validation gate (ISO 3779)

```
if vin[8].match(/[0-9X]/i):
  apply isValidVinChecksum()
  if fails → tryAutoCorrectVin() → score 0.85 (1 edit) or 0.25 (uncorrectable)
else:
  // European/Asian VIN — no standard check digit at pos 9
  score = 0.80  (no penalty)
```

Символы I, O, Q после нормализации → кандидат отклоняется (невалидные VIN символы по ISO 3779).

#### OCR quality gate

```typescript
// gearbox_tag code rejected if:
code.length < 5
OR  alnum_chars / code.length < 0.70
```

При провале gate: `extractCandidatesFromOcr` возвращает `[]`. Роутер создаёт suggestion «пришлите чёткое фото».

#### Слабые vs. сильные коды КПП

| Класс | Паттерн | Примеры | Standalone? |
|---|---|---|---|
| **strong** | Существующий OEM паттерн, длина ≥ 4 | `A245E`, `JF011E`, `RE4F04A`, `6HP19`, `NAG1` | Да (score 0.70+) |
| **weak** | `[0-9]{1,2}[A-Z]{1,3}[0-9]{0,4}` или `[A-Z]{2,4}[0-9]{1,2}` | `01M`, `09G`, `0AM`, `DP0` | Нет — требует gearbox context |

Строки, соответствующие паттерну OEM part number (`^\d{4,6}-\d{4,6}`), отклоняются на любом уровне.

#### `chooseBestCandidate` — логика выбора и конфликтов

```
1. Отделить incomplete VINs (meta.isIncompleteVin) от обычных кандидатов.
2. Отсортировать обычные по score DESC, при равенстве — по TYPE_PRIORITY DESC.
   TYPE_PRIORITY: VIN=10, FRAME=9, OCR_VIN=8, OCR_FRAME=7,
                  TRANSMISSION_CODE=6, OCR_TRANSMISSION_CODE=5, GEARBOX_TYPE=1
3. Conflict detection:
   - ≥2 VIN/OCR_VIN с score ≥ 0.80 И разными values → conflicts["multiple_vin:V1|V2"]
   - ≥2 FRAME/OCR_FRAME с score ≥ 0.80 И разными values → conflicts["multiple_frame:F1|F2"]
4. Если есть VIN/FRAME с score ≥ 0.80 → он становится best; TRANSMISSION_CODE уходит в alternates.
5. Иначе → first of sorted list.
```

**VIN + FRAME**: конфликт не объявляется; VIN побеждает по TYPE_PRIORITY (10 > 9).

### Routing в `processIncomingMessageFull()` (обновлён в Step 2)

```
Score threshold → Action
──────────────────────────────────────────────────────
best: VIN/FRAME/OCR_VIN/OCR_FRAME, score ≥ 0.80
  → createVehicleLookupCase + enqueueVehicleLookup
  → suggestion: gearboxTagRequest (или registration_doc ack)

best: TRANSMISSION_CODE/OCR_TRANSMISSION_CODE, score ≥ 0.70
  → enqueuePriceLookup({ transmissionCode: best.value, oem: best.value })

best: GEARBOX_TYPE
  → suggestion: gearboxNoVin

best: TRANSMISSION_CODE, score 0.55..0.69
  → suggestion: weak code clarification (подтвердить маркировку, попросить VIN)

conflicts present (any)
  → suggestion: conflict clarification (перечислить VIN/FRAME, спросить какой верный)

meta.isIncompleteVin = true
  → suggestion: INCOMPLETE_VIN_REPLY

ocrQualityGateFailed AND no best
  → suggestion: «пришлите чёткое фото»

no candidate / score < threshold
  → triggerAiSuggestion()
```

### Ключи suggestion templates (не изменились)

| Ключ | Триггер |
|---|---|
| `gearboxTagRequest` | VIN/FRAME обнаружен, запрашивается фото таблички |
| `gearboxNoVin` | Только тип КПП без VIN/FRAME |
| `vehicle_id_request` (intent) | Incomplete VIN, conflict clarification |
| `gearbox_tag_request` (intent) | OCR quality fail, weak code clarification, registration_doc |

---

## 8. Step 3 — Unify GearboxType Systems (2026-02-26)

### Проблема

В кодовой базе существовали два несовместимых представления типа КПП без явной конверсии между ними:

| Контекст | Значения | Источник |
|---|---|---|
| `VehicleContext.gearboxType` | `"AT"` `"MT"` `"CVT"` | Парсинг PartsAPI `modifikaciya`/`kpp` / GPT extractor |
| `GearboxType` (price-sources) | `"акпп"` `"мкпп"` `"вариатор"` `"dsg"` `"ркпп"` `"unknown"` | `detectGearboxType()` из текста клиента |

### Что изменилось

| Файл | Изменение |
|---|---|
| `server/services/gearbox/gearbox-kind.ts` | **Новый файл.** Канонический тип `GearboxKind` + 4 конвертера |
| `server/services/__tests__/gearbox-kind.test.ts` | **Новый файл.** Unit-тесты для всех чистых функций конвертации (30+ кейсов) |
| `server/workers/vehicle-lookup.worker.ts` | Импорт `fromVehicleContextGearboxType` + `toPriceSearchGearboxType`; MODEL_ONLY путь теперь использует `vehicleContext.gearboxType` как fallback через конвертер, когда `detectGearboxType` возвращает `"unknown"` |

### Точка конверсии в vehicle-lookup.worker.ts

**MODEL_ONLY path** (`processVehicleLookup`, строки ~500–512):

```typescript
// Before:
const gearboxType = lastMessage ? detectGearboxType(lastMessage) : "unknown" as const;

// After:
const detectedFromText = lastMessage ? detectGearboxType(lastMessage) : "unknown" as const;
const gearboxType = detectedFromText !== "unknown"
  ? detectedFromText
  : toPriceSearchGearboxType(fromVehicleContextGearboxType(vehicleContext.gearboxType));
```

`SearchFallback.gearboxType` теперь всегда содержит корректный `GearboxType` ("акпп"/...) — даже когда текст клиента не содержит ключевых слов КПП, парсинг из PartsAPI уже заполнил `vehicleContext.gearboxType`.

### Ключевые принципы Step 3

- **Полная обратная совместимость** — `GearboxType` union в `types.ts` не изменён, `VehicleContext.gearboxType` не переименован, payload очередей не изменён.
- **Без изменений DB-схемы** — ни одна таблица не затронута.
- `price-lookup.worker.ts` и `price-searcher.ts` не изменялись — `pickGearboxLabel` / `resolveGearboxLabel` / `createEscalationSuggestion` корректно читают VehicleContext ("AT"/"MT"/"CVT"); `lookupPricesByFallback` корректно читает `SearchFallback.gearboxType` (`GearboxType`).
- **`tryFallbackPriceLookup`** не изменена — нет `vehicleContext` в параметрах; ранний возврат при `"unknown"` сохранён.

---

## 9. Step 4 — Split Transmission Identification API (2026-02-26)

### Проблема

`identifyTransmissionByOem()` была семантически перегружена: используется и для кодов моделей КПП (`JF011E`, `6HP19`), и — потенциально — для настоящих OEM-номеров запчастей (`31020-3VX2D`). Разделение делает намерение вызывающего кода явным.

### Что изменилось

| Файл | Изменение |
|---|---|
| `server/services/transmission-identifier.ts` | Добавлены `identifyTransmissionByTransmissionCode`, `identifyTransmissionByOemPartNumber`, `classifyOemInput`; тело перенесено в `_identifyTransmissionByInput`; `identifyTransmissionByOem` помечена `@deprecated` |
| `server/workers/price-lookup.worker.ts` | Импортированы новые функции; `lookupPricesByOem` получила параметры `transmissionCode?` и `oemPartNumber?`; идентификация маршрутизируется через `if(transmissionCode) … else if(oemPartNumber) … else legacy`; `processPriceLookup` передаёт оба поля |
| `server/services/__tests__/transmission-identifier.test.ts` | **Новый файл.** Unit-тесты для `classifyOemInput` (только чистые функции, без DB/GPT/network) |

### Ключевые принципы Step 4

- **Без изменений DB-схемы** — ни одна таблица не затронута. Ключ кеша (`normalizedOem`) на момент Step 4 по-прежнему `inputValue.trim().toUpperCase()` *(изменено в Step 5 — см. раздел 10)*.
- ~~**Без изменений cache key format**~~ — `normalizedOem` обновлён в Step 5 до схемы `tc:<UPPER>` / `pn:<UPPER>` с legacy fallback.
- **Полная обратная совместимость** — `identifyTransmissionByOem` сохранена и делегирует к правильному пути через `classifyOemInput`.
- **GPT-промпт не дублируется** — одна внутренняя функция `_identifyTransmissionByInput(inputValue, inputKind, context)`.
- **Маршрутизация воркера** — `lookupPricesByOem` теперь выбирает правильный метод идентификации на основе явных полей job payload; legacy `oem` используется как последний fallback.

### Хьюристика `classifyOemInput`

```
OEM_PART_NUMBER_RE = /\d-|-\d/   (цифра рядом с дефисом)

if OEM_PART_NUMBER_RE.test(oem):
  → "oemPartNumber"   // 31020-3VX2D
else:
  → "transmissionCode"  // JF011E, 6HP19, A245E
```

**Известное ограничение:** коды вида `AW55-51SN` (дефис между `5` и `5`) классифицируются как `oemPartNumber` по этой эвристике. Это известный edge-case, задокументированный в тестах.

### Следующие шаги (запланировано)

- **Step 5:** ~~Обновить cache key с учётом явного разделения полей (`transmissionCode::` / `oem::` prefix).~~ → **Выполнено — см. раздел 10.**
- **Step 6:** ~~Price Snapshot Cache Key Isolation (price_snapshots).~~ → **Выполнено — см. раздел 11.**

---

## 10. Step 5 — Identity Cache Key Prefix (2026-02-26)

### Проблема

До Step 5 оба типа входных данных (`transmissionCode` и `oemPartNumber`) писали в кеш под одним ключом `inputValue.trim().toUpperCase()`. Это могло вызвать коллизию: `JF011E` и теоретически совпадающий part number сохранялись под идентичным ключом.

### Что изменилось

| Файл | Изменение |
|---|---|
| `server/services/transmission-identifier.ts` | Добавлены `TransmissionInputKind` (exported type), `normalizeIdentityInput`, `buildIdentityCacheKey`; `_identifyTransmissionByInput` обновлена: prefixed-key read, legacy fallback, soft-migration upsert, prefixed-key write |
| `server/services/__tests__/transmission-identifier.test.ts` | Добавлены тесты для `normalizeIdentityInput`, `buildIdentityCacheKey` и round-trip (15+ кейсов) |

### Новые экспорты

| Функция / тип | Сигнатура | Описание |
|---|---|---|
| `TransmissionInputKind` | `"transmissionCode" \| "oemPartNumber"` | Exported type (ранее только внутренний `InputKind`) |
| `normalizeIdentityInput(value)` | `string → string` | Trim, uppercase, collapse spaces; dashes preserved |
| `buildIdentityCacheKey(kind, normalized)` | `(TransmissionInputKind, string) → string` | Returns `"tc:<normalized>"` or `"pn:<normalized>"` |

### Схема ключей

```
transmissionCode → normalizedOem = "tc:<NORMALIZED>"   // напр. "tc:JF011E"
oemPartNumber    → normalizedOem = "pn:<NORMALIZED>"   // напр. "pn:31020-3VX2D"
```

### Порядок чтения кеша

```
1. primaryKey = buildIdentityCacheKey(kind, normalizeIdentityInput(inputValue))
2. storage.getTransmissionIdentity(primaryKey)  // ← новый prefixed ключ
3. Если промах → storage.getTransmissionIdentity(normalized)  // ← legacy ключ (без prefix)
4. Если legacy hit:
   a. storage.incrementTransmissionIdentityHit(normalized)
   b. best-effort upsert: storage.saveTransmissionIdentity({ normalizedOem: primaryKey, ... })
      // soft-migration — legacy строка НЕ удаляется
   c. Вернуть результат из legacy строки
5. Промах обоих → GPT lookup
```

### Запись в кеш

Новые GPT-результаты всегда записываются под `primaryKey` (prefixed). Устаревший plain-normalized ключ больше не создаётся.

### Ключевые принципы Step 5

- **Без изменений DB-схемы** — колонка `normalizedOem` продолжает хранить строку; unique index не изменён.
- **Полная обратная совместимость** — существующие legacy строки в кеше продолжают отдавать результаты через fallback lookup.
- **Soft-migration** — реализована как best-effort upsert на legacy hit; не блокирует основной флоу при ошибке.
- **`classifyOemInput` не изменена** — routing heuristic Step 4 работает идентично.
- **`identifyTransmissionByOem`** (deprecated) продолжает работать — делегирует к `_identifyTransmissionByInput` с правильным `kind`.
- **Scope** — только `transmission-identifier.ts`; `price-lookup.worker.ts` и другие файлы не затронуты.

---

## 11. Step 6 — Price Snapshot Cache Key Isolation (2026-02-26)

### Проблема

До Step 6 `price_snapshots.searchKey` строился как `buildCacheKey(oem, make, model)` → `"oem::make::model"` (lowercase). Поле `oem` не несло информации о том, что именно в нём лежит — код модели КПП (`JF011E`) или OEM-номер запчасти (`31020-3VX2D`). Это могло приводить к некорректному переиспользованию снапшотов.

### Что изменилось

| Файл | Изменение |
|---|---|
| `server/workers/price-lookup.worker.ts` | Добавлены `normalizePriceKeyValue`, `buildPriceSnapshotKey`; обновлены read/write пути в `lookupPricesByOem` |

### Новые хелперы

| Функция | Сигнатура | Описание |
|---|---|---|
| `normalizePriceKeyValue(value)` | `string → string` | Trim, lowercase, collapse spaces — зеркалит нормализацию legacy `buildCacheKey` |
| `buildPriceSnapshotKey(kind, normalizedValue, make?, model?)` | `(kind, string, ...) → string` | Возвращает `"tc::<v>::<make>::<model>"` или `"pn::<v>::<make>::<model>"` |

### Схема ключей

```
transmissionCode → searchKey = "tc::<normalized>::<make>::<model>"   // напр. "tc::jf011e::nissan::x-trail"
oemPartNumber    → searchKey = "pn::<normalized>::<make>::<model>"   // напр. "pn::31020-3vx2d::nissan::x-trail"
```

### Порядок чтения снапшота

```
1. keyKind = transmissionCode ? "transmissionCode" : oemPartNumber ? "oemPartNumber" : null
2. prefixedKey = keyKind ? buildPriceSnapshotKey(keyKind, normalize(value), make, model) : null
3. legacyCacheKey = buildCacheKey(oem, make, model)  // старый формат
4. writeKey = prefixedKey ?? legacyCacheKey

5. Если prefixedKey → storage.getGlobalPriceSnapshot(prefixedKey)
   - hit → cacheHit="prefixed", вернуть снапшот
6. Если промах → storage.getGlobalPriceSnapshot(legacyCacheKey)
   - hit → cacheHit="legacy", вернуть снапшот
   - Если prefixedKey задан → soft-migrate: createPriceSnapshot({ searchKey: prefixedKey, ...поля из legacy снапшота })
     - Non-fatal: обёрнуто в try/catch; legacy строка НЕ удаляется
7. cacheHit="miss" → стандартный поиск + запись под writeKey
```

### Запись снапшота

Оба пути записи в `lookupPricesByOem` (ai_estimate + основной) используют `searchKey: writeKey` (= prefixed, если вид известен; иначе legacy).

### Ключевые принципы Step 6

- **Без изменений DB-схемы** — колонка `searchKey` продолжает хранить строку; тип не изменён.
- **Полная обратная совместимость** — legacy строки `"oem::make::model"` продолжают отдаваться через fallback lookup.
- **Soft-migration** — best-effort upsert prefixed строки на legacy hit; не блокирует основной флоу.
- **TTL и expiresAt не изменены** — логика истечения срока хранится в поле `expiresAt`; soft-migrate копирует его из оригинального снапшота.
- **Queue payload не изменён** — `PriceLookupJobData` не затронут.
- **`lookupPricesByFallback` не изменена** — использует отдельный `buildFallbackSearchKey`, не относящийся к OEM-пути.
- **Scope** — только `price-lookup.worker.ts`; `transmission-identifier.ts` и другие файлы не затронуты.

---

## 12. Step 7 — Observability & Legacy-hit metrics (2026-02-26)

### Проблема

До Step 7 единственным способом наблюдения за пайплайном были `console.log`. Не было возможности:
- измерить hit-rate кешей identity и price-snapshot;
- понять, насколько часто срабатывает legacy-fallback и soft-migration;
- видеть распределение исходов детекции (VIN vs TC vs GEARBOX_TYPE vs conflict).

### Что изменилось

| Файл | Изменение |
|---|---|
| `server/services/observability/metrics.ts` | **Новый файл.** No-op фасад `incr` / `timing` с типом `MetricTags`. Реальный бекенд подключается заменой тел функций без изменения call-sites. |
| `server/services/inbound-message-handler.ts` | Импорт `incr`; счётчики детекции после `chooseBestCandidate`; branch-счётчики для каждой ветки роутинга |
| `server/services/transmission-identifier.ts` | Импорт `incr`; счётчики identity cache hit/miss/soft-migration + structured debug logs |
| `server/workers/price-lookup.worker.ts` | Импорт `incr`; счётчики price cache hit/miss/soft-migration + structured debug logs |

### Metrics helper API

Файл: `server/services/observability/metrics.ts`

```typescript
// All tag values MUST be low-cardinality enum-like literals.
// Raw VINs, cache keys, OEM strings, and user-supplied values
// are NEVER permitted as tag values — see Privacy section below.
type MetricTags = Record<string, string | number | boolean | null | undefined>;

// Increment a counter by 1.
// name: dot-namespaced, e.g. "detector.candidates_total"
function incr(name: string, tags?: MetricTags): void   // default: no-op

// Record a duration in milliseconds.
function timing(name: string, ms: number, tags?: MetricTags): void  // default: no-op
```

Реальный бекенд подключается заменой тел `incr` / `timing` — все call-sites остаются неизменными.

### Метрики (полный список)

#### Step 2 Detection (`server/services/inbound-message-handler.ts`)

| Метрика | Теги | Точка эмиссии |
|---|---|---|
| `detector.candidates_total` | `count: number` | После `chooseBestCandidate` — всегда |
| `detector.best` | `type` (CandidateType), `source` (`text`/`ocr`), `score_bucket` (`>=0.8`/`0.55-0.79`/`<0.55`) | После `chooseBestCandidate`, если `best` не null |
| `detector.ocr_rejected` | — | OCR quality gate failed, нет `best` (ветка 5) |
| `detector.incomplete_vin` | — | `best.meta.isIncompleteVin === true` (ветка 6) |
| `detector.conflict` | `kind` (`multiple_vin`/`multiple_frame`/`unknown`) | По одному на каждый элемент `conflicts[]` (ветка 7) |
| `detector.route_vehicle_lookup` | `idType` (`VIN`/`FRAME`) | Перед `enqueueVehicleLookup` (ветка 8) |
| `detector.route_price_lookup` | `kind` (`transmissionCode`) | Перед `enqueuePriceLookup` (ветка 9) |
| `detector.route_no_vin` | — | `best.type === "GEARBOX_TYPE"` (ветка 10) |
| `detector.weak_tc_clarification` | — | TC score 0.55–0.69, clarification suggestion (ветка 11) |

#### Step 5 Identity Cache (`server/services/transmission-identifier.ts`)

Эмитируется внутри `_identifyTransmissionByInput()`.

| Метрика | Теги | Точка эмиссии |
|---|---|---|
| `identity_cache.hit` | `key` (`prefixed`/`legacy`), `kind` (`transmissionCode`/`oemPartNumber`) | Prefixed key hit (шаг 3) / legacy key hit (шаг 4) |
| `identity_cache.miss` | `kind` | Оба ключа дали промах → вызов GPT (шаг 6) |
| `identity_cache.soft_migration` | `result` (`success`/`fail`), `kind` | Попытка upsert prefixed строки при legacy hit (шаг 5) |

Рядом с каждым `incr` добавлен `console.log` с JSON `{ kind, cacheHit, keyHint }`, где `keyHint` — только `prefix + "..." + last4` форма ключа (например `"tc:...011E"`).

#### Step 6 Price Snapshot Cache (`server/workers/price-lookup.worker.ts`)

Эмитируется внутри `lookupPricesByOem()`.

| Метрика | Теги | Точка эмиссии |
|---|---|---|
| `price_cache.hit` | `key` (`prefixed`/`legacy`), `kind` (`transmissionCode`/`oemPartNumber`/`unknown`) | Prefixed key hit / legacy key hit |
| `price_cache.miss` | `kind` | Оба ключа дали промах → поиск цены |
| `price_cache.soft_migration` | `result` (`success`/`fail`), `kind` | Попытка upsert prefixed snapshot при legacy hit |

Аналогично: рядом с каждым `incr` добавлен `console.log` с JSON `{ kind, cacheHit }`.

### Privacy & cardinality rules

| Правило | Детали |
|---|---|
| VIN никогда не попадает в теги | VIN маскируется в `console.log` через `maskCandidateValue()` / `maskVin()`; в тегах метрик VIN не используется |
| Кэш-ключи не попадают в теги | В structured logs показывается только `keyHint` (`prefix + ...lastN`), не полный ключ |
| Имена моделей не попадают в теги | Теги содержат только enum-подобные значения: `type`, `kind`, `source`, `score_bucket`, `result`, `key` |
| OEM-строки не попадают в теги | `kind` = `"transmissionCode"` или `"oemPartNumber"` — описание типа, не значение |
| `MetricTags` — только low-cardinality | Не более ~10 возможных значений на тег; нарушения фиксируются code review |

### Ключевые принципы Step 7

- **Без изменений бизнес-логики** — только наблюдение; никаких изменений условий роутинга, очередей, DB-схемы.
- **No-op по умолчанию** — новые зависимости от внешних систем не вносятся; production-трафик не затрагивается.
- **Structured debug logs** — `console.log` с JSON `{ kind, cacheHit[, keyHint] }` для корреляции с application logs без внешней системы.
- **Scope** — 3 существующих файла + 1 новый; тесты, schema, queue payload не затронуты.
- **Итого метрик:** 15 (9 detector + 3 identity cache + 3 price cache).

---

## 13. Step 8 — Yandex Anchor Selection Refactor (2026-02-27)

### Проблема

`buildYandexQueries()` всегда использовал `oem` как главный поисковый якорь в Q1/Q2:
```
Q1: `${label} ${oem} купить`
Q2: `${label} ${make} ${model} ${oem} контрактная`
```
Для PN-входов (e.g. `31020-3VX2D`) это плохо: маркетплейсы публикуют объявления по рыночным кодам (`JF011E`), поэтому Yandex-стадия часто не давала достаточно листингов и передавала управление GPT. GPT query builders уже использовали `resolveSearchTerm(oem, modelName)` — Yandex не использовал.

### Цель

При включённом feature flag `YANDEX_PREFER_MODELNAME` (default: OFF):
- Q1 использует `modelName` как якорь, если он является валидным рыночным кодом.
- Q2 добавляет `oem` (PN) как вторичный токен, чтобы объявления с номером запчасти всё равно находились.
- Если modelName невалиден или flag выключен — поведение идентично pre-Step-8.

### Что изменилось

| Файл | Изменение |
|---|---|
| `shared/schema.ts` | Добавлен `"YANDEX_PREFER_MODELNAME"` в `FEATURE_FLAG_NAMES` |
| `server/services/feature-flags.ts` | Добавлена запись `YANDEX_PREFER_MODELNAME` в `DEFAULT_FLAGS` (`enabled: false`) |
| `server/services/price-searcher.ts` | Новые типы, хелперы, обновлены `buildYandexQueries` / `searchWithYandex` / `searchUsedTransmissionPrice` |
| `server/workers/price-lookup.worker.ts` | Call-site `searchUsedTransmissionPrice` передаёт `opts.inputKind` |
| `server/services/__tests__/price-searcher-yandex-anchor.test.ts` | **Новый файл.** Unit-тесты (50+ кейсов) |

### Новые типы и интерфейсы (`price-searcher.ts`)

```typescript
// Вид входного идентификатора — передаётся из воркера в searcher
export type PriceSearchInputKind = "transmissionCode" | "oemPartNumber" | "legacy";

// Опциональный 7-й аргумент searchUsedTransmissionPrice
export interface PriceSearchOpts {
  inputKind?: PriceSearchInputKind;  // default: "legacy"
  inputValue?: string;               // нормализованное исходное значение (TC или PN)
}
```

### Новые helper-функции (`price-searcher.ts`)

| Функция | Сигнатура | Описание |
|---|---|---|
| `isValidMarketModelName(modelName)` | `(string \| null \| undefined) → boolean` | Возвращает `true`, если `modelName` является валидным рыночным кодом (не каталожным, не type-label, не длиннее 12 символов, не содержит 4+ цифр подряд). Зеркалит `isValidTransmissionModel` из воркера. |
| `selectYandexAnchor(oem, modelName, inputKind)` | `(string, string \| null \| undefined, PriceSearchInputKind) → string` | Политика выбора якоря: PN + valid modelName → `modelName`; TC/legacy + valid modelName ≠ oem → `modelName`; иначе → `oem`. |

### Обновлённые сигнатуры

**`buildYandexQueries`** (теперь экспортирован):
```typescript
export function buildYandexQueries(
  oem: string,
  modelName: string | null,
  make?: string | null,
  model?: string | null,
  gearboxType?: string | null,
  opts?: { inputKind?: PriceSearchInputKind; flagEnabled?: boolean }  // NEW
): string[]
```

**`searchWithYandex`**:
```typescript
export async function searchWithYandex(
  oem, modelName, make?, model?, gearboxType?,
  opts?: { inputKind?, flagEnabled? }  // NEW
): Promise<...>
```

**`searchUsedTransmissionPrice`**:
```typescript
export async function searchUsedTransmissionPrice(
  oem, modelName, origin, make?, vehicleContext?, tenantId?,
  opts?: PriceSearchOpts  // NEW — 7-й аргумент, опциональный
): Promise<PriceSearchResult>
```
Обратная совместимость: все существующие call-sites, передающие 4–6 аргументов, работают без изменений (`opts` → `undefined` → `inputKind: "legacy"`, flag → `false`).

### Логика генерации запросов

#### Flag OFF (default) — поведение идентично pre-Step-8

```
Q1: `${label} ${oem} купить`
Q2: `${label} ${make} ${model} ${oem} контрактная`   (если make+model)
    `${label} ${make} ${oem} контрактная`             (если только make)
Q3: `${label} ${modelName} ${make} купить`            (если modelName valid и ≠ oem)
Q4: `${label} ${modelName} цена`                      (если modelName valid и ≠ oem)
```

#### Flag ON, PN вход + valid modelName (e.g. oem="31020-3VX2D", modelName="JF011E")

```
Q1: `${label} JF011E купить`                                          ← якорь = modelName
Q2: `${label} NISSAN QASHQAI JF011E 31020-3VX2D контрактная`         ← PN добавлен вторичным токеном
Q3: `${label} JF011E NISSAN купить`                                   (если не совпадает с Q1)
Q4: `${label} JF011E цена`
```

#### Правило дедупликации Q3/Q4

Q3 и Q4 исключаются из вывода, если совпадают с уже добавленными Q1/Q2 (применяется строгое сравнение строк). Максимум 4 запроса — slice(0, 4).

### Обновление call-site в воркере

```typescript
// server/workers/price-lookup.worker.ts  — lookupPricesByOem()
const searchInputKind =
  transmissionCode ? "transmissionCode" :
  oemPartNumber    ? "oemPartNumber"    : "legacy";

await searchUsedTransmissionPrice(oem, identification.modelName, ..., tenantId, {
  inputKind: searchInputKind,
  inputValue: transmissionCode ?? oemPartNumber ?? oem,
});
```

### Новые метрики (`price-searcher.ts`)

| Метрика | Теги | Точка эмиссии |
|---|---|---|
| `price_search.anchor_selected` | `anchor` (`oem`/`modelName`), `kind` (`transmissionCode`/`oemPartNumber`/`legacy`), `stage` (`yandex`) | Перед вызовом `searchWithYandex` в `searchUsedTransmissionPrice` |
| `price_search.yandex.query_count` | `kind` | После вызова `searchWithYandex` |

**Итого метрик Step 8:** 2 (+ 15 из Step 7 = 17 всего).

### Feature flag: `YANDEX_PREFER_MODELNAME`

| Параметр | Значение |
|---|---|
| Имя | `YANDEX_PREFER_MODELNAME` |
| Default | `false` (OFF) |
| Scope | Per-tenant через `featureFlagService.isEnabled(name, tenantId)` |
| Где читается | `searchUsedTransmissionPrice()` — один раз за вызов, до Yandex-стадии |
| Rollout | Включить на одном тенанте, убедиться в росте Yandex hit-rate, затем глобально |

### Валидационные правила `isValidMarketModelName`

| Правило | Пример отклонения | Пример принятия |
|---|---|---|
| `!modelName` → false | `null`, `""` | — |
| В `GEARBOX_TYPE_STRINGS` → false | `"AT"`, `"CVT"`, `"АКПП"` | — |
| `length > 12` → false | `"ABCDEFGHIJKLM"` | — |
| `/\d{4,}/` → false (каталожный код) | `"2500A230"`, `"31020-3VX2D"` | — |
| Не совпадает `/^[A-Z0-9][A-Z0-9\-()]{1,11}$/` → false | `"кпп"` | — |
| Проходит все → true | — | `"JF011E"`, `"W5MBB"`, `"AW55-51SN"`, `"FAU(5A)"` |

### Тесты

**Файл:** `server/services/__tests__/price-searcher-yandex-anchor.test.ts`

| Группа | Кейсов | Описание |
|---|---|---|
| `isValidMarketModelName` | 16 | Валидные коды, каталожные коды, type-labels, edge cases |
| `selectYandexAnchor — PN` | 4 | PN + valid, PN + null, PN + catalog, PN + type |
| `selectYandexAnchor — TC` | 3 | TC + different valid, TC + same, TC + invalid |
| `selectYandexAnchor — legacy` | 2 | legacy + different valid, legacy + same |
| `buildYandexQueries — flag OFF` | 7 | Точный snapshot pre-Step-8 поведения |
| `buildYandexQueries — flag ON, PN` | 5 | Q1 якорь, PN в Q2, PN присутствует, no dup, max 4 |
| `buildYandexQueries — flag ON, TC` | 3 | oem=modelName, different valid, invalid |
| `buildYandexQueries — flag ON, invalid modelName` | 3 | null, catalog code, type label |
| `buildYandexQueries — no duplicates` | 5 | Параметризованный инвариант дедупликации |

**Запуск:**
```bash
npx vitest run server/services/__tests__/price-searcher-yandex-anchor.test.ts
```

### Ключевые принципы Step 8

- **Схемы кэш-ключей не изменены** — `tc::<v>::<make>::<model>` и `pn::<v>::<make>::<model>` для price snapshot; `tc:<V>` и `pn:<V>` для identity cache — без изменений.
- **TC/PN семантика не смешивается** — `oem` (PN) появляется только как дополнительный токен в Q2, никогда как замена TC.
- **Полная обратная совместимость** — `opts` опционален везде; flag по умолчанию OFF → вывод идентичен pre-Step-8.
- **DB-схема не изменена** — нет новых колонок, нет новых миграций.
- **Архитектура не упрощена** — все слои (Yandex → GPT fallback → escalation → ai_estimate) сохранены.
- **Feature-flag gated** — новое поведение активируется явно per-tenant через `YANDEX_PREFER_MODELNAME`.
- **Scope** — 4 файла изменены + 1 новый тестовый файл.
