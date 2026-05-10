import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { VALID_INTENTS, TRAINING_POLICY_LIMITS } from "@shared/schema";
import { requireAuth, requireOperator, requireAdmin, requirePermission, requireTenant } from "../middleware/rbac";
import { aiRateLimiter, conversationRateLimiter, tenantAiLimiter, tenantConversationLimiter } from "../middleware/rate-limiter";
import { scheduleDelayedMessage, cancelDelayedMessage, getDelayedJobs, getQueueMetrics } from "../services/message-queue";
import { WhatsAppPersonalAdapter } from "../services/whatsapp-personal-adapter";
import { telegramAdapter } from "../services/telegram-adapter";
import { whatsappAdapter } from "../services/whatsapp-adapter";
import { maxAdapter } from "../services/max-adapter";
import { recordTrainingSample, getTrainingSamples, exportTrainingSamples, type TrainingOutcome } from "../services/training-sample-service";
import { addToLearningQueue } from "../services/learning-score-service";
import { sanitizeString, sanitizeForLog } from "../utils/sanitizer";
import type { ParsedAttachment } from "../services/channel-adapter";
import { sendEscalationBotMessage, CHANNEL_LABELS } from "../services/escalation-bot";
import { getSecret } from "../services/secret-resolver";

const router = Router();

async function getUserForConversations(userId: string) {
  let user = await storage.getUserByOidcId(userId);
  if (!user) {
    user = await storage.getUser(userId);
  }
  return user;
}

// ============ CONVERSATION ROUTES ============

const conversationsQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// Full-text search across customer name, phone and all message content
router.get("/api/conversations/search", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const q = (req.query.q as string | undefined)?.trim() ?? "";
    if (q.length < 2) {
      return res.status(400).json({ error: "Query must be at least 2 characters" });
    }
    const results = await storage.searchConversations(tenantId, q);
    res.json(results);
  } catch (error) {
    console.error("Error searching conversations:", error);
    res.status(500).json({ error: "Failed to search conversations" });
  }
});

router.get("/api/conversations", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const parsed = conversationsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten() });
    }
    const { status, limit, offset } = parsed.data;
    const safeLimit = Math.min(limit, 200);
    let conversations;
    if (status === "active") {
      conversations = await storage.getActiveConversations(tenantId);
    } else {
      conversations = await storage.getConversationsByTenant(tenantId, { limit: safeLimit, offset });
    }
    res.setHeader("X-Pagination-Limit", String(safeLimit));
    res.setHeader("X-Pagination-Offset", String(offset));
    res.json(conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

router.get("/api/conversations/channel-counts", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const counts = await storage.getConversationChannelCounts(req.tenantId!);
    res.json(counts);
  } catch (error) {
    console.error("Error fetching channel counts:", error);
    res.status(500).json({ error: "Failed to fetch channel counts" });
  }
});

router.get("/api/failed-leads", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const leads = await storage.getFailedLeads(req.tenantId!);
    res.json(leads);
  } catch (error) {
    console.error("Error fetching failed leads:", error);
    res.status(500).json({ error: "Failed to fetch failed leads" });
  }
});

router.get("/api/conversations/:id", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const detail = await storage.getConversationDetail(req.params.id, tenantId);
    if (!detail) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    
    if (detail.tenantId !== tenantId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    res.json(detail);
  } catch (error) {
    console.error("Error fetching conversation:", error);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

router.patch("/api/conversations/:id", requireAuth, requireOperator, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const conversation = await storage.getConversation(req.params.id, tenantId);
    if (!conversation || conversation.tenantId !== tenantId) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const { status, mode } = req.body;
    const previousStatus = conversation.status;

    const updated = await storage.updateConversation(req.params.id, tenantId, { status, mode });
    
    if (status === "resolved" && previousStatus !== "resolved") {
      const { triggerSummaryOnConversationResolved } = await import("../services/customer-summary-service");
      triggerSummaryOnConversationResolved(conversation.tenantId, conversation.customerId).catch(err => {
        console.error("Failed to trigger summary on conversation resolved:", err);
      });

      const { indexConversation } = await import("../services/conversation-rag-indexer");
      indexConversation(req.params.id, tenantId).catch(err => {
        console.error("[ConversationRAG] Failed to index resolved conversation:", err);
      });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating conversation:", error);
    res.status(500).json({ error: "Failed to update conversation" });
  }
});

router.delete("/api/conversations/:id", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const conversation = await storage.getConversation(req.params.id, tenantId);
    if (!conversation || conversation.tenantId !== tenantId) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    await storage.deleteConversation(req.params.id, tenantId);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting conversation:", error);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.post("/api/conversations/:id/mute", requireAuth, requireOperator, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const conversation = await storage.getConversation(req.params.id, tenantId);
    if (!conversation || conversation.tenantId !== tenantId) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    const { muted } = req.body as { muted: boolean };
    await storage.updateConversation(req.params.id, tenantId, { isMuted: muted });
    res.json({ success: true, isMuted: muted });
  } catch (error) {
    console.error("Error toggling conversation mute:", error);
    res.status(500).json({ error: "Failed to toggle mute" });
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

// ============ CONVERSION ROUTES ============

router.post("/api/conversations/:id/conversion", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const conversationId = req.params.id;
    const { amount, currency } = req.body;

    if (!amount || typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    const { submitConversion } = await import("../services/conversion-service");
    const result = await submitConversion({
      tenantId: tenantId,
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

router.get("/api/conversations/:id/conversion", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const conversationId = req.params.id;
    
    const conversation = await storage.getConversation(conversationId, tenantId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (conversation.tenantId !== tenantId) {
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

router.post("/api/lost-deals", requireAuth, requirePermission("VIEW_ANALYTICS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { conversationId, reason, notes } = req.body;
    if (!conversationId || !reason) {
      return res.status(400).json({ error: "conversationId and reason are required" });
    }

    const sanitizedNotes = notes ? sanitizeString(notes) : notes;

    const { LostDealsService } = await import("../services/lost-deals-service");
    const lostDealsService = new LostDealsService(storage);
    const lostDeal = await lostDealsService.recordManualLostDeal(
      tenantId,
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

router.get("/api/admin/training-samples", requireAuth, requirePermission("MANAGE_TRAINING"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    
    const outcome = req.query.outcome as TrainingOutcome | undefined;
    const samples = await getTrainingSamples(tenantId, outcome);
    res.json(samples);
  } catch (error) {
    console.error("Error fetching training samples:", error);
    res.status(500).json({ error: "Failed to fetch training samples" });
  }
});

router.post("/api/admin/training-samples/export", requireAuth, requirePermission("EXPORT_TRAINING_DATA"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    
    const outcome = req.body.outcome as TrainingOutcome | undefined;
    const exportData = await exportTrainingSamples(tenantId, outcome);
    res.json(exportData);
  } catch (error) {
    console.error("Error exporting training samples:", error);
    res.status(500).json({ error: "Failed to export training samples" });
  }
});

// ============ TRAINING POLICIES ROUTES ============

router.get("/api/admin/training-policies", requireAuth, requirePermission("MANAGE_POLICIES"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

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

router.put("/api/admin/training-policies", requireAuth, requirePermission("MANAGE_POLICIES"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

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

router.get("/api/admin/learning-queue", requireAuth, requirePermission("MANAGE_TRAINING"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

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

router.patch("/api/admin/learning-queue/:conversationId/review", requireAuth, requirePermission("MANAGE_TRAINING"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const item = await storage.getLearningQueueItem(req.params.conversationId);
    if (!item) {
      return res.status(404).json({ error: "Learning queue item not found" });
    }
    
    if (item.tenantId !== tenantId) {
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

// ============ CONVERSATION SUMMARY (ESCALATION BOT) ============

router.post("/api/conversations/:id/send-summary", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const conversationId = req.params.id;
    const conversation = await storage.getConversationWithCustomer(conversationId, tenantId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const tenant = await storage.getTenant(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const botToken = await getSecret({ scope: "global", keyName: "TELEGRAM_ESCALATION_BOT_TOKEN" });
    if (!botToken) {
      return res.status(400).json({ error: "Telegram escalation bot not configured" });
    }

    const chatId = tenant.escalationChatId?.trim();
    if (!chatId) {
      return res.status(400).json({ error: "Escalation chat ID not configured for this tenant" });
    }

    const messages = await storage.getMessagesByConversation(conversationId, tenantId);
    const customer = conversation.customer;

    const customerName = customer?.name || "Неизвестный клиент";
    const customerPhone = customer?.phone || "—";
    const customerChannel = customer?.channel || "—";
    const createdAt = new Date(conversation.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });

    const recentMessages = messages.slice(-15);
    const msgLines = recentMessages.map((m) => {
      const time = new Date(m.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      const role = m.role === "assistant" ? "🤖 Оператор/AI" : "👤 Клиент";
      const text = (m.content || "").slice(0, 200);
      return `${role} [${time}]: ${text}`;
    }).join("\n");

    const summaryText = [
      `📋 *Выжимка диалога*`,
      ``,
      `👤 Клиент: ${customerName}`,
      `📱 Телефон: ${customerPhone}`,
      `📡 Канал: ${CHANNEL_LABELS[customerChannel] ?? customerChannel}`,
      `📅 Начало: ${createdAt}`,
      ``,
      `💬 *Последние сообщения:*`,
      msgLines || "Сообщений нет",
      ``,
      `📌 Статус: ${conversation.status}`,
    ].join("\n");

    try {
      await sendEscalationBotMessage(botToken, chatId, summaryText);
    } catch (tgErr: any) {
      console.error(`[SendSummary] Telegram API error: ${tgErr.message}`);
      return res.status(502).json({ error: tgErr.message });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error sending summary:", error);
    res.status(500).json({ error: "Failed to send summary" });
  }
});

export default router;
