import { Router, type Request, type Response } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/rbac";
import { requireActiveSubscription } from "../../middleware/subscription";
import { requireActiveTenant } from "../../middleware/fraud-protection";
import { fraudDetectionService } from "../../services/fraud-detection-service";
import { channelConnectionCache } from "../channel-management.routes";

const router = Router();

// ── /api/whatsapp-personal ────────────────────────────────────────────────────

router.post("/api/whatsapp-personal/start-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const fraudCheck = await fraudDetectionService.validateChannelConnection(
      tenantId,
      "whatsapp_personal",
      { whatsapp_personal: { method: "qr" } }
    );

    if (!fraudCheck.allowed) {
      return res.status(403).json({
        error: fraudCheck.message,
        code: "FRAUD_DETECTED"
      });
    }

    const { WhatsAppPersonalAdapter: WAP } = await import("../../services/whatsapp-personal-adapter");
    const result = await WAP.startAuth(tenantId);

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

router.post("/api/whatsapp-personal/start-auth-phone", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, requireTenant, async (req: Request, res: Response) => {
  try {
    const phoneNumber = req.body.phoneNumber;
    const userTenantId = req.tenantId!;

    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: "Phone number is required" });
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

    const { WhatsAppPersonalAdapter: WAP } = await import("../../services/whatsapp-personal-adapter");
    const result = await WAP.startAuthWithPhone(userTenantId, phoneNumber);

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

router.post("/api/whatsapp-personal/check-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const { WhatsAppPersonalAdapter: WAP } = await import("../../services/whatsapp-personal-adapter");
    const result = await WAP.checkAuth(tenantId);

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

router.post("/api/whatsapp-personal/cancel-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const { WhatsAppPersonalAdapter: WAP } = await import("../../services/whatsapp-personal-adapter");
    const authCheck = await WAP.checkAuth(tenantId);
    if (
      authCheck.status === "qr_ready" ||
      authCheck.status === "pairing_code_ready" ||
      authCheck.status === "connecting"
    ) {
      await WAP.logout(tenantId);
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error cancelling WhatsApp Personal auth:", error);
    res.status(500).json({ error: error.message || "Failed to cancel auth" });
  }
});

router.post("/api/whatsapp-personal/logout", requireAuth, requirePermission("MANAGE_CHANNELS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const { WhatsAppPersonalAdapter: WAP } = await import("../../services/whatsapp-personal-adapter");
    const result = await WAP.logout(tenantId);

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

router.get("/api/whatsapp-personal/status", requireAuth, requirePermission("MANAGE_CHANNELS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const { WhatsAppPersonalAdapter: WAP } = await import("../../services/whatsapp-personal-adapter");
    const isConnected = WAP.isConnected(tenantId);
    const authCheck = await WAP.checkAuth(tenantId);

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

router.post(
  "/api/whatsapp-personal/start-conversation",
  requireAuth,
  requirePermission("MANAGE_CHANNELS"),
  requireActiveSubscription,
  requireActiveTenant,
  requireTenant,
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;

      const { phoneNumber, initialMessage } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ error: "Номер телефона обязателен" });
      }

      const cleanDigits = String(phoneNumber).replace(/\D/g, "");
      if (cleanDigits.length < 10 || cleanDigits.length > 15) {
        return res.status(400).json({ error: "Неверный формат номера телефона" });
      }

      // WhatsApp requires a first message to actually create the conversation on the recipient's device
      if (!initialMessage || !String(initialMessage).trim()) {
        return res.status(400).json({ error: "Для WhatsApp необходимо первое сообщение" });
      }

      const { WhatsAppPersonalAdapter: WAP } = await import(
        "../../services/whatsapp-personal-adapter"
      );

      if (!WAP.isConnected(tenantId)) {
        return res.status(400).json({ error: "WhatsApp Personal не подключён" });
      }

      const recipientJid = `${cleanDigits}@s.whatsapp.net`;

      // Verify the number is registered on WhatsApp before creating a conversation
      const session = WAP.getSession(tenantId);
      if (session?.socket) {
        try {
          const [result] = await session.socket.onWhatsApp(recipientJid);
          if (!result?.exists) {
            return res.status(400).json({ error: `Номер +${cleanDigits} не зарегистрирован в WhatsApp` });
          }
          // Use the confirmed JID from WhatsApp (may differ, e.g. business accounts)
          // recipientJid stays as-is; WA will route correctly
        } catch (e: any) {
          console.warn(`[WhatsAppPersonal] onWhatsApp check failed for ${recipientJid}:`, e.message);
          // Non-fatal: proceed even if check fails
        }
      }

      const { storage } = await import("../../storage");
      let customer = await storage.getCustomerByExternalId(tenantId, "whatsapp_personal", recipientJid);

      if (!customer) {
        try {
          customer = await storage.createCustomer(
            {
              tenantId,
              externalId: recipientJid,
              name: `WhatsApp +${cleanDigits}`,
              channel: "whatsapp_personal",
              phone: `+${cleanDigits}`,
              metadata: {},
            },
            tenantId
          );
        } catch (e: any) {
          customer = await storage.getCustomerByExternalId(tenantId, "whatsapp_personal", recipientJid);
          if (!customer) throw e;
        }
      }

      const allConversations = await storage.getConversationsByTenant(tenantId);
      let conversation = allConversations.find(
        (c) =>
          c.customerId === customer!.id &&
          (c.status === "active" || c.status === "pending")
      );

      if (!conversation) {
        conversation = await storage.createConversation(
          {
            tenantId,
            customerId: customer.id,
            status: "active",
            mode: "learning",
          },
          tenantId
        );
      }

      if (initialMessage && String(initialMessage).trim()) {
        const trimmed = String(initialMessage).trim();
        const adapter = new WAP(tenantId);

        const sendResult = await adapter.sendMessage(recipientJid, trimmed);

        if (sendResult.success) {
          await storage.createMessage(
            {
              conversationId: conversation.id,
              role: "assistant",
              content: trimmed,
              metadata: {
                isOutbound: true,
                externalMessageId: sendResult.externalMessageId ?? null,
                channel: "whatsapp_personal",
                recipientJid,
              },
            },
            tenantId
          );
          console.log(
            `[WhatsAppPersonal] start-conversation: sent initial message to ${recipientJid}`
          );
        } else {
          console.error(
            `[WhatsAppPersonal] start-conversation: failed to send initial message: ${sendResult.error}`
          );
          // Clean up the orphaned conversation since the message failed to send
          try {
            await storage.deleteConversation(conversation.id, tenantId);
          } catch {
            // best-effort cleanup
          }
          return res.status(500).json({
            error: `Не удалось отправить сообщение: ${sendResult.error || "Ошибка WhatsApp"}`,
          });
        }
      }

      res.json({ success: true, conversationId: conversation.id });
    } catch (error: any) {
      console.error("Error starting WhatsApp Personal conversation:", error);
      res.status(500).json({ error: error.message || "Failed to start conversation" });
    }
  }
);

router.get(
  "/api/whatsapp-personal/media/:tenantId/:messageId",
  requireAuth,
  requireTenant,
  async (req: Request, res: Response) => {
    try {
      const { tenantId, messageId } = req.params;

      const requestTenantId = req.tenantId!;
      if (tenantId !== requestTenantId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { getFromMediaCache } = await import("../../services/whatsapp-personal-adapter");
      const media = getFromMediaCache(tenantId, decodeURIComponent(messageId));

      if (!media) {
        return res.status(404).json({ error: "Media not found or expired" });
      }

      res.set("Content-Type", media.mimeType);
      res.set("Content-Length", String(media.buffer.length));
      res.set("Content-Disposition", `inline; filename="${media.fileName}"`);
      res.set("Cache-Control", "private, max-age=3600");
      res.send(media.buffer);
    } catch (error: any) {
      console.error("Error serving WhatsApp Personal media:", error);
      res.status(500).json({ error: "Failed to serve media" });
    }
  }
);

export default router;

