import { describe, it, expect, beforeEach, vi } from "vitest";
import { MaxAdapter } from "../max-adapter";

describe("MaxAdapter", () => {
  let adapter: MaxAdapter;

  beforeEach(() => {
    adapter = new MaxAdapter("test_token");
    adapter.clearProcessedMessages();
  });

  describe("parseIncomingMessage", () => {
    it("should parse a valid message_created webhook payload", () => {
      const payload = {
        update_type: "message_created",
        timestamp: 1737500130100,
        message: {
          mid: "msg_12345",
          seq: 1,
          text: "Hello from MAX!",
          sender: {
            user_id: 123456,
            first_name: "Ivan",
            last_name: "Petrov",
            username: "ivanp",
          },
          recipient: {
            chat_id: 789,
          },
          timestamp: 1737500130000,
        },
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result?.externalMessageId).toBe("msg_12345");
      expect(result?.externalConversationId).toBe("789");
      expect(result?.externalUserId).toBe("123456");
      expect(result?.text).toBe("Hello from MAX!");
      expect(result?.channel).toBe("max");
      expect(result?.metadata?.senderFirstName).toBe("Ivan");
      expect(result?.metadata?.senderUsername).toBe("ivanp");
    });

    it("should parse updates array format", () => {
      const payload = {
        updates: [
          {
            update_type: "message_created",
            timestamp: 1737500130100,
            message: {
              mid: "msg_array_1",
              seq: 2,
              text: "Array format message",
              sender: {
                user_id: 111,
              },
              recipient: {
                user_id: 222,
              },
              timestamp: 1737500130000,
            },
          },
        ],
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result?.externalMessageId).toBe("msg_array_1");
      expect(result?.text).toBe("Array format message");
    });

    it("should return null for empty payload", () => {
      expect(adapter.parseIncomingMessage(null)).toBeNull();
      expect(adapter.parseIncomingMessage(undefined)).toBeNull();
      expect(adapter.parseIncomingMessage({})).toBeNull();
    });

    it("should return null for messages without text", () => {
      const payload = {
        update_type: "message_created",
        message: {
          mid: "msg_notext",
          sender: { user_id: 123 },
        },
      };

      const result = adapter.parseIncomingMessage(payload);
      expect(result).toBeNull();
    });

    it("should ignore non-message updates", () => {
      const payload = {
        update_type: "bot_started",
        timestamp: 1737500130100,
        user_id: 123,
      };

      const result = adapter.parseIncomingMessage(payload);
      expect(result).toBeNull();
    });

    it("should handle idempotency - same message parsed twice", () => {
      const payload = {
        update_type: "message_created",
        message: {
          mid: "duplicate_msg_123",
          text: "Duplicate message",
          sender: { user_id: 123 },
          recipient: { chat_id: 456 },
          timestamp: Date.now(),
        },
      };

      const result1 = adapter.parseIncomingMessage(payload);
      expect(result1).not.toBeNull();

      const result2 = adapter.parseIncomingMessage(payload);
      expect(result2).toBeNull();
    });
  });

  describe("verifyWebhook", () => {
    it("should verify valid webhook secret", () => {
      const headers = {
        "x-max-bot-api-secret": "my_secret_123",
      };

      const result = adapter.verifyWebhook(headers, {}, "my_secret_123");

      expect(result.valid).toBe(true);
    });

    it("should reject invalid webhook secret", () => {
      const headers = {
        "x-max-bot-api-secret": "wrong_secret",
      };

      const result = adapter.verifyWebhook(headers, {}, "correct_secret");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid secret");
    });

    it("should reject missing secret header", () => {
      const headers = {};

      const result = adapter.verifyWebhook(headers, {}, "expected_secret");

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing secret header");
    });

    it("should accept any request when no secret configured", () => {
      const headers = {};

      const result = adapter.verifyWebhook(headers, {});

      expect(result.valid).toBe(true);
    });

    it("should handle case-insensitive header names", () => {
      const headers = {
        "X-Max-Bot-Api-Secret": "my_secret",
      };

      const result = adapter.verifyWebhook(headers, {}, "my_secret");

      expect(result.valid).toBe(true);
    });
  });

  describe("sendMessage payload structure", () => {
    it("should create correct message body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            mid: "sent_msg_123",
            seq: 1,
            timestamp: Date.now(),
          },
        }),
      });

      global.fetch = mockFetch;

      vi.mock("../feature-flags", () => ({
        featureFlagService: {
          isEnabled: vi.fn().mockResolvedValue(true),
        },
      }));

      await adapter.sendMessage("12345", "Test message");

      expect(mockFetch).toHaveBeenCalled();
      const [url, options] = mockFetch.mock.calls[0];

      expect(url).toContain("https://platform-api.max.ru/messages");
      expect(url).toContain("user_id=12345");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer test_token");

      const body = JSON.parse(options.body);
      expect(body.text).toBe("Test message");
      expect(body.notify).toBe(true);
    });

    it("should truncate long messages to 4000 chars", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          message: { mid: "msg_1", seq: 1, timestamp: Date.now() },
        }),
      });

      global.fetch = mockFetch;

      const longText = "a".repeat(5000);
      await adapter.sendMessage("123", longText);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text.length).toBe(4000);
    });
  });

  describe("verifyAuth", () => {
    it("should return error when no token configured", async () => {
      const noTokenAdapter = new MaxAdapter("");

      const result = await noTokenAdapter.verifyAuth();

      expect(result.success).toBe(false);
      expect(result.error).toBe("MAX_TOKEN not configured");
    });

    it("should handle successful auth response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          user_id: 12345,
          first_name: "TestBot",
          is_bot: true,
          username: "test_bot",
        }),
      });

      global.fetch = mockFetch;

      const result = await adapter.verifyAuth();

      expect(result.success).toBe(true);
      expect(result.botInfo?.user_id).toBe(12345);
      expect(result.botInfo?.first_name).toBe("TestBot");
    });

    it("should handle auth failure", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      global.fetch = mockFetch;

      const result = await adapter.verifyAuth();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Authentication failed");
    });
  });

  describe("error handling", () => {
    it("should handle 429 rate limit with retry", async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve({
            ok: false,
            status: 429,
            headers: new Map([["Retry-After", "1"]]),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            message: { mid: "msg_after_retry", seq: 1, timestamp: Date.now() },
          }),
        });
      });

      global.fetch = mockFetch;

      await adapter.sendMessage("123", "Test");

      expect(callCount).toBeGreaterThan(1);
    });

    it("should handle 5xx server errors with retry", async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: async () => "Internal Server Error",
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            message: { mid: "msg_recovered", seq: 1, timestamp: Date.now() },
          }),
        });
      });

      global.fetch = mockFetch;

      await adapter.sendMessage("123", "Test");

      expect(callCount).toBe(2);
    });
  });
});
