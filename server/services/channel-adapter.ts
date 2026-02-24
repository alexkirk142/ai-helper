import type { ChannelType, FeatureFlagName } from "@shared/schema";
import { featureFlagService } from "./feature-flags";
import { auditLog } from "./audit-log";
import { MaxAdapter } from "./max-adapter";
import { TelegramAdapter } from "./telegram-adapter";
import { whatsappAdapter } from "./whatsapp-adapter";
import { WhatsAppPersonalAdapter } from "./whatsapp-personal-adapter";
import { maxPersonalAdapter } from "./max-personal-adapter";

// ============ Channel Adapter Interface ============

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

// ============ Channel Registry ============

const CHANNEL_FLAG_MAP: Record<ChannelType, FeatureFlagName | null> = {
  mock: null,
  telegram: "TELEGRAM_CHANNEL_ENABLED",
  telegram_personal: "TELEGRAM_PERSONAL_CHANNEL_ENABLED",
  whatsapp: "WHATSAPP_CHANNEL_ENABLED",
  whatsapp_personal: "WHATSAPP_PERSONAL_CHANNEL_ENABLED",
  max: "MAX_CHANNEL_ENABLED",
  max_personal: "MAX_PERSONAL_CHANNEL_ENABLED",
};

class ChannelRegistry {
  private adapters: Map<ChannelType, ChannelAdapter> = new Map();
  private mockAdapter: ChannelAdapter | null = null;

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.name, adapter);
    if (adapter.name === "mock") {
      this.mockAdapter = adapter;
    }
    console.log(`[ChannelRegistry] Registered adapter: ${adapter.name}`);
  }

  unregister(channelType: ChannelType): void {
    this.adapters.delete(channelType);
    console.log(`[ChannelRegistry] Unregistered adapter: ${channelType}`);
  }

  async getAdapter(
    channelType: ChannelType,
    tenantId?: string
  ): Promise<{ adapter: ChannelAdapter | null; disabled: boolean; reason?: string }> {
    const featureFlag = CHANNEL_FLAG_MAP[channelType];

    if (featureFlag) {
      const isEnabled = await featureFlagService.isEnabled(featureFlag, tenantId);
      if (!isEnabled) {
        return {
          adapter: null,
          disabled: true,
          reason: `Channel ${channelType} is disabled by feature flag ${featureFlag}`,
        };
      }
    }

    const adapter = this.adapters.get(channelType);
    if (!adapter) {
      return {
        adapter: null,
        disabled: false,
        reason: `No adapter registered for channel: ${channelType}`,
      };
    }

    return { adapter, disabled: false };
  }

  getAdapterSync(channelType: ChannelType): ChannelAdapter {
    const adapter = this.adapters.get(channelType);
    if (adapter) return adapter;

    console.warn(`[ChannelRegistry] Unknown channel: ${channelType}, using mock`);
    return this.mockAdapter || new MockChannelAdapter();
  }

  listRegistered(): ChannelType[] {
    return Array.from(this.adapters.keys());
  }

  async listEnabled(tenantId?: string): Promise<ChannelType[]> {
    const enabled: ChannelType[] = [];
    const channelTypes = Array.from(this.adapters.keys());
    for (const channelType of channelTypes) {
      const { disabled } = await this.getAdapter(channelType, tenantId);
      if (!disabled) {
        enabled.push(channelType);
      }
    }
    return enabled;
  }
}

export const channelRegistry = new ChannelRegistry();

// ============ Mock Channel Adapter ============

class MockChannelAdapter implements ChannelAdapter {
  readonly name: ChannelType = "mock";

  async sendMessage(
    externalConversationId: string,
    text: string,
    options?: { replyToMessageId?: string }
  ): Promise<ChannelSendResult> {
    console.log(
      `[MockChannel] Sending to ${externalConversationId}: "${text.substring(0, 50)}..."`
    );
    return {
      success: true,
      externalMessageId: `mock_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      timestamp: new Date(),
    };
  }

  parseIncomingMessage(rawPayload: unknown): ParsedIncomingMessage | null {
    if (!rawPayload || typeof rawPayload !== "object") return null;

    const payload = rawPayload as Record<string, unknown>;
    if (!payload.text || !payload.userId) return null;

    return {
      externalMessageId: String(payload.messageId || `mock_in_${Date.now()}`),
      externalConversationId: String(payload.conversationId || payload.userId),
      externalUserId: String(payload.userId),
      text: String(payload.text),
      timestamp: new Date(),
      channel: "mock",
      metadata: payload.metadata as Record<string, unknown> | undefined,
    };
  }

  async sendTypingStart(externalConversationId: string): Promise<void> {
    console.log(`[MockChannel] Typing started: ${externalConversationId}`);
  }

  async sendTypingStop(externalConversationId: string): Promise<void> {
    console.log(`[MockChannel] Typing stopped: ${externalConversationId}`);
  }

  verifyWebhook(): WebhookVerifyResult {
    return { valid: true };
  }
}

// ============ Stub Adapters (NO real API calls) ============

class TelegramStubAdapter implements ChannelAdapter {
  readonly name: ChannelType = "telegram";

  async sendMessage(
    externalConversationId: string,
    text: string,
    options?: { replyToMessageId?: string }
  ): Promise<ChannelSendResult> {
    console.log(`[TelegramStub] Would send to chat ${externalConversationId}`);
    return {
      success: true,
      externalMessageId: `tg_stub_${Date.now()}`,
      timestamp: new Date(),
    };
  }

  parseIncomingMessage(rawPayload: unknown): ParsedIncomingMessage | null {
    if (!rawPayload || typeof rawPayload !== "object") return null;

    const payload = rawPayload as Record<string, unknown>;
    const message = payload.message as Record<string, unknown> | undefined;
    if (!message) return null;

    const chat = message.chat as Record<string, unknown> | undefined;
    const from = message.from as Record<string, unknown> | undefined;
    if (!chat || !from || !message.text) return null;

    return {
      externalMessageId: String(message.message_id),
      externalConversationId: String(chat.id),
      externalUserId: String(from.id),
      text: String(message.text),
      timestamp: new Date((message.date as number) * 1000),
      channel: "telegram",
      metadata: {
        chatType: chat.type,
        firstName: from.first_name,
        lastName: from.last_name,
        username: from.username,
      },
    };
  }

  async sendTypingStart(externalConversationId: string): Promise<void> {
    console.log(`[TelegramStub] Would send typing action to ${externalConversationId}`);
  }

  verifyWebhook(
    headers: Record<string, string>,
    body: unknown,
    secret?: string
  ): WebhookVerifyResult {
    return { valid: true };
  }
}

class WhatsAppStubAdapter implements ChannelAdapter {
  readonly name: ChannelType = "whatsapp";

  async sendMessage(
    externalConversationId: string,
    text: string,
    options?: { replyToMessageId?: string }
  ): Promise<ChannelSendResult> {
    console.log(`[WhatsAppStub] Would send to ${externalConversationId}`);
    return {
      success: true,
      externalMessageId: `wa_stub_${Date.now()}`,
      timestamp: new Date(),
    };
  }

  parseIncomingMessage(rawPayload: unknown): ParsedIncomingMessage | null {
    if (!rawPayload || typeof rawPayload !== "object") return null;

    const payload = rawPayload as Record<string, unknown>;
    const entry = (payload.entry as unknown[])?.at(0) as Record<string, unknown> | undefined;
    const changes = (entry?.changes as unknown[])?.at(0) as Record<string, unknown> | undefined;
    const value = changes?.value as Record<string, unknown> | undefined;
    const messages = value?.messages as unknown[] | undefined;
    const message = messages?.at(0) as Record<string, unknown> | undefined;

    if (!message || message.type !== "text") return null;

    const textObj = message.text as Record<string, unknown>;

    return {
      externalMessageId: String(message.id),
      externalConversationId: String(message.from),
      externalUserId: String(message.from),
      text: String(textObj?.body || ""),
      timestamp: new Date(Number(message.timestamp) * 1000),
      channel: "whatsapp",
      metadata: {
        phoneNumberId: value?.metadata,
      },
    };
  }

  verifyWebhook(
    headers: Record<string, string>,
    body: unknown,
    secret?: string
  ): WebhookVerifyResult {
    return { valid: true };
  }
}

class MaxStubAdapter implements ChannelAdapter {
  readonly name: ChannelType = "max";

  async sendMessage(
    externalConversationId: string,
    text: string,
    options?: { replyToMessageId?: string }
  ): Promise<ChannelSendResult> {
    console.log(`[MaxStub] Would send to ${externalConversationId}`);
    return {
      success: true,
      externalMessageId: `max_stub_${Date.now()}`,
      timestamp: new Date(),
    };
  }

  parseIncomingMessage(rawPayload: unknown): ParsedIncomingMessage | null {
    if (!rawPayload || typeof rawPayload !== "object") return null;

    const payload = rawPayload as Record<string, unknown>;
    const message = payload.message as Record<string, unknown> | undefined;
    if (!message) return null;

    return {
      externalMessageId: String(message.mid || `max_in_${Date.now()}`),
      externalConversationId: String(message.chat_id),
      externalUserId: String(message.from),
      text: String(message.text || ""),
      timestamp: new Date(),
      channel: "max",
    };
  }

  async sendTypingStart(externalConversationId: string): Promise<void> {
    console.log(`[MaxStub] Would send typing to ${externalConversationId}`);
  }

  verifyWebhook(): WebhookVerifyResult {
    return { valid: true };
  }
}

// ============ Inbound Flow ============

export interface InboundFlowResult {
  success: boolean;
  parsed?: ParsedIncomingMessage;
  conversationId?: string;
  messageId?: string;
  error?: string;
}

export async function processInboundMessage(
  channelType: ChannelType,
  rawPayload: unknown,
  tenantId?: string
): Promise<InboundFlowResult> {
  const { adapter, disabled, reason } = await channelRegistry.getAdapter(channelType, tenantId);

  if (disabled || !adapter) {
    console.warn(`[InboundFlow] Channel unavailable: ${reason}`);
    return { success: false, error: reason };
  }

  const parsed = adapter.parseIncomingMessage(rawPayload);
  if (!parsed) {
    return { success: false, error: "Failed to parse incoming message" };
  }

  console.log(
    `[InboundFlow] Parsed message from ${parsed.channel}: ${parsed.text.substring(0, 50)}...`
  );

  return {
    success: true,
    parsed,
  };
}

// ============ Outbound Flow ============

export interface OutboundFlowResult {
  success: boolean;
  externalMessageId?: string;
  error?: string;
  channelDisabled?: boolean;
}

export async function processOutboundMessage(
  channelType: ChannelType,
  externalConversationId: string,
  text: string,
  messageId: string,
  tenantId?: string,
  options?: { sendTyping?: boolean; replyToMessageId?: string }
): Promise<OutboundFlowResult> {
  const { adapter, disabled, reason } = await channelRegistry.getAdapter(channelType, tenantId);

  if (disabled) {
    console.warn(`[OutboundFlow] Channel disabled: ${reason}`);
    return { success: false, error: reason, channelDisabled: true };
  }

  if (!adapter) {
    console.error(`[OutboundFlow] No adapter: ${reason}`);
    return { success: false, error: reason };
  }

  try {
    if (options?.sendTyping && adapter.sendTypingStart) {
      await adapter.sendTypingStart(externalConversationId);
      await new Promise((r) => setTimeout(r, 500));
      if (adapter.sendTypingStop) {
        await adapter.sendTypingStop(externalConversationId);
      }
    }

    const result = await adapter.sendMessage(externalConversationId, text, {
      replyToMessageId: options?.replyToMessageId,
    });

    if (result.success) {
      await auditLog.log(
        "message_sent" as any,
        "message",
        messageId,
        "system",
        "system",
        {
          channel: channelType,
          externalMessageId: result.externalMessageId,
          externalConversationId,
        }
      );
    }

    return {
      success: result.success,
      externalMessageId: result.externalMessageId,
      error: result.error,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[OutboundFlow] Send failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

// ============ Legacy Compatibility ============

export function getChannelAdapter(channelType: string): ChannelAdapter {
  return channelRegistry.getAdapterSync(channelType as ChannelType);
}

export function registerChannelAdapter(adapter: ChannelAdapter): void {
  channelRegistry.register(adapter);
}

// ============ Initialize Default Adapters ============

channelRegistry.register(new MockChannelAdapter());
channelRegistry.register(new TelegramAdapter());
channelRegistry.register(whatsappAdapter);
channelRegistry.register(new MaxAdapter());
channelRegistry.register(new WhatsAppPersonalAdapter());
channelRegistry.register(maxPersonalAdapter);

export {
  MockChannelAdapter,
  TelegramStubAdapter,
  MaxAdapter,
  TelegramAdapter,
  whatsappAdapter,
  WhatsAppPersonalAdapter,
  maxPersonalAdapter,
};
