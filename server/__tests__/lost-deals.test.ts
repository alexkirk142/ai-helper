import { describe, it, expect, vi, beforeEach } from "vitest";
import { LostDealsService } from "../services/lost-deals-service";
import type { IStorage } from "../storage";
import type { LostDeal, Conversation, AiSuggestion, Message } from "@shared/schema";

const mockStorage: Partial<IStorage> = {
  getLostDealByConversation: vi.fn(),
  getLostDealsByTenant: vi.fn(),
  createLostDeal: vi.fn(),
  getMessagesByConversation: vi.fn(),
  getProductsByTenant: vi.fn(),
  getConversationsByTenant: vi.fn(),
  getSuggestionsByTenant: vi.fn(),
};

describe("Lost Deals Service", () => {
  let service: LostDealsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LostDealsService(mockStorage as IStorage);
  });

  describe("detectLostDeal", () => {
    it("should return null if lost deal already exists", async () => {
      const existingDeal: LostDeal = {
        id: "ld1",
        tenantId: "t1",
        conversationId: "c1",
        reason: "OTHER",
        detectedAutomatically: true,
        notes: null,
        createdAt: new Date(),
      };
      (mockStorage.getLostDealByConversation as any).mockResolvedValue(existingDeal);

      const conversation: Conversation = { id: "c1", tenantId: "t1" } as Conversation;
      const result = await service.detectLostDeal("c1", null, conversation);

      expect(result).toBeNull();
    });

    it("should detect ESCALATED_NO_RESPONSE when escalated without reply", async () => {
      (mockStorage.getLostDealByConversation as any).mockResolvedValue(undefined);
      
      const oldTime = new Date(Date.now() - 60 * 60 * 1000);
      const suggestion: AiSuggestion = {
        id: "s1",
        conversationId: "c1",
        decision: "ESCALATE",
        createdAt: oldTime,
      } as AiSuggestion;
      
      const messages: Message[] = [
        { id: "m1", conversationId: "c1", role: "customer", createdAt: new Date() } as Message,
      ];
      (mockStorage.getMessagesByConversation as any).mockResolvedValue(messages);

      const conversation: Conversation = { id: "c1", tenantId: "t1" } as Conversation;
      const result = await service.detectLostDeal("c1", suggestion, conversation);

      expect(result).toBe("ESCALATED_NO_RESPONSE");
    });

    it("should NOT detect ESCALATED_NO_RESPONSE when owner replied", async () => {
      (mockStorage.getLostDealByConversation as any).mockResolvedValue(undefined);
      
      const oldTime = new Date(Date.now() - 60 * 60 * 1000);
      const suggestion: AiSuggestion = {
        id: "s1",
        conversationId: "c1",
        decision: "ESCALATE",
        createdAt: oldTime,
      } as AiSuggestion;
      
      const messages: Message[] = [
        { id: "m1", conversationId: "c1", role: "owner", createdAt: new Date() } as Message,
      ];
      (mockStorage.getMessagesByConversation as any).mockResolvedValue(messages);

      const conversation: Conversation = { id: "c1", tenantId: "t1" } as Conversation;
      const result = await service.detectLostDeal("c1", suggestion, conversation);

      expect(result).toBeNull();
    });

    it("should detect AI_ERROR when STALE_DATA penalty present", async () => {
      (mockStorage.getLostDealByConversation as any).mockResolvedValue(undefined);
      
      const suggestion: AiSuggestion = {
        id: "s1",
        conversationId: "c1",
        decision: "NEED_APPROVAL",
        penalties: [{ code: "STALE_DATA", message: "Data is stale" }],
        createdAt: new Date(),
      } as AiSuggestion;

      const conversation: Conversation = { id: "c1", tenantId: "t1" } as Conversation;
      const result = await service.detectLostDeal("c1", suggestion, conversation);

      expect(result).toBe("AI_ERROR");
    });

    it("should detect NO_STOCK for availability intent with MISSING_STOCK penalty", async () => {
      (mockStorage.getLostDealByConversation as any).mockResolvedValue(undefined);
      
      const suggestion: AiSuggestion = {
        id: "s1",
        conversationId: "c1",
        intent: "availability",
        penalties: [{ code: "MISSING_STOCK", message: "Product out of stock" }],
        decision: "NEED_APPROVAL",
        createdAt: new Date(),
      } as AiSuggestion;

      const conversation: Conversation = { id: "c1", tenantId: "t1" } as Conversation;
      const result = await service.detectLostDeal("c1", suggestion, conversation);

      expect(result).toBe("NO_STOCK");
    });
  });

  describe("createLostDeal", () => {
    it("should create a lost deal", async () => {
      const createdDeal: LostDeal = {
        id: "ld1",
        tenantId: "t1",
        conversationId: "c1",
        reason: "PRICE_TOO_HIGH",
        detectedAutomatically: false,
        notes: "Customer said too expensive",
        createdAt: new Date(),
      };
      (mockStorage.createLostDeal as any).mockResolvedValue(createdDeal);

      const result = await service.createLostDeal(
        "t1",
        "c1",
        "PRICE_TOO_HIGH",
        false,
        "Customer said too expensive"
      );

      expect(result).toEqual(createdDeal);
      expect(mockStorage.createLostDeal).toHaveBeenCalledWith({
        tenantId: "t1",
        conversationId: "c1",
        reason: "PRICE_TOO_HIGH",
        detectedAutomatically: false,
        notes: "Customer said too expensive",
      });
    });
  });

  describe("recordManualLostDeal", () => {
    it("should throw error if lost deal already exists", async () => {
      const existingDeal: LostDeal = {
        id: "ld1",
        tenantId: "t1",
        conversationId: "c1",
        reason: "OTHER",
        detectedAutomatically: true,
        notes: null,
        createdAt: new Date(),
      };
      (mockStorage.getLostDealByConversation as any).mockResolvedValue(existingDeal);

      await expect(
        service.recordManualLostDeal("t1", "c1", "PRICE_TOO_HIGH")
      ).rejects.toThrow("Lost deal already recorded for this conversation");
    });

    it("should create manual lost deal when none exists", async () => {
      (mockStorage.getLostDealByConversation as any).mockResolvedValue(undefined);
      const createdDeal: LostDeal = {
        id: "ld1",
        tenantId: "t1",
        conversationId: "c1",
        reason: "OTHER",
        detectedAutomatically: false,
        notes: "Manual note",
        createdAt: new Date(),
      };
      (mockStorage.createLostDeal as any).mockResolvedValue(createdDeal);

      const result = await service.recordManualLostDeal("t1", "c1", "OTHER", "Manual note");

      expect(result).toEqual(createdDeal);
    });
  });

  describe("getLostDealsAnalytics", () => {
    it("should return empty analytics when no lost deals", async () => {
      (mockStorage.getLostDealsByTenant as any).mockResolvedValue([]);
      (mockStorage.getConversationsByTenant as any).mockResolvedValue([]);
      (mockStorage.getSuggestionsByTenant as any).mockResolvedValue([]);

      const result = await service.getLostDealsAnalytics("t1");

      expect(result.totalLostDeals).toBe(0);
      expect(result.byReason).toEqual([]);
      expect(result.byIntent).toEqual([]);
      expect(result.timeline).toEqual([]);
    });

    it("should aggregate lost deals by reason", async () => {
      const lostDeals: LostDeal[] = [
        { id: "ld1", tenantId: "t1", conversationId: "c1", reason: "NO_STOCK", detectedAutomatically: true, notes: null, createdAt: new Date() },
        { id: "ld2", tenantId: "t1", conversationId: "c2", reason: "NO_STOCK", detectedAutomatically: true, notes: null, createdAt: new Date() },
        { id: "ld3", tenantId: "t1", conversationId: "c3", reason: "AI_ERROR", detectedAutomatically: true, notes: null, createdAt: new Date() },
      ];
      (mockStorage.getLostDealsByTenant as any).mockResolvedValue(lostDeals);
      (mockStorage.getConversationsByTenant as any).mockResolvedValue([]);
      (mockStorage.getSuggestionsByTenant as any).mockResolvedValue([]);

      const result = await service.getLostDealsAnalytics("t1");

      expect(result.totalLostDeals).toBe(3);
      expect(result.byReason).toContainEqual({ reason: "NO_STOCK", count: 2, percentage: 67 });
      expect(result.byReason).toContainEqual({ reason: "AI_ERROR", count: 1, percentage: 33 });
    });

    it("should aggregate lost deals by intent", async () => {
      const lostDeals: LostDeal[] = [
        { id: "ld1", tenantId: "t1", conversationId: "c1", reason: "NO_STOCK", detectedAutomatically: true, notes: null, createdAt: new Date() },
        { id: "ld2", tenantId: "t1", conversationId: "c2", reason: "AI_ERROR", detectedAutomatically: true, notes: null, createdAt: new Date() },
      ];
      const suggestions: AiSuggestion[] = [
        { id: "s1", conversationId: "c1", intent: "availability" } as AiSuggestion,
        { id: "s2", conversationId: "c2", intent: "price" } as AiSuggestion,
      ];
      (mockStorage.getLostDealsByTenant as any).mockResolvedValue(lostDeals);
      (mockStorage.getConversationsByTenant as any).mockResolvedValue([]);
      (mockStorage.getSuggestionsByTenant as any).mockResolvedValue(suggestions);

      const result = await service.getLostDealsAnalytics("t1");

      expect(result.byIntent).toContainEqual({ intent: "availability", count: 1, percentage: 50 });
      expect(result.byIntent).toContainEqual({ intent: "price", count: 1, percentage: 50 });
    });

    it("should generate timeline data", async () => {
      const date1 = new Date("2025-01-20");
      const date2 = new Date("2025-01-21");
      const lostDeals: LostDeal[] = [
        { id: "ld1", tenantId: "t1", conversationId: "c1", reason: "NO_STOCK", detectedAutomatically: true, notes: null, createdAt: date1 },
        { id: "ld2", tenantId: "t1", conversationId: "c2", reason: "AI_ERROR", detectedAutomatically: true, notes: null, createdAt: date1 },
        { id: "ld3", tenantId: "t1", conversationId: "c3", reason: "OTHER", detectedAutomatically: true, notes: null, createdAt: date2 },
      ];
      (mockStorage.getLostDealsByTenant as any).mockResolvedValue(lostDeals);
      (mockStorage.getConversationsByTenant as any).mockResolvedValue([]);
      (mockStorage.getSuggestionsByTenant as any).mockResolvedValue([]);

      const result = await service.getLostDealsAnalytics("t1");

      expect(result.timeline).toHaveLength(2);
      expect(result.timeline).toContainEqual({ date: "2025-01-20", count: 2 });
      expect(result.timeline).toContainEqual({ date: "2025-01-21", count: 1 });
    });
  });
});
