import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { insertKnowledgeDocSchema } from "@shared/schema";
import { requireAuth, requirePermission } from "../middleware/rbac";
import { featureFlagService } from "../services/feature-flags";

const router = Router();

router.get("/api/knowledge-docs", requireAuth, requirePermission("MANAGE_KNOWLEDGE_BASE"), async (req: Request, res: Response) => {
  try {
    const knowledgeDocsUser = await storage.getUser(req.userId!);
    if (!knowledgeDocsUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const docs = await storage.getKnowledgeDocsByTenant(knowledgeDocsUser.tenantId);
    res.json(docs);
  } catch (error) {
    console.error("Error fetching knowledge docs:", error);
    res.status(500).json({ error: "Failed to fetch knowledge docs" });
  }
});

router.post("/api/knowledge-docs", requireAuth, requirePermission("MANAGE_KNOWLEDGE_BASE"), async (req: Request, res: Response) => {
  try {
    const createDocUser = await storage.getUser(req.userId!);
    if (!createDocUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    
    const docData = insertKnowledgeDocSchema.omit({ tenantId: true }).safeParse(req.body);
    if (!docData.success) {
      return res.status(400).json({ error: "Invalid document data", details: docData.error.issues });
    }
    
    const doc = await storage.createKnowledgeDoc({
      tenantId: createDocUser.tenantId,
      ...docData.data,
    });
    res.status(201).json(doc);
  } catch (error) {
    console.error("Error creating knowledge doc:", error);
    res.status(500).json({ error: "Failed to create knowledge doc" });
  }
});

router.patch("/api/knowledge-docs/:id", requireAuth, requirePermission("MANAGE_KNOWLEDGE_BASE"), async (req: Request, res: Response) => {
  try {
    const docUpdateUser = req.userId ? await storage.getUser(req.userId!) : undefined;
    if (!docUpdateUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const existingDoc = await storage.getKnowledgeDoc(req.params.id);
    if (!existingDoc || existingDoc.tenantId !== docUpdateUser.tenantId) {
      return res.status(404).json({ error: "Document not found" });
    }
    const doc = await storage.updateKnowledgeDoc(req.params.id, req.body);
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }
    res.json(doc);
  } catch (error) {
    console.error("Error updating knowledge doc:", error);
    res.status(500).json({ error: "Failed to update knowledge doc" });
  }
});

router.delete("/api/knowledge-docs/:id", requireAuth, requirePermission("MANAGE_KNOWLEDGE_BASE"), async (req: Request, res: Response) => {
  try {
    const docDeleteUser = req.userId ? await storage.getUser(req.userId!) : undefined;
    if (!docDeleteUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const doc = await storage.getKnowledgeDoc(req.params.id);
    if (!doc || doc.tenantId !== docDeleteUser.tenantId) {
      return res.status(404).json({ error: "Document not found" });
    }
    
    const deleted = await storage.deleteKnowledgeDoc(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Document not found" });
    }
    
    await storage.deleteRagBySource(doc.tenantId, "DOC", doc.id);
    
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting knowledge doc:", error);
    res.status(500).json({ error: "Failed to delete knowledge doc" });
  }
});

// ============ RAG EMBEDDINGS ADMIN ROUTES ============

router.post("/api/admin/rag/regenerate-embeddings", requireAuth, requirePermission("MANAGE_KNOWLEDGE_BASE"), async (req: Request, res: Response) => {
  try {
    const { embeddingService } = await import("../services/embedding-service");
    const pLimit = (await import("p-limit")).default;
    
    if (!embeddingService.isAvailable()) {
      return res.status(503).json({ error: "Embedding service not available - OPENAI_API_KEY not set" });
    }

    const isRagEnabled = await featureFlagService.isEnabled("RAG_ENABLED");
    if (!isRagEnabled) {
      return res.status(403).json({ error: "RAG feature is disabled" });
    }

    const ragRegenUser = await storage.getUser(req.userId!);
    if (!ragRegenUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const tenant = { id: ragRegenUser.tenantId };

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const batchSize = Math.min(parseInt(req.query.batchSize as string) || 10, 50);
    const concurrency = Math.min(parseInt(req.query.concurrency as string) || 3, 5);
    const includeStale = req.query.includeStale === "true";

    let chunks = await storage.getRagChunksWithoutEmbedding(tenant.id, limit);
    
    if (includeStale) {
      const staleResult = await storage.invalidateStaleEmbeddings(tenant.id);
      if (staleResult.invalidated > 0) {
        console.log(`[RAG] Invalidated ${staleResult.invalidated} stale embeddings`);
        const additionalChunks = await storage.getRagChunksWithoutEmbedding(tenant.id, limit);
        chunks = additionalChunks;
      }
    }
    
    if (chunks.length === 0) {
      return res.json({ processed: 0, failed: 0, total: 0, message: "No chunks need embedding" });
    }

    let processed = 0;
    let failed = 0;
    const rateLimiter = pLimit(concurrency);

    const batches: typeof chunks[] = [];
    for (let i = 0; i < chunks.length; i += batchSize) {
      batches.push(chunks.slice(i, i + batchSize));
    }

    console.log(`[RAG] Processing ${chunks.length} chunks in ${batches.length} batches (concurrency: ${concurrency})`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      
      const results = await Promise.all(
        batch.map(chunk => 
          rateLimiter(async () => {
            try {
              const result = await embeddingService.createEmbedding(chunk.chunkText);
              if (result) {
                const updated = await storage.updateRagChunkEmbedding(chunk.id, result.embedding);
                return updated ? "success" : "failed";
              }
              return "failed";
            } catch (err) {
              console.error(`[RAG] Embedding error for chunk ${chunk.id}:`, err);
              return "failed";
            }
          })
        )
      );

      processed += results.filter(r => r === "success").length;
      failed += results.filter(r => r === "failed").length;
      
      console.log(`[RAG] Batch ${batchIndex + 1}/${batches.length}: ${results.filter(r => r === "success").length} success, ${results.filter(r => r === "failed").length} failed`);

      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    res.json({ 
      processed, 
      failed, 
      total: chunks.length,
      batches: batches.length,
      config: { batchSize, concurrency, includeStale }
    });
  } catch (error) {
    console.error("Error regenerating embeddings:", error);
    res.status(500).json({ error: "Failed to regenerate embeddings" });
  }
});

router.get("/api/admin/rag/status", requireAuth, requirePermission("MANAGE_KNOWLEDGE_BASE"), async (req: Request, res: Response) => {
  try {
    const { embeddingService } = await import("../services/embedding-service");
    
    const isRagEnabled = await featureFlagService.isEnabled("RAG_ENABLED");
    const isServiceAvailable = embeddingService.isAvailable();

    const ragStatusUser = await storage.getUser(req.userId!);
    if (!ragStatusUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const ragTenantId = ragStatusUser.tenantId;
    let pendingChunks = 0;
    let staleChunks = 0;

    const pending = await storage.getRagChunksWithoutEmbedding(ragTenantId, 1000);
    pendingChunks = pending.length;

    const stale = await storage.getRagChunksWithStaleHash(ragTenantId, 1000);
    staleChunks = stale.length;

    res.json({
      ragEnabled: isRagEnabled,
      embeddingServiceAvailable: isServiceAvailable,
      model: embeddingService.MODEL,
      dimensions: embeddingService.DIMENSIONS,
      pendingChunks,
      staleChunks,
    });
  } catch (error) {
    console.error("Error fetching RAG status:", error);
    res.status(500).json({ error: "Failed to fetch RAG status" });
  }
});

router.post("/api/admin/rag/invalidate-stale", requireAuth, requirePermission("MANAGE_KNOWLEDGE_BASE"), async (req: Request, res: Response) => {
  try {
    const isRagEnabled = await featureFlagService.isEnabled("RAG_ENABLED");
    if (!isRagEnabled) {
      return res.status(403).json({ error: "RAG feature is disabled" });
    }

    const ragInvalidateUser = await storage.getUser(req.userId!);
    if (!ragInvalidateUser?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const result = await storage.invalidateStaleEmbeddings(ragInvalidateUser.tenantId);
    console.log(`[RAG] Invalidated ${result.invalidated} stale embeddings`);

    res.json(result);
  } catch (error) {
    console.error("Error invalidating stale embeddings:", error);
    res.status(500).json({ error: "Failed to invalidate stale embeddings" });
  }
});

export default router;
