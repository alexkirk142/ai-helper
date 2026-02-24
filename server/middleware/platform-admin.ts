import type { Request, Response, NextFunction, RequestHandler } from "express";
import { auditLog } from "../services/audit-log";

export const PLATFORM_ADMIN_MARKER = Symbol("requiresPlatformAdmin");

export interface PlatformAdminMarkedHandler extends RequestHandler {
  [PLATFORM_ADMIN_MARKER]?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      isPlatformAdmin?: boolean;
    }
  }
}

export function requirePlatformAdmin(): PlatformAdminMarkedHandler {
  const handler: PlatformAdminMarkedHandler = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const user = (req as any).user;
    
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!user.isPlatformAdmin) {
      await auditLog.log(
        "admin_access_denied" as any,
        "admin",
        user.tenantId || "platform",
        user.id,
        "user",
        {
          requestPath: req.path,
          requestMethod: req.method,
          requestId: (req as any).id,
        }
      );
      return res.status(403).json({ error: "Platform admin access required" });
    }

    req.isPlatformAdmin = true;
    next();
  };

  handler[PLATFORM_ADMIN_MARKER] = true;
  return handler;
}

export function auditAdminAction(action: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    const requestId = (req as any).id || "unknown";

    await auditLog.log(
      action as any,
      "admin",
      "platform",
      user?.id || "unknown",
      "user",
      {
        requestPath: req.path,
        requestMethod: req.method,
        requestId,
        queryLength: Object.keys(req.query).length,
      }
    );

    next();
  };
}
