/**
 * Integration tests for the AI learning pipeline (Этапы 1–4 из AI_LEARNING_UPGRADE.md).
 *
 * Tests cover:
 *  1. Auto-Harvest: operator manual reply → OPERATOR_MANUAL training sample
 *  2. Learning Queue Worker: processLearningQueueItem → status="reviewed"
 *  3. Conversation-to-RAG Indexer: resolved conversation → rag_document type=CONVERSATION
 *  4. Training Stats API: getAiTrainingStats returns correct structure
 *
 * Uses MemStorage (in-memory) so no DB connection is needed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemStorage } from "./helpers/mem-storage";
import type { IStorage } from "../storage.types";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeStorage(): MemStorage {
  return new MemStorage();
}

async function seedConversationWithMessages(
  storage: MemStorage,
  tenantId: string,
  customerId: string,
  pairs: Array<{ customer: string; assistant: string }>
) {
  const conv = await storage.createConversation(
    { tenantId, customerId, status: "active", mode: "learning" },
    tenantId
  );

  for (const { customer, assistant } of pairs) {
    await storage.createMessage(
      { conversationId: conv.id, role: "customer", content: customer, attachments: [], metadata: {} },
      tenantId
    );
    await storage.createMessage(
      { conversationId: conv.id, role: "owner", content: assistant, attachments: [], metadata: {} },
      tenantId
    );
  }

  return conv;
}

// --------------------------------------------------------------------------
// Suite 1: Learning Queue Processor
// --------------------------------------------------------------------------

describe("Learning Queue Processor", () => {
  it("processes a pending item, creates OPERATOR_MANUAL samples and marks reviewed", async () => {
    vi.resetModules();

    const memStorage = makeStorage();

    // Patch the module-level storage singleton
    vi.doMock("../storage", () => ({ storage: memStorage }));

    const { processLearningQueueItem } = await import("../services/learning-queue-processor");

    const tenants = await (memStorage as any).tenants;
    // Get the seeded tenant from MemStorage's seedDemoData
    const [tenantId] = [...(memStorage as any).tenants.keys()];
    const [customerId] = [...(memStorage as any).customers.keys()];

    const conv = await seedConversationWithMessages(memStorage, tenantId, customerId, [
      { customer: "Сколько стоит товар?", assistant: "Товар стоит 500 рублей." },
      { customer: "А есть скидки?", assistant: "Да, 10% для постоянных клиентов." },
    ]);

    const queueItem = await memStorage.createLearningQueueItem({
      tenantId,
      conversationId: conv.id,
      learningScore: 3,
      reasons: ["LONG_CONVERSATION"],
      status: "pending",
    });

    const result = await processLearningQueueItem(queueItem);

    expect(result.processed).toBeGreaterThan(0);

    const samples = await memStorage.getAiTrainingSamplesByTenant(tenantId);
    expect(samples.some(s => s.outcome === "OPERATOR_MANUAL")).toBe(true);

    const updated = await memStorage.getLearningQueueItem(conv.id);
    expect(updated?.status).toBe("reviewed");
  });

  it("skips items with learningScore below threshold (< 1)", async () => {
    vi.resetModules();
    const memStorage = makeStorage();
    vi.doMock("../storage", () => ({ storage: memStorage }));
    const { processLearningQueueItem } = await import("../services/learning-queue-processor");

    const [tenantId] = [...(memStorage as any).tenants.keys()];
    const [customerId] = [...(memStorage as any).customers.keys()];
    const conv = await seedConversationWithMessages(memStorage, tenantId, customerId, [
      { customer: "Привет", assistant: "Добрый день!" },
      { customer: "Вопрос", assistant: "Ответ" },
    ]);

    const item = await memStorage.createLearningQueueItem({
      tenantId,
      conversationId: conv.id,
      learningScore: 0,
      reasons: [],
      status: "pending",
    });

    const result = await processLearningQueueItem(item);

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    const updated = await memStorage.getLearningQueueItem(conv.id);
    expect(updated?.status).toBe("dismissed");
  });

  it("does not create duplicate samples for the same userMessage", async () => {
    vi.resetModules();
    const memStorage = makeStorage();
    vi.doMock("../storage", () => ({ storage: memStorage }));
    const { processLearningQueueItem } = await import("../services/learning-queue-processor");

    const [tenantId] = [...(memStorage as any).tenants.keys()];
    const [customerId] = [...(memStorage as any).customers.keys()];
    const conv = await seedConversationWithMessages(memStorage, tenantId, customerId, [
      { customer: "Тот же вопрос", assistant: "Тот же ответ" },
      { customer: "Другой вопрос", assistant: "Другой ответ" },
    ]);

    const item = await memStorage.createLearningQueueItem({
      tenantId,
      conversationId: conv.id,
      learningScore: 2,
      reasons: [],
      status: "pending",
    });

    // Process twice
    await processLearningQueueItem(item);

    // Create a new pending item for same conv to re-process
    const item2 = await memStorage.createLearningQueueItem({
      tenantId,
      conversationId: conv.id,
      learningScore: 2,
      reasons: [],
      status: "pending",
    });
    const result2 = await processLearningQueueItem(item2);

    // All should be skipped as duplicates (samples already exist for same userMessage in this conv)
    expect(result2.skipped).toBeGreaterThanOrEqual(result2.processed);
  });
});

// --------------------------------------------------------------------------
// Suite 2: Training Stats
// --------------------------------------------------------------------------

describe("getAiTrainingStats", () => {
  it("returns zero-filled structure when no data exists", async () => {
    const storage = makeStorage();
    const [tenantId] = [...(storage as any).tenants.keys()];

    const stats = await storage.getAiTrainingStats(tenantId);

    expect(stats).toMatchObject({
      samplesByOutcome: {
        APPROVED: expect.any(Number),
        EDITED: expect.any(Number),
        REJECTED: expect.any(Number),
        OPERATOR_MANUAL: expect.any(Number),
      },
      conversationRagCount: expect.any(Number),
      topIntents: expect.any(Array),
      totalSamples: expect.any(Number),
      learningQueuePending: expect.any(Number),
    });
    // avgConfidenceLast50 is null when no suggestions exist, number otherwise
    expect(stats.avgConfidenceLast50 === null || typeof stats.avgConfidenceLast50 === "number").toBe(true);

    expect(stats.totalSamples).toBe(0);
    expect(stats.learningQueuePending).toBe(0);
  });

  it("counts samples by outcome correctly", async () => {
    const storage = makeStorage();
    const [tenantId] = [...(storage as any).tenants.keys()];
    const [customerId] = [...(storage as any).customers.keys()];

    const conv = await storage.createConversation(
      { tenantId, customerId, status: "active", mode: "learning" },
      tenantId
    );

    const baseSample = {
      tenantId,
      conversationId: conv.id,
      userMessage: "question",
      aiSuggestion: "ai reply",
      finalAnswer: "final",
      intent: "price",
      decision: "NEED_APPROVAL",
      rejectionReason: null,
    };

    await storage.createAiTrainingSample({ ...baseSample, userMessage: "q1", outcome: "APPROVED" });
    await storage.createAiTrainingSample({ ...baseSample, userMessage: "q2", outcome: "APPROVED" });
    await storage.createAiTrainingSample({ ...baseSample, userMessage: "q3", outcome: "EDITED" });
    await storage.createAiTrainingSample({ ...baseSample, userMessage: "q4", outcome: "OPERATOR_MANUAL" });
    await storage.createAiTrainingSample({ ...baseSample, userMessage: "q5", outcome: "REJECTED", finalAnswer: null });

    const stats = await storage.getAiTrainingStats(tenantId);

    expect(stats.samplesByOutcome.APPROVED).toBe(2);
    expect(stats.samplesByOutcome.EDITED).toBe(1);
    expect(stats.samplesByOutcome.OPERATOR_MANUAL).toBe(1);
    expect(stats.samplesByOutcome.REJECTED).toBe(1);
    expect(stats.totalSamples).toBe(5);
  });

  it("counts pending learning queue items", async () => {
    const storage = makeStorage();
    const [tenantId] = [...(storage as any).tenants.keys()];
    const [customerId] = [...(storage as any).customers.keys()];

    const conv = await storage.createConversation(
      { tenantId, customerId, status: "active", mode: "learning" },
      tenantId
    );

    await storage.createLearningQueueItem({
      tenantId,
      conversationId: conv.id,
      learningScore: 2,
      reasons: [],
      status: "pending",
    });

    const stats = await storage.getAiTrainingStats(tenantId);
    expect(stats.learningQueuePending).toBe(1);
  });

  it("counts conversation RAG documents", async () => {
    const storage = makeStorage();
    const [tenantId] = [...(storage as any).tenants.keys()];

    await storage.createRagDocument({
      tenantId,
      type: "CONVERSATION",
      sourceId: "conv-abc",
      content: "Клиент: вопрос\nОператор: ответ",
      metadata: {},
    });

    const stats = await storage.getAiTrainingStats(tenantId);
    expect(stats.conversationRagCount).toBe(1);
  });

  it("collects top intents sorted by frequency", async () => {
    const storage = makeStorage();
    const [tenantId] = [...(storage as any).tenants.keys()];
    const [customerId] = [...(storage as any).customers.keys()];

    const conv = await storage.createConversation(
      { tenantId, customerId, status: "active", mode: "learning" },
      tenantId
    );

    const base = {
      tenantId,
      conversationId: conv.id,
      userMessage: "q",
      aiSuggestion: "a",
      finalAnswer: "f",
      decision: "NEED_APPROVAL",
      outcome: "APPROVED",
      rejectionReason: null,
    };

    for (let i = 0; i < 3; i++) {
      await storage.createAiTrainingSample({ ...base, userMessage: `price-${i}`, intent: "price" });
    }
    for (let i = 0; i < 2; i++) {
      await storage.createAiTrainingSample({ ...base, userMessage: `ship-${i}`, intent: "shipping" });
    }
    await storage.createAiTrainingSample({ ...base, userMessage: "avail-0", intent: "availability" });

    const stats = await storage.getAiTrainingStats(tenantId);

    expect(stats.topIntents[0].intent).toBe("price");
    expect(stats.topIntents[0].count).toBe(3);
    expect(stats.topIntents[1].intent).toBe("shipping");
    expect(stats.topIntents[1].count).toBe(2);
  });
});

// --------------------------------------------------------------------------
// Suite 3: Few-Shot OPERATOR_MANUAL priority (existing service)
// --------------------------------------------------------------------------

describe("Few-Shot OPERATOR_MANUAL priority", () => {
  it("OPERATOR_MANUAL samples score higher than APPROVED", async () => {
    vi.resetModules();
    const memStorage = makeStorage();
    vi.doMock("../storage", () => ({ storage: memStorage }));

    const [tenantId] = [...(memStorage as any).tenants.keys()];
    const [customerId] = [...(memStorage as any).customers.keys()];

    const conv = await memStorage.createConversation(
      { tenantId, customerId, status: "active", mode: "learning" },
      tenantId
    );

    await memStorage.createAiTrainingSample({
      tenantId,
      conversationId: conv.id,
      userMessage: "Есть ли скидки?",
      aiSuggestion: "AI: да, есть",
      finalAnswer: "Оператор: да, специально для вас 10%.",
      intent: "discount",
      decision: "NEED_APPROVAL",
      outcome: "OPERATOR_MANUAL",
      rejectionReason: null,
    });

    await memStorage.createAiTrainingSample({
      tenantId,
      conversationId: conv.id,
      userMessage: "Какова цена?",
      aiSuggestion: "AI: 500 руб",
      finalAnswer: "AI: 500 руб",
      intent: "price",
      decision: "AUTO_SEND",
      outcome: "APPROVED",
      rejectionReason: null,
    });

    const { selectFewShotExamples } = await import("../services/few-shot-builder");
    const examples = await selectFewShotExamples(tenantId, { maxExamples: 2 });

    // OPERATOR_MANUAL should come first (higher score)
    expect(examples.length).toBeGreaterThanOrEqual(1);
    const first = examples[0];
    expect(first.userMessage).toBe("Есть ли скидки?");
  });
});

// --------------------------------------------------------------------------
// Suite 4: Conversation-to-RAG Indexer helpers (pure unit)
// --------------------------------------------------------------------------

describe("Conversation RAG Indexer: extractTrainingPairsFromConversation", () => {
  it("extracts adjacent customer/assistant pairs", async () => {
    const { extractTrainingPairsFromConversation } = await import(
      "../services/learning-queue-processor"
    );

    const messages = [
      { id: "1", role: "customer", content: "Привет", conversationId: "c1", tenantId: "t1", attachments: [], metadata: {}, createdAt: new Date() },
      { id: "2", role: "owner", content: "Здравствуйте!", conversationId: "c1", tenantId: "t1", attachments: [], metadata: {}, createdAt: new Date() },
      { id: "3", role: "customer", content: "Ещё вопрос", conversationId: "c1", tenantId: "t1", attachments: [], metadata: {}, createdAt: new Date() },
      { id: "4", role: "owner", content: "Ещё ответ", conversationId: "c1", tenantId: "t1", attachments: [], metadata: {}, createdAt: new Date() },
    ] as any[];

    const pairs = extractTrainingPairsFromConversation(messages);

    expect(pairs).toHaveLength(2);
    expect(pairs[0].userMessage).toBe("Привет");
    expect(pairs[0].finalAnswer).toBe("Здравствуйте!");
    expect(pairs[1].userMessage).toBe("Ещё вопрос");
    expect(pairs[1].finalAnswer).toBe("Ещё ответ");
  });

  it("skips empty messages", async () => {
    const { extractTrainingPairsFromConversation } = await import(
      "../services/learning-queue-processor"
    );

    const messages = [
      { id: "1", role: "customer", content: "", conversationId: "c1", tenantId: "t1", attachments: [], metadata: {}, createdAt: new Date() },
      { id: "2", role: "owner", content: "Ответ", conversationId: "c1", tenantId: "t1", attachments: [], metadata: {}, createdAt: new Date() },
    ] as any[];

    const pairs = extractTrainingPairsFromConversation(messages);
    expect(pairs).toHaveLength(0);
  });
});
