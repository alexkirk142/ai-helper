import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  calculateDelay,
  computeHumanDelay,
  getDefaultHumanDelaySettings,
  HumanDelayInput,
} from "../services/human-delay-engine";
import { HumanDelaySettings, DEFAULT_DELAY_PROFILES } from "@shared/schema";

describe("Human Delay Engine", () => {
  const mockTenant = {
    workingHoursStart: "09:00",
    workingHoursEnd: "18:00",
    timezone: "Europe/Moscow",
  };

  const mockSettings: HumanDelaySettings = {
    tenantId: "test-tenant",
    enabled: true,
    delayProfiles: DEFAULT_DELAY_PROFILES,
    nightMode: "DELAY",
    nightDelayMultiplier: 3.0,
    nightAutoReplyText: "Thanks for your message!",
    minDelayMs: 3000,
    maxDelayMs: 120000,
    typingIndicatorEnabled: true,
    updatedAt: new Date(),
  };

  describe("getDefaultHumanDelaySettings", () => {
    it("should return default settings with correct tenantId", () => {
      const settings = getDefaultHumanDelaySettings("tenant-123");
      expect(settings.tenantId).toBe("tenant-123");
      expect(settings.enabled).toBe(false);
      expect(settings.nightMode).toBe("DELAY");
      expect(settings.nightDelayMultiplier).toBe(3.0);
      expect(settings.minDelayMs).toBe(3000);
      expect(settings.maxDelayMs).toBe(120000);
    });
  });

  describe("calculateDelay", () => {
    it("should select SHORT profile for short messages (<100 chars)", () => {
      const input: HumanDelayInput = {
        messageLength: 50,
        settings: mockSettings,
        tenant: mockTenant,
      };
      const result = calculateDelay(input);
      expect(result.profileUsed).toBe("SHORT");
    });

    it("should select MEDIUM profile for medium messages (100-300 chars)", () => {
      const input: HumanDelayInput = {
        messageLength: 200,
        settings: mockSettings,
        tenant: mockTenant,
      };
      const result = calculateDelay(input);
      expect(result.profileUsed).toBe("MEDIUM");
    });

    it("should select LONG profile for long messages (>300 chars)", () => {
      const input: HumanDelayInput = {
        messageLength: 500,
        settings: mockSettings,
        tenant: mockTenant,
      };
      const result = calculateDelay(input);
      expect(result.profileUsed).toBe("LONG");
    });

    it("should respect profile override", () => {
      const input: HumanDelayInput = {
        messageLength: 50,
        settings: mockSettings,
        tenant: mockTenant,
        profileOverride: "LONG",
      };
      const result = calculateDelay(input);
      expect(result.profileUsed).toBe("LONG");
    });

    it("should respect min/max delay bounds", () => {
      const input: HumanDelayInput = {
        messageLength: 50,
        settings: mockSettings,
        tenant: mockTenant,
      };
      const result = calculateDelay(input);
      expect(result.finalDelayMs).toBeGreaterThanOrEqual(mockSettings.minDelayMs);
      expect(result.finalDelayMs).toBeLessThanOrEqual(mockSettings.maxDelayMs);
    });

    it("should include typing delay based on message length and typing speed", () => {
      const input: HumanDelayInput = {
        messageLength: 100,
        settings: mockSettings,
        tenant: mockTenant,
      };
      const result = calculateDelay(input);
      expect(result.typingDelayMs).toBeGreaterThan(0);
    });
  });

  describe("computeHumanDelay", () => {
    it("should return zero delay when disabled", () => {
      const input: HumanDelayInput = {
        messageLength: 100,
        settings: { ...mockSettings, enabled: false },
        tenant: mockTenant,
      };
      const result = computeHumanDelay(input);
      expect(result.delay.finalDelayMs).toBe(0);
      expect(result.shouldSend).toBe(true);
      expect(result.nightModeAction).toBeNull();
    });

    it("should return shouldSend=true during working hours", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-08T12:00:00+03:00"));

      const input: HumanDelayInput = {
        messageLength: 100,
        settings: mockSettings,
        tenant: mockTenant,
      };
      const result = computeHumanDelay(input);
      expect(result.shouldSend).toBe(true);

      vi.useRealTimers();
    });

    it("should handle AUTO_REPLY night mode", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-08T23:00:00+03:00"));

      const input: HumanDelayInput = {
        messageLength: 100,
        settings: { ...mockSettings, nightMode: "AUTO_REPLY" },
        tenant: mockTenant,
      };
      const result = computeHumanDelay(input);
      expect(result.nightModeAction).toBe("AUTO_REPLY");
      expect(result.autoReplyText).toBe("Thanks for your message!");
      expect(result.shouldSend).toBe(true);

      vi.useRealTimers();
    });

    it("should handle DISABLE night mode", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-08T23:00:00+03:00"));

      const input: HumanDelayInput = {
        messageLength: 100,
        settings: { ...mockSettings, nightMode: "DISABLE" },
        tenant: mockTenant,
      };
      const result = computeHumanDelay(input);
      expect(result.nightModeAction).toBe("DISABLE");
      expect(result.shouldSend).toBe(false);

      vi.useRealTimers();
    });

    it("should apply night delay multiplier in DELAY mode", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-08T23:00:00+03:00"));

      const input: HumanDelayInput = {
        messageLength: 100,
        settings: mockSettings,
        tenant: mockTenant,
      };
      const result = computeHumanDelay(input);
      expect(result.delay.isNightMode).toBe(true);
      expect(result.delay.nightMultiplierApplied).toBe(3.0);
      expect(result.nightModeAction).toBe("DELAY");

      vi.useRealTimers();
    });
  });

  describe("Edge cases", () => {
    it("should handle empty message", () => {
      const input: HumanDelayInput = {
        messageLength: 0,
        settings: mockSettings,
        tenant: mockTenant,
      };
      const result = calculateDelay(input);
      expect(result.typingDelayMs).toBe(0);
      expect(result.profileUsed).toBe("SHORT");
    });

    it("should handle very long message", () => {
      const input: HumanDelayInput = {
        messageLength: 5000,
        settings: mockSettings,
        tenant: mockTenant,
      };
      const result = calculateDelay(input);
      expect(result.finalDelayMs).toBeLessThanOrEqual(mockSettings.maxDelayMs);
    });

    it("should handle missing working hours", () => {
      const input: HumanDelayInput = {
        messageLength: 100,
        settings: mockSettings,
        tenant: {
          workingHoursStart: null,
          workingHoursEnd: null,
          timezone: "UTC",
        },
      };
      const result = computeHumanDelay(input);
      expect(result.shouldSend).toBe(true);
    });

    it("should handle overnight working hours", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-01-08T02:00:00+03:00"));

      const input: HumanDelayInput = {
        messageLength: 100,
        settings: mockSettings,
        tenant: {
          workingHoursStart: "22:00",
          workingHoursEnd: "06:00",
          timezone: "Europe/Moscow",
        },
      };
      const result = computeHumanDelay(input);
      expect(result.delay.isNightMode).toBe(false);

      vi.useRealTimers();
    });
  });
});
