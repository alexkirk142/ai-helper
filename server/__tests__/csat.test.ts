import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculateAvgCsat } from "../services/csat-service";

vi.mock("../storage", () => ({
  storage: {
    getCsatRatingByConversation: vi.fn(),
    getConversation: vi.fn(),
    createCsatRating: vi.fn(),
    getCsatRatingsByTenant: vi.fn(),
  },
}));

describe("CSAT Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("calculateAvgCsat", () => {
    it("should return 0 for empty array", () => {
      expect(calculateAvgCsat([])).toBe(0);
    });

    it("should calculate average correctly for single rating", () => {
      expect(calculateAvgCsat([5])).toBe(5);
    });

    it("should calculate average correctly for multiple ratings", () => {
      expect(calculateAvgCsat([1, 2, 3, 4, 5])).toBe(3);
    });

    it("should calculate average correctly for high ratings", () => {
      expect(calculateAvgCsat([4, 5, 5, 5])).toBe(4.75);
    });

    it("should calculate average correctly for low ratings", () => {
      expect(calculateAvgCsat([1, 1, 2, 2])).toBe(1.5);
    });
  });

  describe("CSAT Analytics calculation", () => {
    it("should identify problem intents correctly", async () => {
      const { storage } = await import("../storage");
      const { getCsatAnalytics } = await import("../services/csat-service");

      vi.mocked(storage.getCsatRatingsByTenant).mockResolvedValue([
        { id: "1", tenantId: "t1", conversationId: "c1", rating: 2, comment: null, intent: "complaint", decision: "ESCALATE", createdAt: new Date() },
        { id: "2", tenantId: "t1", conversationId: "c2", rating: 1, comment: null, intent: "complaint", decision: "ESCALATE", createdAt: new Date() },
        { id: "3", tenantId: "t1", conversationId: "c3", rating: 5, comment: null, intent: "price", decision: "AUTO_SEND", createdAt: new Date() },
        { id: "4", tenantId: "t1", conversationId: "c4", rating: 4, comment: null, intent: "price", decision: "AUTO_SEND", createdAt: new Date() },
      ]);

      const analytics = await getCsatAnalytics("t1");

      expect(analytics.avgScore).toBe(3);
      expect(analytics.totalRatings).toBe(4);
      expect(analytics.problemIntents).toHaveLength(1);
      expect(analytics.problemIntents[0].key).toBe("complaint");
      expect(analytics.problemIntents[0].avgScore).toBe(1.5);
    });

    it("should calculate distribution correctly", async () => {
      const { storage } = await import("../storage");
      const { getCsatAnalytics } = await import("../services/csat-service");

      vi.mocked(storage.getCsatRatingsByTenant).mockResolvedValue([
        { id: "1", tenantId: "t1", conversationId: "c1", rating: 5, comment: null, intent: null, decision: null, createdAt: new Date() },
        { id: "2", tenantId: "t1", conversationId: "c2", rating: 5, comment: null, intent: null, decision: null, createdAt: new Date() },
        { id: "3", tenantId: "t1", conversationId: "c3", rating: 4, comment: null, intent: null, decision: null, createdAt: new Date() },
        { id: "4", tenantId: "t1", conversationId: "c4", rating: 3, comment: null, intent: null, decision: null, createdAt: new Date() },
      ]);

      const analytics = await getCsatAnalytics("t1");

      expect(analytics.distribution).toHaveLength(5);
      expect(analytics.distribution.find(d => d.rating === 5)?.count).toBe(2);
      expect(analytics.distribution.find(d => d.rating === 5)?.percentage).toBe(50);
      expect(analytics.distribution.find(d => d.rating === 4)?.count).toBe(1);
      expect(analytics.distribution.find(d => d.rating === 3)?.count).toBe(1);
      expect(analytics.distribution.find(d => d.rating === 1)?.count).toBe(0);
    });

    it("should return empty analytics for no ratings", async () => {
      const { storage } = await import("../storage");
      const { getCsatAnalytics } = await import("../services/csat-service");

      vi.mocked(storage.getCsatRatingsByTenant).mockResolvedValue([]);

      const analytics = await getCsatAnalytics("t1");

      expect(analytics.avgScore).toBe(0);
      expect(analytics.totalRatings).toBe(0);
      expect(analytics.byIntent).toHaveLength(0);
      expect(analytics.byDecision).toHaveLength(0);
      expect(analytics.problemIntents).toHaveLength(0);
    });

    it("should breakdown by decision correctly", async () => {
      const { storage } = await import("../storage");
      const { getCsatAnalytics } = await import("../services/csat-service");

      vi.mocked(storage.getCsatRatingsByTenant).mockResolvedValue([
        { id: "1", tenantId: "t1", conversationId: "c1", rating: 5, comment: null, intent: null, decision: "AUTO_SEND", createdAt: new Date() },
        { id: "2", tenantId: "t1", conversationId: "c2", rating: 4, comment: null, intent: null, decision: "AUTO_SEND", createdAt: new Date() },
        { id: "3", tenantId: "t1", conversationId: "c3", rating: 2, comment: null, intent: null, decision: "ESCALATE", createdAt: new Date() },
      ]);

      const analytics = await getCsatAnalytics("t1");

      expect(analytics.byDecision).toHaveLength(2);
      
      const autoSend = analytics.byDecision.find(d => d.key === "AUTO_SEND");
      expect(autoSend?.avgScore).toBe(4.5);
      expect(autoSend?.count).toBe(2);
      
      const escalate = analytics.byDecision.find(d => d.key === "ESCALATE");
      expect(escalate?.avgScore).toBe(2);
      expect(escalate?.count).toBe(1);
    });
  });

  describe("submitCsatRating", () => {
    it("should prevent duplicate submissions", async () => {
      const { storage } = await import("../storage");
      const { submitCsatRating } = await import("../services/csat-service");

      vi.mocked(storage.getCsatRatingByConversation).mockResolvedValue({
        id: "existing",
        tenantId: "t1",
        conversationId: "c1",
        rating: 5,
        comment: null,
        intent: null,
        decision: null,
        createdAt: new Date(),
      });

      const result = await submitCsatRating({
        tenantId: "t1",
        conversationId: "c1",
        rating: 4,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already submitted");
    });

    it("should reject if conversation not found", async () => {
      const { storage } = await import("../storage");
      const { submitCsatRating } = await import("../services/csat-service");

      vi.mocked(storage.getCsatRatingByConversation).mockResolvedValue(undefined);
      vi.mocked(storage.getConversation).mockResolvedValue(undefined);

      const result = await submitCsatRating({
        tenantId: "t1",
        conversationId: "c1",
        rating: 4,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should reject tenant mismatch", async () => {
      const { storage } = await import("../storage");
      const { submitCsatRating } = await import("../services/csat-service");

      vi.mocked(storage.getCsatRatingByConversation).mockResolvedValue(undefined);
      vi.mocked(storage.getConversation).mockResolvedValue({
        id: "c1",
        tenantId: "other-tenant",
        customerId: "cust1",
        channelId: null,
        status: "resolved",
        mode: "learning",
        lastMessageAt: new Date(),
        unreadCount: 0,
        createdAt: new Date(),
      });

      const result = await submitCsatRating({
        tenantId: "t1",
        conversationId: "c1",
        rating: 4,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("mismatch");
    });

    it("should successfully create rating", async () => {
      const { storage } = await import("../storage");
      const { submitCsatRating } = await import("../services/csat-service");

      vi.mocked(storage.getCsatRatingByConversation).mockResolvedValue(undefined);
      vi.mocked(storage.getConversation).mockResolvedValue({
        id: "c1",
        tenantId: "t1",
        customerId: "cust1",
        channelId: null,
        status: "resolved",
        mode: "learning",
        lastMessageAt: new Date(),
        unreadCount: 0,
        createdAt: new Date(),
      });
      vi.mocked(storage.createCsatRating).mockResolvedValue({
        id: "new-rating",
        tenantId: "t1",
        conversationId: "c1",
        rating: 5,
        comment: "Great!",
        intent: null,
        decision: null,
        createdAt: new Date(),
      });

      const result = await submitCsatRating({
        tenantId: "t1",
        conversationId: "c1",
        rating: 5,
        comment: "Great!",
      });

      expect(result.success).toBe(true);
      expect(storage.createCsatRating).toHaveBeenCalledWith({
        tenantId: "t1",
        conversationId: "c1",
        rating: 5,
        comment: "Great!",
      });
    });
  });
});
