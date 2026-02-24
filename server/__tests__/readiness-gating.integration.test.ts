import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import express, { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import http from "http";
import { MemStorage } from "./helpers/mem-storage";
import * as storageModule from "../storage";

describe("Readiness Gating Integration", () => {
  let app: Express;
  let server: http.Server;
  let tenantId: string;
  let userId: string;
  let mockStorage: MemStorage;

  beforeAll(async () => {
    mockStorage = new MemStorage();
    
    vi.spyOn(storageModule, 'storage', 'get').mockReturnValue(mockStorage as any);
    
    const { registerRoutes } = await import("../routes");

    app = express();
    app.use(express.json());
    app.use(session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: true,
    }));
    
    const tenant = await mockStorage.createTenant({
      name: "Test Store",
      language: "ru",
      tone: "formal",
      addressStyle: "vy",
      currency: "RUB",
      timezone: "Europe/Moscow",
    });
    tenantId = tenant.id;
    
    const user = await mockStorage.createUser({
      username: "admin",
      password: "password",
      tenantId,
      role: "admin",
    });
    userId = user.id;
    
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).userId = userId;
      (req as any).isAuthenticated = () => true;
      next();
    });
    
    server = http.createServer(app);
    await registerRoutes(server, app);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe("PATCH /api/settings/decision autosend gating", () => {
    it("should return 409 when enabling autosend with low readiness score", async () => {
      const response = await request(app)
        .patch("/api/settings/decision")
        .send({ autosendAllowed: true });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe("Readiness score too low");
      expect(response.body.score).toBeDefined();
      expect(response.body.score).toBeLessThan(80);
      expect(response.body.threshold).toBe(80);
      expect(response.body.recommendations).toBeDefined();
      expect(Array.isArray(response.body.recommendations)).toBe(true);
      expect(response.body.message).toContain("Невозможно включить автоотправку");
      
      const recommendations = response.body.recommendations.join(" ");
      expect(recommendations).toContain("товар");
    });

    it("should allow updating thresholds without readiness check", async () => {
      const response = await request(app)
        .patch("/api/settings/decision")
        .send({ tAuto: 0.85, tEscalate: 0.3 });

      expect(response.status).toBe(200);
      expect(response.body.tAuto).toBe(0.85);
      expect(response.body.tEscalate).toBe(0.3);
    });

    it("should include score and threshold in 409 response", async () => {
      const response = await request(app)
        .patch("/api/settings/decision")
        .send({ autosendAllowed: true });

      expect(response.status).toBe(409);
      expect(typeof response.body.score).toBe("number");
      expect(response.body.threshold).toBe(80);
      expect(response.body.score).toBeGreaterThanOrEqual(0);
      expect(response.body.score).toBeLessThanOrEqual(100);
    });
  });
});
