/**
 * MAX Gateway SSE Manager
 *
 * Subscribes to /instances/{id}/events for each gateway-backed MAX Personal account.
 * Handles the `deleted` event: when the gateway removes an instance server-side,
 * the corresponding DB record is updated to status="deleted" and the SSE connection closed.
 *
 * Lifecycle:
 *   - initializeAll()       — call once at app startup
 *   - subscribe(instanceId) — call after creating a new gateway account
 *   - unsubscribe(instanceId) — call before intentionally deleting an account locally
 *     (prevents a reconnect race between local DELETE and the incoming SSE event)
 */

import { db } from "../db";
import { maxPersonalAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { maxGatewayClient } from "./max-gateway-client";

interface Connection {
  controller: AbortController;
  instanceId: string;
}

const RECONNECT_INITIAL_MS = 3_000;
const RECONNECT_MAX_MS = 120_000;

class MaxGatewaySSEManager {
  private connections = new Map<string, Connection>();

  /**
   * Load all gateway accounts from the DB and start an SSE subscription for each.
   * Called once at app startup after the server is ready.
   */
  async initializeAll(): Promise<void> {
    let rows: { idInstance: string }[];
    try {
      rows = await db
        .select({ idInstance: maxPersonalAccounts.idInstance })
        .from(maxPersonalAccounts)
        .where(eq(maxPersonalAccounts.provider, "max_gateway"));
    } catch (err: any) {
      console.error("[GatewaySSE] Failed to load accounts for SSE init:", err.message);
      return;
    }

    for (const row of rows) {
      this.subscribe(row.idInstance);
    }

    if (rows.length > 0) {
      console.log(`[GatewaySSE] Subscribed to ${rows.length} instance(s)`);
    }
  }

  /**
   * Start watching an instance. Idempotent — safe to call multiple times for the same id.
   */
  subscribe(instanceId: string): void {
    if (this.connections.has(instanceId)) return;

    const controller = new AbortController();
    this.connections.set(instanceId, { controller, instanceId });

    // Run in background — never awaited so it doesn't block callers
    this.runWithReconnect(instanceId, controller.signal).catch(() => {});
  }

  /**
   * Stop watching an instance. Does nothing if not subscribed.
   */
  unsubscribe(instanceId: string): void {
    const conn = this.connections.get(instanceId);
    if (!conn) return;
    conn.controller.abort();
    this.connections.delete(instanceId);
  }

  private async runWithReconnect(instanceId: string, signal: AbortSignal): Promise<void> {
    let delayMs = RECONNECT_INITIAL_MS;

    while (!signal.aborted) {
      try {
        const res = await maxGatewayClient.openInstanceEventsStream(instanceId, signal);
        // Connection established — reset backoff
        delayMs = RECONNECT_INITIAL_MS;
        await this.consumeStream(res, instanceId, signal);
      } catch (err: any) {
        if (signal.aborted) return;
        if (err.name === "AbortError") return;
        console.warn(`[GatewaySSE] ${instanceId}: stream error — ${err.message}. Reconnecting in ${delayMs}ms…`);
      }

      if (signal.aborted) return;

      // Wait before reconnecting with exponential backoff
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delayMs);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      delayMs = Math.min(delayMs * 2, RECONNECT_MAX_MS);
    }
  }

  /**
   * Read the SSE stream and dispatch events until the connection closes or signal aborts.
   */
  private async consumeStream(
    response: Response,
    instanceId: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    let currentData = "";

    const cleanup = () => { reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cleanup, { once: true });

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            currentData += line.slice(5).trim();
          } else if (line === "") {
            // Blank line — dispatch the event
            if (currentData !== "" || currentEvent !== "message") {
              await this.handleEvent(instanceId, currentEvent, currentData, signal);
            }
            currentEvent = "message";
            currentData = "";
          }
        }
      }
    } finally {
      signal.removeEventListener("abort", cleanup);
      reader.cancel().catch(() => {});
    }
  }

  private async handleEvent(
    instanceId: string,
    event: string,
    data: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return;

    switch (event) {
      case "deleted":
        console.log(`[GatewaySSE] Instance ${instanceId} deleted by gateway — removing from DB`);
        await this.handleDeletedEvent(instanceId);
        // Stop reconnecting — instance is gone
        this.unsubscribe(instanceId);
        break;

      case "stateInstanceChanged": {
        let state: Record<string, unknown> = {};
        try { state = JSON.parse(data); } catch { /* ignore malformed data */ }
        const authenticated = Boolean(state.authenticated);
        const newStatus = authenticated ? "authorized" : "notAuthorized";
        try {
          await db
            .update(maxPersonalAccounts)
            .set({ status: newStatus, updatedAt: new Date() })
            .where(eq(maxPersonalAccounts.idInstance, instanceId));
          console.log(`[GatewaySSE] ${instanceId} stateInstanceChanged → ${newStatus}`);
        } catch (err: any) {
          console.error(`[GatewaySSE] ${instanceId} DB update failed:`, err.message);
        }
        break;
      }

      default:
        // Ignore unrecognised events
        break;
    }
  }

  private async handleDeletedEvent(instanceId: string): Promise<void> {
    try {
      await db
        .update(maxPersonalAccounts)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(eq(maxPersonalAccounts.idInstance, instanceId));
    } catch (err: any) {
      console.error(`[GatewaySSE] Failed to mark ${instanceId} as deleted:`, err.message);
    }
  }
}

export const gatewaySSEManager = new MaxGatewaySSEManager();
