import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeHmacSha256,
  verifyHmacSignature,
  verifyTimestamp,
  verifyTelegramWebhook,
  verifyWhatsAppWebhook,
  verifyMaxWebhook,
} from "../middleware/webhook-security";

describe("Webhook Security", () => {
  describe("computeHmacSha256", () => {
    it("computes correct HMAC-SHA256", () => {
      const payload = '{"test":"data"}';
      const secret = "test-secret";
      const result = computeHmacSha256(payload, secret);
      
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[a-f0-9]+$/);
    });

    it("produces different hashes for different secrets", () => {
      const payload = '{"test":"data"}';
      const hash1 = computeHmacSha256(payload, "secret1");
      const hash2 = computeHmacSha256(payload, "secret2");
      
      expect(hash1).not.toBe(hash2);
    });

    it("produces different hashes for different payloads", () => {
      const secret = "test-secret";
      const hash1 = computeHmacSha256('{"a":1}', secret);
      const hash2 = computeHmacSha256('{"a":2}', secret);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("verifyHmacSignature", () => {
    it("returns true for matching signatures", () => {
      const sig = "abc123def456";
      expect(verifyHmacSignature(sig, sig)).toBe(true);
    });

    it("returns false for different signatures", () => {
      expect(verifyHmacSignature("abc123", "xyz789")).toBe(false);
    });

    it("returns false for different length signatures", () => {
      expect(verifyHmacSignature("short", "much-longer-signature")).toBe(false);
    });
  });

  describe("verifyTimestamp", () => {
    it("accepts timestamp within tolerance", () => {
      const now = Math.floor(Date.now() / 1000);
      const result = verifyTimestamp(now, 300);
      
      expect(result.valid).toBe(true);
    });

    it("accepts timestamp 1 minute ago", () => {
      const oneMinuteAgo = Math.floor(Date.now() / 1000) - 60;
      const result = verifyTimestamp(oneMinuteAgo, 300);
      
      expect(result.valid).toBe(true);
    });

    it("rejects timestamp outside tolerance", () => {
      const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
      const result = verifyTimestamp(tenMinutesAgo, 300);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Timestamp outside tolerance");
    });

    it("rejects future timestamp outside tolerance", () => {
      const tenMinutesLater = Math.floor(Date.now() / 1000) + 600;
      const result = verifyTimestamp(tenMinutesLater, 300);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Timestamp outside tolerance");
    });
  });

  describe("verifyTelegramWebhook", () => {
    it("returns valid when no secret configured", () => {
      const headers = {};
      const body = { update_id: 123 };
      
      const result = verifyTelegramWebhook(headers, body, undefined);
      
      expect(result.valid).toBe(true);
    });

    it("returns invalid when secret required but missing header", () => {
      const headers = {};
      const body = { update_id: 123 };
      const secret = "my-secret";
      
      const result = verifyTelegramWebhook(headers, body, secret);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing secret header");
    });

    it("returns invalid for wrong secret", () => {
      const headers = { "x-telegram-bot-api-secret-token": "wrong-secret" };
      const body = { update_id: 123 };
      const secret = "correct-secret";
      
      const result = verifyTelegramWebhook(headers, body, secret);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid secret");
    });

    it("returns valid for correct secret", () => {
      const secret = "my-telegram-secret";
      const headers = { "x-telegram-bot-api-secret-token": secret };
      const body = { update_id: 123 };
      
      const result = verifyTelegramWebhook(headers, body, secret);
      
      expect(result.valid).toBe(true);
    });

    it("checks timestamp when provided", () => {
      const secret = "my-secret";
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      const headers = {
        "x-telegram-bot-api-secret-token": secret,
        "x-telegram-timestamp": String(oldTimestamp),
      };
      const body = { update_id: 123 };
      
      const result = verifyTelegramWebhook(headers, body, secret, { timestampTolerance: 300 });
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Timestamp outside tolerance");
    });
  });

  describe("verifyWhatsAppWebhook", () => {
    it("returns invalid when signature header missing", () => {
      const headers = {};
      const body = { entry: [] };
      
      const result = verifyWhatsAppWebhook(headers, body, "secret");
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing X-Hub-Signature-256 header");
    });

    it("returns valid when no secret configured but signature present", () => {
      const headers = { "x-hub-signature-256": "sha256=abc123" };
      const body = { entry: [] };
      
      const result = verifyWhatsAppWebhook(headers, body, undefined);
      
      expect(result.valid).toBe(true);
    });

    it("returns invalid for wrong signature", () => {
      const headers = { "x-hub-signature-256": "sha256=wrong" };
      const body = { entry: [] };
      const secret = "my-secret";
      
      const result = verifyWhatsAppWebhook(headers, body, secret);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid signature");
    });

    it("returns valid for correct HMAC signature", () => {
      const secret = "whatsapp-app-secret";
      const body = { entry: [{ id: "123" }] };
      const bodyString = JSON.stringify(body);
      const signature = "sha256=" + computeHmacSha256(bodyString, secret);
      const headers = { "x-hub-signature-256": signature };
      
      const result = verifyWhatsAppWebhook(headers, body, secret);
      
      expect(result.valid).toBe(true);
    });

    it("checks timestamp when provided", () => {
      const secret = "whatsapp-secret";
      const body = { entry: [] };
      const bodyString = JSON.stringify(body);
      const signature = "sha256=" + computeHmacSha256(bodyString, secret);
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      
      const headers = {
        "x-hub-signature-256": signature,
        "x-hub-timestamp": String(oldTimestamp),
      };
      
      const result = verifyWhatsAppWebhook(headers, body, secret, { timestampTolerance: 300 });
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Timestamp outside tolerance");
    });
  });

  describe("verifyMaxWebhook", () => {
    it("returns valid when no secret configured", () => {
      const headers = {};
      const body = { event: "message" };
      
      const result = verifyMaxWebhook(headers, body, undefined);
      
      expect(result.valid).toBe(true);
    });

    it("returns invalid when secret required but missing header", () => {
      const headers = {};
      const body = { event: "message" };
      const secret = "max-secret";
      
      const result = verifyMaxWebhook(headers, body, secret);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Missing secret header");
    });

    it("returns invalid for wrong secret (simple mode)", () => {
      const headers = { "x-max-bot-api-secret": "wrong" };
      const body = { event: "message" };
      const secret = "correct-secret";
      
      const result = verifyMaxWebhook(headers, body, secret);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid secret");
    });

    it("returns valid for correct secret (simple mode)", () => {
      const secret = "max-secret";
      const headers = { "x-max-bot-api-secret": secret };
      const body = { event: "message" };
      
      const result = verifyMaxWebhook(headers, body, secret);
      
      expect(result.valid).toBe(true);
    });

    it("validates HMAC signature when x-max-signature provided", () => {
      const secret = "max-secret";
      const body = { event: "message" };
      const bodyString = JSON.stringify(body);
      const signature = computeHmacSha256(bodyString, secret);
      
      const headers = {
        "x-max-bot-api-secret": secret,
        "x-max-signature": signature,
      };
      
      const result = verifyMaxWebhook(headers, body, secret);
      
      expect(result.valid).toBe(true);
    });

    it("rejects invalid HMAC signature", () => {
      const secret = "max-secret";
      const headers = {
        "x-max-bot-api-secret": secret,
        "x-max-signature": "invalid-hmac",
      };
      const body = { event: "message" };
      
      const result = verifyMaxWebhook(headers, body, secret);
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid HMAC signature");
    });

    it("checks timestamp when provided", () => {
      const secret = "max-secret";
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      const headers = {
        "x-max-bot-api-secret": secret,
        "x-max-timestamp": String(oldTimestamp),
      };
      const body = { event: "message" };
      
      const result = verifyMaxWebhook(headers, body, secret, { timestampTolerance: 300 });
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Timestamp outside tolerance");
    });
  });

  describe("anti-replay protection", () => {
    it("accepts recent timestamp", () => {
      const secret = "test-secret";
      const recentTimestamp = Math.floor(Date.now() / 1000) - 30;
      const headers = {
        "x-telegram-bot-api-secret-token": secret,
        "x-telegram-timestamp": String(recentTimestamp),
      };
      const body = { update_id: 1 };
      
      const result = verifyTelegramWebhook(headers, body, secret);
      
      expect(result.valid).toBe(true);
    });

    it("rejects replay attack with old timestamp", () => {
      const secret = "test-secret";
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400;
      const headers = {
        "x-telegram-bot-api-secret-token": secret,
        "x-telegram-timestamp": String(oldTimestamp),
      };
      const body = { update_id: 1 };
      
      const result = verifyTelegramWebhook(headers, body, secret, { timestampTolerance: 300 });
      
      expect(result.valid).toBe(false);
    });
  });
});
