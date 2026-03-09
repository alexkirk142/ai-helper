/**
 * Candidate-based identifier detection pipeline (Step 2).
 *
 * Instead of first-match-wins sequential checks, this module:
 *   1. Extracts ALL plausible candidates from text / OCR results.
 *   2. Scores each candidate (0..1) with explicit reasons.
 *   3. Resolves the best candidate with conflict detection.
 *
 * Exported functions used by inbound-message-handler.ts:
 *   extractCandidatesFromText, extractCandidatesFromOcr,
 *   chooseBestCandidate, maskCandidateValue
 *
 * Exported helpers re-used by the legacy wrappers in inbound-message-handler.ts:
 *   normalizeVehicleIdText, normalizeCyrillicHomoglyphs,
 *   CYRILLIC_TO_LATIN, normalizeTransmissionCode
 */

import { isValidVinChecksum, tryAutoCorrectVin } from "../../utils/vin-validator";
import { detectGearboxType } from "../price-sources/types";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type CandidateType =
  | "VIN"
  | "FRAME"
  | "TRANSMISSION_CODE"
  | "GEARBOX_TYPE"
  | "OCR_VIN"
  | "OCR_FRAME"
  | "OCR_TRANSMISSION_CODE";

export interface DetectionCandidate {
  type: CandidateType;
  /** Normalized / corrected value ready for downstream use. */
  value: string;
  /** Original substring as it appeared in the input. */
  raw: string;
  /** Confidence 0..1. */
  score: number;
  reasons: string[];
  source: "text" | "ocr";
  meta?: {
    autocorrectEdits?: number;
    ocrConfidence?: number;
    contextHits?: string[];
    isIncompleteVin?: boolean;
  };
}

export interface BestCandidateResult {
  best?: DetectionCandidate;
  alternates: DetectionCandidate[];
  /** Non-empty when multiple high-confidence conflicting candidates exist. */
  conflicts?: string[];
}

/** Mirrors the return shape of analyzeImages() in vin-ocr.service.ts */
export interface OcrAnalysisResult {
  type: "gearbox_tag" | "registration_doc" | "unknown";
  code?: string;
  vin?: string;
  frame?: string;
  /** Confidence value 0..1 if the OCR provider exposes it. */
  confidence?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization helpers (exported so inbound-message-handler can reuse them)
// ─────────────────────────────────────────────────────────────────────────────

export const CYRILLIC_TO_LATIN: Record<string, string> = {
  "\u0410": "A", "\u0430": "a", // А/а → A
  "\u0412": "B",                 // В   → B (lowercase в not visually similar)
  "\u0421": "C", "\u0441": "c", // С/с → C
  "\u0415": "E", "\u0435": "e", // Е/е → E
  "\u041A": "K", "\u043A": "k", // К/к → K
  "\u041C": "M", "\u043C": "m", // М/м → M
  "\u041D": "H", "\u043D": "h", // Н/н → H
  "\u041E": "O", "\u043E": "o", // О/о → O
  "\u0420": "P", "\u0440": "p", // Р/р → P
  "\u0422": "T", "\u0442": "t", // Т/т → T
  "\u0423": "Y", "\u0443": "y", // У/у → Y
  "\u0425": "X", "\u0445": "x", // Х/х → X
};

const CYRILLIC_RE = new RegExp(`[${Object.keys(CYRILLIC_TO_LATIN).join("")}]`, "g");

export function normalizeCyrillicHomoglyphs(text: string): string {
  return text.replace(CYRILLIC_RE, (ch) => CYRILLIC_TO_LATIN[ch] ?? ch);
}

/** Replace Cyrillic lookalikes + non-standard dash variants with ASCII equivalents. */
export function normalizeVehicleIdText(text: string): string {
  const result = normalizeCyrillicHomoglyphs(text);
  return result.replace(/[\u2013\u2014\u2212\u2011]/g, "-");
}

// ─────────────────────────────────────────────────────────────────────────────
// Context keyword detection
// ─────────────────────────────────────────────────────────────────────────────

const VIN_CONTEXT_KEYWORDS = ["vin", "вин", "vin:", "номер кузова", "рама", "стс", "sts"];
const FRAME_CONTEXT_KEYWORDS = ["frame", "рама", "кузов", "номер кузова"];
const GEARBOX_CONTEXT_KEYWORDS = [
  "акпп", "кпп", "короб", "вариатор", "trans", "gearbox", "automatic", "dsg",
];

/**
 * Returns which keywords from the list appear within [position-radius,
 * position+valueLength+radius] of lowercased text.
 */
function findContextHits(
  lowerText: string,
  position: number,
  valueLength: number,
  radius: number,
  keywords: string[],
): string[] {
  const start = Math.max(0, position - radius);
  const end = Math.min(lowerText.length, position + valueLength + radius);
  const window = lowerText.substring(start, end);
  return keywords.filter((kw) => window.includes(kw));
}

// ─────────────────────────────────────────────────────────────────────────────
// VIN extraction + scoring
// ─────────────────────────────────────────────────────────────────────────────

// VIN excludes I, O, Q per ISO 3779
const VIN_CHARS = "A-HJ-NPR-Z0-9";
const VIN_REGEX = new RegExp(`[${VIN_CHARS}]{17}`, "gi");
const VIN_INCOMPLETE_REGEX = new RegExp(`[${VIN_CHARS}]{16}(?![${VIN_CHARS}])`, "gi");

/**
 * ISO 3779 check-digit at position 9 (index 8) is only mandated for
 * North American VINs (WMI starting with 1–5).
 * European (S,V,W,Y,Z,A-H range), Asian (J,K,L,M,N,P,R) and other
 * non-NA manufacturers do not use a standardised check digit —
 * applying the NA formula to them produces false negatives.
 */
function isNorthAmericanVin(vin: string): boolean {
  const firstChar = (vin[0] ?? "").toUpperCase();
  return firstChar >= "1" && firstChar <= "5";
}

function isChecksumApplicable(vin: string): boolean {
  if (!isNorthAmericanVin(vin)) return false;
  return /[0-9X]/i.test(vin[8] ?? "");
}

function scoreVinMatch(
  rawMatch: string,
  originalText: string,
  matchIndex: number,
  lowerOriginal: string,
  source: "text" | "ocr",
): DetectionCandidate | null {
  const norm = rawMatch.replace(/\s/g, "").toUpperCase();
  if (norm.length !== 17) return null;

  // I, O, Q are never valid VIN characters — VIN_REGEX already excludes them
  // for text inputs, but OCR may produce them directly.
  if (/[IOQ]/.test(norm)) return null;

  const reasons: string[] = [];
  let score = 0.80;
  let autocorrectEdits = 0;
  let effectiveValue = norm;

  if (isChecksumApplicable(norm)) {
    if (isValidVinChecksum(norm)) {
      score = 0.90;
      reasons.push("checksum_valid");
    } else {
      const corrected = tryAutoCorrectVin(norm);
      if (corrected) {
        // tryAutoCorrectVin makes exactly 1 substitution
        autocorrectEdits = 1;
        effectiveValue = corrected;
        score = 0.85;
        reasons.push("checksum_valid_after_autocorrect");
      } else {
        // Checksum fails and cannot be fixed with a single char swap → likely garbage
        score = 0.25;
        reasons.push("checksum_invalid_uncorrectable");
      }
    }
  } else {
    // European/Asian VIN — no standard check digit at pos 9
    score = 0.80;
    reasons.push("no_checksum_applicable");
  }

  const contextHits = findContextHits(
    lowerOriginal, matchIndex, rawMatch.length, 50, VIN_CONTEXT_KEYWORDS,
  );
  const boost = Math.min(contextHits.length * 0.05, 0.10);
  score = Math.min(score + boost, 0.95);
  if (contextHits.length > 0) reasons.push(`context:${contextHits.join(",")}`);

  return {
    type: source === "ocr" ? "OCR_VIN" : "VIN",
    value: effectiveValue,
    raw: originalText.substring(matchIndex, matchIndex + rawMatch.length),
    score,
    reasons,
    source,
    meta: { autocorrectEdits, contextHits },
  };
}

function extractVinCandidates(text: string, source: "text" | "ocr" = "text"): DetectionCandidate[] {
  const normalized = normalizeVehicleIdText(text);
  const lower = text.toLowerCase();
  const candidates: DetectionCandidate[] = [];

  VIN_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VIN_REGEX.exec(normalized)) !== null) {
    const cand = scoreVinMatch(m[0], text, m.index, lower, source);
    if (cand) candidates.push(cand);
  }
  return candidates;
}

function extractIncompleteVinCandidates(
  text: string,
  fullVinPositions: Array<{ index: number; length: number }>,
): DetectionCandidate[] {
  const normalized = normalizeVehicleIdText(text);
  const candidates: DetectionCandidate[] = [];

  VIN_INCOMPLETE_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VIN_INCOMPLETE_REGEX.exec(normalized)) !== null) {
    const raw = m[0];
    const norm = raw.replace(/\s/g, "").toUpperCase();
    if (norm.length !== 16) continue;

    // Skip if a 17-char VIN starts at the same or adjacent position
    const overlaps = fullVinPositions.some(
      (p) => Math.abs(p.index - m!.index) < 2,
    );
    if (overlaps) continue;

    candidates.push({
      type: "VIN",
      value: norm,
      raw: text.substring(m.index, m.index + raw.length),
      score: 0.15,
      reasons: ["incomplete_vin_16chars"],
      source: "text",
      meta: { isIncompleteVin: true },
    });
  }
  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// FRAME extraction + scoring
// ─────────────────────────────────────────────────────────────────────────────

// With dash: prefix 3-6 alnum + dash + 4-8 digits suffix
const FRAME_WITH_DASH_RE = /\b([A-Z0-9]{3,6})-([0-9]{4,8})\b/gi;
// Without dash: 2-5 letters + 6-10 digits, total 8-14 chars (Japanese chassis)
const FRAME_DASHLESS_RE = /\b([A-Z]{2,5})(\d{6,10})\b/gi;

/**
 * Reject strings that look like phone numbers:
 * 11+ consecutive digits starting with 7, 8, or 9.
 */
function isPhoneLike(s: string): boolean {
  const digits = s.replace(/\D/g, "");
  return digits.length >= 11 && /^[789]/.test(digits);
}

function scoreFrameMatch(
  norm: string,
  rawValue: string,
  matchIndex: number,
  lowerOriginal: string,
  withDash: boolean,
  source: "text" | "ocr",
): DetectionCandidate | null {
  if (isPhoneLike(norm)) return null;
  // All-digit strings are not valid frame numbers
  if (/^\d+$/.test(norm.replace(/-/g, ""))) return null;

  const reasons: string[] = [withDash ? "frame_with_dash" : "frame_dashless"];
  let score = withDash ? 0.85 : 0.80;

  const contextHits = findContextHits(
    lowerOriginal, matchIndex, rawValue.length, 50, FRAME_CONTEXT_KEYWORDS,
  );
  const boost = Math.min(contextHits.length * 0.05, 0.10);
  score = Math.min(score + boost, 0.95);
  if (contextHits.length > 0) reasons.push(`context:${contextHits.join(",")}`);

  return {
    type: source === "ocr" ? "OCR_FRAME" : "FRAME",
    value: norm,
    raw: rawValue,
    score,
    reasons,
    source,
    meta: { contextHits },
  };
}

function extractFrameCandidates(
  text: string,
  /** Ranges already claimed by VIN candidates — prevents overlap. */
  coveredRanges: Array<[number, number]> = [],
  source: "text" | "ocr" = "text",
): DetectionCandidate[] {
  const normalized = normalizeVehicleIdText(text);
  const lower = text.toLowerCase();
  const candidates: DetectionCandidate[] = [];
  const localCovered: Array<[number, number]> = [...coveredRanges];

  let m: RegExpExecArray | null;

  // With-dash frames
  FRAME_WITH_DASH_RE.lastIndex = 0;
  while ((m = FRAME_WITH_DASH_RE.exec(normalized)) !== null) {
    const alreadyCovered = localCovered.some(
      ([s, e]) => m!.index >= s && m!.index < e,
    );
    if (alreadyCovered) continue;

    const raw = m[0].trim();
    const norm = raw.replace(/\s/g, "").toUpperCase();
    const cand = scoreFrameMatch(
      norm,
      text.substring(m.index, m.index + m[0].length).trim(),
      m.index,
      lower,
      true,
      source,
    );
    if (cand) {
      candidates.push(cand);
      localCovered.push([m.index, m.index + m[0].length]);
    }
  }

  // Dashless frames
  FRAME_DASHLESS_RE.lastIndex = 0;
  while ((m = FRAME_DASHLESS_RE.exec(normalized)) !== null) {
    const raw = m[0];
    if (raw.length < 8 || raw.length > 14) continue;

    const alreadyCovered = localCovered.some(
      ([s, e]) => m!.index >= s && m!.index < e,
    );
    if (alreadyCovered) continue;

    const norm = raw.toUpperCase();
    if (/^\d+$/.test(norm)) continue;

    const cand = scoreFrameMatch(
      norm,
      text.substring(m.index, m.index + raw.length),
      m.index,
      lower,
      false,
      source,
    );
    if (cand) {
      candidates.push(cand);
      localCovered.push([m.index, m.index + raw.length]);
    }
  }

  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transmission code extraction + scoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strong: the existing well-known OEM pattern (Japanese/Korean/European AT models).
 * Covers: A245E, U150E, JF010E, JF011E, U660E, RE4F04A, NAG1, A6MF1, 6HP19 etc.
 * Also covers Ford/GM-style codes: CD4E, AX4N, AX4S (2-3 letters + 1 digit + 1-2 letters).
 */
const STRONG_OEM_RE =
  /\b((?:[A-Z]{1,3}[0-9]{2,4}[A-Z][A-Z0-9]{0,4}|[A-Z0-9]{2,4}[A-Z][0-9]{1,4}[A-Z0-9]{0,4}|[A-Z]{2,3}[0-9]{1}[A-Z]{1,2})(?:-[A-Z0-9]{2,5})?)\b/g;

/**
 * Weak: short or digit-first codes that need gearbox context to be trusted.
 * Covers: 01M, 09G, 0AM, 0AT, DP0, DQ250 (DQ → [A-Z]{2}[0-9]{3} gets caught by strong for 5-char)
 */
const WEAK_OEM_RE = /\b([0-9]{1,2}[A-Z]{1,3}[0-9]{0,4}|[A-Z]{2,4}[0-9]{1,2})\b/g;

/**
 * Monetary context keywords — when a matched code token appears within a short
 * window of these patterns, it is almost certainly NOT a transmission code
 * (e.g. "От25т.р." → OT25T matched as TC, but the window contains "т.р").
 */
const PRICE_CONTEXT_RE = /(?:т\.р|тыс\.?\s*руб|руб|₽|тысяч|\bk\b|тыс\b)/i;

function hasPriceContext(text: string, index: number, length: number): boolean {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + length + 20);
  const window = text.substring(start, end);
  PRICE_CONTEXT_RE.lastIndex = 0;
  return PRICE_CONTEXT_RE.test(window);
}

export function normalizeTransmissionCode(code: string): string {
  return normalizeCyrillicHomoglyphs(code).toUpperCase();
}

/** Returns "strong" | "weak" | null (not a transmission code). */
export function classifyTransmissionStrength(
  code: string,
): "strong" | "weak" | null {
  if (!code || code.length < 2 || code.length > 14) return null;
  if (/^\d+$/.test(code)) return null;          // all digits
  if (code.length === 17) return null;            // would be a VIN
  if (/^\d{4,6}-\d{4,6}/.test(code)) return null; // OEM part number (e.g. 31020-3VX2D)
  if (/^[A-Z]{1,2}\d{6,}$/.test(code)) return null; // frame-like (short prefix + many digits)

  STRONG_OEM_RE.lastIndex = 0;
  if (STRONG_OEM_RE.test(code) && code.replace(/-.*/, "").length >= 4) return "strong";

  WEAK_OEM_RE.lastIndex = 0;
  if (WEAK_OEM_RE.test(code)) return "weak";

  return null;
}

function extractTransmissionCodeCandidates(
  text: string,
  source: "text" | "ocr" = "text",
): DetectionCandidate[] {
  if (!text || text.trim().length < 2) return [];

  const upper = normalizeTransmissionCode(text.trim());
  const lowerOrig = text.toLowerCase();

  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(upper)) return []; // entire text is a VIN

  const seen = new Set<string>();
  const rawCandidates: Array<{
    code: string;
    index: number;
    rawSlice: string;
    strength: "strong" | "weak";
  }> = [];

  // Strong passes first
  STRONG_OEM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STRONG_OEM_RE.exec(upper)) !== null) {
    const code = m[1];
    if (!seen.has(code)) {
      const strength = classifyTransmissionStrength(code);
      if (strength === "strong") {
        seen.add(code);
        rawCandidates.push({
          code,
          index: m.index,
          rawSlice: text.substring(m.index, m.index + m[0].length),
          strength: "strong",
        });
      }
    }
  }

  const coveredByStrong = rawCandidates.map(
    (rc) => [rc.index, rc.index + rc.code.length] as [number, number],
  );

  // Weak passes second, skip positions already covered by strong
  WEAK_OEM_RE.lastIndex = 0;
  while ((m = WEAK_OEM_RE.exec(upper)) !== null) {
    const code = m[1];
    if (seen.has(code)) continue;
    const alreadyCovered = coveredByStrong.some(
      ([s, e]) => m!.index >= s && m!.index < e,
    );
    if (alreadyCovered) continue;
    const strength = classifyTransmissionStrength(code);
    if (strength === "weak") {
      seen.add(code);
      rawCandidates.push({
        code,
        index: m.index,
        rawSlice: text.substring(m.index, m.index + m[0].length),
        strength: "weak",
      });
    }
  }

  const candidates: DetectionCandidate[] = [];

  for (const { code, index, rawSlice, strength } of rawCandidates) {
    if (code.length === 17) continue;
    if (/^\d+$/.test(code)) continue;
    if (/^[A-Z]{1,2}\d{6,}$/.test(code)) continue; // frame-like

    // Suppress codes that appear inside a monetary/price context
    // (e.g. "От25т.р." → OT25T, "30т.р." → surroundings contain "т.р")
    if (hasPriceContext(text, index, rawSlice.length)) continue;

    const contextHits = findContextHits(
      lowerOrig, index, rawSlice.length, 50, GEARBOX_CONTEXT_KEYWORDS,
    );
    const reasons: string[] = [`strength:${strength}`];
    let score: number;

    if (strength === "strong") {
      score = 0.70;
      if (contextHits.length > 0) {
        score = Math.min(score + 0.05, 0.75);
        reasons.push(`context:${contextHits.join(",")}`);
      }
    } else {
      if (contextHits.length > 0) {
        score = 0.55;
        reasons.push(`context:${contextHits.join(",")}`);
      } else {
        score = 0.20; // weak without context → effectively ignored downstream
        reasons.push("no_gearbox_context");
      }
    }

    candidates.push({
      type: source === "ocr" ? "OCR_TRANSMISSION_CODE" : "TRANSMISSION_CODE",
      value: code,
      raw: rawSlice,
      score,
      reasons,
      source,
      meta: { contextHits },
    });
  }

  // Return only the highest-scoring single transmission code to reduce noise
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? [candidates[0]] : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Gearbox type candidates
// ─────────────────────────────────────────────────────────────────────────────

function extractGearboxTypeCandidates(text: string): DetectionCandidate[] {
  const gearboxType = detectGearboxType(text);
  if (gearboxType === "unknown") return [];
  return [
    {
      type: "GEARBOX_TYPE",
      value: gearboxType,
      raw: gearboxType,
      score: 0.30,
      reasons: ["gearbox_type_keyword"],
      source: "text",
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main text extraction (public)
// ─────────────────────────────────────────────────────────────────────────────

export function extractCandidatesFromText(text: string): DetectionCandidate[] {
  if (!text || !text.trim()) return [];

  const candidates: DetectionCandidate[] = [];

  // Extract full VINs first; track their positions for deduplication below
  const vinCandidates = extractVinCandidates(text);
  candidates.push(...vinCandidates);

  const vinPositions = vinCandidates.map((c) => {
    const normalized = normalizeVehicleIdText(text);
    const idx = normalized.toUpperCase().indexOf(c.value.substring(0, 6));
    return { index: Math.max(0, idx), length: 17 };
  });

  // Incomplete VINs (16-char) only when no full VIN at the same position
  candidates.push(...extractIncompleteVinCandidates(text, vinPositions));

  // FRAME (covered-range logic prevents overlap with VINs)
  candidates.push(...extractFrameCandidates(text));

  // Transmission code (single best)
  candidates.push(...extractTransmissionCodeCandidates(text));

  // Gearbox type keyword
  candidates.push(...extractGearboxTypeCandidates(text));

  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// OCR result → candidates (public)
// ─────────────────────────────────────────────────────────────────────────────

function validateOcrAlnum(value: string, minLength: number): boolean {
  if (!value || value.length < minLength) return false;
  const alnum = value.replace(/[^A-Z0-9]/gi, "").length;
  return alnum / value.length >= 0.70;
}

/**
 * Strict 4-char gearbox tag pattern: VIN-safe charset (excludes I, O, Q which
 * are forbidden in VINs and likely OCR noise for 0/1).
 * Only used when the GEARBOX_TAG_MINLEN_4 feature flag is enabled.
 */
const GEARBOX_TAG_4CHAR_RE = /^[A-HJ-NPR-Z0-9]{4}$/;

/** Options for extractCandidatesFromOcr — all flags default to false/off. */
export interface ExtractFromOcrOptions {
  /**
   * When true, allows exactly-4-character gearbox_tag codes that match
   * the strict VIN-safe alphanumeric pattern (/^[A-HJ-NPR-Z0-9]{4}$/).
   * These codes receive a fixed baseScore of 0.60 so they route to the
   * weak-code clarification flow (>= 0.55) and never directly to price
   * lookup (< 0.70).
   * Default: false — 4-char codes are rejected by the quality gate.
   */
  allowGearboxTagMinLen4?: boolean;
}

/**
 * Converts a structured OCR analysis result into scored DetectionCandidates.
 * Applies quality gates: rejects codes that are too short or have too many
 * garbage characters.
 *
 * @param opts - Optional feature-flag overrides. Pass `{ allowGearboxTagMinLen4: true }`
 *   (read from featureFlagService by the caller) to allow strict 4-char gearbox codes.
 *   When opts is absent or allowGearboxTagMinLen4 is false, behavior is identical to
 *   the original implementation.
 */
export function extractCandidatesFromOcr(
  ocrResult: OcrAnalysisResult,
  opts?: ExtractFromOcrOptions,
): DetectionCandidate[] {
  const candidates: DetectionCandidate[] = [];
  const ocrConf = ocrResult.confidence ?? 0.80;

  if (ocrResult.type === "gearbox_tag" && ocrResult.code) {
    const code = normalizeTransmissionCode(ocrResult.code);

    // Determine whether this is an exactly-4-char code allowed by the flag.
    // The regex uses the VIN-safe charset (excludes I, O, Q) to reduce OCR noise.
    const isFourChar = code.length === 4;
    const allowedBy4CharFlag =
      isFourChar &&
      opts?.allowGearboxTagMinLen4 === true &&
      GEARBOX_TAG_4CHAR_RE.test(code);

    // Quality gate — two paths:
    //   • 4-char codes: pass only when allowedBy4CharFlag is true (strict regex match).
    //   • All other lengths: apply existing validateOcrAlnum(code, 5) check
    //     (length >= 5 AND alnum ratio >= 70%).
    if (!allowedBy4CharFlag && !validateOcrAlnum(code, 5)) {
      return []; // Caller should ask for a clearer photo
    }

    const strength = classifyTransmissionStrength(code);

    // Scoring:
    //   • 4-char allowed by flag → fixed baseScore 0.60:
    //       - above clarification threshold (0.55) → routes to weak_tc_clarification
    //       - below direct-lookup threshold (0.70) → never auto-routes to price lookup
    //   • All other codes → existing logic unchanged.
    const baseScore = allowedBy4CharFlag
      ? 0.72
      : (strength === "strong" ? 0.75 : (code.length >= 5 ? 0.65 : 0.50));
    const score = Math.min(baseScore, ocrConf);

    candidates.push({
      type: "OCR_TRANSMISSION_CODE",
      value: code,
      raw: ocrResult.code,
      score,
      reasons: [
        "ocr_gearbox_tag",
        `strength:${strength ?? "unknown"}`,
        ...(allowedBy4CharFlag ? ["gearbox_tag_4char_allowed"] : []),
      ],
      source: "ocr",
      meta: { ocrConfidence: ocrConf },
    });
  }

  if (ocrResult.type === "registration_doc") {
    if (ocrResult.vin) {
      const vinCands = extractVinCandidates(ocrResult.vin, "ocr");
      for (const c of vinCands) {
        candidates.push({
          ...c,
          score: Math.min(c.score, 0.85),
          reasons: [...c.reasons, "ocr_registration_doc"],
          meta: { ...c.meta, ocrConfidence: ocrConf },
        });
      }
    }
    if (ocrResult.frame) {
      const frameCands = extractFrameCandidates(ocrResult.frame, [], "ocr");
      for (const c of frameCands) {
        candidates.push({
          ...c,
          score: Math.min(c.score, 0.85),
          reasons: [...c.reasons, "ocr_registration_doc"],
          meta: { ...c.meta, ocrConfidence: ocrConf },
        });
      }
    }
  }

  return candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// Best candidate selection (public)
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_PRIORITY: Record<CandidateType, number> = {
  VIN: 10,
  FRAME: 9,
  OCR_VIN: 8,
  OCR_FRAME: 7,
  TRANSMISSION_CODE: 6,
  OCR_TRANSMISSION_CODE: 5,
  GEARBOX_TYPE: 1,
};

function isVinOrFrame(c: DetectionCandidate): boolean {
  return (
    c.type === "VIN" ||
    c.type === "FRAME" ||
    c.type === "OCR_VIN" ||
    c.type === "OCR_FRAME"
  );
}

/**
 * Selects the best candidate from a list, detecting conflicts when multiple
 * high-confidence (>=0.80) candidates with different values exist for the
 * same type.
 */
export function chooseBestCandidate(cands: DetectionCandidate[]): BestCandidateResult {
  if (cands.length === 0) return { alternates: [] };

  const incompleteVins = cands.filter((c) => c.meta?.isIncompleteVin);
  const regular = cands.filter((c) => !c.meta?.isIncompleteVin);

  // Only incomplete VINs → return first for clarification path
  if (regular.length === 0) {
    return { best: incompleteVins[0], alternates: incompleteVins.slice(1) };
  }

  const sorted = [...regular].sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 0.01) return diff;
    return (TYPE_PRIORITY[b.type] ?? 0) - (TYPE_PRIORITY[a.type] ?? 0);
  });

  const conflicts: string[] = [];

  // Detect multiple high-confidence VINs with distinct values
  const highVins = sorted.filter(
    (c) => (c.type === "VIN" || c.type === "OCR_VIN") && c.score >= 0.80,
  );
  const distinctVinValues = [...new Set(highVins.map((c) => c.value))];
  if (distinctVinValues.length >= 2) {
    conflicts.push(`multiple_vin:${distinctVinValues.slice(0, 3).join("|")}`);
  }

  // Detect multiple high-confidence FRAMEs with distinct values
  const highFrames = sorted.filter(
    (c) => (c.type === "FRAME" || c.type === "OCR_FRAME") && c.score >= 0.80,
  );
  const distinctFrameValues = [...new Set(highFrames.map((c) => c.value))];
  if (distinctFrameValues.length >= 2) {
    conflicts.push(`multiple_frame:${distinctFrameValues.slice(0, 3).join("|")}`);
  }

  // VIN/FRAME always beats TRANSMISSION_CODE when high-confidence
  const bestVinOrFrame = sorted.find((c) => isVinOrFrame(c) && c.score >= 0.80);
  if (bestVinOrFrame) {
    return {
      best: bestVinOrFrame,
      alternates: sorted.filter((c) => c !== bestVinOrFrame),
      conflicts: conflicts.length ? conflicts : undefined,
    };
  }

  return {
    best: sorted[0],
    alternates: sorted.slice(1),
    conflicts: conflicts.length ? conflicts : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging helpers (public)
// ─────────────────────────────────────────────────────────────────────────────

/** Masks a VIN for safe logging: keeps first 3 and last 3 characters. */
export function maskVin(vin: string): string {
  if (vin.length <= 6) return vin;
  return `${vin.slice(0, 3)}${"*".repeat(vin.length - 6)}${vin.slice(-3)}`;
}

export function maskCandidateValue(c: DetectionCandidate): string {
  if (c.type === "VIN" || c.type === "OCR_VIN") return maskVin(c.value);
  return c.value;
}
