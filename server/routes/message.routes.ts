import { Router, type Request, type Response } from "express";
import { z } from "zod";
import multer from "multer";
import { storage } from "../storage";
import { requireAuth, requirePermission } from "../middleware/rbac";
import { conversationRateLimiter, tenantConversationLimiter } from "../middleware/rate-limiter";
import { featureFlagService } from "../services/feature-flags";
import { WhatsAppPersonalAdapter } from "../services/whatsapp-personal-adapter";
import { telegramAdapter } from "../services/telegram-adapter";
import { whatsappAdapter } from "../services/whatsapp-adapter";
import { maxAdapter } from "../services/max-adapter";
import type { ParsedAttachment } from "../services/channel-adapter";
import { recordTrainingSample } from "../services/training-sample-service";

const router = Router();

const ALLOWED_MESSAGE_MIME_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  // Audio
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  // Video
  "video/mp4",
  "video/webm",
  "video/ogg",
  // Documents
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// Multer instance for optional file uploads — memory storage, max 50 MB
const messageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MESSAGE_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

async function getUserForConversations(userId: string) {
  let user = await storage.getUserByOidcId(userId);
  if (!user) {
    user = await storage.getUser(userId);
  }
  return user;
}

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
      let effectiveAccountId: string | undefined =
        ((lastCustomerMsg?.metadata as any)?.accountId as string | undefined) ??
        (conversation.messages.find((m) => (m.metadata as any)?.accountId)?.metadata as any)?.accountId;
      // For telegram_personal: always override with the designated sender account
      // to avoid accidentally sending via the resolver account when the stored
      // accountId refers to a deleted/replaced Telegram session.
      if (effectiveChannelType === "telegram_personal") {
        try {
          const tgAccounts = await storage.getTelegramAccountsByTenant(conversation.tenantId);
          const senderAcc = tgAccounts.find(
            (a: any) => a.tgRole === "sender" || a.tgRole === "both"
          );
          if (senderAcc) {
            effectiveAccountId = senderAcc.id;
          }
        } catch {
          // keep existing effectiveAccountId as fallback
        }
      }

      console.log(
        `[OutboundHandler] channel=${effectiveChannelType}, channelId=${effectiveChannelId}, hasFile=${!!uploadedFile}`,
      );

      // ── Media send path ────────────────────────────────────────────────────
      let outboundAttachment: ParsedAttachment | undefined;

      if (uploadedFile && role === "owner" && conversation.messages.length > 0) {
        const { buffer, mimetype, size } = uploadedFile;
        // Multer decodes multipart header bytes as latin1; re-encode to get the real UTF-8 filename.
        const originalname = Buffer.from(uploadedFile.originalname, "latin1").toString("utf8");

        if (effectiveChannelType === "telegram_personal" && conversation.customer?.externalId && effectiveChannelId) {
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
              effectiveAccountId,
            );

            if (sendResult.success && sendResult.externalMessageId) {
              const accountId = sendResult.accountId || effectiveChannelId;
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

        if (effectiveChannelType === "telegram" && conversation.customer?.externalId) {
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

        if (effectiveChannelType === "max_personal" && conversation.customer?.externalId) {
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

        if (effectiveChannelType === "whatsapp_personal" && conversation.customer?.externalId) {
          try {
            const adapter = new WhatsAppPersonalAdapter(conversation.tenantId);
            let recipientJid = conversation.customer.externalId;
            if (!recipientJid.includes("@")) recipientJid = `${recipientJid}@s.whatsapp.net`;
            const { buffer, mimetype, size } = uploadedFile;
            const originalname = Buffer.from(uploadedFile.originalname, "latin1").toString("utf8");

            const sendResult = await adapter.sendMediaMessage(
              recipientJid,
              buffer,
              mimetype,
              originalname,
              content.trim() || undefined,
            );

            if (sendResult.success) {
              outboundAttachment = buildAttachmentMeta(mimetype, originalname, size, {});
              console.log(`[OutboundHandler] WhatsApp Personal media sent: msgId=${sendResult.externalMessageId}`);
            } else {
              console.error(`[OutboundHandler] WhatsApp Personal media send failed: ${sendResult.error}`);
            }
          } catch (sendError: any) {
            console.error(`[OutboundHandler] WhatsApp Personal media send error:`, sendError.message);
          }
        }
      }

      // If a file was uploaded but we failed to send it, return an error immediately
      // so the client shows a notification and no empty message bubble is saved to DB.
      if (uploadedFile && role === "owner" && !outboundAttachment) {
        return res.status(500).json({ error: "Не удалось отправить файл. Попробуйте ещё раз." });
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

      // ── Auto-Harvest: record operator manual messages as training samples ───
      // When an operator writes a reply without using an AI suggestion, capture
      // it as a high-value training example (outcome=OPERATOR_MANUAL).
      if (role === "owner" && content.trim().length > 0) {
        try {
          const autoLearningEnabled = await featureFlagService.isEnabled("AUTO_LEARNING_ENABLED", msgUser.tenantId);
          if (autoLearningEnabled) {
            const allMessages = conversation.messages;
            const customerMessages = allMessages.filter(m => m.role === "customer");
            const lastCustomerMsg = customerMessages[customerMessages.length - 1];

            if (lastCustomerMsg) {
              // Deduplication: check if a training sample already exists for this
              // conversation + userMessage combination
              const convSamples = await storage.getAiTrainingSamplesByConversation(req.params.id, msgUser.tenantId);
              const alreadyExists = convSamples.some(
                s => s.userMessage === lastCustomerMsg.content
              );

              if (!alreadyExists) {
                // Synthetic AiSuggestion-like object — only the fields accessed by recordTrainingSample:
                // suggestion.conversationId, suggestion.suggestedReply, suggestion.intent, suggestion.decision
                const syntheticSuggestion = {
                  conversationId: req.params.id,
                  suggestedReply: "",
                  intent: null,
                  decision: null,
                };
                await recordTrainingSample({
                  suggestion: syntheticSuggestion as any,
                  userMessage: lastCustomerMsg.content,
                  finalAnswer: content.trim(),
                  outcome: "OPERATOR_MANUAL",
                  tenantId: msgUser.tenantId,
                });
                console.log(`[AutoHarvest] Recorded OPERATOR_MANUAL sample for conv=${req.params.id}`);
              }
            }
          }
        } catch (harvestError: any) {
          console.error("[AutoHarvest] Failed to record training sample:", harvestError.message);
        }
      }

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
        if (effectiveChannelType === "whatsapp_personal" && conversation.customer?.externalId) {
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

        if (effectiveChannelType === "telegram_personal" && conversation.customer?.externalId && effectiveChannelId) {
          try {
            const { telegramClientManager } = await import("../services/telegram-client-manager");
            const recipientId = conversation.customer.externalId;
            const sendResult = await telegramClientManager.sendMessage(
              conversation.tenantId,
              effectiveChannelId,
              recipientId,
              content.trim(),
              { preferAccountId: effectiveAccountId },
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

        if (effectiveChannelType === "max_personal" && conversation.customer?.externalId) {
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
    } catch (error: any) {
      if (error instanceof multer.MulterError || error.message?.startsWith("File type not allowed")) {
        return res.status(400).json({ error: error.message });
      }
      console.error("Error sending message:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  },
);

/** Maps MIME type to a ParsedAttachment, merging any extra fields (url, fileId). */
router.delete("/api/conversations/:id/messages/:msgId", requireAuth, requirePermission("SEND_MESSAGES"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const conversation = await storage.getConversation(req.params.id, user.tenantId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const deleted = await storage.deleteMessage(req.params.msgId, user.tenantId);
    if (!deleted) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

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

export default router;
