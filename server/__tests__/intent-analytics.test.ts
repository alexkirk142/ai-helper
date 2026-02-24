import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    getSuggestionsByTenant: vi.fn(),
    getCsatRatingsByTenant: vi.fn(),
    getConversionsByTenant: vi.fn(),
    getConversationsByTenant: vi.fn(),
  },
}));

import { storage } from "../storage";
import { getIntentAnalytics } from "../services/intent-analytics-service";

describe("Intent Analytics Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getIntentAnalytics", () => {
    it("should return empty intents when no suggestions", async () => {
      vi.mocked(storage.getSuggestionsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getCsatRatingsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversionsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversationsByTenant).mockResolvedValue([]);

      const analytics = await getIntentAnalytics("tenant-1");

      expect(analytics.intents).toHaveLength(0);
      expect(analytics.totalIntents).toBe(0);
      expect(analytics.totalConversations).toBe(0);
    });

    it("should calculate autosendRate and escalationRate correctly", async () => {
      vi.mocked(storage.getSuggestionsByTenant).mockResolvedValue([
        { id: "s1", tenantId: "tenant-1", conversationId: "c1", intent: "price", decision: "AUTO_SEND", confidence: 90 },
        { id: "s2", tenantId: "tenant-1", conversationId: "c2", intent: "price", decision: "AUTO_SEND", confidence: 85 },
        { id: "s3", tenantId: "tenant-1", conversationId: "c3", intent: "price", decision: "ESCALATE", confidence: 30 },
        { id: "s4", tenantId: "tenant-1", conversationId: "c4", intent: "price", decision: "NEED_APPROVAL", confidence: 60 },
      ] as any);
      vi.mocked(storage.getCsatRatingsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversionsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversationsByTenant).mockResolvedValue([
        { id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" },
      ] as any);

      const analytics = await getIntentAnalytics("tenant-1");

      expect(analytics.intents).toHaveLength(1);
      const priceIntent = analytics.intents[0];
      expect(priceIntent.intent).toBe("price");
      expect(priceIntent.autosendRate).toBe(50);
      expect(priceIntent.escalationRate).toBe(25);
      expect(priceIntent.avgConfidence).toBe(66);
    });

    it("should calculate csatAvg correctly", async () => {
      vi.mocked(storage.getSuggestionsByTenant).mockResolvedValue([
        { id: "s1", tenantId: "tenant-1", conversationId: "c1", intent: "shipping", decision: "AUTO_SEND", confidence: 80 },
        { id: "s2", tenantId: "tenant-1", conversationId: "c2", intent: "shipping", decision: "AUTO_SEND", confidence: 85 },
      ] as any);
      vi.mocked(storage.getCsatRatingsByTenant).mockResolvedValue([
        { id: "r1", tenantId: "tenant-1", conversationId: "c1", intent: "shipping", rating: 5 },
        { id: "r2", tenantId: "tenant-1", conversationId: "c2", intent: "shipping", rating: 4 },
      ] as any);
      vi.mocked(storage.getConversionsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversationsByTenant).mockResolvedValue([
        { id: "c1" }, { id: "c2" },
      ] as any);

      const analytics = await getIntentAnalytics("tenant-1");

      expect(analytics.intents).toHaveLength(1);
      expect(analytics.intents[0].csatAvg).toBe(4.5);
    });

    it("should calculate conversionRate and lostDealRate correctly", async () => {
      vi.mocked(storage.getSuggestionsByTenant).mockResolvedValue([
        { id: "s1", tenantId: "tenant-1", conversationId: "c1", intent: "availability", decision: "AUTO_SEND", confidence: 90 },
        { id: "s2", tenantId: "tenant-1", conversationId: "c2", intent: "availability", decision: "AUTO_SEND", confidence: 85 },
        { id: "s3", tenantId: "tenant-1", conversationId: "c3", intent: "availability", decision: "NEED_APPROVAL", confidence: 70 },
        { id: "s4", tenantId: "tenant-1", conversationId: "c4", intent: "availability", decision: "NEED_APPROVAL", confidence: 75 },
      ] as any);
      vi.mocked(storage.getCsatRatingsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversionsByTenant).mockResolvedValue([
        { id: "conv1", tenantId: "tenant-1", conversationId: "c1", intent: "availability", amount: 1000 },
      ] as any);
      vi.mocked(storage.getConversationsByTenant).mockResolvedValue([
        { id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" },
      ] as any);

      const analytics = await getIntentAnalytics("tenant-1");

      expect(analytics.intents).toHaveLength(1);
      const availabilityIntent = analytics.intents[0];
      expect(availabilityIntent.conversionRate).toBe(25);
      expect(availabilityIntent.lostDealRate).toBe(75);
    });

    it("should assign correct status based on metrics", async () => {
      vi.mocked(storage.getSuggestionsByTenant).mockResolvedValue([
        { id: "s1", tenantId: "tenant-1", conversationId: "c1", intent: "complaint", decision: "ESCALATE", confidence: 60 },
        { id: "s2", tenantId: "tenant-1", conversationId: "c2", intent: "complaint", decision: "ESCALATE", confidence: 55 },
        { id: "s3", tenantId: "tenant-1", conversationId: "c3", intent: "complaint", decision: "ESCALATE", confidence: 50 },
        { id: "s4", tenantId: "tenant-1", conversationId: "c4", intent: "complaint", decision: "ESCALATE", confidence: 65 },
        { id: "s5", tenantId: "tenant-1", conversationId: "c5", intent: "complaint", decision: "ESCALATE", confidence: 70 },
      ] as any);
      vi.mocked(storage.getCsatRatingsByTenant).mockResolvedValue([
        { id: "r1", tenantId: "tenant-1", conversationId: "c1", intent: "complaint", rating: 2 },
        { id: "r2", tenantId: "tenant-1", conversationId: "c2", intent: "complaint", rating: 2 },
        { id: "r3", tenantId: "tenant-1", conversationId: "c3", intent: "complaint", rating: 3 },
      ] as any);
      vi.mocked(storage.getConversionsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversationsByTenant).mockResolvedValue([
        { id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }, { id: "c5" },
      ] as any);

      const analytics = await getIntentAnalytics("tenant-1");

      expect(analytics.intents[0].status).toBe("critical");
      expect(analytics.intents[0].recommendation).toContain("человек");
    });

    it("should recommend autosend when confidence is high", async () => {
      vi.mocked(storage.getSuggestionsByTenant).mockResolvedValue([
        { id: "s1", tenantId: "tenant-1", conversationId: "c1", intent: "price", decision: "NEED_APPROVAL", confidence: 95 },
        { id: "s2", tenantId: "tenant-1", conversationId: "c2", intent: "price", decision: "NEED_APPROVAL", confidence: 90 },
        { id: "s3", tenantId: "tenant-1", conversationId: "c3", intent: "price", decision: "NEED_APPROVAL", confidence: 85 },
        { id: "s4", tenantId: "tenant-1", conversationId: "c4", intent: "price", decision: "NEED_APPROVAL", confidence: 88 },
        { id: "s5", tenantId: "tenant-1", conversationId: "c5", intent: "price", decision: "AUTO_SEND", confidence: 92 },
      ] as any);
      vi.mocked(storage.getCsatRatingsByTenant).mockResolvedValue([
        { id: "r1", tenantId: "tenant-1", conversationId: "c1", intent: "price", rating: 5 },
        { id: "r2", tenantId: "tenant-1", conversationId: "c2", intent: "price", rating: 4 },
        { id: "r3", tenantId: "tenant-1", conversationId: "c3", intent: "price", rating: 5 },
        { id: "r4", tenantId: "tenant-1", conversationId: "c4", intent: "price", rating: 4 },
        { id: "r5", tenantId: "tenant-1", conversationId: "c5", intent: "price", rating: 5 },
      ] as any);
      vi.mocked(storage.getConversionsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversationsByTenant).mockResolvedValue([
        { id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }, { id: "c5" },
      ] as any);

      const analytics = await getIntentAnalytics("tenant-1");

      expect(analytics.intents[0].status).toBe("good");
      expect(analytics.intents[0].recommendation).toContain("autosend");
    });

    it("should handle multiple intents correctly", async () => {
      vi.mocked(storage.getSuggestionsByTenant).mockResolvedValue([
        { id: "s1", tenantId: "tenant-1", conversationId: "c1", intent: "price", decision: "AUTO_SEND", confidence: 90 },
        { id: "s2", tenantId: "tenant-1", conversationId: "c2", intent: "shipping", decision: "NEED_APPROVAL", confidence: 70 },
        { id: "s3", tenantId: "tenant-1", conversationId: "c3", intent: "return", decision: "ESCALATE", confidence: 40 },
      ] as any);
      vi.mocked(storage.getCsatRatingsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversionsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversationsByTenant).mockResolvedValue([
        { id: "c1" }, { id: "c2" }, { id: "c3" },
      ] as any);

      const analytics = await getIntentAnalytics("tenant-1");

      expect(analytics.intents).toHaveLength(3);
      expect(analytics.totalIntents).toBe(3);
      expect(analytics.intents.map(i => i.intent)).toContain("price");
      expect(analytics.intents.map(i => i.intent)).toContain("shipping");
      expect(analytics.intents.map(i => i.intent)).toContain("return");
    });

    it("should recommend adding data when confidence is low", async () => {
      vi.mocked(storage.getSuggestionsByTenant).mockResolvedValue([
        { id: "s1", tenantId: "tenant-1", conversationId: "c1", intent: "other", decision: "NEED_APPROVAL", confidence: 30 },
        { id: "s2", tenantId: "tenant-1", conversationId: "c2", intent: "other", decision: "NEED_APPROVAL", confidence: 35 },
        { id: "s3", tenantId: "tenant-1", conversationId: "c3", intent: "other", decision: "NEED_APPROVAL", confidence: 40 },
        { id: "s4", tenantId: "tenant-1", conversationId: "c4", intent: "other", decision: "NEED_APPROVAL", confidence: 45 },
        { id: "s5", tenantId: "tenant-1", conversationId: "c5", intent: "other", decision: "NEED_APPROVAL", confidence: 50 },
      ] as any);
      vi.mocked(storage.getCsatRatingsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversionsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversationsByTenant).mockResolvedValue([
        { id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }, { id: "c5" },
      ] as any);

      const analytics = await getIntentAnalytics("tenant-1");

      expect(analytics.intents[0].recommendation).toContain("Добавить данные");
    });
  });
});
