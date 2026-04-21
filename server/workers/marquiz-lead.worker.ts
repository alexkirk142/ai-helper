import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { asc, and, eq } from "drizzle-orm";
import { db } from "../db";
import { maxPersonalAccounts } from "../../shared/schema";
import { getRedisConnectionConfig } from "../services/message-queue";
import type { MarquizLeadJobData } from "../services/marquiz-lead-queue";
import { MaxPersonalAdapter } from "../services/max-personal-adapter";
import { maxStatusKey } from "../routes/max-personal-webhook";
import { telegramClientManager } from "../services/telegram-client-manager";
import { storage } from "../storage";
import type { Tenant } from "../../shared/schema";

const QUEUE_NAME = "marquiz_leads";
const ROTATION_KEY_PREFIX = "marquiz:rotation:";

const maxPersonalAdapter = new MaxPersonalAdapter();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) {
    return "7" + digits.slice(1);
  }
  return digits;
}

/** Format phone as GREEN-API chatId: "79991234567@c.us" */
function toMaxChatId(phone: string): string {
  return `${normalizePhone(phone)}@c.us`;
}

/** Check if current moment falls within tenant working hours */
function isWorkingHours(tenant: Tenant): boolean {
  try {
    const timezone = tenant.timezone || "Europe/Moscow";
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "12", 10);
    const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const current = h * 60 + m;

    const parseHM = (t: string | null | undefined, def: number) => {
      if (!t) return def;
      const [hh, mm] = t.split(":").map(Number);
      return hh * 60 + (mm || 0);
    };
    const start = parseHM(tenant.workingHoursStart, 9 * 60);
    const end = parseHM(tenant.workingHoursEnd, 18 * 60);

    return start <= end
      ? current >= start && current < end
      : current >= start || current < end;
  } catch {
    return true; // default to "working hours" on error
  }
}

/** Detect lead type by quiz name or filled fields */
function detectLeadType(data: MarquizLeadJobData): "engine" | "gearbox" | "tires" {
  const qn = data.quizName.toLowerCase();
  if (qn.includes("шин") || qn.includes("резин") || qn.includes("колес")) return "tires";
  if (data.tireSeason || data.tireWidth || data.tireDiameter) return "tires";
  if (qn.includes("двигател") || qn.includes("мотор")) return "engine";
  if (data.engineType || data.engineVolume || data.engineModel) return "engine";
  return "gearbox";
}

function buildResponseText(data: MarquizLeadJobData, tenant: Tenant): string {
  const afterHours = !isWorkingHours(tenant);
  const leadType = detectLeadType(data);

  const oohSuffix = afterHours
    ? "\n\nУтром приеду на работу, скину Вам подходящий вариант 👍"
    : "";

  if (leadType === "tires" && (tenant as any).templateTiresEnabled === false) {
    return `Здравствуйте! Получили вашу заявку. Свяжемся с вами в ближайшее время 👍${oohSuffix}`;
  }
  if (leadType === "engine" && (tenant as any).templateEngineEnabled === false) {
    return `Здравствуйте! Получили вашу заявку. Свяжемся с вами в ближайшее время 👍${oohSuffix}`;
  }
  if (leadType === "gearbox" && (tenant as any).templateGearboxEnabled === false) {
    return `Здравствуйте! Получили вашу заявку. Свяжемся с вами в ближайшее время 👍${oohSuffix}`;
  }

  if (leadType === "tires") {
    const lines: string[] = [];
    if (data.tireSeason)   lines.push(`🌦 Сезон: ${data.tireSeason}`);
    if (data.city)         lines.push(`📍 Город: ${data.city}`);

    const bySize = data.tireMethod?.toLowerCase().includes("размер");

    if (bySize && (data.tireWidth || data.tireHeight || data.tireDiameter)) {
      const size = [data.tireWidth, data.tireHeight, data.tireDiameter].filter(Boolean).join("/");
      lines.unshift(`🔧 Размер: ${size}`);
      const details = lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
      return `Здравствуйте! Получили вашу заявку на подбор шин.${details}\n\nВсё верно?${oohSuffix}`;
    } else {
      if (data.carInfo) lines.unshift(`🚗 Автомобиль: ${data.carInfo}`);
      const details = lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
      return `Здравствуйте! Получили вашу заявку на подбор шин.${details}\n\nВсё верно?${oohSuffix}`;
    }
  }

  if (leadType === "engine") {
    const lines: string[] = [];
    if (data.carInfo)      lines.push(`🚗 Автомобиль: ${data.carInfo}`);
    if (data.engineType)   lines.push(`⚙️ Тип: ${data.engineType}`);
    if (data.engineVolume) lines.push(`📦 Объём: ${data.engineVolume}`);
    if (data.engineModel)  lines.push(`🔧 Модель двигателя: ${data.engineModel}`);
    if (data.city)         lines.push(`📍 Город: ${data.city}`);
    if (data.vin)          lines.push(`🔑 VIN: ${data.vin}`);

    const details = lines.length > 0 ? `\n\n${lines.join("\n")}` : "";

    if (data.vin || data.engineModel) {
      return `Здравствуйте! Получили вашу заявку на подбор двигателя.${details}\n\nВсё верно?${oohSuffix}`;
    } else {
      return `Здравствуйте! Получили вашу заявку на подбор двигателя.${details}\n\nНапишите ВИН-код или маркировку двигателя — подберём точный вариант 🙏${oohSuffix}`;
    }
  }

  // Default: КПП
  const lines: string[] = [];
  if (data.carInfo)     lines.push(`🚗 Автомобиль: ${data.carInfo}`);
  if (data.gearboxType) lines.push(`⚙️ Тип КПП: ${data.gearboxType}`);
  if (data.city)        lines.push(`📍 Город: ${data.city}`);
  if (data.vin)         lines.push(`🔑 VIN: ${data.vin}`);

  const details = lines.length > 0 ? `\n\n${lines.join("\n")}` : "";

  if (data.vin) {
    return `Здравствуйте! Получили вашу заявку на подбор КПП.${details}\n\nВсё верно?${oohSuffix}`;
  } else {
    return `Здравствуйте! Получили вашу заявку на подбор КПП.${details}\n\nНапишите ВИН-код или маркировку коробки — подберём точный вариант 🙏${oohSuffix}`;
  }
}

/**
 * Pick the next MAX Personal account for this tenant using Redis round-robin.
 * Returns null if the tenant has no authorised accounts.
 */
async function getNextAccount(
  redis: IORedis,
  tenantId: string,
) {
  const accounts = await db
    .select()
    .from(maxPersonalAccounts)
    .where(
      and(
        eq(maxPersonalAccounts.tenantId, tenantId),
        eq(maxPersonalAccounts.status, "authorized"),
        eq(maxPersonalAccounts.autoReplyEnabled, true),
      ),
    )
    .orderBy(asc(maxPersonalAccounts.createdAt));

  if (accounts.length === 0) return null;
  if (accounts.length === 1) return accounts[0];

  const rotationKey = `${ROTATION_KEY_PREFIX}${tenantId}`;
  const counter = await redis.incr(rotationKey);
  return accounts[(counter - 1) % accounts.length];
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

async function processLead(job: Job<MarquizLeadJobData>, redis: IORedis): Promise<void> {
  const data = job.data;
  const tenantId = process.env.MARQUIZ_TENANT_ID ?? "";

  if (!tenantId) {
    console.error("[MarquizWorker] MARQUIZ_TENANT_ID env var is not set — skipping lead");
    return;
  }

  // Load tenant to access working hours / timezone
  const tenant = await storage.getTenant(tenantId);
  if (!tenant) {
    console.error(`[MarquizWorker] Tenant ${tenantId} not found`);
    return;
  }

  console.log(
    `[MarquizWorker] Processing lead: quiz="${data.quizName}", tgUsername="${data.telegramUsername}", jobId=${job.id}, workingHours=${isWorkingHours(tenant)}`,
  );

  const text = buildResponseText(data, tenant);
  const phone = `+${normalizePhone(data.phone)}`;
  const commonMeta = {
    source: "marquiz",
    quizName: data.quizName,
    gearboxType: data.gearboxType,
    engineType: data.engineType,
    carInfo: data.carInfo,
    vin: data.vin,
    city: data.city,
  };

  const hasPhone = data.phone && normalizePhone(data.phone).length >= 10;
  const preferred = data.preferredChannel; // "telegram" | "max" | undefined

  console.log(`[MarquizWorker] Channel routing: preferredChannel="${preferred ?? "auto"}", hasPhone=${!!hasPhone}, tgUsername="${data.telegramUsername}"`);

  // ══════════════════════════════════════════════════════════════════════════
  // STRICT ROUTING: respect the channel the client chose in Marquiz.
  // If preferred is set — use ONLY that channel, no cross-channel fallback.
  // If not set — use best-effort auto logic (Telegram first, then MAX).
  // ══════════════════════════════════════════════════════════════════════════

  // Helper: send via Telegram by phone (two-account importContacts strategy)
  const sendViaTelegramByPhone = async () => {
    const tgAccounts = await storage.getTelegramAccountsByTenant(tenantId);
    const hasTg = tgAccounts.some(a => a.status === "active" && a.isEnabled);
    if (!hasTg) return { success: false, error: "No active Telegram account" };

    console.log(`[MarquizWorker] Telegram two-account strategy for phone ${phone}`);
    const tgResult = await telegramClientManager.importContactAndSend(tenantId, phone, text);

    if (tgResult.success && tgResult.userId) {
      const senderAccountId = (tgResult as any).accountId ?? null;
      const senderChannelId = (tgResult as any).channelId ?? null;

      let customer = await storage.getCustomerByExternalId(tenantId, "telegram_personal", tgResult.userId);
      if (!customer) {
        customer = await storage.createCustomer(
          { tenantId, channel: "telegram_personal", externalId: tgResult.userId, phone,
            name: data.clientName || tgResult.firstName || null,
            metadata: { ...commonMeta, telegramUsername: tgResult.username ?? null, channelAccountId: senderAccountId } },
          tenantId,
        );
        console.log(`[MarquizWorker] TG customer created: ${customer.id}`);
      }
      // Pin conversation to the SENDER's channel so the outbound handler always
      // routes operator replies through the sender, not the resolver.
      // Without this, the client might reply to the resolver (which gets notified
      // by Telegram's importContacts), causing effectiveChannelId to resolve to
      // the resolver's channelId and sending operator replies from the resolver.
      const conversation = await storage.createConversation(
        { tenantId, customerId: customer.id, status: "active", mode: "learning",
          ...(senderChannelId ? { channelId: senderChannelId } : {}) },
        tenantId,
      );
      await storage.createMessage(
        { conversationId: conversation.id, role: "assistant", content: text,
          metadata: { source: "marquiz_autoresponse", channel: "telegram_personal", accountId: senderAccountId } },
        tenantId,
      );
      console.log(`[MarquizWorker] Done via Telegram phone — userId=${tgResult.userId}, channelId=${senderChannelId}`);
    }
    return tgResult;
  };

  // Helper: send via Telegram by username
  const sendViaTelegramByUsername = async () => {
    const tgAccounts = await storage.getTelegramAccountsByTenant(tenantId);
    // Prefer sender/both accounts — avoid using resolver-only accounts for client-facing sends
    const tgAccount =
      tgAccounts.find(a => a.status === "active" && a.isEnabled && (a as any).tgRole === "sender") ??
      tgAccounts.find(a => a.status === "active" && a.isEnabled && (a as any).tgRole === "both") ??
      tgAccounts.find(a => a.status === "active" && a.isEnabled && (a as any).tgRole !== "resolver") ??
      tgAccounts.find(a => a.status === "active" && a.isEnabled);
    if (!tgAccount) return { success: false, error: "No active Telegram account" };

    console.log(`[MarquizWorker] Telegram username @${data.telegramUsername} via account ${tgAccount.id}`);
    const tgResult = await telegramClientManager.sendMessageByUsername(tenantId, tgAccount.id, data.telegramUsername, text);

    if (tgResult.success && tgResult.userId) {
      let customer = await storage.getCustomerByExternalId(tenantId, "telegram_personal", tgResult.userId);
      if (!customer) {
        customer = await storage.createCustomer(
          { tenantId, channel: "telegram_personal", externalId: tgResult.userId, phone,
            name: data.clientName || tgResult.firstName || null,
            metadata: { ...commonMeta, telegramUsername: tgResult.username ?? data.telegramUsername, channelAccountId: tgAccount.id } },
          tenantId,
        );
        console.log(`[MarquizWorker] TG customer created: ${customer.id}`);
      }
      const conversation = await storage.createConversation(
        { tenantId, customerId: customer.id, status: "active", mode: "learning",
          ...((tgAccount as any).channelId ? { channelId: (tgAccount as any).channelId } : {}) },
        tenantId,
      );
      await storage.createMessage(
        { conversationId: conversation.id, role: "assistant", content: text,
          metadata: { source: "marquiz_autoresponse", channel: "telegram_personal", accountId: tgAccount.id, externalMessageId: tgResult.externalMessageId ?? null } },
        tenantId,
      );
      console.log(`[MarquizWorker] Done via Telegram username — @${data.telegramUsername}`);
    }
    return tgResult;
  };

  // Helper: send via MAX Personal
  const sendViaMAX = async (): Promise<{ success: boolean; error?: string }> => {
    if (!data.maxPhone || normalizePhone(data.maxPhone).length < 10) {
      return { success: false, error: "No valid MAX phone" };
    }
    const account = await getNextAccount(redis, tenantId);
    if (!account) return { success: false, error: "No authorised MAX account" };

    const chatId = toMaxChatId(data.maxPhone);
    console.log(`[MarquizWorker] Trying MAX account: ${account.label ?? account.accountId}`);

    let customer = await storage.getCustomerByExternalId(tenantId, "max_personal", chatId);
    if (!customer) {
      customer = await storage.createCustomer(
        { tenantId, channel: "max_personal", externalId: chatId, phone, name: data.clientName || null, metadata: commonMeta },
        tenantId,
      );
    }

    const conversation = await storage.createConversation(
      { tenantId, customerId: customer.id, status: "active", mode: "learning" }, tenantId,
    );

    const result = await maxPersonalAdapter.sendMessageForTenant(tenantId, chatId, text, undefined, account.accountId);

    if (!result.success) {
      await storage.updateConversation(conversation.id, tenantId, { status: "failed_delivery" });
      await storage.createMessage(
        { conversationId: conversation.id, role: "assistant", content: text,
          metadata: { source: "marquiz_autoresponse", accountId: account.accountId, failureReason: `MAX send failed: ${result.error}` } },
        tenantId,
      );
      return { success: false, error: result.error };
    }

    // ── Save message to DB FIRST so that outgoingAPIMessageReceived webhook can
    // look it up by externalMessageId and persist maxInternalId on the customer.
    // This must happen BEFORE the 4-second wait — otherwise the webhook fires
    // during the wait, getCustomerByOutboundMessageId returns null, maxInternalId
    // is never saved, and the customer's reply creates a duplicate conversation.
    const msgId = result.externalMessageId;
    const savedMessage = await storage.createMessage(
      { conversationId: conversation.id, role: "assistant", content: text,
        metadata: { source: "marquiz_autoresponse", accountId: account.accountId, externalMessageId: msgId ?? null } },
      tenantId,
    );

    // ── Async noAccount detection via webhook signal ──────────────────────────
    // GREEN-API doesn't return "noAccount" synchronously — it comes back as an
    // outgoingMessageStatus webhook a couple of seconds after the send.
    // We mark this message as "pending" in Redis, then wait a few seconds for
    // the webhook handler to overwrite it with "noAccount" if needed.
    let noAccountDetected = false;

    if (msgId) {
      const statusKey = maxStatusKey(msgId);
      await redis.set(statusKey, "pending", "EX", 30).catch(() => {});
      console.log(`[MarquizWorker] MAX message sent (id=${msgId}), waiting 4s for noAccount signal…`);

      await new Promise<void>((r) => setTimeout(r, 4000));

      const signal = await redis.get(statusKey).catch(() => null);
      console.log(`[MarquizWorker] Redis signal for ${msgId}: ${signal ?? "(none)"}`);

      if (signal === "noAccount") {
        noAccountDetected = true;
        await redis.del(statusKey).catch(() => {});
      }
    }

    if (noAccountDetected) {
      // Roll back so the conversation doesn't sit in the list while we retry via Telegram
      await storage.updateConversation(conversation.id, tenantId, { status: "failed_delivery" });
      await storage.updateMessage(savedMessage.id, tenantId, {
        metadata: { source: "marquiz_autoresponse", accountId: account.accountId, failureReason: "noAccount" },
      }).catch(() => {});
      console.warn(`[MarquizWorker] noAccount signal received — falling back to Telegram`);
      return { success: false, error: "noAccount" };
    }

    console.log(`[MarquizWorker] Done via MAX — account=${account.accountId}, externalMsgId=${msgId}`);
    return { success: true };
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTING
  // ══════════════════════════════════════════════════════════════════════════

  // ── STRICT: client chose Telegram ─────────────────────────────────────────
  if (preferred === "telegram") {
    if (data.telegramUsername) {
      const r = await sendViaTelegramByUsername();
      if (r.success) return;
      console.warn(`[MarquizWorker] Telegram username send failed (${r.error})`);
    }
    if (hasPhone) {
      const r = await sendViaTelegramByPhone();
      if (r.success) return;
      console.warn(`[MarquizWorker] Telegram phone send failed (${r.error})`);
    }
    console.warn(`[MarquizWorker] Client chose Telegram but all methods failed — saving as failed lead`);
    await saveFailedLead(data, tenantId, phone, commonMeta, "telegram_failed");
    return;
  }

  // ── STRICT: client chose MAX ───────────────────────────────────────────────
  if (preferred === "max") {
    const r = await sendViaMAX();
    if (r.success) return;
    console.warn(`[MarquizWorker] Client chose MAX but send failed (${r.error}) — saving as failed lead`);
    await saveFailedLead(data, tenantId, phone, commonMeta, r.error === "No valid MAX phone" ? "max_no_phone" : "max_send_failed");
    return;
  }

  // ── AUTO: MAX first, Telegram fallback ────────────────────────────────────
  // No channel preference — try MAX first, then Telegram if MAX fails.
  if (!hasPhone && !data.telegramUsername) {
    console.warn(`[MarquizWorker] No contact info — saving as failed lead`);
    await saveFailedLead(data, tenantId, phone, commonMeta, "no_contact_info");
    return;
  }

  if (hasPhone) {
    const r = await sendViaMAX();
    if (r.success) return;
    console.warn(`[MarquizWorker] MAX failed (${r.error}), trying Telegram fallback`);
  }

  // Telegram fallback
  if (data.telegramUsername) {
    const r = await sendViaTelegramByUsername();
    if (r.success) return;
    console.warn(`[MarquizWorker] Telegram username fallback failed (${r.error})`);
  }
  if (hasPhone) {
    const r = await sendViaTelegramByPhone();
    if (r.success) return;
    console.warn(`[MarquizWorker] Telegram phone fallback failed (${r.error})`);
  }

  console.warn(`[MarquizWorker] All channels failed — saving as failed lead`);
  await saveFailedLead(data, tenantId, phone, commonMeta, "all_channels_failed");
}

// ---------------------------------------------------------------------------
// Failed lead persistence
// ---------------------------------------------------------------------------

/**
 * Saves a Marquiz lead that could not be delivered to any messenger.
 * Creates a customer + conversation with status="failed_delivery" so it
 * appears on the dedicated "Failed Leads" page but NOT in the main list.
 */
async function saveFailedLead(
  data: MarquizLeadJobData,
  tenantId: string,
  phone: string,
  commonMeta: Record<string, unknown>,
  failureReason: string,
): Promise<void> {
  try {
    const externalId = `failed:${normalizePhone(data.phone || data.maxPhone || Date.now().toString())}`;
    let customer = await storage.getCustomerByExternalId(tenantId, "marquiz_failed", externalId);
    if (!customer) {
      customer = await storage.createCustomer(
        {
          tenantId,
          channel: "marquiz_failed" as any,
          externalId,
          phone: phone || null,
          name: data.clientName || null,
          metadata: { ...commonMeta, telegramUsername: data.telegramUsername || null },
        },
        tenantId,
      );
    }

    const conversation = await storage.createConversation(
      {
        tenantId,
        customerId: customer.id,
        status: "failed_delivery",
        mode: "learning",
      },
      tenantId,
    );

    await storage.createMessage(
      {
        conversationId: conversation.id,
        role: "assistant",
        content: buildResponseText_forFailed(data),
        metadata: {
          source: "marquiz_autoresponse",
          failureReason,
          preferredChannel: data.preferredChannel ?? "auto",
          phone: data.phone,
          maxPhone: data.maxPhone,
          telegramUsername: data.telegramUsername,
        },
      },
      tenantId,
    );

    console.log(`[MarquizWorker] Saved failed lead — conversationId=${conversation.id}, reason=${failureReason}`);
  } catch (err: any) {
    console.error(`[MarquizWorker] Failed to save failed lead: ${err.message}`);
  }
}

/** Returns the auto-response text for a failed lead record (same as would have been sent). */
function buildResponseText_forFailed(data: MarquizLeadJobData): string {
  // Reuse the same builder with a minimal fake tenant (no working hours suffix needed)
  const fakeTenant = {
    workingHoursStart: "09:00",
    workingHoursEnd: "21:00",
    workingDays: ["mon","tue","wed","thu","fri"],
    timezone: "Europe/Moscow",
    autoReplyOutsideHours: false,
  } as any;
  return buildResponseText(data, fakeTenant);
}

// ---------------------------------------------------------------------------
// Direct processing (fallback when Redis/BullMQ is unavailable)
// ---------------------------------------------------------------------------

/**
 * Process a Marquiz lead synchronously without going through BullMQ.
 * Used as a fallback when Redis is not configured.
 */
export async function processMarquizLeadDirect(data: MarquizLeadJobData): Promise<void> {
  // Create a minimal job-like object for processLead
  const fakeJob = { data, id: `direct-${Date.now()}` } as Job<MarquizLeadJobData>;

  // Use a dummy redis object (round-robin won't work, will pick first account)
  const dummyRedis = {
    incr: async () => 1,
  } as unknown as IORedis;

  await processLead(fakeJob, dummyRedis);
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

export function startMarquizLeadWorker(): Worker<MarquizLeadJobData> | null {
  const config = getRedisConnectionConfig();
  if (!config) {
    console.warn("[MarquizWorker] REDIS_URL not set — worker not started");
    return null;
  }

  // Dedicated connection for rotation counter (BullMQ needs maxRetriesPerRequest: null)
  const rotationRedis = new IORedis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const worker = new Worker<MarquizLeadJobData>(
    QUEUE_NAME,
    async (job) => {
      await processLead(job, rotationRedis);
    },
    {
      connection: config,
      concurrency: 1,
    },
  );

  worker.on("completed", (job) => {
    console.log(`[MarquizWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[MarquizWorker] Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[MarquizWorker] Worker error:", err.message);
  });

  console.log("[MarquizWorker] Worker started, queue:", QUEUE_NAME);
  return worker;
}
