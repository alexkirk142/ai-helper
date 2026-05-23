import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Returns a backend-proxied avatar URL for a customer, or null if unavailable.
 *
 * - max_personal    — proxied via /api/channels/max-personal/:accountId/media/photo
 *                     (raw i.oneme.ru CDN URL stored in customer.metadata.avatarUrl)
 * - whatsapp_personal — proxied via /api/whatsapp-personal/avatar?jid=...
 *                     (Baileys profilePictureUrl, fetched on-demand per request)
 * - telegram_personal — proxied via /api/telegram-personal/avatar/:accountId/:userId
 *                     (gramjs downloadProfilePhoto, cached 24h)
 */
export function getCustomerAvatarUrl(
  customer: { channel?: string | null; metadata?: unknown; externalId?: string | null } | null | undefined,
): string | null {
  if (!customer) return null;
  const meta = customer.metadata as Record<string, unknown> | null | undefined;

  if (customer.channel === "max_personal") {
    const avatarUrl = meta?.avatarUrl as string | undefined;
    const maxAccountId = meta?.maxAccountId as string | undefined;
    if (!avatarUrl || !maxAccountId) return null;
    return `/api/channels/max-personal/${maxAccountId}/media/photo?url=${encodeURIComponent(avatarUrl)}`;
  }

  if (customer.channel === "whatsapp_personal") {
    const jid = customer.externalId;
    // Skip LID contacts — profilePictureUrl on @lid is unreliable
    if (!jid || jid.endsWith("@lid")) return null;
    return `/api/whatsapp-personal/avatar?jid=${encodeURIComponent(jid)}`;
  }

  if (customer.channel === "telegram_personal") {
    const accountId = meta?.accountId as string | undefined;
    const userId = customer.externalId;
    if (!accountId || !userId) return null;
    return `/api/telegram-personal/avatar/${encodeURIComponent(accountId)}/${encodeURIComponent(userId)}`;
  }

  return null;
}

/** @deprecated Use getCustomerAvatarUrl instead */
export function getMaxAvatarUrl(
  customer: { channel?: string | null; metadata?: unknown; externalId?: string | null } | null | undefined,
): string | null {
  return getCustomerAvatarUrl(customer);
}
