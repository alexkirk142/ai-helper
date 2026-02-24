# Bug Fix Workflow

## Steps

1. **Read the buggy file COMPLETELY** — understand full context before changing anything
2. **Read all files that import/depend on it** — search with:
   - Imports: search for `from "./[filename]"` or `from "../[path]"`
   - Type usage: search for the type/function name across the codebase
3. **Read `shared/schema.ts`** for related entity types, Zod schemas, and table definitions
4. **Identify root cause** — don't treat symptoms:
   - Is it a type mismatch between `shared/schema.ts` and runtime data?
   - Is it a missing `tenantId` filter (multi-tenancy leak)?
   - Is it a race condition in async code?
   - Is it a missing null/undefined check?
   - Is it a Zod validation schema that's too strict or too loose?
5. **Check if the same bug exists in similar places** — patterns repeat across routes/services
6. **Implement fix** with minimal changes
7. **Verify dependent modules still work** — trace the call chain
8. **Check edge cases** — empty arrays, null values, missing optional fields

## Project-specific bug patterns

### Multi-tenancy data leak
Every database query MUST filter by `tenantId`. Check:
```typescript
// WRONG — leaks data across tenants
const items = await storage.getAll();

// CORRECT — scoped to tenant
const items = await storage.getAllByTenant(tenantId);
```

### Missing auth/permission check
Every route must have appropriate middleware:
```typescript
// WRONG — no auth
app.get("/api/data", async (req, res) => { ... });

// CORRECT — auth + permission
app.get("/api/data", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req, res) => { ... });
```

### Zod validation bypass
Always validate input before using it:
```typescript
// WRONG — trusting raw input
const { name, email } = req.body;

// CORRECT — validate first
const parseResult = schema.safeParse(req.body);
if (!parseResult.success) {
  return res.status(400).json({ error: "Validation failed", details: parseResult.error.errors });
}
const { name, email } = parseResult.data;
```

### React Query stale data
After mutations, invalidate related queries:
```typescript
// WRONG — data stays stale
const mutation = useMutation({ mutationFn: ... });

// CORRECT — invalidate cache
const mutation = useMutation({
  mutationFn: ...,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/related-data"] });
  },
});
```

### Type mismatch shared ↔ server ↔ client
Types flow from `shared/schema.ts` to both server and client. If a column is added to the
Drizzle table but the Zod schema isn't updated (or vice versa), there will be runtime errors.
Check all three layers match.

## Key files to review for context

| Area | Files |
|------|-------|
| Types & schemas | `shared/schema.ts` |
| Storage layer | `server/storage.ts` (interface), `server/database-storage.ts` (impl) |
| Routes | `server/routes.ts`, `server/routes/*.ts` |
| Middleware | `server/middleware/rbac.ts`, `server/middleware/validation.ts`, `server/middleware/error-handler.ts` |
| Client queries | `client/src/lib/queryClient.ts` |
| Auth | `client/src/hooks/use-auth.ts`, `server/services/auth-service.ts` |

## Before submitting

- [ ] Root cause identified and fixed (not just symptoms)
- [ ] No regression in related features
- [ ] Error handling covers the edge case
- [ ] Types are consistent across `shared/` → `server/` → `client/`
- [ ] Multi-tenancy: all queries scoped to `tenantId`
- [ ] Auth: all routes have appropriate middleware
- [ ] Validation: all user input validated with Zod
