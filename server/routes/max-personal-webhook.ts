import { Router } from "express";
import { db } from "../db";
import { maxPersonalAccounts } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import type { ParsedIncomingMessage, ParsedAttachment } from "../services/channel-adapter";
import { processIncomingMessageFull } from "../services/inbound-message-handler";
import { storage } from "../storage";

const router = Router();

interface GreenApiSenderData {
  chatId: string;
  chatName?: string;
  senderName?: string;
  sender?: string;
}

interface GreenApiFileData {
  downloadUrl: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
}

interface GreenApiMessageData {
  typeMessage:
    | "textMessage"
    | "imageMessage"
    | "videoMessage"
    | "audioMessage"
    | "voiceMessage"
    | "documentMessage"
    | "stickerMessage"
    | string;
  textMessageData?: { textMessage: string };
  fileMessageData?: GreenApiFileData;
}

interface GreenApiWebhook {
  typeWebhook: string;
  idMessage?: string;
  timestamp?: number;
  senderData?: GreenApiSenderData;
  messageData?: GreenApiMessageData;
}

function buildAttachment(msgData: GreenApiMessageData): ParsedAttachment | null {
  const fileData = msgData.fileMessageData;
  if (!fileData) return null;

  const typeMap: Record<string, ParsedAttachment["type"]> = {
    imageMessage: "image",
    videoMessage: "video",
    audioMessage: "audio",
    voiceMessage: "voice",
    documentMessage: "document",
    stickerMessage: "sticker",
  };

  const type: ParsedAttachment["type"] = typeMap[msgData.typeMessage] ?? "document";

  return {
    type,
    url: fileData.downloadUrl,
    mimeType: fileData.mimeType,
    fileName: fileData.fileName,
  };
}

// Public endpoint — no auth, GREEN-API posts here.
// Route includes accountId to prevent cross-tenant spoofing.
router.post("/:tenantId/:accountId", async (req, res) => {
  const { tenantId, accountId } = req.params;
  console.log(`[MaxPersonalWebhook] Incoming POST /${tenantId}/${accountId} typeWebhook=${(req.body as any)?.typeWebhook ?? "?"} ip=${req.ip}`);

  try {
    // Verify by both tenantId and accountId — prevents cross-tenant spoofing
    const account = await db.query.maxPersonalAccounts.findFirst({
      where: and(
        eq(maxPersonalAccounts.tenantId, tenantId),
        eq(maxPersonalAccounts.accountId, accountId),
      ),
    });

    if (!account) {
      console.warn(`[MaxPersonalWebhook] Unknown tenant/account: ${tenantId}/${accountId}`);
      return res.status(404).json({ error: "Account not found" });
    }

    const payload = req.body as GreenApiWebhook;

    // When we send a message via API, GREEN-API fires outgoingAPIMessageReceived with the
    // recipient's internal numeric chatId (e.g. "58240096@c.us").  This differs from the
    // phone-based chatId we used when creating the customer ("79786768846@c.us").
    // Capture the numeric chatId and update the customer record so that future inbound
    // webhooks (which always carry the numeric chatId) match the right customer.
    if (payload.typeWebhook === "outgoingAPIMessageReceived") {
      const numericChatId = payload.senderData?.chatId;
      const idMessage = payload.idMessage;

      if (numericChatId && idMessage) {
        const normalized = numericChatId.includes("@") ? numericChatId : `${numericChatId}@c.us`;
        const localPart = normalized.split("@")[0];
        // A numeric MAX ID is all-digits and shorter than a phone number.
        // Phone numbers in @c.us format are always >= 10 digits (RU: 11, others: 10-15).
        // MAX internal user IDs are typically 7-9 digits.
        // We treat chatId as a numeric MAX ID only when it is all-digits AND has fewer digits
        // than the customer's existing phone-based externalId (phone > numeric by definition).
        const isAllDigits = /^\d+$/.test(localPart);

        if (isAllDigits) {
          try {
            const customer = await storage.getCustomerByOutboundMessageId(tenantId, "max_personal", idMessage);

            if (customer && customer.externalId !== normalized) {
              const oldLocal = (customer.externalId ?? "").split("@")[0];
              // Migrate only when the old ID is longer (phone) and the new ID is shorter (numeric MAX ID).
              // This correctly handles all phone lengths (RU=11, others=10-15) without magic numbers.
              const isPhoneBased = /^\d+$/.test(oldLocal) && oldLocal.length > localPart.length;

              if (isPhoneBased) {
                await storage.updateCustomer(customer.id, tenantId, { externalId: normalized });
                console.log(`[MaxPersonalWebhook] Migrated customer ${customer.id} externalId: ${customer.externalId} → ${normalized}`);
              }
            }
          } catch (err: any) {
            console.error(`[MaxPersonalWebhook] Failed to remap chatId for idMessage=${idMessage}:`, err.message);
          }
        }
      }
      return res.json({ ok: true });
    }

    if (payload.typeWebhook !== "incomingMessageReceived") {
      return res.json({ ok: true });
    }

    const sender = payload.senderData;
    const msgData = payload.messageData;

    if (!sender?.chatId || !msgData) {
      return res.json({ ok: true });
    }

    const msgType = msgData.typeMessage;
    let text = "";
    const attachments: ParsedAttachment[] = [];

    if (msgType === "textMessage" && msgData.textMessageData) {
      text = msgData.textMessageData.textMessage || "";
    } else {
      const att = buildAttachment(msgData);
      if (att) {
        attachments.push(att);
        if (msgData.fileMessageData?.caption) {
          text = msgData.fileMessageData.caption;
        }
      }
    }

    // Normalize chatId to always include the "@c.us" suffix.
    // GREEN-API sometimes sends chatId without the suffix (e.g. "205361510" instead of
    // "205361510@c.us"), which would break the lookup against customers created by
    // start-conversation (which always appends "@c.us").
    // Rule: if chatId already contains "@" leave it untouched (covers @c.us and @g.us),
    // otherwise append "@c.us".
    const normalizedChatId = sender.chatId.includes("@")
      ? sender.chatId
      : `${sender.chatId}@c.us`;

    const parsed: ParsedIncomingMessage = {
      externalMessageId: payload.idMessage || `mp_${Date.now()}`,
      externalConversationId: normalizedChatId,
      externalUserId: normalizedChatId,
      text,
      timestamp: payload.timestamp ? new Date(payload.timestamp * 1000) : new Date(),
      channel: "max_personal",
      metadata: {
        // pushName / firstName are checked by inbound-message-handler for customer name
        pushName: sender.senderName || sender.chatName,
        senderName: sender.senderName || sender.chatName,
        chatId: normalizedChatId,
        accountId: account.accountId,
      },
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    // Acknowledge immediately so GREEN-API doesn't retry due to timeout.
    res.json({ ok: true });

    processIncomingMessageFull(tenantId, parsed).then(() => {
      console.log(`[MaxPersonalWebhook] Processed ${msgType} from ${sender.chatId} for tenant ${tenantId} account ${accountId}`);
    }).catch((err: Error) => {
      console.error(`[MaxPersonalWebhook] Processing error for ${tenantId}/${accountId}:`, err.message);
    });
  } catch (error: any) {
    console.error("[MaxPersonalWebhook] Error:", error.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Internal error" });
    }
  }
});

export default router;
