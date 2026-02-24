import { openai } from "./decision-engine";
import { isValidVinChecksum, tryAutoCorrectVin } from "../utils/vin-validator";

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

/** Truncates base64 data: URLs so they are safe to include in log output. */
export function logSafeUrl(url: string): string {
  if (url.startsWith("data:")) {
    return url.substring(0, 50) + "...[base64 truncated]";
  }
  return url;
}

export type ImageAnalysisResult =
  | { type: "gearbox_tag"; code: string }
  | { type: "registration_doc"; vin: string | null; frame: string | null; make: string | null; model: string | null }
  | { type: "unknown" };

const IMAGE_ANALYSIS_PROMPT = `Analyze this image and determine what it shows.

TYPE 1 — Gearbox tag/label (шильдик КПП):
A metal or plastic label attached to a transmission with alphanumeric codes.
→ Extract the transmission model code (e.g. W5MBB, F4A42, RE4F03B)
→ Return: { "type": "gearbox_tag", "code": "<extracted code>" }

TYPE 2 — Vehicle registration document (свидетельство о регистрации ТС):
A Russian vehicle registration certificate showing VIN, Frame/Кузов number, make, model.
→ Extract VIN (17 chars) if present, OR Frame/Кузов number if VIN is absent/ОТСУТСТВУЕТ
→ Return: { "type": "registration_doc", "vin": "<VIN or null>", "frame": "<frame number or null>", "make": "<make or null>", "model": "<model or null>" }

TYPE 3 — Other / unclear:
→ Return: { "type": "unknown" }

Respond ONLY with a valid JSON object, no extra text, no markdown code fences.`;

/**
 * Uses GPT-4o vision to classify a single image and extract relevant data.
 * Returns typed ImageAnalysisResult.
 */
export async function analyzeImage(
  attachment: { url?: string; mimeType?: string }
): Promise<ImageAnalysisResult> {
  const url = attachment.url;
  if (!url) return { type: "unknown" };

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url, detail: "high" },
          },
          {
            type: "text",
            text: IMAGE_ANALYSIS_PROMPT,
          },
        ],
      },
    ],
    max_tokens: 200,
    temperature: 0,
  });

  const text = (response.choices[0]?.message?.content ?? "").trim();
  try {
    const jsonStr = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(jsonStr) as ImageAnalysisResult;
    if (
      parsed.type === "gearbox_tag" ||
      parsed.type === "registration_doc" ||
      parsed.type === "unknown"
    ) {
      return parsed;
    }
  } catch {
    // fall through to unknown
  }

  return { type: "unknown" };
}

/**
 * Strategy 2: sends the same image to GPT-4o a second time with a targeted prompt
 * that names the previously-read (checksum-invalid) VIN and highlights confusion pairs.
 * Also runs strategy 1 (single-char substitution) on GPT's new attempt.
 * Returns a checksum-valid VIN string, or null if the retry still fails.
 */
async function retryVinReadWithGpt(url: string, previousVin: string): Promise<string | null> {
  const retryPrompt =
    `Look at this vehicle registration document image again.\n` +
    `You previously read the VIN as: ${previousVin}\n` +
    `This VIN has an invalid checksum — there is likely a misread character.\n\n` +
    `Pay special attention to these visually similar pairs:\n` +
    `- Letter S vs digit 5\n` +
    `- Letter B vs digit 8\n` +
    `- Letter Z vs digit 2\n` +
    `- Letter G vs digit 6\n` +
    `- Letter I vs digit 1\n` +
    `- Letter O vs digit 0 (O is never valid in VIN)\n\n` +
    `Read the VIN again very carefully, character by character.\n` +
    `Return ONLY the 17-character VIN, nothing else.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url, detail: "high" } },
            { type: "text", text: retryPrompt },
          ],
        },
      ],
      max_tokens: 50,
      temperature: 0,
    });

    const text = (response.choices[0]?.message?.content ?? "").trim().toUpperCase();
    if (!VIN_RE.test(text)) return null;

    if (isValidVinChecksum(text)) return text;

    // Apply strategy 1 on GPT's new attempt as well
    const corrected = tryAutoCorrectVin(text);
    return corrected ?? null;
  } catch (e) {
    console.error(`[VinOCR] GPT VIN retry failed:`, e);
    return null;
  }
}

/**
 * Iterates over attachments and returns the first non-unknown ImageAnalysisResult.
 * Falls back to { type: "unknown" } if all attachments are unclassified or fail.
 */
export async function analyzeImages(
  attachments: Array<{ url?: string; mimeType?: string }>
): Promise<ImageAnalysisResult> {
  for (const attachment of attachments) {
    const url = attachment.url;
    if (!url) continue;

    console.log(`[VinOCR] Analyzing attachment: ${logSafeUrl(url)}`);

    try {
      let result = await analyzeImage(attachment);
      console.log(`[VinOCR] Image analysis result: ${JSON.stringify(result)}`);

      if (result.type === "registration_doc" && result.vin) {
        if (!isValidVinChecksum(result.vin)) {
          // Strategy 1: single-char substitution
          const corrected = tryAutoCorrectVin(result.vin);
          if (corrected) {
            console.log(`[VinOCR] Auto-corrected registration_doc VIN: ${result.vin} → ${corrected}`);
            result = { ...result, vin: corrected };
          } else {
            // Strategy 2: ask GPT to re-read the image with targeted guidance
            console.warn(`[VinOCR] registration_doc VIN checksum invalid, trying GPT retry: ${result.vin}`);
            const gptRetry = await retryVinReadWithGpt(url, result.vin);
            if (gptRetry) {
              console.log(`[VinOCR] GPT retry corrected registration_doc VIN: ${result.vin} → ${gptRetry}`);
              result = { ...result, vin: gptRetry };
            } else {
              console.warn(`[VinOCR] registration_doc VIN still invalid after GPT retry: ${result.vin}`);
            }
          }
        }
      }

      if (result.type !== "unknown") {
        return result;
      }
    } catch (e) {
      console.error(`[VinOCR] Failed to analyze attachment (${logSafeUrl(url)}):`, e);
    }
  }

  return { type: "unknown" };
}

/**
 * Uses GPT-4o vision to extract a VIN from image attachments.
 * Accepts HTTP/HTTPS URLs and data: URLs (base64-encoded images).
 * Returns the first valid 17-char VIN found, or null.
 */
export async function extractVinFromImages(
  attachments: Array<{ url?: string; mimeType?: string }>
): Promise<string | null> {
  for (const attachment of attachments) {
    const url = attachment.url;
    if (!url) continue;

    console.log(`[VinOCR] Processing attachment: ${logSafeUrl(url)}`);

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url, detail: "high" },
              },
              {
                type: "text",
                text:
                  "Extract the VIN number from this image. " +
                  "A VIN is exactly 17 characters: letters A-Z (no I, O, Q) and digits 0-9. " +
                  "Return ONLY the 17-character VIN with no spaces or punctuation. " +
                  "If no VIN is visible, return exactly: null",
              },
            ],
          },
        ],
        max_tokens: 50,
        temperature: 0,
      });

      const text = (response.choices[0]?.message?.content ?? "").trim();
      if (text && text !== "null" && VIN_RE.test(text)) {
        let extractedVin = text.toUpperCase();
        if (!isValidVinChecksum(extractedVin)) {
          // Strategy 1: single-char substitution
          const corrected = tryAutoCorrectVin(extractedVin);
          if (corrected) {
            console.log(`[VinOCR] Auto-corrected VIN: ${extractedVin} → ${corrected}`);
            extractedVin = corrected;
          } else {
            // Strategy 2: ask GPT to re-read the image with targeted guidance
            console.warn(`[VinOCR] VIN checksum invalid, trying GPT retry: ${extractedVin}`);
            const gptRetry = await retryVinReadWithGpt(url, extractedVin);
            if (gptRetry) {
              console.log(`[VinOCR] GPT retry corrected VIN: ${extractedVin} → ${gptRetry}`);
              extractedVin = gptRetry;
            } else {
              console.warn(`[VinOCR] VIN still invalid after GPT retry: ${extractedVin}`);
            }
          }
        }
        console.log(`[VinOCR] Extracted VIN: ${extractedVin}`);
        return extractedVin;
      }

      console.log(`[VinOCR] No VIN found in attachment (response: "${text}")`);
    } catch (e) {
      console.error(`[VinOCR] Failed to process attachment (${logSafeUrl(url)}):`, e);
    }
  }

  return null;
}
