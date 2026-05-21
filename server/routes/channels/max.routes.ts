import { Router, type Request, type Response } from "express";
import { storage } from "../../storage";
import { requireAuth, requireTenant } from "../../middleware/rbac";
import { getAppUrl } from "../../utils/app-url";

const router = Router();

// Accounts created before the `provider` column existed got default "green_api".
// Treat any mpa-* instance as a gateway account regardless of the stored provider value.
function isGatewayAccount(account: { provider?: string | null; idInstance: string }): boolean {
  return account.provider === "max_gateway" || account.idInstance.startsWith("mpa-");
}

// ── /api/channels/max-personal ────────────────────────────────────────────────

router.get("/api/channels/max-personal/accounts", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(404).json({ error: "Tenant not found" });

    const { db } = await import("../../db");
    const { maxPersonalAccounts } = await import("@shared/schema");
    const { eq, asc } = await import("drizzle-orm");
    const rows = await db.select({
      accountId: maxPersonalAccounts.accountId,
      idInstance: maxPersonalAccounts.idInstance,
      displayName: maxPersonalAccounts.displayName,
      label: maxPersonalAccounts.label,
      status: maxPersonalAccounts.status,
      webhookRegistered: maxPersonalAccounts.webhookRegistered,
      autoReplyEnabled: maxPersonalAccounts.autoReplyEnabled,
    }).from(maxPersonalAccounts)
      .where(eq(maxPersonalAccounts.tenantId, tenantId))
      .orderBy(asc(maxPersonalAccounts.createdAt));

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

    // Gateway instances use native admin API for QR
    if (isGatewayAccount(account as any)) {
      const { maxGatewayClient } = await import("../../services/max-gateway-client");
      // Try to get existing QR first; only start a new session if none is active
      let base64 = await maxGatewayClient.getQrImageBase64(account.idInstance);
      if (!base64) {
        // No active QR session — check if already authenticated
        const status = await maxGatewayClient.getInstanceStatus(account.idInstance);
        if (status.authenticated) return res.json({ type: "alreadyLogged", message: "" });
        // Start a new QR session and fetch the image
        try { await maxGatewayClient.startQrSession(account.idInstance); } catch { /* ignore */ }
        base64 = await maxGatewayClient.getQrImageBase64(account.idInstance);
      }
      if (!base64) return res.json({ type: "alreadyLogged", message: "" });
      return res.json({ type: "qrCode", message: base64 });
    }

    const { maxGreenApiAdapter } = await import("../../services/max-green-api-adapter");
    const qrResult = await maxGreenApiAdapter.getQR(account.idInstance, account.apiTokenInstance, account.apiUrl);
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

    let state: string;

    // Gateway instances use native admin API for status
    if (isGatewayAccount(account as any)) {
      const { maxGatewayClient } = await import("../../services/max-gateway-client");
      const instanceStatus = await maxGatewayClient.getInstanceStatus(account.idInstance);
      state = instanceStatus.authenticated ? "authorized" : "notAuthorized";

      const incomingDisplayName = instanceStatus.displayName ?? instanceStatus.phone ?? undefined;
      if (instanceStatus.authenticated && (account.status !== "authorized" || (!account.displayName && incomingDisplayName))) {
        const displayName = incomingDisplayName;

        let webhookRegistered = false;
        try {
          const appUrl = getAppUrl();
          const webhookUrl = `${appUrl}/webhooks/max-personal/${tenantId}/${account.accountId}`;
          await maxGatewayClient.setWebhook(account.idInstance, webhookUrl);
          webhookRegistered = true;
        } catch (err: any) {
          console.error("[Routes] Gateway setWebhook failed:", err.message);
        }

        await db.update(maxPersonalAccounts)
          .set({ status: "authorized", webhookRegistered, displayName: displayName ?? account.displayName, updatedAt: new Date() })
          .where(and(eq(maxPersonalAccounts.tenantId, tenantId), eq(maxPersonalAccounts.accountId, account.accountId)));
      }
    } else {
      const { maxGreenApiAdapter } = await import("../../services/max-green-api-adapter");
      state = await maxGreenApiAdapter.getState(account.idInstance, account.apiTokenInstance, account.apiUrl);

      if (state === "authorized" && account.status !== "authorized") {
        let displayName: string | undefined;
        try {
          const info = await maxGreenApiAdapter.getAccountInfo(account.idInstance, account.apiTokenInstance, account.apiUrl);
          displayName = info.nameAccount || info.wid;
        } catch { /* non-fatal */ }

        let webhookRegistered = false;
        try {
          const appUrl = getAppUrl();
          const webhookUrl = `${appUrl}/webhooks/max-personal/${tenantId}/${account.accountId}`;
          await maxGreenApiAdapter.setWebhook(account.idInstance, account.apiTokenInstance, webhookUrl, account.apiUrl);
          webhookRegistered = true;
        } catch (err: any) {
          console.error("[Routes] GREEN-API setWebhook failed:", err.message);
        }

        await db.update(maxPersonalAccounts)
          .set({ status: "authorized", webhookRegistered, displayName: displayName ?? account.displayName, updatedAt: new Date() })
          .where(and(eq(maxPersonalAccounts.tenantId, tenantId), eq(maxPersonalAccounts.accountId, account.accountId)));
      }
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
    await greenApi.setWebhook(account.idInstance, account.apiTokenInstance, webhookUrl, account.apiUrl);

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

// DELETE /api/channels/max-personal/:accountId — delete an instance (tenant self-service)
router.delete("/api/channels/max-personal/:accountId", requireAuth, async (req: Request, res: Response) => {
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
        eq(maxPersonalAccounts.accountId, req.params.accountId),
      ),
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    // For gateway instances — remove from the gateway first (best-effort)
    if (isGatewayAccount(account as any)) {
      try {
        const { maxGatewayClient } = await import("../../services/max-gateway-client");
        await maxGatewayClient.deleteInstance(account.idInstance);
      } catch (err: any) {
        console.warn(`[Routes] Gateway deleteInstance failed (continuing): ${err.message}`);
      }
    }

    await db.delete(maxPersonalAccounts)
      .where(and(
        eq(maxPersonalAccounts.tenantId, tenantId),
        eq(maxPersonalAccounts.accountId, account.accountId),
      ));

    console.log(`[Routes] MAX account ${account.accountId} (${account.idInstance}) deleted by tenant ${tenantId}`);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[Routes] deleteAccount error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/channels/max-personal/gateway-available — check if self-service creation is possible
router.get("/api/channels/max-personal/gateway-available", requireAuth, async (_req: Request, res: Response) => {
  try {
    const { MaxGatewayClient } = await import("../../services/max-gateway-client");
    const available = await MaxGatewayClient.isConfigured();
    res.json({ available });
  } catch {
    res.json({ available: false });
  }
});

// POST /api/channels/max-personal/create — self-service account creation via gateway
router.post("/api/channels/max-personal/create", requireAuth, async (req: Request, res: Response) => {
  try {
    const { MaxGatewayClient, maxGatewayClient } = await import("../../services/max-gateway-client");
    const { getSecret } = await import("../../services/secret-resolver");

    const gatewayUrl = await getSecret({ scope: "global", keyName: "MAX_GATEWAY_URL" });
    if (!await MaxGatewayClient.isConfigured()) {
      return res.status(503).json({ error: "MAX Gateway не настроен на платформе" });
    }

    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    const tenantId = user?.tenantId;
    if (!tenantId) return res.status(404).json({ error: "Tenant not found" });

    const { label } = req.body as { label?: string };

    const { db } = await import("../../db");
    const { maxPersonalAccounts } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const existingAccounts = await db.select().from(maxPersonalAccounts)
      .where(eq(maxPersonalAccounts.tenantId, tenantId));
    if (existingAccounts.length >= 50) {
      return res.status(400).json({ error: "Достигнут максимальный лимит аккаунтов (50)" });
    }

    const { randomUUID } = await import("crypto");
    const accountId = randomUUID();
    const instanceId = `mpa-${accountId.replace(/-/g, "").slice(0, 16)}`;

    const appUrl = getAppUrl();
    const webhookUrl = `${appUrl}/webhooks/max-personal/${tenantId}/${accountId}`;

    let apiToken: string | null = null;
    try {
      const result = await maxGatewayClient.createInstance(instanceId, tenantId, webhookUrl);
      apiToken = result.apiToken;
    } catch (err: any) {
      console.error("[MaxPersonal] Gateway createInstance failed:", err.message);
      return res.status(400).json({ error: `Не удалось создать инстанс: ${err.message}` });
    }

    await db.insert(maxPersonalAccounts).values({
      tenantId,
      accountId,
      idInstance: instanceId,
      apiTokenInstance: apiToken ?? "",
      apiUrl: gatewayUrl,
      mediaUrl: gatewayUrl,
      label: label ?? null,
      displayName: null,
      status: "unknown",
      webhookRegistered: true,
      provider: "max_gateway",
    });

    console.log(`[MaxPersonal] Self-service instance created: ${instanceId} for tenant ${tenantId}`);
    return res.json({ success: true, accountId });
  } catch (error: any) {
    console.error("[MaxPersonal] Self-service create error:", error);
    res.status(500).json({ error: error.message || "Failed to create account" });
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

    // For gateway accounts: verify the number is registered in MAX before creating anything.
    // Use the userId returned by check-phone as chatId — it matches the numeric format
    // used in incoming webhooks, avoiding the @c.us vs. short-id mismatch.
    let chatId: string;
    const isGatewayAccount = (account as any).provider === "max_gateway" || account.idInstance.startsWith("mpa-");
    if (isGatewayAccount) {
      const { maxGatewayClient: mgc } = await import("../../services/max-gateway-client");
      const checkResult = await mgc.checkPhone(account.idInstance, cleanDigits);
      if (!checkResult.registered) {
        return res.status(422).json({ error: "Этот номер не зарегистрирован в MAX" });
      }
      chatId = String(checkResult.userId);
    } else {
      chatId = `${cleanDigits}@c.us`;
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

// ── Media proxy for gateway instances ────────────────────────────────────────
// Proxies MAX CDN images through the gateway so the browser can load them.
// Usage: GET /api/channels/max-personal/:accountId/media/photo?url=<cdn url (i.oneme.ru)>
// Handles both new format (raw CDN url) and legacy format (full gateway download URL
// with ?baseUrl= param) so old stored messages continue to work after a domain change.
router.get("/api/channels/max-personal/:accountId/media/photo", requireAuth, async (req: Request, res: Response) => {
  try {
    const { url: rawUrl } = req.query as { url?: string };
    if (!rawUrl) return res.status(400).json({ error: "url is required" });

    // Legacy: stored url may be a full gateway download URL with ?baseUrl=<cdnUrl>.
    // Extract the actual CDN url so the proxy always uses the currently configured gateway.
    let mediaUrl = rawUrl;
    try {
      const parsed = new URL(rawUrl);
      const extracted = parsed.searchParams.get("baseUrl");
      if (extracted) mediaUrl = extracted;
    } catch { /* rawUrl is not a full URL — use as-is */ }

    const { db } = await import("../../db");
    const { maxPersonalAccounts } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const account = await db.query.maxPersonalAccounts.findFirst({
      where: eq(maxPersonalAccounts.accountId, req.params.accountId),
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    const { getSecret } = await import("../../services/secret-resolver");
    const gatewayUrl = (await getSecret({ scope: "global", keyName: "MAX_GATEWAY_URL" })) ?? "";
    const adminKey = (await getSecret({ scope: "global", keyName: "MAX_GATEWAY_ADMIN_KEY" })) ?? "";

    const baseUrl = gatewayUrl.replace(/\/$/, "");
    const proxyUrl = `${baseUrl}/instances/${account.idInstance}/download/photo?baseUrl=${encodeURIComponent(mediaUrl)}`;
    console.log("[MaxPersonal] media proxy fetching:", proxyUrl);

    const upstream = await fetch(proxyUrl, {
      headers: { Authorization: `Bearer ${adminKey}` },
    });

    if (!upstream.ok) return res.status(upstream.status).end();

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.send(buf);
  } catch (err: any) {
    console.error("[MaxPersonal] media proxy error:", err.message, err.cause ? String(err.cause) : "");
    res.status(500).end();
  }
});

// ── Generic media proxy (audio, video, document) ─────────────────────────────
// Proxies any gateway media URL through the server so the browser can load it.
// Supports Range requests so audio/video seeking works in the browser.
// Usage: GET /api/channels/max-personal/:accountId/media/file?url=<gateway url>
router.get("/api/channels/max-personal/:accountId/media/file", requireAuth, async (req: Request, res: Response) => {
  try {
    const { url: rawUrl } = req.query as { url?: string };
    if (!rawUrl) return res.status(400).json({ error: "url is required" });

    const { getSecret } = await import("../../services/secret-resolver");
    const adminKey = (await getSecret({ scope: "global", keyName: "MAX_GATEWAY_ADMIN_KEY" })) ?? "";

    const headers: Record<string, string> = { Authorization: `Bearer ${adminKey}` };
    // Forward Range header so the browser can seek inside audio/video
    if (req.headers.range) {
      headers["Range"] = req.headers.range;
    }

    const upstream = await fetch(rawUrl, { headers });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).end();
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    const acceptRanges = upstream.headers.get("accept-ranges");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (contentRange) res.setHeader("Content-Range", contentRange);
    if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
    else res.setHeader("Accept-Ranges", "bytes");

    res.status(upstream.status);
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.send(buf);
  } catch (err: any) {
    console.error("[MaxPersonal] media/file proxy error:", err.message);
    res.status(500).end();
  }
});

export default router;
