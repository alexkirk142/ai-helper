import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, requirePermission, requireTenant } from "../middleware/rbac";
import { renderTemplate, TEMPLATE_SAMPLE_VALUES } from "../services/template-renderer";

const router = Router();

// ============================================================
// MESSAGE TEMPLATES
// ============================================================

const createTemplateSchema = z.object({
  type: z.enum(["price_result", "price_options", "payment_options", "tag_request", "not_found"]),
  name: z.string().min(1).max(255),
  content: z.string().min(1),
  isActive: z.boolean().optional(),
  order: z.number().int().optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  content: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  order: z.number().int().optional(),
});

const previewTemplateSchema = z.union([
  z.object({ templateId: z.string().min(1) }),
  z.object({ content: z.string().min(1) }),
]);

// GET /api/templates — list all templates for current tenant
router.get("/api/templates", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const templates = await storage.getMessageTemplatesByTenant(req.tenantId!);
    res.json(templates);
  } catch (error) {
    console.error("Error fetching templates:", error);
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

// POST /api/templates — create template
router.post("/api/templates", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    const template = await storage.createMessageTemplate({
      tenantId: req.tenantId!,
      ...parsed.data,
    });
    res.status(201).json(template);
  } catch (error) {
    console.error("Error creating template:", error);
    res.status(500).json({ error: "Failed to create template" });
  }
});

// POST /api/templates/preview — render template with sample data
// Must be registered BEFORE /:id routes to avoid param capture
router.post("/api/templates/preview", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const parsed = previewTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }

    let content: string;
    if ("templateId" in parsed.data) {
      const tpl = await storage.getMessageTemplate(parsed.data.templateId);
      if (!tpl || tpl.tenantId !== tenantId) {
        return res.status(404).json({ error: "Template not found" });
      }
      content = tpl.content;
    } else {
      content = parsed.data.content;
    }

    const rendered = renderTemplate(content, TEMPLATE_SAMPLE_VALUES);
    res.json({ rendered });
  } catch (error) {
    console.error("Error previewing template:", error);
    res.status(500).json({ error: "Failed to preview template" });
  }
});

// PATCH /api/templates/:id — update template
router.patch("/api/templates/:id", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const existing = await storage.getMessageTemplate(req.params.id);
    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "Template not found" });
    }
    const parsed = updateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    const updated = await storage.updateMessageTemplate(req.params.id, parsed.data);
    res.json(updated);
  } catch (error) {
    console.error("Error updating template:", error);
    res.status(500).json({ error: "Failed to update template" });
  }
});

// DELETE /api/templates/:id — delete template
router.delete("/api/templates/:id", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const existing = await storage.getMessageTemplate(req.params.id);
    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "Template not found" });
    }
    const deleted = await storage.deleteMessageTemplate(req.params.id);
    res.json({ success: deleted });
  } catch (error) {
    console.error("Error deleting template:", error);
    res.status(500).json({ error: "Failed to delete template" });
  }
});

// ============================================================
// PAYMENT METHODS
// ============================================================

const createPaymentMethodSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  order: z.number().int().optional(),
});

const updatePaymentMethodSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  order: z.number().int().optional(),
});

const reorderPaymentMethodsSchema = z.array(
  z.object({
    id: z.string().min(1),
    order: z.number().int(),
  })
).min(1);

// GET /api/payment-methods — list all for tenant
router.get("/api/payment-methods", requireAuth, requirePermission("VIEW_CONVERSATIONS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const methods = await storage.getPaymentMethodsByTenant(req.tenantId!);
    res.json(methods);
  } catch (error) {
    console.error("Error fetching payment methods:", error);
    res.status(500).json({ error: "Failed to fetch payment methods" });
  }
});

// POST /api/payment-methods — create
router.post("/api/payment-methods", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const parsed = createPaymentMethodSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    const method = await storage.createPaymentMethod({
      tenantId: req.tenantId!,
      ...parsed.data,
    });
    res.status(201).json(method);
  } catch (error) {
    console.error("Error creating payment method:", error);
    res.status(500).json({ error: "Failed to create payment method" });
  }
});

// PATCH /api/payment-methods/reorder — bulk reorder (must be before /:id)
router.patch("/api/payment-methods/reorder", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const parsed = reorderPaymentMethodsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    await storage.reorderPaymentMethods(req.tenantId!, parsed.data);
    res.json({ success: true });
  } catch (error) {
    console.error("Error reordering payment methods:", error);
    res.status(500).json({ error: "Failed to reorder payment methods" });
  }
});

// PATCH /api/payment-methods/:id — update
router.patch("/api/payment-methods/:id", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const existing = await storage.getPaymentMethod(req.params.id);
    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "Payment method not found" });
    }
    const parsed = updatePaymentMethodSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    const updated = await storage.updatePaymentMethod(req.params.id, parsed.data);
    res.json(updated);
  } catch (error) {
    console.error("Error updating payment method:", error);
    res.status(500).json({ error: "Failed to update payment method" });
  }
});

// DELETE /api/payment-methods/:id — delete
router.delete("/api/payment-methods/:id", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const existing = await storage.getPaymentMethod(req.params.id);
    if (!existing || existing.tenantId !== tenantId) {
      return res.status(404).json({ error: "Payment method not found" });
    }
    const deleted = await storage.deletePaymentMethod(req.params.id);
    res.json({ success: deleted });
  } catch (error) {
    console.error("Error deleting payment method:", error);
    res.status(500).json({ error: "Failed to delete payment method" });
  }
});

export default router;
