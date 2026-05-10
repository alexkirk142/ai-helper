import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { requireAuth, requirePermission, requireTenant } from "../middleware/rbac";
import { z } from "zod";

const router = Router();

const createTemplateSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(100),
  content: z.string().min(1, "Текст шаблона обязателен").max(4000),
  category: z.string().optional().nullable(),
});

// GET /api/response-templates — get all templates for the current tenant
router.get(
  "/api/response-templates",
  requireAuth,
  requirePermission("VIEW_CONVERSATIONS"),
  requireTenant,
  async (req: Request, res: Response) => {
    try {
      const templates = await storage.getTemplatesByTenant(req.tenantId!);
      res.json(templates);
    } catch (err) {
      console.error("[ResponseTemplates] GET error:", err);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  }
);

// POST /api/response-templates — create a new template
router.post(
  "/api/response-templates",
  requireAuth,
  requirePermission("MANAGE_CONVERSATIONS"),
  requireTenant,
  async (req: Request, res: Response) => {
    try {
      const parsed = createTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      }

      const template = await storage.createTemplate({
        tenantId: req.tenantId!,
        name: parsed.data.name,
        content: parsed.data.content,
        category: parsed.data.category ?? null,
        triggers: [],
        isActive: true,
        usageCount: 0,
      });

      res.status(201).json(template);
    } catch (err) {
      console.error("[ResponseTemplates] POST error:", err);
      res.status(500).json({ error: "Failed to create template" });
    }
  }
);

// DELETE /api/response-templates/:id — delete a template
router.delete(
  "/api/response-templates/:id",
  requireAuth,
  requirePermission("MANAGE_CONVERSATIONS"),
  requireTenant,
  async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteTemplate(req.params.id, req.tenantId!);
      if (!deleted) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[ResponseTemplates] DELETE error:", err);
      res.status(500).json({ error: "Failed to delete template" });
    }
  }
);

export { router as responseTemplatesRouter };
