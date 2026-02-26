# Transmission Price Estimation System — Architectural Review & Improvement Plan

**Scope:** Used/contract transmission (AT/MT/CVT) price estimation for the Russian market.  
**Approach:** Review existing implementation; propose improvements and refactor with minimal disruption.  
**Assumptions:** Russian-language listings, prices in RUB; pipeline: VIN → OEM → transmission model → web search → aggregation → price range.

---

## 1. Executive Summary (One Page)

The system resolves a client VIN to a transmission OEM and model, then searches the web (Yandex Search API + Playwright first; GPT-4.1 web_search as fallback) and aggregates listing prices into a min/max/avg range. **Note:** The codebase uses **Yandex Search API** and **OpenAI web_search**, not Google Custom Search (CSE); CSE can be added as an optional source.

**Strengths:** Clear staging (Yandex → GPT fallback), OEM→model cache and validation (`isValidTransmissionModel`), vehicle-context-aware queries, IQR-based outlier removal, escalation path when no prices found, and global price snapshot cache with TTL.

**Main risks:** Wrong OEM/model mapping (Podzamenu/PartsAPI or GPT), stale or “price on request”–only results, mixed new/used/parts-only listings, currency/unit confusion (USD/JPY vs RUB), no confidence score or explanation for the user, and limited observability.

### Top 10 Recommendations

| # | Recommendation | Impact | Effort |
|---|----------------|--------|--------|
| 1 | **Add confidence score and short explanation** to every price reply (source, listing count, “от N объявлений”) | High — trust and transparency | Low |
| 2 | **Detect and exclude “цена по запросу”** in prompts and post-parse (keyword + optional GPT pass) | High — avoids bogus zeros or misleading counts | Low |
| 3 | **Normalize price parsing** for “от X ₽”, ranges, VAT, “за штуку” so one listing → one canonical RUB value | High — fewer duplicates and wrong ranges | Medium |
| 4 | **Introduce structured logging + span IDs** for the full path (VIN → OEM → model → search → aggregate) | High — debuggability and metrics | Low |
| 5 | **Add negative query keywords** (e.g. -гидроблок -ремкомплект) and optional RU morphology in Yandex queries | Medium — better relevance | Low |
| 6 | **Winsorize or cap** extreme prices (e.g. 3× median) before IQR; optionally weight sources by domain trust | Medium — more robust aggregation | Low |
| 7 | **Domain allowlist for Yandex** (prioritize drom/avito/farpost/japancar) and document CSE as optional second source | Medium — quality and optionality | Low |
| 8 | **VIN→OEM cache TTL** (e.g. 30 days) and **OEM→identity TTL** (e.g. 90 days) with explicit expiry in DB/queries | Medium — freshness vs cost | Low |
| 9 | **Regression test suite** with golden VINs, OEMs, and expected price bands or “not_found”/escalation | High — safe refactors | Medium |
| 10 | **Refactor into clear modules:** VIN Resolver, OEM/Model Resolver, Price Searcher (with pluggable sources), Aggregator, Response Builder | Medium — maintainability | Medium |

---

## 2. Algorithm Tree (End-to-End)

### 2.1 Mermaid Flowchart

```mermaid
flowchart TB
  subgraph Client
    A0[Client sends message with VIN]
  end

  subgraph VIN_Extraction
    A1[Extract VIN/FRAME from message]
    A2{Valid VIN/FRAME?}
    A1 --> A2
    A2 -->|No| END_NO_VIN[End: no lookup]
    A2 -->|Yes| A3[Normalize value]
  end

  subgraph Vehicle_Lookup
    B1[Create vehicle lookup case]
    B2[Enqueue vehicle lookup job]
    B3[Podzamenu + PartsAPI in parallel]
    B4{gearbox.oem FOUND or gearbox.model?}
    B3 --> B4
    B4 -->|No| B_FAIL[FAILED: PARSE_FAILED]
    B4 -->|Yes| B5[Build vehicleContext: make, model, year, gearboxType, gearboxModelHint, etc.]
    B5 --> B6[Parse modifikaciya/opcii/kpp for gearboxType/driveType]
    B6 --> B7{gearboxType/driveType missing?}
    B7 -->|Yes| B8[GPT extract from partsApiRawData]
    B7 -->|No| B9[Upsert vehicle_lookup_cache]
    B8 --> B9
    B9 --> B10{confidence ≥ 0.85 and OEM FOUND?}
    B10 -->|Yes| P1[Enqueue price lookup: OEM + oemModelHint + vehicleContext]
    B10 -->|No| B11{Model-only or no OEM?}
    B11 -->|Model only| P2[Enqueue price lookup: oem=null, searchFallback]
    B11 -->|No OEM| P3[Fallback price lookup: make/model/gearboxType/model]
  end

  A0 --> A1
  A3 --> B1 --> B2 --> B3

  subgraph Price_Lookup
    C1[buildCacheKey: oem::make::model]
    C2[getGlobalPriceSnapshot(cacheKey)]
    C3{Cache hit and not expired?}
    C2 --> C3
    C3 -->|Yes| C_DONE[Return cached suggestion]
    C3 -->|No| C4{oemModelHint valid transmission model?}
    C4 -->|Yes| C5[identification = oemModelHint, skip GPT]
    C4 -->|No| C6[identifyTransmissionByOem: cache → GPT-4.1 + web_search]
    C6 --> C7[effectiveDisplayName = modelName or vehicleDesc + gearboxLabel]
    C5 --> C7
    C7 --> C8[searchUsedTransmissionPrice]
  end

  P1 --> C1
  P2 --> C1
  P3 --> C1

  subgraph Price_Search
    D1[fetchLiveFxRates]
    D2[buildPrimaryQuery + buildFallbackQuery]
    D3[Stage 1: searchWithYandex → buildYandexQueries]
    D4[searchYandex per query, merge, sort by domain priority]
    D5[Top 8 URLs → fetchPageViaPlaywright, parseListingsFromHtml]
    D6[filterListingsByTitle, dedup by URL, removeOutliers]
    D7{≥3 listings OR ≥2 domains?}
    D7 -->|Yes| D_YANDEX[Return source: yandex]
    D7 -->|No| D8{GPT_WEB_SEARCH_ENABLED?}
    D8 -->|No| D_NF1[Return not_found]
    D8 -->|Yes| D9[runSearch(primaryQuery) — GPT-4.1 web_search]
    D9 --> D10[parseListingsFromResponse, validatePrices]
    D10 --> D11[Filter isExcluded/isDefective]
    D11 --> D12{≥2 listings?}
    D12 -->|No| D13[runSearch(fallbackQuery)]
    D13 --> D11
    D12 -->|Yes| D14[removeOutliers, min/max/avg]
    D14 --> D15{<2 after outlier?}
    D15 -->|Yes| D_NF2[Return not_found]
    D15 -->|No| D_GPT[Return source: openai_web_search]
  end

  C8 --> D1 --> D2 --> D3 --> D4 --> D5 --> D6 --> D7

  subgraph After_Search
    E1{source in yandex|openai_web_search|not_found?}
    E1 -->|not_found| E2[PRICE_ESCALATION_ENABLED?]
    E2 -->|Yes| E3[createEscalationSuggestion]
    E2 -->|No| E4[AI_PRICE_ESTIMATE_ENABLED?]
    E4 -->|Yes| E5[estimatePriceFromAI → save ai_estimate 2h TTL]
    E4 -->|No| E6[createNotFoundSuggestion]
    E1 -->|Found| E7[Save snapshot: 7d TTL, createPriceSuggestions or short reply]
  end

  D_YANDEX --> E1
  D_GPT --> E1
  D_NF1 --> E1
  D_NF2 --> E1
```

### 2.2 Indented Tree with Node IDs and I/O

| Node ID | Step | Input | Output | External / Notes |
|--------|------|-------|--------|------------------|
| **A0** | Client message | User message | — | — |
| **A1** | Extract VIN/FRAME | Message text | idType, rawValue | — |
| **A2** | Valid VIN? | idType, value | boolean | — |
| **A3** | Normalize | value | normalizedValue | — |
| **B1–B2** | Create case, enqueue | caseId, tenantId, idType, normalizedValue | Job enqueued | DB, BullMQ |
| **B3** | Podzamenu + PartsAPI | normalizedValue | lookupResult, partsApi | Podzamenu HTTP, partsapi.ru |
| **B4** | Has OEM or model? | gearbox | boolean | — |
| **B5–B9** | vehicleContext, cache | lookupResult, partsApi | vehicleContext, cache row | DB |
| **B10–B11** | Route | gearbox, confidence | P1 | P2 | P3 | — |
| **C1** | buildCacheKey | oem, make, model | cacheKey string | — |
| **C2** | getGlobalPriceSnapshot | cacheKey | PriceSnapshot \| null | DB, expiresAt |
| **C3** | Cache hit? | cached | boolean | — |
| **C4–C7** | Identify transmission | oem, oemModelHint, vehicleContext | identification, effectiveDisplayName | transmission_identity_cache, OpenAI (if miss) |
| **C8** | searchUsedTransmissionPrice | oem, modelName, origin, vehicleContext, tenantId | PriceSearchResult | Yandex, Playwright, OpenAI |
| **D1** | fetchLiveFxRates | — | { JPY, EUR, USD, KRW } | cdn.jsdelivr.net currency API |
| **D2** | buildPrimaryQuery / buildFallbackQuery | oem, modelName, origin, gearboxLabel, make, vehicleDesc | primaryQuery, fallbackQuery | — |
| **D3–D4** | searchWithYandex | oem, modelName, make, model, gearboxType | queries → Yandex POST | Yandex Search API |
| **D5** | Fetch pages | sortedUrls (top 8) | html per URL | Playwright /fetch-page or fetch |
| **D6** | parseListingsFromHtml, filterListingsByTitle, dedup, removeOutliers | html, url, domain | ParsedListing[] | cheerio, LISTING_*_KEYWORDS |
| **D7** | Enough Yandex? | listings.length, uniqueDomains | boolean | ≥3 or ≥2 domains |
| **D8–D15** | GPT fallback | primaryQuery, fallbackQuery | runSearch → parse → validate → filter → removeOutliers | OpenAI Responses API (web_search) |
| **E1–E7** | Save snapshot, create suggestion | priceData, snapshot | DB snapshot, AI suggestion | DB, WebSocket broadcast |

### 2.3 Decision Points and Fallbacks Summary

- **A2:** No valid VIN → no vehicle lookup.
- **B4:** No OEM and no model → case FAILED (PARSE_FAILED).
- **B10:** High confidence + OEM → enqueue OEM price lookup (P1).
- **B11:** Model-only (e.g. VW group) → price lookup with searchFallback (P2); no OEM → fallback price lookup (P3).
- **C3:** Cache hit → return cached suggestion (no search).
- **C4:** Valid oemModelHint → skip GPT identification.
- **D7:** Yandex sufficient → return `source: "yandex"` (no GPT).
- **D8:** GPT fallback disabled → return `not_found`.
- **D12/D15:** After primary/fallback and outlier removal, &lt;2 listings → `not_found`.
- **E2:** not_found + escalation enabled → escalation suggestion; else E4.
- **E4:** not_found + AI estimate enabled → estimatePriceFromAI, save 2h TTL; else not_found suggestion.

### 2.4 Retries and Error Handling (Current)

- **PartsAPI:** `decodeVinPartsApiWithRetry` (e.g. 3 retries, 2s delay); on failure returns null, Podzamenu result still used.
- **Podzamenu:** On `PodzamenuLookupError` with NOT_FOUND, Strategy 3: use PartsAPI result if present and run fallback price lookup.
- **Yandex:** 429/401/!ok → return []; timeout (15s) → return [].
- **Playwright:** `Promise.allSettled` per URL; failed fetches leave no listings for that URL.
- **GPT (identification / search / AI estimate):** try/catch; on failure: identification → FALLBACK_RESULT (null modelName); search → []; AI estimate → fall through to not_found suggestion.

---

## 3. Failure Modes and Data-Quality Risks

| Risk | Where it manifests | Current mitigation | Gap |
|------|--------------------|--------------------|-----|
| **Wrong OEM mapping** | Podzamenu returns incorrect or alternate OEM for VIN | Evidence/source stored; no automatic validation | No cross-check (e.g. PartsAPI kpp vs Podzamenu OEM); wrong OEM → wrong model → wrong prices |
| **Wrong transmission model** | GPT or cache returns internal/catalog code (e.g. M3MHD987579) | `isValidTransmissionModel` rejects 4+ consecutive digits, length &gt; 12; effectiveDisplayName fallback | Borderline codes; synonym variants (e.g. FAU vs FAU(5A)) may differ in search quality |
| **Stale pricing** | Listings removed or prices changed | price_snapshots TTL 7d (24h for not_found, 2h for ai_estimate) | No per-listing age; no “data as of” in user message |
| **“Price on request”** | Snippets say “цена по запросу” but parser expects number | GPT instructed to return prices; no explicit exclusion of “по запросу” | GPT may return 0 or omit; no post-parse filter for “по запросу” |
| **Duplicates** | Same listing via multiple queries or URLs | Dedup by URL in Yandex path; GPT path no URL dedup | Same offer with different URLs; range “от X до Y” → two entries (intended) but can double-count if same listing |
| **Currency parsing** | USD/JPY in snippet, interpreted as RUB | validatePrices: drop price &lt; 1% of median (catches unconverted); FX only in international fallback | Ambiguous “10000” (RUB vs JPY); no explicit “₽”/“руб” requirement in GPT output |
| **Mixed new/used** | New or rebuilt in results | EXCLUDE_KEYWORDS (новая, восстановл, remanufactured); LISTING_EXCLUDE_KEYWORDS (гидроблок, на запчасти…) | Partial; “контрактная” + “новая” in same title; no “только б/у” in query |
| **Regional bias** | Results from one region or one site dominate | Domain priority (drom, farpost, avito high); no geo filter | No explicit “Россия” or region in Yandex; single-region spike can skew |
| **Shipping included/excluded** | “С доставкой” vs “самовывоз” | Not distinguished | Avg can mix different cost bases |
| **Bait / SEO spam** | Irrelevant or bait listings in snippets | Domain allowlist/priority; filterListingsByTitle | No “цена от X” pattern to detect bait; no domain blocklist from feedback |
| **Outlier skew** | One very high/low price | removeOutliers (IQR 1.5×); validatePrices &lt; 1% median | With few listings IQR not applied (&lt;4); no winsorization |
| **Missing model code** | MODEL_ONLY or no OEM | Fallback price lookup by make/model/gearboxType; escalation when not_found | Weaker search quality; no explicit “unknown model” confidence in reply |

---

## 4. Proposed Improvements (High ROI)

### 4.1 Query Generation

- **Negative keywords (Yandex):** Add `-гидроблок -ремкомплект -насос -сальник` (or equivalent in API) to reduce parts-only results.
- **RU morphology:** If Yandex supports it, enable so “контрактная” matches “контрактные” etc.
- **Synonyms and AT/MT/CVT:** Already using gearboxLabel (МКПП/АКПП/вариатор) from vehicleContext; add explicit “б/у”, “с разборки” in every primary query.
- **“Price on request” in prompt:** Add: “Do not include listings that only say ‘цена по запросу’ or ‘уточняйте цену’; only include listings with a numeric price in RUB.”

### 4.2 Source Selection and CSE / Yandex Config

- **Domain allowlist:** Already have DOMAIN_PRIORITY_SCORES and EXCLUDED_DOMAINS; document as allowlist/priority; optionally filter Yandex results to only these domains if API supports.
- **“Price on request” detection:** In parseListingsFromResponse and snippet handling, drop or flag items where title/snippet contains “по запросу”/“уточняйте цену” and no numeric price.
- **Google CSE (optional):** Add a second source (e.g. CSE with siteRestrict to drom.ru, avito.ru, farpost.ru) as optional Stage 1b or fallback; same parsing pipeline.

### 4.3 Parsing and Normalization

- **RUB-only and ranges:** In parsePriceFromText, prefer “₽”/“руб”; support “от X ₽”, “X – Y ₽” → one or two entries; reject if only “по запросу”.
- **Installment / VAT / “за штуку”:** Normalize “в кредит”, “НДС” to one unit price; “за штуку” = per unit; log when normalized.
- **Deduplication:** In GPT path, dedup by (domain + normalized price) or by URL if GPT returns url.

### 4.4 Outlier Detection and Aggregation

- **Winsorize or cap:** Before or instead of IQR, cap prices to e.g. [0.25×median, 3×median] then compute min/max/avg.
- **Weighted sources:** Optional weight by DOMAIN_PRIORITY_SCORES when computing avg (e.g. drom/avito weight 1.2, unknown 0.8).
- **Minimum N:** Keep “&lt;2 valid listings → not_found”; document that 2–3 listings imply low confidence.

### 4.5 Confidence and Explanations

- **Confidence score:** From listing count and source: e.g. yandex + ≥5 listings → 0.9; openai_web_search + 2–4 → 0.7; ai_estimate → 0.5.
- **Short explanation:** Append to reply: “По данным от N объявлений (источник: …)” and “Актуально на &lt;date&gt;”.

### 4.6 Caching and TTLs

- **VIN→lookup:** vehicle_lookup_cache has no explicit expiresAt in schema; add optional expiresAt (e.g. 30 days) and filter in getVehicleLookupCacheByKey.
- **OEM→identity:** transmission_identity_cache has expiresAt; ensure all reads filter by expiresAt &gt; now; set TTL e.g. 90 days on write.
- **OEM→prices:** Already 7d / 24h / 2h; consider 3d for yandex if market moves fast.

### 4.7 Instrumentation and Observability

- **Structured logs:** One trace_id (or caseId + jobId) from VIN to price reply; log at each step: step name, cacheKey, source, listing count, duration.
- **Metrics:** Counters for cache_hit, source=yandex|openai|not_found, escalation, ai_estimate; histogram for latency per stage.

### 4.8 Fraud / Spam Resistance

- **Bait pattern:** If title matches “цена от X” and body has much higher price, exclude or flag.
- **Domain blocklist:** Table or config for domains to exclude based on feedback.
- **Minimum listing quality:** Require title length or presence of gearbox keyword before including.

---

## 5. Prioritized Roadmap

### Quick wins (1–3 days)

| Item | Description | Impact | Complexity | Risk | Success metric |
|------|-------------|--------|------------|------|----------------|
| Q1 | Add “цена по запросу” / “уточняйте цену” to GPT search prompt and exclude in parseListingsFromResponse when no price | Fewer zero/misleading listings | Low | Low | Share of replies with 0 or 1 listing decreases |
| Q2 | Append to price reply: “По данным от N объявлений. Актуально на &lt;date&gt;.” and optional confidence (0.5/0.7/0.9) | Transparency, trust | Low | Low | User feedback or support tickets on “no source” |
| Q3 | Structured log at start of vehicle + price flow: caseId, cacheKey, source (when done) | Debugging | Low | Low | Time to diagnose a bad estimate |
| Q4 | Negative keywords in Yandex query string (e.g. -гидроблок -ремкомплект) if API allows | Relevance | Low | Low | Fewer filteredOut in logs; same or higher listingsCount |
| Q5 | Winsorize prices to [0.25×median, 3×median] before IQR (or use winsorization instead of IQR when N&lt;6) | Robustness | Low | Low | Fewer extreme min/max in edge cases |

### Medium (1–2 weeks)

| Item | Description | Impact | Complexity | Risk | Success metric |
|------|-------------|--------|------------|------|----------------|
| M1 | Normalize “от X ₽”, “X – Y ₽”, “за штуку” in parsePriceFromText; single canonical value per listing | Correct ranges, no double-count | Medium | Medium | Regression tests on 20 snippets |
| M2 | Regression test suite: 10 VINs (with expected OEM/model or “not_found”), 10 OEMs (expected band or not_found); run in CI | Safe refactors | Medium | Low | All tests pass; new bugs caught before merge |
| M3 | VIN→lookup cache: add expiresAt (30 days), filter reads; OEM→identity: ensure TTL 90 days on write and filter on read | Freshness vs cost | Low | Low | Cache hit rate and age of hits |
| M4 | Domain allowlist doc + optional filter in Yandex path (only keep results from DOMAIN_PRIORITY_SCORES domains) | Quality | Low | Low | Listing source distribution |
| M5 | Dedup GPT path by (domain + price) or URL; optional weight-by-domain in avg | Fewer duplicates, better avg | Low | Low | listingsCount and avg stability |

### Long-term (1–3 months)

| Item | Description | Impact | Complexity | Risk | Success metric |
|------|-------------|--------|------------|------|----------------|
| L1 | Refactor: VIN Resolver (Podzamenu + PartsAPI), OEM/Model Resolver (cache + GPT), Price Searcher (Yandex + GPT + optional CSE), Aggregator, Response Builder; interfaces for each external call | Maintainability, testability | High | Medium | Unit tests per module; same E2E behavior |
| L2 | Google CSE as optional source (siteRestrict RU auto domains), same parsing/aggregation | Coverage, redundancy | Medium | Low | Comparison A/B: Yandex vs Yandex+CSE |
| L3 | Full observability: trace_id end-to-end, metrics (latency, cache hit, source), dashboard | Operations, SLA | Medium | Low | P95 latency and error rate visible |
| L4 | Confidence model: input listing count, source, spread (IQR); output 0–1; explain “низкая/средняя/высокая уверенность” in UI | Trust, escalation decisions | Medium | Low | Correlation with user acceptance |
| L5 | Feedback loop: “цена неверная” → store (oem, snapshot_id, user_feedback) → periodic review and blocklist/allowlist tuning | Quality over time | High | Medium | Reduction in repeated complaints for same OEM |

---

## 6. Refactor Proposal (Minimal Disruption)

### 6.1 Module Boundaries

- **VIN Resolver:** Input: idType, value. Output: VehicleLookupResult (vehicleMeta, gearbox, evidence). Depends: Podzamenu client, PartsAPI client, vehicle_lookup_cache. No change to API; extract from vehicle-lookup.worker into `server/services/vin-resolver.ts` (or keep in worker but call a service).
- **OEM/Model Resolver:** Input: oem, vehicleContext?, oemModelHint?. Output: TransmissionIdentification. Depends: transmission_identity_cache, OpenAI. Already in `transmission-identifier.ts`; add an interface `TransmissionResolver` so tests can mock.
- **Price Searcher (pluggable sources):** Input: oem, modelName, origin, vehicleContext, tenantId. Output: PriceSearchResult. Interface `PriceSource`: `search(query, options) => Promise<ParsedListing[]>`. Implementations: YandexPlaywrightSource, OpenAIWebSearchSource, (future) GoogleCSESource. Orchestrator in `price-searcher.ts` calls sources in order and merges.
- **Aggregator:** Input: ParsedListing[]. Output: { min, max, avg, mileageMin, mileageMax, listingsCount }. Steps: validatePrices, filter isExcluded/isDefective, removeOutliers (or winsorize), min/max/avg. Pure function; move to `server/services/price-aggregator.ts`.
- **Response Builder:** Input: PriceSearchResult, snapshot, vehicleContext. Output: suggestion text + optional confidence/explanation. Uses templates; keep in worker or move to `server/services/price-response-builder.ts`.

### 6.2 Interfaces for External Services

- **Podzamenu:** `lookupByVehicleId({ idType, value }): Promise<LookupResult>` — already abstracted; ensure all calls go through one module.
- **PartsAPI:** `decodeVinPartsApi(vin, apiKey): Promise<PartsApiResult | null>` — same.
- **Yandex:** `searchYandex(query, maxResults): Promise<YandexSearchResult[]>` — already in yandex-source.ts.
- **Playwright/fetch:** `fetchPageViaPlaywright(url): Promise<string>` — already behind POST /fetch-page.
- **OpenAI:** Wrap `responses.create` for identification, search, and AI estimate behind `TransmissionIdentifier`, `PriceSearchRunner`, `AiPriceEstimator` so they can be mocked in tests.

### 6.3 Test Plan

- **Unit:**  
  - buildPrimaryQuery / buildFallbackQuery for given oem, modelName, origin, gearboxLabel, vehicleDesc.  
  - parsePriceFromText / parseMileageFromText (RUB, “от X”, range, invalid).  
  - removeOutliers / validatePrices (known arrays).  
  - Aggregator: given listings → expected min/max/avg.  
  - isValidTransmissionModel (accept/reject list).
- **Integration:**  
  - VIN → Podzamenu (or mock) → gearbox.oem + vehicleContext.  
  - OEM + vehicleContext → identifyTransmissionByOem (mock OpenAI) → modelName.  
  - searchWithYandex with mock Yandex + mock Playwright → ParsedListing[].
- **Regression datasets:**  
  - 10 VINs: expected OEM or “no OEM”; 10 OEMs (or OEM+vehicle): expected price band (min–max) or “not_found”/escalation.  
  - Edge: invalid VIN, missing model code, single listing, all “по запросу”, extreme outlier (e.g. 1M among 80k).

---

## 7. Definition of Done and Acceptance Tests

### 7.1 Definition of Done (per story)

- Code merged to main; no regression in existing E2E.
- Unit/integration tests added or updated; regression suite run in CI.
- Logging: at least one structured log (or trace_id) for the path affected.
- Docs: PROJECT_MAP or API_REFERENCE updated if new surface or behavior.

### 7.2 Concrete Acceptance Test Cases

| ID | Scenario | Input | Expected |
|----|----------|--------|----------|
| T1 | Happy path, high confidence | VIN → Mitsubishi Lancer CY4A, 5FM/T | OEM 2500A230, model W5MBB or equivalent; price range from Yandex or GPT (e.g. 60k–120k RUB band); suggestion contains “МКПП” and range. |
| T2 | Edge: VIN with no OEM, model only | VIN → VW group MODEL_ONLY | Fallback price lookup by make/model/gearboxType; either price range or escalation/not_found. |
| T3 | Edge: invalid / unknown VIN | Invalid VIN | Case FAILED or NOT_FOUND; no price lookup or fallback with empty context. |
| T4 | Missing model code | OEM valid, vehicleContext without gearboxModelHint, GPT returns internal code | effectiveDisplayName = “Make Model АКПП”; no internal code in user-facing text. |
| T5 | No search results | OEM with no listings (or mock returning []) | source=not_found; escalation suggestion if enabled, else AI estimate or not_found message. |
| T6 | Only “price on request” | Mock snippets only “цена по запросу” | After improvement: 0 listings; not_found (no bogus zero). |
| T7 | Extreme outlier | Listings [50000, 55000, 60000, 500000] | Outlier 500000 excluded (IQR or winsorization); min/max from 50k–60k range. |
| T8 | Cache hit | Same cacheKey within TTL | No Yandex/GPT call; cached snapshot returned; suggestion matches previous. |
| T9 | Multiple OEMs | 3 different OEMs (e.g. Japanese, European, Korean) | Each gets correct gearboxLabel (МКПП/АКПП/вариатор) and plausible range or not_found. |
| T10 | Confidence and explanation | Any successful price reply | After improvement: reply includes “от N объявлений” and date or confidence. |

---

## 8. References to Code (Key Files)

- **Vehicle lookup:** `server/workers/vehicle-lookup.worker.ts`, `podzamenu_lookup_service.py`, `server/services/partsapi-vin-decoder.ts`
- **Transmission identification:** `server/services/transmission-identifier.ts`, `server/storage.ts` (getTransmissionIdentity)
- **Price search:** `server/services/price-searcher.ts`, `server/services/price-sources/yandex-source.ts`, `server/services/playwright-fetcher.ts`
- **Price lookup worker:** `server/workers/price-lookup.worker.ts`
- **Cache and schema:** `shared/schema.ts` (price_snapshots, transmission_identity_cache, vehicle_lookup_cache), `server/database-storage.ts` (getGlobalPriceSnapshot)
- **Docs:** `PROJECT_MAP.md`, `docs/API_REFERENCE.md`, `docs/AUDIT_AND_IMPROVEMENTS.md`

---

*End of review. Implement improvements in the order of the roadmap; run regression tests after each batch.*
