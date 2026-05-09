import { Router, type Request, type Response } from "express";
import { storage } from "../../storage";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/rbac";
import { requireActiveSubscription } from "../../middleware/subscription";
import { requireActiveTenant } from "../../middleware/fraud-protection";
import { fraudDetectionService } from "../../services/fraud-detection-service";
import { MAX_TELEGRAM_ACCOUNTS_PER_TENANT } from "../../config/business-constants";
import { channelConnectionCache } from "../channel-management.routes";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function ensureTelegramChannel(tenantId: string): Promise<string> {
  const existingChannels = await storage.getChannelsByTenant(tenantId);
  let channel = existingChannels.find(c => c.type === "telegram_personal");
  if (!channel) {
    channel = await storage.createChannel({
      tenantId,
      type: "telegram_personal",
      name: "Telegram Personal",
      config: {},
      isActive: true,
    });
  }
  return channel.id;
}

async function finalizeAccountAuth(
  tenantId: string,
  accountId: string,
  sessionString: string,
  user: any,
  authMethod: "qr" | "phone",
  existingClient?: any
): Promise<void> {
  const channelId = await ensureTelegramChannel(tenantId);

  await storage.updateTelegramAccount(accountId, {
    sessionString,
    status: "active",
    authMethod,
    channelId,
    userId: user?.id?.toString() ?? null,
    username: user?.username ?? null,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    phoneNumber: user?.phone ?? null,
    lastError: null,
  });

  await storage.updateChannel(channelId, { isActive: true });

  const { telegramClientManager } = await import("../../services/telegram-client-manager");

  telegramClientManager.connectAccount(tenantId, accountId, channelId, sessionString, existingClient)
    .then(connected => {
      if (connected) {
        return telegramClientManager.syncDialogs(tenantId, channelId, { limit: 5, messageLimit: 20 });
      }
    })
    .then(syncResult => {
      if (syncResult) {
        console.log(`[TelegramPersonal] Sync complete: ${syncResult.dialogsImported} dialogs, ${syncResult.messagesImported} messages`);
      }
    })
    .catch(err => {
      console.error(`[TelegramPersonal] Background connect/sync error:`, err.message);
    });
}

// ── /api/telegram-personal ────────────────────────────────────────────────────

router.get("/api/telegram-personal/accounts", requireAuth, requirePermission("MANAGE_CHANNELS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const accounts = await storage.getTelegramAccountsByTenant(tenantId);
    const { telegramClientManager } = await import("../../services/telegram-client-manager");

    const result = accounts.map(a => ({
      id: a.id,
      phoneNumber: a.phoneNumber,
      firstName: a.firstName,
      lastName: a.lastName,
      username: a.username,
      userId: a.userId,
      status: a.status,
      lastError: a.lastError,
      authMethod: a.authMethod,
      isEnabled: a.isEnabled,
      tgRole: (a as any).tgRole ?? "both",
      isConnected: a.status === "active" && a.isEnabled && telegramClientManager.isAccountConnected(tenantId, a.id),
      createdAt: a.createdAt,
    }));

    res.json({ accounts: result });
  } catch (error: any) {
    console.error("Error listing Telegram accounts:", error);
    res.status(500).json({ error: error.message || "Failed to list accounts" });
  }
});

/**
 * GET /api/telegram-personal/flood-status
 * Returns current FLOOD_WAIT state for all accounts of the tenant.
 * Reads from DB lastError + in-memory connection/timer state — no Telegram API calls made.
 */
router.get("/api/telegram-personal/flood-status", requireAuth, requirePermission("MANAGE_CHANNELS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { telegramClientManager } = await import("../../services/telegram-client-manager");
    const accounts = await storage.getTelegramAccountsByTenant(tenantId);

    const result = accounts.map(a => {
      const connectionKey = `${tenantId}:${a.id}`;
      const isConnected = telegramClientManager.isAccountConnected(tenantId, a.id);
      const hasReconnectTimer = telegramClientManager.hasReconnectTimer(connectionKey);
      const isConnecting = telegramClientManager.isConnecting(connectionKey);

      // Parse FLOOD_WAIT seconds from lastError if present
      let floodWaitSecondsRemaining: number | null = null;
      if (a.lastError) {
        const match = a.lastError.match(/reconnecting in (\d+)s/);
        if (match) {
          floodWaitSecondsRemaining = parseInt(match[1], 10);
        }
      }

      return {
        id: a.id,
        phoneNumber: a.phoneNumber,
        firstName: a.firstName,
        status: a.status,
        lastError: a.lastError,
        isConnected,
        hasReconnectTimer,
        isConnecting,
        floodWaitSecondsRemaining,
        updatedAt: a.updatedAt,
      };
    });

    res.json({ accounts: result, checkedAt: new Date().toISOString() });
  } catch (error: any) {
    console.error("Error getting flood status:", error);
    res.status(500).json({ error: error.message || "Failed to get flood status" });
  }
});

router.patch("/api/telegram-personal/accounts/:id/role", requireAuth, requirePermission("MANAGE_CHANNELS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const { role } = req.body as { role: string };
    if (!["resolver", "sender", "both"].includes(role)) {
      return res.status(400).json({ error: "role must be resolver | sender | both" });
    }

    const { db: dbInst } = await import("../../db");
    const { telegramSessions } = await import("@shared/schema");
    const { and: andOp, eq: eqOp } = await import("drizzle-orm");

    const result = await dbInst.update(telegramSessions)
      .set({ tgRole: role, updatedAt: new Date() } as any)
      .where(andOp(eqOp(telegramSessions.tenantId, tenantId), eqOp(telegramSessions.id, req.params.id)))
      .returning({ id: telegramSessions.id });

    if (result.length === 0) return res.status(404).json({ error: "Account not found" });

    console.log(`[Routes] Telegram account ${req.params.id} role set to ${role}`);
    return res.json({ ok: true, tgRole: role });
  } catch (err: any) {
    console.error("[Routes] tg role update error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.post("/api/telegram-personal/accounts/send-code", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, requireTenant, async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body;
    const tenantId = req.tenantId!;

    if (!phoneNumber) return res.status(400).json({ error: "Phone number is required" });

    const fraudCheck = await fraudDetectionService.validateChannelConnection(
      tenantId, "telegram", { telegram: { botId: phoneNumber } }
    );
    if (!fraudCheck.allowed) {
      return res.status(403).json({ error: fraudCheck.message, code: "FRAUD_DETECTED" });
    }

    const existingAccounts = await storage.getTelegramAccountsByTenant(tenantId);
    const activeAccounts = existingAccounts.filter(a => a.status === "active" || a.status === "pending" || a.status === "awaiting_code" || a.status === "awaiting_2fa");
    if (activeAccounts.length >= MAX_TELEGRAM_ACCOUNTS_PER_TENANT) {
      return res.status(400).json({
        error: `Maximum ${MAX_TELEGRAM_ACCOUNTS_PER_TENANT} Telegram accounts per tenant`,
      });
    }

    const account = await storage.createTelegramAccount({
      tenantId,
      phoneNumber,
      status: "awaiting_code",
      authMethod: "phone",
    });

    const sessionId = `tg_phone_${account.id}`;

    const { TelegramPersonalAdapter } = await import("../../services/telegram-personal-adapter");
    const result = await TelegramPersonalAdapter.startAuth(sessionId, phoneNumber);

    if (result.success) {
      res.json({ success: true, accountId: account.id, sessionId });
    } else {
      await storage.updateTelegramAccount(account.id, { status: "error", lastError: result.error });
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("Error sending Telegram code:", error);
    res.status(500).json({ error: error.message || "Failed to send code" });
  }
});

router.post("/api/telegram-personal/accounts/verify-code", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireTenant, async (req: Request, res: Response) => {
  try {
    const { accountId, sessionId, phoneNumber, code } = req.body;
    const tenantId = req.tenantId!;

    if (!sessionId || !phoneNumber || !code || !accountId) {
      return res.status(400).json({ error: "accountId, sessionId, phoneNumber, and code are required" });
    }

    const account = await storage.getTelegramAccountById(accountId);
    if (!account || account.tenantId !== tenantId) {
      return res.status(404).json({ error: "Account not found" });
    }

    const { TelegramPersonalAdapter } = await import("../../services/telegram-personal-adapter");
    const result = await TelegramPersonalAdapter.verifyCode(sessionId, phoneNumber, code);

    if (result.success && result.sessionString) {
      await finalizeAccountAuth(tenantId, accountId, result.sessionString, result.user, "phone", result.client);
      res.json({ success: true, user: result.user });
    } else if (result.needs2FA) {
      await storage.updateTelegramAccount(accountId, { status: "awaiting_2fa" });
      res.json({ success: false, needs2FA: true, sessionId, accountId });
    } else {
      await storage.updateTelegramAccount(accountId, { status: "error", lastError: result.error });
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("Error verifying Telegram code:", error);
    res.status(500).json({ error: error.message || "Failed to verify code" });
  }
});

router.post("/api/telegram-personal/accounts/verify-password", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireTenant, async (req: Request, res: Response) => {
  try {
    const { accountId, sessionId, password } = req.body;
    const tenantId = req.tenantId!;

    if (!sessionId || !password || !accountId) {
      return res.status(400).json({ error: "accountId, sessionId, and password are required" });
    }

    const account = await storage.getTelegramAccountById(accountId);
    if (!account || account.tenantId !== tenantId) {
      return res.status(404).json({ error: "Account not found" });
    }

    const { TelegramPersonalAdapter } = await import("../../services/telegram-personal-adapter");
    const result = await TelegramPersonalAdapter.verify2FA(sessionId, password);

    if (result.success && result.sessionString) {
      await finalizeAccountAuth(tenantId, accountId, result.sessionString, result.user, "phone", result.client);
      res.json({ success: true, user: result.user });
    } else {
      await storage.updateTelegramAccount(accountId, { lastError: result.error });
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("Error verifying 2FA:", error);
    res.status(500).json({ error: error.message || "Failed to verify 2FA" });
  }
});

router.post("/api/telegram-personal/accounts/start-qr", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const existingAccounts = await storage.getTelegramAccountsByTenant(tenantId);
    const activeAccounts = existingAccounts.filter(a => a.status === "active" || a.status === "pending" || a.status === "awaiting_code" || a.status === "awaiting_2fa");
    if (activeAccounts.length >= MAX_TELEGRAM_ACCOUNTS_PER_TENANT) {
      return res.status(400).json({
        error: `Maximum ${MAX_TELEGRAM_ACCOUNTS_PER_TENANT} Telegram accounts per tenant`,
      });
    }

    const account = await storage.createTelegramAccount({
      tenantId,
      status: "pending",
      authMethod: "qr",
    });

    const sessionId = `tg_qr_${account.id}`;

    const { TelegramPersonalAdapter } = await import("../../services/telegram-personal-adapter");
    const result = await TelegramPersonalAdapter.startQrAuth(sessionId);

    if (result.success && result.qrUrl) {
      const QRCode = await import("qrcode");
      const qrImageDataUrl = await QRCode.toDataURL(result.qrUrl, {
        width: 256, margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });

      res.json({
        success: true,
        accountId: account.id,
        sessionId,
        qrImageDataUrl,
        qrUrl: result.qrUrl,
        expiresAt: result.expiresAt,
      });
    } else {
      await storage.updateTelegramAccount(account.id, { status: "error", lastError: result.error });
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("Error starting QR auth:", error);
    res.status(500).json({ error: error.message || "Failed to start QR auth" });
  }
});

router.post("/api/telegram-personal/accounts/check-qr", requireAuth, requirePermission("MANAGE_CHANNELS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const { sessionId, accountId } = req.body;
    const tenantId = req.tenantId!;

    if (!sessionId || !accountId) return res.status(400).json({ error: "sessionId and accountId are required" });

    const account = await storage.getTelegramAccountById(accountId);
    if (!account || account.tenantId !== tenantId) {
      return res.status(404).json({ error: "Account not found" });
    }

    const { TelegramPersonalAdapter } = await import("../../services/telegram-personal-adapter");
    const result = await TelegramPersonalAdapter.checkQrAuth(sessionId);

    if (result.status === "authorized" && result.sessionString) {
      await finalizeAccountAuth(tenantId, accountId, result.sessionString, result.user, "qr");
      res.json({ ...result });
    } else if (result.status === "needs_2fa") {
      await storage.updateTelegramAccount(accountId, { status: "awaiting_2fa" });
      res.json({ success: true, status: "needs_2fa", accountId, sessionId });
    } else if (result.qrUrl) {
      const QRCode = await import("qrcode");
      const qrImageDataUrl = await QRCode.toDataURL(result.qrUrl, {
        width: 256, margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      res.json({ ...result, qrImageDataUrl });
    } else {
      res.json(result);
    }
  } catch (error: any) {
    console.error("Error checking QR auth:", error);
    res.status(500).json({ error: error.message || "Failed to check QR auth" });
  }
});

router.post("/api/telegram-personal/accounts/verify-qr-2fa", requireAuth, requirePermission("MANAGE_CHANNELS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const { sessionId, accountId, password } = req.body;
    const tenantId = req.tenantId!;

    if (!sessionId || !password || !accountId) {
      return res.status(400).json({ error: "sessionId, accountId, and password are required" });
    }

    const account = await storage.getTelegramAccountById(accountId);
    if (!account || account.tenantId !== tenantId) {
      return res.status(404).json({ error: "Account not found" });
    }

    const { TelegramPersonalAdapter } = await import("../../services/telegram-personal-adapter");
    const result = await TelegramPersonalAdapter.verify2FAForQr(sessionId, password);

    if (result.success && result.sessionString) {
      await finalizeAccountAuth(tenantId, accountId, result.sessionString, result.user, "qr");
      res.json({ success: true, user: result.user });
    } else {
      await storage.updateTelegramAccount(accountId, { lastError: result.error });
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("Error verifying QR 2FA:", error);
    res.status(500).json({ error: error.message || "Failed to verify 2FA" });
  }
});

router.post("/api/telegram-personal/accounts/cancel-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
  try {
    const { sessionId, accountId } = req.body;
    const tenantId = (req as any).user?.tenantId;

    if (sessionId) {
      const { TelegramPersonalAdapter } = await import("../../services/telegram-personal-adapter");
      await TelegramPersonalAdapter.cancelAuth(sessionId);
    }

    if (accountId && tenantId) {
      const account = await storage.getTelegramAccountById(accountId);
      if (account && account.tenantId === tenantId && account.status !== "active") {
        await storage.deleteTelegramAccount(accountId);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error canceling auth:", error);
    res.json({ success: true });
  }
});

router.delete("/api/telegram-personal/accounts/:id", requireAuth, requirePermission("MANAGE_CHANNELS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const accountId = req.params.id;

    const account = await storage.getTelegramAccountById(accountId);
    if (!account || account.tenantId !== tenantId) {
      return res.status(404).json({ error: "Account not found" });
    }

    const { telegramClientManager } = await import("../../services/telegram-client-manager");
    await telegramClientManager.disconnectAccount(tenantId, accountId);

    await storage.deleteTelegramAccount(accountId);

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting Telegram account:", error);
    res.status(500).json({ error: error.message || "Failed to delete account" });
  }
});

router.patch("/api/telegram-personal/accounts/:id", requireAuth, requirePermission("MANAGE_CHANNELS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const accountId = req.params.id;
    const { isEnabled } = req.body;
    if (typeof isEnabled !== "boolean") return res.status(400).json({ error: "isEnabled (boolean) is required" });

    const account = await storage.getTelegramAccountById(accountId);
    if (!account || account.tenantId !== tenantId) {
      return res.status(404).json({ error: "Account not found" });
    }

    const { telegramClientManager } = await import("../../services/telegram-client-manager");

    if (!isEnabled) {
      await telegramClientManager.disconnectAccount(tenantId, accountId);
    }

    const updated = await storage.updateTelegramAccount(accountId, { isEnabled });

    if (isEnabled && account.status === "active" && account.sessionString) {
      const channelId = account.channelId || await ensureTelegramChannel(tenantId);
      await telegramClientManager.connectAccount(tenantId, accountId, channelId, account.sessionString);
    }

    res.json({ success: true, account: updated });
  } catch (error: any) {
    console.error("Error toggling Telegram account:", error);
    res.status(500).json({ error: error.message || "Failed to update account" });
  }
});

// Legacy endpoints (kept for backward compatibility)

router.post("/api/telegram-personal/start-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, requireTenant, async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body;
    const userTenantId = req.tenantId!;

    if (!phoneNumber) return res.status(400).json({ error: "Phone number is required" });

    const fraudCheck = await fraudDetectionService.validateChannelConnection(
      userTenantId, "telegram", { telegram: { botId: phoneNumber } }
    );
    if (!fraudCheck.allowed) {
      return res.status(403).json({ error: fraudCheck.message, code: "FRAUD_DETECTED" });
    }

    const sessionId = `tg_auth_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const { TelegramPersonalAdapter } = await import("../../services/telegram-personal-adapter");
    const result = await TelegramPersonalAdapter.startAuth(sessionId, phoneNumber);

    if (result.success) {
      res.json({ success: true, sessionId });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("Error starting Telegram auth:", error);
    res.status(500).json({ error: error.message || "Failed to start authentication" });
  }
});

router.post("/api/telegram-personal/verify-code", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, async (req: Request, res: Response) => {
  try {
    const { sessionId, phoneNumber, code } = req.body;
    if (!sessionId || !phoneNumber || !code) {
      return res.status(400).json({ error: "Session ID, phone number, and code are required" });
    }

    const { TelegramPersonalAdapter } = await import("../../services/telegram-personal-adapter");
    const result = await TelegramPersonalAdapter.verifyCode(sessionId, phoneNumber, code);

    if (result.success) {
      res.json({ success: true, sessionString: result.sessionString, user: result.user });
    } else if (result.needs2FA) {
      res.json({ success: false, needs2FA: true, sessionId });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("Error verifying Telegram code:", error);
    res.status(500).json({ error: error.message || "Failed to verify code" });
  }
});

router.post("/api/telegram-personal/verify-2fa", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, async (req: Request, res: Response) => {
  try {
    const { sessionId, password } = req.body;
    if (!sessionId || !password) {
      return res.status(400).json({ error: "Session ID and password are required" });
    }

    const { TelegramPersonalAdapter } = await import("../../services/telegram-personal-adapter");
    const result = await TelegramPersonalAdapter.verify2FA(sessionId, password);

    if (result.success) {
      res.json({ success: true, sessionString: result.sessionString, user: result.user });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    console.error("Error verifying 2FA:", error);
    res.status(500).json({ error: error.message || "Failed to verify 2FA" });
  }
});

router.post("/api/telegram-personal/cancel-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    if (sessionId) {
      const { TelegramPersonalAdapter } = await import("../../services/telegram-personal-adapter");
      await TelegramPersonalAdapter.cancelAuth(sessionId);
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error canceling auth:", error);
    res.json({ success: true });
  }
});

router.post("/api/telegram-personal/verify-session", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, async (req: Request, res: Response) => {
  try {
    const { sessionString } = req.body;
    if (!sessionString) return res.status(400).json({ error: "Session string is required" });

    const { TelegramPersonalAdapter } = await import("../../services/telegram-personal-adapter");
    const result = await TelegramPersonalAdapter.verifySession(sessionString);
    res.json(result);
  } catch (error: any) {
    console.error("Error verifying session:", error);
    res.status(500).json({ error: error.message || "Failed to verify session" });
  }
});

router.post("/api/telegram-personal/disconnect", requireAuth, requirePermission("MANAGE_CHANNELS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const existingChannels = await storage.getChannelsByTenant(tenantId);
    const channel = existingChannels.find(c => c.type === "telegram_personal");
    if (channel) {
      const { telegramClientManager } = await import("../../services/telegram-client-manager");
      await telegramClientManager.disconnect(tenantId, channel.id);
      await storage.updateChannel(channel.id, { config: {}, isActive: false });
    }
    channelConnectionCache.set("telegram_personal", {
      connected: false, botInfo: undefined, lastError: undefined, lastChecked: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error disconnecting Telegram Personal:", error);
    res.status(500).json({ error: error.message || "Failed to disconnect" });
  }
});

router.post("/api/telegram-personal/start-conversation", requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const { phoneNumber, initialMessage } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const cleanPhone = String(phoneNumber).replace(/[^\d+]/g, "");
    if (cleanPhone.length < 10 || cleanPhone.length > 15 || !/^\+?\d+$/.test(cleanPhone)) {
      return res.status(400).json({ error: "Invalid phone number format" });
    }

    const existingChannels = await storage.getChannelsByTenant(tenantId);
    const channel = existingChannels.find(c => c.type === "telegram_personal" && c.isActive);

    if (!channel) {
      return res.status(400).json({ error: "No active Telegram Personal channel" });
    }

    const { telegramClientManager } = await import("../../services/telegram-client-manager");
    const result = await telegramClientManager.startConversationByPhone(
      tenantId,
      channel.id,
      phoneNumber,
      initialMessage
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    let customer = await storage.getCustomerByExternalId(tenantId, "telegram_personal", result.userId!);
    if (!customer) {
      const resolveResult = await telegramClientManager.resolvePhoneNumber(tenantId, channel.id, phoneNumber);
      const customerName = resolveResult.success
        ? `${resolveResult.firstName || ""} ${resolveResult.lastName || ""}`.trim() || "Telegram User"
        : "Telegram User";

      try {
        customer = await storage.createCustomer({
          tenantId,
          externalId: result.userId!,
          name: customerName,
          channel: "telegram_personal",
          metadata: { phone: phoneNumber },
        }, tenantId);
      } catch (e: any) {
        customer = await storage.getCustomerByExternalId(tenantId, "telegram_personal", result.userId!);
        if (!customer) throw e;
      }
    }

    const allConversations = await storage.getConversationsByTenant(tenantId);
    let conversation: { id: string } | undefined = allConversations.find(c => c.customerId === customer!.id);

    if (!conversation) {
      conversation = await storage.createConversation({
        tenantId,
        customerId: customer.id,
        channelId: channel.id,
        status: "active",
        mode: "learning",
      }, tenantId);
    }

    res.json({
      success: true,
      conversationId: conversation!.id,
    });
  } catch (error: any) {
    console.error("Error starting Telegram conversation:", error);
    res.status(500).json({ error: error.message || "Failed to start conversation" });
  }
});

// Telegram Personal media proxy (MTProto)
router.get(
  "/api/telegram-personal/media/:accountId/:chatId/:msgId",
  requireAuth,
  requireTenant,
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;

      const { accountId, chatId, msgId } = req.params;
      const msgIdNum = parseInt(msgId, 10);
      if (isNaN(msgIdNum)) {
        return res.status(400).json({ error: "Invalid message ID" });
      }

      const { telegramClientManager } = await import("../../services/telegram-client-manager");

      let client = telegramClientManager.getClientForAccount(tenantId, accountId);
      if (!client) {
        const channels = await storage.getChannelsByTenant(tenantId);
        const tgChannel = channels.find((c) => c.type === "telegram_personal" && c.isActive);
        if (tgChannel) {
          client = telegramClientManager.getClient(tenantId, tgChannel.id);
        }
      }

      if (!client) {
        return res.status(503).json({ error: "Telegram account not connected" });
      }

      const messages = await client.getMessages(BigInt(chatId) as any, { ids: [msgIdNum] });
      const msg = messages?.[0];
      if (!msg) {
        return res.status(404).json({ error: "Message not found" });
      }

      const buffer = (await client.downloadMedia(msg, {})) as Buffer | undefined;
      if (!buffer || buffer.length === 0) {
        return res.status(404).json({ error: "Media not available" });
      }

      let contentType = "application/octet-stream";
      const media = msg.media;
      if (media && "document" in media && media.document && "mimeType" in (media.document as any)) {
        contentType = (media.document as any).mimeType || contentType;
      } else if (media && media instanceof (await import("telegram")).Api.MessageMediaPhoto) {
        contentType = "image/jpeg";
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(buffer);
    } catch (error: any) {
      console.error("[TelegramPersonalMediaProxy] Error:", error.message);
      res.status(500).json({ error: "Failed to download media" });
    }
  },
);

export default router;
