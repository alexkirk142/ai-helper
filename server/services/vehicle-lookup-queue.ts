import { Queue } from "bullmq";
import { getRedisConnectionConfig } from "./message-queue";

export interface VehicleLookupJobData {
  caseId: string;
  tenantId: string;
  conversationId: string;
  idType: "VIN" | "FRAME";
  normalizedValue: string;
}

const QUEUE_NAME = "vehicle_lookup_queue";

let vehicleLookupQueue: Queue<VehicleLookupJobData> | null = null;

export function getVehicleLookupQueue(): Queue<VehicleLookupJobData> | null {
  if (vehicleLookupQueue) return vehicleLookupQueue;

  const config = getRedisConnectionConfig();
  if (!config) {
    console.warn("[VehicleLookupQueue] REDIS_URL not configured, queue disabled");
    return null;
  }

  try {
    vehicleLookupQueue = new Queue<VehicleLookupJobData>(QUEUE_NAME, {
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
    console.log("[VehicleLookupQueue] Queue initialized:", QUEUE_NAME);
    return vehicleLookupQueue;
  } catch (error) {
    console.error("[VehicleLookupQueue] Failed to create queue:", error);
    return null;
  }
}

export async function enqueueVehicleLookup(data: VehicleLookupJobData): Promise<{ jobId: string } | null> {
  const queue = getVehicleLookupQueue();
  if (!queue) return null;

  try {
    const job = await queue.add(`case_${data.caseId}`, data, { jobId: `case_${data.caseId}` });
    console.log("[VehicleLookupQueue] Job enqueued:", job.id, "caseId:", data.caseId);
    return { jobId: job.id ?? "" };
  } catch (error) {
    console.error("[VehicleLookupQueue] Failed to enqueue job:", error);
    return null;
  }
}

export async function closeVehicleLookupQueue(): Promise<void> {
  if (vehicleLookupQueue) {
    await vehicleLookupQueue.close();
    vehicleLookupQueue = null;
    console.log("[VehicleLookupQueue] Queue closed");
  }
}
