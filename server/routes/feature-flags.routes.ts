import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { featureFlagService } from "../services/feature-flags";
import { auditLog } from "../services/audit-log";
import { storage } from "../storage";
import { requireAuth, requirePermission } from "../middleware/rbac";
import { requirePlatformAdmin } from "../middleware/platform-admin";

const router = Router();

const toggleFlagSchema = z.object({
  enabled: z.boolean(),
  tenantId: z.string().optional(),
});

// ============ FEATURE FLAGS ROUTES (Admin only) ============

router.get("/api/admin/feature-flags", requireAuth, requirePermission("VIEW_AUDIT_LOGS"), async (req: Request, res: Response) => {
  try {
    const tenant = await storage.getDefaultTenant();
    const flags = await featureFlagService.getAllFlags(tenant?.id);
    res.json(flags);
  } catch (error) {
    console.error("Error fetching feature flags:", error);
    res.status(500).json({ error: "Failed to fetch feature flags" });
  }
});

// Must be before /:name to avoid shadowing
router.get("/api/admin/feature-flags/tenant/:tenantId", requireAuth, requirePlatformAdmin(), async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.params;
    const flags = await featureFlagService.getAllFlags(tenantId);
    res.json(flags);
  } catch (error) {
    console.error("Error fetching tenant feature flags:", error);
    res.status(500).json({ error: "Failed to fetch tenant feature flags" });
  }
});

router.get("/api/admin/feature-flags/:name", requireAuth, requirePermission("VIEW_AUDIT_LOGS"), async (req: Request, res: Response) => {
  try {
    const tenant = await storage.getDefaultTenant();
    const flag = await featureFlagService.getFlag(req.params.name, tenant?.id);
    if (!flag) {
      return res.status(404).json({ error: "Feature flag not found" });
    }
    res.json(flag);
  } catch (error) {
    console.error("Error fetching feature flag:", error);
    res.status(500).json({ error: "Failed to fetch feature flag" });
  }
});

router.post("/api/admin/feature-flags/:name/toggle", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    const parsed = toggleFlagSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }

    const tenant = await storage.getDefaultTenant();
    const { enabled, tenantId } = parsed.data;

    const flag = await featureFlagService.setFlag(
      req.params.name,
      enabled,
      tenantId || null
    );

    await auditLog.logFeatureFlagToggled(
      req.params.name,
      enabled,
      req.userId || "system",
      tenantId || tenant?.id
    );

    res.json(flag);
  } catch (error) {
    console.error("Error toggling feature flag:", error);
    res.status(500).json({ error: "Failed to toggle feature flag" });
  }
});

router.get("/api/feature-flags/:name/check", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const tenantId: string | undefined =
      (req as any).user?.tenantId ?? (req.session as any)?.tenantId ?? undefined;

    const enabled = await featureFlagService.isEnabled(
      req.params.name as any,
      tenantId
    );
    res.json({ name: req.params.name, enabled });
  } catch (error) {
    console.error("Error checking feature flag:", error);
    res.status(500).json({ error: "Failed to check feature flag" });
  }
});

export default router;
