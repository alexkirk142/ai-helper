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

/** Data from the lead form, used to enrich escalation notifications. */
export interface LeadInfo {
  quizName?: string | null;
  // Automotive-specific (optional — present only for automotive quizzes)
  carInfo?: string | null;
  vin?: string | null;
  city?: string | null;
  gearboxType?: string | null;
  engineType?: string | null;
  engineVolume?: string | null;
  engineModel?: string | null;
  tireSeason?: string | null;
  tireMethod?: string | null;
  tireWidth?: string | null;
  tireHeight?: string | null;
  tireDiameter?: string | null;
  // Generic: all raw fields from non-automotive quizzes / external forms
  rawFields?: Record<string, string> | null;
}

/** Escapes Markdown special characters in user-supplied strings. */
function escapeMd(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/[*_`[\]]/g, "\\$&");
}

/**
 * Formats lead application data as a block of lines for inclusion in a notification.
 * Handles both automotive (KPP/engine/tires) and generic (rawFields) leads.
 * Only non-empty fields are shown.
 */
function formatLeadInfo(lead: LeadInfo): string {
  const lines: string[] = [];

  if (lead.quizName) lines.push(`📋 Заявка: ${escapeMd(lead.quizName)}`);

  // Automotive fields
  if (lead.carInfo)     lines.push(`🚗 Автомобиль: ${escapeMd(lead.carInfo)}`);
  if (lead.vin)         lines.push(`🔑 VIN: ${escapeMd(lead.vin)}`);
  if (lead.city)        lines.push(`🏙 Город: ${escapeMd(lead.city)}`);
  if (lead.gearboxType) lines.push(`⚙️ Тип КПП: ${escapeMd(lead.gearboxType)}`);

  const engineParts = [lead.engineType, lead.engineVolume, lead.engineModel].filter(Boolean);
  if (engineParts.length) lines.push(`🔧 Двигатель: ${engineParts.map(escapeMd).join(", ")}`);

  const tireParts: string[] = [];
  if (lead.tireSeason) tireParts.push(escapeMd(lead.tireSeason));
  if (lead.tireWidth && lead.tireHeight && lead.tireDiameter) {
    tireParts.push(`${escapeMd(lead.tireWidth)}/${escapeMd(lead.tireHeight)} ${escapeMd(lead.tireDiameter)}`);
  } else if (lead.tireMethod) {
    tireParts.push(escapeMd(lead.tireMethod));
  }
  if (tireParts.length) lines.push(`🛞 Шины: ${tireParts.join(", ")}`);

  // Generic fields (non-automotive): only shown when no automotive-specific data was emitted
  const hasAutomotiveData = lead.carInfo || lead.vin || lead.gearboxType || lead.engineType || tireParts.length;
  if (!hasAutomotiveData && lead.rawFields) {
    for (const [key, value] of Object.entries(lead.rawFields)) {
      if (value) lines.push(`• ${escapeMd(key)}: ${escapeMd(value)}`);
    }
  }

  return lines.join("\n");
}

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
  leadInfo?: LeadInfo | null;
  botToken: string;
  chatId: string;
}): Promise<void> {
  const name = escapeMd(opts.clientName || "Неизвестный клиент");
  const phone = escapeMd(opts.phone || "—");
  const tgUser = opts.telegramUsername ? `@${escapeMd(opts.telegramUsername.replace(/^@/, ""))}` : "—";
  const channel = opts.preferredChannel
    ? (CHANNEL_LABELS[opts.preferredChannel] ?? opts.preferredChannel)
    : "авто";

  const leadBlock = opts.leadInfo ? formatLeadInfo(opts.leadInfo) : "";

  const text = [
    `🚨 *Не удалось связаться с клиентом*`,
    ``,
    `👤 Клиент: ${name}`,
    `📱 Телефон: ${phone}`,
    `💬 Telegram: ${tgUser}`,
    `📡 Канал: ${channel}`,
    ...(leadBlock ? [``, leadBlock] : []),
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
  leadInfo?: LeadInfo | null;
  botToken: string;
  chatId: string;
}): Promise<void> {
  const name = escapeMd(opts.clientName || "Неизвестный клиент");
  const phone = escapeMd(opts.phone || "—");
  const channelLabel = CHANNEL_LABELS[opts.channel] ?? opts.channel;

  const leadBlock = opts.leadInfo ? formatLeadInfo(opts.leadInfo) : "";

  const text = [
    `⏰ *Клиент не отвечает*`,
    ``,
    `👤 Клиент: ${name}`,
    `📱 Телефон: ${phone}`,
    `📡 Канал: ${channelLabel}`,
    ...(leadBlock ? [``, leadBlock] : []),
    ``,
    `Клиент не ответил на первое сообщение в течение *15 минут*.`,
    `Рекомендуем позвонить вручную.`,
  ].join("\n");

  await sendEscalationBotMessage(opts.botToken, opts.chatId, text);
}
