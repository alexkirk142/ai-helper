import { AsyncLocalStorage } from "async_hooks";
import { desc, eq, and, or, sql } from "drizzle-orm";
import { db } from "../db";
import { auditEvents } from "@shared/schema";
import type { AuditEvent, AuditAction } from "@shared/schema";
import { randomUUID } from "crypto";
import { sanitizeDeep } from "../utils/sanitizer";

interface AuditContext {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  tenantId?: string;
}

type AuditEventInsertRow = typeof auditEvents.$inferInsert;

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 500;

class AuditLogService {
  private readonly _als = new AsyncLocalStorage<AuditContext>();
  private _buffer: AuditEventInsertRow[] = [];
  private readonly _flushTimer: NodeJS.Timeout;

  constructor() {
    this._flushTimer = setInterval(() => {
      this._flush().catch((err) =>
        console.error(
          JSON.stringify({ level: "error", type: "audit", msg: "Flush failed", err: String(err) })
        )
      );
    }, FLUSH_INTERVAL_MS);
    // Allow process to exit even if the flush timer is still pending.
    this._flushTimer.unref();
  }

  /**
   * Run fn within a fresh per-request ALS context.
   * Call this from request middleware so that every async operation
   * triggered downstream inherits an isolated, request-scoped context.
   */
  runWithContext<T>(ctx: AuditContext, fn: () => T): T {
    return this._als.run({ ...ctx }, fn);
  }

  /**
   * Merge additional fields into the current request's ALS context.
   * Safe to call from route handlers after middleware has set up the store.
   * Outside a request (background jobs), this is a no-op.
   */
  setContext(ctx: AuditContext): void {
    const store = this._als.getStore();
    if (store) {
      Object.assign(store, ctx);
    }
  }

  /**
   * Clear all fields in the current request's ALS context.
   * With ALS the context is naturally scoped to the runWithContext() call,
   * so manual clearing is rarely needed — this method exists for API compatibility.
   */
  clearContext(): void {
    const store = this._als.getStore();
    if (store) {
      store.requestId = undefined;
      store.ipAddress = undefined;
      store.userAgent = undefined;
      store.tenantId = undefined;
    }
  }

  private _currentContext(): AuditContext {
    return this._als.getStore() ?? {};
  }

  private async _flush(): Promise<void> {
    if (this._buffer.length === 0) return;
    const batch = this._buffer.splice(0, this._buffer.length);
    try {
      await db.insert(auditEvents).values(batch);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          type: "audit",
          msg: "DB insert failed",
          count: batch.length,
          err: String(err),
        })
      );
      // Re-queue failed rows at the front of the buffer to preserve order,
      // capped to avoid runaway memory growth.
      const cap = Math.max(0, 500 - this._buffer.length);
      this._buffer.unshift(...batch.slice(0, cap));
    }
  }

  async log(
    action: AuditAction,
    entityType: string,
    entityId: string,
    actor: string,
    actorType: "user" | "system" | "ai",
    metadata?: Record<string, unknown>
  ): Promise<AuditEvent> {
    const ctx = this._currentContext();
    const sanitizedMetadata = metadata ? sanitizeDeep(metadata) : {};
    const now = new Date();
    const id = randomUUID();

    const event: AuditEvent = {
      id,
      tenantId: ctx.tenantId ?? null,
      actor,
      actorType,
      action,
      entityType,
      entityId,
      metadata: sanitizedMetadata,
      requestId: ctx.requestId ?? null,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      createdAt: now,
    };

    // Emit structured log immediately for real-time observability.
    console.log(
      JSON.stringify({
        level: "info",
        type: "audit",
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        actor: event.actor,
        actorType: event.actorType,
        requestId: event.requestId,
        timestamp: now.toISOString(),
      })
    );

    // Buffer for batch insert to PostgreSQL.
    this._buffer.push({
      id: event.id,
      tenantId: event.tenantId,
      actor: event.actor,
      actorType: event.actorType,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata as Record<string, unknown>,
      requestId: event.requestId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
    });

    if (this._buffer.length >= BATCH_SIZE) {
      this._flush().catch((err) =>
        console.error(
          JSON.stringify({ level: "error", type: "audit", msg: "Eager flush failed", err: String(err) })
        )
      );
    }

    return event;
  }

  // Convenience methods for common actions

  async logSuggestionGenerated(
    suggestionId: string,
    conversationId: string,
    metadata?: Record<string, unknown>
  ): Promise<AuditEvent> {
    return this.log(
      "suggestion_generated",
      "suggestion",
      suggestionId,
      "system",
      "ai",
      { conversationId, ...metadata }
    );
  }

  async logSuggestionApproved(
    suggestionId: string,
    userId: string,
    metadata?: Record<string, unknown>
  ): Promise<AuditEvent> {
    return this.log(
      "suggestion_approved",
      "suggestion",
      suggestionId,
      userId,
      "user",
      metadata
    );
  }

  async logSuggestionEdited(
    suggestionId: string,
    userId: string,
    originalText: string,
    editedText: string
  ): Promise<AuditEvent> {
    return this.log(
      "suggestion_edited",
      "suggestion",
      suggestionId,
      userId,
      "user",
      { originalText, editedText }
    );
  }

  async logSuggestionRejected(
    suggestionId: string,
    userId: string,
    reason?: string
  ): Promise<AuditEvent> {
    return this.log(
      "suggestion_rejected",
      "suggestion",
      suggestionId,
      userId,
      "user",
      { reason }
    );
  }

  async logMessageSent(
    messageId: string,
    conversationId: string,
    actor: string,
    actorType: "user" | "ai"
  ): Promise<AuditEvent> {
    return this.log(
      "message_sent",
      "message",
      messageId,
      actor,
      actorType,
      { conversationId }
    );
  }

  async logConversationEscalated(
    conversationId: string,
    escalationId: string,
    reason: string,
    userId?: string
  ): Promise<AuditEvent> {
    return this.log(
      "conversation_escalated",
      "conversation",
      conversationId,
      userId || "system",
      userId ? "user" : "system",
      { escalationId, reason }
    );
  }

  async logEscalationResolved(
    escalationId: string,
    conversationId: string,
    userId: string,
    resolution: "handled" | "dismissed"
  ): Promise<AuditEvent> {
    const action = resolution === "handled" ? "escalation_resolved" : "escalation_dismissed";
    return this.log(
      action,
      "escalation",
      escalationId,
      userId,
      "user",
      { conversationId }
    );
  }

  async logConversationStatusChanged(
    conversationId: string,
    fromStatus: string,
    toStatus: string,
    actor: string,
    actorType: "user" | "system"
  ): Promise<AuditEvent> {
    return this.log(
      "conversation_status_changed",
      "conversation",
      conversationId,
      actor,
      actorType,
      { fromStatus, toStatus }
    );
  }

  async logFeatureFlagToggled(
    flagName: string,
    enabled: boolean,
    userId: string,
    tenantId?: string
  ): Promise<AuditEvent> {
    return this.log(
      "feature_flag_toggled",
      "feature_flag",
      flagName,
      userId,
      "user",
      { enabled, tenantId }
    );
  }

  // Query methods — read from PostgreSQL

  async getEventsByEntity(
    entityType: string,
    entityId: string,
    limit = 50
  ): Promise<AuditEvent[]> {
    return db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
  }

  async getEventsByConversation(conversationId: string, limit = 50): Promise<AuditEvent[]> {
    return db
      .select()
      .from(auditEvents)
      .where(
        or(
          and(
            eq(auditEvents.entityType, "conversation"),
            eq(auditEvents.entityId, conversationId)
          ),
          // Include events for related entities (suggestions, messages) that carry conversationId
          // in their JSONB metadata field.
          sql`${auditEvents.metadata}->>'conversationId' = ${conversationId}`
        )
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
  }

  async getRecentEvents(tenantId: string, limit = 100): Promise<AuditEvent[]> {
    return db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenantId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
  }

  async getAllEvents(limit = 1000): Promise<AuditEvent[]> {
    return db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
  }
}

// Singleton instance
export const auditLog = new AuditLogService();
