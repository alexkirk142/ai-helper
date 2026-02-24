import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { fraudDetectionService } from "../services/fraud-detection-service";

export const TENANT_RESTRICTED_ERROR = {
  error: "TENANT_RESTRICTED",
  message: "Этот аккаунт требует ручной проверки. Пожалуйста, свяжитесь с поддержкой.",
  code: "TENANT_RESTRICTED",
};

export async function requireActiveTenant(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.userId || req.userId === "system") {
      res.status(403).json({ error: "User authentication required" });
      return;
    }

    let user = await storage.getUserByOidcId(req.userId);
    if (!user) {
      user = await storage.getUser(req.userId);
    }

    if (!user?.tenantId) {
      res.status(403).json({ error: "User not associated with a tenant" });
      return;
    }

    const tenantStatus = await fraudDetectionService.getTenantStatus(user.tenantId);

    if (tenantStatus === "restricted") {
      res.status(403).json(TENANT_RESTRICTED_ERROR);
      return;
    }

    next();
  } catch (error) {
    console.error("[Fraud Protection Middleware] Error checking tenant status:", error);
    res.status(500).json({ error: "Failed to verify account status" });
  }
}

export async function requireActiveTenantForChannels(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.userId || req.userId === "system") {
      res.status(403).json({ error: "User authentication required" });
      return;
    }

    let user = await storage.getUserByOidcId(req.userId);
    if (!user) {
      user = await storage.getUser(req.userId);
    }

    if (!user?.tenantId) {
      res.status(403).json({ error: "User not associated with a tenant" });
      return;
    }

    const tenantStatus = await fraudDetectionService.getTenantStatus(user.tenantId);

    if (tenantStatus === "restricted") {
      res.status(403).json(TENANT_RESTRICTED_ERROR);
      return;
    }

    (req as any).tenantId = user.tenantId;

    next();
  } catch (error) {
    console.error("[Fraud Protection Middleware] Error checking tenant status for channel:", error);
    res.status(500).json({ error: "Failed to verify account status" });
  }
}
