import OpenAI from "openai";
import { storage } from "../storage";
import { featureFlagService } from "./feature-flags";
import { sanitizeString } from "../utils/sanitizer";
import { retrieveContext, formatContextForPrompt, type RetrievalResult, type RetrievedChunk } from "./rag-retrieval";
import { selectFewShotExamples, buildFewShotPromptBlock, type FewShotConfig } from "./few-shot-builder";
import {
  type DecisionSettings,
  type DecisionType,
  type IntentType,
  type Penalty,
  type ConfidenceBreakdown,
  type UsedSource,
  type SuggestionResponse,
  type Product,
  type KnowledgeDoc,
  type Tenant,
  type CustomerMemory,
  type TenantAgentSettings,
  type VehicleLookupCase,
  type PriceSnapshot,
  PENALTY_CODES,
  INTENT_TYPES,
  VEHICLE_LOOKUP_INTENTS,
} from "@shared/schema";

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "sk-placeholder",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
});

// Generic fallback system prompt — used when the tenant has not configured
// a custom system prompt in their agent settings.
export const DEFAULT_SYSTEM_PROMPT = `Вы — профессиональный менеджер по продажам, помогающий клиентам с их запросами.

ВАЖНЫЕ ПРАВИЛА:
1. НИКОГДА не придумывайте цены, наличие или сроки доставки. Используйте только факты из предоставленного контекста.
2. Если информации нет, задавайте уточняющие вопросы.
3. Отвечайте кратко и по существу.
4. При вопросах о скидках и жалобах — переключайте на оператора.`;

// Builds the "identity + company facts + scripts" part of the system prompt.
// CONTEXT, customer memory, few-shot examples, and JSON format instructions
// are appended separately in generateWithDecisionEngine().
function buildSystemPrompt(
  tenant: Tenant,
  agentSettings: TenantAgentSettings | null,
  autoPartsEnabled = false,
): string {
  const base = agentSettings?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  const facts: string[] = [];
  const name = agentSettings?.companyName ?? tenant.name;
  if (name) facts.push(`- Название: ${name}`);
  if (agentSettings?.specialization)
    facts.push(`- Специализация: ${agentSettings.specialization}`);
  if (agentSettings?.warehouseCity)
    facts.push(`- Город склада: ${agentSettings.warehouseCity}`);
  if (agentSettings?.warrantyMonths && agentSettings?.warrantyKm)
    facts.push(`- Гарантия: ${agentSettings.warrantyMonths} мес. / ${agentSettings.warrantyKm} км`);
  if (agentSettings?.installDays)
    facts.push(`- Срок на установку после получения: ${agentSettings.installDays} дней`);
  if (agentSettings?.qrDiscountPercent)
    facts.push(`- Скидка при оплате QR/СБП: ${agentSettings.qrDiscountPercent}%`);

  const factsBlock = facts.length > 0
    ? "ДАННЫЕ КОМПАНИИ:\n" + facts.join("\n")
    : "";

  const scripts: string[] = [];
  if (agentSettings?.objectionPayment)
    scripts.push(`Ответ на "оплата при получении":\n${agentSettings.objectionPayment}`);
  if (agentSettings?.objectionOnline)
    scripts.push(`Ответ на "онлайн платёж опасен":\n${agentSettings.objectionOnline}`);
  if (agentSettings?.closingScript)
    scripts.push(`Скрипт закрытия сделки:\n${agentSettings.closingScript}`);

  const scriptsBlock = scripts.length > 0
    ? "СКРИПТЫ ОТВЕТОВ:\n" + scripts.join("\n\n")
    : "";

  const customFactsRaw = agentSettings?.customFacts as Record<string, string> | null | undefined;
  const customFactsBlock =
    customFactsRaw && Object.keys(customFactsRaw).length > 0
      ? "ДОПОЛНИТЕЛЬНЫЕ ФАКТЫ О КОМПАНИИ:\n" +
        Object.entries(customFactsRaw)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")
      : "";

  const autoPartsBlock = autoPartsEnabled
    ? `ПРАВИЛА ИДЕНТИФИКАЦИИ АВТОМОБИЛЯ:
- Если клиент прислал фото — отвечай естественно, никогда не упоминай технические процессы
- Если в истории разговора есть [Client attached a photo] — интент gearbox_tag_request, НЕ vehicle_id_request
- Маркировка КПП (2-14 символов, буквы+цифры, напр. A245E, K9K, 01M, DQ250) — достаточна для поиска, ВИН не нужен
- Если маркировка не распознана — попроси марку/модель/год, а НЕ ВИН
- Запрашивай ВИН ТОЛЬКО если нет ни ВИН, ни рамы, ни маркировки КПП, ни фото
- Общайся как опытный менеджер автозапчастей — кратко, профессионально, без технического жаргона
- Никогда не раскрывай, что ты ИИ или что система автоматически обрабатывает данные`
    : "";

  return [base, factsBlock, scriptsBlock, customFactsBlock, autoPartsBlock].filter(Boolean).join("\n\n");
}

const CONFIDENCE_WEIGHTS = {
  similarity: 0.45,
  intent: 0.25,
  selfCheck: 0.30,
};

const DEFAULT_SETTINGS: DecisionSettings = {
  tenantId: "",
  tAuto: 0.80,
  tEscalate: 0.40,
  autosendAllowed: false,
  intentsAutosendAllowed: ["price", "availability", "shipping", "other"],
  intentsForceHandoff: [
    "discount",
    "complaint",
    "photo_request",     // always escalate — needs warehouse photo
    "needs_manual_quote",// always escalate — no price found
    "want_visit",        // always escalate — needs warehouse address
  ],
  updatedAt: new Date(),
};

export interface GenerationContext {
  conversationId: string;
  tenantId: string;
  tenant: Tenant;
  customerMessage: string;
  conversationHistory: { role: "user" | "assistant"; content: string }[];
  products: Product[];
  docs: KnowledgeDoc[];
  customerMemory?: CustomerMemory | null;
}

const TOPIC_LABELS: Record<string, string> = {
  price: "Цена",
  availability: "Наличие",
  shipping: "Доставка",
  return: "Возврат",
  discount: "Скидки",
  complaint: "Жалобы",
  other: "Прочее",
  photo_request: "Запрос фото",
  price_objection: "Возражение по цене",
  ready_to_buy: "Готов купить",
  needs_manual_quote: "Ручной расчёт",
  invalid_vin: "Неверный ВИН",
  marking_provided: "Маркировка агрегата",
  payment_blocked: "Блокировка платежа",
  warranty_question: "Вопрос о гарантии",
  want_visit: "Хочет приехать",
  what_included: "Что в комплекте",
  mileage_preference: "Выбор по пробегу/цене",
};

// Intent classification guide appended to every system prompt.
// Surgical update: new intents added below existing ones — do not reorder existing entries.
const INTENT_GUIDE = `КЛАССИФИКАЦИЯ ИНТЕНТОВ (выбирайте наиболее точный):

Базовые интенты:
- price            — клиент спрашивает цену товара
- availability     — клиент спрашивает о наличии
- shipping         — вопросы о доставке, сроках, транспортных компаниях
- return           — вопросы о возврате товара
- discount         — клиент просит скидку
- complaint        — жалоба или претензия
- other            — любые другие вопросы

Интенты поиска транспортного средства:
- vehicle_id_request  — клиент не дал ВИН/РАМУ/маркировку/фото. Попроси: ВИН (17 символов), номер кузова (рама), или маркировку с шильдика КПП (фото или текст). Спрашивай один раз, естественно.
- gearbox_tag_request — клиент прислал фото шильдика КПП. Ответь естественно, как опытный менеджер запчастей: подтверди, что смотришь фото. НЕ проси ВИН повторно.
- gearbox_tag_retry   — предыдущее фото шильдика было нечитаемым. Попроси переснять при хорошем освещении, шильдик должен быть в фокусе.

Новые интенты:
- photo_request       — клиент просит фото или видео товара (ВСЕГДА ESCALATE)
- price_objection     — "дорого", "видел дешевле", возражение по цене
- ready_to_buy        — "оформляем", "беру", "как заказать", запрос реквизитов, готов к оплате
- needs_manual_quote  — цена не найдена в системе, нужен ручной расчёт (ВСЕГДА ESCALATE)
- invalid_vin         — ВИН не соответствует формату (не 17 символов, или содержит И/О/Q). Попроси корректный 17-значный ВИН или фото шильдика КПП.
- marking_provided    — клиент дал маркировку КПП или OEM-код текстом (напр. A245E, K9K, 01M). Подтверди и сообщи, что уточняешь наличие. Если маркировка не распознана — попроси марку/модель/год, НЕ ВИН.
- payment_blocked     — банк заблокировал платёж клиента
- warranty_question   — вопрос об условиях гарантии
- want_visit          — клиент хочет приехать на склад лично (ВСЕГДА ESCALATE)
- what_included       — вопрос о комплектации ("ЭБУ", "навесное", "гидротрансформатор", "с косой")
- mileage_preference  — клиент выбирает вариант по цене или пробегу. Триггеры: "дешевле", "поменьше пробег", "эконом", "оптимум", "лучший вариант", "бюджет", ответ на вопрос о выборе варианта. Действие: NEED_APPROVAL — агент предлагает конкретный вариант.`;

export function buildCustomerContextBlock(memory: CustomerMemory | null | undefined): string | null {
  if (!memory) return null;
  
  const parts: string[] = [];
  
  const prefs = memory.preferences as Record<string, string> | null;
  if (prefs && Object.keys(prefs).length > 0) {
    const prefLines: string[] = [];
    if (prefs.city) prefLines.push(`- Город: ${sanitizeString(prefs.city)}`);
    if (prefs.delivery) prefLines.push(`- Предпочтительная доставка: ${sanitizeString(prefs.delivery)}`);
    if (prefs.payment) prefLines.push(`- Предпочтительная оплата: ${sanitizeString(prefs.payment)}`);
    if (prefLines.length > 0) {
      parts.push("Предпочтения клиента:\n" + prefLines.join("\n"));
    }
  }
  
  if (memory.lastSummaryText) {
    parts.push(`Краткое резюме: ${sanitizeString(memory.lastSummaryText)}`);
  }
  
  const topics = memory.frequentTopics as Record<string, number> | null;
  if (topics && Object.keys(topics).length > 0) {
    const sorted = Object.entries(topics)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([topic, count]) => `${TOPIC_LABELS[topic] || topic} (${count}x)`);
    if (sorted.length > 0) {
      parts.push("Частые темы запросов: " + sorted.join(", "));
    }
  }
  
  if (parts.length === 0) return null;
  
  return "CUSTOMER CONTEXT (use as hints, do not override KB/Products facts):\n" + parts.join("\n");
}

export interface DecisionResult {
  replyText: string;
  intent: string | null; // IntentType | VehicleLookupIntentType
  confidence: ConfidenceBreakdown;
  decision: DecisionType;
  explanations: string[];
  penalties: Penalty[];
  missingFields: string[];
  usedSources: UsedSource[];
  needsApproval: boolean;
  needsHandoff: boolean;
  // Triple lock autosend fields
  autosendEligible: boolean;
  autosendBlockReason?: "FLAG_OFF" | "SETTING_OFF" | "INTENT_NOT_ALLOWED";
  // Self-check handoff info
  selfCheckNeedHandoff: boolean;
  selfCheckReasons: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const STALE_DATA_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const LOW_SIMILARITY_THRESHOLD = 0.5;

function convertRetrievalToSources(retrieval: RetrievalResult): {
  sources: UsedSource[];
  conflicts: boolean;
  hasStaleData: boolean;
  maxSimilarity: number;
} {
  const sources: UsedSource[] = [];
  const prices: number[] = [];
  let hasStaleData = false;
  const now = Date.now();

  for (const chunk of retrieval.productChunks) {
    const metadata = chunk.metadata as Record<string, unknown>;
    sources.push({
      type: "product",
      id: chunk.sourceId,
      title: (metadata.productName as string) || (metadata.sku as string) || "Товар",
      quote: chunk.chunkText.slice(0, 200),
      similarity: chunk.similarity,
    });
    if (metadata.chunkType === "price" && typeof metadata.price === "number") {
      prices.push(metadata.price);
    }
    
    if (metadata.priceVersion && typeof metadata.priceVersion === "number") {
      const age = now - metadata.priceVersion;
      if (age > STALE_DATA_THRESHOLD_MS) {
        hasStaleData = true;
      }
    }
  }

  for (const chunk of retrieval.docChunks) {
    const metadata = chunk.metadata as Record<string, unknown>;
    sources.push({
      type: "doc",
      id: chunk.sourceId,
      title: (metadata.docTitle as string) || (metadata.category as string) || "Документ",
      quote: chunk.chunkText.slice(0, 200),
      similarity: chunk.similarity,
    });
  }

  const conflicts = prices.length > 1 && new Set(prices).size > 1;
  const maxSimilarity = sources.length > 0 
    ? Math.max(...sources.map(s => s.similarity || 0)) 
    : 0;

  return { sources, conflicts, hasStaleData, maxSimilarity };
}

function calculateSimilarityScoreFromRetrieval(retrieval: RetrievalResult): {
  score: number;
  sources: UsedSource[];
  conflicts: boolean;
  hasStaleData: boolean;
  lowSimilarity: boolean;
} {
  const { sources, conflicts, hasStaleData, maxSimilarity } = convertRetrievalToSources(retrieval);
  
  if (sources.length === 0) {
    return { score: 0, sources: [], conflicts: false, hasStaleData: false, lowSimilarity: true };
  }

  const lowSimilarity = maxSimilarity < LOW_SIMILARITY_THRESHOLD;
  return { score: maxSimilarity, sources, conflicts, hasStaleData, lowSimilarity };
}

function calculateSimilarityScoreFallback(products: Product[], docs: KnowledgeDoc[]): {
  score: number;
  sources: UsedSource[];
  conflicts: boolean;
} {
  const sources: UsedSource[] = [];
  const prices: number[] = [];

  for (const p of products.slice(0, 3)) {
    sources.push({
      type: "product",
      id: p.id,
      title: p.name,
      quote: `${p.name}: ${p.price} ${p.currency}`,
      similarity: 0.85 + Math.random() * 0.10,
    });
    if (p.price) prices.push(p.price);
  }

  for (const d of docs.slice(0, 3)) {
    sources.push({
      type: "doc",
      id: d.id,
      title: d.title,
      quote: d.content.slice(0, 100) + "...",
      similarity: 0.80 + Math.random() * 0.15,
    });
  }

  if (sources.length === 0) {
    return { score: 0, sources: [], conflicts: false };
  }

  const maxSimilarity = Math.max(...sources.map(s => s.similarity || 0));
  const conflicts = prices.length > 1 && new Set(prices).size > 1;

  return { score: maxSimilarity, sources, conflicts };
}

function detectMissingFields(
  intent: string | null,
  products: Product[],
  docs: KnowledgeDoc[]
): string[] {
  const missing: string[] = [];

  if (intent === "price" || intent === "availability") {
    const hasPrice = products.some(p => p.price !== null && p.price !== undefined);
    if (!hasPrice) missing.push("price");

    const hasStock = products.some(p => p.inStock !== null && p.inStock !== undefined);
    if (!hasStock) missing.push("availability");
  }

  if (intent === "shipping") {
    const hasDelivery = docs.some(d => d.category === "shipping") || 
                        products.some(p => p.deliveryInfo);
    if (!hasDelivery) missing.push("delivery_terms");
  }

  return missing;
}

interface PenaltyContext {
  intent: string | null;
  sources: UsedSource[];
  conflicts: boolean;
  hasStaleData: boolean;
  lowSimilarity: boolean;
  missingFields: string[];
  selfCheckScore: number;
  settings: DecisionSettings;
}

function applyPenalties(ctx: PenaltyContext): { penalties: Penalty[]; forceEscalate: boolean } {
  const { intent, sources, conflicts, hasStaleData, lowSimilarity, missingFields, selfCheckScore, settings } = ctx;
  const penalties: Penalty[] = [];
  let forceEscalate = false;

  const intentsForceHandoff = (settings.intentsForceHandoff || []) as string[];
  if (intent && intentsForceHandoff.includes(intent)) {
    penalties.push(PENALTY_CODES.INTENT_FORCE_HANDOFF);
    forceEscalate = true;
  }

  if (sources.length === 0) {
    penalties.push(PENALTY_CODES.NO_SOURCES);
  }

  if (missingFields.includes("price") && intent === "price") {
    penalties.push(PENALTY_CODES.PRICE_NOT_FOUND);
  }

  if (missingFields.includes("availability") && intent === "availability") {
    penalties.push(PENALTY_CODES.AVAILABILITY_NOT_FOUND);
  }

  if (conflicts) {
    penalties.push(PENALTY_CODES.CONFLICTING_SOURCES);
  }

  if (hasStaleData) {
    penalties.push(PENALTY_CODES.STALE_DATA);
    forceEscalate = true;
  }

  if (lowSimilarity && sources.length > 0) {
    penalties.push(PENALTY_CODES.LOW_SIMILARITY);
  }

  if (selfCheckScore < 0.5) {
    penalties.push(PENALTY_CODES.SELF_CHECK_LOW);
  }

  return { penalties, forceEscalate };
}

function calculateFinalConfidence(
  similarityScore: number,
  intentScore: number,
  selfCheckScore: number,
  penalties: Penalty[]
): ConfidenceBreakdown {
  const penaltySum = penalties.reduce((sum, p) => sum + Math.abs(p.value), 0);
  
  const raw = CONFIDENCE_WEIGHTS.similarity * similarityScore +
              CONFIDENCE_WEIGHTS.intent * intentScore +
              CONFIDENCE_WEIGHTS.selfCheck * selfCheckScore;
  
  const total = clamp(raw - penaltySum, 0, 1);

  return {
    total,
    similarity: similarityScore,
    intent: intentScore,
    selfCheck: selfCheckScore,
  };
}

function makeDecision(
  confidence: number,
  forceEscalate: boolean,
  settings: DecisionSettings
): DecisionType {
  if (forceEscalate) {
    return "ESCALATE";
  }

  if (confidence >= settings.tAuto) {
    return "AUTO_SEND";
  }

  if (confidence >= settings.tEscalate) {
    return "NEED_APPROVAL";
  }

  return "ESCALATE";
}

function generateExplanations(
  decision: DecisionType,
  confidence: ConfidenceBreakdown,
  penalties: Penalty[],
  intent: string | null,
  sources: UsedSource[],
  settings: DecisionSettings
): string[] {
  const explanations: string[] = [];

  if (sources.length > 0 && confidence.similarity > 0.7) {
    explanations.push("Высокая схожесть с документами базы знаний");
  }

  for (const penalty of penalties) {
    explanations.push(penalty.message);
  }

  if (decision === "AUTO_SEND") {
    explanations.push(`Уверенность ${(confidence.total * 100).toFixed(0)}% выше порога автоотправки`);
  } else if (decision === "NEED_APPROVAL") {
    explanations.push(`Уверенность ${(confidence.total * 100).toFixed(0)}% требует проверки оператором`);
  } else if (decision === "ESCALATE") {
    explanations.push(`Уверенность ${(confidence.total * 100).toFixed(0)}% ниже порога — передача оператору`);
  }

  return explanations;
}

interface SelfCheckResult {
  score: number;
  needHandoff: boolean;
  reasons: string[];
  missingFields: string[];
}

async function performSelfCheck(
  customerMessage: string,
  draftReply: string,
  sources: UsedSource[],
  tenant: Tenant
): Promise<SelfCheckResult> {
  try {
    const sourcesContext = sources.slice(0, 3).map(s => 
      `[${s.type}] ${s.title}: ${s.quote}`
    ).join("\n");

    const prompt = `You are a quality checker for customer support responses.

Customer question: "${customerMessage}"
Draft response: "${draftReply}"
Sources used:
${sourcesContext || "No sources"}

Evaluate the draft response and return JSON:
{
  "self_check_score": 0.0-1.0 (how confident you are this is a good response),
  "need_handoff": true|false (should this go to a human?),
  "reasons": ["reason1", "reason2"] (reasons for your score or handoff decision),
  "missing_fields": ["price", "availability"] (if any critical info is missing)
}

Rules:
- Score LOW if the response makes up information not in sources
- Score LOW if critical data (price, availability, delivery) is missing from sources but mentioned in response
- Score HIGH if response accurately uses source information
- need_handoff=true if the question requires human judgment (discounts, complaints, special requests)`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_completion_tokens: 256,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return {
      score: clamp(parsed.self_check_score || 0.6, 0, 1),
      needHandoff: parsed.need_handoff ?? false,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
      missingFields: parsed.missing_fields || [],
    };
  } catch (error) {
    console.error("Self-check failed:", error);
    return { score: 0.6, needHandoff: false, reasons: [], missingFields: [] };
  }
}

export async function generateWithDecisionEngine(
  context: GenerationContext
): Promise<DecisionResult> {
  const settings = await storage.getDecisionSettings(context.tenantId) || DEFAULT_SETTINGS;
  const agentSettings = await storage.getTenantAgentSettings(context.tenantId);
  
  const decisionEngineEnabled = await featureFlagService.isEnabled("DECISION_ENGINE_ENABLED", context.tenantId);
  const autosendEnabled = await featureFlagService.isEnabled("AI_AUTOSEND_ENABLED", context.tenantId);
  const ragEnabled = await featureFlagService.isEnabled("RAG_ENABLED", context.tenantId);
  const autoPartsEnabled = await featureFlagService.isEnabled("AUTO_PARTS_ENABLED", context.tenantId);

  let ragResult: RetrievalResult | null = null;
  let contextParts: string[] = [];

  // Inject fresh price snapshot if available for this conversation
  let priceSnapshotBlock: string | null = null;
  try {
    // Get the latest vehicle lookup case for this conversation
    const latestCase = await storage.getLatestVehicleLookupCase(
      context.conversationId
    );
    if (latestCase?.normalizedValue) {
      // Try to find a fresh price snapshot using the OEM from the case
      // The case stores the VIN/FRAME — we need to find associated OEM
      // Look in price_snapshots by conversation context
      const recentSnapshot = await storage.getLatestPriceSnapshotForConversation(
        context.tenantId,
        context.conversationId
      );
      if (recentSnapshot && recentSnapshot.minPrice && recentSnapshot.maxPrice) {
        const freshness = recentSnapshot.createdAt
          ? Math.round(
              (Date.now() - new Date(recentSnapshot.createdAt).getTime())
              / 1000 / 60
            )
          : null;
        priceSnapshotBlock = [
          "АКТУАЛЬНЫЕ ЦЕНЫ (только что найдены системой):",
          `Модель КПП: ${recentSnapshot.modelName ?? recentSnapshot.oem}`,
          `Диапазон цен: ${recentSnapshot.minPrice.toLocaleString("ru-RU")} — ${recentSnapshot.maxPrice.toLocaleString("ru-RU")} ₽`,
          recentSnapshot.avgPrice
            ? `Средняя цена: ${recentSnapshot.avgPrice.toLocaleString("ru-RU")} ₽`
            : null,
          recentSnapshot.listingsCount
            ? `Найдено объявлений: ${recentSnapshot.listingsCount}`
            : null,
          freshness !== null
            ? `Данные получены: ${freshness} мин. назад`
            : null,
          "ВАЖНО: Используй ТОЛЬКО эти цены в своём ответе. Игнорируй любые другие цены из контекста.",
        ]
          .filter(Boolean)
          .join("\n");
      }
    }
  } catch (err) {
    console.warn("[DecisionEngine] Price snapshot injection failed:", err);
  }

  if (priceSnapshotBlock) {
    contextParts.unshift(priceSnapshotBlock); // inject FIRST, highest priority
  }

  if (ragEnabled) {
    try {
      ragResult = await retrieveContext(context.customerMessage, {
        tenantId: context.tenantId,
      });
      
      if (ragResult.chunks.length > 0) {
        const ragContext = formatContextForPrompt(ragResult);
        if (ragContext) {
          contextParts.push(ragContext);
        }
      }
    } catch (error) {
      console.warn("[Decision Engine] RAG retrieval failed, using fallback:", error);
      ragResult = null;
    }
  }

  if (!ragResult || ragResult.chunks.length === 0) {
    if (context.products.length > 0) {
      contextParts.push("Products:\n" + context.products.map((p) => 
        `- ${p.name}: ${p.price} ${p.currency}, ${p.inStock ? "in stock" : "out of stock"}`
      ).join("\n"));
    }
    if (context.docs.length > 0) {
      contextParts.push("Knowledge Base:\n" + context.docs.map((d) => 
        `- ${d.title}: ${d.content.slice(0, 200)}`
      ).join("\n"));
    }
  }

  const customerContextBlock = buildCustomerContextBlock(context.customerMemory);

  let fewShotBlock = "";
  try {
    // Derive a preferredIntent hint from the customer's most frequent topic so the
    // +0.5 relevance boost in scoreExample fires for topic-matching examples.
    // Falls back to undefined for first-time customers (no history yet).
    const frequentTopics = context.customerMemory?.frequentTopics as Record<string, number> | null | undefined;
    const preferredIntent = frequentTopics && Object.keys(frequentTopics).length > 0
      ? Object.entries(frequentTopics).sort(([, a], [, b]) => b - a)[0][0]
      : undefined;

    const fewShotConfig: Partial<FewShotConfig> = {
      maxExamples: 5,
      maxTokens: 1500,
      minConfidence: 0.7,
      preferredIntent,
    };
    const examples = await selectFewShotExamples(context.tenantId, fewShotConfig);
    if (examples.length > 0) {
      const { promptBlock } = buildFewShotPromptBlock(examples, fewShotConfig.maxTokens || 1500);
      fewShotBlock = promptBlock;
    }
  } catch (error) {
    console.warn("[Decision Engine] Few-shot learning failed, continuing without examples:", error);
  }

  const basePrompt = buildSystemPrompt(context.tenant, agentSettings, autoPartsEnabled);

  const systemPrompt = [
    basePrompt,
    `Стиль общения: ${context.tenant.tone === "formal" ? "формальный, вежливый" : "дружелюбный, неформальный"}, обращение: "${context.tenant.addressStyle === "vy" ? "Вы" : "ты"}", язык: ${context.tenant.language}.`,
    `Скидки: ${context.tenant.allowDiscounts ? `Вы можете предложить скидку до ${context.tenant.maxDiscountPercent}%.` : "Вежливо объясните, что скидки не предусмотрены."}`,
    contextParts.length > 0 ? "CONTEXT:\n" + contextParts.join("\n\n") : "No specific product/knowledge context available.",
    customerContextBlock ?? "",
    fewShotBlock ?? "",
    INTENT_GUIDE,
    `Respond ONLY with a JSON object in this exact format:
{
  "reply_text": "Your response to the customer",
  "intent": "price|availability|shipping|return|discount|complaint|other|vehicle_id_request|gearbox_tag_request|gearbox_tag_retry|photo_request|price_objection|ready_to_buy|needs_manual_quote|invalid_vin|marking_provided|payment_blocked|warranty_question|want_visit|what_included|mileage_preference",
  "intent_probability": 0.0-1.0,
  "questions_to_ask": ["optional questions if info is missing"]
}`,
  ].filter(Boolean).join("\n\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      ...context.conversationHistory,
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 1024,
  });

  const responseContent = response.choices[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(responseContent);
  } catch {
    parsed = {
      reply_text: "Прошу прощения, не удалось сформировать ответ. Пожалуйста, попробуйте еще раз.",
      intent: "other",
      intent_probability: 0.5,
      questions_to_ask: [],
    };
  }

  const intent: string = INTENT_TYPES.includes(parsed.intent)
    ? (parsed.intent as IntentType)
    : (VEHICLE_LOOKUP_INTENTS.includes(parsed.intent as any) ? parsed.intent : "other");
  const intentScore = clamp(parsed.intent_probability || 0.6, 0, 1);

  let similarityScore: number;
  let sources: UsedSource[];
  let conflicts: boolean;
  let hasStaleData = false;
  let lowSimilarity = false;

  if (ragResult && ragResult.chunks.length > 0) {
    const ragScores = calculateSimilarityScoreFromRetrieval(ragResult);
    similarityScore = ragScores.score;
    sources = ragScores.sources;
    conflicts = ragScores.conflicts;
    hasStaleData = ragScores.hasStaleData;
    lowSimilarity = ragScores.lowSimilarity;
  } else {
    const fallbackScores = calculateSimilarityScoreFallback(context.products, context.docs);
    similarityScore = fallbackScores.score;
    sources = fallbackScores.sources;
    conflicts = fallbackScores.conflicts;
  }

  const selfCheckResult = await performSelfCheck(context.customerMessage, parsed.reply_text, sources, context.tenant);
  const { score: selfCheckScore, needHandoff: selfCheckNeedHandoff, reasons: selfCheckReasons, missingFields: selfCheckMissing } = selfCheckResult;

  const detectedMissing = detectMissingFields(intent, context.products, context.docs);
  const allMissingFields = Array.from(new Set([...detectedMissing, ...selfCheckMissing]));

  const { penalties, forceEscalate } = applyPenalties({
    intent,
    sources,
    conflicts,
    hasStaleData,
    lowSimilarity,
    missingFields: allMissingFields,
    selfCheckScore,
    settings,
  });

  const confidence = calculateFinalConfidence(similarityScore, intentScore, selfCheckScore, penalties);

  let decision: DecisionType;
  let autosendEligible = false;
  let autosendBlockReason: "FLAG_OFF" | "SETTING_OFF" | "INTENT_NOT_ALLOWED" | undefined;
  let policyBlockedIntent: string | null = null;

  if (!decisionEngineEnabled) {
    // Kill switch: decision engine disabled, always need approval
    decision = "NEED_APPROVAL";
    autosendEligible = false;
  } else {
    decision = makeDecision(confidence.total, forceEscalate || selfCheckNeedHandoff, settings);

    // Check training policy: alwaysEscalateIntents prevents AUTO_SEND
    const trainingPolicy = await storage.getAiTrainingPolicy(context.tenantId);
    if (trainingPolicy?.alwaysEscalateIntents && 
        intent && 
        trainingPolicy.alwaysEscalateIntents.includes(intent) && 
        decision === "AUTO_SEND") {
      decision = "NEED_APPROVAL";
      policyBlockedIntent = intent;
    }

    // Use shared function for triple lock autosend eligibility
    const autosendCheck = checkAutosendEligibility(decision, intent, autosendEnabled, settings);
    autosendEligible = autosendCheck.eligible;
    autosendBlockReason = autosendCheck.blockReason;

    // Vehicle lookup intents: allow autosend only when self-check does not require handoff
    if (autosendEligible && intent && VEHICLE_LOOKUP_INTENTS.includes(intent as any) && selfCheckNeedHandoff) {
      autosendEligible = false;
    }

    // Guardrail: never autosend vehicle-lookup intents if reply contains price/offer
    if (autosendEligible && intent && VEHICLE_LOOKUP_INTENTS.includes(intent as any) && replyContainsPriceOrOffer(parsed.reply_text)) {
      autosendEligible = false;
    }
  }

  const explanations = generateExplanations(decision, confidence, penalties, intent, sources, settings);

  // Add policy block explanation
  if (policyBlockedIntent) {
    explanations.unshift(`Интент "${policyBlockedIntent}" настроен для обязательной проверки оператором`);
  }

  // Add self-check reasons to explanations if handoff needed
  if (selfCheckNeedHandoff && selfCheckReasons.length > 0) {
    explanations.push(`Self-check: ${selfCheckReasons.join("; ")}`);
  }

  // Add autosend block reason to explanations
  if (decision === "AUTO_SEND" && !autosendEligible && autosendBlockReason) {
    const blockMessages: Record<string, string> = {
      FLAG_OFF: "Автоотправка отключена глобально (feature flag)",
      SETTING_OFF: "Автоотправка отключена в настройках",
      INTENT_NOT_ALLOWED: `Интент "${intent}" не разрешён для автоотправки`,
    };
    explanations.unshift(`Рекомендуется автоответ, но: ${blockMessages[autosendBlockReason]}`);
  }

  return {
    replyText: parsed.reply_text,
    intent,
    confidence,
    decision,
    explanations,
    penalties,
    missingFields: allMissingFields,
    usedSources: sources,
    needsApproval: decision !== "AUTO_SEND" || !autosendEligible,
    needsHandoff: decision === "ESCALATE",
    autosendEligible,
    autosendBlockReason,
    selfCheckNeedHandoff,
    selfCheckReasons,
  };
}

export const decisionEngine = {
  generateWithDecisionEngine,
  DEFAULT_SETTINGS,
};

// Named export for easier imports
export { DEFAULT_SETTINGS };

// Export helper functions for unit testing
// These are internal functions that should be tested directly
export const _testing = {
  calculateFinalConfidence,
  makeDecision,
  applyPenalties,
  detectMissingFields,
  generateExplanations,
  CONFIDENCE_WEIGHTS,
  checkAutosendEligibility,
  replyContainsPriceOrOffer,
  convertRetrievalToSources,
  STALE_DATA_THRESHOLD_MS,
  LOW_SIMILARITY_THRESHOLD,
};

// Guardrail: block autosend for vehicle-lookup intents when reply looks like price/offer
function replyContainsPriceOrOffer(replyText: string): boolean {
  const lower = replyText.toLowerCase().trim();
  const priceWords = ["цена", "стоимость", "стоит", "руб", "рублей", "₽", "eur", "usd", "€", "$", "скидк", "%"];
  if (priceWords.some((w) => lower.includes(w))) return true;
  // Numbers that look like prices (e.g. 15 000, 15000, 1.500)
  if (/\d[\d\s.,]*\s*(руб|р\.|eur|usd|€|\$|₽)/i.test(replyText)) return true;
  if (/\d+%/.test(replyText)) return true;
  return false;
}

// Internal function for autosend eligibility check - used by both production and tests
function checkAutosendEligibility(
  decision: DecisionType,
  intent: string | null,
  autosendFeatureFlag: boolean,
  settings: DecisionSettings
): { eligible: boolean; blockReason?: "FLAG_OFF" | "SETTING_OFF" | "INTENT_NOT_ALLOWED" } {
  if (decision !== "AUTO_SEND") {
    return { eligible: false };
  }
  if (!autosendFeatureFlag) {
    return { eligible: false, blockReason: "FLAG_OFF" };
  }
  if (!settings.autosendAllowed) {
    return { eligible: false, blockReason: "SETTING_OFF" };
  }
  const intentsAllowed = (settings.intentsAutosendAllowed || []) as string[];
  if (intent && !intentsAllowed.includes(intent)) {
    return { eligible: false, blockReason: "INTENT_NOT_ALLOWED" };
  }
  return { eligible: true };
}
