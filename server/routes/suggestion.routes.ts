import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { requireAuth, requirePermission } from "../middleware/rbac";
import { aiRateLimiter, tenantAiLimiter } from "../middleware/rate-limiter";
import { featureFlagService } from "../services/feature-flags";
import { auditLog } from "../services/audit-log";
import { scheduleDelayedMessage, cancelDelayedMessage } from "../services/message-queue";
import { recordTrainingSample } from "../services/training-sample-service";
import { addToLearningQueue } from "../services/learning-score-service";
import { WhatsAppPersonalAdapter } from "../services/whatsapp-personal-adapter";
import { telegramAdapter } from "../services/telegram-adapter";
import { whatsappAdapter } from "../services/whatsapp-adapter";
import { maxAdapter } from "../services/max-adapter";
import { sanitizeForLog } from "../utils/sanitizer";

const router = Router();

async function getUserForConversations(userId: string) {
  let user = await storage.getUserByOidcId(userId);
  if (!user) {
    user = await storage.getUser(userId);
  }
  return user;
}

router.post("/api/conversations/:id/generate-suggestion", requireAuth, requirePermission("VIEW_CONVERSATIONS"), aiRateLimiter, tenantAiLimiter, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const genUser = await getUserForConversations(req.userId);
    if (!genUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { getAiBillingStatus } = await import("../services/cryptobot-billing");
    const aiBilling = await getAiBillingStatus(genUser.tenantId);
    if (!aiBilling.canAccess) {
      return res.status(402).json({ error: "SUBSCRIPTION_REQUIRED", message: "Active AI Agent subscription required", code: "SUBSCRIPTION_REQUIRED" });
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

    if (effectiveChannelType === "telegram_personal" && conversationDetail.customer?.externalId && effectiveChannelId) {
      try {
        const { telegramClientManager } = await import("../services/telegram-client-manager");
        const recipientId = conversationDetail.customer.externalId;

        console.log(`[Outbound] Sending Telegram message to ${recipientId} via channel ${effectiveChannelId}`);

        channelSendResult = await telegramClientManager.sendMessage(
          conversationDetail.tenantId,
          effectiveChannelId,
          recipientId,
          text,
        );

        if (channelSendResult.success) {
          console.log(`[Outbound] Telegram message sent: ${channelSendResult.externalMessageId}`);
        } else {
          console.error(`[Outbound] Telegram send failed: ${channelSendResult.error}`);
        }
      } catch (sendError: any) {
        console.error(`[Outbound] Telegram send error:`, sendError.message);
      }
    } else if (effectiveChannelType === "whatsapp_personal" && conversationDetail.customer?.externalId) {
      let recipientJid = conversationDetail.customer.externalId;
      if (!recipientJid.includes("@")) {
        recipientJid = `${recipientJid}@s.whatsapp.net`;
      }
      const waAdapter = new WhatsAppPersonalAdapter(tenantId);
      console.log(`[Outbound] Sending WhatsApp message to ${recipientJid}`);
      channelSendResult = await waAdapter.sendMessage(recipientJid, text);
      console.log(`[Outbound] Result:`, sanitizeForLog(channelSendResult));
    } else if (effectiveChannelType === "max_personal" && conversationDetail.customer?.externalId) {
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
    } else if (effectiveChannelType === "telegram" && conversationDetail.customer?.externalId) {
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
    } else if (effectiveChannelType === "whatsapp" && conversationDetail.customer?.externalId) {
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
    } else if (effectiveChannelType === "max" && conversationDetail.customer?.externalId) {
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
            delayResult,
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

    const { effectiveChannelType: approveChannelType } =
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
            delayResult,
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

    const { effectiveChannelType: editChannelType } =
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
      "operator",
    );

    res.json({ escalation });
  } catch (error) {
    console.error("Error escalating suggestion:", error);
    res.status(500).json({ error: "Failed to escalate" });
  }
});

export default router;
