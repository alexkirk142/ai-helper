import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RagDocType } from "@shared/schema";

interface MockRagDocument {
  id: string;
  tenantId: string;
  type: RagDocType;
  sourceId: string;
}

interface MockRagChunk {
  id: string;
  ragDocumentId: string;
  chunkText: string;
}

class MockRagStorage {
  private ragDocuments: Map<string, MockRagDocument> = new Map();
  private ragChunks: Map<string, MockRagChunk> = new Map();

  addRagDocument(doc: MockRagDocument): void {
    this.ragDocuments.set(doc.id, doc);
  }

  addRagChunk(chunk: MockRagChunk): void {
    this.ragChunks.set(chunk.id, chunk);
  }

  async deleteRagBySource(
    tenantId: string,
    sourceType: "PRODUCT" | "DOC",
    sourceId: string
  ): Promise<{ deletedDocs: number }> {
    const toDelete: string[] = [];
    
    for (const [id, doc] of this.ragDocuments) {
      if (doc.tenantId === tenantId && doc.type === sourceType && doc.sourceId === sourceId) {
        toDelete.push(id);
      }
    }
    
    for (const id of toDelete) {
      this.ragDocuments.delete(id);
      for (const [chunkId, chunk] of this.ragChunks) {
        if (chunk.ragDocumentId === id) {
          this.ragChunks.delete(chunkId);
        }
      }
    }
    
    return { deletedDocs: toDelete.length };
  }

  getRagDocumentCount(): number {
    return this.ragDocuments.size;
  }

  getRagChunkCount(): number {
    return this.ragChunks.size;
  }

  hasRagDocument(id: string): boolean {
    return this.ragDocuments.has(id);
  }

  hasRagChunk(id: string): boolean {
    return this.ragChunks.has(id);
  }
}

describe("RAG Cleanup", () => {
  let storage: MockRagStorage;

  beforeEach(() => {
    storage = new MockRagStorage();
  });

  describe("deleteRagBySource", () => {
    it("should delete rag_documents by tenantId, sourceType, sourceId", async () => {
      storage.addRagDocument({
        id: "rag-doc-1",
        tenantId: "tenant-1",
        type: "PRODUCT",
        sourceId: "prod-1",
      });
      storage.addRagChunk({
        id: "chunk-1",
        ragDocumentId: "rag-doc-1",
        chunkText: "Test chunk",
      });

      const result = await storage.deleteRagBySource("tenant-1", "PRODUCT", "prod-1");

      expect(result.deletedDocs).toBe(1);
      expect(storage.getRagDocumentCount()).toBe(0);
    });

    it("should cascade delete rag_chunks when rag_documents deleted", async () => {
      storage.addRagDocument({
        id: "rag-doc-1",
        tenantId: "tenant-1",
        type: "DOC",
        sourceId: "doc-1",
      });
      storage.addRagChunk({
        id: "chunk-1",
        ragDocumentId: "rag-doc-1",
        chunkText: "Chunk 1",
      });
      storage.addRagChunk({
        id: "chunk-2",
        ragDocumentId: "rag-doc-1",
        chunkText: "Chunk 2",
      });

      expect(storage.getRagChunkCount()).toBe(2);

      await storage.deleteRagBySource("tenant-1", "DOC", "doc-1");

      expect(storage.getRagChunkCount()).toBe(0);
    });

    it("should not delete documents from different tenantId", async () => {
      storage.addRagDocument({
        id: "rag-doc-1",
        tenantId: "tenant-1",
        type: "PRODUCT",
        sourceId: "prod-1",
      });
      storage.addRagDocument({
        id: "rag-doc-2",
        tenantId: "tenant-2",
        type: "PRODUCT",
        sourceId: "prod-1",
      });

      const result = await storage.deleteRagBySource("tenant-1", "PRODUCT", "prod-1");

      expect(result.deletedDocs).toBe(1);
      expect(storage.hasRagDocument("rag-doc-1")).toBe(false);
      expect(storage.hasRagDocument("rag-doc-2")).toBe(true);
    });

    it("should not delete documents with different sourceType", async () => {
      storage.addRagDocument({
        id: "rag-doc-1",
        tenantId: "tenant-1",
        type: "PRODUCT",
        sourceId: "id-1",
      });
      storage.addRagDocument({
        id: "rag-doc-2",
        tenantId: "tenant-1",
        type: "DOC",
        sourceId: "id-1",
      });

      const result = await storage.deleteRagBySource("tenant-1", "PRODUCT", "id-1");

      expect(result.deletedDocs).toBe(1);
      expect(storage.hasRagDocument("rag-doc-1")).toBe(false);
      expect(storage.hasRagDocument("rag-doc-2")).toBe(true);
    });

    it("should return deletedDocs: 0 if no matching documents", async () => {
      storage.addRagDocument({
        id: "rag-doc-1",
        tenantId: "tenant-1",
        type: "PRODUCT",
        sourceId: "prod-1",
      });

      const result = await storage.deleteRagBySource("tenant-1", "PRODUCT", "prod-999");

      expect(result.deletedDocs).toBe(0);
      expect(storage.getRagDocumentCount()).toBe(1);
    });

    it("should delete multiple rag_documents for same source (re-index scenario)", async () => {
      storage.addRagDocument({
        id: "rag-doc-1",
        tenantId: "tenant-1",
        type: "PRODUCT",
        sourceId: "prod-1",
      });
      storage.addRagDocument({
        id: "rag-doc-2",
        tenantId: "tenant-1",
        type: "PRODUCT",
        sourceId: "prod-1",
      });

      const result = await storage.deleteRagBySource("tenant-1", "PRODUCT", "prod-1");

      expect(result.deletedDocs).toBe(2);
      expect(storage.getRagDocumentCount()).toBe(0);
    });
  });

  describe("integration with product/doc deletion", () => {
    it("should clean up RAG when product is deleted", async () => {
      storage.addRagDocument({
        id: "rag-doc-1",
        tenantId: "tenant-1",
        type: "PRODUCT",
        sourceId: "prod-to-delete",
      });
      storage.addRagChunk({
        id: "chunk-1",
        ragDocumentId: "rag-doc-1",
        chunkText: "Product info",
      });

      const mockDeleteProduct = async (productId: string, tenantId: string) => {
        await storage.deleteRagBySource(tenantId, "PRODUCT", productId);
        return true;
      };

      await mockDeleteProduct("prod-to-delete", "tenant-1");

      expect(storage.getRagDocumentCount()).toBe(0);
      expect(storage.getRagChunkCount()).toBe(0);
    });

    it("should clean up RAG when knowledge doc is deleted", async () => {
      storage.addRagDocument({
        id: "rag-doc-1",
        tenantId: "tenant-1",
        type: "DOC",
        sourceId: "doc-to-delete",
      });
      storage.addRagChunk({
        id: "chunk-1",
        ragDocumentId: "rag-doc-1",
        chunkText: "Doc content",
      });

      const mockDeleteKnowledgeDoc = async (docId: string, tenantId: string) => {
        await storage.deleteRagBySource(tenantId, "DOC", docId);
        return true;
      };

      await mockDeleteKnowledgeDoc("doc-to-delete", "tenant-1");

      expect(storage.getRagDocumentCount()).toBe(0);
      expect(storage.getRagChunkCount()).toBe(0);
    });
  });
});
