import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import { 
  registerRoute, 
  getRouteRegistry, 
  getProtectedRoutes,
  getUnprotectedRoutes,
  calculateRbacCoverage,
  clearRegistry,
  createTrackedApp
} from "../services/route-registry";
import { requireAuth, requireAdmin, requirePermission } from "../middleware/rbac";

describe("Route Registry", () => {
  beforeEach(() => {
    clearRegistry();
  });

  describe("registerRoute", () => {
    it("registers /api routes", () => {
      registerRoute({ method: "GET", path: "/api/users", requiresAuth: false });
      
      const registry = getRouteRegistry();
      expect(registry).toHaveLength(1);
      expect(registry[0]).toEqual({
        method: "GET",
        path: "/api/users",
        requiresAuth: false,
      });
    });

    it("ignores non-api routes", () => {
      registerRoute({ method: "GET", path: "/health", requiresAuth: false });
      registerRoute({ method: "GET", path: "/ready", requiresAuth: false });
      
      const registry = getRouteRegistry();
      expect(registry).toHaveLength(0);
    });

    it("ignores webhook routes", () => {
      registerRoute({ method: "POST", path: "/api/webhook/telegram", requiresAuth: false });
      registerRoute({ method: "POST", path: "/webhooks/whatsapp", requiresAuth: false });
      
      const registry = getRouteRegistry();
      expect(registry).toHaveLength(0);
    });

    it("ignores auth routes", () => {
      registerRoute({ method: "GET", path: "/api/login", requiresAuth: false });
      registerRoute({ method: "GET", path: "/api/logout", requiresAuth: false });
      registerRoute({ method: "GET", path: "/api/callback", requiresAuth: false });
      
      const registry = getRouteRegistry();
      expect(registry).toHaveLength(0);
    });

    it("does not duplicate routes", () => {
      registerRoute({ method: "GET", path: "/api/users", requiresAuth: false });
      registerRoute({ method: "GET", path: "/api/users", requiresAuth: true });
      
      const registry = getRouteRegistry();
      expect(registry).toHaveLength(1);
    });

    it("stores permission info", () => {
      registerRoute({ 
        method: "DELETE", 
        path: "/api/customers/:id/data", 
        requiresAuth: true,
        requiredPermission: "DELETE_CUSTOMER_DATA"
      });
      
      const registry = getRouteRegistry();
      expect(registry[0].requiredPermission).toBe("DELETE_CUSTOMER_DATA");
    });
  });

  describe("getProtectedRoutes", () => {
    it("returns only protected routes", () => {
      registerRoute({ method: "GET", path: "/api/public", requiresAuth: false });
      registerRoute({ method: "GET", path: "/api/private", requiresAuth: true });
      registerRoute({ method: "POST", path: "/api/admin", requiresAuth: true });
      
      const protected_ = getProtectedRoutes();
      expect(protected_).toHaveLength(2);
      expect(protected_.every(r => r.requiresAuth)).toBe(true);
    });
  });

  describe("getUnprotectedRoutes", () => {
    it("returns only unprotected routes", () => {
      registerRoute({ method: "GET", path: "/api/public", requiresAuth: false });
      registerRoute({ method: "GET", path: "/api/private", requiresAuth: true });
      
      const unprotected = getUnprotectedRoutes();
      expect(unprotected).toHaveLength(1);
      expect(unprotected[0].path).toBe("/api/public");
    });
  });

  describe("calculateRbacCoverage", () => {
    it("calculates correct coverage percentage", () => {
      registerRoute({ method: "GET", path: "/api/a", requiresAuth: true });
      registerRoute({ method: "GET", path: "/api/b", requiresAuth: true });
      registerRoute({ method: "GET", path: "/api/c", requiresAuth: false });
      registerRoute({ method: "GET", path: "/api/d", requiresAuth: false });
      
      const result = calculateRbacCoverage();
      expect(result.coverage).toBe(50);
      expect(result.protectedCount).toBe(2);
      expect(result.unprotectedCount).toBe(2);
      expect(result.totalCount).toBe(4);
    });

    it("returns 0 coverage for empty registry", () => {
      const result = calculateRbacCoverage();
      expect(result.coverage).toBe(0);
      expect(result.totalCount).toBe(0);
    });

    it("returns 100 coverage when all routes are protected", () => {
      registerRoute({ method: "GET", path: "/api/a", requiresAuth: true });
      registerRoute({ method: "POST", path: "/api/b", requiresAuth: true });
      
      const result = calculateRbacCoverage();
      expect(result.coverage).toBe(100);
    });

    it("lists protected and unprotected endpoints", () => {
      registerRoute({ method: "GET", path: "/api/protected", requiresAuth: true });
      registerRoute({ method: "POST", path: "/api/public", requiresAuth: false });
      
      const result = calculateRbacCoverage();
      expect(result.protectedEndpoints).toContain("GET /api/protected");
      expect(result.unprotectedEndpoints).toContain("POST /api/public");
    });
  });

  describe("createTrackedApp", () => {
    it("tracks registered routes", () => {
      const app = express();
      createTrackedApp(app);
      
      const mockHandler = (req: any, res: any) => res.json({});
      
      app.get("/api/test", mockHandler);
      app.post("/api/items", mockHandler);
      
      const registry = getRouteRegistry();
      expect(registry.length).toBeGreaterThanOrEqual(2);
      expect(registry.some(r => r.method === "GET" && r.path === "/api/test")).toBe(true);
      expect(registry.some(r => r.method === "POST" && r.path === "/api/items")).toBe(true);
    });

    it("detects real requireAuth middleware via Symbol marker", () => {
      const app = express();
      createTrackedApp(app);
      
      const handler = (req: any, res: any) => res.json({});
      
      app.get("/api/auth-protected", requireAuth, handler);
      
      const registry = getRouteRegistry();
      const route = registry.find(r => r.path === "/api/auth-protected");
      expect(route?.requiresAuth).toBe(true);
    });

    it("detects requireAdmin middleware via Symbol marker", () => {
      const app = express();
      createTrackedApp(app);
      
      const handler = (req: any, res: any) => res.json({});
      
      app.post("/api/admin-only", requireAuth, requireAdmin, handler);
      
      const registry = getRouteRegistry();
      const route = registry.find(r => r.path === "/api/admin-only");
      expect(route?.requiresAuth).toBe(true);
    });

    it("detects requirePermission and extracts permission via Symbol", () => {
      const app = express();
      createTrackedApp(app);
      
      const handler = (req: any, res: any) => res.json({});
      
      app.delete("/api/customers/:id", requireAuth, requirePermission("DELETE_CUSTOMER_DATA"), handler);
      
      const registry = getRouteRegistry();
      const route = registry.find(r => r.path === "/api/customers/:id");
      expect(route?.requiresAuth).toBe(true);
      expect(route?.requiredPermission).toBe("DELETE_CUSTOMER_DATA");
    });

    it("marks routes without auth middleware as unprotected", () => {
      const app = express();
      createTrackedApp(app);
      
      const handler = (req: any, res: any) => res.json({});
      
      app.get("/api/public-data", handler);
      
      const registry = getRouteRegistry();
      const route = registry.find(r => r.path === "/api/public-data");
      expect(route?.requiresAuth).toBe(false);
    });
  });
});
