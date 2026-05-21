import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { db, pool } from "../db";
import { users, tenants, subscriptions, subscriptionGrants, adminActions, integrationSecrets, SECRET_SCOPES, proxies, PROXY_PROTOCOLS, PROXY_STATUSES, maxPersonalAccounts } from "@shared/schema";
import { ilike, or, eq, desc, isNull, and, sql } from "drizzle-orm";
import { requirePlatformAdmin, auditAdminAction } from "../middleware/platform-admin";
import { requirePlatformOwner } from "../middleware/platform-owner";
import { requireAuth } from "../middleware/rbac";
import { adminActionService } from "../services/admin-action-service";
import { encryptSecret, isValidKeyName } from "../services/secret-store";
import { clearSecretCache } from "../services/secret-resolver";
import { updateService } from "../services/update-service";
import { getAppUrl } from "../utils/app-url";
import { SUBSCRIPTION_PRICE_USDT } from "../config/business-constants";

const MAX_GRANT_DURATION_DAYS = 365;

const reasonSchema = z.object({
  reason: z.string().min(3).max(500),
});

const grantSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().min(3).max(500),
});

const simpleGrantSchema = z.object({
  days: z.number().int().min(1).max(MAX_GRANT_DURATION_DAYS),
  reason: z.string().min(3).max(500),
});

const revokeSchema = z.object({
  reason: z.string().min(3).max(500),
});

const router = Router();

router.get(
  "/health",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_health_check"),
  async (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      adminId: (req as any).user?.id,
    });
  }
);

// Billing metrics for admin dashboard
router.get(
  "/billing/metrics",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    // Active subscriptions (paid, status = active)
    const activeSubsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"));
    const activeSubscriptions = Number(activeSubsResult[0]?.count || 0);

    // Active grants (not revoked, within date range)
    const activeGrantsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(subscriptionGrants)
      .where(
        and(
          isNull(subscriptionGrants.revokedAt),
          sql`${subscriptionGrants.startsAt} <= ${now}`,
          sql`${subscriptionGrants.endsAt} > ${now}`
        )
      );
    const activeGrants = Number(activeGrantsResult[0]?.count || 0);

    // Trials (status = trialing and trial hasn't ended)
    const trialsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, "trialing"),
          sql`${subscriptions.trialEndsAt} > ${now}`
        )
      );
    const trialCount = Number(trialsResult[0]?.count || 0);

    // Expired trials (status = expired or trialing with ended trial)
    const expiredTrialsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(subscriptions)
      .where(
        or(
          eq(subscriptions.status, "expired"),
          and(
            eq(subscriptions.status, "trialing"),
            sql`${subscriptions.trialEndsAt} <= ${now}`
          )
        )
      );
    const expiredTrials = Number(expiredTrialsResult[0]?.count || 0);

    // Upcoming renewals - subscriptions and grants ending in next 30 days
    const upcomingSubscriptions = await db
      .select({
        tenantId: subscriptions.tenantId,
        endsAt: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, "active"),
          sql`${subscriptions.currentPeriodEnd} > ${now}`,
          sql`${subscriptions.currentPeriodEnd} <= ${thirtyDaysFromNow}`
        )
      );

    const upcomingGrants = await db
      .select({
        tenantId: subscriptionGrants.tenantId,
        endsAt: subscriptionGrants.endsAt,
      })
      .from(subscriptionGrants)
      .where(
        and(
          isNull(subscriptionGrants.revokedAt),
          sql`${subscriptionGrants.endsAt} > ${now}`,
          sql`${subscriptionGrants.endsAt} <= ${thirtyDaysFromNow}`
        )
      );

    // Combine and get tenant names
    const allUpcoming = [...upcomingSubscriptions, ...upcomingGrants];
    const uniqueTenantIds = Array.from(new Set(allUpcoming.map(u => u.tenantId)));
    
    const tenantNames = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(sql`${tenants.id} IN ${uniqueTenantIds.length > 0 ? sql`(${sql.join(uniqueTenantIds.map(id => sql`${id}`), sql`,`)})` : sql`('')`}`);

    const tenantNameMap = Object.fromEntries(tenantNames.map(t => [t.id, t.name]));

    const renewals = allUpcoming.map(u => ({
      tenantId: u.tenantId,
      tenantName: tenantNameMap[u.tenantId] || "Unknown",
      endsAt: u.endsAt?.toISOString() || "",
      amount: SUBSCRIPTION_PRICE_USDT,
    })).sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime());

    res.json({
      activeSubscriptions,
      activeGrants,
      trialCount,
      expiredTrials,
      upcomingRenewals: {
        count: renewals.length,
        totalAmount: renewals.length * SUBSCRIPTION_PRICE_USDT,
        renewals,
      },
      totalRevenue: activeSubscriptions * SUBSCRIPTION_PRICE_USDT,
    });
  }
);

// ── Pricing management ──────────────────────────────────────────────────────

router.get(
  "/billing/prices",
  requireAuth,
  requirePlatformAdmin(),
  async (_req, res) => {
    const { getSubscriptionPriceUsdt, getAiSubscriptionPriceUsdt, getTrialPeriodHours } =
      await import("../services/cryptobot-billing");
    const [subscriptionPrice, aiAgentPrice, trialHours] = await Promise.all([
      getSubscriptionPriceUsdt(),
      getAiSubscriptionPriceUsdt(),
      getTrialPeriodHours(),
    ]);
    res.json({ subscriptionPrice, aiAgentPrice, trialHours });
  }
);

const pricesSchema = z.object({
  subscriptionPrice: z.number().positive().optional(),
  aiAgentPrice:      z.number().positive().optional(),
  trialHours:        z.number().int().positive().optional(),
});

router.put(
  "/billing/prices",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    const parsed = pricesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid price data", details: parsed.error.errors });
    }
    const { subscriptionPrice, aiAgentPrice, trialHours } = parsed.data;

    const adminId = (req as any).user?.id;

    const priceEntries: Array<{ keyName: string; value: string }> = [];
    if (subscriptionPrice !== undefined) priceEntries.push({ keyName: "PRICE_SUBSCRIPTION_USDT", value: String(subscriptionPrice) });
    if (aiAgentPrice      !== undefined) priceEntries.push({ keyName: "PRICE_AI_AGENT_USDT",    value: String(aiAgentPrice) });
    if (trialHours        !== undefined) priceEntries.push({ keyName: "PRICE_TRIAL_HOURS",      value: String(trialHours) });

    for (const entry of priceEntries) {
      const { ciphertext, meta, last4 } = encryptSecret(entry.value);
      const condition = and(
        eq(integrationSecrets.scope, "global"),
        isNull(integrationSecrets.tenantId),
        eq(integrationSecrets.keyName, entry.keyName),
        isNull(integrationSecrets.revokedAt)
      );
      const [existing] = await db.select().from(integrationSecrets).where(condition).limit(1);
      if (existing) {
        await db.update(integrationSecrets)
          .set({ encryptedValue: ciphertext, encryptionMeta: meta, last4, rotatedAt: new Date(), updatedAt: new Date() })
          .where(eq(integrationSecrets.id, existing.id));
      } else {
        await db.insert(integrationSecrets).values({
          scope: "global",
          keyName: entry.keyName,
          encryptedValue: ciphertext,
          encryptionMeta: meta,
          last4,
          createdByAdminId: adminId,
        });
      }
      clearSecretCache({ scope: "global", tenantId: undefined, keyName: entry.keyName });
    }

    console.log(`[Admin] Prices updated by ${req.userId}`);
    res.json({ success: true });
  }
);

// ── Subscription management ──────────────────────────────────────────────────

router.get(
  "/billing/subscriptions",
  requireAuth,
  requirePlatformAdmin(),
  async (_req, res) => {
    const rows = await db
      .select({
        id: subscriptions.id,
        tenantId: subscriptions.tenantId,
        tenantName: tenants.name,
        feature: subscriptions.feature,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        updatedAt: subscriptions.updatedAt,
      })
      .from(subscriptions)
      .leftJoin(tenants, eq(subscriptions.tenantId, tenants.id))
      .where(
        or(
          eq(subscriptions.status, "active"),
          eq(subscriptions.status, "trialing"),
          eq(subscriptions.status, "incomplete"),
        )
      )
      .orderBy(desc(subscriptions.updatedAt));

    res.json(rows);
  }
);

router.post(
  "/billing/subscriptions/:tenantId/cancel",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    const { tenantId } = req.params;
    const { feature } = req.body as { feature?: string };

    if (!feature || (feature !== "channels" && feature !== "ai_agent")) {
      return res.status(400).json({ error: "feature must be 'channels' or 'ai_agent'" });
    }

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, feature)))
      .limit(1);

    if (!sub) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    const now = new Date();

    await db
      .update(subscriptions)
      .set({
        status: "canceled",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: now,
        updatedAt: now,
      })
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, feature)));

    // Also revoke all active grants for this tenant+feature so access is truly gone
    await db
      .update(subscriptionGrants)
      .set({
        revokedAt: now,
        revokedByUserId: req.userId ?? null,
        revokedReason: "Admin revoked subscription",
      })
      .where(
        and(
          eq(subscriptionGrants.tenantId, tenantId),
          eq(subscriptionGrants.feature, feature),
          isNull(subscriptionGrants.revokedAt)
        )
      );

    console.log(`[Admin] Subscription ${feature} for tenant ${tenantId} immediately revoked by ${req.userId}`);
    res.json({ success: true });
  }
);

router.get(
  "/billing/grants",
  requireAuth,
  requirePlatformAdmin(),
  async (_req, res) => {
    const rows = await db
      .select({
        id: subscriptionGrants.id,
        tenantId: subscriptionGrants.tenantId,
        tenantName: tenants.name,
        feature: subscriptionGrants.feature,
        startsAt: subscriptionGrants.startsAt,
        endsAt: subscriptionGrants.endsAt,
        reason: subscriptionGrants.reason,
      })
      .from(subscriptionGrants)
      .leftJoin(tenants, eq(subscriptionGrants.tenantId, tenants.id))
      .where(
        and(
          isNull(subscriptionGrants.revokedAt),
          sql`${subscriptionGrants.endsAt} > NOW()`
        )
      )
      .orderBy(desc(subscriptionGrants.endsAt));

    res.json(rows);
  }
);

router.post(
  "/billing/grants/:grantId/revoke",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    const { grantId } = req.params;

    const [grant] = await db
      .select()
      .from(subscriptionGrants)
      .where(and(eq(subscriptionGrants.id, grantId), isNull(subscriptionGrants.revokedAt)))
      .limit(1);

    if (!grant) {
      return res.status(404).json({ error: "Grant not found or already revoked" });
    }

    await db
      .update(subscriptionGrants)
      .set({
        revokedAt: new Date(),
        revokedByUserId: req.userId ?? null,
        revokedReason: "Admin revoked",
      })
      .where(eq(subscriptionGrants.id, grantId));

    console.log(`[Admin] Grant ${grantId} revoked by ${req.userId}`);
    res.json({ success: true });
  }
);

// ── Notify bot broadcast ─────────────────────────────────────────────────────

router.get(
  "/notify/subscribers",
  requireAuth,
  requirePlatformAdmin(),
  async (_req, res) => {
    const { rows } = await pool.query<{
      id: string; chat_id: string; first_name: string | null;
      username: string | null; created_at: string;
    }>(
      `SELECT id, chat_id, first_name, username, created_at
       FROM notify_bot_subscribers
       ORDER BY created_at DESC`
    );
    res.json(rows);
  }
);

router.post(
  "/notify/broadcast",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    const { message } = req.body as { message?: string };
    if (!message?.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const { getSecret } = await import("../services/secret-resolver");
    const botToken = await getSecret({ scope: "global", keyName: "TELEGRAM_ESCALATION_BOT_TOKEN" });
    if (!botToken) {
      return res.status(503).json({ error: "Notification bot is not configured" });
    }

    const { rows } = await pool.query<{ chat_id: string }>(
      `SELECT chat_id FROM notify_bot_subscribers`
    );

    let sent = 0;
    let failed = 0;

    await Promise.allSettled(
      rows.map(async (sub) => {
        const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: sub.chat_id, text: message, parse_mode: "Markdown" }),
        });
        const json = await r.json() as { ok: boolean };
        if (json.ok) sent++; else failed++;
      })
    );

    console.log(`[Admin] Broadcast sent by ${req.userId}: ${sent} ok, ${failed} failed`);
    res.json({ success: true, sent, failed, total: rows.length });
  }
);

router.get(
  "/tenants/search",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_tenants_search"),
  async (req, res) => {
    const q = (req.query.q as string) || "";
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = parseInt(req.query.offset as string) || 0;

    if (q.length < 2) {
      return res.status(400).json({ error: "Query must be at least 2 characters" });
    }

    const results = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        status: tenants.status,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .where(ilike(tenants.name, `%${q}%`))
      .limit(limit)
      .offset(offset);

    const tenantsWithSubs = await Promise.all(
      results.map(async (tenant) => {
        const sub = await db
          .select({
            status: subscriptions.status,
            hadTrial: subscriptions.hadTrial,
          })
          .from(subscriptions)
          .where(eq(subscriptions.tenantId, tenant.id))
          .limit(1);

        return {
          ...tenant,
          subscriptionStatus: sub[0]?.status || "none",
          hadTrial: sub[0]?.hadTrial || false,
        };
      })
    );

    res.json({
      results: tenantsWithSubs,
      count: tenantsWithSubs.length,
      query: q,
    });
  }
);

router.get(
  "/users/search",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_users_search"),
  async (req, res) => {
    const q = (req.query.q as string) || "";
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = parseInt(req.query.offset as string) || 0;

    if (q.length < 2) {
      return res.status(400).json({ error: "Query must be at least 2 characters" });
    }

    const results = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        tenantId: users.tenantId,
        isPlatformAdmin: users.isPlatformAdmin,
        authProvider: users.authProvider,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(
        or(
          ilike(users.username, `%${q}%`),
          ilike(users.email, `%${q}%`)
        )
      )
      .limit(limit)
      .offset(offset);

    res.json({
      results: results.map((user) => ({
        ...user,
        email: user.email ? maskEmail(user.email) : null,
      })),
      count: results.length,
      query: q,
    });
  }
);

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const maskedLocal = local.length > 2 
    ? local[0] + "***" + local[local.length - 1]
    : local[0] + "***";
  return `${maskedLocal}@${domain}`;
}

// GET + PATCH template settings for a tenant
router.get(
  "/tenants/:tenantId/template-settings",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    const { tenantId } = req.params;
    const [tenant] = await db
      .select({
        templateGearboxEnabled: tenants.templateGearboxEnabled,
        templateEngineEnabled: tenants.templateEngineEnabled,
        templateTiresEnabled: tenants.templateTiresEnabled,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    res.json(tenant);
  }
);

const templateSettingsSchema = z.object({
  templateGearboxEnabled: z.boolean().optional(),
  templateEngineEnabled: z.boolean().optional(),
  templateTiresEnabled: z.boolean().optional(),
});

router.patch(
  "/tenants/:tenantId/template-settings",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    const { tenantId } = req.params;
    const parsed = templateSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

    const updates: Record<string, boolean> = {};
    if (parsed.data.templateGearboxEnabled !== undefined) updates.templateGearboxEnabled = parsed.data.templateGearboxEnabled;
    if (parsed.data.templateEngineEnabled  !== undefined) updates.templateEngineEnabled  = parsed.data.templateEngineEnabled;
    if (parsed.data.templateTiresEnabled   !== undefined) updates.templateTiresEnabled   = parsed.data.templateTiresEnabled;

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });

    const [updated] = await db.update(tenants).set(updates).where(eq(tenants.id, tenantId)).returning({
      templateGearboxEnabled: tenants.templateGearboxEnabled,
      templateEngineEnabled: tenants.templateEngineEnabled,
      templateTiresEnabled: tenants.templateTiresEnabled,
    });
    if (!updated) return res.status(404).json({ error: "Tenant not found" });

    console.log(`[Admin] Template settings updated for tenant ${tenantId}:`, updates);
    res.json({ ok: true, ...updated });
  }
);

router.post(
  "/tenants/:tenantId/restrict",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_tenant_restrict"),
  async (req, res) => {
    const { tenantId } = req.params;
    const parsed = reasonSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ error: "Reason required (3-500 chars)" });
    }

    const adminId = (req as any).user?.id;
    const result = await adminActionService.restrictTenant(tenantId, adminId, parsed.data.reason);

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    res.json({
      success: true,
      alreadyRestricted: result.alreadyInState || false,
      actionId: result.actionId,
    });
  }
);

router.post(
  "/tenants/:tenantId/unrestrict",
  requireAuth,
  requirePlatformOwner(),
  auditAdminAction("admin_tenant_unrestrict"),
  async (req, res) => {
    const { tenantId } = req.params;
    const parsed = reasonSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ error: "Reason required (3-500 chars)" });
    }

    const adminId = (req as any).user?.id;
    const result = await adminActionService.unrestrictTenant(tenantId, adminId, parsed.data.reason);

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    res.json({
      success: true,
      alreadyActive: result.alreadyInState || false,
      actionId: result.actionId,
    });
  }
);

router.post(
  "/users/:userId/disable",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_user_disable"),
  async (req, res) => {
    const { userId } = req.params;
    const parsed = reasonSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ error: "Reason required (3-500 chars)" });
    }

    const adminId = (req as any).user?.id;
    const result = await adminActionService.disableUser(userId, adminId, parsed.data.reason);

    if (!result.success) {
      return res.status(result.error === "User not found" ? 404 : 400).json({ error: result.error });
    }

    res.json({
      success: true,
      alreadyDisabled: result.alreadyInState || false,
      actionId: result.actionId,
    });
  }
);

router.post(
  "/users/:userId/enable",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_user_enable"),
  async (req, res) => {
    const { userId } = req.params;
    const parsed = reasonSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ error: "Reason required (3-500 chars)" });
    }

    const adminId = (req as any).user?.id;
    const result = await adminActionService.enableUser(userId, adminId, parsed.data.reason);

    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }

    res.json({
      success: true,
      alreadyEnabled: result.alreadyInState || false,
      actionId: result.actionId,
    });
  }
);

router.post(
  "/users/:userId/unlock-login",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    const { userId } = req.params;
    try {
      await db.update(users)
        .set({ failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(users.id, userId));
      console.log(`[Admin] Login lock cleared for user ${userId} by admin`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  "/tenants/:tenantId/grants",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_grant_create"),
  async (req, res) => {
    const { tenantId } = req.params;
    const parsed = grantSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Invalid request",
        details: parsed.error.errors 
      });
    }

    const startsAt = new Date(parsed.data.startsAt);
    const endsAt = new Date(parsed.data.endsAt);
    const now = new Date();

    if (endsAt <= startsAt) {
      return res.status(400).json({ error: "endsAt must be after startsAt" });
    }

    if (endsAt <= now) {
      return res.status(400).json({ error: "endsAt must be in the future" });
    }

    const durationMs = endsAt.getTime() - startsAt.getTime();
    const durationDays = durationMs / (1000 * 60 * 60 * 24);
    if (durationDays > MAX_GRANT_DURATION_DAYS) {
      return res.status(400).json({ error: `Grant duration cannot exceed ${MAX_GRANT_DURATION_DAYS} days` });
    }

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const adminId = (req as any).user?.id;

    const [grant] = await db
      .insert(subscriptionGrants)
      .values({
        tenantId,
        startsAt,
        endsAt,
        grantedByUserId: adminId,
        reason: parsed.data.reason,
      })
      .returning();

    await db.insert(adminActions).values({
      actionType: "grant_create",
      targetType: "grant",
      targetId: grant.id,
      adminId,
      reason: parsed.data.reason,
      previousState: null,
      metadata: { 
        tenantId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    });

    res.status(201).json({
      success: true,
      grant: {
        id: grant.id,
        tenantId: grant.tenantId,
        startsAt: grant.startsAt,
        endsAt: grant.endsAt,
        reason: grant.reason,
        createdAt: grant.createdAt,
      },
    });
  }
);

// Simple grant endpoint - accepts days instead of dates
router.post(
  "/tenants/:tenantId/grant",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_grant_create"),
  async (req, res) => {
    const { tenantId } = req.params;
    const parsed = simpleGrantSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Invalid request",
        details: parsed.error.errors 
      });
    }

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(403).json({ error: "Authentication required" });
    }

    const startsAt = new Date();
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + parsed.data.days);

    const [grant] = await db
      .insert(subscriptionGrants)
      .values({
        tenantId,
        startsAt,
        endsAt,
        grantedByUserId: adminId,
        reason: parsed.data.reason,
      })
      .returning();

    await db.insert(adminActions).values({
      actionType: "admin_grant_create",
      targetType: "grant",
      targetId: grant.id,
      adminId,
      reason: parsed.data.reason,
      previousState: null,
      metadata: { 
        tenantId,
        days: parsed.data.days,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    });

    res.status(201).json({
      success: true,
      grant: {
        id: grant.id,
        tenantId: grant.tenantId,
        startsAt: grant.startsAt,
        endsAt: grant.endsAt,
        reason: grant.reason,
        createdAt: grant.createdAt,
      },
    });
  }
);

router.get(
  "/tenants/:tenantId/grants",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_grants_list"),
  async (req, res) => {
    const { tenantId } = req.params;
    const includeRevoked = req.query.includeRevoked === "true";

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    let query = db
      .select({
        id: subscriptionGrants.id,
        tenantId: subscriptionGrants.tenantId,
        startsAt: subscriptionGrants.startsAt,
        endsAt: subscriptionGrants.endsAt,
        reason: subscriptionGrants.reason,
        grantedByUserId: subscriptionGrants.grantedByUserId,
        revokedAt: subscriptionGrants.revokedAt,
        revokedReason: subscriptionGrants.revokedReason,
        createdAt: subscriptionGrants.createdAt,
      })
      .from(subscriptionGrants)
      .where(eq(subscriptionGrants.tenantId, tenantId))
      .orderBy(desc(subscriptionGrants.createdAt))
      .limit(50);

    const results = await query;

    const filtered = includeRevoked 
      ? results 
      : results.filter(g => !g.revokedAt);

    res.json({
      grants: filtered,
      count: filtered.length,
    });
  }
);

router.delete(
  "/grants/:grantId",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_grant_revoke"),
  async (req, res) => {
    const { grantId } = req.params;
    const parsed = revokeSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Reason required (3-500 chars)" });
    }

    const [grant] = await db
      .select()
      .from(subscriptionGrants)
      .where(eq(subscriptionGrants.id, grantId))
      .limit(1);

    if (!grant) {
      return res.status(404).json({ error: "Grant not found" });
    }

    if (grant.revokedAt) {
      const adminId = (req as any).user?.id;
      
      await db.insert(adminActions).values({
        actionType: "grant_revoke",
        targetType: "grant",
        targetId: grantId,
        adminId,
        reason: parsed.data.reason,
        previousState: null,
        metadata: {
          idempotent: true,
          noOp: true,
          alreadyState: "revoked",
          grantId: grant.id,
          tenantId: grant.tenantId,
        },
      });

      return res.json({
        success: true,
        alreadyRevoked: true,
        grantId: grant.id,
      });
    }

    const adminId = (req as any).user?.id;

    await db
      .update(subscriptionGrants)
      .set({
        revokedAt: new Date(),
        revokedByUserId: adminId,
        revokedReason: parsed.data.reason,
      })
      .where(eq(subscriptionGrants.id, grantId));

    await db.insert(adminActions).values({
      actionType: "grant_revoke",
      targetType: "grant",
      targetId: grantId,
      adminId,
      reason: parsed.data.reason,
      previousState: {
        startsAt: grant.startsAt,
        endsAt: grant.endsAt,
        tenantId: grant.tenantId,
      },
      metadata: null,
    });

    res.json({
      success: true,
      alreadyRevoked: false,
      grantId: grant.id,
    });
  }
);

// ============================================
// AI AGENT SUBSCRIPTION GRANTS
// ============================================

// Grant AI Agent subscription for N days
router.post(
  "/tenants/:tenantId/ai-grant",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_ai_grant_create"),
  async (req, res) => {
    const { tenantId } = req.params;
    const parsed = simpleGrantSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parsed.error.errors,
      });
    }

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const adminId = (req as any).user?.id;
    if (!adminId) {
      return res.status(403).json({ error: "Authentication required" });
    }

    const startsAt = new Date();
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + parsed.data.days);

    const [grant] = await db
      .insert(subscriptionGrants)
      .values({
        tenantId,
        feature: "ai_agent",
        startsAt,
        endsAt,
        grantedByUserId: adminId,
        reason: parsed.data.reason,
      })
      .returning();

    await db.insert(adminActions).values({
      actionType: "admin_ai_grant_create",
      targetType: "grant",
      targetId: grant.id,
      adminId,
      reason: parsed.data.reason,
      previousState: null,
      metadata: {
        tenantId,
        feature: "ai_agent",
        days: parsed.data.days,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    });

    res.status(201).json({
      success: true,
      grant: {
        id: grant.id,
        tenantId: grant.tenantId,
        feature: grant.feature,
        startsAt: grant.startsAt,
        endsAt: grant.endsAt,
        reason: grant.reason,
        createdAt: grant.createdAt,
      },
    });
  }
);

// List active AI Agent grants for a tenant
router.get(
  "/tenants/:tenantId/ai-grants",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_ai_grants_list"),
  async (req, res) => {
    const { tenantId } = req.params;

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const grants = await db
      .select({
        id: subscriptionGrants.id,
        tenantId: subscriptionGrants.tenantId,
        feature: subscriptionGrants.feature,
        startsAt: subscriptionGrants.startsAt,
        endsAt: subscriptionGrants.endsAt,
        reason: subscriptionGrants.reason,
        grantedByUserId: subscriptionGrants.grantedByUserId,
        revokedAt: subscriptionGrants.revokedAt,
        revokedReason: subscriptionGrants.revokedReason,
        createdAt: subscriptionGrants.createdAt,
      })
      .from(subscriptionGrants)
      .where(
        and(
          eq(subscriptionGrants.tenantId, tenantId),
          eq(subscriptionGrants.feature, "ai_agent")
        )
      )
      .orderBy(desc(subscriptionGrants.createdAt))
      .limit(50);

    const active = grants.filter((g) => !g.revokedAt);

    res.json({ grants: active, count: active.length });
  }
);

// ============================================
// INTEGRATION SECRETS MANAGEMENT
// ============================================

const secretCreateSchema = z.object({
  scope: z.enum(SECRET_SCOPES),
  tenantId: z.string().uuid().optional(),
  keyName: z.string(),
  plaintextValue: z.string().min(1).max(10000),
  reason: z.string().min(3).max(500),
});

const secretRotateSchema = z.object({
  plaintextValue: z.string().min(1).max(10000),
  reason: z.string().min(3).max(500),
});

const secretRevokeSchema = z.object({
  reason: z.string().min(3).max(500),
});

function secretToMetadata(secret: typeof integrationSecrets.$inferSelect) {
  return {
    id: secret.id,
    scope: secret.scope,
    tenantId: secret.tenantId,
    keyName: secret.keyName,
    last4: secret.last4,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
    rotatedAt: secret.rotatedAt,
    revokedAt: secret.revokedAt,
  };
}

router.post(
  "/secrets",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    const parsed = secretCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { scope, tenantId, keyName, plaintextValue, reason } = parsed.data;

    if (!isValidKeyName(keyName)) {
      return res.status(400).json({ error: "Invalid keyName format. Must be 3-64 uppercase letters, numbers, or underscores." });
    }

    if (scope === "tenant" && !tenantId) {
      return res.status(400).json({ error: "tenantId required for tenant-scoped secrets" });
    }

    if (scope === "global" && tenantId) {
      return res.status(400).json({ error: "tenantId must not be provided for global-scoped secrets" });
    }

    if (scope === "global") {
      const user = (req as any).user;
      if (!user?.isPlatformOwner) {
        return res.status(403).json({ error: "Global secrets can only be managed by platform owner" });
      }
    }

    if (scope === "tenant") {
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId!)).limit(1);
      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }
    }

    const adminId = (req as any).user?.id;
    const { ciphertext, meta, last4 } = encryptSecret(plaintextValue);

    const existingCondition = scope === "global"
      ? and(eq(integrationSecrets.scope, "global"), isNull(integrationSecrets.tenantId), eq(integrationSecrets.keyName, keyName), isNull(integrationSecrets.revokedAt))
      : and(eq(integrationSecrets.scope, "tenant"), eq(integrationSecrets.tenantId, tenantId!), eq(integrationSecrets.keyName, keyName), isNull(integrationSecrets.revokedAt));

    const [existing] = await db.select().from(integrationSecrets).where(existingCondition).limit(1);

    if (existing) {
      const previousState = {
        last4: existing.last4,
        rotatedAt: existing.rotatedAt,
        updatedAt: existing.updatedAt,
      };

      const [updated] = await db
        .update(integrationSecrets)
        .set({
          encryptedValue: ciphertext,
          encryptionMeta: meta,
          last4,
          rotatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(integrationSecrets.id, existing.id))
        .returning();

      await db.insert(adminActions).values({
        actionType: "secret_rotate",
        targetType: "secret",
        targetId: updated.id,
        adminId,
        reason,
        previousState,
        metadata: { upsert: true },
      });

      clearSecretCache({ scope, tenantId, keyName });
      return res.status(200).json(secretToMetadata(updated));
    }

    const [created] = await db
      .insert(integrationSecrets)
      .values({
        scope,
        tenantId: scope === "tenant" ? tenantId : null,
        keyName,
        encryptedValue: ciphertext,
        encryptionMeta: meta,
        last4,
        createdByAdminId: adminId,
      })
      .returning();

    await db.insert(adminActions).values({
      actionType: "secret_create",
      targetType: "secret",
      targetId: created.id,
      adminId,
      reason,
      previousState: null,
      metadata: null,
    });

    clearSecretCache({ scope, tenantId, keyName });
    res.status(201).json(secretToMetadata(created));
  }
);

router.post(
  "/secrets/:id/rotate",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    const { id } = req.params;
    const parsed = secretRotateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const adminId = (req as any).user?.id;
    const user = (req as any).user;
    const { plaintextValue, reason } = parsed.data;
    const { ciphertext, meta, last4 } = encryptSecret(plaintextValue);

    try {
      const { rotated, secret } = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(integrationSecrets)
          .where(eq(integrationSecrets.id, id))
          .limit(1);

        if (!existing) {
          const err = new Error("Secret not found") as Error & { status: number };
          err.status = 404;
          throw err;
        }

        if (existing.scope === "global" && !user?.isPlatformOwner) {
          const err = new Error("Global secrets can only be managed by platform owner") as Error & { status: number };
          err.status = 403;
          throw err;
        }

        if (existing.revokedAt) {
          const err = new Error("Cannot rotate a revoked secret") as Error & { status: number };
          err.status = 400;
          throw err;
        }

        const previousState = {
          last4: existing.last4,
          rotatedAt: existing.rotatedAt,
          updatedAt: existing.updatedAt,
        };

        await tx.insert(adminActions).values({
          actionType: "secret_rotate",
          targetType: "secret",
          targetId: id,
          adminId,
          reason,
          previousState,
          metadata: null,
        });

        const [updatedRow] = await tx
          .update(integrationSecrets)
          .set({
            encryptedValue: ciphertext,
            encryptionMeta: meta,
            last4,
            rotatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(integrationSecrets.id, id))
          .returning();

        if (!updatedRow) {
          const err = new Error("Secret update failed") as Error & { status: number };
          err.status = 500;
          throw err;
        }

        return { rotated: updatedRow, secret: existing };
      });

      clearSecretCache({
        scope: secret.scope as "global" | "tenant",
        tenantId: secret.tenantId || undefined,
        keyName: secret.keyName,
      });
      res.json(secretToMetadata(rotated));
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      if (typeof e.status === "number") {
        return res.status(e.status).json({ error: e.message });
      }
      throw err;
    }
  }
);

router.post(
  "/secrets/:id/revoke",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    const { id } = req.params;
    const parsed = secretRevokeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const [secret] = await db.select().from(integrationSecrets).where(eq(integrationSecrets.id, id)).limit(1);
    if (!secret) {
      return res.status(404).json({ error: "Secret not found" });
    }

    if (secret.scope === "global") {
      const user = (req as any).user;
      if (!user?.isPlatformOwner) {
        return res.status(403).json({ error: "Global secrets can only be managed by platform owner" });
      }
    }

    const adminId = (req as any).user?.id;
    const { reason } = parsed.data;

    if (secret.revokedAt) {
      await db.insert(adminActions).values({
        actionType: "secret_revoke",
        targetType: "secret",
        targetId: id,
        adminId,
        reason,
        previousState: null,
        metadata: { idempotent: true, noOp: true, alreadyState: "revoked" },
      });

      return res.json({ success: true, alreadyRevoked: true, secretId: id });
    }

    const previousState = {
      last4: secret.last4,
      revokedAt: secret.revokedAt,
    };

    await db
      .update(integrationSecrets)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(integrationSecrets.id, id));

    await db.insert(adminActions).values({
      actionType: "secret_revoke",
      targetType: "secret",
      targetId: id,
      adminId,
      reason,
      previousState,
      metadata: null,
    });

    clearSecretCache({ scope: secret.scope as "global" | "tenant", tenantId: secret.tenantId || undefined, keyName: secret.keyName });
    res.json({ success: true, alreadyRevoked: false, secretId: id });
  }
);

router.get(
  "/secrets",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    const scope = req.query.scope as string | undefined;
    const tenantId = req.query.tenantId as string | undefined;
    const keyName = req.query.keyName as string | undefined;
    const includeRevoked = req.query.includeRevoked === "true";
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = parseInt(req.query.offset as string) || 0;

    const conditions: ReturnType<typeof eq>[] = [];

    if (scope && SECRET_SCOPES.includes(scope as any)) {
      conditions.push(eq(integrationSecrets.scope, scope as any));
    }
    if (tenantId) {
      conditions.push(eq(integrationSecrets.tenantId, tenantId));
    }
    if (keyName) {
      conditions.push(eq(integrationSecrets.keyName, keyName));
    }
    if (!includeRevoked) {
      conditions.push(isNull(integrationSecrets.revokedAt));
    }

    const secrets = await db
      .select()
      .from(integrationSecrets)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(integrationSecrets.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      secrets: secrets.map(secretToMetadata),
      pagination: { limit, offset, count: secrets.length },
    });
  }
);

// ============================================
// USER MANAGEMENT
// ============================================

router.get(
  "/users",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_users_list"),
  async (req, res) => {
    const q = (req.query.q as string) || "";
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = parseInt(req.query.offset as string) || 0;

    let conditions: ReturnType<typeof eq>[] = [];
    
    if (q.length >= 2) {
      conditions.push(
        or(
          ilike(users.username, `%${q}%`),
          ilike(users.email, `%${q}%`)
        )!
      );
    }

    const results = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        tenantId: users.tenantId,
        isPlatformAdmin: users.isPlatformAdmin,
        isPlatformOwner: users.isPlatformOwner,
        authProvider: users.authProvider,
        isDisabled: users.isDisabled,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    const usersWithTenants = await Promise.all(
      results.map(async (user) => {
        let tenantName: string | null = null;
        if (user.tenantId) {
          const [tenant] = await db
            .select({ name: tenants.name })
            .from(tenants)
            .where(eq(tenants.id, user.tenantId))
            .limit(1);
          tenantName = tenant?.name || null;
        }
        return {
          ...user,
          tenantName,
        };
      })
    );

    res.json({
      users: usersWithTenants,
      total: usersWithTenants.length,
    });
  }
);

router.get(
  "/users/:userId",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_user_view"),
  async (req, res) => {
    const { userId } = req.params;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let tenantName: string | null = null;
    let subscriptionStatus: string | null = null;
    let trialEndsAt: Date | null = null;
    let grantEndsAt: Date | null = null;
    let aiSubscriptionStatus: string | null = null;
    let aiGrantEndsAt: Date | null = null;

    if (user.tenantId) {
      const [tenant] = await db
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, user.tenantId))
        .limit(1);
      tenantName = tenant?.name || null;

      // Channels subscription
      const [sub] = await db
        .select({
          status: subscriptions.status,
          trialEndsAt: subscriptions.trialEndsAt,
        })
        .from(subscriptions)
        .where(and(eq(subscriptions.tenantId, user.tenantId), eq(subscriptions.feature, "channels")))
        .limit(1);
      subscriptionStatus = sub?.status || null;
      trialEndsAt = sub?.trialEndsAt || null;

      // AI Agent subscription
      const [aiSub] = await db
        .select({ status: subscriptions.status })
        .from(subscriptions)
        .where(and(eq(subscriptions.tenantId, user.tenantId), eq(subscriptions.feature, "ai_agent")))
        .limit(1);
      aiSubscriptionStatus = aiSub?.status || null;

      const now = new Date();

      // Active channels grants
      const [activeGrant] = await db
        .select({ endsAt: subscriptionGrants.endsAt })
        .from(subscriptionGrants)
        .where(
          and(
            eq(subscriptionGrants.tenantId, user.tenantId),
            eq(subscriptionGrants.feature, "channels"),
            isNull(subscriptionGrants.revokedAt),
            sql`${subscriptionGrants.startsAt} <= ${now}`,
            sql`${subscriptionGrants.endsAt} > ${now}`
          )
        )
        .orderBy(desc(subscriptionGrants.endsAt))
        .limit(1);

      if (activeGrant) {
        subscriptionStatus = "active";
        grantEndsAt = activeGrant.endsAt;
      }

      // Active AI Agent grants
      const [activeAiGrant] = await db
        .select({ endsAt: subscriptionGrants.endsAt })
        .from(subscriptionGrants)
        .where(
          and(
            eq(subscriptionGrants.tenantId, user.tenantId),
            eq(subscriptionGrants.feature, "ai_agent"),
            isNull(subscriptionGrants.revokedAt),
            sql`${subscriptionGrants.startsAt} <= ${now}`,
            sql`${subscriptionGrants.endsAt} > ${now}`
          )
        )
        .orderBy(desc(subscriptionGrants.endsAt))
        .limit(1);

      if (activeAiGrant) {
        aiSubscriptionStatus = "active";
        aiGrantEndsAt = activeAiGrant.endsAt;
      }
    }

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tenantName,
      isPlatformAdmin: user.isPlatformAdmin,
      isPlatformOwner: user.isPlatformOwner,
      authProvider: user.authProvider,
      isDisabled: user.isDisabled,
      disabledAt: user.disabledAt,
      disabledReason: user.disabledReason,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
      emailVerifiedAt: user.emailVerifiedAt,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      subscriptionStatus,
      trialEndsAt,
      grantEndsAt,
      aiSubscriptionStatus,
      aiGrantEndsAt,
    });
  }
);

router.get(
  "/users/:userId/audit",
  requireAuth,
  requirePlatformAdmin(),
  auditAdminAction("admin_user_audit_view"),
  async (req, res) => {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const logs = await db
      .select()
      .from(adminActions)
      .where(
        or(
          eq(adminActions.targetId, userId),
          eq(adminActions.adminId, userId)
        )
      )
      .orderBy(desc(adminActions.createdAt))
      .limit(limit);

    res.json({ logs });
  }
);

router.post(
  "/users/:userId/impersonate",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    const { userId } = req.params;
    const parsed = reasonSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: "Reason required (3-500 chars)" });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.isPlatformOwner) {
      return res.status(403).json({ error: "Cannot impersonate platform owner" });
    }

    if (user.isPlatformAdmin) {
      return res.status(403).json({ error: "Cannot impersonate platform admin" });
    }

    const adminUser = (req as any).user;
    const session = req.session as any;

    session.originalUserId = adminUser.id;
    session.originalRole = adminUser.role;
    session.originalTenantId = adminUser.tenantId ?? null;
    session.userId = user.id;
    session.role = user.role;
    session.tenantId = user.tenantId;
    session.isImpersonating = true;
    session.impersonatedAt = new Date().toISOString();

    await db.insert(adminActions).values({
      actionType: "impersonate_start",
      targetType: "user",
      targetId: userId,
      adminId: adminUser.id,
      reason: parsed.data.reason,
      previousState: null,
      metadata: {
        targetUsername: user.username,
        targetTenantId: user.tenantId,
      },
    });

    res.json({
      success: true,
      redirectUrl: "/",
      impersonatedUser: {
        id: user.id,
        username: user.username,
        tenantId: user.tenantId,
      },
    });
  }
);

router.post(
  "/impersonate/exit",
  requireAuth,
  async (req, res) => {
    const session = req.session as any;

    if (!session.isImpersonating || !session.originalUserId) {
      return res.status(400).json({ error: "Not currently impersonating" });
    }

    const impersonatedUserId = session.userId;
    const originalUserId = session.originalUserId;

    session.userId = session.originalUserId;
    session.role = session.originalRole;
    session.tenantId = session.originalTenantId ?? null;
    delete session.originalUserId;
    delete session.originalRole;
    delete session.originalTenantId;
    delete session.isImpersonating;
    delete session.impersonatedAt;

    await db.insert(adminActions).values({
      actionType: "impersonate_end",
      targetType: "user",
      targetId: impersonatedUserId,
      adminId: originalUserId,
      reason: "Impersonation session ended",
      previousState: null,
      metadata: null,
    });

    res.json({
      success: true,
      redirectUrl: "/owner",
    });
  }
);

router.post(
  "/users/:userId/promote-admin",
  requireAuth,
  requirePlatformOwner(),
  auditAdminAction("admin_promote"),
  async (req, res) => {
    const { userId } = req.params;
    const parsed = reasonSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ error: "Reason required (3-500 chars)" });
    }

    const ownerId = (req as any).user?.id;
    const result = await adminActionService.promoteToAdmin(userId, ownerId, parsed.data.reason);

    if (!result.success) {
      return res.status(result.error === "User not found" ? 404 : 400).json({ error: result.error });
    }

    res.json({
      success: true,
      alreadyAdmin: result.alreadyInState || false,
      actionId: result.actionId,
    });
  }
);

router.post(
  "/users/:userId/demote-admin",
  requireAuth,
  requirePlatformOwner(),
  auditAdminAction("admin_demote"),
  async (req, res) => {
    const { userId } = req.params;
    const parsed = reasonSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ error: "Reason required (3-500 chars)" });
    }

    const ownerId = (req as any).user?.id;
    const result = await adminActionService.demoteFromAdmin(userId, ownerId, parsed.data.reason);

    if (!result.success) {
      return res.status(result.error === "User not found" ? 404 : 400).json({ error: result.error });
    }

    res.json({
      success: true,
      alreadyNotAdmin: result.alreadyInState || false,
      actionId: result.actionId,
    });
  }
);

// ============ SYSTEM UPDATES (Platform Owner Only) ============

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/zip" || file.originalname.endsWith(".zip")) {
      cb(null, true);
    } else {
      cb(new Error("Only ZIP files are allowed"));
    }
  },
});

router.get(
  "/updates",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    try {
      const history = await updateService.getHistory();
      const currentVersion = await updateService.getCurrentVersion();
      res.json({ history, currentVersion });
    } catch (error) {
      console.error("[Admin] Error fetching updates:", error);
      res.status(500).json({ error: "Failed to fetch update history" });
    }
  }
);

router.get(
  "/updates/version",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    try {
      const version = await updateService.getCurrentVersion();
      res.json({ version });
    } catch (error) {
      res.status(500).json({ error: "Failed to get version" });
    }
  }
);

router.post(
  "/updates/upload",
  requireAuth,
  requirePlatformOwner(),
  auditAdminAction("update_upload"),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { version, changelog } = req.body;
      
      if (!version) {
        return res.status(400).json({ error: "Version is required" });
      }

      const update = await updateService.processUpload(
        req.file.buffer,
        req.file.originalname,
        version,
        changelog
      );

      res.json({ success: true, update });
    } catch (error) {
      console.error("[Admin] Error uploading update:", error);
      res.status(500).json({ error: "Failed to upload update" });
    }
  }
);

router.post(
  "/updates/:id/apply",
  requireAuth,
  requirePlatformOwner(),
  auditAdminAction("update_apply"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;
      
      const result = await updateService.applyUpdate(id, userId);
      
      if (result.success) {
        res.json({ success: true, message: result.message });
      } else {
        res.status(400).json({ success: false, error: result.message });
      }
    } catch (error) {
      console.error("[Admin] Error applying update:", error);
      res.status(500).json({ error: "Failed to apply update" });
    }
  }
);

router.post(
  "/updates/:id/rollback",
  requireAuth,
  requirePlatformOwner(),
  auditAdminAction("update_rollback"),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const result = await updateService.rollback(id);
      
      if (result.success) {
        res.json({ success: true, message: result.message });
      } else {
        res.status(400).json({ success: false, error: result.message });
      }
    } catch (error) {
      console.error("[Admin] Error rolling back update:", error);
      res.status(500).json({ error: "Failed to rollback update" });
    }
  }
);

// Rebuild project (run npm run build)
router.post(
  "/system/rebuild",
  requireAuth,
  requirePlatformOwner(),
  auditAdminAction("system_rebuild"),
  async (req, res) => {
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      
      console.log("[Admin] Starting project rebuild...");
      
      const { stdout, stderr } = await execAsync("npm run build", { 
        cwd: process.cwd(),
        timeout: 180000 // 3 minutes
      });
      
      console.log("[Admin] Rebuild stdout:", stdout);
      if (stderr) console.log("[Admin] Rebuild stderr:", stderr);
      
      console.log("[Admin] Project rebuilt successfully");
      res.json({ 
        success: true, 
        message: "Проект пересобран успешно. Перезапустите сервер командой: pm2 restart aisales" 
      });
    } catch (error: any) {
      console.error("[Admin] Rebuild failed:", error);
      res.status(500).json({ 
        success: false, 
        error: `Ошибка сборки: ${error.message}` 
      });
    }
  }
);

// ============================================
// GITHUB DEPLOY
// ============================================

interface DeployState {
  status: "idle" | "running" | "success" | "error";
  log: string[];
  startedAt?: string;
  finishedAt?: string;
  commitBefore?: string;
  commitAfter?: string;
}

let deployState: DeployState = { status: "idle", log: [] };

async function runDeploy(): Promise<void> {
  const { spawn } = await import("child_process");
  const cwd = process.cwd();

  function addLog(line: string) {
    const trimmed = line.toString().trimEnd();
    if (trimmed) {
      console.log("[Deploy]", trimmed);
      deployState.log.push(trimmed);
    }
  }

  function runCmd(cmd: string, args: string[], label: string, extraEnv?: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
      addLog(`\n▶ ${label}`);
      // Strip NODE_ENV=production so npm ci installs devDependencies (needed for tsx build)
      const { NODE_ENV: _drop, ...baseEnv } = process.env as Record<string, string>;
      const proc = spawn(cmd, args, { cwd, shell: true, env: { ...baseEnv, CI: "true", ...extraEnv } });
      proc.stdout.on("data", (d) => addLog(d.toString()));
      proc.stderr.on("data", (d) => addLog(d.toString()));
      proc.on("close", (code) => {
        if (code === 0) { addLog(`✓ ${label} — готово`); resolve(); }
        else reject(new Error(`${label} завершился с кодом ${code}`));
      });
    });
  }

  try {
    // Capture commit before
    const { execSync } = await import("child_process");
    try {
      deployState.commitBefore = execSync("git log -1 --format=\"%h %s\"", { cwd }).toString().trim();
    } catch { /* ignore */ }

    await runCmd("git", ["fetch", "origin"], "git fetch origin");
    await runCmd("git", ["reset", "--hard", "origin/master"], "git reset --hard origin/master");
    await runCmd("npm", ["ci"], "npm ci (установка зависимостей)");
    await runCmd("npm", ["run", "build"], "npm run build");
    await runCmd("npx", ["drizzle-kit", "push", "--force"], "drizzle-kit push (миграции БД)");

    try {
      deployState.commitAfter = execSync("git log -1 --format=\"%h %s\"", { cwd }).toString().trim();
    } catch { /* ignore */ }

    deployState.status = "success";
    deployState.finishedAt = new Date().toISOString();
    addLog("\n✅ Деплой завершён успешно! Перезапускаю сервисы...");

    // Restart PM2 after a short delay so the response can be delivered
    setTimeout(() => {
      spawn("pm2", ["restart", "ecosystem.config.cjs", "--update-env"], {
        cwd, shell: true, detached: true, stdio: "ignore",
      }).unref();
    }, 2000);
  } catch (err: any) {
    deployState.status = "error";
    deployState.finishedAt = new Date().toISOString();
    addLog(`\n❌ Ошибка деплоя: ${err.message}`);
    console.error("[Deploy] Failed:", err);
  }
}

router.post(
  "/deploy",
  requireAuth,
  requirePlatformOwner(),
  auditAdminAction("github_deploy"),
  async (req, res) => {
    if (deployState.status === "running") {
      return res.status(409).json({ error: "Деплой уже запущен" });
    }
    deployState = { status: "running", log: [], startedAt: new Date().toISOString() };
    deployState.log.push("🚀 Запуск деплоя из GitHub (ветка master)...");
    runDeploy().catch(console.error);
    res.json({ ok: true, message: "Деплой запущен" });
  }
);

router.get(
  "/deploy/status",
  requireAuth,
  requirePlatformOwner(),
  (req, res) => {
    res.json(deployState);
  }
);

router.get(
  "/deploy/git-info",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    try {
      const { execSync } = await import("child_process");
      const cwd = process.cwd();
      const local = execSync("git log -1 --format=\"%h|%s|%ai\"", { cwd }).toString().trim();
      let origin = "";
      try {
        execSync("git fetch origin master", { cwd, timeout: 10000, stdio: "pipe" });
        origin = execSync("git log -1 origin/master --format=\"%h|%s|%ai\"", { cwd }).toString().trim();
      } catch { /* offline or no remote */ }
      const [localHash, localMsg, localDate] = local.split("|");
      const [originHash, originMsg, originDate] = (origin || local).split("|");
      res.json({
        local: { hash: localHash, message: localMsg, date: localDate },
        origin: { hash: originHash, message: originMsg, date: originDate },
        hasUpdate: !!origin && originHash !== localHash,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================
// PROXY MANAGEMENT
// ============================================

const proxySchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(PROXY_PROTOCOLS).default("socks5"),
  username: z.string().max(255).optional().nullable(),
  password: z.string().max(255).optional().nullable(),
  country: z.string().max(10).optional().nullable(),
  label: z.string().max(255).optional().nullable(),
});

const proxyUpdateSchema = proxySchema.partial().extend({
  status: z.enum(PROXY_STATUSES).optional(),
});

function maskProxyPassword(proxy: any): any {
  if (!proxy) return proxy;
  return {
    ...proxy,
    password: proxy.password ? "********" : null,
    hasPassword: !!proxy.password,
  };
}

const bulkProxySchema = z.object({
  proxies: z.array(z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    protocol: z.enum(PROXY_PROTOCOLS).optional(),
    username: z.string().optional().nullable(),
    password: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    label: z.string().optional().nullable(),
  })).min(1).max(1000),
});

// List all proxies
router.get(
  "/proxies",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    try {
      const { status, limit = "50", offset = "0" } = req.query;
      
      let query = db.select().from(proxies);
      
      if (status && PROXY_STATUSES.includes(status as any)) {
        query = query.where(eq(proxies.status, status as any)) as any;
      }
      
      const results = await query
        .orderBy(desc(proxies.createdAt))
        .limit(parseInt(limit as string))
        .offset(parseInt(offset as string));
      
      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(proxies);
      
      // Get stats by status
      const statsResult = await db
        .select({
          status: proxies.status,
          count: sql<number>`count(*)`,
        })
        .from(proxies)
        .groupBy(proxies.status);
      
      const stats = statsResult.reduce((acc, s) => {
        acc[s.status] = Number(s.count);
        return acc;
      }, {} as Record<string, number>);
      
      res.json({
        proxies: results.map(maskProxyPassword),
        pagination: {
          total: Number(countResult[0]?.count || 0),
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
        },
        stats: {
          available: stats.available || 0,
          assigned: stats.assigned || 0,
          disabled: stats.disabled || 0,
          failed: stats.failed || 0,
        },
      });
    } catch (error) {
      console.error("[Admin] Error listing proxies:", error);
      res.status(500).json({ error: "Failed to list proxies" });
    }
  }
);

// Add single proxy
router.post(
  "/proxies",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    try {
      const parsed = proxySchema.parse(req.body);
      
      const [proxy] = await db
        .insert(proxies)
        .values({
          host: parsed.host,
          port: parsed.port,
          protocol: parsed.protocol,
          username: parsed.username || null,
          password: parsed.password || null,
          country: parsed.country || null,
          label: parsed.label || null,
          status: "available",
        })
        .returning();
      
      res.json({ success: true, proxy: maskProxyPassword(proxy) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid proxy data", details: error.errors });
      }
      console.error("[Admin] Error adding proxy:", error);
      res.status(500).json({ error: "Failed to add proxy" });
    }
  }
);

// Bulk import proxies
router.post(
  "/proxies/import",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    try {
      const parsed = bulkProxySchema.parse(req.body);
      
      const proxyValues = parsed.proxies.map(p => ({
        host: p.host,
        port: p.port,
        protocol: p.protocol || "socks5" as const,
        username: p.username || null,
        password: p.password || null,
        country: p.country || null,
        label: p.label || null,
        status: "available" as const,
      }));
      
      const inserted = await db
        .insert(proxies)
        .values(proxyValues)
        .returning();
      
      res.json({ 
        success: true, 
        imported: inserted.length,
        proxies: inserted.map(maskProxyPassword),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid proxy data", details: error.errors });
      }
      console.error("[Admin] Error importing proxies:", error);
      res.status(500).json({ error: "Failed to import proxies" });
    }
  }
);

// Parse proxy list from text (format: host:port or host:port:user:pass or protocol://host:port)
router.post(
  "/proxies/parse",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    try {
      const { text } = req.body;
      
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Text is required" });
      }
      
      const lines = text.split(/[\n\r]+/).filter(line => line.trim());
      const parsed: any[] = [];
      const errors: string[] = [];
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        
        try {
          // Format: protocol://user:pass@host:port
          const urlMatch = trimmed.match(/^(https?|socks[45]):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/i);
          if (urlMatch) {
            parsed.push({
              protocol: urlMatch[1].toLowerCase(),
              username: urlMatch[2] || null,
              password: urlMatch[3] || null,
              host: urlMatch[4],
              port: parseInt(urlMatch[5]),
            });
            continue;
          }
          
          // Format: host:port:user:pass
          const parts = trimmed.split(":");
          if (parts.length >= 2) {
            const port = parseInt(parts[1]);
            if (port > 0 && port <= 65535) {
              parsed.push({
                host: parts[0],
                port: port,
                username: parts[2] || null,
                password: parts[3] || null,
                protocol: "socks5",
              });
              continue;
            }
          }
          
          errors.push(`Invalid format: ${trimmed}`);
        } catch (e) {
          errors.push(`Parse error: ${trimmed}`);
        }
      }
      
      res.json({ 
        parsed, 
        errors,
        valid: parsed.length,
        invalid: errors.length,
      });
    } catch (error) {
      console.error("[Admin] Error parsing proxies:", error);
      res.status(500).json({ error: "Failed to parse proxies" });
    }
  }
);

// Update proxy
router.patch(
  "/proxies/:id",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const parsed = proxyUpdateSchema.parse(req.body);
      
      const updates: Record<string, any> = {};
      if (parsed.host !== undefined) updates.host = parsed.host;
      if (parsed.port !== undefined) updates.port = parsed.port;
      if (parsed.protocol !== undefined) updates.protocol = parsed.protocol;
      if (parsed.username !== undefined) updates.username = parsed.username;
      if (parsed.password !== undefined) updates.password = parsed.password;
      if (parsed.country !== undefined) updates.country = parsed.country;
      if (parsed.label !== undefined) updates.label = parsed.label;
      if (parsed.status !== undefined) updates.status = parsed.status;
      
      updates.updatedAt = new Date();
      
      const [updated] = await db
        .update(proxies)
        .set(updates)
        .where(eq(proxies.id, id))
        .returning();
      
      if (!updated) {
        return res.status(404).json({ error: "Proxy not found" });
      }
      
      res.json({ success: true, proxy: maskProxyPassword(updated) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid proxy data", details: error.errors });
      }
      console.error("[Admin] Error updating proxy:", error);
      res.status(500).json({ error: "Failed to update proxy" });
    }
  }
);

// Delete proxy
router.delete(
  "/proxies/:id",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const [deleted] = await db
        .delete(proxies)
        .where(eq(proxies.id, id))
        .returning();
      
      if (!deleted) {
        return res.status(404).json({ error: "Proxy not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error("[Admin] Error deleting proxy:", error);
      res.status(500).json({ error: "Failed to delete proxy" });
    }
  }
);

// Delete all proxies (with optional status filter)
router.delete(
  "/proxies",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    try {
      const { status } = req.query;
      
      let deleteQuery;
      if (status && PROXY_STATUSES.includes(status as any)) {
        deleteQuery = db.delete(proxies).where(eq(proxies.status, status as any));
      } else {
        deleteQuery = db.delete(proxies);
      }
      
      const result = await deleteQuery.returning();
      
      res.json({ success: true, deleted: result.length });
    } catch (error) {
      console.error("[Admin] Error deleting proxies:", error);
      res.status(500).json({ error: "Failed to delete proxies" });
    }
  }
);

// Assign proxy to tenant/channel
router.post(
  "/proxies/:id/assign",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { tenantId, channelId } = req.body;
      
      const [updated] = await db
        .update(proxies)
        .set({
          assignedTenantId: tenantId || null,
          assignedChannelId: channelId || null,
          status: tenantId || channelId ? "assigned" : "available",
          updatedAt: new Date(),
        })
        .where(eq(proxies.id, id))
        .returning();
      
      if (!updated) {
        return res.status(404).json({ error: "Proxy not found" });
      }
      
      res.json({ success: true, proxy: maskProxyPassword(updated) });
    } catch (error) {
      console.error("[Admin] Error assigning proxy:", error);
      res.status(500).json({ error: "Failed to assign proxy" });
    }
  }
);

// Get available proxy for channel (used during channel connection)
router.get(
  "/proxies/available",
  requireAuth,
  requirePlatformOwner(),
  async (req, res) => {
    try {
      const { protocol, country } = req.query;
      
      let query = db
        .select()
        .from(proxies)
        .where(eq(proxies.status, "available"));
      
      const results = await query.limit(10);
      
      // Filter by protocol and country if specified
      let filtered = results;
      if (protocol) {
        filtered = filtered.filter(p => p.protocol === protocol);
      }
      if (country) {
        filtered = filtered.filter(p => p.country === country);
      }
      
      res.json({ 
        proxies: filtered.map(maskProxyPassword),
        total: filtered.length,
      });
    } catch (error) {
      console.error("[Admin] Error getting available proxies:", error);
      res.status(500).json({ error: "Failed to get available proxies" });
    }
  }
);

// ============ MAX PERSONAL (GREEN-API) ADMIN ROUTES ============

const MAX_PERSONAL_ACCOUNTS_LIMIT = 50;

const maxPersonalAddSchema = z.object({
  idInstance: z.string().min(1).optional(),
  apiTokenInstance: z.string().min(1).optional(),
  label: z.string().optional(),
  // GREEN-API dashboard URLs — apiUrl for text, mediaUrl for file uploads
  apiUrl: z.string().url().optional(),
  mediaUrl: z.string().url().optional(),
});

const maxPersonalPatchSchema = z.object({
  label: z.string(),
});

function maskToken(token: string): string {
  return token.length > 4
    ? `${"•".repeat(token.length - 4)}${token.slice(-4)}`
    : "••••";
}

// GET /users/:userId/max-personal — return all accounts for tenant
router.get(
  "/users/:userId/max-personal",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    try {
      const { userId } = req.params;

      const user = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId)).limit(1);
      if (!user[0]?.tenantId) {
        return res.status(404).json({ error: "User or tenant not found" });
      }
      const { tenantId } = user[0];

      let accounts: (typeof maxPersonalAccounts.$inferSelect)[] = [];
      try {
        accounts = await db.select().from(maxPersonalAccounts)
          .where(eq(maxPersonalAccounts.tenantId, tenantId))
          .orderBy(maxPersonalAccounts.createdAt);
      } catch (dbErr: any) {
        if (dbErr?.message?.includes("does not exist") || dbErr?.code === "42P01") {
          console.warn("[Admin] max_personal_accounts table not found — migration pending");
          return res.json({ accounts: [] });
        }
        throw dbErr;
      }

      return res.json({
        accounts: accounts.map((a) => ({
          accountId: a.accountId,
          idInstance: a.idInstance,
          apiTokenInstance: maskToken(a.apiTokenInstance),
          apiUrl: a.apiUrl,
          mediaUrl: a.mediaUrl,
          displayName: a.displayName,
          status: a.status,
          webhookRegistered: a.webhookRegistered,
          label: a.label,
          provider: a.provider ?? "green_api",
        })),
      });
    } catch (error) {
      console.error("[Admin] Error fetching MAX Personal accounts:", error);
      res.status(500).json({ error: "Failed to fetch MAX Personal accounts" });
    }
  }
);

// POST /users/:userId/max-personal — add a new account (up to 5)
router.post(
  "/users/:userId/max-personal",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const parsed = maxPersonalAddSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body" });
      }

      const userRow = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId)).limit(1);
      if (!userRow[0]?.tenantId) {
        return res.status(404).json({ error: "User or tenant not found" });
      }
      const { tenantId } = userRow[0];

      // 1. Check account limit
      let existingAccounts: (typeof maxPersonalAccounts.$inferSelect)[] = [];
      try {
        existingAccounts = await db.select().from(maxPersonalAccounts)
          .where(eq(maxPersonalAccounts.tenantId, tenantId));
      } catch (dbErr: any) {
        if (dbErr?.message?.includes("does not exist") || dbErr?.code === "42P01") {
          console.warn("[Admin] max_personal_accounts table not found — migration pending");
          return res.status(503).json({ error: "MAX Personal feature not yet available. Run database migrations." });
        }
        throw dbErr;
      }

      if (existingAccounts.length >= MAX_PERSONAL_ACCOUNTS_LIMIT) {
        return res.status(400).json({ error: `Максимум ${MAX_PERSONAL_ACCOUNTS_LIMIT} аккаунтов достигнут` });
      }

      const { MaxGatewayClient, maxGatewayClient } = await import("../services/max-gateway-client");
      const { getSecret: getSecretVal } = await import("../services/secret-resolver");
      const gatewayConfigured = await MaxGatewayClient.isConfigured();

      if (gatewayConfigured) {
        // === MAX GATEWAY PATH ===
        const gatewayUrl = await getSecretVal({ scope: "global", keyName: "MAX_GATEWAY_URL" });
        const { randomUUID } = await import("crypto");
        const accountId = randomUUID();
        const instanceId = `mpa-${accountId.replace(/-/g, "").slice(0, 16)}`;

        const appUrl = getAppUrl();
        const webhookUrl = `${appUrl}/webhooks/max-personal/${tenantId}/${accountId}`;

        let apiToken: string;
        try {
          const result = await maxGatewayClient.createInstance(instanceId, String(tenantId), webhookUrl);
          apiToken = result.apiToken;
        } catch (err: any) {
          return res.status(400).json({ error: `Failed to create gateway instance: ${err.message}` });
        }

        const [inserted] = await db.insert(maxPersonalAccounts).values({
          tenantId,
          accountId,
          idInstance: instanceId,
          apiTokenInstance: apiToken,
          apiUrl: gatewayUrl,
          mediaUrl: gatewayUrl,
          label: parsed.data.label ?? null,
          displayName: null,
          status: "unknown",
          webhookRegistered: true,
          provider: "max_gateway",
        }).returning();

        return res.json({
          success: true,
          accountId: inserted.accountId,
          idInstance: inserted.idInstance,
          status: inserted.status,
          provider: "max_gateway",
          message: "Instance created on max-gateway. Scan QR to authorize.",
        });
      } else {
        // === GREEN-API LEGACY PATH ===
        if (!parsed.data.idInstance || !parsed.data.apiTokenInstance) {
          return res.status(400).json({ error: "idInstance and apiTokenInstance are required when gateway is not configured" });
        }
        const { idInstance, apiTokenInstance, label, apiUrl, mediaUrl } = parsed.data as Required<typeof parsed.data>;

        // 2. Check duplicate idInstance for this tenant
        const duplicate = existingAccounts.find((a) => a.idInstance === idInstance);
        if (duplicate) {
          return res.status(400).json({ error: "Этот инстанс уже добавлен для данного тенанта" });
        }

        const { maxGreenApiAdapter } = await import("../services/max-green-api-adapter");

        // 3. Check current state (non-blocking — save regardless)
        let state = "unknown";
        try {
          state = await maxGreenApiAdapter.getState(idInstance, apiTokenInstance, apiUrl);
        } catch (err: any) {
          return res.status(400).json({ error: `Не удалось проверить инстанс GREEN-API: ${err.message}` });
        }

        // 4. Get account display name (only if authorized)
        let displayName: string | undefined;
        if (state === "authorized") {
          try {
            const info = await maxGreenApiAdapter.getAccountInfo(idInstance, apiTokenInstance, apiUrl);
            displayName = info.nameAccount || info.wid;
          } catch {
            // non-fatal
          }
        }

        // 5. Generate accountId and register webhook only if authorized
        const { randomUUID } = await import("crypto");
        const accountId = randomUUID();
        let webhookRegistered = false;
        if (state === "authorized") {
          try {
            const appUrl = getAppUrl();
            const webhookUrl = `${appUrl}/webhooks/max-personal/${tenantId}/${accountId}`;
            await maxGreenApiAdapter.setWebhook(idInstance, apiTokenInstance, webhookUrl, apiUrl);
            webhookRegistered = true;
          } catch (err: any) {
            console.error("[Admin] GREEN-API setWebhook failed:", err.message);
          }
        }

        // 6. Insert new row
        const [inserted] = await db.insert(maxPersonalAccounts).values({
          tenantId,
          accountId,
          idInstance,
          apiTokenInstance,
          apiUrl: apiUrl ?? null,
          mediaUrl: mediaUrl ?? null,
          label: label ?? null,
          displayName: displayName ?? null,
          status: state,
          webhookRegistered,
          provider: "green_api",
        }).returning();

        return res.json({
          accountId: inserted.accountId,
          idInstance: inserted.idInstance,
          apiTokenInstance: maskToken(inserted.apiTokenInstance),
          apiUrl: inserted.apiUrl,
          mediaUrl: inserted.mediaUrl,
          displayName: inserted.displayName,
          status: inserted.status,
          webhookRegistered: inserted.webhookRegistered,
          label: inserted.label,
          provider: "green_api",
        });
      }
    } catch (error) {
      console.error("[Admin] Error saving MAX Personal account:", error);
      res.status(500).json({ error: "Failed to save MAX Personal account" });
    }
  }
);

// GET /users/:userId/max-personal/:accountId/qr — get QR code for authorization
router.get(
  "/users/:userId/max-personal/:accountId/qr",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    try {
      const { userId, accountId } = req.params;

      const userRow = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId)).limit(1);
      if (!userRow[0]?.tenantId) {
        return res.status(404).json({ error: "User or tenant not found" });
      }
      const { tenantId } = userRow[0];

      const account = await db.query.maxPersonalAccounts.findFirst({
        where: and(eq(maxPersonalAccounts.tenantId, tenantId), eq(maxPersonalAccounts.accountId, accountId)),
      });
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      const { maxGreenApiAdapter } = await import("../services/max-green-api-adapter");
      const qrResult = await maxGreenApiAdapter.getQR(account.idInstance, account.apiTokenInstance, account.apiUrl);

      return res.json(qrResult);
    } catch (error: any) {
      console.error("[Admin] Error fetching GREEN-API QR:", error);
      res.status(500).json({ error: error.message || "Failed to fetch QR code" });
    }
  }
);

// GET /users/:userId/max-personal/:accountId/status — poll authorization status
router.get(
  "/users/:userId/max-personal/:accountId/status",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    try {
      const { userId, accountId } = req.params;

      const userRow = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId)).limit(1);
      if (!userRow[0]?.tenantId) {
        return res.status(404).json({ error: "User or tenant not found" });
      }
      const { tenantId } = userRow[0];

      const account = await db.query.maxPersonalAccounts.findFirst({
        where: and(eq(maxPersonalAccounts.tenantId, tenantId), eq(maxPersonalAccounts.accountId, accountId)),
      });
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      const { maxGreenApiAdapter } = await import("../services/max-green-api-adapter");
      const state = await maxGreenApiAdapter.getState(account.idInstance, account.apiTokenInstance, account.apiUrl);

      // If now authorized — register webhook and update DB
      if (state === "authorized" && account.status !== "authorized") {
        let displayName: string | undefined;
        try {
          const info = await maxGreenApiAdapter.getAccountInfo(account.idInstance, account.apiTokenInstance, account.apiUrl);
          displayName = info.nameAccount || info.wid;
        } catch {
          // non-fatal
        }

        let webhookRegistered = false;
        try {
          const appUrl = getAppUrl();
          const webhookUrl = `${appUrl}/webhooks/max-personal/${tenantId}/${accountId}`;
          await maxGreenApiAdapter.setWebhook(account.idInstance, account.apiTokenInstance, webhookUrl, account.apiUrl);
          webhookRegistered = true;
        } catch (err: any) {
          console.error("[Admin] GREEN-API setWebhook failed:", err.message);
        }

        await db.update(maxPersonalAccounts)
          .set({ status: "authorized", webhookRegistered, displayName: displayName ?? account.displayName, updatedAt: new Date() })
          .where(and(eq(maxPersonalAccounts.tenantId, tenantId), eq(maxPersonalAccounts.accountId, accountId)));
      }

      return res.json({ status: state });
    } catch (error: any) {
      console.error("[Admin] Error polling GREEN-API status:", error);
      res.status(500).json({ error: error.message || "Failed to poll status" });
    }
  }
);

// PATCH /users/:userId/max-personal/:accountId — update label
router.patch(
  "/users/:userId/max-personal/:accountId",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    try {
      const { userId, accountId } = req.params;
      const parsed = maxPersonalPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "label is required" });
      }

      const userRow = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId)).limit(1);
      if (!userRow[0]?.tenantId) {
        return res.status(404).json({ error: "User or tenant not found" });
      }
      const { tenantId } = userRow[0];

      const [updated] = await db.update(maxPersonalAccounts)
        .set({ label: parsed.data.label, updatedAt: new Date() })
        .where(and(eq(maxPersonalAccounts.tenantId, tenantId), eq(maxPersonalAccounts.accountId, accountId)))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Account not found" });
      }

      return res.json({ success: true, label: updated.label });
    } catch (error) {
      console.error("[Admin] Error updating MAX Personal account label:", error);
      res.status(500).json({ error: "Failed to update label" });
    }
  }
);

// POST /users/:userId/max-personal/:accountId/register-webhook — force re-register webhook
router.post(
  "/users/:userId/max-personal/:accountId/register-webhook",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    try {
      const { userId, accountId } = req.params;

      const userRow = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId)).limit(1);
      if (!userRow[0]?.tenantId) {
        return res.status(404).json({ error: "User or tenant not found" });
      }
      const { tenantId } = userRow[0];

      const [account] = await db.select().from(maxPersonalAccounts)
        .where(and(eq(maxPersonalAccounts.tenantId, tenantId), eq(maxPersonalAccounts.accountId, accountId)))
        .limit(1);
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      if (account.status !== "authorized") {
        return res.status(400).json({ error: "Account is not authorized" });
      }

      const appUrl = getAppUrl();
      const webhookUrl = `${appUrl}/webhooks/max-personal/${tenantId}/${accountId}`;
      const { maxGreenApiAdapter } = await import("../services/max-green-api-adapter");
      await maxGreenApiAdapter.setWebhook(account.idInstance, account.apiTokenInstance, webhookUrl, account.apiUrl);

      await db.update(maxPersonalAccounts)
        .set({ webhookRegistered: true, updatedAt: new Date() })
        .where(and(eq(maxPersonalAccounts.tenantId, tenantId), eq(maxPersonalAccounts.accountId, accountId)));

      return res.json({ success: true, webhookUrl });
    } catch (error: any) {
      console.error("[Admin] GREEN-API register-webhook failed:", error.message);
      res.status(500).json({ error: error.message || "Failed to register webhook" });
    }
  }
);

// DELETE /users/:userId/max-personal/:accountId — delete specific account
router.delete(
  "/users/:userId/max-personal/:accountId",
  requireAuth,
  requirePlatformAdmin(),
  async (req, res) => {
    try {
      const { userId, accountId } = req.params;

      const userRow = await db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId)).limit(1);
      if (!userRow[0]?.tenantId) {
        return res.status(404).json({ error: "User or tenant not found" });
      }
      const { tenantId } = userRow[0];

      let account: typeof maxPersonalAccounts.$inferSelect | undefined;
      try {
        account = await db.query.maxPersonalAccounts.findFirst({
          where: and(eq(maxPersonalAccounts.tenantId, tenantId), eq(maxPersonalAccounts.accountId, accountId)),
        });
      } catch (dbErr: any) {
        if (dbErr?.message?.includes("does not exist") || dbErr?.code === "42P01") {
          console.warn("[Admin] max_personal_accounts table not found — migration pending");
          return res.json({ success: true });
        }
        throw dbErr;
      }

      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      // If gateway instance — delete from gateway
      if (account.provider === "max_gateway") {
        try {
          const { maxGatewayClient } = await import("../services/max-gateway-client");
          await maxGatewayClient.deleteInstance(account.idInstance);
        } catch (err: any) {
          console.error("[Admin] Failed to delete gateway instance:", err.message);
          // non-fatal — continue with DB deletion
        }
      } else {
        // Clear webhook on GREEN-API
        try {
          const { maxGreenApiAdapter } = await import("../services/max-green-api-adapter");
          await maxGreenApiAdapter.setWebhook(account.idInstance, account.apiTokenInstance, "", account.apiUrl);
        } catch {
          // non-fatal
        }
      }

      await db.delete(maxPersonalAccounts)
        .where(and(eq(maxPersonalAccounts.tenantId, tenantId), eq(maxPersonalAccounts.accountId, accountId)));

      return res.json({ success: true });
    } catch (error) {
      console.error("[Admin] Error deleting MAX Personal account:", error);
      res.status(500).json({ error: "Failed to delete MAX Personal account" });
    }
  }
);

// =====================
// MAX GATEWAY ADMIN API
// =====================

// GET /max-gateway/config — check if gateway is configured
router.get("/max-gateway/config", requireAuth, requirePlatformAdmin(), async (req, res) => {
  try {
    const { getSecret: gs } = await import("../services/secret-resolver");
    const gatewayUrl = await gs({ scope: "global", keyName: "MAX_GATEWAY_URL" });
    const adminKey = await gs({ scope: "global", keyName: "MAX_GATEWAY_ADMIN_KEY" });
    res.json({ configured: !!(gatewayUrl && adminKey), gatewayUrl: gatewayUrl || null });
  } catch {
    res.json({ configured: false, gatewayUrl: null });
  }
});

// GET /max-gateway/stats — stats for all instances
router.get("/max-gateway/stats", requireAuth, requirePlatformAdmin(), async (req, res) => {
  try {
    const { maxGatewayClient } = await import("../services/max-gateway-client");
    const stats = await maxGatewayClient.getStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /max-gateway/instances — all instances on gateway
router.get("/max-gateway/instances", requireAuth, requirePlatformAdmin(), async (req, res) => {
  try {
    const { maxGatewayClient } = await import("../services/max-gateway-client");
    const instances = await maxGatewayClient.getAllInstances();
    res.json({ instances });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /max-gateway/tenants/:tenantId/instances
router.get("/max-gateway/tenants/:tenantId/instances", requireAuth, requirePlatformAdmin(), async (req, res) => {
  try {
    const { maxGatewayClient } = await import("../services/max-gateway-client");
    const instances = await maxGatewayClient.getTenantInstances(req.params.tenantId);
    res.json({ tenantId: req.params.tenantId, instances });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /max-gateway/proxies
router.get("/max-gateway/proxies", requireAuth, requirePlatformAdmin(), async (req, res) => {
  try {
    const { maxGatewayClient } = await import("../services/max-gateway-client");
    const result = await maxGatewayClient.getProxies();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /max-gateway/proxies — add proxies as text
router.post("/max-gateway/proxies", requireAuth, requirePlatformAdmin(), async (req, res) => {
  try {
    const { proxies, label } = req.body as { proxies: string; label?: string };
    if (!proxies) return res.status(400).json({ error: "proxies text is required" });
    const { maxGatewayClient } = await import("../services/max-gateway-client");
    const result = await maxGatewayClient.addProxies(proxies, label);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /max-gateway/proxies/upload — upload proxy list as text body
router.post("/max-gateway/proxies/upload", requireAuth, requirePlatformAdmin(), async (req, res) => {
  try {
    const { text, label, replace } = req.body as { text: string; label?: string; replace?: boolean };
    if (!text) return res.status(400).json({ error: "proxy list text is required" });
    const { maxGatewayClient } = await import("../services/max-gateway-client");
    const buf = Buffer.from(text, "utf-8");
    const result = await maxGatewayClient.uploadProxies(buf, label, replace === true);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /max-gateway/proxies — clear entire proxy pool
router.delete("/max-gateway/proxies", requireAuth, requirePlatformAdmin(), async (req, res) => {
  try {
    const { maxGatewayClient } = await import("../services/max-gateway-client");
    await maxGatewayClient.clearProxies();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /max-gateway/proxies/:id
router.delete("/max-gateway/proxies/:id", requireAuth, requirePlatformAdmin(), async (req, res) => {
  try {
    const { maxGatewayClient } = await import("../services/max-gateway-client");
    await maxGatewayClient.deleteProxy(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /max-gateway/proxies/:id
router.patch("/max-gateway/proxies/:id", requireAuth, requirePlatformAdmin(), async (req, res) => {
  try {
    const { active } = req.body as { active: boolean };
    if (typeof active !== "boolean") return res.status(400).json({ error: "active boolean is required" });
    const { maxGatewayClient } = await import("../services/max-gateway-client");
    await maxGatewayClient.toggleProxy(req.params.id, active);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
