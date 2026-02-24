import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { generateSecurityReadinessReport, SecurityReadinessReport } from "../services/security-readiness";
import { registerRoute, clearRegistry } from "../services/route-registry";

describe("Security Readiness Service", () => {
  beforeEach(() => {
    clearRegistry();
    registerRoute({ method: "GET", path: "/api/public", requiresAuth: false });
    registerRoute({ method: "POST", path: "/api/protected", requiresAuth: true });
    registerRoute({ method: "DELETE", path: "/api/admin", requiresAuth: true, requiredPermission: "DELETE_CUSTOMER_DATA" });
  });

  describe("generateSecurityReadinessReport", () => {
    it("returns a valid report structure", () => {
      const report = generateSecurityReadinessReport();

      expect(report).toHaveProperty("piiMasking");
      expect(report).toHaveProperty("piiMaskingDetails");
      expect(report).toHaveProperty("rbacCoverage");
      expect(report).toHaveProperty("rbacDetails");
      expect(report).toHaveProperty("webhookVerification");
      expect(report).toHaveProperty("rateLimiting");
      expect(report).toHaveProperty("dataDeletion");
      expect(report).toHaveProperty("auditCoverage");
      expect(report).toHaveProperty("auditDetails");
      expect(report).toHaveProperty("generatedAt");
    });

    it("piiMasking is OK when sanitizer is available", () => {
      const report = generateSecurityReadinessReport();
      expect(report.piiMasking).toBe("OK");
      expect(report.piiMaskingDetails.length).toBeGreaterThan(0);
    });

    it("rbacCoverage is a percentage between 0 and 100", () => {
      const report = generateSecurityReadinessReport();
      expect(report.rbacCoverage).toBeGreaterThanOrEqual(0);
      expect(report.rbacCoverage).toBeLessThanOrEqual(100);
    });

    it("rbacDetails includes protected and total endpoints", () => {
      const report = generateSecurityReadinessReport();
      expect(report.rbacDetails.protectedEndpoints).toBe(2);
      expect(report.rbacDetails.totalApiEndpoints).toBe(3);
      expect(Array.isArray(report.rbacDetails.unprotectedEndpoints)).toBe(true);
      expect(Array.isArray(report.rbacDetails.protectedEndpointsList)).toBe(true);
    });

    it("rbacDetails lists unprotected endpoints from registry", () => {
      const report = generateSecurityReadinessReport();
      expect(report.rbacDetails.unprotectedEndpoints).toContain("GET /api/public");
    });

    it("rbacDetails lists protected endpoints from registry", () => {
      const report = generateSecurityReadinessReport();
      expect(report.rbacDetails.protectedEndpointsList).toContain("POST /api/protected");
      expect(report.rbacDetails.protectedEndpointsList).toContain("DELETE /api/admin");
    });

    it("webhookVerification includes all channels", () => {
      const report = generateSecurityReadinessReport();
      expect(report.webhookVerification).toHaveProperty("telegram");
      expect(report.webhookVerification).toHaveProperty("whatsapp");
      expect(report.webhookVerification).toHaveProperty("max");
      expect(typeof report.webhookVerification.telegram).toBe("boolean");
      expect(typeof report.webhookVerification.whatsapp).toBe("boolean");
      expect(typeof report.webhookVerification.max).toBe("boolean");
    });

    it("rateLimiting includes all categories", () => {
      const report = generateSecurityReadinessReport();
      expect(report.rateLimiting).toHaveProperty("public");
      expect(report.rateLimiting).toHaveProperty("webhook");
      expect(report.rateLimiting).toHaveProperty("ai");
      expect(report.rateLimiting).toHaveProperty("onboarding");
      expect(report.rateLimiting).toHaveProperty("conversation");
    });

    it("dataDeletion is boolean", () => {
      const report = generateSecurityReadinessReport();
      expect(typeof report.dataDeletion).toBe("boolean");
    });

    it("auditCoverage returns OK or WARN", () => {
      const report = generateSecurityReadinessReport();
      expect(["OK", "WARN"]).toContain(report.auditCoverage);
    });

    it("auditDetails includes present and missing events", () => {
      const report = generateSecurityReadinessReport();
      expect(Array.isArray(report.auditDetails.presentEvents)).toBe(true);
      expect(Array.isArray(report.auditDetails.missingEvents)).toBe(true);
    });

    it("generatedAt is a valid ISO date string", () => {
      const report = generateSecurityReadinessReport();
      const date = new Date(report.generatedAt);
      expect(date.toISOString()).toBe(report.generatedAt);
    });

    it("all webhook verifications are true", () => {
      const report = generateSecurityReadinessReport();
      expect(report.webhookVerification.telegram).toBe(true);
      expect(report.webhookVerification.whatsapp).toBe(true);
      expect(report.webhookVerification.max).toBe(true);
    });

    it("all rate limiting categories are true", () => {
      const report = generateSecurityReadinessReport();
      expect(report.rateLimiting.public).toBe(true);
      expect(report.rateLimiting.webhook).toBe(true);
      expect(report.rateLimiting.ai).toBe(true);
      expect(report.rateLimiting.onboarding).toBe(true);
      expect(report.rateLimiting.conversation).toBe(true);
    });
  });
});

describe("Security Readiness Endpoint Integration", () => {
  const mockRequest = (role: string = "admin") => ({
    headers: { "x-debug-role": role },
    isAuthenticated: () => true,
    user: { claims: { sub: "user-1" } },
    tenantId: "tenant-1",
    userId: "user-1",
  } as unknown as Request);

  const mockResponse = () => {
    const res: Partial<Response> = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res as Response;
  };

  it("requires admin role for access", async () => {
    const res = mockResponse();
    const req = mockRequest("operator");

    const { requirePermission } = await import("../middleware/rbac");
    const middleware = requirePermission("VIEW_AUDIT_LOGS");

    (req as any).userRole = "operator";
    
    middleware(req, res, () => {});
    
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows admin role access", async () => {
    const res = mockResponse();
    const req = mockRequest("admin");

    const { requirePermission } = await import("../middleware/rbac");
    const middleware = requirePermission("VIEW_AUDIT_LOGS");

    (req as any).userRole = "admin";
    
    const next = vi.fn();
    middleware(req, res, next);
    
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("report includes all expected fields", () => {
    const report = generateSecurityReadinessReport();
    
    const expectedFields = [
      "piiMasking",
      "piiMaskingDetails",
      "rbacCoverage",
      "rbacDetails",
      "webhookVerification",
      "rateLimiting",
      "dataDeletion",
      "auditCoverage",
      "auditDetails",
      "generatedAt",
    ];

    for (const field of expectedFields) {
      expect(report).toHaveProperty(field);
    }
  });
});
