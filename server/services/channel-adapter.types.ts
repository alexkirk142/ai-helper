/**
 * Shared types for channel adapters.
 * Import from here instead of channel-adapter.ts to avoid circular dependencies.
 */
import type { ChannelType } from "@shared/schema";

export interface ChannelSendResult {
  success: boolean;
  externalMessageId?: string;
  error?: string;
  timestamp?: Date;
}

export interface ParsedAttachment {
  type: "image" | "voice" | "audio" | "video" | "video_note" | "document" | "sticker" | "poll";
  url?: string;
  fileId?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  duration?: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  pollQuestion?: string;
  pollOptions?: string[];
}

export interface ParsedIncomingMessage {
  externalMessageId: string;
  externalConversationId: string;
  externalUserId: string;
  text: string;
  timestamp: Date;
  channel: ChannelType;
  metadata?: Record<string, unknown>;
  attachments?: ParsedAttachment[];
  forwardedFrom?: {
    name?: string;
    username?: string;
    date?: number;
  };
}

export interface WebhookVerifyResult {
  valid: boolean;
  challenge?: string;
  error?: string;
}

export interface ChannelAdapter {
  readonly name: ChannelType;

  sendMessage(
    externalConversationId: string,
    text: string,
    options?: { replyToMessageId?: string }
  ): Promise<ChannelSendResult>;

  parseIncomingMessage(rawPayload: unknown): ParsedIncomingMessage | null;

  sendTypingStart?(externalConversationId: string): Promise<void>;

  sendTypingStop?(externalConversationId: string): Promise<void>;

  verifyWebhook?(
    headers: Record<string, string>,
    body: unknown,
    secret?: string
  ): WebhookVerifyResult;
}
