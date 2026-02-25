/**
 * Max Personal Adapter — GREEN-API integration.
 *
 * Credentials (idInstance + apiTokenInstance) are stored in the
 * max_personal_accounts table and managed exclusively by platform admins.
 * Tenants cannot enter or modify credentials themselves.
 */

import type { ChannelAdapter, ParsedIncomingMessage, ChannelSendResult } from "./channel-adapter";
import type { ChannelType } from "@shared/schema";
import { maxGreenApiAdapter } from "./max-green-api-adapter";
import { db } from "../db";
import { maxPersonalAccounts } from "@shared/schema";
import { and, eq } from "drizzle-orm";

export class MaxPersonalAdapter implements ChannelAdapter {
  readonly name: ChannelType = "max_personal";

  async sendMessage(
    externalConversationId: string,
    text: string,
    _options?: { replyToMessageId?: string }
  ): Promise<ChannelSendResult> {
    const account = await this.getAccount(externalConversationId);
    if (!account) {
      return { success: false, error: "No MAX Personal account connected for this tenant" };
    }

    try {
      const result = await maxGreenApiAdapter.sendMessage(
        account.idInstance,
        account.apiTokenInstance,
        externalConversationId,
        text
      );
      return {
        success: true,
        externalMessageId: result.idMessage,
        timestamp: new Date(),
      };
    } catch (error: any) {
      console.error("[MaxPersonal] sendMessage error:", error.message);
      return { success: false, error: error.message };
    }
  }

  parseIncomingMessage(rawPayload: unknown): ParsedIncomingMessage | null {
    // Incoming messages arrive via the /webhooks/max-personal/:tenantId endpoint
    // and are parsed there before calling processIncomingMessageFull().
    // This method is kept for compatibility with the ChannelAdapter interface.
    if (!rawPayload || typeof rawPayload !== "object") return null;

    const payload = rawPayload as Record<string, unknown>;
    const chatId = String(payload.chatId || "");
    if (!chatId) return null;

    return {
      externalMessageId: String(payload.idMessage || `mp_${Date.now()}`),
      externalConversationId: chatId,
      externalUserId: String(payload.sender || chatId),
      text: String(payload.text || ""),
      timestamp: new Date(),
      channel: "max_personal",
      metadata: payload.metadata as Record<string, unknown> | undefined,
    };
  }

  /**
   * Resolve the tenant account from an externalConversationId.
   * Callers should prefer `sendMessageForTenant` which carries an explicit tenantId.
   * This method supports an optional "tenantId::chatId" encoding for contexts where
   * only the generic sendMessage interface is available (e.g. message-send worker).
   */
  private async getAccount(externalConversationId: string) {
    const parts = externalConversationId.split("::");
    if (parts.length === 2) {
      const tenantId = parts[0];
      const accounts = await db
        .select()
        .from(maxPersonalAccounts)
        .where(and(eq(maxPersonalAccounts.tenantId, tenantId), eq(maxPersonalAccounts.status, "authorized")))
        .limit(1);
      return accounts[0] ?? null;
    }
    console.warn("[MaxPersonal] getAccount() called without tenantId encoding — tenantId is required. Use sendMessageForTenant() for all calls.");
    throw new Error("[MaxPersonalAdapter] tenantId is required to resolve account. Cross-tenant fallback has been removed.");
  }

  /**
   * Preferred send path — use when tenantId is known.
   * Pass `accountId` (the webhook UUID) to route through a specific account when the
   * tenant has multiple MAX Personal accounts configured.
   */
  async sendMessageForTenant(
    tenantId: string,
    chatId: string,
    text: string,
    attachments?: Array<{ url: string; mimeType?: string; fileName?: string; caption?: string }>,
    accountId?: string,
  ): Promise<ChannelSendResult> {
    const account = await db.query.maxPersonalAccounts.findFirst({
      where: accountId
        ? and(
            eq(maxPersonalAccounts.tenantId, tenantId),
            eq(maxPersonalAccounts.accountId, accountId),
            eq(maxPersonalAccounts.status, "authorized"),
          )
        : and(
            eq(maxPersonalAccounts.tenantId, tenantId),
            eq(maxPersonalAccounts.status, "authorized"),
          ),
    });
    if (!account) {
      return { success: false, error: "No MAX Personal account connected" };
    }

    try {
      if (attachments && attachments.length > 0) {
        const att = attachments[0];
        const buf = await fetch(att.url)
          .then((r) => r.arrayBuffer())
          .then((ab) => Buffer.from(ab));
        const result = await maxGreenApiAdapter.sendFile(
          account.idInstance,
          account.apiTokenInstance,
          chatId,
          buf,
          att.mimeType ?? "application/octet-stream",
          att.fileName ?? "file",
          att.caption
        );
        return { success: true, externalMessageId: result.idMessage, timestamp: new Date() };
      }

      const result = await maxGreenApiAdapter.sendMessage(
        account.idInstance,
        account.apiTokenInstance,
        chatId,
        text
      );
      return { success: true, externalMessageId: result.idMessage, timestamp: new Date() };
    } catch (error: any) {
      console.error("[MaxPersonal] sendMessageForTenant error:", error.message);
      return { success: false, error: error.message };
    }
  }
}

export const maxPersonalAdapter = new MaxPersonalAdapter();
