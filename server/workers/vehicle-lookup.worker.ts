import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { VehicleLookupJobData } from "../services/vehicle-lookup-queue";
import { getRedisConnectionConfig } from "../services/message-queue";
import {
  lookupByVehicleId,
  PODZAMENU_NOT_FOUND,
  PodzamenuLookupError,
} from "../services/podzamenu-lookup-client";
import type { GearboxInfo } from "../services/podzamenu-lookup-client";
import { fillGearboxTemplate } from "../services/gearbox-templates";
import { storage } from "../storage";
import { identifyTransmissionByOem, type VehicleContext } from "../services/transmission-identifier";
import { getSecret } from "../services/secret-resolver";
import { decodeVinPartsApiWithRetry, type PartsApiResult } from "../services/partsapi-vin-decoder";
import { extractVehicleContextFromRawData } from "../services/vehicle-data-extractor";
import { sanitizeForLog } from "../utils/sanitizer";

const QUEUE_NAME = "vehicle_lookup_queue";

const DUPLICATE_SUGGESTION_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

function isValidTransmissionModel(model: string | null): boolean {
  if (!model) return false;
  if (model.length > 12) return false;
  // Reject internal catalog codes with 4+ consecutive digits (e.g. M3MHD987579)
  if (/\d{4,}/.test(model)) return false;
  return /^[A-Z0-9][A-Z0-9\-()]{1,11}$/.test(model);
}

function computeLookupConfidence(gearbox: GearboxInfo, evidence: Record<string, unknown>): number {
  let c = 0.5;
  const hasOem = gearbox.oemStatus === "FOUND" && !!gearbox.oem;
  const isModelOnly = gearbox.oemStatus === "MODEL_ONLY" && !!gearbox.model;
  if (hasOem) c += 0.3;
  if (isModelOnly) c += 0.2;
  if (evidence.sourceSelected === "podzamenu") c += 0.1;
  if (Array.isArray(gearbox.oemCandidates) && gearbox.oemCandidates.length > 0) c += 0.1;
  if (gearbox.oemStatus === "NOT_AVAILABLE") c -= 0.2;
  if (!hasOem && !isModelOnly) c -= 0.2;
  return Math.max(0, Math.min(1, c));
}

function idTypeToLabel(idType: string): string {
  return idType === "VIN" ? "VIN-коду" : "номеру кузова";
}

function buildResultSuggestionText(
  templates: { gearboxLookupFound: string; gearboxLookupModelOnly: string; gearboxTagRequest: string; gearboxLookupFallback: string; gearboxNoVin: string },
  gearbox: GearboxInfo,
  evidence: Record<string, unknown>,
  lookupConfidence: number,
  idType: string,
  gearboxType?: string
): string {
  const source = (evidence.sourceSelected as string) ?? (evidence.source as string) ?? "";
  const oem = gearbox.oem ?? "";
  const model = gearbox.model ?? "";
  const factoryCode = gearbox.factoryCode ?? "";
  const params = { oem, model, source, factoryCode, idType: idTypeToLabel(idType), gearboxType: gearboxType ?? "" };

  if (gearbox.oemStatus === "MODEL_ONLY") {
    return fillGearboxTemplate(templates.gearboxLookupModelOnly, params);
  }
  if (lookupConfidence >= 0.8) {
    return fillGearboxTemplate(templates.gearboxLookupFound, params);
  }
  if (lookupConfidence >= 0.5) {
    return fillGearboxTemplate(templates.gearboxLookupModelOnly, params);
  }
  return fillGearboxTemplate(templates.gearboxTagRequest, params);
}

async function createResultSuggestionIfNeeded(params: {
  tenantId: string;
  conversationId: string;
  messageId?: string;
  gearbox: GearboxInfo;
  evidence: Record<string, unknown>;
  lookupConfidence: number;
  idType: string;
  gearboxType?: string;
}): Promise<void> {
  const { tenantId, conversationId, messageId, gearbox, evidence, lookupConfidence, idType, gearboxType } = params;
  const templates = await storage.getTenantTemplates(tenantId);
  const suggestedReply = buildResultSuggestionText(templates, gearbox, evidence, lookupConfidence, idType, gearboxType);

  const intent =
    (gearbox.oemStatus === "FOUND" && gearbox.oem) || gearbox.oemStatus === "MODEL_ONLY"
      ? "other"
      : "gearbox_tag_request";

  const recentSuggestions = await storage.getSuggestionsByConversation(conversationId, tenantId);
  const cutoff = new Date(Date.now() - DUPLICATE_SUGGESTION_WINDOW_MS);
  const hasDuplicate = recentSuggestions
    .slice(0, 5)
    .some((s) => s.suggestedReply === suggestedReply && s.createdAt >= cutoff);
  if (hasDuplicate) {
    console.log(`[VehicleLookupWorker] Skipping duplicate suggestion for conversation ${conversationId}`);
    return;
  }

  const suggestion = await storage.createAiSuggestion({
    conversationId,
    messageId: messageId ?? null,
    suggestedReply,
    intent,
    confidence: lookupConfidence,
    needsApproval: true,
    needsHandoff: false,
    questionsToAsk: [],
    usedSources: [],
    status: "pending",
    decision: "NEED_APPROVAL",
    autosendEligible: false,
  }, tenantId);

  try {
    const { realtimeService } = await import("../services/websocket-server");
    realtimeService.broadcastNewSuggestion(tenantId, conversationId, suggestion.id);
  } catch {
    // Skip broadcast if import fails (e.g. circular deps, worker runs separately)
  }

  console.log(`[VehicleLookupWorker] Created result suggestion ${suggestion.id} for conversation ${conversationId}`);
}


async function processVehicleLookup(job: Job<VehicleLookupJobData>): Promise<void> {
  const { caseId, tenantId, conversationId, idType, normalizedValue } = job.data;

  console.log(`[VehicleLookupWorker] Processing job: ${job.id}, caseId: ${caseId}`);

  const { featureFlagService } = await import("../services/feature-flags");
  const autoPartsEnabled = await featureFlagService.isEnabled("AUTO_PARTS_ENABLED", tenantId);
  if (!autoPartsEnabled) {
    console.log(`[VehicleLookupWorker] Tenant ${tenantId} — AUTO_PARTS_ENABLED=false, skipping`);
    return;
  }

  const caseRow = await storage.getVehicleLookupCaseById(caseId, tenantId);
  if (!caseRow) {
    throw new Error(`Case not found: ${caseId}`);
  }

  await storage.updateVehicleLookupCaseStatus(caseId, tenantId, { status: "RUNNING" });

  let partsApiPromise: Promise<PartsApiResult | null> = Promise.resolve(null);

  try {
    // BUG 5: Run Podzamenu and PartsAPI in parallel to reduce worst-case latency
    // from ~285 s (sequential) to ~75 s (parallel).
    // BUG 1: PartsAPI supports FRAME numbers — remove idType === "VIN" guard.
    const partsApiKey = await getSecret({ scope: "global", keyName: "PARTSAPI_KEY" });
    partsApiPromise = partsApiKey
      ? decodeVinPartsApiWithRetry(normalizedValue, partsApiKey).catch((err: Error) => {
          console.warn(`[VehicleLookupWorker] PartsAPI failed, continuing without it: ${err?.message}`);
          return null;
        })
      : Promise.resolve(null);

    const [lookupResult, partsApi] = await Promise.all([
      lookupByVehicleId({ idType, value: normalizedValue }),
      partsApiPromise,
    ]);

    console.log(`[VehicleLookupWorker] Raw Podzamenu response:`, JSON.stringify(sanitizeForLog(lookupResult), null, 2));
    console.log("[VehicleLookupWorker] PartsAPI result:", JSON.stringify(sanitizeForLog(partsApi)));
    const { gearbox } = lookupResult;

    const hasOem = gearbox.oemStatus === "FOUND" && gearbox.oem;
    const hasModel = !!gearbox.model;

    if (!hasOem && !hasModel) {
      await storage.updateVehicleLookupCaseStatus(caseId, tenantId, {
        status: "FAILED",
        error: "PARSE_FAILED",
      });
      console.error(`[VehicleLookupWorker] Case failed (parse): ${caseId} - no OEM nor model`);
      return;
    }

    // ── Vehicle context ────────────────────────────────────────────────────────
    // Podzamenu owns OEM numbers; PartsAPI owns clean vehicle metadata.
    // Use Podzamenu gearbox.model as hint only when it passes the market-code
    // validator (rejects internal codes like M3MHD987579). Fall back to the kpp
    // field from PartsAPI if available and valid.

    const podzamenuGearboxHint = isValidTransmissionModel(gearbox.model ?? null)
      ? (gearbox.model ?? null)
      : null;
    const factoryCode = gearbox.factoryCode ?? null;

    const partsApiKppHint =
      partsApi?.kpp && isValidTransmissionModel(partsApi.kpp) ? partsApi.kpp : null;
    const gearboxModelHint = podzamenuGearboxHint ?? partsApiKppHint;

    // Parse driveType and gearboxType from PartsAPI modifikaciya field.
    // These fields are often null on partsApi directly but present in rawData.modifikaciya
    // (e.g. "2000(SEDAN) - INTENSE(4WD/EURO4),5FM/T RUSSIA").
    const rawData = partsApi?.rawData as Record<string, string> | null | undefined;
    const modif = (rawData?.modifikaciya || '').toUpperCase();

    const parsedDriveType: string | null = modif.includes('4WD') || modif.includes('AWD')
      ? '4WD'
      : modif.includes('2WD') || modif.includes('FWD')
        ? '2WD'
        : null;

    const parsedGearboxType: string | null = modif.includes('FM/T') || modif.includes('/MT') || modif.includes('MT,')
      ? 'MT'
      : modif.includes('CVT')
        ? 'CVT'
        : modif.includes('/AT') || modif.includes('AT,') || modif.includes('A/T')
          ? 'AT'
          : null;

    if (modif) {
      console.log(
        `[VehicleLookupWorker] modifikaciya="${modif}" → driveType=${parsedDriveType ?? 'null'}, gearboxType=${parsedGearboxType ?? 'null'}`
      );
    }

    // Fallback: parse driveType from opcii if modifikaciya was empty/absent
    // (Japanese market cars often have no modifikaciya but carry opcii like "Привод/Длина:4WD")
    let mutableDriveType: string | null = parsedDriveType;
    if (!mutableDriveType && rawData?.opcii) {
      const opcii = String(rawData.opcii).toUpperCase();
      if (opcii.includes('4WD') || opcii.includes('AWD') || opcii.includes('4X4')) {
        mutableDriveType = '4WD';
        console.log('[VehicleLookupWorker] driveType from opcii:', mutableDriveType);
      } else if (opcii.includes('2WD') || opcii.includes('FWD') || opcii.includes('RWD')) {
        mutableDriveType = '2WD';
        console.log('[VehicleLookupWorker] driveType from opcii:', mutableDriveType);
      }
    }

    // Fallback: parse gearboxType from rawData.kpp if modifikaciya was empty/absent
    // (e.g. rawData.kpp = "CVT" for Nissan X-Trail NT32)
    let mutableGearboxType: string | null = parsedGearboxType;
    if (!mutableGearboxType && rawData?.kpp) {
      const kpp = String(rawData.kpp).toUpperCase().trim();
      if (kpp === 'CVT' || kpp.startsWith('CVT')) {
        mutableGearboxType = 'CVT';
      } else if (kpp === 'MT' || kpp.includes('/MT') || kpp.includes('MT,')) {
        mutableGearboxType = 'MT';
      } else if (kpp === 'AT' || kpp.includes('/AT') || kpp.includes('A/T')) {
        mutableGearboxType = 'AT';
      }
      if (mutableGearboxType) {
        console.log('[VehicleLookupWorker] gearboxType from kpp field:', mutableGearboxType);
      }
    }

    const vehicleContext: VehicleContext = {
      make: partsApi?.make ?? null,
      model: partsApi?.modelName ?? null,
      year: partsApi?.year ?? null,
      engine: partsApi?.engineCode ?? null,
      body: partsApi?.bodyType ?? null,
      driveType: mutableDriveType ?? partsApi?.driveType ?? null,
      gearboxModelHint,
      factoryCode,
      gearboxType: mutableGearboxType ?? partsApi?.gearboxType ?? null,
      displacement: partsApi?.displacement ?? null,
      partsApiRawData: partsApi?.rawData ?? null,
    };

    // BUG 2: Use Podzamenu vehicleMeta as fallback for make/model/year when
    // PartsAPI returns no data (critical for FRAME lookups).
    const vm = lookupResult.vehicleMeta as { make?: string; model?: string; year?: string | number };
    if (!vehicleContext.make && typeof vm.make === "string" && vm.make) {
      vehicleContext.make = vm.make;
      console.log(`[VehicleLookupWorker] make from Podzamenu vehicleMeta: ${vm.make}`);
    }
    if (!vehicleContext.model && typeof vm.model === "string" && vm.model) {
      vehicleContext.model = vm.model;
      console.log(`[VehicleLookupWorker] model from Podzamenu vehicleMeta: ${vm.model}`);
    }
    if (!vehicleContext.year && vm.year) {
      vehicleContext.year = String(vm.year);
      console.log(`[VehicleLookupWorker] year from Podzamenu vehicleMeta: ${vm.year}`);
    }

    // GPT extraction: universal fallback for driveType/gearboxType when all
    // field-based parsing (modifikaciya, opcii, kpp) produced no result.
    // Handles any manufacturer/market without per-field maintenance.
    if ((!vehicleContext.driveType || !vehicleContext.gearboxType) && vehicleContext.partsApiRawData) {
      console.log("[VehicleLookupWorker] driveType/gearboxType null — using GPT extraction");
      const extracted = await extractVehicleContextFromRawData(
        vehicleContext.partsApiRawData as Record<string, unknown>
      );
      if (!vehicleContext.driveType && extracted.driveType) {
        vehicleContext.driveType = extracted.driveType;
        console.log("[VehicleLookupWorker] driveType from GPT:", extracted.driveType);
      }
      if (!vehicleContext.gearboxType && extracted.gearboxType) {
        vehicleContext.gearboxType = extracted.gearboxType;
        console.log("[VehicleLookupWorker] gearboxType from GPT:", extracted.gearboxType);
      }
    }

    console.log(
      `[VehicleLookupWorker] Final vehicleContext: make=${vehicleContext.make}, model=${vehicleContext.model}, ` +
      `year=${vehicleContext.year}, engine=${vehicleContext.engine}, ` +
      `driveType=${vehicleContext.driveType}, gearboxType=${vehicleContext.gearboxType}, ` +
      `gearboxHint=${vehicleContext.gearboxModelHint}`
    );

    // ── Cache & status ─────────────────────────────────────────────────────────
    const lookupConfidence = computeLookupConfidence(gearbox, lookupResult.evidence as Record<string, unknown>);
    const result = {
      vehicleMeta: lookupResult.vehicleMeta,
      gearbox: lookupResult.gearbox,
      evidence: lookupResult.evidence,
      lookupConfidence,
    } as Record<string, unknown>;

    const lookupKey = normalizedValue;
    const evidenceSource = (lookupResult.evidence?.sourceSelected as string) ?? (lookupResult.evidence?.source as string) ?? "podzamenu";
    await storage.upsertVehicleLookupCache({
      lookupKey,
      idType,
      rawValue: caseRow.rawValue,
      normalizedValue,
      result,
      source: evidenceSource,
    });

    const cacheRow = await storage.getVehicleLookupCacheByKey(lookupKey);
    if (cacheRow) {
      await storage.linkCaseToCache(caseId, cacheRow.id);
    }

    await storage.updateVehicleLookupCaseStatus(caseId, tenantId, {
      status: "COMPLETED",
      verificationStatus: "NEED_TAG_OPTIONAL",
    });

    const factoryTag = gearbox.factoryCode ? `, factoryCode: ${gearbox.factoryCode}` : "";
    const logValue = hasOem
      ? `gearbox OEM ${gearbox.oem}${factoryTag}`
      : `gearbox model ${gearbox.model} (OEM not available)${factoryTag}`;
    const src = (lookupResult.evidence?.sourceSelected as string) ?? (lookupResult.evidence?.source as string) ?? "podzamenu";
    console.log(`[VehicleLookupWorker] Case completed: ${caseId} - ${logValue} [${src}], lookup confidence: ${lookupConfidence.toFixed(2)}`);

    const gearboxLabel =
      vehicleContext.gearboxType === "CVT" ? "CVT (вариатор)" :
      vehicleContext.gearboxType === "MT" ? "МКПП" :
      vehicleContext.gearboxType === "AT" ? "АКПП" :
      (vehicleContext.gearboxModelHint ?? "");

    // Reject serial numbers (nomer_kpp, e.g. "EDDVA4480773") from the model field
    // before building the customer-facing suggestion. Serial numbers have 4+ consecutive
    // digits and are meaningless to the customer; use the validated market code instead.
    let gearboxForSuggestion: GearboxInfo = {
      ...gearbox,
      model: isValidTransmissionModel(gearbox.model ?? null)
        ? gearbox.model
        : gearboxModelHint,
    };

    if (gearboxForSuggestion.model) {
      console.log(
        `[VehicleLookupWorker] Model from Podzamenu/PartsAPI: ` +
        `${gearboxForSuggestion.model}, skipping GPT identification`
      );
    } else if (gearbox.oem) {
      try {
        const identification = await identifyTransmissionByOem(
          gearbox.oem,
          vehicleContext
        );
        if (
          identification?.modelName &&
          (identification.confidence === "high" ||
            identification.confidence === "medium")
        ) {
          gearboxForSuggestion = {
            ...gearboxForSuggestion,
            model: identification.modelName,
          };
          console.log(
            `[VehicleLookupWorker] GPT identified model for OEM ` +
            `${gearbox.oem}: ${identification.modelName} ` +
            `(confidence: ${identification.confidence})`
          );
        }
      } catch (err) {
        // Never block suggestion creation
        console.warn(
          "[VehicleLookupWorker] GPT identification failed, " +
          "proceeding without model name:", err
        );
      }
    }

    await createResultSuggestionIfNeeded({
      tenantId,
      conversationId,
      messageId: caseRow.messageId ?? undefined,
      gearbox: gearboxForSuggestion,
      evidence: lookupResult.evidence as Record<string, unknown>,
      lookupConfidence,
      idType,
      gearboxType: gearboxLabel,
    });

  } catch (error) {
    // Treat PARSE_FAILED (podzamenu scraped page but couldn't extract data, HTTP 500)
    // the same as NOT_FOUND: mark the case as FAILED in both situations.
    const isParseFailed =
      error instanceof PodzamenuLookupError &&
      error.code === "LOOKUP_ERROR" &&
      error.statusCode === 500;

    if (error instanceof PodzamenuLookupError && (error.code === PODZAMENU_NOT_FOUND || isParseFailed)) {
      const failReason = isParseFailed ? "PARSE_FAILED" : "NOT_FOUND";
      console.log(`[VehicleLookupWorker] Case not found (Podzamenu ${failReason}): ${caseId}`);
      await storage.updateVehicleLookupCaseStatus(caseId, tenantId, {
        status: "FAILED",
        error: failReason,
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[VehicleLookupWorker] Case failed: ${caseId}`, message);
    await storage.updateVehicleLookupCaseStatus(caseId, tenantId, {
      status: "FAILED",
      error: message,
    });
    throw error;
  }
}

export function createVehicleLookupWorker(connectionConfig: IORedis): Worker<VehicleLookupJobData> {
  const worker = new Worker<VehicleLookupJobData>(
    QUEUE_NAME,
    async (job) => {
      await processVehicleLookup(job);
    },
    {
      connection: connectionConfig as any,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[VehicleLookupWorker] Job completed: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[VehicleLookupWorker] Job failed: ${job?.id}`, error?.message);
  });

  worker.on("error", (error) => {
    console.error("[VehicleLookupWorker] Worker error:", error);
  });

  console.log(`[VehicleLookupWorker] Worker started for queue: ${QUEUE_NAME}`);
  return worker;
}

export async function startVehicleLookupWorker(): Promise<Worker<VehicleLookupJobData> | null> {
  const config = getRedisConnectionConfig();
  if (!config) {
    console.warn("[VehicleLookupWorker] REDIS_URL not configured, worker not started");
    return null;
  }

  try {
    return createVehicleLookupWorker(config);
  } catch (error) {
    console.error("[VehicleLookupWorker] Failed to start worker:", error);
    return null;
  }
}

const isMain = process.argv[1]?.includes("vehicle-lookup.worker");
if (isMain) {
  startVehicleLookupWorker()
    .then((worker) => {
      if (worker) {
        console.log("[VehicleLookupWorker] Process running...");
        process.on("SIGTERM", async () => {
          console.log("[VehicleLookupWorker] Shutting down...");
          await worker.close();
          process.exit(0);
        });
      } else {
        console.error("[VehicleLookupWorker] Failed to start worker");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("[VehicleLookupWorker] Startup error:", error);
      process.exit(1);
    });
}
