import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { requireAuth, requirePermission } from "../middleware/rbac";
import { auditLog } from "../services/audit-log";

const router = Router();

async function getUserForConversations(userId: string) {
  let user = await storage.getUserByOidcId(userId);
  if (!user) {
    user = await storage.getUser(userId);
  }
  return user;
}

router.get("/api/escalations", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const status = req.query.status as string;
    let escalations;
    if (status === "recent") {
      escalations = await storage.getRecentEscalations(user.tenantId, 5);
    } else if (status === "pending") {
      escalations = (await storage.getEscalationsByTenant(user.tenantId)).filter(e => e.status === "pending");
    } else {
      escalations = await storage.getEscalationsByTenant(user.tenantId);
    }
    res.json(escalations);
  } catch (error) {
    console.error("Error fetching escalations:", error);
    res.status(500).json({ error: "Failed to fetch escalations" });
  }
});

router.patch("/api/escalations/:id", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const escalUser = req.userId ? await storage.getUser(req.userId) : undefined;
    if (!escalUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const existingEscalation = await storage.getEscalationEvent(req.params.id, escalUser.tenantId);
    if (!existingEscalation) {
      return res.status(404).json({ error: "Escalation not found" });
    }
    const escalConv = await storage.getConversation(existingEscalation.conversationId, escalUser.tenantId);
    if (!escalConv || escalConv.tenantId !== escalUser.tenantId) {
      return res.status(404).json({ error: "Escalation not found" });
    }

    const { status } = req.body;
    const escalation = await storage.updateEscalationEvent(req.params.id, escalUser.tenantId, {
      status,
      handledAt: new Date(),
    });
    if (!escalation) {
      return res.status(404).json({ error: "Escalation not found" });
    }

    if (status === "handled" || status === "dismissed") {
      await storage.updateConversation(escalation.conversationId, escalUser.tenantId, { status: "active" });
    }

    res.json(escalation);
  } catch (error) {
    console.error("Error updating escalation:", error);
    res.status(500).json({ error: "Failed to update escalation" });
  }
});

router.post("/api/conversations/:id/csat", requireAuth, requirePermission("MANAGE_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const conversationId = req.params.id;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    const conversation = await storage.getConversationWithCustomer(conversationId, user.tenantId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    if (conversation.tenantId !== user.tenantId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const messages = await storage.getMessagesByConversation(conversationId, user.tenantId);
    const lastAiSuggestion = messages
      .filter((m) => Boolean((m as any).suggestionId))
      .map((m) => (m as any).suggestionId as string)
      .pop();

    let intent: string | null = null;
    let decision: string | null = null;

    if (lastAiSuggestion) {
      const suggestion = await storage.getAiSuggestion(lastAiSuggestion, user.tenantId);
      if (suggestion) {
        intent = suggestion.intent || null;
        decision = suggestion.decision || null;
      }
    }

    const { submitCsatRating } = await import("../services/csat-service");
    const result = await submitCsatRating({
      tenantId: user.tenantId,
      conversationId,
      rating,
      comment: comment || null,
      intent,
      decision,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    auditLog.setContext({ tenantId: user.tenantId });
    await auditLog.log(
      "settings_updated" as any,
      "conversation",
      conversationId,
      req.userId,
      "user",
      { action: "csat_submitted", rating, intent, decision },
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Error submitting CSAT:", error);
    res.status(500).json({ error: "Failed to submit CSAT rating" });
  }
});

router.get("/api/conversations/:id/csat", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserForConversations(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const conversationId = req.params.id;
    const existing = await storage.getCsatRatingByConversation(conversationId);

    res.json({ submitted: !!existing, rating: existing?.rating || null });
  } catch (error) {
    console.error("Error checking CSAT:", error);
    res.status(500).json({ error: "Failed to check CSAT status" });
  }
});

export default router;
