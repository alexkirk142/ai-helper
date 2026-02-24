import { describe, it, expect } from "vitest";
import type { UsedSource } from "@shared/schema";
import { PENALTY_CODES, type DecisionSettings } from "@shared/schema";
import type { RetrievedChunk, RetrievalResult } from "../services/rag-retrieval";
import { _testing } from "../services/decision-engine";

const { applyPenalties, STALE_DATA_THRESHOLD_MS, LOW_SIMILARITY_THRESHOLD } = _testing;

function convertRetrievalToSources(retrieval: RetrievalResult): {
  sources: UsedSource[];
  conflicts: boolean;
  hasStaleData: boolean;
  maxSimilarity: number;
} {
  const sources: UsedSource[] = [];
  const prices: number[] = [];
  let hasStaleData = false;
  const now = Date.now();

  for (const chunk of retrieval.productChunks) {
    const metadata = chunk.metadata as Record<string, unknown>;
    sources.push({
      type: "product",
      id: chunk.sourceId,
      title: (metadata.productName as string) || (metadata.sku as string) || "Товар",
      quote: chunk.chunkText.slice(0, 200),
      similarity: chunk.similarity,
    });
    if (metadata.chunkType === "price" && typeof metadata.price === "number") {
      prices.push(metadata.price);
    }
    
    if (metadata.priceVersion && typeof metadata.priceVersion === "number") {
      const age = now - metadata.priceVersion;
      if (age > STALE_DATA_THRESHOLD_MS) {
        hasStaleData = true;
      }
    }
  }

  for (const chunk of retrieval.docChunks) {
    const metadata = chunk.metadata as Record<string, unknown>;
    sources.push({
      type: "doc",
      id: chunk.sourceId,
      title: (metadata.docTitle as string) || (metadata.category as string) || "Документ",
      quote: chunk.chunkText.slice(0, 200),
      similarity: chunk.similarity,
    });
  }

  const conflicts = prices.length > 1 && new Set(prices).size > 1;
  const maxSimilarity = sources.length > 0 
    ? Math.max(...sources.map(s => s.similarity || 0)) 
    : 0;

  return { sources, conflicts, hasStaleData, maxSimilarity };
}

const DEFAULT_SETTINGS: DecisionSettings = {
  tenantId: "test",
  tAuto: 0.85,
  tEscalate: 0.50,
  autosendAllowed: true,
  intentsAutosendAllowed: ["price", "availability", "shipping"],
  intentsForceHandoff: ["complaint"],
  selfCheckEnabled: true,
  updatedAt: new Date(),
};

describe("RAG Integration with Decision Engine", () => {
  describe("convertRetrievalToSources", () => {
    it("should convert product chunks to UsedSource format", () => {
      const retrieval: RetrievalResult = {
        chunks: [{
          chunkText: "Цена товара: 1500 руб",
          similarity: 0.92,
          sourceType: "PRODUCT",
          sourceId: "prod-123",
          metadata: {
            productName: "Телефон",
            sku: "SKU-001",
            chunkType: "price",
            price: 1500,
          },
          chunkIndex: 0,
        }],
        productChunks: [{
          chunkText: "Цена товара: 1500 руб",
          similarity: 0.92,
          sourceType: "PRODUCT",
          sourceId: "prod-123",
          metadata: {
            productName: "Телефон",
            sku: "SKU-001",
            chunkType: "price",
            price: 1500,
          },
          chunkIndex: 0,
        }],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.92,
        topDocSimilarity: 0,
      };

      const { sources, conflicts } = convertRetrievalToSources(retrieval);

      expect(sources).toHaveLength(1);
      expect(sources[0]).toEqual({
        type: "product",
        id: "prod-123",
        title: "Телефон",
        quote: "Цена товара: 1500 руб",
        similarity: 0.92,
      });
      expect(conflicts).toBe(false);
    });

    it("should convert doc chunks to UsedSource format", () => {
      const retrieval: RetrievalResult = {
        chunks: [{
          chunkText: "Возврат товара в течение 14 дней",
          similarity: 0.85,
          sourceType: "DOC",
          sourceId: "doc-456",
          metadata: {
            docTitle: "Политика возврата",
            category: "returns",
          },
          chunkIndex: 0,
        }],
        productChunks: [],
        docChunks: [{
          chunkText: "Возврат товара в течение 14 дней",
          similarity: 0.85,
          sourceType: "DOC",
          sourceId: "doc-456",
          metadata: {
            docTitle: "Политика возврата",
            category: "returns",
          },
          chunkIndex: 0,
        }],
        usedDocFallback: true,
        queryEmbedding: null,
        topProductSimilarity: 0,
        topDocSimilarity: 0.85,
      };

      const { sources } = convertRetrievalToSources(retrieval);

      expect(sources).toHaveLength(1);
      expect(sources[0]).toEqual({
        type: "doc",
        id: "doc-456",
        title: "Политика возврата",
        quote: "Возврат товара в течение 14 дней",
        similarity: 0.85,
      });
    });

    it("should detect price conflicts when multiple products have different prices", () => {
      const retrieval: RetrievalResult = {
        chunks: [],
        productChunks: [
          {
            chunkText: "Цена: 1500 руб",
            similarity: 0.9,
            sourceType: "PRODUCT",
            sourceId: "prod-1",
            metadata: { productName: "Товар 1", chunkType: "price", price: 1500 },
            chunkIndex: 0,
          },
          {
            chunkText: "Цена: 2000 руб",
            similarity: 0.88,
            sourceType: "PRODUCT",
            sourceId: "prod-2",
            metadata: { productName: "Товар 2", chunkType: "price", price: 2000 },
            chunkIndex: 0,
          },
        ],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.9,
        topDocSimilarity: 0,
      };

      const { conflicts } = convertRetrievalToSources(retrieval);
      expect(conflicts).toBe(true);
    });

    it("should NOT detect conflicts when prices are the same", () => {
      const retrieval: RetrievalResult = {
        chunks: [],
        productChunks: [
          {
            chunkText: "Цена: 1500 руб",
            similarity: 0.9,
            sourceType: "PRODUCT",
            sourceId: "prod-1",
            metadata: { productName: "Товар 1", chunkType: "price", price: 1500 },
            chunkIndex: 0,
          },
          {
            chunkText: "Цена: 1500 руб",
            similarity: 0.88,
            sourceType: "PRODUCT",
            sourceId: "prod-2",
            metadata: { productName: "Товар 2", chunkType: "price", price: 1500 },
            chunkIndex: 0,
          },
        ],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.9,
        topDocSimilarity: 0,
      };

      const { conflicts } = convertRetrievalToSources(retrieval);
      expect(conflicts).toBe(false);
    });

    it("should return empty sources for empty retrieval", () => {
      const retrieval: RetrievalResult = {
        chunks: [],
        productChunks: [],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0,
        topDocSimilarity: 0,
      };

      const { sources, conflicts } = convertRetrievalToSources(retrieval);

      expect(sources).toHaveLength(0);
      expect(conflicts).toBe(false);
    });
  });

  describe("usedSources consistency with retrieval", () => {
    it("usedSources should match retrieval productChunks + docChunks", () => {
      const productChunk: RetrievedChunk = {
        chunkText: "Товар А - цена 1000 руб",
        similarity: 0.95,
        sourceType: "PRODUCT",
        sourceId: "prod-a",
        metadata: { productName: "Товар А" },
        chunkIndex: 0,
      };
      const docChunk: RetrievedChunk = {
        chunkText: "Условия доставки...",
        similarity: 0.82,
        sourceType: "DOC",
        sourceId: "doc-b",
        metadata: { docTitle: "Доставка" },
        chunkIndex: 0,
      };

      const retrieval: RetrievalResult = {
        chunks: [productChunk, docChunk],
        productChunks: [productChunk],
        docChunks: [docChunk],
        usedDocFallback: true,
        queryEmbedding: null,
        topProductSimilarity: 0.95,
        topDocSimilarity: 0.82,
      };

      const { sources } = convertRetrievalToSources(retrieval);

      expect(sources.length).toBe(retrieval.productChunks.length + retrieval.docChunks.length);
      expect(sources.filter(s => s.type === "product").length).toBe(retrieval.productChunks.length);
      expect(sources.filter(s => s.type === "doc").length).toBe(retrieval.docChunks.length);
    });

    it("similarity in usedSources should match chunk similarity", () => {
      const productChunk: RetrievedChunk = {
        chunkText: "Описание товара",
        similarity: 0.87,
        sourceType: "PRODUCT",
        sourceId: "prod-x",
        metadata: { productName: "Товар X" },
        chunkIndex: 0,
      };

      const retrieval: RetrievalResult = {
        chunks: [productChunk],
        productChunks: [productChunk],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.87,
        topDocSimilarity: 0,
      };

      const { sources } = convertRetrievalToSources(retrieval);

      expect(sources[0].similarity).toBe(productChunk.similarity);
      expect(sources[0].similarity).toBe(0.87);
    });

    it("quote in usedSources should contain chunkText", () => {
      const chunkText = "Полное описание товара с характеристиками и ценой";
      const productChunk: RetrievedChunk = {
        chunkText,
        similarity: 0.9,
        sourceType: "PRODUCT",
        sourceId: "prod-y",
        metadata: { productName: "Товар Y" },
        chunkIndex: 0,
      };

      const retrieval: RetrievalResult = {
        chunks: [productChunk],
        productChunks: [productChunk],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.9,
        topDocSimilarity: 0,
      };

      const { sources } = convertRetrievalToSources(retrieval);

      expect(sources[0].quote).toBe(chunkText);
    });

    it("source type should match chunk sourceType", () => {
      const productChunk: RetrievedChunk = {
        chunkText: "Product info",
        similarity: 0.9,
        sourceType: "PRODUCT",
        sourceId: "prod-z",
        metadata: {},
        chunkIndex: 0,
      };
      const docChunk: RetrievedChunk = {
        chunkText: "Doc info",
        similarity: 0.8,
        sourceType: "DOC",
        sourceId: "doc-z",
        metadata: {},
        chunkIndex: 0,
      };

      const retrieval: RetrievalResult = {
        chunks: [productChunk, docChunk],
        productChunks: [productChunk],
        docChunks: [docChunk],
        usedDocFallback: true,
        queryEmbedding: null,
        topProductSimilarity: 0.9,
        topDocSimilarity: 0.8,
      };

      const { sources } = convertRetrievalToSources(retrieval);

      const productSource = sources.find(s => s.id === "prod-z");
      const docSource = sources.find(s => s.id === "doc-z");

      expect(productSource?.type).toBe("product");
      expect(docSource?.type).toBe("doc");
    });
  });

  describe("NO_SOURCES penalty", () => {
    it("should apply NO_SOURCES penalty when retrieval returns empty", () => {
      const retrieval: RetrievalResult = {
        chunks: [],
        productChunks: [],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0,
        topDocSimilarity: 0,
      };

      const { sources } = convertRetrievalToSources(retrieval);
      
      const shouldApplyNoSourcesPenalty = sources.length === 0;
      expect(shouldApplyNoSourcesPenalty).toBe(true);
    });

    it("should NOT apply NO_SOURCES penalty when retrieval has chunks", () => {
      const retrieval: RetrievalResult = {
        chunks: [{
          chunkText: "Some content",
          similarity: 0.9,
          sourceType: "PRODUCT",
          sourceId: "prod-1",
          metadata: {},
          chunkIndex: 0,
        }],
        productChunks: [{
          chunkText: "Some content",
          similarity: 0.9,
          sourceType: "PRODUCT",
          sourceId: "prod-1",
          metadata: {},
          chunkIndex: 0,
        }],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.9,
        topDocSimilarity: 0,
      };

      const { sources } = convertRetrievalToSources(retrieval);
      
      const shouldApplyNoSourcesPenalty = sources.length === 0;
      expect(shouldApplyNoSourcesPenalty).toBe(false);
    });
  });

  describe("products always first", () => {
    it("product sources should come before doc sources in usedSources", () => {
      const productChunk: RetrievedChunk = {
        chunkText: "Product",
        similarity: 0.7,
        sourceType: "PRODUCT",
        sourceId: "prod-1",
        metadata: {},
        chunkIndex: 0,
      };
      const docChunk: RetrievedChunk = {
        chunkText: "Doc",
        similarity: 0.95,
        sourceType: "DOC",
        sourceId: "doc-1",
        metadata: {},
        chunkIndex: 0,
      };

      const retrieval: RetrievalResult = {
        chunks: [productChunk, docChunk],
        productChunks: [productChunk],
        docChunks: [docChunk],
        usedDocFallback: true,
        queryEmbedding: null,
        topProductSimilarity: 0.7,
        topDocSimilarity: 0.95,
      };

      const { sources } = convertRetrievalToSources(retrieval);

      const productIndex = sources.findIndex(s => s.type === "product");
      const docIndex = sources.findIndex(s => s.type === "doc");

      expect(productIndex).toBeLessThan(docIndex);
    });
  });

  describe("CONFLICTING_SOURCES penalty flow", () => {
    it("conflicts=true should be usable by applyPenalties for CONFLICTING_SOURCES", () => {
      const retrieval: RetrievalResult = {
        chunks: [],
        productChunks: [
          {
            chunkText: "Цена: 1000 руб",
            similarity: 0.9,
            sourceType: "PRODUCT",
            sourceId: "prod-1",
            metadata: { productName: "A", chunkType: "price", price: 1000 },
            chunkIndex: 0,
          },
          {
            chunkText: "Цена: 2000 руб",
            similarity: 0.85,
            sourceType: "PRODUCT",
            sourceId: "prod-2",
            metadata: { productName: "B", chunkType: "price", price: 2000 },
            chunkIndex: 0,
          },
        ],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.9,
        topDocSimilarity: 0,
      };

      const { conflicts } = convertRetrievalToSources(retrieval);
      
      expect(conflicts).toBe(true);
    });

    it("conflicts should be false when all price chunks have same price", () => {
      const retrieval: RetrievalResult = {
        chunks: [],
        productChunks: [
          {
            chunkText: "Цена: 1500 руб",
            similarity: 0.9,
            sourceType: "PRODUCT",
            sourceId: "prod-1",
            metadata: { chunkType: "price", price: 1500 },
            chunkIndex: 0,
          },
          {
            chunkText: "Цена: 1500 руб (акция)",
            similarity: 0.88,
            sourceType: "PRODUCT",
            sourceId: "prod-2",
            metadata: { chunkType: "price", price: 1500 },
            chunkIndex: 0,
          },
        ],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.9,
        topDocSimilarity: 0,
      };

      const { conflicts } = convertRetrievalToSources(retrieval);
      
      expect(conflicts).toBe(false);
    });

    it("conflicts should be false when only one price chunk exists", () => {
      const retrieval: RetrievalResult = {
        chunks: [],
        productChunks: [
          {
            chunkText: "Цена: 1500 руб",
            similarity: 0.9,
            sourceType: "PRODUCT",
            sourceId: "prod-1",
            metadata: { chunkType: "price", price: 1500 },
            chunkIndex: 0,
          },
          {
            chunkText: "Описание товара",
            similarity: 0.85,
            sourceType: "PRODUCT",
            sourceId: "prod-1",
            metadata: { chunkType: "description" },
            chunkIndex: 1,
          },
        ],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.9,
        topDocSimilarity: 0,
      };

      const { conflicts } = convertRetrievalToSources(retrieval);
      
      expect(conflicts).toBe(false);
    });
  });

  describe("STALE_DATA penalty flow", () => {
    it("should detect stale data when priceVersion is older than threshold", () => {
      const staleTimestamp = Date.now() - STALE_DATA_THRESHOLD_MS - 1000;
      const retrieval: RetrievalResult = {
        chunks: [],
        productChunks: [
          {
            chunkText: "Цена: 1500 руб",
            similarity: 0.9,
            sourceType: "PRODUCT",
            sourceId: "prod-1",
            metadata: { chunkType: "price", price: 1500, priceVersion: staleTimestamp },
            chunkIndex: 0,
          },
        ],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.9,
        topDocSimilarity: 0,
      };

      const { hasStaleData } = convertRetrievalToSources(retrieval);
      
      expect(hasStaleData).toBe(true);
    });

    it("should NOT detect stale data when priceVersion is recent", () => {
      const recentTimestamp = Date.now() - 1000;
      const retrieval: RetrievalResult = {
        chunks: [],
        productChunks: [
          {
            chunkText: "Цена: 1500 руб",
            similarity: 0.9,
            sourceType: "PRODUCT",
            sourceId: "prod-1",
            metadata: { chunkType: "price", price: 1500, priceVersion: recentTimestamp },
            chunkIndex: 0,
          },
        ],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.9,
        topDocSimilarity: 0,
      };

      const { hasStaleData } = convertRetrievalToSources(retrieval);
      
      expect(hasStaleData).toBe(false);
    });

    it("stale data should trigger STALE_DATA penalty and forceEscalate", () => {
      const sources: UsedSource[] = [
        { type: "product", id: "1", title: "Test", quote: "test", similarity: 0.9 },
      ];

      const { penalties, forceEscalate } = applyPenalties({
        intent: "price",
        sources,
        conflicts: false,
        hasStaleData: true,
        lowSimilarity: false,
        missingFields: [],
        selfCheckScore: 0.8,
        settings: DEFAULT_SETTINGS,
      });

      expect(penalties.some(p => p.code === "STALE_DATA")).toBe(true);
      expect(forceEscalate).toBe(true);
    });
  });

  describe("LOW_SIMILARITY penalty flow", () => {
    it("should detect low similarity when maxSimilarity is below threshold", () => {
      const retrieval: RetrievalResult = {
        chunks: [],
        productChunks: [
          {
            chunkText: "Цена: 1500 руб",
            similarity: 0.3,
            sourceType: "PRODUCT",
            sourceId: "prod-1",
            metadata: {},
            chunkIndex: 0,
          },
        ],
        docChunks: [],
        usedDocFallback: false,
        queryEmbedding: null,
        topProductSimilarity: 0.3,
        topDocSimilarity: 0,
      };

      const { maxSimilarity } = convertRetrievalToSources(retrieval);
      
      expect(maxSimilarity).toBe(0.3);
      expect(maxSimilarity < LOW_SIMILARITY_THRESHOLD).toBe(true);
    });

    it("low similarity should trigger LOW_SIMILARITY penalty", () => {
      const sources: UsedSource[] = [
        { type: "product", id: "1", title: "Test", quote: "test", similarity: 0.3 },
      ];

      const { penalties } = applyPenalties({
        intent: "price",
        sources,
        conflicts: false,
        hasStaleData: false,
        lowSimilarity: true,
        missingFields: [],
        selfCheckScore: 0.8,
        settings: DEFAULT_SETTINGS,
      });

      expect(penalties.some(p => p.code === "LOW_SIMILARITY")).toBe(true);
    });

    it("low similarity should NOT trigger penalty when no sources", () => {
      const { penalties } = applyPenalties({
        intent: "price",
        sources: [],
        conflicts: false,
        hasStaleData: false,
        lowSimilarity: true,
        missingFields: [],
        selfCheckScore: 0.8,
        settings: DEFAULT_SETTINGS,
      });

      expect(penalties.some(p => p.code === "LOW_SIMILARITY")).toBe(false);
      expect(penalties.some(p => p.code === "NO_SOURCES")).toBe(true);
    });
  });

  describe("combined escalation scenarios", () => {
    it("stale data + conflicts should both contribute to escalation", () => {
      const sources: UsedSource[] = [
        { type: "product", id: "1", title: "A", quote: "test", similarity: 0.9 },
        { type: "product", id: "2", title: "B", quote: "test", similarity: 0.85 },
      ];

      const { penalties, forceEscalate } = applyPenalties({
        intent: "price",
        sources,
        conflicts: true,
        hasStaleData: true,
        lowSimilarity: false,
        missingFields: [],
        selfCheckScore: 0.8,
        settings: DEFAULT_SETTINGS,
      });

      expect(penalties.some(p => p.code === "STALE_DATA")).toBe(true);
      expect(penalties.some(p => p.code === "CONFLICTING_SOURCES")).toBe(true);
      expect(forceEscalate).toBe(true);
    });

    it("explanations should include penalty messages", () => {
      const { penalties } = applyPenalties({
        intent: "price",
        sources: [{ type: "product", id: "1", title: "Test", quote: "test", similarity: 0.9 }],
        conflicts: true,
        hasStaleData: true,
        lowSimilarity: false,
        missingFields: [],
        selfCheckScore: 0.8,
        settings: DEFAULT_SETTINGS,
      });

      const messages = penalties.map(p => p.message);
      expect(messages).toContain("Данные устарели");
      expect(messages).toContain("Противоречивые данные в источниках");
    });
  });
});
