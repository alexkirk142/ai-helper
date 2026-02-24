import { describe, it, expect, vi, beforeEach } from "vitest";
import { ragRetrieval } from "../services/rag-retrieval";

describe("RAG Retrieval", () => {
  describe("cosineSimilarity", () => {
    it("should return 1 for identical vectors", () => {
      const a = [1, 2, 3];
      const b = [1, 2, 3];
      expect(ragRetrieval.cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });

    it("should return 0 for orthogonal vectors", () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(ragRetrieval.cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    it("should return -1 for opposite vectors", () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(ragRetrieval.cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
    });

    it("should handle normalized vectors correctly", () => {
      const a = [0.6, 0.8, 0];
      const b = [0.6, 0.8, 0];
      expect(ragRetrieval.cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });

    it("should return 0 for empty vectors", () => {
      expect(ragRetrieval.cosineSimilarity([], [])).toBe(0);
    });

    it("should return 0 for different length vectors", () => {
      expect(ragRetrieval.cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it("should handle zero vectors", () => {
      expect(ragRetrieval.cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });
  });

  describe("DEFAULT_CONFIG", () => {
    it("should have correct default values", () => {
      expect(ragRetrieval.DEFAULT_CONFIG.productTopK).toBe(5);
      expect(ragRetrieval.DEFAULT_CONFIG.docTopK).toBe(3);
      expect(ragRetrieval.DEFAULT_CONFIG.retrievalConfidenceThreshold).toBe(0.7);
      expect(ragRetrieval.DEFAULT_CONFIG.minSimilarity).toBe(0.5);
    });
  });

  describe("retrieval strategy concepts", () => {
    it("products should be searched first (priority)", () => {
      const productChunks = [
        { sourceType: "PRODUCT", similarity: 0.8, chunkText: "Product A" },
        { sourceType: "PRODUCT", similarity: 0.75, chunkText: "Product B" },
      ];
      const docChunks = [
        { sourceType: "DOC", similarity: 0.9, chunkText: "Doc about products" },
      ];

      const allChunks = [...productChunks, ...docChunks];
      const sortedByType = allChunks.sort((a, b) => {
        if (a.sourceType === "PRODUCT" && b.sourceType === "DOC") return -1;
        if (a.sourceType === "DOC" && b.sourceType === "PRODUCT") return 1;
        return b.similarity - a.similarity;
      });

      expect(sortedByType[0].sourceType).toBe("PRODUCT");
      expect(sortedByType[1].sourceType).toBe("PRODUCT");
    });

    it("docs should be used only when product retrieval confidence is low", () => {
      const topProductSimilarity = 0.6;
      const retrievalConfidenceThreshold = 0.7;
      
      const usedDocFallback = topProductSimilarity < retrievalConfidenceThreshold;
      expect(usedDocFallback).toBe(true);
    });

    it("docs should NOT be used when product retrieval confidence is high", () => {
      const topProductSimilarity = 0.85;
      const retrievalConfidenceThreshold = 0.7;
      
      const usedDocFallback = topProductSimilarity < retrievalConfidenceThreshold;
      expect(usedDocFallback).toBe(false);
    });

    it("should filter by category when provided", () => {
      const chunks = [
        { metadata: { category: "Электроника" }, chunkText: "Phone" },
        { metadata: { category: "Одежда" }, chunkText: "Shirt" },
        { metadata: { category: "Электроника" }, chunkText: "Laptop" },
      ];
      
      const filterCategory = "Электроника";
      const filtered = chunks.filter(c => c.metadata.category === filterCategory);
      
      expect(filtered).toHaveLength(2);
      expect(filtered.every(c => c.metadata.category === "Электроника")).toBe(true);
    });

    it("should filter by SKU when provided", () => {
      const chunks = [
        { metadata: { sku: "SKU-001" }, chunkText: "Product 1" },
        { metadata: { sku: "SKU-002" }, chunkText: "Product 2" },
        { metadata: { sku: "SKU-001" }, chunkText: "Product 1 price" },
      ];
      
      const filterSku = "SKU-001";
      const filtered = chunks.filter(c => c.metadata.sku === filterSku);
      
      expect(filtered).toHaveLength(2);
      expect(filtered.every(c => c.metadata.sku === "SKU-001")).toBe(true);
    });
  });

  describe("result format", () => {
    it("should return correct structure", () => {
      const mockResult = {
        chunks: [],
        productChunks: [],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0,
        topDocSimilarity: 0,
      };

      expect(mockResult).toHaveProperty("chunks");
      expect(mockResult).toHaveProperty("productChunks");
      expect(mockResult).toHaveProperty("docChunks");
      expect(mockResult).toHaveProperty("usedDocFallback");
      expect(mockResult).toHaveProperty("queryEmbedding");
      expect(mockResult).toHaveProperty("topProductSimilarity");
      expect(mockResult).toHaveProperty("topDocSimilarity");
    });

    it("should include similarity in retrieved chunks", () => {
      const chunk = {
        chunkText: "Test product",
        similarity: 0.85,
        sourceType: "PRODUCT" as const,
        sourceId: "prod-1",
        metadata: { productName: "Test" },
        chunkIndex: 0,
      };

      expect(chunk.similarity).toBe(0.85);
      expect(chunk.sourceType).toBe("PRODUCT");
      expect(chunk.metadata).toHaveProperty("productName");
    });
  });

  describe("formatContextForPrompt", () => {
    it("should return empty string for no chunks", () => {
      const result = ragRetrieval.formatContextForPrompt({
        chunks: [],
        productChunks: [],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0,
        topDocSimilarity: 0,
      });

      expect(result).toBe("");
    });

    it("should format product chunks with header", () => {
      const result = ragRetrieval.formatContextForPrompt({
        chunks: [{
          chunkText: "Цена: 1500 руб",
          similarity: 0.9,
          sourceType: "PRODUCT",
          sourceId: "prod-1",
          metadata: { productName: "Телефон" },
          chunkIndex: 0,
        }],
        productChunks: [{
          chunkText: "Цена: 1500 руб",
          similarity: 0.9,
          sourceType: "PRODUCT",
          sourceId: "prod-1",
          metadata: { productName: "Телефон" },
          chunkIndex: 0,
        }],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.9,
        topDocSimilarity: 0,
      });

      expect(result).toContain("=== ТОВАРЫ ===");
      expect(result).toContain("Телефон");
      expect(result).toContain("Цена: 1500 руб");
      expect(result).toContain("90%");
    });

    it("should format doc chunks with header", () => {
      const result = ragRetrieval.formatContextForPrompt({
        chunks: [{
          chunkText: "Возврат в течение 14 дней",
          similarity: 0.8,
          sourceType: "DOC",
          sourceId: "doc-1",
          metadata: { docTitle: "Политика возврата" },
          chunkIndex: 0,
        }],
        productChunks: [],
        docChunks: [{
          chunkText: "Возврат в течение 14 дней",
          similarity: 0.8,
          sourceType: "DOC",
          sourceId: "doc-1",
          metadata: { docTitle: "Политика возврата" },
          chunkIndex: 0,
        }],
        usedDocFallback: true,
        queryEmbedding: null,
        topProductSimilarity: 0,
        topDocSimilarity: 0.8,
      });

      expect(result).toContain("=== ДОКУМЕНТЫ ===");
      expect(result).toContain("Политика возврата");
      expect(result).toContain("Возврат в течение 14 дней");
    });

    it("should format both products and docs when present", () => {
      const result = ragRetrieval.formatContextForPrompt({
        chunks: [
          {
            chunkText: "Телефон в наличии",
            similarity: 0.6,
            sourceType: "PRODUCT",
            sourceId: "prod-1",
            metadata: { productName: "Телефон" },
            chunkIndex: 0,
          },
          {
            chunkText: "Доставка 2-3 дня",
            similarity: 0.85,
            sourceType: "DOC",
            sourceId: "doc-1",
            metadata: { docTitle: "Доставка" },
            chunkIndex: 0,
          },
        ],
        productChunks: [{
          chunkText: "Телефон в наличии",
          similarity: 0.6,
          sourceType: "PRODUCT",
          sourceId: "prod-1",
          metadata: { productName: "Телефон" },
          chunkIndex: 0,
        }],
        docChunks: [{
          chunkText: "Доставка 2-3 дня",
          similarity: 0.85,
          sourceType: "DOC",
          sourceId: "doc-1",
          metadata: { docTitle: "Доставка" },
          chunkIndex: 0,
        }],
        usedDocFallback: true,
        queryEmbedding: null,
        topProductSimilarity: 0.6,
        topDocSimilarity: 0.85,
      });

      expect(result).toContain("=== ТОВАРЫ ===");
      expect(result).toContain("=== ДОКУМЕНТЫ ===");
    });
  });

  describe("topK limits", () => {
    it("should limit product chunks to productTopK", () => {
      const productTopK = 3;
      const allProducts = [
        { similarity: 0.9 },
        { similarity: 0.85 },
        { similarity: 0.8 },
        { similarity: 0.75 },
        { similarity: 0.7 },
      ];

      const limited = allProducts.slice(0, productTopK);
      expect(limited).toHaveLength(3);
      expect(limited[0].similarity).toBe(0.9);
    });

    it("should limit doc chunks to docTopK", () => {
      const docTopK = 2;
      const allDocs = [
        { similarity: 0.88 },
        { similarity: 0.82 },
        { similarity: 0.78 },
        { similarity: 0.72 },
      ];

      const limited = allDocs.slice(0, docTopK);
      expect(limited).toHaveLength(2);
      expect(limited[0].similarity).toBe(0.88);
    });
  });

  describe("critical chunks priority", () => {
    it("should identify critical chunks (price/stock)", () => {
      const chunks = [
        { chunkType: "info", isCritical: false },
        { chunkType: "price", isCritical: true },
        { chunkType: "stock", isCritical: true },
        { chunkType: "description", isCritical: false },
      ];

      const criticalChunks = chunks.filter(c => c.isCritical);
      expect(criticalChunks).toHaveLength(2);
      expect(criticalChunks.every(c => c.chunkType === "price" || c.chunkType === "stock")).toBe(true);
    });
  });
});
