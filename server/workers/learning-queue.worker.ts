import { Worker, Queue, type Job } from "bullmq";
import { getRedisConnectionConfig } from "../services/message-queue";
import { processPendingLearningQueue } from "../services/learning-queue-processor";

const QUEUE_NAME = "learning_queue_batch";
const BATCH_SIZE = 50;

export interface LearningQueueBatchJobData {
  triggeredBy?: "scheduled" | "manual";
}

let learningQueueBatchQueue: Queue<LearningQueueBatchJobData> | null = null;

export function getLearningQueueBatchQueue(): Queue<LearningQueueBatchJobData> | null {
  return learningQueueBatchQueue;
}

async function processBatch(job: Job<LearningQueueBatchJobData>): Promise<void> {
  const triggeredBy = job.data.triggeredBy ?? "scheduled";
  console.log(`[LearningQueueWorker] Starting batch processing (triggeredBy=${triggeredBy})`);

  const result = await processPendingLearningQueue(BATCH_SIZE);

  console.log(
    `[LearningQueueWorker] Batch done — total=${result.total}, ` +
    `processed=${result.processed}, skipped=${result.skipped}`
  );
}

export function startLearningQueueWorker(): { worker: Worker<LearningQueueBatchJobData>; queue: Queue<LearningQueueBatchJobData> } | null {
  const config = getRedisConnectionConfig();
  if (!config) {
    console.warn("[LearningQueueWorker] REDIS_URL not set — worker not started");
    return null;
  }

  learningQueueBatchQueue = new Queue<LearningQueueBatchJobData>(QUEUE_NAME, {
    connection: config as any,
    defaultJobOptions: {
      removeOnComplete: 10,
      removeOnFail: 20,
    },
  });

  // Schedule a recurring job every 24 hours
  learningQueueBatchQueue.add(
    "daily-batch",
    { triggeredBy: "scheduled" },
    {
      repeat: { every: 24 * 60 * 60 * 1000 },
      jobId: "learning-queue-daily",
    }
  ).catch((err: any) => {
    console.error("[LearningQueueWorker] Failed to schedule recurring job:", err.message);
  });

  const worker = new Worker<LearningQueueBatchJobData>(
    QUEUE_NAME,
    async (job) => {
      await processBatch(job);
    },
    {
      connection: config as any,
      concurrency: 1, // process one batch at a time
    },
  );

  worker.on("completed", (job) => {
    console.log(`[LearningQueueWorker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[LearningQueueWorker] Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[LearningQueueWorker] Worker error:", err.message);
  });

  console.log(`[LearningQueueWorker] Worker started, queue: ${QUEUE_NAME}`);
  return { worker, queue: learningQueueBatchQueue };
}
