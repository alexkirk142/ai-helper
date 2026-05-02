/**
 * Utility for sending notifications via the Telegram escalation bot.
 * The bot token comes from the TELEGRAM_ESCALATION_BOT_TOKEN environment variable.
 * Each tenant configures their own chat_id (escalationChatId) in settings.
 */

export const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  telegram_personal: "Telegram",
  whatsapp: "WhatsApp",
  max_personal: "MAX (WhatsApp)",
  vk: "VK",
  marquiz_failed: "—",
};

/**
 * Sends a text message to the specified Telegram chat via the escalation bot.
 * Throws if the Telegram API returns an error.
 */
export async function sendEscalationBotMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });

  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) {
    throw new Error(`Telegram API error: ${json.description}`);
  }
}

/**
 * Sends a "failed lead" notification — client could not be reached on any channel.
 */
export async function notifyFailedLead(opts: {
  clientName?: string | null;
  phone?: string | null;
  telegramUsername?: string | null;
  preferredChannel?: string;
  failureReason?: string;
  botToken: string;
  chatId: string;
}): Promise<void> {
  const name = opts.clientName || "Неизвестный клиент";
  const phone = opts.phone || "—";
  const tgUser = opts.telegramUsername ? `@${opts.telegramUsername.replace(/^@/, "")}` : "—";
  const channel = opts.preferredChannel
    ? (CHANNEL_LABELS[opts.preferredChannel] ?? opts.preferredChannel)
    : "авто";

  const text = [
    `🚨 *Не удалось связаться с клиентом*`,
    ``,
    `👤 Клиент: ${name}`,
    `📱 Телефон: ${phone}`,
    `💬 Telegram: ${tgUser}`,
    `📡 Канал: ${channel}`,
    ``,
    `❗ Клиент не зарегистрирован ни в одном из мессенджеров.`,
    `Необходимо *позвонить* клиенту и уточнить удобный способ связи.`,
  ].join("\n");

  await sendEscalationBotMessage(opts.botToken, opts.chatId, text);
}

/**
 * Sends a "no reply" notification — client received the first message but hasn't replied in 15 min.
 */
export async function notifyNoReply(opts: {
  clientName?: string | null;
  phone?: string | null;
  channel: string;
  botToken: string;
  chatId: string;
}): Promise<void> {
  const name = opts.clientName || "Неизвестный клиент";
  const phone = opts.phone || "—";
  const channelLabel = CHANNEL_LABELS[opts.channel] ?? opts.channel;

  const text = [
    `⏰ *Клиент не отвечает*`,
    ``,
    `👤 Клиент: ${name}`,
    `📱 Телефон: ${phone}`,
    `📡 Канал: ${channelLabel}`,
    ``,
    `Клиент не ответил на первое сообщение в течение *15 минут*.`,
    `Рекомендуем позвонить вручную.`,
  ].join("\n");

  await sendEscalationBotMessage(opts.botToken, opts.chatId, text);
}
