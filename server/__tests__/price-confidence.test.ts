/**
 * Unit tests for computePriceConfidence() — price confidence scoring layer.
 *
 * All tests operate on the pure function only (no I/O, no mocks required).
 * The function is deterministic: same inputs → same outputs every time.
 */
import {
  computePriceConfidence,
  ParsedListing,
} from "../services/price-searcher";

function makeListing(
  price: number,
  site: string,
  market?: "ru" | "intl"
): ParsedListing {
  return {
    title: "КПП б/у",
    price,
    mileage: null,
    url: `https://${site}/listing`,
    site,
    isUsed: true,
    market,
  };
}

describe("computePriceConfidence", () => {
  // ── Case 1: tiny intl-only sample with wide spread ────────────────────────
  it("2 intl listings, 1 domain, spread ~3× → low confidence", () => {
    const listings = [
      makeListing(50_000, "yahoo.jp", "intl"),
      makeListing(150_000, "yahoo.jp", "intl"),
    ];
    const result = computePriceConfidence(listings, "openai_web_search");

    // sampleSize=2  → +0.15
    // uniqueDomains=1 → +0.10
    // spreadRatio=3.0 → +0.05  (> 2.5)
    // intl-only       → +0
    // total = 0.30 → "low"
    expect(result.confidenceScore).toBeCloseTo(0.3, 5);
    expect(result.confidenceLevel).toBe("low");

    expect(result.confidenceSignals.sampleSize).toBe(2);
    expect(result.confidenceSignals.uniqueDomains).toBe(1);
    expect(result.confidenceSignals.spreadRatio).toBeCloseTo(3, 5);
    expect(result.confidenceSignals.ruCount).toBe(0);
    expect(result.confidenceSignals.intlCount).toBe(2);
  });

  // ── Case 2: solid RU sample with three sources and tight spread ───────────
  it("5 RU listings, 3 domains, spread 1.5× → high confidence", () => {
    const listings = [
      makeListing(80_000, "avito.ru"),
      makeListing(90_000, "avito.ru"),
      makeListing(100_000, "drom.ru"),
      makeListing(110_000, "drom.ru"),
      makeListing(120_000, "farpost.ru"),
    ];
    const result = computePriceConfidence(listings, "openai_web_search");

    // sampleSize=5  → +0.35
    // uniqueDomains=3 → +0.25
    // spreadRatio=1.5 → +0.25  (≤ 1.8)
    // ruCount=5, intlCount=0 → +0.10
    // total = 0.95 → "high"
    expect(result.confidenceScore).toBeCloseTo(0.95, 5);
    expect(result.confidenceLevel).toBe("high");

    expect(result.confidenceSignals.sampleSize).toBe(5);
    expect(result.confidenceSignals.uniqueDomains).toBe(3);
    expect(result.confidenceSignals.ruCount).toBe(5);
    expect(result.confidenceSignals.intlCount).toBe(0);
  });

  // ── Case 3: intl-only vs RU-only — same shape, intl must score lower ──────
  it("intl-only listings score lower than equivalent RU listings", () => {
    const shared = [
      { price: 80_000, site: "ebay.com" },
      { price: 90_000, site: "ebay.com" },
      { price: 100_000, site: "yahoo.jp" },
    ];

    const intlListings = shared.map((l) => makeListing(l.price, l.site, "intl"));
    // Same prices and sites but tagged as RU (no market field → treated as non-intl)
    const ruListings = shared.map((l) => makeListing(l.price, l.site));

    const intlResult = computePriceConfidence(intlListings, "openai_web_search");
    const ruResult = computePriceConfidence(ruListings, "openai_web_search");

    expect(intlResult.confidenceScore).toBeLessThan(ruResult.confidenceScore);
    // intl-only: market bonus = 0; RU-only: market bonus = +0.10
    expect(ruResult.confidenceScore - intlResult.confidenceScore).toBeCloseTo(0.1, 5);
  });

  // ── Case 4: ai_estimate multiplies the raw score by 0.6 ──────────────────
  it("ai_estimate source multiplies the base score by 0.6", () => {
    const listings = [
      makeListing(80_000, "avito.ru"),
      makeListing(100_000, "drom.ru"),
      makeListing(120_000, "farpost.ru"),
    ];

    const webResult = computePriceConfidence(listings, "openai_web_search");
    const aiResult = computePriceConfidence(listings, "ai_estimate");

    // The two calls share identical listings so base score is the same;
    // ai_estimate applies a 0.6 multiplier on top.
    expect(aiResult.confidenceScore).toBeCloseTo(webResult.confidenceScore * 0.6, 5);
    // Sanity: ai score is strictly lower
    expect(aiResult.confidenceScore).toBeLessThan(webResult.confidenceScore);
  });

  // ── Case 5: not_found always yields zero regardless of listings ───────────
  it("not_found source → confidenceScore=0 and level='low'", () => {
    const result = computePriceConfidence([], "not_found");

    expect(result.confidenceScore).toBe(0);
    expect(result.confidenceLevel).toBe("low");
    expect(result.confidenceSignals.sampleSize).toBe(0);
  });

  it("not_found with non-empty listings still → confidenceScore=0", () => {
    // Even if somehow listings were passed with not_found, score must be 0.
    const listings = [makeListing(100_000, "avito.ru"), makeListing(120_000, "drom.ru")];
    const result = computePriceConfidence(listings, "not_found");
    expect(result.confidenceScore).toBe(0);
    expect(result.confidenceLevel).toBe("low");
  });

  // ── Edge cases ────────────────────────────────────────────────────────────
  it("single listing → no spread penalty (spreadRatio=1), low overall", () => {
    const listings = [makeListing(100_000, "avito.ru")];
    const result = computePriceConfidence(listings, "openai_web_search");
    // sampleSize=1 → +0 (no bonus)
    // uniqueDomains=1 → +0.10
    // spreadRatio=1 → +0.25  (≤ 1.8)
    // ruOnly → +0.10
    // total = 0.45 → "medium"
    expect(result.confidenceSignals.spreadRatio).toBe(1);
    expect(result.confidenceScore).toBeCloseTo(0.45, 5);
    expect(result.confidenceLevel).toBe("medium");
  });

  it("score is clamped to [0, 1]", () => {
    // Maximum theoretical score: 0.35+0.25+0.25+0.10 = 0.95 (well below 1)
    // Multiplying by huge factor can't exceed 1 — just verify clamp doesn't fire
    const highListings = Array.from({ length: 6 }, (_, i) =>
      makeListing(90_000 + i * 1_000, `site${i}.ru`)
    );
    const result = computePriceConfidence(highListings, "openai_web_search");
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.confidenceScore).toBeLessThanOrEqual(1);
  });

  it("mixed RU+intl market gets intermediate bonus (+0.05)", () => {
    const listings = [
      makeListing(90_000, "avito.ru", "ru"),
      makeListing(100_000, "yahoo.jp", "intl"),
    ];
    const result = computePriceConfidence(listings, "openai_web_search");
    expect(result.confidenceSignals.ruCount).toBe(1);
    expect(result.confidenceSignals.intlCount).toBe(1);
    // sampleSize=2 → +0.15
    // uniqueDomains=2 → +0.18
    // spreadRatio ≈ 1.11 → +0.25
    // mixed → +0.05
    // total = 0.63 → "medium"
    expect(result.confidenceScore).toBeCloseTo(0.63, 5);
    expect(result.confidenceLevel).toBe("medium");
  });
});
