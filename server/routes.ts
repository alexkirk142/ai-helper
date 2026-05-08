import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { registerPhase0Routes } from "./routes/phase0";
import authRouter from "./routes/auth";
import adminRouter from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth-api";
import { getSession } from "./session";
import cookieParser from "cookie-parser";
import { createTrackedApp } from "./services/route-registry";
import { csrfProtection, generateCsrfToken } from "./middleware/csrf";

// Domain route modules
import customerRouter from "./routes/customer.routes";
import conversationRouter from "./routes/conversation.routes";
import messageRouter from "./routes/message.routes";
import suggestionRouter from "./routes/suggestion.routes";
import escalationRouter from "./routes/escalation.routes";
import productRouter from "./routes/product.routes";
import knowledgeBaseRouter from "./routes/knowledge-base.routes";
import analyticsRouter from "./routes/analytics.routes";
import onboardingRouter from "./routes/onboarding.routes";
import billingRouter from "./routes/billing.routes";
import vehicleLookupRouter from "./routes/vehicle-lookup.routes";
import tenantConfigRouter from "./routes/tenant-config.routes";
import settingsRouter from "./routes/settings.routes";
import featureFlagsRouter from "./routes/feature-flags.routes";

// Channel management & webhook route modules
import channelManagementRouter from "./routes/channel-management.routes";
import telegramBotRouter from "./routes/channels/telegram-bot.routes";
import telegramPersonalRouter from "./routes/channels/telegram-personal.routes";
import whatsappPersonalRouter from "./routes/channels/whatsapp-personal.routes";
import maxRouter from "./routes/channels/max.routes";
import webhooksRouter from "./routes/webhooks.routes";

// Test / debug route module (non-production)
import testRouter from "./routes/test.routes";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  createTrackedApp(app);
  
  app.use(getSession());
  // cookie-parser must be registered after express-session (session parses its
  // own cookie internally and must not see it decoded first) and before csrf-csrf
  // (doubleCsrf reads req.cookies[cookieName] directly).
  app.use(cookieParser());

  // ============ CSRF PROTECTION ============
  // Applied after session (cookie ordering) but before every route.
  // GET /api/csrf-token must be registered BEFORE the middleware so clients
  // can fetch a fresh token without a prior token.  The endpoint is a GET
  // (safe method) so it is automatically exempt from CSRF validation.
  app.get("/api/csrf-token", (req: Request, res: Response) => {
    // overwrite: false — return the existing valid token from the cookie if
    // present; only generate a new one when no valid token exists yet (first
    // visit, cleared cookies, or post-login session regeneration).
    // Using overwrite:true caused a race condition: multiple parallel requests
    // each generated a different token and overwrote the cookie, so the login
    // POST header token no longer matched the final cookie value → 403.
    const token = generateCsrfToken(req, res, { overwrite: false });
    res.set("Cache-Control", "no-store");
    res.json({ token });
  });
  app.use(csrfProtection);

  registerAuthRoutes(app);
  
  // ============ DOMAIN ROUTE MODULES ============
  app.use(customerRouter);
  app.use(conversationRouter);
  app.use(messageRouter);
  app.use(suggestionRouter);
  app.use(escalationRouter);
  app.use(productRouter);
  app.use(knowledgeBaseRouter);
  app.use(analyticsRouter);
  app.use(onboardingRouter);
  app.use(billingRouter);
  app.use(vehicleLookupRouter);
  app.use(tenantConfigRouter);
  app.use(settingsRouter);
  app.use(featureFlagsRouter);

  // ============ CHANNEL MANAGEMENT ROUTES ============
  app.use(channelManagementRouter);
  app.use(telegramBotRouter);
  app.use(telegramPersonalRouter);
  app.use(whatsappPersonalRouter);
  app.use(maxRouter);

  // ============ TEST / DEBUG ROUTES (non-production only) ============
  if (process.env.NODE_ENV !== "production") {
    app.use(testRouter);
  }

  // ============ WEBHOOK ROUTES ============
  app.use(webhooksRouter);

  // ============ AUTH ROUTES (email/password) ============
  app.use("/auth", authRouter);

  // ============ PLATFORM ADMIN ROUTES ============
  app.use("/api/admin", adminRouter);

  // ============ PHASE 0 ROUTES ============
  registerPhase0Routes(app);

  return httpServer;
}
