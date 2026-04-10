import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { asc, and, eq } from "drizzle-orm";
import { db } from "../db";
import { maxPersonalAccounts } from "../../shared/schema";
import { getRedisConnectionConfig } from "../services/message-queue";
import type { MarquizLeadJobData } from "../services/marquiz-lead-queue";
import { MaxPersonalAdapter } from "../services/max-personal-adapter";
import { storage } from "../storage";

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

function buildResponseText(data: MarquizLeadJobData): string {
  const greeting = data.clientName
    ? `Здравствуйте, ${data.clientName}!`
    : "Здравствуйте!";

  const lines: string[] = [
    `${greeting} Получили вашу заявку на подбор КПП.`,
    "",
  ];

  if (data.carInfo) lines.push(`🚗 Автомобиль: ${data.carInfo}`);
  if (data.gearboxType) lines.push(`⚙️ Тип КПП: ${data.gearboxType}`);
  if (data.vin) lines.push(`🔑 VIN: ${data.vin}`);
  if (data.city) lines.push(`📍 Город: ${data.city}`);

  lines.push("");
  lines.push("Подбираем варианты прямо сейчас, свяжемся с вами в течение 15 минут!");

  return lines.join("\n");
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

  const chatId = toMaxChatId(data.maxPhone);
  console.log(
    `[MarquizWorker] Processing lead: chatId=${chatId}, quiz="${data.quizName}", jobId=${job.id}`,
  );

  // 1. Select account with round-robin rotation
  const account = await getNextAccount(redis, tenantId);
  if (!account) {
    console.error(`[MarquizWorker] No authorised MAX Personal accounts for tenant ${tenantId}`);
    throw new Error("No authorised MAX Personal accounts");
  }
  console.log(`[MarquizWorker] Using account: ${account.label ?? account.accountId}`);

  // 2. Find or create customer
  const phone = `+${normalizePhone(data.phone)}`;
  let customer = await storage.getCustomerByExternalId(tenantId, "max_personal", chatId);

  if (!customer) {
    customer = await storage.createCustomer(
      {
        tenantId,
        channel: "max_personal",
        externalId: chatId,
        phone,
        name: data.clientName || null,
        metadata: {
          source: "marquiz",
          quizName: data.quizName,
          gearboxType: data.gearboxType,
          carInfo: data.carInfo,
          vin: data.vin,
          city: data.city,
        },
      },
      tenantId,
    );
    console.log(`[MarquizWorker] Customer created: ${customer.id}`);
  } else {
    console.log(`[MarquizWorker] Existing customer found: ${customer.id}`);
  }

  // 3. Create conversation
  const conversation = await storage.createConversation(
    {
      tenantId,
      customerId: customer.id,
      status: "active",
      mode: "learning",
    },
    tenantId,
  );
  console.log(`[MarquizWorker] Conversation created: ${conversation.id}`);

  // 4. Send message via MAX Personal
  const text = buildResponseText(data);
  const result = await maxPersonalAdapter.sendMessageForTenant(
    tenantId,
    chatId,
    text,
    undefined,
    account.accountId,
  );

  if (!result.success) {
    console.error(`[MarquizWorker] Failed to send MAX message: ${result.error}`);
    throw new Error(`MAX send failed: ${result.error}`);
  }

  // 5. Save outgoing message to DB
  await storage.createMessage(
    {
      conversationId: conversation.id,
      role: "assistant",
      content: text,
      metadata: {
        source: "marquiz_autoresponse",
        accountId: account.accountId,
        externalMessageId: result.externalMessageId ?? null,
      },
    },
    tenantId,
  );

  console.log(
    `[MarquizWorker] Done — account=${account.accountId}, externalMsgId=${result.externalMessageId}`,
  );
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
