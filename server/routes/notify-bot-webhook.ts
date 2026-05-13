import type { Request, Response } from "express";

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
  };
}

async function sendReply(botToken: string, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
}

export async function notifyBotWebhookHandler(req: Request, res: Response): Promise<void> {
  // Always respond 200 immediately so Telegram doesn't retry
  res.json({ ok: true });

  try {
    const { getSecret } = await import("../services/secret-resolver");
    const botToken = await getSecret({ scope: "global", keyName: "TELEGRAM_ESCALATION_BOT_TOKEN" });
    if (!botToken) return;

    const update: TelegramUpdate = req.body;
    const msg = update.message;
    if (!msg?.text) return;

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (text === "/start" || text.startsWith("/start ")) {
      const firstName = msg.from?.first_name ? `, ${msg.from.first_name}` : "";
      await sendReply(
        botToken,
        chatId,
        `✅ *Готово${firstName}!*\n\nВы подключили уведомления об окончании подписки.\n\nМы пришлём напоминание *за 3 дня* и *за 1 день* до того, как ваша подписка закончится — чтобы вы успели её продлить и не потеряли доступ к каналам.\n\nЕсли у вас есть вопросы — напишите нам.`,
      );
    }
  } catch (err) {
    console.error("[NotifyBot] Webhook handler error:", err);
  }
}

/**
 * Registers the Telegram webhook for the notification bot.
 * Called once on server startup. Safe to call repeatedly — Telegram is idempotent.
 */
export async function registerNotifyBotWebhook(appUrl: string): Promise<void> {
  try {
    const { getSecret } = await import("../services/secret-resolver");
    const botToken = await getSecret({ scope: "global", keyName: "TELEGRAM_ESCALATION_BOT_TOKEN" });
    if (!botToken) {
      console.log("[NotifyBot] No TELEGRAM_ESCALATION_BOT_TOKEN configured — webhook skipped");
      return;
    }

    const webhookUrl = `${appUrl}/webhooks/notify-bot`;
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message"] }),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (json.ok) {
      console.log(`[NotifyBot] Webhook registered: ${webhookUrl}`);
    } else {
      console.warn(`[NotifyBot] Webhook registration failed: ${json.description}`);
    }
  } catch (err) {
    console.error("[NotifyBot] Failed to register webhook:", err);
  }
}
