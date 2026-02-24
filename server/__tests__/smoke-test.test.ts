import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SMOKE_TEST_QUESTIONS, SMOKE_TEST_WEIGHT } from "../services/smoke-test-service";

vi.mock("../storage", () => ({
  storage: {
    getTenant: vi.fn(),
    getProductsByTenant: vi.fn(),
    getKnowledgeDocsByTenant: vi.fn(),
  },
}));

vi.mock("../services/decision-engine", () => ({
  generateWithDecisionEngine: vi.fn(),
}));

describe("Smoke Test Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("SMOKE_TEST_QUESTIONS", () => {
    it("should have 5 test questions", () => {
      expect(SMOKE_TEST_QUESTIONS).toHaveLength(5);
    });

    it("should include price question", () => {
      const priceQ = SMOKE_TEST_QUESTIONS.find(q => q.id === "price");
      expect(priceQ).toBeDefined();
      expect(priceQ?.expectedIntent).toBe("price");
      expect(priceQ?.shouldEscalate).toBe(false);
    });

    it("should include availability question", () => {
      const availQ = SMOKE_TEST_QUESTIONS.find(q => q.id === "availability");
      expect(availQ).toBeDefined();
      expect(availQ?.expectedIntent).toBe("availability");
      expect(availQ?.shouldEscalate).toBe(false);
    });

    it("should include delivery question", () => {
      const deliveryQ = SMOKE_TEST_QUESTIONS.find(q => q.id === "delivery");
      expect(deliveryQ).toBeDefined();
      expect(deliveryQ?.expectedIntent).toBe("shipping");
      expect(deliveryQ?.shouldEscalate).toBe(false);
    });

    it("should include returns question", () => {
      const returnsQ = SMOKE_TEST_QUESTIONS.find(q => q.id === "returns");
      expect(returnsQ).toBeDefined();
      expect(returnsQ?.expectedIntent).toBe("return");
      expect(returnsQ?.shouldEscalate).toBe(false);
    });

    it("should include complaint question that should escalate", () => {
      const complaintQ = SMOKE_TEST_QUESTIONS.find(q => q.id === "complaint");
      expect(complaintQ).toBeDefined();
      expect(complaintQ?.expectedIntent).toBe("complaint");
      expect(complaintQ?.shouldEscalate).toBe(true);
    });

    it("should have Russian language questions", () => {
      for (const q of SMOKE_TEST_QUESTIONS) {
        expect(q.question.length).toBeGreaterThan(10);
        expect(/[а-яА-ЯёЁ]/.test(q.question)).toBe(true);
      }
    });
  });

  describe("SMOKE_TEST_WEIGHT", () => {
    it("should have weight of 10", () => {
      expect(SMOKE_TEST_WEIGHT).toBe(10);
    });
  });

  describe("runSmokeTest", () => {
    it("should throw error if tenant not found", async () => {
      const { storage } = await import("../storage");
      (storage.getTenant as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { runSmokeTest } = await import("../services/smoke-test-service");

      await expect(runSmokeTest("non-existent-tenant")).rejects.toThrow("Tenant not found");
    });

    it("should run all 5 questions through decision engine", async () => {
      const { storage } = await import("../storage");
      const { generateWithDecisionEngine } = await import("../services/decision-engine");

      const mockTenant = { id: "t1", name: "Test Tenant", businessName: "Test Business" };
      const mockProducts = [{ id: "p1", name: "Product 1", tenantId: "t1" }];
      const mockDocs = [{ id: "d1", title: "Doc 1", tenantId: "t1" }];

      (storage.getTenant as ReturnType<typeof vi.fn>).mockResolvedValue(mockTenant);
      (storage.getProductsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue(mockProducts);
      (storage.getKnowledgeDocsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue(mockDocs);

      const mockDecisionResult = {
        decision: "NEED_APPROVAL",
        intent: "price",
        confidence: { total: 0.8, similarity: 0.7, intent: 0.9, selfCheck: 0.8 },
        usedSources: [{ type: "product", id: "p1", title: "Product 1" }],
        penalties: [],
        explanations: ["Test explanation"],
        needsHandoff: false,
        suggestedText: "Test response",
      };

      (generateWithDecisionEngine as ReturnType<typeof vi.fn>).mockResolvedValue(mockDecisionResult);

      const { runSmokeTest } = await import("../services/smoke-test-service");
      const result = await runSmokeTest("t1");

      expect(generateWithDecisionEngine).toHaveBeenCalledTimes(5);
      expect(result.results).toHaveLength(5);
      expect(result.totalCount).toBe(5);
    });

    it("should mark test as passed when has sources and no major penalties", async () => {
      const { storage } = await import("../storage");
      const { generateWithDecisionEngine } = await import("../services/decision-engine");

      const mockTenant = { id: "t1", name: "Test", businessName: "Test" };
      (storage.getTenant as ReturnType<typeof vi.fn>).mockResolvedValue(mockTenant);
      (storage.getProductsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (storage.getKnowledgeDocsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const mockDecisionResult = {
        decision: "AUTO_SEND",
        intent: "price",
        confidence: { total: 0.9, similarity: 0.9, intent: 0.9, selfCheck: 0.9 },
        usedSources: [{ type: "product", id: "p1", title: "Product 1" }],
        penalties: [],
        explanations: [],
        needsHandoff: false,
        suggestedText: "Response",
      };

      (generateWithDecisionEngine as ReturnType<typeof vi.fn>).mockResolvedValue(mockDecisionResult);

      const { runSmokeTest } = await import("../services/smoke-test-service");
      const result = await runSmokeTest("t1");

      const nonComplaintResults = result.results.filter(r => !r.question.includes("недоволен"));
      for (const r of nonComplaintResults) {
        expect(r.passed).toBe(true);
      }
    });

    it("should mark test as failed when has STALE_DATA penalty", async () => {
      const { storage } = await import("../storage");
      const { generateWithDecisionEngine } = await import("../services/decision-engine");

      const mockTenant = { id: "t1", name: "Test", businessName: "Test" };
      (storage.getTenant as ReturnType<typeof vi.fn>).mockResolvedValue(mockTenant);
      (storage.getProductsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (storage.getKnowledgeDocsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const mockDecisionResult = {
        decision: "AUTO_SEND",
        intent: "price",
        confidence: { total: 0.7, similarity: 0.6, intent: 0.8, selfCheck: 0.7 },
        usedSources: [{ type: "product", id: "p1", title: "Product 1" }],
        penalties: [{ code: "STALE_DATA", message: "Data is stale", value: 10 }],
        explanations: [],
        needsHandoff: false,
        suggestedText: "Response",
      };

      (generateWithDecisionEngine as ReturnType<typeof vi.fn>).mockResolvedValue(mockDecisionResult);

      const { runSmokeTest } = await import("../services/smoke-test-service");
      const result = await runSmokeTest("t1");

      const nonComplaintResults = result.results.filter(r => !r.question.includes("недоволен"));
      for (const r of nonComplaintResults) {
        expect(r.passed).toBe(false);
        expect(r.hasStaleData).toBe(true);
      }
    });

    it("should mark complaint test as passed when escalates", async () => {
      const { storage } = await import("../storage");
      const { generateWithDecisionEngine } = await import("../services/decision-engine");

      const mockTenant = { id: "t1", name: "Test", businessName: "Test" };
      (storage.getTenant as ReturnType<typeof vi.fn>).mockResolvedValue(mockTenant);
      (storage.getProductsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (storage.getKnowledgeDocsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      (generateWithDecisionEngine as ReturnType<typeof vi.fn>).mockImplementation(async (ctx: { customerMessage: string }) => {
        const isComplaint = ctx.customerMessage.includes("недоволен");
        return {
          decision: isComplaint ? "ESCALATE" : "NEED_APPROVAL",
          intent: isComplaint ? "complaint" : "price",
          confidence: { total: 0.8, similarity: 0.7, intent: 0.9, selfCheck: 0.8 },
          usedSources: isComplaint ? [] : [{ type: "product", id: "p1", title: "Product 1" }],
          penalties: [],
          explanations: [],
          needsHandoff: isComplaint,
          suggestedText: "Response",
        };
      });

      const { runSmokeTest } = await import("../services/smoke-test-service");
      const result = await runSmokeTest("t1");

      const complaintResult = result.results.find(r => r.question.includes("недоволен"));
      expect(complaintResult?.passed).toBe(true);
      expect(complaintResult?.decision).toBe("ESCALATE");
    });

    it("should return PASS check when >=4 tests pass", async () => {
      const { storage } = await import("../storage");
      const { generateWithDecisionEngine } = await import("../services/decision-engine");

      const mockTenant = { id: "t1", name: "Test", businessName: "Test" };
      (storage.getTenant as ReturnType<typeof vi.fn>).mockResolvedValue(mockTenant);
      (storage.getProductsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (storage.getKnowledgeDocsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      let callCount = 0;
      (generateWithDecisionEngine as ReturnType<typeof vi.fn>).mockImplementation(async (ctx: { customerMessage: string }) => {
        callCount++;
        const isComplaint = ctx.customerMessage.includes("недоволен");
        if (isComplaint) {
          return {
            decision: "ESCALATE",
            intent: "complaint",
            confidence: { total: 0.8, similarity: 0.7, intent: 0.9, selfCheck: 0.8 },
            usedSources: [],
            penalties: [],
            explanations: [],
            needsHandoff: true,
            suggestedText: "Response",
          };
        }
        return {
          decision: "AUTO_SEND",
          intent: "price",
          confidence: { total: 0.9, similarity: 0.9, intent: 0.9, selfCheck: 0.9 },
          usedSources: [{ type: "product", id: "p1", title: "Product 1" }],
          penalties: [],
          explanations: [],
          needsHandoff: false,
          suggestedText: "Response",
        };
      });

      const { runSmokeTest } = await import("../services/smoke-test-service");
      const result = await runSmokeTest("t1");

      expect(result.passedCount).toBe(5);
      expect(result.check.status).toBe("PASS");
      expect(result.check.code).toBe("SMOKE_TEST_PASS");
    });

    it("should return WARN check when 2-3 tests pass", async () => {
      const { storage } = await import("../storage");
      const { generateWithDecisionEngine } = await import("../services/decision-engine");

      const mockTenant = { id: "t1", name: "Test", businessName: "Test" };
      (storage.getTenant as ReturnType<typeof vi.fn>).mockResolvedValue(mockTenant);
      (storage.getProductsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (storage.getKnowledgeDocsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      let callCount = 0;
      (generateWithDecisionEngine as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          return {
            decision: "AUTO_SEND",
            intent: "price",
            confidence: { total: 0.9, similarity: 0.9, intent: 0.9, selfCheck: 0.9 },
            usedSources: [{ type: "product", id: "p1", title: "Product 1" }],
            penalties: [],
            explanations: [],
            needsHandoff: false,
            suggestedText: "Response",
          };
        }
        return {
          decision: "NEED_APPROVAL",
          intent: "unknown",
          confidence: { total: 0.3, similarity: 0.2, intent: 0.4, selfCheck: 0.3 },
          usedSources: [],
          penalties: [],
          explanations: [],
          needsHandoff: false,
          suggestedText: "Response",
        };
      });

      const { runSmokeTest } = await import("../services/smoke-test-service");
      const result = await runSmokeTest("t1");

      expect(result.passedCount).toBe(2);
      expect(result.check.status).toBe("WARN");
    });

    it("should return FAIL check when <2 tests pass", async () => {
      const { storage } = await import("../storage");
      const { generateWithDecisionEngine } = await import("../services/decision-engine");

      const mockTenant = { id: "t1", name: "Test", businessName: "Test" };
      (storage.getTenant as ReturnType<typeof vi.fn>).mockResolvedValue(mockTenant);
      (storage.getProductsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (storage.getKnowledgeDocsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      (generateWithDecisionEngine as ReturnType<typeof vi.fn>).mockResolvedValue({
        decision: "NEED_APPROVAL",
        intent: "unknown",
        confidence: { total: 0.3, similarity: 0.2, intent: 0.4, selfCheck: 0.3 },
        usedSources: [],
        penalties: [],
        explanations: [],
        needsHandoff: false,
        suggestedText: "Response",
      });

      const { runSmokeTest } = await import("../services/smoke-test-service");
      const result = await runSmokeTest("t1");

      expect(result.passedCount).toBe(0);
      expect(result.check.status).toBe("FAIL");
    });

    it("should add recommendations for failed tests", async () => {
      const { storage } = await import("../storage");
      const { generateWithDecisionEngine } = await import("../services/decision-engine");

      const mockTenant = { id: "t1", name: "Test", businessName: "Test" };
      (storage.getTenant as ReturnType<typeof vi.fn>).mockResolvedValue(mockTenant);
      (storage.getProductsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (storage.getKnowledgeDocsByTenant as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      (generateWithDecisionEngine as ReturnType<typeof vi.fn>).mockResolvedValue({
        decision: "NEED_APPROVAL",
        intent: "unknown",
        confidence: { total: 0.3, similarity: 0.2, intent: 0.4, selfCheck: 0.3 },
        usedSources: [],
        penalties: [{ code: "STALE_DATA", message: "Stale", value: 10 }],
        explanations: [],
        needsHandoff: false,
        suggestedText: "Response",
      });

      const { runSmokeTest } = await import("../services/smoke-test-service");
      const result = await runSmokeTest("t1");

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.some(r => r.includes("RAG") || r.includes("устарев"))).toBe(true);
    });
  });
});
