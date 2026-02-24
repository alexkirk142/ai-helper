import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { users, tenants } from "@shared/schema";
import { sql, count, gte } from "drizzle-orm";
import { requireAuth, requirePermission } from "../middleware/rbac";

const router = Router();

async function getUserByIdOrOidcId(userId: string) {
  let user = await storage.getUserByOidcId(userId);
  if (!user) {
    user = await storage.getUser(userId);
  }
  return user;
}

// ============ DASHBOARD ROUTES ============

router.get("/api/dashboard/metrics", requireAuth, requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    const user = await storage.getUser(req.userId!);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const metrics = await storage.getDashboardMetrics(user.tenantId);
    res.json(metrics);
  } catch (error) {
    console.error("Error fetching metrics:", error);
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

// ============ CSAT ANALYTICS ============

router.get("/api/analytics/csat", requireAuth, requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { getCsatAnalytics } = await import("../services/csat-service");
    const analytics = await getCsatAnalytics(user.tenantId);

    res.json(analytics);
  } catch (error) {
    console.error("Error getting CSAT analytics:", error);
    res.status(500).json({ error: "Failed to get CSAT analytics" });
  }
});

// ============ CONVERSION ANALYTICS ============

router.get("/api/analytics/conversion", requireAuth, requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { getConversionAnalytics } = await import("../services/conversion-service");
    const analytics = await getConversionAnalytics(user.tenantId);

    res.json(analytics);
  } catch (error) {
    console.error("Error fetching conversion analytics:", error);
    res.status(500).json({ error: "Failed to fetch conversion analytics" });
  }
});

// ============ INTENT ANALYTICS ============

router.get("/api/analytics/intents", requireAuth, requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { getIntentAnalytics } = await import("../services/intent-analytics-service");
    const analytics = await getIntentAnalytics(user.tenantId);

    res.json(analytics);
  } catch (error) {
    console.error("Error fetching intent analytics:", error);
    res.status(500).json({ error: "Failed to fetch intent analytics" });
  }
});

// ============ LOST DEALS ANALYTICS ============

router.get("/api/analytics/lost-deals", requireAuth, requirePermission("VIEW_ANALYTICS"), async (req: Request, res: Response) => {
  try {
    if (!req.userId || req.userId === "system") {
      return res.status(403).json({ error: "User authentication required" });
    }
    const user = await getUserByIdOrOidcId(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }

    const { LostDealsService } = await import("../services/lost-deals-service");
    const lostDealsService = new LostDealsService(storage);
    const analytics = await lostDealsService.getLostDealsAnalytics(user.tenantId);

    res.json(analytics);
  } catch (error) {
    console.error("Error fetching lost deals analytics:", error);
    res.status(500).json({ error: "Failed to fetch lost deals analytics" });
  }
});

// ============ ADMIN SECURITY ROUTES ============

router.get("/api/admin/security/readiness", requireAuth, requirePermission("VIEW_AUDIT_LOGS"), async (req: Request, res: Response) => {
  try {
    const { generateSecurityReadinessReport } = await import("../services/security-readiness");
    const report = generateSecurityReadinessReport();
    res.json(report);
  } catch (error) {
    console.error("Error generating security readiness report:", error);
    res.status(500).json({ error: "Failed to generate security readiness report" });
  }
});

// System metrics endpoint for monitoring hardware load (platform owner only)
router.get("/api/admin/system/metrics", requireAuth, async (req: Request, res: Response) => {
  const user = await storage.getUser(req.userId || "");
  if (!user?.isPlatformOwner) {
    return res.status(403).json({ error: "Platform owner access required" });
  }
  try {
    const os = await import("os");
    
    const cpus = os.cpus();
    const cpuCount = cpus.length;
    let totalIdle = 0;
    let totalTick = 0;
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });
    const cpuUsagePercent = Math.round(((totalTick - totalIdle) / totalTick) * 100);
    
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsagePercent = Math.round((usedMemory / totalMemory) * 100);
    
    const uptimeSeconds = os.uptime();
    const uptimeDays = Math.floor(uptimeSeconds / 86400);
    const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
    const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);
    
    const loadAverage = os.loadavg();
    
    let dbStats = null;
    try {
      const result = await db.execute(sql`SELECT count(*) as connections FROM pg_stat_activity WHERE datname = current_database()`);
      dbStats = {
        activeConnections: Number(result.rows[0]?.connections || 0)
      };
    } catch (e) {
      // Ignore DB stats errors
    }
    
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    let userStats = { totalUsers: 0, activeLast24h: 0, activeLast7d: 0, totalTenants: 0 };
    try {
      const [totalUsersResult, activeLast24hResult, activeLast7dResult, tenantsResult] = await Promise.all([
        db.select({ count: count() }).from(users),
        db.select({ count: count() }).from(users).where(gte(users.lastLoginAt, last24h)),
        db.select({ count: count() }).from(users).where(gte(users.lastLoginAt, last7d)),
        db.select({ count: count() }).from(tenants)
      ]);
      userStats = {
        totalUsers: Number(totalUsersResult[0]?.count || 0),
        activeLast24h: Number(activeLast24hResult[0]?.count || 0),
        activeLast7d: Number(activeLast7dResult[0]?.count || 0),
        totalTenants: Number(tenantsResult[0]?.count || 0)
      };
    } catch (e) {
      // Ignore user stats errors
    }
    
    const recommendations = [];
    if (cpuUsagePercent > 80) {
      recommendations.push({ type: "cpu", message: "Высокая нагрузка на CPU. Рекомендуется апгрейд." });
    }
    if (memoryUsagePercent > 85) {
      recommendations.push({ type: "memory", message: "Высокое использование памяти. Рекомендуется увеличить RAM." });
    }
    if (loadAverage[0] > cpuCount) {
      recommendations.push({ type: "load", message: "Load average превышает число ядер. Система перегружена." });
    }
    
    res.json({
      cpu: {
        cores: cpuCount,
        usagePercent: cpuUsagePercent,
        model: cpus[0]?.model || "Unknown"
      },
      memory: {
        total: totalMemory,
        used: usedMemory,
        free: freeMemory,
        usagePercent: memoryUsagePercent
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: {
          seconds: uptimeSeconds,
          formatted: `${uptimeDays}д ${uptimeHours}ч ${uptimeMinutes}м`
        },
        loadAverage: {
          "1min": Math.round(loadAverage[0] * 100) / 100,
          "5min": Math.round(loadAverage[1] * 100) / 100,
          "15min": Math.round(loadAverage[2] * 100) / 100
        }
      },
      database: dbStats,
      users: userStats,
      recommendations,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error getting system metrics:", error);
    res.status(500).json({ error: "Failed to get system metrics" });
  }
});

export default router;
