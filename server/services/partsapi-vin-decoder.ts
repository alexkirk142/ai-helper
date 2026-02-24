export interface PartsApiResult {
  make: string | null;
  modelName: string | null;
  year: string | null;
  engineCode: string | null;
  kpp: string | null;
  driveType: string | null;
  gearboxType: string | null;
  displacement: string | null;
  bodyType: string | null;
  rawData: Record<string, unknown> | null;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Core fetch — throws on network/timeout errors so callers can distinguish
 * failure types. Use decodeVinPartsApi (safe) or decodeVinPartsApiWithRetry
 * (resilient) instead of calling this directly.
 */
async function decodeVinPartsApiOnce(vin: string, apiKey: string): Promise<PartsApiResult | null> {
  const url = `https://api.partsapi.ru?method=VINdecodeOE&key=${apiKey}&vin=${encodeURIComponent(vin)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const json = await res.json();
  const d = json?.data?.array;
  if (!d) return null;

  // Extract engine code from strings like "G4GC3584975" or "1400CC / 150hp / 110kW TSI"
  let engineCode: string | null = null;
  const engRaw = String(d.dvigately ?? d.nomer_dvigatelya ?? "");
  const engMatch = engRaw.match(/\b([A-Z]{2,5}\d{0,4}[A-Z]{0,3})\b/);
  if (engMatch) engineCode = engMatch[1];

  // Clean model name: "Jetta 1,4 (TRENDLINE)" → "Jetta", "Santa Fe" → "Santa Fe"
  const rawName: string | null = d.naimenovanie ?? null;
  const modelName = rawName
    ? rawName.replace(/[\d,\(].*$/, "").trim() || rawName
    : null;

  return {
    make: d.brend ?? null,
    modelName,
    year: d.vypushcheno
      ? String(d.vypushcheno)
      : d.modelynyj_god
        ? String(d.modelynyj_god)
        : null,
    engineCode,
    kpp: d.kpp ?? null,
    driveType: d.privod ?? null,
    gearboxType: d.tip_kpp ?? null,
    displacement: d.obem ?? d.rabochij_obem ?? null,
    bodyType: d.tip_kuzova ?? d.kuzov ?? null,
    rawData: d,
  };
}

/**
 * Decodes a VIN via partsapi.ru VINdecodeOE method.
 * Returns structured vehicle metadata (make, model, year, engine code, gearbox code).
 * The apiKey must be passed by the caller — fetch it from the global secrets store
 * using getSecret({ scope: "global", keyName: "PARTSAPI_KEY" }).
 * All errors are caught and null is returned — use decodeVinPartsApiWithRetry for
 * resilience against transient timeouts.
 */
export async function decodeVinPartsApi(vin: string, apiKey: string): Promise<PartsApiResult | null> {
  try {
    return await decodeVinPartsApiOnce(vin, apiKey);
  } catch (e) {
    console.warn("[PartsAPI] VIN decode failed:", e);
    return null;
  }
}

/**
 * Same as decodeVinPartsApi but retries up to MAX_RETRIES times on timeout
 * errors, with RETRY_DELAY_MS between attempts.
 * 15 s × 3 attempts = up to 45 s total — acceptable for background BullMQ jobs.
 */
export async function decodeVinPartsApiWithRetry(vin: string, apiKey: string): Promise<PartsApiResult | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[PartsAPI] Attempt ${attempt}/${MAX_RETRIES} for VIN ${vin}`);
      const result = await decodeVinPartsApiOnce(vin, apiKey);
      if (result) {
        console.log(`[PartsAPI] VIN decoded successfully on attempt ${attempt}`);
      }
      return result;
    } catch (err) {
      const isTimeout =
        err instanceof Error &&
        (err.name === 'TimeoutError' || err.message.includes('timeout') || err.message.includes('aborted'));

      if (isTimeout && attempt < MAX_RETRIES) {
        console.warn(`[PartsAPI] Timeout on attempt ${attempt}, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }

      console.error(`[PartsAPI] Failed after ${attempt} attempt(s):`, err);
      return null;
    }
  }
  return null;
}
