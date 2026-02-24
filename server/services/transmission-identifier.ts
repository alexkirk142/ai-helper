import { openai } from "./decision-engine";
import { sanitizeForLog } from "../utils/sanitizer";
import { storage } from "../storage";

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
3. For Mitsubishi Lancer CY4A with "5FM/T":
   - W5MBB = 5-speed manual, 4WD (most common for Lancer 4WD)
   - W5M51 = 5-speed manual, 2WD
   - Look at drive type: "4WD" → W5MBB, "2WD"/"FWD" → W5M51
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

/**
 * Identifies a transmission model from an OEM/part number using GPT-4.1 + web_search.
 * Searches the web to verify the exact market model name used in Russian/Japanese listings.
 * Optionally accepts vehicle context to improve identification accuracy.
 *
 * Returns all nulls with confidence: 'low' on parse failure.
 */
export async function identifyTransmissionByOem(
  oem: string,
  context?: VehicleContext
): Promise<TransmissionIdentification> {
  try {
    console.log(`[TransmissionIdentifier] vehicleContext received:`, JSON.stringify(sanitizeForLog(context ?? null)));

    // 1. Normalize OEM (uppercase, trim)
    const normalizedOem = oem.trim().toUpperCase();

    // 2. Check local cache first
    const cached = await storage.getTransmissionIdentity(normalizedOem);
    if (cached && cached.modelName) {
      console.log(
        `[TransmissionIdentifier] Cache hit for ${normalizedOem}: ${cached.modelName}`
      );
      await storage.incrementTransmissionIdentityHit(normalizedOem);
      return {
        modelName: cached.modelName,
        manufacturer: cached.manufacturer ?? null,
        origin: (cached.origin as TransmissionIdentification["origin"]) ?? "unknown",
        confidence: (cached.confidence as TransmissionIdentification["confidence"]) ?? "high",
        notes: "Returned from local identity cache",
      };
    }

    // 3. GPT call
    const lines: string[] = [`OEM code: ${oem}.`];

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

    if (
      result.modelName &&
      (result.confidence === "high" || result.confidence === "medium")
    ) {
      try {
        await storage.saveTransmissionIdentity({
          oem: oem.trim(),
          normalizedOem,
          modelName: result.modelName,
          manufacturer: result.manufacturer ?? null,
          origin: result.origin,
          confidence: result.confidence,
        });
        console.log(
          `[TransmissionIdentifier] Saved to cache: ${normalizedOem} → ${result.modelName}`
        );
      } catch (err) {
        // Cache save failure must never break the main flow
        console.warn("[TransmissionIdentifier] Cache save failed:", err);
      }
    }

    return result;
  } catch (err: any) {
    console.warn(`[TransmissionIdentifier] Failed to identify OEM "${oem}": ${err.message}`);
    return FALLBACK_RESULT;
  }
}
