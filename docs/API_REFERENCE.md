# API Reference

## Table of Contents

- [Authentication](#authentication)
- [Middleware](#middleware)
- [RBAC — Role-Based Access Control](#rbac--role-based-access-control)
- [Rate Limiting](#rate-limiting)
- [Endpoints](#endpoints)
  - [Health & Metrics](#health--metrics)
  - [Auth](#auth)
  - [Tenant](#tenant)
  - [Onboarding](#onboarding)
  - [Customers](#customers)
  - [Conversations](#conversations)
  - [AI Suggestions](#ai-suggestions)
  - [Settings](#settings)
  - [Products](#products)
  - [Knowledge Base](#knowledge-base)
  - [Escalations](#escalations)
  - [Analytics & Dashboard](#analytics--dashboard)
  - [CSAT](#csat)
  - [Conversions](#conversions)
  - [Lost Deals](#lost-deals)
  - [Vehicle & Price Lookup](#vehicle--price-lookup)
  - [Message Templates](#message-templates)
  - [Payment Methods](#payment-methods)
  - [Agent Settings](#agent-settings)
  - [Channel Management](#channel-management)
  - [Telegram Personal](#telegram-personal)
  - [WhatsApp Personal](#whatsapp-personal)
  - [Max Personal](#max-personal)
  - [Billing](#billing)
  - [Feature Flags](#feature-flags)
  - [Audit Events](#audit-events)
  - [Admin — RAG & Training](#admin--rag--training)
  - [Platform Admin](#platform-admin)
- [Webhooks](#webhooks)
  - [Telegram Webhook](#telegram-webhook)
  - [WhatsApp Webhook](#whatsapp-webhook)
  - [Max Webhook](#max-webhook)
  - [CryptoBot Webhook](#cryptobot-webhook)
- [WebSocket Events](#websocket-events)
- [Environment Variables](#environment-variables)

---

## Authentication

**Type:** Session-based (Express sessions backed by PostgreSQL via `connect-pg-simple`)

| Property | Value |
|----------|-------|
| Store | PostgreSQL (`sessions` table) |
| TTL | 7 days |
| Cookie flags | `HttpOnly`, `Secure` (production), `SameSite=Lax` |
| Secret | `SESSION_SECRET` env var (min 32 chars) |

### Token Flow

1. **Login / Signup** — on success, a session cookie is set containing `userId`, `tenantId`, and `role`.
2. **Verification** — `requireAuth` middleware reads `req.session.userId` and loads the full user from the database.
3. **Refresh** — sessions auto-extend on activity up to the TTL.
4. **Destruction** — explicit logout destroys the session; otherwise it expires after TTL.

### Password Security

| Rule | Value |
|------|-------|
| Hashing algorithm | bcrypt, 12 salt rounds |
| Minimum length | 8 characters |
| Complexity | Uppercase + lowercase + number required |
| Account lockout | 5 failed attempts → 15-minute lockout |
| Anti-enumeration | Same error message for invalid email and invalid password |

### Development Mode

In non-production environments, the following debug headers are accepted:

- `X-Debug-Role` — override the user role
- `X-Debug-User-Id` — override the authenticated user ID

---

## Middleware

### Global Middleware (applied to all requests)

| Middleware | Description |
|-----------|-------------|
| `express.json()` | Parse JSON request bodies |
| `express.urlencoded()` | Parse URL-encoded bodies |
| `requestContextMiddleware` | Adds `req.requestId` (from `X-Request-Id` header or generated UUID); sets `X-Request-Id` response header |
| `apiRateLimiter` | Global rate limit on `/api/*` — 100 req/min (prod), 500 req/min (dev) |
| Session middleware | Initializes `express-session` with PostgreSQL store |

### Auth & Authorization Middleware

| Middleware | Description |
|-----------|-------------|
| `requireAuth` | Requires authenticated session (`req.session.userId`). Sets `req.userId`, `req.userRole`, `req.user`. |
| `requirePermission(perm)` | Checks user has a specific RBAC permission. Returns 403 if denied. |
| `requireRole(roles)` | Requires one of the specified roles. Shorthands: `requireAdmin`, `requireOperator`, `requireViewer`, `requireOwner`. |
| `requirePlatformAdmin()` | Requires `isPlatformAdmin` flag on user. Returns 403 otherwise. |
| `requirePlatformOwner()` | Requires `isPlatformOwner` flag on user. Returns 403 otherwise. |
| `requireActiveSubscription` | Checks tenant has active subscription or grant. Returns 402 otherwise. |
| `requireActiveTenant` | Checks tenant status is not `restricted`. Returns 403 otherwise. |

### Validation Middleware

| Middleware | Description |
|-----------|-------------|
| `validateBody(schema)` | Validates `req.body` against a Zod schema |
| `validateQuery(schema)` | Validates `req.query` against a Zod schema |
| `validateParams(schema)` | Validates `req.params` against a Zod schema |
| `checkBodySize(maxSize)` | Validates `Content-Length` header does not exceed `maxSize` |

### Webhook Security Middleware

| Middleware | Description |
|-----------|-------------|
| `telegramWebhookSecurity` | Verifies `X-Telegram-Bot-Api-Secret-Token` header |
| `whatsappWebhookSecurity` | Verifies `X-Hub-Signature-256` header (HMAC-SHA256 with `WHATSAPP_APP_SECRET`) |
| `maxWebhookSecurity` | Verifies `X-Max-Bot-Api-Secret` header; optionally verifies `X-Max-Signature` (HMAC-SHA256) |

### Utility Middleware

| Middleware | Description |
|-----------|-------------|
| `auditAdminAction(action)` | Logs platform admin actions to the audit log |

---

## RBAC — Role-Based Access Control

**Roles:** `owner` · `admin` · `operator` · `viewer` · `guest`

| Permission | owner | admin | operator | viewer | guest |
|------------|:-----:|:-----:|:--------:|:------:|:-----:|
| `VIEW_CONVERSATIONS` | ✓ | ✓ | ✓ | ✓ | |
| `MANAGE_CONVERSATIONS` | ✓ | ✓ | ✓ | | |
| `VIEW_CUSTOMERS` | ✓ | ✓ | ✓ | ✓ | |
| `MANAGE_CUSTOMERS` | ✓ | ✓ | ✓ | | |
| `DELETE_CUSTOMER_DATA` | ✓ | ✓ | | | |
| `VIEW_ANALYTICS` | ✓ | ✓ | ✓ | | |
| `MANAGE_PRODUCTS` | ✓ | ✓ | ✓ | | |
| `MANAGE_KNOWLEDGE_BASE` | ✓ | ✓ | ✓ | | |
| `MANAGE_AUTOSEND` | ✓ | ✓ | | | |
| `MANAGE_POLICIES` | ✓ | ✓ | | | |
| `MANAGE_TRAINING` | ✓ | ✓ | | | |
| `EXPORT_TRAINING_DATA` | ✓ | ✓ | | | |
| `MANAGE_CHANNELS` | ✓ | ✓ | | | |
| `MANAGE_TENANT_SETTINGS` | ✓ | ✓ | | | |
| `MANAGE_USERS` | ✓ | | | | |
| `VIEW_AUDIT_LOGS` | ✓ | ✓ | | | |

---

## Rate Limiting

| Limiter | Scope | Production | Development |
|---------|-------|-----------|-------------|
| `apiRateLimiter` | `/api/*` | 100 req/min | 500 req/min |
| `aiRateLimiter` | AI generation endpoints | 20 req/min | 100 req/min |
| `webhookRateLimiter` | Webhook endpoints | 500 req/min | 500 req/min |
| `onboardingRateLimiter` | Onboarding endpoints | 30 req/min | 100 req/min |
| `conversationRateLimiter` | Message sending | 100 req/min | 300 req/min |
| `tenantConversationLimiter` | Per-tenant message sending | 50 req/min (default) | — |
| `tenantAiLimiter` | Per-tenant AI generation | 30 req/min (default) | — |

Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## Endpoints

### CSRF Token

#### GET `/api/csrf-token`

Returns a CSRF token for use in state-mutating requests. Required for all POST/PUT/PATCH/DELETE calls.

- **Auth:** None required
- **Response 200:** `{ "token": "string" }`

The token is cached client-side and sent as `X-Csrf-Token` header on every mutating API request. Invalidated automatically on 403 with `INVALID_CSRF_TOKEN`. Implemented using `csrf-csrf` v4 with double-submit cookie pattern.

**Webhook paths are exempt** from CSRF validation (`/webhooks/*`, `/api/max-personal/incoming`).

---

### Health & Metrics

#### GET `/health`

Returns basic health status.

- **Auth:** None
- **Response 200:**

```json
{ "status": "healthy", "timestamp": "2026-02-20T12:00:00.000Z" }
```

#### GET `/ready`

Detailed readiness check (storage, OpenAI, memory).

- **Auth:** None
- **Response 200:** Readiness object (all checks pass)
- **Response 503:** One or more checks failed

#### GET `/metrics`

System metrics (uptime, memory, customer memory counts).

- **Auth:** None
- **Response 200:** Metrics object

---

### Auth

#### POST `/auth/signup`

Create a new account and tenant (or join existing via invite).

- **Auth:** None
- **Rate Limit:** 3 per hour
- **Request Body:**

```json
{
  "email": "string",
  "password": "string",
  "username": "string (optional)",
  "inviteToken": "string (optional)"
}
```

- **Response 201:**

```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "string",
    "username": "string",
    "role": "owner | admin | operator | viewer",
    "tenantId": "uuid"
  }
}
```

- **Response 200 (anti-enumeration):** `{ "success": false, "message": "string", "hint": "login_or_reset" }`
- **Response 400:** Invalid invite, expired invite, weak password
- **Response 409:** Username already exists

#### POST `/auth/login`

Authenticate with email and password.

- **Auth:** None
- **Rate Limit:** 5 per 15 minutes
- **Request Body:**

```json
{ "email": "string", "password": "string" }
```

- **Response 200:**

```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "string",
    "username": "string",
    "role": "string",
    "tenantId": "uuid"
  }
}
```

- **Response 401:** Invalid credentials
- **Response 423:** Account locked (too many failed attempts)

#### POST `/auth/logout`

Destroy the session.

- **Auth:** None
- **Response 200:** `{ "success": true }`

#### GET `/auth/me`

Get current session state.

- **Auth:** None (reads session if present)
- **Response 200:**

```json
{
  "authenticated": true,
  "user": { "id": "uuid", "email": "string", "username": "string", "role": "string" },
  "tenantId": "uuid",
  "role": "string"
}
```

#### POST `/auth/invite`

Send a team invite.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_USERS")`
- **Request Body:**

```json
{ "email": "string", "role": "admin | operator | viewer" }
```

- **Response 201:**

```json
{ "success": true, "inviteLink": "string", "expiresAt": "ISO datetime" }
```

#### POST `/auth/send-verification`

Send email verification link.

- **Auth:** `requireAuth`
- **Response 200:** `{ "success": true, "message": "string" }`

#### POST `/auth/verify-email`

Verify email with token.

- **Auth:** None
- **Request Body:** `{ "token": "string" }`
- **Response 200:** `{ "success": true, "message": "string" }`
- **Response 400:** Invalid/used/expired token

#### POST `/auth/forgot-password`

Request a password reset.

- **Auth:** None
- **Rate Limit:** 5 per 15 minutes
- **Request Body:** `{ "email": "string" }`
- **Response 200:** Always returns success (anti-enumeration)

#### POST `/auth/reset-password`

Reset password with token.

- **Auth:** None
- **Request Body:** `{ "token": "string", "password": "string" }`
- **Response 200:** `{ "success": true, "message": "string" }`
- **Response 400:** Invalid/used/expired token, weak password

#### GET `/api/auth/user`

Get authenticated user details.

- **Auth:** Session required
- **Response 200:**

```json
{
  "id": "uuid",
  "username": "string",
  "email": "string",
  "role": "string",
  "tenantId": "uuid",
  "authProvider": "local | oidc | mixed",
  "isPlatformAdmin": false,
  "isPlatformOwner": false
}
```

- **Response 401:** Unauthorized

---

### Tenant

#### GET `/api/tenant`

Get current tenant.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:** Tenant object

#### PATCH `/api/tenant`

Update tenant settings.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Request Body:** Partial tenant update
- **Response 200:** Updated tenant object

#### POST `/api/onboarding/setup`

Initial tenant setup (business profile).

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Request Body:**

```json
{
  "name": "string",
  "language": "string",
  "tone": "formal | friendly",
  "addressStyle": "vy | ty",
  "currency": "string",
  "timezone": "string",
  "workingHoursStart": "HH:mm",
  "workingHoursEnd": "HH:mm",
  "autoReplyOutsideHours": true,
  "escalationEmail": "string (optional)",
  "allowDiscounts": false,
  "maxDiscountPercent": 0,
  "deliveryOptions": "string (optional)",
  "returnPolicy": "string (optional)"
}
```

- **Response 200:** Tenant object

---

### Onboarding

#### GET `/api/onboarding/state`

Get current onboarding progress.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:**

```json
{
  "tenantId": "uuid",
  "status": "NOT_STARTED | IN_PROGRESS | DONE",
  "currentStep": "BUSINESS | CHANNELS | PRODUCTS | POLICIES | KB | REVIEW | DONE",
  "completedSteps": ["BUSINESS", "CHANNELS"],
  "answers": {},
  "steps": ["BUSINESS", "CHANNELS", "PRODUCTS", "POLICIES", "KB", "REVIEW", "DONE"],
  "totalSteps": 7
}
```

#### PUT `/api/onboarding/state`

Overwrite onboarding state.

- **Auth:** `requireAuth`
- **Request Body:**

```json
{
  "status": "string (optional)",
  "currentStep": "string (optional)",
  "completedSteps": ["string"] ,
  "answers": {}
}
```

- **Response 200:** Updated state

#### POST `/api/onboarding/complete-step`

Mark a step complete and advance.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Request Body:** `{ "step": "string", "answers": {} }`
- **Response 200:** `{ ...state, "completedStep": "string", "nextStep": "string" }`

#### POST `/api/onboarding/generate-templates`

Generate knowledge base drafts from onboarding answers.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Rate Limit:** `onboardingRateLimiter`
- **Request Body:**

```json
{
  "options": {},
  "answers": {
    "BUSINESS": { ... },
    "POLICIES": { ... }
  }
}
```

- **Response 200:** `{ "drafts": [{ "title": "string", "content": "string", "docType": "string" }] }`

#### POST `/api/onboarding/apply-templates`

Apply generated templates to the knowledge base.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Request Body:** `{ "drafts": [{ "title": "string", "content": "string", "docType": "string" }] }`
- **Response 200:** `{ "success": true, "createdDocs": 3, "ragEnabled": true, "documents": [...] }`

#### GET `/api/onboarding/readiness`

Check if tenant is ready for production.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:**

```json
{
  "score": 85,
  "checks": [
    { "code": "PRODUCTS_PRESENT", "status": "PASS", "message": "string", "weight": 20 }
  ],
  "recommendations": ["string"],
  "threshold": 70,
  "ready": true
}
```

#### GET `/api/onboarding/run-smoke-test/stream`

Run smoke test with SSE progress stream.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Rate Limit:** `onboardingRateLimiter`
- **Response:** `text/event-stream`

```
data: { "type": "progress", ... }
data: { "type": "complete", ... }
data: { "type": "error", ... }
```

#### POST `/api/onboarding/run-smoke-test`

Run smoke test (non-streaming).

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Rate Limit:** `onboardingRateLimiter`
- **Response 200:**

```json
{
  "results": [...],
  "passedCount": 3,
  "totalCount": 5,
  "check": { ... },
  "recommendations": [...]
}
```

---

### Customers

#### GET `/api/customers`

List customers for the tenant.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CUSTOMERS")`
- **Query:** `?search=string` (optional)
- **Response 200:** `Customer[]`

#### GET `/api/customers/:id`

Get a single customer.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CUSTOMERS")`
- **Response 200:** Customer object
- **Response 404:** Not found

#### PATCH `/api/customers/:id`

Update customer profile.

- **Auth:** `requireAuth`, `requireOperator`
- **Request Body:**

```json
{
  "name": "string (optional)",
  "email": "string | null (optional)",
  "phone": "string | null (optional)",
  "tags": ["string"] 
}
```

- **Response 200:** Updated customer

#### GET `/api/customers/:id/notes`

List notes for a customer.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CUSTOMERS")`
- **Response 200:** `CustomerNote[]`

#### POST `/api/customers/:id/notes`

Add a note to a customer.

- **Auth:** `requireAuth`, `requireOperator`
- **Request Body:** `{ "noteText": "string (max 2048)" }`
- **Response 201:** Created note

#### DELETE `/api/customers/:id/notes/:noteId`

Delete a customer note. Only the author or an admin can delete.

- **Auth:** `requireAuth`, `requireOperator`
- **Response 200:** `{ "success": true }`

#### DELETE `/api/customers/:id/data`

GDPR data deletion.

- **Auth:** `requireAuth`, `requirePermission("DELETE_CUSTOMER_DATA")`
- **Response 200:** `{ "deletedMessages": 5, "deletedConversations": 2, ... }`

#### GET `/api/customers/:id/memory`

Get customer memory (preferences, topics, summary).

- **Auth:** `requireAuth`, `requirePermission("VIEW_CUSTOMERS")`
- **Response 200:**

```json
{
  "customerId": "uuid",
  "tenantId": "uuid",
  "preferences": {},
  "frequentTopics": {},
  "lastSummaryText": "string | null"
}
```

#### PATCH `/api/customers/:id/memory`

Update customer memory.

- **Auth:** `requireAuth`, `requireOperator`
- **Request Body:** `{ "preferences": {}, "lastSummaryText": "string" }`
- **Response 200:** Updated memory

#### POST `/api/customers/:id/memory/rebuild-summary`

Rebuild the AI-generated customer summary from conversation history.

- **Auth:** `requireAuth`, `requireAdmin`
- **Response 200:** `{ "success": true, "summary": "string", "memory": { ... } }`

---

### Conversations

#### GET `/api/conversations`

List conversations.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Query:** `?status=active` (optional)
- **Response 200:** `ConversationWithCustomer[]` — each item now includes `channel?: Channel` (left-joined)

#### GET `/api/conversations/channel-counts`

Unread message counts grouped by channel family, for rendering filter tabs.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:**
```json
{
  "all": 12,
  "telegram": 5,
  "max": 3,
  "whatsapp": 4
}
```
  Only keys for channel families that have at least one channel record in the tenant are included (`telegram`/`max`/`whatsapp`). `all` is always present.

#### GET `/api/conversations/:id`

Get conversation detail with messages.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:** `ConversationDetail` (conversation + customer + messages + current suggestion)
- **Response 403:** Tenant mismatch

#### PATCH `/api/conversations/:id`

Update conversation status or mode.

- **Auth:** `requireAuth`, `requireOperator`
- **Request Body:**

```json
{
  "status": "active | waiting_customer | waiting_operator | escalated | resolved",
  "mode": "learning | semi-auto | auto"
}
```

- **Response 200:** Updated conversation

#### POST `/api/conversations/:id/read`

Mark conversation as read.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:** `{ "success": true }`

#### POST `/api/conversations/:id/messages`

Send a message in a conversation. Delivers via the appropriate channel adapter.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CONVERSATIONS")`
- **Rate Limit:** `conversationRateLimiter`, `tenantConversationLimiter`
- **Request Body:**

```json
{
  "content": "string",
  "role": "owner | customer | assistant (optional)"
}
```

- **Response 201:** Created message

---

### AI Suggestions

#### POST `/api/conversations/:id/generate-suggestion`

Generate an AI reply suggestion for the latest customer message.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Rate Limit:** `aiRateLimiter`, `tenantAiLimiter`
- **Response 201:**

```json
{
  "suggestionId": "uuid",
  "replyText": "string",
  "intent": "price | availability | shipping | return | discount | complaint | other | photo_request | price_objection | ready_to_buy | needs_manual_quote | invalid_vin | marking_provided | payment_blocked | warranty_question | want_visit | what_included | mileage_preference | vehicle_id_request | gearbox_tag_request | gearbox_tag_retry | null",
  "confidence": {
    "total": 0.85,
    "similarity": 0.90,
    "intent": 0.80,
    "selfCheck": 0.85
  },
  "decision": "AUTO_SEND | NEED_APPROVAL | ESCALATE",
  "explanations": ["string"],
  "penalties": [{ "code": "string", "message": "string", "value": -0.25 }],
  "missingFields": ["string"],
  "usedSources": [{ "type": "product | doc", "id": "uuid", "title": "string", "quote": "string", "similarity": 0.92 }],
  "sourceConflicts": false,
  "autosendEligible": false,
  "autosendBlockReason": "FLAG_OFF | SETTING_OFF | INTENT_NOT_ALLOWED | null",
  "selfCheckNeedHandoff": false,
  "selfCheckReasons": []
}
```

#### POST `/api/suggestions/:id/approve`

Approve an AI suggestion and send it.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CONVERSATIONS")`
- **Response 200:**

```json
{
  "suggestion": { ... },
  "message": { ... },
  "delayResult": { ... },
  "scheduledJob": { ... },
  "sentImmediately": true,
  "channelSendResult": { ... }
}
```

#### POST `/api/suggestions/:id/edit`

Edit a suggestion before sending.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CONVERSATIONS")`
- **Request Body:** `{ "editedText": "string" }`
- **Response 200:** Same shape as approve

#### POST `/api/suggestions/:id/reject`

Reject an AI suggestion.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CONVERSATIONS")`
- **Request Body:** `{ "reason": "string (optional)" }`
- **Response 200:** `{ "success": true }`

#### POST `/api/suggestions/:id/escalate`

Escalate a suggestion to a human operator.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CONVERSATIONS")`
- **Response 200:** `{ "escalation": { ... } }`

---

### Settings

#### GET `/api/settings/decision`

Get decision engine thresholds.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:**

```json
{
  "tenantId": "uuid",
  "tAuto": 0.80,
  "tEscalate": 0.40,
  "autosendAllowed": false,
  "intentsAutosendAllowed": ["price", "availability", "shipping", "other"],
  "intentsForceHandoff": ["discount", "complaint", "photo_request", "needs_manual_quote", "want_visit"]
}
```

#### PATCH `/api/settings/decision`

Update decision engine settings.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_AUTOSEND")`
- **Request Body:**

```json
{
  "tAuto": 0.85,
  "tEscalate": 0.35,
  "autosendAllowed": true,
  "intentsAutosendAllowed": ["price", "availability"],
  "intentsForceHandoff": ["complaint"]
}
```

- **Response 200:** Updated settings
- **Response 409:** Readiness score too low for autosend

#### GET `/api/settings/human-delay`

Get human delay simulation settings.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:** `HumanDelaySettings`

#### PATCH `/api/settings/human-delay`

Update human delay settings.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_AUTOSEND")`
- **Request Body:**

```json
{
  "enabled": true,
  "delayProfiles": {
    "SHORT":  { "baseMin": 2000, "baseMax": 4000, "typingSpeed": 40, "jitter": 500 },
    "MEDIUM": { "baseMin": 4000, "baseMax": 8000, "typingSpeed": 35, "jitter": 1000 },
    "LONG":   { "baseMin": 8000, "baseMax": 15000, "typingSpeed": 30, "jitter": 2000 }
  },
  "nightMode": "AUTO_REPLY | DELAY | DISABLE",
  "nightDelayMultiplier": 3.0,
  "nightAutoReplyText": "string",
  "minDelayMs": 3000,
  "maxDelayMs": 120000,
  "typingIndicatorEnabled": true
}
```

- **Response 200:** Updated settings

---

### Products

#### GET `/api/products`

- **Auth:** `requireAuth`, `requirePermission("MANAGE_PRODUCTS")`
- **Response 200:** `Product[]`

#### POST `/api/products`

- **Auth:** `requireAuth`, `requirePermission("MANAGE_PRODUCTS")`
- **Request Body:**

```json
{
  "name": "string",
  "description": "string (optional)",
  "sku": "string (optional)",
  "price": 1500.00,
  "currency": "RUB",
  "inStock": true,
  "category": "string (optional)",
  "imageUrl": "string (optional)",
  "metadata": {}
}
```

- **Response 201:** Created product

#### PATCH `/api/products/:id`

- **Auth:** `requireAuth`, `requirePermission("MANAGE_PRODUCTS")`
- **Request Body:** Partial product update
- **Response 200:** Updated product

#### DELETE `/api/products/:id`

- **Auth:** `requireAuth`, `requirePermission("MANAGE_PRODUCTS")`
- **Response 204:** No content

#### POST `/api/products/import`

Bulk import products.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_PRODUCTS")`
- **Request Body:**

```json
{
  "products": [
    { "name": "string", "sku": "string", "description": "string", "price": 100, "category": "string", "inStock": true, "stockQuantity": 10 }
  ]
}
```

- **Response 200:** `{ "count": 5, "message": "string" }`

---

### Knowledge Base

#### GET `/api/knowledge-docs`

- **Auth:** `requireAuth`, `requirePermission("MANAGE_KNOWLEDGE_BASE")`
- **Response 200:** `KnowledgeDoc[]`

#### POST `/api/knowledge-docs`

- **Auth:** `requireAuth`, `requirePermission("MANAGE_KNOWLEDGE_BASE")`
- **Request Body:**

```json
{
  "title": "string",
  "content": "string (max 50000)",
  "category": "faq | policy | shipping | returns | general (optional)",
  "tags": ["string"]
}
```

- **Response 201:** Created document

#### PATCH `/api/knowledge-docs/:id`

- **Auth:** `requireAuth`, `requirePermission("MANAGE_KNOWLEDGE_BASE")`
- **Request Body:** Partial document update
- **Response 200:** Updated document

#### DELETE `/api/knowledge-docs/:id`

- **Auth:** `requireAuth`, `requirePermission("MANAGE_KNOWLEDGE_BASE")`
- **Response 204:** No content

---

### Escalations

#### GET `/api/escalations`

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Query:** `?status=recent | pending`
- **Response 200:** `EscalationEvent[]`

#### PATCH `/api/escalations/:id`

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CONVERSATIONS")`
- **Request Body:** `{ "status": "pending | handled | dismissed" }`
- **Response 200:** Updated escalation

---

### Analytics & Dashboard

#### GET `/api/dashboard/metrics`

- **Auth:** `requireAuth`, `requirePermission("VIEW_ANALYTICS")`
- **Response 200:**

```json
{
  "totalConversations": 120,
  "activeConversations": 15,
  "escalatedConversations": 3,
  "resolvedToday": 8,
  "avgResponseTime": 45000,
  "aiAccuracy": 0.87,
  "pendingSuggestions": 2,
  "productsCount": 50,
  "knowledgeDocsCount": 12
}
```

#### GET `/api/analytics/intents`

Intent performance analytics.

- **Auth:** `requireAuth`, `requirePermission("VIEW_ANALYTICS")`
- **Response 200:**

```json
{
  "intents": [
    {
      "intent": "price",
      "totalConversations": 40,
      "autosendRate": 0.75,
      "escalationRate": 0.05,
      "avgConfidence": 0.88,
      "csatAvg": 4.2,
      "conversionRate": 0.30,
      "lostDealRate": 0.10,
      "status": "good | warning | critical",
      "recommendation": "string"
    }
  ],
  "totalConversations": 120,
  "totalIntents": 17
}
```

#### GET `/api/analytics/lost-deals`

Lost deal analytics.

- **Auth:** `requireAuth`, `requirePermission("VIEW_ANALYTICS")`
- **Response 200:**

```json
{
  "totalLostDeals": 15,
  "byReason": [{ "reason": "PRICE_TOO_HIGH", "count": 8, "percentage": 53.3 }],
  "byIntent": [{ "intent": "price", "count": 6, "percentage": 40.0 }],
  "timeline": [{ "date": "2026-02-20", "count": 2 }]
}
```

---

### CSAT

#### POST `/api/conversations/:id/csat`

Submit a CSAT rating.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CONVERSATIONS")`
- **Request Body:** `{ "rating": 4, "comment": "string (optional)" }`
- **Validation:** `rating` must be integer 1–5
- **Response 200:** `{ "success": true }`

#### GET `/api/conversations/:id/csat`

Get CSAT for a conversation.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:** `{ "submitted": true, "rating": 4 }`

#### GET `/api/analytics/csat`

Aggregate CSAT analytics.

- **Auth:** `requireAuth`, `requirePermission("VIEW_ANALYTICS")`
- **Response 200:**

```json
{
  "avgScore": 4.1,
  "totalRatings": 85,
  "distribution": [{ "rating": 5, "count": 40, "percentage": 47.0 }],
  "byIntent": [{ "key": "price", "avgScore": 4.3, "count": 30 }],
  "byDecision": [{ "key": "AUTO_SEND", "avgScore": 4.5, "count": 50 }],
  "problemIntents": [{ "key": "complaint", "avgScore": 2.8, "count": 10 }]
}
```

---

### Conversions

#### POST `/api/conversations/:id/conversion`

Record a conversion (sale).

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CONVERSATIONS")`
- **Request Body:** `{ "amount": 15000, "currency": "RUB (optional)" }`
- **Validation:** `amount` must be positive
- **Response 200:** `{ "success": true, "conversion": { ... } }`

#### GET `/api/conversations/:id/conversion`

Get conversion data for a conversation.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:** `{ "hasConversion": true, "amount": 15000, "currency": "RUB" }`

#### GET `/api/analytics/conversion`

Aggregate conversion analytics.

- **Auth:** `requireAuth`, `requirePermission("VIEW_ANALYTICS")`
- **Response 200:**

```json
{
  "conversionRate": 25.0,
  "totalConversations": 120,
  "totalConversions": 30,
  "totalRevenue": 450000,
  "avgAmount": 15000,
  "currency": "RUB",
  "byIntent": [{ "key": "price", "count": 15, "totalRevenue": 225000, "avgAmount": 15000 }],
  "byDecision": [{ "key": "AUTO_SEND", "count": 20, "totalRevenue": 300000, "avgAmount": 15000 }],
  "topIntentsByRevenue": [],
  "avgTimeToConversion": 2.5
}
```

---

### Lost Deals

#### POST `/api/lost-deals`

Record a lost deal.

- **Auth:** `requireAuth`, `requirePermission("VIEW_ANALYTICS")`
- **Request Body:**

```json
{
  "conversationId": "uuid",
  "reason": "NO_STOCK | PRICE_TOO_HIGH | ESCALATED_NO_RESPONSE | AI_ERROR | OTHER",
  "notes": "string (optional)"
}
```

- **Response 201:** Lost deal object
- **Response 409:** Already recorded for this conversation

---

### Vehicle & Price Lookup

#### POST `/api/conversations/:id/vehicle-lookup-case`

Start a vehicle lookup by VIN or FRAME number.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CONVERSATIONS")`
- **Request Body:** `{ "idType": "VIN | FRAME", "value": "string" }`
- **Response 201:** `{ "caseId": "uuid" }`

#### GET `/api/price-settings`

Get price display settings. Data is stored inside `tenants.templates.priceSettings` JSONB — there is no dedicated `price_settings` table.

- **Auth:** `requireAuth`
- **Response 200:**

```json
{
  "marginPct": -25,
  "roundTo": 100,
  "priceNote": "string",
  "showMarketPrice": false
}
```

#### PUT `/api/price-settings`

Update price display settings (stored inside `tenants.templates.priceSettings` JSONB).

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Request Body:**

```json
{
  "marginPct": -25,
  "roundTo": 1 | 10 | 100 | 1000,
  "priceNote": "string (max 200)",
  "showMarketPrice": false
}
```

- **Validation:** `marginPct` range: -50 to 50; `roundTo` must be one of 1, 10, 100, 1000
- **Response 200:** Updated settings object

#### POST `/api/conversations/:id/price-lookup`

Trigger a price lookup for the latest vehicle in the conversation.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CONVERSATIONS")`
- **Request Body:** `{ "oem": "string (optional)" }`
- **Response 200:** `{ "jobId": "uuid", "oem": "string" }`

#### GET `/api/conversations/:id/price-history`

Get price history snapshots for a conversation.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CONVERSATIONS")`
- **Response 200:** `{ "snapshots": [...], "oem": "string | null" }`

#### VIN-OCR Image Analysis Pipeline

When an inbound message contains image attachments, `processIncomingMessageFull()` calls `analyzeImages()` from `server/services/vin-ocr.service.ts` using **GPT-4o vision** before any text-based detection:

1. **Image classification** (`analyzeImage()`) — GPT-4o classifies each attachment as one of three types:
   - `gearbox_tag` — a transmission label/шильдик. Extracts the OEM code (e.g. `W5MBB`, `F4A42`). Code is passed directly to `enqueuePriceLookup`.
   - `registration_doc` — Russian vehicle registration certificate. Extracts `vin`, `frame`, `make`, `model`. VIN or FRAME is passed to the vehicle lookup pipeline.
   - `unknown` — unrecognised image; falls through to text detection.

2. **VIN checksum validation** — after extracting a VIN, `isValidVinChecksum()` is called. On failure, two correction strategies run in sequence:
   - **Strategy 1** (`tryAutoCorrectVin()`) — single-character substitution over visually similar pairs (`S↔5`, `B↔8`, `Z↔2`, `G↔6`, `I↔1`, `O↔0`).
   - **Strategy 2** (`retryVinReadWithGpt()`) — sends the image a second time with a targeted GPT-4o prompt listing the misread character, asking GPT to re-read character-by-character. Strategy 1 is also applied to GPT's new attempt.

3. **Model**: `gpt-4o` (vision). No `web_search` tool. Returns JSON directly in message content.

**Key file:** `server/services/vin-ocr.service.ts`

**Exported functions:**
- `analyzeImages(attachments)` → `ImageAnalysisResult` — preferred entry point; iterates attachments and returns the first non-unknown result with VIN validation applied.
- `analyzeImage(attachment)` → `ImageAnalysisResult` — single-image analysis without VIN correction.
- `extractVinFromImages(attachments)` → `string | null` — legacy VIN-only extractor; applies the same two-strategy correction pipeline.

---

#### Vehicle Lookup Worker Pipeline

The `POST /api/conversations/:id/vehicle-lookup-case` endpoint enqueues a BullMQ job processed by `server/workers/vehicle-lookup.worker.ts`. The worker follows this pipeline:

1. **Parallel lookup** — Podzamenu and PartsAPI are called **simultaneously** via `Promise.all` to minimise latency (worst-case ~75 s vs ~285 s sequential).
   - **Podzamenu** (`lookupByVehicleId`) — returns OEM code, gearbox model, factory code, OEM candidates, and `vehicleMeta` (make/model/year). Timeout 60 s, 3 retries.
   - **PartsAPI** (`decodeVinPartsApiWithRetry`) — VIN **and FRAME** numbers are both supported (FRAME guard removed). Returns make, model, year, engine, kpp, driveType, gearboxType, displacement. Timeout 15 s, 3 retries. Failure is non-fatal (returns `null`, pipeline continues).
2. **vehicleContext assembly** — PartsAPI fields are preferred; Podzamenu `vehicleMeta` (make/model/year) is used as fallback when PartsAPI returns no data. Critical for FRAME lookups.
3. **gearboxType parsing** — extracted from PartsAPI `rawData.modifikaciya` field (e.g. `"5FM/T"` → `MT`, `"CVT"` → `CVT`). When regex parsing produces no result, `extractVehicleContextFromRawData()` (`server/services/vehicle-data-extractor.ts`) is called as a GPT-4o-mini fallback — it scans ALL raw PartsAPI fields and returns `{ driveType, gearboxType }`.
4. **Price lookup routing** — high-confidence OEM → `enqueuePriceLookup`; MODEL_ONLY → fallback search; no OEM → `tryFallbackPriceLookup`.

#### Price Lookup Worker Pipeline

The `POST /api/conversations/:id/price-lookup` endpoint enqueues a BullMQ job processed by `server/workers/price-lookup.worker.ts`. The worker follows this pipeline for OEM-based lookups:

1. **Global cache check** — `storage.getGlobalPriceSnapshot(oem)`. If a valid (non-expired) snapshot exists for any source, it is reused without new API calls.
2. **Transmission identification** — `identifyTransmissionByOem(oem, vehicleContext)` via gpt-4o-mini. **Skipped** only when `oemModelHint` is a real transmission model code (e.g. `W5MBB`). Generic type strings (`CVT`, `AT`, `MT`, `АКПП`, etc.) are **rejected** by `isValidTransmissionModel` so GPT always runs for those and identifies the real model (e.g. `JF016E`, `RE0F11A`).
3. **Web search** — `searchUsedTransmissionPrice(...)` via **gpt-4.1 + web_search** (OpenAI Responses API). Returns source `openai_web_search` with real listings, or `not_found` when fewer than 2 valid listings are found.
4. **AI estimate fallback** — when step 3 returns `not_found`, `estimatePriceFromAI(...)` is called using **gpt-4.1 + web_search** (same Responses API). GPT searches drom.ru and avito.ru in real time and returns a `{priceMin, priceMax}` JSON estimate. The result is saved as an `ai_estimate` snapshot with a **2-hour TTL** so stale estimates expire quickly.

**Gearbox label mapping** (`gearboxType` → Russian label used in search queries and replies):

| `gearboxType` | Label |
|---|---|
| `MT` | МКПП |
| `CVT` | вариатор |
| `AT` | АКПП |
| `null` / unknown | КПП *(neutral — avoids wrong АКПП assumption)* |

**Price snapshot sources and cache TTLs:**

| `source` | Description | TTL |
|---|---|---|
| `openai_web_search` | Real listings found via gpt-4.1 web search | 7 days |
| `not_found` | Web search returned < 2 listings, no AI estimate | 24 hours |
| `ai_estimate` | AI estimate via gpt-4.1 + web search (fallback) | **2 hours** |

---

### Message Templates

Tenant-scoped message templates used by the price-lookup worker and managed in the **Шаблоны** tab of the Settings page (`/settings`). Templates support `{{variable_name}}` substitution.

**UI:** `client/src/pages/settings.tsx` → `TemplatesTab` component
- `GET /api/templates` — fetched on tab mount via `useQuery({ queryKey: ["/api/templates"] })`
- `POST /api/templates` — create via Sheet form
- `PATCH /api/templates/:id` — edit name/content or toggle `isActive` switch
- `DELETE /api/templates/:id` — delete with AlertDialog confirm

**Template types:**

| Type | Variables available |
|------|---------------------|
| `price_result` | `{{transmission_model}}`, `{{oem}}`, `{{min_price}}`, `{{max_price}}`, `{{avg_price}}`, `{{origin}}`, `{{car_brand}}`, `{{date}}` |
| `payment_options` | none (free-form) |
| `tag_request` | none (free-form) |
| `not_found` | none (free-form) |

#### GET `/api/templates`

List all message templates for the authenticated tenant.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:**

```json
[
  {
    "id": "uuid",
    "tenantId": "uuid",
    "type": "price_result",
    "name": "Результат поиска цены",
    "content": "Нашёл для вас контрактную {{transmission_model}} (OEM: {{oem}}).\n\n💰 Стоимость: {{min_price}} — {{max_price}} ₽\n📊 Средняя цена: {{avg_price}} ₽\n\nЕсть в наличии. Готов ответить на все вопросы!",
    "isActive": true,
    "order": 0,
    "createdAt": "2026-02-21T10:00:00.000Z",
    "updatedAt": "2026-02-21T10:00:00.000Z"
  }
]
```

#### POST `/api/templates`

Create a message template.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Request Body:**

```json
{
  "type": "price_result | price_options | payment_options | tag_request | not_found",
  "name": "string (1–255 chars)",
  "content": "string (min 1)",
  "isActive": true,
  "order": 0
}
```

- **Response 201:** Created template object

#### POST `/api/templates/preview`

Render a template with sample variable values. Accepts either a saved template ID or raw content.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Request Body (option A — by ID):** `{ "templateId": "uuid" }`
- **Request Body (option B — inline):** `{ "content": "Ваш запрос: {{transmission_model}}" }`
- **Response 200:**

```json
{
  "rendered": "Ваш запрос: АКПП U760E"
}
```

Sample values used: `transmission_model=АКПП U760E`, `oem=3530060360`, `min_price=45 000`, `max_price=65 000`, `avg_price=55 000`, `origin=Япония`, `car_brand=Toyota Camry`, `date=<today>`.

#### PATCH `/api/templates/:id`

Update a template. Only fields provided are changed.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Request Body:**

```json
{
  "name": "string (optional)",
  "content": "string (optional)",
  "isActive": true,
  "order": 0
}
```

- **Response 200:** Updated template object
- **Response 404:** Template not found or does not belong to tenant

#### DELETE `/api/templates/:id`

Delete a template permanently.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Response 200:** `{ "success": true }`
- **Response 404:** Template not found or does not belong to tenant

---

### Payment Methods

Tenant-scoped payment options managed in the **Оплата** tab of the Settings page (`/settings`) and shown as a second AI suggestion alongside price replies. When any active payment methods exist, the price-lookup worker automatically creates a supplementary suggestion formatted as:

**UI:** `client/src/pages/settings.tsx` → `PaymentMethodsTab` component
- `GET /api/payment-methods` — fetched on tab mount via `useQuery({ queryKey: ["/api/payment-methods"] })`
- `POST /api/payment-methods` — create via Dialog form
- `PATCH /api/payment-methods/:id` — edit title/description or toggle `isActive` switch
- `PATCH /api/payment-methods/reorder` — reorder via ChevronUp/ChevronDown buttons
- `DELETE /api/payment-methods/:id` — delete with AlertDialog confirm

```
💳 Варианты оплаты:

• Наличные при получении
• Перевод на карту
  Сбербанк / Т-Банк / ВТБ
```

#### GET `/api/payment-methods`

List all payment methods for the authenticated tenant, ordered by `order` then `createdAt`.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:**

```json
[
  {
    "id": "uuid",
    "tenantId": "uuid",
    "title": "Наличные при получении",
    "description": null,
    "isActive": true,
    "order": 0,
    "createdAt": "2026-02-21T10:00:00.000Z"
  }
]
```

#### POST `/api/payment-methods`

Create a payment method.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Request Body:**

```json
{
  "title": "string (1–255 chars)",
  "description": "string (optional)",
  "isActive": true,
  "order": 0
}
```

- **Response 201:** Created payment method object

#### PATCH `/api/payment-methods/reorder`

Bulk-update the `order` field for multiple payment methods in one request.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Request Body:** `[{ "id": "uuid", "order": 0 }, { "id": "uuid", "order": 1 }]` (min 1 item)
- **Response 200:** `{ "success": true }`

#### PATCH `/api/payment-methods/:id`

Update a payment method. Only fields provided are changed.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Request Body:**

```json
{
  "title": "string (optional)",
  "description": "string | null (optional)",
  "isActive": true,
  "order": 0
}
```

- **Response 200:** Updated payment method object
- **Response 404:** Payment method not found or does not belong to tenant

#### DELETE `/api/payment-methods/:id`

Delete a payment method permanently.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Response 200:** `{ "success": true }`
- **Response 404:** Payment method not found or does not belong to tenant

---

### Agent Settings

Per-tenant AI agent configuration. Controls company identity, response scripts, and the AI system prompt. One settings row per tenant; the row is created on the first PUT call.

All endpoints are in `server/routes/tenant-config.routes.ts`.

#### GET `/api/agent-settings`

Retrieve the current tenant's agent settings.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Response 200 (settings exist):**

```json
{
  "id": "uuid",
  "tenantId": "uuid",
  "companyName": "Название компании",
  "specialization": "Чем занимается",
  "warehouseCity": "Москва",
  "warrantyMonths": 12,
  "warrantyKm": 20000,
  "installDays": 14,
  "qrDiscountPercent": 3,
  "systemPrompt": null,
  "objectionPayment": "Мы работаем только по предоплате...",
  "objectionOnline": "Оплата через наш сайт полностью безопасна...",
  "closingScript": "Оформляем заказ?",
  "customFacts": {},
  "updatedAt": "2026-02-21T12:00:00.000Z"
}
```

- **Response 200 (no settings yet):** `{}`

#### PUT `/api/agent-settings`

Create or update agent settings for the current tenant. All body fields are optional — only provided fields are written.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Request body (all fields optional):**

```json
{
  "companyName": "string | null",
  "specialization": "string | null",
  "warehouseCity": "string | null",
  "warrantyMonths": "integer | null",
  "warrantyKm": "integer | null",
  "installDays": "integer | null",
  "qrDiscountPercent": "0–100 | null",
  "systemPrompt": "string (max 10 000 chars) | null",
  "objectionPayment": "string (max 2 000 chars) | null",
  "objectionOnline": "string (max 2 000 chars) | null",
  "closingScript": "string (max 2 000 chars) | null",
  "customFacts": "object | null",
  "mileageLow": "integer | null",
  "mileageMid": "integer | null",
  "mileageHigh": "integer | null"
}
```

- **Response 200:** Updated `TenantAgentSettings` object
- **Response 400:** Validation error

**How the settings affect the AI agent:**

The Decision Engine reads `tenant_agent_settings` at the start of every `generateWithDecisionEngine()` call. The values are used to build the system prompt via `buildSystemPrompt(tenant, agentSettings)`:

| Field | Usage |
|-------|-------|
| `systemPrompt` | If set, replaces `DEFAULT_SYSTEM_PROMPT` as the base instructions |
| `companyName` | Injected into `ДАННЫЕ КОМПАНИИ` block (falls back to `tenant.name`) |
| `specialization` | Added to company facts block |
| `warehouseCity` | Added to company facts block |
| `warrantyMonths` / `warrantyKm` | Added to company facts block |
| `installDays` | Added to company facts block |
| `qrDiscountPercent` | Added to company facts block |
| `objectionPayment` | Added to `СКРИПТЫ ОТВЕТОВ` block |
| `objectionOnline` | Added to `СКРИПТЫ ОТВЕТОВ` block |
| `closingScript` | Added to `СКРИПТЫ ОТВЕТОВ` block |
| `mileageLow` | Mileage threshold for quality tier in `price_options` two-step dialog (default 60 000 km) |
| `mileageMid` | Mileage threshold for mid/budget tier split in `price_options` dialog (default 90 000 km) |
| `mileageHigh` | Informational upper bound for budget tier display (default 90 000 km) |

---

### Channel Management

#### GET `/api/channels/status`

Get all channel connection statuses.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:**

```json
[
  {
    "channel": "telegram",
    "enabled": true,
    "connected": true,
    "lastError": null,
    "botInfo": { "username": "my_bot" },
    "accountCount": 2
  }
]
```

#### GET `/api/channels/feature-flags`

Get channel feature flags.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:**

```json
{
  "MAX_CHANNEL_ENABLED": false,
  "MAX_PERSONAL_CHANNEL_ENABLED": true,
  "TELEGRAM_CHANNEL_ENABLED": false,
  "TELEGRAM_PERSONAL_CHANNEL_ENABLED": true,
  "WHATSAPP_CHANNEL_ENABLED": false,
  "WHATSAPP_PERSONAL_CHANNEL_ENABLED": true,
  "AI_SUGGESTIONS_ENABLED": true,
  "DECISION_ENGINE_ENABLED": false,
  "AI_AUTOSEND_ENABLED": false,
  "HUMAN_DELAY_ENABLED": false,
  "RAG_ENABLED": true,
  "FEW_SHOT_LEARNING": true,
  "AUTO_PARTS_ENABLED": false
}
```

> **`AUTO_PARTS_ENABLED`** — gates the VIN/FRAME auto-detection pipeline in `inbound-message-handler.ts`. When `false`, incoming messages skip vehicle lookup and go directly to AI suggestion generation. Not currently in `feature_flags.json` defaults (treated as `false` when absent).

#### POST `/api/channels/:channel/toggle`

Enable or disable a channel.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`, `requireActiveSubscription`, `requireActiveTenant`
- **Params:** `channel` = `max` | `max_personal` | `telegram` | `telegram_personal` | `whatsapp` | `whatsapp_personal`
- **Request Body:** `{ "enabled": true }`
- **Response 200:** `{ "success": true, "channel": "telegram", "enabled": true }`

#### POST `/api/channels/:channel/config`

Set channel credentials.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`, `requireActiveSubscription`, `requireActiveTenant`
- **Request Body:**

```json
{
  "token": "string",
  "webhookSecret": "string",
  "accessToken": "string",
  "phoneNumberId": "string",
  "verifyToken": "string",
  "appSecret": "string"
}
```

- **Response 200:** `{ "success": true, "message": "string" }`

#### POST `/api/channels/:channel/test`

Test channel connection.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Request Body:** `{ "token": "string (optional)" }`
- **Response 200:** Connection test result

---

### Telegram Personal

#### GET `/api/telegram-personal/accounts`

List all Telegram personal accounts for the tenant.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:**

```json
{
  "accounts": [{
    "id": "uuid",
    "phoneNumber": "string",
    "firstName": "string",
    "lastName": "string",
    "username": "string",
    "userId": "string",
    "status": "pending | awaiting_code | awaiting_2fa | active | error | disconnected",
    "authMethod": "qr | phone",
    "isEnabled": true,
    "isConnected": true,
    "createdAt": "ISO datetime"
  }]
}
```

#### POST `/api/telegram-personal/accounts/send-code`

Start phone-based Telegram auth. Max 5 accounts per tenant.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`, `requireActiveSubscription`, `requireActiveTenant`
- **Request Body:** `{ "phoneNumber": "string" }`
- **Response 200:** `{ "success": true, "accountId": "uuid", "sessionId": "string" }`

#### POST `/api/telegram-personal/accounts/verify-code`

Verify the SMS code.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`, `requireActiveSubscription`
- **Request Body:** `{ "accountId": "uuid", "sessionId": "string", "phoneNumber": "string", "code": "string" }`
- **Response 200 (success):** `{ "success": true, "user": { ... } }`
- **Response 200 (2FA required):** `{ "success": false, "needs2FA": true, "sessionId": "string", "accountId": "uuid" }`

#### POST `/api/telegram-personal/accounts/verify-password`

Provide 2FA password.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`, `requireActiveSubscription`
- **Request Body:** `{ "accountId": "uuid", "sessionId": "string", "password": "string" }`
- **Response 200:** `{ "success": true, "user": { ... } }`

#### POST `/api/telegram-personal/accounts/start-qr`

Start QR-code-based Telegram auth.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`, `requireActiveSubscription`, `requireActiveTenant`
- **Response 200:**

```json
{
  "success": true,
  "accountId": "uuid",
  "sessionId": "string",
  "qrImageDataUrl": "data:image/png;base64,...",
  "qrUrl": "tg://login?token=...",
  "expiresAt": "ISO datetime"
}
```

#### POST `/api/telegram-personal/accounts/check-qr`

Poll QR auth status.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Request Body:** `{ "sessionId": "string", "accountId": "uuid" }`
- **Response 200:** `{ "status": "authorized | pending | expired | needs_2fa", ... }`

#### POST `/api/telegram-personal/accounts/verify-qr-2fa`

Provide 2FA password during QR auth.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Request Body:** `{ "sessionId": "string", "accountId": "uuid", "password": "string" }`
- **Response 200:** `{ "success": true, "user": { ... } }`

#### POST `/api/telegram-personal/accounts/cancel-auth`

Cancel an in-progress auth flow.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Request Body:** `{ "sessionId": "string (optional)", "accountId": "uuid (optional)" }`
- **Response 200:** `{ "success": true }`

#### DELETE `/api/telegram-personal/accounts/:id`

Remove a Telegram personal account.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:** `{ "success": true }`

#### PATCH `/api/telegram-personal/accounts/:id`

Enable/disable an account.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Request Body:** `{ "isEnabled": true }`
- **Response 200:** `{ "success": true, "account": { ... } }`

#### POST `/api/telegram-personal/start-conversation`

Start a new outbound conversation via Telegram personal.

- **Auth:** `requireAuth`
- **Request Body:** `{ "phoneNumber": "string", "initialMessage": "string (optional)" }`
- **Response 200:** `{ "success": true, "conversationId": "uuid" }`

---

### WhatsApp Personal

#### POST `/api/whatsapp-personal/start-auth`

Start QR-based WhatsApp auth.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`, `requireActiveSubscription`
- **Response 200:** `{ "success": true, "status": "qr_ready | connected", "qrCode": "string", "qrDataUrl": "string" }`

#### POST `/api/whatsapp-personal/start-auth-phone`

Start phone pairing code auth.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`, `requireActiveSubscription`, `requireActiveTenant`
- **Request Body:** `{ "phoneNumber": "string" }`
- **Response 200:** `{ "success": true, "status": "pairing_code_ready | connected", "pairingCode": "string" }`

#### POST `/api/whatsapp-personal/check-auth`

Poll auth status.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:** `{ "success": true, "status": "string", "user": { ... } }`

#### POST `/api/whatsapp-personal/logout`

Disconnect WhatsApp personal.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:** Logout result

#### GET `/api/whatsapp-personal/status`

Get connection status.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:** `{ "connected": true, "status": "string", "user": { ... } }`

---

### Max Personal

MAX Personal integration uses **GREEN-API** (https://green-api.com) — a cloud-based WhatsApp/Max gateway. Each account corresponds to a GREEN-API instance (`idInstance` + `apiTokenInstance`). Multiple accounts per tenant are supported (stored in `max_personal_accounts` table).

#### GET `/api/max-personal/accounts`

List all MAX Personal accounts for the tenant.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:**

```json
{
  "accounts": [{
    "id": "uuid",
    "tenantId": "uuid",
    "idInstance": "string",
    "apiTokenInstance": "string",
    "label": "string | null",
    "displayName": "string | null",
    "status": "string",
    "webhookRegistered": true,
    "createdAt": "ISO datetime"
  }]
}
```

#### POST `/api/max-personal/accounts`

Add a new GREEN-API account.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`, `requireActiveSubscription`, `requireActiveTenant`
- **Request Body:**

```json
{
  "idInstance": "string",
  "apiTokenInstance": "string",
  "label": "string (optional)"
}
```

- **Response 201:** Created account object

#### DELETE `/api/max-personal/accounts/:id`

Remove a MAX Personal account.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:** `{ "success": true }`

#### POST `/api/max-personal/start-auth`

Start QR-based Max auth (legacy single-account flow).

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`, `requireActiveSubscription`
- **Response 200:** `{ "success": true, "status": "qr_ready | connected", "qrCode": "string", "qrDataUrl": "string", "user": { ... } }`
- **Response 503:** Service unavailable

#### POST `/api/max-personal/check-auth`

Poll auth status (legacy single-account flow).

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:** `{ "success": true, "status": "string", "user": { ... } }`

#### POST `/api/max-personal/logout`

Disconnect Max personal (legacy single-account flow).

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:** Logout result

#### GET `/api/max-personal/status`

Get connection status (legacy single-account flow).

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:** `{ "connected": true, "status": "string", "user": { ... } }`

#### GET `/api/max-personal/service-status`

Check if the Max Personal Python microservice is available.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_CHANNELS")`
- **Response 200:** `{ "available": true }`

#### POST `/api/max-personal/incoming` *(internal)*

Receives messages from the GREEN-API webhook or Max Personal Python microservice.

- **Auth:** `X-Internal-Secret` header (matches `MAX_INTERNAL_SECRET` or `SESSION_SECRET`)
- **Request Body:** `{ "tenant_id": "uuid", "message": { ... } }`
- **Response 200:** `{ "success": true }`

---

### Billing

#### GET `/api/billing/me`

Get billing status for the current tenant.

- **Auth:** `requireAuth`
- **Response 200:**

```json
{
  "hasSubscription": true,
  "status": "active | trialing | past_due | canceled | ...",
  "plan": { "id": "uuid", "name": "string", "amount": 5000, "currency": "usd", "interval": "month" },
  "currentPeriodEnd": "ISO datetime",
  "cancelAtPeriodEnd": false,
  "canAccess": true,
  "isTrial": false,
  "trialEndsAt": null,
  "trialDaysRemaining": null,
  "hadTrial": true,
  "hasActiveGrant": false,
  "grantEndsAt": null
}
```

#### POST `/api/billing/checkout`

Create a payment checkout session (CryptoBot).

- **Auth:** `requireAuth`, `requireAdmin`
- **Response 200:** `{ "url": "https://...", "invoiceId": "string" }`

#### GET `/api/billing/check-invoice/:invoiceId`

Check invoice payment status.

- **Auth:** `requireAuth`
- **Response 200:** `{ "status": "string", "billingStatus": { ... } }`

#### POST `/api/billing/cancel`

Cancel subscription.

- **Auth:** `requireAuth`, `requireAdmin`
- **Response 200:** `{ "success": true, "message": "string" }`

---

### Feature Flags

#### GET `/api/admin/feature-flags`

List all feature flags.

- **Auth:** `requireAuth`, `requirePermission("VIEW_AUDIT_LOGS")`
- **Response 200:** `FeatureFlag[]`

#### GET `/api/admin/feature-flags/:name`

Get a single flag.

- **Auth:** `requireAuth`, `requirePermission("VIEW_AUDIT_LOGS")`
- **Response 200:** Feature flag object
- **Response 404:** Not found

#### POST `/api/admin/feature-flags/:name/toggle`

Toggle a feature flag.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TENANT_SETTINGS")`
- **Request Body:** `{ "enabled": true, "tenantId": "uuid (optional)" }`
- **Response 200:** Updated flag

#### GET `/api/feature-flags/:name/check`

Check if a flag is enabled for the current tenant.

- **Auth:** `requireAuth`, `requirePermission("VIEW_CONVERSATIONS")`
- **Response 200:** `{ "name": "string", "enabled": true }`

---

### Audit Events

#### GET `/api/conversations/:id/audit`

Get audit trail for a conversation.

- **Auth:** `requireAuth`, `requirePermission("VIEW_AUDIT_LOGS")`
- **Response 200:** `AuditEvent[]`

#### GET `/api/admin/audit-events`

List recent audit events.

- **Auth:** `requireAuth`, `requirePermission("VIEW_AUDIT_LOGS")`
- **Query:** `?limit=100` (max 500)
- **Response 200:** `AuditEvent[]`

#### GET `/api/admin/audit-events/:entityType/:entityId`

Get audit events for a specific entity.

- **Auth:** `requireAuth`, `requirePermission("VIEW_AUDIT_LOGS")`
- **Query:** `?limit=50` (max 200)
- **Response 200:** `AuditEvent[]`

---

### Admin — RAG & Training

#### POST `/api/admin/rag/regenerate-embeddings`

Regenerate RAG embeddings.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_KNOWLEDGE_BASE")`
- **Query:** `?limit=50&batchSize=10&concurrency=3&includeStale=true`
- **Response 200:** `{ "processed": 42, "failed": 1, "total": 43, "batches": 5 }`

#### GET `/api/admin/rag/status`

Get RAG system status.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_KNOWLEDGE_BASE")`
- **Response 200:**

```json
{
  "ragEnabled": true,
  "embeddingServiceAvailable": true,
  "model": "text-embedding-3-small",
  "dimensions": 1536,
  "pendingChunks": 5,
  "staleChunks": 0
}
```

#### POST `/api/admin/rag/invalidate-stale`

Mark stale RAG chunks for re-embedding.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_KNOWLEDGE_BASE")`
- **Response 200:** `{ "invalidated": 12 }`

#### GET `/api/admin/delayed-jobs`

List delayed (scheduled) message jobs.

- **Auth:** `requireAuth`, `requirePermission("VIEW_AUDIT_LOGS")`
- **Response 200:** `{ "jobs": [...], "metrics": { ... } }`

#### GET `/api/admin/training-samples`

List AI training samples.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TRAINING")`
- **Query:** `?outcome=APPROVED | EDITED | REJECTED`
- **Response 200:** `AiTrainingSample[]`

#### POST `/api/admin/training-samples/export`

Export training data.

- **Auth:** `requireAuth`, `requirePermission("EXPORT_TRAINING_DATA")`
- **Request Body:** `{ "outcome": "string (optional)" }`
- **Response 200:** Export data object

#### GET `/api/admin/training-policies`

Get training policies.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_POLICIES")`
- **Response 200:**

```json
{
  "tenantId": "uuid",
  "alwaysEscalateIntents": ["complaint"],
  "forbiddenTopics": ["politics"],
  "disabledLearningIntents": [],
  "updatedAt": "ISO datetime"
}
```

#### PUT `/api/admin/training-policies`

Update training policies.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_POLICIES")`
- **Request Body:**

```json
{
  "alwaysEscalateIntents": ["complaint", "return"],
  "forbiddenTopics": ["politics", "religion"],
  "disabledLearningIntents": []
}
```

- **Response 200:** Updated policy

#### GET `/api/admin/learning-queue`

Get learning queue items.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TRAINING")`
- **Query:** `?minScore=2`
- **Response 200:** `{ "items": [...], "total": 15, "minScore": 2 }`

#### PATCH `/api/admin/learning-queue/:conversationId/review`

Review a learning queue item.

- **Auth:** `requireAuth`, `requirePermission("MANAGE_TRAINING")`
- **Response 200:** Updated queue item

#### GET `/api/admin/security/readiness`

Security readiness report.

- **Auth:** `requireAuth`, `requirePermission("VIEW_AUDIT_LOGS")`
- **Response 200:** Security readiness report object

#### GET `/api/admin/system/metrics`

System metrics (CPU, memory, DB stats).

- **Auth:** `requireAuth`, `requirePlatformOwner`
- **Response 200:**

```json
{
  "cpu": { ... },
  "memory": { ... },
  "uptime": 86400,
  "loadAverage": [0.5, 0.3, 0.2],
  "dbStats": { ... },
  "userStats": { ... }
}
```

---

### Platform Admin

All platform admin routes require `requireAuth` + `requirePlatformAdmin()` (or `requirePlatformOwner()` where noted). Most also apply `auditAdminAction(...)`.

#### GET `/api/admin/health`

Admin health check.

- **Response 200:** `{ "status": "ok", "timestamp": "string", "adminId": "uuid" }`

#### GET `/api/admin/billing/metrics`

Billing overview metrics.

- **Response 200:**

```json
{
  "activeSubscriptions": 50,
  "activeGrants": 5,
  "trialCount": 10,
  "expiredTrials": 3,
  "upcomingRenewals": { "count": 12, "totalAmount": 60000, "renewals": [...] },
  "totalRevenue": 250000
}
```

#### GET `/api/admin/tenants/search`

Search tenants.

- **Query:** `?q=string&limit=20&offset=0`
- **Response 200:** `{ "results": [...], "count": 5, "query": "string" }`

#### GET `/api/admin/users/search`

Search users (emails are masked).

- **Query:** `?q=string&limit=20&offset=0`
- **Response 200:** `{ "results": [...], "count": 3, "query": "string" }`

#### POST `/api/admin/tenants/:tenantId/restrict`

Restrict a tenant (disables all channels).

- **Request Body:** `{ "reason": "string (3-500 chars)" }`
- **Response 200:** `{ "success": true, "actionId": "uuid" }`

#### POST `/api/admin/tenants/:tenantId/unrestrict`

Unrestrict a tenant. **Requires platform owner.**

- **Request Body:** `{ "reason": "string (3-500 chars)" }`
- **Response 200:** `{ "success": true, "actionId": "uuid" }`

#### POST `/api/admin/users/:userId/disable`

Disable a user.

- **Request Body:** `{ "reason": "string (3-500 chars)" }`
- **Response 200:** `{ "success": true, "actionId": "uuid" }`

#### POST `/api/admin/users/:userId/enable`

Re-enable a user.

- **Request Body:** `{ "reason": "string (3-500 chars)" }`
- **Response 200:** `{ "success": true, "actionId": "uuid" }`

#### POST `/api/admin/tenants/:tenantId/grant`

Grant temporary subscription access.

- **Request Body:** `{ "days": 30, "reason": "string (3-500 chars)" }`
- **Validation:** `days` range: 1–365
- **Response 201:** `{ "success": true, "grant": { ... } }`

#### POST `/api/admin/tenants/:tenantId/grants`

Grant access with explicit date range.

- **Request Body:** `{ "startsAt": "ISO datetime", "endsAt": "ISO datetime", "reason": "string (3-500 chars)" }`
- **Response 201:** `{ "success": true, "grant": { ... } }`

#### GET `/api/admin/tenants/:tenantId/grants`

List grants for a tenant.

- **Query:** `?includeRevoked=true`
- **Response 200:** `{ "grants": [...], "count": 3 }`

#### DELETE `/api/admin/grants/:grantId`

Revoke a grant.

- **Request Body:** `{ "reason": "string (3-500 chars)" }`
- **Response 200:** `{ "success": true, "grantId": "uuid" }`

#### POST `/api/admin/secrets`

Create or rotate an integration secret.

- **Request Body:**

```json
{
  "scope": "global | tenant",
  "tenantId": "uuid (required if scope=tenant)",
  "keyName": "UPPERCASE_ALPHANUMERIC_KEY (3-64 chars)",
  "plaintextValue": "string (1-10000 chars)",
  "reason": "string (3-500 chars)"
}
```

- **Response 201:** Secret metadata (new) or **200** (rotated existing)

#### POST `/api/admin/secrets/:id/rotate`

Rotate an existing secret.

- **Request Body:** `{ "plaintextValue": "string (1-10000 chars)", "reason": "string (3-500 chars)" }`
- **Response 200:** Updated secret metadata
- **Response 403:** Global secrets require platform owner

#### POST `/api/admin/secrets/:id/revoke`

Revoke a secret.

- **Request Body:** `{ "reason": "string (3-500 chars)" }`
- **Response 200:** `{ "success": true, "secretId": "uuid" }`

#### GET `/api/admin/secrets`

List secrets (values are never returned).

- **Query:** `?scope=global|tenant&tenantId=uuid&keyName=string&includeRevoked=true&limit=20&offset=0`
- **Response 200:** `{ "secrets": [...], "pagination": { "limit": 20, "offset": 0, "count": 5 } }`

#### GET `/api/admin/users`

List all users.

- **Query:** `?q=string&limit=20&offset=0`
- **Response 200:** `{ "users": [...], "total": 50 }`

#### GET `/api/admin/users/:userId`

Get full user details with tenant/subscription info.

- **Response 200:** Full user object

#### GET `/api/admin/users/:userId/audit`

Get user's audit log.

- **Query:** `?limit=50` (max 100)
- **Response 200:** `{ "logs": [...] }`

#### POST `/api/admin/users/:userId/impersonate`

Impersonate a user. **Requires platform owner.** Cannot impersonate other admins/owners.

- **Request Body:** `{ "reason": "string (3-500 chars)" }`
- **Response 200:** `{ "success": true, "redirectUrl": "string", "impersonatedUser": { ... } }`

#### POST `/api/admin/impersonate/exit`

Exit impersonation and return to admin session.

- **Auth:** `requireAuth`
- **Response 200:** `{ "success": true, "redirectUrl": "string" }`

#### POST `/api/admin/users/:userId/promote-admin`

Promote user to platform admin. **Requires platform owner.**

- **Request Body:** `{ "reason": "string (3-500 chars)" }`
- **Response 200:** `{ "success": true, "actionId": "uuid" }`

#### POST `/api/admin/users/:userId/demote-admin`

Demote a platform admin. **Requires platform owner.**

- **Request Body:** `{ "reason": "string (3-500 chars)" }`
- **Response 200:** `{ "success": true, "actionId": "uuid" }`

#### GET `/api/admin/updates`

Get update history. **Requires platform owner.**

- **Response 200:** `{ "history": [...], "currentVersion": "string" }`

#### GET `/api/admin/updates/version`

Get current version. **Requires platform owner.**

- **Response 200:** `{ "version": "string" }`

#### POST `/api/admin/updates/upload`

Upload a system update package. **Requires platform owner.**

- **Content-Type:** `multipart/form-data`
- **Fields:** `file` (ZIP, max 100 MB), `version` (string), `changelog` (string, optional)
- **Response 200:** `{ "success": true, "update": { ... } }`

#### POST `/api/admin/updates/:id/apply`

Apply an uploaded update. **Requires platform owner.**

- **Response 200:** `{ "success": true, "message": "string" }`

#### POST `/api/admin/updates/:id/rollback`

Rollback a previously applied update. **Requires platform owner.**

- **Response 200:** `{ "success": true, "message": "string" }`

#### POST `/api/admin/system/rebuild`

Trigger system rebuild. **Requires platform owner.**

- **Response 200:** `{ "success": true, "message": "string" }`

#### Proxy Management (all require platform owner)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/proxies` | List proxies. Query: `?status=...&limit=50&offset=0` |
| POST | `/api/admin/proxies` | Add a proxy. Body: `{ host, port, protocol, username?, password?, country?, label? }` |
| POST | `/api/admin/proxies/import` | Bulk import (max 1000). Body: `{ proxies: [...] }` |
| POST | `/api/admin/proxies/parse` | Parse proxy list from text. Body: `{ text: "string" }` |
| PATCH | `/api/admin/proxies/:id` | Update a proxy. |
| DELETE | `/api/admin/proxies/:id` | Delete a proxy. |
| DELETE | `/api/admin/proxies` | Bulk delete. Query: `?status=...` |
| POST | `/api/admin/proxies/:id/assign` | Assign proxy to tenant/channel. Body: `{ tenantId?, channelId? }` |
| GET | `/api/admin/proxies/available` | List available proxies. Query: `?protocol=socks5&country=RU` |

---

## Webhooks

### Telegram Webhook

**URL:** `POST /webhooks/telegram` (also `/api/webhook/telegram`)

| Property | Value |
|----------|-------|
| Auth | None |
| Rate limit | `webhookRateLimiter` (500 req/min) |
| Verification | `X-Telegram-Bot-Api-Secret-Token` header must match `TELEGRAM_WEBHOOK_SECRET` |
| Feature flag | `TELEGRAM_CHANNEL_ENABLED` |

**Payload:** Standard Telegram Bot API `Update` object.

**Response 200:**

```json
{
  "ok": true,
  "processed": true,
  "messageId": "string",
  "chatId": "string",
  "userId": "string",
  "duplicate": false
}
```

**Response 401:** Verification failed

Deduplication is performed by `update_id`.

---

### WhatsApp Webhook

**Verification (GET):** `GET /webhooks/whatsapp`

- Query params: `hub.mode`, `hub.verify_token`, `hub.challenge`
- Returns the `hub.challenge` string on success
- Returns 403 if `hub.verify_token` doesn't match or channel is disabled

**Messages (POST):** `POST /webhooks/whatsapp`

| Property | Value |
|----------|-------|
| Auth | None |
| Rate limit | `webhookRateLimiter` (500 req/min) |
| Verification | `X-Hub-Signature-256` header (HMAC-SHA256 with `WHATSAPP_APP_SECRET`) |
| Feature flag | `WHATSAPP_CHANNEL_ENABLED` |

**Payload:** Standard WhatsApp Business API webhook payload. Only `whatsapp_business_account` objects are processed.

**Response 200:**

```json
{
  "ok": true,
  "processed": true,
  "messageId": "string",
  "senderId": "string"
}
```

---

### Max Webhook

**URL:** `POST /webhooks/max/`

| Property | Value |
|----------|-------|
| Auth | None |
| Verification | `X-Max-Bot-Api-Secret` header; optionally `X-Max-Signature` (HMAC-SHA256) |
| Feature flag | `MAX_CHANNEL_ENABLED` |

**Response 200:**

```json
{
  "ok": true,
  "received": { "messageId": "string", "userId": "string", "chatId": "string" },
  "duplicate": false
}
```

**Additional Max webhook endpoints:**

- `GET /webhooks/max/health` — returns `{ "channel": "max", "enabled": true, "webhookConfigured": true, "tokenConfigured": true }`
- `POST /webhooks/max/verify-auth` — returns `{ "ok": true, "bot": { "id": "string", "name": "string", "username": "string" } }`

---

### CryptoBot Webhook

**URL:** `POST /webhooks/cryptobot`

| Property | Value |
|----------|-------|
| Auth | None |
| Verification | `crypto-pay-api-signature` header (HMAC-SHA256 with `CRYPTO_PAY_API_TOKEN`) |

**Payload:** CryptoBot payment event object.

**Response 200:** `{ "received": true }`
**Response 400:** Missing or invalid signature

Handles subscription payment confirmations.

---

## WebSocket Events

**Connection URL:** `ws://host/ws` (or `wss://` in production)

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe` | `{ type: "subscribe", conversationId: "uuid" }` | Subscribe to updates for a conversation |
| `set_tenant` | `{ type: "set_tenant", tenantId: "uuid" }` | Set tenant context |
| `ping` | `{ type: "ping" }` | Keepalive; server responds with `pong` |

### Server → Client

| Event | Payload | When |
|-------|---------|------|
| `connected` | `{ type: "connected" }` | On connection |
| `pong` | `{ type: "pong" }` | In response to `ping` |
| `new_message` | `{ type: "new_message", conversationId: "uuid", message: Message }` | New message in a subscribed conversation |
| `conversation_update` | `{ type: "conversation_update", conversation: Partial<Conversation> & { id: string } }` | Conversation status/mode change |
| `new_conversation` | `{ type: "new_conversation", conversation: Conversation }` | New conversation created |
| `new_suggestion` | `{ type: "new_suggestion", conversationId: "uuid", suggestionId: "uuid" }` | AI suggestion generated |

**Scoping:** `new_message` is sent to clients subscribed to the specific conversation or the tenant. All other events are broadcast to all clients in the tenant.

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI API key (fallback: `OPENAI_API_KEY`) |
| `SESSION_SECRET` | Session secret, min 32 chars |
| `INTEGRATION_SECRETS_MASTER_KEY` | AES-256-GCM master key (32 bytes, base64) |

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | `development` / `staging` / `production` / `test` |
| `PORT` | `5000` | Server listen port |
| `TRUST_PROXY` | `false` | Enable for reverse proxy (Cloudflare, Nginx) |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `SENTRY_DSN` | — | Sentry error tracking DSN |
| `REDIS_URL` | — | Redis URL for queues/workers (disabled if not set) |

### OpenAI

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_INTEGRATIONS_OPENAI_API_KEY` | — | Primary API key |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | `https://api.openai.com/v1` | API base URL |
| `OPENAI_API_KEY` | — | Fallback API key |

### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_MAX_REQUESTS` | `100` | Max API requests per minute |
| `RATE_LIMIT_AI_MAX_REQUESTS` | `20` | Max AI requests per minute |

### Telegram

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot API token |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook verification secret |
| `TELEGRAM_API_ID` | MTProto API ID (numeric, for personal accounts) |
| `TELEGRAM_API_HASH` | MTProto API hash (32-char hex) |

### WhatsApp

| Variable | Description |
|----------|-------------|
| `WHATSAPP_ACCESS_TOKEN` | Business API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verify token |
| `WHATSAPP_APP_SECRET` | App secret for signature verification |

### Max (VK Teams)

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_TOKEN` | — | Bot token |
| `MAX_WEBHOOK_SECRET` | — | Webhook verification secret |
| `MAX_SERVICE_URL` | `http://localhost:8100` | Python microservice URL |
| `MAX_INTERNAL_SECRET` | falls back to `SESSION_SECRET` | Internal service auth |

### Billing

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `CRYPTO_PAY_API_TOKEN` | CryptoPay API token |
| `CRYPTO_PAY_TESTNET` | Enable CryptoPay testnet (`true`/`false`) |

### Feature Flags (env overrides)

| Variable | Default | Description |
|----------|---------|-------------|
| `FEATURE_AI_SUGGESTIONS_ENABLED` | — | Enable AI suggestions |
| `FEATURE_RAG_ENABLED` | `true` | Enable RAG retrieval |
| `FEATURE_AI_AUTOSEND_ENABLED` | `false` | Enable auto-send |
| `FEATURE_HUMAN_DELAY_ENABLED` | `false` | Enable human-like delay |
| `FEATURE_DECISION_ENGINE_ENABLED` | `false` | Enable decision engine |

### Price Sources

| Variable | Default | Description |
|----------|---------|-------------|
| `AVITO_ENABLED` | `false` | Enable Avito price source |
| `DROM_ENABLED` | `false` | Enable Drom price source |
| `SERP_API_KEY` | — | SerpAPI key for web price source |

### Vehicle Lookup

| Variable | Default | Description |
|----------|---------|-------------|
| `PODZAMENU_LOOKUP_SERVICE_URL` | `http://localhost:8200` | Podzamenu service URL |

### Platform Owner Bootstrap

| Variable | Description |
|----------|-------------|
| `OWNER_EMAIL` | Bootstrap owner email |
| `OWNER_PASSWORD` | Bootstrap owner password (remove after first run) |
| `OWNER_PASSWORD_HASH` | Alternative: bcrypt hash |
| `OWNER_NAME` | Owner display name (default: "Platform Owner") |

### Test / Debug Endpoints

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_TEST_ENDPOINTS` | `false` | Enable `POST /api/test/simulate-message` in production. Automatically enabled when `NODE_ENV !== 'production'`. |

---

## Test / Debug Endpoints

> Available when `NODE_ENV !== 'production'` **or** `ENABLE_TEST_ENDPOINTS=true`.
> Auth required (`requireAuth`). No special permissions needed.

### `POST /api/test/simulate-message`

Simulates an incoming customer message via the mock channel adapter. Creates a real customer + conversation and runs the full inbound pipeline (`processIncomingMessageFull`), including VIN/FRAME detection, vehicle lookup queuing, and AI suggestion generation.

**Request body:**
```json
{
  "customerName": "Тест Иванов",
  "customerPhone": "+79001234567",
  "message": "WVWZZZ7MZ6V025007"
}
```

**Response:**
```json
{
  "success": true,
  "conversation": { /* ConversationWithCustomer */ },
  "customer": { /* Customer */ }
}
```

**Notes:**
- Uses `channel: "mock"` — no real messenger is involved.
- `externalUserId` is derived from digits in `customerPhone` (e.g. `79001234567`).
- If a customer with that phone already exists in the mock channel, the message is added to their existing active conversation.
