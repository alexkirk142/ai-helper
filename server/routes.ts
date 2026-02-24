import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { registerPhase0Routes } from "./routes/phase0";
import authRouter from "./routes/auth";
import adminRouter from "./routes/admin";
import maxWebhookRouter from "./routes/max-webhook";
import maxPersonalWebhookRouter from "./routes/max-personal-webhook";
import { telegramWebhookHandler } from "./routes/telegram-webhook";
import { whatsappWebhookHandler, whatsappWebhookVerifyHandler } from "./routes/whatsapp-webhook";
import { featureFlagService } from "./services/feature-flags";
import { auditLog } from "./services/audit-log";
import { webhookRateLimiter } from "./middleware/rate-limiter";
import { registerAuthRoutes } from "./routes/auth-api";
import { getSession } from "./session";
import cookieParser from "cookie-parser";
import { WhatsAppPersonalAdapter } from "./services/whatsapp-personal-adapter";
import { requireAuth, requirePermission } from "./middleware/rbac";
import { requireActiveSubscription } from "./middleware/subscription";
import { requireActiveTenant } from "./middleware/fraud-protection";
import { fraudDetectionService } from "./services/fraud-detection-service";
import { createTrackedApp } from "./services/route-registry";
import { csrfProtection, generateCsrfToken } from "./middleware/csrf";

// Domain route modules
import customerRouter from "./routes/customer.routes";
import conversationRouter from "./routes/conversation.routes";
import productRouter from "./routes/product.routes";
import knowledgeBaseRouter from "./routes/knowledge-base.routes";
import analyticsRouter from "./routes/analytics.routes";
import onboardingRouter from "./routes/onboarding.routes";
import billingRouter from "./routes/billing.routes";
import vehicleLookupRouter from "./routes/vehicle-lookup.routes";
import tenantConfigRouter from "./routes/tenant-config.routes";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  createTrackedApp(app);
  
  app.use(getSession());
  // cookie-parser must be registered after express-session (session parses its
  // own cookie internally and must not see it decoded first) and before csrf-csrf
  // (doubleCsrf reads req.cookies[cookieName] directly).
  app.use(cookieParser());

  // ============ CSRF PROTECTION ============
  // Applied after session (cookie ordering) but before every route.
  // GET /api/csrf-token must be registered BEFORE the middleware so clients
  // can fetch a fresh token without a prior token.  The endpoint is a GET
  // (safe method) so it is automatically exempt from CSRF validation.
  app.get("/api/csrf-token", (req: Request, res: Response) => {
    const token = generateCsrfToken(req, res);
    res.json({ token });
  });
  app.use(csrfProtection);

  registerAuthRoutes(app);
  
  // ============ DOMAIN ROUTE MODULES ============
  app.use(customerRouter);
  app.use(conversationRouter);
  app.use(productRouter);
  app.use(knowledgeBaseRouter);
  app.use(analyticsRouter);
  app.use(onboardingRouter);
  app.use(billingRouter);
  app.use(vehicleLookupRouter);
  app.use(tenantConfigRouter);

  // ============ CHANNEL MANAGEMENT ROUTES ============

  const channelConnectionCache = new Map<string, {
    connected: boolean;
    botInfo?: { user_id?: number; first_name?: string; username?: string };
    lastError?: string;
    lastChecked?: string;
  }>();

  app.get("/api/channels/status", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const maxToken = process.env.MAX_TOKEN;
      const maxCache = channelConnectionCache.get("max");
      
      const statuses = [
        {
          channel: "max",
          enabled: await featureFlagService.isEnabled("MAX_CHANNEL_ENABLED"),
          connected: maxCache?.connected ?? !!maxToken,
          lastError: maxCache?.lastError,
          botInfo: maxCache?.botInfo,
        },
        {
          channel: "telegram",
          enabled: await featureFlagService.isEnabled("TELEGRAM_CHANNEL_ENABLED"),
          connected: channelConnectionCache.get("telegram")?.connected ?? !!process.env.TELEGRAM_BOT_TOKEN,
          lastError: channelConnectionCache.get("telegram")?.lastError,
          botInfo: channelConnectionCache.get("telegram")?.botInfo,
        },
        await (async () => {
          const { telegramClientManager } = await import("./services/telegram-client-manager");
          const tenantId = (req as any).user?.tenantId;
          
          let isConnected = false;
          let botInfo = channelConnectionCache.get("telegram_personal")?.botInfo;
          let accountCount = 0;
          
          if (tenantId) {
            const accounts = await storage.getTelegramAccountsByTenant(tenantId);
            const activeAccounts = accounts.filter(a => a.status === "active" && a.isEnabled);
            accountCount = activeAccounts.length;
            
            for (const acc of activeAccounts) {
              if (telegramClientManager.isAccountConnected(tenantId, acc.id)) {
                isConnected = true;
                if (!botInfo && acc.firstName) {
                  botInfo = {
                    user_id: acc.userId ? parseInt(acc.userId, 10) : undefined,
                    first_name: acc.firstName,
                    username: acc.username || undefined,
                  };
                }
                break;
              }
            }

            if (!isConnected) {
              const channels = await storage.getChannelsByTenant(tenantId);
              const tgChannel = channels.find(c => c.type === "telegram_personal");
              if (tgChannel) {
                const verification = await telegramClientManager.verifyConnection(tenantId, tgChannel.id);
                isConnected = verification.connected;
                if (verification.user) {
                  botInfo = {
                    user_id: verification.user.id,
                    first_name: verification.user.firstName,
                    username: verification.user.username,
                  };
                } else {
                  const config = tgChannel.config as { user?: { id?: number; firstName?: string; username?: string } } | null;
                  if (config?.user) {
                    botInfo = { user_id: config.user.id, first_name: config.user.firstName, username: config.user.username };
                  }
                }
              }
            }
          }
          
          return {
            channel: "telegram_personal",
            enabled: await featureFlagService.isEnabled("TELEGRAM_PERSONAL_CHANNEL_ENABLED"),
            connected: isConnected,
            lastError: channelConnectionCache.get("telegram_personal")?.lastError,
            botInfo,
            accountCount,
          };
        })(),
        {
          channel: "whatsapp",
          enabled: await featureFlagService.isEnabled("WHATSAPP_CHANNEL_ENABLED"),
          connected: channelConnectionCache.get("whatsapp")?.connected ?? (!!process.env.WHATSAPP_ACCESS_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID),
          lastError: channelConnectionCache.get("whatsapp")?.lastError,
          botInfo: channelConnectionCache.get("whatsapp")?.botInfo,
        },
        await (async () => {
          const waPersonalUser = req.userId ? await storage.getUser(req.userId) : undefined;
          const tenantId = waPersonalUser?.tenantId || "default";
          const sessionInfo = WhatsAppPersonalAdapter.getSessionInfo(tenantId);
          
          return {
            channel: "whatsapp_personal",
            enabled: await featureFlagService.isEnabled("WHATSAPP_PERSONAL_CHANNEL_ENABLED"),
            connected: WhatsAppPersonalAdapter.isConnected(tenantId),
            lastError: channelConnectionCache.get("whatsapp_personal")?.lastError,
            botInfo: sessionInfo.user ? {
              user_id: parseInt(sessionInfo.user.id.split(":")[0], 10) || 0,
              first_name: sessionInfo.user.name,
              username: sessionInfo.user.phone,
            } : channelConnectionCache.get("whatsapp_personal")?.botInfo,
          };
        })(),
        await (async () => {
          const mpUser = req.userId ? await storage.getUser(req.userId) : undefined;
          const mpTenantId = mpUser?.tenantId;
          let mpConnected = false;
          let mpAccounts: Array<{ displayName?: string | null; label?: string | null }> = [];
          if (mpTenantId) {
            try {
              const { db } = await import("./db");
              const { maxPersonalAccounts } = await import("@shared/schema");
              const { eq } = await import("drizzle-orm");
              const rows = await db.select().from(maxPersonalAccounts)
                .where(eq(maxPersonalAccounts.tenantId, mpTenantId));
              const authorized = rows.filter((a) => a.status === "authorized");
              if (authorized.length > 0) {
                mpConnected = true;
                mpAccounts = authorized.map((a) => ({ displayName: a.displayName, label: a.label }));
              }
            } catch {
              // ignore — DB may not have the table yet
            }
          }
          return {
            channel: "max_personal",
            enabled: await featureFlagService.isEnabled("MAX_PERSONAL_CHANNEL_ENABLED"),
            connected: mpConnected,
            // Legacy single-account field kept for backwards compat
            botInfo: mpAccounts[0] ? { first_name: mpAccounts[0].displayName ?? undefined } : undefined,
            accounts: mpAccounts,
          };
        })(),
      ];

      res.json(statuses);
    } catch (error) {
      console.error("Error fetching channel status:", error);
      res.status(500).json({ error: "Failed to fetch channel status" });
    }
  });

  app.get("/api/channels/feature-flags", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const flags = {
        MAX_CHANNEL_ENABLED: await featureFlagService.isEnabled("MAX_CHANNEL_ENABLED"),
        MAX_PERSONAL_CHANNEL_ENABLED: await featureFlagService.isEnabled("MAX_PERSONAL_CHANNEL_ENABLED"),
        TELEGRAM_CHANNEL_ENABLED: await featureFlagService.isEnabled("TELEGRAM_CHANNEL_ENABLED"),
        TELEGRAM_PERSONAL_CHANNEL_ENABLED: await featureFlagService.isEnabled("TELEGRAM_PERSONAL_CHANNEL_ENABLED"),
        WHATSAPP_CHANNEL_ENABLED: await featureFlagService.isEnabled("WHATSAPP_CHANNEL_ENABLED"),
        WHATSAPP_PERSONAL_CHANNEL_ENABLED: await featureFlagService.isEnabled("WHATSAPP_PERSONAL_CHANNEL_ENABLED"),
      };

      res.json(flags);
    } catch (error) {
      console.error("Error fetching channel feature flags:", error);
      res.status(500).json({ error: "Failed to fetch channel feature flags" });
    }
  });

  app.post("/api/channels/:channel/toggle", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, async (req: Request, res: Response) => {
    try {
      const { channel } = req.params;
      const { enabled } = req.body;

      const flagNameMap: Record<string, string> = {
        max: "MAX_CHANNEL_ENABLED",
        max_personal: "MAX_PERSONAL_CHANNEL_ENABLED",
        telegram: "TELEGRAM_CHANNEL_ENABLED",
        telegram_personal: "TELEGRAM_PERSONAL_CHANNEL_ENABLED",
        whatsapp: "WHATSAPP_CHANNEL_ENABLED",
        whatsapp_personal: "WHATSAPP_PERSONAL_CHANNEL_ENABLED",
      };

      const flagName = flagNameMap[channel];
      if (!flagName) {
        return res.status(400).json({ error: "Unknown channel" });
      }

      await featureFlagService.setFlag(flagName, enabled);

      await auditLog.log(
        "feature_flag_toggled" as any,
        "channel",
        channel,
        "system",
        "system",
        { flagName, enabled }
      );

      res.json({ success: true, channel, enabled });
    } catch (error) {
      console.error("Error toggling channel:", error);
      res.status(500).json({ error: "Failed to toggle channel" });
    }
  });

  app.post("/api/channels/:channel/config", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, async (req: Request, res: Response) => {
    try {
      const { channel } = req.params;
      const { token, webhookSecret, accessToken, phoneNumberId, verifyToken, appSecret } = req.body;

      if (channel !== "max" && channel !== "telegram" && channel !== "whatsapp") {
        return res.status(400).json({ error: "Channel configuration not supported yet" });
      }

      const user = await storage.getUserByOidcId(req.userId!) || await storage.getUser(req.userId!);
      const userTenantId = user?.tenantId;

      if (!userTenantId) {
        return res.status(403).json({ error: "User not associated with a tenant" });
      }

      const hasChannelCredentials = token || accessToken || phoneNumberId;
      if (hasChannelCredentials) {
        const channelType = channel === "telegram" ? "telegram" : channel === "max" ? "max" : "whatsapp_business";
        let fingerprintInput;
        
        if (channel === "telegram") {
          fingerprintInput = { telegram: { botToken: token } };
        } else if (channel === "max") {
          fingerprintInput = { max: { workspaceId: token } };
        } else {
          fingerprintInput = { whatsapp_business: { businessId: accessToken, phoneNumber: phoneNumberId } };
        }
        
        const fraudCheck = await fraudDetectionService.validateChannelConnection(
          userTenantId,
          channelType as any,
          fingerprintInput
        );

        if (!fraudCheck.allowed) {
          return res.status(403).json({ 
            error: fraudCheck.message,
            code: "FRAUD_DETECTED"
          });
        }
      }

      await auditLog.log(
        "channel_config_updated" as any,
        "channel",
        channel,
        "system",
        "system",
        { hasToken: !!token, hasWebhookSecret: !!webhookSecret, hasAccessToken: !!accessToken, hasPhoneNumberId: !!phoneNumberId }
      );

      if (channel === "whatsapp") {
        const secretsNeeded = [];
        if (accessToken) secretsNeeded.push("WHATSAPP_ACCESS_TOKEN");
        if (phoneNumberId) secretsNeeded.push("WHATSAPP_PHONE_NUMBER_ID");
        if (verifyToken) secretsNeeded.push("WHATSAPP_VERIFY_TOKEN");
        if (appSecret) secretsNeeded.push("WHATSAPP_APP_SECRET");
        
        res.json({ 
          success: true, 
          message: `Для применения конфигурации добавьте следующие секреты: ${secretsNeeded.join(", ")}. После этого перезапустите приложение.` 
        });
        return;
      }

      const secretName = channel === "max" ? "MAX_TOKEN" : "TELEGRAM_BOT_TOKEN";
      res.json({ 
        success: true, 
        message: `Для применения токена добавьте его в Secrets (${secretName}). После этого перезапустите приложение.` 
      });
    } catch (error) {
      console.error("Error saving channel config:", error);
      res.status(500).json({ error: "Failed to save channel config" });
    }
  });

  app.post("/api/channels/:channel/test", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const { channel } = req.params;
      const { token } = req.body;

      if (channel === "max") {
        const { MaxAdapter } = await import("./services/max-adapter");
        const testAdapter = new MaxAdapter(token || process.env.MAX_TOKEN);
        const result = await testAdapter.verifyAuth();

        if (result.success && result.botInfo) {
          channelConnectionCache.set("max", {
            connected: true,
            botInfo: {
              user_id: result.botInfo.user_id,
              first_name: result.botInfo.first_name,
              username: result.botInfo.username || undefined,
            },
            lastError: undefined,
            lastChecked: new Date().toISOString(),
          });
        } else {
          channelConnectionCache.set("max", {
            connected: false,
            botInfo: undefined,
            lastError: result.error,
            lastChecked: new Date().toISOString(),
          });
        }

        res.json(result);
        return;
      }

      if (channel === "telegram") {
        const { TelegramAdapter } = await import("./services/telegram-adapter");
        const testAdapter = new TelegramAdapter(token || process.env.TELEGRAM_BOT_TOKEN);
        const result = await testAdapter.verifyAuth();

        if (result.success && result.botInfo) {
          channelConnectionCache.set("telegram", {
            connected: true,
            botInfo: {
              user_id: result.botInfo.id,
              first_name: result.botInfo.first_name,
              username: result.botInfo.username,
            },
            lastError: undefined,
            lastChecked: new Date().toISOString(),
          });
        } else {
          channelConnectionCache.set("telegram", {
            connected: false,
            botInfo: undefined,
            lastError: result.error,
            lastChecked: new Date().toISOString(),
          });
        }

        res.json(result);
        return;
      }

      if (channel === "whatsapp") {
        const { whatsappAdapter } = await import("./services/whatsapp-adapter");
        const result = await whatsappAdapter.testConnection();

        if (result.success) {
          channelConnectionCache.set("whatsapp", {
            connected: true,
            botInfo: undefined,
            lastError: undefined,
            lastChecked: new Date().toISOString(),
          });
        } else {
          channelConnectionCache.set("whatsapp", {
            connected: false,
            botInfo: undefined,
            lastError: result.error,
            lastChecked: new Date().toISOString(),
          });
        }

        res.json(result);
        return;
      }

      return res.status(400).json({ error: "Channel test not supported yet" });
    } catch (error) {
      console.error("Error testing channel:", error);
      res.status(500).json({ error: "Failed to test channel connection" });
    }
  });

  // ============ TELEGRAM PERSONAL AUTH ROUTES ============

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
    authMethod: "qr" | "phone"
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

    const { telegramClientManager } = await import("./services/telegram-client-manager");
    await telegramClientManager.connectAccount(tenantId, accountId, channelId, sessionString);

    telegramClientManager.syncDialogs(tenantId, channelId, { limit: 50, messageLimit: 20 })
      .then(syncResult => {
        console.log(`[TelegramPersonal] Sync complete: ${syncResult.dialogsImported} dialogs, ${syncResult.messagesImported} messages`);
      })
      .catch(err => {
        console.error(`[TelegramPersonal] Sync error:`, err.message);
      });
  }

  // --- Multi-account: List accounts ---
  app.get("/api/telegram-personal/accounts", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).user?.tenantId;
      if (!tenantId) return res.status(403).json({ error: "User not associated with a tenant" });

      const accounts = await storage.getTelegramAccountsByTenant(tenantId);
      const { telegramClientManager } = await import("./services/telegram-client-manager");

      const result = accounts.map(a => ({
        id: a.id,
        phoneNumber: a.phoneNumber,
        firstName: a.firstName,
        lastName: a.lastName,
        username: a.username,
        userId: a.userId,
        status: a.status,
        authMethod: a.authMethod,
        isEnabled: a.isEnabled,
        isConnected: a.status === "active" && a.isEnabled && telegramClientManager.isAccountConnected(tenantId, a.id),
        createdAt: a.createdAt,
      }));

      res.json({ accounts: result });
    } catch (error: any) {
      console.error("Error listing Telegram accounts:", error);
      res.status(500).json({ error: error.message || "Failed to list accounts" });
    }
  });

  // --- Multi-account: Start phone auth ---
  app.post("/api/telegram-personal/accounts/send-code", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, async (req: Request, res: Response) => {
    try {
      const { phoneNumber } = req.body;
      const tenantId = (req as any).user?.tenantId;

      if (!phoneNumber) return res.status(400).json({ error: "Phone number is required" });
      if (!tenantId) return res.status(403).json({ error: "User not associated with a tenant" });

      const fraudCheck = await fraudDetectionService.validateChannelConnection(
        tenantId, "telegram", { telegram: { botId: phoneNumber } }
      );
      if (!fraudCheck.allowed) {
        return res.status(403).json({ error: fraudCheck.message, code: "FRAUD_DETECTED" });
      }

      const existingAccounts = await storage.getTelegramAccountsByTenant(tenantId);
      const activeAccounts = existingAccounts.filter(a => a.status === "active" || a.status === "pending" || a.status === "awaiting_code" || a.status === "awaiting_2fa");
      if (activeAccounts.length >= 5) {
        return res.status(400).json({ error: "Maximum 5 Telegram accounts per tenant" });
      }

      const account = await storage.createTelegramAccount({
        tenantId,
        phoneNumber,
        status: "awaiting_code",
        authMethod: "phone",
      });

      const sessionId = `tg_phone_${account.id}`;

      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
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

  // --- Multi-account: Verify phone code ---
  app.post("/api/telegram-personal/accounts/verify-code", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, async (req: Request, res: Response) => {
    try {
      const { accountId, sessionId, phoneNumber, code } = req.body;
      const tenantId = (req as any).user?.tenantId;

      if (!sessionId || !phoneNumber || !code || !accountId) {
        return res.status(400).json({ error: "accountId, sessionId, phoneNumber, and code are required" });
      }
      if (!tenantId) return res.status(403).json({ error: "User not associated with a tenant" });

      const account = await storage.getTelegramAccountById(accountId);
      if (!account || account.tenantId !== tenantId) {
        return res.status(404).json({ error: "Account not found" });
      }

      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
      const result = await TelegramPersonalAdapter.verifyCode(sessionId, phoneNumber, code);

      if (result.success && result.sessionString) {
        await finalizeAccountAuth(tenantId, accountId, result.sessionString, result.user, "phone");
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

  // --- Multi-account: Verify 2FA password (phone auth) ---
  app.post("/api/telegram-personal/accounts/verify-password", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, async (req: Request, res: Response) => {
    try {
      const { accountId, sessionId, password } = req.body;
      const tenantId = (req as any).user?.tenantId;

      if (!sessionId || !password || !accountId) {
        return res.status(400).json({ error: "accountId, sessionId, and password are required" });
      }
      if (!tenantId) return res.status(403).json({ error: "User not associated with a tenant" });

      const account = await storage.getTelegramAccountById(accountId);
      if (!account || account.tenantId !== tenantId) {
        return res.status(404).json({ error: "Account not found" });
      }

      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
      const result = await TelegramPersonalAdapter.verify2FA(sessionId, password);

      if (result.success && result.sessionString) {
        await finalizeAccountAuth(tenantId, accountId, result.sessionString, result.user, "phone");
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

  // --- Multi-account: Start QR auth ---
  app.post("/api/telegram-personal/accounts/start-qr", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).user?.tenantId;
      if (!tenantId) return res.status(403).json({ error: "User not associated with a tenant" });

      const existingAccounts = await storage.getTelegramAccountsByTenant(tenantId);
      const activeAccounts = existingAccounts.filter(a => a.status === "active" || a.status === "pending" || a.status === "awaiting_code" || a.status === "awaiting_2fa");
      if (activeAccounts.length >= 5) {
        return res.status(400).json({ error: "Maximum 5 Telegram accounts per tenant" });
      }

      const account = await storage.createTelegramAccount({
        tenantId,
        status: "pending",
        authMethod: "qr",
      });

      const sessionId = `tg_qr_${account.id}`;

      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
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

  // --- Multi-account: Check QR auth status ---
  app.post("/api/telegram-personal/accounts/check-qr", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const { sessionId, accountId } = req.body;
      const tenantId = (req as any).user?.tenantId;

      if (!sessionId || !accountId) return res.status(400).json({ error: "sessionId and accountId are required" });
      if (!tenantId) return res.status(403).json({ error: "User not associated with a tenant" });

      const account = await storage.getTelegramAccountById(accountId);
      if (!account || account.tenantId !== tenantId) {
        return res.status(404).json({ error: "Account not found" });
      }

      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
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

  // --- Multi-account: Verify 2FA for QR auth ---
  app.post("/api/telegram-personal/accounts/verify-qr-2fa", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const { sessionId, accountId, password } = req.body;
      const tenantId = (req as any).user?.tenantId;

      if (!sessionId || !password || !accountId) {
        return res.status(400).json({ error: "sessionId, accountId, and password are required" });
      }
      if (!tenantId) return res.status(403).json({ error: "User not associated with a tenant" });

      const account = await storage.getTelegramAccountById(accountId);
      if (!account || account.tenantId !== tenantId) {
        return res.status(404).json({ error: "Account not found" });
      }

      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
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

  // --- Multi-account: Cancel auth ---
  app.post("/api/telegram-personal/accounts/cancel-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const { sessionId, accountId } = req.body;
      const tenantId = (req as any).user?.tenantId;

      if (sessionId) {
        const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
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

  // --- Multi-account: Delete/disconnect account ---
  app.delete("/api/telegram-personal/accounts/:id", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).user?.tenantId;
      const accountId = req.params.id;

      if (!tenantId) return res.status(403).json({ error: "User not associated with a tenant" });

      const account = await storage.getTelegramAccountById(accountId);
      if (!account || account.tenantId !== tenantId) {
        return res.status(404).json({ error: "Account not found" });
      }

      const { telegramClientManager } = await import("./services/telegram-client-manager");
      await telegramClientManager.disconnectAccount(tenantId, accountId);

      await storage.deleteTelegramAccount(accountId);

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting Telegram account:", error);
      res.status(500).json({ error: error.message || "Failed to delete account" });
    }
  });

  // --- Multi-account: Toggle account enabled/disabled ---
  app.patch("/api/telegram-personal/accounts/:id", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).user?.tenantId;
      const accountId = req.params.id;
      const { isEnabled } = req.body;

      if (!tenantId) return res.status(403).json({ error: "User not associated with a tenant" });
      if (typeof isEnabled !== "boolean") return res.status(400).json({ error: "isEnabled (boolean) is required" });

      const account = await storage.getTelegramAccountById(accountId);
      if (!account || account.tenantId !== tenantId) {
        return res.status(404).json({ error: "Account not found" });
      }

      const { telegramClientManager } = await import("./services/telegram-client-manager");

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

  // --- Legacy endpoints (kept for backward compatibility) ---

  app.post("/api/telegram-personal/start-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, async (req: Request, res: Response) => {
    try {
      const { phoneNumber } = req.body;
      const user = await storage.getUserByOidcId(req.userId!) || await storage.getUser(req.userId!);
      const userTenantId = user?.tenantId;

      if (!phoneNumber) return res.status(400).json({ error: "Phone number is required" });
      if (!userTenantId) return res.status(403).json({ error: "User not associated with a tenant" });

      const fraudCheck = await fraudDetectionService.validateChannelConnection(
        userTenantId, "telegram", { telegram: { botId: phoneNumber } }
      );
      if (!fraudCheck.allowed) {
        return res.status(403).json({ error: fraudCheck.message, code: "FRAUD_DETECTED" });
      }

      const sessionId = `tg_auth_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
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

  app.post("/api/telegram-personal/verify-code", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, async (req: Request, res: Response) => {
    try {
      const { sessionId, phoneNumber, code } = req.body;
      if (!sessionId || !phoneNumber || !code) {
        return res.status(400).json({ error: "Session ID, phone number, and code are required" });
      }

      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
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

  app.post("/api/telegram-personal/verify-2fa", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, async (req: Request, res: Response) => {
    try {
      const { sessionId, password } = req.body;
      if (!sessionId || !password) {
        return res.status(400).json({ error: "Session ID and password are required" });
      }

      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
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

  app.post("/api/telegram-personal/cancel-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body;
      if (sessionId) {
        const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
        await TelegramPersonalAdapter.cancelAuth(sessionId);
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error canceling auth:", error);
      res.json({ success: true });
    }
  });

  app.post("/api/telegram-personal/verify-session", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, async (req: Request, res: Response) => {
    try {
      const { sessionString } = req.body;
      if (!sessionString) return res.status(400).json({ error: "Session string is required" });

      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
      const result = await TelegramPersonalAdapter.verifySession(sessionString);
      res.json(result);
    } catch (error: any) {
      console.error("Error verifying session:", error);
      res.status(500).json({ error: error.message || "Failed to verify session" });
    }
  });

  app.post("/api/telegram-personal/start-qr-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const sessionId = `qr_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
      const result = await TelegramPersonalAdapter.startQrAuth(sessionId);

      if (result.success && result.qrUrl) {
        const QRCode = await import("qrcode");
        const qrImageDataUrl = await QRCode.toDataURL(result.qrUrl, {
          width: 256, margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
        });
        res.json({ success: true, sessionId, qrImageDataUrl, qrUrl: result.qrUrl, expiresAt: result.expiresAt });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error("Error starting QR auth:", error);
      res.status(500).json({ error: error.message || "Failed to start QR auth" });
    }
  });

  app.post("/api/telegram-personal/check-qr-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ error: "Session ID is required" });

      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
      const result = await TelegramPersonalAdapter.checkQrAuth(sessionId);

      if (result.status === "authorized" && result.sessionString) {
        const tenantId = (req as any).user?.tenantId;
        if (tenantId) {
          const existingChannels = await storage.getChannelsByTenant(tenantId);
          let channel = existingChannels.find(c => c.type === "telegram_personal");
          if (channel) {
            await storage.updateChannel(channel.id, {
              config: { sessionData: result.sessionString, user: result.user },
              isActive: true,
            });
          } else {
            channel = await storage.createChannel({
              tenantId, type: "telegram_personal",
              name: `Telegram Personal (${result.user?.firstName || "Connected"})`,
              config: { sessionData: result.sessionString, user: result.user },
              isActive: true,
            });
          }
          const { telegramClientManager } = await import("./services/telegram-client-manager");
          await telegramClientManager.connect(tenantId, channel.id, result.sessionString);
          telegramClientManager.syncDialogs(tenantId, channel.id, { limit: 50, messageLimit: 20 }).catch(() => {});
        }
        channelConnectionCache.set("telegram_personal", {
          connected: true,
          botInfo: result.user ? { user_id: result.user.id, first_name: result.user.firstName, username: result.user.username } : undefined,
          lastError: undefined, lastChecked: new Date().toISOString(),
        });
      }

      if (result.qrUrl) {
        const QRCode = await import("qrcode");
        const qrImageDataUrl = await QRCode.toDataURL(result.qrUrl, {
          width: 256, margin: 2, color: { dark: "#000000", light: "#ffffff" },
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

  app.post("/api/telegram-personal/verify-qr-2fa", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const { sessionId, password } = req.body;
      if (!sessionId || !password) return res.status(400).json({ error: "Session ID and password are required" });

      const { TelegramPersonalAdapter } = await import("./services/telegram-personal-adapter");
      const result = await TelegramPersonalAdapter.verify2FAForQr(sessionId, password);

      if (result.success && result.sessionString) {
        const tenantId = (req as any).user?.tenantId;
        if (tenantId) {
          const existingChannels = await storage.getChannelsByTenant(tenantId);
          let channel = existingChannels.find(c => c.type === "telegram_personal");
          if (channel) {
            await storage.updateChannel(channel.id, {
              config: { sessionData: result.sessionString, user: result.user }, isActive: true,
            });
          } else {
            channel = await storage.createChannel({
              tenantId, type: "telegram_personal",
              name: `Telegram Personal (${result.user?.firstName || "Connected"})`,
              config: { sessionData: result.sessionString, user: result.user }, isActive: true,
            });
          }
          const { telegramClientManager } = await import("./services/telegram-client-manager");
          await telegramClientManager.connect(tenantId, channel.id, result.sessionString);
          telegramClientManager.syncDialogs(tenantId, channel.id, { limit: 50, messageLimit: 20 }).catch(() => {});
        }
        channelConnectionCache.set("telegram_personal", {
          connected: true,
          botInfo: result.user ? { user_id: result.user.id, first_name: result.user.firstName, username: result.user.username } : undefined,
          lastError: undefined, lastChecked: new Date().toISOString(),
        });
        res.json({ success: true, sessionString: result.sessionString, user: result.user });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error("Error verifying QR 2FA:", error);
      res.status(500).json({ error: error.message || "Failed to verify 2FA" });
    }
  });

  app.post("/api/telegram-personal/disconnect", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).user?.tenantId;
      if (!tenantId) return res.status(403).json({ error: "User not associated with a tenant" });

      const existingChannels = await storage.getChannelsByTenant(tenantId);
      const channel = existingChannels.find(c => c.type === "telegram_personal");
      if (channel) {
        const { telegramClientManager } = await import("./services/telegram-client-manager");
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

  app.post("/api/telegram-personal/start-conversation", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).user?.tenantId;
      
      if (!tenantId) {
        return res.status(403).json({ error: "User not associated with a tenant" });
      }

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

      const { telegramClientManager } = await import("./services/telegram-client-manager");
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
          });
        } catch (e: any) {
          customer = await storage.getCustomerByExternalId(tenantId, "telegram_personal", result.userId!);
          if (!customer) throw e;
        }
      }

      const allConversations = await storage.getConversationsByTenant(tenantId);
      let conversation = allConversations.find(c => c.customerId === customer!.id);

      if (!conversation) {
        conversation = await storage.createConversation({
          tenantId,
          customerId: customer.id,
          channelId: channel.id,
          status: "active",
          mode: "learning",
        });
      }

      res.json({ 
        success: true, 
        conversationId: conversation.id,
      });
    } catch (error: any) {
      console.error("Error starting Telegram conversation:", error);
      res.status(500).json({ error: error.message || "Failed to start conversation" });
    }
  });

  // ============ MAX PERSONAL — OUTBOUND CONVERSATION ============

  app.get("/api/channels/personal-status", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).user?.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: "User not associated with a tenant" });
      }

      // telegram_personal — check via active connected sessions
      const { telegramClientManager } = await import("./services/telegram-client-manager");
      const tgAccounts = await storage.getTelegramAccountsByTenant(tenantId);
      const tgActive = tgAccounts.filter((a) => a.status === "active" && a.isEnabled);
      let tgConnected = false;
      for (const acc of tgActive) {
        if (telegramClientManager.isAccountConnected(tenantId, acc.id)) {
          tgConnected = true;
          break;
        }
      }

      // max_personal — check authorized accounts
      const { db: dbInstance } = await import("./db");
      const { maxPersonalAccounts: mpAccTable } = await import("@shared/schema");
      const { eq: eqFn, and: andFn } = await import("drizzle-orm");
      const mpRows = await dbInstance.select().from(mpAccTable).where(
        andFn(
          eqFn(mpAccTable.tenantId, tenantId),
          eqFn(mpAccTable.status, "authorized"),
        ),
      );

      res.json({ telegram_personal: tgConnected, max_personal: mpRows.length > 0 });
    } catch (error: any) {
      console.error("Error fetching personal channel status:", error);
      res.status(500).json({ error: "Failed to fetch channel status" });
    }
  });

  app.post("/api/max-personal/start-conversation", requireAuth, async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).user?.tenantId;
      if (!tenantId) {
        return res.status(403).json({ error: "User not associated with a tenant" });
      }

      const { phoneNumber, initialMessage } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({ error: "Phone number is required" });
      }

      const cleanDigits = String(phoneNumber).replace(/\D/g, "");
      if (cleanDigits.length < 10 || cleanDigits.length > 15) {
        return res.status(400).json({ error: "Invalid phone number format" });
      }

      // GREEN-API chatId format: "79991234567@c.us"
      const chatId = `${cleanDigits}@c.us`;

      // Find authorized MAX Personal account for this tenant
      const { db: dbInst } = await import("./db");
      const { maxPersonalAccounts: mpTable } = await import("@shared/schema");
      const { eq: eqOp, and: andOp } = await import("drizzle-orm");
      const account = await dbInst.query.maxPersonalAccounts.findFirst({
        where: andOp(
          eqOp(mpTable.tenantId, tenantId),
          eqOp(mpTable.status, "authorized"),
        ),
      });

      if (!account) {
        return res.status(400).json({ error: "No active MAX Personal account connected" });
      }

      // Upsert customer by chatId
      let customer = await storage.getCustomerByExternalId(tenantId, "max_personal", chatId);
      if (!customer) {
        try {
          customer = await storage.createCustomer({
            tenantId,
            externalId: chatId,
            name: `WhatsApp +${cleanDigits}`,
            channel: "max_personal",
            phone: `+${cleanDigits}`,
            metadata: {},
          });
        } catch (e: any) {
          customer = await storage.getCustomerByExternalId(tenantId, "max_personal", chatId);
          if (!customer) throw e;
        }
      }

      // Upsert conversation by customerId
      const allConversations = await storage.getConversationsByTenant(tenantId);
      let conversation = allConversations.find((c) => c.customerId === customer!.id);

      if (!conversation) {
        conversation = await storage.createConversation({
          tenantId,
          customerId: customer.id,
          status: "active",
          mode: "learning",
        });
      }

      // Send initial message if provided
      if (initialMessage && String(initialMessage).trim()) {
        const trimmed = String(initialMessage).trim();
        const { maxPersonalAdapter } = await import("./services/max-personal-adapter");
        const sendResult = await maxPersonalAdapter.sendMessageForTenant(tenantId, chatId, trimmed);
        if (sendResult.success) {
          await storage.createMessage({
            conversationId: conversation.id,
            role: "assistant",
            content: trimmed,
            metadata: { isOutbound: true, externalMessageId: sendResult.externalMessageId ?? null },
          });
        }
      }

      res.json({ success: true, conversationId: conversation.id });
    } catch (error: any) {
      console.error("Error starting MAX Personal conversation:", error);
      res.status(500).json({ error: error.message || "Failed to start conversation" });
    }
  });

  // ============ TELEGRAM FILE PROXY (Bot API) ============

  app.get("/api/telegram/file/:fileId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { fileId } = req.params;
      if (!fileId || typeof fileId !== "string") {
        return res.status(400).json({ error: "Invalid file ID" });
      }

      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) {
        return res.status(503).json({ error: "Telegram Bot API not configured" });
      }

      // Step 1: resolve file_path from Telegram
      const getFileResp = await fetch(
        `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
      );
      if (!getFileResp.ok) {
        return res.status(502).json({ error: "Failed to resolve file from Telegram" });
      }
      const getFileJson = (await getFileResp.json()) as { ok: boolean; result?: { file_path: string } };
      if (!getFileJson.ok || !getFileJson.result?.file_path) {
        return res.status(404).json({ error: "File not found on Telegram" });
      }

      // Step 2: stream the file from Telegram CDN
      const fileUrl = `https://api.telegram.org/file/bot${token}/${getFileJson.result.file_path}`;
      const fileResp = await fetch(fileUrl);
      if (!fileResp.ok || !fileResp.body) {
        return res.status(502).json({ error: "Failed to fetch file content" });
      }

      const contentType = fileResp.headers.get("content-type") || "application/octet-stream";
      const contentLength = fileResp.headers.get("content-length");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      if (contentLength) res.setHeader("Content-Length", contentLength);

      const { Readable } = await import("stream");
      const nodeStream = Readable.fromWeb(fileResp.body as any);
      nodeStream.pipe(res);
    } catch (error: any) {
      console.error("[TelegramFileProxy] Error:", error.message);
      res.status(500).json({ error: "Failed to proxy file" });
    }
  });

  // ============ TELEGRAM PERSONAL MEDIA PROXY (MTProto) ============

  app.get(
    "/api/telegram-personal/media/:accountId/:chatId/:msgId",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.userId!);
        const tenantId = user?.tenantId;
        if (!tenantId) {
          return res.status(403).json({ error: "User not associated with a tenant" });
        }

        const { accountId, chatId, msgId } = req.params;
        const msgIdNum = parseInt(msgId, 10);
        if (isNaN(msgIdNum)) {
          return res.status(400).json({ error: "Invalid message ID" });
        }

        const { telegramClientManager } = await import("./services/telegram-client-manager");

        // Try both the accountId directly and legacy format
        let client = telegramClientManager.getClientForAccount(tenantId, accountId);
        if (!client) {
          // Fallback: accountId might be legacy_channelId — resolve channel
          const channels = await storage.getChannelsByTenant(tenantId);
          const tgChannel = channels.find((c) => c.type === "telegram_personal" && c.isActive);
          if (tgChannel) {
            client = telegramClientManager.getClient(tenantId, tgChannel.id);
          }
        }

        if (!client) {
          return res.status(503).json({ error: "Telegram account not connected" });
        }

        const messages = await client.getMessages(BigInt(chatId), { ids: [msgIdNum] });
        const msg = messages?.[0];
        if (!msg) {
          return res.status(404).json({ error: "Message not found" });
        }

        const buffer = (await client.downloadMedia(msg, {})) as Buffer | undefined;
        if (!buffer || buffer.length === 0) {
          return res.status(404).json({ error: "Media not available" });
        }

        // Detect content type from document mime or default to octet-stream
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

  // ============ WHATSAPP PERSONAL ROUTES ============

  app.post("/api/whatsapp-personal/start-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserByOidcId(req.userId!) || await storage.getUser(req.userId!);
      const tenantId = user?.tenantId;
      
      if (!tenantId) {
        return res.status(403).json({ error: "User not associated with a tenant" });
      }

      const { WhatsAppPersonalAdapter } = await import("./services/whatsapp-personal-adapter");
      const result = await WhatsAppPersonalAdapter.startAuth(tenantId);

      if (result.success) {
        if (result.qrCode || result.qrDataUrl) {
          res.json({
            success: true,
            status: "qr_ready",
            qrCode: result.qrCode,
            qrDataUrl: result.qrDataUrl,
          });
        } else {
          channelConnectionCache.set("whatsapp_personal", {
            connected: true,
            lastError: undefined,
            lastChecked: new Date().toISOString(),
          });
          res.json({ success: true, status: "connected" });
        }
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error("Error starting WhatsApp Personal auth:", error);
      res.status(500).json({ error: error.message || "Failed to start authentication" });
    }
  });

  app.post("/api/whatsapp-personal/start-auth-phone", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, async (req: Request, res: Response) => {
    try {
      const phoneNumber = req.body.phoneNumber;
      
      const user = await storage.getUserByOidcId(req.userId!) || await storage.getUser(req.userId!);
      const userTenantId = user?.tenantId;

      if (!phoneNumber) {
        return res.status(400).json({ success: false, error: "Phone number is required" });
      }
      
      if (!userTenantId) {
        return res.status(403).json({ error: "User not associated with a tenant" });
      }

      const fraudCheck = await fraudDetectionService.validateChannelConnection(
        userTenantId,
        "whatsapp_personal",
        { whatsapp_personal: { phoneNumber } }
      );

      if (!fraudCheck.allowed) {
        return res.status(403).json({ 
          error: fraudCheck.message,
          code: "FRAUD_DETECTED"
        });
      }

      const { WhatsAppPersonalAdapter } = await import("./services/whatsapp-personal-adapter");
      const result = await WhatsAppPersonalAdapter.startAuthWithPhone(userTenantId, phoneNumber);

      if (result.success) {
        if (result.pairingCode) {
          res.json({
            success: true,
            status: "pairing_code_ready",
            pairingCode: result.pairingCode,
          });
        } else {
          channelConnectionCache.set("whatsapp_personal", {
            connected: true,
            lastError: undefined,
            lastChecked: new Date().toISOString(),
          });
          res.json({ success: true, status: "connected" });
        }
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error("Error starting WhatsApp Personal phone auth:", error);
      res.status(500).json({ error: error.message || "Failed to start phone authentication" });
    }
  });

  app.post("/api/whatsapp-personal/check-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserByOidcId(req.userId!) || await storage.getUser(req.userId!);
      const tenantId = user?.tenantId;
      
      if (!tenantId) {
        return res.status(403).json({ error: "User not associated with a tenant" });
      }

      const { WhatsAppPersonalAdapter } = await import("./services/whatsapp-personal-adapter");
      const result = await WhatsAppPersonalAdapter.checkAuth(tenantId);

      if (result.status === "connected" && result.user) {
        channelConnectionCache.set("whatsapp_personal", {
          connected: true,
          botInfo: {
            user_id: parseInt(result.user.id.split(":")[0], 10) || 0,
            first_name: result.user.name,
            username: result.user.phone,
          },
          lastError: undefined,
          lastChecked: new Date().toISOString(),
        });
      }

      res.json({
        success: result.success,
        status: result.status,
        qrCode: result.qrCode,
        qrDataUrl: result.qrDataUrl,
        pairingCode: result.pairingCode,
        user: result.user,
        error: result.error,
      });
    } catch (error: any) {
      console.error("Error checking WhatsApp Personal auth:", error);
      res.status(500).json({ error: error.message || "Failed to check authentication" });
    }
  });

  app.post("/api/whatsapp-personal/logout", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserByOidcId(req.userId!) || await storage.getUser(req.userId!);
      const tenantId = user?.tenantId;
      
      if (!tenantId) {
        return res.status(403).json({ error: "User not associated with a tenant" });
      }

      const { WhatsAppPersonalAdapter } = await import("./services/whatsapp-personal-adapter");
      const result = await WhatsAppPersonalAdapter.logout(tenantId);

      channelConnectionCache.set("whatsapp_personal", {
        connected: false,
        lastError: undefined,
        lastChecked: new Date().toISOString(),
      });

      res.json(result);
    } catch (error: any) {
      console.error("Error logging out WhatsApp Personal:", error);
      res.status(500).json({ error: error.message || "Failed to logout" });
    }
  });

  app.get("/api/whatsapp-personal/status", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
    try {
      const user = await storage.getUserByOidcId(req.userId!) || await storage.getUser(req.userId!);
      const tenantId = user?.tenantId;
      
      if (!tenantId) {
        return res.status(403).json({ error: "User not associated with a tenant" });
      }

      const { WhatsAppPersonalAdapter } = await import("./services/whatsapp-personal-adapter");
      const isConnected = WhatsAppPersonalAdapter.isConnected(tenantId);
      const authCheck = await WhatsAppPersonalAdapter.checkAuth(tenantId);

      res.json({
        connected: isConnected,
        status: authCheck.status,
        user: authCheck.user,
      });
    } catch (error: any) {
      console.error("Error checking WhatsApp Personal status:", error);
      res.status(500).json({ error: error.message || "Failed to check status" });
    }
  });

  // ============ TEST / DEBUG ROUTES ============
  // Available when NODE_ENV !== 'production' OR ENABLE_TEST_ENDPOINTS=true

  if (process.env.NODE_ENV !== "production" || process.env.ENABLE_TEST_ENDPOINTS === "true") {
    app.post("/api/test/simulate-message", requireAuth, async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.userId!);
        if (!user?.tenantId) {
          return res.status(403).json({ error: "User not associated with a tenant" });
        }

        const { customerName, customerPhone, message, imageBase64, imageMimeType, conversationId } = req.body as {
          customerName?: string;
          customerPhone?: string;
          message?: string;
          imageBase64?: string;
          imageMimeType?: string;
          conversationId?: string;
        };

        let resolvedName: string;
        let resolvedPhone: string;

        if (conversationId) {
          // Reuse existing conversation — look up customer from it
          const existingConv = await storage.getConversationWithCustomer(conversationId);
          if (!existingConv || existingConv.tenantId !== user.tenantId) {
            return res.status(404).json({ error: "Conversation not found" });
          }
          if (!existingConv.customer?.phone) {
            return res.status(400).json({ error: "Customer phone not found for this conversation" });
          }
          if (!message && !imageBase64) {
            return res.status(400).json({ error: "Missing required field: message or image" });
          }
          resolvedName = existingConv.customer.name || "Test Customer";
          resolvedPhone = existingConv.customer.phone;
        } else {
          if (!customerName || !customerPhone || (!message && !imageBase64)) {
            return res.status(400).json({ error: "Missing required fields: customerName, customerPhone, and message or image" });
          }
          resolvedName = customerName;
          resolvedPhone = customerPhone;
        }

        const externalUserId = resolvedPhone.replace(/\D/g, "") || `test_${Date.now()}`;

        const { processIncomingMessageFull } = await import("./services/inbound-message-handler");

        const parsed = {
          externalMessageId: `test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
          externalConversationId: externalUserId,
          externalUserId,
          text: message || "",
          timestamp: new Date(),
          channel: "mock" as const,
          metadata: {
            firstName: resolvedName,
            phone: resolvedPhone,
          },
          attachments: imageBase64
            ? [
                {
                  type: "image" as const,
                  url: `data:${imageMimeType || "image/jpeg"};base64,${imageBase64}`,
                  mimeType: imageMimeType || "image/jpeg",
                },
              ]
            : undefined,
        };

        await processIncomingMessageFull(user.tenantId, parsed);

        const customer = await storage.getCustomerByExternalId(user.tenantId, "mock", externalUserId);
        if (!customer) {
          return res.status(500).json({ error: "Customer was not created" });
        }

        const allConversations = await storage.getConversationsByTenant(user.tenantId);
        const conv = allConversations.find(
          (c) => c.customerId === customer.id && (c.status === "active" || c.status === "pending")
        );

        const conversation = conv ? await storage.getConversationWithCustomer(conv.id) : null;

        console.log(`[TestEndpoint] Simulated message for tenant ${user.tenantId}, customer ${customer.id}`);
        res.json({ success: true, conversation, customer });
      } catch (error: any) {
        console.error("[TestEndpoint] simulate-message error:", error);
        res.status(500).json({ error: error.message || "Failed to simulate message" });
      }
    });
  }

  // ============ WEBHOOK ROUTES ============

  app.post("/webhooks/telegram", webhookRateLimiter, telegramWebhookHandler);
  app.post("/api/webhook/telegram", webhookRateLimiter, telegramWebhookHandler);

  app.get("/webhooks/whatsapp", whatsappWebhookVerifyHandler);
  app.post("/webhooks/whatsapp", webhookRateLimiter, whatsappWebhookHandler);
  app.get("/api/webhook/whatsapp", whatsappWebhookVerifyHandler);
  app.post("/api/webhook/whatsapp", webhookRateLimiter, whatsappWebhookHandler);

  // ============ MAX WEBHOOK ROUTES ============
  app.use("/webhooks/max", maxWebhookRouter);

  // ============ MAX PERSONAL (GREEN-API) WEBHOOK ============
  app.use("/webhooks/max-personal", webhookRateLimiter, maxPersonalWebhookRouter);

  // ============ AUTH ROUTES (email/password) ============
  app.use("/auth", authRouter);

  // ============ PLATFORM ADMIN ROUTES ============
  app.use("/api/admin", adminRouter);

  // ============ PHASE 0 ROUTES ============
  registerPhase0Routes(app);

  return httpServer;
}
