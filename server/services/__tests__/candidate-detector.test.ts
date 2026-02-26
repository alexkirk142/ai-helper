/**
 * Unit tests for server/services/detection/candidate-detector.ts
 *
 * These tests cover pure-function behavior only — no DB, no queue, no network.
 */

import {
  extractCandidatesFromText,
  extractCandidatesFromOcr,
  chooseBestCandidate,
  maskVin,
  maskCandidateValue,
  normalizeVehicleIdText,
  normalizeTransmissionCode,
  classifyTransmissionStrength,
  type DetectionCandidate,
  type OcrAnalysisResult,
} from "../detection/candidate-detector";

// ─────────────────────────────────────────────────────────────────────────────
// VIN detection
// ─────────────────────────────────────────────────────────────────────────────

describe("VIN detection — extractCandidatesFromText", () => {
  it("detects a valid North-American VIN with correct checksum", () => {
    // 1HGCM82633A004352 is a well-known valid NA VIN (checksum 9th char = '3')
    const cands = extractCandidatesFromText("мой вин 1HGCM82633A004352");
    const vin = cands.find((c) => c.type === "VIN");
    expect(vin).toBeDefined();
    expect(vin!.value).toBe("1HGCM82633A004352");
    expect(vin!.score).toBeGreaterThanOrEqual(0.90);
    expect(vin!.reasons).toContain("checksum_valid");
  });

  it("detects a European VIN (no check digit) with score 0.80", () => {
    // WAUZZZ4B8CN123456 — Audi VIN, position 9 = 'C' (letter) → no checksum
    const cands = extractCandidatesFromText("VIN: WAUZZZ4B8CN123456");
    const vin = cands.find((c) => c.type === "VIN");
    expect(vin).toBeDefined();
    expect(vin!.score).toBeCloseTo(0.85, 1); // 0.80 base + 0.05 context boost from "VIN:"
    expect(vin!.reasons).toContain("no_checksum_applicable");
  });

  it("applies context boost when VIN keyword is nearby", () => {
    const withoutContext = extractCandidatesFromText("1HGCM82633A004352");
    const withContext = extractCandidatesFromText("vin: 1HGCM82633A004352");
    const scoreWithout = withoutContext.find((c) => c.type === "VIN")!.score;
    const scoreWith = withContext.find((c) => c.type === "VIN")!.score;
    expect(scoreWith).toBeGreaterThan(scoreWithout);
  });

  it("autocorrects a 1-char OCR error in a valid VIN (score 0.85)", () => {
    // Introduce one OCR error: 1HGCM82633A004352 → change char at position 4 (M→N)
    // 1HGCN82633A004352 — N is in SIMILAR_CHARS for no standard pair, so let's use
    // a known substitution: S↔5 — use a VIN where S is at a non-check position
    // WBAHN03491GM63720 is a valid BMW VIN; replace B→8 (known pair)
    // We don't know the exact checksum for a custom VIN, so test the mechanic:
    // Use a VIN that tryAutoCorrectVin can fix.
    const correctedVin = "1HGCM82633A004352"; // known valid
    // Corrupt: replace position 5 (8→B) — that's a SIMILAR_CHARS pair {B:['8'], 8:['B']}
    const corrupted = "1HGCMB2633A004352"; // 8→B
    const cands = extractCandidatesFromText(corrupted);
    const vin = cands.find((c) => c.type === "VIN");
    expect(vin).toBeDefined();
    expect(vin!.value).toBe(correctedVin);
    expect(vin!.score).toBeCloseTo(0.85, 1);
    expect(vin!.meta?.autocorrectEdits).toBe(1);
  });

  it("assigns low score (<= 0.25) when checksum fails and cannot be autocorrected", () => {
    // Corrupt 2 chars so single-char correction cannot fix it
    const badVin = "1HGCMB2633Z004352"; // two wrong chars (B and Z)
    const cands = extractCandidatesFromText(badVin);
    const vin = cands.find((c) => c.type === "VIN");
    if (vin) {
      // If detected, score must be very low (only matching via North-American path where checksum fails)
      expect(vin.score).toBeLessThanOrEqual(0.25);
    }
    // It's also acceptable to not find it at all (NA path, checksum invalid, score 0.25 but still returned)
  });

  it("detects a Cyrillic-homoglyph VIN (mixed Cyrillic/Latin chars)", () => {
    // Replace some Latin chars with visually identical Cyrillic
    // 1HGCM82633A004352 → replace A (latin) with А (Cyrillic U+0410)
    const cyrillicVin = "1HGCM82633\u0410004352"; // А instead of A
    const cands = extractCandidatesFromText(cyrillicVin);
    const vin = cands.find((c) => c.type === "VIN");
    expect(vin).toBeDefined();
    expect(vin!.value).toBe("1HGCM82633A004352");
  });

  it("flags a 16-char VIN as incomplete with low score", () => {
    const shortVin = "1HGCM82633A00435"; // 16 chars
    const cands = extractCandidatesFromText(shortVin);
    const incomplete = cands.find((c) => c.meta?.isIncompleteVin);
    expect(incomplete).toBeDefined();
    expect(incomplete!.score).toBeLessThan(0.20);
    expect(incomplete!.reasons).toContain("incomplete_vin_16chars");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FRAME detection
// ─────────────────────────────────────────────────────────────────────────────

describe("FRAME detection — extractCandidatesFromText", () => {
  it("detects a standard frame number with dash", () => {
    const cands = extractCandidatesFromText("GX100-1234567");
    const frame = cands.find((c) => c.type === "FRAME");
    expect(frame).toBeDefined();
    expect(frame!.value).toBe("GX100-1234567");
    expect(frame!.score).toBeGreaterThanOrEqual(0.85);
    expect(frame!.reasons).toContain("frame_with_dash");
  });

  it("detects a Japanese dashless chassis code", () => {
    const cands = extractCandidatesFromText("EU11105303");
    const frame = cands.find((c) => c.type === "FRAME");
    expect(frame).toBeDefined();
    expect(frame!.reasons).toContain("frame_dashless");
  });

  it("rejects a phone number as FRAME", () => {
    const cands = extractCandidatesFromText("79001234567");
    const frame = cands.find((c) => c.type === "FRAME");
    expect(frame).toBeUndefined();
  });

  it("rejects an 11-digit string starting with 8 (phone)", () => {
    const cands = extractCandidatesFromText("рама: 89161234567");
    const frame = cands.find((c) => c.type === "FRAME");
    expect(frame).toBeUndefined();
  });

  it("applies context boost for рама keyword", () => {
    const withContext = extractCandidatesFromText("рама GX100-1234567");
    const withoutContext = extractCandidatesFromText("GX100-1234567");
    const scoreWith = withContext.find((c) => c.type === "FRAME")!.score;
    const scoreWithout = withoutContext.find((c) => c.type === "FRAME")!.score;
    expect(scoreWith).toBeGreaterThanOrEqual(scoreWithout);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Transmission code detection
// ─────────────────────────────────────────────────────────────────────────────

describe("Transmission code — extractCandidatesFromText", () => {
  it("detects strong Japanese code A245E standalone", () => {
    const cands = extractCandidatesFromText("A245E");
    const tc = cands.find((c) => c.type === "TRANSMISSION_CODE");
    expect(tc).toBeDefined();
    expect(tc!.value).toBe("A245E");
    expect(tc!.score).toBeGreaterThanOrEqual(0.70);
    expect(tc!.reasons.some((r) => r.includes("strength:strong"))).toBe(true);
  });

  it("detects JF011E with score >= 0.70", () => {
    const cands = extractCandidatesFromText("код КПП JF011E");
    const tc = cands.find((c) => c.type === "TRANSMISSION_CODE");
    expect(tc).toBeDefined();
    expect(tc!.score).toBeGreaterThanOrEqual(0.70);
  });

  it("ignores weak code 01M without gearbox context", () => {
    const cands = extractCandidatesFromText("01M без контекста");
    const tc = cands.find((c) => c.type === "TRANSMISSION_CODE");
    // If found, must have very low score (< 0.55)
    if (tc) {
      expect(tc.score).toBeLessThan(0.55);
    }
  });

  it("accepts weak code 01M when gearbox context is present", () => {
    const cands = extractCandidatesFromText("АКПП 01M не работает");
    const tc = cands.find(
      (c) => c.type === "TRANSMISSION_CODE" && c.value === "01M",
    );
    expect(tc).toBeDefined();
    expect(tc!.score).toBeGreaterThanOrEqual(0.55);
    expect(tc!.reasons.some((r) => r.startsWith("context:"))).toBe(true);
  });

  it("ignores OEM part numbers (digits-digits pattern)", () => {
    const cands = extractCandidatesFromText("31020-3VX2D");
    const tc = cands.find((c) => c.type === "TRANSMISSION_CODE");
    expect(tc).toBeUndefined();
  });

  it("normalizes Cyrillic homoglyphs in transmission code", () => {
    // А245Е with Cyrillic А and Е
    const cyrillicCode = "\u0410245\u0415";
    const cands = extractCandidatesFromText(cyrillicCode);
    const tc = cands.find((c) => c.type === "TRANSMISSION_CODE");
    expect(tc).toBeDefined();
    expect(tc!.value).toBe("A245E");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyTransmissionStrength
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyTransmissionStrength", () => {
  const strongCodes = ["A245E", "U150E", "JF010E", "JF011E", "U660E", "RE4F04A", "A8TR1", "A6MF1", "NAG1", "6HP19"];
  const weakCodes = ["01M", "09G", "0AM", "DP0"];
  const nullCodes = ["", "12345", "12345-67890", "AB1234567", "WAUZZZ4B8CN123456" /* VIN */];

  test.each(strongCodes)("classifies %s as strong", (code) => {
    expect(classifyTransmissionStrength(code)).toBe("strong");
  });

  test.each(weakCodes)("classifies %s as weak", (code) => {
    expect(classifyTransmissionStrength(code)).toBe("weak");
  });

  test.each(nullCodes)("classifies %s as null", (code) => {
    expect(classifyTransmissionStrength(code)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OCR extraction
// ─────────────────────────────────────────────────────────────────────────────

describe("OCR extraction — extractCandidatesFromOcr", () => {
  it("accepts a gearbox_tag with quality code", () => {
    const ocr: OcrAnalysisResult = { type: "gearbox_tag", code: "JF011E" };
    const cands = extractCandidatesFromOcr(ocr);
    expect(cands.length).toBe(1);
    expect(cands[0].type).toBe("OCR_TRANSMISSION_CODE");
    expect(cands[0].value).toBe("JF011E");
    expect(cands[0].score).toBeGreaterThanOrEqual(0.70);
  });

  it("rejects gearbox_tag with too-short code (OCR quality gate)", () => {
    const ocr: OcrAnalysisResult = { type: "gearbox_tag", code: "AB" }; // too short
    const cands = extractCandidatesFromOcr(ocr);
    expect(cands.length).toBe(0);
  });

  it("rejects gearbox_tag with garbage characters (alnum ratio < 70%)", () => {
    const ocr: OcrAnalysisResult = { type: "gearbox_tag", code: "??!**" };
    const cands = extractCandidatesFromOcr(ocr);
    expect(cands.length).toBe(0);
  });

  it("extracts VIN from registration_doc", () => {
    const ocr: OcrAnalysisResult = {
      type: "registration_doc",
      vin: "1HGCM82633A004352",
    };
    const cands = extractCandidatesFromOcr(ocr);
    const vin = cands.find((c) => c.type === "OCR_VIN");
    expect(vin).toBeDefined();
    expect(vin!.value).toBe("1HGCM82633A004352");
    expect(vin!.reasons).toContain("ocr_registration_doc");
  });

  it("returns empty array for unknown OCR type", () => {
    const ocr: OcrAnalysisResult = { type: "unknown" };
    const cands = extractCandidatesFromOcr(ocr);
    expect(cands.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// chooseBestCandidate
// ─────────────────────────────────────────────────────────────────────────────

describe("chooseBestCandidate", () => {
  const makeCandidate = (
    type: DetectionCandidate["type"],
    value: string,
    score: number,
    extra?: Partial<DetectionCandidate>,
  ): DetectionCandidate => ({
    type,
    value,
    raw: value,
    score,
    reasons: [],
    source: "text",
    ...extra,
  });

  it("returns undefined best when no candidates", () => {
    const result = chooseBestCandidate([]);
    expect(result.best).toBeUndefined();
    expect(result.alternates).toHaveLength(0);
  });

  it("picks the highest-scored candidate", () => {
    const cands = [
      makeCandidate("TRANSMISSION_CODE", "A245E", 0.70),
      makeCandidate("VIN", "1HGCM82633A004352", 0.90),
    ];
    const { best } = chooseBestCandidate(cands);
    expect(best!.type).toBe("VIN");
  });

  it("VIN beats TRANSMISSION_CODE even if score is slightly lower (type priority)", () => {
    const cands = [
      makeCandidate("TRANSMISSION_CODE", "A245E", 0.75),
      makeCandidate("VIN", "WAUZZZ4B8CN123456", 0.80),
    ];
    const { best } = chooseBestCandidate(cands);
    expect(best!.type).toBe("VIN");
  });

  it("VIN/FRAME wins over TRANSMISSION_CODE — TC goes to alternates", () => {
    const cands = [
      makeCandidate("VIN", "1HGCM82633A004352", 0.90),
      makeCandidate("TRANSMISSION_CODE", "JF011E", 0.70),
    ];
    const { best, alternates } = chooseBestCandidate(cands);
    expect(best!.type).toBe("VIN");
    expect(alternates.some((a) => a.value === "JF011E")).toBe(true);
  });

  it("detects multiple_vin conflict with two distinct high-confidence VINs", () => {
    const cands = [
      makeCandidate("VIN", "1HGCM82633A004352", 0.90),
      makeCandidate("VIN", "WAUZZZ4B8CN123456", 0.85),
    ];
    const { conflicts } = chooseBestCandidate(cands);
    expect(conflicts).toBeDefined();
    expect(conflicts!.some((c) => c.startsWith("multiple_vin:"))).toBe(true);
  });

  it("no conflict when two VINs share the same value", () => {
    const cands = [
      makeCandidate("VIN", "1HGCM82633A004352", 0.90),
      makeCandidate("VIN", "1HGCM82633A004352", 0.88),
    ];
    const { conflicts } = chooseBestCandidate(cands);
    expect(conflicts).toBeUndefined();
  });

  it("detects multiple_frame conflict", () => {
    const cands = [
      makeCandidate("FRAME", "GX100-1234567", 0.85),
      makeCandidate("FRAME", "AT200-9876543", 0.85),
    ];
    const { conflicts } = chooseBestCandidate(cands);
    expect(conflicts).toBeDefined();
    expect(conflicts!.some((c) => c.startsWith("multiple_frame:"))).toBe(true);
  });

  it("handles incomplete VIN — returns it as best with isIncompleteVin flag", () => {
    const incomplete = makeCandidate("VIN", "1HGCM82633A00435", 0.15, {
      meta: { isIncompleteVin: true },
    });
    const { best } = chooseBestCandidate([incomplete]);
    expect(best).toBeDefined();
    expect(best!.meta?.isIncompleteVin).toBe(true);
  });

  it("prefers regular candidates over incomplete VIN", () => {
    const incomplete = makeCandidate("VIN", "1HGCM82633A00435", 0.15, {
      meta: { isIncompleteVin: true },
    });
    const regular = makeCandidate("TRANSMISSION_CODE", "A245E", 0.70);
    const { best } = chooseBestCandidate([incomplete, regular]);
    expect(best!.type).toBe("TRANSMISSION_CODE");
    expect(best!.meta?.isIncompleteVin).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Logging helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("maskVin", () => {
  it("masks the middle of a VIN, keeping first 3 and last 3 chars", () => {
    expect(maskVin("1HGCM82633A004352")).toBe("1HG***********352");
  });

  it("returns short strings unchanged", () => {
    expect(maskVin("ABC")).toBe("ABC");
  });
});

describe("maskCandidateValue", () => {
  it("masks VIN types", () => {
    const c: DetectionCandidate = {
      type: "VIN",
      value: "1HGCM82633A004352",
      raw: "1HGCM82633A004352",
      score: 0.9,
      reasons: [],
      source: "text",
    };
    expect(maskCandidateValue(c)).toContain("***");
  });

  it("does not mask transmission codes", () => {
    const c: DetectionCandidate = {
      type: "TRANSMISSION_CODE",
      value: "A245E",
      raw: "A245E",
      score: 0.7,
      reasons: [],
      source: "text",
    };
    expect(maskCandidateValue(c)).toBe("A245E");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeVehicleIdText
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeVehicleIdText", () => {
  it("replaces Cyrillic А → A", () => {
    expect(normalizeVehicleIdText("\u0410BC")).toBe("ABC");
  });

  it("replaces em-dash with regular hyphen", () => {
    expect(normalizeVehicleIdText("GX100\u2014123")).toBe("GX100-123");
  });

  it("replaces multiple dash variants", () => {
    const dashes = ["\u2013", "\u2014", "\u2212", "\u2011"];
    for (const d of dashes) {
      expect(normalizeVehicleIdText(`A${d}B`)).toBe("A-B");
    }
  });
});
