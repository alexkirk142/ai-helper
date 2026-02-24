import type { ChannelType, FeatureFlagName } from "@shared/schema";
import type {
  ChannelAdapter,
  ChannelSendResult,
  ParsedIncomingMessage,
  WebhookVerifyResult,
} from "./channel-adapter";
import { featureFlagService } from "./feature-flags";
import { auditLog } from "./audit-log";

const MAX_API_BASE_URL = "https://platform-api.max.ru";
const MAX_RATE_LIMIT_RPS = 30;

export interface MaxBotInfo {
  user_id: number;
  first_name: string;
  last_name?: string | null;
  username?: string | null;
  is_bot: boolean;
  description?: string | null;
  avatar_url?: string | null;
}

export interface MaxMessageBody {
  mid: string;
  seq: number;
  text?: string;
  sender?: {
    user_id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  recipient?: {
    chat_id?: number;
    user_id?: number;
  };
  timestamp: number;
}

export interface MaxUpdate {
  update_type: string;
  timestamp: number;
  message?: MaxMessageBody;
  chat_id?: number;
  user_id?: number;
}

export interface MaxWebhookPayload {
  updates?: MaxUpdate[];
  update_type?: string;
  timestamp?: number;
  message?: MaxMessageBody;
}

export interface MaxSendMessageResponse {
  message?: {
    mid: string;
    seq: number;
    timestamp: number;
  };
  success?: boolean;
  error?: string;
  code?: string;
}

export type MaxApiError = {
  code: string;
  message: string;
  status: number;
};

function isRetryableError(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MaxAdapter implements ChannelAdapter {
  readonly name: ChannelType = "max";
  private token: string;
  private baseUrl: string;
  private processedMessageIds: Set<string> = new Set();
  private maxProcessedIds = 10000;

  constructor(token?: string) {
    this.token = token || process.env.MAX_TOKEN || "";
    this.baseUrl = MAX_API_BASE_URL;

    if (!this.token) {
      console.warn("[MaxAdapter] MAX_TOKEN not configured");
    }
  }

  private getAuthHeader(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private async makeRequest<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    queryParams?: Record<string, string | number>,
    retries = 3
  ): Promise<{ data?: T; error?: MaxApiError }> {
    let url = `${this.baseUrl}${endpoint}`;

    if (queryParams) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryParams)) {
        params.append(key, String(value));
      }
      url += `?${params.toString()}`;
    }

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers: this.getAuthHeader(),
          body: body ? JSON.stringify(body) : undefined,
        });

        if (response.status === 401 || response.status === 403) {
          console.error(`[MaxAdapter] Auth error: ${response.status}`);
          return {
            error: {
              code: "AUTH_ERROR",
              message: `Authentication failed: ${response.status}`,
              status: response.status,
            },
          };
        }

        if (isRetryableError(response.status)) {
          const retryAfter = response.headers.get("Retry-After");
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, attempt) * 1000;

          console.warn(
            `[MaxAdapter] Retryable error ${response.status}, attempt ${attempt}/${retries}, waiting ${delay}ms`
          );

          if (attempt < retries) {
            await sleep(delay);
            continue;
          }

          return {
            error: {
              code: response.status === 429 ? "RATE_LIMIT" : "SERVER_ERROR",
              message: `Request failed after ${retries} attempts: ${response.status}`,
              status: response.status,
            },
          };
        }

        if (!response.ok) {
          const errorBody = await response.text();
          console.error(`[MaxAdapter] Request failed: ${response.status} - ${errorBody}`);
          return {
            error: {
              code: "REQUEST_FAILED",
              message: errorBody || `HTTP ${response.status}`,
              status: response.status,
            },
          };
        }

        const data = (await response.json()) as T;
        return { data };
      } catch (error) {
        console.error(`[MaxAdapter] Network error attempt ${attempt}/${retries}:`, error);

        if (attempt < retries) {
          await sleep(Math.pow(2, attempt) * 1000);
          continue;
        }

        return {
          error: {
            code: "NETWORK_ERROR",
            message: error instanceof Error ? error.message : "Network error",
            status: 0,
          },
        };
      }
    }

    return {
      error: {
        code: "MAX_RETRIES",
        message: "Max retries exceeded",
        status: 0,
      },
    };
  }

  async verifyAuth(): Promise<{ success: boolean; botInfo?: MaxBotInfo; error?: string }> {
    if (!this.token) {
      return { success: false, error: "MAX_TOKEN not configured" };
    }

    const result = await this.makeRequest<MaxBotInfo>("GET", "/me");

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    if (result.data && result.data.is_bot) {
      console.log(`[MaxAdapter] Authenticated as bot: ${result.data.first_name} (${result.data.user_id})`);
      return { success: true, botInfo: result.data };
    }

    return { success: false, error: "Invalid bot info received" };
  }

  async sendMessage(
    externalConversationId: string,
    text: string,
    options?: { replyToMessageId?: string }
  ): Promise<ChannelSendResult> {
    const isEnabled = await featureFlagService.isEnabled("MAX_CHANNEL_ENABLED");
    if (!isEnabled) {
      console.log("[MaxAdapter] Channel disabled, message not sent");
      await auditLog.log(
        "message_sent" as any,
        "message",
        "blocked",
        "system",
        "system",
        {
          channel: "max",
          blocked: true,
          reason: "MAX_CHANNEL_ENABLED is false",
          targetId: externalConversationId,
        }
      );
      return {
        success: false,
        error: "MAX channel is disabled",
      };
    }

    if (!this.token) {
      return {
        success: false,
        error: "MAX_TOKEN not configured",
      };
    }

    const chatId = parseInt(externalConversationId, 10);
    const isUserId = !isNaN(chatId) && chatId > 0;

    const queryParams: Record<string, string | number> = isUserId
      ? { user_id: chatId }
      : { chat_id: Math.abs(chatId) };

    const body: { text: string; notify?: boolean } = {
      text: text.substring(0, 4000),
      notify: true,
    };

    const result = await this.makeRequest<MaxSendMessageResponse>(
      "POST",
      "/messages",
      body,
      queryParams
    );

    if (result.error) {
      console.error(`[MaxAdapter] Send failed: ${result.error.message}`);
      return {
        success: false,
        error: result.error.message,
      };
    }

    const messageId = result.data?.message?.mid || `max_${Date.now()}`;
    console.log(`[MaxAdapter] Message sent: ${messageId}`);

    return {
      success: true,
      externalMessageId: messageId,
      timestamp: result.data?.message?.timestamp
        ? new Date(result.data.message.timestamp)
        : new Date(),
    };
  }

  parseIncomingMessage(rawPayload: unknown): ParsedIncomingMessage | null {
    if (!rawPayload || typeof rawPayload !== "object") {
      return null;
    }

    const payload = rawPayload as MaxWebhookPayload;

    let message: MaxMessageBody | undefined;
    let updateType: string | undefined;
    let updateTimestamp: number | undefined;

    if (payload.updates && Array.isArray(payload.updates) && payload.updates.length > 0) {
      const update = payload.updates[0];
      message = update.message;
      updateType = update.update_type;
      updateTimestamp = update.timestamp;
    } else if (payload.message) {
      message = payload.message;
      updateType = payload.update_type;
      updateTimestamp = payload.timestamp;
    }

    if (!message) {
      return null;
    }

    if (updateType !== "message_created" && updateType !== undefined) {
      console.log(`[MaxAdapter] Ignoring non-message update: ${updateType}`);
      return null;
    }

    if (!message.text) {
      console.log("[MaxAdapter] No text in message, ignoring");
      return null;
    }

    const messageId = message.mid || `max_in_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    if (this.processedMessageIds.has(messageId)) {
      console.log(`[MaxAdapter] Duplicate message ignored: ${messageId}`);
      return null;
    }

    this.processedMessageIds.add(messageId);
    if (this.processedMessageIds.size > this.maxProcessedIds) {
      const iterator = this.processedMessageIds.values();
      const firstValue = iterator.next().value;
      if (firstValue) {
        this.processedMessageIds.delete(firstValue);
      }
    }

    const senderId = message.sender?.user_id || 0;
    const chatId = message.recipient?.chat_id || message.recipient?.user_id || senderId;
    const timestamp = message.timestamp || updateTimestamp || Date.now();

    return {
      externalMessageId: messageId,
      externalConversationId: String(chatId),
      externalUserId: String(senderId),
      text: message.text,
      timestamp: new Date(timestamp),
      channel: "max",
      metadata: {
        seq: message.seq,
        senderFirstName: message.sender?.first_name,
        senderLastName: message.sender?.last_name,
        senderUsername: message.sender?.username,
        updateType,
      },
    };
  }

  async sendTypingStart(externalConversationId: string): Promise<void> {
    console.log(`[MaxAdapter] Typing indicator not supported, would send to ${externalConversationId}`);
  }

  verifyWebhook(
    headers: Record<string, string>,
    body: unknown,
    secret?: string
  ): WebhookVerifyResult {
    if (!secret) {
      return { valid: true };
    }

    const receivedSecret =
      headers["x-max-bot-api-secret"] ||
      headers["X-Max-Bot-Api-Secret"] ||
      headers["X-MAX-BOT-API-SECRET"];

    if (!receivedSecret) {
      console.warn("[MaxAdapter] Missing X-Max-Bot-Api-Secret header");
      return { valid: false, error: "Missing secret header" };
    }

    if (receivedSecret !== secret) {
      console.warn("[MaxAdapter] Invalid webhook secret");
      return { valid: false, error: "Invalid secret" };
    }

    return { valid: true };
  }

  async subscribeWebhook(
    webhookUrl: string,
    secret?: string,
    updateTypes?: string[]
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.token) {
      return { success: false, error: "MAX_TOKEN not configured" };
    }

    const body: {
      url: string;
      secret?: string;
      update_types?: string[];
    } = {
      url: webhookUrl,
      update_types: updateTypes || ["message_created", "bot_started"],
    };

    if (secret) {
      body.secret = secret;
    }

    const result = await this.makeRequest<{ success: boolean; message?: string }>(
      "POST",
      "/subscriptions",
      body
    );

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    console.log(`[MaxAdapter] Webhook subscribed: ${webhookUrl}`);
    return { success: true };
  }

  async unsubscribeWebhook(): Promise<{ success: boolean; error?: string }> {
    if (!this.token) {
      return { success: false, error: "MAX_TOKEN not configured" };
    }

    const result = await this.makeRequest<{ success: boolean }>("DELETE", "/subscriptions");

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    console.log("[MaxAdapter] Webhook unsubscribed");
    return { success: true };
  }

  async checkChannelEnabled(tenantId?: string): Promise<boolean> {
    return featureFlagService.isEnabled("MAX_CHANNEL_ENABLED", tenantId);
  }

  clearProcessedMessages(): void {
    this.processedMessageIds.clear();
  }
}

export function createMaxAdapter(token?: string): MaxAdapter {
  return new MaxAdapter(token);
}

export const maxAdapter = new MaxAdapter();
