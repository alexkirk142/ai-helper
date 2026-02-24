import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { requireAuth, requirePermission } from "../middleware/rbac";
import { validateBody, patchTenantSchema } from "../middleware/validation";
import { auditLog } from "../services/audit-log";
import { onboardingRateLimiter } from "../middleware/rate-limiter";

const router = Router();

const ONBOARDING_STEPS = ["BUSINESS", "CHANNELS", "PRODUCTS", "POLICIES", "KB", "REVIEW", "DONE"] as const;
type OnboardingStep = typeof ONBOARDING_STEPS[number];

const ONBOARDING_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "DONE"] as const;
type OnboardingStatus = typeof ONBOARDING_STATUSES[number];

async function getUserByIdOrOidcId(userId: string) {
  let user = await storage.getUserByOidcId(userId);
  if (!user) {
    user = await storage.getUser(userId);
  }
  return user;
}

// ============ TENANT ROUTES ============

router.get("/api/tenant", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const tenant = await storage.getTenant(user.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    res.json(tenant);
  } catch (error) {
    console.error("Error fetching tenant:", error);
    res.status(500).json({ error: "Failed to fetch tenant" });
  }
});

router.patch("/api/tenant", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), validateBody(patchTenantSchema), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const updated = await storage.updateTenant(user.tenantId, req.body);
    res.json(updated);
  } catch (error) {
    console.error("Error updating tenant:", error);
    res.status(500).json({ error: "Failed to update tenant" });
  }
});

router.post("/api/onboarding/setup", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const onboardingUser = await storage.getUser(req.userId!);
    if (!onboardingUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    let tenant = await storage.getTenant(onboardingUser.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    tenant = await storage.updateTenant(tenant.id, {
      name: data.name,
      language: data.language,
      tone: data.tone,
      addressStyle: data.addressStyle,
      currency: data.currency,
      timezone: data.timezone,
      workingHoursStart: data.workingHoursStart,
      workingHoursEnd: data.workingHoursEnd,
      autoReplyOutsideHours: data.autoReplyOutsideHours,
      escalationEmail: data.escalationEmail || null,
      allowDiscounts: data.allowDiscounts,
      maxDiscountPercent: data.maxDiscountPercent,
    });

    if (data.deliveryOptions) {
      await storage.createKnowledgeDoc({
        tenantId: tenant!.id,
        title: "Delivery Options",
        content: data.deliveryOptions,
        category: "shipping",
      });
    }
    if (data.returnPolicy) {
      await storage.createKnowledgeDoc({
        tenantId: tenant!.id,
        title: "Return Policy",
        content: data.returnPolicy,
        category: "returns",
      });
    }

    res.json(tenant);
  } catch (error) {
    console.error("Error in onboarding setup:", error);
    res.status(500).json({ error: "Failed to complete setup" });
  }
});

// ============ ONBOARDING STATE ROUTES ============

router.get("/api/onboarding/state", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    if (!user.role || !["operator", "admin", "owner"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    let state = await storage.getOnboardingState(user.tenantId);
    
    if (!state) {
      state = {
        tenantId: user.tenantId,
        status: "NOT_STARTED",
        currentStep: "BUSINESS",
        completedSteps: [],
        answers: {},
        updatedAt: new Date(),
      };
    }
    
    res.json({
      ...state,
      steps: ONBOARDING_STEPS,
      totalSteps: ONBOARDING_STEPS.length - 1,
    });
  } catch (error) {
    console.error("Error fetching onboarding state:", error);
    res.status(500).json({ error: "Failed to fetch onboarding state" });
  }
});

router.put("/api/onboarding/state", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    if (!user.role || !["operator", "admin", "owner"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const { status, currentStep, completedSteps, answers } = req.body;
    
    if (status && !ONBOARDING_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status: ${status}` });
    }
    
    if (currentStep && !ONBOARDING_STEPS.includes(currentStep)) {
      return res.status(400).json({ error: `Invalid step: ${currentStep}` });
    }
    
    if (completedSteps && !Array.isArray(completedSteps)) {
      return res.status(400).json({ error: "completedSteps must be an array" });
    }
    if (completedSteps) {
      for (const step of completedSteps) {
        if (!ONBOARDING_STEPS.includes(step)) {
          return res.status(400).json({ error: `Invalid step in completedSteps: ${step}` });
        }
      }
    }

    const state = await storage.upsertOnboardingState({
      tenantId: user.tenantId,
      status,
      currentStep,
      completedSteps,
      answers,
    });

    auditLog.setContext({ tenantId: user.tenantId });
    await auditLog.log(
      "settings_updated" as any,
      "tenant",
      user.tenantId,
      req.userId,
      "user",
      { action: "onboarding_state_updated", status, currentStep, completedStepsCount: completedSteps?.length ?? 0 }
    );
    
    res.json(state);
  } catch (error) {
    console.error("Error updating onboarding state:", error);
    res.status(500).json({ error: "Failed to update onboarding state" });
  }
});

router.post("/api/onboarding/complete-step", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    if (!user.role || !["operator", "admin", "owner"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const { step, answers: stepAnswers } = req.body;
    
    if (!step || !ONBOARDING_STEPS.includes(step)) {
      return res.status(400).json({ error: `Invalid step: ${step}` });
    }

    let currentState = await storage.getOnboardingState(user.tenantId);
    if (!currentState) {
      currentState = {
        tenantId: user.tenantId,
        status: "NOT_STARTED",
        currentStep: "BUSINESS",
        completedSteps: [],
        answers: {},
        updatedAt: new Date(),
      };
    }

    const stepsSet = new Set(currentState.completedSteps ?? []);
    stepsSet.add(step);
    const completedSteps = Array.from(stepsSet);
    
    const answers = {
      ...(currentState.answers ?? {}),
      [step]: stepAnswers,
    };
    
    const currentIndex = ONBOARDING_STEPS.indexOf(step as OnboardingStep);
    const nextStep = currentIndex < ONBOARDING_STEPS.length - 1 
      ? ONBOARDING_STEPS[currentIndex + 1] 
      : "DONE";
    
    const status: OnboardingStatus = nextStep === "DONE" ? "DONE" : "IN_PROGRESS";

    const state = await storage.upsertOnboardingState({
      tenantId: user.tenantId,
      status,
      currentStep: nextStep,
      completedSteps,
      answers,
    });

    auditLog.setContext({ tenantId: user.tenantId });
    await auditLog.log(
      "settings_updated" as any,
      "tenant",
      user.tenantId,
      req.userId,
      "user",
      { action: "onboarding_step_completed", completedStep: step, nextStep, status }
    );
    
    res.json({
      ...state,
      completedStep: step,
      nextStep,
    });
  } catch (error) {
    console.error("Error completing onboarding step:", error);
    res.status(500).json({ error: "Failed to complete onboarding step" });
  }
});

router.post("/api/onboarding/generate-templates", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), onboardingRateLimiter, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    if (!user.role || !["operator", "admin", "owner"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const { generateTemplates, templateOptionsSchema } = await import("../services/onboarding-templates");
    
    const optionsResult = templateOptionsSchema.safeParse(req.body.options || {});
    if (!optionsResult.success) {
      return res.status(400).json({ error: "Invalid options", details: optionsResult.error.errors });
    }
    const options = optionsResult.data;

    const answers = req.body.answers || {};
    const businessInfo = answers.BUSINESS || {};
    const policiesInfo = answers.POLICIES || {};

    const input = {
      businessName: businessInfo.name || "Магазин",
      businessDescription: businessInfo.description,
      categories: businessInfo.categories,
      deliveryInfo: policiesInfo.delivery,
      returnsInfo: policiesInfo.returns,
      paymentInfo: policiesInfo.payment,
      discountInfo: policiesInfo.discount,
    };

    const drafts = await generateTemplates(input, options);

    auditLog.setContext({ tenantId: user.tenantId });
    await auditLog.log(
      "settings_updated" as any,
      "tenant",
      user.tenantId,
      req.userId,
      "user",
      { action: "templates_generated", count: drafts.length, types: drafts.map(d => d.docType) }
    );

    res.json({ drafts });
  } catch (error) {
    console.error("Error generating templates:", error);
    res.status(500).json({ error: "Failed to generate templates" });
  }
});

router.post("/api/onboarding/apply-templates", requireAuth, requirePermission("MANAGE_TENANT_SETTINGS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    if (!user.role || !["operator", "admin", "owner"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const { applyDraftsSchema } = await import("../services/onboarding-templates");
    const { indexDocument } = await import("../services/rag-indexer");
    
    const result = applyDraftsSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: "Invalid drafts", details: result.error.errors });
    }

    const { drafts } = result.data;
    const createdDocs: any[] = [];
    const ragEnabled = process.env.RAG_ENABLED === "true" && process.env.OPENAI_API_KEY;

    for (const draft of drafts) {
      const knowledgeDoc = await storage.createKnowledgeDoc({
        tenantId: user.tenantId,
        title: draft.title,
        content: draft.content,
        docType: draft.docType,
        category: draft.docType,
        tags: ["onboarding", "auto-generated"],
        isActive: true,
      });
      createdDocs.push(knowledgeDoc);

      if (ragEnabled) {
        try {
          const ragResult = indexDocument(knowledgeDoc);
          const ragDoc = await storage.createRagDocument(ragResult.ragDocument);
          
          for (const chunk of ragResult.chunks) {
            await storage.createRagChunk({
              ragDocumentId: ragDoc.id,
              chunkText: chunk.chunkText,
              chunkIndex: chunk.chunkIndex,
              tokenCount: chunk.tokenCount,
              metadata: chunk.metadata,
            });
          }
        } catch (ragError) {
          console.error(`Error indexing document ${knowledgeDoc.id}:`, ragError);
        }
      }
    }

    auditLog.setContext({ tenantId: user.tenantId });
    await auditLog.log(
      "settings_updated" as any,
      "tenant",
      user.tenantId,
      req.userId,
      "user",
      { action: "templates_applied", count: createdDocs.length, docIds: createdDocs.map(d => d.id) }
    );

    res.json({ 
      success: true, 
      createdDocs: createdDocs.length,
      ragEnabled,
      documents: createdDocs.map(d => ({ id: d.id, title: d.title, docType: d.docType })),
    });
  } catch (error) {
    console.error("Error applying templates:", error);
    res.status(500).json({ error: "Failed to apply templates" });
  }
});

router.get("/api/onboarding/readiness", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    if (!user.role || !["operator", "admin", "owner"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const { calculateReadinessScore, READINESS_THRESHOLD } = await import("../services/readiness-score-service");
    const { isFeatureEnabled } = await import("../services/feature-flags");

    const result = await calculateReadinessScore(
      user.tenantId,
      storage,
      (flag: string) => isFeatureEnabled(flag)
    );

    await storage.createReadinessReport({
      tenantId: user.tenantId,
      score: result.score,
      checks: result.checks,
      recommendations: result.recommendations,
    });

    auditLog.setContext({ tenantId: user.tenantId });
    await auditLog.log(
      "settings_updated" as any,
      "tenant",
      user.tenantId,
      req.userId,
      "user",
      { action: "readiness_calculated", score: result.score, threshold: READINESS_THRESHOLD }
    );

    res.json({
      score: result.score,
      checks: result.checks,
      recommendations: result.recommendations,
      threshold: READINESS_THRESHOLD,
      ready: result.score >= READINESS_THRESHOLD,
    });
  } catch (error) {
    console.error("Error calculating readiness:", error);
    res.status(500).json({ error: "Failed to calculate readiness" });
  }
});

router.get("/api/onboarding/run-smoke-test/stream", requireAuth, requirePermission("VIEW_CONVERSATIONS"), onboardingRateLimiter, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    if (!user.role || !["operator", "admin", "owner"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const { runSmokeTest } = await import("../services/smoke-test-service");
    
    const result = await runSmokeTest(user.tenantId, (progress) => {
      res.write(`data: ${JSON.stringify({ type: "progress", ...progress })}\n\n`);
    });

    auditLog.setContext({ tenantId: user.tenantId });
    await auditLog.log(
      "settings_updated" as any,
      "tenant",
      user.tenantId,
      req.userId,
      "user",
      { 
        action: "smoke_test_run", 
        passedCount: result.passedCount, 
        totalCount: result.totalCount,
        checkStatus: result.check.status,
      }
    );

    res.write(`data: ${JSON.stringify({ 
      type: "complete",
      results: result.results,
      passedCount: result.passedCount,
      totalCount: result.totalCount,
      check: result.check,
      recommendations: result.recommendations,
    })}\n\n`);
    
    res.end();
  } catch (error) {
    console.error("Error running smoke test:", error);
    res.write(`data: ${JSON.stringify({ type: "error", error: "Failed to run smoke test" })}\n\n`);
    res.end();
  }
});

router.post("/api/onboarding/run-smoke-test", requireAuth, requirePermission("VIEW_CONVERSATIONS"), onboardingRateLimiter, async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    if (!user.role || !["operator", "admin", "owner"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const { runSmokeTest } = await import("../services/smoke-test-service");
    const result = await runSmokeTest(user.tenantId);

    auditLog.setContext({ tenantId: user.tenantId });
    await auditLog.log(
      "settings_updated" as any,
      "tenant",
      user.tenantId,
      req.userId,
      "user",
      { 
        action: "smoke_test_run", 
        passedCount: result.passedCount, 
        totalCount: result.totalCount,
        checkStatus: result.check.status,
      }
    );

    res.json({
      results: result.results,
      passedCount: result.passedCount,
      totalCount: result.totalCount,
      check: result.check,
      recommendations: result.recommendations,
    });
  } catch (error) {
    console.error("Error running smoke test:", error);
    res.status(500).json({ error: "Failed to run smoke test" });
  }
});

export default router;
