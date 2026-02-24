import { storage } from "../storage";
import type { ParsedIncomingMessage } from "./channel-adapter";
import { getMergedGearboxTemplates, fillGearboxTemplate } from "./gearbox-templates";
import { detectGearboxType } from "./price-sources/types";
import { realtimeService } from "./websocket-server";
import { featureFlagService } from "./feature-flags";
import { isValidVinChecksum, tryAutoCorrectVin } from "../utils/vin-validator";

const VIN_CHARS = "A-HJ-NPR-Z0-9"; // VIN excludes I, O, Q
const VIN_REGEX = new RegExp(`[${VIN_CHARS}]{17}`, "gi");
const VIN_INCOMPLETE_REGEX = new RegExp(`[${VIN_CHARS}]{16}(?![${VIN_CHARS}])`, "gi");
const FRAME_REGEX = /[A-Z0-9]{3,}\s*-\s*[A-Z0-9]{3,}/gi;

// Japanese FRAME without dash: 2-5 letters + 6-10 digits, total 8-14 chars
// e.g. EU11105303, GX1001234567, AT2111234567
const FRAME_DASHLESS_REGEX = /\b[A-Z]{2,5}\d{6,10}\b/gi;
const FRAME_DASHLESS_MIN_LEN = 8;
const FRAME_DASHLESS_MAX_LEN = 14;

// Cyrillic chars visually identical to Latin ones (uppercase + lowercase)
const CYRILLIC_TO_LATIN: Record<string, string> = {
  "\u0410": "A", "\u0430": "a", // А → A
  "\u0412": "B",                // В → B (lowercase в not similar)
  "\u0421": "C", "\u0441": "c", // С → C
  "\u0415": "E", "\u0435": "e", // Е → E
  "\u041A": "K", "\u043A": "k", // К → K
  "\u041C": "M", "\u043C": "m", // М → M
  "\u041D": "H", "\u043D": "h", // Н → H
  "\u041E": "O", "\u043E": "o", // О → O
  "\u0420": "P", "\u0440": "p", // Р → P
  "\u0422": "T", "\u0442": "t", // Т → T
  "\u0423": "Y", "\u0443": "y", // У → Y
  "\u0425": "X", "\u0445": "x", // Х → X
};
const CYRILLIC_RE = new RegExp(`[${Object.keys(CYRILLIC_TO_LATIN).join("")}]`, "g");

/**
 * Pre-normalize text for vehicle ID detection:
 * 1) Replace Cyrillic lookalikes with Latin equivalents
 * 2) Replace en-dash, em-dash, minus sign, non-breaking hyphen → regular hyphen
 */
function normalizeVehicleIdText(text: string): string {
  let result = text.replace(CYRILLIC_RE, (ch) => CYRILLIC_TO_LATIN[ch] ?? ch);
  result = result.replace(/[\u2013\u2014\u2212\u2011]/g, "-");
  return result;
}

export type VehicleIdDetection =
  | { idType: "VIN"; rawValue: string; normalizedValue: string }
  | { idType: "VIN"; rawValue: string; normalizedValue: string; isIncompleteVin: true }
  | { idType: "FRAME"; rawValue: string; normalizedValue: string };

/**
 * Detect a gearbox OEM marking from plain text when no VIN/FRAME was found.
 * Returns the first plausible marking or null.
 *
 * Patterns covered:
 *   Japanese:  A245E, U150E, JF010E, RE4F04A, U660E
 *   European:  01M, 09G, DQ250, 0AM, NAG1, 6HP19
 *   Korean:    A6MF1, M11, 6T40, A8TR1
 *   With suffix: A245E-02A, RE4F04A-B41
 */
export function detectGearboxMarkingFromText(text: string): string | null {
  if (!text || text.trim().length < 2) return null;

  const upper = text.toUpperCase().trim();

  // Skip if already detected as VIN or frame by detectVehicleIdFromText
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(upper)) return null;

  // Skip OEM part numbers (digits-digits pattern like 24600-42L00)
  if (/^\d{4,6}-\d{4,6}[A-Z0-9]*$/.test(upper)) return null;

  // Two alternatives:
  //   1. letter(s)+digits+letter  — covers U150E, A245E, JF010E, U660E
  //   2. alphanumeric+letter+digits — covers RE4F04A, NAG1, 6HP19, A8TR1
  const oemPattern =
    /\b((?:[A-Z]{1,3}[0-9]{2,4}[A-Z][A-Z0-9]{0,4}|[A-Z0-9]{2,4}[A-Z][0-9]{1,4}[A-Z0-9]{0,4})(?:-[A-Z0-9]{2,5})?)\b/g;
  const matches = upper.match(oemPattern);
  if (!matches) return null;

  const filtered = matches.filter(
    (m) =>
      m.length >= 2 &&
      m.length <= 14 &&
      m.length !== 17 && // not a VIN
      !/^\d+$/.test(m) && // not all digits
      !/^[A-Z]{1,2}\d{6,}$/.test(m), // not a frame number pattern
  );

  return filtered.length > 0 ? filtered[0] : null;
}

export function detectVehicleIdFromText(text: string): VehicleIdDetection | null {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed.length) return null;

  // Normalize Cyrillic lookalikes and non-standard dashes before matching
  const normalized = normalizeVehicleIdText(trimmed);

  const candidates: { index: number; det: VehicleIdDetection }[] = [];

  // VIN 17 (full)
  let m: RegExpExecArray | null;
  VIN_REGEX.lastIndex = 0;
  while ((m = VIN_REGEX.exec(normalized)) !== null) {
    const raw = m[0];
    const norm = raw.replace(/\s/g, "").toUpperCase();
    if (norm.length === 17) {
      candidates.push({ index: m.index, det: { idType: "VIN", rawValue: trimmed.substring(m.index, m.index + raw.length), normalizedValue: norm } });
    }
  }

  // VIN 16 (incomplete)
  VIN_INCOMPLETE_REGEX.lastIndex = 0;
  while ((m = VIN_INCOMPLETE_REGEX.exec(normalized)) !== null) {
    const raw = m[0];
    const norm = raw.replace(/\s/g, "").toUpperCase();
    if (norm.length === 16) {
      candidates.push({
        index: m.index,
        det: { idType: "VIN", rawValue: trimmed.substring(m.index, m.index + raw.length), normalizedValue: norm, isIncompleteVin: true },
      });
    }
  }

  // FRAME with dash (e.g. GX100-1234567)
  FRAME_REGEX.lastIndex = 0;
  while ((m = FRAME_REGEX.exec(normalized)) !== null) {
    const raw = m[0].trim();
    const norm = raw.replace(/\s/g, "").toUpperCase();
    candidates.push({ index: m.index, det: { idType: "FRAME", rawValue: trimmed.substring(m.index, m.index + m[0].length).trim(), normalizedValue: norm } });
  }

  // FRAME without dash — Japanese chassis codes (e.g. EU11105303)
  FRAME_DASHLESS_REGEX.lastIndex = 0;
  while ((m = FRAME_DASHLESS_REGEX.exec(normalized)) !== null) {
    const raw = m[0];
    if (raw.length < FRAME_DASHLESS_MIN_LEN || raw.length > FRAME_DASHLESS_MAX_LEN) continue;
    const norm = raw.toUpperCase();
    // Skip if already covered by a VIN or dashed FRAME candidate at the same position
    const alreadyCovered = candidates.some(
      (c) => c.index <= m!.index && c.index + c.det.rawValue.length >= m!.index + raw.length
    );
    if (alreadyCovered) continue;
    candidates.push({ index: m.index, det: { idType: "FRAME", rawValue: trimmed.substring(m.index, m.index + raw.length), normalizedValue: norm } });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index);
  return candidates[0].det;
}

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

  // Find existing customer by (tenantId, channel, externalUserId)
  let customer = await storage.getCustomerByExternalId(tenant.id, parsed.channel, parsed.externalUserId);
  
  if (!customer) {
    const customerName = (parsed.metadata?.pushName as string) ||
                         (parsed.metadata?.firstName as string) ||
                         (parsed.metadata?.contactName as string) ||
                         `User ${parsed.externalUserId.slice(-4)}`;
    
    const isLid = parsed.metadata?.isLid === true;
    const remoteJid = (parsed.metadata?.remoteJid as string) || parsed.externalConversationId;
    let customerPhone = (parsed.metadata?.phone as string) || "";
    
    customer = await storage.createCustomer({
      tenantId: tenant.id,
      channel: parsed.channel,
      externalId: parsed.externalUserId,
      name: customerName,
      phone: customerPhone,
      metadata: { remoteJid },
    });
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
    });
    conversationId = newConv.id;
    unreadCount = 0;
    console.log(`[InboundHandler] Created new conversation: ${newConv.id}`);
  }

  const existingMessages = await storage.getMessagesByConversation(conversationId);
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
  });

  console.log(`[InboundHandler] Saved message ${message.id} to conversation ${conversationId}`);

  await storage.updateConversation(conversationId, {
    unreadCount: unreadCount + 1,
  });

  realtimeService.broadcastNewMessage(tenant.id, message, conversationId);
  
  if (isNew) {
    const conversationWithCustomer = await storage.getConversationWithCustomer(conversationId);
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

export async function triggerAiSuggestion(conversationId: string): Promise<void> {
  try {
    const conversation = await storage.getConversationDetail(conversationId);
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

    const pendingSuggestion = await storage.getPendingSuggestionByConversation(conversationId);
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
    });

    console.log(`[InboundHandler] Created AI suggestion ${suggestion.id} with decision: ${decisionResult.decision}`);

    // Notify frontend about new suggestion via WebSocket
    realtimeService.broadcastNewSuggestion(tenant.id, conversationId, suggestion.id);

    // Increment frequent topic for customer memory
    if (decisionResult.intent && decisionResult.intent !== "other") {
      try {
        await storage.incrementFrequentTopic(tenant.id, conversation.customer.id, decisionResult.intent);
        console.log(`[InboundHandler] Incremented topic "${decisionResult.intent}" for customer ${conversation.customer.id}`);
      } catch (error) {
        console.error(`[InboundHandler] Failed to increment topic:`, error);
      }
    }

    // Trigger summary generation based on message count
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

export async function processIncomingMessageFull(
  tenantId: string,
  parsed: ParsedIncomingMessage
): Promise<void> {
  try {
    const result = await handleIncomingMessage(tenantId, parsed);
    const text = (parsed.text || "").trim();

    const autoPartsEnabled = await featureFlagService.isEnabled("AUTO_PARTS_ENABLED", tenantId);

    if (!autoPartsEnabled) {
      await triggerAiSuggestion(result.conversationId);
      return;
    }

    let vehicleDet = detectVehicleIdFromText(text);

    if (vehicleDet && vehicleDet.idType === "VIN" && !("isIncompleteVin" in vehicleDet)) {
      if (!isValidVinChecksum(vehicleDet.normalizedValue)) {
        const corrected = tryAutoCorrectVin(vehicleDet.normalizedValue);
        if (corrected) {
          console.log(`[InboundHandler] Auto-corrected VIN: ${vehicleDet.normalizedValue} → ${corrected}`);
          vehicleDet = { ...vehicleDet, normalizedValue: corrected };
        }
        // If not correctable — still proceed; the pipeline handles invalid VINs downstream
      }
    }

    let imageAnalysisType: "gearbox_tag" | "registration_doc" | null = null;

    // If no VIN/FRAME in text but there are image attachments → classify image
    if (!vehicleDet && !text) {
      const imageAttachments = (parsed.attachments ?? []).filter(
        (a) => a.type === "image" && a.url
      );
      if (imageAttachments.length > 0) {
        const { analyzeImages, extractVinFromImages, logSafeUrl } = await import("./vin-ocr.service");
        const safeUrls = imageAttachments.map((a) => logSafeUrl(a.url ?? ""));
        console.log(`[InboundHandler] No text VIN found, classifying ${imageAttachments.length} image(s): ${safeUrls.join(", ")}`);

        const imageResult = await analyzeImages(imageAttachments).catch(() => ({ type: "unknown" as const }));

        if (imageResult.type === "gearbox_tag" && imageResult.code) {
          console.log(`[InboundHandler] Gearbox tag detected in image: ${imageResult.code} — enqueueing direct price lookup`);
          const { enqueuePriceLookup } = await import("./price-lookup-queue");
          await enqueuePriceLookup({
            tenantId,
            conversationId: result.conversationId,
            oem: imageResult.code,
          });
          return;
        }

        if (imageResult.type === "registration_doc") {
          imageAnalysisType = "registration_doc";
          const identifier = imageResult.vin ?? imageResult.frame;
          if (identifier) {
            const idType: "VIN" | "FRAME" = imageResult.vin ? "VIN" : "FRAME";
            const labelRu = imageResult.vin ? "VIN" : "номер кузова";
            console.log(`[InboundHandler] Registration doc detected, ${idType}: ${identifier}`);

            const tenant = await storage.getTenant(tenantId) ?? await storage.getDefaultTenant();
            if (tenant) {
              const suggestion = await storage.createAiSuggestion({
                conversationId: result.conversationId,
                messageId: result.messageId,
                suggestedReply: `Вижу свидетельство о регистрации. Нашёл ${labelRu}: ${identifier}. Начинаю подбор КПП.`,
                intent: "gearbox_tag_request",
                confidence: 1,
                needsApproval: true,
                needsHandoff: false,
                questionsToAsk: [],
                usedSources: [],
                status: "pending",
              });
              realtimeService.broadcastNewSuggestion(tenant.id, result.conversationId, suggestion.id);
              console.log(`[InboundHandler] Created registration_doc suggestion for conversation ${result.conversationId}`);
            }

            vehicleDet = { idType, rawValue: identifier, normalizedValue: identifier };
          } else {
            console.log(`[InboundHandler] Registration doc detected but no VIN/frame found in image`);
          }
        }

        // Fallback: plain VIN extraction for images not classified as gearbox_tag or registration_doc
        if (!vehicleDet && imageResult.type === "unknown") {
          const vinFromImage = await extractVinFromImages(imageAttachments).catch(() => null);
          if (vinFromImage) {
            console.log(`[InboundHandler] VIN extracted via image OCR fallback: ${vinFromImage}`);
            let correctedVin = vinFromImage;
            if (!isValidVinChecksum(vinFromImage)) {
              const corrected = tryAutoCorrectVin(vinFromImage);
              if (corrected) {
                console.log(`[InboundHandler] Auto-corrected OCR fallback VIN: ${vinFromImage} → ${corrected}`);
                correctedVin = corrected;
              }
            }
            vehicleDet = { idType: "VIN", rawValue: vinFromImage, normalizedValue: correctedVin };
          }
        }
      }
    }

    if (vehicleDet && "isIncompleteVin" in vehicleDet && vehicleDet.isIncompleteVin) {
      const conversation = await storage.getConversationDetail(result.conversationId);
      const tenant = conversation ? await storage.getTenant(conversation.tenantId) ?? await storage.getDefaultTenant() : null;
      if (conversation && tenant) {
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
        });
        realtimeService.broadcastNewSuggestion(tenant.id, result.conversationId, suggestion.id);
        console.log(`[InboundHandler] Incomplete VIN detected, created vehicle_id_request suggestion for ${result.conversationId}`);
      }
      return;
    }

    if (vehicleDet && !("isIncompleteVin" in vehicleDet && vehicleDet.isIncompleteVin)) {
      const activeCase = await storage.findActiveVehicleLookupCase(tenantId, result.conversationId, vehicleDet.normalizedValue);
      if (activeCase) {
        console.log("[InboundHandler] Skipped duplicate vehicle lookup case");
      } else {
        const row = await storage.createVehicleLookupCase({
          tenantId,
          conversationId: result.conversationId,
          messageId: result.messageId,
          idType: vehicleDet.idType,
          rawValue: vehicleDet.rawValue,
          normalizedValue: vehicleDet.normalizedValue,
          status: "PENDING",
          verificationStatus: "NONE",
        });
        const { enqueueVehicleLookup } = await import("./vehicle-lookup-queue");
        await enqueueVehicleLookup({
          caseId: row.id,
          tenantId,
          conversationId: result.conversationId,
          idType: vehicleDet.idType,
          normalizedValue: vehicleDet.normalizedValue,
        });
        console.log(`[InboundHandler] Vehicle ID detected (${vehicleDet.idType}), created case ${row.id} and enqueued lookup`);

        // Skip the generic gearbox_tag_request if we already created a registration_doc suggestion
        if (imageAnalysisType !== "registration_doc") {
          const tenant = await storage.getTenant(tenantId) ?? await storage.getDefaultTenant();
          if (tenant) {
            const templates = getMergedGearboxTemplates(tenant);
            const idTypeLabel = vehicleDet.idType === "VIN" ? "VIN-коду" : "номеру кузова";
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
            });
            realtimeService.broadcastNewSuggestion(tenant.id, result.conversationId, suggestion.id);
            console.log(`[InboundHandler] Created gearbox_tag_request suggestion for vehicle lookup case ${row.id}`);
          }
        }
      }
      return;
    }

    // If no VIN/FRAME detected, try to detect a gearbox OEM marking (e.g. A245E, K9K, 01M)
    // and enqueue a direct price lookup — skip Podzamenu VIN/FRAME lookup entirely.
    if (!vehicleDet && autoPartsEnabled) {
      const detectedMarking = detectGearboxMarkingFromText(text);
      console.log('[GearboxDetect] autoPartsEnabled:', autoPartsEnabled, '| detected:', detectedMarking);
      if (detectedMarking) {
        console.log(
          `[InboundHandler] Gearbox marking detected (${detectedMarking}) — enqueueing direct price lookup for ${result.conversationId}`,
        );
        const { enqueuePriceLookup } = await import("./price-lookup-queue");
        await enqueuePriceLookup({
          tenantId,
          conversationId: result.conversationId,
          oem: detectedMarking,
        });
        return; // price-lookup worker handles the reply
      }
    }

    // If no VIN/FRAME detected but customer mentioned a gearbox type, prompt for VIN
    if (!vehicleDet && text) {
      const mentionedGearboxType = detectGearboxType(text);
      if (mentionedGearboxType !== "unknown") {
        const tenant = await storage.getTenant(tenantId) ?? await storage.getDefaultTenant();
        if (tenant) {
          const pendingSuggestion = await storage.getPendingSuggestionByConversation(result.conversationId);
          if (!pendingSuggestion) {
            const templates = getMergedGearboxTemplates(tenant);
            const replyText = fillGearboxTemplate(templates.gearboxNoVin, {
              gearboxType: mentionedGearboxType.toUpperCase(),
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
            });
            realtimeService.broadcastNewSuggestion(tenant.id, result.conversationId, suggestion.id);
            console.log(`[InboundHandler] Gearbox type "${mentionedGearboxType}" without VIN, created gearbox_no_vin suggestion`);
          }
        }
        return;
      }
    }

    await triggerAiSuggestion(result.conversationId);
  } catch (error) {
    console.error(`[InboundHandler] Error processing message:`, error);
  }
}
