import type { Express, Request, Response } from "express";
import { storage } from "../storage";

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    name: string;
    status: "pass" | "fail";
    message?: string;
    responseTime?: number;
  }[];
}

const startTime = Date.now();

export function registerHealthRoutes(app: Express): void {
  // Basic health check - always returns 200 if server is running
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  });

  // Detailed readiness check - verifies all dependencies
  app.get("/ready", async (_req: Request, res: Response) => {
    const checks: HealthStatus["checks"] = [];
    let overallStatus: HealthStatus["status"] = "healthy";

    // Check storage
    const storageStart = Date.now();
    try {
      const tenant = await storage.getDefaultTenant();
      checks.push({
        name: "storage",
        status: tenant ? "pass" : "fail",
        message: tenant ? "Storage accessible" : "No default tenant found",
        responseTime: Date.now() - storageStart,
      });
    } catch (error) {
      checks.push({
        name: "storage",
        status: "fail",
        message: error instanceof Error ? error.message : "Storage check failed",
        responseTime: Date.now() - storageStart,
      });
      overallStatus = "unhealthy";
    }

    // Check OpenAI configuration
    const hasOpenAIKey = !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    checks.push({
      name: "openai",
      status: hasOpenAIKey ? "pass" : "fail",
      message: hasOpenAIKey ? "API key configured" : "API key missing",
    });
    if (!hasOpenAIKey) {
      overallStatus = overallStatus === "healthy" ? "degraded" : overallStatus;
    }

    // Check memory usage
    const memoryUsage = process.memoryUsage();
    const memoryUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const memoryTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    const memoryPercent = Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100);
    
    checks.push({
      name: "memory",
      status: memoryPercent < 90 ? "pass" : "fail",
      message: `${memoryUsedMB}MB / ${memoryTotalMB}MB (${memoryPercent}%)`,
    });
    if (memoryPercent >= 90) {
      overallStatus = overallStatus === "healthy" ? "degraded" : overallStatus;
    }

    const response: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "1.0.0",
      uptime: Math.round((Date.now() - startTime) / 1000),
      checks,
    };

    const statusCode = overallStatus === "unhealthy" ? 503 : 200;
    res.status(statusCode).json(response);
  });

  // Metrics endpoint (minimal)
  app.get("/metrics", async (_req: Request, res: Response) => {
    const memoryUsage = process.memoryUsage();
    
    // Get tenant for customer memory metrics
    const tenant = await storage.getDefaultTenant();
    let customerMemoryMetrics = {
      customers_count: 0,
      notes_count: 0,
      memory_count: 0,
    };
    
    if (tenant) {
      const [customersCount, notesCount, memoryCount] = await Promise.all([
        storage.getCustomersCount(tenant.id),
        storage.getCustomerNotesCount(tenant.id),
        storage.getCustomerMemoryCount(tenant.id),
      ]);
      customerMemoryMetrics = {
        customers_count: customersCount,
        notes_count: notesCount,
        memory_count: memoryCount,
      };
    }
    
    res.json({
      uptime_seconds: Math.round((Date.now() - startTime) / 1000),
      memory: {
        heap_used_bytes: memoryUsage.heapUsed,
        heap_total_bytes: memoryUsage.heapTotal,
        external_bytes: memoryUsage.external,
        rss_bytes: memoryUsage.rss,
      },
      customer_memory: customerMemoryMetrics,
      timestamp: new Date().toISOString(),
    });
  });
}
