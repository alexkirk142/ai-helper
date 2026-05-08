import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { featureFlagService } from "../services/feature-flags";
import { auditLog } from "../services/audit-log";
import { WhatsAppPersonalAdapter } from "../services/whatsapp-personal-adapter";
import { requireAuth, requirePermission, requireTenant } from "../middleware/rbac";
import { requireActiveSubscription } from "../middleware/subscription";
import { requireActiveTenant } from "../middleware/fraud-protection";
import { fraudDetectionService } from "../services/fraud-detection-service";
const router = Router();

// In-memory cache for channel connection state; exported so webhook handlers can update it.
export const channelConnectionCache = new Map<string, {
  connected: boolean;
  botInfo?: { user_id?: number; first_name?: string; username?: string };
  lastError?: string;
  lastChecked?: string;
}>();

// ── /api/channels ─────────────────────────────────────────────────────────────

router.get("/api/channels/status", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
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
        const { telegramClientManager } = await import("../services/telegram-client-manager");
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
            const { db } = await import("../db");
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



router.get("/api/channels/feature-flags", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
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

router.post("/api/channels/:channel/toggle", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, async (req: Request, res: Response) => {
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

router.post("/api/channels/:channel/config", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, requireTenant, async (req: Request, res: Response) => {
  try {
    const { channel } = req.params;
    const { token, webhookSecret, accessToken, phoneNumberId, verifyToken, appSecret } = req.body;

    if (channel !== "max" && channel !== "telegram" && channel !== "whatsapp") {
      return res.status(400).json({ error: "Channel configuration not supported yet" });
    }

    const userTenantId = req.tenantId!;

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

router.post("/api/channels/:channel/test", requireAuth, requirePermission("MANAGE_CHANNELS"), async (req: Request, res: Response) => {
  try {
    const { channel } = req.params;
    const { token } = req.body;

    if (channel === "max") {
      const { MaxAdapter } = await import("../services/max-adapter");
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
      const { TelegramAdapter } = await import("../services/telegram-adapter");
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
      const { whatsappAdapter } = await import("../services/whatsapp-adapter");
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

// ── /api/channels/personal-status ─────────────────────────────────────────────

router.get("/api/channels/personal-status", requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const { telegramClientManager } = await import("../services/telegram-client-manager");
    const tgAccounts = await storage.getTelegramAccountsByTenant(tenantId);
    const tgActive = tgAccounts.filter((a) => a.status === "active" && a.isEnabled);
    let tgConnected = false;
    for (const acc of tgActive) {
      if (telegramClientManager.isAccountConnected(tenantId, acc.id)) {
        tgConnected = true;
        break;
      }
    }

    const { db: dbInstance } = await import("../db");
    const { maxPersonalAccounts: mpAccTable } = await import("@shared/schema");
    const { eq: eqFn, and: andFn } = await import("drizzle-orm");
    const mpRows = await dbInstance.select().from(mpAccTable).where(
      andFn(
        eqFn(mpAccTable.tenantId, tenantId),
        eqFn(mpAccTable.status, "authorized"),
      ),
    );

    const { WhatsAppPersonalAdapter } = await import("../services/whatsapp-personal-adapter");
    const waConnected = WhatsAppPersonalAdapter.isConnected(tenantId);

    res.json({ telegram_personal: tgConnected, max_personal: mpRows.length > 0, whatsapp_personal: waConnected });
  } catch (error: any) {
    console.error("Error fetching personal channel status:", error);
    res.status(500).json({ error: "Failed to fetch channel status" });
  }
});

export default router;
