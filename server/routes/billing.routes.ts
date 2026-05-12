import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { requireAuth, requireAdmin } from "../middleware/rbac";

const router = Router();

async function getUserForBilling(userId: string) {
  let user = await storage.getUserByOidcId(userId);
  if (!user) {
    user = await storage.getUser(userId);
  }
  return user;
}

router.get("/api/billing/me", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { getBillingStatus } = await import("../services/cryptobot-billing");
    const billingStatus = await getBillingStatus(user.tenantId);
    res.json(billingStatus);
  } catch (error: any) {
    console.error("Error fetching billing status:", error);
    res.status(500).json({ error: "Failed to fetch billing status" });
  }
});

router.post("/api/billing/checkout", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { createInvoice } = await import("../services/cryptobot-billing");
    
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const successUrl = `${baseUrl}/settings?billing=success`;

    const result = await createInvoice(user.tenantId, successUrl);

    res.json({ url: result.payUrl, invoiceId: result.invoiceId });
  } catch (error: any) {
    console.error("Error creating crypto invoice:", error);
    res.status(500).json({ error: error.message || "Failed to create payment invoice" });
  }
});

router.get("/api/billing/check-invoice/:invoiceId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { invoiceId } = req.params;
    
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    const { checkInvoiceStatus, getBillingStatus, getSubscriptionByTenant } = await import("../services/cryptobot-billing");
    
    const subscription = await getSubscriptionByTenant(user.tenantId);
    if (!subscription || subscription.cryptoInvoiceId !== invoiceId) {
      return res.status(403).json({ error: "Invoice not found for your tenant" });
    }
    
    const status = await checkInvoiceStatus(invoiceId);
    const billingStatus = await getBillingStatus(user.tenantId);
    
    res.json({ status, billingStatus });
  } catch (error: any) {
    console.error("Error checking invoice status:", error);
    res.status(500).json({ error: error.message || "Failed to check invoice status" });
  }
});

router.post("/api/billing/cancel", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { cancelSubscription } = await import("../services/cryptobot-billing");
    await cancelSubscription(user.tenantId);

    res.json({ success: true, message: "Subscription will be canceled at period end" });
  } catch (error: any) {
    console.error("Error canceling subscription:", error);
    res.status(500).json({ error: error.message || "Failed to cancel subscription" });
  }
});

// ─── AI Agent subscription routes ───────────────────────────────────────────

router.get("/api/billing/ai/me", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { getAiBillingStatus } = await import("../services/cryptobot-billing");
    const billingStatus = await getAiBillingStatus(user.tenantId);
    res.json(billingStatus);
  } catch (error: any) {
    console.error("Error fetching AI billing status:", error);
    res.status(500).json({ error: "Failed to fetch AI billing status" });
  }
});

router.post("/api/billing/ai/checkout", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { createAiInvoice } = await import("../services/cryptobot-billing");

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const successUrl = `${baseUrl}/extensions?billing=success`;

    const result = await createAiInvoice(user.tenantId, successUrl);
    res.json({ url: result.payUrl, invoiceId: result.invoiceId });
  } catch (error: any) {
    console.error("Error creating AI invoice:", error);
    res.status(500).json({ error: error.message || "Failed to create AI payment invoice" });
  }
});

router.post("/api/billing/ai/cancel", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { cancelAiSubscription } = await import("../services/cryptobot-billing");
    await cancelAiSubscription(user.tenantId);

    res.json({ success: true, message: "AI subscription will be canceled at period end" });
  } catch (error: any) {
    console.error("Error canceling AI subscription:", error);
    res.status(500).json({ error: error.message || "Failed to cancel AI subscription" });
  }
});

router.post("/webhooks/cryptobot", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["crypto-pay-api-signature"] as string;
    
    const rawBody = req.rawBody instanceof Buffer 
      ? req.rawBody.toString("utf8") 
      : JSON.stringify(req.body);
    
    const { verifyWebhookSignature, handleWebhookEvent } = await import("../services/cryptobot-billing");
    
    if (!signature) {
      console.error("[CryptoBot Webhook] Missing signature header");
      return res.status(400).json({ error: "Missing signature" });
    }
    
    if (!await verifyWebhookSignature(rawBody, signature)) {
      console.error("[CryptoBot Webhook] Invalid signature");
      return res.status(400).json({ error: "Invalid signature" });
    }

    await handleWebhookEvent(req.body);
    res.json({ received: true });
  } catch (error: any) {
    console.error("[CryptoBot Webhook] Error:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

router.get("/api/billing/public-config", async (_req: Request, res: Response) => {
  try {
    const { getSecret } = await import("../services/secret-resolver");
    const token = await getSecret({ scope: "global", keyName: "TELEGRAM_ESCALATION_BOT_TOKEN" });
    if (!token) {
      return res.json({ notifyBotUsername: null });
    }
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const tgJson = (await tgRes.json()) as { ok: boolean; result?: { username?: string } };
    const notifyBotUsername = tgJson.ok ? (tgJson.result?.username ?? null) : null;
    res.json({ notifyBotUsername });
  } catch {
    res.json({ notifyBotUsername: null });
  }
});

export default router;
