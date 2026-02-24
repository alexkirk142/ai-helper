import type { Request, Response, NextFunction } from "express";
import { WhatsAppAdapter, whatsappAdapter } from "../services/whatsapp-adapter";
import { featureFlagService } from "../services/feature-flags";
import { auditLog } from "../services/audit-log";

export async function whatsappWebhookVerifyHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const isEnabled = await featureFlagService.isEnabled("WHATSAPP_CHANNEL_ENABLED");
    if (!isEnabled) {
      console.log("[WhatsAppWebhook] Channel disabled, rejecting verification");
      res.status(403).send("Channel disabled");
      return;
    }

    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") {
        query[key] = value;
      }
    }

    const result = whatsappAdapter.verifyWebhookChallenge(query);

    if (!result.valid) {
      console.warn(`[WhatsAppWebhook] Challenge verification failed: ${result.error}`);
      res.status(403).send(result.error || "Verification failed");
      return;
    }

    console.log("[WhatsAppWebhook] Challenge verified successfully");
    res.status(200).send(result.challenge);
  } catch (error) {
    console.error("[WhatsAppWebhook] Verification error:", error);
    res.status(500).send("Internal server error");
  }
}

export async function whatsappWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const isEnabled = await featureFlagService.isEnabled("WHATSAPP_CHANNEL_ENABLED");
    if (!isEnabled) {
      console.log("[WhatsAppWebhook] Channel disabled, ignoring webhook");
      res.status(200).json({ ok: true, ignored: true, reason: "channel_disabled" });
      return;
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") {
        headers[key.toLowerCase()] = value;
      }
    }

    const rawBody = (req as any).rawBody;
    const bodyForVerification = rawBody instanceof Buffer 
      ? rawBody.toString("utf8") 
      : JSON.stringify(req.body);
    const verifyResult = whatsappAdapter.verifyWebhook(headers, bodyForVerification);

    if (!verifyResult.valid) {
      console.warn(`[WhatsAppWebhook] Signature verification failed: ${verifyResult.error}`);
      res.status(401).json({ ok: false, error: verifyResult.error });
      return;
    }

    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      res.status(400).json({ ok: false, error: "Invalid request body" });
      return;
    }

    if (payload.object !== "whatsapp_business_account") {
      res.status(200).json({ ok: true, ignored: true, reason: "not_whatsapp_event" });
      return;
    }

    const parsed = whatsappAdapter.parseIncomingMessage(payload);

    if (!parsed) {
      const hasStatuses = payload.entry?.some((e: any) =>
        e.changes?.some((c: any) => c.value?.statuses?.length > 0)
      );

      if (hasStatuses) {
        console.log("[WhatsAppWebhook] Status update received, acknowledging");
        res.status(200).json({ ok: true, type: "status_update" });
        return;
      }

      console.log("[WhatsAppWebhook] No parseable message in payload");
      res.status(200).json({ ok: true, ignored: true, reason: "no_message" });
      return;
    }

    console.log(
      `[WhatsAppWebhook] Received message from ${parsed.externalUserId}: "${parsed.text.substring(0, 50)}..."`
    );

    await auditLog.log(
      "message_received" as any,
      "message",
      parsed.externalMessageId,
      "system",
      "system",
      {
        channel: "whatsapp",
        senderId: parsed.externalUserId,
        textPreview: parsed.text.substring(0, 100),
        metadata: parsed.metadata,
      }
    );

    res.status(200).json({
      ok: true,
      processed: true,
      messageId: parsed.externalMessageId,
      senderId: parsed.externalUserId,
    });
  } catch (error) {
    console.error("[WhatsAppWebhook] Error processing webhook:", error);
    res.status(200).json({
      ok: true,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

export function clearProcessedMessages(): void {
  whatsappAdapter.clearProcessedMessages();
}

export function getProcessedMessageCount(): number {
  return whatsappAdapter.getProcessedMessageCount();
}
