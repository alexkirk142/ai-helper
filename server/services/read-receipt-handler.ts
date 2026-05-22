/**
 * Shared read-receipt handler.
 *
 * Called when a contact reads our outgoing messages on any personal channel
 * (MAX Personal, WhatsApp Personal, Telegram Personal).
 *
 * Responsibilities:
 *  1. Resolve externalUserId → Customer
 *  2. Find their most recent Conversation
 *  3. Update conversations.last_read_at
 *  4. Broadcast message_read WS event to all connected operators of the tenant
 */
import { db } from "../db";
import { conversations } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { storage } from "../storage";
import { realtimeService } from "./websocket-server";
import type { ChannelType } from "@shared/schema";

/**
 * Mark the most recent conversation of a customer as read up to `readAt`.
 *
 * @param tenantId   - UUID of the tenant
 * @param channel    - channel type ("max_personal" | "whatsapp_personal" | "telegram_personal")
 * @param externalId - customer's externalId as stored in DB (e.g. "79001234567@c.us", "123456789")
 * @param readAt     - when the contact read the messages
 */
export async function handleIncomingReadReceipt(
  tenantId: string,
  channel: ChannelType,
  externalId: string,
  readAt: Date,
): Promise<void> {
  const customer = await storage.getCustomerByExternalId(tenantId, channel, externalId);

  if (!customer) {
    console.log(`[ReadReceipt] No customer for channel=${channel} externalId=${externalId} tenant=${tenantId}`);
    return;
  }

  const conversation = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.tenantId, tenantId),
      eq(conversations.customerId, customer.id),
    ),
    orderBy: (conv, { desc }) => [desc(conv.lastMessageAt)],
  });

  if (!conversation) {
    console.log(`[ReadReceipt] No conversation for customerId=${customer.id} tenant=${tenantId}`);
    return;
  }

  // Only update if the new read mark is newer than the stored one
  if (conversation.lastReadAt && conversation.lastReadAt >= readAt) {
    return;
  }

  await db.update(conversations)
    .set({ lastReadAt: readAt, updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id));

  console.log(`[ReadReceipt] Updated lastReadAt=${readAt.toISOString()} for conversation=${conversation.id} (${channel} customer=${customer.id})`);

  realtimeService.broadcastMessageRead(tenantId, conversation.id, readAt);
}
