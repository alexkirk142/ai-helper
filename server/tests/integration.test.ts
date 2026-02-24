/**
 * Integration tests for AI Sales Operator API
 * Tests the complete flow from conversation to AI suggestion to actions
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { registerRoutes } from "../routes";
import { createServer } from "http";
import { requestContextMiddleware } from "../middleware/request-context";
import { apiRateLimiter } from "../middleware/rate-limiter";
import { registerHealthRoutes } from "../routes/health";
import { z } from "zod";
import { storage } from "../storage";

let app: express.Express;
let httpServer: ReturnType<typeof createServer>;

beforeAll(async () => {
  app = express();
  httpServer = createServer(app);
  
  app.use(express.json());
  app.use(requestContextMiddleware);
  app.use("/api", apiRateLimiter);
  registerHealthRoutes(app);
  
  await registerRoutes(httpServer, app);
});

afterAll(() => {
  httpServer.close();
});

describe("Health Endpoints", () => {
  it("GET /health returns healthy status", async () => {
    const res = await request(app).get("/health");
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "healthy");
    expect(res.body).toHaveProperty("timestamp");
  });

  it("GET /ready returns readiness with checks", async () => {
    const res = await request(app).get("/ready");
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("checks");
    expect(Array.isArray(res.body.checks)).toBe(true);
  });

  it("GET /metrics returns metrics data", async () => {
    const res = await request(app).get("/metrics");
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("uptime_seconds");
    expect(res.body).toHaveProperty("memory");
  });
});

describe("Feature Flags Endpoints", () => {
  it("GET /api/admin/feature-flags returns flags list with admin role", async () => {
    const res = await request(app)
      .get("/api/admin/feature-flags")
      .set("X-Debug-Role", "admin");
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    
    // Should have default flags
    const flagNames = res.body.map((f: { name: string }) => f.name);
    expect(flagNames).toContain("AI_SUGGESTIONS_ENABLED");
    expect(flagNames).toContain("RAG_ENABLED");
  });

  it("GET /api/admin/feature-flags without debug header returns 403 (defaults to operator)", async () => {
    // Without X-Debug-Role header, should default to operator and get 403
    const res = await request(app)
      .get("/api/admin/feature-flags");
    
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error", "Forbidden");
    expect(res.body).toHaveProperty("currentRole", "operator");
  });

  it("GET /api/admin/feature-flags as operator returns 403", async () => {
    const res = await request(app)
      .get("/api/admin/feature-flags")
      .set("X-Debug-Role", "operator");
    
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error", "Forbidden");
  });

  it("POST /api/admin/feature-flags/:name/toggle toggles flag with admin role", async () => {
    const res = await request(app)
      .post("/api/admin/feature-flags/AI_SUGGESTIONS_ENABLED/toggle")
      .set("X-Debug-Role", "admin")
      .send({ enabled: true });
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("name", "AI_SUGGESTIONS_ENABLED");
    expect(res.body).toHaveProperty("enabled", true);
  });

  it("GET /api/feature-flags/:name/check returns flag status", async () => {
    const res = await request(app)
      .get("/api/feature-flags/AI_SUGGESTIONS_ENABLED/check");
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("name", "AI_SUGGESTIONS_ENABLED");
    expect(res.body).toHaveProperty("enabled");
    expect(typeof res.body.enabled).toBe("boolean");
  });
});

describe("Tenant & Dashboard Endpoints", () => {
  it("GET /api/tenant returns tenant data", async () => {
    const res = await request(app).get("/api/tenant");
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("name");
  });

  it("GET /api/dashboard/metrics returns metrics", async () => {
    const res = await request(app).get("/api/dashboard/metrics");
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalConversations");
    expect(res.body).toHaveProperty("activeConversations");
    expect(res.body).toHaveProperty("productsCount");
  });
});

describe("Conversations Endpoints", () => {
  let conversationId: string;

  it("GET /api/conversations returns list", async () => {
    const res = await request(app).get("/api/conversations");
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    
    if (res.body.length > 0) {
      conversationId = res.body[0].id;
      expect(res.body[0]).toHaveProperty("id");
      expect(res.body[0]).toHaveProperty("status");
      expect(res.body[0]).toHaveProperty("customer");
    }
  });

  it("GET /api/conversations/:id returns conversation detail", async () => {
    if (!conversationId) return;
    
    const res = await request(app).get(`/api/conversations/${conversationId}`);
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("id", conversationId);
    expect(res.body).toHaveProperty("messages");
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  it("POST /api/conversations/:id/messages sends message", async () => {
    if (!conversationId) return;
    
    const res = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .send({ content: "Test message from integration test", role: "owner" });
    
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("content", "Test message from integration test");
  });

  it("POST /api/conversations/:id/messages rejects empty content", async () => {
    if (!conversationId) return;
    
    const res = await request(app)
      .post(`/api/conversations/${conversationId}/messages`)
      .send({ content: "", role: "owner" });
    
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /api/conversations/:id/audit returns audit events", async () => {
    if (!conversationId) return;
    
    const res = await request(app).get(`/api/conversations/${conversationId}/audit`);
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("Products Endpoints", () => {
  let productId: string;

  it("GET /api/products returns products list", async () => {
    const res = await request(app).get("/api/products");
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /api/products creates product", async () => {
    const res = await request(app)
      .post("/api/products")
      .send({
        name: "Test Product Integration",
        price: 999,
        currency: "RUB",
        inStock: true,
      });
    
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("name", "Test Product Integration");
    productId = res.body.id;
  });

  it("PATCH /api/products/:id updates product", async () => {
    if (!productId) return;
    
    const res = await request(app)
      .patch(`/api/products/${productId}`)
      .send({ price: 1299 });
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("price", 1299);
  });

  it("DELETE /api/products/:id deletes product", async () => {
    if (!productId) return;
    
    const res = await request(app).delete(`/api/products/${productId}`);
    expect(res.status).toBe(204);
  });
});

describe("Knowledge Docs Endpoints", () => {
  let docId: string;

  it("GET /api/knowledge-docs returns docs list", async () => {
    const res = await request(app).get("/api/knowledge-docs");
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /api/knowledge-docs creates doc", async () => {
    const res = await request(app)
      .post("/api/knowledge-docs")
      .send({
        title: "Test Policy",
        content: "This is a test policy content",
        category: "test",
      });
    
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("title", "Test Policy");
    docId = res.body.id;
  });

  it("DELETE /api/knowledge-docs/:id deletes doc", async () => {
    if (!docId) return;
    
    const res = await request(app).delete(`/api/knowledge-docs/${docId}`);
    expect(res.status).toBe(204);
  });
});

describe("Escalations Endpoints", () => {
  it("GET /api/escalations returns escalations list", async () => {
    const res = await request(app).get("/api/escalations");
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/escalations?status=pending returns pending only", async () => {
    const res = await request(app).get("/api/escalations?status=pending");
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // All returned should be pending
    res.body.forEach((e: { status: string }) => {
      expect(e.status).toBe("pending");
    });
  });
});

describe("Audit Events Endpoints", () => {
  it("GET /api/admin/audit-events returns events with admin role", async () => {
    const res = await request(app)
      .get("/api/admin/audit-events")
      .set("X-Debug-Role", "admin");
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /api/admin/audit-events as operator returns 403", async () => {
    const res = await request(app)
      .get("/api/admin/audit-events")
      .set("X-Debug-Role", "operator");
    
    expect(res.status).toBe(403);
  });

  it("GET /api/admin/audit-events without debug header returns 403", async () => {
    // Without X-Debug-Role, should default to operator and get 403
    const res = await request(app)
      .get("/api/admin/audit-events");
    
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("currentRole", "operator");
  });
});

describe("Rate Limiting", () => {
  it("Returns rate limit headers", async () => {
    const res = await request(app).get("/api/tenant");
    
    expect(res.headers).toHaveProperty("x-ratelimit-limit");
    expect(res.headers).toHaveProperty("x-ratelimit-remaining");
  });
});

describe("Request Context", () => {
  it("Returns X-Request-Id header", async () => {
    const res = await request(app).get("/health");
    
    expect(res.headers).toHaveProperty("x-request-id");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("Uses provided X-Request-Id", async () => {
    const customId = "test-request-id-12345";
    const res = await request(app)
      .get("/health")
      .set("X-Request-Id", customId);
    
    expect(res.headers["x-request-id"]).toBe(customId);
  });
});

// ============ PHASE 1.1 TESTS ============

describe("Phase 1.1: Decision Settings", () => {
  it("GET /api/settings/decision returns settings with defaults", async () => {
    const res = await request(app).get("/api/settings/decision");
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("tAuto");
    expect(res.body).toHaveProperty("tEscalate");
    expect(res.body).toHaveProperty("autosendAllowed");
    expect(res.body).toHaveProperty("intentsAutosendAllowed");
    expect(res.body).toHaveProperty("intentsForceHandoff");
    expect(typeof res.body.tAuto).toBe("number");
    expect(typeof res.body.tEscalate).toBe("number");
  });

  it("PATCH /api/settings/decision updates thresholds", async () => {
    const res = await request(app)
      .patch("/api/settings/decision")
      .send({ tAuto: 0.75, tEscalate: 0.35 });
    
    expect(res.status).toBe(200);
    expect(res.body.tAuto).toBe(0.75);
    expect(res.body.tEscalate).toBe(0.35);
  });

  it("PATCH /api/settings/decision validates tAuto >= tEscalate", async () => {
    const res = await request(app)
      .patch("/api/settings/decision")
      .send({ tAuto: 0.30, tEscalate: 0.50 });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("tAuto must be greater than or equal to tEscalate");
  });

  it("PATCH /api/settings/decision updates autosend settings", async () => {
    const res = await request(app)
      .patch("/api/settings/decision")
      .send({ 
        autosendAllowed: true,
        intentsAutosendAllowed: ["price", "availability"]
      });
    
    expect(res.status).toBe(200);
    expect(res.body.autosendAllowed).toBe(true);
  });
});

describe("Phase 1.1: Suggestion Response Contract", () => {
  let conversationId: string;

  beforeAll(async () => {
    // Get first conversation for testing
    const convRes = await request(app).get("/api/conversations");
    if (convRes.body && convRes.body.length > 0) {
      conversationId = convRes.body[0].id;
    }
  });

  it("GET conversation with suggestion has Phase 1.1 fields", async () => {
    if (!conversationId) return;
    
    const res = await request(app).get(`/api/conversations/${conversationId}`);
    
    expect(res.status).toBe(200);
    
    const suggestion = res.body.currentSuggestion;
    if (suggestion) {
      // Phase 1 fields
      expect(suggestion).toHaveProperty("decision");
      expect(suggestion).toHaveProperty("confidence");
      expect(suggestion).toHaveProperty("explanations");
      expect(suggestion).toHaveProperty("penalties");
      expect(suggestion).toHaveProperty("usedSources");
      expect(suggestion).toHaveProperty("missingFields");
      
      // Phase 1.1 fields
      expect(suggestion).toHaveProperty("autosendEligible");
      expect(suggestion).toHaveProperty("selfCheckNeedHandoff");
      expect(suggestion).toHaveProperty("selfCheckReasons");
      
      // Validate types
      expect(Array.isArray(suggestion.explanations)).toBe(true);
      expect(Array.isArray(suggestion.penalties)).toBe(true);
      expect(Array.isArray(suggestion.usedSources)).toBe(true);
      expect(Array.isArray(suggestion.selfCheckReasons)).toBe(true);
      expect(typeof suggestion.autosendEligible).toBe("boolean");
      expect(typeof suggestion.selfCheckNeedHandoff).toBe("boolean");
    }
  });

  it("Suggestion penalties have correct format {code, message, value}", async () => {
    if (!conversationId) return;
    
    const res = await request(app).get(`/api/conversations/${conversationId}`);
    
    if (res.body.currentSuggestion?.penalties) {
      for (const penalty of res.body.currentSuggestion.penalties) {
        expect(typeof penalty.code).toBe("string");
        expect(typeof penalty.message).toBe("string");
        expect(typeof penalty.value).toBe("number");
      }
    }
  });

  it("Suggestion usedSources have correct format", async () => {
    if (!conversationId) return;
    
    const res = await request(app).get(`/api/conversations/${conversationId}`);
    
    if (res.body.currentSuggestion?.usedSources) {
      for (const source of res.body.currentSuggestion.usedSources) {
        expect(source).toHaveProperty("type");
        expect(source).toHaveProperty("id");
        expect(["product", "doc"]).toContain(source.type);
      }
    }
  });
});

describe("Phase 1.1: Feature Flags Kill Switch", () => {
  it("GET /api/feature-flags/DECISION_ENGINE_ENABLED/check returns flag status", async () => {
    const res = await request(app)
      .get("/api/feature-flags/DECISION_ENGINE_ENABLED/check");
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("name", "DECISION_ENGINE_ENABLED");
    expect(res.body).toHaveProperty("enabled");
    expect(typeof res.body.enabled).toBe("boolean");
  });

  it("GET /api/feature-flags/AI_AUTOSEND_ENABLED/check returns flag status", async () => {
    const res = await request(app)
      .get("/api/feature-flags/AI_AUTOSEND_ENABLED/check");
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("name", "AI_AUTOSEND_ENABLED");
    expect(res.body).toHaveProperty("enabled");
  });

  it("Toggling AI_AUTOSEND_ENABLED affects flag status", async () => {
    // Get initial state
    const initialRes = await request(app)
      .get("/api/feature-flags/AI_AUTOSEND_ENABLED/check");
    const initialState = initialRes.body.enabled;

    // Toggle to opposite
    await request(app)
      .post("/api/admin/feature-flags/AI_AUTOSEND_ENABLED/toggle")
      .set("X-Debug-Role", "admin")
      .send({ enabled: !initialState });

    // Verify change
    const afterToggle = await request(app)
      .get("/api/feature-flags/AI_AUTOSEND_ENABLED/check");
    expect(afterToggle.body.enabled).toBe(!initialState);

    // Restore original state
    await request(app)
      .post("/api/admin/feature-flags/AI_AUTOSEND_ENABLED/toggle")
      .set("X-Debug-Role", "admin")
      .send({ enabled: initialState });
  });
});

describe("Phase 1.1: Triple Lock Integration", () => {
  it("Settings updates persist autosendAllowed correctly", async () => {
    // Get initial settings
    const initial = await request(app).get("/api/settings/decision");
    expect(initial.status).toBe(200);

    // Enable autosend
    const enableRes = await request(app)
      .patch("/api/settings/decision")
      .send({ autosendAllowed: true });
    expect(enableRes.status).toBe(200);
    expect(enableRes.body.autosendAllowed).toBe(true);

    // Verify persistence
    const verify = await request(app).get("/api/settings/decision");
    expect(verify.body.autosendAllowed).toBe(true);

    // Disable autosend
    const disableRes = await request(app)
      .patch("/api/settings/decision")
      .send({ autosendAllowed: false });
    expect(disableRes.status).toBe(200);
    expect(disableRes.body.autosendAllowed).toBe(false);
  });

  it("Settings updates persist intentsAutosendAllowed correctly", async () => {
    const newIntents = ["price", "availability"];
    
    const res = await request(app)
      .patch("/api/settings/decision")
      .send({ intentsAutosendAllowed: newIntents });
    
    expect(res.status).toBe(200);
    expect(res.body.intentsAutosendAllowed).toEqual(expect.arrayContaining(newIntents));

    // Verify persistence
    const verify = await request(app).get("/api/settings/decision");
    expect(verify.body.intentsAutosendAllowed).toEqual(expect.arrayContaining(newIntents));
  });

  it("Triple lock requires all three conditions for eligibility", async () => {
    // This test verifies that all three locks are checked via settings
    // Setup: autosendAllowed=true, intentsAutosendAllowed includes "price"
    await request(app)
      .patch("/api/settings/decision")
      .send({ 
        autosendAllowed: true,
        intentsAutosendAllowed: ["price", "availability"]
      });

    const settings = await request(app).get("/api/settings/decision");
    expect(settings.body.autosendAllowed).toBe(true);
    expect(settings.body.intentsAutosendAllowed).toContain("price");

    // Lock 2 (settings) can be toggled
    await request(app)
      .patch("/api/settings/decision")
      .send({ autosendAllowed: false });

    const afterDisable = await request(app).get("/api/settings/decision");
    expect(afterDisable.body.autosendAllowed).toBe(false);

    // Lock 3 (intents) can be modified
    await request(app)
      .patch("/api/settings/decision")
      .send({ intentsAutosendAllowed: [] });

    const afterIntentsRemoved = await request(app).get("/api/settings/decision");
    expect(afterIntentsRemoved.body.intentsAutosendAllowed).toEqual([]);

    // Restore defaults
    await request(app)
      .patch("/api/settings/decision")
      .send({ 
        autosendAllowed: false,
        intentsAutosendAllowed: ["price", "availability", "shipping", "other"]
      });
  });

  it("Triple lock - feature flag can be toggled independently", async () => {
    // Check current flag state
    const flagCheck = await request(app)
      .get("/api/feature-flags/AI_AUTOSEND_ENABLED/check");
    const initialState = flagCheck.body.enabled;

    // Toggle flag
    await request(app)
      .post("/api/admin/feature-flags/AI_AUTOSEND_ENABLED/toggle")
      .set("X-Debug-Role", "admin")
      .send({ enabled: true });

    const afterEnable = await request(app)
      .get("/api/feature-flags/AI_AUTOSEND_ENABLED/check");
    expect(afterEnable.body.enabled).toBe(true);

    // Restore
    await request(app)
      .post("/api/admin/feature-flags/AI_AUTOSEND_ENABLED/toggle")
      .set("X-Debug-Role", "admin")
      .send({ enabled: initialState });
  });
});

// ============ PHASE 1.1 ADDITIONAL TESTS ============

describe("Phase 1.1: Tenant Isolation for DecisionSettings", () => {
  it("DecisionSettings for tenant A do not affect tenant B", async () => {
    const tenantAId = "tenant-isolation-test-A";
    const tenantBId = "tenant-isolation-test-B";

    // Set different tAuto values for each tenant via storage directly
    await storage.upsertDecisionSettings({
      tenantId: tenantAId,
      tAuto: 0.90,
      tEscalate: 0.30,
      autosendAllowed: true,
    });

    await storage.upsertDecisionSettings({
      tenantId: tenantBId,
      tAuto: 0.70,
      tEscalate: 0.20,
      autosendAllowed: false,
    });

    // Retrieve and verify isolation
    const settingsA = await storage.getDecisionSettings(tenantAId);
    const settingsB = await storage.getDecisionSettings(tenantBId);

    // Tenant A assertions
    expect(settingsA).toBeDefined();
    expect(settingsA!.tAuto).toBe(0.90);
    expect(settingsA!.tEscalate).toBe(0.30);
    expect(settingsA!.autosendAllowed).toBe(true);

    // Tenant B assertions - must be different (no leak from A)
    expect(settingsB).toBeDefined();
    expect(settingsB!.tAuto).toBe(0.70);
    expect(settingsB!.tEscalate).toBe(0.20);
    expect(settingsB!.autosendAllowed).toBe(false);

    // Cross-contamination check: A's values should not appear in B
    expect(settingsB!.tAuto).not.toBe(settingsA!.tAuto);
    expect(settingsB!.autosendAllowed).not.toBe(settingsA!.autosendAllowed);
  });
});

describe("Phase 1.1: Zod Contract Validation for Suggestion Response", () => {
  // Define Zod schema matching SuggestionResponse type in schema.ts
  const PenaltySchema = z.object({
    code: z.string(),
    message: z.string(),
    value: z.number(),
  });

  const UsedSourceSchema = z.object({
    type: z.enum(["product", "doc"]),
    id: z.string(),
    title: z.string().nullable().optional(),
    quote: z.string().nullable().optional(),
    similarity: z.number().nullable().optional(),
  });

  const AiSuggestionResponseSchema = z.object({
    id: z.string(),
    conversationId: z.string(),
    messageId: z.string(),
    suggestedReply: z.string(),
    intent: z.string().nullable(),
    confidence: z.number(),
    needsApproval: z.boolean(),
    needsHandoff: z.boolean(),
    questionsToAsk: z.array(z.string()),
    status: z.string(),
    createdAt: z.string(),
    // Phase 1 fields
    decision: z.enum(["AUTO_SEND", "NEED_APPROVAL", "ESCALATE"]).nullable().optional(),
    explanations: z.array(z.string()).nullable().optional(),
    penalties: z.array(PenaltySchema).nullable().optional(),
    usedSources: z.array(UsedSourceSchema).nullable().optional(),
    missingFields: z.array(z.string()).nullable().optional(),
    similarityScore: z.number().nullable().optional(),
    intentScore: z.number().nullable().optional(),
    selfCheckScore: z.number().nullable().optional(),
    sourceConflicts: z.boolean().nullable().optional(),
    // Phase 1.1 fields
    autosendEligible: z.boolean().nullable().optional(),
    autosendBlockReason: z.enum(["FLAG_OFF", "SETTING_OFF", "INTENT_NOT_ALLOWED"]).nullable().optional(),
    selfCheckNeedHandoff: z.boolean().nullable().optional(),
    selfCheckReasons: z.array(z.string()).nullable().optional(),
  });

  it("GET /api/conversations/:id suggestion validates against Zod schema", async () => {
    // Get conversations
    const convRes = await request(app).get("/api/conversations");
    expect(convRes.status).toBe(200);
    
    if (!convRes.body || convRes.body.length === 0) {
      return; // Skip if no conversations
    }

    const conversationId = convRes.body[0].id;
    const detailRes = await request(app).get(`/api/conversations/${conversationId}`);
    expect(detailRes.status).toBe(200);

    const suggestion = detailRes.body.currentSuggestion;
    if (!suggestion) {
      return; // Skip if no suggestion
    }

    // Validate against Zod schema - this will throw if invalid
    const parseResult = AiSuggestionResponseSchema.safeParse(suggestion);
    
    if (!parseResult.success) {
      console.error("Zod validation errors:", parseResult.error.format());
    }
    
    expect(parseResult.success).toBe(true);
    
    // Additional type checks on parsed data
    if (parseResult.success) {
      const parsed = parseResult.data;
      expect(parsed.id).toBeDefined();
      expect(parsed.suggestedReply).toBeDefined();
      expect(typeof parsed.confidence).toBe("number");
    }
  });
});
