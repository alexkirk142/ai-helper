# Codebase Audit & Improvement Plan

**Auditor:** Senior Tech Lead (automated deep audit)
**Initial Audit:** 2026-02-20
**Last Updated:** 2026-02-24 (Phase 1–3: Yandex+Playwright price pipeline, escalation, feature flags)
**Scope:** Full codebase — server, client, shared, Python services, config, migrations, docs
**Codebase:** AI Sales Operator — B2B SaaS for AI-powered customer support automation

---

## Audit Summary (2026-02-24)

**All 9 CRIT issues from the initial audit are fixed.** Most DEBT and ARCH items are also resolved. The system is significantly more robust and secure. Key new findings from the February 22 and February 24 audits are documented in Sections 9 and 14 below.

### Current Status Overview

| Category | Total | ✅ Fixed | ⚠️ Partial | ❌ Not Done |
|----------|-------|---------|-----------|------------|
| Critical | 9 | 9 | 0 | 0 |
| Technical Debt | 13 | 9 | 0 | 4 |
| Architecture | 6 | 5 | 0 | 1 |
| Security | ~10 | 6 | 2 | 2 |
| Performance | ~10 | 7 | 1 | 2 |
| New Findings (2026-02-22) | 8 | 2 | 2 | 4 |
| New Findings (2026-02-24 — OCR/extraction) | 2 | 2 | 0 | 0 |
| New Findings (2026-02-24 — Price Architecture) | 8 | 7 | 1 | 0 |

---

---

## Section 1: Critical Issues

Issues that can cause data breaches, crashes, or data loss. **Fix immediately.**

### CRIT-01: ~~WebSocket server has ZERO authentication~~ — FIXED

- **File:** `server/services/websocket-server.ts`
- **Lines:** 19–36, 58–66
- **Problem:** Any client can connect to `/ws`, send `{"type":"set_tenant","tenantId":"<any-uuid>"}`, and receive all real-time messages (customer data, AI suggestions, conversation updates) for any tenant. There is no session/token verification on the upgrade request or on `set_tenant` messages. This is a full cross-tenant data breach vector.
- **Solution:** Verify the session cookie on the HTTP `upgrade` request before accepting the WebSocket connection. Validate that the `tenantId` set by the client matches the user's authenticated tenant. Reject unauthorized connections with `socket.destroy()`.
- **Priority:** CRITICAL
- **Status:** ✅ FIXED — Session cookie is now verified on WebSocket upgrade via `authenticateAndUpgrade()`. Tenant is resolved from the authenticated user's session and bound to the connection. Clients cannot override `tenantId`. Unauthenticated connections are rejected with 401 in production. Client updated to no longer send `set_tenant`.

### CRIT-02: ~~No tenant isolation on entity lookups — cross-tenant data access~~ — FIXED

- **File:** `server/routes.ts`
- **Lines:** 171–181 (customers), 570–593 (conversations), and many more
- **Problem:** `GET /api/customers/:id`, `PATCH /api/customers/:id`, `GET /api/customers/:id/notes`, `DELETE /api/customers/:id/data`, `PATCH /api/conversations/:id`, and other endpoints fetch entities by UUID without verifying the entity belongs to the requesting user's tenant. An authenticated user from tenant A can read and modify data from tenant B by guessing UUIDs.
- **Solution:** Add `AND tenantId = :userTenantId` to all single-entity queries, or add a middleware that verifies ownership after fetching.
- **Priority:** CRITICAL
- **Status:** ✅ FIXED — All single-entity route handlers now verify `entity.tenantId === user.tenantId` after fetch. Affected endpoints: `GET/PATCH /api/customers/:id`, `GET/POST/DELETE /api/customers/:id/notes`, `GET/PATCH/POST /api/customers/:id/memory`, `PATCH /api/conversations/:id`, `POST /api/conversations/:id/messages`, `POST /api/conversations/:id/generate-suggestion`, `POST /api/suggestions/:id/{approve,edit,reject,escalate}`, `PATCH /api/escalations/:id`, `PATCH/DELETE /api/products/:id`, `PATCH/DELETE /api/knowledge-docs/:id`. All return 404 (not 403) on cross-tenant access to avoid leaking entity existence.

### CRIT-03: ~~Error handler re-throws, crashing the process~~ — FIXED

- **File:** `server/index.ts`
- **Lines:** 97–103
- **Problem:** After sending the error response to the client, the global error handler calls `throw err`. This re-throws into the Node.js event loop as an unhandled exception, which crashes the process.
- **Solution:** Remove `throw err`. Log the error instead (e.g., `console.error(err)` or use a structured logger). If you want crash-on-unknown, do it only for programmer errors, not for all errors.
- **Priority:** CRITICAL
- **Status:** ✅ FIXED — Replaced the broken inline error handler (which sent a response then re-threw) with `app.use(errorHandler)` from `server/middleware/error-handler.ts`. The existing middleware already logs errors as structured JSON, handles `ZodError` → 400, operational errors → their status code, and unknown errors → 500, without re-throwing. Removed the now-unused `Request`, `Response`, `NextFunction` imports from `server/index.ts`.

### CRIT-04: ~~SESSION_SECRET can be undefined in production~~ — FIXED

- **File:** `server/config.ts` line 14; session setup uses `process.env.SESSION_SECRET!`
- **Lines:** 14, and wherever session is configured
- **Problem:** `SESSION_SECRET` is defined as `z.string().min(32).optional()`. In production, if the env var is missing, sessions are signed with `undefined` as the secret, making session cookies trivially forgeable.
- **Solution:** Make `SESSION_SECRET` required in production. Change the schema to conditionally require it, or add a startup check that aborts if `NODE_ENV=production && !SESSION_SECRET`.
- **Priority:** CRITICAL
- **Status:** ✅ FIXED — `envSchema` now includes a `.superRefine()` that adds a Zod validation issue when `NODE_ENV` is `production` or `staging` and `SESSION_SECRET` is absent. `validateConfig()` already throws on any Zod failure in non-development environments, so the process aborts at startup with a clear error message before any route or session middleware can be mounted. `server/session.ts` no longer uses the `!` non-null assertion; it reads the secret through `getConfig()` and applies a clearly-labelled dev-only fallback string (so local dev still starts without the variable set). `checkRequiredServices()` updated: the production hard-fail is now schema-level; it emits a soft warning only in development.

### CRIT-05: ~~RBAC `extractUserRole()` always returns `"operator"` in production~~ — FIXED

- **File:** `server/middleware/rbac.ts`
- **Lines:** 92–97
- **Problem:** The function has a TODO comment saying "extract from session/JWT" but falls through to `return "operator"` for all production requests. This means every authenticated user (including guests, viewers, or even someone who should be banned) gets `operator` permissions. The `session.role` field IS set on login (line 109), but `extractUserRole` ignores it when there's no `session.userId`.
- **Solution:** Read role from `req.session.role` (which is already set by auth). The `_requireAuth` middleware at line 109 does `req.userRole = session.role || extractUserRole(req)` — so for logged-in users this works. But the fallback in `extractUserRole` should return `"guest"` (least privilege), not `"operator"`.
- **Priority:** CRITICAL
- **Status:** ✅ FIXED — In production, `extractUserRole()` now reads `req.session.role` (set by the auth service at login) and validates it against the list of known roles before returning it. When no authenticated session role is present, the function returns `"guest"` (least privilege) instead of `"operator"`. The dev/staging behavior (X-Debug-Role header → operator fallback) is unchanged.

### CRIT-06: ~~`PATCH /api/tenant` accepts raw body without validation~~ — FIXED

- **File:** `server/routes/routes.ts`
- **Lines:** ~77
- **Problem:** `req.body` is passed directly to `storage.updateTenant()` with no Zod validation and no field whitelist. An attacker could overwrite arbitrary tenant fields including `status`, `id`, `planId`, etc.
- **Solution:** Define a Zod schema for allowed tenant update fields. Validate and whitelist before passing to storage.
- **Priority:** CRITICAL
- **Status:** ✅ FIXED — Added `patchTenantSchema` to `server/middleware/validation.ts` that explicitly whitelists only the 16 user-editable tenant fields (`name`, `language`, `tone`, `addressStyle`, `currency`, `timezone`, `workingHoursStart`, `workingHoursEnd`, `workingDays`, `autoReplyOutsideHours`, `escalationEmail`, `escalationTelegram`, `allowDiscounts`, `maxDiscountPercent`, `templates`). Security-sensitive fields (`id`, `status`, `createdAt`) are excluded from the schema — Zod strips unknown keys by default, so any attempt to send them is silently dropped. `validateBody(patchTenantSchema)` middleware is applied to `PATCH /api/tenant` before the handler; invalid payloads receive a structured 400 response.

### CRIT-07: ~~`drizzle-kit push --force` runs in production startup~~ — FIXED

- **File:** `start.sh` line 3, `package.json` line 9
- **Lines:** start.sh:3, package.json:9
- **Problem:** The production start command runs `drizzle-kit push --force` which auto-applies schema changes to the production database without review, approval, or backup. This can cause data loss (column drops, type changes) silently.
- **Solution:** Remove `--force`. Implement a proper migration strategy: generate SQL migrations, review them, apply manually or via CI with rollback capability.
- **Priority:** CRITICAL
- **Status:** ✅ FIXED — Removed `drizzle-kit push --force` from all production entry points. `npm run start` (`package.json`) now only starts the server (`NODE_ENV=production node dist/index.cjs`) — no schema mutations at startup. A dedicated `npm run db:migrate` script runs `drizzle-kit migrate`, which applies only the reviewed, version-controlled SQL files in `./migrations/`. All deployment entry points updated: `start.sh` calls `npx drizzle-kit migrate` then starts the server directly; `Dockerfile` CMD uses `drizzle-kit migrate`; `nixpacks.toml` start command runs `npm run db:migrate && npm run start`. `server/scripts/migrate.ts` updated to invoke `drizzle-kit migrate`. `.cursorrules` updated to document the correct migration workflow and prohibit `push --force` in production.

### CRIT-08: ~~Routes use `getDefaultTenant()` instead of user's tenant~~ — FIXED

- **File:** `server/routes/routes.ts`
- **Lines:** ~150–167
- **Problem:** Multiple routes (customer list, onboarding setup, etc.) call `storage.getDefaultTenant()` instead of resolving the authenticated user's actual tenant. In a multi-tenant system, all users see the same "default" tenant's data, breaking tenant isolation.
- **Solution:** Resolve tenant from `req.user.tenantId` (available via the session). Never use `getDefaultTenant()` in tenant-scoped routes.
- **Priority:** CRITICAL
- **Status:** ✅ FIXED — Eliminated all 22 calls to `storage.getDefaultTenant()` in `server/routes.ts`. Each route now resolves the tenant from the authenticated user's session via `storage.getUser(req.userId)` and uses `user.tenantId`. Routes that already had a fetched user variable (`genUser`, `approveUser`, `editUser`, `rejectUser`) now use that variable's `tenantId` directly. Routes that only needed `tenant.id` use `user.tenantId` directly (no redundant full-tenant fetch). The `POST /api/onboarding/setup` route no longer creates new tenants as a fallback — it updates the authenticated user's own tenant and returns 403 if none is associated. The training-samples routes had a partial "fallback to default" pattern that is now removed entirely: a missing `tenantId` returns 403, not a cross-tenant default. The WhatsApp Personal IIFE inside `GET /api/channels/status` resolves tenantId from the authenticated user instead of querying the first tenant in the DB.

### CRIT-09: ~~Impersonation doesn't update `tenantId` in session~~ — FIXED

- **File:** `server/routes/admin.ts`
- **Lines:** ~1215–1222 (start), ~1262–1269 (exit)
- **Problem:** When a platform admin impersonates a user, the session sets `userId` and `role` but never updates `tenantId`. Subsequent requests may use the admin's original `tenantId`, causing cross-tenant data access or broken impersonation.
- **Solution:** Set `session.tenantId = targetUser.tenantId` during impersonation.
- **Priority:** CRITICAL
- **Status:** ✅ FIXED — Impersonation start now saves `session.originalTenantId = adminUser.tenantId ?? null` and sets `session.tenantId = user.tenantId`. Impersonation exit restores `session.tenantId = session.originalTenantId ?? null` and deletes `session.originalTenantId`. All subsequent requests made during an impersonation session now operate under the impersonated user's tenant, preventing the admin's `tenantId` from leaking into tenant-scoped queries.

---

## Section 2: Technical Debt

### ~~DEBT-01: Audit log is in-memory only — all events lost on restart~~ — FIXED

- **File:** `server/services/audit-log.ts`
- **Lines:** 13, 49
- **Problem:** Despite having an `auditEvents` table in the database schema (`shared/schema.ts`), audit events are stored only in a JavaScript `Map`. All audit history is lost on every server restart. The Map also grows unboundedly (no eviction, no size limit), creating a memory leak.
- **Solution:** Write events to PostgreSQL via `storage.createAuditEvent()`. Add batch-insert for performance. Remove the in-memory Map.
- **Effort:** Medium
- **Status:** ✅ FIXED — Removed the in-memory `Map` entirely. `audit-log.ts` now imports `db` and the `auditEvents` table directly and buffers insert rows in memory (`_buffer: AuditEventInsertRow[]`). A `setInterval` timer flushes the buffer to PostgreSQL every 500 ms using a single batch `db.insert(auditEvents).values(batch)`. When the buffer reaches 50 events a fire-and-forget eager flush is also triggered. Failed batches are re-queued at the front of the buffer (capped at 500 to bound memory). The timer calls `.unref()` so the Node.js event loop can exit cleanly. All three query methods (`getEventsByEntity`, `getEventsByConversation`, `getRecentEvents`, `getAllEvents`) now issue Drizzle ORM queries against the `audit_events` table instead of filtering the in-memory Map. `getEventsByConversation` uses a JSONB `->>'conversationId'` expression to match events for related entities (suggestions, messages) that store the conversation reference in metadata.

### ~~DEBT-02: Shared audit context across concurrent requests~~ — FIXED

- **File:** `server/services/audit-log.ts`
- **Lines:** 14–18
- **Problem:** The audit log service is a singleton with a single `context` object. Concurrent requests overwrite each other's context (requestId, IP, tenantId), causing audit events to be attributed to the wrong request/user.
- **Solution:** Pass context per-call instead of setting it on the singleton. Or use AsyncLocalStorage (Node.js) for request-scoped context.
- **Effort:** Medium
- **Status:** ✅ FIXED — Replaced the shared `context: AuditContext` object with `AsyncLocalStorage<AuditContext>`. Added `runWithContext(ctx, fn)` that calls `this._als.run({ ...ctx }, fn)` to create an isolated store per request. Updated `requestContextMiddleware` (`server/middleware/request-context.ts`) to call `auditLog.runWithContext({ requestId, ipAddress, userAgent }, () => next())` instead of `setContext` + `clearContext`; every async operation triggered by `next()` inherits the per-request ALS store automatically. `setContext` now merges into the current store via `Object.assign(store, ctx)` (called from route handlers to add `tenantId`) and is a no-op outside a request. `clearContext` resets the current store's fields. Concurrent requests each have their own independent ALS store, so no cross-request contamination of audit context is possible.

### DEBT-03: ~~`MemStorage` class — ~1,400 lines of dead code~~ — FIXED

- **File:** `server/storage.ts`
- **Lines:** ~269–1697
- **Problem:** The export at the end creates `DatabaseStorage`. The entire `MemStorage` class is unused in production. It must be maintained in sync with the `IStorage` interface, doubling the maintenance burden.
- **Solution:** Delete `MemStorage` or move it to a test utility file if needed for unit testing.
- **Effort:** Low
- **Status:** ✅ FIXED — `MemStorage` class (~1,400 lines) removed from `server/storage.ts`. `server/storage.ts` now contains only the `IStorage` interface and the `DatabaseStorage` export (~230 lines). The class was moved to `server/__tests__/helpers/mem-storage.ts` (a test-only module) since 4 integration tests depended on it. All test imports updated to the new path. No production code imports `MemStorage`. Four pre-existing type errors in the class body were also fixed during the move.

### DEBT-04: ~~`routes.ts` is a monolithic 4,800+ line file~~ — FIXED

- **File:** `server/routes.ts`
- **Lines:** 1–4800+
- **Problem:** A single file registers 100+ endpoints with inline business logic. Extremely difficult to navigate, review, maintain, or test.
- **Solution:** Split into domain-specific route files (already partially done with `auth.ts`, `admin.ts`, etc.). Move remaining routes: `customer-routes.ts`, `conversation-routes.ts`, `product-routes.ts`, `knowledge-base-routes.ts`, `analytics-routes.ts`, `onboarding-routes.ts`, `billing-routes.ts`, `vehicle-lookup-routes.ts`.
- **Effort:** High
- **Status:** ✅ FIXED — Split into 8 domain-specific route modules under `server/routes/`: `customer.routes.ts`, `conversation.routes.ts`, `product.routes.ts`, `knowledge-base.routes.ts`, `analytics.routes.ts`, `onboarding.routes.ts`, `billing.routes.ts`, `vehicle-lookup.routes.ts`. Each exports a single Express Router with all original middleware, validation, and tenant isolation preserved. The main `server/routes.ts` is now a thin index that only imports and mounts these routers alongside existing auth, admin, webhook, and phase-0 sub-routers. Pure structural refactor — no business logic changes.

### DEBT-05: 100+ `as any` type casts across server code

- **File:** Multiple (46+ server files)
- **Lines:** Scattered — notable: `admin.ts` (28 casts), `auth-service.ts` (9 casts)
- **Problem:** Bypasses TypeScript safety. The most common pattern is `(req as any).user` — Express request is not properly typed.
- **Solution:** Extend Express `Request` type via declaration merging (partially done in `rbac.ts` lines 64–71). Apply consistently. Replace remaining `as any` with proper types.
- **Effort:** Medium

### DEBT-06: ~~Duplicate batch utils~~ — FIXED

- **File:** `server/batch/utils.ts` AND `server/replit_integrations/batch/utils.ts`
- **Lines:** Entire files
- **Problem:** Near-identical files. The `replit_integrations` copy is a legacy artifact from the Replit platform.
- **Solution:** Delete `server/replit_integrations/` entirely.
- **Effort:** Low
- **Status:** ✅ FIXED — Deleted `server/replit_integrations/batch/utils.ts` and the entire `server/replit_integrations/` directory. No code imported from this path; it was a completely orphaned legacy artifact.

### DEBT-07: Email provider only logs to console

- **File:** `server/services/email-provider.ts` (inferred from audit)
- **Lines:** Entire file
- **Problem:** Only `ConsoleEmailProvider` is implemented. Verification emails, password resets, and invite emails are never actually sent. Users cannot complete these flows.
- **Solution:** Implement a real email provider (SendGrid, Postmark, or SMTP). Make it configurable via env vars.
- **Effort:** Medium

### ~~DEBT-08: Message send worker has stub implementations~~ — FIXED

- **File:** `server/workers/message-send.worker.ts`
- **Lines:** 13–31
- **Problem:** `isMessageStillValid()` always returns `{valid: true}` — delayed messages are sent even if the conversation was resolved or the suggestion rejected. `markMessageAsSent()` and `markMessageAsFailed()` only log to console — delivery status is never persisted.
- **Solution:** Implement actual validity checks (conversation status, suggestion status). Update message status in the database.
- **Effort:** Medium
- **Status:** ✅ FIXED — `isMessageStillValid()` now queries `storage.getConversation()` and rejects when `status` is in `{"resolved", "closed"}`; if the job carries a `suggestionId`, it also queries `storage.getAiSuggestion()` and rejects when `status` is in `{"rejected", "cancelled"}`. `markMessageAsSent()` fetches the existing message, merges `{deliveryStatus: "sent", deliveredAt, externalMessageId}` into the metadata JSONB, then persists via the new `storage.updateMessage()`. `markMessageAsFailed()` does the same with `{deliveryStatus: "failed", failedAt, lastError}`. Added `updateMessage(id, Partial<InsertMessage>): Promise<Message | undefined>` to `IStorage`, `DatabaseStorage`, and `MemStorage` (test helper) following the same pattern as the existing `updateAiSuggestion`.

### DEBT-09: Hardcoded business values throughout codebase

- **File:** Multiple files
- **Lines:** Various
- **Problem:**
  - Price: `50` USDT/month hardcoded in `admin.ts`, `cryptobot-billing.ts`
  - Trial: `72` hours in `cryptobot-billing.ts`
  - Telegram account limit: `5` per tenant in `telegram-client-manager.ts`
  - Average response time: always `12ms` mock in `database-storage.ts:793`
  - `resolvedToday`: always `0` in `database-storage.ts:791`
- **Solution:** Move business constants to a config file or database-backed settings per tenant.
- **Effort:** Low

### DEBT-10: `deleteProduct` always returns true

- **File:** `server/database-storage.ts`
- **Lines:** ~504–507
- **Problem:** Returns `true` regardless of whether the product existed. Callers cannot distinguish between successful deletion and no-op.
- **Solution:** Check `result.rowCount` and return `false` if 0 rows affected.
- **Effort:** Low

### DEBT-11: `settings.tsx` is ~3,000+ lines

- **File:** `client/src/pages/settings.tsx`
- **Lines:** 1–3000+
- **Problem:** Massive single-file page containing all settings tabs, forms, channel configuration, decision engine config, human delay config, etc. Extremely hard to maintain.
- **Solution:** Extract each tab into its own component: `ChannelSettings.tsx`, `DecisionEngineSettings.tsx`, `HumanDelaySettings.tsx`, `TenantSettings.tsx`, etc.
- **Effort:** Medium

### DEBT-12: ~~`@types/*` packages in production dependencies~~ — FIXED

- **File:** `package.json`
- **Lines:** 48–52 (`@types/bcrypt`, `@types/ioredis-mock`, `@types/memoizee`, `@types/multer`, `@types/qrcode`, `@types/supertest`)
- **Problem:** Type definition packages are in `dependencies` instead of `devDependencies`. They're included in the production bundle unnecessarily.
- **Solution:** Move all `@types/*` packages to `devDependencies`.
- **Effort:** Low
- **Status:** ✅ FIXED — Moved `@types/bcrypt`, `@types/ioredis-mock`, `@types/memoizee`, `@types/multer`, `@types/qrcode`, and `@types/supertest` from `dependencies` to `devDependencies`. Type-only packages are never bundled at runtime; they are stripped by TypeScript and have no production footprint.

### DEBT-13: ~~Test dependencies in production dependencies~~ — FIXED

- **File:** `package.json`
- **Lines:** 94 (`supertest`), 101 (`vitest`), 71 (`ioredis-mock`)
- **Problem:** `supertest`, `vitest`, and `ioredis-mock` are test-only packages but listed in `dependencies`.
- **Solution:** Move to `devDependencies`.
- **Effort:** Low
- **Status:** ✅ FIXED — Moved `supertest`, `vitest`, and `ioredis-mock` from `dependencies` to `devDependencies`. All three are exclusively imported in `*.test.ts` files under `server/__tests__/` and `server/tests/`; no production source file imports them. They are excluded from production builds when `NODE_ENV=production` and `npm install --omit=dev` is used (e.g., in Docker).

---

## Section 3: Architectural Improvements

### ARCH-01: ~~Extract route handlers from monolithic routes.ts~~ — DONE

- **Current state:** 100+ endpoints with inline business logic in a single `routes.ts` (4,800+ lines). Some routes already extracted (`auth.ts`, `admin.ts`, `health.ts`, webhooks).
- **Proposed change:** Split into domain-specific route modules: `customer.routes.ts`, `conversation.routes.ts`, `product.routes.ts`, `knowledge-base.routes.ts`, `analytics.routes.ts`, `onboarding.routes.ts`, `billing.routes.ts`, `vehicle-lookup.routes.ts`. Each file < 300 lines. Central `routes.ts` only imports and mounts.
- **Benefits:** Easier navigation, code review, testing, and onboarding. Enables per-route-group middleware.
- **Risks:** Large diff, potential merge conflicts. Mitigate by doing it in one focused PR.
- **Status:** ✅ DONE — All 8 domain route modules created and mounted. See DEBT-04 for details.

### ARCH-02: Move audit log to database-backed implementation

- **Current state:** In-memory `Map` with unbounded growth. Shared mutable context across concurrent requests. All data lost on restart.
- **Proposed change:** Use the existing `auditEvents` table in the schema. Write events via `DatabaseStorage`. Use `AsyncLocalStorage` for per-request context. Add background flush for performance.
- **Benefits:** Persistent audit trail, compliance-ready, no memory leak, correct attribution.
- **Risks:** Slight increase in DB write load. Mitigate with batched inserts.

### ARCH-03: Implement proper multi-tenancy throughout

- **Current state:** Many routes use `getDefaultTenant()` or skip tenant ownership checks on entity lookups. WebSocket allows arbitrary tenant impersonation.
- **Proposed change:** Create a middleware that resolves `req.tenantId` from the authenticated session. Add tenant scoping to all storage methods. Add ownership verification on all entity lookups.
- **Benefits:** True multi-tenancy, data isolation, security compliance.
- **Risks:** Requires touching many routes and storage methods. Thorough testing needed.

### ~~ARCH-04: Replace in-memory rate limiting with Redis-backed~~ — FIXED

- **Current state:** Rate limiters use in-memory `Map` (`server/middleware/rate-limiter.ts`). Auth rate limiter uses `express-rate-limit` (also in-memory). PM2 cluster mode means each worker has separate limits.
- **Proposed change:** Use `ioredis` (already a dependency) for rate limit state. Adopt `rate-limit-redis` store for `express-rate-limit`.
- **Benefits:** Correct rate limiting across all workers. Survives restarts.
- **Risks:** Redis becomes a harder dependency. Already required for BullMQ, so minimal additional risk.
- **Status:** ✅ FIXED — Added `server/redis-client.ts` (shared ioredis singleton); `rate-limiter.ts` now uses atomic Redis INCR+PEXPIRE Lua script for all custom limiters with transparent in-memory fallback when Redis is unavailable; `server/routes/auth.ts` `express-rate-limit` instances use `rate-limit-redis` `RedisStore` with `passOnStoreError: true` for graceful fallback; `server/index.ts` eagerly initialises the Redis client at startup and closes it in the graceful shutdown sequence.

### ~~ARCH-05: Implement graceful shutdown~~ — FIXED

- **Current state:** `SIGTERM` handler only kills the Python child process. No HTTP server drain, no DB pool close, no BullMQ worker shutdown.
- **Proposed change:** On `SIGTERM`: stop accepting new connections, drain in-flight requests (with timeout), close BullMQ workers, close DB pool, close WebSocket server, then exit.
- **Benefits:** Zero-downtime deployments. No lost messages or orphaned connections.
- **Risks:** Low. Standard Node.js pattern.
- **Status:** ✅ FIXED — `server/index.ts` now exports a single `gracefulShutdown(signal)` function registered on both `SIGTERM` and `SIGINT`. Teardown order: (1) kill Max Personal Python subprocess, (2) `httpServer.close()` with a 5-second forced-drain timeout, (3) close all three BullMQ queue connections in parallel via `Promise.allSettled` (`closeQueue`, `closeVehicleLookupQueue`, `closePriceLookupQueue`), (4) `realtimeService.close()` (new `close()` method added to `RealtimeService` in `websocket-server.ts`), (5) `pool.end()` (`pool` exported from `server/db.ts`), (6) `process.exit(0)`. An `isShuttingDown` guard prevents re-entry if a second signal arrives mid-sequence.

### ARCH-06: Introduce service layer between routes and storage

- **Current state:** Route handlers directly call `storage.*` methods and contain business logic (validation, authorization checks, side effects like WebSocket broadcasts).
- **Proposed change:** Introduce service classes (e.g., `CustomerService`, `ConversationService`) that encapsulate business logic. Routes only handle HTTP concerns (parsing, responding). Storage only handles data access.
- **Benefits:** Testable business logic without HTTP. Single responsibility. Reusable logic across routes and workers.
- **Risks:** Significant refactor. Do incrementally, starting with the most complex domains (conversations, customers).

---

## Section 4: Security

### 4.1 Secret Storage Practices

| Aspect | Status | Notes |
|--------|--------|-------|
| Integration secrets (API keys) | ✅ AES-256-GCM encryption | Via `secret-store.ts` with `INTEGRATION_SECRETS_MASTER_KEY` |
| Session secret | ✅ Required in production/staging | `envSchema.superRefine` aborts startup if missing (CRIT-04 fixed) |
| OpenAI API key | ⚠️ `"sk-placeholder"` fallback | Hardcoded in 4 files — misleading, looks like a real key prefix |
| Telegram session strings | ✅ Encrypted at rest | `sessionString` is encrypted with AES-256-GCM via `secret-store.ts` when `INTEGRATION_SECRETS_MASTER_KEY` is set. Legacy plaintext sessions are detected and passed through; decrypt failure returns null (re-auth). See 4.6. |
| `.env.example` | ✅ Exists | 110 lines, covers all env vars. `.env` is gitignored |
| Secrets in logs | ✅ PII sanitizer exists | `server/utils/sanitizer.ts` masks API keys in logs |

### 4.2 Input Validation Coverage

| Area | Status | Notes |
|------|--------|-------|
| Zod validation middleware | ✅ Exists | `server/middleware/validation.ts` |
| Route-level validation | ⚠️ Inconsistent | Some routes use Zod, many pass `req.body` directly (e.g., CRIT-06) |
| LIKE pattern injection | ⚠️ Unescaped | `%` and `_` in search queries act as wildcards (`database-storage.ts:243-246`) |
| WebSocket message validation | ❌ None | `JSON.parse` with no schema validation on WS messages |

### 4.3 SQL Injection Protection

| Area | Status | Notes |
|------|--------|-------|
| Drizzle ORM parameterization | ✅ Good | All queries use Drizzle's query builder — values are parameterized |
| Raw SQL | ✅ Minimal | Only in migration files, not in application code |
| LIKE patterns | ⚠️ See 4.2 | Not SQL injection, but LIKE wildcard injection |

### 4.4 Rate Limiting

| Area | Status | Notes |
|------|--------|-------|
| General API rate limit | ✅ Exists | In-memory — won't work with PM2 cluster |
| AI generation rate limit | ✅ Exists | Per-tenant AI limiter |
| Auth brute force protection | ✅ Exists | `express-rate-limit` — in-memory, per-process only |
| WebSocket rate limit | ❌ None | No limit on WS connections or messages |
| Webhook rate limit | ✅ Exists | Per-channel webhook limiter |
| Vehicle lookup rate limit | ⚠️ BullMQ concurrency only | No per-tenant rate limit on lookup API |

### 4.5 CORS Configuration

| Aspect | Status | Notes |
|--------|--------|-------|
| CORS middleware | ⚠️ Not explicitly configured | Relies on same-origin (Vite proxy in dev, static serve in prod). No explicit `cors()` middleware found. If deployed behind a different domain, CORS will block requests. |

### ~~4.6 Telegram Session Security~~ — Session storage FIXED

| Aspect | Status | Notes |
|--------|--------|-------|
| Session string storage | ✅ FIXED | `telegramSessions.sessionString` is encrypted with AES-256-GCM via `server/services/secret-store.ts`. New/updated sessions are encrypted when `INTEGRATION_SECRETS_MASTER_KEY` is set; stored as JSON `{v,ciphertext,meta}` in the same column. Legacy unencrypted values are detected (no leading `{` / invalid payload) and returned as-is. Decrypt failure (e.g. key rotated) returns `sessionString: null` so UI can require re-auth. Encrypt/decrypt is applied in `server/database-storage.ts` (create/update/get); `telegram-personal-adapter.ts` and `telegram-client-manager.ts` continue to use plaintext from storage. |
| Session reconnection | ⚠️ No FloodWait handling | `telegram-client-manager.ts` reconnect loop doesn't handle FloodWaitError — can result in Telegram IP ban |
| Auth state cleanup | ❌ No TTL | `authStates` Map in `telegram-personal-adapter.ts` leaks TelegramClient connections — no timeout/cleanup |
| Multi-account limits | ✅ 5 per tenant | Hardcoded but functional |

### 4.7 Authentication/Authorization Gaps

| Gap | Severity | Notes |
|-----|----------|-------|
| RBAC fallback returns `operator` | CRITICAL | See CRIT-05 |
| ~~No CSRF token~~ | ~~HIGH~~ | ~~Session auth without CSRF protection. `sameSite: lax` mitigates POST from cross-site, but not all cases~~ ✅ FIXED — Double-submit cookie pattern via `csrf-csrf` v4 (`server/middleware/csrf.ts`). `GET /api/csrf-token` generates a HMAC-signed token (httpOnly cookie) and returns the raw value; `apiRequest()` in `client/src/lib/queryClient.ts` fetches it lazily and sends it as `X-Csrf-Token` on all POST/PUT/PATCH/DELETE; webhook paths exempt via `skipCsrfProtection`; stale tokens auto-cleared on 403. |
| WebSocket unauthenticated | CRITICAL | See CRIT-01 |
| Impersonation missing tenantId | CRITICAL | See CRIT-09 |
| ~~Webhook verification skipped when secrets not set~~ | ~~HIGH~~ | ~~`webhook-security.ts:70-72` returns `{valid: true}` if secret is undefined~~ ✅ FIXED — All three verify functions (`verifyTelegramWebhook`, `verifyWhatsAppWebhook`, `verifyMaxWebhook`) now return `{valid: false, error: "Webhook secret not configured"}` when `NODE_ENV` is `"production"` or `"staging"` and the secret env var is absent. Permissive pass-through is retained only in development/test. |

### 4.8 Dependency Vulnerabilities

| Package | Version | Concern |
|---------|---------|---------|
| `express` | ^4.21.2 | Keep updated — Express 4.x has had path traversal issues in older versions |
| `@whiskeysockets/baileys` | ^7.0.0-rc.9 | Release candidate — may have undiscovered vulnerabilities |
| `telegram` (gramjs) | ^2.26.22 | Monitor for MTProto security issues |
| `passport` | ^0.7.0 | Passport 0.7 requires careful session handling |
| `stripe` | ^20.2.0 | ✅ Up to date |
| `openai` | ^6.15.0 | ✅ Up to date |
| `ioredis-mock` | ^8.13.1 | Should be in devDependencies, not production |

---

## Section 5: Performance

### ~~5.1 N+1 Queries~~ — FIXED

| Location | Method | Impact |
|----------|--------|--------|
| ~~`database-storage.ts:402-417`~~ | ~~`getConversationsByTenant()`~~ | ~~For each conversation: 1 query for customer + 1 query for all messages. 100 conversations = 201 queries.~~ ✅ FIXED — Rewritten with `INNER JOIN customers` + one batched `inArray` message query. 2 queries total regardless of conversation count. |
| ~~`database-storage.ts:419-437`~~ | ~~`getActiveConversations()`~~ | ~~Same N+1 pattern as above.~~ ✅ FIXED — Same approach: JOIN + single batched messages query. |
| ~~`database-storage.ts:736-744`~~ | ~~`getEscalationsByTenant()`~~ | ~~Fetches ALL conversations to get IDs, then queries escalations.~~ ✅ FIXED — Replaced two-step fetch with a Drizzle subquery: `WHERE conversationId IN (SELECT id FROM conversations WHERE tenantId = ?)`. Single query. |

### 5.2 Missing Caching Opportunities

| Opportunity | Current State | Recommendation |
|-------------|---------------|----------------|
| Tenant settings | Fetched from DB on every request | Cache with 60s TTL (tenant settings change rarely) |
| Feature flags | Read from JSON file on every check | Already in-memory, but file reads should be cached |
| RBAC permission matrix | Computed on every request | Already static — no action needed |
| Customer memory | Fetched on every AI generation | Cache with 5-minute TTL per customer |
| RAG embeddings | All loaded into memory per query | Index with pgvector extension for proper vector search |

### 5.3 Heavy Operations on Main Thread

| Operation | File | Impact |
|-----------|------|--------|
| Cosine similarity on all embeddings | `database-storage.ts:1127-1149` | Loads ALL 3072-dim embeddings into memory and computes similarity in JS. Will not scale past ~500 chunks per tenant. **Fix:** Use `pgvector` extension. |
| Full response body logging | `server/index.ts:74-88` | Serializes every API response to JSON for logging. Large responses (conversation history, product lists) cause I/O pressure. **Fix:** Log only status code and response size, not body. |
| ~~Dashboard metrics~~ | ~~`database-storage.ts:770-798`~~ | ~~Fetches ALL conversations, products, and docs into memory just to count them.~~ ✅ FIXED — `getDashboardMetrics()` now uses 4 `COUNT(*)` aggregate queries run in parallel via `Promise.all`. No rows are loaded into memory. |

### 5.4 Memory Leaks

| Leak | File | Impact |
|------|------|--------|
| ~~Audit log Map grows unboundedly~~ | ~~`audit-log.ts:13`~~ | ~~Every audit event is stored forever in memory. No eviction. Server will eventually OOM.~~ ✅ FIXED — In-memory Map removed; events batch-inserted into PostgreSQL. |
| Telegram `authStates` Map | `telegram-personal-adapter.ts` | TelegramClient connections stored without TTL. Abandoned auth flows leak connections. |
| In-memory rate limit Maps | `rate-limiter.ts:18-19` | Old entries never cleaned up. Grows proportionally to unique IPs/tenants. |

### 5.5 Bundle Size (Client)

| Issue | Impact | Recommendation |
|-------|--------|----------------|
| ~~No code splitting / lazy loading~~ | ~~All 20 pages loaded upfront~~ | ✅ FIXED — All 20 page components in `client/src/App.tsx` converted to `React.lazy()`. Three `<Suspense fallback={<PageLoader />}>` boundaries added (main `Router`, `AuthRouter`, `OwnerRouter`). Each page is now a separate Vite/Rollup chunk loaded on first navigation. |
| 40+ shadcn/ui components imported | Tree-shaking helps but not fully | Already individual imports — OK |
| ~~recharts imported on all pages~~ | ~~Heavy charting library (~200KB)~~ | ✅ FIXED — `recharts` is only referenced in `ui/chart.tsx`. `Analytics` is now its own lazy chunk, so recharts stays out of the main bundle and loads only when `/analytics` is visited. |
| framer-motion | ~100KB | Only use where animations are needed, lazy-load elsewhere |
| ~~Google Fonts in index.html~~ | ~~Render-blocking~~ | ✅ ALREADY DONE — `&display=swap` was already present at the end of the Google Fonts URL in `client/index.html`, which causes the Fonts API to emit `font-display: swap` on every `@font-face` rule it serves. |

### 5.6 Database Query Optimization

| Query | Fix |
|-------|-----|
| ~~`getConversationsByTenant` — N+1~~ | ✅ FIXED — `INNER JOIN customers` + single batched `inArray` message query. 2 queries total. |
| ~~`getDashboardMetrics` — SELECT * to count~~ | ✅ FIXED — 4 `COUNT(*)` aggregate queries in `Promise.all`. No full rows loaded. |
| ~~`getEscalationsByTenant` — double query~~ | ✅ FIXED — Drizzle subquery: `WHERE conversationId IN (SELECT id FROM conversations WHERE tenantId = ?)`. |
| `getAllRagChunksWithEmbedding` — full table scan | Install pgvector, use `<=>` operator for nearest-neighbor search |
| ~~`getMessagesByConversation` — no pagination~~ | ✅ FIXED — `getMessagesByConversationPaginated(conversationId, cursor?, limit?)` added to `IStorage` + `DatabaseStorage`. `GET /api/conversations/:id/messages?cursor=&limit=` returns `{ messages, nextCursor }`. Existing callers unchanged. |
| Missing indexes | Add composite indexes on `(tenantId, status)` for conversations, `(tenantId, customerId)` for customer_memory |

---

## Section 6: Testing

### 6.1 Current Test Coverage

**Total test files:** 50 (49 TypeScript + 1 Python)

| Area | Test Files | Coverage |
|------|-----------|----------|
| Decision Engine | `decision-engine.test.ts`, `decision-engine-e2e.test.ts` | Core AI logic well-tested |
| RAG | `rag-indexer.test.ts`, `rag-retrieval.test.ts`, `rag-integration.test.ts`, `rag-cleanup.test.ts` | Good coverage |
| Few-shot | `few-shot-builder.test.ts` | ✅ |
| Embeddings | `embedding-service.test.ts` | ✅ |
| RBAC | `rbac.test.ts`, `permission-403.test.ts` | ✅ |
| Rate limiting | `rate-limiter.test.ts` | ✅ |
| Webhook security | `webhook-security.test.ts`, `webhook-security.integration.test.ts` | ✅ |
| Validation | `validation.test.ts` | ✅ |
| Human delay | `human-delay-engine.test.ts`, `human-delay-integration.test.ts` | ✅ |
| Customer operations | `customer-memory.test.ts`, `customer-summary-service.test.ts`, `customer-card-phase4.test.ts`, `customer-data-deletion.test.ts` | Good |
| Analytics | `conversion.test.ts`, `csat.test.ts`, `intent-analytics.test.ts`, `lost-deals.test.ts`, `learning-score.test.ts` | ✅ |
| Channel adapters | `telegram-adapter.test.ts`, `whatsapp-adapter.test.ts`, `max-adapter.test.ts` | Basic only |
| Onboarding | `onboarding.test.ts`, `onboarding-templates.test.ts` | ✅ |
| Subscription | `subscription-gating.test.ts`, `subscription-grants.test.ts` | ✅ |
| Training | `training-policies.test.ts` | ✅ |
| Admin | `admin-action-idempotency.test.ts`, `platform-owner.test.ts` | ✅ |
| Security | `sanitizer.test.ts`, `security-readiness.test.ts`, `integration-secrets.test.ts` | ✅ |

**Not tested:**

| Area | Risk |
|------|------|
| WebSocket server | No tests — unauthenticated access undetected |
| Multi-tenancy isolation | No cross-tenant access tests |
| Route authorization (end-to-end) | Only unit tests for RBAC middleware |
| Message send worker | No tests for stubs or actual sending |
| Vehicle/price lookup workers | No unit tests for worker logic |
| Telegram client manager | No tests for reconnection, multi-account |
| Billing flows (CryptoBot) | No tests for payment processing |
| Frontend components | Zero client-side tests |
| Database storage methods | No direct tests — tested indirectly via service tests |
| Error handler behavior | No test for the re-throw bug |

### 6.2 test_regression_iter4.py

- **What it tests:** End-to-end regression for the Podzamenu VIN/FRAME lookup service (`podzamenu_lookup_service.py`). Tests 48 VIN/FRAME lookups against a running instance at `localhost:8200`. Validates HTTP 200 responses, gearbox model detection, OEM extraction, and make identification. Iteration 3 targets have specific assertion checks (make, model, OEM).
- **Is it still relevant?** **Yes** — the Podzamenu service is actively used. This test ensures parsing logic continues to work against the external sites (podzamenu.ru, prof-rf). However, it requires a running Python service with Playwright + Chromium, making it unsuitable for CI without browser infrastructure. It's effectively a manual integration test.
- **Recommendation:** Keep as a manual regression suite. Add a mock-based unit test for the parsing logic that can run in CI.

### 6.3 Suggested Test Priorities

1. **CRITICAL:** Multi-tenancy isolation tests — verify users cannot access other tenants' data
2. **CRITICAL:** WebSocket authentication tests
3. **HIGH:** Message send worker integration tests
4. **HIGH:** End-to-end auth flow tests (login → session → protected route → logout)
5. **HIGH:** Error handler behavior test (verify no re-throw)
6. **MEDIUM:** Frontend component tests (at least critical flows: auth, chat, settings)
7. **MEDIUM:** Database storage method tests with real PostgreSQL (test container)
8. **MEDIUM:** Billing flow tests with CryptoBot API mocks
9. **LOW:** Telegram client manager reconnection tests

---

## Section 7: Documentation vs Reality

### 7.1 README.md

| Aspect | Status |
|--------|--------|
| Product description | ✅ Accurate |
| Features listed | ⚠️ Incomplete — only lists 7 features. Missing: RAG, few-shot learning, decision engine, RBAC, CSAT, analytics, onboarding, vehicle lookup, price lookup, admin panel, billing |
| WhatsApp channel | ❌ Not mentioned (but implemented) |
| MAX channel | ❌ Not mentioned (but implemented) |
| Multi-channel support | ❌ Not mentioned |
| Setup instructions | ⚠️ Only "copy .env and use PM2". No npm install, no database setup, no Redis, no Python services |
| Architecture diagram | ❌ Missing |
| Development setup | ❌ Missing — no `npm run dev` instructions |
| Docker instructions | ❌ Missing — Dockerfile exists but not documented |

### 7.2 AGENT_CAPABILITIES_AND_PLAN.md

| Aspect | Status |
|--------|--------|
| Feature inventory (Sections 1–4) | ✅ Very comprehensive and accurate. Matches actual implementation well |
| Vehicle lookup | ❌ Not documented (but fully implemented) |
| Price lookup | ❌ Not documented (but implemented with mock data) |
| Feature flags list | ✅ Accurate and matches `feature_flags.json` |
| Tech stack | ✅ Accurate |
| Language | Russian — may be inaccessible to English-speaking contributors |
| Development ideas (Section 5) | ✅ Good roadmap ideas, still relevant |

### 7.3 INTEGRATION_MAP_GEARBOX_OEM.md

| Aspect | Status |
|--------|--------|
| Message flow documentation | ✅ Extremely detailed and accurate |
| Decision Engine documentation | ✅ Accurate — matches `decision-engine.ts` |
| Schema documentation | ✅ Accurate — matches `shared/schema.ts` |
| Vehicle lookup documentation | ✅ Comprehensive, matches implementation |
| Price lookup documentation | ✅ Accurate — correctly notes mock-only status |
| Channel adapter architecture | ✅ Well-documented with correct file references |
| Storage methods | ✅ All methods listed match `database-storage.ts` |
| Missing items | ⚠️ Doesn't document the `gearbox-templates.ts` Russian template system |
| Status table (Section 7.7) | ✅ Honest about what's not implemented |

### 7.4 PLAN_PODZAMENU_LOOKUP.md

| Aspect | Status |
|--------|--------|
| Architecture plan | ✅ Followed almost exactly — BullMQ + Python Playwright service |
| File locations | ✅ Mostly accurate, actual filenames differ slightly (e.g., `vehicle-lookup-queue.ts` vs proposed `lookup-queue.ts`) |
| Step-by-step plan | ✅ All 10 steps were implemented |
| Rate limiting plan | ⚠️ Partially implemented — BullMQ concurrency exists, per-tenant rate limit not implemented |
| Cache table plan | ✅ Implemented as `vehicle_lookup_cache` |
| Case table plan | ✅ Implemented as `vehicle_lookup_cases` |
| PM2 worker plan | ⚠️ Workers run via npm scripts, not as separate PM2 apps as planned |
| Auto-trigger by VIN detection | ❌ Not implemented — lookup requires manual API call |

### 7.5 Additional Undocumented Features

The following significant features exist in code but are not documented in any file:

- Admin action service and idempotency
- Customer data deletion (GDPR)
- Fraud detection and channel fingerprinting
- Security readiness scoring
- Smoke test service
- Learning score and learning queue
- Document chunking service
- Proxy management
- System update service
- Owner dashboard and bootstrap
- Platform admin impersonation

---

## Section 8: Prioritized Action Plan

### Sprint 1 — Critical (do immediately, this week)

1. **Fix error handler re-throw** (CRIT-03) — Remove `throw err` from `server/index.ts:102`. Replace with `console.error(err)`. [5 minutes]
2. **Make SESSION_SECRET required in production** (CRIT-04) — Change config.ts to fail on startup without it. [15 minutes]
3. **Fix RBAC fallback to `"guest"` instead of `"operator"`** (CRIT-05) — Change `rbac.ts:96` from `return "operator"` to `return "guest"`. [5 minutes]
4. **Add WebSocket authentication** (CRIT-01) — Verify session cookie on upgrade. Validate tenantId matches session. [2–4 hours]
5. **Add tenant isolation on entity lookups** (CRIT-02) — Add `tenantId` check to all single-entity storage methods and routes. [4–8 hours]
6. **Fix routes using `getDefaultTenant()`** (CRIT-08) — Replace with `req.user.tenantId` everywhere. [2 hours]
7. **Add Zod validation to `PATCH /api/tenant`** (CRIT-06) — Whitelist allowed fields. [30 minutes]
8. ~~**Fix impersonation tenantId** (CRIT-09) — Add `session.tenantId = user.tenantId` to impersonation logic. [15 minutes]~~ ✅ DONE
9. ~~**Remove `--force` from production migrations** (CRIT-07) — Use reviewed migration files instead. [30 minutes]~~ ✅ DONE

### Sprint 2 — Important (this week / next week)

1. ~~**Move audit log to database** (DEBT-01, DEBT-02) — Use existing `auditEvents` table. Use AsyncLocalStorage for request context. [1 day]~~ ✅ DONE
2. ~~**Fix N+1 queries** (P1, P3) — Rewrite `getConversationsByTenant` and `getActiveConversations` with JOINs. Use COUNT(*) for dashboard. [4 hours]~~ ✅ DONE
3. ~~**Encrypt Telegram session strings** — Use existing `secret-store.ts` AES-256-GCM for `sessionString` field. [2 hours]~~ ✅ DONE
4. ~~**Add webhook verification enforcement** — Reject webhooks when secrets are not configured (don't silently skip). [1 hour]~~ ✅ DONE
5. ~~**Implement message worker stubs** (DEBT-08) — Add real validity checking and database status updates. [3 hours]~~ ✅ DONE
6. **Replace in-memory rate limiting with Redis** (ARCH-04) — Already have `ioredis` as dependency. [3 hours]
7. ~~**Delete `MemStorage` dead code** (DEBT-03) — [30 minutes]~~ ✅ DONE
8. ~~**Delete `server/replit_integrations/`** (DEBT-06) — [5 minutes]~~ ✅ DONE
9. **Move test/type packages to devDependencies** (DEBT-12, DEBT-13) — [15 minutes]
10. **Add Telegram FloodWait handling** — Exponential backoff in reconnect loop, detect `AuthKeyUnregisteredError`. [2 hours]

### Sprint 3 — Improvements (next iteration)

1. ~~**Split `routes.ts` into domain modules** (DEBT-04, ARCH-01) — Extract into 8–10 focused route files. [1–2 days]~~ ✅ DONE
2. **Split `settings.tsx` into tab components** (DEBT-11) — [4 hours]
3. **Add code splitting / lazy loading** — `React.lazy()` for route-based splitting. [2 hours]
4. **Install pgvector and migrate RAG to vector search** — Eliminate JS-side cosine similarity. [1 day]
5. **Add pagination to `getMessagesByConversation`** — [2 hours]
6. **Implement graceful shutdown** (ARCH-05) — [3 hours]
7. **Remove fake random similarity scores** from decision engine RAG fallback. [30 minutes]
8. **Add auth state cleanup timer** for Telegram adapter (10-minute TTL). [1 hour]
9. **Disable full response body logging** — Log status + response size only. [30 minutes]
10. **Implement real email provider** (DEBT-07) — [4 hours]

### Sprint 4 — Nice to Have

1. **Add frontend tests** — Start with auth flow, conversation list, chat interface. [2–3 days]
2. **Add multi-tenancy integration tests** — Verify cross-tenant access is blocked. [1 day]
3. **Introduce service layer** (ARCH-06) — Start with ConversationService, CustomerService. [2–3 days]
4. **Replace `as any` casts with proper types** (DEBT-05) — Extend Express Request consistently. [1 day]
5. **Add CSRF tokens** — For session-based auth. [3 hours]
6. **Add explicit CORS configuration** — For future multi-domain deployments. [1 hour]
7. **Implement real price sources** — Replace mock prices with Avito/Exist scrapers. [2–3 days]
8. **Add database connection pool tuning** — Configure max connections, idle timeouts. [1 hour]
9. **Extract hardcoded business constants** (DEBT-09) — Move to tenant config or database. [3 hours]
10. **Update README.md** — Add comprehensive setup, architecture diagram, all features. [2 hours]
11. **Translate AGENT_CAPABILITIES_AND_PLAN.md to English** — Or maintain bilingual docs. [2 hours]
12. **Add auto-VIN detection in messages** — Trigger vehicle lookup from inbound messages automatically. [1 day]

---

---

## Section 9: New Findings (2026-02-22 Audit)

### ~~NEW-01: `AUTO_PARTS_ENABLED` feature flag undocumented~~ — FIXED

- **File:** `server/services/inbound-message-handler.ts`, `feature_flags.json`
- **Problem:** The flag `AUTO_PARTS_ENABLED` was not listed in `feature_flags.json`.
- **Status:** ✅ FIXED — `AUTO_PARTS_ENABLED: true` is now present in `feature_flags.json` as the 13th entry. Default is `true`, meaning the VIN/FRAME auto-detection pipeline is active by default for all tenants. Updated in `docs/CONVENTIONS.md` feature flags table.

### NEW-02: `auth-service.ts` — password reset does not invalidate sessions

- **File:** `server/services/auth-service.ts`
- **Problem:** There is a TODO comment: "All existing sessions should be invalidated (TODO: implement session store)". When a user resets their password, existing sessions from before the reset remain valid. An attacker who stole a session cookie retains access even after the victim changes their password.
- **Recommendation:** On password reset, delete all sessions for the user from the `sessions` table using `DELETE FROM sessions WHERE sess->>'userId' = :userId`.
- **Priority:** High

### NEW-03: MAX Personal uses GREEN-API but documentation was outdated

- **Status:** ✅ Documentation now updated (this audit)
- **Files:** `server/services/max-green-api-adapter.ts`, `server/routes.ts`, `max_personal_accounts` table
- **Discovery:** MAX Personal channel was completely re-architected from Playwright-based to GREEN-API HTTP-based integration. This is now documented in `docs/API_REFERENCE.md`, `docs/DATABASE_SCHEMA.md`, and `.cursorrules`.

### NEW-04: `price_settings` stored in `tenants.templates` JSONB — no dedicated table

- **Status:** ✅ Documentation now updated (this audit)
- **File:** `server/routes/vehicle-lookup.routes.ts`
- **Discovery:** `GET/PUT /api/price-settings` read/write from `tenants.templates.priceSettings` JSONB key. There is no separate DB table. Default: `{ marginPct: -25, roundTo: 100, priceNote: "", showMarketPrice: false }`.

### NEW-05: `ecosystem.config.cjs` has 3 PM2 apps, not 2

- **Status:** ✅ Documentation now updated (this audit)
- **Discovery:** PM2 ecosystem now has: `aisales` (main app), `worker-price-lookup`, and `podzamenu-service` (Python Podzamenu lookup at port 8200). The vehicle lookup Python service is both spawned as a child process from `server/index.ts` AND configured as a PM2 process — the PM2 configuration is the canonical production approach.

### NEW-06: Dockerfile does not exist

- **Status:** ✅ Documentation updated (this audit)
- **Discovery:** `Dockerfile` referenced in documentation does not exist in the repository. Railway deployment uses Nixpacks (`nixpacks.toml`). Docker deployment is not actually provided.
- **Recommendation:** Either create a `Dockerfile` or remove all references from docs. Currently Nixpacks is the only supported container deployment path.

### NEW-07: Migration count out of sync with docs

- **Status:** ✅ Documentation now updated (this audit)
- **Discovery:** There are 16 numbered migration files (0000–0015) plus 1 manual file. Previous docs stated 0000–0012. New migrations 0013–0015 added `feature_flags` composite unique indexes and `max_personal_accounts` table (single then multi-account).

### NEW-08: `settings.tsx` grew to 4,151 lines

- **File:** `client/src/pages/settings.tsx`
- **Problem:** The settings page is now 4,151 lines (previously estimated ~3000). This makes it the largest file in the codebase by a significant margin.
- **Impact:** Code review difficulty, poor maintainability. Contains 6 distinct tabs (Company, AI Agent, Automation, AI Training, Templates & Payment, Channels).
- **Recommendation:** Extract each tab into its own component under `client/src/components/settings/`. This was DEBT-11 — still not resolved, and the file has grown larger.
- **Priority:** Medium

---

## Remaining Open Issues (as of 2026-02-22)

### Still Pending from Previous Audit

| ID | Description | Priority |
|----|-------------|----------|
| DEBT-05 | 100+ `as any` casts — extend Express Request type | Medium |
| DEBT-07 | Email provider only logs to console — no real sending | Medium |
| DEBT-09 | Hardcoded business values (50 USDT, 72h trial, etc.) | Low |
| DEBT-10 | `deleteProduct` always returns `true` | Low |
| DEBT-11 | `settings.tsx` is 4,151 lines — extract tab components | Medium |
| ARCH-06 | No service layer between routes and storage | Low |
| 4.2 | LIKE pattern injection in search (`%` and `_` unescaped) | Medium |
| 4.2 | WebSocket messages not schema-validated | Medium |
| 4.4 | No WebSocket connection/message rate limit | Medium |
| 4.5 | No explicit CORS configuration | Low |
| 4.6 | Telegram FloodWait in reconnect loop not handled | High |
| 4.6 | Telegram `authStates` Map has no TTL — leaks connections | High |
| 5.2 | Missing caching (tenant settings, customer memory) | Low |
| 5.3 | Cosine similarity in JS — should use pgvector | Medium |
| 5.3 | Full response body logging on all API calls | Low |
| 5.6 | Missing composite indexes on `(tenantId, status)` for conversations | Low |
| 5.6 | `getAllRagChunksWithEmbedding` — full table scan at scale | Medium |
| Testing | No frontend tests | Low |
| Testing | No WebSocket auth tests | High |
| Testing | No multi-tenancy cross-tenant access tests | High |

### New Issues (from 2026-02-22 Audit)

| ID | Description | Priority |
|----|-------------|----------|
| ~~NEW-01~~ | ~~`AUTO_PARTS_ENABLED` flag not in `feature_flags.json`~~ | ✅ Fixed |
| NEW-02 | Password reset doesn't invalidate existing sessions | High |
| NEW-06 | Dockerfile doesn't exist but is referenced in docs | Low |
| NEW-08 | `settings.tsx` now 4,151 lines (DEBT-11 got worse) | Medium |

---

## Section 10: Fixes Applied 2026-02-22 (Message Routing)

| # | Fix | File(s) | Lines | Description |
|---|-----|---------|-------|-------------|
| FIX-01 | Double suggestions bug — VIN/FRAME branch hard stop | `server/services/inbound-message-handler.ts` | ~462 | Added `return;` at the end of the `if (vehicleDet && !isIncompleteVin)` block in `processIncomingMessageFull`. Previously, after enqueueing vehicle lookup and creating the `gearbox_tag_request` suggestion, execution fell through to `triggerAiSuggestion()`, producing a second AI suggestion for the same message. Now the VIN/FRAME branch is a hard stop — no AI suggestion is created when a VIN or FRAME is detected. Covers both the new-case and duplicate-case paths. |
| FIX-02 | Double suggestions bug — gearbox_type branch hard stop | `server/services/inbound-message-handler.ts` | ~514 | Added `return;` at the end of the `if (mentionedGearboxType !== "unknown")` block. Previously, after creating the `gearbox_no_vin` suggestion (or skipping creation if one already existed), execution fell through to `triggerAiSuggestion()`. Now when a gearbox type is detected, the branch is a hard stop — `triggerAiSuggestion()` is never reached. |
| FIX-03 | Updated `gearboxNoVin` template text | `server/services/gearbox-templates.ts` | ~16 | Replaced the old VIN-only prompt ("Для точного подбора …") with a new template that asks for gearbox marking OR VIN: "Здравствуйте! Чтобы сразу посчитать цену, нужна маркировка коробки (на шильдике КПП) или VIN. Что можете прислать?" The new text no longer uses the `{{gearboxType}}` placeholder. Tenant overrides in `tenants.templates.gearboxNoVin` take precedence as before. |
| FIX-04 | AI price estimate fallback in PriceLookupWorker | `server/workers/price-lookup.worker.ts` | ~320–438 | When `searchUsedTransmissionPrice` returns `source: "not_found"` (0 valid listings), the worker now calls `estimatePriceFromAI(oem, identification)` using the existing `openai` client (imported from `../services/decision-engine`). The GPT-4o-mini prompt asks for a RUB price range for the given OEM/model on the Russian used-parts market. If AI returns valid `{priceMin, priceMax}`, a snapshot with `source: "ai_estimate"` and a customer-facing reply is created (confidence: 0.5); the reply text does not mention AI or the price source. If the AI call throws or returns malformed JSON, the function silently returns `null` and the existing `not_found` behavior continues. |

---

## Section 11: Improvements Applied 2026-02-22 (Transmission Identification & Parser)

| # | Improvement | File(s) | Lines changed | Description |
|---|-------------|---------|---------------|-------------|
| IMP-01 | `VehicleContext` interface + context-aware GPT prompt in `identifyTransmissionByOem()` | `server/services/transmission-identifier.ts` | +22 | Added `VehicleContext` interface with fields `make`, `model`, `year`, `engine`, `body`, `driveType`, `gearboxModelHint`, `factoryCode`. Extended `identifyTransmissionByOem(oem, context?)` to build a multi-line user prompt that includes all non-null context fields before the identify instruction. Fully backwards-compatible — `context` is optional. |
| IMP-02 | `vehicleContext` field added to `PriceLookupJobData` | `server/services/price-lookup-queue.ts` | +2 | Added optional `vehicleContext?: VehicleContext` field to the BullMQ job data interface, imported via `import type { VehicleContext }` from `transmission-identifier`. No change to `enqueuePriceLookup` function signature — backwards-compatible. |
| IMP-03 | Vehicle context forwarded from `vehicle-lookup.worker.ts` (Path A — high-confidence OEM) | `server/workers/vehicle-lookup.worker.ts` | +16 | In the `lookupConfidence >= 0.85 && oemStatus === "FOUND"` branch, `vehicleMeta` is now cast to include `driveType` and a `VehicleContext` object is constructed from make/model/year/engine/body/driveType/gearboxModelHint/factoryCode and passed as `vehicleContext` to `enqueuePriceLookup`. `year` (number in vehicleMeta) is converted to string via `String()`. Added `import type { VehicleContext }` at top of file. |
| IMP-04 | `vehicleContext` threaded into `identifyTransmissionByOem()` call in price-lookup worker | `server/workers/price-lookup.worker.ts` | +5 | Added `VehicleContext` to imports from `transmission-identifier`. Extended `lookupPricesByOem()` signature with optional `vehicleContext?: VehicleContext`. `processPriceLookup` now destructures `vehicleContext` from `job.data` and passes it to `lookupPricesByOem()`, which then forwards it to `identifyTransmissionByOem(oem, vehicleContext)`. When `oemModelHint` is present the GPT call is still skipped (shortcircuit unchanged). |
| IMP-05 | Drive type (`привод`) parsing in Podzamenu Python parser | `podzamenu_lookup_service.py` | +10 | Added `"привод"`, `"тип привода"`, `"drive"`, `"drivetrain"` entries to `META_LABELS` → maps to `"driveType"` key in `vehicleMeta`. Extended `_extract_vehicle_info_js` JS evaluator: (a) added `driveIdx` header search covering all four variants; (b) added `meta.driveType` extraction from horizontal table data rows; (c) added drive-type key-value pair detection in the 2b loop. `_extract_meta_from_page` automatically benefits via the updated `META_LABELS` iteration. `driveType` is returned as part of `vehicleMeta` in `LookupResponse` without any schema change. |

### Impact

- GPT-4o-mini now receives vehicle make/model/year/engine/chassis/drive-type context when identifying an OEM transmission code, improving confidence and accuracy — especially for OEM codes shared across multiple brands or variants.
- Drive type data (`FWD`, `AWD`, `4WD`, `передний`, `полный`, etc.) is captured from podzamenu tables and flows end-to-end: parser → vehicleMeta → vehicleContext → GPT prompt.
- All changes are backwards-compatible: existing jobs without `vehicleContext` continue to work as before.

---

## Section 12: Fixes Applied 2026-02-23 (Search Strategy & Display Name)

| # | Fix | File(s) | Lines | Description |
|---|-----|---------|-------|-------------|
| FIX-05 | `isValidTransmissionModel` filter for internal OEM catalog codes | `server/workers/price-lookup.worker.ts` | ~375–384, ~423–435 | Added `isValidTransmissionModel(model)` predicate. Rejects codes longer than 12 characters or containing 4+ consecutive digits (e.g. `M3MHD987579` has `987579` — 6 consecutive digits). Accepts standard market codes: letter-only (`QCE`), digit-first (`09G`), hyphenated (`AW55-51SN`), parenthesised (`QCE(6A)`), and mixed alphanumeric (`F4A42`, `U660E`, `DQ250`). When `oemModelHint` from vehicle lookup passes validation it is used directly (GPT identification skipped). When it fails, the hint is discarded with a log line and GPT identification runs instead. |
| FIX-06 | GPT prompt updated to return market/commercial name | `server/services/transmission-identifier.ts` | ~22–28, ~61–70 | **System prompt** extended with: `"Return the modelName as the market/commercial name used in Russian контрактные АКПП listings (e.g. 'F4A42', 'U660E', 'A4CF1', 'AW55-51SN') — NOT internal catalog codes or part numbers. If unsure of the exact model, return the most likely market model name for this vehicle."` **User prompt** gains an extra reinforcement line `"Return modelName as it appears in Russian контрактные АКПП listings … — NOT internal catalog or part numbers."` injected only when `vehicleContext` fields are present, i.e. when there is enough vehicle data to make the instruction actionable. |
| FIX-07 | Dual search strategy — OEM+vehicle path when vehicleContext is present | `server/services/price-searcher.ts`, `server/workers/price-lookup.worker.ts` | price-searcher: ~57–100, ~192–207; worker: ~465–471 | **`price-searcher.ts`**: Added `import type { VehicleContext }` and a fifth parameter `vehicleContext?: VehicleContext \| null` to `searchUsedTransmissionPrice`. Computes `vehicleDesc = "${make} ${model}"` from context. `buildPrimaryQuery` gains a `vehicleDesc?` parameter — when set, returns `контрактная АКПП ${vehicleDesc} ${oem} [б/у из Японии\|Европы]`, using the raw OEM code and vehicle name instead of the (possibly unreliable) `modelName`. `buildFallbackQuery` similarly returns `контрактная АКПП ${vehicleDesc} ${oem} цена купить` when `vehicleDesc` is available. The existing model-name path is unchanged and used as fallback when `vehicleContext` is absent. **`price-lookup.worker.ts`**: `searchUsedTransmissionPrice` call now passes `vehicleContext` as the fifth argument. |
| FIX-08 | `effectiveDisplayName` fallback when modelName is an internal code | `server/workers/price-lookup.worker.ts` | ~445–461, ~483, ~495, ~523 | After `identification` is resolved (both fast-path and GPT path), `effectiveDisplayName` is computed: if `identification.modelName` passes `isValidTransmissionModel` it is used as-is; otherwise, if `vehicleContext` has `make` + `model`, the fallback is `"${make} ${model} АКПП"` (e.g. `"HYUNDAI ELANTRA АКПП"`); otherwise `null`. A warning log is emitted when the fallback activates. All three downstream display sites now use `effectiveDisplayName`: (1) AI-estimate suggestion text (line ~483), (2) `modelName` field in the AI-estimate snapshot (line ~495), (3) `modelName` field in the web-search snapshot (line ~523) — ensuring `createPriceSuggestions` and the cached-result path never render an internal code to the customer. |
| FIX-09 | VIN/FRAME label in templates reflects detection type | `server/services/gearbox-templates.ts`, `server/services/inbound-message-handler.ts` | gearbox-templates: template strings; inbound-handler: detection-type pass-through | Templates previously always read "VIN/номер кузова" regardless of what was actually detected. Detection type (`"VIN"` or `"FRAME"`) is now passed from `inbound-message-handler.ts` into the template layer. The `gearboxLookupFound` and `gearboxLookupModelOnly` templates use the appropriate label: `"VIN-коду"` when detection type is `VIN`, `"номеру кузова"` when it is `FRAME`. |
| FIX-10 | Removed `{{source}}` placeholder from customer-facing templates | `server/services/gearbox-templates.ts` | template strings | `gearboxLookupFound` and `gearboxLookupModelOnly` templates previously included a `{{source}}` placeholder that rendered as `"Источник: podzamenu"` in suggestions shown to customers — exposing an internal service name. The `{{source}}` placeholder and its surrounding text have been removed from both templates. Tenant overrides that do not contain `{{source}}` are unaffected. |

### Impact

- Internal Podzamenu catalog codes (e.g. `M3MHD987579`) are now reliably rejected before they reach the GPT identification prompt or the web search query.
- GPT is explicitly instructed to return market-tradeable codes (`F4A42`, `U660E`, etc.) — validated by a post-identification guard.
- Web search queries now use the car make/model + raw OEM number when vehicle context is available, producing consistently findable results on Russian used-parts marketplaces even when the transmission model name is uncertain.
- Customers never see internal catalog codes or data-source names in suggestion text.

---

---

## Section 13: New Findings (2026-02-24 Audit)

### NEW-09: `vin-ocr.service.ts` — undocumented GPT-4o vision image analysis service

- **File:** `server/services/vin-ocr.service.ts`
- **Discovery:** A fully implemented image analysis service using `gpt-4o` (vision) was not documented anywhere. It is actively called from `inbound-message-handler.ts` on every message with image attachments.
- **What it does:**
  - `analyzeImages(attachments)` — iterates attachments, calls GPT-4o vision to classify each as `gearbox_tag`, `registration_doc`, or `unknown`
  - For `gearbox_tag`: extracts transmission OEM code (e.g. `W5MBB`) → passed directly to `enqueuePriceLookup`
  - For `registration_doc`: extracts VIN, frame number, make, model → routed to vehicle lookup pipeline
  - Two-step VIN checksum correction: (1) single-char substitution for visually similar pairs (`S↔5`, `B↔8`, `Z↔2`, `G↔6`, `I↔1`, `O↔0`); (2) GPT-4o retry with targeted confusion-pairs prompt
  - `extractVinFromImages(attachments)` — legacy VIN-only extractor, same correction pipeline
- **Impact:** This is a critical component of the inbound image pipeline. Without it, image-based VIN/OEM extraction is impossible.
- **Action taken:** ✅ Fully documented in `docs/API_REFERENCE.md` under **VIN-OCR Image Analysis Pipeline**.
- **Priority:** Documentation only — code was already working.

### NEW-10: `vehicle-data-extractor.ts` — undocumented GPT-4o-mini driveType/gearboxType fallback

- **File:** `server/services/vehicle-data-extractor.ts`
- **Discovery:** A GPT-4o-mini fallback extractor for `driveType` and `gearboxType` from PartsAPI `rawData` was not documented. It is called from `vehicle-lookup.worker.ts` when regex-based parsing of `modifikaciya`/`opcii`/`kpp` fields produces no values.
- **What it does:**
  - `extractVehicleContextFromRawData(rawData)` — sends raw PartsAPI JSON to gpt-4o-mini with a system prompt that scans ALL fields (`modifikaciya`, `opcii`, `privod`, `kpp`, `tip_kpp`, `opisanie`, `naimenovanie`, `modely`) for drive type and gearbox type indicators
  - Returns `{ driveType: "4WD"|"2WD"|null, gearboxType: "CVT"|"MT"|"AT"|null }`
  - ~50 tokens per call. Non-fatal — on failure, returns `{ driveType: null, gearboxType: null }`
- **Impact:** Improves `gearboxType` detection accuracy for non-standard PartsAPI responses, which flows into transmission identification and search query construction.
- **Action taken:** ✅ Referenced in `docs/API_REFERENCE.md` in the Vehicle Lookup Worker Pipeline gearboxType parsing step.
- **Priority:** Documentation only — code was already working.

---

---

## Section 14: Price Search Architecture Analysis (2026-02-24) — ✅ IMPLEMENTED

Full deep-dive analysis of the price search implementation upgraded to a Yandex+Playwright
3-stage cascade pipeline across Phases 1–3 (2026-02-24). All critical findings are resolved.

### PRICE-01: GPT web_search is unreliable — hallucinates listings ✅ FIXED

- **File:** `server/services/price-searcher.ts`
- **Problem:** `searchUsedTransmissionPrice()` was using `openai.responses.create` (gpt-4.1 + `web_search`). GPT hallucinated prices, fabricated listing URLs, invented sources.
- **Fix applied (Phase 2):** `searchWithYandex()` runs as Stage 1 — real Yandex API URLs → Playwright rendering → cheerio parsing → filtered listings from actual pages. GPT path demoted to opt-out fallback (`GPT_WEB_SEARCH_ENABLED` flag, default `true`).
- **Status:** ✅ Resolved

### PRICE-02: `parsePrice` in Avito/Drom sources — selector miss, not code bug ✅ FIXED

- **Files:** `server/services/price-sources/drom-source.ts`, `avito-source.ts`
- **Problem:** Root cause was Cheerio CSS selectors not matching current site HTML; Avito requires JS execution. `parsePrice()` itself was correct but called with `null`/`undefined`.
- **Fix applied (Phase 1):** Added `if (!raw) return null` guard and changed signature to `(raw: string | null | undefined)` in both files. Playwright bridge (`/fetch-page`) resolves rendering for future use.
- **Status:** ✅ Resolved

### PRICE-03: Worker source routing silently drops Yandex results ✅ FIXED

- **File:** `server/workers/price-lookup.worker.ts`
- **Problem:** Worker condition only handled `"openai_web_search" || "not_found"`. Any `"yandex"` result would fall to the else branch and produce a not-found suggestion.
- **Fix applied (Phase 2):** Changed condition to `priceData.source === "yandex" || "openai_web_search" || "not_found"`. Cache check and suggestion builder also updated to handle `"yandex"` source.
- **Status:** ✅ Resolved

### PRICE-04: Escalation suggestion has no dedicated storage structure ✅ FIXED

- **Files:** `shared/schema.ts`, `migrations/0019_ai_suggestions_escalation.sql`, `server/workers/price-lookup.worker.ts`
- **Problem:** Stage 2 escalation payload (readyQueries, suggestedSites, urlsAlreadyChecked, vehicleContext) had no structured storage column.
- **Fix applied (Phase 1 + Phase 3):** Added `escalation_data JSONB` column to `ai_suggestions` via migration 0019. `createEscalationSuggestion()` populates it with full operator context including copy-ready RU+EN queries, suggested sites, and URLs already checked.
- **Status:** ✅ Resolved

### PRICE-05: `transmission_identity_cache` has no TTL — grows unboundedly ✅ FIXED

- **Files:** `shared/schema.ts`, `migrations/0018_transmission_identity_cache_ttl.sql`
- **Problem:** Cache had no `expires_at` column. Entries never invalidated; stale GPT results remained valid forever.
- **Fix applied (Phase 1):** Added `expires_at TIMESTAMP` column via migration 0018. Existing rows backfilled with `created_at + 30 days`. Schema updated in `transmissionIdentityCache` table definition.
- **Status:** ✅ Resolved

### PRICE-06: Podzamenu service PORT env var discrepancy ✅ FIXED

- **Files:** `podzamenu_lookup_service.py`, `server/services/playwright-fetcher.ts`
- **Problem:** Python service reads `PORT` (default 8200); Node.js bridge would use `PODZAMENU_SERVICE_PORT`. Mismatch if only one var is set.
- **Fix applied (Phase 1):** `playwright-fetcher.ts` reads `process.env.PODZAMENU_SERVICE_PORT ?? process.env.PORT ?? "8200"` — handles both naming conventions.
- **Status:** ✅ Resolved

### PRICE-07: `lookupPricesByFallback` will also call Yandex+Playwright ⚠️ ACCEPTED RISK

- **File:** `server/workers/price-lookup.worker.ts` (lookupPricesByFallback)
- **Problem:** Fallback flow (no OEM) calls `searchUsedTransmissionPrice()` which now invokes Yandex+Playwright with limited context (make/model/gearboxType only, no OEM).
- **Decision:** Accepted. Yandex+Playwright is preferred even for non-OEM queries — weaker queries still return real data. GPT fallback remains available via `GPT_WEB_SEARCH_ENABLED`. No fix planned for now.
- **Status:** ⚠️ Accepted as-is (low-priority secondary path)

### PRICE-08: FX rates fetched per-request from external CDN ❌ OPEN

- **File:** `server/services/price-searcher.ts` (`fetchLiveFxRates()`)
- **Problem:** Every price search call makes a live HTTP request to `cdn.jsdelivr.net`. If CDN is down or slow (3s timeout), price searches are delayed. Rates are valid for 24h — no need to fetch per-request.
- **Fix:** Cache FX rates in memory with 1-hour TTL. Refresh lazily on stale.
- **Priority:** Low — not addressed in Phase 1–3 (path is GPT fallback, less frequent with Yandex Stage 1)

### Summary of Phase 1–3 Implementation (2026-02-24)

| # | Action | Files | Status |
|---|--------|-------|--------|
| A | Add `stage`, `urls[]`, `domains[]` to `price_snapshots` | migration 0017 + `shared/schema.ts` | ✅ Done |
| B | Add `expires_at` to `transmission_identity_cache` | migration 0018 + `shared/schema.ts` | ✅ Done |
| C | Add `escalation_data JSONB` to `ai_suggestions` | migration 0019 + `shared/schema.ts` | ✅ Done |
| D | Add `POST /fetch-page` endpoint to Python service | `podzamenu_lookup_service.py` | ✅ Done |
| E | Create `server/services/playwright-fetcher.ts` | new file | ✅ Done |
| F | Create `server/services/price-sources/yandex-source.ts` | new file | ✅ Done |
| G | Fix `parsePrice` defensive guard in drom/avito sources | 2 files | ✅ Done |
| H | Update price-searcher.ts: searchWithYandex + GPT fallback guard | `price-searcher.ts` | ✅ Done |
| I | Fix source routing in worker (add "yandex") | `price-lookup.worker.ts` | ✅ Done |
| J | Add `createEscalationSuggestion()` to worker | `price-lookup.worker.ts` | ✅ Done |
| K | Register `PRICE_ESCALATION_ENABLED`, `GPT_WEB_SEARCH_ENABLED`, `AI_PRICE_ESTIMATE_ENABLED` flags | `shared/schema.ts` + `feature-flags.ts` | ✅ Done |
| L | Save `stage`, `urls[]`, `domains[]` on snapshot create | `price-lookup.worker.ts` | ✅ Done |
| M | FX rates per-request CDN call (PRICE-08) | `price-searcher.ts` | ❌ Deferred |

---

*End of audit. Initial audit: 2026-02-20. Updated: 2026-02-24 (Phase 1–3 implementation complete).*
*All 9 critical issues from initial audit have been fixed. All Price Architecture issues resolved except PRICE-08 (deferred).*
