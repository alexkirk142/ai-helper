import { Router, type Request, type Response } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/rbac";
import { requireActiveSubscription } from "../../middleware/subscription";
import { requireActiveTenant } from "../../middleware/fraud-protection";
import { fraudDetectionService } from "../../services/fraud-detection-service";
import { channelConnectionCache } from "../channel-management.routes";

const router = Router();

// ── /api/whatsapp-personal ────────────────────────────────────────────────────

router.post("/api/whatsapp-personal/start-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

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

export default router;
