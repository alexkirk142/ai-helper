import { Router, type Request, type Response } from "express";
import { z } from "zod";
import multer from "multer";
import { storage } from "../storage";
import { VALID_INTENTS, TRAINING_POLICY_LIMITS } from "@shared/schema";
import { requireAuth, requireOperator, requireAdmin, requirePermission } from "../middleware/rbac";
import { aiRateLimiter, conversationRateLimiter, tenantAiLimiter, tenantConversationLimiter } from "../middleware/rate-limiter";
import { featureFlagService } from "../services/feature-flags";
import { auditLog } from "../services/audit-log";
import { scheduleDelayedMessage, cancelDelayedMessage, getDelayedJobs, getQueueMetrics } from "../services/message-queue";
import { WhatsAppPersonalAdapter } from "../services/whatsapp-personal-adapter";
import { telegramAdapter } from "../services/telegram-adapter";
import { whatsappAdapter } from "../services/whatsapp-adapter";
import { maxAdapter } from "../services/max-adapter";
import { recordTrainingSample, getTrainingSamples, exportTrainingSamples, type TrainingOutcome } from "../services/training-sample-service";
import { addToLearningQueue } from "../services/learning-score-service";
import { sanitizeString, sanitizeForLog } from "../utils/sanitizer";
import type { ParsedAttachment } from "../services/channel-adapter";

// Multer instance for optional file uploads — memory storage, max 50 MB
const messageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const router = Router();

async function getUserForConversations(userId: string) {
  let user = await storage.getUserByOidcId(userId);
  if (!user) {
    user = await storage.getUser(userId);
  }
  return user;
}

// ============ CONVERSATION ROUTES ============

router.get("/api/conversations", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    const status = req.query.status as string;
    let conversations;
    if (status === "active") {
      conversations = await storage.getActiveConversations(user.tenantId);
    } else {
      conversations = await storage.getConversationsByTenant(user.tenantId);
    }
    res.json(conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

router.get("/api/conversations/channel-counts", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const counts = await storage.getConversationChannelCounts(user.tenantId);
    res.json(counts);
  } catch (error) {
    console.error("Error fetching channel counts:", error);
    res.status(500).json({ error: "Failed to fetch channel counts" });
  }
});

router.get("/api/failed-leads", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const leads = await storage.getFailedLeads(user.tenantId);
    res.json(leads);
  } catch (error) {
    console.error("Error fetching failed leads:", error);
    res.status(500).json({ error: "Failed to fetch failed leads" });
  }
});

router.get("/api/conversations/:id", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    const detail = await storage.getConversationDetail(req.params.id, user.tenantId);
    if (!detail) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    if (detail.tenantId !== user.tenantId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    res.json(detail);
  } catch (error) {
    console.error("Error fetching conversation:", error);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

router.patch("/api/conversations/:id", requireAuth, requireOperator, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const conversation = await storage.getConversation(req.params.id, user.tenantId);
    if (!conversation || conversation.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const { status, mode } = req.body;
    const previousStatus = conversation.status;

    const updated = await storage.updateConversation(req.params.id, user.tenantId, { status, mode });
    
    if (status === "resolved" && previousStatus !== "resolved") {
      const { triggerSummaryOnConversationResolved } = await import("../services/customer-summary-service");
      triggerSummaryOnConversationResolved(conversation.tenantId, conversation.customerId).catch(err => {
        console.error("Failed to trigger summary on conversation resolved:", err);
      });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating conversation:", error);
    res.status(500).json({ error: "Failed to update conversation" });
  }
});

router.delete("/api/conversations/:id", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const conversation = await storage.getConversation(req.params.id, user.tenantId);
    if (!conversation || conversation.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    await storage.deleteConversation(req.params.id, user.tenantId);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting conversation:", error);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.post("/api/conversations/:id/read", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const conversation = await storage.getConversation(req.params.id, user.tenantId);
    if (!conversation || conversation.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    await storage.updateConversation(req.params.id, user.tenantId, { unreadCount: 0 });
    res.json({ success: true });
  } catch (error) {
    console.error("Error marking conversation as read:", error);
    res.status(500).json({ error: "Failed to mark conversation as read" });
  }
});

router.post("/api/conversations/:id/mute", requireAuth, requireOperator, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const conversation = await storage.getConversation(req.params.id, user.tenantId);
    if (!conversation || conversation.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    const { muted } = req.body as { muted: boolean };
    await storage.updateConversation(req.params.id, user.tenantId, { isMuted: muted });
    res.json({ success: true, isMuted: muted });
  } catch (error) {
    console.error("Error toggling conversation mute:", error);
    res.status(500).json({ error: "Failed to toggle mute" });
  }
});

router.get("/api/conversations/:id/messages", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const conversationId = req.params.id;

    const conversation = await storage.getConversation(conversationId, user.tenantId);
    if (!conversation || conversation.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const querySchema = z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten() });
    }
    const { cursor, limit } = parsed.data;

    const result = await storage.getMessagesByConversationPaginated(conversationId, user.tenantId, cursor, limit);

    res.json(result);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post(
  "/api/conversations/:id/messages",
  requireAuth,
  requirePermission("MANAGE_CONVERSATIONS"),
  messageUpload.single("file"),
  conversationRateLimiter,
  tenantConversationLimiter,
  async (req: Request, res: Response) => {
    try {
      const content = (req.body.content ?? "") as string;
      const role = (req.body.role ?? "owner") as string;
      const uploadedFile = req.file;

      if (!uploadedFile && (!content || typeof content !== "string" || content.trim().length === 0)) {
        return res.status(400).json({ error: "Message content or file is required" });
      }

      if (!req.userId || req.userId === "system") {
        return res.status(403).json({ error: "User authentication required" });
      }
      const msgUser = await getUserForConversations(req.userId);
      if (!msgUser?.tenantId) {
        return res.status(403).json({ error: "User not associated with a tenant" });
      }

      const conversation = await storage.getConversationDetail(req.params.id, msgUser.tenantId);
      if (!conversation || conversation.tenantId !== msgUser.tenantId) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // Resolve effective channel type before sending
      const customerMessages = conversation.messages.filter((m) => m.role === "customer");
      const lastCustomerMsg = customerMessages[customerMessages.length - 1];
      const channelType = (lastCustomerMsg?.metadata as any)?.channel as string | undefined;
      let effectiveChannelType: string | undefined = channelType;
      // Fallback 1: customer entity channel (set when customer was created via start-conversation)
      if (!effectiveChannelType) {
        effectiveChannelType = (conversation.customer as any)?.channel as string | undefined;
      }
      // Fallback 2: channel record linked to conversation
      if (!effectiveChannelType && conversation.channelId) {
        const ch = await storage.getChannel(conversation.channelId);
        effectiveChannelType = ch?.type;
      }
      // Fallback 3: scan all messages for any channel hint (covers operator-started conversations
      // where no customer messages exist yet and conversation has no channelId)
      if (!effectiveChannelType) {
        for (const msg of conversation.messages) {
          const ch = (msg.metadata as any)?.channel as string | undefined;
          if (ch) { effectiveChannelType = ch; break; }
        }
      }
      let effectiveChannelId: string | undefined =
        conversation.channelId || ((lastCustomerMsg?.metadata as any)?.channelId as string | undefined);
      // Fallback: scan all messages for a channelId hint (covers Telegram conversations where
      // conversation.channelId was not set and last customer message lacks it).
      if (!effectiveChannelId) {
        for (const msg of conversation.messages) {
          const cid = (msg.metadata as any)?.channelId as string | undefined;
          if (cid) { effectiveChannelId = cid; break; }
        }
      }
      // Last resort for telegram_personal: query for an active sender/both account.
      if (!effectiveChannelId && effectiveChannelType === "telegram_personal") {
        try {
          const tgAccounts = await storage.getTelegramAccountsByTenant(conversation.tenantId);
          const senderAccount = tgAccounts.find(a => a.tgRole === "sender" || a.tgRole === "both");
          if (senderAccount?.channelId) {
            effectiveChannelId = senderAccount.channelId;
            console.log(`[OutboundHandler] Resolved telegram channelId from account role: ${effectiveChannelId}`);
          }
        } catch {}
      }
      // For multi-account channels (max_personal): prefer accountId from last customer msg,
      // then fall back to any message that carries one (e.g. the initial outbound message).
      const effectiveAccountId: string | undefined =
        ((lastCustomerMsg?.metadata as any)?.accountId as string | undefined) ??
        (conversation.messages.find((m) => (m.metadata as any)?.accountId)?.metadata as any)?.accountId;

      console.log(
        `[OutboundHandler] channel=${effectiveChannelType}, channelId=${effectiveChannelId}, hasFile=${!!uploadedFile}`,
      );

      // ── Media send path ────────────────────────────────────────────────────
      let outboundAttachment: ParsedAttachment | undefined;

      if (uploadedFile && role === "owner" && conversation.messages.length > 0) {
        const { buffer, mimetype, originalname, size } = uploadedFile;

        if (effectiveChannelType === "telegram_personal" && conversation.customer && effectiveChannelId) {
          try {
            const { telegramClientManager } = await import("../services/telegram-client-manager");
            const recipientId = conversation.customer.externalId;

            const sendResult = await telegramClientManager.sendFileMessage(
              conversation.tenantId,
              effectiveChannelId,
              recipientId,
              buffer,
              mimetype,
              originalname,
              content.trim(),
            );

            if (sendResult.success && sendResult.externalMessageId) {
              const accountId = sendResult.accountId ?? effectiveChannelId;
              const msgId = sendResult.externalMessageId;
              outboundAttachment = buildAttachmentMeta(mimetype, originalname, size, {
                url: `/api/telegram-personal/media/${encodeURIComponent(accountId)}/${encodeURIComponent(recipientId)}/${msgId}`,
              });
              console.log(`[OutboundHandler] Telegram file sent: msgId=${msgId}`);
            } else {
              console.error(`[OutboundHandler] Telegram file send failed: ${sendResult.error}`);
            }
          } catch (sendError: any) {
            console.error(`[OutboundHandler] Telegram file send error:`, sendError.message);
          }
        }

        if (effectiveChannelType === "telegram" && conversation.customer) {
          try {
            const { TelegramAdapter } = await import("../services/telegram-adapter");
            const adapter = new TelegramAdapter();
            const recipientId = conversation.customer.externalId;

            const sendResult = await adapter.sendMediaMessage(
              recipientId,
              buffer,
              mimetype,
              originalname,
              content.trim(),
            );

            if (sendResult.success) {
              outboundAttachment = buildAttachmentMeta(mimetype, originalname, size, {
                fileId: sendResult.fileId,
                url: sendResult.fileId ? `/api/telegram/file/${sendResult.fileId}` : undefined,
              });
              console.log(`[OutboundHandler] Telegram Bot API file sent: fileId=${sendResult.fileId}`);
            } else {
              console.error(`[OutboundHandler] Telegram Bot API file send failed: ${sendResult.error}`);
            }
          } catch (sendError: any) {
            console.error(`[OutboundHandler] Telegram Bot API file send error:`, sendError.message);
          }
        }

        if (effectiveChannelType === "max_personal" && conversation.customer) {
          try {
            const { maxPersonalAdapter } = await import("../services/max-personal-adapter");
            const chatId = conversation.customer.externalId;
            const caption = content.trim() || undefined;

            const sendResult = await maxPersonalAdapter.sendFileMessageForTenant(
              conversation.tenantId,
              chatId,
              buffer,
              mimetype,
              originalname,
              caption,
              effectiveAccountId,
            );

            if (sendResult.success) {
              outboundAttachment = buildAttachmentMeta(mimetype, originalname, size, {});
              console.log(`[OutboundHandler] MAX Personal file sent: msgId=${sendResult.externalMessageId}`);
            } else {
              console.error(`[OutboundHandler] MAX Personal file send failed: ${sendResult.error}`);
            }
          } catch (sendError: any) {
            console.error(`[OutboundHandler] MAX Personal file send error:`, sendError.message);
          }
        }
      }

      // ── Save message to DB ─────────────────────────────────────────────────
      const messageContent = uploadedFile
        ? content.trim() // caption (may be empty)
        : content.trim();

      const message = await storage.createMessage({
        conversationId: req.params.id,
        role,
        content: messageContent,
        attachments: outboundAttachment ? [outboundAttachment] : [],
        metadata: {},
      }, msgUser.tenantId);

      await storage.updateConversation(req.params.id, msgUser.tenantId, { unreadCount: 0 });

      // ── VIN OCR for customer image uploads ─────────────────────────────────
      // When an image is uploaded explicitly as a customer message (role: "customer"),
      // run OCR to detect a VIN and trigger vehicle lookup — same pipeline as the
      // inbound channel handler.
      if (role === "customer" && uploadedFile && uploadedFile.mimetype?.startsWith("image/")) {
        const autoPartsEnabled = await featureFlagService.isEnabled("AUTO_PARTS_ENABLED", msgUser.tenantId);
        if (autoPartsEnabled) {
          try {
            const { extractVinFromImages, logSafeUrl } = await import("../services/vin-ocr.service");
            const dataUrl = `data:${uploadedFile.mimetype};base64,${uploadedFile.buffer.toString("base64")}`;
            console.log(`[ConversationRoute] Running VIN OCR on customer image: ${logSafeUrl(dataUrl)}`);
            const vinFromImage = await extractVinFromImages([{ url: dataUrl, mimeType: uploadedFile.mimetype }]).catch(() => null);
            if (vinFromImage) {
              console.log(`[ConversationRoute] VIN extracted from customer image OCR: ${vinFromImage}`);
              const activeCase = await storage.findActiveVehicleLookupCase(msgUser.tenantId, req.params.id, vinFromImage);
              if (!activeCase) {
                const row = await storage.createVehicleLookupCase({
                  tenantId: msgUser.tenantId,
                  conversationId: req.params.id,
                  messageId: message.id,
                  idType: "VIN",
                  rawValue: vinFromImage,
                  normalizedValue: vinFromImage,
                  status: "PENDING",
                  verificationStatus: "NONE",
                }, msgUser.tenantId);
                const { enqueueVehicleLookup } = await import("../services/vehicle-lookup-queue");
                await enqueueVehicleLookup({
                  caseId: row.id,
                  tenantId: msgUser.tenantId,
                  conversationId: req.params.id,
                  idType: "VIN",
                  normalizedValue: vinFromImage,
                });
                console.log(`[ConversationRoute] Created vehicle lookup case ${row.id} from customer image OCR`);
              } else {
                console.log(`[ConversationRoute] Skipped duplicate lookup case for VIN ${vinFromImage}`);
              }
            }
          } catch (ocrError: any) {
            console.error("[ConversationRoute] VIN OCR failed:", ocrError.message);
          }
        }
      }

      // ── Text send path (no file, or file already handled above) ───────────
      if (!uploadedFile && role === "owner" && conversation.messages.length > 0) {
        if (effectiveChannelType === "whatsapp_personal" && conversation.customer) {
          let recipientJid = conversation.customer.externalId;
          if (!recipientJid.includes("@")) recipientJid = `${recipientJid}@s.whatsapp.net`;
          try {
            const adapter = new WhatsAppPersonalAdapter(conversation.tenantId);
            const sendResult = await adapter.sendMessage(recipientJid, content.trim());
            if (sendResult.success) {
              console.log(`[OutboundHandler] WhatsApp message sent: ${sendResult.externalMessageId}`);
            } else {
              console.error(`[OutboundHandler] WhatsApp send failed: ${sendResult.error}`);
            }
          } catch (sendError: any) {
            console.error(`[OutboundHandler] WhatsApp send error:`, sendError.message);
          }
        }

        if (effectiveChannelType === "telegram_personal" && conversation.customer && effectiveChannelId) {
          try {
            const { telegramClientManager } = await import("../services/telegram-client-manager");
            const recipientId = conversation.customer.externalId;
            const sendResult = await telegramClientManager.sendMessage(
              conversation.tenantId,
              effectiveChannelId,
              recipientId,
              content.trim(),
            );
            if (sendResult.success) {
              console.log(`[OutboundHandler] Telegram message sent: ${sendResult.externalMessageId}`);
            } else {
              console.error(`[OutboundHandler] Telegram send failed: ${sendResult.error}`);
            }
          } catch (sendError: any) {
            console.error(`[OutboundHandler] Telegram send error:`, sendError.message);
          }
        }

        if (effectiveChannelType === "max_personal" && conversation.customer) {
          try {
            const { maxPersonalAdapter } = await import("../services/max-personal-adapter");
            const chatId = conversation.customer.externalId;
            const sendResult = await maxPersonalAdapter.sendMessageForTenant(
              conversation.tenantId,
              chatId,
              content.trim(),
              undefined,
              effectiveAccountId,
            );
            if (sendResult.success) {
              console.log(`[OutboundHandler] MAX Personal message sent: ${sendResult.externalMessageId}`);
            } else {
              console.error(`[OutboundHandler] MAX Personal send failed: ${sendResult.error}`);
            }
          } catch (sendError: any) {
            console.error(`[OutboundHandler] MAX Personal send error:`, sendError.message);
          }
        }
      }

      res.status(201).json(message);
    } catch (error) {
      console.error("Error sending message:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  },
);

/** Maps MIME type to a ParsedAttachment, merging any extra fields (url, fileId). */
function buildAttachmentMeta(
  mimeType: string,
  fileName: string,
  fileSize: number,
  extra: Partial<ParsedAttachment>,
): ParsedAttachment {
  const mime = mimeType.toLowerCase();
  let type: ParsedAttachment["type"] = "document";
  if (mime.startsWith("image/")) type = "image";
  else if (mime.startsWith("video/")) type = "video";
  else if (mime === "audio/ogg") type = "voice";
  else if (mime.startsWith("audio/")) type = "audio";

  return {
    type,
    mimeType,
    fileName,
    fileSize,
    ...extra,
  };
}

// ============ AI SUGGESTION ROUTES ============

router.post("/api/conversations/:id/generate-suggestion", requireAuth, requirePermission("VIEW_CONVERSATIONS"), aiRateLimiter, tenantAiLimiter, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const genUser = await getUserForConversations(req.userId);
    if (!genUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const conversation = await storage.getConversationDetail(req.params.id, genUser.tenantId);
    if (!conversation || conversation.tenantId !== genUser.tenantId) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const tenant = await storage.getTenant(genUser.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const lastCustomerMessage = conversation.messages
      .filter((m) => m.role === "customer")
      .pop();
    
    if (!lastCustomerMessage) {
      return res.status(400).json({ error: "No customer message to respond to" });
    }

    const relevantDocs = await storage.searchKnowledgeDocs(tenant.id, lastCustomerMessage.content);
    const relevantProducts = await storage.searchProducts(tenant.id, lastCustomerMessage.content);

    const conversationHistory = conversation.messages.slice(-6).map((m) => ({
      role: (m.role === "customer" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    }));

    const { generateWithDecisionEngine } = await import("../services/decision-engine");
    const decisionResult = await generateWithDecisionEngine({
      conversationId: req.params.id,
      tenantId: tenant.id,
      tenant,
      customerMessage: lastCustomerMessage.content,
      conversationHistory,
      products: relevantProducts,
      docs: relevantDocs,
    });

    const suggestion = await storage.createAiSuggestion({
      conversationId: req.params.id,
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
      missingFields: decisionResult.missingFields,
      autosendEligible: decisionResult.autosendEligible,
      autosendBlockReason: decisionResult.autosendBlockReason,
      selfCheckNeedHandoff: decisionResult.selfCheckNeedHandoff,
      selfCheckReasons: decisionResult.selfCheckReasons,
    }, genUser.tenantId);

    await auditLog.logSuggestionGenerated(suggestion.id, req.params.id, {
      intent: decisionResult.intent,
      confidence: decisionResult.confidence.total,
      decision: decisionResult.decision,
    });

    res.status(201).json(suggestion);
  } catch (error) {
    console.error("Error generating suggestion:", error);
    res.status(500).json({ error: "Failed to generate suggestion" });
  }
});

async function resolveConversationChannel(conversationId: string, tenantId: string): Promise<{ effectiveChannelType: string | undefined; effectiveChannelId: string | undefined }> {
  const conversationDetail = await storage.getConversationDetail(conversationId, tenantId);
  if (!conversationDetail) return { effectiveChannelType: undefined, effectiveChannelId: undefined };

  const messages = conversationDetail.messages || [];
  const lastCustomerMsg = messages.filter((m: any) => m.role === "customer").pop();

  let effectiveChannelType = conversationDetail.customer?.channel as string | undefined;
  if (!effectiveChannelType && lastCustomerMsg) {
    effectiveChannelType = (lastCustomerMsg.metadata as any)?.channel;
  }
  if (!effectiveChannelType && conversationDetail.channelId) {
    const channel = await storage.getChannel(conversationDetail.channelId);
    effectiveChannelType = channel?.type;
  }
  if (!effectiveChannelType) {
    for (const msg of messages) {
      const ch = (msg.metadata as any)?.channel as string | undefined;
      if (ch) { effectiveChannelType = ch; break; }
    }
  }

  const effectiveChannelId = conversationDetail.channelId || (lastCustomerMsg?.metadata as any)?.channelId;
  return { effectiveChannelType, effectiveChannelId };
}

async function sendToChannel(conversationId: string, text: string, tenantId: string) {
  let channelSendResult = null;
  try {
    const conversationDetail = await storage.getConversationDetail(conversationId, tenantId);
    if (!conversationDetail) return null;
    
    const messages = conversationDetail.messages || [];
    const lastCustomerMsg = messages.filter(m => m.role === "customer").pop();
    
    let effectiveChannelType = conversationDetail.customer?.channel as string | undefined;
    if (!effectiveChannelType && lastCustomerMsg) {
      effectiveChannelType = (lastCustomerMsg.metadata as any)?.channel;
    }
    if (!effectiveChannelType && conversationDetail.channelId) {
      const channel = await storage.getChannel(conversationDetail.channelId);
      effectiveChannelType = channel?.type;
    }
    // Fallback: scan all messages for channel hint (covers operator-started conversations)
    if (!effectiveChannelType) {
      for (const msg of messages) {
        const ch = (msg.metadata as any)?.channel as string | undefined;
        if (ch) { effectiveChannelType = ch; break; }
      }
    }
    
    const effectiveChannelId = conversationDetail.channelId || (lastCustomerMsg?.metadata as any)?.channelId;
    // For multi-account max_personal: prefer accountId from customer msg, then any message
    const effectiveAccountId: string | undefined =
      ((lastCustomerMsg?.metadata as any)?.accountId as string | undefined) ??
      (messages.find((m) => (m.metadata as any)?.accountId)?.metadata as any)?.accountId;
    
    console.log(`[Outbound] Channel: ${effectiveChannelType}, ChannelId: ${effectiveChannelId}, CustomerExternalId: ${conversationDetail.customer?.externalId}`);
    
    if (effectiveChannelType === "telegram_personal" && conversationDetail.customer && effectiveChannelId) {
      try {
        const { telegramClientManager } = await import("../services/telegram-client-manager");
        const recipientId = conversationDetail.customer.externalId;
        
        console.log(`[Outbound] Sending Telegram message to ${recipientId} via channel ${effectiveChannelId}`);
        
        channelSendResult = await telegramClientManager.sendMessage(
          conversationDetail.tenantId,
          effectiveChannelId,
          recipientId,
          text
        );
        
        if (channelSendResult.success) {
          console.log(`[Outbound] Telegram message sent: ${channelSendResult.externalMessageId}`);
        } else {
          console.error(`[Outbound] Telegram send failed: ${channelSendResult.error}`);
        }
      } catch (sendError: any) {
        console.error(`[Outbound] Telegram send error:`, sendError.message);
      }
    } else if (effectiveChannelType === "whatsapp_personal" && conversationDetail.customer) {
      let recipientJid = conversationDetail.customer.externalId;
      if (!recipientJid.includes("@")) {
        recipientJid = `${recipientJid}@s.whatsapp.net`;
      }
      const waAdapter = new WhatsAppPersonalAdapter(tenantId);
      console.log(`[Outbound] Sending WhatsApp message to ${recipientJid}`);
      channelSendResult = await waAdapter.sendMessage(recipientJid, text);
      console.log(`[Outbound] Result:`, sanitizeForLog(channelSendResult));
    } else if (effectiveChannelType === "max_personal" && conversationDetail.customer) {
      try {
        const { maxPersonalAdapter } = await import("../services/max-personal-adapter");
        const chatId = conversationDetail.customer.externalId;
        console.log(`[Outbound] Sending MAX Personal message to ${chatId}`);
        channelSendResult = await maxPersonalAdapter.sendMessageForTenant(tenantId, chatId, text, undefined, effectiveAccountId);
        if (channelSendResult.success) {
          console.log(`[Outbound] MAX Personal message sent: ${channelSendResult.externalMessageId}`);
        } else {
          console.error(`[Outbound] MAX Personal send failed: ${channelSendResult.error}`);
        }
      } catch (maxError: any) {
        console.error(`[Outbound] MAX Personal send error:`, maxError.message);
      }
    } else if (effectiveChannelType === "telegram" && conversationDetail.customer) {
      try {
        const chatId = conversationDetail.customer.externalId;
        console.log(`[Outbound] Sending Telegram Bot message to ${chatId}`);
        channelSendResult = await telegramAdapter.sendMessage(chatId, text);
        if (channelSendResult.success) {
          console.log(`[Outbound] Telegram Bot message sent: ${channelSendResult.externalMessageId}`);
        } else {
          console.error(`[Outbound] Telegram Bot send failed: ${channelSendResult.error}`);
        }
      } catch (tgError: any) {
        console.error(`[Outbound] Telegram Bot send error:`, tgError.message);
      }
    } else if (effectiveChannelType === "whatsapp" && conversationDetail.customer) {
      try {
        const recipientId = conversationDetail.customer.externalId;
        console.log(`[Outbound] Sending WhatsApp Business message to ${recipientId}`);
        channelSendResult = await whatsappAdapter.sendMessage(recipientId, text);
        if (channelSendResult.success) {
          console.log(`[Outbound] WhatsApp Business message sent: ${channelSendResult.externalMessageId}`);
        } else {
          console.error(`[Outbound] WhatsApp Business send failed: ${channelSendResult.error}`);
        }
      } catch (waError: any) {
        console.error(`[Outbound] WhatsApp Business send error:`, waError.message);
      }
    } else if (effectiveChannelType === "max" && conversationDetail.customer) {
      try {
        const chatId = conversationDetail.customer.externalId;
        console.log(`[Outbound] Sending MAX Bot message to ${chatId}`);
        channelSendResult = await maxAdapter.sendMessage(chatId, text);
        if (channelSendResult.success) {
          console.log(`[Outbound] MAX Bot message sent: ${channelSendResult.externalMessageId}`);
        } else {
          console.error(`[Outbound] MAX Bot send failed: ${channelSendResult.error}`);
        }
      } catch (maxBotError: any) {
        console.error(`[Outbound] MAX Bot send error:`, maxBotError.message);
      }
    } else if (effectiveChannelType) {
      console.warn(`[sendToChannel] Unknown channel type: ${effectiveChannelType}`);
    }
  } catch (channelError) {
    console.error("[Outbound] Channel send error:", channelError);
  }
  return channelSendResult;
}

router.post("/api/suggestions/:id/approve", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const approveUser = await getUserForConversations(req.userId ?? "");
    if (!approveUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const suggestion = await storage.getAiSuggestion(req.params.id, approveUser.tenantId);
    if (!suggestion) {
      return res.status(404).json({ error: "Suggestion not found" });
    }

    const tenant = await storage.getTenant(approveUser.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const humanDelayEnabled = await featureFlagService.isEnabled("HUMAN_DELAY_ENABLED");
    let delayResult = null;
    let messageToSend = suggestion.suggestedReply;

    if (humanDelayEnabled) {
      const { computeHumanDelay, getDefaultHumanDelaySettings } = await import("../services/human-delay-engine");
      const delaySettings = await storage.getHumanDelaySettings(tenant.id) || getDefaultHumanDelaySettings(tenant.id);
      
      if (delaySettings.enabled) {
        delayResult = computeHumanDelay({
          messageLength: suggestion.suggestedReply.length,
          settings: delaySettings,
          tenant: {
            workingHoursStart: tenant.workingHoursStart,
            workingHoursEnd: tenant.workingHoursEnd,
            timezone: tenant.timezone,
          },
        });

        if (delayResult.nightModeAction === "DISABLE") {
          return res.status(400).json({ 
            error: "Sending disabled outside working hours",
            delayResult 
          });
        }

        if (delayResult.nightModeAction === "AUTO_REPLY" && delayResult.autoReplyText) {
          messageToSend = delayResult.autoReplyText;
        }
      }
    }

    await storage.updateAiSuggestion(req.params.id, approveUser.tenantId, { status: "approved" });

    const message = await storage.createMessage({
      conversationId: suggestion.conversationId,
      role: "assistant",
      content: messageToSend,
      attachments: [],
      metadata: { 
        suggestionId: suggestion.id,
        delayApplied: delayResult?.delay?.finalDelayMs || 0,
        isNightMode: delayResult?.delay?.isNightMode || false,
        status: "pending",
      },
    }, approveUser.tenantId);

    await storage.createHumanAction({
      suggestionId: suggestion.id,
      action: "approve",
      originalText: suggestion.suggestedReply,
    });

    const messages = await storage.getMessagesByConversation(suggestion.conversationId, approveUser.tenantId);
    const lastCustomerMessage = [...messages].reverse().find(m => m.role === "customer");
    if (lastCustomerMessage) {
      await recordTrainingSample({
        suggestion,
        userMessage: lastCustomerMessage.content,
        finalAnswer: suggestion.suggestedReply,
        outcome: "APPROVED",
        tenantId: tenant.id,
      });
    }

    await addToLearningQueue({
      suggestion,
      outcome: "APPROVED",
      messageCount: messages.length,
      tenantId: tenant.id,
      conversationId: suggestion.conversationId,
    });

    let scheduledJob = null;
    let sentImmediately = false;

    const { effectiveChannelType: approveChannelType, effectiveChannelId: approveChannelId } =
      await resolveConversationChannel(suggestion.conversationId, approveUser.tenantId);
    
    if (humanDelayEnabled && delayResult?.delay?.finalDelayMs) {
      const delaySettings = await storage.getHumanDelaySettings(tenant.id);
      scheduledJob = await scheduleDelayedMessage({
        tenantId: tenant.id,
        conversationId: suggestion.conversationId,
        messageId: message.id,
        suggestionId: suggestion.id,
        channel: approveChannelType ?? "mock",
        text: messageToSend,
        delayMs: delayResult.delay.finalDelayMs,
        typingEnabled: delaySettings?.typingIndicatorEnabled || false,
      });
      
      if (!scheduledJob) {
        sentImmediately = true;
      }
    } else {
      sentImmediately = true;
    }

    const channelSendResult = sentImmediately
      ? await sendToChannel(suggestion.conversationId, messageToSend, tenant.id)
      : null;

    await auditLog.logSuggestionApproved(suggestion.id, "operator");
    await auditLog.logMessageSent(message.id, suggestion.conversationId, "ai", "ai");

    res.json({ suggestion, message, delayResult, scheduledJob, sentImmediately, channelSendResult });
  } catch (error) {
    console.error("Error approving suggestion:", error);
    res.status(500).json({ error: "Failed to approve suggestion" });
  }
});

router.post("/api/suggestions/:id/edit", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const { editedText } = req.body;

    const editUser = await getUserForConversations(req.userId ?? "");
    if (!editUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const suggestion = await storage.getAiSuggestion(req.params.id, editUser.tenantId);
    if (!suggestion) {
      return res.status(404).json({ error: "Suggestion not found" });
    }

    const tenant = await storage.getTenant(editUser.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const humanDelayEnabled = await featureFlagService.isEnabled("HUMAN_DELAY_ENABLED");
    let delayResult = null;

    if (humanDelayEnabled) {
      const { computeHumanDelay, getDefaultHumanDelaySettings } = await import("../services/human-delay-engine");
      const delaySettings = await storage.getHumanDelaySettings(tenant.id) || getDefaultHumanDelaySettings(tenant.id);
      
      if (delaySettings.enabled) {
        delayResult = computeHumanDelay({
          messageLength: editedText.length,
          settings: delaySettings,
          tenant: {
            workingHoursStart: tenant.workingHoursStart,
            workingHoursEnd: tenant.workingHoursEnd,
            timezone: tenant.timezone,
          },
        });

        if (delayResult.nightModeAction === "DISABLE") {
          return res.status(400).json({ 
            error: "Sending disabled outside working hours",
            delayResult 
          });
        }
      }
    }

    await storage.updateAiSuggestion(req.params.id, editUser.tenantId, { status: "edited" });

    const message = await storage.createMessage({
      conversationId: suggestion.conversationId,
      role: "assistant",
      content: editedText,
      attachments: [],
      metadata: { 
        suggestionId: suggestion.id, 
        edited: true,
        delayApplied: delayResult?.delay?.finalDelayMs || 0,
        isNightMode: delayResult?.delay?.isNightMode || false,
        status: "pending",
      },
    }, editUser.tenantId);

    await storage.createHumanAction({
      suggestionId: suggestion.id,
      action: "edit",
      originalText: suggestion.suggestedReply,
      editedText,
    });

    const convMessages = await storage.getMessagesByConversation(suggestion.conversationId, editUser.tenantId);
    const lastCustomerMsg = [...convMessages].reverse().find(m => m.role === "customer");
    if (lastCustomerMsg) {
      await recordTrainingSample({
        suggestion,
        userMessage: lastCustomerMsg.content,
        finalAnswer: editedText,
        outcome: "EDITED",
        tenantId: tenant.id,
      });
    }

    await addToLearningQueue({
      suggestion,
      outcome: "EDITED",
      messageCount: convMessages.length,
      tenantId: tenant.id,
      conversationId: suggestion.conversationId,
    });

    let scheduledJob = null;
    let sentImmediately = false;

    const { effectiveChannelType: editChannelType, effectiveChannelId: editChannelId } =
      await resolveConversationChannel(suggestion.conversationId, editUser.tenantId);
    
    if (humanDelayEnabled && delayResult?.delay?.finalDelayMs) {
      const delaySettings = await storage.getHumanDelaySettings(tenant.id);
      scheduledJob = await scheduleDelayedMessage({
        tenantId: tenant.id,
        conversationId: suggestion.conversationId,
        messageId: message.id,
        suggestionId: suggestion.id,
        channel: editChannelType ?? "mock",
        text: editedText,
        delayMs: delayResult.delay.finalDelayMs,
        typingEnabled: delaySettings?.typingIndicatorEnabled || false,
      });
      
      if (!scheduledJob) {
        sentImmediately = true;
      }
    } else {
      sentImmediately = true;
    }

    const channelSendResult = sentImmediately
      ? await sendToChannel(suggestion.conversationId, editedText, tenant.id)
      : null;

    await auditLog.logSuggestionEdited(suggestion.id, "operator", suggestion.suggestedReply, editedText);
    await auditLog.logMessageSent(message.id, suggestion.conversationId, "operator", "user");

    res.json({ suggestion, message, delayResult, scheduledJob, sentImmediately, channelSendResult });
  } catch (error) {
    console.error("Error editing suggestion:", error);
    res.status(500).json({ error: "Failed to edit suggestion" });
  }
});

router.post("/api/suggestions/:id/reject", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const rejectUser = await getUserForConversations(req.userId ?? "");
    if (!rejectUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const suggestion = await storage.getAiSuggestion(req.params.id, rejectUser.tenantId);
    if (!suggestion) {
      return res.status(404).json({ error: "Suggestion not found" });
    }

    await storage.updateAiSuggestion(req.params.id, rejectUser.tenantId, { status: "rejected" });
    await storage.createHumanAction({
      suggestionId: suggestion.id,
      action: "reject",
      originalText: suggestion.suggestedReply,
      reason: req.body.reason,
    });

    const rejectMessages = await storage.getMessagesByConversation(suggestion.conversationId, rejectUser.tenantId);
    const lastCustomerMsgReject = [...rejectMessages].reverse().find(m => m.role === "customer");
    if (lastCustomerMsgReject) {
      await recordTrainingSample({
        suggestion,
        userMessage: lastCustomerMsgReject.content,
        finalAnswer: null,
        outcome: "REJECTED",
        tenantId: rejectUser.tenantId,
        rejectionReason: req.body.reason || null,
      });
    }

    await addToLearningQueue({
      suggestion,
      outcome: "REJECTED",
      messageCount: rejectMessages.length,
      tenantId: rejectUser.tenantId,
      conversationId: suggestion.conversationId,
    });

    const messages = await storage.getMessagesBySuggestionId?.(suggestion.id, rejectUser.tenantId);
    if (messages) {
      for (const msg of messages) {
        await cancelDelayedMessage(msg.id, "rejected");
      }
    }

    await auditLog.logSuggestionRejected(suggestion.id, "operator", req.body.reason);

    res.json({ success: true });
  } catch (error) {
    console.error("Error rejecting suggestion:", error);
    res.status(500).json({ error: "Failed to reject suggestion" });
  }
});

router.post("/api/suggestions/:id/escalate", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const escalateUser = await getUserForConversations(req.userId ?? "");
    if (!escalateUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const suggestion = await storage.getAiSuggestion(req.params.id, escalateUser.tenantId);
    if (!suggestion) {
      return res.status(404).json({ error: "Suggestion not found" });
    }

    await storage.updateAiSuggestion(req.params.id, escalateUser.tenantId, { status: "rejected" });
    await storage.updateConversation(suggestion.conversationId, escalateUser.tenantId, { status: "escalated" });

    const messages = await storage.getMessagesBySuggestionId?.(suggestion.id, escalateUser.tenantId);
    if (messages) {
      for (const msg of messages) {
        await cancelDelayedMessage(msg.id, "escalated");
      }
    }

    const escalation = await storage.createEscalationEvent({
      conversationId: suggestion.conversationId,
      reason: suggestion.intent || "manual_escalation",
      summary: `AI suggestion escalated for review. Intent: ${suggestion.intent}`,
      suggestedResponse: suggestion.suggestedReply,
      clarificationNeeded: suggestion.questionsToAsk?.join(", ") || null,
      status: "pending",
    }, escalateUser.tenantId);

    await storage.createHumanAction({
      suggestionId: suggestion.id,
      action: "escalate",
      originalText: suggestion.suggestedReply,
    });

    await auditLog.logConversationEscalated(
      suggestion.conversationId,
      escalation.id,
      suggestion.intent || "manual_escalation",
      "operator"
    );

    res.json({ escalation });
  } catch (error) {
    console.error("Error escalating suggestion:", error);
    res.status(500).json({ error: "Failed to escalate" });
  }
});

// ============ DECISION SETTINGS ROUTES ============

router.get("/api/settings/decision", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const decisionSettingsUser = await storage.getUser(req.userId!);
    if (!decisionSettingsUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const tenantId = decisionSettingsUser.tenantId;

    const settings = await storage.getDecisionSettings(tenantId);
    
    const { DEFAULT_SETTINGS } = await import("../services/decision-engine");
    res.json(settings || { ...DEFAULT_SETTINGS, tenantId });
  } catch (error) {
    console.error("Error fetching decision settings:", error);
    res.status(500).json({ error: "Failed to fetch decision settings" });
  }
});

router.patch("/api/settings/decision", requireAuth, requirePermission("MANAGE_AUTOSEND"), async (req: Request, res: Response) => {
  try {
    const decisionPatchUser = await storage.getUser(req.userId!);
    if (!decisionPatchUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const tenant = { id: decisionPatchUser.tenantId };

    const { tAuto, tEscalate, autosendAllowed, intentsAutosendAllowed, intentsForceHandoff } = req.body;

    if (tAuto !== undefined && (tAuto < 0 || tAuto > 1)) {
      return res.status(400).json({ error: "tAuto must be between 0 and 1" });
    }
    if (tEscalate !== undefined && (tEscalate < 0 || tEscalate > 1)) {
      return res.status(400).json({ error: "tEscalate must be between 0 and 1" });
    }
    if (tAuto !== undefined && tEscalate !== undefined && tAuto < tEscalate) {
      return res.status(400).json({ error: "tAuto must be greater than or equal to tEscalate" });
    }

    if (autosendAllowed === true) {
      const { calculateReadinessScore, READINESS_THRESHOLD } = await import("../services/readiness-score-service");
      const { isFeatureEnabled } = await import("../services/feature-flags");
      
      const result = await calculateReadinessScore(
        tenant.id,
        storage,
        (flag: string) => isFeatureEnabled(flag)
      );

      if (result.score < READINESS_THRESHOLD) {
        auditLog.setContext({ tenantId: tenant.id });
        await auditLog.log(
          "settings_updated" as any,
          "tenant",
          tenant.id,
          req.userId || "system",
          req.userId ? "user" : "system",
          { action: "autosend_blocked_readiness", score: result.score, threshold: READINESS_THRESHOLD }
        );

        return res.status(409).json({
          error: "Readiness score too low",
          message: `Невозможно включить автоотправку. Текущий показатель готовности: ${result.score}%, требуется: ${READINESS_THRESHOLD}%`,
          score: result.score,
          threshold: READINESS_THRESHOLD,
          recommendations: result.recommendations,
        });
      }
    }

    const updated = await storage.upsertDecisionSettings({
      tenantId: tenant.id,
      tAuto,
      tEscalate,
      autosendAllowed,
      intentsAutosendAllowed,
      intentsForceHandoff,
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating decision settings:", error);
    res.status(500).json({ error: "Failed to update decision settings" });
  }
});

// ============ HUMAN DELAY SETTINGS ROUTES ============

router.get("/api/settings/human-delay", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const humanDelayUser = await storage.getUser(req.userId!);
    if (!humanDelayUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const tenantId = humanDelayUser.tenantId;

    const settings = await storage.getHumanDelaySettings(tenantId);
    const { getDefaultHumanDelaySettings } = await import("../services/human-delay-engine");
    res.json(settings || getDefaultHumanDelaySettings(tenantId));
  } catch (error) {
    console.error("Error fetching human delay settings:", error);
    res.status(500).json({ error: "Failed to fetch human delay settings" });
  }
});

const humanDelaySettingsValidation = z.object({
  enabled: z.boolean().optional(),
  delayProfiles: z.record(z.string(), z.object({
    baseMin: z.number().min(0),
    baseMax: z.number().min(0),
    typingSpeed: z.number().min(1),
    jitter: z.number().min(0),
  })).optional(),
  nightMode: z.enum(["AUTO_REPLY", "DELAY", "DISABLE"]).optional(),
  nightDelayMultiplier: z.number().min(1).max(10).optional(),
  nightAutoReplyText: z.string().optional(),
  minDelayMs: z.number().min(0).optional(),
  maxDelayMs: z.number().min(0).optional(),
  typingIndicatorEnabled: z.boolean().optional(),
}).refine((data) => {
  if (data.minDelayMs !== undefined && data.maxDelayMs !== undefined) {
    return data.minDelayMs <= data.maxDelayMs;
  }
  return true;
}, { message: "minDelayMs must be <= maxDelayMs" });

router.patch("/api/settings/human-delay", requireAuth, requirePermission("MANAGE_AUTOSEND"), async (req: Request, res: Response) => {
  try {
    const humanDelayPatchUser = await storage.getUser(req.userId!);
    if (!humanDelayPatchUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const parseResult = humanDelaySettingsValidation.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ 
        error: parseResult.error.errors[0]?.message || "Invalid request body" 
      });
    }

    const { 
      enabled, 
      delayProfiles, 
      nightMode, 
      nightDelayMultiplier,
      nightAutoReplyText,
      minDelayMs,
      maxDelayMs,
      typingIndicatorEnabled
    } = parseResult.data;

    const updated = await storage.upsertHumanDelaySettings({
      tenantId: humanDelayPatchUser.tenantId,
      enabled,
      delayProfiles,
      nightMode,
      nightDelayMultiplier,
      nightAutoReplyText,
      minDelayMs,
      maxDelayMs,
      typingIndicatorEnabled,
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating human delay settings:", error);
    res.status(500).json({ error: "Failed to update human delay settings" });
  }
});

// ============ DELAYED JOBS ADMIN ROUTES ============

router.get("/api/admin/delayed-jobs", requireAuth, requirePermission("VIEW_AUDIT_LOGS"), async (req: Request, res: Response) => {
  try {
    const jobs = await getDelayedJobs();
    const metrics = getQueueMetrics();
    res.json({ jobs, metrics });
  } catch (error) {
    console.error("Error fetching delayed jobs:", error);
    res.status(500).json({ error: "Failed to fetch delayed jobs" });
  }
});

// ============ ESCALATION ROUTES ============

router.get("/api/escalations", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const status = req.query.status as string;
    let escalations;
    if (status === "recent") {
      escalations = await storage.getRecentEscalations(user.tenantId, 5);
    } else if (status === "pending") {
      escalations = (await storage.getEscalationsByTenant(user.tenantId)).filter(e => e.status === "pending");
    } else {
      escalations = await storage.getEscalationsByTenant(user.tenantId);
    }
    res.json(escalations);
  } catch (error) {
    console.error("Error fetching escalations:", error);
    res.status(500).json({ error: "Failed to fetch escalations" });
  }
});

router.patch("/api/escalations/:id", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const escalUser = req.userId ? await storage.getUser(req.userId) : undefined;
    if (!escalUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const existingEscalation = await storage.getEscalationEvent(req.params.id, escalUser.tenantId);
    if (!existingEscalation) {
      return res.status(404).json({ error: "Escalation not found" });
    }
    const escalConv = await storage.getConversation(existingEscalation.conversationId, escalUser.tenantId);
    if (!escalConv || escalConv.tenantId !== escalUser.tenantId) {
      return res.status(404).json({ error: "Escalation not found" });
    }

    const { status } = req.body;
    const escalation = await storage.updateEscalationEvent(req.params.id, escalUser.tenantId, {
      status,
      handledAt: new Date(),
    });
    if (!escalation) {
      return res.status(404).json({ error: "Escalation not found" });
    }

    if (status === "handled" || status === "dismissed") {
      await storage.updateConversation(escalation.conversationId, escalUser.tenantId, { status: "active" });
    }

    res.json(escalation);
  } catch (error) {
    console.error("Error updating escalation:", error);
    res.status(500).json({ error: "Failed to update escalation" });
  }
});

// ============ CSAT ROUTES ============

router.post("/api/conversations/:id/csat", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const conversationId = req.params.id;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    const conversation = await storage.getConversationWithCustomer(conversationId, user.tenantId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    if (conversation.tenantId !== user.tenantId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const messages = await storage.getMessagesByConversation(conversationId, user.tenantId);
    const lastAiSuggestion = messages
      .filter(m => m.suggestionId)
      .map(m => m.suggestionId)
      .pop();

    let intent: string | null = null;
    let decision: string | null = null;

    if (lastAiSuggestion) {
      const suggestion = await storage.getAiSuggestion(lastAiSuggestion, user.tenantId);
      if (suggestion) {
        intent = suggestion.intent || null;
        decision = suggestion.decision || null;
      }
    }

    const { submitCsatRating } = await import("../services/csat-service");
    const result = await submitCsatRating({
      tenantId: user.tenantId,
      conversationId,
      rating,
      comment: comment || null,
      intent,
      decision,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    auditLog.setContext({ tenantId: user.tenantId });
    await auditLog.log(
      "settings_updated" as any,
      "conversation",
      conversationId,
      req.userId,
      "user",
      { action: "csat_submitted", rating, intent, decision }
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Error submitting CSAT:", error);
    res.status(500).json({ error: "Failed to submit CSAT rating" });
  }
});

router.get("/api/conversations/:id/csat", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const conversationId = req.params.id;
    const existing = await storage.getCsatRatingByConversation(conversationId);

    res.json({ submitted: !!existing, rating: existing?.rating || null });
  } catch (error) {
    console.error("Error checking CSAT:", error);
    res.status(500).json({ error: "Failed to check CSAT status" });
  }
});

// ============ CONVERSION ROUTES ============

router.post("/api/conversations/:id/conversion", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const conversationId = req.params.id;
    const { amount, currency } = req.body;

    if (!amount || typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    const { submitConversion } = await import("../services/conversion-service");
    const result = await submitConversion({
      tenantId: user.tenantId,
      conversationId,
      amount,
      currency: currency || "RUB",
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, conversion: result.conversion });
  } catch (error) {
    console.error("Error recording conversion:", error);
    res.status(500).json({ error: "Failed to record conversion" });
  }
});

router.get("/api/conversations/:id/conversion", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const conversationId = req.params.id;
    
    const conversation = await storage.getConversation(conversationId, user.tenantId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (conversation.tenantId !== user.tenantId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const { getConversionByConversation } = await import("../services/conversion-service");
    const conversion = await getConversionByConversation(conversationId);

    res.json({ 
      hasConversion: !!conversion, 
      amount: conversion?.amount || null,
      currency: conversion?.currency || null,
    });
  } catch (error) {
    console.error("Error checking conversion:", error);
    res.status(500).json({ error: "Failed to check conversion" });
  }
});

// ============ LOST DEALS ROUTES ============

router.post("/api/lost-deals", requireAuth, requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { conversationId, reason, notes } = req.body;
    if (!conversationId || !reason) {
      return res.status(400).json({ error: "conversationId and reason are required" });
    }

    const sanitizedNotes = notes ? sanitizeString(notes) : notes;

    const { LostDealsService } = await import("../services/lost-deals-service");
    const lostDealsService = new LostDealsService(storage);
    const lostDeal = await lostDealsService.recordManualLostDeal(
      user.tenantId,
      conversationId,
      reason,
      sanitizedNotes
    );

    res.status(201).json(lostDeal);
  } catch (error: any) {
    console.error("Error recording lost deal:", error);
    if (error.message?.includes("already recorded")) {
      return res.status(409).json({ error: error.message });
    }
    res.status(500).json({ error: "Failed to record lost deal" });
  }
});

// ============ TRAINING SAMPLES ROUTES ============

router.get("/api/admin/training-samples", requireAuth, requirePermission("MANAGE_TRAINING"), async (req: Request, res: Response) => {
  try {
    const trainingSamplesUser = await storage.getUser(req.userId!);
    if (!trainingSamplesUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const tenantId = trainingSamplesUser.tenantId;
    
    const outcome = req.query.outcome as TrainingOutcome | undefined;
    const samples = await getTrainingSamples(tenantId, outcome);
    res.json(samples);
  } catch (error) {
    console.error("Error fetching training samples:", error);
    res.status(500).json({ error: "Failed to fetch training samples" });
  }
});

router.post("/api/admin/training-samples/export", requireAuth, requirePermission("EXPORT_TRAINING_DATA"), async (req: Request, res: Response) => {
  try {
    const trainingExportUser = await storage.getUser(req.userId!);
    if (!trainingExportUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const tenantId = trainingExportUser.tenantId;
    
    const outcome = req.body.outcome as TrainingOutcome | undefined;
    const exportData = await exportTrainingSamples(tenantId, outcome);
    res.json(exportData);
  } catch (error) {
    console.error("Error exporting training samples:", error);
    res.status(500).json({ error: "Failed to export training samples" });
  }
});

// ============ TRAINING POLICIES ROUTES ============

router.get("/api/admin/training-policies", requireAuth, requirePermission("MANAGE_POLICIES"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await storage.getUser(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const tenantId = user.tenantId;

    const policy = await storage.getAiTrainingPolicy(tenantId);
    if (!policy) {
      return res.json({
        tenantId,
        alwaysEscalateIntents: [],
        forbiddenTopics: [],
        disabledLearningIntents: [],
        updatedAt: new Date(),
      });
    }
    res.json(policy);
  } catch (error) {
    console.error("Error fetching training policy:", error);
    res.status(500).json({ error: "Failed to fetch training policy" });
  }
});

router.put("/api/admin/training-policies", requireAuth, requirePermission("MANAGE_POLICIES"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await storage.getUser(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const tenantId = user.tenantId;

    const { alwaysEscalateIntents, forbiddenTopics, disabledLearningIntents } = req.body;
    
    const validIntentSet = new Set(VALID_INTENTS);
    const validateIntents = (intents: unknown[], fieldName: string): string[] | null => {
      if (!Array.isArray(intents)) return [];
      if (intents.length > TRAINING_POLICY_LIMITS.maxIntentsListSize) {
        return null;
      }
      const filtered = intents.filter((i): i is string => 
        typeof i === "string" && validIntentSet.has(i as any)
      );
      return filtered;
    };

    const validatedAlwaysEscalate = validateIntents(alwaysEscalateIntents ?? [], "alwaysEscalateIntents");
    const validatedDisabledLearning = validateIntents(disabledLearningIntents ?? [], "disabledLearningIntents");
    
    if (validatedAlwaysEscalate === null) {
      return res.status(400).json({ error: `alwaysEscalateIntents exceeds maximum of ${TRAINING_POLICY_LIMITS.maxIntentsListSize} items` });
    }
    if (validatedDisabledLearning === null) {
      return res.status(400).json({ error: `disabledLearningIntents exceeds maximum of ${TRAINING_POLICY_LIMITS.maxIntentsListSize} items` });
    }

    let validatedForbiddenTopics: string[] = [];
    if (Array.isArray(forbiddenTopics)) {
      if (forbiddenTopics.length > TRAINING_POLICY_LIMITS.maxForbiddenTopicsSize) {
        return res.status(400).json({ error: `forbiddenTopics exceeds maximum of ${TRAINING_POLICY_LIMITS.maxForbiddenTopicsSize} items` });
      }
      validatedForbiddenTopics = forbiddenTopics
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .map(t => t.trim().slice(0, TRAINING_POLICY_LIMITS.maxTopicLength));
    }

    const policy = await storage.upsertAiTrainingPolicy({
      tenantId,
      alwaysEscalateIntents: validatedAlwaysEscalate,
      forbiddenTopics: validatedForbiddenTopics,
      disabledLearningIntents: validatedDisabledLearning,
    });
    res.json(policy);
  } catch (error) {
    console.error("Error updating training policy:", error);
    res.status(500).json({ error: "Failed to update training policy" });
  }
});

// ============ LEARNING QUEUE ROUTES ============

router.get("/api/admin/learning-queue", requireAuth, requirePermission("MANAGE_TRAINING"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await storage.getUser(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const tenantId = user.tenantId;

    const minScore = req.query.minScore ? parseInt(req.query.minScore as string, 10) : undefined;
    const items = await storage.getLearningQueueByTenant(tenantId, minScore);
    
    res.json({
      items,
      total: items.length,
      minScore: minScore ?? 0,
    });
  } catch (error) {
    console.error("Error fetching learning queue:", error);
    res.status(500).json({ error: "Failed to fetch learning queue" });
  }
});

router.patch("/api/admin/learning-queue/:conversationId/review", requireAuth, requirePermission("MANAGE_TRAINING"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    
    const user = await storage.getUser(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    const item = await storage.getLearningQueueItem(req.params.conversationId);
    if (!item) {
      return res.status(404).json({ error: "Learning queue item not found" });
    }
    
    if (item.tenantId !== user.tenantId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const updated = await storage.updateLearningQueueItem(item.id, {
      status: "reviewed",
      reviewedBy: req.userId,
    });
    
    res.json(updated);
  } catch (error) {
    console.error("Error updating learning queue item:", error);
    res.status(500).json({ error: "Failed to update learning queue item" });
  }
});

export default router;
