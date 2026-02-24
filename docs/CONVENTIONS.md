# Code Conventions — AI Sales Operator

This document describes the conventions **already used** in the codebase. Every section includes real code examples with file paths and line numbers.

---

## Naming

### Files: `kebab-case`

All source files across client, server, and shared use `kebab-case.ts` / `kebab-case.tsx`.

```
server/services/decision-engine.ts
server/services/customer-summary-service.ts
server/middleware/rate-limiter.ts
server/workers/message-send.worker.ts
client/src/pages/customer-profile.tsx
client/src/components/chat-interface.tsx
client/src/hooks/use-auth.ts
client/src/lib/queryClient.ts          ← only exception (camelCase), legacy
shared/schema.ts
```

Worker files use the suffix `.worker.ts`:

```
server/workers/message-send.worker.ts
server/workers/price-lookup.worker.ts
server/workers/vehicle-lookup.worker.ts
```

Test files use the suffix `.test.ts`:

```
server/__tests__/embedding-service.test.ts
server/tests/rate-limiter.test.ts
server/services/__tests__/telegram-adapter.test.ts
```

### Variables & Functions: `camelCase`

```typescript
// server/services/price-lookup-queue.ts:22
let priceLookupQueue: Queue<PriceLookupJobData> | null = null;

// client/src/pages/conversations.tsx:14
const [selectedId, setSelectedId] = useState<string | null>(null);

// server/database-storage.ts:55
private defaultTenantId: string | null = null;

// client/src/pages/customer-profile.tsx:57
const getTags = (c: Customer): string[] => { ... };
```

### Types & Interfaces: `PascalCase`

```typescript
// server/middleware/rbac.ts:8
export interface MarkedHandler extends RequestHandler { ... }

// server/middleware/rbac.ts:13
export type UserRole = "owner" | "admin" | "operator" | "viewer" | "guest";

// server/services/fraud-detection-service.ts:8
export interface FingerprintInput { ... }

// client/src/components/chat-interface.tsx:34
interface ChatInterfaceProps { ... }

// shared/schema.ts:17
export type ValidIntent = typeof VALID_INTENTS[number];

// shared/schema.ts:28
export type TenantStatus = typeof TENANT_STATUSES[number];
```

### Constants: `UPPER_SNAKE_CASE`

```typescript
// shared/schema.ts:7
export const VALID_INTENTS = ["price", "availability", "shipping", ...] as const;

// shared/schema.ts:20
export const TRAINING_POLICY_LIMITS = { maxIntentsListSize: 50, ... } as const;

// shared/schema.ts:742
export const CONVERSATION_STATUSES = ["active", "waiting_customer", ...] as const;

// server/routes.ts:33
const MAX_NOTE_LENGTH = 2048;

// server/workers/message-send.worker.ts:11
const QUEUE_NAME = "message_send_queue";

// server/services/whatsapp-adapter.ts:12
const WHATSAPP_API_VERSION = "v18.0";

// server/middleware/rbac.ts:15
export const PERMISSIONS = ["VIEW_CONVERSATIONS", "MANAGE_CONVERSATIONS", ...] as const;

// client/src/hooks/use-mobile.tsx:3
const MOBILE_BREAKPOINT = 768;
```

### Database Tables: `snake_case` (SQL), `camelCase` (JS variable)

SQL table names use `snake_case`. The JS/TS variable for the table uses `camelCase`.

```typescript
// shared/schema.ts:60
export const tenants = pgTable("tenants", { ... });

// shared/schema.ts:161
export const customers = pgTable("customers", { ... });

// shared/schema.ts:179
export const customerNotes = pgTable("customer_notes", { ... });

// shared/schema.ts:189
export const customerMemory = pgTable("customer_memory", { ... });

// shared/schema.ts:302
export const aiSuggestions = pgTable("ai_suggestions", { ... });

// shared/schema.ts:345
export const aiTrainingSamples = pgTable("ai_training_samples", { ... });

// shared/schema.ts:1263
export const vehicleLookupCache = pgTable("vehicle_lookup_cache", { ... });
```

Column names in SQL are `snake_case`, mapped to `camelCase` in TypeScript:

```typescript
// shared/schema.ts:68-69
workingHoursStart: text("working_hours_start").default("09:00"),
workingHoursEnd: text("working_hours_end").default("18:00"),

// shared/schema.ts:100
emailVerifiedAt: timestamp("email_verified_at"),
```

### API Endpoints: `/api/resource` with `kebab-case` slugs

Pattern: `/api/{resource}` or `/api/{resource}/:id/{sub-resource}`. Multi-word slugs use `kebab-case` (e.g., `feature-flags`, `generate-suggestion`, `human-delay`).

Routes are split across domain modules under `server/routes/`:

| Module | File | Prefix |
|--------|------|--------|
| Auth | `auth.ts`, `auth-api.ts` | `/auth/`, `/api/auth/` |
| Customers | `customer.routes.ts` | `/api/customers/` |
| Conversations | `conversation.routes.ts` | `/api/conversations/`, `/api/suggestions/` |
| Products | `product.routes.ts` | `/api/products/` |
| Knowledge Base | `knowledge-base.routes.ts` | `/api/knowledge-docs/` |
| Analytics | `analytics.routes.ts` | `/api/analytics/`, `/api/dashboard/`, `/api/escalations/`, `/api/lost-deals/` |
| Onboarding | `onboarding.routes.ts` | `/api/onboarding/` |
| Billing | `billing.routes.ts` | `/api/billing/` |
| Vehicle/Price | `vehicle-lookup.routes.ts` | `/api/conversations/:id/vehicle-lookup-case`, `/api/price-settings/`, `/api/conversations/:id/price-lookup`, `/api/conversations/:id/price-history` |
| Templates/Payment/AgentSettings | `tenant-config.routes.ts` | `/api/templates/`, `/api/payment-methods/`, `/api/agent-settings/` |
| Admin | `admin.ts` | `/api/admin/` |
| Feature Flags | `phase0.ts` | `/api/admin/feature-flags/`, `/api/feature-flags/`, `/api/admin/audit-events/` |
| Health | `health.ts` | `/health`, `/ready`, `/metrics` |

Central route registration + channels/webhooks remain in `server/routes.ts` (1,697 lines).

### React Components: `PascalCase`

```typescript
// client/src/pages/conversations.tsx:13
export default function Conversations() { ... }

// client/src/pages/dashboard.tsx:22
export default function Dashboard() { ... }

// client/src/components/ui/button.tsx:48
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>( ... );

// client/src/components/ui/toast.tsx:41
const Toast = React.forwardRef< ... >( ... );

// client/src/components/subscription-paywall.tsx
export function SubscriptionPaywall({ ... }: SubscriptionPaywallProps) { ... }
```

---

## File Structure Patterns

### Component File (Page)

Pattern: `imports → local state → query hooks → mutation hooks → handlers → JSX`

```typescript
// client/src/pages/conversations.tsx — representative structure

// 1. React imports
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";

// 2. Internal component imports
import { ConversationList } from "@/components/conversation-list";
import { ChatInterface } from "@/components/chat-interface";
import { CustomerCard } from "@/components/customer-card";

// 3. Utility imports
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// 4. UI component imports
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, ... } from "@/components/ui/sheet";

// 5. Icon imports
import { User, ArrowLeft } from "lucide-react";

// 6. Type imports (always last)
import type { ConversationWithCustomer, ConversationDetail } from "@shared/schema";

// 7. Component definition
export default function Conversations() {
  // a. Local state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { toast } = useToast();

  // b. Query hooks
  const { data: conversations, isLoading } = useQuery<ConversationWithCustomer[]>({
    queryKey: ["/api/conversations"],
  });

  // c. Mutation hooks
  const approveMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/suggestions/${id}/approve`),
    onSuccess: () => { queryClient.invalidateQueries({ ... }); },
  });

  // d. Event handlers
  const handleSelectConversation = async (id: string) => { ... };

  // e. JSX return
  return ( ... );
}
```

### Route File

Pattern: `imports → constants → registerRoutes function → grouped route handlers`

```typescript
// server/routes.ts — structure overview

// 1. Framework & type imports
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";

// 2. Internal imports (storage, services, middleware)
import { storage } from "./storage";
import { requireAuth, requireOperator, requireAdmin, requirePermission } from "./middleware/rbac";

// 3. Constants
const MAX_NOTE_LENGTH = 2048;

// 4. Async registration function
export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // 5. Middleware setup
  app.use(getSession());

  // 6. Routes grouped by feature with section comments
  // ============ TENANT ROUTES ============
  app.get("/api/tenant", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req, res) => {
    try {
      // ... business logic
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to ..." });
    }
  });

  return httpServer;
}
```

### Service File (Class-Based)

Pattern: `imports → constants → interfaces → class → singleton export`

```typescript
// server/services/audit-log.ts — representative structure

// 1. Imports
import type { AuditEvent, InsertAuditEvent, AuditAction } from "@shared/schema";
import { randomUUID } from "crypto";

// 2. Interface definitions
interface AuditContext {
  requestId?: string;
  ipAddress?: string;
}

// 3. Service class
class AuditLogService {
  private events: Map<string, AuditEvent> = new Map();
  private context: AuditContext = {};

  // Public API methods
  async log(action: AuditAction, ...): Promise<AuditEvent> { ... }

  // Convenience methods
  async logSuggestionGenerated(...): Promise<AuditEvent> { ... }
  async logSuggestionApproved(...): Promise<AuditEvent> { ... }

  // Query methods
  async getEventsByEntity(...): Promise<AuditEvent[]> { ... }
}

// 4. Singleton export
export const auditLog = new AuditLogService();
```

### Service File (Function-Based)

Pattern: `imports → client init → constants → interfaces → exported functions`

```typescript
// server/services/customer-summary-service.ts — representative structure

// 1. Imports
import OpenAI from "openai";
import { storage } from "../storage";

// 2. Client initialization
const openai = new OpenAI({ ... });

// 3. Constants
const DEFAULT_MESSAGE_LIMIT = 30;

// 4. Interfaces
export interface SummaryResult { ... }

// 5. Private helpers
async function getRecentCustomerMessages(...): Promise<Message[]> { ... }

// 6. Exported functions
export async function generateCustomerSummary(...): Promise<SummaryResult> { ... }
export async function triggerSummaryOnConversationResolved(...): Promise<void> { ... }
```

### Migration File

Pattern: Header comment → idempotent SQL → indexes

```sql
-- migrations/0003_vehicle_lookup_tables.sql

-- Migration: Vehicle lookup cache and cases (Podzamenu VIN/FRAME)
-- Creates vehicle_lookup_cache and vehicle_lookup_cases tables with indexes.

CREATE TABLE IF NOT EXISTS vehicle_lookup_cache (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  lookup_key TEXT NOT NULL,
  ...
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_lookup_cache_lookup_key_unique
  ON vehicle_lookup_cache (lookup_key);
```

Naming: `NNNN_description.sql` (sequential numbering, `snake_case` description). Manual migrations go in `migrations/manual/`.

### Schema File

Pattern: `imports → constants → table definitions → insert schemas → type exports → extended types`

```typescript
// shared/schema.ts — structure overview

// 1. Imports
import { pgTable, text, varchar, ... } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// 2. Constants (union values)
export const VALID_INTENTS = ["price", "availability", ...] as const;
export type ValidIntent = typeof VALID_INTENTS[number];

// 3. Table definitions
export const tenants = pgTable("tenants", { ... });
export const users = pgTable("users", { ... });

// 4. Insert schemas (Zod)
export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true });

// 5. Type exports (inferred from tables)
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

// 6. Extended types (for API responses)
export type ConversationWithCustomer = Conversation & {
  customer: Customer;
  lastMessage?: Message;
  channel?: Channel;
};
```

---

## Imports

### Import Order

The project follows a consistent order across files:

**Client files:**
1. React / React hooks (`react`, `react-hook-form`)
2. Third-party libraries (`@tanstack/react-query`, `zod`, `wouter`)
3. Internal utilities (`@/lib/queryClient`, `@/hooks/use-auth`)
4. UI components (`@/components/ui/*`)
5. Application components (`@/components/*`)
6. Icons (`lucide-react`)
7. Type imports (`type` keyword, `@shared/schema`)

```typescript
// client/src/pages/conversations.tsx:1-11
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ConversationList } from "@/components/conversation-list";
import { ChatInterface } from "@/components/chat-interface";
import { CustomerCard } from "@/components/customer-card";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { User, ArrowLeft } from "lucide-react";
import type { ConversationWithCustomer, ConversationDetail } from "@shared/schema";
```

**Server files:**
1. Framework imports (`express`, `http`)
2. Third-party libraries (`openai`, `zod`, `drizzle-orm`)
3. Internal modules (`./storage`, `./db`, `./services/*`, `./middleware/*`)
4. Schema imports (`@shared/schema` — tables, then types)

```typescript
// server/routes.ts:1-8
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import OpenAI from "openai";
import { z } from "zod";
import { insertProductSchema, insertKnowledgeDocSchema, ... } from "@shared/schema";
import { sql, count, gte } from "drizzle-orm";
```

### Path Aliases

Configured in `tsconfig.json`:

```json
{
  "paths": {
    "@/*": ["./client/src/*"],
    "@shared/*": ["./shared/*"]
  }
}
```

Also in `vite.config.ts`:

```typescript
resolve: {
  alias: {
    "@": path.resolve(import.meta.dirname, "client", "src"),
    "@shared": path.resolve(import.meta.dirname, "shared"),
  },
},
```

- `@/*` — client-side imports (components, hooks, lib, pages)
- `@shared/*` — shared code (schema, models)
- Server files use **relative** imports (`./storage`, `../middleware/rbac`)
- Client files use **alias** imports (`@/components/ui/button`, `@shared/schema`)

---

## TypeScript

### Strict Mode: Yes

```json
// tsconfig.json:9
"strict": true
```

### `any` Usage

`any` is prevalent (~150+ instances), concentrated in:
- **Error catch blocks** — most common legitimate use
- **Telegram/WhatsApp adapters** — external library types are often untyped
- **Route handlers** — catch blocks and dynamic data

```typescript
// server/routes.ts — typical catch block pattern
} catch (error: any) {
  res.status(500).json({ error: "Failed to fetch tenant" });
}

// server/services/auth-service.ts:226 — error type checking
private isUniqueViolationError(error: any): boolean { ... }

// client/src/lib/websocket.ts:3 — callback typing
type MessageHandler = (data: any) => void;
```

### Enums vs Union Types: Union Types Only

**No `enum` declarations exist** in the codebase. The project uses `as const` arrays with derived union types:

```typescript
// shared/schema.ts:7-17
export const VALID_INTENTS = [
  "price", "availability", "shipping", "return", "discount", "complaint", "other",
] as const;
export type ValidIntent = typeof VALID_INTENTS[number];

// shared/schema.ts:27-28
export const TENANT_STATUSES = ["active", "restricted"] as const;
export type TenantStatus = typeof TENANT_STATUSES[number];

// server/middleware/rbac.ts:13
export type UserRole = "owner" | "admin" | "operator" | "viewer" | "guest";

// server/services/training-sample-service.ts:5
export type TrainingOutcome = "APPROVED" | "EDITED" | "REJECTED";
```

Pattern: Define `const ARRAY = [...] as const`, then derive `type T = typeof ARRAY[number]`.

### Type vs Interface

**Interfaces** are more common (~50+) than **type aliases** (~30+).

- **`interface`** — used for object shapes, component props, service contracts:

```typescript
// server/storage.ts:44
export interface IStorage { ... }

// server/middleware/error-handler.ts:4
interface AppError extends Error { statusCode?: number; isOperational?: boolean; }

// client/src/components/chat-interface.tsx:34
interface ChatInterfaceProps { conversationId: string; ... }
```

- **`type`** — used for unions, intersections, utility types, and inferred types:

```typescript
// shared/schema.ts — inferred types
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;

// client/src/lib/queryClient.ts:26
type UnauthorizedBehavior = "returnNull" | "throw";

// shared/schema.ts — composite types
export type ConversationWithCustomer = Conversation & { customer: Customer; ... };
```

### Generics

Limited custom generics. Mainly used through library APIs:

```typescript
// client/src/lib/queryClient.ts:27
export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T>

// server/middleware/validation.ts:94
export function validateBody<T extends ZodSchema>(schema: T)

// client/src/pages/conversations.tsx:35
const { data: conversations } = useQuery<ConversationWithCustomer[]>({ ... });
```

---

## Error Handling

### Backend: Try/Catch + Error Middleware + Custom Errors

Every route handler wraps its body in `try/catch`:

```typescript
// server/routes.ts:54-67
app.get("/api/tenant", requireAuth, requirePermission("VIEW_CONVERSATIONS"), async (req, res) => {
  try {
    const user = await storage.getUser(req.userId);
    if (!user?.tenantId) {
      return res.status(403).json({ error: "User not associated with a tenant" });
    }
    const tenant = await storage.getTenant(user.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    res.json(tenant);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch tenant" });
  }
});
```

**Error middleware** (`server/middleware/error-handler.ts`):

```typescript
// server/middleware/error-handler.ts:9-61
export function errorHandler(err: AppError, req: Request, res: Response, _next: NextFunction): void {
  // Structured JSON logging
  console.error(JSON.stringify({
    level: "error", type: "error", requestId, message: err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    path: req.path, method: req.method, timestamp: new Date().toISOString(),
  }));

  // Zod validation errors → 400
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation error", details: [...], requestId });
    return;
  }
  // Operational errors → custom status
  if (err.isOperational) {
    res.status(err.statusCode || 400).json({ error: err.message, requestId });
    return;
  }
  // Unknown errors → 500
  res.status(500).json({ error: "Internal server error", requestId });
}
```

**Custom error class:**

```typescript
// server/middleware/error-handler.ts:64-73
export class OperationalError extends Error {
  statusCode: number;
  isOperational = true;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = "OperationalError";
  }
}
```

### Frontend: Toast Notifications + React Query Error States

No React Error Boundaries. Errors are handled via:

1. **Toast notifications** — used in 13+ pages/components:

```typescript
// client/src/pages/conversations.tsx:50-51
onSuccess: () => {
  toast({ title: "Response approved and sent" });
},
```

2. **React Query error states** — conditional rendering:

```typescript
// Typical pattern: useQuery returns isLoading / isError
const { data, isLoading } = useQuery<ConversationWithCustomer[]>({
  queryKey: ["/api/conversations"],
});
```

3. **`throwIfResNotOk` wrapper** — throws on non-OK responses:

```typescript
// client/src/lib/queryClient.ts:3-8
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}
```

### Telegram: Catch + Status Update + Console Logging

```typescript
// server/services/telegram-client-manager.ts — typical pattern
try {
  // ... telegram operation
} catch (error: any) {
  console.error(`Telegram error for account ${accountId}:`, error);
  // Update account status with error info
  await this.updateAccountStatus(accountId, { lastError: error.message });
}
```

### API Error Response Format

Consistent `{ error: string }` JSON shape, optionally with `details`, `requestId`, or `code`:

```typescript
// Standard error
res.status(404).json({ error: "Tenant not found" });

// Validation error (with details)
res.status(400).json({
  error: "Validation error",
  details: [{ path: "email", message: "Invalid email" }],
  requestId,
});

// Auth error (with code)
res.status(401).json({ error: "Invalid credentials", code: "INVALID_PASSWORD" });

// Server error
res.status(500).json({ error: "Internal server error", requestId });
```

---

## Async Patterns

### async/await: Dominant

`async/await` is used in 500+ locations. It is the standard pattern for all asynchronous operations.

```typescript
// server/database-storage.ts:57-59
async getTenant(id: string): Promise<Tenant | undefined> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
  return tenant;
}

// client/src/pages/conversations.tsx:18-28
const handleSelectConversation = async (id: string) => {
  setSelectedId(id);
  try {
    await apiRequest("POST", `/api/conversations/${id}/read`);
    queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
  } catch (error) {
    console.error("Failed to mark conversation as read:", error);
  }
};
```

### .then(): Rare

Only ~5 instances, mostly in worker bootstrap code:

```typescript
// server/workers/vehicle-lookup.worker.ts:370
worker.on("ready", () => { ... }).then((worker) => { ... });

// server/workers/message-send.worker.ts:164
import("../services/websocket-server").then(({ realtimeService }) => { ... });
```

### Promise.all: Used for Concurrent Queries

```typescript
// server/routes/health.ts:104
const [customersCount, notesCount, memoryCount] = await Promise.all([
  db.select({ count: count() }).from(customers),
  db.select({ count: count() }).from(customerNotes),
  db.select({ count: count() }).from(customerMemory),
]);

// server/services/intent-analytics-service.ts:60
const [suggestions, csatRatings, conversions, conversations] = await Promise.all([...]);

// server/services/telegram-client-manager.ts:28
const [dbApiId, dbApiHash] = await Promise.all([...]);
```

---

## Database Patterns

### Select Queries

Drizzle ORM fluent API with destructuring:

```typescript
// Single record (destructure first element)
// server/database-storage.ts:58
const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));

// With ORDER BY
// server/database-storage.ts:278-280
return db.select().from(customerNotes)
  .where(eq(customerNotes.customerId, customerId))
  .orderBy(desc(customerNotes.createdAt));

// With AND/OR conditions
// server/database-storage.ts:239-249
return db.select().from(customers).where(
  and(
    eq(customers.tenantId, tenantId),
    or(
      ilike(customers.name, `%${query}%`),
      ilike(customers.phone, `%${query}%`),
      ilike(customers.email, `%${query}%`)
    )
  )
);

// With aggregation
// server/database-storage.ts:649
const result = await db.select({ count: sql<number>`count(*)` }).from(ragChunks);
```

### Insert / Update

```typescript
// INSERT with .returning()
// server/database-storage.ts:80
const [tenant] = await db.insert(tenants).values(data).returning();

// UPDATE with .set(), .where(), .returning()
// server/database-storage.ts:88
const [tenant] = await db.update(tenants).set(data).where(eq(tenants.id, id)).returning();

// UPDATE with spread and date override
// server/database-storage.ts:264-267
const [customer] = await db.update(customers)
  .set({ ...data, updatedAt: new Date() })
  .where(eq(customers.id, id))
  .returning();
```

### Transactions

Used for multi-table operations that must be atomic:

```typescript
// server/services/customer-data-deletion-service.ts:72-173
await db.transaction(async (tx) => {
  const customerRecord = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  // ... multiple delete operations using tx instead of db
  await tx.delete(messages).where(inArray(messages.conversationId, conversationIds));
  await tx.delete(conversations).where(eq(conversations.customerId, customerId));
  await tx.delete(customers).where(eq(customers.id, customerId));
});
```

### Soft Delete vs Hard Delete

**Hard deletes** are the standard approach. `db.delete()` is used directly:

```typescript
// server/database-storage.ts:289
const result = await db.delete(customerNotes).where(eq(customerNotes.id, id));

// server/database-storage.ts:505
const result = await db.delete(products).where(eq(products.id, id));

// server/database-storage.ts:543
await db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, id));
```

No `deletedAt` soft-delete column exists on tables. Deletion is tracked through the audit log service for compliance.

---

## State Management (Frontend)

### Global State: None

No Redux, Zustand, or MobX. The app relies entirely on React Query for server state and `useState` for local UI state.

### Server State: TanStack React Query

`useQuery` for reads, `useMutation` for writes, `queryClient` for cache management.

**Query pattern** — queryKey mirrors the API path:

```typescript
// client/src/pages/conversations.tsx:35-37
const { data: conversations, isLoading } = useQuery<ConversationWithCustomer[]>({
  queryKey: ["/api/conversations"],
});

// client/src/hooks/use-auth.ts:40-45
const { data: user, isLoading } = useQuery<AuthUser | null>({
  queryKey: ["/api/auth/user"],
  queryFn: fetchUser,
  retry: false,
  staleTime: 1000 * 60 * 5,
});
```

**Mutation pattern** — invalidate related queries on success:

```typescript
// client/src/pages/products.tsx:98-106
const createMutation = useMutation({
  mutationFn: (data: ProductFormValues) => apiRequest("POST", "/api/products", data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    setIsDialogOpen(false);
    form.reset();
  },
});
```

**QueryClient defaults:**

```typescript
// client/src/lib/queryClient.ts:44-57
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: { retry: false },
  },
});
```

### Form State: react-hook-form + Zod

```typescript
// client/src/pages/products.tsx:80-81
const form = useForm<ProductFormValues>({
  resolver: zodResolver(productFormSchema),
});

// client/src/pages/onboarding.tsx:170-180
const productForm = useForm<z.infer<typeof productFormSchema>>({
  resolver: zodResolver(productFormSchema),
  defaultValues: { name: "", sku: "", description: "", price: 0, category: "", inStock: true },
});
```

### Local UI State: useState

```typescript
// client/src/components/chat-interface.tsx:156-161
const [manualMessage, setManualMessage] = useState("");
const [editedSuggestion, setEditedSuggestion] = useState("");
const [isEditing, setIsEditing] = useState(false);
const [showSources, setShowSources] = useState(false);
```

### Context Providers

Used sparingly — only for theme:

```typescript
// client/src/lib/theme-provider.tsx:21-73
const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({ children, defaultTheme = "system", storageKey = "theme", ...props }) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );
  return (
    <ThemeProviderContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
};
```

---

## API Communication

### Client → Server: `apiRequest` Wrapper Around `fetch`

All mutations go through `apiRequest`. All queries use the default `queryFn`.

```typescript
// client/src/lib/queryClient.ts:10-24
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  await throwIfResNotOk(res);
  return res;
}
```

**Usage:**

```typescript
// POST with data
apiRequest("POST", "/api/products", { name: "Widget", price: 100 });

// PATCH with data
apiRequest("PATCH", `/api/customers/${id}`, { name: "Updated" });

// DELETE without data
apiRequest("DELETE", `/api/products/${id}`);

// POST without data (action)
apiRequest("POST", `/api/suggestions/${id}/approve`);
```

### Default Query Function

Queries use the `queryKey` as the fetch URL:

```typescript
// client/src/lib/queryClient.ts:27-42
export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });
    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }
    await throwIfResNotOk(res);
    return await res.json();
  };
```

### Request Format

- Content-Type: `application/json` (when body present)
- Auth: Session cookies (`credentials: "include"`)
- No Bearer tokens — session-based authentication

### Response Handling

- **Success:** `res.json(data)` — returns the resource directly
- **Error:** `res.status(code).json({ error: "message" })` — always includes `error` field

---

## Request Validation

### Zod Schemas in Routes

Request bodies are validated inline with Zod:

```typescript
// server/routes.ts:233-235
const noteSchema = z.object({
  noteText: z.string()
    .min(1, "Note text is required")
    .max(MAX_NOTE_LENGTH, `Note text must be ${MAX_NOTE_LENGTH} characters or less`),
});

// server/routes.ts:1402-1421
const humanDelaySettingsValidation = z.object({
  enabled: z.boolean().optional(),
  delayProfiles: z.record(z.string(), z.object({
    baseMin: z.number().min(0),
    baseMax: z.number().min(0),
    typingSpeed: z.number().min(1),
    jitter: z.number().min(0),
  })).optional(),
  nightMode: z.enum(["AUTO_REPLY", "DELAY", "DISABLE"]).optional(),
}).refine((data) => {
  if (data.minDelayMs !== undefined && data.maxDelayMs !== undefined) {
    return data.minDelayMs <= data.maxDelayMs;
  }
  return true;
}, { message: "minDelayMs must be <= maxDelayMs" });
```

Schema insert types from Drizzle are also used for validation:

```typescript
// server/routes.ts:7
import { insertProductSchema, insertKnowledgeDocSchema, ... } from "@shared/schema";
```

---

## Git

### Commit Message Format

No strict conventional-commits prefix enforced. Messages use imperative mood with a short description. Features use `feat:`, fixes use `Fix:` or `Fix` prefix:

```
feat: Price Engine cascade + podzamenu parser fixes + regression suite
feat: Telegram Personal multi-account + phone auth
Run db migrations in start script
Fix: run migrations inline in Dockerfile CMD
Add database migration step before app start
Fix: gracefully handle missing OpenAI API key on startup
Fix build: externalize all node_modules from server bundle
Add build script for Vite + esbuild
Add Dockerfile for Railway deployment
Add Railway/Nixpacks config for Node.js
Add project files
Initial commit
```

### Branch Naming

Single branch: `main`. No `develop`, `feature-*`, or release branches observed.

### PR Process

No PR process observed — direct pushes to `main`.

---

## Environment Variables

### Naming Convention: `UPPER_SNAKE_CASE` with Descriptive Prefixes

```
AI_INTEGRATIONS_OPENAI_API_KEY     ← prefix: AI_INTEGRATIONS_
AI_INTEGRATIONS_OPENAI_BASE_URL
SESSION_SECRET
INTEGRATION_SECRETS_MASTER_KEY     ← prefix: INTEGRATION_SECRETS_
TELEGRAM_BOT_TOKEN                 ← prefix: TELEGRAM_
TELEGRAM_API_ID
TELEGRAM_API_HASH
TELEGRAM_WEBHOOK_SECRET
WHATSAPP_API_TOKEN                 ← prefix: WHATSAPP_
WHATSAPP_PHONE_ID
RATE_LIMIT_MAX_REQUESTS            ← prefix: RATE_LIMIT_
RATE_LIMIT_AI_MAX_REQUESTS
LOG_LEVEL
NODE_ENV
PORT
DATABASE_URL
PODZAMENU_LOOKUP_SERVICE_URL
AVITO_ENABLED
DROM_ENABLED
SERP_API_KEY
SENTRY_DSN
```

### Where Defined

`.env.example` — template with all variables documented in sections with comments.

### How Accessed in Code

**Centralized config** via `server/config.ts` with Zod validation:

```typescript
// server/config.ts:4-36
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(5000),
  AI_INTEGRATIONS_OPENAI_API_KEY: z.string().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  DATABASE_URL: z.string().optional(),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});

// server/config.ts:42-65
export function validateConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // In development, allow startup with warnings
    if (process.env.NODE_ENV === "development") { ... }
    throw new Error("Invalid configuration");
  }
  config = result.data;
  return config;
}
```

**Direct `process.env` access** is also common for variables not in the config schema:

```typescript
// server/routes.ts:36
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "sk-placeholder",
});

// server/session.ts:20
process.env.SESSION_SECRET!

// server/routes.ts:3125
process.env.TELEGRAM_BOT_TOKEN
```

---

## Logging

### Console-Based with Structured JSON

No centralized logger library (some `pino` usage in WhatsApp adapter). The project uses `console.log` / `console.error` with JSON formatting for structured logs.

**Error logging:**

```typescript
// server/middleware/error-handler.ts:18-27
console.error(JSON.stringify({
  level: "error",
  type: "error",
  requestId,
  message: err.message,
  stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  path: req.path,
  method: req.method,
  timestamp: new Date().toISOString(),
}));
```

**Audit logging:**

```typescript
// server/services/audit-log.ts:52-62
console.log(JSON.stringify({
  level: "info",
  type: "audit",
  action: event.action,
  entityType: event.entityType,
  entityId: event.entityId,
  actor: event.actor,
  actorType: event.actorType,
  requestId: event.requestId,
  timestamp: event.createdAt.toISOString(),
}));
```

**Request logging:**

```typescript
// server/index.ts:57-65
export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
```

---

## Testing

### Framework: Vitest

Test files use `describe` / `it` / `expect` with `vi` for mocks.

```typescript
// server/__tests__/embedding-service.test.ts — typical structure
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("EmbeddingService", () => {
  beforeEach(() => { ... });
  afterEach(() => { vi.restoreAllMocks(); });

  describe("generateEmbedding", () => {
    it("should generate embedding for text", async () => {
      const result = await generateEmbedding("test text");
      expect(result).toBeDefined();
      expect(result.embedding).toHaveLength(3072);
    });
  });
});
```

Integration tests use Supertest:

```typescript
// server/tests/rate-limiter.test.ts — HTTP test pattern
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";

describe("Rate Limiter", () => {
  it("should allow requests under limit", async () => {
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
  });
});
```

Test file locations:
- `server/__tests__/` — integration tests
- `server/tests/` — unit tests
- `server/services/__tests__/` — service-specific tests

---

## Export Patterns

### Server: Named Exports (Dominant)

```typescript
// server/storage.ts:44
export interface IStorage { ... }

// server/services/audit-log.ts:248
export const auditLog = new AuditLogService();

// server/middleware/rbac.ts:5
export const AUTH_MARKER = Symbol("requiresAuth");

// server/config.ts:42
export function validateConfig(): EnvConfig { ... }
```

Route files use `export default`:

```typescript
// server/routes/admin.ts:1909
export default router;
```

### Client: Default Exports for Pages, Named for Components/Utils

```typescript
// Pages — default export
// client/src/pages/conversations.tsx:13
export default function Conversations() { ... }

// client/src/pages/dashboard.tsx:22
export default function Dashboard() { ... }

// Utilities — named export
// client/src/lib/queryClient.ts:10
export async function apiRequest(...) { ... }

// client/src/lib/queryClient.ts:44
export const queryClient = new QueryClient({ ... });

// Hooks — named export
// client/src/hooks/use-auth.ts
export function useAuth() { ... }

// UI components — named export
// client/src/components/ui/button.tsx
export { Button, buttonVariants };
```

---

## CSRF Protection

### Double-Submit Cookie Pattern (csrf-csrf v4)

All state-mutating API calls (POST/PUT/PATCH/DELETE) require a valid CSRF token:

```typescript
// Server: GET /api/csrf-token → generates token, sets httpOnly cookie
app.get("/api/csrf-token", (req, res) => {
  const token = generateCsrfToken(req, res);
  res.json({ token });
});
app.use(csrfProtection); // validates X-Csrf-Token header on mutating requests
```

```typescript
// Client: client/src/lib/queryClient.ts
// Lazy-fetches token on first mutating request, caches in memory
// Sends as X-Csrf-Token header
// Invalidates on 403 INVALID_CSRF_TOKEN response
```

**Exempt paths**: `/webhooks/*`, `/api/max-personal/incoming`, `GET/HEAD/OPTIONS` methods.

---

## Middleware Patterns

### Auth Middleware Chain

Routes use composable middleware for auth, permissions, and subscription checks:

```typescript
// server/routes.ts:54
app.get("/api/tenant",
  requireAuth,
  requirePermission("VIEW_CONVERSATIONS"),
  async (req, res) => { ... }
);

// server/routes.ts:2935
app.post("/api/products",
  requireAuth,
  requireActiveSubscription,
  requireActiveTenant,
  requirePermission("MANAGE_PRODUCTS"),
  async (req, res) => { ... }
);
```

Available middleware:
- `requireAuth` — session authentication
- `requireOperator` — role >= operator
- `requireAdmin` — role >= admin
- `requirePermission("PERM")` — specific permission via RBAC matrix
- `requireActiveSubscription` — billing check
- `requireActiveTenant` — fraud protection check
- Rate limiters: `aiRateLimiter`, `webhookRateLimiter`, `conversationRateLimiter`

---

## Channel Adapter Pattern

### Interface: `ChannelAdapter`

All messaging channels implement the same interface (defined in `server/services/channel-adapter.ts`):

```typescript
interface ChannelAdapter {
  readonly name: ChannelType;
  sendMessage(externalConversationId: string, text: string, options?): Promise<ChannelSendResult>;
  parseIncomingMessage(rawPayload: unknown): ParsedIncomingMessage | null;
  sendTypingStart?(externalConversationId: string): Promise<void>;
  sendTypingStop?(externalConversationId: string): Promise<void>;
  verifyWebhook?(headers, body, secret?): WebhookVerifyResult;
}
```

Registered channels (in `channelRegistry`): `mock`, `telegram`, `whatsapp`, `max`, `whatsapp_personal`, `max_personal`. Feature flag gating per channel type.

### Inbound Message Pipeline

**ALWAYS use `processIncomingMessageFull()` for ALL inbound messages.** Never create alternative pipelines.

```
Channel event → processIncomingMessageFull(tenantId, parsed)
  1. handleIncomingMessage(): find/create customer+conversation, dedup, save, WS broadcast
  2. If AUTO_PARTS_ENABLED: detectVehicleIdFromText() → VIN/FRAME → enqueue lookup
  3. triggerAiSuggestion(): check no pending → Decision Engine → save → WS broadcast
```

### GREEN-API (MAX Personal)

MAX Personal accounts use the [GREEN-API](https://green-api.com) platform (not Playwright). Each account has `idInstance` + `apiTokenInstance` from the GREEN-API dashboard. Multiple accounts per tenant (stored in `max_personal_accounts` table). The `max-green-api-adapter.ts` handles sending; the `max-personal-webhook.ts` route handles incoming events.

---

## Feature Flags Pattern

### Checking Flags

```typescript
// Async (routes/services) — always fresh for tenant-specific
const enabled = await featureFlagService.isEnabled("FLAG_NAME");
const tenantEnabled = await featureFlagService.isEnabled("FLAG_NAME", tenantId);

// Sync helper (after initialization)
const enabled = isFeatureEnabled("FLAG_NAME");
```

### Storage

Flags are stored in `feature_flags.json` (defaults, keyed as `global:<FLAG_NAME>`), seeded to `feature_flags` DB table at startup, and loaded into memory. Partial unique indexes allow per-tenant overrides. See migration `0013_feature_flags_composite_unique.sql`.

### Known Flags

| Flag | Default | Purpose |
|------|---------|---------|
| `AI_SUGGESTIONS_ENABLED` | `true` | Gates `triggerAiSuggestion` |
| `DECISION_ENGINE_ENABLED` | `false` | Advanced decision engine |
| `AI_AUTOSEND_ENABLED` | `false` | Auto-send without approval |
| `HUMAN_DELAY_ENABLED` | `false` | Human-like typing delay |
| `RAG_ENABLED` | `true` | RAG context retrieval |
| `FEW_SHOT_LEARNING` | `true` | Few-shot examples in prompts |
| `TELEGRAM_PERSONAL_CHANNEL_ENABLED` | `true` | MTProto channel |
| `WHATSAPP_PERSONAL_CHANNEL_ENABLED` | `true` | Baileys channel |
| `MAX_PERSONAL_CHANNEL_ENABLED` | `true` | GREEN-API channel |
| `TELEGRAM_CHANNEL_ENABLED` | `false` | Bot API (inactive) |
| `WHATSAPP_CHANNEL_ENABLED` | `false` | Business API (inactive) |
| `MAX_CHANNEL_ENABLED` | `false` | Bot API (inactive) |
| `AUTO_PARTS_ENABLED` | `true` | VIN/FRAME auto-detection in messages |

---

## UI Framework

### shadcn/ui + Tailwind CSS

40+ shadcn/ui components in `client/src/components/ui/`. Configured via `components.json`:

```json
{
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "client/src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui"
  }
}
```

Dark mode via CSS class: `darkMode: ["class"]` in `tailwind.config.ts`.

Icons from `lucide-react`:

```typescript
import { User, ArrowLeft, Search, Package, Edit2, Trash2 } from "lucide-react";
```
