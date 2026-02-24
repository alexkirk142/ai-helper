import { describe, it, expect } from "vitest";
import {
  indexProduct,
  indexDocument,
  validateRagDocType,
  ragIndexer,
  computeContentHash,
  type RagChunkResult,
} from "../services/rag-indexer";
import type { Product, KnowledgeDoc } from "@shared/schema";

const mockProduct: Product = {
  id: "prod-1",
  tenantId: "tenant-1",
  sku: "SKU-001",
  name: "Тестовый товар",
  description: "Описание тестового товара с подробной информацией о характеристиках и преимуществах.",
  price: 1500,
  currency: "RUB",
  category: "Электроника",
  inStock: true,
  stockQuantity: 10,
  variants: [],
  images: [],
  deliveryInfo: "Доставка 2-3 дня",
  createdAt: new Date(),
};

const mockDocument: KnowledgeDoc = {
  id: "doc-1",
  tenantId: "tenant-1",
  title: "Политика возврата",
  content: "Вы можете вернуть товар в течение 14 дней с момента покупки. Товар должен быть в оригинальной упаковке и не иметь следов использования. Возврат денежных средств производится в течение 5 рабочих дней после получения товара на складе.",
  category: "policy",
  docType: "returns",
  tags: ["возврат", "гарантия"],
  isActive: true,
  createdAt: new Date(),
};

describe("RAG Indexer", () => {
  describe("indexProduct", () => {
    it("should create RAG document from product", () => {
      const result = indexProduct(mockProduct);
      
      expect(result.ragDocument.tenantId).toBe("tenant-1");
      expect(result.ragDocument.type).toBe("PRODUCT");
      expect(result.ragDocument.sourceId).toBe("prod-1");
      expect(result.ragDocument.content).toContain("Тестовый товар");
    });

    it("should include product metadata", () => {
      const result = indexProduct(mockProduct);
      
      expect(result.ragDocument.metadata).toHaveProperty("sku", "SKU-001");
      expect(result.ragDocument.metadata).toHaveProperty("category", "Электроника");
      expect(result.ragDocument.metadata).toHaveProperty("price", 1500);
    });

    it("should create at least one chunk", () => {
      const result = indexProduct(mockProduct);
      
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("should set correct chunk indices", () => {
      const result = indexProduct(mockProduct);
      
      result.chunks.forEach((chunk, index) => {
        expect(chunk.chunkIndex).toBe(index);
      });
    });

    it("should include source info in chunk metadata", () => {
      const result = indexProduct(mockProduct);
      
      expect(result.chunks[0].metadata).toHaveProperty("sourceType", "PRODUCT");
      expect(result.chunks[0].metadata).toHaveProperty("sourceId", "prod-1");
    });

    it("should include productId, sku, category, priceVersion in metadata", () => {
      const result = indexProduct(mockProduct);
      
      expect(result.chunks[0].metadata).toHaveProperty("productId", "prod-1");
      expect(result.chunks[0].metadata).toHaveProperty("sku", "SKU-001");
      expect(result.chunks[0].metadata).toHaveProperty("category", "Электроника");
      expect(result.chunks[0].metadata).toHaveProperty("priceVersion");
    });
  });

  describe("product logical blocks", () => {
    it("should create separate price chunk with isCritical=true", () => {
      const result = indexProduct(mockProduct);
      
      const priceChunk = result.chunks.find(c => c.chunkType === "price");
      expect(priceChunk).toBeDefined();
      expect(priceChunk?.isCritical).toBe(true);
      expect(priceChunk?.chunkText).toContain("1500");
    });

    it("should create separate stock chunk with isCritical=true", () => {
      const result = indexProduct(mockProduct);
      
      const stockChunk = result.chunks.find(c => c.chunkType === "stock");
      expect(stockChunk).toBeDefined();
      expect(stockChunk?.isCritical).toBe(true);
      expect(stockChunk?.chunkText).toContain("наличии");
    });

    it("should create info chunk with name, sku, category", () => {
      const result = indexProduct(mockProduct);
      
      const infoChunk = result.chunks.find(c => c.chunkType === "info");
      expect(infoChunk).toBeDefined();
      expect(infoChunk?.isCritical).toBe(false);
      expect(infoChunk?.chunkText).toContain("Тестовый товар");
      expect(infoChunk?.chunkText).toContain("SKU-001");
    });

    it("should create description chunk", () => {
      const result = indexProduct(mockProduct);
      
      const descChunk = result.chunks.find(c => c.chunkType === "description");
      expect(descChunk).toBeDefined();
      expect(descChunk?.isCritical).toBe(false);
      expect(descChunk?.chunkText).toContain("Описание");
    });

    it("should create specs chunk when variants present", () => {
      const productWithSpecs: Product = {
        ...mockProduct,
        variants: [
          { name: "Цвет", value: "Черный" },
          { name: "Размер", value: "XL" },
        ],
      };
      
      const result = indexProduct(productWithSpecs);
      
      const specsChunk = result.chunks.find(c => c.chunkType === "specs");
      expect(specsChunk).toBeDefined();
      expect(specsChunk?.chunkText).toContain("Характеристики");
    });

    it("should not create specs chunk when no variants", () => {
      const result = indexProduct(mockProduct);
      
      const specsChunk = result.chunks.find(c => c.chunkType === "specs");
      expect(specsChunk).toBeUndefined();
    });

    it("should include stock quantity and delivery info in stock chunk", () => {
      const result = indexProduct(mockProduct);
      
      const stockChunk = result.chunks.find(c => c.chunkType === "stock");
      expect(stockChunk?.chunkText).toContain("10 шт.");
      expect(stockChunk?.chunkText).toContain("Доставка 2-3 дня");
    });
  });

  describe("indexDocument", () => {
    it("should create RAG document from knowledge doc", () => {
      const result = indexDocument(mockDocument);
      
      expect(result.ragDocument.tenantId).toBe("tenant-1");
      expect(result.ragDocument.type).toBe("DOC");
      expect(result.ragDocument.sourceId).toBe("doc-1");
      expect(result.ragDocument.content).toContain("Политика возврата");
    });

    it("should include document metadata", () => {
      const result = indexDocument(mockDocument);
      
      expect(result.ragDocument.metadata).toHaveProperty("title", "Политика возврата");
      expect(result.ragDocument.metadata).toHaveProperty("docType", "returns");
      expect(result.ragDocument.metadata).toHaveProperty("category", "policy");
    });

    it("should create at least one chunk", () => {
      const result = indexDocument(mockDocument);
      
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("should not produce empty chunks", () => {
      const result = indexDocument(mockDocument);
      
      result.chunks.forEach(chunk => {
        expect(chunk.chunkText.trim().length).toBeGreaterThan(0);
        expect(chunk.tokenCount).toBeGreaterThan(0);
      });
    });
  });

  describe("chunk ordering", () => {
    it("should maintain correct chunk order for large documents", () => {
      const largeDoc: KnowledgeDoc = {
        ...mockDocument,
        content: Array.from({ length: 20 }, (_, i) => 
          `Параграф ${i + 1}: Это тестовый текст для проверки порядка чанков. `.repeat(10)
        ).join("\n\n"),
      };
      
      const result = indexDocument(largeDoc);
      
      for (let i = 0; i < result.chunks.length; i++) {
        expect(result.chunks[i].chunkIndex).toBe(i);
      }
    });

    it("should preserve content order in chunks", () => {
      const orderedDoc: KnowledgeDoc = {
        ...mockDocument,
        content: "НАЧАЛО документа.\n\n" + 
          "Середина текста. ".repeat(100) + 
          "\n\nКОНЕЦ документа.",
      };
      
      const result = indexDocument(orderedDoc);
      
      expect(result.chunks[0].chunkText).toContain("НАЧАЛО");
      expect(result.chunks[result.chunks.length - 1].chunkText).toContain("КОНЕЦ");
    });
  });

  describe("no empty chunks", () => {
    it("should filter out whitespace-only content", () => {
      const docWithWhitespace: KnowledgeDoc = {
        ...mockDocument,
        content: "Текст.\n\n   \n\n  \n\nЕще текст.",
      };
      
      const result = indexDocument(docWithWhitespace);
      
      result.chunks.forEach(chunk => {
        expect(chunk.chunkText.trim().length).toBeGreaterThan(0);
      });
    });

    it("should handle empty content gracefully", () => {
      const emptyDoc: KnowledgeDoc = {
        ...mockDocument,
        title: "",
        content: "",
      };
      
      const result = indexDocument(emptyDoc);
      
      expect(result.chunks.length).toBe(0);
    });
  });

  describe("validateRagDocType", () => {
    it("should validate PRODUCT type", () => {
      expect(validateRagDocType("PRODUCT")).toBe("PRODUCT");
    });

    it("should validate DOC type", () => {
      expect(validateRagDocType("DOC")).toBe("DOC");
    });

    it("should return null for invalid type", () => {
      expect(validateRagDocType("INVALID")).toBeNull();
    });

    it("should return null for null/undefined", () => {
      expect(validateRagDocType(null)).toBeNull();
      expect(validateRagDocType(undefined)).toBeNull();
    });
  });

  describe("chunking configuration", () => {
    it("should use default config", () => {
      expect(ragIndexer.DEFAULT_CONFIG.minTokens).toBe(100);
      expect(ragIndexer.DEFAULT_CONFIG.maxTokens).toBe(400);
      expect(ragIndexer.DEFAULT_CONFIG.overlapTokens).toBe(50);
    });

    it("should accept custom config", () => {
      const customConfig = {
        minTokens: 50,
        maxTokens: 200,
        overlapTokens: 25,
      };
      
      const result = indexProduct(mockProduct, customConfig);
      
      expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("contentHash", () => {
    it("should compute consistent hash for same content", () => {
      const hash1 = computeContentHash("Test content");
      const hash2 = computeContentHash("Test content");
      expect(hash1).toBe(hash2);
    });

    it("should compute different hash for different content", () => {
      const hash1 = computeContentHash("Test content 1");
      const hash2 = computeContentHash("Test content 2");
      expect(hash1).not.toBe(hash2);
    });

    it("should trim whitespace before hashing", () => {
      const hash1 = computeContentHash("  Test content  ");
      const hash2 = computeContentHash("Test content");
      expect(hash1).toBe(hash2);
    });

    it("should return 16 character hex string", () => {
      const hash = computeContentHash("Test content");
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it("should include contentHash in product chunk metadata", () => {
      const result = indexProduct(mockProduct);
      
      result.chunks.forEach((chunk) => {
        expect(chunk.metadata).toHaveProperty("contentHash");
        expect(typeof chunk.metadata.contentHash).toBe("string");
        expect((chunk.metadata.contentHash as string).length).toBe(16);
      });
    });

    it("should include contentHash in document chunk metadata", () => {
      const result = indexDocument(mockDocument);
      
      result.chunks.forEach((chunk) => {
        expect(chunk.metadata).toHaveProperty("contentHash");
        expect(typeof chunk.metadata.contentHash).toBe("string");
      });
    });

    it("should compute hash matching actual chunk text", () => {
      const result = indexProduct(mockProduct);
      
      result.chunks.forEach((chunk) => {
        const expectedHash = computeContentHash(chunk.chunkText);
        expect(chunk.metadata.contentHash).toBe(expectedHash);
      });
    });
  });
});
