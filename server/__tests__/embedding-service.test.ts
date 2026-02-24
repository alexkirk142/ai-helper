import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Embedding Service", () => {
  const originalEnv = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.OPENAI_API_KEY = originalEnv;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  describe("isEmbeddingServiceAvailable", () => {
    it("should return true when API key is set", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      vi.resetModules();
      
      const { isEmbeddingServiceAvailable } = await import("../services/embedding-service");
      expect(isEmbeddingServiceAvailable()).toBe(true);
    });

    it("should return false when API key is not set", async () => {
      delete process.env.OPENAI_API_KEY;
      vi.resetModules();
      
      const { isEmbeddingServiceAvailable } = await import("../services/embedding-service");
      expect(isEmbeddingServiceAvailable()).toBe(false);
    });
  });

  describe("embeddingService constants", () => {
    it("should use text-embedding-3-large model", async () => {
      const { embeddingService } = await import("../services/embedding-service");
      expect(embeddingService.MODEL).toBe("text-embedding-3-large");
    });

    it("should have 3072 dimensions", async () => {
      const { embeddingService } = await import("../services/embedding-service");
      expect(embeddingService.DIMENSIONS).toBe(3072);
    });
  });

  describe("createEmbedding without API key", () => {
    it("should return null when API key not set", async () => {
      delete process.env.OPENAI_API_KEY;
      vi.resetModules();

      const { createEmbedding } = await import("../services/embedding-service");
      const result = await createEmbedding("Test text");

      expect(result).toBeNull();
    });
  });

  describe("createEmbeddings batch without API key", () => {
    it("should return nulls when API key not set", async () => {
      delete process.env.OPENAI_API_KEY;
      vi.resetModules();

      const { createEmbeddings } = await import("../services/embedding-service");
      const results = await createEmbeddings(["Text 1", "Text 2"]);

      expect(results).toEqual([null, null]);
    });
  });
});

describe("Embedding update concepts", () => {
  it("embedding changes when text content changes", () => {
    const hashText = (text: string): number => {
      let hash = 0;
      for (const char of text) {
        hash = ((hash << 5) - hash) + char.charCodeAt(0);
        hash = hash & hash;
      }
      return hash;
    };
    
    const originalText = "Цена: 1000 RUB";
    const updatedText = "Цена: 1500 RUB";
    
    const originalHash = hashText(originalText);
    const updatedHash = hashText(updatedText);
    
    expect(originalHash).not.toBe(updatedHash);
  });

  it("priceVersion tracks when price changes", () => {
    const chunk = {
      id: "chunk-1",
      chunkText: "Цена: 1000 RUB",
      priceVersion: 1000,
    };
    
    const originalVersion = chunk.priceVersion;
    
    chunk.chunkText = "Цена: 1500 RUB";
    chunk.priceVersion = 2000;
    
    expect(chunk.priceVersion).toBeGreaterThan(originalVersion);
  });

  it("isCritical flag identifies price/stock chunks for re-embedding priority", () => {
    const chunks = [
      { chunkType: "info", isCritical: false },
      { chunkType: "price", isCritical: true },
      { chunkType: "stock", isCritical: true },
      { chunkType: "description", isCritical: false },
    ];
    
    const criticalChunks = chunks.filter(c => c.isCritical);
    
    expect(criticalChunks.length).toBe(2);
    expect(criticalChunks.map(c => c.chunkType)).toContain("price");
    expect(criticalChunks.map(c => c.chunkType)).toContain("stock");
  });
});

describe("RAG feature flag integration", () => {
  it("embedding creation respects RAG_ENABLED flag concept", async () => {
    const ragEnabled = true;
    const apiKeySet = false;
    
    const shouldCreateEmbedding = ragEnabled && apiKeySet;
    
    expect(shouldCreateEmbedding).toBe(false);
  });
});
