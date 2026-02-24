import type { Request, Response, NextFunction } from "express";
import { TelegramAdapter, telegramAdapter } from "../services/telegram-adapter";
import { featureFlagService } from "../services/feature-flags";
import { auditLog } from "../services/audit-log";
import { processIncomingMessageFull } from "../services/inbound-message-handler";

const processedUpdateIds = new Set<number>();
const MAX_PROCESSED_IDS = 10000;

function cleanupProcessedIds(): void {
  if (processedUpdateIds.size > MAX_PROCESSED_IDS) {
    const iterator = processedUpdateIds.values();
    const firstValue = iterator.next().value;
    if (firstValue !== undefined) {
      processedUpdateIds.delete(firstValue);
    }
  }
}

export async function telegramWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const isEnabled = await featureFlagService.isEnabled("TELEGRAM_CHANNEL_ENABLED");
    if (!isEnabled) {
      console.log("[TelegramWebhook] Channel disabled, ignoring webhook");
      res.status(200).json({ ok: true, ignored: true, reason: "channel_disabled" });
      return;
    }

    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }

    const verifyResult = telegramAdapter.verifyWebhook(headers, req.body, webhookSecret);
    if (!verifyResult.valid) {
      console.warn(`[TelegramWebhook] Verification failed: ${verifyResult.error}`);
      res.status(401).json({ ok: false, error: verifyResult.error });
      return;
    }

    const update = req.body;
    if (!update || typeof update !== "object") {
      res.status(400).json({ ok: false, error: "Invalid request body" });
      return;
    }

    const updateId = update.update_id;
    if (typeof updateId === "number") {
      if (processedUpdateIds.has(updateId)) {
        console.log(`[TelegramWebhook] Duplicate update ignored: ${updateId}`);
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }
      processedUpdateIds.add(updateId);
      cleanupProcessedIds();
    }

    const parsed = telegramAdapter.parseIncomingMessage(update);

    if (!parsed) {
      console.log("[TelegramWebhook] No parseable message in update");
      res.status(200).json({ ok: true, ignored: true, reason: "no_message" });
      return;
    }

    console.log(
      `[TelegramWebhook] Received message from ${parsed.externalUserId} in chat ${parsed.externalConversationId}: "${parsed.text.substring(0, 50)}"`
    );

    await auditLog.log(
      "message_received" as any,
      "message",
      parsed.externalMessageId,
      "system",
      "system",
      {
        channel: "telegram",
        chatId: parsed.externalConversationId,
        userId: parsed.externalUserId,
        textPreview: parsed.text.substring(0, 100),
        attachmentCount: parsed.attachments?.length ?? 0,
        metadata: parsed.metadata,
      }
    );

    // Process through the standard inbound pipeline (save + AI suggestion)
    await processIncomingMessageFull("", parsed);

    res.status(200).json({
      ok: true,
      processed: true,
      messageId: parsed.externalMessageId,
      chatId: parsed.externalConversationId,
      userId: parsed.externalUserId,
    });
  } catch (error) {
    console.error("[TelegramWebhook] Error processing webhook:", error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

export function clearProcessedUpdates(): void {
  processedUpdateIds.clear();
}

export function getProcessedUpdateCount(): number {
  return processedUpdateIds.size;
}
