/**
 * transmission-identifier.ts
 *
 * Terminology used throughout this file and the broader pipeline:
 *
 *   transmissionCode — the gearbox market/model code, e.g. JF011E, 6HP19, A245E.
 *     This is the value that appears on Russian контрактные КПП marketplace listings
 *     and is used as the primary search term when pricing a gearbox.
 *
 *   oemPartNumber — an OEM part number issued by the vehicle manufacturer,
 *     e.g. 31020-3VX2D.  Part numbers differ from model codes: they identify a
 *     specific assembly SKU rather than the transmission family.
 *
 * Public API (Step 4):
 *   identifyTransmissionByTransmissionCode — resolves a gearbox model code (JF011E, 6HP19).
 *   identifyTransmissionByOemPartNumber    — cross-references an OEM part number (31020-3VX2D).
 *   identifyTransmissionByOem             — @deprecated; routes to one of the above via heuristic.
 *
 * Both new functions share the same internal GPT + cache logic (_identifyTransmissionByInput).
 *
 * Cache key scheme (Step 5):
 *   transmissionCode inputs → normalizedOem = "tc:<NORMALIZED>"   e.g. "tc:JF011E"
 *   oemPartNumber inputs    → normalizedOem = "pn:<NORMALIZED>"   e.g. "pn:31020-3VX2D"
 *
 *   Backward compatibility: on cache read, the prefixed key is tried first; if not found,
 *   the legacy unprefixed key (plain NORMALIZED) is attempted.  A legacy hit triggers a
 *   best-effort soft-migration: the prefixed key is upserted with the same payload so that
 *   future lookups land on the correct prefixed entry.  Legacy rows are never deleted.
 *   New GPT results are always written under the prefixed key only.
 *
 * No DB schema changes — normalizedOem column continues to hold the string value.
 */

import { openai } from "./decision-engine";
import { sanitizeForLog } from "../utils/sanitizer";
import { storage } from "../storage";
import { incr } from "./observability/metrics";

export interface VehicleContext {
  make?: string | null;
  model?: string | null;
  year?: string | null;
  engine?: string | null;
  body?: string | null;
  driveType?: string | null;
  gearboxModelHint?: string | null;
  factoryCode?: string | null;
  gearboxType?: string | null;
  displacement?: string | null;
  partsApiRawData?: Record<string, unknown> | null;
}

export interface TransmissionIdentification {
  modelName: string | null;       // e.g. "JATCO JF011E"
  manufacturer: string | null;    // e.g. "JATCO", "Aisin", "ZF", "Getrag"
  origin: "japan" | "europe" | "korea" | "usa" | "unknown";
  confidence: "high" | "medium" | "low";
  notes: string;
}

const SYSTEM_PROMPT = `You are an expert in automotive transmissions. Your task is to identify the exact market/commercial transmission model name based on OEM code and vehicle data.

CRITICAL RULES:
1. Return modelName EXACTLY as it appears in Russian контрактные КПП marketplace listings (e.g. 'F4A42', 'W5MBB', 'S6FA', 'QCE', 'U660E') — NOT internal catalog codes or part numbers.
2. If vehicle data contains "modifikaciya" or "opcii" field — READ IT CAREFULLY to determine transmission type:
   - "5FM/T" or "5MT" or "FM/T" = 5-speed MANUAL (МКПП). Do NOT return CVT or automatic.
   - "6FM/T" or "6MT" = 6-speed MANUAL (МКПП)
   - "4AT" or "4A/T" = 4-speed AUTOMATIC (АКПП)
   - "5AT" or "5A/T" = 5-speed AUTOMATIC (АКПП)
   - "CVT" or "CVT8" = continuously variable transmission (вариатор)
   - "S6FA/T" = S6FA series, MANUAL
3. For Mitsubishi transmissions — match by EXACT model, not generic rules:

   Lancer CY4A with 5FM/T:
   - W5MBB = 5-speed manual, 4WD
   - W5M51 = 5-speed manual, 2WD (FWD)

   Space Gear / Delica L400 (body codes: PA3W, PA4W, PB4W, PC4W, PD4W, PD6W, PD8W, PE8W, PF8W) with 5FM/T:
   - R5M217EJDL = 5-speed manual (DO NOT use W5M51 for this model)

   IMPORTANT: W5M51 is ONLY for Lancer/Galant FWD platform.
   It is NOT used in Space Gear, Delica, Pajero, or other body-on-frame vehicles.
   Always check the body code (modely/kuzova field) before applying W5M series.
4. The "modifikaciya" field is the most reliable source for transmission type — always prioritize it over general knowledge.
5. Return JSON only: { modelName, manufacturer, origin, confidence, notes }

When identifying the transmission model — use web search to verify:
Search for the OEM code and vehicle data to find the exact transmission model name
used in Russian and Japanese parts listings.
Example queries: "OEM 310203VX2D Nissan X-Trail коробка передач модель"
or "Nissan X-Trail NT32 MR20DD CVT модель вариатора"
Return the market model name (e.g. JF016E, K313, W5MBB) confirmed by actual listings.
If web search confirms the model — set confidence: "high".
If web search is inconclusive — set confidence: "medium".`;

// GPT-4.1 with web_search often wraps the JSON in a code fence and then appends
// explanation text after the closing ```. The old strip-from-ends approach failed
// when the string did not end with ``` (explanation text followed).
// This function extracts the JSON object robustly in three ordered attempts.
function extractJsonFromText(text: string): string {
  // First try: extract content from within the first ```...``` block.
  // Using a non-greedy match so we stop at the FIRST closing fence, not the last.
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    const blockContent = codeBlockMatch[1].trim();
    if (blockContent.startsWith("{")) return blockContent;
  }

  // Second try: last JSON object in text (GPT tends to put JSON at the end)
  const lastBrace = text.lastIndexOf("{");
  const lastClose = text.lastIndexOf("}");
  if (lastBrace !== -1 && lastClose > lastBrace) {
    return text.slice(lastBrace, lastClose + 1);
  }

  // Third try: first JSON object in text
  const firstBrace = text.indexOf("{");
  const firstClose = text.indexOf("}");
  if (firstBrace !== -1 && firstClose > firstBrace) {
    return text.slice(firstBrace, firstClose + 1);
  }

  return text.trim(); // fallback — will likely throw in JSON.parse, caught upstream
}

const FALLBACK_RESULT: TransmissionIdentification = {
  modelName: null,
  manufacturer: null,
  origin: "unknown",
  confidence: "low",
  notes: "Could not identify transmission from OEM code",
};

// ─── Routing heuristic ────────────────────────────────────────────────────────

/**
 * Pattern that distinguishes an OEM part number (e.g. 31020-3VX2D, 310203VX2D-1)
 * from a transmission model code (e.g. JF011E, 6HP19).
 * A part number always contains a hyphen directly adjacent to a digit.
 */
const OEM_PART_NUMBER_RE = /\d-|-\d/;

/** Semantic kind of a transmission identity input. */
export type TransmissionInputKind = "transmissionCode" | "oemPartNumber";

// Internal alias kept for function-signature brevity.
type InputKind = TransmissionInputKind;

/**
 * Classify a raw OEM string into its semantic kind.
 * Exported so callers and tests can use the same heuristic without re-implementing it.
 */
export function classifyOemInput(oem: string): InputKind {
  return OEM_PART_NUMBER_RE.test(oem) ? "oemPartNumber" : "transmissionCode";
}

// ─── Cache key helpers (Step 5) ───────────────────────────────────────────────

/**
 * Normalise a raw identity input value to a canonical string suitable for use
 * as part of a cache key.
 * Rules: trim whitespace, uppercase, collapse/remove internal spaces.
 * Dashes are preserved — they are significant in OEM part numbers (31020-3VX2D).
 */
export function normalizeIdentityInput(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Build the prefixed cache key for a given input kind and its normalised value.
 *   transmissionCode → "tc:<normalized>"   e.g. "tc:JF011E"
 *   oemPartNumber    → "pn:<normalized>"   e.g. "pn:31020-3VX2D"
 */
export function buildIdentityCacheKey(kind: TransmissionInputKind, normalized: string): string {
  return kind === "transmissionCode" ? `tc:${normalized}` : `pn:${normalized}`;
}

// ─── Shared internal implementation ──────────────────────────────────────────

/**
 * Core identification logic shared by all public entry points.
 * Uses GPT-4.1 + web_search and writes/reads the transmission_identity_cache table.
 *
 * Cache key scheme (Step 5):
 *   1. Compute normalized = normalizeIdentityInput(inputValue)
 *   2. primaryKey = buildIdentityCacheKey(inputKind, normalized)   e.g. "tc:JF011E"
 *   3. Try primaryKey — if found, use it.
 *   4. Fall back to legacy key (plain normalized, no prefix) for backward compat.
 *   5. On legacy hit: soft-migrate by upserting a prefixed entry (best-effort, non-fatal).
 *   6. New GPT results are always written under primaryKey — never unprefixed.
 */
async function _identifyTransmissionByInput(
  inputValue: string,
  inputKind: InputKind,
  context?: VehicleContext | null
): Promise<TransmissionIdentification> {
  try {
    console.log(
      `[TransmissionIdentifier] Identifying ${inputKind} "${inputValue}", vehicleContext:`,
      JSON.stringify(sanitizeForLog(context ?? null))
    );

    // 1. Normalize — uppercase, trim, collapse spaces; dashes preserved
    const normalized = normalizeIdentityInput(inputValue);

    // 2. Build the prefixed primary key
    const primaryKey = buildIdentityCacheKey(inputKind, normalized);

    // 3. Try primary (prefixed) key first
    const cached = await storage.getTransmissionIdentity(primaryKey);
    if (cached && cached.modelName) {
      incr("identity_cache.hit", { key: "prefixed", kind: inputKind });
      const keyHint = `${primaryKey.slice(0, 3)}...${primaryKey.slice(-4)}`;
      console.log(
        `[TransmissionIdentifier] Cache hit (primary) for ${primaryKey}: ${cached.modelName}`
      );
      console.log(
        `[TransmissionIdentifier] CacheOutcome: ${JSON.stringify({ kind: inputKind, cacheHit: "prefixed", keyHint })}`
      );
      await storage.incrementTransmissionIdentityHit(primaryKey);
      return {
        modelName: cached.modelName,
        manufacturer: cached.manufacturer ?? null,
        origin: (cached.origin as TransmissionIdentification["origin"]) ?? "unknown",
        confidence: (cached.confidence as TransmissionIdentification["confidence"]) ?? "high",
        notes: "Returned from local identity cache",
      };
    }

    // 4. Fall back to legacy unprefixed key (rows created before Step 5)
    const legacyCached = await storage.getTransmissionIdentity(normalized);
    if (legacyCached && legacyCached.modelName) {
      incr("identity_cache.hit", { key: "legacy", kind: inputKind });
      const legacyKeyHint = `${normalized.slice(0, 4)}...`;
      console.log(
        `[TransmissionIdentifier] Cache hit (legacy) for ${normalized}: ${legacyCached.modelName} — soft-migrating to ${primaryKey}`
      );
      console.log(
        `[TransmissionIdentifier] CacheOutcome: ${JSON.stringify({ kind: inputKind, cacheHit: "legacy", keyHint: legacyKeyHint })}`
      );
      await storage.incrementTransmissionIdentityHit(normalized);

      // 5. Soft-migration: upsert a prefixed entry so future lookups use the correct key.
      //    Best-effort — a failure here must not break the cache-hit return path.
      try {
        await storage.saveTransmissionIdentity({
          oem: legacyCached.oem,
          normalizedOem: primaryKey,
          modelName: legacyCached.modelName,
          manufacturer: legacyCached.manufacturer ?? null,
          origin: legacyCached.origin as TransmissionIdentification["origin"],
          confidence: legacyCached.confidence as TransmissionIdentification["confidence"],
        });
        incr("identity_cache.soft_migration", { result: "success", kind: inputKind });
        console.log(
          `[TransmissionIdentifier] Soft-migrated legacy "${normalized}" → "${primaryKey}"`
        );
      } catch (migrateErr) {
        incr("identity_cache.soft_migration", { result: "fail", kind: inputKind });
        console.warn(
          `[TransmissionIdentifier] Soft-migration upsert failed (non-fatal):`,
          migrateErr
        );
      }

      return {
        modelName: legacyCached.modelName,
        manufacturer: legacyCached.manufacturer ?? null,
        origin: (legacyCached.origin as TransmissionIdentification["origin"]) ?? "unknown",
        confidence: (legacyCached.confidence as TransmissionIdentification["confidence"]) ?? "high",
        notes: "Returned from local identity cache (legacy key; migrated to prefixed)",
      };
    }

    // 6. Build GPT prompt (cache miss on both primary and legacy keys)
    incr("identity_cache.miss", { kind: inputKind });
    console.log(
      `[TransmissionIdentifier] CacheOutcome: ${JSON.stringify({ kind: inputKind, cacheHit: "miss" })}`
    );
    const lines: string[] = [`OEM code: ${inputValue}.`];

    if (context?.partsApiRawData) {
      lines.push(`Full vehicle data from OEM catalog:`);
      lines.push(JSON.stringify(context.partsApiRawData, null, 2));
    } else {
      if (context?.make || context?.model) {
        lines.push(`Vehicle: ${[context.make, context.model].filter(Boolean).join(" ")}`);
      }
      if (context?.year) lines.push(`Year: ${context.year}`);
      if (context?.engine) lines.push(`Engine code: ${context.engine}`);
      if (context?.driveType) lines.push(`Drive type: ${context.driveType}`);
      if (context?.gearboxModelHint) lines.push(`Gearbox model hint: ${context.gearboxModelHint}`);
    }

    // Always append these signals regardless of rawData presence —
    // explicit structured fields prevent GPT from misreading the blob
    if (context?.factoryCode) {
      lines.push(`Factory code (from Podzamenu gearbox record): ${context.factoryCode}`);
    }
    if (context?.gearboxType) {
      lines.push(`Transmission type (pre-parsed, use this to avoid MT/CVT/AT confusion): ${context.gearboxType}`);
    }
    if (context?.displacement) {
      lines.push(`Engine displacement (critical for variant disambiguation): ${context.displacement}`);
    }
    if (context?.body) {
      lines.push(`Body type: ${context.body}`);
    }

    lines.push(`\nBased on the above vehicle data and OEM code, identify the transmission.`);
    lines.push(`Return modelName as it appears in Russian контрактные КПП listings (e.g. 'F4A42', 'W5MBB', 'S6FA', 'QCE') — NOT internal catalog or part numbers.`);
    lines.push(`Identify: modelName, manufacturer, origin, confidence, notes.`);

    const userPrompt = lines.join("\n");
    const input = SYSTEM_PROMPT + "\n\n" + userPrompt;
    console.log("[TransmissionIdentifier] Full GPT prompt:\n" + input);

    const response = await (openai as any).responses.create({
      model: "gpt-4.1",
      tools: [{ type: "web_search" }],
      input,
      temperature: 0,
    });

    const raw: string = response.output_text ?? "";
    const stripped = extractJsonFromText(raw);

    console.log("[TransmissionIdentifier] GPT response:", raw);
    console.log("[TransmissionIdentifier] Extracted JSON:", stripped);

    const parsed = JSON.parse(stripped) as Partial<TransmissionIdentification>;

    const validOrigins = ["japan", "europe", "korea", "usa", "unknown"] as const;
    const validConfidences = ["high", "medium", "low"] as const;

    const result: TransmissionIdentification = {
      modelName: typeof parsed.modelName === "string" ? parsed.modelName : null,
      manufacturer: typeof parsed.manufacturer === "string" ? parsed.manufacturer : null,
      origin: validOrigins.includes(parsed.origin as any)
        ? (parsed.origin as TransmissionIdentification["origin"])
        : "unknown",
      confidence: validConfidences.includes(parsed.confidence as any)
        ? (parsed.confidence as TransmissionIdentification["confidence"])
        : "low",
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };

    // Space Gear / Delica L400 guard: W5M series is FWD-platform only (Lancer/Galant).
    // If GPT returns a W5M model for a body-on-frame Mitsubishi body code, downgrade
    // confidence so the result requires operator approval instead of auto-sending.
    const spaceGearBodyPattern = /^P[A-F]\d+W$/i;
    const bodyCode = context?.partsApiRawData?.modely as string | undefined;
    if (bodyCode && spaceGearBodyPattern.test(bodyCode) && result.modelName?.startsWith("W5M")) {
      console.warn(
        `[TransmissionIdentifier] W5M series detected for Space Gear body ${bodyCode} — likely wrong. Setting confidence to low.`
      );
      result.confidence = "low";
      result.notes = `WARNING: W5M series unlikely for Space Gear/Delica L400 body ${bodyCode}. Manual verification required. ` + result.notes;
    }

    if (
      result.modelName &&
      (result.confidence === "high" || result.confidence === "medium")
    ) {
      try {
        // Always write under the prefixed primary key — never the legacy unprefixed form.
        await storage.saveTransmissionIdentity({
          oem: inputValue.trim(),
          normalizedOem: primaryKey,
          modelName: result.modelName,
          manufacturer: result.manufacturer ?? null,
          origin: result.origin,
          confidence: result.confidence,
        });
        console.log(
          `[TransmissionIdentifier] Saved to cache: ${primaryKey} → ${result.modelName}`
        );
      } catch (err) {
        // Cache save failure must never break the main flow
        console.warn("[TransmissionIdentifier] Cache save failed:", err);
      }
    }

    return result;
  } catch (err: any) {
    console.warn(
      `[TransmissionIdentifier] Failed to identify ${inputKind} "${inputValue}": ${err.message}`
    );
    return FALLBACK_RESULT;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Identifies the transmission from a gearbox model/market code (e.g. JF011E, 6HP19, A245E).
 * This is the value that appears in Russian контрактные КПП marketplace listings.
 */
export async function identifyTransmissionByTransmissionCode(
  transmissionCode: string,
  vehicleContext?: VehicleContext | null
): Promise<TransmissionIdentification> {
  return _identifyTransmissionByInput(transmissionCode, "transmissionCode", vehicleContext);
}

/**
 * Identifies the transmission from an OEM part number (e.g. 31020-3VX2D).
 * Part numbers are issued by the vehicle manufacturer and identify a specific assembly SKU.
 * GPT will cross-reference the part number to find the corresponding market model code.
 */
export async function identifyTransmissionByOemPartNumber(
  oemPartNumber: string,
  vehicleContext?: VehicleContext | null
): Promise<TransmissionIdentification> {
  return _identifyTransmissionByInput(oemPartNumber, "oemPartNumber", vehicleContext);
}

/**
 * @deprecated Use {@link identifyTransmissionByTransmissionCode} or
 * {@link identifyTransmissionByOemPartNumber} instead.
 *
 * Routing heuristic: if the input contains a digit adjacent to a hyphen
 * (e.g. "31020-3VX2D") it is treated as an OEM part number; otherwise it is
 * treated as a transmission model code (e.g. "JF011E", "6HP19").
 *
 * Preserved for backward compatibility — existing callers that pass only `oem`
 * continue to work without modification.
 */
export async function identifyTransmissionByOem(
  oem: string,
  context?: VehicleContext | null
): Promise<TransmissionIdentification> {
  const kind = classifyOemInput(oem);
  return _identifyTransmissionByInput(oem, kind, context);
}
