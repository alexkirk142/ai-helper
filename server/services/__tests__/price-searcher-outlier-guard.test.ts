/**
 * Unit tests for the small-sample outlier guard (OUTLIER_GUARD_SMALL_SAMPLE).
 *
 * Covers removeOutliers() behavior when the second argument
 * `smallSampleGuardEnabled` is true/false for n=2 and n=3 inputs.
 *
 * No network, no DB, no GPT — pure function tests only.
 *
 * Median is computed as sorted[Math.floor(n/2)] (index-based, consistent with
 * the IQR path's percentile logic):
 *   n=2 → sorted[1] (the larger value)
 *   n=3 → sorted[1] (the middle value)
 *
 * Run: npx vitest run server/services/__tests__/price-searcher-outlier-guard.test.ts
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — hoisted before any import resolution.
// These prevent heavy server dependencies (DB, OpenAI, Playwright) from being
// initialized just to test pure price-filter logic.
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

import { removeOutliers } from "../price-searcher";
import { incr } from "../observability/metrics";

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Flag OFF — must be identical to current (pre-guard) implementation
// ─────────────────────────────────────────────────────────────────────────────

describe("removeOutliers — flag OFF (backward compatibility)", () => {
  it("n=2, flag OFF (default) — returns prices unchanged even with extreme outlier", () => {
    // Pre-guard behavior: n < 4 → return as-is, no matter the spread
    const prices = [100_000, 600_000];
    expect(removeOutliers(prices)).toEqual([100_000, 600_000]);
    expect(incr).not.toHaveBeenCalled();
  });

  it("n=3, flag OFF (default) — returns prices unchanged even with 5x outlier", () => {
    const prices = [100_000, 120_000, 600_000];
    expect(removeOutliers(prices)).toEqual([100_000, 120_000, 600_000]);
    expect(incr).not.toHaveBeenCalled();
  });

  it("n=3, flag explicitly false — returns prices unchanged", () => {
    const prices = [100_000, 120_000, 600_000];
    expect(removeOutliers(prices, false)).toEqual([100_000, 120_000, 600_000]);
    expect(incr).not.toHaveBeenCalled();
  });

  it("n=1, flag OFF — returns unchanged (n < 2, guard never activates)", () => {
    expect(removeOutliers([150_000])).toEqual([150_000]);
    expect(incr).not.toHaveBeenCalled();
  });

  it("n=0, flag OFF — returns empty array unchanged", () => {
    expect(removeOutliers([])).toEqual([]);
    expect(incr).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// n=2 + flag ON
// ─────────────────────────────────────────────────────────────────────────────

describe("removeOutliers — n=2, flag ON", () => {
  /**
   * [100k, 400k]:
   *   median = sorted[1] = 400_000
   *   lower  = 400_000 / 3 ≈ 133_333
   *   100_000 < 133_333 → guard wants to remove 100k
   *   filtered = [400_000] → length 1 < 2 → FALLBACK → original returned
   */
  it("n=2: one value 4x the other → guard activates, fallback protects original array", () => {
    const prices = [100_000, 400_000];
    const result = removeOutliers(prices, true);
    // Fail-safe: filtered would be length 1 → must return original
    expect(result).toEqual([100_000, 400_000]);
    expect(incr).toHaveBeenCalledWith(
      "price_search.small_sample_guard_applied",
      { result: "fallback" }
    );
  });

  /**
   * [100k, 280k]:
   *   median = 280_000
   *   lower  = 280_000 / 3 ≈ 93_333 — 100_000 > 93_333 ✓
   *   upper  = 280_000 * 3 = 840_000 — 280_000 < 840_000 ✓
   *   Both pass → SKIPPED → original returned
   */
  it("n=2: realistic spread (2.8x) → guard skips (both within bounds)", () => {
    const prices = [100_000, 280_000];
    const result = removeOutliers(prices, true);
    expect(result).toEqual([100_000, 280_000]);
    expect(incr).toHaveBeenCalledWith(
      "price_search.small_sample_guard_applied",
      { result: "skipped" }
    );
  });

  it("n=1, flag ON — guard does not activate (n < 2)", () => {
    expect(removeOutliers([150_000], true)).toEqual([150_000]);
    expect(incr).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// n=3 + flag ON
// ─────────────────────────────────────────────────────────────────────────────

describe("removeOutliers — n=3, flag ON", () => {
  /**
   * [100k, 120k, 600k]:
   *   sorted  = [100_000, 120_000, 600_000]
   *   median  = sorted[1] = 120_000
   *   upper   = 120_000 * 3 = 360_000 — 600_000 > 360_000 → REMOVE
   *   lower   = 120_000 / 3 = 40_000  — both others pass
   *   filtered = [100_000, 120_000] → length 2 ≥ 2 → TRIMMED
   */
  it("n=3: one value 5x the median → outlier trimmed, 2 valid prices returned", () => {
    const prices = [100_000, 120_000, 600_000];
    const result = removeOutliers(prices, true);
    expect(result).toEqual(expect.arrayContaining([100_000, 120_000]));
    expect(result).not.toContain(600_000);
    expect(result).toHaveLength(2);
    expect(incr).toHaveBeenCalledWith(
      "price_search.small_sample_guard_applied",
      { result: "trimmed" }
    );
  });

  /**
   * Verify with a 4x outlier too (600k is ~5x 120k above, but let's test 4x)
   * [80k, 100k, 400k]:
   *   median = sorted[1] = 100_000, upper = 300_000
   *   400_000 > 300_000 → trimmed → [80_000, 100_000]
   */
  it("n=3: one value ~4x the median → trimmed", () => {
    const prices = [80_000, 100_000, 400_000];
    const result = removeOutliers(prices, true);
    expect(result).toEqual(expect.arrayContaining([80_000, 100_000]));
    expect(result).not.toContain(400_000);
    expect(result).toHaveLength(2);
    expect(incr).toHaveBeenCalledWith(
      "price_search.small_sample_guard_applied",
      { result: "trimmed" }
    );
  });

  /**
   * [100k, 150k, 180k] — realistic spread (1.8× ratio):
   *   median = sorted[1] = 150_000
   *   lower  = 50_000  — all pass
   *   upper  = 450_000 — all pass
   *   → SKIPPED → original unchanged
   */
  it("n=3: realistic spread (1.8x) → not trimmed (guard skips)", () => {
    const prices = [100_000, 150_000, 180_000];
    const result = removeOutliers(prices, true);
    expect(result).toEqual([100_000, 150_000, 180_000]);
    expect(incr).toHaveBeenCalledWith(
      "price_search.small_sample_guard_applied",
      { result: "skipped" }
    );
  });

  /**
   * [10k, 100k, 20_000k]:
   *   median = sorted[1] = 100_000
   *   lower  = 33_333  — 10_000 < 33_333 → REMOVE
   *   upper  = 300_000 — 20_000_000 > 300_000 → REMOVE
   *   filtered = [100_000] → length 1 < 2 → FALLBACK → original returned
   */
  it("guard removes too many items → fallback to original array", () => {
    const prices = [10_000, 100_000, 20_000_000];
    const result = removeOutliers(prices, true);
    expect(result).toEqual([10_000, 100_000, 20_000_000]);
    expect(incr).toHaveBeenCalledWith(
      "price_search.small_sample_guard_applied",
      { result: "fallback" }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IQR path for n >= 4 — must be identical regardless of flag
// ─────────────────────────────────────────────────────────────────────────────

describe("removeOutliers — IQR unchanged for n >= 4", () => {
  const prices = [100_000, 110_000, 120_000, 130_000, 900_000];

  it("n=5, flag OFF — IQR removes extreme outlier", () => {
    const result = removeOutliers(prices, false);
    expect(result).not.toContain(900_000);
    expect(incr).not.toHaveBeenCalled();
  });

  it("n=5, flag ON — IQR still applied (guard not involved for n >= 4)", () => {
    const result = removeOutliers(prices, true);
    expect(result).not.toContain(900_000);
    // No small-sample metric emitted — IQR path is silent
    expect(incr).not.toHaveBeenCalled();
  });

  it("n=5, flag ON — produces identical result to flag OFF", () => {
    const resultOff = removeOutliers(prices, false);
    const resultOn  = removeOutliers(prices, true);
    expect(resultOn).toEqual(resultOff);
  });

  it("n=4, realistic prices — IQR path, no guard metric", () => {
    const p = [80_000, 90_000, 100_000, 110_000];
    const result = removeOutliers(p, true);
    expect(result).toEqual(expect.arrayContaining([80_000, 90_000, 100_000, 110_000]));
    expect(incr).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Metric emitted exactly once per call
// ─────────────────────────────────────────────────────────────────────────────

describe("removeOutliers — metric emitted exactly once", () => {
  it("emits exactly one incr call per removeOutliers invocation with flag ON and n=2–3", () => {
    removeOutliers([100_000, 120_000, 600_000], true); // trimmed
    expect(incr).toHaveBeenCalledTimes(1);
  });

  it("emits no incr call when flag is OFF", () => {
    removeOutliers([100_000, 120_000, 600_000], false);
    expect(incr).toHaveBeenCalledTimes(0);
  });
});
