import { Worker, type Job } from "bullmq";
import { getRedisConnectionConfig } from "../services/message-queue";
import type { NoReplyCheckJobData } from "../services/no-reply-check-queue";
import { storage } from "../storage";
import { notifyNoReply } from "../services/escalation-bot";
import { getSecret } from "../services/secret-resolver";

async function processNoReplyCheck(job: Job<NoReplyCheckJobData>): Promise<void> {
  const { conversationId, tenantId, channel, clientName, phone } = job.data;

  console.log(`[NoReplyCheckWorker] Checking conversation ${conversationId} for reply`);

  const tenant = await storage.getTenant(tenantId);
  if (!tenant) {
    console.warn(`[NoReplyCheckWorker] Tenant ${tenantId} not found — skipping`);
    return;
  }

  const botToken = await getSecret({ scope: "global", keyName: "TELEGRAM_ESCALATION_BOT_TOKEN" });
  const chatId = (tenant as any).escalationChatId?.trim();

  if (!botToken || !chatId) {
    console.log(`[NoReplyCheckWorker] Escalation bot not configured for tenant ${tenantId} — skipping`);
    return;
  }

  const messages = await storage.getMessagesByConversation(conversationId, tenantId);

  // Check if any "user" (customer) message exists after the initial assistant message
  const firstAssistantIdx = messages.findIndex((m) => m.role === "assistant");
  const hasCustomerReply = messages.some(
    (m, idx) => idx > firstAssistantIdx && m.role === "user",
  );

  if (hasCustomerReply) {
    console.log(`[NoReplyCheckWorker] Customer replied in conversation ${conversationId} — no notification needed`);
    return;
  }

  console.log(`[NoReplyCheckWorker] No reply in conversation ${conversationId} — sending escalation notification`);

  try {
    await notifyNoReply({
      clientName: clientName ?? null,
      phone: phone ?? null,
      channel,
      botToken,
      chatId,
    });
    console.log(`[NoReplyCheckWorker] Escalation notification sent for conversation ${conversationId}`);
  } catch (err: any) {
    console.error(`[NoReplyCheckWorker] Failed to send notification: ${err.message}`);
    throw err; // rethrow so BullMQ retries
  }
}

export function startNoReplyCheckWorker(): Worker<NoReplyCheckJobData> | null {
  const config = getRedisConnectionConfig();
  if (!config) {
    console.warn("[NoReplyCheckWorker] REDIS_URL not set — worker not started");
    return null;
  }

  const worker = new Worker<NoReplyCheckJobData>(
    "no_reply_check",
    async (job) => {
      await processNoReplyCheck(job);
    },
    {
      connection: config,
      concurrency: 5,
    },
  );

  worker.on("completed", (job) => {
    console.log(`[NoReplyCheckWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[NoReplyCheckWorker] Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[NoReplyCheckWorker] Worker error:", err.message);
  });

  console.log("[NoReplyCheckWorker] Worker started, queue: no_reply_check");
  return worker;
}
