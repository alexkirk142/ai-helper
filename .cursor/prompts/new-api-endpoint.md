# New API Endpoint

## Before creating

1. Read `server/routes.ts` — most routes are defined directly inside `registerRoutes()`
2. Read `server/routes/` for any modular router files (`auth.ts`, `admin.ts`, `phase0.ts`, etc.)
3. Read `shared/schema.ts` — find existing types, Zod schemas, and table definitions
4. Search `server/routes.ts` for a similar endpoint to avoid duplication
5. Read `server/middleware/` to understand available middleware

## Steps

1. **Define types** in `shared/schema.ts`:
   - Add Drizzle table (if new entity) using `pgTable()`
   - Create insert schema: `export const insertXxxSchema = createInsertSchema(xxx).omit({ id: true, createdAt: true })`
   - Export select type: `export type Xxx = typeof xxx.$inferSelect`
   - Export insert type: `export type InsertXxx = z.infer<typeof insertXxxSchema>`

2. **Add storage methods** in `server/database-storage.ts` (and interface in `server/storage.ts`)

3. **Create route** in `server/routes.ts` inside `registerRoutes()`:
   - Follow the inline route pattern (most common)
   - Or create a separate router in `server/routes/[name].ts` if the domain is large

4. **Add Zod validation** using `z.object({...})` with `.safeParse(req.body)`

5. **Apply middleware** (pick what applies):
   - `requireAuth` — authentication required
   - `requirePermission("PERMISSION_NAME")` — RBAC check
   - `requireRole(["admin", "operator"])` — role-based check
   - `requireActiveSubscription` — paid feature
   - `requireActiveTenant` — fraud protection
   - Rate limiter: `apiRateLimiter`, `aiRateLimiter`, `conversationRateLimiter`
   - Validation: `validateBody(schema)`, `validateQuery(schema)`, `validateParams(schema)`

6. **Implement error handling** following project pattern (try/catch with JSON errors)

7. **Register route** — if using a separate router, mount it in `registerRoutes()` with `app.use()`

## Template — inline route in `server/routes.ts`

```typescript
// --- [Feature Name] ---

app.get("/api/[resource]", requireAuth, requirePermission("[PERMISSION]"), async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: "Tenant not found" });
    }

    const result = await storage.[getMethod](tenantId);
    res.json(result);
  } catch (error) {
    console.error("[Feature] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/[resource]", requireAuth, requirePermission("[PERMISSION]"), async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    if (!tenantId) {
      return res.status(403).json({ error: "Tenant not found" });
    }

    const parseResult = insertXxxSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parseResult.error.errors.map(e => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const created = await storage.[createMethod]({ ...parseResult.data, tenantId });
    res.status(201).json(created);
  } catch (error) {
    console.error("[Feature] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
```

## Template — separate router module in `server/routes/[name].ts`

```typescript
import { Router, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth, requirePermission } from "../middleware/rbac";

const router = Router();

router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const result = await storage.[getMethod](tenantId);
    res.json(result);
  } catch (error) {
    console.error("[Feature] Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

// Then in server/routes.ts, inside registerRoutes():
// import xxxRouter from "./routes/[name]";
// app.use("/api/[resource]", xxxRouter);
```

## Available permissions (from RBAC middleware)

- `VIEW_CONVERSATIONS`, `MANAGE_CONVERSATIONS`
- `SEND_MESSAGES`
- `MANAGE_CUSTOMERS`
- `MANAGE_PRODUCTS`
- `MANAGE_KNOWLEDGE_BASE`
- `MANAGE_AI_SETTINGS`
- `MANAGE_CHANNELS`
- `MANAGE_TENANT_SETTINGS`
- `MANAGE_TEAM`
- `VIEW_AUDIT_LOGS`

## Response format conventions

```typescript
// Success — return entity directly
res.json({ id: "...", name: "..." });

// Success — list
res.json([{ id: "1" }, { id: "2" }]);

// Success — action result
res.json({ success: true, message: "Done" });

// Created
res.status(201).json({ success: true, data: { ... } });

// Validation error
res.status(400).json({ error: "Validation failed", details: [...] });

// Not found
res.status(404).json({ error: "Resource not found" });

// Forbidden
res.status(403).json({ error: "Forbidden" });
```
