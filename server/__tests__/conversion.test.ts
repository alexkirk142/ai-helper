import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    getConversionByConversation: vi.fn(),
    getConversation: vi.fn(),
    getSuggestionsByConversation: vi.fn(),
    createConversion: vi.fn(),
    getConversionsByTenant: vi.fn(),
    getConversationsByTenant: vi.fn(),
  },
}));

describe("Conversion Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("submitConversion", () => {
    it("should prevent duplicate conversions", async () => {
      const { storage } = await import("../storage");
      const { submitConversion } = await import("../services/conversion-service");

      vi.mocked(storage.getConversionByConversation).mockResolvedValue({
        id: "existing",
        tenantId: "t1",
        conversationId: "c1",
        amount: 1000,
        currency: "RUB",
        intent: null,
        decision: null,
        createdAt: new Date(),
      });

      const result = await submitConversion({
        tenantId: "t1",
        conversationId: "c1",
        amount: 500,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already submitted");
    });

    it("should reject if conversation not found", async () => {
      const { storage } = await import("../storage");
      const { submitConversion } = await import("../services/conversion-service");

      vi.mocked(storage.getConversionByConversation).mockResolvedValue(undefined);
      vi.mocked(storage.getConversation).mockResolvedValue(undefined);

      const result = await submitConversion({
        tenantId: "t1",
        conversationId: "c1",
        amount: 1000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should reject tenant mismatch", async () => {
      const { storage } = await import("../storage");
      const { submitConversion } = await import("../services/conversion-service");

      vi.mocked(storage.getConversionByConversation).mockResolvedValue(undefined);
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

      const result = await submitConversion({
        tenantId: "t1",
        conversationId: "c1",
        amount: 1000,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("mismatch");
    });

    it("should successfully create conversion with intent from suggestion", async () => {
      const { storage } = await import("../storage");
      const { submitConversion } = await import("../services/conversion-service");

      vi.mocked(storage.getConversionByConversation).mockResolvedValue(undefined);
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
      vi.mocked(storage.getSuggestionsByConversation).mockResolvedValue([
        {
          id: "sug1",
          tenantId: "t1",
          conversationId: "c1",
          messageId: "m1",
          intent: "price",
          confidence: 0.9,
          suggestedReply: "test",
          decision: "AUTO_SEND",
          status: "sent",
          createdAt: new Date(),
          usedSources: [],
          explanations: [],
          penalties: [],
        },
      ]);
      vi.mocked(storage.createConversion).mockResolvedValue({
        id: "conv1",
        tenantId: "t1",
        conversationId: "c1",
        amount: 1500,
        currency: "RUB",
        intent: "price",
        decision: "AUTO_SEND",
        createdAt: new Date(),
      });

      const result = await submitConversion({
        tenantId: "t1",
        conversationId: "c1",
        amount: 1500,
        currency: "RUB",
      });

      expect(result.success).toBe(true);
      expect(result.conversion?.amount).toBe(1500);
      expect(storage.createConversion).toHaveBeenCalledWith({
        tenantId: "t1",
        conversationId: "c1",
        amount: 1500,
        currency: "RUB",
        intent: "price",
        decision: "AUTO_SEND",
      });
    });
  });

  describe("getConversionAnalytics", () => {
    it("should calculate conversion rate correctly", async () => {
      const { storage } = await import("../storage");
      const { getConversionAnalytics } = await import("../services/conversion-service");

      vi.mocked(storage.getConversionsByTenant).mockResolvedValue([
        { id: "1", tenantId: "t1", conversationId: "c1", amount: 1000, currency: "RUB", intent: "price", decision: "AUTO_SEND", createdAt: new Date() },
        { id: "2", tenantId: "t1", conversationId: "c2", amount: 2000, currency: "RUB", intent: "price", decision: "AUTO_SEND", createdAt: new Date() },
      ]);
      vi.mocked(storage.getConversationsByTenant).mockResolvedValue([
        { id: "c1", tenantId: "t1", customerId: "cust1", channelId: null, status: "resolved", mode: "learning", lastMessageAt: new Date(), unreadCount: 0, createdAt: new Date() },
        { id: "c2", tenantId: "t1", customerId: "cust2", channelId: null, status: "resolved", mode: "learning", lastMessageAt: new Date(), unreadCount: 0, createdAt: new Date() },
        { id: "c3", tenantId: "t1", customerId: "cust3", channelId: null, status: "active", mode: "learning", lastMessageAt: new Date(), unreadCount: 0, createdAt: new Date() },
        { id: "c4", tenantId: "t1", customerId: "cust4", channelId: null, status: "active", mode: "learning", lastMessageAt: new Date(), unreadCount: 0, createdAt: new Date() },
      ]);

      const analytics = await getConversionAnalytics("t1");

      expect(analytics.totalConversions).toBe(2);
      expect(analytics.totalConversations).toBe(4);
      expect(analytics.conversionRate).toBe(50);
      expect(analytics.totalRevenue).toBe(3000);
      expect(analytics.avgAmount).toBe(1500);
    });

    it("should calculate breakdown by intent correctly", async () => {
      const { storage } = await import("../storage");
      const { getConversionAnalytics } = await import("../services/conversion-service");

      vi.mocked(storage.getConversionsByTenant).mockResolvedValue([
        { id: "1", tenantId: "t1", conversationId: "c1", amount: 1000, currency: "RUB", intent: "price", decision: "AUTO_SEND", createdAt: new Date() },
        { id: "2", tenantId: "t1", conversationId: "c2", amount: 2000, currency: "RUB", intent: "price", decision: "AUTO_SEND", createdAt: new Date() },
        { id: "3", tenantId: "t1", conversationId: "c3", amount: 500, currency: "RUB", intent: "availability", decision: "NEED_APPROVAL", createdAt: new Date() },
      ]);
      vi.mocked(storage.getConversationsByTenant).mockResolvedValue([
        { id: "c1", tenantId: "t1", customerId: "cust1", channelId: null, status: "resolved", mode: "learning", lastMessageAt: new Date(), unreadCount: 0, createdAt: new Date() },
        { id: "c2", tenantId: "t1", customerId: "cust2", channelId: null, status: "resolved", mode: "learning", lastMessageAt: new Date(), unreadCount: 0, createdAt: new Date() },
        { id: "c3", tenantId: "t1", customerId: "cust3", channelId: null, status: "resolved", mode: "learning", lastMessageAt: new Date(), unreadCount: 0, createdAt: new Date() },
      ]);

      const analytics = await getConversionAnalytics("t1");

      expect(analytics.byIntent).toHaveLength(2);
      
      const priceIntent = analytics.byIntent.find(b => b.key === "price");
      expect(priceIntent?.count).toBe(2);
      expect(priceIntent?.totalRevenue).toBe(3000);
      expect(priceIntent?.avgAmount).toBe(1500);
      
      const availIntent = analytics.byIntent.find(b => b.key === "availability");
      expect(availIntent?.count).toBe(1);
      expect(availIntent?.totalRevenue).toBe(500);
    });

    it("should calculate top intents by revenue", async () => {
      const { storage } = await import("../storage");
      const { getConversionAnalytics } = await import("../services/conversion-service");

      vi.mocked(storage.getConversionsByTenant).mockResolvedValue([
        { id: "1", tenantId: "t1", conversationId: "c1", amount: 5000, currency: "RUB", intent: "price", decision: "AUTO_SEND", createdAt: new Date() },
        { id: "2", tenantId: "t1", conversationId: "c2", amount: 1000, currency: "RUB", intent: "availability", decision: "AUTO_SEND", createdAt: new Date() },
        { id: "3", tenantId: "t1", conversationId: "c3", amount: 3000, currency: "RUB", intent: "discount", decision: "NEED_APPROVAL", createdAt: new Date() },
      ]);
      vi.mocked(storage.getConversationsByTenant).mockResolvedValue([
        { id: "c1", tenantId: "t1", customerId: "cust1", channelId: null, status: "resolved", mode: "learning", lastMessageAt: new Date(), unreadCount: 0, createdAt: new Date() },
        { id: "c2", tenantId: "t1", customerId: "cust2", channelId: null, status: "resolved", mode: "learning", lastMessageAt: new Date(), unreadCount: 0, createdAt: new Date() },
        { id: "c3", tenantId: "t1", customerId: "cust3", channelId: null, status: "resolved", mode: "learning", lastMessageAt: new Date(), unreadCount: 0, createdAt: new Date() },
      ]);

      const analytics = await getConversionAnalytics("t1");

      expect(analytics.topIntentsByRevenue).toHaveLength(3);
      expect(analytics.topIntentsByRevenue[0].key).toBe("price");
      expect(analytics.topIntentsByRevenue[0].totalRevenue).toBe(5000);
      expect(analytics.topIntentsByRevenue[1].key).toBe("discount");
      expect(analytics.topIntentsByRevenue[2].key).toBe("availability");
    });

    it("should return empty analytics for no conversions", async () => {
      const { storage } = await import("../storage");
      const { getConversionAnalytics } = await import("../services/conversion-service");

      vi.mocked(storage.getConversionsByTenant).mockResolvedValue([]);
      vi.mocked(storage.getConversationsByTenant).mockResolvedValue([]);

      const analytics = await getConversionAnalytics("t1");

      expect(analytics.conversionRate).toBe(0);
      expect(analytics.totalConversions).toBe(0);
      expect(analytics.totalRevenue).toBe(0);
      expect(analytics.byIntent).toHaveLength(0);
      expect(analytics.byDecision).toHaveLength(0);
      expect(analytics.avgTimeToConversion).toBeNull();
    });
  });
});
