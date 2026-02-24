import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    upsertLearningQueueItem: vi.fn(),
    getLearningQueueByTenant: vi.fn(),
    getLearningQueueItem: vi.fn(),
    updateLearningQueueItem: vi.fn(),
  },
}));

import { storage } from "../storage";
import type { AiSuggestion } from "@shared/schema";
import { LEARNING_SCORE_REASONS } from "@shared/schema";

const mockStorage = storage as {
  upsertLearningQueueItem: ReturnType<typeof vi.fn>;
  getLearningQueueByTenant: ReturnType<typeof vi.fn>;
  getLearningQueueItem: ReturnType<typeof vi.fn>;
  updateLearningQueueItem: ReturnType<typeof vi.fn>;
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

describe("Learning Score Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("calculateLearningScore", () => {
    it("should return score 0 for normal approved suggestion", async () => {
      const { calculateLearningScore } = await import("../services/learning-score-service");
      
      const result = calculateLearningScore({
        suggestion: createMockSuggestion(),
        outcome: "APPROVED",
        tenantId: "tenant-1",
        conversationId: "conv-1",
      });

      expect(result.score).toBe(0);
      expect(result.reasons).toEqual([]);
    });

    it("should add ESCALATED score when decision is ESCALATE", async () => {
      const { calculateLearningScore } = await import("../services/learning-score-service");
      
      const result = calculateLearningScore({
        suggestion: createMockSuggestion({ decision: "ESCALATE" }),
        outcome: "APPROVED",
        tenantId: "tenant-1",
        conversationId: "conv-1",
      });

      expect(result.score).toBe(LEARNING_SCORE_REASONS.ESCALATED.score);
      expect(result.reasons).toContain("ESCALATED");
    });

    it("should add EDITED score when outcome is EDITED", async () => {
      const { calculateLearningScore } = await import("../services/learning-score-service");
      
      const result = calculateLearningScore({
        suggestion: createMockSuggestion(),
        outcome: "EDITED",
        tenantId: "tenant-1",
        conversationId: "conv-1",
      });

      expect(result.score).toBe(LEARNING_SCORE_REASONS.EDITED.score);
      expect(result.reasons).toContain("EDITED");
    });

    it("should add LOW_SIMILARITY score when penalty exists", async () => {
      const { calculateLearningScore } = await import("../services/learning-score-service");
      
      const result = calculateLearningScore({
        suggestion: createMockSuggestion({ 
          penalties: { LOW_SIMILARITY: 0.2 } 
        }),
        outcome: "APPROVED",
        tenantId: "tenant-1",
        conversationId: "conv-1",
      });

      expect(result.score).toBe(LEARNING_SCORE_REASONS.LOW_SIMILARITY.score);
      expect(result.reasons).toContain("LOW_SIMILARITY");
    });

    it("should add STALE_DATA score when penalty exists", async () => {
      const { calculateLearningScore } = await import("../services/learning-score-service");
      
      const result = calculateLearningScore({
        suggestion: createMockSuggestion({ 
          penalties: { STALE_DATA: 0.1 } 
        }),
        outcome: "APPROVED",
        tenantId: "tenant-1",
        conversationId: "conv-1",
      });

      expect(result.score).toBe(LEARNING_SCORE_REASONS.STALE_DATA.score);
      expect(result.reasons).toContain("STALE_DATA");
    });

    it("should add LONG_CONVERSATION score when messages > threshold", async () => {
      const { calculateLearningScore } = await import("../services/learning-score-service");
      
      const result = calculateLearningScore({
        suggestion: createMockSuggestion(),
        outcome: "APPROVED",
        messageCount: 15, // > 10 threshold
        tenantId: "tenant-1",
        conversationId: "conv-1",
      });

      expect(result.score).toBe(LEARNING_SCORE_REASONS.LONG_CONVERSATION.score);
      expect(result.reasons).toContain("LONG_CONVERSATION");
    });

    it("should accumulate multiple scores", async () => {
      const { calculateLearningScore } = await import("../services/learning-score-service");
      
      const result = calculateLearningScore({
        suggestion: createMockSuggestion({ 
          decision: "ESCALATE",
          penalties: { LOW_SIMILARITY: 0.2, STALE_DATA: 0.1 }
        }),
        outcome: "EDITED",
        messageCount: 15,
        tenantId: "tenant-1",
        conversationId: "conv-1",
      });

      const expectedScore = 
        LEARNING_SCORE_REASONS.ESCALATED.score +
        LEARNING_SCORE_REASONS.EDITED.score +
        LEARNING_SCORE_REASONS.LOW_SIMILARITY.score +
        LEARNING_SCORE_REASONS.STALE_DATA.score +
        LEARNING_SCORE_REASONS.LONG_CONVERSATION.score;

      expect(result.score).toBe(expectedScore);
      expect(result.reasons).toContain("ESCALATED");
      expect(result.reasons).toContain("EDITED");
      expect(result.reasons).toContain("LOW_SIMILARITY");
      expect(result.reasons).toContain("STALE_DATA");
      expect(result.reasons).toContain("LONG_CONVERSATION");
    });
  });

  describe("addToLearningQueue", () => {
    it("should not add to queue when score is 0", async () => {
      const { addToLearningQueue } = await import("../services/learning-score-service");
      
      await addToLearningQueue({
        suggestion: createMockSuggestion(),
        outcome: "APPROVED",
        tenantId: "tenant-1",
        conversationId: "conv-1",
      });

      expect(mockStorage.upsertLearningQueueItem).not.toHaveBeenCalled();
    });

    it("should add to queue when score > 0", async () => {
      const { addToLearningQueue } = await import("../services/learning-score-service");
      
      mockStorage.upsertLearningQueueItem.mockResolvedValue({
        id: "item-1",
        tenantId: "tenant-1",
        conversationId: "conv-1",
        learningScore: 2,
        reasons: ["EDITED"],
        status: "pending",
        createdAt: new Date(),
      });

      await addToLearningQueue({
        suggestion: createMockSuggestion(),
        outcome: "EDITED",
        tenantId: "tenant-1",
        conversationId: "conv-1",
      });

      expect(mockStorage.upsertLearningQueueItem).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        learningScore: LEARNING_SCORE_REASONS.EDITED.score,
        reasons: ["EDITED"],
        status: "pending",
      });
    });
  });

  describe("getLearningQueue with filtering", () => {
    it("should filter by minScore", async () => {
      const { getLearningQueue } = await import("../services/learning-score-service");
      
      const mockItems = [
        { id: "1", conversationId: "c1", learningScore: 5, reasons: ["ESCALATED", "EDITED"], status: "pending" },
        { id: "2", conversationId: "c2", learningScore: 2, reasons: ["EDITED"], status: "pending" },
      ];
      
      mockStorage.getLearningQueueByTenant.mockResolvedValue(mockItems);

      const result = await getLearningQueue("tenant-1", 3);

      expect(mockStorage.getLearningQueueByTenant).toHaveBeenCalledWith("tenant-1", 3);
      expect(result.total).toBe(2);
    });
  });

  describe("LEARNING_SCORE_REASONS constants", () => {
    it("should have correct score values", () => {
      expect(LEARNING_SCORE_REASONS.ESCALATED.score).toBe(3);
      expect(LEARNING_SCORE_REASONS.EDITED.score).toBe(2);
      expect(LEARNING_SCORE_REASONS.LOW_SIMILARITY.score).toBe(2);
      expect(LEARNING_SCORE_REASONS.STALE_DATA.score).toBe(3);
      expect(LEARNING_SCORE_REASONS.LONG_CONVERSATION.score).toBe(1);
      expect(LEARNING_SCORE_REASONS.MULTIPLE_REJECTIONS.score).toBe(2);
    });

    it("should have Russian labels", () => {
      expect(LEARNING_SCORE_REASONS.ESCALATED.label).toBe("Эскалация");
      expect(LEARNING_SCORE_REASONS.EDITED.label).toBe("Редактирование");
    });
  });
});
