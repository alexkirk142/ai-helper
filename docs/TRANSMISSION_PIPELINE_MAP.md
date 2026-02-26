# Transmission Lookup Pipeline — File Map

> Справочник для имплементационных промптов. Не модифицировать вручную.
> Актуально на: 2026-02-26 (обновлено после Step 3 — Unify GearboxType Systems)

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

| Function | File | Line |
|---|---|---|
| `identifyTransmissionByOem()` | `server/services/transmission-identifier.ts` | 107 |

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
| `searchUsedTransmissionPrice()` | `server/services/price-searcher.ts` | 519 |
| `searchWithYandex()` | `server/services/price-searcher.ts` | 399 |
| `buildPrimaryQuery()` | `server/services/price-searcher.ts` | 106 |
| `buildFallbackQuery()` | `server/services/price-searcher.ts` | 134 |
| `buildYandexQueries()` | `server/services/price-searcher.ts` | 292 |
| `parseListingsFromResponse()` | `server/services/price-searcher.ts` | 233 |
| `parseListingsFromHtml()` | `server/services/price-searcher.ts` | 321 |
| `filterListingsByTitle()` | `server/services/price-searcher.ts` | 387 |
| `removeOutliers()` | `server/services/price-searcher.ts` | 199 |
| `validatePrices()` | `server/services/price-searcher.ts` | 213 |

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

### `server/services/transmission-identifier.ts`
**Exports:** `VehicleContext` (interface), `TransmissionIdentification` (interface), `identifyTransmissionByOem`
**Role:** GPT-4.1 + web_search: конвертирует сырой OEM-код в рыночное название КПП (напр. JF011E). Проверяет/пишет DB-кеш `transmission_identity_cache`.

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
normalizedOem: text("normalized_oem").notNull()  // uppercase, trimmed

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

// price-lookup.worker.ts — ключ кеша:
buildCacheKey(oem, vehicleContext?.make, vehicleContext?.model)
// формат: "oem::make::model" (lowercase)
storage.getGlobalPriceSnapshot(cacheKey)

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
normalizedOem: string,    // unique index
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
searchKey: string | null, // композитный ключ: "oem::make::model" (lowercase)
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
- **Step 4:** Разделить `identifyTransmissionByOem()` на два метода: один для кода модели КПП, другой для OEM part number.
- **Step 5:** Обновить cache key с учётом явного разделения полей.
- **Step 6:** Миграция DB (если потребуется добавить отдельную колонку для part number).

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
