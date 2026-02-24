/**
 * Unit tests for validation middleware and schemas
 */

import { describe, it, expect } from "vitest";
import {
  messageBodySchema,
  editSuggestionSchema,
  productBodySchema,
  knowledgeDocBodySchema,
  PAYLOAD_LIMITS,
} from "../middleware/validation";

describe("messageBodySchema", () => {
  it("validates valid message", () => {
    const result = messageBodySchema.safeParse({
      content: "Hello, world!",
      role: "owner",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty content", () => {
    const result = messageBodySchema.safeParse({
      content: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects content exceeding max length", () => {
    const longContent = "a".repeat(PAYLOAD_LIMITS.MAX_MESSAGE_LENGTH + 1);
    const result = messageBodySchema.safeParse({
      content: longContent,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(
        String(PAYLOAD_LIMITS.MAX_MESSAGE_LENGTH)
      );
    }
  });

  it("applies default role", () => {
    const result = messageBodySchema.safeParse({
      content: "Test",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("owner");
    }
  });

  it("validates attachments array", () => {
    const result = messageBodySchema.safeParse({
      content: "Test",
      attachments: [
        { type: "image", url: "https://example.com/img.jpg" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects too many attachments", () => {
    const attachments = Array(PAYLOAD_LIMITS.MAX_ATTACHMENTS_COUNT + 1).fill({
      type: "image",
      url: "https://example.com/img.jpg",
    });
    const result = messageBodySchema.safeParse({
      content: "Test",
      attachments,
    });
    expect(result.success).toBe(false);
  });
});

describe("editSuggestionSchema", () => {
  it("validates valid edit", () => {
    const result = editSuggestionSchema.safeParse({
      editedText: "Edited message content",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty edited text", () => {
    const result = editSuggestionSchema.safeParse({
      editedText: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects text exceeding max length", () => {
    const longText = "a".repeat(PAYLOAD_LIMITS.MAX_MESSAGE_LENGTH + 1);
    const result = editSuggestionSchema.safeParse({
      editedText: longText,
    });
    expect(result.success).toBe(false);
  });
});

describe("productBodySchema", () => {
  it("validates valid product", () => {
    const result = productBodySchema.safeParse({
      name: "Test Product",
      price: 999,
      currency: "RUB",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = productBodySchema.safeParse({
      name: "",
      price: 999,
    });
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding max length", () => {
    const result = productBodySchema.safeParse({
      name: "a".repeat(201),
      price: 999,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative price", () => {
    const result = productBodySchema.safeParse({
      name: "Test",
      price: -10,
    });
    expect(result.success).toBe(false);
  });

  it("applies default currency", () => {
    const result = productBodySchema.safeParse({
      name: "Test",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("RUB");
    }
  });

  it("validates description max length", () => {
    const longDesc = "a".repeat(PAYLOAD_LIMITS.MAX_PRODUCT_DESCRIPTION + 1);
    const result = productBodySchema.safeParse({
      name: "Test",
      description: longDesc,
    });
    expect(result.success).toBe(false);
  });
});

describe("knowledgeDocBodySchema", () => {
  it("validates valid document", () => {
    const result = knowledgeDocBodySchema.safeParse({
      title: "Test Doc",
      content: "Document content here",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = knowledgeDocBodySchema.safeParse({
      title: "",
      content: "Content",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = knowledgeDocBodySchema.safeParse({
      title: "Title",
      content: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects content exceeding max length", () => {
    const longContent = "a".repeat(PAYLOAD_LIMITS.MAX_KNOWLEDGE_DOC_CONTENT + 1);
    const result = knowledgeDocBodySchema.safeParse({
      title: "Title",
      content: longContent,
    });
    expect(result.success).toBe(false);
  });

  it("validates tags array", () => {
    const result = knowledgeDocBodySchema.safeParse({
      title: "Title",
      content: "Content",
      tags: ["tag1", "tag2"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects too many tags", () => {
    const tags = Array(21).fill("tag");
    const result = knowledgeDocBodySchema.safeParse({
      title: "Title",
      content: "Content",
      tags,
    });
    expect(result.success).toBe(false);
  });
});

describe("PAYLOAD_LIMITS", () => {
  it("has expected limits defined", () => {
    expect(PAYLOAD_LIMITS.MAX_BODY_SIZE).toBeGreaterThan(0);
    expect(PAYLOAD_LIMITS.MAX_MESSAGE_LENGTH).toBeGreaterThan(0);
    expect(PAYLOAD_LIMITS.MAX_ATTACHMENTS_COUNT).toBeGreaterThan(0);
    expect(PAYLOAD_LIMITS.MAX_PRODUCT_DESCRIPTION).toBeGreaterThan(0);
    expect(PAYLOAD_LIMITS.MAX_KNOWLEDGE_DOC_CONTENT).toBeGreaterThan(0);
  });

  it("has reasonable message limit", () => {
    // Between 1000 and 10000 characters is reasonable
    expect(PAYLOAD_LIMITS.MAX_MESSAGE_LENGTH).toBeGreaterThanOrEqual(1000);
    expect(PAYLOAD_LIMITS.MAX_MESSAGE_LENGTH).toBeLessThanOrEqual(10000);
  });
});
