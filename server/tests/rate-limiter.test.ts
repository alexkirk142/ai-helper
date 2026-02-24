import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { Express } from "express";
import request from "supertest";
import {
  createRateLimiter,
  createTenantRateLimiter,
  setTenantRateLimits,
  getTenantRateLimits,
  clearRateLimits,
  apiRateLimiter,
  aiRateLimiter,
  webhookRateLimiter,
  onboardingRateLimiter,
} from "../middleware/rate-limiter";

describe("Rate Limiter", () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    clearRateLimits();
  });

  afterEach(() => {
    clearRateLimits();
  });

  describe("createRateLimiter", () => {
    it("allows requests within limit", async () => {
      const limiter = createRateLimiter({ maxRequests: 3, category: "public" });
      app.get("/test", limiter, (req, res) => res.json({ ok: true }));

      const res1 = await request(app).get("/test");
      const res2 = await request(app).get("/test");
      const res3 = await request(app).get("/test");

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);
    });

    it("returns 429 when limit exceeded", async () => {
      const limiter = createRateLimiter({ 
        maxRequests: 2, 
        category: "public",
        enableAudit: false,
      });
      app.get("/test", limiter, (req, res) => res.json({ ok: true }));

      await request(app).get("/test");
      await request(app).get("/test");
      const res3 = await request(app).get("/test");

      expect(res3.status).toBe(429);
      expect(res3.body.error).toBe("Too many requests");
      expect(res3.body.retryAfter).toBeGreaterThan(0);
      expect(res3.body.category).toBe("public");
    });

    it("sets Retry-After header on 429", async () => {
      const limiter = createRateLimiter({ 
        maxRequests: 1, 
        category: "ai",
        enableAudit: false,
      });
      app.get("/test", limiter, (req, res) => res.json({ ok: true }));

      await request(app).get("/test");
      const res2 = await request(app).get("/test");

      expect(res2.status).toBe(429);
      expect(res2.headers["retry-after"]).toBeDefined();
      expect(parseInt(res2.headers["retry-after"])).toBeGreaterThan(0);
    });

    it("sets rate limit headers", async () => {
      const limiter = createRateLimiter({ 
        maxRequests: 10, 
        category: "webhook",
        enableAudit: false,
      });
      app.get("/test", limiter, (req, res) => res.json({ ok: true }));

      const res = await request(app).get("/test");

      expect(res.headers["x-ratelimit-limit"]).toBe("10");
      expect(res.headers["x-ratelimit-remaining"]).toBe("9");
      expect(res.headers["x-ratelimit-reset"]).toBeDefined();
      expect(res.headers["x-ratelimit-category"]).toBe("webhook");
    });

    it("uses different limits for different categories", async () => {
      const publicLimiter = createRateLimiter({ 
        maxRequests: 2, 
        category: "public",
        enableAudit: false,
      });
      const aiLimiter = createRateLimiter({ 
        maxRequests: 1, 
        category: "ai",
        enableAudit: false,
      });

      app.get("/public", publicLimiter, (req, res) => res.json({ type: "public" }));
      app.get("/ai", aiLimiter, (req, res) => res.json({ type: "ai" }));

      const p1 = await request(app).get("/public");
      const p2 = await request(app).get("/public");
      const p3 = await request(app).get("/public");

      const a1 = await request(app).get("/ai");
      const a2 = await request(app).get("/ai");

      expect(p1.status).toBe(200);
      expect(p2.status).toBe(200);
      expect(p3.status).toBe(429);

      expect(a1.status).toBe(200);
      expect(a2.status).toBe(429);
    });
  });

  describe("Per-tenant rate limiting", () => {
    it("enforces tenant-specific limits", async () => {
      setTenantRateLimits("tenant-1", { maxConversationsPerMin: 2 });
      
      const tenantLimiter = createTenantRateLimiter("conversation");
      app.post("/conversation", (req, res, next) => {
        req.tenantId = "tenant-1";
        req.userId = "user-1";
        next();
      }, tenantLimiter, (req, res) => res.json({ ok: true }));

      const r1 = await request(app).post("/conversation");
      const r2 = await request(app).post("/conversation");
      const r3 = await request(app).post("/conversation");

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(429);
      expect(r3.body.error).toBe("Tenant rate limit exceeded");
      expect(r3.body.limitType).toBe("conversation");
    });

    it("isolates limits between tenants", async () => {
      setTenantRateLimits("tenant-a", { maxAiCallsPerMin: 2 });
      setTenantRateLimits("tenant-b", { maxAiCallsPerMin: 2 });

      const tenantLimiter = createTenantRateLimiter("ai");
      
      app.post("/ai-a", (req, res, next) => {
        req.tenantId = "tenant-a";
        next();
      }, tenantLimiter, (req, res) => res.json({ tenant: "a" }));

      app.post("/ai-b", (req, res, next) => {
        req.tenantId = "tenant-b";
        next();
      }, tenantLimiter, (req, res) => res.json({ tenant: "b" }));

      await request(app).post("/ai-a");
      await request(app).post("/ai-a");
      const a3 = await request(app).post("/ai-a");

      const b1 = await request(app).post("/ai-b");
      const b2 = await request(app).post("/ai-b");

      expect(a3.status).toBe(429);
      expect(b1.status).toBe(200);
      expect(b2.status).toBe(200);
    });

    it("uses default limits when tenant config not set", async () => {
      const config = getTenantRateLimits("unknown-tenant");
      
      expect(config.maxConversationsPerMin).toBe(50);
      expect(config.maxAiCallsPerMin).toBe(30);
    });

    it("passes through when no tenantId", async () => {
      const tenantLimiter = createTenantRateLimiter("conversation");
      app.post("/test", tenantLimiter, (req, res) => res.json({ ok: true }));

      const res = await request(app).post("/test");
      expect(res.status).toBe(200);
    });

    it("sets tenant rate limit headers", async () => {
      setTenantRateLimits("tenant-x", { maxConversationsPerMin: 10 });
      
      const tenantLimiter = createTenantRateLimiter("conversation");
      app.post("/test", (req, res, next) => {
        req.tenantId = "tenant-x";
        next();
      }, tenantLimiter, (req, res) => res.json({ ok: true }));

      const res = await request(app).post("/test");

      expect(res.headers["x-tenant-ratelimit-limit"]).toBe("10");
      expect(res.headers["x-tenant-ratelimit-remaining"]).toBe("9");
      expect(res.headers["x-tenant-ratelimit-reset"]).toBeDefined();
    });
  });

  describe("Pre-configured limiters", () => {
    it("apiRateLimiter uses public category", async () => {
      app.get("/api/test", apiRateLimiter, (req, res) => res.json({ ok: true }));
      
      const res = await request(app).get("/api/test");
      expect(res.headers["x-ratelimit-category"]).toBe("public");
    });

    it("aiRateLimiter uses ai category", async () => {
      app.get("/ai/test", aiRateLimiter, (req, res) => res.json({ ok: true }));
      
      const res = await request(app).get("/ai/test");
      expect(res.headers["x-ratelimit-category"]).toBe("ai");
    });

    it("webhookRateLimiter uses webhook category", async () => {
      app.post("/webhook/test", webhookRateLimiter, (req, res) => res.json({ ok: true }));
      
      const res = await request(app).post("/webhook/test");
      expect(res.headers["x-ratelimit-category"]).toBe("webhook");
    });

    it("onboardingRateLimiter uses onboarding category", async () => {
      app.post("/onboard", onboardingRateLimiter, (req, res) => res.json({ ok: true }));
      
      const res = await request(app).post("/onboard");
      expect(res.headers["x-ratelimit-category"]).toBe("onboarding");
    });
  });

  describe("clearRateLimits", () => {
    it("resets all limits", async () => {
      const limiter = createRateLimiter({ 
        maxRequests: 1, 
        category: "public",
        enableAudit: false,
      });
      app.get("/test", limiter, (req, res) => res.json({ ok: true }));

      await request(app).get("/test");
      const r2 = await request(app).get("/test");
      expect(r2.status).toBe(429);

      clearRateLimits();

      const r3 = await request(app).get("/test");
      expect(r3.status).toBe(200);
    });
  });
});
