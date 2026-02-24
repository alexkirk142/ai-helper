import { describe, it, expect, beforeEach } from "vitest";
import {
  scheduleDelayedMessage,
  cancelDelayedMessage,
  getDelayedJobs,
  getQueueMetrics,
  resetMetrics,
} from "../message-queue";

describe("Message Queue Service", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("scheduleDelayedMessage", () => {
    it("should return null when HUMAN_DELAY_ENABLED=false or queue unavailable", async () => {
      const result = await scheduleDelayedMessage({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        messageId: "msg-1",
        suggestionId: "sug-1",
        channel: "mock",
        text: "Hello, world!",
        delayMs: 5000,
        typingEnabled: false,
      });

      expect(result).toBeNull();
    });

    it("should handle scheduling with typing enabled", async () => {
      const result = await scheduleDelayedMessage({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        messageId: "msg-2",
        suggestionId: "sug-2",
        channel: "mock",
        text: "Original message",
        delayMs: 3000,
        typingEnabled: true,
      });

      expect(result).toBeNull();
    });
  });

  describe("cancelDelayedMessage", () => {
    it("should return false for non-existent job", async () => {
      const result = await cancelDelayedMessage("non-existent-msg", "rejected");
      expect(result).toBe(false);
    });

    it("should handle cancel with different reasons", async () => {
      const reasons: Array<"edited" | "rejected" | "escalated"> = ["edited", "rejected", "escalated"];
      for (const reason of reasons) {
        const result = await cancelDelayedMessage("non-existent", reason);
        expect(result).toBe(false);
      }
    });
  });

  describe("getDelayedJobs", () => {
    it("should return empty array when queue unavailable", async () => {
      const jobs = await getDelayedJobs();
      expect(Array.isArray(jobs)).toBe(true);
      expect(jobs.length).toBe(0);
    });
  });

  describe("getQueueMetrics", () => {
    it("should return metrics object with correct structure", () => {
      const metrics = getQueueMetrics();
      expect(metrics).toHaveProperty("scheduledCount");
      expect(metrics).toHaveProperty("completedCount");
      expect(metrics).toHaveProperty("failedCount");
      expect(metrics).toHaveProperty("avgDelayMs");
    });

    it("should reset metrics correctly", () => {
      resetMetrics();
      const metrics = getQueueMetrics();
      expect(metrics.scheduledCount).toBe(0);
      expect(metrics.completedCount).toBe(0);
      expect(metrics.failedCount).toBe(0);
      expect(metrics.avgDelayMs).toBe(0);
    });
  });
});
