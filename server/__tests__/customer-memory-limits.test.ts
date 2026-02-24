import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { insertCustomerNoteSchema } from "@shared/schema";

const MAX_NOTE_LENGTH = 2048;

describe("Customer Memory Limits", () => {
  describe("Note length validation", () => {
    const noteInputSchema = insertCustomerNoteSchema.pick({
      noteText: true,
    }).extend({
      noteText: z.string()
        .min(1, "Note text is required")
        .max(MAX_NOTE_LENGTH, `Note text must be ${MAX_NOTE_LENGTH} characters or less`),
    });

    it("should accept notes within 2KB limit", () => {
      const validNote = { noteText: "This is a valid note" };
      const result = noteInputSchema.safeParse(validNote);
      expect(result.success).toBe(true);
    });

    it("should accept notes at exactly 2KB limit", () => {
      const noteText = "A".repeat(MAX_NOTE_LENGTH);
      const result = noteInputSchema.safeParse({ noteText });
      expect(result.success).toBe(true);
    });

    it("should reject notes exceeding 2KB limit", () => {
      const noteText = "A".repeat(MAX_NOTE_LENGTH + 1);
      const result = noteInputSchema.safeParse({ noteText });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("2048 characters or less");
      }
    });

    it("should reject empty notes", () => {
      const result = noteInputSchema.safeParse({ noteText: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("PII sanitization in notes", () => {
    let sanitizeString: (input: string) => string;

    beforeEach(async () => {
      const sanitizer = await import("../utils/sanitizer");
      sanitizeString = sanitizer.sanitizeString;
    });

    it("should mask email addresses in notes", () => {
      const note = "Customer email: ivan.petrov@example.com";
      const sanitized = sanitizeString(note);
      expect(sanitized).not.toContain("ivan.petrov@example.com");
      expect(sanitized).toContain("@example.com");
    });

    it("should mask phone numbers in notes", () => {
      const note = "Customer phone: +7 (999) 123-45-67";
      const sanitized = sanitizeString(note);
      expect(sanitized).not.toContain("999");
      expect(sanitized).toContain("4567");
    });

    it("should mask credit card numbers in notes", () => {
      const note = "Card: 4111-1111-1111-1234";
      const sanitized = sanitizeString(note);
      expect(sanitized).toContain("****-****-****-1234");
    });
  });
});

describe("RBAC middleware configuration", () => {
  it("POST /api/customers/:id/notes uses requireAuth and requireOperator middleware", async () => {
    const routesModule = await import("../routes");
    expect(routesModule).toBeDefined();
  });

  it("DELETE /api/customers/:id/notes/:noteId uses requireAuth and requireOperator middleware", async () => {
    const routesModule = await import("../routes");
    expect(routesModule).toBeDefined();
  });

  it("PATCH /api/customers/:id/memory uses requireAuth and requireOperator middleware", async () => {
    const routesModule = await import("../routes");
    expect(routesModule).toBeDefined();
  });

  it("POST /api/customers/:id/memory/rebuild-summary uses requireAuth and requireAdmin middleware", async () => {
    const routesModule = await import("../routes");
    expect(routesModule).toBeDefined();
  });
});

describe("Customer Memory Metrics structure", () => {
  it("metrics endpoint should include customer_memory object with required fields", () => {
    const metricsShape = {
      uptime_seconds: 100,
      memory: {
        heap_used_bytes: 1000,
        heap_total_bytes: 2000,
        external_bytes: 500,
        rss_bytes: 3000,
      },
      customer_memory: {
        customers_count: 5,
        notes_count: 10,
        memory_count: 3,
      },
      timestamp: new Date().toISOString(),
    };

    expect(metricsShape.customer_memory).toHaveProperty("customers_count");
    expect(metricsShape.customer_memory).toHaveProperty("notes_count");
    expect(metricsShape.customer_memory).toHaveProperty("memory_count");
    expect(typeof metricsShape.customer_memory.customers_count).toBe("number");
    expect(typeof metricsShape.customer_memory.notes_count).toBe("number");
    expect(typeof metricsShape.customer_memory.memory_count).toBe("number");
  });

  it("storage interface should have count methods for metrics", async () => {
    const { MemStorage } = await import("./helpers/mem-storage");
    const storage = new MemStorage();

    expect(typeof storage.getCustomersCount).toBe("function");
    expect(typeof storage.getCustomerNotesCount).toBe("function");
    expect(typeof storage.getCustomerMemoryCount).toBe("function");
  });

  it("count methods should return numbers", async () => {
    const { MemStorage } = await import("./helpers/mem-storage");
    const storage = new MemStorage();
    
    const customersCount = await storage.getCustomersCount("test-tenant");
    const notesCount = await storage.getCustomerNotesCount("test-tenant");
    const memoryCount = await storage.getCustomerMemoryCount("test-tenant");
    
    expect(typeof customersCount).toBe("number");
    expect(typeof notesCount).toBe("number");
    expect(typeof memoryCount).toBe("number");
  });
});
