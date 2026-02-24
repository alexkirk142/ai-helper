import type { Request, Response, NextFunction, RequestHandler } from "express";
import { db } from "../db";
import { adminActions } from "@shared/schema";

export const PLATFORM_OWNER_MARKER = Symbol("requiresPlatformOwner");

export interface PlatformOwnerMarkedHandler extends RequestHandler {
  [PLATFORM_OWNER_MARKER]?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      isPlatformOwner?: boolean;
    }
  }
}

export function requirePlatformOwner(): PlatformOwnerMarkedHandler {
  const handler: PlatformOwnerMarkedHandler = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const user = (req as any).user;
    
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!user.isPlatformOwner) {
      try {
        await db.insert(adminActions).values({
          actionType: "owner_access_denied",
          targetType: "user",
          targetId: user.id,
          adminId: user.id,
          reason: "Attempted owner-only action without owner privileges",
          metadata: {
            requestPath: req.path,
            requestMethod: req.method,
            ip: req.ip || req.socket.remoteAddress,
          },
        });
      } catch (err) {
        console.error("[PlatformOwner] Failed to log access denial:", err);
      }

      return res.status(403).json({ error: "Platform owner access required" });
    }

    req.isPlatformOwner = true;
    next();
  };

  handler[PLATFORM_OWNER_MARKER] = true;
  return handler;
}

export function isOwnerProtected(user: { isPlatformOwner?: boolean }): boolean {
  return user?.isPlatformOwner === true;
}
