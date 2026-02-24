import { Queue } from "bullmq";
import { getRedisConnectionConfig } from "./message-queue";
import type { GearboxType } from "./price-sources/types";
import type { VehicleContext } from "./transmission-identifier";

export interface SearchFallback {
  make: string | null;
  model: string | null;
  gearboxType: GearboxType;
  gearboxModel: string | null;
}

export interface PriceLookupJobData {
  tenantId: string;
  conversationId: string;
  oem: string | null;
  oemModelHint?: string | null;
  vehicleContext?: VehicleContext;
  searchFallback?: SearchFallback;
  isModelOnly?: boolean;
}

const QUEUE_NAME = "price_lookup_queue";

let priceLookupQueue: Queue<PriceLookupJobData> | null = null;

export function getPriceLookupQueue(): Queue<PriceLookupJobData> | null {
  if (priceLookupQueue) return priceLookupQueue;

  const config = getRedisConnectionConfig();
  if (!config) {
    console.warn("[PriceLookupQueue] REDIS_URL not configured, queue disabled");
    return null;
  }

  try {
    priceLookupQueue = new Queue<PriceLookupJobData>(QUEUE_NAME, {
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
    console.log("[PriceLookupQueue] Queue initialized:", QUEUE_NAME);
    return priceLookupQueue;
  } catch (error) {
    console.error("[PriceLookupQueue] Failed to create queue:", error);
    return null;
  }
}

export async function enqueuePriceLookup(data: PriceLookupJobData): Promise<{ jobId: string } | null> {
  const queue = getPriceLookupQueue();
  if (!queue) {
    console.log("[PriceLookupQueue] Queue not available, skipping enqueue for conversation", data.conversationId);
    return null;
  }

  try {
    const job = await queue.add("price_lookup", data, {
      attempts: 3,
      removeOnComplete: true,
    });
    const searchLabel = data.oem ?? `fallback:${data.searchFallback?.make}_${data.searchFallback?.model}_${data.searchFallback?.gearboxType}`;
    console.log("[PriceLookupQueue] Job enqueued:", job.id, "conversationId:", data.conversationId, "search:", searchLabel);
    return { jobId: job.id ?? "" };
  } catch (error) {
    console.error("[PriceLookupQueue] Failed to enqueue job:", error);
    return null;
  }
}

export async function closePriceLookupQueue(): Promise<void> {
  if (priceLookupQueue) {
    await priceLookupQueue.close();
    priceLookupQueue = null;
    console.log("[PriceLookupQueue] Queue closed");
  }
}
