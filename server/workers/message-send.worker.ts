import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import {
  DelayedMessageJobData,
  recordJobCompleted,
  recordJobFailed,
  getRedisConnectionConfig,
} from "../services/message-queue";
import { auditLog } from "../services/audit-log";
import { getChannelAdapter } from "../services/channel-adapter";
import { storage } from "../storage";

const QUEUE_NAME = "message_send_queue";

// Terminal conversation statuses — sending into these states makes no sense.
const TERMINAL_CONVERSATION_STATUSES = new Set(["resolved", "closed"]);

// Suggestion statuses that mean the operator explicitly cancelled the send.
const CANCELLED_SUGGESTION_STATUSES = new Set(["rejected", "cancelled"]);

async function isMessageStillValid(
  messageId: string,
  conversationId: string,
  tenantId: string,
  suggestionId?: string
): Promise<{ valid: boolean; reason?: string }> {
  const conversation = await storage.getConversation(conversationId, tenantId);
  if (!conversation) {
    return { valid: false, reason: "Conversation not found" };
  }
  if (TERMINAL_CONVERSATION_STATUSES.has(conversation.status)) {
    return { valid: false, reason: `Conversation is ${conversation.status}` };
  }

  if (suggestionId) {
    const suggestion = await storage.getAiSuggestion(suggestionId, tenantId);
    if (!suggestion) {
      return { valid: false, reason: "Suggestion not found" };
    }
    if (CANCELLED_SUGGESTION_STATUSES.has(suggestion.status ?? "")) {
      return { valid: false, reason: `Suggestion is ${suggestion.status}` };
    }
  }

  return { valid: true };
}

async function markMessageAsSent(
  messageId: string,
  tenantId: string,
  externalId: string
): Promise<void> {
  const existing = await storage.getMessage(messageId, tenantId);
  const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
  await storage.updateMessage(messageId, tenantId, {
    metadata: {
      ...existingMeta,
      deliveryStatus: "sent",
      deliveredAt: new Date().toISOString(),
      externalMessageId: externalId || null,
    } as unknown,
  });
}

async function markMessageAsFailed(
  messageId: string,
  tenantId: string,
  error: string
): Promise<void> {
  const existing = await storage.getMessage(messageId, tenantId);
  const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
  await storage.updateMessage(messageId, tenantId, {
    metadata: {
      ...existingMeta,
      deliveryStatus: "failed",
      failedAt: new Date().toISOString(),
      lastError: error,
    } as unknown,
  });
}

async function processDelayedMessage(job: Job<DelayedMessageJobData>): Promise<void> {
  const { tenantId, messageId, conversationId, suggestionId, channel, text, typingEnabled, createdAt, delayMs, jobId } = job.data;

  const jobStartTime = Date.now();
  const actualDelayMs = jobStartTime - new Date(createdAt).getTime();

  console.log(`[Worker] Processing job: ${job.id}, messageId: ${messageId}`);
  console.log(`[Worker] Scheduled delay: ${delayMs}ms, Actual delay: ${actualDelayMs}ms`);

  const validity = await isMessageStillValid(messageId, conversationId, tenantId, suggestionId);
  if (!validity.valid) {
    console.log(`[Worker] Message no longer valid: ${messageId}, reason: ${validity.reason}`);
    await auditLog.log(
      "message_send_skipped" as any,
      "message",
      messageId,
      "worker",
      "system",
      { reason: validity.reason, jobId: job.id }
    );
    return;
  }

  // MAX Personal requires knowing the customer's phone-based chatId and the accountId —
  // neither of which can be derived from the DB conversation UUID alone.
  // Look up the conversation so we can call sendMessageForTenant directly.
  if (channel === "max_personal") {
    const { maxPersonalAdapter } = await import("../services/max-personal-adapter");
    const conversation = await storage.getConversationDetail(conversationId, tenantId);
    if (!conversation?.customer?.externalId) {
      throw new Error(`[Worker] MAX Personal: customer externalId not found for conversation ${conversationId}`);
    }
    const chatId = conversation.customer.externalId;
    const msgs = conversation.messages ?? [];
    const effectiveAccountId: string | undefined =
      (msgs.find((m: any) => (m.metadata as any)?.accountId)?.metadata as any)?.accountId;

    const result = await maxPersonalAdapter.sendMessageForTenant(tenantId, chatId, text, undefined, effectiveAccountId);
    if (result.success) {
      await markMessageAsSent(messageId, tenantId, result.externalMessageId || "");
      recordJobCompleted(Date.now() - new Date(createdAt).getTime());
      await auditLog.log(
        "message_sent_delayed" as any,
        "message",
        messageId,
        "worker",
        "system",
        {
          jobId,
          scheduledDelayMs: delayMs,
          actualDelayMs: Date.now() - new Date(createdAt).getTime(),
          externalMessageId: result.externalMessageId,
          channel,
        }
      );
      console.log(`[Worker] MAX Personal message sent: ${messageId}`);
    } else {
      throw new Error(result.error || "MAX Personal send failed");
    }
    return;
  }

  const adapter = getChannelAdapter(channel);

  if (typingEnabled) {
    await adapter.sendTypingStart(conversationId);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await adapter.sendTypingStop(conversationId);
  }

  const result = await adapter.sendMessage(conversationId, text);

  if (result.success) {
    await markMessageAsSent(messageId, tenantId, result.externalMessageId || "");
    recordJobCompleted(actualDelayMs);

    await auditLog.log(
      "message_sent_delayed" as any,
      "message",
      messageId,
      "worker",
      "system",
      {
        jobId: job.id,
        scheduledDelayMs: delayMs,
        actualDelayMs,
        externalMessageId: result.externalMessageId,
        channel,
      }
    );

    console.log(`[Worker] Message sent successfully: ${messageId}`);
  } else {
    throw new Error(result.error || "Channel send failed");
  }
}

export function createMessageSendWorker(connectionConfig: IORedis): Worker<DelayedMessageJobData> {
  const worker = new Worker<DelayedMessageJobData>(
    QUEUE_NAME,
    async (job) => {
      await processDelayedMessage(job);
    },
    {
      connection: connectionConfig,
      concurrency: 5,
      limiter: {
        max: 100,
        duration: 60000,
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[Worker] Job completed: ${job.id}`);
  });

  worker.on("failed", async (job, error) => {
    console.error(`[Worker] Job failed: ${job?.id}`, error.message);
    recordJobFailed();

    if (job) {
      const attemptsMade = job.attemptsMade;
      const maxAttempts = job.opts.attempts || 3;

      if (attemptsMade >= maxAttempts) {
        await markMessageAsFailed(job.data.messageId, job.data.tenantId, error.message);
        await auditLog.log(
          "message_send_failed" as any,
          "message",
          job.data.messageId,
          "worker",
          "system",
          {
            jobId: job.id,
            error: error.message,
            attempts: attemptsMade,
          }
        );
      }
    }
  });

  worker.on("error", (error) => {
    console.error("[Worker] Worker error:", error);
  });

  console.log(`[Worker] Message send worker started for queue: ${QUEUE_NAME}`);
  return worker;
}

export async function startWorker(): Promise<Worker<DelayedMessageJobData> | null> {
  const config = getRedisConnectionConfig();
  if (!config) {
    console.warn("[Worker] REDIS_URL not configured, worker not started");
    return null;
  }

  try {
    const worker = createMessageSendWorker(config);
    return worker;
  } catch (error) {
    console.error("[Worker] Failed to start worker:", error);
    return null;
  }
}

if (require.main === module) {
  startWorker()
    .then((worker) => {
      if (worker) {
        console.log("[Worker] Worker process running...");
        process.on("SIGTERM", async () => {
          console.log("[Worker] Shutting down...");
          await worker.close();
          process.exit(0);
        });
      } else {
        console.error("[Worker] Failed to start worker");
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error("[Worker] Startup error:", error);
      process.exit(1);
    });
}
