/**
 * Unit tests: 4-character gearbox_tag OCR code handling.
 *
 * Feature flag: GEARBOX_TAG_MINLEN_4
 * Controlled via extractCandidatesFromOcr(ocrResult, { allowGearboxTagMinLen4: bool })
 *
 * Coverage:
 *   A) Flag OFF (default) — "S4TA" and other 4-char codes are rejected
 *   B) Flag ON — strict 4-char codes are allowed, score = 0.60 (clarify path only)
 *   C) Flag ON — non-strict / noisy 4-char codes remain rejected
 *   D) Other OCR types are unaffected by the new option
 *   E) Regression — existing 5+ char codes score and route correctly
 *
 * No DB, no network, no imports outside the unit under test.
 */

import { describe, it, expect } from "vitest";
import {
  extractCandidatesFromOcr,
  type OcrAnalysisResult,
} from "../../detection/candidate-detector";

// ─────────────────────────────────────────────────────────────────────────────
// A) Flag OFF: 4-char gearbox_tag codes are rejected (current / default behavior)
// ─────────────────────────────────────────────────────────────────────────────

describe("A) Flag OFF: 4-char gearbox_tag rejected (default behavior)", () => {
  it("'S4TA' with no opts returns []", () => {
    const ocr: OcrAnalysisResult = { type: "gearbox_tag", code: "S4TA" };
    expect(extractCandidatesFromOcr(ocr)).toHaveLength(0);
  });

  it("'S4TA' with allowGearboxTagMinLen4: false returns []", () => {
    const ocr: OcrAnalysisResult = { type: "gearbox_tag", code: "S4TA" };
    expect(extractCandidatesFromOcr(ocr, { allowGearboxTagMinLen4: false })).toHaveLength(0);
  });

  it("'S4TA' with opts: {} (flag key absent) returns []", () => {
    const ocr: OcrAnalysisResult = { type: "gearbox_tag", code: "S4TA" };
    expect(extractCandidatesFromOcr(ocr, {})).toHaveLength(0);
  });

  it("other real-world 4-char codes are also rejected when flag off", () => {
    for (const code of ["A131", "K312", "A343", "A245", "RE4F"]) {
      expect(
        extractCandidatesFromOcr({ type: "gearbox_tag", code }, { allowGearboxTagMinLen4: false }),
        `expected [] for "${code}" when flag off`,
      ).toHaveLength(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B) Flag ON: strict 4-char codes are allowed with correct scoring
// ─────────────────────────────────────────────────────────────────────────────

describe("B) Flag ON: strict 4-char codes allowed, score = 0.60", () => {
  it("'S4TA' returns exactly 1 candidate", () => {
    const ocr: OcrAnalysisResult = { type: "gearbox_tag", code: "S4TA" };
    const cands = extractCandidatesFromOcr(ocr, { allowGearboxTagMinLen4: true });
    expect(cands).toHaveLength(1);
  });

  it("candidate type is OCR_TRANSMISSION_CODE", () => {
    const [cand] = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "S4TA" },
      { allowGearboxTagMinLen4: true },
    );
    expect(cand.type).toBe("OCR_TRANSMISSION_CODE");
  });

  it("candidate value is normalized code 'S4TA'", () => {
    const [cand] = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "S4TA" },
      { allowGearboxTagMinLen4: true },
    );
    expect(cand.value).toBe("S4TA");
  });

  it("candidate source is 'ocr'", () => {
    const [cand] = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "S4TA" },
      { allowGearboxTagMinLen4: true },
    );
    expect(cand.source).toBe("ocr");
  });

  it("score is exactly 0.60 when confidence absent (default ocrConf = 0.80)", () => {
    const [cand] = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "S4TA" },
      { allowGearboxTagMinLen4: true },
    );
    // min(baseScore=0.60, ocrConf=0.80) = 0.60
    expect(cand.score).toBe(0.60);
    expect(cand.meta?.ocrConfidence).toBe(0.80);
  });

  it("score >= 0.55 → reaches clarification route threshold", () => {
    const [cand] = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "S4TA" },
      { allowGearboxTagMinLen4: true },
    );
    expect(cand.score).toBeGreaterThanOrEqual(0.55);
  });

  it("score < 0.70 → NEVER reaches direct price-lookup threshold", () => {
    const [cand] = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "S4TA" },
      { allowGearboxTagMinLen4: true },
    );
    expect(cand.score).toBeLessThan(0.70);
  });

  it("score is capped by explicit ocrConf when confidence < 0.60", () => {
    const [cand] = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "S4TA", confidence: 0.55 },
      { allowGearboxTagMinLen4: true },
    );
    // min(0.60, 0.55) = 0.55
    expect(cand.score).toBe(0.55);
    expect(cand.meta?.ocrConfidence).toBe(0.55);
  });

  it("score is NOT raised above 0.60 when ocrConf > 0.60", () => {
    const [cand] = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "S4TA", confidence: 0.90 },
      { allowGearboxTagMinLen4: true },
    );
    // min(0.60, 0.90) = 0.60
    expect(cand.score).toBe(0.60);
  });

  it("reasons include 'ocr_gearbox_tag' and 'gearbox_tag_4char_allowed'", () => {
    const [cand] = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "S4TA" },
      { allowGearboxTagMinLen4: true },
    );
    expect(cand.reasons).toContain("ocr_gearbox_tag");
    expect(cand.reasons).toContain("gearbox_tag_4char_allowed");
  });

  it("other strict 4-char codes (A131, K312, A343) are also allowed", () => {
    for (const code of ["A131", "K312", "A343"]) {
      const cands = extractCandidatesFromOcr(
        { type: "gearbox_tag", code },
        { allowGearboxTagMinLen4: true },
      );
      expect(cands, `expected 1 candidate for "${code}"`).toHaveLength(1);
      expect(cands[0].score).toBe(0.60);
    }
  });

  it("lowercase input is normalized to uppercase and allowed (normalization is idempotent)", () => {
    // normalizeTransmissionCode("s4ta") → "S4TA" which passes the strict regex.
    // This is expected: OCR returning lowercase is normalized consistently with
    // all other code paths in the detector.
    const [cand] = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "s4ta" },
      { allowGearboxTagMinLen4: true },
    );
    expect(cand.value).toBe("S4TA");
    expect(cand.score).toBe(0.60);
  });

  it("Cyrillic homoglyph 4-char code is normalized and allowed", () => {
    // "С4ТА" (Cyrillic С/Т) → normalizes to "C4TA" → 4 alnum chars, strict regex passes
    const [cand] = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "\u04214\u0422\u0410" },
      { allowGearboxTagMinLen4: true },
    );
    expect(cand.value).toBe("C4TA");
    expect(cand.score).toBe(0.60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C) Flag ON: non-strict 4-char codes remain rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("C) Flag ON: non-strict 4-char codes rejected", () => {
  it("'S4T!' (special char) returns []", () => {
    expect(
      extractCandidatesFromOcr({ type: "gearbox_tag", code: "S4T!" }, { allowGearboxTagMinLen4: true }),
    ).toHaveLength(0);
  });

  it("'S 4T' (internal space, length 4) returns []", () => {
    // "S 4T" has length 4 but contains a space — regex /^[A-HJ-NPR-Z0-9]{4}$/ rejects it.
    expect(
      extractCandidatesFromOcr({ type: "gearbox_tag", code: "S 4T" }, { allowGearboxTagMinLen4: true }),
    ).toHaveLength(0);
  });

  it("'S4T-' (trailing dash) returns []", () => {
    expect(
      extractCandidatesFromOcr({ type: "gearbox_tag", code: "S4T-" }, { allowGearboxTagMinLen4: true }),
    ).toHaveLength(0);
  });

  it("'S4TO' contains O (VIN-excluded char) returns []", () => {
    // O is excluded from charset [A-HJ-NPR-Z0-9] as an OCR noise guard (O vs 0).
    expect(
      extractCandidatesFromOcr({ type: "gearbox_tag", code: "S4TO" }, { allowGearboxTagMinLen4: true }),
    ).toHaveLength(0);
  });

  it("'S4TI' contains I (VIN-excluded char) returns []", () => {
    // I is excluded as an OCR noise guard (I vs 1).
    expect(
      extractCandidatesFromOcr({ type: "gearbox_tag", code: "S4TI" }, { allowGearboxTagMinLen4: true }),
    ).toHaveLength(0);
  });

  it("'S4TQ' contains Q (VIN-excluded char) returns []", () => {
    expect(
      extractCandidatesFromOcr({ type: "gearbox_tag", code: "S4TQ" }, { allowGearboxTagMinLen4: true }),
    ).toHaveLength(0);
  });

  it("3-char code 'S4T' returns [] even with flag ON (relaxation is 4-char only)", () => {
    expect(
      extractCandidatesFromOcr({ type: "gearbox_tag", code: "S4T" }, { allowGearboxTagMinLen4: true }),
    ).toHaveLength(0);
  });

  it("2-char code 'AB' returns [] even with flag ON", () => {
    expect(
      extractCandidatesFromOcr({ type: "gearbox_tag", code: "AB" }, { allowGearboxTagMinLen4: true }),
    ).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D) Other OCR types are unaffected by the opts parameter
// ─────────────────────────────────────────────────────────────────────────────

describe("D) Other OCR types unaffected", () => {
  it("registration_doc with short vin returns [] regardless of flag", () => {
    const ocr: OcrAnalysisResult = { type: "registration_doc", vin: "ABCD" };
    expect(extractCandidatesFromOcr(ocr, { allowGearboxTagMinLen4: true })).toHaveLength(0);
  });

  it("unknown OCR type returns [] regardless of flag", () => {
    const ocr: OcrAnalysisResult = { type: "unknown" };
    expect(extractCandidatesFromOcr(ocr, { allowGearboxTagMinLen4: true })).toHaveLength(0);
  });

  it("gearbox_tag with no code field returns [] regardless of flag", () => {
    const ocr: OcrAnalysisResult = { type: "gearbox_tag" };
    expect(extractCandidatesFromOcr(ocr, { allowGearboxTagMinLen4: true })).toHaveLength(0);
  });

  it("registration_doc VIN is still extracted correctly when flag is ON", () => {
    const ocr: OcrAnalysisResult = { type: "registration_doc", vin: "1HGCM82633A004352" };
    const cands = extractCandidatesFromOcr(ocr, { allowGearboxTagMinLen4: true });
    const vin = cands.find((c) => c.type === "OCR_VIN");
    expect(vin).toBeDefined();
    expect(vin!.value).toBe("1HGCM82633A004352");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E) Regression: existing 5+ char code behavior unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe("E) Regression: existing 5+ char code scoring unchanged", () => {
  it("'JF011E' still yields score >= 0.70 (direct price-lookup path)", () => {
    const [cand] = extractCandidatesFromOcr({ type: "gearbox_tag", code: "JF011E" });
    expect(cand.score).toBeGreaterThanOrEqual(0.70);
  });

  it("'JF011E' score is identical with flag ON (flag only affects 4-char codes)", () => {
    const baseScore = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "JF011E" },
    )[0].score;
    const withFlagScore = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "JF011E" },
      { allowGearboxTagMinLen4: true },
    )[0].score;
    expect(withFlagScore).toBe(baseScore);
  });

  it("'A245E' (5-char, strong) scores >= 0.70", () => {
    const [cand] = extractCandidatesFromOcr({ type: "gearbox_tag", code: "A245E" });
    expect(cand.score).toBeGreaterThanOrEqual(0.70);
  });

  it("'A245E' reasons do NOT include 'gearbox_tag_4char_allowed'", () => {
    const [cand] = extractCandidatesFromOcr(
      { type: "gearbox_tag", code: "A245E" },
      { allowGearboxTagMinLen4: true },
    );
    expect(cand.reasons).not.toContain("gearbox_tag_4char_allowed");
  });

  it("noise-heavy 5-char code '?A1?@' is still rejected by alnum ratio gate", () => {
    // 2 alnum out of 5 = 40% < 70% threshold — no change with flag ON
    const ocr: OcrAnalysisResult = { type: "gearbox_tag", code: "?A1?@" };
    expect(extractCandidatesFromOcr(ocr, { allowGearboxTagMinLen4: true })).toHaveLength(0);
  });

  it("5-char weak code 'S4TAX' (no OEM pattern match) scores in [0.55, 0.70) — clarification path", () => {
    const [cand] = extractCandidatesFromOcr({ type: "gearbox_tag", code: "S4TAX" });
    expect(cand.score).toBeGreaterThanOrEqual(0.55);
    expect(cand.score).toBeLessThan(0.70);
  });
});
