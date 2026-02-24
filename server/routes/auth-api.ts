import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";

async function isAuthenticatedSession(req: Request, res: Response, next: NextFunction) {
  const session = (req as any).session;
  if (session?.userId) {
    try {
      const user = await storage.getUser(session.userId);
      if (user) {
        (req as any).sessionUser = user;
        return next();
      }
    } catch (err) {
      console.error("[Auth] Session user fetch error:", err);
    }
  }
  return res.status(401).json({ message: "Unauthorized" });
}

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticatedSession, async (req: any, res) => {
    try {
      if (req.sessionUser) {
        return res.json({
          id: req.sessionUser.id,
          username: req.sessionUser.username,
          email: req.sessionUser.email,
          role: req.sessionUser.role,
          tenantId: req.sessionUser.tenantId,
          authProvider: req.sessionUser.authProvider,
          isPlatformAdmin: req.sessionUser.isPlatformAdmin || false,
          isPlatformOwner: req.sessionUser.isPlatformOwner || false,
        });
      }
      return res.status(401).json({ message: "Unauthorized" });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });
}
