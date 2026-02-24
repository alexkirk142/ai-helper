/**
 * HTTP client for the Podzamenu lookup service (FastAPI).
 * Looks up vehicle info (OEM gearbox, etc.) by VIN or FRAME.
 */

const DEFAULT_URL = "http://localhost:8200";

// ── OEM candidate scoring ──────────────────────────────────────────────────
// Podzamenu often returns multiple OEM candidates for the transmission
// section. The first entry is not always the gearbox assembly — it can be
// a control module, bracket, or other ancillary part.
// We score each candidate by its name and pick the highest-scoring one.

const ASSEMBLY_KEYWORDS = [
  "в сборе", "сборе", "assembly",
  "коробка передач", "кпп", "акпп", "мкпп", "вариатор", "cvt",
  "ведущий мост в блоке", "автоматическая коробка", "механическая коробка",
  "блок с автоматической", "трансмиссия",
];

const EXCLUDE_KEYWORDS = [
  "модуль", "блок управления", "датчик", "прокладка", "сальник",
  "фильтр", "шланг", "гайка", "болт", "кронштейн", "крышка",
  "поддон", "щуп", "трубка", "клапан", "соленоид", "sensor",
  "module", "control unit", "bracket", "gasket", "seal", "filter",
];

function scoreCandidate(name: string): number {
  const lower = name.toLowerCase();
  if (EXCLUDE_KEYWORDS.some((k) => lower.includes(k))) return -1;
  if (ASSEMBLY_KEYWORDS.some((k) => lower.includes(k))) return 2;
  return 1; // neutral
}

function selectBestOemCandidate(
  candidates: GearboxOemCandidate[],
  serviceOem: string | null
): string | null {
  if (candidates.length === 0) return serviceOem;

  const scored = candidates.map((c) => ({
    ...c,
    score: scoreCandidate(c.name ?? ""),
  }));

  console.log(
    "[Podzamenu] Candidate scores:",
    JSON.stringify(scored.map(({ oem, name, score }) => ({ oem, name, score })))
  );

  const best = scored
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score)[0];

  if (!best) {
    console.log("[Podzamenu] All candidates excluded by keyword filter, falling back to service OEM");
    return serviceOem;
  }

  console.log(
    "[Podzamenu] Selected best candidate:",
    JSON.stringify({ oem: best.oem, name: best.name, score: best.score })
  );

  return best.oem;
}

const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10_000;

export const PODZAMENU_NOT_FOUND = "NOT_FOUND" as const;

export interface LookupRequest {
  idType: "VIN" | "FRAME";
  value: string;
}

export interface GearboxOemCandidate {
  oem: string;
  name: string;
}

export interface GearboxInfo {
  model: string | null;
  factoryCode: string | null;
  oem: string | null;
  oemCandidates: GearboxOemCandidate[];
  oemStatus: "FOUND" | "NOT_FOUND" | "NOT_AVAILABLE" | "MODEL_ONLY";
}

export interface LookupResponse {
  vehicleMeta: Record<string, unknown>;
  gearbox: GearboxInfo;
  evidence: Record<string, unknown>;
}

export class PodzamenuLookupError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "PodzamenuLookupError";
  }
}

function isRetryable(err: PodzamenuLookupError): boolean {
  // Retry on timeout, connection refused / fetch failed, and HTTP 5xx
  if (err.code === "TIMEOUT" || err.code === "NETWORK_ERROR") return true;
  if (err.code === "LOOKUP_ERROR" && err.statusCode !== undefined && err.statusCode >= 500) return true;
  return false;
}

async function attemptLookup(url: string, request: LookupRequest): Promise<LookupResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idType: request.idType,
        value: request.value,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.status === 404) {
      throw new PodzamenuLookupError(
        PODZAMENU_NOT_FOUND,
        PODZAMENU_NOT_FOUND,
        404
      );
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body.detail) {
          detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
        } else if (body.message) {
          detail = body.message;
        }
      } catch {
        const text = await res.text();
        if (text) detail = text.slice(0, 200);
      }
      throw new PodzamenuLookupError(
        `Podzamenu lookup failed: ${detail}`,
        "LOOKUP_ERROR",
        res.status
      );
    }

    const data = (await res.json()) as LookupResponse;
    if (!data || !data.gearbox || typeof data.gearbox.oemStatus !== "string") {
      throw new PodzamenuLookupError(
        "Invalid response from Podzamenu: missing gearbox",
        "INVALID_RESPONSE"
      );
    }

    const oemCandidates: GearboxOemCandidate[] = Array.isArray(data.gearbox.oemCandidates)
      ? data.gearbox.oemCandidates
      : [];

    const selectedOem = selectBestOemCandidate(oemCandidates, data.gearbox.oem ?? null);

    const gearbox: GearboxInfo = {
      model: data.gearbox.model ?? null,
      factoryCode: data.gearbox.factoryCode ?? null,
      oem: selectedOem,
      oemCandidates,
      oemStatus: data.gearbox.oemStatus,
    };

    return {
      vehicleMeta: data.vehicleMeta ?? {},
      gearbox,
      evidence: data.evidence ?? {},
    };
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof PodzamenuLookupError) {
      throw err;
    }
    if (err instanceof SyntaxError) {
      throw new PodzamenuLookupError(
        "Invalid JSON response from Podzamenu",
        "INVALID_RESPONSE"
      );
    }
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        throw new PodzamenuLookupError(
          `Podzamenu lookup timeout after ${TIMEOUT_MS / 1000}s`,
          "TIMEOUT"
        );
      }
      throw new PodzamenuLookupError(
        `Podzamenu lookup failed: ${err.message}`,
        "NETWORK_ERROR"
      );
    }
    throw new PodzamenuLookupError(
      "Podzamenu lookup failed: unknown error",
      "UNKNOWN"
    );
  }
}

export async function lookupByVehicleId(
  request: LookupRequest
): Promise<LookupResponse> {
  const baseUrl =
    process.env.PODZAMENU_LOOKUP_SERVICE_URL?.trim() || DEFAULT_URL;
  const url = `${baseUrl.replace(/\/$/, "")}/lookup`;

  let lastError: PodzamenuLookupError | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(
        `[PodzamenuClient] Retry ${attempt}/${MAX_RETRIES} in ${RETRY_DELAY_MS / 1000}s (last error: ${lastError?.code})`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }

    try {
      return await attemptLookup(url, request);
    } catch (err) {
      if (!(err instanceof PodzamenuLookupError)) throw err;
      lastError = err;
      if (!isRetryable(err)) throw err;
    }
  }

  throw lastError!;
}
