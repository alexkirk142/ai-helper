import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { maxAdapter, MaxWebhookPayload } from "../services/max-adapter";
import { featureFlagService } from "../services/feature-flags";
import { auditLog } from "../services/audit-log";
import { processInboundMessage } from "../services/channel-adapter";

const router = Router();

const MAX_WEBHOOK_SECRET = process.env.MAX_WEBHOOK_SECRET;

const processedMessageIds = new Set<string>();
const MAX_PROCESSED_IDS = 10000;

function addProcessedId(id: string): boolean {
  if (processedMessageIds.has(id)) {
    return false;
  }

  processedMessageIds.add(id);

  if (processedMessageIds.size > MAX_PROCESSED_IDS) {
    const iterator = processedMessageIds.values();
    const firstValue = iterator.next().value;
    if (firstValue) {
      processedMessageIds.delete(firstValue);
    }
  }

  return true;
}

router.post("/", async (req: Request, res: Response) => {
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();

  try {
    const isEnabled = await featureFlagService.isEnabled("MAX_CHANNEL_ENABLED");

    if (!isEnabled) {
      console.log(`[MaxWebhook] Channel disabled, ignoring webhook (requestId: ${requestId})`);
      await auditLog.log(
        "message_sent" as any,
        "webhook",
        "max",
        "system",
        "system",
        {
          action: "ignored",
          reason: "MAX_CHANNEL_ENABLED is false",
          requestId,
        }
      );
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    if (MAX_WEBHOOK_SECRET) {
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") {
          headers[key] = value;
        }
      }

      const verifyResult = maxAdapter.verifyWebhook(headers, req.body, MAX_WEBHOOK_SECRET);
      if (!verifyResult.valid) {
        console.warn(`[MaxWebhook] Verification failed: ${verifyResult.error}`);
        res.status(401).json({ ok: false, error: "Webhook verification failed" });
        return;
      }
    }

    const payload = req.body as MaxWebhookPayload;

    const result = await processInboundMessage("max", payload);

    if (!result.success || !result.parsed) {
      console.log(`[MaxWebhook] Parse failed or non-message update: ${result.error}`);
      res.status(200).json({ ok: true });
      return;
    }

    const { parsed } = result;

    const idempotencyKey = `max_${parsed.externalMessageId}`;
    if (!addProcessedId(idempotencyKey)) {
      console.log(`[MaxWebhook] Duplicate message ignored: ${parsed.externalMessageId}`);
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    console.log(
      `[MaxWebhook] Received message from user ${parsed.externalUserId}: "${parsed.text.substring(0, 50)}..."`
    );

    await auditLog.log(
      "conversation_created" as any,
      "message",
      parsed.externalMessageId,
      "system",
      "system",
      {
        channel: "max",
        externalUserId: parsed.externalUserId,
        externalConversationId: parsed.externalConversationId,
        textPreview: parsed.text.substring(0, 100),
        requestId,
      }
    );

    res.status(200).json({
      ok: true,
      received: {
        messageId: parsed.externalMessageId,
        userId: parsed.externalUserId,
        chatId: parsed.externalConversationId,
      },
    });
  } catch (error) {
    console.error("[MaxWebhook] Error processing webhook:", error);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/health", async (_req: Request, res: Response) => {
  const isEnabled = await featureFlagService.isEnabled("MAX_CHANNEL_ENABLED");

  res.json({
    channel: "max",
    enabled: isEnabled,
    webhookConfigured: !!MAX_WEBHOOK_SECRET,
    tokenConfigured: !!process.env.MAX_TOKEN,
  });
});

router.post("/verify-auth", async (_req: Request, res: Response) => {
  const result = await maxAdapter.verifyAuth();

  if (result.success) {
    res.json({
      ok: true,
      bot: {
        id: result.botInfo?.user_id,
        name: result.botInfo?.first_name,
        username: result.botInfo?.username,
      },
    });
  } else {
    res.status(401).json({ ok: false, error: result.error });
  }
});

export default router;
