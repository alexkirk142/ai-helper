import { Queue, Job, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { featureFlagService } from "./feature-flags";
import { auditLog } from "./audit-log";

export interface DelayedMessageJobData {
  jobId: string;
  tenantId: string;
  conversationId: string;
  messageId: string;
  suggestionId?: string;
  channel: string;
  text: string;
  delayMs: number;
  typingEnabled: boolean;
  createdAt: string;
  scheduledSendAt: string;
}

export interface MessageQueueMetrics {
  scheduledCount: number;
  completedCount: number;
  failedCount: number;
  avgDelayMs: number;
}

const QUEUE_NAME = "message_send_queue";

let messageQueue: Queue<DelayedMessageJobData> | null = null;
let queueEvents: QueueEvents | null = null;

const metrics: MessageQueueMetrics = {
  scheduledCount: 0,
  completedCount: 0,
  failedCount: 0,
  avgDelayMs: 0,
};

let totalDelayMs = 0;

export function getRedisConnectionConfig(): IORedis | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn("[MessageQueue] REDIS_URL not configured, queue disabled");
    return null;
  }

  try {
    return new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  } catch (error) {
    console.error("[MessageQueue] Invalid REDIS_URL:", error);
    return null;
  }
}

export function getMessageQueue(): Queue<DelayedMessageJobData> | null {
  if (messageQueue) return messageQueue;

  const config = getRedisConnectionConfig();
  if (!config) return null;

  try {
    messageQueue = new Queue<DelayedMessageJobData>(QUEUE_NAME, {
      connection: config,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });

    console.log("[MessageQueue] Queue initialized:", QUEUE_NAME);
    return messageQueue;
  } catch (error) {
    console.error("[MessageQueue] Failed to create queue:", error);
    return null;
  }
}

export async function scheduleDelayedMessage(
  data: Omit<DelayedMessageJobData, "jobId" | "createdAt" | "scheduledSendAt">
): Promise<{ jobId: string; scheduledAt: Date } | null> {
  const isEnabled = await featureFlagService.isEnabled("HUMAN_DELAY_ENABLED");
  if (!isEnabled) {
    console.log("[MessageQueue] HUMAN_DELAY_ENABLED=false, skipping queue");
    return null;
  }

  const queue = getMessageQueue();
  if (!queue) {
    console.warn("[MessageQueue] Queue unavailable, falling back to immediate send");
    await auditLog.log(
      "queue_fallback_immediate" as any,
      "message",
      data.messageId,
      "system",
      "system",
      { reason: "queue_unavailable", delayMs: data.delayMs }
    );
    return null;
  }

  const jobId = `msg_${data.messageId}`;
  const createdAt = new Date();
  const scheduledSendAt = new Date(createdAt.getTime() + data.delayMs);

  const jobData: DelayedMessageJobData = {
    ...data,
    jobId,
    createdAt: createdAt.toISOString(),
    scheduledSendAt: scheduledSendAt.toISOString(),
  };

  try {
    await queue.add(jobId, jobData, {
      delay: data.delayMs,
      jobId,
    });

    metrics.scheduledCount++;
    totalDelayMs += data.delayMs;
    metrics.avgDelayMs = Math.round(totalDelayMs / metrics.scheduledCount);

    console.log(`[MessageQueue] Job scheduled: ${jobId}, delay: ${data.delayMs}ms`);

    await auditLog.log(
      "message_scheduled" as any,
      "message",
      data.messageId,
      "system",
      "system",
      {
        jobId,
        delayMs: data.delayMs,
        scheduledSendAt: scheduledSendAt.toISOString(),
        typingEnabled: data.typingEnabled,
      }
    );

    return { jobId, scheduledAt: scheduledSendAt };
  } catch (error) {
    console.error("[MessageQueue] Failed to schedule job:", error);
    return null;
  }
}

export async function cancelDelayedMessage(
  messageId: string,
  reason: "edited" | "rejected" | "escalated"
): Promise<boolean> {
  const queue = getMessageQueue();
  if (!queue) return false;

  const jobId = `msg_${messageId}`;

  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      console.log(`[MessageQueue] Job not found for cancel: ${jobId}`);
      return false;
    }

    const state = await job.getState();
    if (state === "completed" || state === "failed") {
      console.log(`[MessageQueue] Job already ${state}: ${jobId}`);
      return false;
    }

    await job.remove();
    console.log(`[MessageQueue] Job cancelled: ${jobId}, reason: ${reason}`);

    await auditLog.log(
      "message_cancelled" as any,
      "message",
      messageId,
      "operator",
      "user",
      { jobId, reason, previousState: state }
    );

    return true;
  } catch (error) {
    console.error("[MessageQueue] Failed to cancel job:", error);
    return false;
  }
}

export async function getDelayedJobs(): Promise<
  Array<{
    jobId: string;
    messageId: string;
    conversationId: string;
    delayMs: number;
    scheduledSendAt: string;
    state: string;
  }>
> {
  const queue = getMessageQueue();
  if (!queue) return [];

  try {
    const delayed = await queue.getDelayed();
    const waiting = await queue.getWaiting();
    const active = await queue.getActive();

    const allJobs = [...delayed, ...waiting, ...active];

    return Promise.all(
      allJobs.map(async (job) => ({
        jobId: job.id || "",
        messageId: job.data.messageId,
        conversationId: job.data.conversationId,
        delayMs: job.data.delayMs,
        scheduledSendAt: job.data.scheduledSendAt,
        state: await job.getState(),
      }))
    );
  } catch (error) {
    console.error("[MessageQueue] Failed to get delayed jobs:", error);
    return [];
  }
}

export function getQueueMetrics(): MessageQueueMetrics {
  return { ...metrics };
}

export function recordJobCompleted(actualDelayMs: number): void {
  metrics.completedCount++;
  totalDelayMs += actualDelayMs;
  metrics.avgDelayMs = Math.round(totalDelayMs / (metrics.scheduledCount + metrics.completedCount));
}

export function recordJobFailed(): void {
  metrics.failedCount++;
}

export async function closeQueue(): Promise<void> {
  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }
  if (messageQueue) {
    await messageQueue.close();
    messageQueue = null;
  }
  console.log("[MessageQueue] Queue closed");
}

export function isQueueAvailable(): boolean {
  return getMessageQueue() !== null;
}

export function resetMetrics(): void {
  metrics.scheduledCount = 0;
  metrics.completedCount = 0;
  metrics.failedCount = 0;
  metrics.avgDelayMs = 0;
  totalDelayMs = 0;
}
