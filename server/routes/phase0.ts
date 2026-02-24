import type { Express, Request, Response } from "express";
import { featureFlagService } from "../services/feature-flags";
import { auditLog } from "../services/audit-log";
import { storage } from "../storage";
import { z } from "zod";
import { requireAuth, requireAdmin, requirePermission } from "../middleware/rbac";
import { requirePlatformAdmin } from "../middleware/platform-admin";

// Validation schemas
const toggleFlagSchema = z.object({
  enabled: z.boolean(),
  tenantId: z.string().optional(),
});

export function registerPhase0Routes(app: Express): void {
  // ============ FEATURE FLAGS ROUTES (Admin only) ============

  // Get all feature flags
  app.get("/api/admin/feature-flags", requireAuth, requirePermission("VIEW_AUDIT_LOGS"), async (req: Request, res: Response) => {
    try {
      const tenant = await storage.getDefaultTenant();
      const flags = await featureFlagService.getAllFlags(tenant?.id);
      res.json(flags);
    } catch (error) {
      console.error("Error fetching feature flags:", error);
      res.status(500).json({ error: "Failed to fetch feature flags" });
    }
  });

  // Get all flag values for a specific tenant (for admin UI) — must be before /:name
  app.get("/api/admin/feature-flags/tenant/:tenantId", requireAuth, requirePlatformAdmin(), async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.params;
      const flags = await featureFlagService.getAllFlags(tenantId);
      res.json(flags);
    } catch (error) {
      console.error("Error fetching tenant feature flags:", error);
      res.status(500).json({ error: "Failed to fetch tenant feature flags" });
    }
  });

  // Get single feature flag
  app.get("/api/admin/feature-flags/:name", requireAuth, requirePermission("VIEW_AUDIT_LOGS"), async (req: Request, res: Response) => {
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

  // Toggle feature flag
  app.post("/api/admin/feature-flags/:name/toggle", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
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

      // Audit log the toggle (use userId from RBAC middleware)
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

  // Check if flag is enabled (utility endpoint)
  app.get("/api/feature-flags/:name/check", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
    try {
      // Use the authenticated user's tenantId, not the platform "default" tenant.
      // getDefaultTenant() can return a different ID than the requesting user's
      // tenant when the platform has multiple tenants, causing the lookup to miss
      // the tenant-specific override stored by the toggle endpoint.
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

  // ============ AUDIT LOG ROUTES ============

  // Get audit events for a conversation
  app.get("/api/conversations/:id/audit", requireAuth, requirePermission("VIEW_AUDIT_LOGS"), async (req: Request, res: Response) => {
    try {
      const events = await auditLog.getEventsByConversation(req.params.id);
      res.json(events);
    } catch (error) {
      console.error("Error fetching audit events:", error);
      res.status(500).json({ error: "Failed to fetch audit events" });
    }
  });

  // Get recent audit events for tenant (Admin only)
  app.get("/api/admin/audit-events", requireAuth, requirePermission("VIEW_AUDIT_LOGS"), async (req: Request, res: Response) => {
    try {
      const tenant = await storage.getDefaultTenant();
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }
      
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const events = await auditLog.getRecentEvents(tenant.id, limit);
      res.json(events);
    } catch (error) {
      console.error("Error fetching audit events:", error);
      res.status(500).json({ error: "Failed to fetch audit events" });
    }
  });

  // Get audit events by entity (Admin only)
  app.get("/api/admin/audit-events/:entityType/:entityId", requireAuth, requirePermission("VIEW_AUDIT_LOGS"), async (req: Request, res: Response) => {
    try {
      const { entityType, entityId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const events = await auditLog.getEventsByEntity(entityType, entityId, limit);
      res.json(events);
    } catch (error) {
      console.error("Error fetching audit events:", error);
      res.status(500).json({ error: "Failed to fetch audit events" });
    }
  });
}
