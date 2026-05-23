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

/**
 * Fallback payment verification — called when the user returns from CryptoBot
 * via ?billing=success. Checks the pending invoice directly with the CryptoBot API
 * and activates the subscription if the payment is confirmed (webhook fallback).
 */
router.post("/api/billing/verify-payment", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { getSubscriptionByTenant, checkInvoiceStatus, handleWebhookEvent, getBillingStatus } =
      await import("../services/cryptobot-billing");

    const subscription = await getSubscriptionByTenant(user.tenantId);
    if (!subscription?.cryptoInvoiceId) {
      const billingStatus = await getBillingStatus(user.tenantId);
      return res.json({ activated: billingStatus.canAccess, billingStatus });
    }

    // If already active, nothing to do
    if (subscription.status === "active") {
      const billingStatus = await getBillingStatus(user.tenantId);
      return res.json({ activated: true, billingStatus });
    }

    const invoiceStatus = await checkInvoiceStatus(subscription.cryptoInvoiceId);
    if (invoiceStatus === "paid") {
      // Replay the webhook activation logic
      await handleWebhookEvent({
        update_type: "invoice_paid",
        request_date: new Date().toISOString(),
        update_id: 0,
        payload: {
          invoice_id: Number(subscription.cryptoInvoiceId),
          status: "paid",
          hash: "",
          asset: "",
          amount: "",
          pay_url: "",
          description: "",
          created_at: new Date().toISOString(),
          paid_at: new Date().toISOString(),
          paid_anonymously: false,
          payload: JSON.stringify({ tenantId: user.tenantId, feature: "channels" }),
        },
      });
      console.log(`[BillingVerify] Fallback-activated channels subscription for tenant ${user.tenantId}`);
    }

    const billingStatus = await getBillingStatus(user.tenantId);
    return res.json({ activated: billingStatus.canAccess, invoiceStatus, billingStatus });
  } catch (error: any) {
    console.error("[BillingVerify] Error:", error);
    res.status(500).json({ error: error.message || "Verification failed" });
  }
});

router.post("/api/billing/ai/verify-payment", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { getAiSubscriptionByTenant, checkInvoiceStatus, handleWebhookEvent, getAiBillingStatus } =
      await import("../services/cryptobot-billing");

    const subscription = await getAiSubscriptionByTenant(user.tenantId);
    if (!subscription?.cryptoInvoiceId) {
      const billingStatus = await getAiBillingStatus(user.tenantId);
      return res.json({ activated: billingStatus.canAccess, billingStatus });
    }

    if (subscription.status === "active") {
      const billingStatus = await getAiBillingStatus(user.tenantId);
      return res.json({ activated: true, billingStatus });
    }

    const invoiceStatus = await checkInvoiceStatus(subscription.cryptoInvoiceId);
    if (invoiceStatus === "paid") {
      await handleWebhookEvent({
        update_type: "invoice_paid",
        request_date: new Date().toISOString(),
        update_id: 0,
        payload: {
          invoice_id: Number(subscription.cryptoInvoiceId),
          status: "paid",
          hash: "",
          asset: "",
          amount: "",
          pay_url: "",
          description: "",
          created_at: new Date().toISOString(),
          paid_at: new Date().toISOString(),
          paid_anonymously: false,
          payload: JSON.stringify({ tenantId: user.tenantId, feature: "ai_agent" }),
        },
      });
      console.log(`[BillingVerify] Fallback-activated AI agent subscription for tenant ${user.tenantId}`);
    }

    const billingStatus = await getAiBillingStatus(user.tenantId);
    return res.json({ activated: billingStatus.canAccess, invoiceStatus, billingStatus });
  } catch (error: any) {
    console.error("[BillingVerify-AI] Error:", error);
    res.status(500).json({ error: error.message || "Verification failed" });
  }
});

// ─── Extra MAX accounts subscription routes ──────────────────────────────────

router.get("/api/billing/extra-accounts/me", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { getExtraAccountsBillingStatus } = await import("../services/cryptobot-billing");
    const billingStatus = await getExtraAccountsBillingStatus(user.tenantId);
    res.json(billingStatus);
  } catch (error: any) {
    console.error("Error fetching extra accounts billing status:", error);
    res.status(500).json({ error: "Failed to fetch extra accounts billing status" });
  }
});

router.post("/api/billing/extra-accounts/checkout", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { createExtraAccountsInvoice } = await import("../services/cryptobot-billing");

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const successUrl = `${baseUrl}/settings?tab=channels&billing=extra_accounts_success`;

    const result = await createExtraAccountsInvoice(user.tenantId, successUrl);
    res.json({ url: result.payUrl, invoiceId: result.invoiceId });
  } catch (error: any) {
    console.error("Error creating extra accounts invoice:", error);
    res.status(500).json({ error: error.message || "Failed to create extra accounts invoice" });
  }
});

router.post("/api/billing/extra-accounts/cancel", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { cancelExtraAccountsSubscription } = await import("../services/cryptobot-billing");
    await cancelExtraAccountsSubscription(user.tenantId);

    res.json({ success: true, message: "Extra accounts subscription will be canceled at period end" });
  } catch (error: any) {
    console.error("Error canceling extra accounts subscription:", error);
    res.status(500).json({ error: error.message || "Failed to cancel extra accounts subscription" });
  }
});

router.post("/api/billing/extra-accounts/verify-payment", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForBilling(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { getExtraAccountsSubscriptionByTenant, checkInvoiceStatus, handleWebhookEvent, getExtraAccountsBillingStatus } =
      await import("../services/cryptobot-billing");

    const subscription = await getExtraAccountsSubscriptionByTenant(user.tenantId);
    if (!subscription?.cryptoInvoiceId) {
      const billingStatus = await getExtraAccountsBillingStatus(user.tenantId);
      return res.json({ activated: billingStatus.canAccess, billingStatus });
    }

    if (subscription.status === "active") {
      const billingStatus = await getExtraAccountsBillingStatus(user.tenantId);
      return res.json({ activated: true, billingStatus });
    }

    const invoiceStatus = await checkInvoiceStatus(subscription.cryptoInvoiceId);
    if (invoiceStatus === "paid") {
      await handleWebhookEvent({
        update_type: "invoice_paid",
        request_date: new Date().toISOString(),
        update_id: 0,
        payload: {
          invoice_id: Number(subscription.cryptoInvoiceId),
          status: "paid",
          hash: "",
          asset: "",
          amount: "",
          pay_url: "",
          description: "",
          created_at: new Date().toISOString(),
          paid_at: new Date().toISOString(),
          paid_anonymously: false,
          payload: JSON.stringify({ tenantId: user.tenantId, feature: "extra_max_accounts" }),
        },
      });
      console.log(`[BillingVerify] Fallback-activated extra_max_accounts subscription for tenant ${user.tenantId}`);
    }

    const billingStatus = await getExtraAccountsBillingStatus(user.tenantId);
    return res.json({ activated: billingStatus.canAccess, invoiceStatus, billingStatus });
  } catch (error: any) {
    console.error("[BillingVerify-ExtraAccounts] Error:", error);
    res.status(500).json({ error: error.message || "Verification failed" });
  }
});

router.get("/api/billing/public-config", async (_req: Request, res: Response) => {
  try {
    const { getSecret } = await import("../services/secret-resolver");
    const {
      getSubscriptionPriceUsdt, getAiSubscriptionPriceUsdt, getTrialPeriodHours,
      getExtraAccountPriceUsdt, getChannelsMode, getAiAgentMode,
    } = await import("../services/cryptobot-billing");

    const [token, subscriptionPrice, aiAgentPrice, trialHours, extraAccountPrice, channelsMode, aiAgentMode] = await Promise.all([
      getSecret({ scope: "global", keyName: "TELEGRAM_ESCALATION_BOT_TOKEN" }),
      getSubscriptionPriceUsdt(),
      getAiSubscriptionPriceUsdt(),
      getTrialPeriodHours(),
      getExtraAccountPriceUsdt(),
      getChannelsMode(),
      getAiAgentMode(),
    ]);

    let notifyBotUsername: string | null = null;
    if (token) {
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const tgJson = (await tgRes.json()) as { ok: boolean; result?: { username?: string } };
        notifyBotUsername = tgJson.ok ? (tgJson.result?.username ?? null) : null;
      } catch {/* ignore Telegram errors */}
    }

    res.json({ notifyBotUsername, subscriptionPrice, aiAgentPrice, trialHours, extraAccountPrice, channelsMode, aiAgentMode });
  } catch {
    res.json({ notifyBotUsername: null, subscriptionPrice: 50, aiAgentPrice: 30, trialHours: 72, extraAccountPrice: 10, channelsMode: "active", aiAgentMode: "active" });
  }
});

export default router;
