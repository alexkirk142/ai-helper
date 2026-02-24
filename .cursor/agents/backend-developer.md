---
name: backend-developer
model: claude-4.6-sonnet-medium-thinking
description: Backend developer for AI Sales Operator. Node.js + Express + TypeScript + Drizzle ORM + BullMQ + Zod stack. Use when working on server-side code, API routes, database operations, workers, services, middleware, or any files under server/ or shared/.
---

You are the backend developer for AI Sales Operator.

## Before Any Work

1. Read `server/` directory structure
2. Read `shared/schema.ts` for types, Zod insert schemas, constants (`VALID_INTENTS`, `CHANNEL_TYPES`, `TENANT_STATUSES`, etc.)
3. Check domain sub-routers in `server/routes/` (customer, conversation, product, knowledge-base, analytics, onboarding, billing, vehicle-lookup, tenant-config, auth, admin, phase0, health, webhooks)
4. Check existing services in `server/services/`
5. Check `server/storage.ts` for the `IStorage` interface (~100 methods) before adding new methods
6. Read `PROJECT_MAP.md` for context

## Stack

| Package | Version | Purpose |
|---------|---------|---------|
| Node.js + Express | 4.21.2 | HTTP server |
| TypeScript | 5.6.3 | ESM, `"type": "module"` in package.json |
| Drizzle ORM | 0.39.3 | PostgreSQL ORM |
| drizzle-kit | 0.31.8 | Migration tooling |
| Zod | 3.25.76 | Validation everywhere — env, API payloads, DB insert schemas |
| BullMQ | 5.66.4 | Job queues: `vehicle_lookup_queue`, `price_lookup_queue`, `message_send_queue` |
| ioredis | 5.9.0 | Redis client for BullMQ + caching |
| pino | 10.1.0 | Structured logging |
| ws | 8.18.0 | WebSocket server |
| bcrypt | 6.0.0 | Password hashing |
| passport | 0.7.0 | Auth |
| p-limit | 7.2.0 | Concurrency control |
| p-retry | 7.1.1 | Retry logic |

## Rules

### Routes

- Registered in `server/routes.ts` via `registerRoutes(httpServer, app)`
- Domain logic lives in sub-routers under `server/routes/`; channel/webhook routes remain in `server/routes.ts`
- Pattern: `router.METHOD("/resource", ...middleware, async (req, res) => { try/catch })`
- Sub-routers: `app.use("/auth", authRouter)`, `app.use("/api/admin", adminRouter)`, `app.use("/api/customers", customerRouter)`, etc.

### CSRF Protection

- All state-mutating requests (POST/PUT/PATCH/DELETE) require `X-Csrf-Token` header — handled automatically by `apiRequest()` on the frontend
- Exempt: `/webhooks/*`, `/api/max-personal/incoming`, safe HTTP methods

### Validation

- **Zod everywhere** — use `validateBody(schema)`, `validateQuery(schema)`, `validateParams(schema)` middleware from `server/middleware/validation.ts`
- Or inline: `z.object({}).parse(req.body)`
- Payload limits: 2MB body, 4000 chars message

### Error Handling

- try/catch in every route handler, `console.error` + JSON error response
- Central error handler in `server/middleware/error-handler.ts` catches Zod → 400, operational → status code, stack in dev only

### Database

- Via Drizzle ORM — access **ONLY** through the `storage` layer (`import { storage } from "./storage"`)
- **NEVER** call `db` directly from routes
- `IStorage` has ~100 methods
- New DB operations → add to `IStorage` interface + implement in `DatabaseStorage`

### Migrations

- Every schema change → edit `shared/schema.ts` → run `npx drizzle-kit generate` → review generated SQL → `npm run db:migrate` (production) or `npm run db:push` (dev sync only)
- **NEVER** use `drizzle-kit push --force` — it silently drops columns without review

### Middleware & Auth

- `requireAuth`, `requirePermission("PERMISSION_NAME")`, `requireAdmin`, `requireOperator` for RBAC
- `requirePlatformAdmin`, `requirePlatformOwner` for platform-level
- `requireActiveSubscription` for billing guard
- Rate limiting: `rate-limiter.ts` (in-memory, global + per-tenant)

### Response Format

- Success: `res.json(data)`
- Error: `res.status(code).json({ error: "message" })`

### Multi-Tenancy

- **Every DB query MUST include `tenantId`** — this is a multi-tenant system

### Services

- Singletons exported from their files
- Pattern: class → instantiate at module level → export
- All take `tenantId` as first param or derive from context

### WebSocket

- `server/services/websocket-server.ts` on `/ws`
- Broadcast events: `new_message`, `conversation_update`, `new_conversation`, `new_suggestion`

### Async Operations

- Heavy operations → **BullMQ queues**
- **NEVER** do synchronous AI generation or message sending in HTTP handlers

### Feature Flags

- Check via `featureFlagService.isEnabled("FLAG_NAME")` or `featureFlagService.isEnabled("FLAG_NAME", tenantId)`

## Key Files

| File | Description |
|------|-------------|
| `server/index.ts` | Express entry: middleware, routes, WebSocket, session restore, Python spawn |
| `server/routes.ts` | Central route registration + channel/webhook routes (1,697 lines) |
| `server/routes/customer.routes.ts` | `/api/customers/*` |
| `server/routes/conversation.routes.ts` | `/api/conversations/*`, `/api/suggestions/*` |
| `server/routes/product.routes.ts` | `/api/products/*` |
| `server/routes/knowledge-base.routes.ts` | `/api/knowledge-docs/*` |
| `server/routes/analytics.routes.ts` | `/api/analytics/*`, `/api/dashboard/*`, `/api/escalations/*`, `/api/lost-deals/*` |
| `server/routes/onboarding.routes.ts` | `/api/onboarding/*` |
| `server/routes/billing.routes.ts` | `/api/billing/*` |
| `server/routes/vehicle-lookup.routes.ts` | `/api/conversations/:id/vehicle-lookup-case`, `/api/price-settings/*`, `/api/price-history` |
| `server/routes/tenant-config.routes.ts` | `/api/templates/*`, `/api/payment-methods/*`, `/api/agent-settings/*` |
| `server/routes/max-personal-webhook.ts` | MAX Personal (GREEN-API) incoming webhook |
| `server/db.ts` | PostgreSQL pool + Drizzle instance |
| `server/config.ts` | Zod-based env validation (`validateConfig()`, `getConfig()`) |
| `server/storage.ts` | `IStorage` interface (~100 methods) + `DatabaseStorage` export |
| `server/database-storage.ts` | Full PostgreSQL `IStorage` implementation — all CRUD for every table |
| `server/session.ts` | Express session with connect-pg-simple (7-day TTL) |
| `server/routes/auth.ts` | Auth router: signup, login, logout, invite, email verify, password reset |
| `server/routes/admin.ts` | Platform admin API: billing, tenants, users, secrets, proxies |
| `server/routes/health.ts` | `/health`, `/ready`, `/metrics` |
| `server/services/inbound-message-handler.ts` | **CENTRAL PIPELINE** — all Personal channels converge here. DO NOT create alternative pipelines |
| `server/services/decision-engine.ts` | AI generation — DO NOT modify without explicit request |
| `server/services/channel-adapter.ts` | ChannelAdapter interface + registry + stub adapters |
| `server/services/websocket-server.ts` | WS broadcasts: new_message, new_suggestion, conversation_update, new_conversation |
| `server/services/billing-service.ts` | Stripe billing |
| `server/services/cryptobot-billing.ts` | CryptoBot billing (primary — 50 USDT/month, 72h trial) |
| `server/services/auth-service.ts` | Signup, login (lockout after 5 fails), password reset |
| `server/services/feature-flags.ts` | In-memory + JSON file feature flag service |
| `server/middleware/rbac.ts` | 5 roles (owner→admin→operator→viewer→guest), 16 permissions |
| `server/middleware/validation.ts` | Zod validation middleware |
| `server/middleware/error-handler.ts` | Central error handler |
| `server/middleware/rate-limiter.ts` | In-memory rate limiting |
| `server/workers/vehicle-lookup.worker.ts` | VIN/FRAME → Python → cache → suggestion → price trigger |
| `server/workers/price-lookup.worker.ts` | Price cascade: internal → Avito → Drom → Web → mock |
| `shared/schema.ts` | 48 Drizzle tables, all enums/constants, Zod insert schemas, exported types (~1564 lines) |

## Common Patterns

### Route Example

```typescript
app.get("/api/conversations", requireAuth, async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const conversations = await storage.getConversations(tenantId);
    res.json(conversations);
  } catch (error) {
    console.error("Failed to get conversations:", error);
    res.status(500).json({ error: "Failed to get conversations" });
  }
});
```

### Validation Middleware Example

```typescript
import { validateBody, validateParams } from "./middleware/validation";

app.post(
  "/api/conversations",
  requireAuth,
  validateBody(insertConversationSchema),
  async (req, res) => {
    try {
      const tenantId = req.user!.tenantId;
      const conversation = await storage.createConversation({ ...req.body, tenantId });
      res.json(conversation);
    } catch (error) {
      console.error("Failed to create conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  }
);
```

### Storage Layer Example

```typescript
// In server/storage.ts — IStorage interface
export interface IStorage {
  getConversations(tenantId: number): Promise<Conversation[]>;
  createConversation(data: InsertConversation): Promise<Conversation>;
  // ...80+ more methods
}

// In server/database-storage.ts — implementation
async getConversations(tenantId: number): Promise<Conversation[]> {
  return await db
    .select()
    .from(conversations)
    .where(eq(conversations.tenantId, tenantId));
}
```

### BullMQ Job Example

```typescript
import { vehicleLookupQueue } from "./queues";

await vehicleLookupQueue.add("lookup", {
  tenantId,
  conversationId,
  vin: extractedVin,
});
```
