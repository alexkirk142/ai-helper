import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { updateCustomerSchema, insertCustomerNoteSchema } from "@shared/schema";
import { requireAuth, requireOperator, requireAdmin, requirePermission } from "../middleware/rbac";
import { auditLog } from "../services/audit-log";
import { sanitizeString } from "../utils/sanitizer";

const router = Router();

const MAX_NOTE_LENGTH = 2048;

// GET /api/customers - List customers with optional search
router.get("/api/customers", requireAuth, requirePermission("VIEW_CUSTOMERS"), async (req: Request, res: Response) => {
  try {
    const customersUser = await storage.getUser(req.userId!);
    if (!customersUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const search = req.query.search as string | undefined;
    let customers;
    if (search && search.trim().length > 0) {
      customers = await storage.searchCustomers(customersUser.tenantId, search.trim());
    } else {
      customers = await storage.getCustomersByTenant(customersUser.tenantId);
    }
    res.json(customers);
  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

// GET /api/customers/:id - Get single customer
router.get("/api/customers/:id", requireAuth, requirePermission("VIEW_CUSTOMERS"), async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const customer = await storage.getCustomer(req.params.id);
    if (!customer || customer.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(customer);
  } catch (error) {
    console.error("Error fetching customer:", error);
    res.status(500).json({ error: "Failed to fetch customer" });
  }
});

// PATCH /api/customers/:id - Update customer (displayName, tags)
router.patch("/api/customers/:id", requireAuth, requireOperator, async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const customer = await storage.getCustomer(req.params.id);
    if (!customer || customer.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Customer not found" });
    }
    
    const parsed = updateCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
    }
    
    const updated = await storage.updateCustomer(req.params.id, parsed.data);
    res.json(updated);
  } catch (error) {
    console.error("Error updating customer:", error);
    res.status(500).json({ error: "Failed to update customer" });
  }
});

// GET /api/customers/:id/notes - Get customer notes
router.get("/api/customers/:id/notes", requireAuth, requirePermission("VIEW_CUSTOMERS"), async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const customer = await storage.getCustomer(req.params.id);
    if (!customer || customer.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Customer not found" });
    }
    const notes = await storage.getCustomerNotes(req.params.id);
    res.json(notes);
  } catch (error) {
    console.error("Error fetching customer notes:", error);
    res.status(500).json({ error: "Failed to fetch customer notes" });
  }
});

// POST /api/customers/:id/notes - Create customer note
router.post("/api/customers/:id/notes", requireAuth, requireOperator, async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const customer = await storage.getCustomer(req.params.id);
    if (!customer || customer.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const noteInputSchema = insertCustomerNoteSchema.pick({
      noteText: true,
    }).extend({
      noteText: z.string()
        .min(1, "Note text is required")
        .max(MAX_NOTE_LENGTH, `Note text must be ${MAX_NOTE_LENGTH} characters or less`),
    });
    
    const parsed = noteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid data", details: parsed.error.flatten() });
    }

    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required to create notes" });
    }

    const sanitizedNoteText = sanitizeString(parsed.data.noteText);

    const note = await storage.createCustomerNote({
      tenantId: customer.tenantId,
      customerId: req.params.id,
      noteText: sanitizedNoteText,
      authorUserId: user.id,
    });
    
    auditLog.setContext({ tenantId: customer.tenantId, requestId: req.requestId });
    await auditLog.log(
      "note_added" as any,
      "customer_note",
      note.id,
      user.id,
      "user",
      { customerId: customer.id, noteLength: sanitizedNoteText.length }
    );
    
    res.status(201).json(note);
  } catch (error) {
    console.error("Error creating customer note:", error);
    res.status(500).json({ error: "Failed to create customer note" });
  }
});

// DELETE /api/customers/:id/notes/:noteId - Delete customer note
router.delete("/api/customers/:id/notes/:noteId", requireAuth, requireOperator, async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const customer = await storage.getCustomer(req.params.id);
    if (!customer || customer.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Customer not found" });
    }
    
    const note = await storage.getCustomerNote(req.params.noteId);
    if (!note || note.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Note not found" });
    }
    
    const isAdmin = req.userRole === "admin" || req.userRole === "owner";
    const isAuthor = !!(note.authorUserId && user.id === note.authorUserId);
    
    if (!isAuthor && !isAdmin) {
      return res.status(403).json({ error: "Only note author or admin can delete this note" });
    }
    
    await storage.deleteCustomerNote(req.params.noteId);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting customer note:", error);
    res.status(500).json({ error: "Failed to delete customer note" });
  }
});

// DELETE /api/customers/:id/data - Complete customer data deletion (GDPR compliance, admin only)
router.delete("/api/customers/:id/data", requireAuth, requirePermission("DELETE_CUSTOMER_DATA"), async (req: Request, res: Response) => {
  try {
    const customerId = req.params.id;
    const tenantId = req.tenantId;
    const userId = req.userId;

    if (!tenantId || !userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const customer = await storage.getCustomer(customerId);
    
    if (!customer) {
      return res.json({
        success: true,
        customerId,
        tenantId,
        deletedEntities: {
          customers: 0,
          customerMemory: 0,
          customerNotes: 0,
          conversations: 0,
          messages: 0,
          aiSuggestions: 0,
          humanActions: 0,
          aiTrainingSamples: 0,
          csatRatings: 0,
          conversions: 0,
          lostDeals: 0,
        },
        deletedAt: new Date().toISOString(),
        message: "Customer data already deleted or does not exist",
      });
    }

    if (customer.tenantId !== tenantId) {
      return res.status(403).json({ error: "Cannot delete customer data from another tenant" });
    }

    const { deleteCustomerData } = await import("../services/customer-data-deletion-service");
    const result = await deleteCustomerData(customerId, tenantId, userId);

    res.json(result);
  } catch (error) {
    console.error("Error deleting customer data:", error);
    if (error instanceof Error && error.message === "TENANT_MISMATCH") {
      return res.status(403).json({ error: "Cannot delete customer data from another tenant" });
    }
    res.status(500).json({ error: "Failed to delete customer data" });
  }
});

// GET /api/customers/:id/memory - Get customer memory (preferences + frequent topics)
router.get("/api/customers/:id/memory", requireAuth, requirePermission("VIEW_CUSTOMERS"), async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const customer = await storage.getCustomer(req.params.id);
    if (!customer || customer.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Customer not found" });
    }
    
    const memory = await storage.getCustomerMemory(customer.tenantId, customer.id);
    if (!memory) {
      return res.json({
        customerId: customer.id,
        tenantId: customer.tenantId,
        preferences: {},
        frequentTopics: {},
        lastSummaryText: null,
      });
    }
    
    res.json(memory);
  } catch (error) {
    console.error("Error fetching customer memory:", error);
    res.status(500).json({ error: "Failed to fetch customer memory" });
  }
});

// PATCH /api/customers/:id/memory - Update customer preferences
router.patch("/api/customers/:id/memory", requireAuth, requireOperator, async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const customer = await storage.getCustomer(req.params.id);
    if (!customer || customer.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Customer not found" });
    }
    
    const { preferences, lastSummaryText } = req.body;
    
    if (preferences && typeof preferences !== "object") {
      return res.status(400).json({ error: "preferences must be an object" });
    }
    
    let memory;
    if (preferences) {
      memory = await storage.updateCustomerPreferences(customer.tenantId, customer.id, preferences);
    } else {
      memory = await storage.upsertCustomerMemory({
        tenantId: customer.tenantId,
        customerId: customer.id,
        lastSummaryText: lastSummaryText ?? undefined,
      });
    }
    
    auditLog.setContext({ tenantId: customer.tenantId, requestId: req.requestId });
    await auditLog.log(
      "memory_updated" as any,
      "customer_memory",
      customer.id,
      req.userId || "system",
      req.userId ? "user" : "system",
      { 
        updatedPreferences: preferences ? Object.keys(preferences) : [],
        updatedSummary: !!lastSummaryText,
      }
    );
    
    res.json(memory);
  } catch (error) {
    console.error("Error updating customer memory:", error);
    res.status(500).json({ error: "Failed to update customer memory" });
  }
});

// POST /api/customers/:id/memory/rebuild-summary - Rebuild customer summary via LLM
router.post("/api/customers/:id/memory/rebuild-summary", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const user = req.userId ? await storage.getUser(req.userId) : undefined;
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const customer = await storage.getCustomer(req.params.id);
    if (!customer || customer.tenantId !== user.tenantId) {
      return res.status(404).json({ error: "Customer not found" });
    }
    
    const { generateCustomerSummary } = await import("../services/customer-summary-service");
    const result = await generateCustomerSummary(customer.tenantId, customer.id, "manual_rebuild");
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || "Failed to generate summary" });
    }
    
    auditLog.setContext({ tenantId: customer.tenantId, requestId: req.requestId });
    await auditLog.log(
      "summary_updated" as any,
      "customer_memory",
      customer.id,
      req.userId || "system",
      "user",
      { 
        triggeredBy: "manual_rebuild",
        summaryLength: result.summary?.length ?? 0,
      }
    );
    
    const memory = await storage.getCustomerMemory(customer.tenantId, customer.id);
    res.json({ 
      success: true, 
      summary: result.summary,
      memory 
    });
  } catch (error) {
    console.error("Error rebuilding customer summary:", error);
    res.status(500).json({ error: "Failed to rebuild customer summary" });
  }
});

export default router;
