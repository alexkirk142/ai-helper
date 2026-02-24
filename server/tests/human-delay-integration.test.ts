import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { createServer } from "http";
import { registerRoutes } from "../routes";
import { storage } from "../storage";

describe("Human Delay Settings API Integration", () => {
  let app: express.Express;
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    server = createServer(app);
    await registerRoutes(server, app);
  });

  afterAll(() => {
    server.close();
  });

  describe("GET /api/settings/human-delay", () => {
    it("should return default settings when none exist", async () => {
      const res = await request(app).get("/api/settings/human-delay");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("tenantId");
      expect(res.body).toHaveProperty("enabled");
      expect(res.body).toHaveProperty("nightMode");
      expect(res.body.nightMode).toBe("DELAY");
    });

    it("should return settings with all expected fields", async () => {
      const res = await request(app).get("/api/settings/human-delay");
      expect(res.status).toBe(200);
      
      expect(res.body).toHaveProperty("delayProfiles");
      expect(res.body).toHaveProperty("nightDelayMultiplier");
      expect(res.body).toHaveProperty("nightAutoReplyText");
      expect(res.body).toHaveProperty("minDelayMs");
      expect(res.body).toHaveProperty("maxDelayMs");
      expect(res.body).toHaveProperty("typingIndicatorEnabled");
    });
  });

  describe("PATCH /api/settings/human-delay", () => {
    it("should update enabled flag", async () => {
      const res = await request(app)
        .patch("/api/settings/human-delay")
        .send({ enabled: true });
      
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
    });

    it("should update night mode", async () => {
      const res = await request(app)
        .patch("/api/settings/human-delay")
        .send({ nightMode: "AUTO_REPLY" });
      
      expect(res.status).toBe(200);
      expect(res.body.nightMode).toBe("AUTO_REPLY");
    });

    it("should reject invalid night mode", async () => {
      const res = await request(app)
        .patch("/api/settings/human-delay")
        .send({ nightMode: "INVALID" });
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid enum value");
    });

    it("should update delay multiplier", async () => {
      const res = await request(app)
        .patch("/api/settings/human-delay")
        .send({ nightDelayMultiplier: 5.0 });
      
      expect(res.status).toBe(200);
      expect(res.body.nightDelayMultiplier).toBe(5.0);
    });

    it("should update min/max delay bounds", async () => {
      const res = await request(app)
        .patch("/api/settings/human-delay")
        .send({ minDelayMs: 5000, maxDelayMs: 60000 });
      
      expect(res.status).toBe(200);
      expect(res.body.minDelayMs).toBe(5000);
      expect(res.body.maxDelayMs).toBe(60000);
    });

    it("should reject negative minDelayMs", async () => {
      const res = await request(app)
        .patch("/api/settings/human-delay")
        .send({ minDelayMs: -1000 });
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("greater than or equal to 0");
    });

    it("should reject minDelayMs > maxDelayMs", async () => {
      const res = await request(app)
        .patch("/api/settings/human-delay")
        .send({ minDelayMs: 100000, maxDelayMs: 50000 });
      
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("minDelayMs must be <= maxDelayMs");
    });

    it("should update auto reply text", async () => {
      const res = await request(app)
        .patch("/api/settings/human-delay")
        .send({ nightAutoReplyText: "New auto reply message" });
      
      expect(res.status).toBe(200);
      expect(res.body.nightAutoReplyText).toBe("New auto reply message");
    });

    it("should update typing indicator flag", async () => {
      const res = await request(app)
        .patch("/api/settings/human-delay")
        .send({ typingIndicatorEnabled: false });
      
      expect(res.status).toBe(200);
      expect(res.body.typingIndicatorEnabled).toBe(false);
    });

    it("should update delay profiles", async () => {
      const customProfiles = {
        SHORT: { baseMin: 1000, baseMax: 2000, typingSpeed: 50, jitter: 300 },
        MEDIUM: { baseMin: 3000, baseMax: 6000, typingSpeed: 40, jitter: 800 },
        LONG: { baseMin: 7000, baseMax: 12000, typingSpeed: 35, jitter: 1500 },
      };

      const res = await request(app)
        .patch("/api/settings/human-delay")
        .send({ delayProfiles: customProfiles });
      
      expect(res.status).toBe(200);
      expect(res.body.delayProfiles).toEqual(customProfiles);
    });
  });
});
