import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getConfig } from "../config";
import { storage } from "../storage";

export const AUTH_MARKER = Symbol("requiresAuth");
export const PERMISSION_MARKER = Symbol("requiredPermission");

export interface MarkedHandler extends RequestHandler {
  [AUTH_MARKER]?: boolean;
  [PERMISSION_MARKER]?: string;
}

export type UserRole = "owner" | "admin" | "operator" | "viewer" | "guest";

export const PERMISSIONS = [
  "VIEW_CONVERSATIONS",
  "MANAGE_CONVERSATIONS",
  "VIEW_CUSTOMERS",
  "MANAGE_CUSTOMERS",
  "DELETE_CUSTOMER_DATA",
  "VIEW_ANALYTICS",
  "MANAGE_PRODUCTS",
  "MANAGE_KNOWLEDGE_BASE",
  "MANAGE_AUTOSEND",
  "MANAGE_POLICIES",
  "MANAGE_TRAINING",
  "EXPORT_TRAINING_DATA",
  "MANAGE_CHANNELS",
  "MANAGE_TENANT_SETTINGS",
  "MANAGE_USERS",
  "VIEW_AUDIT_LOGS",
] as const;

export type Permission = typeof PERMISSIONS[number];

const PERMISSION_MATRIX: Record<Permission, UserRole[]> = {
  VIEW_CONVERSATIONS: ["owner", "admin", "operator", "viewer"],
  MANAGE_CONVERSATIONS: ["owner", "admin", "operator"],
  VIEW_CUSTOMERS: ["owner", "admin", "operator", "viewer"],
  MANAGE_CUSTOMERS: ["owner", "admin", "operator"],
  DELETE_CUSTOMER_DATA: ["owner", "admin"],
  VIEW_ANALYTICS: ["owner", "admin", "operator"],
  MANAGE_PRODUCTS: ["owner", "admin", "operator"],
  MANAGE_KNOWLEDGE_BASE: ["owner", "admin", "operator"],
  MANAGE_AUTOSEND: ["owner", "admin"],
  MANAGE_POLICIES: ["owner", "admin"],
  MANAGE_TRAINING: ["owner", "admin"],
  EXPORT_TRAINING_DATA: ["owner", "admin"],
  MANAGE_CHANNELS: ["owner", "admin"],
  MANAGE_TENANT_SETTINGS: ["owner", "admin"],
  MANAGE_USERS: ["owner"],
  VIEW_AUDIT_LOGS: ["owner", "admin"],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  const allowedRoles = PERMISSION_MATRIX[permission];
  return allowedRoles?.includes(role) ?? false;
}

export function getPermissionsForRole(role: UserRole): Permission[] {
  return PERMISSIONS.filter(permission => hasPermission(role, permission));
}

declare global {
  namespace Express {
    interface Request {
      userRole?: UserRole;
      userId?: string;
    }
  }
}

/**
 * Extract user role from request.
 * In production: reads from req.session.role (set by auth service on login).
 * In development/staging: allows X-Debug-Role header for testing.
 * Falls back to "guest" (least privilege) when no authenticated role is present.
 */
export function extractUserRole(req: Request): UserRole {
  const config = getConfig();
  
  // In development/staging/test, allow debug role header for testing.
  // SECURITY: Debug role is ONLY allowed in non-production AND must be explicitly provided.
  if (config.NODE_ENV !== "production") {
    const debugRole = req.headers["x-debug-role"] as string;
    if (debugRole && ["owner", "admin", "operator", "viewer", "guest"].includes(debugRole)) {
      return debugRole as UserRole;
    }
    // In non-production without explicit debug header, default to operator (not admin!)
    // This allows basic API access but blocks admin routes during development.
    return "operator";
  }
  
  // In production, read role from the authenticated session.
  // session.role is written by the auth service at login time.
  const session = (req as any).session;
  const validRoles: UserRole[] = ["owner", "admin", "operator", "viewer", "guest"];
  if (session?.role && validRoles.includes(session.role as UserRole)) {
    return session.role as UserRole;
  }
  
  // No authenticated session role — apply least-privilege default.
  return "guest";
}

/**
 * Middleware to require authentication.
 * Checks email/password session, then falls back to debug headers in non-production.
 */
async function _requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const config = getConfig();
  
  const session = req.session as any;
  if (session?.userId) {
    req.userId = session.userId;
    req.userRole = session.role || extractUserRole(req);
    
    // Fetch full user object for platform admin/owner checks
    try {
      const user = await storage.getUser(session.userId);
      if (user) {
        (req as any).user = user;
      }
    } catch (err) {
      console.error("[requireAuth] Error fetching user:", err);
    }
    
    return next();
  }
  
  // In non-production, allow debug headers for testing
  if (config.NODE_ENV !== "production") {
    req.userRole = extractUserRole(req);
    req.userId = req.headers["x-debug-user-id"] as string || "system";
    return next();
  }
  
  // In production without valid session, return 401
  res.status(401).json({ error: "Authentication required" });
}

export const requireAuth: MarkedHandler = Object.assign(_requireAuth, {
  [AUTH_MARKER]: true,
});

/**
 * Middleware to require specific roles.
 * Returns 403 if user doesn't have required role.
 */
export function requireRole(allowedRoles: UserRole[]): MarkedHandler {
  const handler = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userRole) {
      req.userRole = extractUserRole(req);
    }
    
    if (!allowedRoles.includes(req.userRole)) {
      res.status(403).json({
        error: "Forbidden",
        message: `This endpoint requires one of the following roles: ${allowedRoles.join(", ")}`,
        currentRole: req.userRole,
        requestId: req.requestId,
      });
      return;
    }
    
    next();
  };
  
  return Object.assign(handler, { [AUTH_MARKER]: true }) as MarkedHandler;
}

/**
 * Shorthand for admin-only endpoints.
 */
export const requireAdmin: MarkedHandler = requireRole(["owner", "admin"]);

/**
 * Shorthand for operator or higher endpoints.
 */
export const requireOperator: MarkedHandler = requireRole(["owner", "admin", "operator"]);

/**
 * Shorthand for viewer or higher endpoints (read-only access).
 */
export const requireViewer: MarkedHandler = requireRole(["owner", "admin", "operator", "viewer"]);

/**
 * Shorthand for owner-only endpoints.
 */
export const requireOwner: MarkedHandler = requireRole(["owner"]);

/**
 * Middleware to require a specific permission.
 * Uses the permission matrix to check if user's role has the required permission.
 */
export function requirePermission(permission: Permission): MarkedHandler {
  const handler = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userRole) {
      req.userRole = extractUserRole(req);
    }

    if (!hasPermission(req.userRole, permission)) {
      res.status(403).json({
        error: "Forbidden",
        message: `Permission denied: ${permission}`,
        currentRole: req.userRole,
        requiredPermission: permission,
        requestId: req.requestId,
      });
      return;
    }

    next();
  };

  return Object.assign(handler, { 
    [AUTH_MARKER]: true, 
    [PERMISSION_MARKER]: permission 
  }) as MarkedHandler;
}
