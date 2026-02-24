import { describe, it, expect, beforeEach, vi } from "vitest";
import { calculateReadinessScore, READINESS_THRESHOLD } from "../services/readiness-score-service";
import type { IStorage } from "../storage";

const createMockStorage = (overrides: Partial<IStorage> = {}): IStorage => {
  const defaultMock: Partial<IStorage> = {
    getProductsByTenant: vi.fn().mockResolvedValue([]),
    getKnowledgeDocsByTenant: vi.fn().mockResolvedValue([]),
    getRagChunksWithoutEmbedding: vi.fn().mockResolvedValue([]),
    getAiTrainingPolicy: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  return defaultMock as IStorage;
};

describe("Readiness Score Service", () => {
  describe("PRODUCTS_PRESENT check", () => {
    it("should PASS when >= 10 products", async () => {
      const products = Array(15).fill(null).map((_, i) => ({
        id: `p${i}`,
        name: `Product ${i}`,
        tenantId: "t1",
        price: 100,
        inStock: true,
      }));
      
      const storage = createMockStorage({
        getProductsByTenant: vi.fn().mockResolvedValue(products),
      });

      const result = await calculateReadinessScore("t1", storage, () => true);
      
      const check = result.checks.find(c => c.code === "PRODUCTS_PRESENT");
      expect(check?.status).toBe("PASS");
      expect(check?.weight).toBe(25);
    });

    it("should WARN when 1-9 products", async () => {
      const products = Array(5).fill(null).map((_, i) => ({
        id: `p${i}`,
        name: `Product ${i}`,
        tenantId: "t1",
        price: 100,
        inStock: true,
      }));
      
      const storage = createMockStorage({
        getProductsByTenant: vi.fn().mockResolvedValue(products),
      });

      const result = await calculateReadinessScore("t1", storage, () => true);
      
      const check = result.checks.find(c => c.code === "PRODUCTS_PRESENT");
      expect(check?.status).toBe("WARN");
    });

    it("should FAIL when 0 products", async () => {
      const storage = createMockStorage({
        getProductsByTenant: vi.fn().mockResolvedValue([]),
      });

      const result = await calculateReadinessScore("t1", storage, () => true);
      
      const check = result.checks.find(c => c.code === "PRODUCTS_PRESENT");
      expect(check?.status).toBe("FAIL");
    });
  });

  describe("PRODUCTS_HAVE_PRICE_STOCK check", () => {
    it("should PASS when >= 70% have price and stock", async () => {
      const products = [
        { id: "p1", name: "P1", tenantId: "t1", price: 100, inStock: true },
        { id: "p2", name: "P2", tenantId: "t1", price: 200, inStock: true },
        { id: "p3", name: "P3", tenantId: "t1", price: 300, inStock: true },
        { id: "p4", name: "P4", tenantId: "t1", price: null, inStock: false },
      ];
      
      const storage = createMockStorage({
        getProductsByTenant: vi.fn().mockResolvedValue(products),
      });

      const result = await calculateReadinessScore("t1", storage, () => true);
      
      const check = result.checks.find(c => c.code === "PRODUCTS_HAVE_PRICE_STOCK");
      expect(check?.status).toBe("PASS");
    });

    it("should WARN when 30-70% have price and stock", async () => {
      const products = [
        { id: "p1", name: "P1", tenantId: "t1", price: 100, inStock: true },
        { id: "p2", name: "P2", tenantId: "t1", price: null, inStock: false },
        { id: "p3", name: "P3", tenantId: "t1", price: null, inStock: false },
      ];
      
      const storage = createMockStorage({
        getProductsByTenant: vi.fn().mockResolvedValue(products),
      });

      const result = await calculateReadinessScore("t1", storage, () => true);
      
      const check = result.checks.find(c => c.code === "PRODUCTS_HAVE_PRICE_STOCK");
      expect(check?.status).toBe("WARN");
    });
  });

  describe("KB_PRESENT check", () => {
    it("should PASS when >= 3 doc types present", async () => {
      const docs = [
        { id: "d1", docType: "delivery", tenantId: "t1" },
        { id: "d2", docType: "returns", tenantId: "t1" },
        { id: "d3", docType: "faq", tenantId: "t1" },
      ];
      
      const storage = createMockStorage({
        getKnowledgeDocsByTenant: vi.fn().mockResolvedValue(docs),
      });

      const result = await calculateReadinessScore("t1", storage, () => true);
      
      const check = result.checks.find(c => c.code === "KB_PRESENT");
      expect(check?.status).toBe("PASS");
    });

    it("should WARN when 1-2 doc types present", async () => {
      const docs = [
        { id: "d1", docType: "delivery", tenantId: "t1" },
      ];
      
      const storage = createMockStorage({
        getKnowledgeDocsByTenant: vi.fn().mockResolvedValue(docs),
      });

      const result = await calculateReadinessScore("t1", storage, () => true);
      
      const check = result.checks.find(c => c.code === "KB_PRESENT");
      expect(check?.status).toBe("WARN");
      expect(result.recommendations.some(r => r.includes("Добавьте документы"))).toBe(true);
    });

    it("should FAIL when no docs present", async () => {
      const storage = createMockStorage({
        getKnowledgeDocsByTenant: vi.fn().mockResolvedValue([]),
      });

      const result = await calculateReadinessScore("t1", storage, () => true);
      
      const check = result.checks.find(c => c.code === "KB_PRESENT");
      expect(check?.status).toBe("FAIL");
    });
  });

  describe("TRAINING_POLICY_SET check", () => {
    it("should PASS when policy has settings", async () => {
      const storage = createMockStorage({
        getAiTrainingPolicy: vi.fn().mockResolvedValue({
          tenantId: "t1",
          alwaysEscalateIntents: ["complaint"],
          forbiddenTopics: [],
          disabledLearningIntents: [],
        }),
      });

      const result = await calculateReadinessScore("t1", storage, () => true);
      
      const check = result.checks.find(c => c.code === "TRAINING_POLICY_SET");
      expect(check?.status).toBe("PASS");
    });

    it("should WARN when policy not set", async () => {
      const storage = createMockStorage({
        getAiTrainingPolicy: vi.fn().mockResolvedValue(null),
      });

      const result = await calculateReadinessScore("t1", storage, () => true);
      
      const check = result.checks.find(c => c.code === "TRAINING_POLICY_SET");
      expect(check?.status).toBe("WARN");
    });
  });

  describe("FEW_SHOT_ENABLED check", () => {
    it("should PASS when few-shot enabled", async () => {
      const storage = createMockStorage();

      const result = await calculateReadinessScore("t1", storage, () => true);
      
      const check = result.checks.find(c => c.code === "FEW_SHOT_ENABLED");
      expect(check?.status).toBe("PASS");
    });

    it("should WARN when few-shot disabled", async () => {
      const storage = createMockStorage();

      const result = await calculateReadinessScore("t1", storage, () => false);
      
      const check = result.checks.find(c => c.code === "FEW_SHOT_ENABLED");
      expect(check?.status).toBe("WARN");
    });
  });

  describe("Score calculation", () => {
    it("should return max 100 score for perfect setup", async () => {
      const products = Array(20).fill(null).map((_, i) => ({
        id: `p${i}`,
        name: `Product ${i}`,
        tenantId: "t1",
        price: 100,
        inStock: true,
      }));
      
      const docs = [
        { id: "d1", docType: "delivery", tenantId: "t1" },
        { id: "d2", docType: "returns", tenantId: "t1" },
        { id: "d3", docType: "faq", tenantId: "t1" },
        { id: "d4", docType: "policy", tenantId: "t1" },
      ];

      const storage = createMockStorage({
        getProductsByTenant: vi.fn().mockResolvedValue(products),
        getKnowledgeDocsByTenant: vi.fn().mockResolvedValue(docs),
        getRagChunksWithoutEmbedding: vi.fn().mockResolvedValue([]),
        getAiTrainingPolicy: vi.fn().mockResolvedValue({
          tenantId: "t1",
          alwaysEscalateIntents: ["complaint"],
          forbiddenTopics: [],
          disabledLearningIntents: [],
        }),
      });

      const originalEnv = process.env.RAG_ENABLED;
      process.env.RAG_ENABLED = "true";

      const result = await calculateReadinessScore("t1", storage, () => true);
      
      process.env.RAG_ENABLED = originalEnv;

      expect(result.score).toBe(100);
      expect(result.checks.every(c => c.status === "PASS")).toBe(true);
    });

    it("should return low score for empty setup", async () => {
      const storage = createMockStorage();

      const result = await calculateReadinessScore("t1", storage, () => false);
      
      expect(result.score).toBeLessThan(50);
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe("READINESS_THRESHOLD", () => {
    it("should be 80", () => {
      expect(READINESS_THRESHOLD).toBe(80);
    });
  });
});
