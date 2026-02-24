import express from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { requestContextMiddleware } from "./middleware/request-context";
import { apiRateLimiter } from "./middleware/rate-limiter";
import { getRateLimiterRedis, closeRateLimiterRedis } from "./redis-client";
import { registerHealthRoutes } from "./routes/health";
import { validateConfig, checkRequiredServices } from "./config";
import { WhatsAppPersonalAdapter } from "./services/whatsapp-personal-adapter";
import { realtimeService } from "./services/websocket-server";
import { storage } from "./storage";
import { telegramClientManager } from "./services/telegram-client-manager";
import { errorHandler } from "./middleware/error-handler";
import { pool } from "./db";
import { closeQueue } from "./services/message-queue";
import { closeVehicleLookupQueue } from "./services/vehicle-lookup-queue";
import { closePriceLookupQueue } from "./services/price-lookup-queue";
import { startVehicleLookupWorker } from "./workers/vehicle-lookup.worker";
import { startPriceLookupWorker } from "./workers/price-lookup.worker";
import { startWorker as startMessageSendWorker } from "./workers/message-send.worker";
import type { Worker } from "bullmq";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";
import { bootstrapPlatformOwner } from "./services/owner-bootstrap";
import { featureFlagService } from "./services/feature-flags";
import { sanitizeForLog } from "./utils/sanitizer";

let podzamenuProcess: ChildProcess | null = null;
let vehicleLookupWorker: Worker | null = null;
let priceLookupWorker: Worker | null = null;
let messageSendWorker: Worker | null = null;

// Validate configuration on startup
const config = validateConfig();

// Eagerly initialise the rate-limiter Redis client so it connects before the
// first request arrives (non-blocking; falls back to in-memory if unavailable).
getRateLimiterRedis();
const serviceCheck = checkRequiredServices();
if (serviceCheck.warnings.length > 0) {
  console.warn("Configuration warnings:");
  serviceCheck.warnings.forEach((w) => console.warn(`  - ${w}`));
}

const app = express();
// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "10mb", // raised from default 100kb to support base64-encoded image uploads
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "10mb" }));

// Phase 0: Request context middleware (adds requestId, sets audit context)
app.use(requestContextMiddleware);

// Phase 0: Rate limiting for API endpoints
app.use("/api", apiRateLimiter);

// Phase 0: Health check routes (before auth/other middleware)
registerHealthRoutes(app);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(sanitizeForLog(capturedJsonResponse))}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Intercept oversized request bodies before any route handler can log them
  if (process.env.NODE_ENV !== 'test') {
    app.use((req, _res, next) => {
      if (req.body && JSON.stringify(req.body).length > 1000) {
        console.log(`[HTTP] ${req.method} ${req.path} body suppressed (too large)`);
      }
      next();
    });
  }

  await registerRoutes(httpServer, app);

  app.use(errorHandler);

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  realtimeService.initialize(httpServer);

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    async () => {
      log(`serving on port ${port}`);
      
      // Load persisted feature flags from DB into in-memory cache
      await featureFlagService.initFromDb();

      // Bootstrap platform owner (idempotent)
      try {
        const ownerResult = await bootstrapPlatformOwner();
        if (ownerResult.action !== "skipped") {
          log(`Platform owner ${ownerResult.action}: ${ownerResult.userId}`, "startup");
        }
      } catch (err: any) {
        log(`Platform owner bootstrap failed: ${err.message}`, "startup");
      }
      
      // Ensure default tenant exists in database
      const tenant = await storage.ensureDefaultTenant();
      log(`Default tenant ready: ${tenant.id}`, "startup");
      
      // Auto-restore WhatsApp Personal sessions on startup
      // Pass the real tenant UUID to map file system "default" folder to database UUID
      await restoreWhatsAppSessions(tenant.id);
      
      // Auto-restore Telegram Personal sessions on startup
      try {
        await telegramClientManager.initialize();
        log("Telegram Personal sessions initialized", "startup");
      } catch (err: any) {
        log(`Telegram Personal initialization failed: ${err.message}`, "startup");
      }
      
      // Auto-start Podzamenu lookup service
      startPodzamenuService();

      // Wait for Podzamenu (Playwright) to finish initializing before workers start
      log("Waiting 15s for Podzamenu service to initialize...", "startup");
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      log("Podzamenu startup delay elapsed, starting BullMQ workers", "startup");

      // Start BullMQ workers
      vehicleLookupWorker = await startVehicleLookupWorker();
      priceLookupWorker = await startPriceLookupWorker();
      messageSendWorker = await startMessageSendWorker();
      log("BullMQ workers started", "startup");
    },
  );
})();

// Restore saved WhatsApp Personal sessions on server start
// Maps file system folder "default" to the actual database tenant UUID
async function restoreWhatsAppSessions(realTenantId: string) {
  const sessionsDir = "./whatsapp_sessions";
  
  if (!fs.existsSync(sessionsDir)) {
    return;
  }
  
  try {
    // Migrate "default" folder to real tenant UUID if needed
    const defaultPath = `${sessionsDir}/default`;
    const realPath = `${sessionsDir}/${realTenantId}`;
    
    if (fs.existsSync(defaultPath) && !fs.existsSync(realPath)) {
      log(`Migrating WhatsApp session from 'default' to '${realTenantId}'`, "whatsapp");
      fs.renameSync(defaultPath, realPath);
    }
    
    const tenantDirs = fs.readdirSync(sessionsDir);
    
    for (const tenantId of tenantDirs) {
      const tenantPath = `${sessionsDir}/${tenantId}`;
      if (fs.statSync(tenantPath).isDirectory()) {
        log(`Restoring WhatsApp session for tenant: ${tenantId}`, "whatsapp");
        
        try {
          const result = await WhatsAppPersonalAdapter.restoreSession(tenantId);
          if (result.connected) {
            log(`WhatsApp session restored for ${tenantId}: ${result.user?.phone || 'connected'}`, "whatsapp");
          } else if (result.error?.includes("Session expired")) {
            log(`WhatsApp session expired for ${tenantId}, needs re-auth`, "whatsapp");
          } else {
            log(`WhatsApp session restore failed for ${tenantId}: ${result.error}`, "whatsapp");
          }
        } catch (err: any) {
          log(`Failed to restore WhatsApp session for ${tenantId}: ${err.message}`, "whatsapp");
        }
      }
    }
  } catch (err: any) {
    log(`Error scanning WhatsApp sessions: ${err.message}`, "whatsapp");
  }
}

// Auto-start Podzamenu Python lookup service (FastAPI, port 8200)
function startPodzamenuService() {
  const scriptPath = "./podzamenu_lookup_service.py";

  if (!fs.existsSync(scriptPath)) {
    log("Podzamenu service script not found, skipping auto-start", "podzamenu");
    return;
  }

  if (podzamenuProcess && !podzamenuProcess.killed) {
    log("Podzamenu service already running", "podzamenu");
    return;
  }

  try {
    log("Starting Podzamenu lookup service...", "podzamenu");

    podzamenuProcess = spawn("python3", [scriptPath], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: "8200",
      },
    });

    podzamenuProcess.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      lines.forEach(line => {
        if (line.includes("Uvicorn running")) {
          log("Podzamenu service started on port 8200", "podzamenu");
        }
      });
    });

    podzamenuProcess.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (!msg.includes("INFO:")) {
        console.error("[Podzamenu]", msg);
      }
    });

    podzamenuProcess.on("error", (err) => {
      log(`Podzamenu service error: ${err.message}`, "podzamenu");
    });

    podzamenuProcess.on("exit", (code, signal) => {
      log(`Podzamenu service exited (code: ${code}, signal: ${signal})`, "podzamenu");
      podzamenuProcess = null;
    });

  } catch (err: any) {
    log(`Failed to start Podzamenu service: ${err.message}`, "podzamenu");
  }
}

// Graceful shutdown — ordered teardown on SIGTERM / SIGINT
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log(`Received ${signal}, starting graceful shutdown`, "shutdown");

  // Kill Python subprocesses first so they stop producing new work
  if (podzamenuProcess && !podzamenuProcess.killed) {
    podzamenuProcess.kill();
    log("Podzamenu service stopped", "shutdown");
  }

  // Step 1 + 2: Stop accepting new connections; drain in-flight with 5 s timeout
  await new Promise<void>((resolve) => {
    const forceClose = setTimeout(() => {
      log("Drain timeout reached, proceeding", "shutdown");
      resolve();
    }, 5_000);

    httpServer.close(() => {
      clearTimeout(forceClose);
      log("HTTP server closed", "shutdown");
      resolve();
    });
  });

  // Step 3a: Close BullMQ workers (stop accepting new jobs, drain active ones)
  await Promise.allSettled([
    vehicleLookupWorker?.close(),
    priceLookupWorker?.close(),
    messageSendWorker?.close(),
  ]);
  log("BullMQ workers closed", "shutdown");

  // Step 3b: Close BullMQ queue connections
  await Promise.allSettled([
    closeQueue(),
    closeVehicleLookupQueue(),
    closePriceLookupQueue(),
  ]);
  log("BullMQ queues closed", "shutdown");

  // Step 4: Close WebSocket server
  await realtimeService.close();
  log("WebSocket server closed", "shutdown");

  // Step 5: Close database pool
  await pool.end();
  log("Database pool closed", "shutdown");

  // Step 6: Close rate-limiter Redis client
  await closeRateLimiterRedis();
  log("Rate-limiter Redis closed", "shutdown");

  log("Graceful shutdown complete", "shutdown");
  process.exit(0);
}

process.on("SIGTERM", () => { gracefulShutdown("SIGTERM").catch(console.error); });
process.on("SIGINT",  () => { gracefulShutdown("SIGINT").catch(console.error); });
