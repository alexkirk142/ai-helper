import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

vi.mock("../storage", () => ({
  storage: {
    getConversationsByTenant: vi.fn(),
    getMessagesByConversation: vi.fn(),
    upsertCustomerMemory: vi.fn(),
    getCustomerMemory: vi.fn(),
  },
}));

vi.mock("./audit-log", () => ({
  auditLog: {
    setContext: vi.fn(),
    log: vi.fn().mockResolvedValue({}),
  },
}));

import { generateCustomerSummary, shouldTriggerSummaryByMessageCount } from "../services/customer-summary-service";
import { storage } from "../storage";

describe("Customer Summary Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateCustomerSummary", () => {
    it("should return success with undefined summary when less than 3 messages", async () => {
      (storage.getConversationsByTenant as any).mockResolvedValue([
        { id: "conv-1", customerId: "cust-1" },
      ]);
      (storage.getMessagesByConversation as any).mockResolvedValue([
        { id: "msg-1", role: "customer", content: "Hello", createdAt: new Date() },
      ]);

      const result = await generateCustomerSummary("tenant-1", "cust-1", "manual_rebuild");

      expect(result.success).toBe(true);
      expect(result.summary).toBeUndefined();
    });

    it("should generate summary from LLM response", async () => {
      (storage.getConversationsByTenant as any).mockResolvedValue([
        { id: "conv-1", customerId: "cust-1" },
      ]);
      (storage.getMessagesByConversation as any).mockResolvedValue([
        { id: "msg-1", role: "customer", content: "Сколько стоит iPhone?", createdAt: new Date("2024-01-01") },
        { id: "msg-2", role: "owner", content: "iPhone стоит 80000 рублей", createdAt: new Date("2024-01-02") },
        { id: "msg-3", role: "customer", content: "А доставка есть?", createdAt: new Date("2024-01-03") },
        { id: "msg-4", role: "owner", content: "Да, доставка курьером", createdAt: new Date("2024-01-04") },
      ]);
      (storage.upsertCustomerMemory as any).mockResolvedValue({});

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              summary_bullets: [
                "- Интересовался ценой на iPhone",
                "- Спрашивал о доставке",
              ],
            }),
          },
        }],
      });

      const result = await generateCustomerSummary("tenant-1", "cust-1", "manual_rebuild");

      expect(result.success).toBe(true);
      expect(result.summary).toContain("Интересовался ценой на iPhone");
      expect(result.summary).toContain("Спрашивал о доставке");
      expect(storage.upsertCustomerMemory).toHaveBeenCalled();
    });

    it("should handle LLM error gracefully without crashing", async () => {
      (storage.getConversationsByTenant as any).mockResolvedValue([
        { id: "conv-1", customerId: "cust-1" },
      ]);
      (storage.getMessagesByConversation as any).mockResolvedValue([
        { id: "msg-1", role: "customer", content: "Hello", createdAt: new Date("2024-01-01") },
        { id: "msg-2", role: "owner", content: "Hi", createdAt: new Date("2024-01-02") },
        { id: "msg-3", role: "customer", content: "Test", createdAt: new Date("2024-01-03") },
      ]);

      mockCreate.mockRejectedValue(new Error("LLM unavailable"));

      const result = await generateCustomerSummary("tenant-1", "cust-1", "manual_rebuild");

      expect(result.success).toBe(false);
      expect(result.error).toBe("LLM unavailable");
    });

    it("should handle invalid JSON response from LLM", async () => {
      (storage.getConversationsByTenant as any).mockResolvedValue([
        { id: "conv-1", customerId: "cust-1" },
      ]);
      (storage.getMessagesByConversation as any).mockResolvedValue([
        { id: "msg-1", role: "customer", content: "Hello", createdAt: new Date("2024-01-01") },
        { id: "msg-2", role: "owner", content: "Hi", createdAt: new Date("2024-01-02") },
        { id: "msg-3", role: "customer", content: "Test", createdAt: new Date("2024-01-03") },
      ]);

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: "not valid json",
          },
        }],
      });

      const result = await generateCustomerSummary("tenant-1", "cust-1", "manual_rebuild");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to parse LLM response");
    });

    it("should handle missing summary_bullets in LLM response", async () => {
      (storage.getConversationsByTenant as any).mockResolvedValue([
        { id: "conv-1", customerId: "cust-1" },
      ]);
      (storage.getMessagesByConversation as any).mockResolvedValue([
        { id: "msg-1", role: "customer", content: "Hello", createdAt: new Date("2024-01-01") },
        { id: "msg-2", role: "owner", content: "Hi", createdAt: new Date("2024-01-02") },
        { id: "msg-3", role: "customer", content: "Test", createdAt: new Date("2024-01-03") },
      ]);

      mockCreate.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({ other_field: "value" }),
          },
        }],
      });

      const result = await generateCustomerSummary("tenant-1", "cust-1", "manual_rebuild");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid summary format from LLM");
    });
  });

  describe("shouldTriggerSummaryByMessageCount", () => {
    it("should return false when less than trigger count messages", async () => {
      (storage.getConversationsByTenant as any).mockResolvedValue([
        { id: "conv-1", customerId: "cust-1" },
      ]);
      (storage.getMessagesByConversation as any).mockResolvedValue([
        { id: "msg-1", role: "customer", content: "Hello", createdAt: new Date() },
      ]);

      const result = await shouldTriggerSummaryByMessageCount("tenant-1", "cust-1");

      expect(result).toBe(false);
    });

    it("should return true when no existing summary and enough messages", async () => {
      const messages = Array.from({ length: 10 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? "customer" : "owner",
        content: `Message ${i}`,
        createdAt: new Date(Date.now() - i * 1000),
      }));

      (storage.getConversationsByTenant as any).mockResolvedValue([
        { id: "conv-1", customerId: "cust-1" },
      ]);
      (storage.getMessagesByConversation as any).mockResolvedValue(messages);
      (storage.getCustomerMemory as any).mockResolvedValue(null);

      const result = await shouldTriggerSummaryByMessageCount("tenant-1", "cust-1");

      expect(result).toBe(true);
    });
  });
});
