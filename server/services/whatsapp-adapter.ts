import crypto from "crypto";
import type { ChannelType } from "@shared/schema";
import type {
  ChannelAdapter,
  ChannelSendResult,
  ParsedIncomingMessage,
  WebhookVerifyResult,
} from "./channel-adapter";
import { featureFlagService } from "./feature-flags";
import { auditLog } from "./audit-log";

const WHATSAPP_API_VERSION = "v18.0";
const WHATSAPP_API_BASE = "https://graph.facebook.com";

export interface WhatsAppBotInfo {
  verified_name: string;
  display_phone_number: string;
  phone_number_id: string;
  quality_rating: string;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "image" | "document" | "audio" | "video" | "sticker" | "location" | "contacts" | "button" | "interactive";
  text?: { body: string };
  image?: { id: string; mime_type: string; sha256: string };
  context?: { from: string; id: string };
}

export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

export interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    field: string;
    value: {
      messaging_product: string;
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      contacts?: WhatsAppContact[];
      messages?: WhatsAppMessage[];
      statuses?: Array<{
        id: string;
        status: "sent" | "delivered" | "read" | "failed";
        timestamp: string;
        recipient_id: string;
      }>;
      errors?: Array<{
        code: number;
        title: string;
        message: string;
      }>;
    };
  }>;
}

export interface WhatsAppWebhookPayload {
  object: "whatsapp_business_account";
  entry: WhatsAppWebhookEntry[];
}

export interface WhatsAppSendMessageResponse {
  messaging_product: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id: string;
  };
}

export interface WhatsAppTemplateComponent {
  type: "header" | "body" | "button";
  parameters?: Array<{
    type: "text" | "currency" | "date_time" | "image" | "document" | "video";
    text?: string;
  }>;
  sub_type?: "quick_reply" | "url";
  index?: number;
}

export interface WhatsAppTemplate {
  name: string;
  language: { code: string };
  components?: WhatsAppTemplateComponent[];
}

export type WhatsAppApiError = {
  code: number;
  message: string;
  type: string;
};

function isRetryableError(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CUSTOMER_CARE_WINDOW_MS = 24 * 60 * 60 * 1000;

export class WhatsAppAdapter implements ChannelAdapter {
  readonly name: ChannelType = "whatsapp";
  private accessToken: string;
  private phoneNumberId: string;
  private verifyToken: string;
  private appSecret: string;
  private baseUrl: string;
  private processedMessageIds: Set<string> = new Set();
  private maxProcessedIds = 10000;
  private lastInboundTimestamps: Map<string, number> = new Map();

  constructor(config?: {
    accessToken?: string;
    phoneNumberId?: string;
    verifyToken?: string;
    appSecret?: string;
    baseUrl?: string;
  }) {
    this.accessToken = config?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || "";
    this.phoneNumberId = config?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    this.verifyToken = config?.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || "";
    this.appSecret = config?.appSecret || process.env.WHATSAPP_APP_SECRET || "";
    this.baseUrl = config?.baseUrl || `${WHATSAPP_API_BASE}/${WHATSAPP_API_VERSION}`;

    if (!this.accessToken) {
      console.warn("[WhatsAppAdapter] WHATSAPP_ACCESS_TOKEN not configured");
    }
    if (!this.phoneNumberId) {
      console.warn("[WhatsAppAdapter] WHATSAPP_PHONE_NUMBER_ID not configured");
    }
  }

  private getAuthHeader(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };
  }

  private async makeRequest<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    retries = 3
  ): Promise<{ data?: T; error?: WhatsAppApiError }> {
    const url = `${this.baseUrl}${endpoint}`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers: this.getAuthHeader(),
          body: body ? JSON.stringify(body) : undefined,
        });

        const responseData = await response.json() as T & { error?: WhatsAppApiError };

        if (!response.ok) {
          const error = responseData.error || {
            code: response.status,
            message: `HTTP ${response.status}`,
            type: "HttpError",
          };

          if (isRetryableError(response.status) && attempt < retries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
            console.warn(
              `[WhatsAppAdapter] Retrying request (${attempt}/${retries}) after ${delay}ms: ${error.message}`
            );
            await sleep(delay);
            continue;
          }

          return { error };
        }

        return { data: responseData };
      } catch (fetchError) {
        const errorMessage = fetchError instanceof Error ? fetchError.message : "Unknown fetch error";

        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          console.warn(
            `[WhatsAppAdapter] Network error, retrying (${attempt}/${retries}) after ${delay}ms: ${errorMessage}`
          );
          await sleep(delay);
          continue;
        }

        return {
          error: {
            code: 0,
            message: errorMessage,
            type: "NetworkError",
          },
        };
      }
    }

    return {
      error: {
        code: 0,
        message: "Max retries exceeded",
        type: "RetryError",
      },
    };
  }

  isWithinCustomerCareWindow(recipientId: string): boolean {
    const lastInbound = this.lastInboundTimestamps.get(recipientId);
    if (!lastInbound) return false;
    return Date.now() - lastInbound < CUSTOMER_CARE_WINDOW_MS;
  }

  recordInboundMessage(recipientId: string, timestamp?: Date): void {
    const ts = timestamp?.getTime() || Date.now();
    this.lastInboundTimestamps.set(recipientId, ts);

    if (this.lastInboundTimestamps.size > 10000) {
      const oldest = Array.from(this.lastInboundTimestamps.entries())
        .sort((a, b) => a[1] - b[1])
        .slice(0, 1000);
      for (const [key] of oldest) {
        this.lastInboundTimestamps.delete(key);
      }
    }
  }

  async sendMessage(
    recipientId: string,
    text: string,
    options?: {
      replyToMessageId?: string;
      template?: WhatsAppTemplate;
      forceTemplate?: boolean;
    }
  ): Promise<ChannelSendResult> {
    if (!this.accessToken || !this.phoneNumberId) {
      return {
        success: false,
        error: "WhatsApp credentials not configured",
      };
    }

    const withinWindow = this.isWithinCustomerCareWindow(recipientId);

    if (!withinWindow && !options?.template && !options?.forceTemplate) {
      console.warn(
        `[WhatsAppAdapter] Outside 24h window for ${recipientId}, template required`
      );
      return {
        success: false,
        error: "Outside 24h customer care window - template message required",
      };
    }

    let payload: Record<string, unknown>;

    if (options?.template || (!withinWindow && options?.forceTemplate)) {
      if (!options?.template) {
        return {
          success: false,
          error: "Template required but not provided",
        };
      }
      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientId,
        type: "template",
        template: options.template,
      };
    } else {
      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientId,
        type: "text",
        text: {
          preview_url: false,
          body: text,
        },
      };
    }

    if (options?.replyToMessageId) {
      payload.context = { message_id: options.replyToMessageId };
    }

    const result = await this.makeRequest<WhatsAppSendMessageResponse>(
      "POST",
      `/${this.phoneNumberId}/messages`,
      payload
    );

    if (result.error) {
      console.error(`[WhatsAppAdapter] Send failed: ${result.error.message}`);
      return {
        success: false,
        error: result.error.message,
      };
    }

    const messageId = result.data?.messages?.[0]?.id;

    await auditLog.log(
      "message_sent" as any,
      "message",
      messageId || "unknown",
      "system",
      "system",
      {
        channel: "whatsapp",
        recipientId,
        messageId,
        withinWindow,
        isTemplate: !!options?.template,
      }
    );

    return {
      success: true,
      externalMessageId: messageId,
      timestamp: new Date(),
    };
  }

  async sendTemplateMessage(
    recipientId: string,
    templateName: string,
    languageCode: string,
    components?: WhatsAppTemplateComponent[]
  ): Promise<ChannelSendResult> {
    return this.sendMessage(recipientId, "", {
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
      forceTemplate: true,
    });
  }

  parseIncomingMessage(rawPayload: unknown): ParsedIncomingMessage | null {
    if (!rawPayload || typeof rawPayload !== "object") return null;

    const payload = rawPayload as WhatsAppWebhookPayload;

    if (payload.object !== "whatsapp_business_account") {
      return null;
    }

    const entry = payload.entry?.[0];
    if (!entry) return null;

    const change = entry.changes?.[0];
    if (!change || change.field !== "messages") return null;

    const value = change.value;
    const message = value?.messages?.[0];

    if (!message) return null;

    if (this.processedMessageIds.has(message.id)) {
      console.log(`[WhatsAppAdapter] Duplicate message ignored: ${message.id}`);
      return null;
    }

    this.processedMessageIds.add(message.id);
    if (this.processedMessageIds.size > this.maxProcessedIds) {
      const iterator = this.processedMessageIds.values();
      const firstValue = iterator.next().value;
      if (firstValue !== undefined) {
        this.processedMessageIds.delete(firstValue);
      }
    }

    let textContent = "";
    if (message.type === "text" && message.text?.body) {
      textContent = message.text.body;
    } else if (message.type === "button") {
      textContent = `[Button: ${(message as any).button?.text || "clicked"}]`;
    } else if (message.type === "interactive") {
      const interactive = (message as any).interactive;
      textContent = `[Interactive: ${interactive?.button_reply?.title || interactive?.list_reply?.title || "selected"}]`;
    } else {
      textContent = `[${message.type}]`;
    }

    const contact = value.contacts?.[0];
    const metadata = value.metadata;
    const timestamp = new Date(Number(message.timestamp) * 1000);

    this.recordInboundMessage(message.from, timestamp);

    return {
      externalMessageId: message.id,
      externalConversationId: message.from,
      externalUserId: message.from,
      text: textContent,
      timestamp,
      channel: "whatsapp",
      metadata: {
        phoneNumberId: metadata?.phone_number_id,
        displayPhoneNumber: metadata?.display_phone_number,
        contactName: contact?.profile?.name,
        messageType: message.type,
        replyTo: message.context?.id,
      },
    };
  }

  verifyWebhook(
    headers: Record<string, string>,
    body: unknown,
    secret?: string
  ): WebhookVerifyResult {
    const signature = headers["x-hub-signature-256"];
    const appSecret = secret || this.appSecret;

    if (!signature) {
      return { valid: false, error: "Missing X-Hub-Signature-256 header" };
    }

    if (!appSecret) {
      console.warn("[WhatsAppAdapter] No app secret for signature verification");
      return { valid: true };
    }

    const bodyString = typeof body === "string" ? body : JSON.stringify(body);
    const expectedSignature = "sha256=" + crypto
      .createHmac("sha256", appSecret)
      .update(bodyString, "utf8")
      .digest("hex");

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: "Invalid signature" };
    }

    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return { valid: false, error: "Signature mismatch" };
    }

    return { valid: true };
  }

  verifyWebhookChallenge(query: Record<string, string>): WebhookVerifyResult {
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (mode !== "subscribe") {
      return { valid: false, error: "Invalid hub.mode" };
    }

    if (!this.verifyToken) {
      console.warn("[WhatsAppAdapter] WHATSAPP_VERIFY_TOKEN not configured");
      return { valid: false, error: "Verify token not configured" };
    }

    if (token !== this.verifyToken) {
      return { valid: false, error: "Verify token mismatch" };
    }

    return { valid: true, challenge };
  }

  async sendTypingStart(recipientId: string): Promise<void> {
    console.log(`[WhatsAppAdapter] Typing indicator not supported by WhatsApp API`);
  }

  async testConnection(): Promise<{ success: boolean; botInfo?: WhatsAppBotInfo; error?: string }> {
    if (!this.accessToken || !this.phoneNumberId) {
      return { success: false, error: "Credentials not configured" };
    }

    const result = await this.makeRequest<any>(
      "GET",
      `/${this.phoneNumberId}`
    );

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    return {
      success: true,
      botInfo: {
        verified_name: result.data?.verified_name || "",
        display_phone_number: result.data?.display_phone_number || "",
        phone_number_id: result.data?.id || this.phoneNumberId,
        quality_rating: result.data?.quality_rating || "unknown",
      },
    };
  }

  clearProcessedMessages(): void {
    this.processedMessageIds.clear();
  }

  getProcessedMessageCount(): number {
    return this.processedMessageIds.size;
  }
}

export const whatsappAdapter = new WhatsAppAdapter();
