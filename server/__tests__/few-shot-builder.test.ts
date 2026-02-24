import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  selectFewShotExamples,
  groupByIntent,
  buildFewShotPromptBlock,
  buildFewShotBlock,
  fewShotBuilder,
  DEFAULT_FEW_SHOT_CONFIG,
  type FewShotExample,
} from "../services/few-shot-builder";
import { storage } from "../storage";

vi.mock("../storage", () => ({
  storage: {
    getAiTrainingSamplesByTenant: vi.fn(),
  },
}));

const mockStorage = vi.mocked(storage);

function createMockSample(overrides: Partial<{
  id: string;
  tenantId: string;
  conversationId: string;
  userMessage: string;
  aiSuggestion: string;
  finalAnswer: string | null;
  intent: string | null;
  decision: string | null;
  outcome: string;
  rejectionReason: string | null;
  createdAt: Date;
}>) {
  return {
    id: overrides.id || "sample-1",
    tenantId: overrides.tenantId || "tenant-1",
    conversationId: overrides.conversationId || "conv-1",
    userMessage: overrides.userMessage || "Test question",
    aiSuggestion: overrides.aiSuggestion || "AI suggested reply",
    finalAnswer: overrides.finalAnswer ?? "Final reply",
    intent: overrides.intent ?? "price",
    decision: overrides.decision ?? "NEED_APPROVAL",
    outcome: overrides.outcome || "APPROVED",
    rejectionReason: overrides.rejectionReason ?? null,
    createdAt: overrides.createdAt || new Date(),
  };
}

describe("Few-Shot Builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("selectFewShotExamples", () => {
    it("should select only APPROVED and EDITED samples", async () => {
      mockStorage.getAiTrainingSamplesByTenant.mockResolvedValue([
        createMockSample({ id: "1", outcome: "APPROVED", finalAnswer: "Reply 1" }),
        createMockSample({ id: "2", outcome: "EDITED", finalAnswer: "Reply 2" }),
        createMockSample({ id: "3", outcome: "REJECTED", finalAnswer: null }),
      ]);

      const examples = await selectFewShotExamples("tenant-1");

      expect(examples).toHaveLength(2);
      expect(examples.every(e => e.assistantReply)).toBe(true);
    });

    it("should filter out samples without finalAnswer", async () => {
      mockStorage.getAiTrainingSamplesByTenant.mockResolvedValue([
        createMockSample({ id: "1", outcome: "APPROVED", finalAnswer: "Reply 1" }),
        createMockSample({ id: "2", outcome: "APPROVED", finalAnswer: null }),
        createMockSample({ id: "3", outcome: "APPROVED", finalAnswer: "" }),
      ]);

      const examples = await selectFewShotExamples("tenant-1");

      expect(examples.every(e => e.assistantReply && e.assistantReply.trim() !== "")).toBe(true);
      expect(examples.some(e => e.assistantReply === "Reply 1")).toBe(true);
    });

    it("should respect maxExamples limit", async () => {
      const samples = Array.from({ length: 10 }, (_, i) =>
        createMockSample({ id: `${i}`, outcome: "APPROVED", finalAnswer: `Reply ${i}` })
      );
      mockStorage.getAiTrainingSamplesByTenant.mockResolvedValue(samples);

      const examples = await selectFewShotExamples("tenant-1", { maxExamples: 5 });

      expect(examples).toHaveLength(5);
    });

    it("should prioritize APPROVED over EDITED", async () => {
      mockStorage.getAiTrainingSamplesByTenant.mockResolvedValue([
        createMockSample({ id: "1", outcome: "EDITED", finalAnswer: "Edited reply" }),
        createMockSample({ id: "2", outcome: "APPROVED", finalAnswer: "Approved reply" }),
      ]);

      const examples = await selectFewShotExamples("tenant-1", { maxExamples: 2 });

      expect(examples[0].assistantReply).toBe("Approved reply");
    });

    it("should boost score for preferred intent", async () => {
      mockStorage.getAiTrainingSamplesByTenant.mockResolvedValue([
        createMockSample({ id: "1", intent: "shipping", finalAnswer: "Shipping reply" }),
        createMockSample({ id: "2", intent: "price", finalAnswer: "Price reply" }),
      ]);

      const examples = await selectFewShotExamples("tenant-1", { 
        maxExamples: 2,
        preferredIntent: "price" 
      });

      expect(examples[0].intent).toBe("price");
    });

    it("should consider AUTO_SEND as high confidence", async () => {
      mockStorage.getAiTrainingSamplesByTenant.mockResolvedValue([
        createMockSample({ id: "1", decision: "AUTO_SEND", finalAnswer: "Auto reply" }),
        createMockSample({ id: "2", decision: "NEED_APPROVAL", finalAnswer: "Manual reply" }),
      ]);

      const examples = await selectFewShotExamples("tenant-1");

      expect(examples.length).toBeGreaterThanOrEqual(1);
      expect(examples[0].assistantReply).toBe("Auto reply");
    });
  });

  describe("groupByIntent", () => {
    it("should group examples by intent", () => {
      const examples: FewShotExample[] = [
        { userMessage: "Q1", assistantReply: "A1", intent: "price", category: null, score: 1 },
        { userMessage: "Q2", assistantReply: "A2", intent: "price", category: null, score: 1 },
        { userMessage: "Q3", assistantReply: "A3", intent: "shipping", category: null, score: 1 },
      ];

      const grouped = groupByIntent(examples);

      expect(grouped.get("price")).toHaveLength(2);
      expect(grouped.get("shipping")).toHaveLength(1);
    });

    it("should group null intent as 'other'", () => {
      const examples: FewShotExample[] = [
        { userMessage: "Q1", assistantReply: "A1", intent: null, category: null, score: 1 },
        { userMessage: "Q2", assistantReply: "A2", intent: "price", category: null, score: 1 },
      ];

      const grouped = groupByIntent(examples);

      expect(grouped.get("other")).toHaveLength(1);
      expect(grouped.get("price")).toHaveLength(1);
    });
  });

  describe("buildFewShotPromptBlock", () => {
    it("should return empty string for no examples", () => {
      const result = buildFewShotPromptBlock([], 1000);

      expect(result.promptBlock).toBe("");
      expect(result.totalTokens).toBe(0);
      expect(result.usedExamples).toHaveLength(0);
    });

    it("should format examples correctly in Russian", () => {
      const examples: FewShotExample[] = [
        { userMessage: "Сколько стоит?", assistantReply: "100 рублей", intent: "price", category: null, score: 1 },
      ];

      const result = buildFewShotPromptBlock(examples, 1000);

      expect(result.promptBlock).toContain("Примеры успешных ответов");
      expect(result.promptBlock).toContain("Клиент: Сколько стоит?");
      expect(result.promptBlock).toContain("Оператор: 100 рублей");
    });

    it("should respect token limit", () => {
      const examples: FewShotExample[] = Array.from({ length: 10 }, (_, i) => ({
        userMessage: "A".repeat(500),
        assistantReply: "B".repeat(500),
        intent: "price",
        category: null,
        score: 1,
      }));

      const result = buildFewShotPromptBlock(examples, 300);

      expect(result.totalTokens).toBeLessThanOrEqual(300);
      expect(result.usedExamples.length).toBeLessThan(10);
    });

    it("should include as many examples as fit within token limit", () => {
      const examples: FewShotExample[] = [
        { userMessage: "Short Q1", assistantReply: "Short A1", intent: "price", category: null, score: 1 },
        { userMessage: "Short Q2", assistantReply: "Short A2", intent: "price", category: null, score: 1 },
        { userMessage: "Short Q3", assistantReply: "Short A3", intent: "price", category: null, score: 1 },
      ];

      const result = buildFewShotPromptBlock(examples, 500);

      expect(result.usedExamples.length).toBeGreaterThanOrEqual(1);
    });

    it("should sanitize PII (phone and email) from examples", () => {
      const examples: FewShotExample[] = [
        { 
          userMessage: "Позвоните мне +7 (999) 123-45-67", 
          assistantReply: "Напишите на test@example.com", 
          intent: "other", 
          category: null, 
          score: 1 
        },
      ];

      const result = buildFewShotPromptBlock(examples, 1500);

      expect(result.promptBlock).not.toContain("+7 (999) 123-45-67");
      expect(result.promptBlock).not.toContain("test@example.com");
      expect(result.promptBlock).toContain("Клиент:");
      expect(result.promptBlock).toContain("Оператор:");
    });
  });

  describe("buildFewShotBlock", () => {
    it("should return complete result with all properties", async () => {
      mockStorage.getAiTrainingSamplesByTenant.mockResolvedValue([
        createMockSample({ id: "1", intent: "price", finalAnswer: "Price reply" }),
        createMockSample({ id: "2", intent: "shipping", finalAnswer: "Shipping reply" }),
      ]);

      const result = await buildFewShotBlock("tenant-1");

      expect(result).toHaveProperty("examples");
      expect(result).toHaveProperty("promptBlock");
      expect(result).toHaveProperty("totalTokens");
      expect(result).toHaveProperty("groupedByIntent");
      expect(result.groupedByIntent instanceof Map).toBe(true);
    });

    it("should return empty block when no samples exist", async () => {
      mockStorage.getAiTrainingSamplesByTenant.mockResolvedValue([]);

      const result = await buildFewShotBlock("tenant-1");

      expect(result.examples).toHaveLength(0);
      expect(result.promptBlock).toBe("");
      expect(result.totalTokens).toBe(0);
    });

    it("should use custom config when provided", async () => {
      mockStorage.getAiTrainingSamplesByTenant.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) =>
          createMockSample({ id: `${i}`, finalAnswer: `Reply ${i}` })
        )
      );

      const result = await buildFewShotBlock("tenant-1", { maxExamples: 3 });

      expect(result.examples.length).toBeLessThanOrEqual(3);
    });
  });

  describe("estimateTokens", () => {
    it("should estimate tokens based on character count", () => {
      const text = "Hello world"; // 11 chars
      const tokens = fewShotBuilder.estimateTokens(text);
      
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(text.length);
    });

    it("should handle empty string", () => {
      expect(fewShotBuilder.estimateTokens("")).toBe(0);
    });

    it("should handle Cyrillic text", () => {
      const text = "Привет мир"; // 10 chars
      const tokens = fewShotBuilder.estimateTokens(text);
      
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe("DEFAULT_FEW_SHOT_CONFIG", () => {
    it("should have correct default values", () => {
      expect(DEFAULT_FEW_SHOT_CONFIG.maxExamples).toBe(5);
      expect(DEFAULT_FEW_SHOT_CONFIG.maxTokens).toBe(1500);
      expect(DEFAULT_FEW_SHOT_CONFIG.minConfidence).toBe(0.7);
    });
  });
});
