import { Router } from "express";
import { db } from "../db";
import { maxPersonalAccounts, customers } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
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
      console.log(`[MaxPersonalWebhook] outgoingAPIMessageReceived full senderData:`, JSON.stringify(payload.senderData));
      const numericChatId = payload.senderData?.chatId;
      const senderSelf = payload.senderData?.sender;
      const idMessage = payload.idMessage;

      if (numericChatId && idMessage) {
        const normalized = numericChatId.includes("@") ? numericChatId : `${numericChatId}@c.us`;
        const localPart = normalized.split("@")[0];

        // Safety guard: if chatId == sender (our own account echoed back), skip migration.
        // This prevents overwriting the customer's externalId with our own account's internal ID.
        if (senderSelf && (numericChatId === senderSelf || normalized === senderSelf || localPart === senderSelf?.split("@")[0])) {
          console.warn(`[MaxPersonalWebhook] Skipping chatId migration — chatId matches sender (our own account): chatId=${normalized} sender=${senderSelf}`);
          return res.json({ ok: true });
        }
        // A numeric MAX ID is all-digits and shorter than a phone number.
        // Phone numbers in @c.us format are always >= 10 digits (RU: 11, others: 10-15).
        // MAX internal user IDs are typically 7-9 digits.
        // We treat chatId as a numeric MAX ID only when it is all-digits AND has fewer digits
        // than the customer's existing phone-based externalId (phone > numeric by definition).
        const isAllDigits = /^\d+$/.test(localPart);

        if (isAllDigits) {
          try {
            const customer = await storage.getCustomerByOutboundMessageId(tenantId, "max_personal", idMessage);

            if (customer) {
              const oldLocal = (customer.externalId ?? "").split("@")[0];
              // Only save the numeric MAX internal ID when the existing externalId is phone-based
              // (phone is longer than MAX internal ID by definition).
              const isPhoneBased = /^\d+$/.test(oldLocal) && oldLocal.length > localPart.length;

              if (isPhoneBased) {
                // Save the numeric MAX internal ID in metadata for inbound message matching.
                // Do NOT replace externalId — the phone-based chatId is required for sendMessage.
                const existingMeta = (customer.metadata as Record<string, unknown>) ?? {};
                if (existingMeta.maxInternalId !== localPart) {
                  await storage.updateCustomer(customer.id, tenantId, {
                    metadata: { ...existingMeta, maxInternalId: localPart },
                  });
                  console.log(`[MaxPersonalWebhook] Saved MAX internal ID for customer ${customer.id}: maxInternalId=${localPart} (externalId kept as ${customer.externalId})`);
                }
              }
            }
          } catch (err: any) {
            console.error(`[MaxPersonalWebhook] Failed to save maxInternalId for idMessage=${idMessage}:`, err.message);
          }
        }
      }
      return res.json({ ok: true });
    }

    if (payload.typeWebhook === "outgoingMessageStatus") {
      const body = req.body as any;
      console.log(`[MaxPersonalWebhook] outgoingMessageStatus: idMessage=${body.idMessage} status=${body.status} chatId=${body.senderData?.chatId ?? body.chatId ?? "?"}`);
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

    // Normalize chatId for storage.
    //
    // GREEN-API MAX uses three chatId formats:
    //   1. "79991234567@c.us"  — phone number (always 10+ digits before @c.us)
    //   2. "41837581"          — MAX internal user_id (short numeric, NO suffix)
    //   3. "-1001234567890"    — group_id (negative number, may carry @g.us)
    //
    // For phone-length numbers (10+ digits) without "@" we add the @c.us suffix so they
    // match customers created by start-conversation.
    // For short numeric IDs (< 10 digits) we keep them as-is — adding @c.us would produce
    // an invalid chatId that GREEN-API rejects with 400 on the next send.
    let normalizedChatId: string;
    if (sender.chatId.includes("@")) {
      normalizedChatId = sender.chatId;
    } else if (/^\d{10,}$/.test(sender.chatId)) {
      // Phone-length number — add @c.us to match the format used by start-conversation.
      normalizedChatId = `${sender.chatId}@c.us`;
    } else {
      // Short numeric MAX internal user_id or group_id — keep as-is.
      normalizedChatId = sender.chatId;
    }

    // If chatId is a pure-numeric value (either short MAX ID or a phone without @c.us),
    // try to resolve it to an existing customer.
    const incomingLocalPart = normalizedChatId.includes("@")
      ? normalizedChatId.split("@")[0]
      : normalizedChatId;
    if (/^\d+$/.test(incomingLocalPart)) {
      // 1. Exact match on the normalised form.
      const existsByExternalId = await storage.getCustomerByExternalId(tenantId, "max_personal", normalizedChatId);
      if (!existsByExternalId) {
        // 2. Legacy: some customers were stored with the wrong "shortId@c.us" format.
        //    Try that variant before falling back to metadata lookup.
        const legacyId = `${incomingLocalPart}@c.us`;
        const existsByLegacyId = await storage.getCustomerByExternalId(tenantId, "max_personal", legacyId);
        if (existsByLegacyId) {
          console.log(`[MaxPersonalWebhook] Matched legacy chatId format ${legacyId} → using as normalizedChatId`);
          normalizedChatId = legacyId;
        } else {
          // 3. Look for a customer who has this numeric ID as metadata.maxInternalId
          //    (set by outgoingAPIMessageReceived after we sent to them by phone number).
          const byInternalId = await db.query.customers.findFirst({
            where: and(
              eq(customers.tenantId, tenantId),
              eq(customers.channel, "max_personal"),
              sql`${customers.metadata}->>'maxInternalId' = ${incomingLocalPart}`
            ),
          });
          if (byInternalId) {
            console.log(`[MaxPersonalWebhook] Resolved MAX internal ID ${incomingLocalPart} → phone externalId: ${byInternalId.externalId}`);
            normalizedChatId = byInternalId.externalId;
          }
        }
      }
    }

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
