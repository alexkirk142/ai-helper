import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const routesContent = readFileSync(join(__dirname, "../routes.ts"), "utf-8");

function extractEndpoints(content: string): Array<{
  method: string;
  path: string;
  hasAuth: boolean;
  permission: string | null;
}> {
  const endpoints: Array<{ method: string; path: string; hasAuth: boolean; permission: string | null }> = [];
  
  const routeRegex = /app\.(get|post|patch|delete)\s*\(\s*["']([^"']+)["']\s*,([^)]+\))/gi;
  
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const path = match[2];
    const middlewareSection = match[3];
    
    const hasAuth = middlewareSection.includes("requireAuth");
    
    const permissionMatch = middlewareSection.match(/requirePermission\s*\(\s*["']([^"']+)["']\s*\)/);
    const permission = permissionMatch ? permissionMatch[1] : null;
    
    endpoints.push({ method, path, hasAuth, permission });
  }
  
  return endpoints;
}

const allEndpoints = extractEndpoints(routesContent);

const writeEndpoints = allEndpoints.filter(e => 
  e.method === "POST" || e.method === "PATCH" || e.method === "DELETE"
);

const excludedPaths = [
  "/api/webhook/telegram",
  "/api/webhook/whatsapp",
  "/webhooks/telegram",
  "/webhooks/whatsapp",
  "/api/login",
  "/api/logout", 
  "/api/callback"
];

const protectedWriteEndpoints = writeEndpoints.filter(e => 
  e.hasAuth && !excludedPaths.some(ex => e.path.includes(ex))
);

const unprotectedWriteEndpoints = writeEndpoints.filter(e => 
  !e.hasAuth && !excludedPaths.some(ex => e.path.includes(ex))
);

describe("Real Routes.ts Endpoint Protection", () => {
  describe("Write endpoint coverage", () => {
    it("all write endpoints are protected (excluding webhooks)", () => {
      expect(unprotectedWriteEndpoints).toHaveLength(0);
      if (unprotectedWriteEndpoints.length > 0) {
        console.log("Unprotected write endpoints:", unprotectedWriteEndpoints.map(e => `${e.method} ${e.path}`));
      }
    });

    it("has substantial number of protected write endpoints", () => {
      expect(protectedWriteEndpoints.length).toBeGreaterThan(40);
    });
  });

  describe("MANAGE_CONVERSATIONS permission", () => {
    it("protects suggestion approve endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/suggestions/:id/approve");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CONVERSATIONS");
    });

    it("protects suggestion edit endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/suggestions/:id/edit");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CONVERSATIONS");
    });

    it("protects suggestion reject endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/suggestions/:id/reject");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CONVERSATIONS");
    });

    it("protects suggestion escalate endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/suggestions/:id/escalate");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CONVERSATIONS");
    });

    it("protects escalation update endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/escalations/:id");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CONVERSATIONS");
    });
  });

  describe("MANAGE_PRODUCTS permission", () => {
    it("protects product create endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/products" && e.method === "POST");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_PRODUCTS");
    });

    it("protects product update endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/products/:id" && e.method === "PATCH");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_PRODUCTS");
    });

    it("protects product delete endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/products/:id" && e.method === "DELETE");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_PRODUCTS");
    });

    it("protects product import endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/products/import");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_PRODUCTS");
    });
  });

  describe("MANAGE_KNOWLEDGE_BASE permission", () => {
    it("protects knowledge doc create endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/knowledge-docs" && e.method === "POST");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_KNOWLEDGE_BASE");
    });

    it("protects knowledge doc update endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/knowledge-docs/:id" && e.method === "PATCH");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_KNOWLEDGE_BASE");
    });

    it("protects knowledge doc delete endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/knowledge-docs/:id" && e.method === "DELETE");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_KNOWLEDGE_BASE");
    });

    it("protects RAG regenerate embeddings endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/admin/rag/regenerate-embeddings");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_KNOWLEDGE_BASE");
    });

    it("protects RAG invalidate stale endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/admin/rag/invalidate-stale");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_KNOWLEDGE_BASE");
    });
  });

  describe("MANAGE_CHANNELS permission", () => {
    it("protects channel toggle endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/channels/:channel/toggle");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CHANNELS");
    });

    it("protects channel config endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/channels/:channel/config");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CHANNELS");
    });

    it("protects channel test endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/channels/:channel/test");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CHANNELS");
    });

    it("protects telegram-personal start-auth endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/telegram-personal/start-auth");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CHANNELS");
    });

    it("protects telegram-personal verify-code endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/telegram-personal/verify-code");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CHANNELS");
    });

    it("protects telegram-personal verify-2fa endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/telegram-personal/verify-2fa");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CHANNELS");
    });

    it("protects telegram-personal start-qr-auth endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/telegram-personal/start-qr-auth");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CHANNELS");
    });

    it("protects whatsapp-personal start-auth endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/whatsapp-personal/start-auth");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CHANNELS");
    });

    it("protects whatsapp-personal check-auth endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/whatsapp-personal/check-auth");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CHANNELS");
    });

    it("protects whatsapp-personal logout endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/whatsapp-personal/logout");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_CHANNELS");
    });
  });

  describe("MANAGE_TENANT_SETTINGS permission", () => {
    it("protects tenant update endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/tenant" && e.method === "PATCH");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_TENANT_SETTINGS");
    });

    it("protects onboarding setup endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/onboarding/setup");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("MANAGE_TENANT_SETTINGS");
    });
  });

  describe("DELETE_CUSTOMER_DATA permission", () => {
    it("protects customer data deletion endpoint", () => {
      const route = allEndpoints.find(e => e.path === "/api/customers/:id/data");
      expect(route?.hasAuth).toBe(true);
      expect(route?.permission).toBe("DELETE_CUSTOMER_DATA");
    });
  });

  describe("Regression guard", () => {
    it("zero unprotected write endpoints", () => {
      const unprotected = writeEndpoints.filter(e => 
        !e.hasAuth && 
        !excludedPaths.some(ex => e.path.includes(ex))
      );
      
      expect(unprotected).toEqual([]);
    });
  });
});
