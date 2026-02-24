import type { ChannelType, FeatureFlagName } from "@shared/schema";
import type {
  ChannelAdapter,
  ChannelSendResult,
  ParsedAttachment,
  ParsedIncomingMessage,
  WebhookVerifyResult,
} from "./channel-adapter";
import { featureFlagService } from "./feature-flags";
import { auditLog } from "./audit-log";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_RATE_LIMIT_RPS = 30;

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string;
  title?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVideoNote {
  file_id: string;
  file_unique_id: string;
  length: number;
  duration: number;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramSticker {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  is_animated: boolean;
  is_video: boolean;
  type: string;
}

interface TelegramPoll {
  id: string;
  question: string;
  options: Array<{ text: string; voter_count: number }>;
  total_voter_count: number;
  is_closed: boolean;
  is_anonymous: boolean;
  type: string;
  allows_multiple_answers: boolean;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: TelegramMessage;
  photo?: TelegramPhotoSize[];
  voice?: TelegramVoice;
  audio?: TelegramAudio;
  video?: TelegramVideo;
  video_note?: TelegramVideoNote;
  document?: TelegramDocument;
  sticker?: TelegramSticker;
  animation?: TelegramDocument;
  poll?: TelegramPoll;
  forward_from?: TelegramUser;
  forward_from_chat?: TelegramChat;
  forward_date?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
    migrate_to_chat_id?: number;
  };
}

export type TelegramApiError = {
  code: string;
  message: string;
  status: number;
  retryAfter?: number;
};

function isRetryableError(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegramAdapter implements ChannelAdapter {
  readonly name: ChannelType = "telegram";
  private token: string;
  private baseUrl: string;
  private processedMessageIds: Set<string> = new Set();
  private maxProcessedIds = 10000;

  constructor(token?: string) {
    this.token = token || process.env.TELEGRAM_BOT_TOKEN || "";
    this.baseUrl = TELEGRAM_API_BASE_URL;

    if (!this.token) {
      console.warn("[TelegramAdapter] TELEGRAM_BOT_TOKEN not configured");
    }
  }

  private getApiUrl(method: string): string {
    return `${this.baseUrl}/bot${this.token}/${method}`;
  }

  private async makeRequest<T>(
    method: string,
    body?: Record<string, unknown>,
    retries = 3
  ): Promise<{ data?: T; error?: TelegramApiError }> {
    const url = this.getApiUrl(method);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        });

        const json = (await response.json()) as TelegramApiResponse<T>;

        if (json.ok && json.result !== undefined) {
          return { data: json.result };
        }

        if (response.status === 401 || response.status === 403 || json.error_code === 401) {
          console.error(`[TelegramAdapter] Auth error: ${json.description}`);
          return {
            error: {
              code: "AUTH_ERROR",
              message: json.description || `Authentication failed: ${response.status}`,
              status: response.status,
            },
          };
        }

        if (json.error_code === 429 || response.status === 429) {
          const retryAfter = json.parameters?.retry_after || Math.pow(2, attempt);
          const delay = retryAfter * 1000;

          console.warn(
            `[TelegramAdapter] Rate limited, attempt ${attempt}/${retries}, waiting ${delay}ms`
          );

          if (attempt < retries) {
            await sleep(delay);
            continue;
          }

          return {
            error: {
              code: "RATE_LIMIT",
              message: json.description || "Rate limit exceeded",
              status: 429,
              retryAfter,
            },
          };
        }

        if (isRetryableError(response.status)) {
          const delay = Math.pow(2, attempt) * 1000;

          console.warn(
            `[TelegramAdapter] Retryable error ${response.status}, attempt ${attempt}/${retries}, waiting ${delay}ms`
          );

          if (attempt < retries) {
            await sleep(delay);
            continue;
          }

          return {
            error: {
              code: "SERVER_ERROR",
              message: json.description || `Server error: ${response.status}`,
              status: response.status,
            },
          };
        }

        console.error(`[TelegramAdapter] Request failed: ${json.description}`);
        return {
          error: {
            code: "REQUEST_FAILED",
            message: json.description || `HTTP ${response.status}`,
            status: response.status,
          },
        };
      } catch (error) {
        console.error(`[TelegramAdapter] Network error attempt ${attempt}/${retries}:`, error);

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

  async verifyAuth(): Promise<{ success: boolean; botInfo?: TelegramBotInfo; error?: string }> {
    if (!this.token) {
      return { success: false, error: "TELEGRAM_BOT_TOKEN not configured" };
    }

    const result = await this.makeRequest<TelegramBotInfo>("getMe");

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    if (result.data && result.data.is_bot) {
      console.log(
        `[TelegramAdapter] Authenticated as bot: ${result.data.first_name} (@${result.data.username})`
      );
      return { success: true, botInfo: result.data };
    }

    return { success: false, error: "Invalid bot info received" };
  }

  async sendMessage(
    externalConversationId: string,
    text: string,
    options?: { replyToMessageId?: string }
  ): Promise<ChannelSendResult> {
    const isEnabled = await featureFlagService.isEnabled("TELEGRAM_CHANNEL_ENABLED");
    if (!isEnabled) {
      console.log("[TelegramAdapter] Channel disabled, message not sent");
      await auditLog.log(
        "message_sent" as any,
        "message",
        "blocked",
        "system",
        "system",
        {
          channel: "telegram",
          blocked: true,
          reason: "TELEGRAM_CHANNEL_ENABLED is false",
          targetId: externalConversationId,
        }
      );
      return {
        success: false,
        error: "Telegram channel is disabled",
      };
    }

    if (!this.token) {
      return {
        success: false,
        error: "TELEGRAM_BOT_TOKEN not configured",
      };
    }

    const chatId = parseInt(externalConversationId, 10);
    if (isNaN(chatId)) {
      return {
        success: false,
        error: "Invalid chat ID",
      };
    }

    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: text.substring(0, 4096),
      parse_mode: "HTML",
    };

    if (options?.replyToMessageId) {
      const replyToId = parseInt(options.replyToMessageId, 10);
      if (!isNaN(replyToId)) {
        body.reply_to_message_id = replyToId;
      }
    }

    const result = await this.makeRequest<TelegramMessage>("sendMessage", body);

    if (result.error) {
      console.error(`[TelegramAdapter] Send failed: ${result.error.message}`);
      return {
        success: false,
        error: result.error.message,
      };
    }

    const messageId = result.data?.message_id
      ? String(result.data.message_id)
      : `tg_${Date.now()}`;
    console.log(`[TelegramAdapter] Message sent: ${messageId}`);

    return {
      success: true,
      externalMessageId: messageId,
      timestamp: result.data?.date ? new Date(result.data.date * 1000) : new Date(),
    };
  }

  /**
   * Sends a file to a Telegram chat using the appropriate Bot API method
   * (sendPhoto, sendDocument, sendAudio, sendVoice, sendVideo).
   * The file is streamed directly to Telegram — no local storage needed.
   * Returns the sent message metadata including Telegram's file_id.
   */
  async sendMediaMessage(
    externalConversationId: string,
    buffer: Buffer,
    mimeType: string,
    fileName: string,
    caption: string,
  ): Promise<ChannelSendResult & { fileId?: string; sentMsgId?: string }> {
    if (!this.token) {
      return { success: false, error: "TELEGRAM_BOT_TOKEN not configured" };
    }

    const chatId = parseInt(externalConversationId, 10);
    if (isNaN(chatId)) {
      return { success: false, error: "Invalid chat ID" };
    }

    const { method, fieldName, attachmentType } = this.resolveMediaMethod(mimeType, fileName);

    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append(fieldName, new Blob([buffer], { type: mimeType }), fileName);
    if (caption) {
      formData.append("caption", caption.substring(0, 1024));
      formData.append("parse_mode", "HTML");
    }

    try {
      const response = await fetch(this.getApiUrl(method), {
        method: "POST",
        body: formData,
      });

      const json = (await response.json()) as TelegramApiResponse<TelegramMessage>;

      if (!json.ok || !json.result) {
        console.error(`[TelegramAdapter] Media send failed: ${json.description}`);
        return { success: false, error: json.description || "Media send failed" };
      }

      const msg = json.result;
      const fileId = this.extractFileId(msg, attachmentType);
      const msgId = String(msg.message_id);

      console.log(`[TelegramAdapter] Media sent (${attachmentType}): msgId=${msgId}, fileId=${fileId}`);
      return {
        success: true,
        externalMessageId: msgId,
        timestamp: new Date(msg.date * 1000),
        fileId,
        sentMsgId: msgId,
      };
    } catch (error: any) {
      console.error(`[TelegramAdapter] Media send error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private resolveMediaMethod(
    mimeType: string,
    fileName: string,
  ): { method: string; fieldName: string; attachmentType: ParsedAttachment["type"] } {
    const mime = mimeType.toLowerCase();
    if (mime.startsWith("image/") && !mime.includes("gif")) {
      return { method: "sendPhoto", fieldName: "photo", attachmentType: "image" };
    }
    if (mime === "audio/ogg" || mime === "audio/mpeg" && fileName.toLowerCase().endsWith(".oga")) {
      return { method: "sendVoice", fieldName: "voice", attachmentType: "voice" };
    }
    if (mime.startsWith("audio/")) {
      return { method: "sendAudio", fieldName: "audio", attachmentType: "audio" };
    }
    if (mime.startsWith("video/")) {
      return { method: "sendVideo", fieldName: "video", attachmentType: "video" };
    }
    return { method: "sendDocument", fieldName: "document", attachmentType: "document" };
  }

  private extractFileId(msg: TelegramMessage, type: ParsedAttachment["type"]): string | undefined {
    if (type === "image" && msg.photo) {
      return msg.photo[msg.photo.length - 1]?.file_id;
    }
    if (type === "voice" && msg.voice) return msg.voice.file_id;
    if (type === "audio" && msg.audio) return msg.audio.file_id;
    if (type === "video" && msg.video) return msg.video.file_id;
    if (msg.document) return msg.document.file_id;
    return undefined;
  }

  async sendTypingStart(externalConversationId: string): Promise<void> {
    if (!this.token) {
      return;
    }

    const chatId = parseInt(externalConversationId, 10);
    if (isNaN(chatId)) {
      return;
    }

    try {
      await this.makeRequest("sendChatAction", {
        chat_id: chatId,
        action: "typing",
      });
      console.log(`[TelegramAdapter] Sent typing action to ${externalConversationId}`);
    } catch (error) {
      console.warn(`[TelegramAdapter] Failed to send typing action:`, error);
    }
  }

  parseIncomingMessage(rawPayload: unknown): ParsedIncomingMessage | null {
    if (!rawPayload || typeof rawPayload !== "object") {
      return null;
    }

    const update = rawPayload as TelegramUpdate;
    const message = update.message || update.edited_message;

    if (!message) {
      console.log("[TelegramAdapter] No message in update, ignoring");
      return null;
    }

    const hasMedia = !!(
      message.photo ||
      message.voice ||
      message.audio ||
      message.video ||
      message.video_note ||
      message.document ||
      message.sticker ||
      message.animation ||
      message.poll
    );

    if (!message.text && !message.caption && !hasMedia) {
      console.log("[TelegramAdapter] No text or media in message, ignoring");
      return null;
    }

    const messageId = String(message.message_id);
    const idempotencyKey = `${message.chat.id}_${messageId}`;

    if (this.processedMessageIds.has(idempotencyKey)) {
      console.log(`[TelegramAdapter] Duplicate message ignored: ${idempotencyKey}`);
      return null;
    }

    this.processedMessageIds.add(idempotencyKey);
    if (this.processedMessageIds.size > this.maxProcessedIds) {
      const iterator = this.processedMessageIds.values();
      const firstValue = iterator.next().value;
      if (firstValue) {
        this.processedMessageIds.delete(firstValue);
      }
    }

    const attachments: ParsedAttachment[] = [];

    if (message.photo) {
      const largest = message.photo[message.photo.length - 1];
      attachments.push({
        type: "image",
        fileId: largest.file_id,
        url: `/api/telegram/file/${largest.file_id}`,
        width: largest.width,
        height: largest.height,
        fileSize: largest.file_size,
        mimeType: "image/jpeg",
      });
    }

    if (message.voice) {
      attachments.push({
        type: "voice",
        fileId: message.voice.file_id,
        url: `/api/telegram/file/${message.voice.file_id}`,
        duration: message.voice.duration,
        mimeType: message.voice.mime_type,
        fileSize: message.voice.file_size,
      });
    }

    if (message.audio) {
      attachments.push({
        type: "audio",
        fileId: message.audio.file_id,
        url: `/api/telegram/file/${message.audio.file_id}`,
        duration: message.audio.duration,
        mimeType: message.audio.mime_type,
        fileSize: message.audio.file_size,
        fileName: message.audio.file_name,
      });
    }

    if (message.video) {
      attachments.push({
        type: "video",
        fileId: message.video.file_id,
        url: `/api/telegram/file/${message.video.file_id}`,
        duration: message.video.duration,
        width: message.video.width,
        height: message.video.height,
        mimeType: message.video.mime_type,
        fileSize: message.video.file_size,
        fileName: message.video.file_name,
      });
    }

    if (message.video_note) {
      attachments.push({
        type: "video_note",
        fileId: message.video_note.file_id,
        url: `/api/telegram/file/${message.video_note.file_id}`,
        duration: message.video_note.duration,
        width: message.video_note.length,
        height: message.video_note.length,
        fileSize: message.video_note.file_size,
      });
    }

    if (message.document) {
      attachments.push({
        type: "document",
        fileId: message.document.file_id,
        url: `/api/telegram/file/${message.document.file_id}`,
        mimeType: message.document.mime_type,
        fileSize: message.document.file_size,
        fileName: message.document.file_name,
      });
    }

    if (message.sticker) {
      attachments.push({
        type: "sticker",
        fileId: message.sticker.file_id,
        url: `/api/telegram/file/${message.sticker.file_id}`,
        width: message.sticker.width,
        height: message.sticker.height,
      });
    }

    if (message.animation) {
      attachments.push({
        type: "video",
        fileId: message.animation.file_id,
        url: `/api/telegram/file/${message.animation.file_id}`,
        mimeType: message.animation.mime_type,
        fileSize: message.animation.file_size,
        fileName: message.animation.file_name,
      });
    }

    if (message.poll) {
      attachments.push({
        type: "poll",
        pollQuestion: message.poll.question,
        pollOptions: message.poll.options.map((o) => o.text),
      });
    }

    let forwardedFrom: ParsedIncomingMessage["forwardedFrom"];
    if (message.forward_from || message.forward_from_chat) {
      forwardedFrom = {
        name: message.forward_from
          ? [message.forward_from.first_name, message.forward_from.last_name]
              .filter(Boolean)
              .join(" ")
          : message.forward_from_chat?.title,
        username:
          message.forward_from?.username ?? message.forward_from_chat?.username,
        date: message.forward_date,
      };
    }

    return {
      externalMessageId: messageId,
      externalConversationId: String(message.chat.id),
      externalUserId: message.from ? String(message.from.id) : "unknown",
      text: message.text ?? message.caption ?? "",
      timestamp: new Date(message.date * 1000),
      channel: "telegram",
      metadata: {
        updateId: update.update_id,
        chatType: message.chat.type,
        firstName: message.from?.first_name,
        lastName: message.from?.last_name,
        username: message.from?.username,
        languageCode: message.from?.language_code,
        chatTitle: message.chat.title,
        chatUsername: message.chat.username,
      },
      ...(attachments.length > 0 && { attachments }),
      ...(forwardedFrom && { forwardedFrom }),
    };
  }

  verifyWebhook(
    headers: Record<string, string>,
    body: unknown,
    secret?: string
  ): WebhookVerifyResult {
    if (!secret) {
      return { valid: true };
    }

    const receivedToken =
      headers["x-telegram-bot-api-secret-token"] ||
      headers["X-Telegram-Bot-Api-Secret-Token"];

    if (!receivedToken) {
      console.warn("[TelegramAdapter] Missing X-Telegram-Bot-Api-Secret-Token header");
      return { valid: false, error: "Missing secret header" };
    }

    if (receivedToken !== secret) {
      console.warn("[TelegramAdapter] Invalid webhook secret");
      return { valid: false, error: "Invalid secret" };
    }

    return { valid: true };
  }

  async setWebhook(
    webhookUrl: string,
    secret?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.token) {
      return { success: false, error: "TELEGRAM_BOT_TOKEN not configured" };
    }

    const body: Record<string, unknown> = {
      url: webhookUrl,
      allowed_updates: ["message", "edited_message", "channel_post"],
      drop_pending_updates: false,
    };

    if (secret) {
      body.secret_token = secret;
    }

    const result = await this.makeRequest<boolean>("setWebhook", body);

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    console.log(`[TelegramAdapter] Webhook set: ${webhookUrl}`);
    return { success: true };
  }

  async deleteWebhook(): Promise<{ success: boolean; error?: string }> {
    if (!this.token) {
      return { success: false, error: "TELEGRAM_BOT_TOKEN not configured" };
    }

    const result = await this.makeRequest<boolean>("deleteWebhook");

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    console.log("[TelegramAdapter] Webhook deleted");
    return { success: true };
  }

  async getWebhookInfo(): Promise<{
    success: boolean;
    info?: {
      url: string;
      has_custom_certificate: boolean;
      pending_update_count: number;
      last_error_date?: number;
      last_error_message?: string;
    };
    error?: string;
  }> {
    if (!this.token) {
      return { success: false, error: "TELEGRAM_BOT_TOKEN not configured" };
    }

    const result = await this.makeRequest<{
      url: string;
      has_custom_certificate: boolean;
      pending_update_count: number;
      last_error_date?: number;
      last_error_message?: string;
    }>("getWebhookInfo");

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return { success: true, info: result.data };
  }

  async checkChannelEnabled(tenantId?: string): Promise<boolean> {
    return featureFlagService.isEnabled("TELEGRAM_CHANNEL_ENABLED", tenantId);
  }

  clearProcessedMessages(): void {
    this.processedMessageIds.clear();
  }
}

export function createTelegramAdapter(token?: string): TelegramAdapter {
  return new TelegramAdapter(token);
}

export const telegramAdapter = new TelegramAdapter();
