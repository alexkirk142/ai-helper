import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { Express } from "express";
import request from "supertest";
import {
  createWebhookSecurityMiddleware,
  telegramWebhookSecurity,
  whatsappWebhookSecurity,
  maxWebhookSecurity,
  computeHmacSha256,
} from "../middleware/webhook-security";

declare module "http" {
  interface IncomingMessage {
    rawBody?: Buffer;
  }
}

describe("Webhook Security Integration", () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as any).rawBody = buf;
        },
      })
    );
  });

  describe("Telegram webhook rejection", () => {
    beforeEach(() => {
      vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-telegram-secret");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("rejects request without secret header", async () => {
      const middleware = createWebhookSecurityMiddleware({ channel: "telegram" });
      app.post("/webhook/telegram", middleware, (req, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .post("/webhook/telegram")
        .send({ update_id: 123, message: { text: "hello" } });

      expect(response.status).toBe(401);
      expect(response.body.ok).toBe(false);
      expect(response.body.error).toBe("Missing secret header");
    });

    it("rejects request with wrong secret", async () => {
      const middleware = createWebhookSecurityMiddleware({ channel: "telegram" });
      app.post("/webhook/telegram", middleware, (req, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .post("/webhook/telegram")
        .set("X-Telegram-Bot-Api-Secret-Token", "wrong-secret")
        .send({ update_id: 123 });

      expect(response.status).toBe(401);
      expect(response.body.ok).toBe(false);
      expect(response.body.error).toBe("Invalid secret");
    });

    it("accepts request with correct secret", async () => {
      const middleware = createWebhookSecurityMiddleware({ channel: "telegram" });
      app.post("/webhook/telegram", middleware, (req, res) => {
        res.json({ ok: true, processed: true });
      });

      const response = await request(app)
        .post("/webhook/telegram")
        .set("X-Telegram-Bot-Api-Secret-Token", "test-telegram-secret")
        .send({ update_id: 123 });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.processed).toBe(true);
    });

    it("rejects replay attack with old timestamp", async () => {
      const middleware = createWebhookSecurityMiddleware({
        channel: "telegram",
        timestampTolerance: 300,
      });
      app.post("/webhook/telegram", middleware, (req, res) => {
        res.json({ ok: true });
      });

      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;

      const response = await request(app)
        .post("/webhook/telegram")
        .set("X-Telegram-Bot-Api-Secret-Token", "test-telegram-secret")
        .set("X-Telegram-Timestamp", String(oldTimestamp))
        .send({ update_id: 123 });

      expect(response.status).toBe(401);
      expect(response.body.error).toContain("Timestamp outside tolerance");
    });
  });

  describe("WhatsApp webhook rejection", () => {
    beforeEach(() => {
      vi.stubEnv("WHATSAPP_APP_SECRET", "whatsapp-test-secret");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("rejects request without signature header", async () => {
      const middleware = createWebhookSecurityMiddleware({ channel: "whatsapp" });
      app.post("/webhook/whatsapp", middleware, (req, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .post("/webhook/whatsapp")
        .send({ object: "whatsapp_business_account", entry: [] });

      expect(response.status).toBe(401);
      expect(response.body.ok).toBe(false);
      expect(response.body.error).toBe("Missing X-Hub-Signature-256 header");
    });

    it("rejects request with invalid signature", async () => {
      const middleware = createWebhookSecurityMiddleware({ channel: "whatsapp" });
      app.post("/webhook/whatsapp", middleware, (req, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .post("/webhook/whatsapp")
        .set("X-Hub-Signature-256", "sha256=invalid")
        .send({ object: "whatsapp_business_account", entry: [] });

      expect(response.status).toBe(401);
      expect(response.body.ok).toBe(false);
      expect(response.body.error).toBe("Invalid signature");
    });

    it("accepts request with valid HMAC signature", async () => {
      const middleware = createWebhookSecurityMiddleware({ channel: "whatsapp" });
      app.post("/webhook/whatsapp", middleware, (req, res) => {
        res.json({ ok: true, verified: true });
      });

      const body = { object: "whatsapp_business_account", entry: [] };
      const bodyString = JSON.stringify(body);
      const signature = "sha256=" + computeHmacSha256(bodyString, "whatsapp-test-secret");

      const response = await request(app)
        .post("/webhook/whatsapp")
        .set("X-Hub-Signature-256", signature)
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.verified).toBe(true);
    });
  });

  describe("MAX webhook rejection", () => {
    beforeEach(() => {
      vi.stubEnv("MAX_WEBHOOK_SECRET", "max-test-secret");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("rejects request without secret header", async () => {
      const middleware = createWebhookSecurityMiddleware({ channel: "max" });
      app.post("/webhook/max", middleware, (req, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .post("/webhook/max")
        .send({ event: "message", payload: {} });

      expect(response.status).toBe(401);
      expect(response.body.ok).toBe(false);
      expect(response.body.error).toBe("Missing secret header");
    });

    it("rejects request with wrong secret", async () => {
      const middleware = createWebhookSecurityMiddleware({ channel: "max" });
      app.post("/webhook/max", middleware, (req, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .post("/webhook/max")
        .set("X-Max-Bot-Api-Secret", "wrong-secret")
        .send({ event: "message" });

      expect(response.status).toBe(401);
      expect(response.body.ok).toBe(false);
      expect(response.body.error).toBe("Invalid secret");
    });

    it("accepts request with correct secret", async () => {
      const middleware = createWebhookSecurityMiddleware({ channel: "max" });
      app.post("/webhook/max", middleware, (req, res) => {
        res.json({ ok: true, processed: true });
      });

      const response = await request(app)
        .post("/webhook/max")
        .set("X-Max-Bot-Api-Secret", "max-test-secret")
        .send({ event: "message" });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.processed).toBe(true);
    });

    it("validates HMAC when x-max-signature provided", async () => {
      const middleware = createWebhookSecurityMiddleware({ channel: "max" });
      app.post("/webhook/max", middleware, (req, res) => {
        res.json({ ok: true });
      });

      const body = { event: "message" };
      const bodyString = JSON.stringify(body);
      const signature = computeHmacSha256(bodyString, "max-test-secret");

      const response = await request(app)
        .post("/webhook/max")
        .set("X-Max-Bot-Api-Secret", "max-test-secret")
        .set("X-Max-Signature", signature)
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });

    it("rejects invalid HMAC signature", async () => {
      const middleware = createWebhookSecurityMiddleware({ channel: "max" });
      app.post("/webhook/max", middleware, (req, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .post("/webhook/max")
        .set("X-Max-Bot-Api-Secret", "max-test-secret")
        .set("X-Max-Signature", "invalid-hmac")
        .send({ event: "message" });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Invalid HMAC signature");
    });
  });

  describe("No secret configured - passthrough mode", () => {
    it("telegram passes through when no secret configured", async () => {
      vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
      
      const middleware = createWebhookSecurityMiddleware({ channel: "telegram" });
      app.post("/webhook/telegram", middleware, (req, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .post("/webhook/telegram")
        .send({ update_id: 123 });

      expect(response.status).toBe(200);
      
      vi.unstubAllEnvs();
    });

    it("max passes through when no secret configured", async () => {
      vi.stubEnv("MAX_WEBHOOK_SECRET", "");
      
      const middleware = createWebhookSecurityMiddleware({ channel: "max" });
      app.post("/webhook/max", middleware, (req, res) => {
        res.json({ ok: true });
      });

      const response = await request(app)
        .post("/webhook/max")
        .send({ event: "message" });

      expect(response.status).toBe(200);
      
      vi.unstubAllEnvs();
    });
  });
});
