import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TelegramAdapter, TelegramUpdate, TelegramMessage } from "../telegram-adapter";

describe("TelegramAdapter", () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    adapter = new TelegramAdapter("test_bot_token");
  });

  afterEach(() => {
    adapter.clearProcessedMessages();
    vi.restoreAllMocks();
  });

  describe("parseIncomingMessage", () => {
    it("should parse a valid text message", () => {
      const payload: TelegramUpdate = {
        update_id: 123456789,
        message: {
          message_id: 42,
          from: {
            id: 100500,
            is_bot: false,
            first_name: "Иван",
            last_name: "Петров",
            username: "ivan_petrov",
            language_code: "ru",
          },
          chat: {
            id: 100500,
            type: "private",
            first_name: "Иван",
            last_name: "Петров",
            username: "ivan_petrov",
          },
          date: 1704067200,
          text: "Привет! Какие у вас товары?",
        },
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result!.externalMessageId).toBe("42");
      expect(result!.externalConversationId).toBe("100500");
      expect(result!.externalUserId).toBe("100500");
      expect(result!.text).toBe("Привет! Какие у вас товары?");
      expect(result!.channel).toBe("telegram");
      expect(result!.timestamp).toEqual(new Date(1704067200 * 1000));
      expect(result!.metadata).toMatchObject({
        updateId: 123456789,
        chatType: "private",
        firstName: "Иван",
        lastName: "Петров",
        username: "ivan_petrov",
        languageCode: "ru",
      });
    });

    it("should parse a group message", () => {
      const payload: TelegramUpdate = {
        update_id: 123456790,
        message: {
          message_id: 99,
          from: {
            id: 200300,
            is_bot: false,
            first_name: "Мария",
            username: "maria_test",
          },
          chat: {
            id: -1001234567890,
            type: "supergroup",
            title: "Тестовая группа",
            username: "test_group",
          },
          date: 1704153600,
          text: "Сообщение в группе",
        },
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result!.externalMessageId).toBe("99");
      expect(result!.externalConversationId).toBe("-1001234567890");
      expect(result!.externalUserId).toBe("200300");
      expect(result!.metadata?.chatType).toBe("supergroup");
      expect(result!.metadata?.chatTitle).toBe("Тестовая группа");
    });

    it("should handle edited messages", () => {
      const payload: TelegramUpdate = {
        update_id: 123456791,
        edited_message: {
          message_id: 55,
          from: {
            id: 100500,
            is_bot: false,
            first_name: "Test",
          },
          chat: {
            id: 100500,
            type: "private",
          },
          date: 1704240000,
          text: "Отредактированное сообщение",
        },
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result!.externalMessageId).toBe("55");
      expect(result!.text).toBe("Отредактированное сообщение");
    });

    it("should return null for null payload", () => {
      const result = adapter.parseIncomingMessage(null);
      expect(result).toBeNull();
    });

    it("should return null for empty object", () => {
      const result = adapter.parseIncomingMessage({});
      expect(result).toBeNull();
    });

    it("should return null for message without text", () => {
      const payload: TelegramUpdate = {
        update_id: 123456792,
        message: {
          message_id: 100,
          from: {
            id: 100500,
            is_bot: false,
            first_name: "Test",
          },
          chat: {
            id: 100500,
            type: "private",
          },
          date: 1704326400,
        },
      };

      const result = adapter.parseIncomingMessage(payload);
      expect(result).toBeNull();
    });

    it("should ignore duplicate messages (idempotency)", () => {
      const payload: TelegramUpdate = {
        update_id: 123456793,
        message: {
          message_id: 777,
          from: {
            id: 100500,
            is_bot: false,
            first_name: "Test",
          },
          chat: {
            id: 100500,
            type: "private",
          },
          date: 1704412800,
          text: "Дублирующееся сообщение",
        },
      };

      const result1 = adapter.parseIncomingMessage(payload);
      expect(result1).not.toBeNull();

      const result2 = adapter.parseIncomingMessage(payload);
      expect(result2).toBeNull();
    });

    it("should handle message without from field", () => {
      const payload = {
        update_id: 123456794,
        message: {
          message_id: 888,
          chat: {
            id: 100500,
            type: "private",
          },
          date: 1704499200,
          text: "Сообщение без отправителя",
        },
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result!.externalUserId).toBe("unknown");
    });
  });

  describe("verifyWebhook", () => {
    it("should return valid when no secret is configured", () => {
      const result = adapter.verifyWebhook({}, {});
      expect(result.valid).toBe(true);
    });

    it("should return valid when secret matches", () => {
      const headers = {
        "x-telegram-bot-api-secret-token": "my_secret_token",
      };

      const result = adapter.verifyWebhook(headers, {}, "my_secret_token");
      expect(result.valid).toBe(true);
    });

    it("should return invalid when secret header is missing", () => {
      const result = adapter.verifyWebhook({}, {}, "my_secret_token");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing secret header");
    });

    it("should return invalid when secret does not match", () => {
      const headers = {
        "x-telegram-bot-api-secret-token": "wrong_secret",
      };

      const result = adapter.verifyWebhook(headers, {}, "my_secret_token");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid secret");
    });

    it("should handle capitalized header names", () => {
      const headers = {
        "X-Telegram-Bot-Api-Secret-Token": "my_secret_token",
      };

      const result = adapter.verifyWebhook(headers, {}, "my_secret_token");
      expect(result.valid).toBe(true);
    });
  });

  describe("sendMessage", () => {
    beforeEach(() => {
      vi.mock("../feature-flags", () => ({
        featureFlagService: {
          isEnabled: vi.fn().mockResolvedValue(true),
        },
      }));
    });

    it("should map message correctly for API request", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            result: {
              message_id: 12345,
              from: { id: 123, is_bot: true, first_name: "TestBot" },
              chat: { id: 100500, type: "private" },
              date: 1704585600,
              text: "Test message",
            },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const testAdapter = new TelegramAdapter("test_token");
      const result = await testAdapter.sendMessage("100500", "Test message");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest_token/sendMessage",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: 100500,
            text: "Test message",
            parse_mode: "HTML",
          }),
        })
      );

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe("12345");
    });

    it("should handle reply_to_message_id option", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            result: {
              message_id: 12346,
              chat: { id: 100500, type: "private" },
              date: 1704585600,
              text: "Reply message",
            },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const testAdapter = new TelegramAdapter("test_token");
      await testAdapter.sendMessage("100500", "Reply message", {
        replyToMessageId: "999",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            chat_id: 100500,
            text: "Reply message",
            parse_mode: "HTML",
            reply_to_message_id: 999,
          }),
        })
      );
    });

    it("should truncate long messages to 4096 characters", async () => {
      const longText = "A".repeat(5000);
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            result: {
              message_id: 12347,
              chat: { id: 100500, type: "private" },
              date: 1704585600,
            },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const testAdapter = new TelegramAdapter("test_token");
      await testAdapter.sendMessage("100500", longText);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.text.length).toBe(4096);
    });

    it("should return error for invalid chat ID", async () => {
      const testAdapter = new TelegramAdapter("test_token");
      const result = await testAdapter.sendMessage("invalid_id", "Test");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid chat ID");
    });

    it("should return error when token is not configured", async () => {
      const testAdapter = new TelegramAdapter("");
      const result = await testAdapter.sendMessage("100500", "Test");

      expect(result.success).toBe(false);
      expect(result.error).toBe("TELEGRAM_BOT_TOKEN not configured");
    });
  });

  describe("sendTypingStart", () => {
    it("should call sendChatAction with typing action", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: true }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const testAdapter = new TelegramAdapter("test_token");
      await testAdapter.sendTypingStart("100500");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest_token/sendChatAction",
        expect.objectContaining({
          body: JSON.stringify({
            chat_id: 100500,
            action: "typing",
          }),
        })
      );
    });
  });

  describe("error handling", () => {
    it("should handle 401 auth errors", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            ok: false,
            error_code: 401,
            description: "Unauthorized",
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const testAdapter = new TelegramAdapter("invalid_token");
      const result = await testAdapter.verifyAuth();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unauthorized");
    });

    it("should handle 429 rate limit with retry", async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            json: () =>
              Promise.resolve({
                ok: false,
                error_code: 429,
                description: "Too Many Requests",
                parameters: { retry_after: 1 },
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ok: true,
              result: {
                id: 123456,
                is_bot: true,
                first_name: "TestBot",
                username: "test_bot",
              },
            }),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const testAdapter = new TelegramAdapter("test_token");
      const result = await testAdapter.verifyAuth();

      expect(callCount).toBe(2);
      expect(result.success).toBe(true);
      expect(result.botInfo?.username).toBe("test_bot");
    }, 10000);

    it("should handle 5xx server errors with retry", async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 502,
            json: () =>
              Promise.resolve({
                ok: false,
                error_code: 502,
                description: "Bad Gateway",
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ok: true,
              result: {
                message_id: 999,
                chat: { id: 100500, type: "private" },
                date: Date.now() / 1000,
              },
            }),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const testAdapter = new TelegramAdapter("test_token");
      const result = await testAdapter.sendMessage("100500", "Test after retry");

      expect(callCount).toBe(2);
      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe("999");
    }, 10000);
  });
});
