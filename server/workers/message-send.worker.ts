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
  suggestionId?: string
): Promise<{ valid: boolean; reason?: string }> {
  const conversation = await storage.getConversation(conversationId);
  if (!conversation) {
    return { valid: false, reason: "Conversation not found" };
  }
  if (TERMINAL_CONVERSATION_STATUSES.has(conversation.status)) {
    return { valid: false, reason: `Conversation is ${conversation.status}` };
  }

  if (suggestionId) {
    const suggestion = await storage.getAiSuggestion(suggestionId);
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
  externalId: string
): Promise<void> {
  const existing = await storage.getMessage(messageId);
  const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
  await storage.updateMessage(messageId, {
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
  error: string
): Promise<void> {
  const existing = await storage.getMessage(messageId);
  const existingMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
  await storage.updateMessage(messageId, {
    metadata: {
      ...existingMeta,
      deliveryStatus: "failed",
      failedAt: new Date().toISOString(),
      lastError: error,
    } as unknown,
  });
}

async function processDelayedMessage(job: Job<DelayedMessageJobData>): Promise<void> {
  const { messageId, conversationId, suggestionId, channel, text, typingEnabled, createdAt, delayMs } = job.data;

  const jobStartTime = Date.now();
  const actualDelayMs = jobStartTime - new Date(createdAt).getTime();

  console.log(`[Worker] Processing job: ${job.id}, messageId: ${messageId}`);
  console.log(`[Worker] Scheduled delay: ${delayMs}ms, Actual delay: ${actualDelayMs}ms`);

  const validity = await isMessageStillValid(messageId, conversationId, suggestionId);
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

  const adapter = getChannelAdapter(channel);

  if (typingEnabled) {
    await adapter.sendTypingStart(conversationId);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await adapter.sendTypingStop(conversationId);
  }

  const result = await adapter.sendMessage(conversationId, text);

  if (result.success) {
    await markMessageAsSent(messageId, result.externalMessageId || "");
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
        await markMessageAsFailed(job.data.messageId, error.message);
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
