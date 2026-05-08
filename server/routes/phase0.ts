import type { Express, Request, Response } from "express";
import { auditLog } from "../services/audit-log";
import { storage } from "../storage";
import { requireAuth, requirePermission } from "../middleware/rbac";

export function registerPhase0Routes(app: Express): void {
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
