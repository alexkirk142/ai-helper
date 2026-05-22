// Suppress gramJS internal _updateLoop TIMEOUT spam — these are normal long-poll
// timeouts that gramJS catches and re-logs via console.error on every cycle (~15s).
// They are not real errors; the loop always retries successfully.
const _origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (
    args[0] instanceof Error &&
    args[0].message === "TIMEOUT" &&
    typeof args[0].stack === "string" &&
    args[0].stack.includes("updates.js")
  ) {
    return;
  }
  _origConsoleError.apply(console, args);
};

import express from "express";
import cors from "cors";
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
import { setupInboundMessageHandler } from "./services/inbound-message-handler";
import { errorHandler } from "./middleware/error-handler";
import { pool } from "./db";
import { closeQueue } from "./services/message-queue";
import { closeVehicleLookupQueue } from "./services/vehicle-lookup-queue";
import { closeNoReplyCheckQueue } from "./services/no-reply-check-queue";
import { startVehicleLookupWorker } from "./workers/vehicle-lookup.worker";
import { startWorker as startMessageSendWorker } from "./workers/message-send.worker";
import { startMarquizLeadWorker } from "./workers/marquiz-lead.worker";
import { startNoReplyCheckWorker } from "./workers/no-reply-check.worker";
import { startLearningQueueWorker } from "./workers/learning-queue.worker";
import type { Worker } from "bullmq";
import * as fs from "fs";
import { bootstrapPlatformOwner } from "./services/owner-bootstrap";
import { featureFlagService } from "./services/feature-flags";
import { sanitizeForLog } from "./utils/sanitizer";

let vehicleLookupWorker: Worker | null = null;
let messageSendWorker: Worker | null = null;
let marquizLeadWorker: Worker | null = null;
let noReplyCheckWorker: Worker | null = null;
let learningQueueWorker: Worker | null = null;

// Prevent gramjs internal timeouts and other unhandled rejections from crashing the process
process.on("unhandledRejection", (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  // Suppress known benign gramjs errors
  if (
    msg.includes("TIMEOUT") ||
    msg.includes("AUTH_KEY_DUPLICATED") ||
    msg.includes("Connection was closed")
  ) {
    console.warn("[Process] Suppressed unhandled rejection:", msg);
    return;
  }
  console.error("[Process] Unhandled rejection:", reason);
});

process.on("uncaughtException", (err: Error) => {
  const msg = err?.message ?? String(err);
  if (
    msg.includes("TIMEOUT") ||
    msg.includes("AUTH_KEY_DUPLICATED") ||
    msg.includes("Connection was closed")
  ) {
    console.warn("[Process] Suppressed uncaught exception:", msg);
    return;
  }
  console.error("[Process] Uncaught exception:", err);
  process.exit(1);
});

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

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : undefined;

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

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
      const isSilentRoute =
        path === "/api/conversations" ||
        path === "/api/failed-leads" ||
        /^\/api\/conversations\/[^/]+$/.test(path) ||
        /^\/api\/conversations\/[^/]+\/messages/.test(path) ||
        /^\/api\/customers\/[^/]+$/.test(path) ||
        /^\/api\/escalations/.test(path);
      if (capturedJsonResponse && !isSilentRoute) {
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
      
      // Apply any pending lightweight column migrations (idempotent ADD COLUMN IF NOT EXISTS)
      try {
        await pool.query(`
          ALTER TABLE max_personal_accounts
            ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN NOT NULL DEFAULT TRUE;
        `);
        await pool.query(`
          ALTER TABLE telegram_sessions
            ADD COLUMN IF NOT EXISTS tg_role TEXT NOT NULL DEFAULT 'both';
        `);
        await pool.query(`
          ALTER TABLE tenants
            ADD COLUMN IF NOT EXISTS template_gearbox_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS template_engine_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS template_tires_enabled   BOOLEAN NOT NULL DEFAULT TRUE;
        `);
        await pool.query(`
          ALTER TABLE tenants
            ADD COLUMN IF NOT EXISTS escalation_chat_id TEXT;
        `);
        await pool.query(`
          ALTER TABLE tenants
            ADD COLUMN IF NOT EXISTS lead_channel_priority TEXT[];
        `);
        // Notify bot subscribers table
        await pool.query(`
          CREATE TABLE IF NOT EXISTS notify_bot_subscribers (
            id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            chat_id     BIGINT NOT NULL UNIQUE,
            first_name  TEXT,
            username    TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        log("DB column check: auto_reply_enabled + tg_role + template flags + escalation_chat_id + lead_channel_priority OK", "startup");
      } catch (err: any) {
        log(`DB column migration warning: ${err.message}`, "startup");
      }

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
      
      vehicleLookupWorker = await startVehicleLookupWorker();
      messageSendWorker = await startMessageSendWorker();
      marquizLeadWorker = startMarquizLeadWorker();
      noReplyCheckWorker = startNoReplyCheckWorker();
      const learningQueueResult = startLearningQueueWorker();
      learningQueueWorker = learningQueueResult?.worker ?? null;
      log("BullMQ workers started", "startup");

      // Wire messageBus → processIncomingMessageFull before any channel connects
      setupInboundMessageHandler();
      log("Inbound message handler subscribed to message bus", "startup");

      // Auto-restore Telegram Personal sessions in background — must not block worker startup
      telegramClientManager.initialize()
        .then(() => log("Telegram Personal sessions initialized", "startup"))
        .catch((err: any) => log(`Telegram Personal initialization failed: ${err.message}`, "startup"));

      // Reconcile MAX gateway accounts: fix provider, sync status & displayName from gateway
      backfillMaxGatewayDisplayNames()
        .then((n) => log(`MAX gateway reconcile complete: ${n} account(s) updated`, "startup"))
        .catch((err: any) => log(`MAX gateway reconcile failed: ${err.message}`, "startup"));

      // Subscribe to SSE /instances/{id}/events for each gateway account.
      // Handles the `deleted` event: marks account as deleted in DB when removed from gateway.
      import("./services/max-gateway-sse-manager")
        .then(({ gatewaySSEManager }) =>
          gatewaySSEManager.initializeAll()
            .then(() => log("MAX Gateway SSE subscriptions initialized", "startup"))
            .catch((err: any) => log(`MAX Gateway SSE init failed: ${err.message}`, "startup"))
        )
        .catch(() => {});

      // Register notification bot webhook (fire-and-forget, non-blocking)
      import("./routes/notify-bot-webhook").then(({ registerNotifyBotWebhook }) => {
        try {
          const { getAppUrl } = require("./utils/app-url");
          registerNotifyBotWebhook(getAppUrl()).catch(() => {});
        } catch {
          // APP_URL not configured — skip silently
        }
      });
    },
  );
})();

// Reconcile all MAX gateway accounts on startup:
//  1. Fix provider = "green_api" for legacy mpa-* instances
//  2. For every gateway account call getInstanceStatus and sync:
//     - displayName (phone number)
//     - status: if gateway says authenticated=false but DB says "authorized" → mark notAuthorized
// Returns number of rows actually changed.
async function backfillMaxGatewayDisplayNames(): Promise<number> {
  const { db } = await import("./db");
  const { maxPersonalAccounts } = await import("@shared/schema");
  const { and, eq, like, ne, or } = await import("drizzle-orm");
  const { maxGatewayClient } = await import("./services/max-gateway-client");

  // Step 1: fix provider for legacy mpa-* accounts stored as "green_api"
  try {
    const fixed = await db.update(maxPersonalAccounts)
      .set({ provider: "max_gateway", updatedAt: new Date() })
      .where(and(
        like(maxPersonalAccounts.idInstance, "mpa-%"),
        ne(maxPersonalAccounts.provider, "max_gateway"),
      ))
      .returning({ accountId: maxPersonalAccounts.accountId });
    if (fixed.length > 0) {
      log(`MAX gateway provider fix: corrected ${fixed.length} account(s)`, "startup");
    }
  } catch (err: any) {
    log(`MAX gateway provider fix failed: ${err.message}`, "startup");
  }

  // Step 2: load ALL gateway accounts (by provider OR idInstance prefix)
  const rows = await db.select({
    accountId: maxPersonalAccounts.accountId,
    tenantId: maxPersonalAccounts.tenantId,
    idInstance: maxPersonalAccounts.idInstance,
    status: maxPersonalAccounts.status,
    displayName: maxPersonalAccounts.displayName,
  }).from(maxPersonalAccounts)
    .where(or(
      eq(maxPersonalAccounts.provider, "max_gateway"),
      like(maxPersonalAccounts.idInstance, "mpa-%"),
    ));

  let updated = 0;
  for (const row of rows) {
    try {
      const gwStatus = await maxGatewayClient.getInstanceStatus(row.idInstance);
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      let changed = false;

      // Sync displayName from gateway phone/displayName
      const name = gwStatus.phone ?? gwStatus.displayName ?? null;
      if (name && !row.displayName) {
        updates.displayName = name;
        changed = true;
      }

      // Sync auth status: mark notAuthorized if gateway says not authenticated
      if (!gwStatus.authenticated && row.status === "authorized") {
        updates.status = "notAuthorized";
        changed = true;
        log(`MAX gateway reconcile: ${row.idInstance} marked notAuthorized (was authorized in DB)`, "startup");
      }

      if (changed) {
        await db.update(maxPersonalAccounts)
          .set(updates)
          .where(and(
            eq(maxPersonalAccounts.tenantId, row.tenantId),
            eq(maxPersonalAccounts.accountId, row.accountId),
          ));
        updated++;
      }
    } catch {
      // non-fatal — skip this instance
    }
  }
  return updated;
}

// Restore saved WhatsApp Personal sessions on server start.
// Collects tenant IDs from BOTH the file system and the DB so sessions
// survive container restarts where the FS is ephemeral.
async function restoreWhatsAppSessions(realTenantId: string) {
  const sessionsDir = "./whatsapp_sessions";

  const tenantIds = new Set<string>();

  // ── 1. Collect from file system (if directory exists) ───────────────────
  try {
    // Migrate "default" folder to real tenant UUID if needed
    const defaultPath = `${sessionsDir}/default`;
    const realPath = `${sessionsDir}/${realTenantId}`;
    if (fs.existsSync(defaultPath) && !fs.existsSync(realPath)) {
      log(`Migrating WhatsApp session from 'default' to '${realTenantId}'`, "whatsapp");
      fs.renameSync(defaultPath, realPath);
    }

    if (fs.existsSync(sessionsDir)) {
      for (const entry of fs.readdirSync(sessionsDir)) {
        if (fs.statSync(`${sessionsDir}/${entry}`).isDirectory()) {
          tenantIds.add(entry);
        }
      }
    }
  } catch (err: any) {
    log(`Error scanning WhatsApp session dirs: ${err.message}`, "whatsapp");
  }

  // ── 2. Collect from DB (handles ephemeral FS after container restart) ───
  try {
    const { db: dbInstance } = await import("./db");
    const { whatsappAuthSessions } = await import("@shared/schema");
    const rows = await dbInstance.select({ tenantId: whatsappAuthSessions.tenantId }).from(whatsappAuthSessions);
    for (const row of rows) {
      tenantIds.add(row.tenantId);
    }
    if (rows.length > 0) {
      log(`Found ${rows.length} WhatsApp session(s) in DB`, "whatsapp");
    }
  } catch (err: any) {
    log(`Error reading WhatsApp sessions from DB: ${err.message}`, "whatsapp");
  }

  // ── 3. Restore each tenant (startAuth will restore FS from DB if needed) ─
  for (const tenantId of tenantIds) {
    log(`Restoring WhatsApp session for tenant: ${tenantId}`, "whatsapp");
    try {
      const result = await WhatsAppPersonalAdapter.restoreSession(tenantId);
      if (result.connected) {
        log(`WhatsApp session restored for ${tenantId}: ${result.user?.phone || "connected"}`, "whatsapp");
      } else if (result.error?.includes("Session expired")) {
        log(`WhatsApp session expired for ${tenantId}, needs re-auth`, "whatsapp");
      } else {
        log(`WhatsApp session restoring in background for ${tenantId}`, "whatsapp");
      }
    } catch (err: any) {
      log(`Failed to restore WhatsApp session for ${tenantId}: ${err.message}`, "whatsapp");
    }
  }

  if (tenantIds.size === 0) {
    log("No saved WhatsApp sessions found", "whatsapp");
  }
}

// Graceful shutdown — ordered teardown on SIGTERM / SIGINT
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log(`Received ${signal}, starting graceful shutdown`, "shutdown");

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

  // Step 3a: Disconnect Telegram Personal sessions gracefully so Telegram
  // releases auth keys immediately — prevents TIMEOUT on the next restart
  try {
    const { telegramClientManager } = await import("./services/telegram-client-manager");
    await telegramClientManager.shutdown();
    log("Telegram Personal sessions disconnected", "shutdown");
  } catch (tgErr: any) {
    log(`Telegram shutdown error (non-fatal): ${tgErr.message}`, "shutdown");
  }

  // Step 3b: Close BullMQ workers (stop accepting new jobs, drain active ones)
  await Promise.allSettled([
    vehicleLookupWorker?.close(),
    messageSendWorker?.close(),
    marquizLeadWorker?.close(),
  ]);
  log("BullMQ workers closed", "shutdown");

  // Step 3c: Close BullMQ queue connections
  await Promise.allSettled([
    closeQueue(),
    closeVehicleLookupQueue(),
    closeNoReplyCheckQueue(),
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
