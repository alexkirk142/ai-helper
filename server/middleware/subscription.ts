import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

export const SUBSCRIPTION_REQUIRED_ERROR = {
  error: "SUBSCRIPTION_REQUIRED",
  message: "Active subscription required to connect channels",
  code: "SUBSCRIPTION_REQUIRED",
};

export async function requireActiveSubscription(
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

    const { getBillingStatus } = await import("../services/billing-service");
    const billingStatus = await getBillingStatus(user.tenantId);

    if (!billingStatus.canAccess) {
      res.status(402).json(SUBSCRIPTION_REQUIRED_ERROR);
      return;
    }

    next();
  } catch (error) {
    console.error("[Subscription Middleware] Error checking subscription:", error);
    res.status(500).json({ error: "Failed to verify subscription status" });
  }
}
