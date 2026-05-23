import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, requirePermission, requireTenant } from "../middleware/rbac";

const router = Router();

// GET /api/crm/leads — list leads with filters
router.get("/api/crm/leads", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const { status, source, search, limit, offset } = req.query;
    const result = await storage.getLeads(req.tenantId!, {
      status: status as string | undefined,
      source: source as string | undefined,
      search: search as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });
    res.json(result);
  } catch (error) {
    console.error("Error fetching CRM leads:", error);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

// GET /api/crm/stats — counts by status
router.get("/api/crm/stats", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const stats = await storage.getCrmStats(req.tenantId!);
    res.json(stats);
  } catch (error) {
    console.error("Error fetching CRM stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// GET /api/crm/leads/:id — single lead
router.get("/api/crm/leads/:id", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const lead = await storage.getLead(req.params.id, req.tenantId!);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  } catch (error) {
    console.error("Error fetching lead:", error);
    res.status(500).json({ error: "Failed to fetch lead" });
  }
});

const updateLeadSchema = z.object({
  status: z.enum(["new", "contacted", "in_progress", "converted", "failed", "closed"]).optional(),
  notes: z.string().max(5000).optional(),
  name: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(200).optional().nullable(),
});

// PATCH /api/crm/leads/:id — update lead status/notes
router.patch("/api/crm/leads/:id", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const parsed = updateLeadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });

    const updated = await storage.updateLead(req.params.id, req.tenantId!, parsed.data);
    if (!updated) return res.status(404).json({ error: "Lead not found" });
    res.json(updated);
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(500).json({ error: "Failed to update lead" });
  }
});

// DELETE /api/crm/leads/:id — delete lead (admin only)
router.delete("/api/crm/leads/:id", requireAuth, requirePermission("MANAGE_SETTINGS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const lead = await storage.getLead(req.params.id, req.tenantId!);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    await storage.deleteLead(req.params.id, req.tenantId!);
    res.json({ ok: true });
  } catch (error) {
    console.error("Error deleting lead:", error);
    res.status(500).json({ error: "Failed to delete lead" });
  }
});

export default router;
