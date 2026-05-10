import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, requirePermission, requireTenant } from "../middleware/rbac";
import { auditLog } from "../services/audit-log";

const router = Router();

// ============ DECISION SETTINGS ROUTES ============

router.get("/api/settings/decision", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const settings = await storage.getDecisionSettings(tenantId);

    const { DEFAULT_SETTINGS } = await import("../services/decision-engine");
    res.json(settings || { ...DEFAULT_SETTINGS, tenantId });
  } catch (error) {
    console.error("Error fetching decision settings:", error);
    res.status(500).json({ error: "Failed to fetch decision settings" });
  }
});

router.patch("/api/settings/decision", requireAuth, requirePermission("MANAGE_AUTOSEND"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenant = { id: req.tenantId! };

    const { tAuto, tEscalate, autosendAllowed, intentsAutosendAllowed, intentsForceHandoff } = req.body;

    if (tAuto !== undefined && (tAuto < 0 || tAuto > 1)) {
      return res.status(400).json({ error: "tAuto must be between 0 and 1" });
    }
    if (tEscalate !== undefined && (tEscalate < 0 || tEscalate > 1)) {
      return res.status(400).json({ error: "tEscalate must be between 0 and 1" });
    }
    if (tAuto !== undefined && tEscalate !== undefined && tAuto < tEscalate) {
      return res.status(400).json({ error: "tAuto must be greater than or equal to tEscalate" });
    }

    if (autosendAllowed === true) {
      const { calculateReadinessScore, READINESS_THRESHOLD } = await import("../services/readiness-score-service");
      const { isFeatureEnabled } = await import("../services/feature-flags");

      const result = await calculateReadinessScore(
        tenant.id,
        storage,
        (flag: string) => isFeatureEnabled(flag)
      );

      if (result.score < READINESS_THRESHOLD) {
        auditLog.setContext({ tenantId: tenant.id });
        await auditLog.log(
          "settings_updated" as any,
          "tenant",
          tenant.id,
          req.userId || "system",
          req.userId ? "user" : "system",
          { action: "autosend_blocked_readiness", score: result.score, threshold: READINESS_THRESHOLD }
        );

        return res.status(409).json({
          error: "Readiness score too low",
          message: `Невозможно включить автоотправку. Текущий показатель готовности: ${result.score}%, требуется: ${READINESS_THRESHOLD}%`,
          score: result.score,
          threshold: READINESS_THRESHOLD,
          recommendations: result.recommendations,
        });
      }
    }

    const updated = await storage.upsertDecisionSettings({
      tenantId: tenant.id,
      tAuto,
      tEscalate,
      autosendAllowed,
      intentsAutosendAllowed,
      intentsForceHandoff,
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating decision settings:", error);
    res.status(500).json({ error: "Failed to update decision settings" });
  }
});

// ============ HUMAN DELAY SETTINGS ROUTES ============

router.get("/api/settings/human-delay", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;

    const settings = await storage.getHumanDelaySettings(tenantId);
    const { getDefaultHumanDelaySettings } = await import("../services/human-delay-engine");
    res.json(settings || getDefaultHumanDelaySettings(tenantId));
  } catch (error) {
    console.error("Error fetching human delay settings:", error);
    res.status(500).json({ error: "Failed to fetch human delay settings" });
  }
});

const humanDelaySettingsValidation = z.object({
  enabled: z.boolean().optional(),
  delayProfiles: z.record(z.string(), z.object({
    baseMin: z.number().min(0),
    baseMax: z.number().min(0),
    typingSpeed: z.number().min(1),
    jitter: z.number().min(0),
  })).optional(),
  nightMode: z.enum(["AUTO_REPLY", "DELAY", "DISABLE"]).optional(),
  nightDelayMultiplier: z.number().min(1).max(10).optional(),
  nightAutoReplyText: z.string().optional(),
  minDelayMs: z.number().min(0).optional(),
  maxDelayMs: z.number().min(0).optional(),
  typingIndicatorEnabled: z.boolean().optional(),
}).refine((data) => {
  if (data.minDelayMs !== undefined && data.maxDelayMs !== undefined) {
    return data.minDelayMs <= data.maxDelayMs;
  }
  return true;
}, { message: "minDelayMs must be <= maxDelayMs" });

router.patch("/api/settings/human-delay", requireAuth, requirePermission("MANAGE_AUTOSEND"), requireTenant, async (req: Request, res: Response) => {
  try {
    const parseResult = humanDelaySettingsValidation.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: parseResult.error.errors[0]?.message || "Invalid request body"
      });
    }

    const {
      enabled,
      delayProfiles,
      nightMode,
      nightDelayMultiplier,
      nightAutoReplyText,
      minDelayMs,
      maxDelayMs,
      typingIndicatorEnabled
    } = parseResult.data;

    const updated = await storage.upsertHumanDelaySettings({
      tenantId: req.tenantId!,
      enabled,
      delayProfiles,
      nightMode,
      nightDelayMultiplier,
      nightAutoReplyText,
      minDelayMs,
      maxDelayMs,
      typingIndicatorEnabled,
    });

    res.json(updated);
  } catch (error) {
    console.error("Error updating human delay settings:", error);
    res.status(500).json({ error: "Failed to update human delay settings" });
  }
});

// ============ AGENT SETTINGS ROUTES ============

const updateAgentSettingsSchema = z.object({
  companyName: z.string().max(500).optional().nullable(),
  specialization: z.string().max(1000).optional().nullable(),
  warehouseCity: z.string().max(255).optional().nullable(),
  warrantyMonths: z.number().int().nonnegative().optional().nullable(),
  warrantyKm: z.number().int().nonnegative().optional().nullable(),
  installDays: z.number().int().nonnegative().optional().nullable(),
  qrDiscountPercent: z.number().int().min(0).max(100).optional().nullable(),
  systemPrompt: z.string().max(10000).optional().nullable(),
  objectionPayment: z.string().max(2000).optional().nullable(),
  objectionOnline: z.string().max(2000).optional().nullable(),
  closingScript: z.string().max(2000).optional().nullable(),
  customFacts: z.record(z.unknown()).optional().nullable(),
  mileageLow: z.number().int().nonnegative().optional().nullable(),
  mileageMid: z.number().int().nonnegative().optional().nullable(),
  mileageHigh: z.number().int().nonnegative().optional().nullable(),
});

router.get("/api/agent-settings", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const settings = await storage.getTenantAgentSettings(req.tenantId!);
    res.json(settings ?? {});
  } catch (error) {
    console.error("Error fetching agent settings:", error);
    res.status(500).json({ error: "Failed to fetch agent settings" });
  }
});

router.put("/api/agent-settings", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const parsed = updateAgentSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    const settings = await storage.upsertTenantAgentSettings(req.tenantId!, parsed.data);
    res.json(settings);
  } catch (error) {
    console.error("Error updating agent settings:", error);
    res.status(500).json({ error: "Failed to update agent settings" });
  }
});

router.get("/api/ai/training-stats", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const stats = await storage.getAiTrainingStats(req.tenantId!);
    res.json(stats);
  } catch (error) {
    console.error("Error fetching AI training stats:", error);
    res.status(500).json({ error: "Failed to fetch AI training stats" });
  }
});

export default router;
