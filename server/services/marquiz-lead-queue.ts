import { Queue } from "bullmq";
import { getRedisConnectionConfig } from "./message-queue";

export interface MarquizLeadJobData {
  quizName: string;
  phone: string;
  maxPhone: string;
  telegramUsername: string; // e.g. "@username" or "username"
  // Channel selected by the client in Marquiz ("telegram" | "max" | "whatsapp" | undefined)
  // When set, routing is STRICT — only the chosen channel is used, no cross-channel fallback.
  preferredChannel?: string;
  // КПП fields
  gearboxType: string;
  // Engine fields
  engineType: string;
  engineVolume: string;
  engineModel: string;
  // Common
  carInfo: string;
  vin: string;
  city: string;
  clientName: string;
  rawFields: Record<string, string>;
}

const QUEUE_NAME = "marquiz_leads";

let marquizLeadQueue: Queue<MarquizLeadJobData> | null = null;

export function getMarquizLeadQueue(): Queue<MarquizLeadJobData> | null {
  if (marquizLeadQueue) return marquizLeadQueue;

  const config = getRedisConnectionConfig();
  if (!config) {
    console.warn("[MarquizLeadQueue] REDIS_URL not configured — queue disabled");
    return null;
  }

  try {
    marquizLeadQueue = new Queue<MarquizLeadJobData>(QUEUE_NAME, {
      connection: config,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
    console.log("[MarquizLeadQueue] Queue initialized:", QUEUE_NAME);
    return marquizLeadQueue;
  } catch (error) {
    console.error("[MarquizLeadQueue] Failed to create queue:", error);
    return null;
  }
}

export async function enqueueMarquizLead(data: MarquizLeadJobData): Promise<{ jobId: string } | null> {
  const queue = getMarquizLeadQueue();
  if (!queue) return null;

  try {
    const job = await queue.add("marquiz_lead", data);
    console.log("[MarquizLeadQueue] Lead enqueued, jobId:", job.id);
    return { jobId: job.id ?? "" };
  } catch (error) {
    console.error("[MarquizLeadQueue] Failed to enqueue lead:", error);
    return null;
  }
}

export async function closeMarquizLeadQueue(): Promise<void> {
  if (marquizLeadQueue) {
    await marquizLeadQueue.close();
    marquizLeadQueue = null;
    console.log("[MarquizLeadQueue] Queue closed");
  }
}
