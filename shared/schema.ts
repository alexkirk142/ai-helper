import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb, real, serial, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Valid intents for AI classification
export const VALID_INTENTS = [
  "price",
  "availability",
  "shipping",
  "return",
  "discount",
  "complaint",
  "other",
  "photo_request",
  "price_objection",
  "ready_to_buy",
  "needs_manual_quote",
  "invalid_vin",
  "marking_provided",
  "payment_blocked",
  "warranty_question",
  "want_visit",
  "what_included",
  "mileage_preference",
] as const;

export type ValidIntent = typeof VALID_INTENTS[number];

// Validation constants for training policies
export const TRAINING_POLICY_LIMITS = {
  maxIntentsListSize: 50,
  maxForbiddenTopicsSize: 100,
  maxTopicLength: 200,
} as const;

// Tenant status for fraud prevention
export const TENANT_STATUSES = ["active", "restricted"] as const;
export type TenantStatus = typeof TENANT_STATUSES[number];

// Admin action types
export const ADMIN_ACTION_TYPES = [
  "tenant_restrict",
  "tenant_unrestrict", 
  "user_disable",
  "user_enable",
  "grant_create",
  "grant_revoke",
  "secret_create",
  "secret_rotate",
  "secret_revoke",
  "user_login",
  "user_logout",
  "owner_access_denied",
  "admin_promote",
  "admin_demote",
  "owner_bootstrap",
  "impersonate_start",
  "impersonate_end",
  "admin_users_list",
  "admin_user_view",
  "admin_user_audit_view",
  "admin_grant_create",
  "update_upload",
  "update_apply",
  "update_rollback",
] as const;
export type AdminActionType = typeof ADMIN_ACTION_TYPES[number];

// Tenants (multi-tenant support for different stores/businesses)
export const tenants = pgTable("tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  language: text("language").notNull().default("ru"),
  tone: text("tone").notNull().default("formal"), // formal, friendly
  addressStyle: text("address_style").notNull().default("vy"), // vy, ty
  currency: text("currency").notNull().default("RUB"),
  timezone: text("timezone").notNull().default("Europe/Moscow"),
  workingHoursStart: text("working_hours_start").default("09:00"),
  workingHoursEnd: text("working_hours_end").default("18:00"),
  workingDays: text("working_days").array().default(sql`ARRAY['mon','tue','wed','thu','fri']`),
  autoReplyOutsideHours: boolean("auto_reply_outside_hours").default(true),
  escalationEmail: text("escalation_email"),
  escalationTelegram: text("escalation_telegram"),
  allowDiscounts: boolean("allow_discounts").default(false),
  maxDiscountPercent: integer("max_discount_percent").default(0),
  status: text("status").notNull().default("active").$type<TenantStatus>(), // active, restricted (fraud prevention)
  templates: jsonb("templates").default({}), // tenant text templates e.g. gearboxLookupFound, gearboxLookupModelOnly, gearboxTagRequest
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Channels (WhatsApp, Telegram, MAX configurations)
export const channels = pgTable("channels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  type: text("type").notNull(), // whatsapp, telegram, max
  name: text("name").notNull(),
  config: jsonb("config").default({}), // API keys, webhook URLs, etc.
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Users (owners/operators)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("operator"), // owner, admin, operator, viewer, guest
  email: text("email"),
  emailVerifiedAt: timestamp("email_verified_at"), // null = unverified, timestamp = when verified
  authProvider: text("auth_provider").default("local"), // local, oidc, mixed
  oidcId: text("oidc_id"),
  passwordUpdatedAt: timestamp("password_updated_at"),
  lastLoginAt: timestamp("last_login_at"),
  failedLoginAttempts: integer("failed_login_attempts").default(0),
  lockedUntil: timestamp("locked_until"),
  isPlatformAdmin: boolean("is_platform_admin").default(false).notNull(),
  isPlatformOwner: boolean("is_platform_owner").default(false).notNull(),
  isDisabled: boolean("is_disabled").default(false).notNull(),
  disabledAt: timestamp("disabled_at"),
  disabledReason: text("disabled_reason"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  // Case-insensitive unique index on email (allows NULL)
  // Created via migration: migrations/0001_add_users_email_unique_index.sql
  uniqueIndex("users_email_unique_lower_idx").on(sql`LOWER(${table.email})`),
]);

// User invites for team member onboarding
export const userInvites = pgTable("user_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  email: text("email").notNull(),
  role: text("role").notNull().default("operator"),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 hash of token (never store plaintext)
  invitedBy: varchar("invited_by").references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Admin actions log (platform admin actions on tenants/users/grants)
export const adminActions = pgTable("admin_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actionType: text("action_type").notNull().$type<AdminActionType>(),
  targetType: text("target_type").notNull(), // "tenant", "user", or "grant"
  targetId: varchar("target_id").notNull(),
  adminId: varchar("admin_id").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  previousState: jsonb("previous_state"), // snapshot of state before action (null for no-op)
  metadata: jsonb("metadata"), // { idempotent, noOp, alreadyState } for no-op actions
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Email tokens for verification and password reset
// SECURITY: Only SHA-256 hashes stored, never plaintext tokens
export const emailTokens = pgTable("email_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 hash
  type: text("type").notNull(), // 'email_verification' | 'password_reset'
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"), // null = unused, timestamp = when used (single-use)
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type EmailToken = typeof emailTokens.$inferSelect;
export type InsertEmailToken = typeof emailTokens.$inferInsert;

// Customers (end users chatting with the business)
export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  channelId: varchar("channel_id").references(() => channels.id),
  channel: text("channel"), // whatsapp_personal, telegram, max, etc.
  externalId: text("external_id"), // platform-specific ID (externalUserId)
  name: text("name"),
  phone: text("phone"),
  email: text("email"),
  tags: jsonb("tags").default([]), // array of strings
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("customers_tenant_channel_external_idx").on(table.tenantId, table.channel, table.externalId),
]);

// Customer Notes (operator notes about customers)
export const customerNotes = pgTable("customer_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  authorUserId: varchar("author_user_id").references(() => users.id),
  noteText: text("note_text").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Customer Memory (long-term memory: preferences + frequent topics)
export const customerMemory = pgTable("customer_memory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  preferences: jsonb("preferences").default({}), // e.g. { city, delivery, payment }
  frequentTopics: jsonb("frequent_topics").default({}), // { intent -> count }
  lastSummaryText: text("last_summary_text"),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("customer_memory_tenant_customer_idx").on(table.tenantId, table.customerId),
]);

// Conversations
export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  customerId: varchar("customer_id").notNull().references(() => customers.id),
  channelId: varchar("channel_id").references(() => channels.id),
  status: text("status").notNull().default("active"), // active, waiting, escalated, resolved
  mode: text("mode").notNull().default("learning"), // learning, semi-auto, auto
  lastMessageAt: timestamp("last_message_at").default(sql`CURRENT_TIMESTAMP`),
  unreadCount: integer("unread_count").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Messages
export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id),
  role: text("role").notNull(), // customer, assistant, owner
  content: text("content").notNull(),
  attachments: jsonb("attachments").default([]),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Products catalog
export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  sku: text("sku"),
  name: text("name").notNull(),
  description: text("description"),
  price: real("price"),
  currency: text("currency").default("RUB"),
  category: text("category"),
  inStock: boolean("in_stock").default(true),
  stockQuantity: integer("stock_quantity"),
  variants: jsonb("variants").default([]),
  images: text("images").array().default(sql`ARRAY[]::text[]`),
  deliveryInfo: text("delivery_info"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Document types for knowledge base
export const DOC_TYPES = ["policy", "faq", "delivery", "returns"] as const;
export type DocType = typeof DOC_TYPES[number];

// Knowledge Base documents
export const knowledgeDocs = pgTable("knowledge_docs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category"), // faq, policy, shipping, returns, general
  docType: text("doc_type"), // policy, faq, delivery, returns
  tags: text("tags").array().default(sql`ARRAY[]::text[]`),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Knowledge Base document chunks
export const knowledgeDocChunks = pgTable("knowledge_doc_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  docId: varchar("doc_id").notNull().references(() => knowledgeDocs.id, { onDelete: "cascade" }),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count").notNull(),
  metadata: jsonb("metadata").default({}), // { title, docType, headings: string[] }
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// RAG Document types
export const RAG_DOC_TYPES = ["PRODUCT", "DOC"] as const;
export type RagDocType = typeof RAG_DOC_TYPES[number];

// RAG Documents (unified index for products and knowledge docs)
export const ragDocuments = pgTable("rag_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  type: text("type").notNull(), // PRODUCT | DOC
  sourceId: varchar("source_id").notNull(), // productId or documentId
  content: text("content").notNull(),
  metadata: jsonb("metadata").default({}), // { category, sku, tags }
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// RAG Chunks (chunked content with optional embeddings)
export const ragChunks = pgTable("rag_chunks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ragDocumentId: varchar("rag_document_id").notNull().references(() => ragDocuments.id, { onDelete: "cascade" }),
  chunkText: text("chunk_text").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  tokenCount: integer("token_count").notNull(),
  embedding: text("embedding"), // nullable - vector stored as text for now
  metadata: jsonb("metadata").default({}),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// AI Suggestions (extended for Phase 1 Decision Engine)
export const aiSuggestions = pgTable("ai_suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id),
  messageId: varchar("message_id").references(() => messages.id),
  suggestedReply: text("suggested_reply").notNull(),
  intent: text("intent"), // price, availability, shipping, return, discount, complaint, other
  confidence: real("confidence").default(0),
  needsApproval: boolean("needs_approval").default(true),
  needsHandoff: boolean("needs_handoff").default(false),
  questionsToAsk: text("questions_to_ask").array().default(sql`ARRAY[]::text[]`),
  usedSources: jsonb("used_sources").default([]),
  status: text("status").default("pending"), // pending, approved, edited, rejected
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  // Phase 1: Decision Engine fields
  similarityScore: real("similarity_score"),
  intentScore: real("intent_score"),
  selfCheckScore: real("self_check_score"),
  decision: text("decision"), // AUTO_SEND, NEED_APPROVAL, ESCALATE
  explanations: jsonb("explanations").default([]), // array of strings
  penalties: jsonb("penalties").default([]), // array of {code, message, value}
  sourceConflicts: boolean("source_conflicts").default(false),
  missingFields: jsonb("missing_fields").default([]), // array of strings like ["price", "availability"]
  // Phase 1.1: Triple lock autosend fields
  autosendEligible: boolean("autosend_eligible").default(false),
  autosendBlockReason: text("autosend_block_reason"), // FLAG_OFF, SETTING_OFF, INTENT_NOT_ALLOWED
  // Phase 1.1: Self-check handoff info
    selfCheckNeedHandoff: boolean("self_check_need_handoff").default(false),
  selfCheckReasons: jsonb("self_check_reasons").default([]), // array of strings
  escalationData: jsonb("escalation_data"),
});

// Human Actions (approve/edit/reject tracking)
export const humanActions = pgTable("human_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  suggestionId: varchar("suggestion_id").notNull().references(() => aiSuggestions.id),
  userId: varchar("user_id").references(() => users.id),
  action: text("action").notNull(), // approve, edit, reject, escalate
  originalText: text("original_text"),
  editedText: text("edited_text"),
  reason: text("reason"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// AI Training Samples (dataset versioning for AI fine-tuning)
export const aiTrainingSamples = pgTable("ai_training_samples", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id),
  userMessage: text("user_message").notNull(),
  aiSuggestion: text("ai_suggestion").notNull(),
  finalAnswer: text("final_answer"), // null for REJECTED
  intent: text("intent"),
  decision: text("decision"), // AUTO_SEND, NEED_APPROVAL, ESCALATE
  outcome: text("outcome").notNull(), // APPROVED, EDITED, REJECTED
  rejectionReason: text("rejection_reason"), // reason for REJECTED outcomes
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// AI Training Policies (per-tenant learning configuration)
export const aiTrainingPolicies = pgTable("ai_training_policies", {
  tenantId: varchar("tenant_id").primaryKey().references(() => tenants.id),
  alwaysEscalateIntents: text("always_escalate_intents").array().default(sql`ARRAY[]::text[]`), // intents that never AUTO_SEND
  forbiddenTopics: text("forbidden_topics").array().default(sql`ARRAY[]::text[]`), // topics that won't create training samples
  disabledLearningIntents: text("disabled_learning_intents").array().default(sql`ARRAY[]::text[]`), // intents excluded from few-shot
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Active Learning Queue (conversations that need review for training)
export const learningQueue = pgTable("learning_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id),
  learningScore: integer("learning_score").notNull().default(0),
  reasons: text("reasons").array().default(sql`ARRAY[]::text[]`), // array of reason codes
  status: text("status").notNull().default("pending"), // pending, reviewed, exported, dismissed
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Learning score reason codes
export const LEARNING_SCORE_REASONS = {
  ESCALATED: { code: "ESCALATED", score: 3, label: "Эскалация" },
  EDITED: { code: "EDITED", score: 2, label: "Редактирование" },
  LOW_SIMILARITY: { code: "LOW_SIMILARITY", score: 2, label: "Низкое сходство" },
  STALE_DATA: { code: "STALE_DATA", score: 3, label: "Устаревшие данные" },
  LONG_CONVERSATION: { code: "LONG_CONVERSATION", score: 1, label: "Длинный диалог" },
  MULTIPLE_REJECTIONS: { code: "MULTIPLE_REJECTIONS", score: 2, label: "Много отклонений" },
} as const;

export type LearningScoreReason = keyof typeof LEARNING_SCORE_REASONS;

// Escalation Events
export const escalationEvents = pgTable("escalation_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id),
  reason: text("reason").notNull(),
  summary: text("summary"),
  suggestedResponse: text("suggested_response"),
  clarificationNeeded: text("clarification_needed"),
  status: text("status").default("pending"), // pending, handled, dismissed
  handledBy: varchar("handled_by").references(() => users.id),
  handledAt: timestamp("handled_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Response Templates
export const responseTemplates = pgTable("response_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  content: text("content").notNull(),
  category: text("category"),
  triggers: text("triggers").array().default(sql`ARRAY[]::text[]`),
  isActive: boolean("is_active").default(true),
  usageCount: integer("usage_count").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============ PHASE 1: Decision Settings (per tenant) ============
export const decisionSettings = pgTable("decision_settings", {
  tenantId: varchar("tenant_id").primaryKey().references(() => tenants.id),
  tAuto: real("t_auto").notNull().default(0.80), // threshold for AUTO_SEND
  tEscalate: real("t_escalate").notNull().default(0.40), // threshold for ESCALATE (below this)
  autosendAllowed: boolean("autosend_allowed").notNull().default(false),
  intentsAutosendAllowed: jsonb("intents_autosend_allowed").default(["price", "availability", "shipping", "other"]), // array of intents
  intentsForceHandoff: jsonb("intents_force_handoff").default(["discount", "complaint"]), // array of intents
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============ PHASE 2: Human Delay Settings (per tenant) ============
export const humanDelaySettings = pgTable("human_delay_settings", {
  tenantId: varchar("tenant_id").primaryKey().references(() => tenants.id),
  enabled: boolean("enabled").notNull().default(false),
  delayProfiles: jsonb("delay_profiles").default({
    SHORT: { baseMin: 2000, baseMax: 4000, typingSpeed: 40, jitter: 500 },
    MEDIUM: { baseMin: 4000, baseMax: 8000, typingSpeed: 35, jitter: 1000 },
    LONG: { baseMin: 8000, baseMax: 15000, typingSpeed: 30, jitter: 2000 }
  }),
  nightMode: text("night_mode").notNull().default("DELAY"), // AUTO_REPLY | DELAY | DISABLE
  nightDelayMultiplier: real("night_delay_multiplier").notNull().default(3.0),
  nightAutoReplyText: text("night_auto_reply_text").default("Спасибо за сообщение! Мы ответим в рабочее время."),
  minDelayMs: integer("min_delay_ms").notNull().default(3000), // 3 seconds min
  maxDelayMs: integer("max_delay_ms").notNull().default(120000), // 2 minutes max
  typingIndicatorEnabled: boolean("typing_indicator_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============ Telegram Personal Sessions (MTProto) ============
export const telegramSessions = pgTable("telegram_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  channelId: varchar("channel_id").references(() => channels.id),
  phoneNumber: text("phone_number"),
  sessionString: text("session_string"),
  phoneCodeHash: text("phone_code_hash"),
  status: text("status").notNull().default("pending"), // pending, awaiting_code, awaiting_2fa, active, error, disconnected
  lastError: text("last_error"),
  userId: text("user_id"),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  authMethod: text("auth_method"), // "qr" | "phone"
  isEnabled: boolean("is_enabled").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (t) => ({
  tenantIdx: index("telegram_sessions_tenant_idx").on(t.tenantId),
}));

// ============ PHASE 7: Onboarding State ============
export const ONBOARDING_STATUS = ["NOT_STARTED", "IN_PROGRESS", "DONE"] as const;
export type OnboardingStatus = typeof ONBOARDING_STATUS[number];

export const ONBOARDING_STEPS = ["BUSINESS", "CHANNELS", "PRODUCTS", "POLICIES", "KB", "REVIEW", "DONE"] as const;
export type OnboardingStep = typeof ONBOARDING_STEPS[number];

export const onboardingState = pgTable("onboarding_state", {
  tenantId: varchar("tenant_id").primaryKey().references(() => tenants.id),
  status: text("status").notNull().default("NOT_STARTED"), // NOT_STARTED, IN_PROGRESS, DONE
  currentStep: text("current_step").notNull().default("BUSINESS"), // BUSINESS, CHANNELS, PRODUCTS, POLICIES, KB, REVIEW, DONE
  completedSteps: text("completed_steps").array().default(sql`ARRAY[]::text[]`),
  answers: jsonb("answers").default({}), // step answers as JSON
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============ PHASE 7.3: Readiness Report ============
export const READINESS_CHECK_STATUS = ["PASS", "WARN", "FAIL"] as const;
export type ReadinessCheckStatus = typeof READINESS_CHECK_STATUS[number];

export const READINESS_CHECK_CODES = [
  "PRODUCTS_PRESENT",
  "PRODUCTS_HAVE_PRICE_STOCK",
  "KB_PRESENT",
  "RAG_INDEX_READY",
  "TRAINING_POLICY_SET",
  "FEW_SHOT_ENABLED",
  "SMOKE_TEST_PASS",
] as const;
export type ReadinessCheckCode = typeof READINESS_CHECK_CODES[number];

export const readinessReports = pgTable("readiness_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  score: integer("score").notNull().default(0),
  checks: jsonb("checks").default([]),
  recommendations: text("recommendations").array().default(sql`ARRAY[]::text[]`),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============ PHASE 8: Analytics - CSAT Ratings ============
export const csatRatings = pgTable("csat_ratings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id),
  rating: integer("rating").notNull(), // 1-5
  comment: text("comment"), // optional feedback
  intent: text("intent"), // captured from conversation's last known intent
  decision: text("decision"), // AUTO_SEND, NEED_APPROVAL, ESCALATE - dominant decision in conversation
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("csat_ratings_conversation_idx").on(table.conversationId),
]);

// Conversions (purchase tracking for analytics)
export const conversions = pgTable("conversions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id),
  amount: real("amount").notNull(), // purchase amount
  currency: text("currency").notNull().default("RUB"),
  intent: text("intent"), // captured from conversation
  decision: text("decision"), // AUTO_SEND, NEED_APPROVAL, ESCALATE
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("conversions_conversation_idx").on(table.conversationId),
]);

// Lost deal reasons enum
export const LOST_DEAL_REASONS = [
  "NO_STOCK",
  "PRICE_TOO_HIGH",
  "ESCALATED_NO_RESPONSE",
  "AI_ERROR",
  "OTHER",
] as const;
export type LostDealReason = typeof LOST_DEAL_REASONS[number];

// Lost Deals (tracking where we lose customers)
export const lostDeals = pgTable("lost_deals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id),
  reason: text("reason").notNull(), // NO_STOCK, PRICE_TOO_HIGH, ESCALATED_NO_RESPONSE, AI_ERROR, OTHER
  detectedAutomatically: boolean("detected_automatically").default(true),
  notes: text("notes"), // optional notes from operator
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============ PHASE 0: Feature Flags ============
export const featureFlags = pgTable("feature_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // name is NOT column-level unique: the composite partial indexes below
  // replace it so that per-tenant overrides (name + tenantId) are allowed.
  name: text("name").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(false),
  tenantId: varchar("tenant_id").references(() => tenants.id), // null = global flag
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  // Global flags: unique on name where tenant_id IS NULL
  uniqueIndex("feature_flags_global_unique").on(table.name).where(sql`${table.tenantId} IS NULL`),
  // Per-tenant overrides: unique on (name, tenant_id) where tenant_id IS NOT NULL
  uniqueIndex("feature_flags_tenant_unique").on(table.name, table.tenantId).where(sql`${table.tenantId} IS NOT NULL`),
]);

// ============ PHASE 0: Audit Events ============
export const auditEvents = pgTable("audit_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  actor: text("actor").notNull(), // user_id, system, ai
  actorType: text("actor_type").notNull(), // user, system, ai
  action: text("action").notNull(), // suggestion_generated, suggestion_approved, etc.
  entityType: text("entity_type").notNull(), // conversation, suggestion, escalation, etc.
  entityId: varchar("entity_id").notNull(),
  metadata: jsonb("metadata").default({}),
  requestId: varchar("request_id"), // for tracing
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Insert schemas
export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true });
export const insertChannelSchema = createInsertSchema(channels).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, passwordUpdatedAt: true, lastLoginAt: true, failedLoginAttempts: true, lockedUntil: true });
export const insertUserInviteSchema = createInsertSchema(userInvites).omit({ id: true, createdAt: true, usedAt: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCustomerNoteSchema = createInsertSchema(customerNotes).omit({ id: true, createdAt: true });
export const insertCustomerMemorySchema = createInsertSchema(customerMemory).omit({ id: true, updatedAt: true });
export const updateCustomerSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
});
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true, createdAt: true });
export const insertKnowledgeDocSchema = createInsertSchema(knowledgeDocs).omit({ id: true, createdAt: true });
export const insertAiSuggestionSchema = createInsertSchema(aiSuggestions).omit({ id: true, createdAt: true });
export const insertHumanActionSchema = createInsertSchema(humanActions).omit({ id: true, createdAt: true });
export const insertAiTrainingSampleSchema = createInsertSchema(aiTrainingSamples).omit({ id: true, createdAt: true });
export const insertAiTrainingPolicySchema = createInsertSchema(aiTrainingPolicies).omit({ updatedAt: true });
export const insertLearningQueueSchema = createInsertSchema(learningQueue).omit({ id: true, createdAt: true, reviewedAt: true });
export const insertEscalationEventSchema = createInsertSchema(escalationEvents).omit({ id: true, createdAt: true });
export const insertResponseTemplateSchema = createInsertSchema(responseTemplates).omit({ id: true, createdAt: true });
export const insertFeatureFlagSchema = createInsertSchema(featureFlags).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAuditEventSchema = createInsertSchema(auditEvents).omit({ id: true, createdAt: true });
export const insertDecisionSettingsSchema = createInsertSchema(decisionSettings).omit({ updatedAt: true });
export const insertHumanDelaySettingsSchema = createInsertSchema(humanDelaySettings).omit({ updatedAt: true });
export const insertTelegramSessionSchema = createInsertSchema(telegramSessions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOnboardingStateSchema = createInsertSchema(onboardingState).omit({ updatedAt: true });
export const insertReadinessReportSchema = createInsertSchema(readinessReports).omit({ id: true, createdAt: true });
export const insertCsatRatingSchema = createInsertSchema(csatRatings).omit({ id: true, createdAt: true }).extend({
  rating: z.number().int().min(1).max(5),
});

export const insertConversionSchema = createInsertSchema(conversions).omit({ id: true, createdAt: true }).extend({
  amount: z.number().positive(),
  currency: z.string().min(1).max(10).optional(),
});

export const insertLostDealSchema = createInsertSchema(lostDeals).omit({ id: true, createdAt: true }).extend({
  reason: z.enum(LOST_DEAL_REASONS),
});

// Types
export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Channel = typeof channels.$inferSelect;
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UserInvite = typeof userInvites.$inferSelect;
export type InsertUserInvite = z.infer<typeof insertUserInviteSchema>;
export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type UpdateCustomer = z.infer<typeof updateCustomerSchema>;
export type CustomerNote = typeof customerNotes.$inferSelect;
export type InsertCustomerNote = z.infer<typeof insertCustomerNoteSchema>;
export type CustomerMemory = typeof customerMemory.$inferSelect;
export type InsertCustomerMemory = z.infer<typeof insertCustomerMemorySchema>;
export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type KnowledgeDoc = typeof knowledgeDocs.$inferSelect;
export type InsertKnowledgeDoc = z.infer<typeof insertKnowledgeDocSchema>;
export type AiSuggestion = typeof aiSuggestions.$inferSelect;
export type InsertAiSuggestion = z.infer<typeof insertAiSuggestionSchema>;
export type HumanAction = typeof humanActions.$inferSelect;
export type InsertHumanAction = z.infer<typeof insertHumanActionSchema>;
export type AiTrainingSample = typeof aiTrainingSamples.$inferSelect;
export type InsertAiTrainingSample = z.infer<typeof insertAiTrainingSampleSchema>;
export type AiTrainingPolicy = typeof aiTrainingPolicies.$inferSelect;
export type InsertAiTrainingPolicy = z.infer<typeof insertAiTrainingPolicySchema>;
export type LearningQueueItem = typeof learningQueue.$inferSelect;
export type InsertLearningQueueItem = z.infer<typeof insertLearningQueueSchema>;
export type EscalationEvent = typeof escalationEvents.$inferSelect;
export type InsertEscalationEvent = z.infer<typeof insertEscalationEventSchema>;
export type ResponseTemplate = typeof responseTemplates.$inferSelect;
export type InsertResponseTemplate = z.infer<typeof insertResponseTemplateSchema>;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type DecisionSettings = typeof decisionSettings.$inferSelect;
export type InsertDecisionSettings = z.infer<typeof insertDecisionSettingsSchema>;
export type HumanDelaySettings = typeof humanDelaySettings.$inferSelect;
export type InsertHumanDelaySettings = z.infer<typeof insertHumanDelaySettingsSchema>;
export type TelegramSession = typeof telegramSessions.$inferSelect;
export type InsertTelegramSession = z.infer<typeof insertTelegramSessionSchema>;
export type OnboardingState = typeof onboardingState.$inferSelect;
export type InsertOnboardingState = z.infer<typeof insertOnboardingStateSchema>;
export type ReadinessReport = typeof readinessReports.$inferSelect;
export type InsertReadinessReport = z.infer<typeof insertReadinessReportSchema>;
export type CsatRating = typeof csatRatings.$inferSelect;
export type InsertCsatRating = z.infer<typeof insertCsatRatingSchema>;
export type Conversion = typeof conversions.$inferSelect;
export type InsertConversion = z.infer<typeof insertConversionSchema>;
export type LostDeal = typeof lostDeals.$inferSelect;
export type InsertLostDeal = z.infer<typeof insertLostDealSchema>;

// CSAT Analytics types
export interface CsatDistribution {
  rating: number;
  count: number;
  percentage: number;
}

export interface CsatBreakdown {
  key: string;
  avgScore: number;
  count: number;
}

export interface CsatAnalytics {
  avgScore: number;
  totalRatings: number;
  distribution: CsatDistribution[];
  byIntent: CsatBreakdown[];
  byDecision: CsatBreakdown[];
  problemIntents: CsatBreakdown[]; // intents with avg < 3.5
}

// Conversion Analytics types
export interface ConversionBreakdown {
  key: string;
  count: number;
  totalRevenue: number;
  avgAmount: number;
}

export interface ConversionAnalytics {
  conversionRate: number; // % of conversations with conversion
  totalConversations: number;
  totalConversions: number;
  totalRevenue: number;
  avgAmount: number;
  currency: string;
  byIntent: ConversionBreakdown[];
  byDecision: ConversionBreakdown[];
  topIntentsByRevenue: ConversionBreakdown[]; // top 5 intents by revenue
  avgTimeToConversion: number | null; // in hours
}

export interface ReadinessCheck {
  code: ReadinessCheckCode;
  status: ReadinessCheckStatus;
  message: string;
  weight: number;
}

// ============ PHASE 0: Conversation State Machine ============
export const CONVERSATION_STATUSES = ["active", "waiting_customer", "waiting_operator", "escalated", "resolved"] as const;
export type ConversationStatus = typeof CONVERSATION_STATUSES[number];

// Valid state transitions
export const CONVERSATION_TRANSITIONS: Record<ConversationStatus, ConversationStatus[]> = {
  active: ["waiting_customer", "waiting_operator", "escalated", "resolved"],
  waiting_customer: ["active", "escalated", "resolved"],
  waiting_operator: ["active", "escalated", "resolved"],
  escalated: ["active", "resolved"],
  resolved: ["active"], // can reopen
};

// ============ PHASE 0: Audit Event Types ============
export const AUDIT_ACTIONS = [
  "suggestion_generated",
  "suggestion_approved",
  "suggestion_edited",
  "suggestion_rejected",
  "message_sent",
  "conversation_created",
  "conversation_status_changed",
  "conversation_escalated",
  "escalation_resolved",
  "escalation_dismissed",
  "product_created",
  "product_updated",
  "product_deleted",
  "knowledge_doc_created",
  "knowledge_doc_updated",
  "knowledge_doc_deleted",
  "tenant_updated",
  "feature_flag_toggled",
  "customer_data_deleted",
  "webhook_verification_failed",
  "rate_limit_exceeded",
] as const;
export type AuditAction = typeof AUDIT_ACTIONS[number];

// ============ PHASE 0: Feature Flag Names ============
export const FEATURE_FLAG_NAMES = [
  "AI_SUGGESTIONS_ENABLED",
  "DECISION_ENGINE_ENABLED",
  "AI_AUTOSEND_ENABLED",
  "HUMAN_DELAY_ENABLED",
  "RAG_ENABLED",
  "FEW_SHOT_LEARNING",
  "TELEGRAM_CHANNEL_ENABLED",
  "TELEGRAM_PERSONAL_CHANNEL_ENABLED",
  "WHATSAPP_CHANNEL_ENABLED",
  "WHATSAPP_PERSONAL_CHANNEL_ENABLED",
  "MAX_CHANNEL_ENABLED",
  "MAX_PERSONAL_CHANNEL_ENABLED",
  "AUTO_PARTS_ENABLED",
  "AI_PRICE_ESTIMATE_ENABLED",
  "PRICE_ESCALATION_ENABLED",
  "GPT_WEB_SEARCH_ENABLED",
] as const;

// ============ Channel Types ============
export const CHANNEL_TYPES = ["mock", "telegram", "telegram_personal", "whatsapp", "whatsapp_personal", "max", "max_personal"] as const;
export type ChannelType = typeof CHANNEL_TYPES[number];
export type FeatureFlagName = typeof FEATURE_FLAG_NAMES[number];

// ============ PHASE 1: Decision Types ============
export const DECISION_TYPES = ["AUTO_SEND", "NEED_APPROVAL", "ESCALATE"] as const;
export type DecisionType = typeof DECISION_TYPES[number];

export const INTENT_TYPES = [
  "price",
  "availability",
  "shipping",
  "return",
  "discount",
  "complaint",
  "other",
  "photo_request",
  "price_objection",
  "ready_to_buy",
  "needs_manual_quote",
  "invalid_vin",
  "marking_provided",
  "payment_blocked",
  "warranty_question",
  "want_visit",
  "what_included",
  "mileage_preference",
] as const;
export type IntentType = typeof INTENT_TYPES[number];

// Vehicle lookup flow intents (request-data steps only; final answers stay need-approval)
export const VEHICLE_LOOKUP_INTENTS = ["vehicle_id_request", "gearbox_tag_request", "gearbox_tag_retry"] as const;
export type VehicleLookupIntentType = typeof VEHICLE_LOOKUP_INTENTS[number];

// Penalty codes for confidence calculation
export const PENALTY_CODES = {
  NO_SOURCES: { code: "NO_SOURCES", message: "Источники не найдены", value: -0.30 },
  INTENT_FORCE_HANDOFF: { code: "INTENT_FORCE_HANDOFF", message: "Интент требует оператора", value: 0 }, // sets decision directly
  PRICE_NOT_FOUND: { code: "PRICE_NOT_FOUND", message: "Цена не найдена в источниках", value: -0.25 },
  AVAILABILITY_NOT_FOUND: { code: "AVAILABILITY_NOT_FOUND", message: "Наличие не подтверждено", value: -0.20 },
  CONFLICTING_SOURCES: { code: "CONFLICTING_SOURCES", message: "Противоречивые данные в источниках", value: -0.20 },
  NEGATIVE_SENTIMENT: { code: "NEGATIVE_SENTIMENT", message: "Негативный настрой клиента", value: -0.15 },
  OUT_OF_SCOPE: { code: "OUT_OF_SCOPE", message: "Вопрос за пределами компетенции", value: -0.40 },
  SELF_CHECK_LOW: { code: "SELF_CHECK_LOW", message: "Модель не уверена в ответе", value: -0.15 },
  STALE_DATA: { code: "STALE_DATA", message: "Данные устарели", value: -0.35 },
  LOW_SIMILARITY: { code: "LOW_SIMILARITY", message: "Низкая релевантность источников", value: -0.25 },
} as const;

export type PenaltyCode = keyof typeof PENALTY_CODES;
export type Penalty = { code: string; message: string; value: number };

// Confidence breakdown for UI display
export type ConfidenceBreakdown = {
  total: number;
  similarity: number;
  intent: number;
  selfCheck: number;
};

// Used source type for UI display
export type UsedSource = {
  type: "product" | "doc";
  id: string;
  title: string;
  quote?: string;
  similarity?: number;
};

// Autosend block reason codes for triple lock
export const AUTOSEND_BLOCK_REASONS = ["FLAG_OFF", "SETTING_OFF", "INTENT_NOT_ALLOWED"] as const;
export type AutosendBlockReason = typeof AUTOSEND_BLOCK_REASONS[number];

// Extended suggestion response for Decision Engine
export type SuggestionResponse = {
  suggestionId: string;
  replyText: string;
  intent: IntentType | null;
  confidence: ConfidenceBreakdown;
  decision: DecisionType;
  explanations: string[];
  penalties: Penalty[];
  missingFields: string[];
  usedSources: UsedSource[];
  sourceConflicts: boolean;
  // Triple lock autosend fields
  autosendEligible: boolean;
  autosendBlockReason?: AutosendBlockReason;
  // Self-check handoff info
  selfCheckNeedHandoff: boolean;
  selfCheckReasons: string[];
};

// Extended types for UI
export type ConversationWithCustomer = Conversation & {
  customer: Customer;
  lastMessage?: Message;
  channel?: Channel;
};

export type ConversationDetail = Conversation & {
  customer: Customer;
  messages: Message[];
  currentSuggestion?: AiSuggestion;
};

// Dashboard metrics type
export type DashboardMetrics = {
  totalConversations: number;
  activeConversations: number;
  escalatedConversations: number;
  resolvedToday: number;
  avgResponseTime: number;
  aiAccuracy: number;
  pendingSuggestions: number;
  productsCount: number;
  knowledgeDocsCount: number;
};

// ============ PHASE 2: Human Delay Types ============
export const DELAY_PROFILE_NAMES = ["SHORT", "MEDIUM", "LONG"] as const;
export type DelayProfileName = typeof DELAY_PROFILE_NAMES[number];

export type DelayProfile = {
  baseMin: number;  // ms
  baseMax: number;  // ms
  typingSpeed: number;  // chars per second
  jitter: number;  // ms
};

export type DelayProfiles = Record<DelayProfileName, DelayProfile>;

export const NIGHT_MODES = ["AUTO_REPLY", "DELAY", "DISABLE"] as const;
export type NightMode = typeof NIGHT_MODES[number];

export type DelayCalculationResult = {
  profileUsed: DelayProfileName;
  calculatedDelayMs: number;
  isNightMode: boolean;
  nightMultiplierApplied: number;
  typingDelayMs: number;
  baseDelayMs: number;
  jitterMs: number;
  finalDelayMs: number;
};

export const DEFAULT_DELAY_PROFILES: DelayProfiles = {
  SHORT: { baseMin: 2000, baseMax: 4000, typingSpeed: 40, jitter: 500 },
  MEDIUM: { baseMin: 4000, baseMax: 8000, typingSpeed: 35, jitter: 1000 },
  LONG: { baseMin: 8000, baseMax: 15000, typingSpeed: 30, jitter: 2000 },
};

// ============ RAG Types ============
export const insertRagDocumentSchema = createInsertSchema(ragDocuments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRagDocument = z.infer<typeof insertRagDocumentSchema>;
export type RagDocument = typeof ragDocuments.$inferSelect;

export const insertRagChunkSchema = createInsertSchema(ragChunks).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRagChunk = z.infer<typeof insertRagChunkSchema>;
export type RagChunk = typeof ragChunks.$inferSelect;

// ============ Phase 8.4: Intent Performance Analytics ============
export type IntentPerformance = {
  intent: string;
  totalConversations: number;
  autosendRate: number;
  escalationRate: number;
  avgConfidence: number;
  csatAvg: number;
  conversionRate: number;
  lostDealRate: number;
  status: "good" | "warning" | "critical";
  recommendation: string;
};

export type IntentAnalytics = {
  intents: IntentPerformance[];
  totalConversations: number;
  totalIntents: number;
};

// Lost Deals Analytics types
export type LostDealsByReason = {
  reason: LostDealReason;
  count: number;
  percentage: number;
};

export type LostDealsByIntent = {
  intent: string;
  count: number;
  percentage: number;
};

export type LostDealsTimelinePoint = {
  date: string; // YYYY-MM-DD
  count: number;
};

export type LostDealsAnalytics = {
  totalLostDeals: number;
  byReason: LostDealsByReason[];
  byIntent: LostDealsByIntent[];
  timeline: LostDealsTimelinePoint[];
};

// ============ AUTH SCHEMA ============
export * from "./models/auth";

// ============ BILLING / SUBSCRIPTIONS ============

// Subscription status state machine
export const SUBSCRIPTION_STATUSES = [
  "trialing",      // Free trial period (72h)
  "active",        // Paid and active
  "past_due",      // Payment failed, grace period
  "canceled",      // User canceled, still active until period end
  "unpaid",        // Payment failed, access restricted
  "incomplete",    // Initial payment pending
  "paused",        // Subscription paused
  "expired",       // Trial or subscription expired, no payment
] as const;

export type SubscriptionStatus = typeof SUBSCRIPTION_STATUSES[number];

// Plans table (single $50/month plan for now)
export const plans = pgTable("plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  stripePriceId: text("stripe_price_id"), // Optional - for Stripe
  stripeProductId: text("stripe_product_id"), // Optional - for Stripe
  amount: integer("amount").notNull(), // in cents (or smallest unit)
  currency: text("currency").notNull().default("usd"),
  cryptoAmount: text("crypto_amount"), // Amount in crypto (e.g., "50" for 50 USDT)
  cryptoAsset: text("crypto_asset").default("USDT"), // BTC, TON, ETH, USDT, etc.
  interval: text("interval").notNull().default("month"), // month, year
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Subscriptions table (one per tenant)
export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id).unique(),
  planId: varchar("plan_id").references(() => plans.id),
  stripeCustomerId: text("stripe_customer_id"), // Optional - for Stripe
  stripeSubscriptionId: text("stripe_subscription_id").unique(), // Optional - for Stripe
  cryptoInvoiceId: text("crypto_invoice_id"), // CryptoBot invoice ID
  paymentProvider: text("payment_provider").default("cryptobot"), // stripe, cryptobot
  status: text("status").notNull().default("incomplete").$type<SubscriptionStatus>(),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),
  canceledAt: timestamp("canceled_at"),
  trialStartedAt: timestamp("trial_started_at"), // When trial began
  trialEndsAt: timestamp("trial_ends_at"), // When trial expires (72h from start)
  trialEnd: timestamp("trial_end"), // Legacy field - kept for compatibility
  hadTrial: boolean("had_trial").default(false), // Whether tenant ever had a trial (prevents multiple trials)
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Subscription grants (manual comping by platform admins)
export const subscriptionGrants = pgTable("subscription_grants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  grantedByUserId: varchar("granted_by_user_id").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  revokedAt: timestamp("revoked_at"), // null = active, set = revoked
  revokedByUserId: varchar("revoked_by_user_id").references(() => users.id),
  revokedReason: text("revoked_reason"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  // Index for active grant lookup: WHERE tenantId = ? AND revokedAt IS NULL AND startsAt <= now AND endsAt >= now
  // Order: tenantId (equality), then time range columns for efficient scans
  index("subscription_grants_active_lookup_idx").on(table.tenantId, table.revokedAt, table.endsAt, table.startsAt),
]);

// Types
export type Plan = typeof plans.$inferSelect;
export type InsertPlan = typeof plans.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

// Insert schemas
export const insertPlanSchema = createInsertSchema(plans).omit({ id: true, createdAt: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true, updatedAt: true });

// Billing status for frontend
export type BillingStatus = {
  hasSubscription: boolean;
  status: SubscriptionStatus | null;
  plan: Plan | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canAccess: boolean; // true if subscription or grant allows access to features
  // Trial-specific fields
  isTrial: boolean;
  trialEndsAt: Date | null;
  trialDaysRemaining: number | null;
  hadTrial: boolean; // true if tenant already used their trial
  // Grant-specific fields (manual comping)
  hasActiveGrant?: boolean;
  grantEndsAt?: Date | null;
};

// ============================================
// ANTI-FRAUD SYSTEM
// ============================================

// Channel types for fingerprinting
export const CHANNEL_FINGERPRINT_TYPES = [
  "telegram",
  "whatsapp_business", 
  "whatsapp_personal",
  "max",
] as const;
export type ChannelFingerprintType = typeof CHANNEL_FINGERPRINT_TYPES[number];

// Fraud flag reasons
export const FRAUD_REASONS = [
  "CHANNEL_REUSE",        // Same channel connected during trial by different tenant
  "MULTI_TRIAL_ATTEMPT",  // User tries to create new tenant after expired trial
  "SUSPICIOUS_ACTIVITY",  // Generic suspicious activity
] as const;
export type FraudReason = typeof FRAUD_REASONS[number];

// Channel fingerprints - stores SHA-256 hashes of channel identifiers
export const channelFingerprints = pgTable("channel_fingerprints", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  channelType: text("channel_type").notNull().$type<ChannelFingerprintType>(),
  fingerprintHash: text("fingerprint_hash").notNull(), // SHA-256 hash of channel identifier
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  firstSeenAt: timestamp("first_seen_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  lastSeenAt: timestamp("last_seen_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  isBlocked: boolean("is_blocked").default(false),
});

// Fraud flags - records of detected fraud attempts
export const fraudFlags = pgTable("fraud_flags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  reason: text("reason").notNull().$type<FraudReason>(),
  metadata: jsonb("metadata").default({}), // Additional context about the fraud attempt
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  resolvedAt: timestamp("resolved_at"), // null = unresolved, timestamp = when resolved by admin
  resolvedBy: varchar("resolved_by").references(() => users.id),
});

// Types
export type ChannelFingerprint = typeof channelFingerprints.$inferSelect;
export type InsertChannelFingerprint = typeof channelFingerprints.$inferInsert;
export type FraudFlag = typeof fraudFlags.$inferSelect;
export type InsertFraudFlag = typeof fraudFlags.$inferInsert;

// Insert schemas
export const insertChannelFingerprintSchema = createInsertSchema(channelFingerprints).omit({ id: true, firstSeenAt: true, lastSeenAt: true });
export const insertFraudFlagSchema = createInsertSchema(fraudFlags).omit({ id: true, createdAt: true });

// ============================================
// SECURE SECRET STORE
// ============================================

export const SECRET_SCOPES = ["global", "tenant"] as const;
export type SecretScope = typeof SECRET_SCOPES[number];

export const integrationSecrets = pgTable("integration_secrets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scope: text("scope").notNull().$type<SecretScope>(),
  tenantId: varchar("tenant_id").references(() => tenants.id),
  keyName: text("key_name").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  encryptionMeta: jsonb("encryption_meta").notNull(),
  last4: text("last_4"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  rotatedAt: timestamp("rotated_at"),
  revokedAt: timestamp("revoked_at"),
  createdByAdminId: varchar("created_by_admin_id").notNull().references(() => users.id),
}, (table) => [
  uniqueIndex("integration_secrets_active_unique_idx")
    .on(sql`${table.scope}`, sql`COALESCE(${table.tenantId}, '')`, sql`${table.keyName}`)
    .where(sql`${table.revokedAt} IS NULL`),
  index("integration_secrets_tenant_key_idx").on(table.tenantId, table.keyName),
]);

export type IntegrationSecret = typeof integrationSecrets.$inferSelect;
export type InsertIntegrationSecret = typeof integrationSecrets.$inferInsert;
export const insertIntegrationSecretSchema = createInsertSchema(integrationSecrets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// ============================================
// SYSTEM UPDATES
// ============================================

export const UPDATE_STATUSES = ["pending", "applied", "failed", "rolled_back"] as const;
export type UpdateStatus = typeof UPDATE_STATUSES[number];

export const updateHistory = pgTable("update_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  version: text("version").notNull(),
  filename: text("filename").notNull(),
  fileSize: integer("file_size").notNull(),
  checksum: text("checksum").notNull(), // SHA-256 hash of the file
  changelog: text("changelog"),
  status: text("status").notNull().$type<UpdateStatus>().default("pending"),
  backupPath: text("backup_path"), // Path to backup created before applying
  appliedAt: timestamp("applied_at"),
  appliedById: varchar("applied_by_id").references(() => users.id),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type UpdateHistory = typeof updateHistory.$inferSelect;
export type InsertUpdateHistory = typeof updateHistory.$inferInsert;
export const insertUpdateHistorySchema = createInsertSchema(updateHistory).omit({
  id: true,
  createdAt: true,
  appliedAt: true,
});

// ============================================
// PROXY MANAGEMENT
// ============================================

export const PROXY_PROTOCOLS = ["http", "https", "socks4", "socks5"] as const;
export type ProxyProtocol = typeof PROXY_PROTOCOLS[number];

export const PROXY_STATUSES = ["available", "assigned", "disabled", "failed"] as const;
export type ProxyStatus = typeof PROXY_STATUSES[number];

export const proxies = pgTable("proxies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  protocol: text("protocol").notNull().$type<ProxyProtocol>().default("socks5"),
  username: text("username"), // optional auth
  password: text("password"), // optional auth (encrypted)
  country: text("country"), // optional: RU, NL, US, etc.
  label: text("label"), // optional: friendly name
  status: text("status").notNull().$type<ProxyStatus>().default("available"),
  assignedTenantId: varchar("assigned_tenant_id").references(() => tenants.id),
  assignedChannelId: varchar("assigned_channel_id").references(() => channels.id),
  lastCheckedAt: timestamp("last_checked_at"),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("proxies_status_idx").on(table.status),
  index("proxies_tenant_idx").on(table.assignedTenantId),
  index("proxies_channel_idx").on(table.assignedChannelId),
]);

export type Proxy = typeof proxies.$inferSelect;
export type InsertProxy = typeof proxies.$inferInsert;
export const insertProxySchema = createInsertSchema(proxies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastCheckedAt: true,
});

// ============================================
// VEHICLE LOOKUP (Podzamenu / VIN/FRAME cache & cases)
// ============================================

export const VEHICLE_LOOKUP_ID_TYPES = ["VIN", "FRAME"] as const;
export type VehicleLookupIdType = typeof VEHICLE_LOOKUP_ID_TYPES[number];

export const VEHICLE_LOOKUP_CASE_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED"] as const;
export type VehicleLookupCaseStatus = typeof VEHICLE_LOOKUP_CASE_STATUSES[number];

export const VEHICLE_LOOKUP_VERIFICATION_STATUSES = [
  "NEED_TAG_OPTIONAL",
  "UNVERIFIED_OEM",
  "VERIFIED_MATCH",
  "MISMATCH",
  "NONE",
] as const;
export type VehicleLookupVerificationStatus = typeof VEHICLE_LOOKUP_VERIFICATION_STATUSES[number];

export const vehicleLookupCache = pgTable(
  "vehicle_lookup_cache",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    lookupKey: text("lookup_key").notNull().unique(),
    idType: text("id_type").notNull().$type<VehicleLookupIdType>(),
    rawValue: text("raw_value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    result: jsonb("result").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    expiresAt: timestamp("expires_at"),
  },
  (table) => [index("vehicle_lookup_cache_normalized_value_idx").on(table.normalizedValue)]
);

export const vehicleLookupCases = pgTable(
  "vehicle_lookup_cases",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
    conversationId: varchar("conversation_id").notNull().references(() => conversations.id),
    messageId: varchar("message_id").references(() => messages.id),
    idType: text("id_type").notNull().$type<VehicleLookupIdType>(),
    rawValue: text("raw_value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    status: text("status").notNull().$type<VehicleLookupCaseStatus>(),
    verificationStatus: text("verification_status").notNull().$type<VehicleLookupVerificationStatus>(),
    cacheId: varchar("cache_id").references(() => vehicleLookupCache.id),
    error: text("error"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("vehicle_lookup_cases_tenant_conversation_idx").on(table.tenantId, table.conversationId),
    index("vehicle_lookup_cases_status_idx").on(table.status),
    index("vehicle_lookup_cases_normalized_value_idx").on(table.normalizedValue),
  ]
);

export type VehicleLookupCache = typeof vehicleLookupCache.$inferSelect;
export type InsertVehicleLookupCache = typeof vehicleLookupCache.$inferInsert;
export type VehicleLookupCase = typeof vehicleLookupCases.$inferSelect;
export type InsertVehicleLookupCase = typeof vehicleLookupCases.$inferInsert;

export const insertVehicleLookupCacheSchema = createInsertSchema(vehicleLookupCache).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertVehicleLookupCaseSchema = createInsertSchema(vehicleLookupCases).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Price Snapshots (cached price lookup results per OEM)
// tenantId is NULLABLE — null means this is a global cache entry shared across all tenants.
// A row with tenantId = null is a global result from OpenAI Web Search, valid for 7 days.
export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").references(() => tenants.id), // null = global cache
    oem: text("oem").notNull(),
    source: text("source").notNull(), // "internal", "avito", "drom", "web", "openai_web_search", "not_found", "mock"
    currency: text("currency").notNull().default("RUB"),
    minPrice: integer("min_price"),
    maxPrice: integer("max_price"),
    avgPrice: integer("avg_price"),
    marketMinPrice: integer("market_min_price"),
    marketMaxPrice: integer("market_max_price"),
    marketAvgPrice: integer("market_avg_price"),
    salePrice: integer("sale_price"),
    marginPct: integer("margin_pct").default(0),
    priceNote: text("price_note"),
    searchKey: text("search_key"),
    // New fields for global OpenAI-based price search
    modelName: text("model_name"),           // e.g. "JATCO JF011E"
    manufacturer: text("manufacturer"),      // e.g. "JATCO", "Aisin", "ZF"
    origin: text("origin"),                  // "japan" | "europe" | "korea" | "unknown"
    mileageMin: integer("mileage_min"),      // lowest mileage found in listings (km)
    mileageMax: integer("mileage_max"),      // highest mileage found in listings (km)
    listingsCount: integer("listings_count").default(0), // number of valid listings found
    searchQuery: text("search_query"),       // query used for web search
    expiresAt: timestamp("expires_at"),      // createdAt + 7 days (or 24h for not_found)
    stage: text("stage"),                    // "yandex" | "escalation" | "not_found"
    urls: text("urls").array(),              // per-listing source URLs
    domains: text("domains").array(),        // unique domains found
    raw: jsonb("raw").default({}),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("price_snapshots_tenant_oem_created_idx").on(table.tenantId, table.oem, table.createdAt),
    index("price_snapshots_oem_created_idx").on(table.oem, table.createdAt),
    index("price_snapshots_search_key_idx").on(table.tenantId, table.searchKey),
    index("idx_price_snapshots_oem_expires").on(table.oem, table.expiresAt),
  ]
);

export type PriceSnapshot = typeof priceSnapshots.$inferSelect;
export type InsertPriceSnapshot = typeof priceSnapshots.$inferInsert;

export const insertPriceSnapshotSchema = createInsertSchema(priceSnapshots).omit({
  id: true,
  createdAt: true,
});

// Internal Prices (tenant's own price list per OEM)
export const internalPrices = pgTable(
  "internal_prices",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
    oem: text("oem").notNull(),
    price: integer("price").notNull(),
    currency: text("currency").notNull().default("RUB"),
    condition: text("condition"), // "used", "new", "contract", etc.
    supplier: text("supplier"),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("internal_prices_tenant_oem_condition_supplier_idx")
      .on(table.tenantId, table.oem, table.condition, table.supplier),
    index("internal_prices_tenant_oem_idx").on(table.tenantId, table.oem),
  ]
);

export type InternalPrice = typeof internalPrices.$inferSelect;
export type InsertInternalPrice = typeof internalPrices.$inferInsert;

export const insertInternalPriceSchema = createInsertSchema(internalPrices).omit({
  id: true,
  updatedAt: true,
});

// ============================================
// MESSAGE TEMPLATES
// ============================================
//
// Template variable reference (static config — not stored in DB):
//   price_result: {{transmission_model}}, {{oem}}, {{min_price}},
//                 {{max_price}}, {{avg_price}}, {{origin}},
//                 {{car_brand}}, {{date}}
//   payment_options: none (free-form content)
//   not_found: none (free-form content)
//   tag_request: none (free-form content)

export const messageTemplates = pgTable("message_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  type: text("type").notNull(), // 'price_result' | 'payment_options' | 'tag_request' | 'not_found'
  name: text("name").notNull(),
  content: text("content").notNull(), // template with {{variables}}
  isActive: boolean("is_active").notNull().default(true),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("message_templates_tenant_type_idx").on(table.tenantId, table.type),
  index("message_templates_tenant_active_idx").on(table.tenantId, table.isActive),
]);

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type InsertMessageTemplate = typeof messageTemplates.$inferInsert;

export const insertMessageTemplateSchema = createInsertSchema(messageTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// ============================================
// PAYMENT METHODS
// ============================================

export const paymentMethods = pgTable("payment_methods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  title: text("title").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("payment_methods_tenant_idx").on(table.tenantId),
  index("payment_methods_tenant_active_idx").on(table.tenantId, table.isActive),
]);

export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type InsertPaymentMethod = typeof paymentMethods.$inferInsert;

export const insertPaymentMethodSchema = createInsertSchema(paymentMethods).omit({
  id: true,
  createdAt: true,
});

// ============================================
// TENANT AGENT SETTINGS
// ============================================
// Per-tenant AI agent configuration — one row per tenant.
// Allows operators to customise agent identity, company facts,
// objection-handling scripts, and the system prompt without
// touching the codebase.

export const tenantAgentSettings = pgTable("tenant_agent_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id).unique(),
  companyName: text("company_name"),
  specialization: text("specialization"),
  warehouseCity: text("warehouse_city"),
  warrantyMonths: integer("warranty_months"),
  warrantyKm: integer("warranty_km"),
  installDays: integer("install_days"),
  qrDiscountPercent: integer("qr_discount_percent"),
  systemPrompt: text("system_prompt"),
  objectionPayment: text("objection_payment"),
  objectionOnline: text("objection_online"),
  closingScript: text("closing_script"),
  customFacts: jsonb("custom_facts").default({}),
  // Mileage tier thresholds for two-step price dialog
  mileageLow: integer("mileage_low"),   // quality tier: mileage ≤ mileageLow (expensive, low mileage)
  mileageMid: integer("mileage_mid"),   // mid tier: mileage ≤ mileageMid; budget tier: mileage > mileageMid
  mileageHigh: integer("mileage_high"), // informational upper bound for budget tier display
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("tenant_agent_settings_tenant_idx").on(table.tenantId),
]);

export type TenantAgentSettings = typeof tenantAgentSettings.$inferSelect;
export type InsertTenantAgentSettings = typeof tenantAgentSettings.$inferInsert;

export const insertTenantAgentSettingsSchema = createInsertSchema(tenantAgentSettings).omit({
  id: true,
  updatedAt: true,
});

// MAX Personal (GREEN-API) accounts — up to 5 per tenant, managed by platform admin only
export const maxPersonalAccounts = pgTable("max_personal_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  // Stable public identifier used in webhook URLs (/:tenantId/:accountId)
  accountId: varchar("account_id").notNull().default(sql`gen_random_uuid()`),
  idInstance: varchar("id_instance").notNull(),
  apiTokenInstance: varchar("api_token_instance").notNull(),
  label: text("label"),
  displayName: text("display_name"),
  status: text("status").notNull().default("unknown"),
  webhookRegistered: boolean("webhook_registered").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  index("max_personal_accounts_tenant_idx").on(table.tenantId),
  uniqueIndex("max_personal_accounts_tenant_instance_unique").on(table.tenantId, table.idInstance),
]);

export type MaxPersonalAccount = typeof maxPersonalAccounts.$inferSelect;
export type InsertMaxPersonalAccount = typeof maxPersonalAccounts.$inferInsert;

export const insertMaxPersonalAccountSchema = createInsertSchema(maxPersonalAccounts).omit({
  id: true,
  accountId: true,
  createdAt: true,
  updatedAt: true,
});

// ============================================
// TRANSMISSION IDENTITY CACHE
// ============================================
// Local OEM → transmission model mapping cache.
// Prevents repeated GPT calls for known OEM codes and eliminates
// hallucinations by serving confirmed identifications from DB.

export const transmissionIdentityCache = pgTable(
  "transmission_identity_cache",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    oem: text("oem").notNull(),
    normalizedOem: text("normalized_oem").notNull(),
    modelName: text("model_name"),
    manufacturer: text("manufacturer"),
    origin: text("origin"),
    confidence: text("confidence").notNull().default("high"),
    hitCount: integer("hit_count").notNull().default(1),
    lastSeenAt: timestamp("last_seen_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    expiresAt: timestamp("expires_at"),
  },
  (table) => [
    uniqueIndex("transmission_identity_cache_normalized_oem_unique").on(table.normalizedOem),
    index("transmission_identity_cache_oem_idx").on(table.oem),
  ]
);

export type TransmissionIdentityCache = typeof transmissionIdentityCache.$inferSelect;
export type InsertTransmissionIdentityCache = typeof transmissionIdentityCache.$inferInsert;

export const insertTransmissionIdentityCacheSchema = createInsertSchema(transmissionIdentityCache).omit({
  id: true,
  hitCount: true,
  lastSeenAt: true,
  createdAt: true,
});
