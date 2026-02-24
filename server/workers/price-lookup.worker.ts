import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { PriceLookupJobData, SearchFallback } from "../services/price-lookup-queue";
import { getRedisConnectionConfig } from "../services/message-queue";
import { storage } from "../storage";
import type { GearboxType } from "../services/price-sources/types";
import { identifyTransmissionByOem, TransmissionIdentification, VehicleContext } from "../services/transmission-identifier";
import { searchUsedTransmissionPrice } from "../services/price-searcher";
import { renderTemplate, DEFAULT_TEMPLATES } from "../services/template-renderer";
import type { PriceSnapshot, TenantAgentSettings } from "@shared/schema";
import { openai } from "../services/decision-engine";
import { featureFlagService } from "../services/feature-flags";

const QUEUE_NAME = "price_lookup_queue";

// ─── Composite cache key ──────────────────────────────────────────────────────

function buildCacheKey(
  oem: string,
  make?: string | null,
  model?: string | null
): string {
  const parts = [oem.toLowerCase().trim()];
  if (make) parts.push(make.toLowerCase().trim());
  if (model) parts.push(model.toLowerCase().trim());
  return parts.join("::");
}

// ─── Origin translation ───────────────────────────────────────────────────────

const ORIGIN_LABELS: Record<string, string> = {
  japan: "Япония",
  europe: "Европа",
  korea: "Корея",
  usa: "США",
  unknown: "",
};

function translateOrigin(origin: string | null | undefined): string {
  return ORIGIN_LABELS[origin ?? ""] ?? "";
}

function formatMileageRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return "";
  if (min === null) return `до ${max!.toLocaleString("ru-RU")} км`;
  if (max === null) return `от ${min.toLocaleString("ru-RU")} км`;
  return `${min.toLocaleString("ru-RU")} — ${max.toLocaleString("ru-RU")} км`;
}

// ─── WS broadcast helper ──────────────────────────────────────────────────────

function broadcastSuggestion(tenantId: string, conversationId: string, suggestionId: string) {
  import("../services/websocket-server")
    .then(({ realtimeService }) => {
      realtimeService.broadcastNewSuggestion(tenantId, conversationId, suggestionId);
    })
    .catch(() => {
      // Skip broadcast if import fails (worker runs as a separate process)
    });
}

// ─── Payment methods suggestion ───────────────────────────────────────────────

async function maybeCreatePaymentMethodsSuggestion(
  tenantId: string,
  conversationId: string
): Promise<void> {
  try {
    const methods = await storage.getActivePaymentMethods(tenantId);
    if (methods.length === 0) return;

    const lines = methods.map((m) =>
      `• ${m.title}${m.description ? `\n  ${m.description}` : ""}`
    );
    const suggestedReply = `💳 Варианты оплаты:\n\n${lines.join("\n")}`;

    const suggestion = await storage.createAiSuggestion({
      conversationId,
      messageId: null,
      suggestedReply,
      intent: "price",
      confidence: 0.9,
      needsApproval: true,
      needsHandoff: false,
      questionsToAsk: [],
      usedSources: [],
      status: "pending",
      decision: "NEED_APPROVAL",
      autosendEligible: false,
    });

    broadcastSuggestion(tenantId, conversationId, suggestion.id);
    console.log(`[PriceLookupWorker] Created payment methods suggestion ${suggestion.id}`);
  } catch (err: any) {
    console.warn(`[PriceLookupWorker] Failed to create payment methods suggestion: ${err.message}`);
  }
}

// ─── Number formatting helpers ───────────────────────────────────────────────

function formatPrice(value: number): string {
  return value.toLocaleString("ru-RU");
}

function formatNumber(value: number): string {
  return value.toLocaleString("ru-RU");
}

function formatDate(date: Date): string {
  return date.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

// ─── Low-level suggestion record creator ─────────────────────────────────────

async function createSuggestionRecord(
  tenantId: string,
  conversationId: string,
  content: string,
  intent: string = "price",
  confidence: number = 0.8
): Promise<void> {
  const suggestion = await storage.createAiSuggestion({
    conversationId,
    messageId: null,
    suggestedReply: content,
    intent,
    confidence,
    needsApproval: true,
    needsHandoff: false,
    questionsToAsk: [],
    usedSources: [],
    status: "pending",
    decision: "NEED_APPROVAL",
    autosendEligible: false,
  });
  broadcastSuggestion(tenantId, conversationId, suggestion.id);
  console.log(`[PriceLookupWorker] Created ${intent} suggestion ${suggestion.id}`);
}

// ─── Two-step price dialog (price_options → mileage_preference) ───────────────

interface PriceSearchListing {
  price: number;
  mileage: number | null;
}

async function createPriceSuggestions(
  tenantId: string,
  conversationId: string,
  snapshot: PriceSnapshot,
  agentSettings: TenantAgentSettings | null
): Promise<void> {
  const raw = snapshot.raw as { listings?: PriceSearchListing[] } | null;
  const listings: PriceSearchListing[] = raw?.listings ?? [];

  const mileageLow = agentSettings?.mileageLow ?? 60000;
  const mileageMid = agentSettings?.mileageMid ?? 90000;

  const qualityListings = listings.filter(
    (l) => l.mileage !== null && l.mileage <= mileageLow
  );
  const midListings = listings.filter(
    (l) => l.mileage !== null && l.mileage > mileageLow && l.mileage <= mileageMid
  );
  const budgetListings = listings.filter(
    (l) => l.mileage === null || l.mileage > mileageMid
  );

  const hasEnoughForTiers = qualityListings.length > 0 && budgetListings.length > 0;

  if (hasEnoughForTiers) {
    const budgetPrice = Math.min(...budgetListings.map((l) => l.price));
    const budgetMileage = Math.max(
      ...budgetListings.filter((l) => l.mileage !== null).map((l) => l.mileage!)
    );
    const qualityPrice = Math.min(...qualityListings.map((l) => l.price));
    const qualityMileage = Math.min(
      ...qualityListings.filter((l) => l.mileage !== null).map((l) => l.mileage!)
    );

    let midPrice: number;
    let midMileage: number;
    if (midListings.length > 0) {
      midPrice = Math.min(...midListings.map((l) => l.price));
      midMileage = Math.round(
        midListings.reduce((s, l) => s + (l.mileage ?? 0), 0) / midListings.length
      );
    } else {
      midPrice = Math.round((budgetPrice + qualityPrice) / 2);
      midMileage = Math.round((budgetMileage + qualityMileage) / 2);
    }

    const tpl = await storage.getActiveMessageTemplateByType(tenantId, "price_options");
    const defaultPriceOptionsTpl = DEFAULT_TEMPLATES.find((t) => t.type === "price_options");
    const templateContent = tpl?.content ?? defaultPriceOptionsTpl?.content ?? "";

    const content = renderTemplate(templateContent, {
      transmission_model: snapshot.modelName ?? snapshot.oem,
      oem: snapshot.oem,
      manufacturer: snapshot.manufacturer ?? "",
      origin: translateOrigin(snapshot.origin),
      budget_price: formatPrice(budgetPrice),
      budget_mileage: formatNumber(budgetMileage),
      mid_price: formatPrice(midPrice),
      mid_mileage: formatNumber(midMileage),
      quality_price: formatPrice(qualityPrice),
      quality_mileage: formatNumber(qualityMileage),
      listings_count: String(listings.length),
      date: formatDate(new Date()),
    });

    await createSuggestionRecord(tenantId, conversationId, content, "price_options", 0.85);
  } else {
    // Not enough listings for tiers — fall back to single price_result template
    const content = await buildPriceReply({
      tenantId,
      snapshot,
      displayLabel: snapshot.modelName ?? snapshot.oem,
      oem: snapshot.oem,
    });
    await createSuggestionRecord(tenantId, conversationId, content, "price", 0.8);
  }

  // Always create payment methods suggestion
  await maybeCreatePaymentMethodsSuggestion(tenantId, conversationId);
}

// ─── Price reply builder ──────────────────────────────────────────────────────

interface PriceReplyOptions {
  tenantId: string;
  snapshot: PriceSnapshot;
  displayLabel: string;
  oem: string | null;
}

async function buildPriceReply(opts: PriceReplyOptions): Promise<string> {
  const { tenantId, snapshot, displayLabel, oem } = opts;

  const salePrice = snapshot.avgPrice ?? 0;
  const minPrice = snapshot.minPrice ?? salePrice;
  const maxPrice = snapshot.maxPrice ?? salePrice;
  const originLabel = translateOrigin(snapshot.origin);
  const mileageRange = formatMileageRange(snapshot.mileageMin ?? null, snapshot.mileageMax ?? null);

  const updatedAt = snapshot.createdAt;
  const timeStr = updatedAt.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });

  try {
    const tpl = await storage.getActiveMessageTemplateByType(tenantId, "price_result");
    if (tpl) {
      const variables: Record<string, string | number> = {
        transmission_model: snapshot.modelName ?? displayLabel,
        oem: oem ?? displayLabel,
        min_price: minPrice.toLocaleString("ru-RU"),
        max_price: maxPrice.toLocaleString("ru-RU"),
        avg_price: salePrice.toLocaleString("ru-RU"),
        origin: originLabel,
        manufacturer: snapshot.manufacturer ?? "",
        car_brand: "",
        date: timeStr,
        mileage_min: snapshot.mileageMin != null ? snapshot.mileageMin.toLocaleString("ru-RU") : "",
        mileage_max: snapshot.mileageMax != null ? snapshot.mileageMax.toLocaleString("ru-RU") : "",
        mileage_range: mileageRange,
        listings_count: snapshot.listingsCount ?? 0,
      };
      return renderTemplate(tpl.content, variables);
    }
  } catch (err: any) {
    console.warn(`[PriceLookupWorker] Failed to load price_result template: ${err.message}`);
  }

  // Friendly fallback — same voice as OEM paths A/B/C.
  // If displayLabel already contains a gearbox type (e.g. "АКПП AUDI Audi A" or
  // "КПП FAU(5A) AUDI") do NOT prepend another type label; otherwise add "КПП".
  const displayHasType = GEARBOX_TYPE_LABELS.some(
    (t) => displayLabel.toUpperCase().includes(t.toUpperCase())
  );
  const singularPrefix = displayHasType ? "Контрактная" : "Контрактная КПП";
  const pluralPrefix   = displayHasType ? "Контрактные" : "Контрактные КПП";
  let text: string;
  if (minPrice === maxPrice) {
    text =
      `${singularPrefix} ${displayLabel} — ` +
      `цена ${minPrice.toLocaleString("ru-RU")} ₽. ` +
      `Цена зависит от пробега и состояния. Какой бюджет вас интересует?`;
  } else {
    text =
      `${pluralPrefix} ${displayLabel} есть в нескольких вариантах — ` +
      `от ${minPrice.toLocaleString("ru-RU")} до ${maxPrice.toLocaleString("ru-RU")} ₽. ` +
      `Цена зависит от пробега и состояния. Какой бюджет вас интересует?`;
  }
  return text;
}

// ─── Suggestion creator ───────────────────────────────────────────────────────

async function createPriceSuggestion(
  tenantId: string,
  conversationId: string,
  snapshot: PriceSnapshot,
  displayLabel: string,
  oem: string | null
): Promise<void> {
  const suggestedReply = await buildPriceReply({ tenantId, snapshot, displayLabel, oem });

  const suggestion = await storage.createAiSuggestion({
    conversationId,
    messageId: null,
    suggestedReply,
    intent: "price",
    confidence: 0.8,
    needsApproval: true,
    needsHandoff: false,
    questionsToAsk: [],
    usedSources: [],
    status: "pending",
    decision: "NEED_APPROVAL",
    autosendEligible: false,
  });

  broadcastSuggestion(tenantId, conversationId, suggestion.id);
  await maybeCreatePaymentMethodsSuggestion(tenantId, conversationId);
  console.log(`[PriceLookupWorker] Created price suggestion ${suggestion.id}`);
}

// ─── AI price estimate fallback ───────────────────────────────────────────────

interface AiPriceEstimate {
  priceMin: number;
  priceMax: number;
}

async function estimatePriceFromAI(
  oem: string,
  identification: { modelName: string | null; manufacturer: string | null },
  vehicleContext?: VehicleContext,
  gearboxLabel: string = 'АКПП'
): Promise<AiPriceEstimate | null> {
  try {
    // Build a specific transmission descriptor so GPT can price accurately.
    // e.g. "МКПП W5MBB 4WD" is much more specific than just "OEM 2500A230".
    const transmissionDesc = [
      gearboxLabel,
      identification.modelName,
      vehicleContext?.driveType ?? null,
    ].filter(Boolean).join(' ');

    const make  = vehicleContext?.make  ?? null;
    const model = vehicleContext?.model ?? null;
    const year  = vehicleContext?.year  ?? null;

    const driveType = vehicleContext?.driveType ?? null;
    const driveNote = driveType ? `Drive type: ${driveType}\n` : '';

    const prompt =
      `Search the internet RIGHT NOW for current prices of this used transmission in Russia:\n` +
      `Transmission: ${transmissionDesc}\n` +
      `OEM: ${oem}\n` +
      (make || model
        ? `Vehicle: ${make ?? 'unknown'} ${model ?? 'unknown'}${year ? `, ${year}` : ''}\n`
        : '') +
      driveNote +
      `Search ANY Russian auto parts source: avito.ru, drom.ru, farpost.ru, dvsavto.ru,\n` +
      `kor-motor.ru, avtgr.ru, baza.drom.ru, abcp.ru, exist.ru, or any other\n` +
      `Russian автозапчасти website that has б/у or контрактные listings.\n` +
      `Instructions:\n` +
      `- Find the lowest available price for a working б/у or контрактная unit\n` +
      `- Find the highest reasonable price (exclude obviously new or fully rebuilt)\n` +
      `- Return ONLY valid JSON, no markdown, no explanation:\n` +
      `{"priceMin": <lowest found price in RUB rounded to 1000>, "priceMax": <highest reasonable price in RUB rounded to 1000>}\n` +
      `- Use actual listing prices found — do NOT adjust or estimate\n` +
      `- If no listings found, return a conservative range based on similar models\n` +
      `- priceMax must not exceed 3x priceMin`;

    console.log('[PriceLookupWorker] AI estimate prompt:', prompt);

    const response = await (openai as any).responses.create({
      model: "gpt-4.1",
      tools: [{ type: "web_search" }],
      input: prompt,
    });

    const raw: string = response.output_text ?? "";
    const text = raw.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).priceMin === "number" &&
      typeof (parsed as Record<string, unknown>).priceMax === "number"
    ) {
      return {
        priceMin: (parsed as Record<string, number>).priceMin,
        priceMax: (parsed as Record<string, number>).priceMax,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Gearbox type → Russian label ────────────────────────────────────────────

function pickGearboxLabel(gearboxType?: string | null): string {
  if (gearboxType === "MT") return "МКПП";
  if (gearboxType === "CVT") return "вариатор";
  if (gearboxType === "AT") return "АКПП";
  // BUG 4: unknown/null type → neutral label to avoid wrong AT assumption
  return "КПП";
}

// ─── Transmission model validation ───────────────────────────────────────────

// Labels used in customer-facing suggestion text — used to detect when a
// displayName already contains the transmission type so we don't duplicate it
// (e.g. "KIA Sportage АКПП" must not become "Контрактные АКПП KIA Sportage АКПП").
const GEARBOX_TYPE_LABELS = ["АКПП", "МКПП", "вариатор", "CVT", "DSG", "робот", "КПП"];

// BUG 3: These generic type strings must be rejected so GPT identification
// runs and finds the real model name (e.g. JF016E, RE0F11A, W5MBB).
const GEARBOX_TYPE_STRINGS = new Set([
  "CVT", "AT", "MT", "DCT", "AMT",
  "АКПП", "МКПП", "ВАРИАТОР", "АВТОМАТ",
  "AUTO", "MANUAL", "AUTOMATIC",
]);

function isValidTransmissionModel(model: string | null): boolean {
  if (!model) return false;
  if (GEARBOX_TYPE_STRINGS.has(model.toUpperCase())) {
    console.log(`[PriceLookupWorker] oemModelHint '${model}' is a type not a model — running GPT`);
    return false;
  }
  if (model.length > 12) return false;
  // Reject internal catalog codes with 4+ consecutive digits
  // e.g. M3MHD987579 contains "987579" — 6 consecutive digits
  if (/\d{4,}/.test(model)) return false;
  // Accept letter-only (QCE), digit-first (09G), hyphenated (AW55-51SN),
  // parenthesised (QCE(6A)), and standard alphanumeric codes (F4A42, U660E)
  return /^[A-Z0-9][A-Z0-9\-()]{1,11}$/.test(model);
}

// ─── OEM lookup flow (new global cache + AI search) ──────────────────────────

async function lookupPricesByOem(
  tenantId: string,
  oem: string,
  conversationId: string,
  oemModelHint?: string | null,
  vehicleContext?: VehicleContext
): Promise<void> {
  // Load agent settings once — needed for mileage tier thresholds
  const agentSettings = await storage.getTenantAgentSettings(tenantId);

  // Determine correct Russian gearbox term from vehicleContext.gearboxType
  const gearboxLabel = pickGearboxLabel(vehicleContext?.gearboxType);

  // Composite cache key: oem::make::model (lowercase) — prevents cross-vehicle collisions
  const cacheKey = buildCacheKey(oem, vehicleContext?.make, vehicleContext?.model);

  // 1. Check global cache first (any tenant, respects expiresAt)
  const cached = await storage.getGlobalPriceSnapshot(cacheKey);
  if (cached) {
    console.log(
      `[PriceLookupWorker] Using global cached snapshot ${cached.id} for OEM "${oem}" (source: ${cached.source})`
    );
    if (cached.source === "ai_estimate" || cached.source === "openai_web_search" || cached.source === "yandex") {
      const priceMin = cached.minPrice ?? 0;
      const priceMax = cached.maxPrice ?? 0;
      const displayName =
        (cached.modelName ??
        `${vehicleContext?.make ?? ''} ${vehicleContext?.model ?? ''} ${gearboxLabel}`.trim()) ||
        (cached.oem ?? oem);
      const nameHasTypeA = GEARBOX_TYPE_LABELS.some(
        (t) => displayName.toUpperCase().includes(t.toUpperCase())
      );
      const replyPrefixA = nameHasTypeA ? "Контрактные" : `Контрактные ${gearboxLabel}`;
      const suggestedReply =
        `${replyPrefixA} ${displayName} есть в нескольких вариантах — от ${priceMin.toLocaleString("ru-RU")} до ${priceMax.toLocaleString("ru-RU")} ₽. ` +
        `Цена зависит от пробега и состояния. Какой бюджет вас интересует?`;
      const confidence = cached.source === "ai_estimate" ? 0.5 : 0.8;
      await createSuggestionRecord(tenantId, conversationId, suggestedReply, "price", confidence);
      await maybeCreatePaymentMethodsSuggestion(tenantId, conversationId);
    } else {
      await createPriceSuggestions(tenantId, conversationId, cached, agentSettings);
    }
    return;
  }

  // 2. Identify transmission model from OEM.
  // If the vehicle lookup already resolved the model name, skip the GPT call entirely.
  let identification: TransmissionIdentification;
  if (oemModelHint && isValidTransmissionModel(oemModelHint)) {
    identification = {
      modelName: oemModelHint,
      manufacturer: null,
      origin: "unknown",
      confidence: "high",
      notes: "model name supplied by vehicle lookup — GPT identification skipped",
    };
    console.log(`[PriceLookupWorker] Using oemModelHint "${oemModelHint}" for OEM "${oem}" — skipping GPT identification`);
  } else {
    if (oemModelHint && !isValidTransmissionModel(oemModelHint)) {
      console.log(`[VehicleLookupWorker] oemModelHint "${oemModelHint}" rejected as internal code — will use GPT identification`);
    }
    console.log(`[PriceLookupWorker] Identifying transmission for OEM "${oem}"`);
    identification = await identifyTransmissionByOem(oem, vehicleContext);
    console.log(
      `[PriceLookupWorker] Identification: model=${identification.modelName}, ` +
        `mfr=${identification.manufacturer}, origin=${identification.origin}, ` +
        `confidence=${identification.confidence}`
    );
  }

  // Fallback display name if GPT returned an internal catalog code.
  // When the model is unknown, use vehicle description + gearbox type label.
  const vehicleDesc =
    vehicleContext?.make && vehicleContext?.model
      ? `${vehicleContext.make} ${vehicleContext.model}`
      : null;
  const effectiveDisplayName: string | null = isValidTransmissionModel(identification.modelName)
    ? identification.modelName
    : vehicleDesc
      ? `${vehicleDesc} ${gearboxLabel}`
      : null;

  if (!isValidTransmissionModel(identification.modelName) && effectiveDisplayName) {
    console.log(
      `[PriceLookupWorker] modelName "${identification.modelName}" looks like internal code — ` +
        `using display name "${effectiveDisplayName}"`
    );
  }

  // 3. Search real prices (Yandex + Playwright, then GPT web_search as fallback)
  console.log(`[PriceLookupWorker] Searching prices for OEM "${oem}"`);
  const priceData = await searchUsedTransmissionPrice(
    oem,
    identification.modelName,
    identification.origin,
    identification.manufacturer,
    vehicleContext,
    tenantId
  );

  // Do NOT save mock results — only save real search results (including not_found)
  if (
    priceData.source === "yandex" ||
    priceData.source === "openai_web_search" ||
    priceData.source === "not_found"
  ) {
    const isNotFound = priceData.source === "not_found";

    if (isNotFound) {
      // Collect urlsChecked from Yandex stage if available
      const urlsChecked: string[] = Array.isArray((priceData as any).urlsChecked)
        ? (priceData as any).urlsChecked
        : [];

      // STAGE 2: Escalation — structured operator task (replaces AI estimate as primary fallback)
      const escalationEnabled = await featureFlagService.isEnabled("PRICE_ESCALATION_ENABLED", tenantId);
      if (escalationEnabled) {
        await createEscalationSuggestion(
          tenantId,
          conversationId,
          oem,
          identification?.modelName ?? null,
          vehicleContext,
          urlsChecked
        );
        return;
      }

      // Fallback: AI estimate if escalation disabled
      const estimateAllowed = await featureFlagService.isEnabled("AI_PRICE_ESTIMATE_ENABLED", tenantId);
      if (!estimateAllowed) {
        console.log("[PriceLookupWorker] Escalation and AI estimate both disabled, returning not_found");
        await createNotFoundSuggestion(tenantId, conversationId, oem);
        return;
      }
      const aiEstimate = await estimatePriceFromAI(oem, identification, vehicleContext, gearboxLabel);
      if (aiEstimate) {
        const { priceMin, priceMax } = aiEstimate;
        const avgPrice = Math.round((priceMin + priceMax) / 2);
        const displayName = effectiveDisplayName ?? oem;
        const nameHasTypeB = GEARBOX_TYPE_LABELS.some(
          (t) => displayName.toUpperCase().includes(t.toUpperCase())
        );
        const replyPrefixB = nameHasTypeB ? "Контрактные" : `Контрактные ${gearboxLabel}`;
        const suggestedReply =
          `${replyPrefixB} ${displayName} есть в нескольких вариантах — от ${priceMin.toLocaleString("ru-RU")} до ${priceMax.toLocaleString("ru-RU")} ₽. ` +
          `Цена зависит от пробега и состояния. Какой бюджет вас интересует?`;
        const aiSnapshot = await storage.createPriceSnapshot({
          tenantId: null,
          oem,
          source: "ai_estimate",
          minPrice: priceMin,
          maxPrice: priceMax,
          avgPrice,
          currency: "RUB",
          modelName: effectiveDisplayName ?? identification.modelName,
          manufacturer: identification.manufacturer,
          origin: identification.origin,
          expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          raw: { priceMin, priceMax, identification } as any,
          searchKey: cacheKey,
        });
        console.log(`[PriceLookupWorker] AI estimate snapshot ${aiSnapshot.id} for OEM "${oem}" (${priceMin}–${priceMax} RUB)`);
        await createSuggestionRecord(tenantId, conversationId, suggestedReply, "price", 0.5);
        await maybeCreatePaymentMethodsSuggestion(tenantId, conversationId);
        return;
      }
      // AI call failed or returned invalid JSON — fall through to not_found behavior
    }

    // For not_found, use 24h TTL so we don't re-search constantly
    const ttlMs = isNotFound ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);

    // 4. Save to global cache (tenantId = null means global)
    const snapshot = await storage.createPriceSnapshot({
      tenantId: null,
      oem,
      source: priceData.source,
      minPrice: priceData.minPrice,
      maxPrice: priceData.maxPrice,
      avgPrice: priceData.avgPrice,
      currency: "RUB",
      modelName: effectiveDisplayName ?? identification.modelName,
      manufacturer: identification.manufacturer,
      origin: identification.origin,
      mileageMin: priceData.mileageMin,
      mileageMax: priceData.mileageMax,
      listingsCount: priceData.listingsCount,
      searchQuery: priceData.searchQuery,
      expiresAt,
      stage: priceData.source,
      urls: priceData.urlsChecked ?? [],
      domains: Array.from(new Set(priceData.listings.map((l) => l.site).filter(Boolean))),
      raw: { ...priceData, identification } as any,
      searchKey: cacheKey,
    });

    console.log(
      `[PriceLookupWorker] Saved global snapshot ${snapshot.id} ` +
        `(source: ${priceData.source}, expires: ${expiresAt.toISOString()})`
    );

    // 5. Create suggestion using customer-friendly template
    if (snapshot.source === "openai_web_search" || snapshot.source === "yandex") {
      const priceMin = snapshot.minPrice ?? 0;
      const priceMax = snapshot.maxPrice ?? 0;
      const displayName =
        (effectiveDisplayName ??
        `${vehicleContext?.make ?? ''} ${vehicleContext?.model ?? ''} ${gearboxLabel}`.trim()) ||
        oem;
      const nameHasTypeC = GEARBOX_TYPE_LABELS.some(
        (t) => displayName.toUpperCase().includes(t.toUpperCase())
      );
      const replyPrefixC = nameHasTypeC ? "Контрактные" : `Контрактные ${gearboxLabel}`;
      const suggestedReply =
        `${replyPrefixC} ${displayName} есть в нескольких вариантах — от ${priceMin.toLocaleString("ru-RU")} до ${priceMax.toLocaleString("ru-RU")} ₽. ` +
        `Цена зависит от пробега и состояния. Какой бюджет вас интересует?`;
      await createSuggestionRecord(tenantId, conversationId, suggestedReply, "price", 0.8);
      await maybeCreatePaymentMethodsSuggestion(tenantId, conversationId);
    } else {
      await createPriceSuggestions(tenantId, conversationId, snapshot, agentSettings);
    }
  } else {
    // Unexpected source — create a not_found suggestion
    console.warn(`[PriceLookupWorker] Unexpected source: ${(priceData as any).source}`);
    await createNotFoundSuggestion(tenantId, conversationId, oem);
  }
}

// ─── Escalation suggestion (operator manual price search) ────────────────────

async function createEscalationSuggestion(
  tenantId: string,
  conversationId: string,
  oem: string,
  modelName: string | null,
  vehicleContext: VehicleContext | null | undefined,
  urlsChecked: string[]
): Promise<void> {
  const gearboxLabel = vehicleContext?.gearboxType === "MT" ? "МКПП"
    : vehicleContext?.gearboxType === "AT" ? "АКПП"
    : vehicleContext?.gearboxType === "CVT" ? "вариатор"
    : "КПП";

  const make = vehicleContext?.make ?? "";
  const model = vehicleContext?.model ?? "";
  const year = vehicleContext?.year ?? "";
  const engine = vehicleContext?.engine ?? "";
  const driveType = vehicleContext?.driveType ?? "";

  const readyQueries = [
    `купить ${gearboxLabel} ${oem} б/у`,
    `контрактная ${gearboxLabel} ${make} ${model} ${oem}`,
    `${gearboxLabel} ${oem} цена разборка`,
    `used ${gearboxLabel} ${oem} buy`,
    modelName ? `${modelName} transmission ${oem} for sale` : null,
    modelName ? `JDM ${modelName} gearbox ${oem}` : null,
  ].filter(Boolean) as string[];

  const escalationData = {
    type: "manual_price_search",
    needsManualInternational: true,
    reason: `Недостаточно цен в РФ сегменте для OEM ${oem}`,
    searchContext: {
      oem,
      modelName: modelName ?? null,
      vehicleContext: {
        make,
        model,
        year,
        engine,
        driveType,
        gearboxType: vehicleContext?.gearboxType ?? null,
      },
      urlsAlreadyChecked: urlsChecked,
    },
    operatorHints: {
      readyQueries,
      suggestedSites: [
        "baza.drom.ru — поиск по OEM",
        "farpost.ru — особенно для регионов ДВ",
        "japancar.ru — японские КПП",
        "ebay.com — международный поиск",
        "aucfree.com — Yahoo Auctions Japan",
        "jdmbuysell.com — JDM запчасти",
      ],
    },
  };

  const operatorText =
    `🔍 Требуется ручной поиск цены\n` +
    `КПП: ${modelName ?? oem} (OEM: ${oem})\n` +
    `Авто: ${[make, model, year, engine, driveType].filter(Boolean).join(" ")}\n\n` +
    `Готовые запросы для поиска:\n` +
    readyQueries.slice(0, 3).map((q) => `• ${q}`).join("\n") + "\n\n" +
    `Уже проверено (${urlsChecked.length} источников):\n` +
    urlsChecked.slice(0, 5).map((u) => `• ${u}`).join("\n");

  try {
    const suggestion = await storage.createAiSuggestion({
      conversationId,
      messageId: null,
      suggestedReply: operatorText,
      intent: "escalation",
      confidence: 1.0,
      needsApproval: true,
      needsHandoff: false,
      decision: "NEED_APPROVAL",
      escalationData,
      questionsToAsk: [],
      usedSources: [],
      status: "pending",
      autosendEligible: false,
      autosendBlockReason: "manual_price_search_required",
    });
    broadcastSuggestion(tenantId, conversationId, suggestion.id);
    console.log(
      `[PriceLookupWorker] Created escalation suggestion ${suggestion.id} for OEM ${oem}`
    );
  } catch (err) {
    console.error("[PriceLookupWorker] Failed to create escalation suggestion:", err);
  }
}

// ─── Not-found suggestion (when price search yields nothing) ─────────────────

async function createNotFoundSuggestion(
  tenantId: string,
  conversationId: string,
  label: string
): Promise<void> {
  try {
    const tpl = await storage.getActiveMessageTemplateByType(tenantId, "not_found");
    const suggestedReply =
      tpl?.content ??
      `Есть в наличии, уточним стоимость для вас по OEM ${label}. Оставьте контакт — свяжемся в течение часа.`;

    const suggestion = await storage.createAiSuggestion({
      conversationId,
      messageId: null,
      suggestedReply,
      intent: "price",
      confidence: 0.5,
      needsApproval: true,
      needsHandoff: false,
      questionsToAsk: [],
      usedSources: [],
      status: "pending",
      decision: "NEED_APPROVAL",
      autosendEligible: false,
    });

    broadcastSuggestion(tenantId, conversationId, suggestion.id);
    console.log(`[PriceLookupWorker] Created not-found suggestion ${suggestion.id}`);
  } catch (err: any) {
    console.warn(`[PriceLookupWorker] Failed to create not-found suggestion: ${err.message}`);
  }
}

// ─── Fallback flow (no OEM — use make/model/type) ────────────────────────────

interface PriceSettings {
  marginPct?: number;
  roundTo?: number;
  priceNote?: string;
  showMarketPrice?: boolean;
}

function buildFallbackSearchQuery(fallback: SearchFallback): string {
  const parts: string[] = [];
  if (fallback.gearboxModel) parts.push(fallback.gearboxModel);
  if (fallback.make) parts.push(fallback.make);
  if (fallback.model) parts.push(fallback.model);
  return parts.join(" ");
}

function buildFallbackSearchKey(fallback: SearchFallback, isModelOnly: boolean): string {
  if (isModelOnly && fallback.gearboxModel) {
    return `model:${fallback.gearboxModel}`;
  }
  const parts = [
    fallback.gearboxModel ?? "",
    fallback.make ?? "",
    fallback.model ?? "",
    fallback.gearboxType,
  ].filter(Boolean);
  return parts.join("_");
}

async function lookupPricesByFallback(
  tenantId: string,
  conversationId: string,
  searchFallback: SearchFallback,
  isModelOnly: boolean
): Promise<void> {
  const { AvitoSource } = await import("../services/price-sources/avito-source");
  const { DromSource } = await import("../services/price-sources/drom-source");
  const { MockSource } = await import("../services/price-sources/mock-source");

  const searchQuery = buildFallbackSearchQuery(searchFallback);
  const searchKey = buildFallbackSearchKey(searchFallback, isModelOnly);
  const gearboxType: GearboxType | undefined = searchFallback.gearboxType;

  const displayLabel = isModelOnly
    ? `КПП ${searchFallback.gearboxModel} ${searchFallback.make ?? ""} ${searchFallback.model ?? ""}`.trim()
    : `${(searchFallback.gearboxType ?? "").toUpperCase()} ${searchFallback.make ?? ""} ${searchFallback.model ?? ""}`.trim();

  const tenant = await storage.getTenant(tenantId);
  const templates = (tenant?.templates ?? {}) as Record<string, unknown>;
  const priceSettings = (templates.priceSettings ?? {}) as PriceSettings;

  // Check cached fallback snapshot (tenant-scoped, since there's no OEM)
  const existingSnapshot = await storage.getPriceSnapshotsByOem(tenantId, searchKey, 1);
  if (existingSnapshot.length > 0) {
    const cached = existingSnapshot[0];
    console.log(`[PriceLookupWorker] Using cached fallback snapshot ${cached.id}`);
    await createPriceSuggestion(tenantId, conversationId, cached, displayLabel, null);
    return;
  }

  // Try external sources cascade
  const externalSources = [new AvitoSource(), new DromSource()];
  let priceResult = null;

  for (const src of externalSources) {
    try {
      priceResult = await src.fetchPrices(searchQuery, gearboxType);
      if (priceResult) {
        console.log(`[PriceLookupWorker] Fallback: ${src.name} returned ${priceResult.listings.length} listings`);
        break;
      }
    } catch (err: any) {
      console.warn(`[PriceLookupWorker] Fallback source ${src.name}: ${err.message}`);
    }
  }

  // Use mock if all external sources failed (but do NOT save mock to DB)
  if (!priceResult) {
    // Try OpenAI web search before falling back to mock
    const webSearchOem = searchFallback.gearboxModel ?? searchQuery;
    const webSearchModel = searchFallback.gearboxModel ?? null;
    console.log(`[PriceLookupWorker] Fallback: trying OpenAI web search for "${webSearchOem}"`);
    try {
      const webResult = await searchUsedTransmissionPrice(webSearchOem, webSearchModel, "unknown", searchFallback.make);
      if (webResult.source === "openai_web_search") {
        console.log(
          `[PriceLookupWorker] Fallback: OpenAI web search returned ${webResult.listingsCount} listings ` +
            `(${webResult.minPrice}–${webResult.maxPrice} RUB)`
        );
        const marginPct = priceSettings.marginPct ?? -25;
        const roundTo = priceSettings.roundTo ?? 100;
        const salePrice = Math.max(
          Math.round((webResult.avgPrice * (1 + marginPct / 100)) / roundTo) * roundTo,
          0
        );
        const snapshot = await storage.createPriceSnapshot({
          tenantId,
          oem: searchKey,
          source: webResult.source,
          minPrice: webResult.minPrice,
          maxPrice: webResult.maxPrice,
          avgPrice: salePrice,
          marketMinPrice: webResult.minPrice,
          marketMaxPrice: webResult.maxPrice,
          marketAvgPrice: webResult.avgPrice,
          salePrice,
          marginPct,
          searchKey,
          currency: "RUB",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          raw: { ...webResult } as any,
        });
        await createPriceSuggestion(tenantId, conversationId, snapshot, displayLabel, null);
        return;
      }
      console.log(
        `[PriceLookupWorker] Fallback: OpenAI web search returned not_found for "${webSearchOem}", falling back to mock`
      );
    } catch (err: any) {
      console.warn(`[PriceLookupWorker] Fallback: OpenAI web search error: ${err.message}`);
    }

    console.log(`[PriceLookupWorker] Fallback: all sources exhausted, using mock (not saved)`);
    const mockResult = await new MockSource().fetchPrices(searchQuery, gearboxType);
    const marginPct = priceSettings.marginPct ?? -25;
    const roundTo = priceSettings.roundTo ?? 100;
    const salePrice = Math.max(
      Math.round((mockResult.avgPrice * (1 + marginPct / 100)) / roundTo) * roundTo,
      0
    );

    // Create suggestion from mock (not saved to DB)
    const updatedAt = new Date();
    const timeStr = updatedAt.toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
    const suggestedReply =
      `Найдены варианты ${displayLabel}: ${salePrice.toLocaleString("ru-RU")} ₽\n` +
      (isModelOnly ? "" : `⚠️ Без точного OEM — цена приблизительная.\n`) +
      `Обновлено: ${timeStr}.`;

    const suggestion = await storage.createAiSuggestion({
      conversationId,
      messageId: null,
      suggestedReply,
      intent: "price",
      confidence: isModelOnly ? 0.7 : 0.5,
      needsApproval: true,
      needsHandoff: false,
      questionsToAsk: [],
      usedSources: [],
      status: "pending",
      decision: "NEED_APPROVAL",
      autosendEligible: false,
    });

    broadcastSuggestion(tenantId, conversationId, suggestion.id);
    await maybeCreatePaymentMethodsSuggestion(tenantId, conversationId);
    return;
  }

  // Save real fallback result to tenant-scoped snapshot (not global — no OEM)
  const marginPct = priceSettings.marginPct ?? -25;
  const roundTo = priceSettings.roundTo ?? 100;
  const salePrice = Math.max(
    Math.round((priceResult.avgPrice * (1 + marginPct / 100)) / roundTo) * roundTo,
    0
  );

  const snapshot = await storage.createPriceSnapshot({
    tenantId,
    oem: searchKey,
    source: priceResult.source,
    minPrice: salePrice,
    maxPrice: salePrice,
    avgPrice: salePrice,
    marketMinPrice: priceResult.minPrice,
    marketMaxPrice: priceResult.maxPrice,
    marketAvgPrice: priceResult.avgPrice,
    salePrice,
    marginPct,
    searchKey,
    currency: "RUB",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    raw: priceResult.listings as any,
  });

  await createPriceSuggestion(tenantId, conversationId, snapshot, displayLabel, null);
}

// ─── Main processor ───────────────────────────────────────────────────────────

async function processPriceLookup(job: Job<PriceLookupJobData>): Promise<void> {
  const { tenantId, conversationId, oem, oemModelHint, vehicleContext, searchFallback, isModelOnly } = job.data;

  console.log(`[PriceLookupWorker] oemModelHint received: ${oemModelHint ?? "none"}`);

  if (oem) {
    // New flow: global cache + AI identification + OpenAI web search
    console.log(`[PriceLookupWorker] OEM mode for "${oem}", conversation ${conversationId}`);
    await lookupPricesByOem(tenantId, oem, conversationId, oemModelHint ?? null, vehicleContext);
  } else if (searchFallback) {
    // Fallback flow: no OEM, use make/model/gearboxType
    const mode = isModelOnly ? "MODEL_ONLY" : "FALLBACK";
    console.log(`[PriceLookupWorker] ${mode} mode, conversation ${conversationId}`);
    await lookupPricesByFallback(tenantId, conversationId, searchFallback, !!isModelOnly);
  } else {
    console.warn(`[PriceLookupWorker] Job ${job.id} has neither oem nor searchFallback — skipping`);
  }
}

// ─── Worker factory ───────────────────────────────────────────────────────────

export function createPriceLookupWorker(connectionConfig: IORedis): Worker<PriceLookupJobData> {
  const worker = new Worker<PriceLookupJobData>(
    QUEUE_NAME,
    async (job) => {
      await processPriceLookup(job);
    },
    {
      connection: connectionConfig,
      concurrency: 1,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[PriceLookupWorker] Job completed: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[PriceLookupWorker] Job failed: ${job?.id}`, error?.message);
  });

  worker.on("error", (error) => {
    console.error("[PriceLookupWorker] Worker error:", error);
  });

  console.log(`[PriceLookupWorker] Worker started for queue: ${QUEUE_NAME}`);
  return worker;
}

export async function startPriceLookupWorker(): Promise<Worker<PriceLookupJobData> | null> {
  const config = getRedisConnectionConfig();
  if (!config) {
    console.warn("[PriceLookupWorker] REDIS_URL not configured, worker not started");
    return null;
  }

  try {
    return createPriceLookupWorker(config);
  } catch (error) {
    console.error("[PriceLookupWorker] Failed to start worker:", error);
    return null;
  }
}

const isMain = process.argv[1]?.includes("price-lookup.worker");
if (isMain) {
  startPriceLookupWorker()
    .then((worker) => {
      if (worker) {
        console.log("[PriceLookupWorker] Process running...");
        process.on("SIGTERM", async () => {
          console.log("[PriceLookupWorker] Shutting down...");
          await worker.close();
          process.exit(0);
        });
      } else {
        console.error("[PriceLookupWorker] Failed to start worker");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("[PriceLookupWorker] Startup error:", error);
      process.exit(1);
    });
}
