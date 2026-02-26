/**
 * Unit tests for international price mixing control (applyIntlMixing).
 *
 * Tests the pure helper `applyIntlMixing` without any network, DB, or GPT
 * dependencies.  Feature flag state is passed directly as boolean arguments.
 *
 * Invariants verified:
 *   1. RU + intl, both flags OFF   → listings returned unchanged (baseline)
 *   2. RU + intl, cap ON           → intl listings above 2.5× ruMedian removed
 *   3. RU only (no intl)           → listings returned unchanged regardless of flags
 *   4. Intl only, discount ON      → all intl prices multiplied by 0.75
 *   5. Both flags OFF              → identical to pre-feature baseline (same as case 1)
 *
 * Additional edge cases:
 *   - Cap removes all intl          → continue with RU only
 *   - Cap removes none (all within) → listings unchanged
 *   - Discount rounds correctly     → Math.round applied
 *   - ruListings === 1 with cap ON  → Case A NOT triggered (ru < 2)
 *
 * Run: npx vitest run server/services/__tests__/price-searcher-intl-mixing.test.ts
 */

import { describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — hoisted before any import resolution.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../observability/metrics", () => ({
  incr: vi.fn(),
  timing: vi.fn(),
}));

vi.mock("../feature-flags", () => ({
  featureFlagService: {
    isEnabled: vi.fn().mockResolvedValue(false),
    isEnabledSync: vi.fn().mockReturnValue(false),
  },
}));

vi.mock("../decision-engine", () => ({
  openai: {},
}));

vi.mock("../price-sources/yandex-source", () => ({
  searchYandex: vi.fn(),
  DOMAIN_PRIORITY_SCORES: {},
}));

vi.mock("../playwright-fetcher", () => ({
  fetchPageViaPlaywright: vi.fn(),
}));

import { applyIntlMixing } from "../price-searcher";
import type { ParsedListing } from "../price-searcher";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ruListing(price: number, extra?: Partial<ParsedListing>): ParsedListing {
  return {
    title: "КПП б/у контрактная",
    price,
    mileage: null,
    url: "https://baza.drom.ru/item",
    site: "baza.drom.ru",
    isUsed: true,
    ...extra,
    // market is intentionally absent (RU = implicit default)
  };
}

function intlListing(price: number, extra?: Partial<ParsedListing>): ParsedListing {
  return {
    title: "Transmission used JDM",
    price,
    mileage: null,
    url: "https://yahoo.jp/item",
    site: "yahoo.jp",
    isUsed: true,
    market: "intl",
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Both flags OFF — baseline identical behavior
// ─────────────────────────────────────────────────────────────────────────────

describe("applyIntlMixing — both flags OFF (baseline)", () => {
  it("returns input listings unchanged when no intl present", () => {
    const listings = [ruListing(80_000), ruListing(100_000), ruListing(120_000)];
    const result = applyIntlMixing(listings, false, false);
    expect(result.listings).toEqual(listings);
    expect(result.capRemovedCount).toBe(0);
    expect(result.discountApplied).toBe(false);
  });

  it("returns input listings unchanged when intl IS present but both flags OFF", () => {
    const listings = [
      ruListing(80_000),
      ruListing(100_000),
      intlListing(400_000), // would be capped if flag ON
    ];
    const result = applyIntlMixing(listings, false, false);
    expect(result.listings).toEqual(listings);
    expect(result.capRemovedCount).toBe(0);
    expect(result.discountApplied).toBe(false);
  });

  it("returns intl-only input unchanged when both flags OFF", () => {
    const listings = [intlListing(200_000), intlListing(250_000)];
    const result = applyIntlMixing(listings, false, false);
    expect(result.listings).toEqual(listings);
    expect(result.capRemovedCount).toBe(0);
    expect(result.discountApplied).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. RU + intl, INTL_PRICE_CAP_ENABLED ON
// ─────────────────────────────────────────────────────────────────────────────

describe("applyIntlMixing — INTL_PRICE_CAP_ENABLED", () => {
  it("removes intl listings above 2.5× RU median", () => {
    // RU prices: [80_000, 100_000] → sorted [80k, 100k] → median = sorted[1] = 100_000
    // cap = 100_000 * 2.5 = 250_000
    const listings = [
      ruListing(80_000),
      ruListing(100_000),
      intlListing(200_000),  // 200k ≤ 250k → KEPT
      intlListing(260_000),  // 260k > 250k → REMOVED
      intlListing(500_000),  // 500k > 250k → REMOVED
    ];
    const result = applyIntlMixing(listings, true, false);

    expect(result.capRemovedCount).toBe(2);
    expect(result.discountApplied).toBe(false);

    const prices = result.listings.map(l => l.price);
    expect(prices).toContain(80_000);
    expect(prices).toContain(100_000);
    expect(prices).toContain(200_000);
    expect(prices).not.toContain(260_000);
    expect(prices).not.toContain(500_000);
  });

  it("keeps all intl listings when all are within the cap", () => {
    // RU prices: [80_000, 120_000] → median = sorted[1] = 120_000 → cap = 300_000
    const listings = [
      ruListing(80_000),
      ruListing(120_000),
      intlListing(150_000),
      intlListing(250_000),
    ];
    const result = applyIntlMixing(listings, true, false);

    expect(result.capRemovedCount).toBe(0);
    expect(result.listings.length).toBe(4);
  });

  it("removes ALL intl listings when all are above cap → continues with RU only", () => {
    // RU prices: [80_000, 100_000] → median = 100_000 → cap = 250_000
    const listings = [
      ruListing(80_000),
      ruListing(100_000),
      intlListing(300_000),
      intlListing(400_000),
    ];
    const result = applyIntlMixing(listings, true, false);

    expect(result.capRemovedCount).toBe(2);
    expect(result.listings).toHaveLength(2);
    // Only RU listings remain
    expect(result.listings.every(l => l.market !== "intl")).toBe(true);
  });

  it("does NOT trigger Case A when ruListings < 2 (single RU listing)", () => {
    // Only 1 RU listing → Case A condition not met → no cap
    const listings = [
      ruListing(100_000),
      intlListing(500_000),
    ];
    const result = applyIntlMixing(listings, true, false);

    expect(result.capRemovedCount).toBe(0);
    expect(result.listings).toEqual(listings);
  });

  it("uses correct median formula: sorted[Math.floor(n/2)] for 3 RU listings", () => {
    // RU prices: [60_000, 90_000, 120_000] → sorted same → median = sorted[1] = 90_000
    // cap = 90_000 * 2.5 = 225_000
    const listings = [
      ruListing(60_000),
      ruListing(90_000),
      ruListing(120_000),
      intlListing(200_000),  // 200k ≤ 225k → KEPT
      intlListing(250_000),  // 250k > 225k → REMOVED
    ];
    const result = applyIntlMixing(listings, true, false);

    expect(result.capRemovedCount).toBe(1);
    const prices = result.listings.map(l => l.price);
    expect(prices).toContain(200_000);
    expect(prices).not.toContain(250_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. RU only (no intl listings)
// ─────────────────────────────────────────────────────────────────────────────

describe("applyIntlMixing — RU only (no intl)", () => {
  it("returns listings unchanged with cap ON", () => {
    const listings = [ruListing(80_000), ruListing(100_000), ruListing(120_000)];
    const result = applyIntlMixing(listings, true, false);
    expect(result.listings).toEqual(listings);
    expect(result.capRemovedCount).toBe(0);
    expect(result.discountApplied).toBe(false);
  });

  it("returns listings unchanged with discount ON", () => {
    const listings = [ruListing(80_000), ruListing(100_000)];
    const result = applyIntlMixing(listings, false, true);
    expect(result.listings).toEqual(listings);
    expect(result.capRemovedCount).toBe(0);
    expect(result.discountApplied).toBe(false);
  });

  it("returns listings unchanged with both flags ON", () => {
    const listings = [ruListing(80_000)];
    const result = applyIntlMixing(listings, true, true);
    expect(result.listings).toEqual(listings);
    expect(result.capRemovedCount).toBe(0);
    expect(result.discountApplied).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Intl only, INTL_PRICE_DISCOUNT_ENABLED ON
// ─────────────────────────────────────────────────────────────────────────────

describe("applyIntlMixing — INTL_PRICE_DISCOUNT_ENABLED", () => {
  it("multiplies all intl prices by 0.75 when intl-only and flag ON", () => {
    const listings = [
      intlListing(200_000),
      intlListing(280_000),
      intlListing(300_000),
    ];
    const result = applyIntlMixing(listings, false, true);

    expect(result.discountApplied).toBe(true);
    expect(result.capRemovedCount).toBe(0);

    const prices = result.listings.map(l => l.price);
    expect(prices).toEqual([
      Math.round(200_000 * 0.75),   // 150_000
      Math.round(280_000 * 0.75),   // 210_000
      Math.round(300_000 * 0.75),   // 225_000
    ]);
  });

  it("applies Math.round correctly for fractional results", () => {
    // 100_001 * 0.75 = 75_000.75 → rounds to 75_001
    const listings = [intlListing(100_001)];
    const result = applyIntlMixing(listings, false, true);
    expect(result.listings[0].price).toBe(Math.round(100_001 * 0.75));
  });

  it("preserves all other listing fields during discount", () => {
    const original = intlListing(200_000);
    const result = applyIntlMixing([original], false, true);

    const discounted = result.listings[0];
    expect(discounted.title).toBe(original.title);
    expect(discounted.site).toBe(original.site);
    expect(discounted.isUsed).toBe(original.isUsed);
    expect(discounted.market).toBe("intl");
    expect(discounted.price).toBe(Math.round(200_000 * 0.75));
  });

  it("does NOT discount when ruListings >= 2 (Case A takes priority)", () => {
    // Both flags ON + RU >= 2 → Case A (cap) should run, NOT Case B (discount)
    const listings = [
      ruListing(80_000),
      ruListing(100_000),
      intlListing(400_000), // above cap: 100_000 * 2.5 = 250_000
    ];
    const result = applyIntlMixing(listings, true, true);

    // Cap applied (not discount)
    expect(result.capRemovedCount).toBe(1);
    expect(result.discountApplied).toBe(false);
  });

  it("does NOT discount when ruListings < 2 but flag is OFF", () => {
    const listings = [intlListing(200_000), intlListing(300_000)];
    const result = applyIntlMixing(listings, false, false);
    expect(result.discountApplied).toBe(false);
    expect(result.listings[0].price).toBe(200_000); // unchanged
    expect(result.listings[1].price).toBe(300_000); // unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Both flags OFF — explicit baseline parity check
// ─────────────────────────────────────────────────────────────────────────────

describe("applyIntlMixing — explicit baseline parity (both flags OFF)", () => {
  it("mixed RU+intl input: output === input (reference identity check)", () => {
    const listings: ParsedListing[] = [
      ruListing(80_000),
      ruListing(100_000),
      intlListing(500_000),
      intlListing(600_000),
    ];
    // With flags OFF, output must be the exact same array reference or deeply equal
    const result = applyIntlMixing(listings, false, false);
    expect(result.listings).toEqual(listings);
  });

  it("intl-only input: output === input (reference identity check)", () => {
    const listings: ParsedListing[] = [
      intlListing(200_000),
      intlListing(250_000),
      intlListing(300_000),
    ];
    const result = applyIntlMixing(listings, false, false);
    expect(result.listings).toEqual(listings);
  });

  it("empty listings: output is empty with no errors", () => {
    const result = applyIntlMixing([], false, false);
    expect(result.listings).toEqual([]);
    expect(result.capRemovedCount).toBe(0);
    expect(result.discountApplied).toBe(false);
  });
});
