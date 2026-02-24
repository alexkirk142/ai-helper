import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    getAiTrainingSamplesByTenant: vi.fn(),
    getAiTrainingPolicy: vi.fn(),
    createAiTrainingSample: vi.fn(),
    upsertAiTrainingPolicy: vi.fn(),
  },
}));

import { storage } from "../storage";
import type { AiSuggestion, AiTrainingSample, AiTrainingPolicy } from "@shared/schema";

const mockStorage = storage as {
  getAiTrainingSamplesByTenant: ReturnType<typeof vi.fn>;
  getAiTrainingPolicy: ReturnType<typeof vi.fn>;
  createAiTrainingSample: ReturnType<typeof vi.fn>;
  upsertAiTrainingPolicy: ReturnType<typeof vi.fn>;
};

function createMockSuggestion(overrides: Partial<AiSuggestion> = {}): AiSuggestion {
  return {
    id: "suggestion-1",
    conversationId: "conv-1",
    suggestedReply: "Test reply",
    intent: "price",
    decision: "NEED_APPROVAL",
    createdAt: new Date(),
    confidence: null,
    similarityScore: null,
    intentScore: null,
    selfCheckScore: null,
    explanations: null,
    penalties: null,
    sourceConflicts: null,
    missingFields: null,
    autosendEligible: null,
    autosendBlockReason: null,
    selfCheckNeedHandoff: null,
    selfCheckReasons: null,
    ...overrides,
  };
}

function createMockSample(overrides: Partial<AiTrainingSample> = {}): AiTrainingSample {
  return {
    id: "sample-1",
    tenantId: "tenant-1",
    conversationId: "conv-1",
    userMessage: "Test message",
    aiSuggestion: "AI suggestion",
    finalAnswer: "Final answer",
    intent: "price",
    decision: "AUTO_SEND",
    outcome: "APPROVED",
    rejectionReason: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockPolicy(overrides: Partial<AiTrainingPolicy> = {}): AiTrainingPolicy {
  return {
    tenantId: "tenant-1",
    alwaysEscalateIntents: [],
    forbiddenTopics: [],
    disabledLearningIntents: [],
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Training Policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("forbiddenTopics blocks training samples", () => {
    it("should not create sample when message contains forbidden topic", async () => {
      const { recordTrainingSample } = await import("../services/training-sample-service");
      
      mockStorage.getAiTrainingPolicy.mockResolvedValue(
        createMockPolicy({ forbiddenTopics: ["конкурент", "lawsuit"] })
      );
      mockStorage.createAiTrainingSample.mockResolvedValue(createMockSample());

      const result = await recordTrainingSample({
        suggestion: createMockSuggestion(),
        userMessage: "Почему ваш конкурент лучше?",
        finalAnswer: "Мы лучше",
        outcome: "APPROVED",
        tenantId: "tenant-1",
      });

      expect(result).toBeNull();
      expect(mockStorage.createAiTrainingSample).not.toHaveBeenCalled();
    });

    it("should create sample when no forbidden topic is found", async () => {
      const { recordTrainingSample } = await import("../services/training-sample-service");
      
      mockStorage.getAiTrainingPolicy.mockResolvedValue(
        createMockPolicy({ forbiddenTopics: ["конкурент"] })
      );
      const mockSample = createMockSample();
      mockStorage.createAiTrainingSample.mockResolvedValue(mockSample);

      const result = await recordTrainingSample({
        suggestion: createMockSuggestion(),
        userMessage: "Сколько стоит товар?",
        finalAnswer: "1000 рублей",
        outcome: "APPROVED",
        tenantId: "tenant-1",
      });

      expect(result).toEqual(mockSample);
      expect(mockStorage.createAiTrainingSample).toHaveBeenCalled();
    });

    it("should create sample when no policy exists", async () => {
      const { recordTrainingSample } = await import("../services/training-sample-service");
      
      mockStorage.getAiTrainingPolicy.mockResolvedValue(undefined);
      const mockSample = createMockSample();
      mockStorage.createAiTrainingSample.mockResolvedValue(mockSample);

      const result = await recordTrainingSample({
        suggestion: createMockSuggestion(),
        userMessage: "Any message here",
        finalAnswer: "Response",
        outcome: "APPROVED",
        tenantId: "tenant-1",
      });

      expect(result).toEqual(mockSample);
      expect(mockStorage.createAiTrainingSample).toHaveBeenCalled();
    });

    it("should check forbidden topics case-insensitively", async () => {
      const { recordTrainingSample } = await import("../services/training-sample-service");
      
      mockStorage.getAiTrainingPolicy.mockResolvedValue(
        createMockPolicy({ forbiddenTopics: ["LAWSUIT"] })
      );
      mockStorage.createAiTrainingSample.mockResolvedValue(createMockSample());

      const result = await recordTrainingSample({
        suggestion: createMockSuggestion(),
        userMessage: "Any lawsuit questions?",
        finalAnswer: "Response",
        outcome: "APPROVED",
        tenantId: "tenant-1",
      });

      expect(result).toBeNull();
      expect(mockStorage.createAiTrainingSample).not.toHaveBeenCalled();
    });
  });

  describe("disabledLearningIntents filters few-shot examples", () => {
    it("should filter out samples with disabled intents", async () => {
      const { selectFewShotExamples } = await import("../services/few-shot-builder");

      mockStorage.getAiTrainingSamplesByTenant.mockResolvedValue([
        createMockSample({ id: "1", intent: "price", outcome: "APPROVED" }),
        createMockSample({ id: "2", intent: "discount", outcome: "APPROVED" }),
        createMockSample({ id: "3", intent: "shipping", outcome: "APPROVED" }),
      ]);
      mockStorage.getAiTrainingPolicy.mockResolvedValue(
        createMockPolicy({ disabledLearningIntents: ["discount"] })
      );

      const examples = await selectFewShotExamples("tenant-1");

      expect(examples.length).toBe(2);
      expect(examples.every(e => e.intent !== "discount")).toBe(true);
    });

    it("should include all samples when no intents are disabled", async () => {
      const { selectFewShotExamples } = await import("../services/few-shot-builder");

      mockStorage.getAiTrainingSamplesByTenant.mockResolvedValue([
        createMockSample({ id: "1", intent: "price", outcome: "APPROVED" }),
        createMockSample({ id: "2", intent: "discount", outcome: "APPROVED" }),
      ]);
      mockStorage.getAiTrainingPolicy.mockResolvedValue(
        createMockPolicy({ disabledLearningIntents: [] })
      );

      const examples = await selectFewShotExamples("tenant-1");

      expect(examples.length).toBe(2);
    });

    it("should include all samples when no policy exists", async () => {
      const { selectFewShotExamples } = await import("../services/few-shot-builder");

      mockStorage.getAiTrainingSamplesByTenant.mockResolvedValue([
        createMockSample({ id: "1", intent: "price", outcome: "APPROVED" }),
        createMockSample({ id: "2", intent: "discount", outcome: "APPROVED" }),
      ]);
      mockStorage.getAiTrainingPolicy.mockResolvedValue(undefined);

      const examples = await selectFewShotExamples("tenant-1");

      expect(examples.length).toBe(2);
    });
  });

  describe("storage methods", () => {
    it("should get training policy by tenant", async () => {
      const mockPolicy = createMockPolicy();
      mockStorage.getAiTrainingPolicy.mockResolvedValue(mockPolicy);

      const result = await storage.getAiTrainingPolicy("tenant-1");

      expect(result).toEqual(mockPolicy);
      expect(mockStorage.getAiTrainingPolicy).toHaveBeenCalledWith("tenant-1");
    });

    it("should upsert training policy", async () => {
      const mockPolicy = createMockPolicy({
        alwaysEscalateIntents: ["complaint"],
        forbiddenTopics: ["secret"],
      });
      mockStorage.upsertAiTrainingPolicy.mockResolvedValue(mockPolicy);

      const result = await storage.upsertAiTrainingPolicy({
        tenantId: "tenant-1",
        alwaysEscalateIntents: ["complaint"],
        forbiddenTopics: ["secret"],
      });

      expect(result).toEqual(mockPolicy);
    });
  });

  describe("validation constants", () => {
    it("should export VALID_INTENTS", async () => {
      const { VALID_INTENTS } = await import("@shared/schema");
      expect(Array.isArray(VALID_INTENTS)).toBe(true);
      expect(VALID_INTENTS).toContain("price");
      expect(VALID_INTENTS).toContain("complaint");
      expect(VALID_INTENTS.length).toBeGreaterThan(0);
    });

    it("should export TRAINING_POLICY_LIMITS", async () => {
      const { TRAINING_POLICY_LIMITS } = await import("@shared/schema");
      expect(TRAINING_POLICY_LIMITS.maxIntentsListSize).toBe(50);
      expect(TRAINING_POLICY_LIMITS.maxForbiddenTopicsSize).toBe(100);
      expect(TRAINING_POLICY_LIMITS.maxTopicLength).toBe(200);
    });
  });
});
