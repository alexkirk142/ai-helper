import { Router, type Request, type Response } from "express";
import { storage } from "../../storage";
import { requireAuth, requireTenant } from "../../middleware/rbac";
import { getAppUrl } from "../../utils/app-url";

const router = Router();

// ── /api/channels/max-personal ────────────────────────────────────────────────

router.get("/api/channels/max-personal/accounts", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(404).json({ error: "Tenant not found" });

    const { db } = await import("../../db");
    const { maxPersonalAccounts } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select({
      accountId: maxPersonalAccounts.accountId,
      idInstance: maxPersonalAccounts.idInstance,
      displayName: maxPersonalAccounts.displayName,
      label: maxPersonalAccounts.label,
      status: maxPersonalAccounts.status,
      webhookRegistered: maxPersonalAccounts.webhookRegistered,
      autoReplyEnabled: maxPersonalAccounts.autoReplyEnabled,
    }).from(maxPersonalAccounts).where(eq(maxPersonalAccounts.tenantId, tenantId));

    return res.json({ accounts: rows });
  } catch (error) {
    console.error("Error fetching MAX Personal accounts:", error);
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
});

router.get("/api/channels/max-personal/:accountId/qr", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(404).json({ error: "Tenant not found" });

    const { db } = await import("../../db");
    const { maxPersonalAccounts } = await import("@shared/schema");
    const { and, eq } = await import("drizzle-orm");
    const account = await db.query.maxPersonalAccounts.findFirst({
      where: and(
        eq(maxPersonalAccounts.tenantId, tenantId),
        eq(maxPersonalAccounts.accountId, req.params.accountId)
      ),
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    const { maxGreenApiAdapter } = await import("../../services/max-green-api-adapter");
    const qrResult = await maxGreenApiAdapter.getQR(account.idInstance, account.apiTokenInstance);
    return res.json(qrResult);
  } catch (error: any) {
    console.error("Error fetching GREEN-API QR:", error);
    res.status(500).json({ error: error.message || "Failed to fetch QR" });
  }
});

router.get("/api/channels/max-personal/:accountId/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(404).json({ error: "Tenant not found" });

    const { db } = await import("../../db");
    const { maxPersonalAccounts } = await import("@shared/schema");
    const { and, eq } = await import("drizzle-orm");
    const account = await db.query.maxPersonalAccounts.findFirst({
      where: and(
        eq(maxPersonalAccounts.tenantId, tenantId),
        eq(maxPersonalAccounts.accountId, req.params.accountId)
      ),
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    const { maxGreenApiAdapter } = await import("../../services/max-green-api-adapter");
    const state = await maxGreenApiAdapter.getState(account.idInstance, account.apiTokenInstance);

    if (state === "authorized" && account.status !== "authorized") {
      let displayName: string | undefined;
      try {
        const info = await maxGreenApiAdapter.getAccountInfo(account.idInstance, account.apiTokenInstance);
        displayName = info.nameAccount || info.wid;
      } catch { /* non-fatal */ }

      let webhookRegistered = false;
      try {
        console.log('[DEBUG] Current APP_URL:', process.env.APP_URL);
        console.log('[DEBUG] RAILWAY_PUBLIC_DOMAIN:', process.env.RAILWAY_PUBLIC_DOMAIN);
        const appUrl = getAppUrl();
        const webhookUrl = `${appUrl}/webhooks/max-personal/${tenantId}/${account.accountId}`;
        console.log(`[DEBUG] Registering webhook for tenant=${tenantId} account=${account.accountId} url=${webhookUrl}`);
        await maxGreenApiAdapter.setWebhook(account.idInstance, account.apiTokenInstance, webhookUrl);
        webhookRegistered = true;
        console.log(`[DEBUG] setWebhook SUCCESS for idInstance=${account.idInstance}`);
      } catch (err: any) {
        console.error("[Routes] GREEN-API setWebhook failed:", err.message);
      }

      await db.update(maxPersonalAccounts)
        .set({ status: "authorized", webhookRegistered, displayName: displayName ?? account.displayName, updatedAt: new Date() })
        .where(and(eq(maxPersonalAccounts.tenantId, tenantId), eq(maxPersonalAccounts.accountId, account.accountId)));
    }

    return res.json({ status: state });
  } catch (error: any) {
    console.error("Error polling GREEN-API status:", error);
    res.status(500).json({ error: error.message || "Failed to poll status" });
  }
});

router.post("/api/channels/max-personal/:accountId/reregister-webhook", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(404).json({ error: "Tenant not found" });

    const { db: dbInst } = await import("../../db");
    const { maxPersonalAccounts: mpTable } = await import("@shared/schema");
    const { and: andOp, eq: eqOp } = await import("drizzle-orm");
    const account = await dbInst.query.maxPersonalAccounts.findFirst({
      where: andOp(
        eqOp(mpTable.tenantId, tenantId),
        eqOp(mpTable.accountId, req.params.accountId)
      ),
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    console.log('[DEBUG] reregister-webhook: APP_URL =', process.env.APP_URL);
    console.log('[DEBUG] reregister-webhook: RAILWAY_PUBLIC_DOMAIN =', process.env.RAILWAY_PUBLIC_DOMAIN);
    const appUrl = getAppUrl();
    const webhookUrl = `${appUrl}/webhooks/max-personal/${tenantId}/${account.accountId}`;
    console.log(`[Routes] Re-registering webhook: ${webhookUrl}`);

    const { maxGreenApiAdapter: greenApi } = await import("../../services/max-green-api-adapter");
    await greenApi.setWebhook(account.idInstance, account.apiTokenInstance, webhookUrl);

    await dbInst.update(mpTable)
      .set({ webhookRegistered: true, updatedAt: new Date() })
      .where(andOp(eqOp(mpTable.tenantId, tenantId), eqOp(mpTable.accountId, account.accountId)));

    return res.json({ ok: true, webhookUrl });
  } catch (err: any) {
    console.error("[Routes] reregister-webhook error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.patch("/api/channels/max-personal/:accountId/auto-reply", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(404).json({ error: "Tenant not found" });

    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be boolean" });

    const { db: dbInst } = await import("../../db");
    const { maxPersonalAccounts: mpTable } = await import("@shared/schema");
    const { and: andOp, eq: eqOp } = await import("drizzle-orm");

    const result = await dbInst.update(mpTable)
      .set({ autoReplyEnabled: enabled, updatedAt: new Date() })
      .where(andOp(eqOp(mpTable.tenantId, tenantId), eqOp(mpTable.accountId, req.params.accountId)))
      .returning({ accountId: mpTable.accountId, autoReplyEnabled: mpTable.autoReplyEnabled });

    if (result.length === 0) return res.status(404).json({ error: "Account not found" });

    console.log(`[Routes] MAX account ${req.params.accountId} auto-reply set to ${enabled}`);
    return res.json({ ok: true, autoReplyEnabled: result[0].autoReplyEnabled });
  } catch (err: any) {
    console.error("[Routes] auto-reply toggle error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── /api/max-personal ─────────────────────────────────────────────────────────

router.post("/api/max-personal/start-conversation", requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const { phoneNumber, initialMessage, accountId: requestedAccountId } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const cleanDigits = String(phoneNumber).replace(/\D/g, "");
    if (cleanDigits.length < 10 || cleanDigits.length > 15) {
      return res.status(400).json({ error: "Invalid phone number format" });
    }

    const chatId = `${cleanDigits}@c.us`;

    const { db: dbInst } = await import("../../db");
    const { maxPersonalAccounts: mpTable } = await import("@shared/schema");
    const { eq: eqOp, and: andOp } = await import("drizzle-orm");
    const account = await dbInst.query.maxPersonalAccounts.findFirst({
      where: requestedAccountId
        ? andOp(
            eqOp(mpTable.tenantId, tenantId),
            eqOp(mpTable.accountId, String(requestedAccountId)),
            eqOp(mpTable.status, "authorized"),
          )
        : andOp(
            eqOp(mpTable.tenantId, tenantId),
            eqOp(mpTable.status, "authorized"),
          ),
    });

    if (!account) {
      return res.status(400).json({ error: "No active MAX Personal account connected" });
    }

    let customer = await storage.getCustomerByExternalId(tenantId, "max_personal", chatId);
    if (!customer) {
      try {
        customer = await storage.createCustomer({
          tenantId,
          externalId: chatId,
          name: `MAX +${cleanDigits}`,
          channel: "max_personal",
          phone: `+${cleanDigits}`,
          metadata: {},
        }, tenantId);
      } catch (e: any) {
        customer = await storage.getCustomerByExternalId(tenantId, "max_personal", chatId);
        if (!customer) throw e;
      }
    }

    const allConversations = await storage.getConversationsByTenant(tenantId);
    let conversation: { id: string } | undefined = allConversations.find((c) => c.customerId === customer!.id);

    if (!conversation) {
      conversation = await storage.createConversation({
        tenantId,
        customerId: customer.id,
        status: "active",
        mode: "learning",
      }, tenantId);
    }

    if (initialMessage && String(initialMessage).trim()) {
      const trimmed = String(initialMessage).trim();
      const { maxPersonalAdapter } = await import("../../services/max-personal-adapter");
      const sendResult = await maxPersonalAdapter.sendMessageForTenant(tenantId, chatId, trimmed);
      if (sendResult.success) {
        await storage.createMessage({
          conversationId: conversation!.id,
          role: "assistant",
          content: trimmed,
          metadata: {
            isOutbound: true,
            externalMessageId: sendResult.externalMessageId ?? null,
            channel: "max_personal",
            accountId: account.accountId,
            chatId,
          },
        }, tenantId);
      }
    }

    res.json({ success: true, conversationId: conversation!.id });
  } catch (error: any) {
    console.error("Error starting MAX Personal conversation:", error);
    res.status(500).json({ error: error.message || "Failed to start conversation" });
  }
});

export default router;
