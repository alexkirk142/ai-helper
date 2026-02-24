import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { requireAuth, requirePermission } from "../middleware/rbac";

const router = Router();

async function getUserByIdOrOidcId(userId: string) {
  let user = await storage.getUserByOidcId(userId);
  if (!user) {
    user = await storage.getUser(userId);
  }
  return user;
}

// POST /api/conversations/:id/vehicle-lookup-case - create vehicle lookup case (VIN/FRAME)
router.post("/api/conversations/:id/vehicle-lookup-case", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const conversationId = req.params.id;
    const { idType, value } = req.body;

    if (!idType || (idType !== "VIN" && idType !== "FRAME")) {
      return res.status(400).json({ error: "idType must be \"VIN\" or \"FRAME\"" });
    }
    if (!value || typeof value !== "string" || value.trim().length === 0) {
      return res.status(400).json({ error: "value is required and must be a non-empty string" });
    }

    const rawValue = value.trim();
    const normalizedValue = idType === "VIN"
      ? rawValue.toUpperCase().replace(/\s/g, "")
      : rawValue.replace(/\s/g, "");

    const conversation = await storage.getConversation(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (conversation.tenantId !== user.tenantId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const row = await storage.createVehicleLookupCase({
      tenantId: user.tenantId,
      conversationId,
      messageId: null,
      idType,
      rawValue,
      normalizedValue,
      status: "PENDING",
      verificationStatus: "NONE",
    });

    const { enqueueVehicleLookup } = await import("../services/vehicle-lookup-queue");
    await enqueueVehicleLookup({
      caseId: row.id,
      tenantId: user.tenantId,
      conversationId,
      idType,
      normalizedValue,
    });

    res.status(201).json({ caseId: row.id });
  } catch (error) {
    console.error("Error creating vehicle lookup case:", error);
    res.status(500).json({ error: "Failed to create vehicle lookup case" });
  }
});

// GET /api/price-settings - get tenant's price settings
router.get("/api/price-settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await getUserByIdOrOidcId(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const tenant = await storage.getTenant(user.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    const templates = (tenant.templates ?? {}) as Record<string, unknown>;
    const priceSettings = templates.priceSettings ?? {
      marginPct: -25,
      roundTo: 100,
      priceNote: "",
      showMarketPrice: false,
    };
    res.json(priceSettings);
  } catch (error) {
    console.error("Error fetching price settings:", error);
    res.status(500).json({ error: "Failed to fetch price settings" });
  }
});

// PUT /api/price-settings - update tenant's price settings (admin/owner only)
router.put("/api/price-settings", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    const user = await getUserByIdOrOidcId(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const { marginPct, roundTo, priceNote, showMarketPrice } = req.body;

    if (marginPct !== undefined && (typeof marginPct !== "number" || marginPct < -50 || marginPct > 50)) {
      return res.status(400).json({ error: "marginPct must be a number between -50 and 50" });
    }
    if (roundTo !== undefined && ![1, 10, 100, 1000].includes(roundTo)) {
      return res.status(400).json({ error: "roundTo must be 1, 10, 100, or 1000" });
    }
    if (priceNote !== undefined && (typeof priceNote !== "string" || priceNote.length > 200)) {
      return res.status(400).json({ error: "priceNote must be a string with max 200 chars" });
    }
    if (showMarketPrice !== undefined && typeof showMarketPrice !== "boolean") {
      return res.status(400).json({ error: "showMarketPrice must be a boolean" });
    }

    const tenant = await storage.getTenant(user.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const templates = (tenant.templates ?? {}) as Record<string, unknown>;
    const existing = (templates.priceSettings ?? {}) as Record<string, unknown>;
    const updated = {
      ...existing,
      ...(marginPct !== undefined && { marginPct }),
      ...(roundTo !== undefined && { roundTo }),
      ...(priceNote !== undefined && { priceNote }),
      ...(showMarketPrice !== undefined && { showMarketPrice }),
    };

    await storage.updateTenant(user.tenantId, {
      templates: { ...templates, priceSettings: updated },
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating price settings:", error);
    res.status(500).json({ error: "Failed to update price settings" });
  }
});

// POST /api/conversations/:id/price-lookup - manual price lookup
router.post("/api/conversations/:id/price-lookup", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const user = await getUserByIdOrOidcId(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const conversationId = req.params.id;
    const conversation = await storage.getConversation(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (conversation.tenantId !== user.tenantId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const latestCase = await storage.getLatestVehicleLookupCaseByConversation(user.tenantId, conversationId);
    if (!latestCase) {
      return res.status(404).json({ error: "No vehicle lookup case found for this conversation" });
    }

    if (!latestCase.cacheId) {
      return res.status(400).json({ error: "Vehicle lookup not completed yet (no cache)" });
    }

    const cache = await storage.getVehicleLookupCacheByKey(latestCase.normalizedValue);
    const result = cache?.result as Record<string, unknown> | null;
    const gearbox = result?.gearbox as Record<string, unknown> | null;
    const oem = (gearbox?.oem as string) || (req.body.oem as string);

    if (!oem) {
      return res.status(400).json({ error: "OEM not found in case. Provide oem in body." });
    }

    const { enqueuePriceLookup } = await import("../services/price-lookup-queue");
    const job = await enqueuePriceLookup({
      tenantId: user.tenantId,
      conversationId,
      oem,
    });

    if (!job) {
      return res.status(503).json({ error: "Price lookup queue is not available" });
    }

    res.json({ jobId: job.jobId, oem });
  } catch (error) {
    console.error("Error starting price lookup:", error);
    res.status(500).json({ error: "Failed to start price lookup" });
  }
});

// GET /api/conversations/:id/price-history - get price snapshots for conversation
router.get("/api/conversations/:id/price-history", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const user = await getUserByIdOrOidcId(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const conversationId = req.params.id;
    const conversation = await storage.getConversation(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (conversation.tenantId !== user.tenantId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const latestCase = await storage.getLatestVehicleLookupCaseByConversation(user.tenantId, conversationId);
    if (!latestCase?.cacheId) {
      return res.json({ snapshots: [], oem: null });
    }

    const cache = await storage.getVehicleLookupCacheByKey(latestCase.normalizedValue);
    const result = cache?.result as Record<string, unknown> | null;
    const gearbox = result?.gearbox as Record<string, unknown> | null;
    const oem = gearbox?.oem as string | undefined;

    if (!oem) {
      return res.json({ snapshots: [], oem: null });
    }

    const snapshots = await storage.getPriceSnapshotsByOem(user.tenantId, oem);
    res.json({ snapshots, oem });
  } catch (error) {
    console.error("Error fetching price history:", error);
    res.status(500).json({ error: "Failed to fetch price history" });
  }
});

export default router;
