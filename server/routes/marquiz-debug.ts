/**
 * Diagnostic endpoint for Marquiz integration.
 * GET /api/debug/marquiz?token=<MARQUIZ_DEBUG_TOKEN>
 * Returns status of env vars, Redis queue, and MAX accounts.
 */
import { Router, type Request, type Response } from "express";
import { db } from "../db";
import { maxPersonalAccounts } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { getMarquizLeadQueue } from "../services/marquiz-lead-queue";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  // Simple security: require a token query param matching the env var
  const debugToken = process.env.MARQUIZ_DEBUG_TOKEN;
  if (debugToken && req.query.token !== debugToken) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const tenantId = process.env.MARQUIZ_TENANT_ID ?? "";
  const redisUrl = process.env.REDIS_URL ?? "";

  // Check queue
  let queueStatus = "unknown";
  let pendingJobs = 0;
  let failedJobs = 0;
  try {
    const queue = getMarquizLeadQueue();
    if (!queue) {
      queueStatus = "disabled (no Redis URL)";
    } else {
      const counts = await queue.getJobCounts("wait", "active", "failed", "delayed");
      pendingJobs = (counts.wait ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
      failedJobs = counts.failed ?? 0;
      queueStatus = "connected";
    }
  } catch (e: any) {
    queueStatus = `error: ${e.message}`;
  }

  // Check MAX accounts for tenant
  let accounts: Array<{ accountId: string; status: string; label: string | null }> = [];
  if (tenantId) {
    try {
      accounts = await db
        .select({ accountId: maxPersonalAccounts.accountId, status: maxPersonalAccounts.status, label: maxPersonalAccounts.label })
        .from(maxPersonalAccounts)
        .where(eq(maxPersonalAccounts.tenantId, tenantId));
    } catch (e: any) {
      accounts = [];
    }
  }

  return res.json({
    tenantId: tenantId || "⚠️ NOT SET — set MARQUIZ_TENANT_ID env var",
    redisUrl: redisUrl ? `${redisUrl.slice(0, 20)}...` : "⚠️ NOT SET",
    queueStatus,
    pendingJobs,
    failedJobs,
    maxAccounts: accounts,
    webhookUrl: "https://ai-helper-production-c56f.up.railway.app/webhooks/marquiz",
  });
});

export default router;
