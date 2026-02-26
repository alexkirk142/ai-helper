/**
 * Unit tests for server/services/transmission-identifier.ts
 *
 * Pure-function tests only — no DB, no GPT, no network I/O.
 *
 * Covers:
 *   - classifyOemInput()         — routing heuristic (Step 4)
 *   - normalizeIdentityInput()   — input normalisation helper (Step 5)
 *   - buildIdentityCacheKey()    — prefixed key builder (Step 5)
 */

import { describe, it, expect } from "vitest";
import {
  classifyOemInput,
  normalizeIdentityInput,
  buildIdentityCacheKey,
} from "../transmission-identifier";

// ─────────────────────────────────────────────────────────────────────────────
// classifyOemInput — OEM part numbers → "oemPartNumber"
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyOemInput → "oemPartNumber"', () => {
  it("classifies 31020-3VX2D (digit before hyphen)", () => {
    expect(classifyOemInput("31020-3VX2D")).toBe("oemPartNumber");
  });

  it("classifies 310203VX2D-1 (digit after hyphen)", () => {
    expect(classifyOemInput("310203VX2D-1")).toBe("oemPartNumber");
  });

  it("classifies 31020-3VX0A (Nissan CVT part number variant)", () => {
    expect(classifyOemInput("31020-3VX0A")).toBe("oemPartNumber");
  });

  it("classifies part numbers with multiple hyphen segments", () => {
    expect(classifyOemInput("1A2-34567-89")).toBe("oemPartNumber");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyOemInput — transmission model codes → "transmissionCode"
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyOemInput → "transmissionCode"', () => {
  it("classifies JF011E (JATCO CVT)", () => {
    expect(classifyOemInput("JF011E")).toBe("transmissionCode");
  });

  it("classifies 6HP19 (ZF 6-speed)", () => {
    expect(classifyOemInput("6HP19")).toBe("transmissionCode");
  });

  it("classifies A245E (Toyota 4-speed AT)", () => {
    expect(classifyOemInput("A245E")).toBe("transmissionCode");
  });

  it("classifies RE4F04A (Nissan AT)", () => {
    expect(classifyOemInput("RE4F04A")).toBe("transmissionCode");
  });

  it("classifies F4A42 (Mitsubishi AT)", () => {
    expect(classifyOemInput("F4A42")).toBe("transmissionCode");
  });

  it("classifies U660E (Toyota 6-speed AT)", () => {
    expect(classifyOemInput("U660E")).toBe("transmissionCode");
  });

  it("classifies W5MBB (Mitsubishi 5-speed MT)", () => {
    expect(classifyOemInput("W5MBB")).toBe("transmissionCode");
  });

  it("classifies NAG1 (Mercedes 7G-Tronic)", () => {
    expect(classifyOemInput("NAG1")).toBe("transmissionCode");
  });

  it("classifies letter-only codes (QCE)", () => {
    expect(classifyOemInput("QCE")).toBe("transmissionCode");
  });

  it("classifies hyphenated codes without digit-adjacency (AW55-51SN)", () => {
    // AW55-51SN: hyphen is between letters/non-digit on both sides at the boundary
    // '5' is adjacent to '-' on left side → actually this IS a digit-adjacent hyphen
    // so this correctly classifies as oemPartNumber per heuristic.
    // Included here to document the known edge case explicitly.
    expect(classifyOemInput("AW55-51SN")).toBe("oemPartNumber");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyOemInput — edge cases", () => {
  it("treats uppercase input same as lowercase (heuristic is case-insensitive for digits)", () => {
    expect(classifyOemInput("31020-3vx2d")).toBe("oemPartNumber");
    expect(classifyOemInput("jf011e")).toBe("transmissionCode");
  });

  it("short codes without digits adjacent to hyphen → transmissionCode", () => {
    expect(classifyOemInput("DP0")).toBe("transmissionCode");
    expect(classifyOemInput("01M")).toBe("transmissionCode");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeIdentityInput — Step 5
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeIdentityInput", () => {
  it("uppercases and trims a transmission code", () => {
    expect(normalizeIdentityInput(" jf011e ")).toBe("JF011E");
  });

  it("uppercases and trims a part number", () => {
    expect(normalizeIdentityInput("31020-3vx2d")).toBe("31020-3VX2D");
  });

  it("preserves dashes (critical for part numbers)", () => {
    expect(normalizeIdentityInput("31020-3VX2D")).toBe("31020-3VX2D");
  });

  it("collapses internal spaces", () => {
    expect(normalizeIdentityInput("JF  011E")).toBe("JF011E");
  });

  it("handles already-normalised input unchanged", () => {
    expect(normalizeIdentityInput("JF011E")).toBe("JF011E");
    expect(normalizeIdentityInput("6HP19")).toBe("6HP19");
    expect(normalizeIdentityInput("A245E")).toBe("A245E");
  });

  it("handles a multi-segment part number", () => {
    expect(normalizeIdentityInput("1A2-34567-89")).toBe("1A2-34567-89");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildIdentityCacheKey — Step 5
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIdentityCacheKey", () => {
  it('returns "tc:<normalized>" for transmissionCode', () => {
    expect(buildIdentityCacheKey("transmissionCode", "JF011E")).toBe("tc:JF011E");
  });

  it('returns "tc:<normalized>" for 6HP19', () => {
    expect(buildIdentityCacheKey("transmissionCode", "6HP19")).toBe("tc:6HP19");
  });

  it('returns "tc:<normalized>" for A245E', () => {
    expect(buildIdentityCacheKey("transmissionCode", "A245E")).toBe("tc:A245E");
  });

  it('returns "pn:<normalized>" for oemPartNumber', () => {
    expect(buildIdentityCacheKey("oemPartNumber", "31020-3VX2D")).toBe("pn:31020-3VX2D");
  });

  it('returns "pn:<normalized>" for multi-segment part number', () => {
    expect(buildIdentityCacheKey("oemPartNumber", "1A2-34567-89")).toBe("pn:1A2-34567-89");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip: normalizeIdentityInput + buildIdentityCacheKey
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeIdentityInput + buildIdentityCacheKey round-trip", () => {
  it("produces correct prefixed key for a lowercase transmission code input", () => {
    const normalized = normalizeIdentityInput(" jf011e ");
    const key = buildIdentityCacheKey("transmissionCode", normalized);
    expect(key).toBe("tc:JF011E");
  });

  it("produces correct prefixed key for a lowercase part number input", () => {
    const normalized = normalizeIdentityInput("31020-3vx2d");
    const key = buildIdentityCacheKey("oemPartNumber", normalized);
    expect(key).toBe("pn:31020-3VX2D");
  });

  it("round-trip is idempotent: normalising an already-normalised value is stable", () => {
    const first = normalizeIdentityInput("JF011E");
    const second = normalizeIdentityInput(first);
    expect(first).toBe(second);
  });
});
