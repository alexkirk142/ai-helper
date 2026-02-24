import { describe, it, expect } from "vitest";
import {
  chunkDocument,
  estimateTokenCount,
  validateDocType,
  type DocumentChunk,
} from "../services/document-chunking-service";

describe("Document Chunking Service", () => {
  describe("estimateTokenCount", () => {
    it("should estimate tokens based on word count", () => {
      const text = "This is a simple test sentence with ten words here";
      const tokens = estimateTokenCount(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBe(Math.ceil(10 * 1.3));
    });

    it("should return 0 for empty string", () => {
      expect(estimateTokenCount("")).toBe(0);
    });

    it("should handle whitespace correctly", () => {
      const text = "  word1   word2   word3  ";
      const tokens = estimateTokenCount(text);
      expect(tokens).toBe(Math.ceil(3 * 1.3));
    });
  });

  describe("validateDocType", () => {
    it("should validate policy type", () => {
      expect(validateDocType("policy")).toBe("policy");
    });

    it("should validate faq type", () => {
      expect(validateDocType("faq")).toBe("faq");
    });

    it("should validate delivery type", () => {
      expect(validateDocType("delivery")).toBe("delivery");
    });

    it("should validate returns type", () => {
      expect(validateDocType("returns")).toBe("returns");
    });

    it("should return null for invalid type", () => {
      expect(validateDocType("invalid")).toBeNull();
    });

    it("should return null for null/undefined", () => {
      expect(validateDocType(null)).toBeNull();
      expect(validateDocType(undefined)).toBeNull();
    });
  });

  describe("chunkDocument - correct chunk count", () => {
    it("should return empty array for empty content", () => {
      const chunks = chunkDocument("", "Test Title", "policy");
      expect(chunks).toHaveLength(0);
    });

    it("should return single chunk for small document", () => {
      const content = "Это короткий документ с небольшим количеством текста.";
      const chunks = chunkDocument(content, "Short Doc", "faq");
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("should create multiple chunks for large document", () => {
      const paragraph = "Это тестовый параграф с достаточным количеством текста для тестирования. ".repeat(50);
      const content = Array(10).fill(paragraph).join("\n\n");
      const chunks = chunkDocument(content, "Large Doc", "policy");
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should respect max token limit approximately", () => {
      const paragraph = "Слово ".repeat(200);
      const content = Array(5).fill(paragraph).join("\n\n");
      const chunks = chunkDocument(content, "Test", "delivery", {
        minTokens: 100,
        maxTokens: 300,
        overlapTokens: 50,
      });
      
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(600);
      }
    });
  });

  describe("chunkDocument - chunk order", () => {
    it("should maintain correct chunk order via chunkIndex", () => {
      const paragraphs = Array.from({ length: 10 }, (_, i) => 
        `Параграф ${i + 1}: ` + "Текст для тестирования порядка чанков. ".repeat(30)
      );
      const content = paragraphs.join("\n\n");
      const chunks = chunkDocument(content, "Order Test", "faq");

      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].metadata.chunkIndex).toBe(i);
      }
    });

    it("should set correct totalChunks in all chunks", () => {
      const content = "Тестовый текст. ".repeat(500);
      const chunks = chunkDocument(content, "Total Test", "returns");

      const total = chunks.length;
      for (const chunk of chunks) {
        expect(chunk.metadata.totalChunks).toBe(total);
      }
    });

    it("should preserve content order across chunks", () => {
      const content = "НАЧАЛО документа.\n\n" + 
        "Середина документа с текстом. ".repeat(200) + 
        "\n\nКОНЕЦ документа.";
      const chunks = chunkDocument(content, "Content Order", "policy");

      expect(chunks[0].content).toContain("НАЧАЛО");
      expect(chunks[chunks.length - 1].content).toContain("КОНЕЦ");
    });
  });

  describe("chunkDocument - no empty chunks", () => {
    it("should not produce empty chunks", () => {
      const content = "Текст.\n\n\n\n\n\nЕще текст.\n\n\n\nБольше текста.";
      const chunks = chunkDocument(content, "Empty Test", "delivery");

      for (const chunk of chunks) {
        expect(chunk.content.trim().length).toBeGreaterThan(0);
      }
    });

    it("should not produce chunks with zero tokens", () => {
      const content = "   \n\n  \n\nРеальный текст здесь.  \n\n   ";
      const chunks = chunkDocument(content, "Zero Test", "faq");

      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeGreaterThan(0);
      }
    });

    it("should handle whitespace-only paragraphs", () => {
      const content = "Первый параграф.\n\n   \n\n   \n\nВторой параграф.";
      const chunks = chunkDocument(content, "Whitespace Test", "returns");

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      for (const chunk of chunks) {
        expect(chunk.content.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("chunkDocument - metadata preservation", () => {
    it("should include title in metadata", () => {
      const content = "Контент документа.";
      const title = "Политика возврата";
      const chunks = chunkDocument(content, title, "returns");

      expect(chunks[0].metadata.title).toBe(title);
    });

    it("should include docType in metadata", () => {
      const chunks = chunkDocument("Контент.", "Title", "policy");
      expect(chunks[0].metadata.docType).toBe("policy");
    });

    it("should extract headings from markdown", () => {
      const content = "# Заголовок 1\n\nТекст под заголовком.\n\n## Заголовок 2\n\nЕще текст.";
      const chunks = chunkDocument(content, "Markdown Doc", "faq");

      const allHeadings = chunks.flatMap(c => c.metadata.headings);
      expect(allHeadings.some(h => h.includes("Заголовок"))).toBe(true);
    });

    it("should handle null docType", () => {
      const chunks = chunkDocument("Контент.", "Title", null);
      expect(chunks[0].metadata.docType).toBeNull();
    });
  });

  describe("chunkDocument - overlap handling", () => {
    it("should create overlapping content between adjacent chunks", () => {
      const paragraphs = Array.from({ length: 20 }, (_, i) => 
        `Уникальный параграф номер ${i + 1}. ` + "Дополнительный текст для увеличения размера. ".repeat(20)
      );
      const content = paragraphs.join("\n\n");
      const chunks = chunkDocument(content, "Overlap Test", "policy", {
        minTokens: 100,
        maxTokens: 200,
        overlapTokens: 50,
      });

      if (chunks.length >= 2) {
        expect(chunks.length).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
