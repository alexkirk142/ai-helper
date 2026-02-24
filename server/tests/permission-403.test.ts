import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, Server } from "http";
import request from "supertest";
import { clearRegistry } from "../services/route-registry";
import { registerRoutes } from "../routes";

describe("Permission 403 Integration Tests", () => {
  let httpServer: Server;
  let app: express.Express;
  
  beforeAll(async () => {
    clearRegistry();
    app = express();
    app.use(express.json());
    httpServer = createServer(app);
    
    try {
      await registerRoutes(httpServer, app);
    } catch (error) {
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
  }, 30000);
  
  afterAll(() => {
    if (httpServer) {
      httpServer.close();
    }
  });

  describe("GET /api/analytics/csat without VIEW_ANALYTICS permission", () => {
    it("returns 403 for guest role", async () => {
      const response = await request(app)
        .get("/api/analytics/csat")
        .set("X-Debug-Role", "guest")
        .set("X-Debug-User-Id", "test-user");
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Forbidden");
      expect(response.body.requiredPermission).toBe("VIEW_ANALYTICS");
    });

    it("returns 403 for viewer role", async () => {
      const response = await request(app)
        .get("/api/analytics/csat")
        .set("X-Debug-Role", "viewer")
        .set("X-Debug-User-Id", "test-user");
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Forbidden");
      expect(response.body.requiredPermission).toBe("VIEW_ANALYTICS");
    });
  });

  describe("GET /api/admin/delayed-jobs without VIEW_AUDIT_LOGS permission", () => {
    it("returns 403 for operator role", async () => {
      const response = await request(app)
        .get("/api/admin/delayed-jobs")
        .set("X-Debug-Role", "operator")
        .set("X-Debug-User-Id", "test-user");
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Forbidden");
      expect(response.body.requiredPermission).toBe("VIEW_AUDIT_LOGS");
    });

    it("returns 403 for viewer role", async () => {
      const response = await request(app)
        .get("/api/admin/delayed-jobs")
        .set("X-Debug-Role", "viewer")
        .set("X-Debug-User-Id", "test-user");
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Forbidden");
      expect(response.body.requiredPermission).toBe("VIEW_AUDIT_LOGS");
    });
  });

  describe("GET /api/customers without VIEW_CUSTOMERS permission", () => {
    it("returns 403 for guest role", async () => {
      const response = await request(app)
        .get("/api/customers")
        .set("X-Debug-Role", "guest")
        .set("X-Debug-User-Id", "test-user");
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Forbidden");
      expect(response.body.requiredPermission).toBe("VIEW_CUSTOMERS");
    });
  });

  describe("GET /api/conversations without VIEW_CONVERSATIONS permission", () => {
    it("returns 403 for guest role", async () => {
      const response = await request(app)
        .get("/api/conversations")
        .set("X-Debug-Role", "guest")
        .set("X-Debug-User-Id", "test-user");
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Forbidden");
      expect(response.body.requiredPermission).toBe("VIEW_CONVERSATIONS");
    });
  });

  describe("Allowed access with correct permissions (passes RBAC, may fail on business logic)", () => {
    it("GET /api/analytics/csat passes RBAC for operator role", async () => {
      const response = await request(app)
        .get("/api/analytics/csat")
        .set("X-Debug-Role", "operator")
        .set("X-Debug-User-Id", "test-user");
      
      if (response.status === 403) {
        expect(response.body.requiredPermission).toBeUndefined();
      }
    });

    it("GET /api/admin/delayed-jobs passes RBAC for admin role", async () => {
      const response = await request(app)
        .get("/api/admin/delayed-jobs")
        .set("X-Debug-Role", "admin")
        .set("X-Debug-User-Id", "test-user");
      
      if (response.status === 403) {
        expect(response.body.requiredPermission).toBeUndefined();
      }
    });

    it("GET /api/customers passes RBAC for viewer role", async () => {
      const response = await request(app)
        .get("/api/customers")
        .set("X-Debug-Role", "viewer")
        .set("X-Debug-User-Id", "test-user");
      
      if (response.status === 403) {
        expect(response.body.requiredPermission).toBeUndefined();
      }
    });

    it("GET /api/conversations passes RBAC for viewer role", async () => {
      const response = await request(app)
        .get("/api/conversations")
        .set("X-Debug-Role", "viewer")
        .set("X-Debug-User-Id", "test-user");
      
      if (response.status === 403) {
        expect(response.body.requiredPermission).toBeUndefined();
      }
    });
  });
});
