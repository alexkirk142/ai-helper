# Transmission Price System — Implementation Map & Improvement Plan

This document maps the architectural review (algorithm tree A0–E7) to the actual codebase, lists mismatches, and specifies five minimal PRs with file lists, tests, and acceptance criteria. A regression test dataset format and 10 sample cases are in `server/__tests__/fixtures/price-regression-cases.json`.

> **Статус на 2026-02-27:** Yandex Anchor Refactor (Step 8) — реализован. Новый feature flag `YANDEX_PREFER_MODELNAME` (default OFF) + `isValidMarketModelName` + `selectYandexAnchor` + обновлённый `buildYandexQueries`. Call-site воркера передаёт `inputKind`. Подробнее: `docs/TRANSMISSION_PIPELINE_MAP.md` → Section 13.

---

## 1. Node ID → Code Mapping (A0–E7)

| Node ID | File | Function / location | Inputs | Outputs |
|---------|------|---------------------|--------|---------|
| **A0** | `server/services/inbound-message-handler.ts` | Entry: `handleInboundMessage` (or caller that passes `parsed` message) | `ParsedIncomingMessage` (text, attachments) | — |
| **A1** | `server/services/inbound-message-handler.ts` | `detectVehicleIdFromText(text)` (lines 91–140); image path: `analyzeImages` → `imageResult.vin` / `imageResult.frame` | `text: string` (or image URL) | `VehicleIdDetection \| null` (idType, rawValue, normalizedValue) |
| **A2** | `server/services/inbound-message-handler.ts` | After A1: check `vehicleDet && !("isIncompleteVin" in vehicleDet)`; VIN checksum: `isValidVinChecksum`, `tryAutoCorrectVin` (lines 404–412) | `VehicleIdDetection` | boolean (proceed vs incomplete vs no VIN) |
| **A3** | `server/services/inbound-message-handler.ts` | `normalizeVehicleIdText` used inside `detectVehicleIdFromText`; `vehicleDet.normalizedValue` is the normalized value | normalized string | used in B1 |
| **B1** | `server/database-storage.ts` | `createVehicleLookupCase(data, tenantId)` (line 1433) | InsertVehicleLookupCase (tenantId, conversationId, messageId, idType, rawValue, normalizedValue, status, verificationStatus) | `VehicleLookupCase` (row with id) |
| **B2** | `server/services/vehicle-lookup-queue.ts` | `enqueueVehicleLookup(data)` (line 46) | VehicleLookupJobData (caseId, tenantId, conversationId, idType, normalizedValue) | `{ jobId } \| null` |
| **B3** | `server/workers/vehicle-lookup.worker.ts` | `processVehicleLookup`; `lookupByVehicleId({ idType, value: normalizedValue })` (podzamenu-lookup-client.ts:219); `decodeVinPartsApiWithRetry(normalizedValue, partsApiKey)` (partsapi-vin-decoder.ts:81) | idType, normalizedValue | lookupResult (gearbox, vehicleMeta, evidence), partsApi |
| **B4** | `server/workers/vehicle-lookup.worker.ts` | `hasOem = gearbox.oemStatus === "FOUND" && gearbox.oem`; `hasModel = !!gearbox.model`; `if (!hasOem && !hasModel)` → FAILED | gearbox | boolean |
| **B5–B9** | `server/workers/vehicle-lookup.worker.ts` | Build vehicleContext (make, model, year, gearboxType, gearboxModelHint, factoryCode, etc.); parse modifikaciya/opcii/kpp; GPT extract if needed; `storage.upsertVehicleLookupCache`; `storage.updateVehicleLookupCaseStatus` | lookupResult, partsApi | vehicleContext, cache row, status COMPLETED |
| **B10–B11** | `server/workers/vehicle-lookup.worker.ts` | Lines 492–533: `isModelOnly` → P2; `lookupConfidence >= 0.85 && gearbox.oem` → P1; else → P3 `tryFallbackPriceLookup` | gearbox, lookupConfidence, vehicleContext | enqueuePriceLookup(P1|P2|P3) |
| **C1** | `server/workers/price-lookup.worker.ts` | `buildCacheKey(oem, vehicleContext?.make, vehicleContext?.model)` (lines 18–26) | oem, make?, model? | string `oem::make::model` (lowercase) |
| **C2** | `server/database-storage.ts` | `getGlobalPriceSnapshot(cacheKey)` (lines 1499–1524) | cacheKey | `PriceSnapshot \| null` (validity: expiresAt > now or legacy 7d createdAt) |
| **C3** | `server/workers/price-lookup.worker.ts` | `if (cached)` (line 479) | cached | boolean; if true → C_DONE (create suggestion from cache) |
| **C4–C7** | `server/workers/price-lookup.worker.ts` | `oemModelHint && isValidTransmissionModel(oemModelHint)` → use hint; else `identifyTransmissionByOem(oem, vehicleContext)` (transmission-identifier.ts:108); then `effectiveDisplayName` | oem, oemModelHint?, vehicleContext | identification, effectiveDisplayName |
| **C8** | `server/services/price-searcher.ts` | `searchUsedTransmissionPrice(oem, identification.modelName, origin, make, vehicleContext, tenantId, opts?)` (line 639) | oem, modelName, origin, make, vehicleContext, tenantId, `PriceSearchOpts?` | `PriceSearchResult` |
| **D1** | `server/services/price-searcher.ts` | `fetchLiveFxRates()` (lines 482–512) | — | `Record<string, number>` (JPY, EUR, USD, KRW) |
| **D2** | `server/services/price-searcher.ts` | `buildPrimaryQuery`, `buildFallbackQuery` (lines 105–147) | oem, modelName, origin, gearboxLabel, make, vehicleDesc | primaryQuery, fallbackQuery strings |
| **D3–D4** | `server/services/price-searcher.ts` | `searchWithYandex` → `buildYandexQueries` (389–438); `searchYandex(q, 5)` (yandex-source.ts:29) | oem, modelName, make, model, gearboxType, `opts?` (`inputKind`, `flagEnabled`) | YandexSearchResult[] merged, sorted by DOMAIN_PRIORITY_SCORES |
| **D5** | `server/services/price-searcher.ts` | `fetchPageViaPlaywright(url)` (playwright-fetcher); `parseListingsFromHtml(html, url, domain)` (308–384) | sortedUrls (top 8, then 5 opened) | ParsedListing[] per page |
| **D6** | `server/services/price-searcher.ts` | `filterListingsByTitle(parsed)` (386–396); dedup by `l.url` (464–468); `removeOutliers(dedupedListings.map(l => l.price))` (473–474) | allListings | validListings (after filter + dedup + IQR) |
| **D7** | `server/services/price-searcher.ts` | `hasEnoughYandex = yandexResult.listings.length >= 3 \|\| uniqueDomains >= 2` (634–636) | yandexResult | boolean → return source: "yandex" or continue |
| **D8–D15** | `server/services/price-searcher.ts` | `featureFlagService.isEnabled("GPT_WEB_SEARCH_ENABLED")`; `runSearch(primaryQuery)`; `parseListingsFromResponse`; `validatePrices`; filter `isExcluded`/`isDefective`; `runSearch(fallbackQuery)` if &lt;2; `removeOutliers`; min/max/avg (744–747) | primaryQuery, fallbackQuery | PriceSearchResult (openai_web_search or not_found) |
| **E1–E7** | `server/workers/price-lookup.worker.ts` | Branch on `priceData.source`; not_found → escalation or AI estimate or createNotFoundSuggestion; else `storage.createPriceSnapshot` (634–656); then `createPriceSuggestions` or short `suggestedReply` (665–679) | priceData, snapshot | DB snapshot, AI suggestion(s), WebSocket broadcast |

---

## 2. Mismatches (Review vs Code)

| # | Mismatch | Review expectation | Actual code | Action |
|---|----------|--------------------|-------------|--------|
| 1 | **“Price on request”** | Exclude listings that only say “цена по запросу” | No keyword or prompt instruction | PR1: prompt + post-parse filter |
| 2 | **Price normalization** | “от X ₽”, ranges, VAT, “за штуку” → one canonical RUB | `parsePriceFromText`: single regex `(\d[\d\s]*)\s*(?:₽|руб\.?|RUB)`; no “от”, no range split, no VAT/unit handling | PR2: extend parser + tests |
| 3 | **Confidence + explanation** | Reply includes “от N объявлений”, date, confidence | Reply has no listing count, no date, confidence only 0.5/0.8 in createSuggestionRecord | PR3: add explanation line + confidence from source/listingsCount |
| 4 | **Dedup** | Dedup by fingerprint (not only URL) | Yandex path: dedup by `l.url` only (price-searcher.ts 464–468). GPT path: no dedup | PR4: dedup by fingerprint (e.g. domain + normalized price or domain + title hash) |
| 5 | **Output range** | P25–P75 + median instead of min/max/avg | min/max/avg computed (price-searcher 744–747, 638–641); reply uses min/max | PR5: compute median, P25, P75; reply shows P25–P75 + median |
| 6 | **VIN→lookup cache TTL** | Review suggests 30d TTL | `vehicleLookupCache` has `expiresAt` in schema; `getVehicleLookupCacheByKey` does **not** filter by expiresAt | Optional: add expiry filter and set expiresAt on upsert (30d) |
| 7 | **OEM→identity TTL** | Review suggests 90d TTL | `getTransmissionIdentity` filters by expiresAt; `saveTransmissionIdentity` does **not** set expiresAt (identity never expires) | Optional: set expiresAt = now + 90d on save |
| 8 | **Outlier logic** | Review suggests winsorize/cap before IQR | Only IQR 1.5×; no winsorization; IQR skipped when prices.length &lt; 4 | PR5 can add winsorization before percentiles |
| 9 | **Exclusion keywords** | “Price on request” in exclusion list | EXCLUDE_KEYWORDS: новая, восстановл, etc.; DEFECT_KEYWORDS: дефект, на запчасти…; no “по запросу” | PR1: add to exclusion list |

---

## 3. Five Minimal PRs

### PR1: “Price on request” exclusion

**Goal:** Avoid treating “цена по запросу” as a valid price; reduce bogus zeros and misleading counts.

**Changed files:**
- `server/services/price-searcher.ts`
  - In the GPT search prompt (runSearch input string, ~line 564): append sentence: `Do NOT include listings that only say "цена по запросу" or "уточняйте цену"; only include listings with a numeric price in RUB.`
  - Add constant: `const PRICE_ON_REQUEST_KEYWORDS = ["цена по запросу", "уточняйте цену", "цену уточняйте", "по запросу"];`
  - In `parseListingsFromResponse`: when pushing a listing from JSON or from line parsing, skip item if `(item.title && isPriceOnRequest(item.title))` (and no separate numeric price). Add helper `function isPriceOnRequest(text: string): boolean` that returns true if text contains any of PRICE_ON_REQUEST_KEYWORDS and does not contain a valid price pattern (reuse parsePriceFromText logic: if no match for ₽/руб, treat as “on request” when keywords present).
  - Simpler variant: after building listings in parseListingsFromResponse, filter out any listing where `title` contains a PRICE_ON_REQUEST_KEYWORD and we only inferred price from a different field or from a range that could be “от X” (optional). Minimal variant: filter out listings whose `title` matches price-on-request and `price === 0` (if ever present). More robust: filter out any listing where title.toLowerCase() includes "по запросу" or "уточняйте цену" (these are typically no-price listings).
- No schema changes.

**New tests:**
- `server/__tests__/price-searcher-parse.test.ts` (or add to existing):
  - `parseListingsFromResponse` returns 0 listings when content is only "цена по запросу" and no numbers.
  - `parseListingsFromResponse` keeps listing when title has "контрактная КПП 70000 руб" (no "по запросу").
  - `parseListingsFromResponse` drops listing when title is "КПП W5MBB цена по запросу" and no price in item (or price 0).

**Acceptance criteria:**
- [ ] GPT prompt includes instruction not to include “цена по запросу”–only listings.
- [ ] Listings with title containing “цена по запросу” / “уточняйте цену” and no valid numeric price are excluded from parsed results.
- [ ] Regression: existing test that expects N listings for a valid JSON array still passes when titles don’t contain these phrases.

---

### PR2: Robust price normalization (от X, ranges, currency)

**Goal:** Normalize “от X ₽”, “X – Y ₽”, and explicit currency so one listing yields one canonical RUB value; reduce duplicates and wrong ranges.

**Changed files:**
- `server/services/price-searcher.ts`
  - **parsePriceFromText:**
    - Add support for “от X ₽” / “от X руб”: match `(?:от|from)\s*(\d[\d\s]*)\s*(?:₽|руб)` and use that as the single price (already in range 1k–15M).
    - Add support for range “X – Y ₽”: match `(\d[\d\s]*)\s*[–\-]\s*(\d[\d\s]*)\s*(?:₽|руб)`; return the lower bound (or both as two entries later). For “one canonical value per listing” use lower bound for “от” semantics.
    - Reject or normalize when currency is not RUB: if text has “\$” or “USD” or “€” or “EUR” or “¥”, do not parse as RUB unless conversion is explicitly done elsewhere (international path already has FX). So in Russian path, return null for non-RUB.
  - Add `parsePriceFromTextStrict(text: string): { price: number; isFrom?: boolean } | null` that returns the price and whether it was “от X” (for optional dedup: same “от” price from same site = one listing).
  - In `parseListingsFromResponse`, when parsing JSON item: if `item.price` is number, use as-is; else use `parsePriceFromText(String(item.price ?? item.title ?? ""))` and if null, try `parsePriceFromTextStrict` on title for “от 70 000 ₽”.
- Optional: “за штуку” / “за ед” — no change to value, only log; “НДС” / “с НДС” — no change (already in RUB).

**New tests:**
- `server/__tests__/price-searcher-parse.test.ts`:
  - `parsePriceFromText("от 70 000 ₽")` → 70000.
  - `parsePriceFromText("80 000 – 120 000 руб")` → 80000 (or document: return first number as min).
  - `parsePriceFromText("100 $")` → null (or keep current behavior if we only match ₽/руб).
  - `parsePriceFromText("75 000 руб. за штуку")` → 75000.

**Acceptance criteria:**
- [ ] “от 70 000 ₽” yields one listing with price 70000.
- [ ] “80 000 – 120 000 руб” yields one value (min) or two entries (min and max) per product spec; document choice.
- [ ] Non-RUB currency in Russian path does not produce a RUB price (or is explicitly rejected).
- [ ] Existing parse tests still pass.

---

### PR3: Confidence score + explanation in user reply

**Goal:** Every price reply includes a short explanation (“от N объявлений”, “актуально на &lt;date&gt;”) and a confidence score derived from source and listing count.

**Changed files:**
- `server/workers/price-lookup.worker.ts`
  - Add helper `function priceReplyConfidence(source: string, listingsCount: number): number`:
    - yandex + listingsCount >= 5 → 0.9; yandex + 3–4 → 0.85; openai_web_search + >= 5 → 0.8; openai_web_search + 2–4 → 0.7; ai_estimate → 0.5.
  - Add helper `function priceReplyExplanation(source: string, listingsCount: number, createdAt: Date): string`:
    - e.g. `По данным от ${listingsCount} объявлений. Актуально на ${formatDate(createdAt)}.`
  - Where `suggestedReply` is built (cached path ~494–496, snapshot path ~676–678, AI estimate path ~605–606): append `\n\n${priceReplyExplanation(...)}` and pass `priceReplyConfidence(...)` as the confidence argument to `createSuggestionRecord`.
  - For cached path: use `cached.listingsCount ?? 0`, `cached.source`, `cached.createdAt`; for snapshot path use `snapshot.listingsCount`, `snapshot.source`, `snapshot.createdAt`; for AI estimate use listingsCount 0, source "ai_estimate", createdAt now.
- Optional: add template variables `listings_count`, `date_actual` to message template and render in `buildPriceReply` if template is used (see template-renderer / price_result template).

**New tests:**
- Unit test `priceReplyConfidence`: (yandex, 5) → 0.9; (openai_web_search, 2) → 0.7; (ai_estimate, 0) → 0.5.
- Unit test `priceReplyExplanation`: contains “от N объявлений” and “Актуально на”.

**Acceptance criteria:**
- [ ] Every price suggestion (cached, fresh yandex/openai, ai_estimate) ends with an explanation line containing listing count and date.
- [ ] Confidence value passed to createSuggestionRecord is 0.5 / 0.7 / 0.8 / 0.85 / 0.9 according to source and listingsCount.
- [ ] No regression in createPriceSuggestions (tiered) path: either add explanation there too or keep as-is and only add to single-line reply path.

---

### PR4: Dedup by fingerprint (not only URL)

**Goal:** Deduplicate listings by a fingerprint (e.g. domain + normalized price, or domain + title hash) so the same offer from different URLs or same URL with different query params is counted once.

**Changed files:**
- `server/services/price-searcher.ts`
  - Add `function listingFingerprint(l: ParsedListing): string`: e.g. `${l.site.toLowerCase()}|${l.price}` (simple). Alternative: `${l.site}|${hashTitle(l.title)}` if we want to merge same-title same-site. Use `site|price` to merge same domain + same price (likely same listing).
  - In GPT path: after building `listings` (after filter isExcluded/isDefective), dedup by fingerprint: `const seen = new Set<string>(); listings = listings.filter(l => { const fp = listingFingerprint(l); if (seen.has(fp)) return false; seen.add(fp); return true; });`
  - In Yandex path: after dedup by URL (464–468), also dedup by fingerprint so same listing from same domain with same price (e.g. two URLs from baza.drom.ru with same price) is single listing.
- No schema change.

**New tests:**
- Two listings: same site, same price, different URLs → after dedup only one remains.
- Two listings: same site, different prices → both remain.

**Acceptance criteria:**
- [ ] GPT path: duplicate (same domain + same price) is removed.
- [ ] Yandex path: duplicate (same URL already; plus same domain+price) is removed.
- [ ] listingsCount and min/max/avg reflect deduplicated set.

---

### PR5: Output range P25–P75 + median (instead of min/max/avg)

**Goal:** Show users the interquartile range (P25–P75) and median instead of min/max/avg for more robust interpretation.

**Changed files:**
- `server/services/price-searcher.ts`
  - Add to `PriceSearchResult`: `medianPrice?: number; priceP25?: number; priceP75?: number;` (optional for backward compat).
  - After `removeOutliers` and computing `validPrices` / `validListings`, compute:
    - `const sorted = [...validPrices].sort((a,b) => a-b); const n = sorted.length;`
    - `medianPrice = n === 0 ? 0 : sorted[Math.floor(n/2)];`
    - `priceP25 = n === 0 ? 0 : sorted[Math.floor(n*0.25)]; priceP75 = n === 0 ? 0 : sorted[Math.floor(n*0.75)];`
  - Populate these in both Yandex success branch (637–658) and GPT success branch (756–768). Keep minPrice/maxPrice/avgPrice for backward compatibility and for snapshot storage.
- `server/workers/price-lookup.worker.ts`
  - Where `suggestedReply` is built using min/max (cached path 494–496, snapshot path 676–678): if `priceData.medianPrice != null && priceData.priceP25 != null && priceData.priceP75 != null`, use: `от ${priceP25} до ${priceP75} ₽ (медиана: ${medianPrice} ₽)`; else fallback to current “от min до max ₽”.
  - Snapshot: store medianPrice, priceP25, priceP75 in `raw` (no schema migration) so cached replies can show P25–P75 when available. When reading from cache, use `cached.raw?.medianPrice` etc. for reply text.
- Optional: add `price_median`, `price_p25`, `price_p75` to schema later; for this PR store in `raw` only.

**New tests:**
- Unit: given validPrices [50k, 60k, 70k, 80k, 90k], median = 70k, P25 = 60k, P75 = 80k.
- Integration: search result includes medianPrice, priceP25, priceP75; reply string contains “медиана”.

**Acceptance criteria:**
- [ ] PriceSearchResult includes medianPrice, priceP25, priceP75 when listings >= 2.
- [ ] User-facing reply shows “от P25 до P75 ₽ (медиана: M ₽)” when available; otherwise falls back to min–max.
- [ ] Snapshot raw (or DB columns) stores P25/P75/median for cached path.
- [ ] Backward compatible: existing snapshots without these fields still show min–max.

---

## 4. Regression Test Dataset Format and Usage

**File:** `server/__tests__/fixtures/price-regression-cases.json`

**Format:**
```json
{
  "version": 1,
  "description": "Regression cases for transmission price pipeline",
  "cases": [
    {
      "id": "string",
      "type": "vin_lookup" | "oem_price",
      "input": { ... },
      "expected": { ... },
      "notes": "optional"
    }
  ]
}
```

- **vin_lookup:** `input`: `{ "idType": "VIN"|"FRAME", "value": "..." }`. `expected`: `{ "hasOem": boolean?, "oem": string?, "modelHint": string?, "shouldFail": boolean? }`.
- **oem_price:** `input`: `{ "oem": string, "make": string?, "model": string?, "gearboxType": string? }`. `expected`: `{ "source": "yandex"|"openai_web_search"|"not_found", "minListings": number?, "priceRange": { "min": number?, "max": number? }?, "orNotFound": boolean }`.

Tests load the JSON and, for each case, run the relevant function (or worker step) with mocks and assert expected fields. Case types: `vin_lookup`, `oem_price` (integration); `parse_only`, `aggregation_only` (unit-level for parseListingsFromResponse / parsePriceFromText / removeOutliers). See `server/__tests__/fixtures/price-regression-cases.json` for 10 sample cases.

---

## 5. Summary Table (PRs)

| PR | Title | Files | New tests | Key AC |
|----|--------|--------|-----------|--------|
| PR1 | Price-on-request exclusion | price-searcher.ts | price-searcher-parse (3 cases) | Prompt + filter “по запросу” |
| PR2 | Robust price normalization | price-searcher.ts | price-searcher-parse (4 cases) | “от X”, range, RUB-only |
| PR3 | Confidence + explanation in reply | price-lookup.worker.ts | unit confidence/explanation | Reply has N объявлений + date + confidence |
| PR4 | Dedup by fingerprint | price-searcher.ts | dedup by fingerprint (2 cases) | Same site+price → one listing |
| PR5 | P25–P75 + median in output | price-searcher.ts, price-lookup.worker.ts | unit percentiles, reply content | Reply shows P25–P75 and median |

All PRs keep the current architecture working; no removal of min/max/avg in storage (PR5 adds percentiles and changes reply text when present).
