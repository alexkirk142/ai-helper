import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { storage } from "../storage";
import { getSecret } from "./secret-resolver";
import { processIncomingMessageFull } from "./inbound-message-handler";
import { featureFlagService } from "./feature-flags";
import type { ParsedAttachment } from "./channel-adapter";

interface ActiveConnection {
  tenantId: string;
  accountId: string;
  channelId: string | null;
  client: TelegramClient;
  sessionString: string;
  connected: boolean;
  lastActivity: Date;
  handlersAttached: boolean;
}

class TelegramClientManager {
  private connections = new Map<string, ActiveConnection>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  private async getCredentials(): Promise<{ apiId: number; apiHash: string } | null> {
    const [dbApiId, dbApiHash] = await Promise.all([
      getSecret({ scope: "global", keyName: "TELEGRAM_API_ID" }),
      getSecret({ scope: "global", keyName: "TELEGRAM_API_HASH" }),
    ]);

    if (dbApiId && dbApiHash) {
      const apiId = parseInt(dbApiId, 10);
      if (!isNaN(apiId) && apiId > 0) {
        return { apiId, apiHash: dbApiHash };
      }
    }

    const envApiId = process.env.TELEGRAM_API_ID;
    const envApiHash = process.env.TELEGRAM_API_HASH;

    if (envApiId && envApiHash) {
      const apiId = parseInt(envApiId, 10);
      if (!isNaN(apiId) && apiId > 0) {
        return { apiId, apiHash: envApiHash };
      }
    }

    return null;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log("[TelegramClientManager] Already initialized");
      return;
    }

    const isEnabled = await featureFlagService.isEnabled("TELEGRAM_PERSONAL_CHANNEL_ENABLED");
    if (!isEnabled) {
      console.log("[TelegramClientManager] Feature flag disabled, skipping initialization");
      return;
    }

    console.log("[TelegramClientManager] Initializing multi-account...");

    try {
      const accounts = await storage.getActiveTelegramAccounts();
      console.log(`[TelegramClientManager] Found ${accounts.length} active Telegram accounts`);

      for (const account of accounts) {
        if (!account.sessionString) {
          console.log(`[TelegramClientManager] Account ${account.id}: no session, skipping`);
          continue;
        }

        try {
          const connected = await this.connectAccount(account.tenantId, account.id, account.channelId, account.sessionString);
          console.log(`[TelegramClientManager] Account ${account.id} connect result: ${connected}`);
        } catch (error: any) {
          console.error(`[TelegramClientManager] Failed to connect account ${account.id}:`, error.message);
        }
      }

      // Also load legacy channels that aren't yet migrated to telegramSessions
      await this.initializeLegacyChannels();

      this.isInitialized = true;
      console.log(`[TelegramClientManager] Initialized with ${this.connections.size} active connections`);

      this.startHealthCheck();
    } catch (error: any) {
      console.error("[TelegramClientManager] Initialization error:", error.message);
    }
  }

  private async initializeLegacyChannels(): Promise<void> {
    try {
      const channels = await storage.getChannelsByType("telegram_personal");
      for (const channel of channels) {
        const config = channel.config as { sessionData?: string } | null;
        if (!channel.isActive || !config?.sessionData) continue;

        const connectionKey = `${channel.tenantId}:legacy_${channel.id}`;
        if (this.connections.has(connectionKey)) continue;

        // Check if already connected via telegramSessions
        const alreadyConnected = Array.from(this.connections.values()).some(
          c => c.tenantId === channel.tenantId && c.channelId === channel.id
        );
        if (alreadyConnected) continue;

        try {
          const connected = await this.connect(channel.tenantId, channel.id, config.sessionData);
          if (connected) {
            console.log(`[TelegramClientManager] Legacy channel ${channel.id} connected`);
          }
        } catch (error: any) {
          console.error(`[TelegramClientManager] Failed to connect legacy channel ${channel.id}:`, error.message);
        }
      }
    } catch (error: any) {
      console.error("[TelegramClientManager] Legacy init error:", error.message);
    }
  }

  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      await this.cleanupInactiveConnections();
    }, 60000);

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(async () => {
      await this.heartbeatCheck();
    }, 15000);
  }

  private async heartbeatCheck(): Promise<void> {
    const activeCount = this.connections.size;
    if (activeCount === 0) return;

    console.log(`[TelegramClientManager] Heartbeat: ${activeCount} active connections`);

    for (const [key, connection] of Array.from(this.connections.entries())) {
      try {
        await connection.client.getMe();
        console.log(`[TelegramClientManager] Heartbeat OK: ${key}`);
      } catch (error: any) {
        console.error(`[TelegramClientManager] Heartbeat FAILED: ${key} - ${error.message}`);
        connection.connected = false;
        this.scheduleReconnect(key, connection);
      }
    }
  }

  private async cleanupInactiveConnections(): Promise<void> {
    try {
      for (const [key, connection] of Array.from(this.connections.entries())) {
        if (connection.accountId.startsWith("legacy_")) {
          const channelId = connection.accountId.replace("legacy_", "");
          const channel = await storage.getChannel(channelId);
          if (!channel || !channel.isActive) {
            console.log(`[TelegramClientManager] Cleaning up inactive legacy channel: ${key}`);
            await this.disconnectByKey(key);
          }
        } else {
          const account = await storage.getTelegramAccountById(connection.accountId);
          if (!account || !account.isEnabled || account.status !== "active") {
            console.log(`[TelegramClientManager] Cleaning up inactive account: ${key}`);
            await this.disconnectByKey(key);
          }
        }
      }
    } catch (error: any) {
      console.error("[TelegramClientManager] Health check error:", error.message);
    }
  }

  /** Connect a multi-account session (from telegramSessions table) */
  async connectAccount(tenantId: string, accountId: string, channelId: string | null, sessionString: string): Promise<boolean> {
    const connectionKey = `${tenantId}:${accountId}`;

    const existing = this.connections.get(connectionKey);
    if (existing?.connected && existing.handlersAttached) {
      console.log(`[TelegramClientManager] Already connected: ${connectionKey}`);
      return true;
    }

    if (existing) {
      console.log(`[TelegramClientManager] Cleaning up stale connection: ${connectionKey}`);
      try { await existing.client.disconnect(); } catch {}
      this.connections.delete(connectionKey);
    }

    const existingTimer = this.reconnectTimers.get(connectionKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.reconnectTimers.delete(connectionKey);
    }

    const credentials = await this.getCredentials();
    if (!credentials) {
      console.error("[TelegramClientManager] No credentials available");
      return false;
    }

    try {
      const { apiId, apiHash } = credentials;
      const session = new StringSession(sessionString);
      const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
      });

      console.log(`[TelegramClientManager] Connecting account ${connectionKey}...`);
      await client.connect();

      const isAuthorized = await client.isUserAuthorized();
      if (!isAuthorized) {
        console.error(`[TelegramClientManager] Session invalid for ${connectionKey}`);
        await storage.updateTelegramAccount(accountId, { status: "error", lastError: "Session invalid" });
        return false;
      }

      const me = await client.getMe();
      console.log(`[TelegramClientManager] Account ${connectionKey}: ${(me as any)?.firstName || 'OK'}`);

      const connection: ActiveConnection = {
        tenantId,
        accountId,
        channelId,
        client,
        sessionString,
        connected: true,
        lastActivity: new Date(),
        handlersAttached: false,
      };

      this.connections.set(connectionKey, connection);
      this.ensureHandlers(connection);

      try {
        const dialogs = await client.getDialogs({ limit: 100 });
        console.log(`[TelegramClientManager] Preloaded ${dialogs.length} dialogs for entity cache`);
      } catch (dialogError: any) {
        console.log(`[TelegramClientManager] Could not preload dialogs: ${dialogError.message}`);
      }

      console.log(`[TelegramClientManager] Connected: ${connectionKey}, total: ${this.connections.size}`);
      return true;
    } catch (error: any) {
      console.error(`[TelegramClientManager] Connection error for ${connectionKey}:`, error.message);
      const conn: ActiveConnection = {
        tenantId, accountId, channelId,
        client: null as any, sessionString,
        connected: false, lastActivity: new Date(), handlersAttached: false,
      };
      this.scheduleReconnect(`${tenantId}:${accountId}`, conn);
      return false;
    }
  }

  /** Legacy connect method (backward compatible with old channelId-based approach) */
  async connect(tenantId: string, channelId: string, sessionString: string): Promise<boolean> {
    const legacyAccountId = `legacy_${channelId}`;
    const connectionKey = `${tenantId}:${legacyAccountId}`;

    const existing = this.connections.get(connectionKey);
    if (existing?.connected && existing.handlersAttached) {
      console.log(`[TelegramClientManager] Already connected and running: ${connectionKey}`);
      return true;
    }

    if (existing) {
      console.log(`[TelegramClientManager] Cleaning up stale connection: ${connectionKey}`);
      try { await existing.client.disconnect(); } catch {}
      this.connections.delete(connectionKey);
    }

    const existingTimer = this.reconnectTimers.get(connectionKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.reconnectTimers.delete(connectionKey);
    }

    const credentials = await this.getCredentials();
    if (!credentials) {
      console.error("[TelegramClientManager] No credentials available");
      return false;
    }

    try {
      const { apiId, apiHash } = credentials;
      const session = new StringSession(sessionString);
      const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
      });

      console.log(`[TelegramClientManager] Connecting client for ${connectionKey}...`);
      await client.connect();
      console.log(`[TelegramClientManager] Client connected for ${connectionKey}, checking auth...`);

      const isAuthorized = await client.isUserAuthorized();
      console.log(`[TelegramClientManager] isUserAuthorized for ${connectionKey}: ${isAuthorized}`);

      if (!isAuthorized) {
        console.error(`[TelegramClientManager] Session invalid for ${connectionKey}`);
        return false;
      }

      const me = await client.getMe();
      console.log(`[TelegramClientManager] Warmup getMe() for ${connectionKey}: ${(me as any)?.firstName || 'OK'}`);

      const connection: ActiveConnection = {
        tenantId,
        accountId: legacyAccountId,
        channelId,
        client,
        sessionString,
        connected: true,
        lastActivity: new Date(),
        handlersAttached: false,
      };

      this.connections.set(connectionKey, connection);
      this.ensureHandlers(connection);

      try {
        const dialogs = await client.getDialogs({ limit: 100 });
        console.log(`[TelegramClientManager] Preloaded ${dialogs.length} dialogs for entity cache`);
      } catch (dialogError: any) {
        console.log(`[TelegramClientManager] Could not preload dialogs: ${dialogError.message}`);
      }

      console.log(`[TelegramClientManager] Connected: ${connectionKey}, total connections: ${this.connections.size}`);
      return true;
    } catch (error: any) {
      console.error(`[TelegramClientManager] Connection error for ${connectionKey}:`, error.message);
      const conn: ActiveConnection = {
        tenantId, accountId: legacyAccountId, channelId,
        client: null as any, sessionString,
        connected: false, lastActivity: new Date(), handlersAttached: false,
      };
      this.scheduleReconnect(connectionKey, conn);
      return false;
    }
  }

  private ensureHandlers(connection: ActiveConnection): void {
    if (connection.handlersAttached) {
      return;
    }

    const connectionKey = `${connection.tenantId}:${connection.accountId}`;
    console.log(`[TelegramClientManager] Attaching NewMessage handler for ${connectionKey}`);

    connection.client.addEventHandler(
      (event: NewMessageEvent) => {
        const msg = event.message;
        console.log(`[TG EVENT] ${connectionKey} | out=${msg.out} | chatId=${msg.chatId} | senderId=${msg.senderId} | text=${(msg.text || '').substring(0, 50)}`);

        if (!msg.out) {
          this.handleNewMessage(connection.tenantId, connection.accountId, connection.channelId, event);
        }
      },
      new NewMessage({})
    );

    connection.handlersAttached = true;
    console.log(`[TelegramClientManager] Handlers attached for ${connectionKey}`);
  }

  private async handleNewMessage(tenantId: string, accountId: string, channelId: string | null, event: NewMessageEvent): Promise<void> {
    try {
      const isEnabled = await featureFlagService.isEnabled("TELEGRAM_PERSONAL_CHANNEL_ENABLED");
      if (!isEnabled) return;

      if (channelId) {
        const channel = await storage.getChannel(channelId);
        if (!channel?.isActive) {
          console.log(`[TelegramClientManager] Channel ${channelId} is inactive, skipping message`);
          return;
        }
      }

      const message = event.message;
      if (message.out) return;

      const senderId = message.senderId?.toString() || "";
      const chatId = message.chatId?.toString() || "";
      const text = message.text || message.message || "";

      const hasMedia =
        !!message.media && !(message.media instanceof Api.MessageMediaEmpty);

      if (!text.trim() && !hasMedia) {
        console.log("[TelegramClientManager] Skipping empty message");
        return;
      }

      console.log(
        `[TelegramClientManager] New message from ${senderId} in chat ${chatId}: ${text.substring(0, 50)}${hasMedia ? " [+media]" : ""}`,
      );

      const connectionKey = `${tenantId}:${accountId}`;
      const connection = this.connections.get(connectionKey);
      if (connection) {
        connection.lastActivity = new Date();
      }

      let senderName = "Unknown";
      try {
        const sender = await message.getSender();
        if (sender && "firstName" in sender) {
          senderName =
            [sender.firstName, sender.lastName].filter(Boolean).join(" ") ||
            "Unknown";
        }
      } catch {}

      // Extract media attachments using on-demand proxy URLs (no download at receive time)
      const attachments: ParsedAttachment[] = [];
      if (hasMedia && connection?.client) {
        try {
          this.extractMediaAttachments(
            message,
            accountId,
            chatId,
            attachments,
          );
        } catch (mediaError: any) {
          console.warn(
            `[TelegramClientManager] Media extraction failed: ${mediaError.message}`,
          );
        }
      }

      // Extract forwarded message info
      let forwardedFrom: { name?: string; username?: string; date?: number } | undefined;
      if (message.fwdFrom) {
        const fwd = message.fwdFrom as Api.MessageFwdHeader;
        forwardedFrom = {
          name: fwd.fromName ?? undefined,
          date: fwd.date,
        };
      }

      await processIncomingMessageFull(tenantId, {
        channel: "telegram_personal",
        externalConversationId: chatId,
        externalUserId: senderId,
        externalMessageId: message.id.toString(),
        text,
        timestamp: new Date((message.date || 0) * 1000),
        metadata: {
          channelId,
          accountId,
          senderName,
          isPrivate: message.isPrivate,
          isGroup: message.isGroup,
          isChannel: message.isChannel,
        },
        ...(attachments.length > 0 && { attachments }),
        ...(forwardedFrom && { forwardedFrom }),
      });
    } catch (error: any) {
      console.error("[TelegramClientManager] Error handling message:", error.message);
    }
  }

  /**
   * Builds attachment metadata from a gramjs message, using on-demand proxy URLs.
   * No file is downloaded at this point — the frontend fetches via
   * GET /api/telegram-personal/media/:accountId/:chatId/:msgId
   */
  private extractMediaAttachments(
    message: Api.Message,
    accountId: string,
    chatId: string,
    attachments: ParsedAttachment[],
  ): void {
    const media = message.media;
    if (!media || media instanceof Api.MessageMediaEmpty) return;

    const proxyBase = `/api/telegram-personal/media/${encodeURIComponent(accountId)}/${encodeURIComponent(chatId)}/${message.id}`;

    if (media instanceof Api.MessageMediaPhoto) {
      const photo = media.photo;
      if (!photo || photo instanceof Api.PhotoEmpty) return;
      const p = photo as Api.Photo;
      const largest = p.sizes?.[p.sizes.length - 1] as any;
      attachments.push({
        type: "image",
        url: proxyBase,
        mimeType: "image/jpeg",
        width: largest?.w,
        height: largest?.h,
      });
      return;
    }

    if (media instanceof Api.MessageMediaDocument) {
      const doc = media.document;
      if (!doc || doc instanceof Api.DocumentEmpty) return;
      const document = doc as Api.Document;
      const attrs = document.attributes;
      const fileSize = Number(document.size);
      const mimeType = document.mimeType;

      const filenameAttr = attrs.find(
        (a) => a instanceof Api.DocumentAttributeFilename,
      ) as Api.DocumentAttributeFilename | undefined;
      const audioAttr = attrs.find(
        (a) => a instanceof Api.DocumentAttributeAudio,
      ) as Api.DocumentAttributeAudio | undefined;
      const videoAttr = attrs.find(
        (a) => a instanceof Api.DocumentAttributeVideo,
      ) as Api.DocumentAttributeVideo | undefined;
      const stickerAttr = attrs.find(
        (a) => a instanceof Api.DocumentAttributeSticker,
      );

      let attachmentType: ParsedAttachment["type"] = "document";
      if (stickerAttr) {
        attachmentType = "sticker";
      } else if (audioAttr?.voice) {
        attachmentType = "voice";
      } else if (audioAttr) {
        attachmentType = "audio";
      } else if (videoAttr?.roundMessage) {
        attachmentType = "video_note";
      } else if (videoAttr) {
        attachmentType = "video";
      }

      attachments.push({
        type: attachmentType,
        url: proxyBase,
        mimeType,
        fileName: filenameAttr?.fileName,
        fileSize,
        duration: audioAttr?.duration ?? videoAttr?.duration ?? undefined,
        width: videoAttr?.w ?? undefined,
        height: videoAttr?.h ?? undefined,
      });
      return;
    }

    if (media instanceof Api.MessageMediaPoll) {
      const poll = media.poll;
      const questionText =
        typeof poll.question === "string"
          ? poll.question
          : (poll.question as any)?.text ?? "";
      const options = poll.answers.map((a) => {
        const txt = a.text;
        return typeof txt === "string" ? txt : (txt as any)?.text ?? "";
      });
      attachments.push({
        type: "poll",
        pollQuestion: questionText,
        pollOptions: options,
      });
    }
  }

  private scheduleReconnect(connectionKey: string, connection: ActiveConnection): void {
    const existingTimer = this.reconnectTimers.get(connectionKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      console.log(`[TelegramClientManager] Attempting reconnect: ${connectionKey}`);
      this.reconnectTimers.delete(connectionKey);
      if (connection.accountId.startsWith("legacy_")) {
        await this.connect(connection.tenantId, connection.channelId!, connection.sessionString);
      } else {
        await this.connectAccount(connection.tenantId, connection.accountId, connection.channelId, connection.sessionString);
      }
    }, 30000);

    this.reconnectTimers.set(connectionKey, timer);
  }

  async disconnect(tenantId: string, channelId: string): Promise<void> {
    // Disconnect legacy connection
    const legacyKey = `${tenantId}:legacy_${channelId}`;
    await this.disconnectByKey(legacyKey);

    // Also disconnect any account connections linked to this channelId
    for (const [key, conn] of Array.from(this.connections.entries())) {
      if (conn.tenantId === tenantId && conn.channelId === channelId) {
        await this.disconnectByKey(key);
      }
    }
  }

  async disconnectAccount(tenantId: string, accountId: string): Promise<void> {
    const connectionKey = `${tenantId}:${accountId}`;
    await this.disconnectByKey(connectionKey);
  }

  private async disconnectByKey(connectionKey: string): Promise<void> {
    const connection = this.connections.get(connectionKey);
    if (connection) {
      try {
        await connection.client.disconnect();
      } catch (error: any) {
        console.warn(`[TelegramClientManager] Disconnect error: ${error.message}`);
      }
      this.connections.delete(connectionKey);
      console.log(`[TelegramClientManager] Disconnected: ${connectionKey}`);
    }

    const timer = this.reconnectTimers.get(connectionKey);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(connectionKey);
    }
  }

  async sendMessage(
    tenantId: string,
    channelId: string,
    externalConversationId: string,
    text: string,
    options?: { replyToMessageId?: string }
  ): Promise<{ success: boolean; externalMessageId?: string; error?: string }> {
    const connection = this.findConnection(tenantId, channelId);
    if (!connection?.connected) {
      return { success: false, error: "Not connected" };
    }

    try {
      const peerId = BigInt(externalConversationId);

      let entity;
      try {
        entity = await connection.client.getEntity(peerId);
        console.log(`[TelegramClientManager] Resolved entity for ${externalConversationId}: ${entity.className}`);
      } catch (entityError: any) {
        console.log(`[TelegramClientManager] Could not resolve entity, trying direct send: ${entityError.message}`);
        entity = peerId;
      }

      const result = await connection.client.sendMessage(entity, {
        message: text,
        replyTo: options?.replyToMessageId ? parseInt(options.replyToMessageId, 10) : undefined,
      });

      connection.lastActivity = new Date();
      console.log(`[TelegramClientManager] Message sent to ${externalConversationId}`);

      return {
        success: true,
        externalMessageId: result.id.toString(),
      };
    } catch (error: any) {
      console.error(`[TelegramClientManager] Send error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sends a file (photo, document, audio, video, etc.) via gramjs sendFile.
   * The file buffer is sent directly — no local storage needed.
   * Returns the sent message ID which can be used to build a proxy URL.
   */
  async sendFileMessage(
    tenantId: string,
    channelId: string,
    externalConversationId: string,
    buffer: Buffer,
    mimeType: string,
    fileName: string,
    caption: string,
  ): Promise<{
    success: boolean;
    externalMessageId?: string;
    accountId?: string;
    error?: string;
  }> {
    const connection = this.findConnection(tenantId, channelId);
    if (!connection?.connected) {
      return { success: false, error: "Not connected" };
    }

    try {
      const peerId = BigInt(externalConversationId);
      let entity: any;
      try {
        entity = await connection.client.getEntity(peerId);
      } catch {
        entity = peerId;
      }

      const forceDocument = !mimeType.startsWith("image/") && !mimeType.startsWith("video/");

      // gramjs CustomFile: (name, size, path, buffer)
      const { CustomFile } = await import("telegram/client/uploads");
      const file = new CustomFile(fileName, buffer.length, "", buffer);

      const result = await connection.client.sendFile(entity, {
        file,
        caption: caption || undefined,
        forceDocument,
        workers: 1,
      });

      connection.lastActivity = new Date();
      const msgId = result.id.toString();
      console.log(`[TelegramClientManager] File sent to ${externalConversationId}, msgId=${msgId}`);

      return {
        success: true,
        externalMessageId: msgId,
        accountId: connection.accountId,
      };
    } catch (error: any) {
      console.error(`[TelegramClientManager] sendFileMessage error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async sendTypingIndicator(tenantId: string, channelId: string, externalConversationId: string): Promise<void> {
    const connection = this.findConnection(tenantId, channelId);
    if (!connection?.connected) return;

    try {
      await connection.client.invoke(
        new Api.messages.SetTyping({
          peer: externalConversationId,
          action: new Api.SendMessageTypingAction(),
        })
      );
    } catch {}
  }

  /** Find a connection by tenantId and channelId (supports both legacy and multi-account) */
  private findConnection(tenantId: string, channelId: string): ActiveConnection | null {
    // Try legacy key first
    const legacyKey = `${tenantId}:legacy_${channelId}`;
    const legacy = this.connections.get(legacyKey);
    if (legacy?.connected) return legacy;

    // Try to find by channelId in multi-account connections
    for (const conn of this.connections.values()) {
      if (conn.tenantId === tenantId && conn.channelId === channelId && conn.connected) {
        return conn;
      }
    }

    return null;
  }

  getClient(tenantId: string, channelId: string): TelegramClient | null {
    const connection = this.findConnection(tenantId, channelId);
    return connection?.connected ? connection.client : null;
  }

  getClientForAccount(tenantId: string, accountId: string): TelegramClient | null {
    const connectionKey = `${tenantId}:${accountId}`;
    const connection = this.connections.get(connectionKey);
    return connection?.connected ? connection.client : null;
  }

  isConnected(tenantId: string, channelId: string): boolean {
    const connection = this.findConnection(tenantId, channelId);
    return connection?.connected || false;
  }

  isAccountConnected(tenantId: string, accountId: string): boolean {
    const connectionKey = `${tenantId}:${accountId}`;
    const connection = this.connections.get(connectionKey);
    return connection?.connected || false;
  }

  /** Get all connections for a specific tenant */
  getConnectionsForTenant(tenantId: string): { accountId: string; channelId: string | null; connected: boolean; lastActivity: Date }[] {
    return Array.from(this.connections.values())
      .filter(c => c.tenantId === tenantId)
      .map(c => ({
        accountId: c.accountId,
        channelId: c.channelId,
        connected: c.connected,
        lastActivity: c.lastActivity,
      }));
  }

  async syncDialogs(tenantId: string, channelId: string, options?: { limit?: number; messageLimit?: number }): Promise<{
    success: boolean;
    dialogsImported: number;
    messagesImported: number;
    error?: string
  }> {
    const connection = this.findConnection(tenantId, channelId);

    if (!connection?.connected) {
      return { success: false, dialogsImported: 0, messagesImported: 0, error: "Not connected" };
    }

    const dialogLimit = options?.limit ?? 50;
    const messageLimit = options?.messageLimit ?? 20;

    console.log(`[TelegramClientManager] Starting dialog sync for ${tenantId}:${channelId}, limit=${dialogLimit}, msgLimit=${messageLimit}`);

    try {
      const dialogs = await connection.client.getDialogs({ limit: dialogLimit });
      console.log(`[TelegramClientManager] Fetched ${dialogs.length} dialogs`);

      let dialogsImported = 0;
      let messagesImported = 0;

      for (const dialog of dialogs) {
        try {
          if (!dialog.entity || !dialog.id) continue;

          const isUser = dialog.isUser;
          if (!isUser) {
            console.log(`[TelegramClientManager] Skipping non-user dialog: ${dialog.title}`);
            continue;
          }

          const chatId = dialog.id.toString();
          const entity = dialog.entity as any;

          const customerName = [entity.firstName, entity.lastName].filter(Boolean).join(" ") || dialog.title || "Unknown";
          const username = entity.username;

          let customer = await storage.getCustomerByExternalId(tenantId, "telegram_personal", chatId);

          if (!customer) {
            customer = await storage.createCustomer({
              tenantId,
              externalId: chatId,
              channel: "telegram_personal",
              name: customerName,
              metadata: { username, telegramId: chatId },
            });
            console.log(`[TelegramClientManager] Created customer: ${customer.id} - ${customerName}`);
          }

          const existingConversations = await storage.getConversationsByTenant(tenantId);
          let existingConv = existingConversations.find(c =>
            c.customerId === customer!.id && c.channelId === channelId
          );

          let conversationId: string;

          if (existingConv) {
            conversationId = existingConv.id;
          } else {
            const newConv = await storage.createConversation({
              tenantId,
              customerId: customer.id,
              channelId: channelId,
              status: "active",
              lastMessageAt: new Date(),
            });
            conversationId = newConv.id;
            dialogsImported++;
          }

          const tgMessages = await connection.client.getMessages(dialog.id, { limit: messageLimit });

          const existingMessages = await storage.getMessagesByConversation(conversationId);
          const existingMsgIds = new Set(
            existingMessages
              .filter(m => m.metadata && typeof m.metadata === 'object' && 'telegramMsgId' in (m.metadata as object))
              .map(m => (m.metadata as { telegramMsgId: string }).telegramMsgId)
          );

          for (const msg of tgMessages.reverse()) {
            if (!msg.text?.trim()) continue;

            const telegramMsgId = msg.id.toString();
            if (existingMsgIds.has(telegramMsgId)) continue;

            const isOutgoing = msg.out || false;
            const senderId = msg.senderId?.toString() || "";

            await storage.createMessage({
              conversationId,
              role: isOutgoing ? "owner" : "customer",
              content: msg.text,
              metadata: {
                channel: "telegram_personal",
                synced: true,
                syncedAt: new Date().toISOString(),
                telegramMsgId,
                senderId,
                senderName: isOutgoing ? "Operator" : customerName,
              },
              createdAt: new Date((msg.date || 0) * 1000),
            });
            messagesImported++;
          }

          if (tgMessages.length > 0) {
            const lastMsg = tgMessages[0];
            await storage.updateConversation(conversationId, {
              lastMessageAt: new Date((lastMsg.date || 0) * 1000),
            });
          }

        } catch (dialogError: any) {
          console.error(`[TelegramClientManager] Error processing dialog ${dialog.title}:`, dialogError.message);
        }
      }

      console.log(`[TelegramClientManager] Sync complete: ${dialogsImported} dialogs, ${messagesImported} messages imported`);
      return { success: true, dialogsImported, messagesImported };

    } catch (error: any) {
      console.error(`[TelegramClientManager] Sync error:`, error.message);
      return { success: false, dialogsImported: 0, messagesImported: 0, error: error.message };
    }
  }

  async verifyConnection(tenantId: string, channelId: string): Promise<{ connected: boolean; user?: { id: number; firstName: string; username?: string } }> {
    const connection = this.findConnection(tenantId, channelId);

    if (!connection) {
      return { connected: false };
    }

    try {
      const me = await connection.client.getMe() as Api.User;
      connection.connected = true;
      connection.lastActivity = new Date();

      return {
        connected: true,
        user: {
          id: Number(me.id),
          firstName: me.firstName || "",
          username: me.username,
        },
      };
    } catch (error: any) {
      console.log(`[TelegramClientManager] Verify failed for ${tenantId}:${channelId}: ${error.message}`);
      connection.connected = false;

      const connectionKey = `${tenantId}:${connection.accountId}`;
      await this.disconnectByKey(connectionKey);

      if (connection.channelId) {
        try {
          await storage.updateChannel(connection.channelId, { isActive: false });
        } catch {}
      }

      return { connected: false };
    }
  }

  async verifyAccountConnection(tenantId: string, accountId: string): Promise<{ connected: boolean; user?: { id: number; firstName: string; username?: string } }> {
    const connectionKey = `${tenantId}:${accountId}`;
    const connection = this.connections.get(connectionKey);

    if (!connection) {
      return { connected: false };
    }

    try {
      const me = await connection.client.getMe() as Api.User;
      connection.connected = true;
      connection.lastActivity = new Date();

      return {
        connected: true,
        user: {
          id: Number(me.id),
          firstName: me.firstName || "",
          username: me.username,
        },
      };
    } catch (error: any) {
      connection.connected = false;
      return { connected: false };
    }
  }

  getActiveConnections(): { tenantId: string; channelId: string | null; accountId: string; lastActivity: Date }[] {
    return Array.from(this.connections.values()).map((c) => ({
      tenantId: c.tenantId,
      channelId: c.channelId,
      accountId: c.accountId,
      lastActivity: c.lastActivity,
    }));
  }

  async resolvePhoneNumber(
    tenantId: string,
    channelId: string,
    phoneNumber: string
  ): Promise<{ success: boolean; userId?: string; firstName?: string; lastName?: string; error?: string }> {
    const connection = this.findConnection(tenantId, channelId);

    if (!connection?.connected) {
      return { success: false, error: "Not connected to Telegram" };
    }

    try {
      const cleanPhone = phoneNumber.replace(/[^\d+]/g, "");
      console.log(`[TelegramClientManager] Resolving phone: ${cleanPhone}`);

      const contact = new Api.InputPhoneContact({
        clientId: BigInt(Date.now()),
        phone: cleanPhone,
        firstName: "Lead",
        lastName: cleanPhone.slice(-4),
      });

      const result = await connection.client.invoke(
        new Api.contacts.ImportContacts({
          contacts: [contact],
        })
      );

      if (result.users && result.users.length > 0) {
        const user = result.users[0] as Api.User;
        const userId = user.id.toString();
        console.log(`[TelegramClientManager] Resolved ${cleanPhone} to user ${userId}: ${user.firstName} ${user.lastName || ""}`);

        return {
          success: true,
          userId,
          firstName: user.firstName || "User",
          lastName: user.lastName || "",
        };
      }

      return { success: false, error: "Phone number not registered in Telegram" };
    } catch (error: any) {
      console.error(`[TelegramClientManager] Phone resolve error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async startConversationByPhone(
    tenantId: string,
    channelId: string,
    phoneNumber: string,
    initialMessage?: string
  ): Promise<{ success: boolean; conversationId?: string; userId?: string; error?: string }> {
    const resolveResult = await this.resolvePhoneNumber(tenantId, channelId, phoneNumber);

    if (!resolveResult.success || !resolveResult.userId) {
      return { success: false, error: resolveResult.error || "Could not resolve phone number" };
    }

    if (initialMessage) {
      const sendResult = await this.sendMessage(tenantId, channelId, resolveResult.userId, initialMessage);
      if (!sendResult.success) {
        return { success: false, error: sendResult.error };
      }
    }

    return {
      success: true,
      conversationId: resolveResult.userId,
      userId: resolveResult.userId,
    };
  }

  async shutdown(): Promise<void> {
    console.log("[TelegramClientManager] Shutting down...");

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    Array.from(this.reconnectTimers.values()).forEach((timer) => {
      clearTimeout(timer);
    });
    this.reconnectTimers.clear();

    for (const [key, connection] of Array.from(this.connections.entries())) {
      try {
        await connection.client.disconnect();
        console.log(`[TelegramClientManager] Disconnected: ${key}`);
      } catch {}
    }
    this.connections.clear();
    this.isInitialized = false;

    console.log("[TelegramClientManager] Shutdown complete");
  }
}

export const telegramClientManager = new TelegramClientManager();
