import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, Server } from "http";
import { 
  clearRegistry, 
  getRouteRegistry, 
  calculateRbacCoverage,
  getProtectedRoutes,
  getUnprotectedRoutes
} from "../services/route-registry";
import { registerRoutes } from "../routes";

describe("Route Registry Integration - Real Routes", () => {
  let httpServer: Server;
  let app: express.Express;
  
  beforeAll(async () => {
    clearRegistry();
    app = express();
    httpServer = createServer(app);
    
    try {
      await registerRoutes(httpServer, app);
    } catch (error) {
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }, 30000);
  
  afterAll(() => {
    if (httpServer) {
      httpServer.close();
    }
  });

  describe("Write endpoint protection", () => {
    it("all write endpoints are protected (excluding webhooks)", () => {
      const registry = getRouteRegistry();
      
      const excludedPaths = [
        "/api/webhook/",
        "/webhooks/",
        "/api/login",
        "/api/logout",
        "/api/callback"
      ];
      
      const writeEndpoints = registry.filter(r => 
        (r.method === "POST" || r.method === "PATCH" || r.method === "DELETE") &&
        !excludedPaths.some(ex => r.path.includes(ex))
      );
      
      const unprotectedWriteEndpoints = writeEndpoints.filter(r => !r.requiresAuth);
      
      if (unprotectedWriteEndpoints.length > 0) {
        console.log("Unprotected write endpoints found:", 
          unprotectedWriteEndpoints.map(r => `${r.method} ${r.path}`)
        );
      }
      
      expect(unprotectedWriteEndpoints.length).toBe(0);
    });

    it("has substantial protected write endpoints", () => {
      const protectedRoutes = getProtectedRoutes();
      const writeProtected = protectedRoutes.filter(r => 
        r.method === "POST" || r.method === "PATCH" || r.method === "DELETE"
      );
      
      expect(writeProtected.length).toBeGreaterThan(40);
    });
  });

  describe("Permission matrix verification", () => {
    it("MANAGE_CONVERSATIONS protects suggestion endpoints", () => {
      const registry = getRouteRegistry();
      
      const suggestionEndpoints = registry.filter(r => 
        r.path.includes("/api/suggestions/") && 
        (r.path.endsWith("/approve") || r.path.endsWith("/edit") || 
         r.path.endsWith("/reject") || r.path.endsWith("/escalate"))
      );
      
      expect(suggestionEndpoints.length).toBeGreaterThanOrEqual(4);
      
      for (const endpoint of suggestionEndpoints) {
        expect(endpoint.requiresAuth).toBe(true);
        expect(endpoint.requiredPermission).toBe("MANAGE_CONVERSATIONS");
      }
    });

    it("MANAGE_CONVERSATIONS protects escalation endpoints", () => {
      const registry = getRouteRegistry();
      
      const escalationEndpoint = registry.find(r => 
        r.path === "/api/escalations/:id" && r.method === "PATCH"
      );
      
      expect(escalationEndpoint).toBeDefined();
      expect(escalationEndpoint?.requiresAuth).toBe(true);
      expect(escalationEndpoint?.requiredPermission).toBe("MANAGE_CONVERSATIONS");
    });

    it("MANAGE_PRODUCTS protects product CRUD endpoints", () => {
      const registry = getRouteRegistry();
      
      const productCreate = registry.find(r => r.path === "/api/products" && r.method === "POST");
      const productUpdate = registry.find(r => r.path === "/api/products/:id" && r.method === "PATCH");
      const productDelete = registry.find(r => r.path === "/api/products/:id" && r.method === "DELETE");
      const productImport = registry.find(r => r.path === "/api/products/import" && r.method === "POST");
      
      expect(productCreate?.requiresAuth).toBe(true);
      expect(productCreate?.requiredPermission).toBe("MANAGE_PRODUCTS");
      
      expect(productUpdate?.requiresAuth).toBe(true);
      expect(productUpdate?.requiredPermission).toBe("MANAGE_PRODUCTS");
      
      expect(productDelete?.requiresAuth).toBe(true);
      expect(productDelete?.requiredPermission).toBe("MANAGE_PRODUCTS");
      
      expect(productImport?.requiresAuth).toBe(true);
      expect(productImport?.requiredPermission).toBe("MANAGE_PRODUCTS");
    });

    it("MANAGE_KNOWLEDGE_BASE protects KB endpoints", () => {
      const registry = getRouteRegistry();
      
      const kbCreate = registry.find(r => r.path === "/api/knowledge-docs" && r.method === "POST");
      const kbUpdate = registry.find(r => r.path === "/api/knowledge-docs/:id" && r.method === "PATCH");
      const kbDelete = registry.find(r => r.path === "/api/knowledge-docs/:id" && r.method === "DELETE");
      
      expect(kbCreate?.requiresAuth).toBe(true);
      expect(kbCreate?.requiredPermission).toBe("MANAGE_KNOWLEDGE_BASE");
      
      expect(kbUpdate?.requiresAuth).toBe(true);
      expect(kbUpdate?.requiredPermission).toBe("MANAGE_KNOWLEDGE_BASE");
      
      expect(kbDelete?.requiresAuth).toBe(true);
      expect(kbDelete?.requiredPermission).toBe("MANAGE_KNOWLEDGE_BASE");
    });

    it("MANAGE_KNOWLEDGE_BASE protects RAG admin endpoints", () => {
      const registry = getRouteRegistry();
      
      const ragRegenerate = registry.find(r => r.path === "/api/admin/rag/regenerate-embeddings");
      const ragInvalidate = registry.find(r => r.path === "/api/admin/rag/invalidate-stale");
      
      expect(ragRegenerate?.requiresAuth).toBe(true);
      expect(ragRegenerate?.requiredPermission).toBe("MANAGE_KNOWLEDGE_BASE");
      
      expect(ragInvalidate?.requiresAuth).toBe(true);
      expect(ragInvalidate?.requiredPermission).toBe("MANAGE_KNOWLEDGE_BASE");
    });

    it("MANAGE_CHANNELS protects channel configuration endpoints", () => {
      const registry = getRouteRegistry();
      
      const channelToggle = registry.find(r => r.path === "/api/channels/:channel/toggle");
      const channelConfig = registry.find(r => r.path === "/api/channels/:channel/config");
      const channelTest = registry.find(r => r.path === "/api/channels/:channel/test");
      
      expect(channelToggle?.requiresAuth).toBe(true);
      expect(channelToggle?.requiredPermission).toBe("MANAGE_CHANNELS");
      
      expect(channelConfig?.requiresAuth).toBe(true);
      expect(channelConfig?.requiredPermission).toBe("MANAGE_CHANNELS");
      
      expect(channelTest?.requiresAuth).toBe(true);
      expect(channelTest?.requiredPermission).toBe("MANAGE_CHANNELS");
    });

    it("MANAGE_CHANNELS protects telegram-personal auth endpoints", () => {
      const registry = getRouteRegistry();
      
      const telegramPaths = [
        "/api/telegram-personal/start-auth",
        "/api/telegram-personal/verify-code",
        "/api/telegram-personal/verify-2fa",
        "/api/telegram-personal/cancel-auth",
        "/api/telegram-personal/verify-session",
        "/api/telegram-personal/start-qr-auth",
        "/api/telegram-personal/check-qr-auth",
        "/api/telegram-personal/verify-qr-2fa"
      ];
      
      for (const path of telegramPaths) {
        const endpoint = registry.find(r => r.path === path);
        expect(endpoint).toBeDefined();
        expect(endpoint?.requiresAuth).toBe(true);
        expect(endpoint?.requiredPermission).toBe("MANAGE_CHANNELS");
      }
    });

    it("MANAGE_CHANNELS protects whatsapp-personal auth endpoints", () => {
      const registry = getRouteRegistry();
      
      const whatsappPaths = [
        "/api/whatsapp-personal/start-auth",
        "/api/whatsapp-personal/start-auth-phone",
        "/api/whatsapp-personal/check-auth",
        "/api/whatsapp-personal/logout"
      ];
      
      for (const path of whatsappPaths) {
        const endpoint = registry.find(r => r.path === path);
        expect(endpoint).toBeDefined();
        expect(endpoint?.requiresAuth).toBe(true);
        expect(endpoint?.requiredPermission).toBe("MANAGE_CHANNELS");
      }
    });

    it("MANAGE_TENANT_SETTINGS protects tenant/onboarding endpoints", () => {
      const registry = getRouteRegistry();
      
      const tenantUpdate = registry.find(r => r.path === "/api/tenant" && r.method === "PATCH");
      const onboardingSetup = registry.find(r => r.path === "/api/onboarding/setup");
      
      expect(tenantUpdate?.requiresAuth).toBe(true);
      expect(tenantUpdate?.requiredPermission).toBe("MANAGE_TENANT_SETTINGS");
      
      expect(onboardingSetup?.requiresAuth).toBe(true);
      expect(onboardingSetup?.requiredPermission).toBe("MANAGE_TENANT_SETTINGS");
    });

    it("DELETE_CUSTOMER_DATA protects customer data deletion", () => {
      const registry = getRouteRegistry();
      
      const customerDataDelete = registry.find(r => 
        r.path === "/api/customers/:id/data" && r.method === "DELETE"
      );
      
      expect(customerDataDelete).toBeDefined();
      expect(customerDataDelete?.requiresAuth).toBe(true);
      expect(customerDataDelete?.requiredPermission).toBe("DELETE_CUSTOMER_DATA");
    });
  });

  describe("RBAC Coverage metrics", () => {
    it("calculates RBAC coverage from real routes", () => {
      const coverage = calculateRbacCoverage();
      
      expect(coverage.totalCount).toBeGreaterThan(50);
      expect(coverage.protectedCount).toBeGreaterThan(40);
      expect(coverage.coverage).toBeGreaterThan(70);
    });

    it("lists unprotected endpoints for dashboard", () => {
      const coverage = calculateRbacCoverage();
      
      expect(Array.isArray(coverage.unprotectedEndpoints)).toBe(true);
      expect(Array.isArray(coverage.protectedEndpoints)).toBe(true);
    });
    
    it("achieves >= 90% RBAC coverage", () => {
      const coverage = calculateRbacCoverage();
      expect(coverage.coverage).toBeGreaterThanOrEqual(90);
    });
  });

  describe("GET endpoint protection (Phase 9.7.3)", () => {
    const excludedPaths = [
      "/api/webhook/",
      "/webhooks/",
      "/api/login",
      "/api/logout",
      "/api/callback",
      "/api/auth/",
      "/health",
      "/ready",
      "/metrics"
    ];

    it("all GET /api/* endpoints require authentication", () => {
      const registry = getRouteRegistry();
      
      const getEndpoints = registry.filter(r => 
        r.method === "GET" && 
        r.path.startsWith("/api/") &&
        !excludedPaths.some(ex => r.path.includes(ex))
      );
      
      const unprotectedGetEndpoints = getEndpoints.filter(r => !r.requiresAuth);
      
      if (unprotectedGetEndpoints.length > 0) {
        console.log("Unprotected GET endpoints found:", 
          unprotectedGetEndpoints.map(r => `${r.method} ${r.path}`)
        );
      }
      
      expect(unprotectedGetEndpoints.length).toBe(0);
    });

    it("all GET /api/* endpoints have permission defined", () => {
      const registry = getRouteRegistry();
      
      const getEndpoints = registry.filter(r => 
        r.method === "GET" && 
        r.path.startsWith("/api/") &&
        !excludedPaths.some(ex => r.path.includes(ex))
      );
      
      const withoutPermission = getEndpoints.filter(r => !r.requiredPermission);
      
      if (withoutPermission.length > 0) {
        console.log("GET endpoints without permission:", 
          withoutPermission.map(r => `${r.method} ${r.path}`)
        );
      }
      
      expect(withoutPermission.length).toBe(0);
    });

    it("VIEW_CUSTOMERS protects customer read endpoints", () => {
      const registry = getRouteRegistry();
      
      const customerEndpoints = [
        "/api/customers",
        "/api/customers/:id",
        "/api/customers/:id/notes",
        "/api/customers/:id/memory"
      ];
      
      for (const path of customerEndpoints) {
        const endpoint = registry.find(r => r.path === path && r.method === "GET");
        expect(endpoint).toBeDefined();
        expect(endpoint?.requiresAuth).toBe(true);
        expect(endpoint?.requiredPermission).toBe("VIEW_CUSTOMERS");
      }
    });

    it("VIEW_CONVERSATIONS protects conversation read endpoints", () => {
      const registry = getRouteRegistry();
      
      const conversationEndpoints = [
        "/api/conversations",
        "/api/conversations/:id",
        "/api/escalations"
      ];
      
      for (const path of conversationEndpoints) {
        const endpoint = registry.find(r => r.path === path && r.method === "GET");
        expect(endpoint).toBeDefined();
        expect(endpoint?.requiresAuth).toBe(true);
        expect(endpoint?.requiredPermission).toBe("VIEW_CONVERSATIONS");
      }
    });

    it("VIEW_ANALYTICS protects analytics read endpoints", () => {
      const registry = getRouteRegistry();
      
      const analyticsEndpoints = [
        "/api/analytics/csat",
        "/api/analytics/conversion",
        "/api/analytics/intents",
        "/api/analytics/lost-deals",
        "/api/dashboard/metrics"
      ];
      
      for (const path of analyticsEndpoints) {
        const endpoint = registry.find(r => r.path === path && r.method === "GET");
        expect(endpoint).toBeDefined();
        expect(endpoint?.requiresAuth).toBe(true);
        expect(endpoint?.requiredPermission).toBe("VIEW_ANALYTICS");
      }
    });

    it("MANAGE_PRODUCTS protects product read endpoints", () => {
      const registry = getRouteRegistry();
      
      const endpoint = registry.find(r => r.path === "/api/products" && r.method === "GET");
      expect(endpoint).toBeDefined();
      expect(endpoint?.requiresAuth).toBe(true);
      expect(endpoint?.requiredPermission).toBe("MANAGE_PRODUCTS");
    });

    it("MANAGE_KNOWLEDGE_BASE protects KB read endpoints", () => {
      const registry = getRouteRegistry();
      
      const kbEndpoints = [
        "/api/knowledge-docs",
        "/api/admin/rag/status"
      ];
      
      for (const path of kbEndpoints) {
        const endpoint = registry.find(r => r.path === path && r.method === "GET");
        expect(endpoint).toBeDefined();
        expect(endpoint?.requiresAuth).toBe(true);
        expect(endpoint?.requiredPermission).toBe("MANAGE_KNOWLEDGE_BASE");
      }
    });

    it("MANAGE_CHANNELS protects channel read endpoints", () => {
      const registry = getRouteRegistry();
      
      const channelEndpoints = [
        "/api/channels/status",
        "/api/channels/feature-flags",
        "/api/whatsapp-personal/status"
      ];
      
      for (const path of channelEndpoints) {
        const endpoint = registry.find(r => r.path === path && r.method === "GET");
        expect(endpoint).toBeDefined();
        expect(endpoint?.requiresAuth).toBe(true);
        expect(endpoint?.requiredPermission).toBe("MANAGE_CHANNELS");
      }
    });

    it("VIEW_AUDIT_LOGS protects admin read endpoints", () => {
      const registry = getRouteRegistry();
      
      const adminEndpoints = [
        "/api/admin/delayed-jobs",
        "/api/admin/security/readiness"
      ];
      
      for (const path of adminEndpoints) {
        const endpoint = registry.find(r => r.path === path && r.method === "GET");
        expect(endpoint).toBeDefined();
        expect(endpoint?.requiresAuth).toBe(true);
        expect(endpoint?.requiredPermission).toBe("VIEW_AUDIT_LOGS");
      }
    });
  });
});
