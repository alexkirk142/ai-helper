import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, requirePermission } from "../middleware/rbac";
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
router.get("/api/templates", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const templates = await storage.getMessageTemplatesByTenant(user.tenantId);
    res.json(templates);
  } catch (error) {
    console.error("Error fetching templates:", error);
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

// POST /api/templates — create template
router.post("/api/templates", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const parsed = createTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    const template = await storage.createMessageTemplate({
      tenantId: user.tenantId,
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
router.post("/api/templates/preview", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const parsed = previewTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }

    let content: string;
    if ("templateId" in parsed.data) {
      const tpl = await storage.getMessageTemplate(parsed.data.templateId);
      if (!tpl || tpl.tenantId !== user.tenantId) {
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
router.patch("/api/templates/:id", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const existing = await storage.getMessageTemplate(req.params.id);
    if (!existing || existing.tenantId !== user.tenantId) {
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
router.delete("/api/templates/:id", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const existing = await storage.getMessageTemplate(req.params.id);
    if (!existing || existing.tenantId !== user.tenantId) {
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
router.get("/api/payment-methods", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const methods = await storage.getPaymentMethodsByTenant(user.tenantId);
    res.json(methods);
  } catch (error) {
    console.error("Error fetching payment methods:", error);
    res.status(500).json({ error: "Failed to fetch payment methods" });
  }
});

// POST /api/payment-methods — create
router.post("/api/payment-methods", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const parsed = createPaymentMethodSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    const method = await storage.createPaymentMethod({
      tenantId: user.tenantId,
      ...parsed.data,
    });
    res.status(201).json(method);
  } catch (error) {
    console.error("Error creating payment method:", error);
    res.status(500).json({ error: "Failed to create payment method" });
  }
});

// PATCH /api/payment-methods/reorder — bulk reorder (must be before /:id)
router.patch("/api/payment-methods/reorder", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const parsed = reorderPaymentMethodsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    await storage.reorderPaymentMethods(user.tenantId, parsed.data);
    res.json({ success: true });
  } catch (error) {
    console.error("Error reordering payment methods:", error);
    res.status(500).json({ error: "Failed to reorder payment methods" });
  }
});

// PATCH /api/payment-methods/:id — update
router.patch("/api/payment-methods/:id", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const existing = await storage.getPaymentMethod(req.params.id);
    if (!existing || existing.tenantId !== user.tenantId) {
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
router.delete("/api/payment-methods/:id", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const existing = await storage.getPaymentMethod(req.params.id);
    if (!existing || existing.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Payment method not found" });
    }
    const deleted = await storage.deletePaymentMethod(req.params.id);
    res.json({ success: deleted });
  } catch (error) {
    console.error("Error deleting payment method:", error);
    res.status(500).json({ error: "Failed to delete payment method" });
  }
});

// ============================================================
// AGENT SETTINGS
// ============================================================

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

// GET /api/agent-settings — get current tenant's agent settings
router.get("/api/agent-settings", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const settings = await storage.getTenantAgentSettings(user.tenantId);
    res.json(settings ?? {});
  } catch (error) {
    console.error("Error fetching agent settings:", error);
    res.status(500).json({ error: "Failed to fetch agent settings" });
  }
});

// PUT /api/agent-settings — upsert agent settings for current tenant
router.put("/api/agent-settings", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const parsed = updateAgentSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }
    const settings = await storage.upsertTenantAgentSettings(user.tenantId, parsed.data);
    res.json(settings);
  } catch (error) {
    console.error("Error updating agent settings:", error);
    res.status(500).json({ error: "Failed to update agent settings" });
  }
});

export default router;
