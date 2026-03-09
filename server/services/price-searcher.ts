import { openai } from "./decision-engine";
import type { VehicleContext } from "./transmission-identifier";
import { searchYandex, DOMAIN_PRIORITY_SCORES } from "./price-sources/yandex-source";
import { fetchPageViaPlaywright } from "./playwright-fetcher";
import { featureFlagService } from "./feature-flags";
import { incr } from "./observability/metrics";

// ─── Input kind & search opts ─────────────────────────────────────────────────

/**
 * Distinguishes how the caller supplied the transmission identifier so that
 * Yandex query builders can choose the most effective search anchor.
 *
 *   transmissionCode — market model code (e.g. JF011E, 6HP19)
 *   oemPartNumber    — OEM catalog part number (e.g. 31020-3VX2D)
 *   legacy           — caller did not specify; treat as pre-Step-7 behavior
 */
export type PriceSearchInputKind = "transmissionCode" | "oemPartNumber" | "legacy";

export interface PriceSearchOpts {
  /** What kind of identifier the caller passed in `oem`. Default: "legacy". */
  inputKind?: PriceSearchInputKind;
  /** The normalized original value (TC or PN) before any substitution. */
  inputValue?: string;
}

export interface PriceSearchListing {
  title: string;
  price: number;
  mileage: number | null;
  url?: string;
  site: string;
  isUsed: boolean;
}

export interface PriceSearchResult {
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  mileageMin: number | null;
  mileageMax: number | null;
  currency: "RUB";
  source: "openai_web_search" | "yandex" | "not_found" | "ai_estimate" | "mock";
  urlsChecked?: string[];
  listingsCount: number;
  listings: PriceSearchListing[];
  searchQuery: string;
  filteredOutCount: number;
  /** Confidence score (0–1) computed from final filtered listings. Optional for backward compat. */
  confidenceScore?: number;
  /** Human-readable confidence tier. Optional for backward compat. */
  confidenceLevel?: "low" | "medium" | "high";
  /** Raw signals used to compute confidenceScore. Optional for backward compat. */
  confidenceSignals?: ConfidenceSignals;
}

// ─── Price confidence scoring ─────────────────────────────────────────────────

/** Low-cardinality signals used to compute a price confidence score. */
export interface ConfidenceSignals {
  sampleSize: number;
  uniqueDomains: number;
  spreadRatio: number;
  ruCount: number;
  intlCount: number;
}

/** Result of computePriceConfidence(). */
export interface PriceConfidenceResult {
  confidenceScore: number;
  confidenceLevel: "low" | "medium" | "high";
  confidenceSignals: ConfidenceSignals;
}

function computeSpreadRatio(listings: ParsedListing[]): number {
  if (listings.length < 2) return 1;
  const prices = listings.map((l) => l.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  if (minP === 0) return 1;
  return maxP / minP;
}

/**
 * Pure, deterministic confidence scorer.
 *
 * Operates on the FINAL set of listings — i.e. after intl mixing,
 * small-sample guard, and removeOutliers have all been applied.
 *
 * No randomness. No side effects. Exported for unit testing.
 */
export function computePriceConfidence(
  listings: ParsedListing[],
  source: "yandex" | "openai_web_search" | "ai_estimate" | "not_found"
): PriceConfidenceResult {
  const sampleSize = listings.length;
  const uniqueDomains = new Set(listings.map((l) => l.site)).size;
  const spreadRatio = computeSpreadRatio(listings);
  const ruCount = listings.filter((l) => l.market !== "intl").length;
  const intlCount = listings.filter((l) => l.market === "intl").length;

  const signals: ConfidenceSignals = { sampleSize, uniqueDomains, spreadRatio, ruCount, intlCount };

  // not_found → always zero confidence
  if (source === "not_found") {
    return { confidenceScore: 0, confidenceLevel: "low", confidenceSignals: signals };
  }

  let score = 0;

  // Sample size
  if (sampleSize >= 5) score += 0.35;
  else if (sampleSize >= 3) score += 0.25;
  else if (sampleSize === 2) score += 0.15;

  // Domain diversity
  if (uniqueDomains >= 3) score += 0.25;
  else if (uniqueDomains === 2) score += 0.18;
  else if (uniqueDomains === 1) score += 0.1;

  // Spread stability
  if (spreadRatio <= 1.8) score += 0.25;
  else if (spreadRatio <= 2.5) score += 0.18;
  else score += 0.05;

  // Market quality
  if (ruCount > 0 && intlCount === 0) score += 0.1;
  else if (ruCount > 0 && intlCount > 0) score += 0.05;
  // intl-only: +0

  // Source adjustment
  if (source === "ai_estimate") score *= 0.6;

  // Clamp to [0, 1]
  score = Math.min(1, Math.max(0, score));

  const confidenceLevel: "low" | "medium" | "high" =
    score >= 0.7 ? "high" : score >= 0.4 ? "medium" : "low";

  return {
    confidenceScore: Math.round(score * 1e6) / 1e6,
    confidenceLevel,
    confidenceSignals: signals,
  };
}

type Origin = "japan" | "europe" | "korea" | "usa" | "unknown";

/**
 * Multiplier applied to intl listing prices when they are the sole source
 * (INTL_PRICE_DISCOUNT_ENABLED).  Intentionally a named constant so it can be
 * changed in one place without hunting call-sites.
 */
const INTL_DISCOUNT_FACTOR = 0.75;

// Keywords that indicate NEW / rebuilt units — must be excluded
const EXCLUDE_KEYWORDS = [
  "новая",
  "новый",
  "новое",
  "восстановл",
  "remanufactured",
  "rebuilt",
];

// Keywords that indicate defective / damaged units — must be excluded.
// "с разборки" alone is kept (it is a standard contractual term);
// only "с разборки под запчасти" (damaged donor) is excluded.
const DEFECT_KEYWORDS = [
  "дефект",
  "неисправн",
  "не работ",
  "пинает",
  "толчок",
  "рывок",
  "на запчасти",
  "под восстановление",
  "требует ремонта",
  "не едет",
  "нет задней",
  "нет передач",
  "горит check",
  "в ремонт",
  "разбор",
  "с разборки под запчасти",
];

// Keywords that indicate used / contract units — prioritized
const PREFER_KEYWORDS = [
  "контрактная",
  "б/у",
  "с разборки",
  "из японии",
  "из европы",
  "японская",
  "европейская",
  "kontraktnaya",
];

const LISTING_INCLUDE_KEYWORDS = [
  "в сборе", "коробка", "мкпп", "акпп", "вариатор",
  "контрактная", "контракт", "б/у", "бу",
];

const LISTING_EXCLUDE_KEYWORDS = [
  "гидроблок", "насос", "сальник", "вал", "поддон",
  "фильтр", "датчик", "ремкомплект", "на запчасти",
  "под восстановление", "требует ремонта", "дефект",
  "не работает",
];

// Strip parenthetical suffix for DISPLAY purposes only (e.g. customer-facing labels).
// Do NOT use in search query builders — "FAU(5A)" must be passed verbatim so GPT
// finds the specific variant, not the entire FAU series.
function stripParentheticalForDisplay(code: string): string {
  const idx = code.indexOf("(");
  return idx !== -1 ? code.slice(0, idx).trim() : code.trim();
}

// Prefer GPT-identified market codes (e.g. W5MBB) over raw OEM catalog numbers
// (e.g. 2500A230). OEM codes with 4+ consecutive digits are internal catalog refs
// that produce poor search results.
function resolveSearchTerm(oem: string, modelName: string | null): string {
  if (!modelName) return oem;
  if (/\d{4,}/.test(modelName)) return oem; // looks like an OEM/catalog number
  return modelName;
}

// ─── Anchor selection helpers ─────────────────────────────────────────────────

/**
 * Generic gearbox type strings that should NEVER be used as a market model
 * anchor — they are type labels, not model codes.
 */
const GEARBOX_TYPE_STRINGS_SEARCHER = new Set([
  "CVT", "AT", "MT", "DCT", "AMT",
  "АКПП", "МКПП", "ВАРИАТОР", "АВТОМАТ",
  "AUTO", "MANUAL", "AUTOMATIC",
  // Numeric-prefixed type labels (mirrored from price-lookup.worker.ts)
  "4AT", "5AT", "6AT", "7AT", "8AT", "9AT", "10AT",
  "4MT", "5MT", "6MT", "7MT",
  "7DCT", "8DCT", "6DCT",
  "4WD", "2WD", "AWD", "FWD", "RWD",
]);

/**
 * Returns true when `modelName` looks like a real market model code
 * (e.g. JF011E, W5MBB, AW55-51SN) rather than an internal OEM catalog number
 * (e.g. 2500A230, 31020-3VX2D) or a generic type label (AT, CVT …).
 *
 * Rules (mirrored from isValidTransmissionModel in price-lookup.worker):
 *   - non-empty
 *   - not a gearbox type string
 *   - length ≤ 12 characters
 *   - must NOT contain 4+ consecutive digits (catalog code guard)
 *   - must match /^[A-Z0-9][A-Z0-9\-()]{1,11}$/
 *
 * Exported so unit tests can cover it independently.
 */
export function isValidMarketModelName(modelName: string | null | undefined): boolean {
  if (!modelName) return false;
  if (GEARBOX_TYPE_STRINGS_SEARCHER.has(modelName.toUpperCase())) return false;
  // Reject numeric-prefixed type labels not covered by the set: 4AT, 5MT, 7DCT, etc.
  if (/^\d+[A-Z]{2,3}$/.test(modelName.toUpperCase())) return false;
  if (modelName.length > 12) return false;
  if (/\d{4,}/.test(modelName)) return false;
  return /^[A-Z0-9][A-Z0-9\-()]{1,11}$/.test(modelName);
}

/**
 * Selects the primary search anchor for Yandex queries when the
 * YANDEX_PREFER_MODELNAME feature flag is enabled.
 *
 * Policy:
 *   - PN input + valid modelName               → modelName (marketplace codes win)
 *   - TC/legacy input + valid modelName ≠ oem  → modelName (GPT-resolved code)
 *   - anything else                            → oem (safe fallback)
 *
 * When flag is OFF this function is never called and oem is used directly.
 *
 * Exported so unit tests can cover it independently.
 */
export function selectYandexAnchor(
  oem: string,
  modelName: string | null | undefined,
  inputKind: PriceSearchInputKind
): string {
  if (!isValidMarketModelName(modelName)) return oem;
  // PN input: always prefer the identified market code when available
  if (inputKind === "oemPartNumber") return modelName!;
  // TC/legacy input: only prefer when modelName actually differs (avoids no-op)
  if (modelName !== oem) return modelName!;
  return oem;
}

function buildPrimaryQuery(
  oem: string,
  modelName: string | null,
  origin: Origin,
  gearboxLabel: string,
  make?: string | null,
  vehicleDesc?: string | null
): string {
  const searchTerm = resolveSearchTerm(oem, modelName);
  // Append OEM code only when it differs from searchTerm to avoid duplication
  const oemSuffix = searchTerm !== oem ? ` ${oem}` : '';
  const makePart = make ? `${make} ` : "";
  switch (origin) {
    case "japan":
      return vehicleDesc
        ? `контрактная ${gearboxLabel} ${searchTerm}${oemSuffix} ${vehicleDesc} б/у из Японии`
        : `${gearboxLabel} ${makePart}${searchTerm}${oemSuffix} контрактная б/у из Японии`;
    case "europe":
      return vehicleDesc
        ? `контрактная ${gearboxLabel} ${searchTerm}${oemSuffix} ${vehicleDesc} б/у из Европы`
        : `${gearboxLabel} ${makePart}${searchTerm}${oemSuffix} контрактная б/у из Европы`;
    default:
      return vehicleDesc
        ? `контрактная ${gearboxLabel} ${searchTerm}${oemSuffix} ${vehicleDesc} б/у`
        : `контрактная ${gearboxLabel} ${searchTerm}${oemSuffix} б/у`;
  }
}

function buildFallbackQuery(
  oem: string,
  modelName: string | null,
  gearboxLabel: string,
  make?: string | null,
  vehicleDesc?: string | null
): string {
  const searchTerm = resolveSearchTerm(oem, modelName);
  const oemSuffix = searchTerm !== oem ? ` ${oem}` : '';
  if (vehicleDesc) {
    return `контрактная ${gearboxLabel} ${searchTerm}${oemSuffix} ${vehicleDesc} цена купить`;
  }
  const makePart = make ? `${make} ` : "";
  return `контрактная ${gearboxLabel} ${makePart}${searchTerm}${oemSuffix} цена купить`;
}

function isExcluded(text: string): boolean {
  const lower = text.toLowerCase();
  return EXCLUDE_KEYWORDS.some((kw) => lower.includes(kw));
}

function isDefective(text: string): boolean {
  const lower = text.toLowerCase();
  // "с разборки" is a standard used-parts term and must NOT be treated as defective.
  // Whitelist it before substring matching because "разбор" ⊂ "с разборки".
  // Only "с разборки под запчасти" (damaged donor) remains defective.
  if (/с разборки(?!\s+под\s+запчасти)/.test(lower)) return false;
  return DEFECT_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

function isPreferred(text: string): boolean {
  const lower = text.toLowerCase();
  return PREFER_KEYWORDS.some((kw) => lower.includes(kw));
}

function parsePriceFromText(text: string): number | null {
  const match = text.match(/(\d[\d\s]*)\s*(?:₽|руб\.?|RUB)/i);
  if (!match) return null;
  const num = parseInt(match[1].replace(/\s/g, ""), 10);
  if (!Number.isFinite(num) || num < 1_000 || num > 15_000_000) return null;
  // Handle USD → RUB conversion (~90 rate)
  return num;
}

function parseMileageFromText(text: string): number | null {
  const match = text.match(/(\d[\d\s]*)\s*(?:км|km)/i);
  if (!match) return null;
  const num = parseInt(match[1].replace(/\s/g, ""), 10);
  if (!Number.isFinite(num) || num < 0 || num > 500_000) return null;
  return num;
}

function extractSiteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/**
 * Internal listing type.  Exported so the pure `applyIntlMixing` helper and
 * its unit tests can reference it directly without duplication.
 */
export interface ParsedListing {
  title: string;
  price: number;
  mileage: number | null;
  url: string;
  site: string;
  isUsed: boolean;
  /** Tagging field: "intl" for listings sourced from runInternationalSearch().
   *  Absent / undefined means the listing came from a Russian-market search. */
  market?: "ru" | "intl";
}

/**
 * Removes statistical outliers from a price array.
 *
 * For n >= 4: applies standard IQR filter (unchanged — do not modify).
 * For n < 4 (small-sample path):
 *   - When `smallSampleGuardEnabled` is false (default): returns prices unchanged
 *     (backward-compatible — identical to pre-guard behavior).
 *   - When `smallSampleGuardEnabled` is true AND 2 <= n < 4:
 *     Applies a symmetric median guard — removes any price that is more than
 *     3× the median OR less than 1/3 of the median.
 *     If the filtered result contains at least 2 prices, returns filtered array
 *     ("trimmed" or "skipped"). Otherwise falls back to the original array to
 *     prevent returning a single-item set ("fallback").
 *   Emits `price_search.small_sample_guard_applied` metric with result tag.
 *
 * Exported for unit testing.
 */
export function removeOutliers(prices: number[], smallSampleGuardEnabled = false): number[] {
  if (prices.length < 4) {
    // Small-sample guard — only runs when flag is enabled and n is 2 or 3.
    if (smallSampleGuardEnabled && prices.length >= 2) {
      const sorted = [...prices].sort((a, b) => a - b);
      // Use index-based median (floor) — consistent with IQR path's percentile logic.
      const median = sorted[Math.floor(sorted.length / 2)];

      const filtered = prices.filter(p => p <= median * 3 && p >= median / 3);

      if (filtered.length >= 2) {
        const result: "trimmed" | "skipped" =
          filtered.length < prices.length ? "trimmed" : "skipped";
        incr("price_search.small_sample_guard_applied", { result });
        return filtered;
      }

      // Fail-safe: guard would remove too many — return original array unchanged.
      incr("price_search.small_sample_guard_applied", { result: "fallback" });
      return prices;
    }

    // Flag disabled or n < 2 — preserve pre-guard behavior exactly.
    return prices;
  }

  // ── IQR filter for n >= 4 (DO NOT MODIFY) ────────────────────────────────
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;

  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  return prices.filter(p => p >= lowerBound && p <= upperBound);
}

/**
 * Absolute minimum price for a used transmission assembly (in RUB).
 * Listings below this threshold are almost certainly accessories, small parts,
 * or parsing artefacts — not a complete КПП unit.
 */
const MIN_TRANSMISSION_PRICE_RUB = 3_000;

function validatePrices(listings: ParsedListing[]): ParsedListing[] {
  // Step 1: absolute minimum — remove obvious non-KPP results (accessories, sensors, etc.)
  const absFiltered = listings.filter(l => {
    if (l.price < MIN_TRANSMISSION_PRICE_RUB) {
      console.warn(
        `[PriceSearcher] Price ${l.price} RUB from ${l.site} below absolute minimum ` +
        `(${MIN_TRANSMISSION_PRICE_RUB} RUB) — excluded`
      );
      return false;
    }
    return true;
  });

  if (absFiltered.length < 2) return absFiltered;

  // Step 2: relative median filter — catches unconverted USD/JPY values (< 1% of median)
  const prices = absFiltered.map(l => l.price).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];

  return absFiltered.filter(l => {
    if (l.price < median * 0.01) {
      console.warn(
        `[PriceSearcher] Suspicious price ${l.price} RUB from ${l.site} ` +
        `(${(l.price / median * 100).toFixed(1)}% of median ${median}) — excluded`
      );
      return false;
    }
    return true;
  });
}

/** Result returned by applyIntlMixing — carries side-effect metadata for metrics. */
export interface IntlMixingResult {
  listings: ParsedListing[];
  /** Number of intl listings removed by the 2.5× cap (Case A). Zero when cap not applied. */
  capRemovedCount: number;
  /** True when the 0.75× discount was applied to intl prices (Case B). */
  discountApplied: boolean;
}

/**
 * Applies international price mixing control to a combined set of RU + intl
 * listings.  Pure function — no side effects (metrics are emitted by the caller).
 *
 * Case A — RU results exist (ruListings.length >= 2) AND intlCapEnabled:
 *   Removes intl listings where price > ruMedian * 2.5.
 *
 * Case B — No RU results (ruListings.length < 2) AND intlDiscountEnabled:
 *   Multiplies all intl prices by INTL_DISCOUNT_FACTOR (0.75).
 *
 * When both flags are false the input listings are returned unchanged, making
 * the behavior identical to pre-feature baseline.
 *
 * Exported for unit testing.
 */
export function applyIntlMixing(
  listings: ParsedListing[],
  intlCapEnabled: boolean,
  intlDiscountEnabled: boolean
): IntlMixingResult {
  const ruListings = listings.filter(l => l.market !== "intl");
  const intlListings = listings.filter(l => l.market === "intl");

  // No intl present → nothing to do
  if (intlListings.length === 0) {
    return { listings, capRemovedCount: 0, discountApplied: false };
  }

  // Case A: RU results exist — cap intl prices above 2.5× RU median
  if (ruListings.length >= 2 && intlCapEnabled) {
    const ruPrices = ruListings.map(l => l.price).sort((a, b) => a - b);
    // Index-based median consistent with removeOutliers IQR path
    const ruMedian = ruPrices[Math.floor(ruPrices.length / 2)];
    const cap = ruMedian * 2.5;
    const cappedIntl = intlListings.filter(l => l.price <= cap);
    const capRemovedCount = intlListings.length - cappedIntl.length;
    return {
      listings: [...ruListings, ...cappedIntl],
      capRemovedCount,
      discountApplied: false,
    };
  }

  // Case B: Intl-only — apply discount factor
  if (ruListings.length < 2 && intlDiscountEnabled) {
    const discounted = intlListings.map(l => ({
      ...l,
      price: Math.round(l.price * INTL_DISCOUNT_FACTOR),
    }));
    return {
      listings: [...ruListings, ...discounted],
      capRemovedCount: 0,
      discountApplied: true,
    };
  }

  // Flags disabled or conditions not met → identical to baseline
  return { listings, capRemovedCount: 0, discountApplied: false };
}

function parseListingsFromResponse(content: string): ParsedListing[] {
  const listings: ParsedListing[] = [];

  // Try to find JSON array in the response first
  const jsonMatch = content.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]) as Array<Record<string, unknown>>;
      for (const item of arr) {
        const price = typeof item.price === "number" ? item.price : parsePriceFromText(String(item.price ?? ""));
        if (!price) continue;
        // Accept both {site, url} (old format) and {source} (new flexible format)
        const siteValue = String(item.site ?? item.source ?? extractSiteName(String(item.url ?? "")));
        listings.push({
          title: String(item.title ?? ""),
          price,
          mileage: typeof item.mileage === "number" ? item.mileage : parseMileageFromText(String(item.mileage ?? "")),
          url: String(item.url ?? ""),
          site: siteValue,
          isUsed: true,
        });
      }
      if (listings.length > 0) return listings;
    } catch {
      // Fall through to text parsing
    }
  }

  // Text parsing fallback — scan each line/paragraph for price data
  const lines = content.split(/\n+/);
  for (const line of lines) {
    if (isExcluded(line)) continue;
    const price = parsePriceFromText(line);
    if (!price) continue;
    const mileage = parseMileageFromText(line);
    const urlMatch = line.match(/https?:\/\/[^\s)]+/);
    const url = urlMatch ? urlMatch[0] : "";
    listings.push({
      title: line.slice(0, 200).trim(),
      price,
      mileage,
      url,
      site: extractSiteName(url),
      isUsed: isPreferred(line),
    });
  }

  return listings;
}

function resolveGearboxLabel(gearboxType?: string | null): string {
  if (!gearboxType) return "КПП";
  const t = gearboxType.toUpperCase();
  if (t === "MT") return "МКПП";
  if (t === "AT") return "АКПП";
  if (t === "CVT") return "вариатор";
  return "КПП";
}

interface YandexQueryOpts {
  /** Input kind forwarded from the search caller. */
  inputKind?: PriceSearchInputKind;
  /**
   * Whether the YANDEX_PREFER_MODELNAME flag is active for this tenant.
   * When false (default) the function produces identical output to pre-Step-7.
   */
  flagEnabled?: boolean;
  /**
   * Whether the OUTLIER_GUARD_SMALL_SAMPLE flag is active for this tenant.
   * When false (default) small-sample guard is not applied, preserving
   * pre-guard behavior for the Yandex path.
   */
  smallSampleGuardEnabled?: boolean;
}

/**
 * Builds the list of Yandex search queries for the price-search stage.
 *
 * Flag OFF (default): behavior is IDENTICAL to pre-Step-7 — oem is always Q1 anchor.
 * Flag ON: anchor is determined by selectYandexAnchor() based on inputKind and
 *   modelName validity.  The PN is kept as a secondary token when it is not the anchor.
 */
export function buildYandexQueries(
  oem: string,
  modelName: string | null,
  make?: string | null,
  model?: string | null,
  gearboxType?: string | null,
  opts?: YandexQueryOpts
): string[] {
  const label = resolveGearboxLabel(gearboxType);
  const flagEnabled = opts?.flagEnabled ?? false;
  const inputKind: PriceSearchInputKind = opts?.inputKind ?? "legacy";

  // ── Anchor selection ───────────────────────────────────────────────────────
  // When flag is OFF, anchorTerm === oem unconditionally (no behavior change).
  const anchorTerm: string = flagEnabled
    ? selectYandexAnchor(oem, modelName, inputKind)
    : oem;

  // Is the selected anchor a model name rather than the raw OEM/PN?
  const anchorIsModelName = anchorTerm !== oem;

  // Secondary PN token: included in Q2 when anchor is modelName and oem is a PN
  // so that listings containing the part number are still found.
  const pnSuffix = anchorIsModelName ? ` ${oem}` : "";

  const queries: string[] = [];

  // Query 1: always — most reliable
  queries.push(`${label} ${anchorTerm} купить`);

  // Query 2: with make+model context
  if (make && model) {
    queries.push(`${label} ${make} ${model} ${anchorTerm}${pnSuffix} контрактная`);
  } else if (make) {
    queries.push(`${label} ${make} ${anchorTerm}${pnSuffix} контрактная`);
  }

  // Queries 3 & 4: with modelName if it differs from OEM and has no 4+ digits.
  // Mirrored from pre-Step-7 logic; deduplicated against Q1 when anchor already
  // uses modelName so we don't emit two identical queries.
  if (modelName && modelName !== oem && !/\d{4,}/.test(modelName)) {
    const q3 = `${label} ${modelName} ${make} купить`;
    const q4 = `${label} ${modelName} цена`;
    // Avoid exact duplicates with Q1 (happens when anchorTerm === modelName and make is falsy)
    if (q3 !== queries[0]) queries.push(q3);
    if (q4 !== queries[0] && q4 !== queries[1]) queries.push(q4);
  }

  return queries.slice(0, 4);
}

function parseListingsFromHtml(
  html: string,
  sourceUrl: string,
  domain: string
): ParsedListing[] {
  const listings: ParsedListing[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cheerio = require("cheerio");
    const $ = cheerio.load(html);

    // Generic price pattern — works across most RU auto parts sites
    const pricePattern = /(\d[\d\s]{2,})\s*(?:₽|руб|rub)/gi;
    const bodyText = $("body").text();
    const matches = [...bodyText.matchAll(pricePattern)];

    // Structured selectors for avito.ru
    // Avito renders via React — prices are in data-marker attributes and itemprop.
    // Fallback to body-text price scan when no structured items found.
    if (domain.includes("avito.ru")) {
      // Primary: item cards with data-marker="item"
      $("[data-marker='item']").each((_i: number, el: any) => {
        const title = $(el).find("[itemprop='name'], [data-marker='item-title']").first().text().trim()
          || $(el).find("h3, h2, a").first().text().trim();
        const priceEl = $(el).find("[data-marker='item-price'], [itemprop='price'], [class*='price']").first();
        const priceText = priceEl.attr("content") || priceEl.text().trim();
        const price = parsePriceFromText(priceText);
        const href = $(el).find("a[data-marker='item-title'], a").first().attr("href");
        const url = href ? (href.startsWith("http") ? href : `https://www.avito.ru${href}`) : sourceUrl;
        if (price && title) {
          listings.push({ title, price, url, site: domain, mileage: null, isUsed: true });
        }
      });
      // Secondary: meta itemprop price on the page (listing detail page)
      if (listings.length === 0) {
        $("[itemprop='price']").each((_i: number, el: any) => {
          const priceText = $(el).attr("content") || $(el).text().trim();
          const price = parsePriceFromText(priceText + " ₽");
          const title = $("[itemprop='name']").first().text().trim() || "АКПП б/у (avito.ru)";
          if (price) {
            listings.push({ title, price, url: sourceUrl, site: domain, mileage: null, isUsed: true });
          }
        });
      }
    }

    // Structured selectors for drom.ru
    if (domain.includes("drom.ru")) {
      $("[data-bull-item], .bull-item, .listing-item").each((_i: number, el: any) => {
        const title = $(el).find(".bull-item__subject, .item-title, h3").first().text().trim();
        const priceText = $(el).find(".bull-item__price-block, .price, [class*='price']").first().text().trim();
        const price = parsePriceFromText(priceText);
        const href = $(el).find("a").first().attr("href");
        const url = href ? (href.startsWith("http") ? href : `https://baza.drom.ru${href}`) : sourceUrl;
        if (price && title) {
          listings.push({ title, price, url, site: domain, mileage: null, isUsed: true });
        }
      });
    }

    // Structured selectors for farpost.ru
    if (domain.includes("farpost.ru")) {
      $(".bull-item, .lot-title, [class*='item']").each((_i: number, el: any) => {
        const title = $(el).find("a, h3, .title").first().text().trim();
        const priceText = $(el).find("[class*='price']").first().text().trim();
        const price = parsePriceFromText(priceText);
        const href = $(el).find("a").first().attr("href");
        const url = href ? (href.startsWith("http") ? href : `https://farpost.ru${href}`) : sourceUrl;
        if (price && title) {
          listings.push({ title, price, url, site: domain, mileage: null, isUsed: true });
        }
      });
    }

    // Structured selectors for japancar.ru / dvsavto.ru / kor-motor.ru / similar RU parts sites
    if (
      listings.length === 0 &&
      (domain.includes("japancar.ru") ||
        domain.includes("dvsavto.ru") ||
        domain.includes("kor-motor.ru") ||
        domain.includes("avtgr.ru") ||
        domain.includes("qx9.ru") ||
        domain.includes("bibika.ru"))
    ) {
      $(".product-card, .product-item, .item-card, [class*='product'], [class*='catalog-item']").each(
        (_i: number, el: any) => {
          const title = $(el).find("h2, h3, .title, .name, a").first().text().trim();
          const priceText = $(el).find("[class*='price'], .price, .cost").first().text().trim();
          const price = parsePriceFromText(priceText);
          const href = $(el).find("a").first().attr("href");
          const url = href ? (href.startsWith("http") ? href : `https://${domain}${href}`) : sourceUrl;
          if (price && title) {
            listings.push({ title, price, url, site: domain, mileage: null, isUsed: true });
          }
        }
      );
    }

    // Universal fallback: extract prices from page text
    if (listings.length === 0 && matches.length > 0) {
      for (const match of matches.slice(0, 5)) {
        const price = parsePriceFromText(match[0]);
        if (price) {
          listings.push({
            title: `КПП б/у (${domain})`,
            price,
            url: sourceUrl,
            site: domain,
            mileage: null,
            isUsed: true,
          });
        }
      }
    }
  } catch (err) {
    console.warn(`[PriceSearcher] HTML parse error for ${domain}:`, err);
  }
  return listings;
}

function filterListingsByTitle(listings: ParsedListing[]): ParsedListing[] {
  return listings.filter((l) => {
    const title = l.title.toLowerCase();
    const hasExcluded = LISTING_EXCLUDE_KEYWORDS.some((kw) => title.includes(kw));
    if (hasExcluded) return false;
    // Only apply include filter if title is descriptive enough
    if (title.length < 5) return true;
    const hasIncluded = LISTING_INCLUDE_KEYWORDS.some((kw) => title.includes(kw));
    return hasIncluded;
  });
}

export async function searchWithYandex(
  oem: string,
  modelName: string | null,
  make?: string | null,
  model?: string | null,
  gearboxType?: string | null,
  opts?: YandexQueryOpts
): Promise<{ listings: ParsedListing[]; urlsChecked: string[] }> {
  const queries = buildYandexQueries(oem, modelName, make, model, gearboxType, opts);
  console.log(`[PriceSearcher/Yandex] Queries: ${JSON.stringify(queries)}`);

  // Run all queries in parallel
  const searchResults = await Promise.allSettled(
    queries.map((q) => searchYandex(q, 5))
  );

  // Collect and deduplicate URLs sorted by priority
  const urlMap = new Map<string, { title: string; snippet: string; domain: string; score: number }>();
  for (const result of searchResults) {
    if (result.status === "fulfilled") {
      for (const item of result.value) {
        if (!urlMap.has(item.url)) {
          urlMap.set(item.url, {
            title: item.title,
            snippet: item.snippet,
            domain: item.domain,
            score: item.priorityScore,
          });
        }
      }
    }
  }

  // Sort by priority, take top 8
  const sortedUrls = Array.from(urlMap.entries())
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 8)
    .map(([url]) => url);

  console.log(`[PriceSearcher/Yandex] Opening ${sortedUrls.length} URLs via Playwright`);

  // Open all candidate URLs concurrently. Promise.allSettled handles individual failures gracefully.
  const pageResults = await Promise.allSettled(
    sortedUrls.map(async (url) => {
      const html = await fetchPageViaPlaywright(url);
      return { url, html };
    })
  );

  const urlsChecked: string[] = [];
  const allListings: ParsedListing[] = [];

  for (const result of pageResults) {
    if (result.status === "fulfilled" && result.value.html) {
      const { url, html } = result.value;
      urlsChecked.push(url);
      const domain = urlMap.get(url)?.domain ?? "";
      const parsed = parseListingsFromHtml(html, url, domain);
      const filtered = filterListingsByTitle(parsed);
      console.log(
        `[PriceSearcher/Yandex] ${domain}: parsed=${parsed.length}, kept=${filtered.length}`
      );
      allListings.push(...filtered);
    }
  }

  // Deduplicate by url
  const seen = new Set<string>();
  const dedupedListings = allListings.filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });

  // Remove outliers — small-sample guard forwarded from caller opts when flag is ON.
  const validPrices = removeOutliers(
    dedupedListings.map((l) => l.price),
    opts?.smallSampleGuardEnabled ?? false
  );
  const validListings = dedupedListings.filter((l) => validPrices.includes(l.price));

  console.log(
    `[PriceSearcher/Yandex] Final: ${validListings.length} listings from ${urlsChecked.length} pages`
  );

  return { listings: validListings, urlsChecked };
}

async function fetchLiveFxRates(): Promise<Record<string, number>> {
  const DEFAULT_RATES: Record<string, number> = {
    JPY: 0.50,
    EUR: 95.0,
    USD: 88.0,
    KRW: 0.065,
  };
  try {
    // Free API, no key required, returns JSON
    const res = await fetch(
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/rub.json",
      { signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) return DEFAULT_RATES;
    const data = await res.json();
    // data.rub contains rates FROM rub, we need rates TO rub
    // So rate_to_rub = 1 / data.rub[currency_lowercase]
    const rub = data?.rub as Record<string, number> | undefined;
    if (!rub) return DEFAULT_RATES;
    return {
      JPY: rub.jpy ? Math.round((1 / rub.jpy) * 1000) / 1000 : DEFAULT_RATES.JPY,
      EUR: rub.eur ? Math.round((1 / rub.eur) * 100) / 100 : DEFAULT_RATES.EUR,
      USD: rub.usd ? Math.round((1 / rub.usd) * 100) / 100 : DEFAULT_RATES.USD,
      KRW: rub.krw ? Math.round((1 / rub.krw) * 10000) / 10000 : DEFAULT_RATES.KRW,
    };
  } catch {
    console.warn("[PriceSearcher] FX fetch failed, using default rates");
    return DEFAULT_RATES;
  }
}

/**
 * Searches for used/contract transmission prices via OpenAI Responses API
 * (gpt-4.1 with web_search tool).
 * Returns source: 'not_found' if < 2 valid listings found after filtering.
 */
export async function searchUsedTransmissionPrice(
  oem: string,
  modelName: string | null,
  origin: Origin,
  make?: string | null,
  vehicleContext?: VehicleContext | null,
  tenantId?: string | null,
  opts?: PriceSearchOpts
): Promise<PriceSearchResult> {
  const fxRates = await fetchLiveFxRates();
  console.log("[PriceSearcher] FX rates:", fxRates);

  const vehicleDesc =
    vehicleContext?.make && vehicleContext?.model
      ? `${vehicleContext.make} ${vehicleContext.model}`
      : null;

  // Derive correct Russian gearbox label from vehicleContext.
  // BUG 4: null/unknown gearboxType uses neutral "КПП" to avoid incorrect
  // АКПП in search queries and customer-facing responses.
  const gearboxLabel =
    vehicleContext?.gearboxType === "MT" ? "МКПП" :
    vehicleContext?.gearboxType === "CVT" ? "вариатор" :
    vehicleContext?.gearboxType === "AT" ? "АКПП" :
    "КПП";

  const primaryQuery = buildPrimaryQuery(oem, modelName, origin, gearboxLabel, make, vehicleDesc);
  const fallbackQuery = buildFallbackQuery(oem, modelName, gearboxLabel, make, vehicleDesc);

  const notFoundResult: PriceSearchResult = {
    minPrice: 0,
    maxPrice: 0,
    avgPrice: 0,
    mileageMin: null,
    mileageMax: null,
    currency: "RUB",
    source: "not_found",
    listingsCount: 0,
    listings: [],
    searchQuery: primaryQuery,
    filteredOutCount: 0,
  };

  // Shared system-level instructions for GPT web_search calls.
  // Kept separate from the search query (input) so the model executes the query
  // verbatim rather than treating the instructions as part of the search string.
  const RU_SEARCH_INSTRUCTIONS =
    "Ты — агент поиска цен на б/у автозапчасти на российском рынке. " +
    "Выполни веб-поиск по запросу пользователя и найди ЛЮБЫЕ упоминания цен " +
    "на маркетплейсах, сайтах дилеров, агрегаторах, форумах и других российских сайтах автозапчастей. " +
    "Для каждой найденной цены верни объект JSON: " +
    "{\"price\": <целое число в рублях>, \"source\": \"<домен>\", \"title\": \"<краткое описание>\"}. " +
    "Если указан диапазон (например 'от 70 000 до 120 000 ₽') — создай ДВЕ записи: с минимальной и максимальной ценой. " +
    "Верни ТОЛЬКО валидный JSON-массив. Если ничего не найдено — верни []. " +
    "НЕ включай новые и восстановленные агрегаты. Включай б/у, контрактные, с разборки. " +
    "Не требуй пробег или другие структурированные поля.";

  // Russian market search — flexible price extraction, any Russian auto parts source.
  // extraContext is appended to the system instructions when partial Yandex listings
  // are available — it asks GPT to confirm or expand the already-known prices.
  const runSearch = async (query: string, extraContext = ""): Promise<ParsedListing[]> => {
    console.log(`[PriceSearcher] Web search query: "${query}"`);
    const searchInstructions = extraContext
      ? RU_SEARCH_INSTRUCTIONS + extraContext
      : RU_SEARCH_INSTRUCTIONS;
    try {
      const response = await (openai as any).responses.create({
        model: "gpt-4.1",
        tools: [{ type: "web_search" }],
        instructions: searchInstructions,
        input: query,
      });

      const content: string = response.output_text ?? "";
      console.log('[PriceSearcher] Raw GPT response:', content.substring(0, 2000));
      const parsed = validatePrices(parseListingsFromResponse(content));
      console.log('[PriceSearcher] Parsed listings count (price-validated):', parsed.length);
      return parsed;
    } catch (err: any) {
      console.warn(`[PriceSearcher] OpenAI web search failed: ${err.message}`);
      return [];
    }
  };

  // International fallback — searches Yahoo Auctions Japan, eBay, JDM/EU parts sites
  // and converts prices to RUB using live FX rates fetched at session start
  const runInternationalSearch = async (): Promise<ParsedListing[]> => {
    const searchDesc = modelName ?? oem;

    // Target sources by transmission origin — Japanese units are on Яфуоку,
    // European units are better covered by eBay.de / leboncoin / EU dealers.
    const intlSources =
      origin === "japan"
        ? "Yahoo Auctions Japan (ヤフオク), JDM parts sites, eBay"
        : origin === "europe"
        ? "eBay, leboncoin.fr, mobile.de, European auto parts dealers"
        : "Yahoo Auctions Japan (ヤフオク), eBay, JDM parts sites, European parts dealers";

    const intlInstructions =
      "Ты — агент поиска цен на б/у трансмиссии на международных площадках. " +
      "Выполни веб-поиск по запросу пользователя. Найди цены продажи б/у агрегатов. " +
      `Ищи на: ${intlSources}. ` +
      "Конвертируй все цены в рубли по курсам: " +
      `1 JPY = ${fxRates.JPY} RUB, 1 USD = ${fxRates.USD} RUB, ` +
      `1 EUR = ${fxRates.EUR} RUB, 1 KRW = ${fxRates.KRW} RUB. ` +
      "Верни JSON-массив: {\"price\": <конвертированная сумма в рублях, целое число>, " +
      "\"source\": \"<сайт>\", \"title\": \"<описание (оригинальная цена в исходной валюте)>\"}. " +
      "Если диапазон — две записи. Верни ТОЛЬКО валидный JSON-массив. Если ничего — верни []. " +
      "Не включай новые и восстановленные агрегаты.";

    const intlQuery = `${searchDesc} OEM ${oem} used gearbox price`;
    console.log(`[PriceSearcher] International search query: "${intlQuery}"`);
    try {
      const response = await (openai as any).responses.create({
        model: "gpt-4.1",
        tools: [{ type: "web_search" }],
        instructions: intlInstructions,
        input: intlQuery,
      });

      const content: string = response.output_text ?? "";
      console.log('[PriceSearcher] Raw GPT response (international):', content.substring(0, 2000));
      const parsed = validatePrices(
        parseListingsFromResponse(content).map(l => ({ ...l, market: "intl" as const }))
      );
      console.log('[PriceSearcher] International parsed listings:', parsed.length);
      return parsed;
    } catch (err: any) {
      console.warn(`[PriceSearcher] International web search failed: ${err.message}`);
      return [];
    }
  };

  // ── Feature flags ─────────────────────────────────────────────────────────
  const inputKind: PriceSearchInputKind = opts?.inputKind ?? "legacy";
  const yandexPreferModelName: boolean = tenantId
    ? await featureFlagService.isEnabled("YANDEX_PREFER_MODELNAME", tenantId)
    : false;

  // OUTLIER_GUARD_SMALL_SAMPLE: when ON, symmetric median guard is applied to
  // price arrays of size 2–3 before min/max/avg computation (Yandex + GPT paths).
  // Default false — no change to existing behavior when flag is absent/disabled.
  const outlierGuardSmallSample: boolean = tenantId
    ? await featureFlagService.isEnabled("OUTLIER_GUARD_SMALL_SAMPLE", tenantId)
    : false;

  // INTL_PRICE_CAP_ENABLED: when ON, intl listings priced above 2.5× RU median
  // are removed when Russian results exist (prevents inflating maxPrice).
  // Default false — identical to pre-flag behavior when absent/disabled.
  const intlCapEnabled: boolean = tenantId
    ? await featureFlagService.isEnabled("INTL_PRICE_CAP_ENABLED", tenantId)
    : false;

  // INTL_PRICE_DISCOUNT_ENABLED: when ON, intl listing prices are multiplied by
  // INTL_DISCOUNT_FACTOR (0.75) when used as the sole price source.
  // Default false — identical to pre-flag behavior when absent/disabled.
  const intlDiscountEnabled: boolean = tenantId
    ? await featureFlagService.isEnabled("INTL_PRICE_DISCOUNT_ENABLED", tenantId)
    : false;

  // Resolve which anchor will actually be used (for metrics only — query
  // construction uses the same logic internally via selectYandexAnchor).
  const effectiveAnchor = yandexPreferModelName
    ? selectYandexAnchor(oem, modelName, inputKind)
    : oem;
  const anchorKind: "modelName" | "oem" = effectiveAnchor !== oem ? "modelName" : "oem";

  incr("price_search.anchor_selected", {
    anchor: anchorKind,
    kind: inputKind,
    stage: "yandex",
  });

  // STAGE 1: Yandex + Playwright
  const yandexResult = await searchWithYandex(
    oem,
    modelName,
    vehicleContext?.make ?? make,
    vehicleContext?.model ?? null,
    vehicleContext?.gearboxType ?? null,
    {
      inputKind,
      flagEnabled: yandexPreferModelName,
      smallSampleGuardEnabled: outlierGuardSmallSample,
    }
  );

  incr("price_search.yandex.query_count", { kind: inputKind });

  const uniqueDomains = new Set(yandexResult.listings.map((l) => l.site)).size;
  const hasEnoughYandex =
    yandexResult.listings.length >= 3 || uniqueDomains >= 2;
  // Partial: 1–2 listings found but below the standalone threshold.
  // We carry them forward into the GPT stage rather than discarding them.
  const hasPartialYandex = !hasEnoughYandex && yandexResult.listings.length >= 1;

  if (hasEnoughYandex) {
    const prices = yandexResult.listings.map((l) => l.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    console.log(
      `[PriceSearcher] Yandex success: ${yandexResult.listings.length} listings, ` +
      `range ${minPrice}–${maxPrice} RUB`
    );
    const { confidenceScore, confidenceLevel, confidenceSignals } =
      computePriceConfidence(yandexResult.listings, "yandex");
    incr("price_search.confidence_level", { level: confidenceLevel });
    return {
      source: "yandex",
      minPrice,
      maxPrice,
      avgPrice,
      mileageMin: null,
      mileageMax: null,
      currency: "RUB",
      listingsCount: yandexResult.listings.length,
      searchQuery: yandexResult.urlsChecked.join(", "),
      filteredOutCount: 0,
      listings: yandexResult.listings,
      urlsChecked: yandexResult.urlsChecked,
      confidenceScore,
      confidenceLevel,
      confidenceSignals,
    };
  }

  console.log(
    `[PriceSearcher] Yandex ${hasPartialYandex ? "partial" : "no"} results ` +
    `(${yandexResult.listings.length} listings, ${uniqueDomains} domains) — ` +
    `${hasPartialYandex ? "enriching with GPT, carrying Yandex data forward" : "falling through to GPT fallback"}`
  );

  // Check if GPT web_search fallback is allowed (default true for backward compatibility)
  const gptFallbackEnabled = tenantId
    ? await featureFlagService.isEnabled("GPT_WEB_SEARCH_ENABLED", tenantId)
    : true;

  if (!gptFallbackEnabled) {
    return {
      ...notFoundResult,
      searchQuery: primaryQuery,
      urlsChecked: yandexResult.urlsChecked,
    };
  }

  // When partial Yandex listings exist, attach them as context so GPT knows
  // what we already have and focuses on finding additional sources.
  let yandexContextExtra = "";
  if (hasPartialYandex) {
    const yandexPriceList = yandexResult.listings
      .map((l) => `${l.price} руб. (${l.site})${l.title ? ": " + l.title.slice(0, 60) : ""}`)
      .join("; ");
    yandexContextExtra =
      ` Контекст: по этой трансмиссии уже найдены следующие цены через Яндекс: ${yandexPriceList}. ` +
      "Найди дополнительные источники для подтверждения или расширения этих данных.";
    console.log(
      `[PriceSearcher] Passing ${yandexResult.listings.length} partial Yandex listing(s) as GPT context`
    );
  }

  // Primary Russian search (GPT web_search fallback — will be replaced by escalation in Phase 3)
  const ruRawListings = await runSearch(primaryQuery, yandexContextExtra);
  let usedQuery = primaryQuery;

  // International fallback when primary Russian search returns nothing.
  // Tracked separately so the mixing logic can distinguish market origin.
  let intlRawListings: ParsedListing[] = [];
  if (ruRawListings.length === 0) {
    console.log('[PriceSearcher] No Russian results, trying international search...');
    intlRawListings = await runInternationalSearch();
    console.log(`[PriceSearcher] International search yielded ${intlRawListings.length} listings`);
  }

  // Combine.  With both flags OFF, rawListings is semantically identical to the
  // pre-feature value (either all-RU or all-intl, never both simultaneously in
  // the current flow).
  let rawListings: ParsedListing[] = [...ruRawListings, ...intlRawListings];

  // Helper: apply new/defective keyword filter to a raw listing array.
  // Defined here so it is available for both the primary pass and all
  // progressive simplification levels below.
  const applyKeywordFilter = (raw: ParsedListing[], label: string): { kept: ParsedListing[]; excluded: number } => {
    let excluded = 0;
    const kept = raw.filter((l) => {
      if (isExcluded(l.title)) { excluded++; return false; }
      if (isDefective(l.title)) {
        console.log(`[PriceSearcher] Excluded defective listing: "${l.title}" (${l.price} RUB)`);
        excluded++;
        return false;
      }
      return true;
    });
    console.log(`[PriceSearcher] After keyword filter (${label}): ${kept.length} kept, ${excluded} excluded`);
    return { kept, excluded };
  };

  // Filter: exclude new/rebuilt and defective/damaged units
  const primaryFiltered = applyKeywordFilter(rawListings, "primary");
  let filteredOut = primaryFiltered.excluded;
  let listings = primaryFiltered.kept;

  // ── Intl mixing logic ────────────────────────────────────────────────────
  // Runs only when intl listings are present in the combined set.
  // Both flags default to false → applyIntlMixing returns listings unchanged,
  // preserving full backward compatibility.
  {
    const ruCount = listings.filter(l => l.market !== "intl").length;
    const intlCount = listings.filter(l => l.market === "intl").length;

    incr("price_search.intl_present", { ruCount, intlCount });

    if (intlCount > 0) {
      const mixResult = applyIntlMixing(listings, intlCapEnabled, intlDiscountEnabled);
      listings = mixResult.listings;

      if (mixResult.capRemovedCount > 0) {
        incr("price_search.intl_cap_applied", { removed: mixResult.capRemovedCount });
        console.log(
          `[PriceSearcher] IntlCap: removed ${mixResult.capRemovedCount} intl listing(s) above 2.5× RU median`
        );
      }
      if (mixResult.discountApplied) {
        incr("price_search.intl_discount_applied");
        console.log(
          `[PriceSearcher] IntlDiscount: applied ${INTL_DISCOUNT_FACTOR}× factor to ${intlCount} intl listing(s)`
        );
      }
    }
  }
  // ── End intl mixing logic ────────────────────────────────────────────────

  // Progressive query simplification — each level activates only when the previous returns < 2 listings.
  //   Level 2 (fallback): model + OEM + vehicle + "цена купить"
  //   Level 3: model code only — strips OEM and vehicle context
  //   Level 4: OEM only — last resort before international / not_found
  const simplifiedQueries: Array<{ label: string; query: string }> = [];

  // Level 2: existing fallback query
  simplifiedQueries.push({ label: "fallback", query: fallbackQuery });

  // Level 3: just the model code (or OEM if no distinct model name), no vehicle context
  const level3Anchor = (modelName && modelName !== oem && !/\d{4,}/.test(modelName)) ? modelName : oem;
  if (level3Anchor !== fallbackQuery) {
    simplifiedQueries.push({
      label: "simplified-code",
      query: `${gearboxLabel} ${level3Anchor} купить`,
    });
  }

  // Level 4: raw OEM number only (skipped when level3 already used OEM as anchor)
  if (level3Anchor !== oem) {
    simplifiedQueries.push({
      label: "simplified-oem",
      query: `${gearboxLabel} ${oem} купить`,
    });
  }

  for (const { label, query } of simplifiedQueries) {
    if (listings.length >= 2) break;
    console.log(`[PriceSearcher] ${listings.length} listing(s) so far, trying ${label} query`);
    rawListings = await runSearch(query);
    usedQuery = query;
    const filtered = applyKeywordFilter(rawListings, label);
    listings = filtered.kept;
    filteredOut = filtered.excluded;
  }

  // Merge partial Yandex listings that were carried forward into the GPT result set.
  // Runs only when hasPartialYandex is true; deduplicates by URL (preferred) or price+site.
  if (hasPartialYandex) {
    const existingKeys = new Set(
      listings.map((l) => (l.url ? l.url : `${l.price}:${l.site}`))
    );
    const freshYandex = yandexResult.listings.filter((l) => {
      const key = l.url ? l.url : `${l.price}:${l.site}`;
      return !existingKeys.has(key);
    });
    if (freshYandex.length > 0) {
      console.log(`[PriceSearcher] Merging ${freshYandex.length} partial Yandex listing(s) into results`);
      listings = [...listings, ...freshYandex];
    }
  }

  if (listings.length < 2) {
    console.log(`[PriceSearcher] Not enough listings found for OEM "${oem}" (${listings.length} valid)`);
    return { ...notFoundResult, searchQuery: usedQuery, filteredOutCount: filteredOut };
  }

  // Remove outliers — small-sample guard active when flag is ON.
  const validPrices = removeOutliers(listings.map((l) => l.price), outlierGuardSmallSample);
  const validListings = listings.filter((l) => validPrices.includes(l.price));
  console.log(`[PriceSearcher] After outlier removal: ${validListings.length} kept (before: ${listings.length})`);

  if (validListings.length < 2) {
    return { ...notFoundResult, searchQuery: usedQuery, filteredOutCount: filteredOut };
  }

  const minPrice = Math.min(...validPrices);
  const maxPrice = Math.max(...validPrices);
  const avgPrice = Math.round(validPrices.reduce((a, b) => a + b, 0) / validPrices.length);

  const mileages = validListings.map((l) => l.mileage).filter((m): m is number => m !== null);
  const mileageMin = mileages.length > 0 ? Math.min(...mileages) : null;
  const mileageMax = mileages.length > 0 ? Math.max(...mileages) : null;

  console.log(
    `[PriceSearcher] Found ${validListings.length} valid listings for OEM "${oem}": ` +
      `${minPrice}–${maxPrice} RUB, avg ${avgPrice} RUB`
  );

  const { confidenceScore, confidenceLevel, confidenceSignals } =
    computePriceConfidence(validListings, "openai_web_search");

  // When partial Yandex data contributed to the result, the sample is inherently
  // weaker than a clean GPT-only or Yandex-sufficient result — cap at "low".
  const finalConfidenceLevel: "low" | "medium" | "high" = hasPartialYandex
    ? "low"
    : confidenceLevel;
  const finalConfidenceScore = hasPartialYandex
    ? Math.min(confidenceScore, 0.39)
    : confidenceScore;

  incr("price_search.confidence_level", { level: finalConfidenceLevel });

  return {
    minPrice,
    maxPrice,
    avgPrice,
    mileageMin,
    mileageMax,
    currency: "RUB",
    source: "openai_web_search",
    listingsCount: validListings.length,
    listings: validListings,
    searchQuery: usedQuery,
    filteredOutCount: filteredOut,
    confidenceScore: finalConfidenceScore,
    confidenceLevel: finalConfidenceLevel,
    confidenceSignals,
  };
}
