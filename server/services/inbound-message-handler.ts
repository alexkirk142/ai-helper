import { storage } from "../storage";
import type { ParsedIncomingMessage } from "./channel-adapter";
import { getMergedGearboxTemplates, fillGearboxTemplate } from "./gearbox-templates";
import { realtimeService } from "./websocket-server";
import { featureFlagService } from "./feature-flags";
import {
  extractCandidatesFromText,
  extractCandidatesFromOcr,
  chooseBestCandidate,
  maskCandidateValue,
  type OcrAnalysisResult,
} from "./detection/candidate-detector";
import { incr } from "./observability/metrics";

// ─────────────────────────────────────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────────────────────────────────────

export type VehicleIdDetection =
  | { idType: "VIN"; rawValue: string; normalizedValue: string }
  | { idType: "VIN"; rawValue: string; normalizedValue: string; isIncompleteVin: true }
  | { idType: "FRAME"; rawValue: string; normalizedValue: string };

// ─────────────────────────────────────────────────────────────────────────────
// Exported legacy functions (signatures unchanged — callers must not break)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect a gearbox OEM marking from plain text when no VIN/FRAME was found.
 * Returns the first plausible marking or null.
 *
 * Internally delegates to the new candidate-based pipeline so that Cyrillic
 * homoglyph normalisation and strong/weak classification are applied
 * consistently, while preserving the original string | null return contract.
 *
 * Patterns covered:
 *   Japanese:  A245E, U150E, JF010E, RE4F04A, U660E
 *   European:  01M, 09G, DQ250, 0AM, NAG1, 6HP19
 *   Korean:    A6MF1, M11, 6T40, A8TR1
 *   With suffix: A245E-02A, RE4F04A-B41
 */
export function detectGearboxMarkingFromText(text: string): string | null {
  if (!text || text.trim().length < 2) return null;

  // Use the full candidate extraction so Cyrillic normalisation is applied.
  // Only consider strong codes standalone; weak codes require context — which
  // matches the intent of the old function (it used the same strong patterns).
  const cands = extractCandidatesFromText(text).filter(
    (c) =>
      (c.type === "TRANSMISSION_CODE" || c.type === "OCR_TRANSMISSION_CODE") &&
      c.score >= 0.55, // weak+context (0.55) or strong (0.70+) accepted here
  );

  if (cands.length === 0) return null;
  cands.sort((a, b) => b.score - a.score);
  return cands[0].value;
}

/**
 * Detect a VIN or FRAME number from plain text.
 *
 * Internally delegates to the new candidate-based pipeline while preserving
 * the original VehicleIdDetection | null return type.
 */
export function detectVehicleIdFromText(text: string): VehicleIdDetection | null {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed.length) return null;

  const cands = extractCandidatesFromText(trimmed);
  const vinFrameCands = cands.filter(
    (c) =>
      c.type === "VIN" || c.type === "FRAME",
  );

  if (vinFrameCands.length === 0) return null;

  // Sort: highest score first, VIN before FRAME on tie
  vinFrameCands.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 0.01) return diff;
    if (a.type === "VIN" && b.type !== "VIN") return -1;
    if (b.type === "VIN" && a.type !== "VIN") return 1;
    return 0;
  });

  const best = vinFrameCands[0];

  if (best.meta?.isIncompleteVin) {
    return {
      idType: "VIN",
      rawValue: best.raw,
      normalizedValue: best.value,
      isIncompleteVin: true,
    };
  }

  return {
    idType: best.type === "VIN" ? "VIN" : "FRAME",
    rawValue: best.raw,
    normalizedValue: best.value,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// handleIncomingMessage — unchanged
// ─────────────────────────────────────────────────────────────────────────────

const INCOMPLETE_VIN_REPLY =
  "Похоже VIN содержит 16 символов. Проверьте, пожалуйста — обычно VIN состоит из 17 символов. Пришлите полный VIN или номер кузова (FRAME).";

export async function handleIncomingMessage(
  tenantId: string,
  parsed: ParsedIncomingMessage
): Promise<{ conversationId: string; messageId: string; isNew: boolean }> {
  const tenant = await storage.getTenant(tenantId) || await storage.getDefaultTenant();
  if (!tenant) {
    throw new Error("Tenant not found");
  }

  let customer = await storage.getCustomerByExternalId(tenant.id, parsed.channel, parsed.externalUserId);

  if (!customer) {
    const customerName = (parsed.metadata?.pushName as string) ||
                         (parsed.metadata?.firstName as string) ||
                         (parsed.metadata?.contactName as string) ||
                         `User ${parsed.externalUserId.slice(-4)}`;

    const isLid = parsed.metadata?.isLid === true;
    const remoteJid = (parsed.metadata?.remoteJid as string) || parsed.externalConversationId;
    const customerPhone = (parsed.metadata?.phone as string) || "";

    customer = await storage.createCustomer({
      tenantId: tenant.id,
      channel: parsed.channel,
      externalId: parsed.externalUserId,
      name: customerName,
      phone: customerPhone,
      metadata: { remoteJid },
    }, tenant.id);
    console.log(`[InboundHandler] Created new customer: ${customer.id} for ${parsed.channel}:${parsed.externalUserId}${isLid ? " (LID contact)" : ""}`);
  }

  const allConversations = await storage.getConversationsByTenant(tenant.id);
  const existingConv = allConversations.find(c =>
    c.customerId === customer!.id &&
    (c.status === "active" || c.status === "pending")
  );
  let isNew = false;
  let conversationId: string;
  let unreadCount: number;

  if (existingConv) {
    conversationId = existingConv.id;
    unreadCount = existingConv.unreadCount || 0;
  } else {
    isNew = true;
    const messageTime = parsed.timestamp ? new Date(parsed.timestamp) : new Date();
    const newConv = await storage.createConversation({
      tenantId: tenant.id,
      customerId: customer.id,
      status: "active",
      mode: "learning",
      unreadCount: 1,
      lastMessageAt: messageTime,
      createdAt: messageTime,
    }, tenant.id);
    conversationId = newConv.id;
    unreadCount = 0;
    console.log(`[InboundHandler] Created new conversation: ${newConv.id}`);
  }

  const existingMessages = await storage.getMessagesByConversation(conversationId, tenant.id);
  const existingMessage = existingMessages.find(m =>
    m.metadata && (m.metadata as any).externalId === parsed.externalMessageId
  );

  if (existingMessage) {
    console.log(`[InboundHandler] Duplicate message ignored: ${parsed.externalMessageId}`);
    return { conversationId, messageId: existingMessage.id, isNew: false };
  }

  const message = await storage.createMessage({
    conversationId,
    role: "customer",
    content: parsed.text,
    attachments: parsed.attachments ?? [],
    metadata: {
      externalId: parsed.externalMessageId,
      channel: parsed.channel,
      ...(parsed.forwardedFrom && { forwardedFrom: parsed.forwardedFrom }),
      ...parsed.metadata,
    },
    createdAt: parsed.timestamp ? new Date(parsed.timestamp) : undefined,
  }, tenant.id);

  console.log(`[InboundHandler] Saved message ${message.id} to conversation ${conversationId}`);

  await storage.updateConversation(conversationId, tenant.id, {
    unreadCount: unreadCount + 1,
  });

  realtimeService.broadcastNewMessage(tenant.id, message, conversationId);

  if (isNew) {
    const conversationWithCustomer = await storage.getConversationWithCustomer(conversationId, tenant.id);
    if (conversationWithCustomer) {
      realtimeService.broadcastNewConversation(tenant.id, conversationWithCustomer);
    }
  } else {
    realtimeService.broadcastConversationUpdate(tenant.id, {
      id: conversationId,
      unreadCount: unreadCount + 1,
    });
  }

  return { conversationId, messageId: message.id, isNew };
}

// ─────────────────────────────────────────────────────────────────────────────
// triggerAiSuggestion — unchanged
// ─────────────────────────────────────────────────────────────────────────────

export async function triggerAiSuggestion(conversationId: string, tenantId: string): Promise<void> {
  try {
    const conversation = await storage.getConversationDetail(conversationId, tenantId);
    if (!conversation) {
      console.warn(`[InboundHandler] Conversation not found for AI: ${conversationId}`);
      return;
    }

    const tenant = await storage.getTenant(conversation.tenantId) || await storage.getDefaultTenant();
    if (!tenant) {
      console.warn(`[InboundHandler] Tenant not found for AI suggestion`);
      return;
    }

    const lastCustomerMessage = conversation.messages
      .filter((m) => m.role === "customer")
      .pop();

    if (!lastCustomerMessage) {
      console.warn(`[InboundHandler] No customer message found for AI`);
      return;
    }

    const pendingSuggestion = await storage.getPendingSuggestionByConversation(conversationId, tenantId);
    if (pendingSuggestion) {
      console.log(`[InboundHandler] Already has pending suggestion for ${conversationId}`);
      return;
    }

    const relevantDocs = await storage.searchKnowledgeDocs(tenant.id, lastCustomerMessage.content);
    const relevantProducts = await storage.searchProducts(tenant.id, lastCustomerMessage.content);

    const customerMemory = await storage.getCustomerMemory(tenant.id, conversation.customer.id);

    const conversationHistory = conversation.messages.slice(-6).map((m) => ({
      role: (m.role === "customer" ? "user" : "assistant") as "user" | "assistant",
      content:
        m.content +
        (m.role === "customer" &&
        Array.isArray(m.attachments) &&
        (m.attachments as unknown[]).length > 0
          ? "\n[Client attached a photo]"
          : ""),
    }));

    const { generateWithDecisionEngine } = await import("./decision-engine");
    const decisionResult = await generateWithDecisionEngine({
      conversationId,
      tenantId: tenant.id,
      tenant,
      customerMessage: lastCustomerMessage.content,
      conversationHistory,
      products: relevantProducts,
      docs: relevantDocs,
      customerMemory,
    });

    const suggestion = await storage.createAiSuggestion({
      conversationId,
      messageId: lastCustomerMessage.id,
      suggestedReply: decisionResult.replyText,
      intent: decisionResult.intent,
      confidence: decisionResult.confidence.total,
      needsApproval: decisionResult.needsApproval,
      needsHandoff: decisionResult.needsHandoff,
      questionsToAsk: [],
      usedSources: decisionResult.usedSources,
      status: "pending",
      similarityScore: decisionResult.confidence.similarity,
      intentScore: decisionResult.confidence.intent,
      selfCheckScore: decisionResult.confidence.selfCheck,
      decision: decisionResult.decision,
      explanations: decisionResult.explanations,
      penalties: decisionResult.penalties,
      sourceConflicts: decisionResult.usedSources.length > 0,
    }, tenantId);

    console.log(`[InboundHandler] Created AI suggestion ${suggestion.id} with decision: ${decisionResult.decision}`);

    realtimeService.broadcastNewSuggestion(tenant.id, conversationId, suggestion.id);

    if (decisionResult.intent && decisionResult.intent !== "other") {
      try {
        await storage.incrementFrequentTopic(tenant.id, conversation.customer.id, decisionResult.intent);
        console.log(`[InboundHandler] Incremented topic "${decisionResult.intent}" for customer ${conversation.customer.id}`);
      } catch (error) {
        console.error(`[InboundHandler] Failed to increment topic:`, error);
      }
    }

    try {
      const { shouldTriggerSummaryByMessageCount, generateCustomerSummary } = await import("./customer-summary-service");
      const shouldTrigger = await shouldTriggerSummaryByMessageCount(tenant.id, conversation.customer.id);
      if (shouldTrigger) {
        generateCustomerSummary(tenant.id, conversation.customer.id, "message_count").catch(err => {
          console.error("[InboundHandler] Summary generation failed:", err);
        });
      }
    } catch (error) {
      console.error("[InboundHandler] Summary trigger check failed:", error);
    }

    if (decisionResult.decision === "AUTO_SEND") {
      console.log(`[InboundHandler] AUTO_SEND triggered for conversation ${conversationId}`);
    }
  } catch (error) {
    console.error(`[InboundHandler] AI suggestion error:`, error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers for processIncomingMessageFull
// ─────────────────────────────────────────────────────────────────────────────

/** Build a human-readable clarification message for detected conflicts. */
function buildConflictClarificationText(conflicts: string[]): string {
  for (const conflict of conflicts) {
    if (conflict.startsWith("multiple_vin:")) {
      const vins = conflict.replace("multiple_vin:", "").split("|");
      const listed = vins.map((v) => `*${v}*`).join(" и ");
      return (
        `Нашёл несколько VIN-кодов в вашем сообщении: ${listed}. ` +
        `Уточните, пожалуйста, какой из них относится к вашему автомобилю.`
      );
    }
    if (conflict.startsWith("multiple_frame:")) {
      const frames = conflict.replace("multiple_frame:", "").split("|");
      const listed = frames.map((f) => `*${f}*`).join(" и ");
      return (
        `Нашёл несколько номеров кузова: ${listed}. ` +
        `Уточните, пожалуйста, какой из них относится к вашему автомобилю.`
      );
    }
  }
  return "Найдено несколько вариантов. Уточните, пожалуйста, VIN или номер кузова вашего автомобиля.";
}

/** Build a clarification message for a medium-confidence transmission code. */
function buildWeakCodeClarificationText(code: string): string {
  return (
    `Похоже на маркировку КПП: *${code}*. ` +
    `Это обозначение коробки передач? Для точного подбора пришлите VIN или номер кузова (FRAME) — ` +
    `или сделайте чёткое фото таблички КПП без бликов.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// processIncomingMessageFull — Step 2 candidate pipeline
// ─────────────────────────────────────────────────────────────────────────────

export async function processIncomingMessageFull(
  tenantId: string,
  parsed: ParsedIncomingMessage
): Promise<void> {
  try {
    const result = await handleIncomingMessage(tenantId, parsed);
    const text = (parsed.text || "").trim();

    const conversation = await storage.getConversation(result.conversationId, tenantId);
    if (conversation?.isMuted) {
      console.log(`[InboundHandler] Conversation ${result.conversationId} is muted — skipping AI suggestion`);
      return;
    }

    const autoPartsEnabled = await featureFlagService.isEnabled("AUTO_PARTS_ENABLED", tenantId);

    if (!autoPartsEnabled) {
      await triggerAiSuggestion(result.conversationId, tenantId);
      return;
    }

    // ── 1. Extract candidates from text ─────────────────────────────────────
    let allCandidates = extractCandidatesFromText(text);

    // ── 2. Extract candidates from images ───────────────────────────────────
    // Run OCR when:
    //   a) there is no text at all (pure image message), OR
    //   b) text is present but yielded no strong VIN/FRAME/TC candidate —
    //      covers the common case where a customer writes a description AND
    //      attaches a photo of the registration doc or gearbox plate.
    const hasStrongTextCandidate = allCandidates.some(
      (c) =>
        ((c.type === "VIN" || c.type === "FRAME") && c.score >= 0.80) ||
        ((c.type === "TRANSMISSION_CODE") && c.score >= 0.55),
    );

    let imageAnalysisType: "gearbox_tag" | "registration_doc" | null = null;
    let ocrQualityGateFailed = false;

    if (!hasStrongTextCandidate) {
      const imageAttachments = (parsed.attachments ?? []).filter(
        (a) => a.type === "image" && a.url
      );

      if (imageAttachments.length > 0) {
        const { analyzeImages, extractVinFromImages, logSafeUrl } = await import("./vin-ocr.service");
        const safeUrls = imageAttachments.map((a) => logSafeUrl(a.url ?? ""));
        console.log(`[InboundHandler] No text — classifying ${imageAttachments.length} image(s): ${safeUrls.join(", ")}`);

        // Resolve Telegram media proxy paths to base64 data URLs
        const resolvedAttachments = await Promise.all(
          imageAttachments.map(async (att) => {
            const url = att.url ?? "";
            const match = url.match(/^\/api\/telegram-personal\/media\/([^/]+)\/([^/]+)\/(\d+)$/);
            if (!match) return att;
            const [, accountId, chatId, msgId] = match;
            try {
              const { telegramClientManager } = await import("./telegram-client-manager");
              const client = telegramClientManager.getClientForAccount(tenantId, accountId);
              if (!client) {
                console.warn(`[InboundHandler] No TG client for accountId=${accountId}, skipping image download`);
                return att;
              }
              const messages = await client.getMessages(BigInt(chatId), { ids: [parseInt(msgId, 10)] });
              const msg = messages?.[0];
              if (!msg) return att;
              const buffer = await client.downloadMedia(msg, {}) as Buffer | undefined;
              if (!buffer || buffer.length === 0) return att;
              const mimeType = att.mimeType ?? "image/jpeg";
              const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
              console.log(`[InboundHandler] Resolved TG media → data URL (${buffer.length} bytes)`);
              return { ...att, url: dataUrl };
            } catch (dlErr: any) {
              console.warn(`[InboundHandler] Failed to download TG media for OCR: ${dlErr.message}`);
              return att;
            }
          })
        );

        const imageResult = await analyzeImages(resolvedAttachments).catch(
          () => ({ type: "unknown" as const })
        );

        if (imageResult.type === "gearbox_tag" || imageResult.type === "registration_doc") {
          imageAnalysisType = imageResult.type;
        }

        // Build OcrAnalysisResult interface from analyzeImages return value
        const ocrInput: OcrAnalysisResult = {
          type: imageResult.type,
          code: (imageResult as any).code,
          vin: (imageResult as any).vin,
          frame: (imageResult as any).frame,
        };

        // Read per-tenant flag before extracting so the detector stays pure.
        const allow4CharGearboxTag = await featureFlagService.isEnabled(
          "GEARBOX_TAG_MINLEN_4",
          tenantId,
        );

        // 4-char gearbox_tag metrics (emitted before extraction, no PII in tags).
        const rawOcrCode = (imageResult as any).code as string | undefined;
        const is4CharGearboxCode =
          imageResult.type === "gearbox_tag" &&
          typeof rawOcrCode === "string" &&
          rawOcrCode.length === 4;
        if (is4CharGearboxCode) {
          incr("detector.gearbox_tag_4char_seen");
        }

        const ocrCandidates = extractCandidatesFromOcr(ocrInput, {
          allowGearboxTagMinLen4: allow4CharGearboxTag,
        });

        // Post-extraction 4-char metrics: allowed/rejected + score bucket.
        if (is4CharGearboxCode) {
          const allowed = ocrCandidates.length > 0;
          incr("detector.gearbox_tag_4char_allowed", { allowed: allowed ? "true" : "false" });
          if (allowed) {
            const s = ocrCandidates[0].score;
            const bucket = s >= 0.70 ? "ge070" : s >= 0.55 ? "055_069" : "lt055";
            incr("detector.gearbox_tag_4char_score_bucket", { bucket });
          }
        }

        // Detect quality gate failure: gearbox_tag returned a code but it failed
        // the OCR quality checks (no candidates produced).
        if (
          imageResult.type === "gearbox_tag" &&
          (imageResult as any).code &&
          ocrCandidates.length === 0
        ) {
          ocrQualityGateFailed = true;
          console.log(`[InboundHandler] OCR quality gate failed for gearbox_tag code: "${(imageResult as any).code}" — will ask for clearer photo`);
        }

        allCandidates = [...allCandidates, ...ocrCandidates];

        // Fallback: plain VIN extraction for images not classified as gearbox_tag/registration_doc
        if (imageResult.type === "unknown" && ocrCandidates.length === 0) {
          const vinFromImage = await extractVinFromImages(resolvedAttachments).catch(() => null);
          if (vinFromImage) {
            console.log(`[InboundHandler] VIN extracted via image OCR fallback: ${vinFromImage}`);
            const fallbackOcr: OcrAnalysisResult = {
              type: "registration_doc",
              vin: vinFromImage,
            };
            const fallbackCands = extractCandidatesFromOcr(fallbackOcr);
            allCandidates = [...allCandidates, ...fallbackCands];
          }
        }
      }
    }

    // ── 3. Choose best candidate ─────────────────────────────────────────────
    const { best, alternates, conflicts } = chooseBestCandidate(allCandidates);

    // ── 3a. Detection outcome metrics ────────────────────────────────────────
    incr("detector.candidates_total", { count: allCandidates.length });
    if (best) {
      const scoreBucket =
        best.score >= 0.8 ? ">=0.8" : best.score >= 0.55 ? "0.55-0.79" : "<0.55";
      incr("detector.best", { type: best.type, source: best.source, score_bucket: scoreBucket });
    }

    // ── 4. Structured detection log (debug) ──────────────────────────────────
    const logCandidates = allCandidates.map((c) => ({
      type: c.type,
      value: maskCandidateValue(c),
      score: c.score.toFixed(2),
      reasons: c.reasons,
      source: c.source,
    }));
    console.log(
      `[InboundHandler] Detection candidates (${allCandidates.length}):`,
      JSON.stringify(logCandidates),
    );
    if (best) {
      console.log(
        `[InboundHandler] Best candidate: type=${best.type} value=${maskCandidateValue(best)} score=${best.score.toFixed(2)} reasons=${best.reasons.join(",")}`,
      );
    } else {
      console.log(`[InboundHandler] No candidate found`);
    }
    if (conflicts?.length) {
      console.log(`[InboundHandler] Conflicts detected: ${conflicts.join(", ")}`);
    }

    // ── 5. Handle OCR quality gate failure ───────────────────────────────────
    if (ocrQualityGateFailed && !best) {
      incr("detector.ocr_rejected");
      const tenant = await storage.getTenant(tenantId) ?? await storage.getDefaultTenant();
      if (tenant) {
        const suggestion = await storage.createAiSuggestion({
          conversationId: result.conversationId,
          messageId: result.messageId,
          suggestedReply:
            "Не удалось распознать маркировку КПП на фото. Пожалуйста, пришлите чёткое фото таблички — " +
            "без бликов, с хорошим освещением, плёнка/табличка целиком в кадре.",
          intent: "gearbox_tag_request",
          confidence: 1,
          needsApproval: true,
          needsHandoff: false,
          questionsToAsk: [],
          usedSources: [],
          status: "pending",
        }, tenant.id);
        realtimeService.broadcastNewSuggestion(tenant.id, result.conversationId, suggestion.id);
        console.log(`[InboundHandler] OCR quality gate — requested clearer photo for ${result.conversationId}`);
      }
      return;
    }

    // ── 6. Incomplete VIN ────────────────────────────────────────────────────
    if (best?.meta?.isIncompleteVin) {
      incr("detector.incomplete_vin");
      const tenant = await storage.getTenant(tenantId) ?? await storage.getDefaultTenant();
      if (tenant) {
        const suggestion = await storage.createAiSuggestion({
          conversationId: result.conversationId,
          messageId: result.messageId,
          suggestedReply: INCOMPLETE_VIN_REPLY,
          intent: "vehicle_id_request",
          confidence: 1,
          needsApproval: true,
          needsHandoff: false,
          questionsToAsk: [],
          usedSources: [],
          status: "pending",
        }, tenantId);
        realtimeService.broadcastNewSuggestion(tenant.id, result.conversationId, suggestion.id);
        console.log(`[InboundHandler] Incomplete VIN — created vehicle_id_request suggestion for ${result.conversationId}`);
      }
      return;
    }

    // ── 7. Conflict clarification ────────────────────────────────────────────
    if (conflicts?.length) {
      for (const conflict of conflicts) {
        const conflictKind = conflict.startsWith("multiple_vin:") ? "multiple_vin"
          : conflict.startsWith("multiple_frame:") ? "multiple_frame"
          : "unknown";
        incr("detector.conflict", { kind: conflictKind });
      }
      const tenant = await storage.getTenant(tenantId) ?? await storage.getDefaultTenant();
      if (tenant) {
        const replyText = buildConflictClarificationText(conflicts);
        const suggestion = await storage.createAiSuggestion({
          conversationId: result.conversationId,
          messageId: result.messageId,
          suggestedReply: replyText,
          intent: "vehicle_id_request",
          confidence: 0.9,
          needsApproval: true,
          needsHandoff: false,
          questionsToAsk: [],
          usedSources: [],
          status: "pending",
          decision: "NEED_APPROVAL",
          autosendEligible: false,
        }, tenant.id);
        realtimeService.broadcastNewSuggestion(tenant.id, result.conversationId, suggestion.id);
        console.log(`[InboundHandler] Conflict clarification created for ${result.conversationId}: ${conflicts.join(", ")}`);
      }
      return;
    }

    // ── 8. VIN / FRAME path (score >= 0.80) ─────────────────────────────────
    if (
      best &&
      (best.type === "VIN" || best.type === "FRAME" ||
       best.type === "OCR_VIN" || best.type === "OCR_FRAME") &&
      best.score >= 0.80
    ) {
      const idType: "VIN" | "FRAME" =
        best.type === "VIN" || best.type === "OCR_VIN" ? "VIN" : "FRAME";

      const activeCase = await storage.findActiveVehicleLookupCase(
        tenantId, result.conversationId, best.value,
      );

      if (activeCase) {
        console.log("[InboundHandler] Skipped duplicate vehicle lookup case");
      } else {
        const row = await storage.createVehicleLookupCase({
          tenantId,
          conversationId: result.conversationId,
          messageId: result.messageId,
          idType,
          rawValue: best.raw,
          normalizedValue: best.value,
          status: "PENDING",
          verificationStatus: "NONE",
        }, tenantId);

        incr("detector.route_vehicle_lookup", { idType });
        const { enqueueVehicleLookup } = await import("./vehicle-lookup-queue");
        await enqueueVehicleLookup({
          caseId: row.id,
          tenantId,
          conversationId: result.conversationId,
          idType,
          normalizedValue: best.value,
        });
        console.log(
          `[InboundHandler] Vehicle ID (${idType} score=${best.score.toFixed(2)}) — case ${row.id} enqueued`,
        );

        // Skip gearboxTagRequest if we already created a registration_doc suggestion
        if (imageAnalysisType !== "registration_doc") {
          const tenant = await storage.getTenant(tenantId) ?? await storage.getDefaultTenant();
          if (tenant) {
            const templates = getMergedGearboxTemplates(tenant);
            const idTypeLabel = idType === "VIN" ? "VIN-коду" : "номеру кузова";
            const suggestion = await storage.createAiSuggestion({
              conversationId: result.conversationId,
              messageId: result.messageId,
              suggestedReply: fillGearboxTemplate(templates.gearboxTagRequest, { idType: idTypeLabel }),
              intent: "gearbox_tag_request",
              confidence: 1,
              needsApproval: true,
              needsHandoff: false,
              questionsToAsk: [],
              usedSources: [],
              status: "pending",
            }, tenant.id);
            realtimeService.broadcastNewSuggestion(tenant.id, result.conversationId, suggestion.id);
            console.log(`[InboundHandler] Created gearbox_tag_request suggestion for case ${row.id}`);
          }
        }

        // Create registration_doc acknowledgement suggestion
        if (imageAnalysisType === "registration_doc") {
          const tenant = await storage.getTenant(tenantId) ?? await storage.getDefaultTenant();
          if (tenant) {
            const labelRu = idType === "VIN" ? "VIN" : "номер кузова";
            const suggestion = await storage.createAiSuggestion({
              conversationId: result.conversationId,
              messageId: result.messageId,
              suggestedReply: `Вижу свидетельство о регистрации. Нашёл ${labelRu}: ${best.value}. Начинаю подбор КПП.`,
              intent: "gearbox_tag_request",
              confidence: 1,
              needsApproval: true,
              needsHandoff: false,
              questionsToAsk: [],
              usedSources: [],
              status: "pending",
            }, tenant.id);
            realtimeService.broadcastNewSuggestion(tenant.id, result.conversationId, suggestion.id);
            console.log(`[InboundHandler] Created registration_doc suggestion for ${result.conversationId}`);
          }
        }
      }
      return;
    }

    // ── 9. Transmission code path (score >= 0.70) ────────────────────────────
    if (
      autoPartsEnabled &&
      best &&
      (best.type === "TRANSMISSION_CODE" || best.type === "OCR_TRANSMISSION_CODE") &&
      best.score >= 0.70
    ) {
      incr("detector.route_price_lookup", { kind: "transmissionCode" });
      console.log(
        `[InboundHandler] Transmission code (${best.value} score=${best.score.toFixed(2)}) — enqueueing price lookup for ${result.conversationId}`,
      );
      const { enqueuePriceLookup } = await import("./price-lookup-queue");
      await enqueuePriceLookup({
        tenantId,
        conversationId: result.conversationId,
        transmissionCode: best.value,
        oem: best.value, // legacy alias for backward compatibility
      });
      return;
    }

    // ── 10. Gearbox type only ────────────────────────────────────────────────
    if (best?.type === "GEARBOX_TYPE") {
      incr("detector.route_no_vin");
      const tenant = await storage.getTenant(tenantId) ?? await storage.getDefaultTenant();
      if (tenant) {
        const pendingSuggestion = await storage.getPendingSuggestionByConversation(
          result.conversationId, tenantId,
        );
        if (!pendingSuggestion) {
          const templates = getMergedGearboxTemplates(tenant);
          const replyText = fillGearboxTemplate(templates.gearboxNoVin, {
            gearboxType: best.value.toUpperCase(),
          });
          const suggestion = await storage.createAiSuggestion({
            conversationId: result.conversationId,
            messageId: result.messageId,
            suggestedReply: replyText,
            intent: "gearbox_no_vin",
            confidence: 0.9,
            needsApproval: true,
            needsHandoff: false,
            questionsToAsk: [],
            usedSources: [],
            status: "pending",
            decision: "NEED_APPROVAL",
            autosendEligible: false,
          }, tenant.id);
          realtimeService.broadcastNewSuggestion(tenant.id, result.conversationId, suggestion.id);
          console.log(`[InboundHandler] Gearbox type "${best.value}" without VIN — created gearbox_no_vin suggestion`);
        }
      }
      return;
    }

    // ── 11. Medium-confidence clarification (0.55..0.69) ────────────────────
    if (
      best &&
      (best.type === "TRANSMISSION_CODE" || best.type === "OCR_TRANSMISSION_CODE") &&
      best.score >= 0.55
    ) {
      incr("detector.weak_tc_clarification");
      const tenant = await storage.getTenant(tenantId) ?? await storage.getDefaultTenant();
      if (tenant) {
        const replyText = buildWeakCodeClarificationText(best.value);
        const suggestion = await storage.createAiSuggestion({
          conversationId: result.conversationId,
          messageId: result.messageId,
          suggestedReply: replyText,
          intent: "gearbox_tag_request",
          confidence: 0.7,
          needsApproval: true,
          needsHandoff: false,
          questionsToAsk: [],
          usedSources: [],
          status: "pending",
          decision: "NEED_APPROVAL",
          autosendEligible: false,
        }, tenant.id);
        realtimeService.broadcastNewSuggestion(tenant.id, result.conversationId, suggestion.id);
        console.log(
          `[InboundHandler] Weak code "${best.value}" (score=${best.score.toFixed(2)}) — clarification requested for ${result.conversationId}`,
        );
      }
      return;
    }

    // ── 12. Fallback ─────────────────────────────────────────────────────────
    await triggerAiSuggestion(result.conversationId, tenantId);
  } catch (error) {
    console.error(`[InboundHandler] Error processing message:`, error);
  }
}
