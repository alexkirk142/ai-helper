import type { Express, RequestHandler } from "express";
import type { Permission, MarkedHandler } from "../middleware/rbac";
import { AUTH_MARKER, PERMISSION_MARKER } from "../middleware/rbac";

export interface RouteEntry {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  requiresAuth: boolean;
  requiredPermission?: Permission;
}

const registry: RouteEntry[] = [];

const EXCLUDED_PATHS = [
  "/health",
  "/ready", 
  "/metrics",
  "/api/login",
  "/api/logout",
  "/api/callback",
  "/webhooks/",
  "/api/webhook/",
];

function isExcludedPath(path: string): boolean {
  return EXCLUDED_PATHS.some(excluded => path.startsWith(excluded) || path === excluded);
}

export function registerRoute(entry: RouteEntry): void {
  if (!entry.path.startsWith("/api") || isExcludedPath(entry.path)) {
    return;
  }
  
  const exists = registry.some(
    r => r.method === entry.method && r.path === entry.path
  );
  
  if (!exists) {
    registry.push(entry);
  }
}

function detectAuthAndPermission(handlers: RequestHandler[]): { requiresAuth: boolean; permission?: Permission } {
  let requiresAuth = false;
  let permission: Permission | undefined;
  
  for (const handler of handlers) {
    const h = handler as MarkedHandler;
    
    if (h[AUTH_MARKER] === true) {
      requiresAuth = true;
    }
    
    if (h[PERMISSION_MARKER]) {
      permission = h[PERMISSION_MARKER] as Permission;
    }
    
    const fnName = handler.name || "";
    if (fnName === "requireAuth" || fnName === "requireOperator" || 
        fnName === "requireAdmin" || fnName === "requireViewer" || 
        fnName === "requireOwner") {
      requiresAuth = true;
    }
  }
  
  return { requiresAuth, permission };
}

export function createTrackedApp(app: Express): Express {
  const originalGet = app.get.bind(app);
  const originalPost = app.post.bind(app);
  const originalPut = app.put.bind(app);
  const originalPatch = app.patch.bind(app);
  const originalDelete = app.delete.bind(app);

  (app as any).get = (path: string, ...handlers: RequestHandler[]) => {
    if (typeof path === "string" && path.startsWith("/api") && !isExcludedPath(path)) {
      const { requiresAuth, permission } = detectAuthAndPermission(handlers);
      registerRoute({ method: "GET", path, requiresAuth, requiredPermission: permission });
    }
    return originalGet(path, ...handlers);
  };

  (app as any).post = (path: string, ...handlers: RequestHandler[]) => {
    if (typeof path === "string" && path.startsWith("/api") && !isExcludedPath(path)) {
      const { requiresAuth, permission } = detectAuthAndPermission(handlers);
      registerRoute({ method: "POST", path, requiresAuth, requiredPermission: permission });
    }
    return originalPost(path, ...handlers);
  };

  (app as any).put = (path: string, ...handlers: RequestHandler[]) => {
    if (typeof path === "string" && path.startsWith("/api") && !isExcludedPath(path)) {
      const { requiresAuth, permission } = detectAuthAndPermission(handlers);
      registerRoute({ method: "PUT", path, requiresAuth, requiredPermission: permission });
    }
    return originalPut(path, ...handlers);
  };

  (app as any).patch = (path: string, ...handlers: RequestHandler[]) => {
    if (typeof path === "string" && path.startsWith("/api") && !isExcludedPath(path)) {
      const { requiresAuth, permission } = detectAuthAndPermission(handlers);
      registerRoute({ method: "PATCH", path, requiresAuth, requiredPermission: permission });
    }
    return originalPatch(path, ...handlers);
  };

  (app as any).delete = (path: string, ...handlers: RequestHandler[]) => {
    if (typeof path === "string" && path.startsWith("/api") && !isExcludedPath(path)) {
      const { requiresAuth, permission } = detectAuthAndPermission(handlers);
      registerRoute({ method: "DELETE", path, requiresAuth, requiredPermission: permission });
    }
    return originalDelete(path, ...handlers);
  };

  return app;
}

export function getRouteRegistry(): RouteEntry[] {
  return [...registry];
}

export function getProtectedRoutes(): RouteEntry[] {
  return registry.filter(r => r.requiresAuth);
}

export function getUnprotectedRoutes(): RouteEntry[] {
  return registry.filter(r => !r.requiresAuth);
}

export function calculateRbacCoverage(): {
  coverage: number;
  protectedCount: number;
  unprotectedCount: number;
  totalCount: number;
  protectedEndpoints: string[];
  unprotectedEndpoints: string[];
} {
  const total = registry.length;
  const protected_ = registry.filter(r => r.requiresAuth);
  const unprotected = registry.filter(r => !r.requiresAuth);
  
  return {
    coverage: total > 0 ? Math.round((protected_.length / total) * 100) : 0,
    protectedCount: protected_.length,
    unprotectedCount: unprotected.length,
    totalCount: total,
    protectedEndpoints: protected_.map(r => `${r.method} ${r.path}`),
    unprotectedEndpoints: unprotected.map(r => `${r.method} ${r.path}`),
  };
}

export function clearRegistry(): void {
  registry.length = 0;
}
