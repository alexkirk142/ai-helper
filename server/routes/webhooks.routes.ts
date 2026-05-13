import { Router } from "express";
import maxWebhookRouter from "./max-webhook";
import maxPersonalWebhookRouter from "./max-personal-webhook";
import marquizWebhookRouter from "./marquiz-webhook";
import marquizDebugRouter from "./marquiz-debug";
import { telegramWebhookHandler } from "./telegram-webhook";
import { whatsappWebhookHandler, whatsappWebhookVerifyHandler } from "./whatsapp-webhook";
import { webhookRateLimiter } from "../middleware/rate-limiter";
import { notifyBotWebhookHandler } from "./notify-bot-webhook";

const router = Router();

// Telegram webhooks
router.post("/webhooks/telegram", webhookRateLimiter, telegramWebhookHandler);
router.post("/api/webhook/telegram", webhookRateLimiter, telegramWebhookHandler);

// WhatsApp webhooks
router.get("/webhooks/whatsapp", whatsappWebhookVerifyHandler);
router.post("/webhooks/whatsapp", webhookRateLimiter, whatsappWebhookHandler);
router.get("/api/webhook/whatsapp", whatsappWebhookVerifyHandler);
router.post("/api/webhook/whatsapp", webhookRateLimiter, whatsappWebhookHandler);

// MAX webhook
router.use("/webhooks/max", maxWebhookRouter);

// MAX Personal (GREEN-API) webhook — ping probe must come before the wildcard router
router.get("/webhooks/max-personal/ping", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});
router.use("/webhooks/max-personal", webhookRateLimiter, maxPersonalWebhookRouter);

// Marquiz webhook
router.use("/webhooks/marquiz", webhookRateLimiter, marquizWebhookRouter);
router.use("/api/debug/marquiz", marquizDebugRouter);

// Notification bot (subscription reminders) webhook
router.post("/webhooks/notify-bot", webhookRateLimiter, notifyBotWebhookHandler);

export default router;
