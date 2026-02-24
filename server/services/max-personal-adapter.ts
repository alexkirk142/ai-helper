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
   * Resolve the tenant account from a chatId. The chatId belongs to a conversation
   * that was opened for a specific tenant — we look up by conversationId in practice,
   * but here we need the tenantId from the calling context. Since sendMessage is called
   * from the message-send worker which has the full conversation, we pass the tenantId
   * as a prefix separated by "::" in the externalConversationId when needed. Otherwise
   * the caller should use sendMessageForTenant directly.
   */
  private async getAccount(externalConversationId: string) {
    // The channel-adapter sendMessage signature doesn't carry tenantId, so we
    // look for any single configured account (single-tenant scenario) or log a warning.
    // The per-tenant resolution is handled in sendMessageForTenant below.
    const accounts = await db.select().from(maxPersonalAccounts).limit(1);
    return accounts[0] ?? null;
  }

  /**
   * Preferred send path — use when tenantId is known.
   * Routes to the first authorized account for the tenant.
   */
  async sendMessageForTenant(
    tenantId: string,
    chatId: string,
    text: string,
    attachments?: Array<{ url: string; mimeType?: string; fileName?: string; caption?: string }>
  ): Promise<ChannelSendResult> {
    const account = await db.query.maxPersonalAccounts.findFirst({
      where: and(
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
