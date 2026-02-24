import { describe, it, expect, beforeEach, vi } from "vitest";
import { WhatsAppAdapter } from "../whatsapp-adapter";
import crypto from "crypto";

describe("WhatsAppAdapter", () => {
  let adapter: WhatsAppAdapter;

  beforeEach(() => {
    adapter = new WhatsAppAdapter({
      accessToken: "test_access_token",
      phoneNumberId: "123456789",
      verifyToken: "test_verify_token",
      appSecret: "test_app_secret",
    });
    adapter.clearProcessedMessages();
  });

  describe("verifyWebhookChallenge", () => {
    it("should verify valid webhook challenge", () => {
      const query = {
        "hub.mode": "subscribe",
        "hub.verify_token": "test_verify_token",
        "hub.challenge": "challenge_12345",
      };

      const result = adapter.verifyWebhookChallenge(query);

      expect(result.valid).toBe(true);
      expect(result.challenge).toBe("challenge_12345");
    });

    it("should reject invalid hub.mode", () => {
      const query = {
        "hub.mode": "unsubscribe",
        "hub.verify_token": "test_verify_token",
        "hub.challenge": "challenge_12345",
      };

      const result = adapter.verifyWebhookChallenge(query);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid hub.mode");
    });

    it("should reject mismatched verify token", () => {
      const query = {
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong_token",
        "hub.challenge": "challenge_12345",
      };

      const result = adapter.verifyWebhookChallenge(query);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Verify token mismatch");
    });
  });

  describe("verifyWebhook (signature)", () => {
    it("should verify valid signature", () => {
      const body = JSON.stringify({ test: "data" });
      const signature = "sha256=" + crypto
        .createHmac("sha256", "test_app_secret")
        .update(body, "utf8")
        .digest("hex");

      const headers = {
        "x-hub-signature-256": signature,
      };

      const result = adapter.verifyWebhook(headers, body);

      expect(result.valid).toBe(true);
    });

    it("should reject missing signature header", () => {
      const body = JSON.stringify({ test: "data" });
      const headers = {};

      const result = adapter.verifyWebhook(headers, body);

      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing X-Hub-Signature-256 header");
    });

    it("should reject invalid signature", () => {
      const body = JSON.stringify({ test: "data" });
      const headers = {
        "x-hub-signature-256": "sha256=invalid_signature_here",
      };

      const result = adapter.verifyWebhook(headers, body);

      expect(result.valid).toBe(false);
    });
  });

  describe("parseIncomingMessage", () => {
    it("should parse text message correctly", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "123456789",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "15550001234",
                    phone_number_id: "987654321",
                  },
                  contacts: [
                    {
                      profile: { name: "Test User" },
                      wa_id: "15551234567",
                    },
                  ],
                  messages: [
                    {
                      from: "15551234567",
                      id: "wamid.test123",
                      timestamp: "1704067200",
                      type: "text",
                      text: { body: "Hello, I need help!" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result?.externalMessageId).toBe("wamid.test123");
      expect(result?.externalConversationId).toBe("15551234567");
      expect(result?.externalUserId).toBe("15551234567");
      expect(result?.text).toBe("Hello, I need help!");
      expect(result?.channel).toBe("whatsapp");
      expect(result?.metadata?.contactName).toBe("Test User");
      expect(result?.metadata?.phoneNumberId).toBe("987654321");
    });

    it("should reject non-WhatsApp events", () => {
      const payload = {
        object: "instagram",
        entry: [],
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).toBeNull();
    });

    it("should handle duplicate messages", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "123456789",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "15550001234",
                    phone_number_id: "987654321",
                  },
                  messages: [
                    {
                      from: "15551234567",
                      id: "wamid.duplicate",
                      timestamp: "1704067200",
                      type: "text",
                      text: { body: "Duplicate message" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result1 = adapter.parseIncomingMessage(payload);
      const result2 = adapter.parseIncomingMessage(payload);

      expect(result1).not.toBeNull();
      expect(result2).toBeNull();
    });

    it("should handle button responses", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "123456789",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "15550001234",
                    phone_number_id: "987654321",
                  },
                  messages: [
                    {
                      from: "15551234567",
                      id: "wamid.button123",
                      timestamp: "1704067200",
                      type: "button",
                      button: { text: "Yes, confirm" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result?.text).toContain("Button");
    });

    it("should return null for status updates", () => {
      const payload = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "123456789",
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: {
                    display_phone_number: "15550001234",
                    phone_number_id: "987654321",
                  },
                  statuses: [
                    {
                      id: "wamid.status123",
                      status: "delivered",
                      timestamp: "1704067200",
                      recipient_id: "15551234567",
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).toBeNull();
    });
  });

  describe("isWithinCustomerCareWindow", () => {
    it("should return false for unknown recipient", () => {
      const result = adapter.isWithinCustomerCareWindow("unknown_user");

      expect(result).toBe(false);
    });

    it("should return true for recent inbound message", () => {
      adapter.recordInboundMessage("15551234567", new Date());

      const result = adapter.isWithinCustomerCareWindow("15551234567");

      expect(result).toBe(true);
    });

    it("should return false for old inbound message", () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      adapter.recordInboundMessage("15551234567", oldDate);

      const result = adapter.isWithinCustomerCareWindow("15551234567");

      expect(result).toBe(false);
    });
  });

  describe("sendMessage", () => {
    it("should fail without credentials", async () => {
      const unconfiguredAdapter = new WhatsAppAdapter({
        accessToken: "",
        phoneNumberId: "",
      });

      const result = await unconfiguredAdapter.sendMessage("15551234567", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured");
    });

    it("should fail outside 24h window without template", async () => {
      const result = await adapter.sendMessage("new_user", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("24h");
    });

    it("should allow sending within 24h window", async () => {
      adapter.recordInboundMessage("15551234567", new Date());

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          messaging_product: "whatsapp",
          contacts: [{ input: "15551234567", wa_id: "15551234567" }],
          messages: [{ id: "wamid.sent123" }],
        }),
      });

      const result = await adapter.sendMessage("15551234567", "Hello");

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe("wamid.sent123");
    });

    it("should send template message", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          messaging_product: "whatsapp",
          contacts: [{ input: "15551234567", wa_id: "15551234567" }],
          messages: [{ id: "wamid.template123" }],
        }),
      });

      const result = await adapter.sendTemplateMessage(
        "15551234567",
        "hello_world",
        "en_US"
      );

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe("wamid.template123");

      const fetchCall = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.type).toBe("template");
      expect(body.template.name).toBe("hello_world");
    });
  });

  describe("testConnection", () => {
    it("should fail without credentials", async () => {
      const unconfiguredAdapter = new WhatsAppAdapter({
        accessToken: "",
        phoneNumberId: "",
      });

      const result = await unconfiguredAdapter.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured");
    });

    it("should return bot info on success", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: "987654321",
          verified_name: "Test Business",
          display_phone_number: "+1 555-000-1234",
          quality_rating: "GREEN",
        }),
      });

      const result = await adapter.testConnection();

      expect(result.success).toBe(true);
      expect(result.botInfo?.verified_name).toBe("Test Business");
      expect(result.botInfo?.quality_rating).toBe("GREEN");
    });
  });
});
