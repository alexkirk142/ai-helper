import { Queue } from "bullmq";
import { getRedisConnectionConfig } from "./message-queue";

export interface NoReplyCheckJobData {
  conversationId: string;
  tenantId: string;
  /** Channel through which the auto-response was sent, e.g. "max_personal", "telegram_personal" */
  channel: string;
  clientName?: string | null;
  phone?: string | null;
}

const QUEUE_NAME = "no_reply_check";
const NO_REPLY_DELAY_MS = 15 * 60 * 1000; // 15 minutes

let noReplyCheckQueue: Queue<NoReplyCheckJobData> | null = null;

export function getNoReplyCheckQueue(): Queue<NoReplyCheckJobData> | null {
  if (noReplyCheckQueue) return noReplyCheckQueue;

  const config = getRedisConnectionConfig();
  if (!config) {
    console.warn("[NoReplyCheckQueue] REDIS_URL not configured — queue disabled");
    return null;
  }

  try {
    noReplyCheckQueue = new Queue<NoReplyCheckJobData>(QUEUE_NAME, {
      connection: config,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "fixed", delay: 5000 },
        removeOnComplete: 200,
        removeOnFail: 100,
      },
    });
    console.log("[NoReplyCheckQueue] Queue initialized:", QUEUE_NAME);
    return noReplyCheckQueue;
  } catch (error) {
    console.error("[NoReplyCheckQueue] Failed to create queue:", error);
    return null;
  }
}

export async function scheduleNoReplyCheck(data: NoReplyCheckJobData): Promise<void> {
  const queue = getNoReplyCheckQueue();
  if (!queue) {
    console.warn("[NoReplyCheckQueue] Queue unavailable — no-reply check skipped");
    return;
  }

  try {
    // Use a unique jobId per conversation to deduplicate concurrent schedules for the same
    // conversation (e.g. if MAX and Telegram both succeed for the same lead).
    // We append a epoch-minute so that if a previous check was silently skipped (e.g. bot
    // token was not yet configured), a new check can still be scheduled after the next deploy.
    const minute = Math.floor(Date.now() / 60000);
    const jobId = `no_reply:${data.conversationId}:${minute}`;
    await queue.add("no_reply_check", data, {
      delay: NO_REPLY_DELAY_MS,
      jobId,
    });
    console.log(`[NoReplyCheckQueue] Scheduled no-reply check for conversation ${data.conversationId} in 15 min (jobId=${jobId})`);
  } catch (error: any) {
    console.error("[NoReplyCheckQueue] Failed to schedule:", error.message);
  }
}

export async function closeNoReplyCheckQueue(): Promise<void> {
  if (noReplyCheckQueue) {
    await noReplyCheckQueue.close();
    noReplyCheckQueue = null;
    console.log("[NoReplyCheckQueue] Queue closed");
  }
}
