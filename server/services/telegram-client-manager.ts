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
  reconnectAttempts: number;
}

interface PendingOutboundMessage {
  externalConversationId: string;
  text: string;
  options?: { replyToMessageId?: string };
  addedAt: Date;
}

class TelegramClientManager {
  private connections = new Map<string, ActiveConnection>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private reconnectCounts = new Map<string, number>(); // persists across reconnect cycles
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;
  // Queue of outbound messages that arrived while a channel was reconnecting.
  // Key: "tenantId:channelId". Flushed automatically when the connection is restored.
  private pendingOutbound = new Map<string, PendingOutboundMessage[]>();
  private static readonly PENDING_MESSAGE_TTL_MS = 10 * 60 * 1000; // 10 min

  // access_hash cache: `tenantId:userId` → BigInt accessHash.
  // Populated on every inbound message.  Telegram MTProto requires the
  // access_hash to send to a user; gramjs caches it in memory but loses it
  // on server restart if the entity was not in the preloaded dialogs.
  private accessHashCache = new Map<string, bigint>();

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
    // Part 1: ping existing connections and reconnect broken ones
    for (const [key, connection] of Array.from(this.connections.entries())) {
      try {
        await connection.client.getMe();
        connection.reconnectAttempts = 0; // reset on successful heartbeat
      } catch (error: any) {
        const msg: string = error?.message ?? String(error);
        console.warn(`[TelegramClientManager] Heartbeat FAILED: ${key} - ${msg}`);
        connection.connected = false;

        // Remove from map so heartbeat won't fire on the same broken client again
        this.connections.delete(key);
        try { await connection.client.disconnect(); } catch {}

        this.scheduleReconnect(key, connection, msg);
      }
    }

    // Part 2: detect orphaned accounts — active in DB but absent from connections
    // map AND not already scheduled for reconnect. This handles the case where the
    // process restarted without initialize() completing (e.g. migration error on the
    // previous boot) or where all reconnect attempts silently gave up.
    try {
      const isEnabled = await featureFlagService.isEnabled("TELEGRAM_PERSONAL_CHANNEL_ENABLED");
      if (!isEnabled) return;

      const accounts = await storage.getActiveTelegramAccounts();
      for (const account of accounts) {
        if (!account.sessionString) continue;
        const connectionKey = `${account.tenantId}:${account.id}`;
        const alreadyConnected = this.connections.has(connectionKey);
        const hasPendingTimer = this.reconnectTimers.has(connectionKey);
        if (!alreadyConnected && !hasPendingTimer) {
          console.log(`[TelegramClientManager] Heartbeat detected orphaned account ${connectionKey} — triggering reconnect`);
          // Fire-and-forget; errors are handled inside connectAccount via scheduleReconnect
          this.connectAccount(account.tenantId, account.id, account.channelId, account.sessionString)
            .catch((err: any) => console.error(`[TelegramClientManager] Heartbeat reconnect failed for ${connectionKey}:`, err.message));
        }
      }
    } catch (err: any) {
      console.warn(`[TelegramClientManager] Heartbeat orphan check error: ${err.message}`);
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
  async connectAccount(tenantId: string, accountId: string, channelId: string | null, sessionString: string, existingClient?: TelegramClient): Promise<boolean> {
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
      let client: TelegramClient;

      if (existingClient) {
        // Reuse the already-connected auth client — no disconnect/reconnect needed.
        // This avoids AUTH_KEY_DUPLICATED that would occur if we disconnected and
        // immediately reconnected with the same session/auth key.
        console.log(`[TelegramClientManager] Adopting existing auth client for ${connectionKey}`);
        client = existingClient;
      } else {
        const { apiId, apiHash } = credentials;
        const session = new StringSession(sessionString);
        client = new TelegramClient(session, apiId, apiHash, {
          connectionRetries: 0,
          // autoReconnect: false — all reconnection is handled by our scheduleReconnect logic.
          // gramJS's internal autoReconnect races with our reconnect on AUTH_KEY_DUPLICATED:
          // gramJS queues its own retry before our catch block can stop it, causing two
          // simultaneous connections with the same auth key → infinite AUTH_KEY_DUPLICATED loop.
          autoReconnect: false,
        });

        console.log(`[TelegramClientManager] Connecting account ${connectionKey}...`);
        await Promise.race([
          client.connect(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("client.connect() timed out after 30s")), 30000)
          ),
        ]);
      }

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
        reconnectAttempts: 0,
      };

      this.connections.set(connectionKey, connection);
      this.ensureHandlers(connection);

      // Preload only 5 most recent dialogs on connect — old dialogs are loaded lazily on new message
      try {
        const dialogs = await client.getDialogs({ limit: 5 });
        console.log(`[TelegramClientManager] Preloaded ${dialogs.length} recent dialogs for entity cache`);
      } catch (dialogError: any) {
        console.log(`[TelegramClientManager] Could not preload dialogs: ${dialogError.message}`);
      }

      console.log(`[TelegramClientManager] Connected: ${connectionKey}, total: ${this.connections.size}`);
      this.reconnectCounts.delete(connectionKey); // reset on success

      // Persist the current session string — gramjs may have rotated the auth key during connect
      // (e.g. after AUTH_KEY_DUPLICATED recovery). Without this, the next restart re-reads the
      // stale key from DB and immediately hits AUTH_KEY_DUPLICATED or AUTH_KEY_INVALID again.
      try {
        const savedSession = client.session.save() as unknown as string;
        if (savedSession && savedSession !== sessionString) {
          console.log(`[TelegramClientManager] Auth key rotated for ${connectionKey} — persisting updated session to DB`);
          await storage.updateTelegramAccount(accountId, { sessionString: savedSession });
          connection.sessionString = savedSession;
        }
      } catch (saveErr: any) {
        console.warn(`[TelegramClientManager] Could not persist updated session for ${connectionKey}: ${saveErr.message}`);
      }

      // Flush any messages that were queued while this channel was reconnecting
      if (channelId) {
        this.flushPendingMessages(tenantId, channelId).catch((err: any) =>
          console.error(`[TelegramClientManager] flushPendingMessages error for ${connectionKey}: ${err.message}`)
        );
      }

      return true;
    } catch (error: any) {
      console.error(`[TelegramClientManager] Connection error for ${connectionKey}:`, error.message);
      try { await client.disconnect(); } catch {}
      const conn: ActiveConnection = {
        tenantId, accountId, channelId,
        client: null as any, sessionString,
        connected: false, lastActivity: new Date(), handlersAttached: false,
        reconnectAttempts: 0,
      };
      this.scheduleReconnect(`${tenantId}:${accountId}`, conn, error.message);
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
        connectionRetries: 0,
        autoReconnect: false,
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
        reconnectAttempts: 0,
      };

      this.connections.set(connectionKey, connection);
      this.ensureHandlers(connection);

      try {
        const dialogs = await client.getDialogs({ limit: 5 });
        console.log(`[TelegramClientManager] Preloaded ${dialogs.length} dialogs for entity cache`);
      } catch (dialogError: any) {
        console.log(`[TelegramClientManager] Could not preload dialogs: ${dialogError.message}`);
      }

      console.log(`[TelegramClientManager] Connected: ${connectionKey}, total connections: ${this.connections.size}`);
      this.reconnectCounts.delete(connectionKey); // reset on success

      // Flush any messages queued while this legacy channel was reconnecting
      this.flushPendingMessages(tenantId, channelId).catch((err: any) =>
        console.error(`[TelegramClientManager] flushPendingMessages error for ${connectionKey}: ${err.message}`)
      );

      return true;
    } catch (error: any) {
      console.error(`[TelegramClientManager] Connection error for ${connectionKey}:`, error.message);
      try { await client.disconnect(); } catch {}
      const conn: ActiveConnection = {
        tenantId, accountId: legacyAccountId, channelId,
        client: null as any, sessionString,
        connected: false, lastActivity: new Date(), handlersAttached: false,
        reconnectAttempts: 0,
      };
      this.scheduleReconnect(connectionKey, conn, error.message);
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
        // Cache the access_hash so we can send back without needing getEntity().
        // For a private chat chatId === the peer user ID, so we key by chatId.
        const hash = (sender as any)?.accessHash;
        if (hash != null) {
          this.accessHashCache.set(`${tenantId}:${chatId}`, BigInt(hash));
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

      // Check if this is a brand-new chat (not yet in DB) — for lazy history sync
      const existingCustomer = await storage.getCustomerByExternalId(tenantId, "telegram_personal", chatId);
      const isNewChat = !existingCustomer;

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

      // Lazy-sync history for chats that weren't in the initial 5 dialogs
      if (isNewChat && channelId) {
        try {
          const customer = await storage.getCustomerByExternalId(tenantId, "telegram_personal", chatId);
          if (customer) {
            const conversations = await storage.getConversationsByTenant(tenantId);
            const conv = conversations.find(c => c.customerId === customer.id && c.channelId === channelId);
            if (conv) {
              // Run async, don't block message delivery
              this.syncSingleChatHistory(tenantId, accountId, channelId, chatId, conv.id, senderName).catch(() => {});
            }
          }
        } catch { /* non-fatal */ }
      }
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

  // Truly fatal errors — session is permanently revoked, never retry
  private static readonly FATAL_ERRORS = [
    "SESSION_REVOKED",
    "USER_DEACTIVATED",
    "USER_DEACTIVATED_BAN",
  ];

  // Temporary errors after restart — retry with longer delay, Telegram releases the old key after ~60s
  private static readonly TRANSIENT_ERRORS = [
    "AUTH_KEY_DUPLICATED",
    "AUTH_KEY_INVALID",
    "SESSION_EXPIRED",
  ];

  // After this many fast 90s retries for AUTH_KEY_DUPLICATED, switch to slow 5-min retries.
  // Never give up on AUTH_KEY_DUPLICATED — it is always transient (old container still running on deploy).
  private static readonly MAX_DUPLICATE_FAST_ATTEMPTS = 4;
  private static readonly MAX_RECONNECT_ATTEMPTS = 10;
  // Slow-retry delay after fast attempts are exhausted (e.g. long-running old container during deploy)
  private static readonly SLOW_RETRY_DELAY_MS = 5 * 60 * 1000;

  private scheduleReconnect(connectionKey: string, connection: ActiveConnection, errorMessage?: string): void {
    // Permanently fatal — stop immediately and update status
    if (errorMessage) {
      const isFatal = TelegramClientManager.FATAL_ERRORS.some((e) => errorMessage.includes(e));
      if (isFatal) {
        console.error(
          `[TelegramClientManager] FATAL error for ${connectionKey}: ${errorMessage}. ` +
          `Session permanently revoked — user must re-authorize.`
        );
        this.reconnectCounts.delete(connectionKey);
        if (!connection.accountId.startsWith("legacy_")) {
          storage.updateTelegramAccount(connection.accountId, {
            status: "error",
            lastError: errorMessage,
            isEnabled: false,
          }).catch(() => {});
        }
        return;
      }
    }

    // Increment persistent counter (survives across connectAccount calls)
    const attempts = (this.reconnectCounts.get(connectionKey) ?? 0) + 1;
    this.reconnectCounts.set(connectionKey, attempts);

    const isAuthKeyDuplicated = errorMessage?.includes("AUTH_KEY_DUPLICATED") ?? false;

    // AUTH_KEY_DUPLICATED is ALWAYS a transient error caused by deploy overlap (old container still running).
    // After MAX_DUPLICATE_FAST_ATTEMPTS fast retries, switch to slow 5-min retries — never give up entirely.
    if (isAuthKeyDuplicated && attempts > TelegramClientManager.MAX_DUPLICATE_FAST_ATTEMPTS) {
      console.warn(
        `[TelegramClientManager] AUTH_KEY_DUPLICATED still present after ${attempts} attempts for ${connectionKey}. ` +
        `Old container likely still running. Switching to slow retry every ${TelegramClientManager.SLOW_RETRY_DELAY_MS / 60000}min.`
      );
      // Reset counter so the cycle can repeat if needed, but mark disconnected in DB for UI visibility
      this.reconnectCounts.set(connectionKey, 0);
      if (!connection.accountId.startsWith("legacy_")) {
        storage.updateTelegramAccount(connection.accountId, {
          status: "disconnected",
          lastError: "AUTH_KEY_DUPLICATED — old deployment still running, will retry automatically",
        }).catch(() => {});
      }

      const existingTimer = this.reconnectTimers.get(connectionKey);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(async () => {
        console.log(`[TelegramClientManager] Slow retry for ${connectionKey} after AUTH_KEY_DUPLICATED cooldown — fully reinitializing client`);
        this.reconnectTimers.delete(connectionKey);

        // Destroy any lingering in-memory client state so the next attempt starts completely fresh.
        // The old Railway container should be long gone by now (30-60s TTL vs our 5min wait).
        const stale = this.connections.get(connectionKey);
        if (stale) {
          try { await stale.client.disconnect(); } catch {}
          this.connections.delete(connectionKey);
        }

        if (connection.accountId.startsWith("legacy_")) {
          await this.connect(connection.tenantId, connection.channelId!, connection.sessionString);
        } else {
          // Reload session from DB — it may have been rotated during a prior successful connect
          // in another process or a previous restart cycle.
          let freshSession = connection.sessionString;
          try {
            const account = await storage.getTelegramAccountById(connection.accountId);
            if (account?.sessionString) {
              freshSession = account.sessionString;
              if (freshSession !== connection.sessionString) {
                console.log(`[TelegramClientManager] Using refreshed session from DB for ${connectionKey}`);
              }
            }
          } catch (dbErr: any) {
            console.warn(`[TelegramClientManager] Could not reload session from DB for ${connectionKey}: ${dbErr.message}`);
          }
          await this.connectAccount(connection.tenantId, connection.accountId, connection.channelId, freshSession);
        }
      }, TelegramClientManager.SLOW_RETRY_DELAY_MS);

      this.reconnectTimers.set(connectionKey, timer);
      return;
    }

    // Stop non-AUTH_KEY_DUPLICATED errors after max attempts to avoid infinite loops
    if (!isAuthKeyDuplicated && attempts > TelegramClientManager.MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[TelegramClientManager] Max reconnect attempts (${TelegramClientManager.MAX_RECONNECT_ATTEMPTS}) ` +
        `reached for ${connectionKey}. Giving up.`
      );
      this.reconnectCounts.delete(connectionKey);
      if (!connection.accountId.startsWith("legacy_")) {
        storage.updateTelegramAccount(connection.accountId, {
          status: "error",
          lastError: errorMessage ?? "Max reconnect attempts reached",
        }).catch(() => {});
      }
      return;
    }

    const existingTimer = this.reconnectTimers.get(connectionKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // AUTH_KEY_DUPLICATED after restart is temporary — Telegram releases old key after ~30–60s
    // once the old container stops. Use an escalating delay: 30s → 60s → 90s → 90s so the first
    // retry is fast (old container usually stops within 30s on Railway) but subsequent retries
    // back off without hammering Telegram. For network drops (non-transient), start with 5s and
    // apply exponential backoff capped at 5 min.
    const isTransient = errorMessage
      ? TelegramClientManager.TRANSIENT_ERRORS.some((e) => errorMessage.includes(e))
      : false;
    const transientDelay = Math.min(30000 * attempts, 90000); // 30s, 60s, 90s, 90s, ...
    const delay = isTransient
      ? transientDelay
      : Math.min(5000 * Math.pow(2, attempts - 1), 300000);

    console.log(
      `[TelegramClientManager] Scheduling reconnect #${attempts} ` +
      `for ${connectionKey} in ${delay / 1000}s` +
      (isTransient ? " (waiting for Telegram to release old key)" : "")
    );

    const timer = setTimeout(async () => {
      console.log(`[TelegramClientManager] Attempting reconnect: ${connectionKey}`);
      this.reconnectTimers.delete(connectionKey);
      if (connection.accountId.startsWith("legacy_")) {
        await this.connect(connection.tenantId, connection.channelId!, connection.sessionString);
      } else {
        await this.connectAccount(connection.tenantId, connection.accountId, connection.channelId, connection.sessionString);
      }
    }, delay);

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

  /** Enqueue an outbound message to be delivered once the channel reconnects. */
  private enqueuePendingMessage(
    tenantId: string,
    channelId: string,
    externalConversationId: string,
    text: string,
    options?: { replyToMessageId?: string },
  ): void {
    const queueKey = `${tenantId}:${channelId}`;
    const queue = this.pendingOutbound.get(queueKey) ?? [];
    queue.push({ externalConversationId, text, options, addedAt: new Date() });
    this.pendingOutbound.set(queueKey, queue);
    console.log(`[TelegramClientManager] Queued message for ${queueKey} (queue size: ${queue.length})`);
  }

  /** Deliver all queued messages for a channel now that it is connected. */
  private async flushPendingMessages(tenantId: string, channelId: string | null): Promise<void> {
    if (!channelId) return;
    const queueKey = `${tenantId}:${channelId}`;
    const queue = this.pendingOutbound.get(queueKey);
    if (!queue || queue.length === 0) return;

    this.pendingOutbound.delete(queueKey);
    const now = Date.now();
    const alive = queue.filter(m => now - m.addedAt.getTime() < TelegramClientManager.PENDING_MESSAGE_TTL_MS);
    const expired = queue.length - alive.length;
    if (expired > 0) {
      console.log(`[TelegramClientManager] Dropped ${expired} expired queued message(s) for ${queueKey}`);
    }

    console.log(`[TelegramClientManager] Flushing ${alive.length} queued message(s) for ${queueKey}`);
    for (const msg of alive) {
      const result = await this.sendMessage(tenantId, channelId, msg.externalConversationId, msg.text, msg.options);
      if (!result.success) {
        console.error(`[TelegramClientManager] Queued message delivery failed for ${queueKey}: ${result.error}`);
      }
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
      // If there is a reconnect in progress, queue the message for delivery on restore.
      // Check whether any connection key for this channel has a pending timer.
      const hasPendingReconnect = Array.from(this.reconnectTimers.keys()).some(key => key.startsWith(tenantId));
      if (hasPendingReconnect) {
        this.enqueuePendingMessage(tenantId, channelId, externalConversationId, text, options);
        return { success: false, error: "Not connected — message queued for delivery on reconnect" };
      }
      return { success: false, error: "Not connected" };
    }

    try {
      const peerId = BigInt(externalConversationId);

      let entity;
      try {
        entity = await connection.client.getEntity(peerId);
        console.log(`[TelegramClientManager] Resolved entity for ${externalConversationId}: ${entity.className}`);
      } catch (entityError: any) {
        // 1. Check in-memory access_hash cache (populated on every inbound message).
        const cachedHash = this.accessHashCache.get(`${tenantId}:${externalConversationId}`);
        if (cachedHash !== undefined) {
          console.log(`[TelegramClientManager] Using cached access_hash for ${externalConversationId}`);
          entity = new Api.InputPeerUser({ userId: peerId, accessHash: cachedHash });
        } else {
          // 2. Cache miss (e.g. after server restart): load recent dialogs to repopulate
          //    gramjs entity cache, then retry getEntity.
          console.log(`[TelegramClientManager] No access_hash cached for ${externalConversationId}, loading dialogs...`);
          try {
            await connection.client.getDialogs({ limit: 100 });
            entity = await connection.client.getEntity(peerId);
            console.log(`[TelegramClientManager] Resolved entity after dialog refresh: ${externalConversationId}`);
          } catch {
            // 3. Last resort — raw BigInt.  Will still fail if the user has never
            //    messaged this account, but surfacing the real error is more useful
            //    than silently swallowing it.
            console.log(`[TelegramClientManager] Could not resolve entity even after dialog refresh, trying raw peer: ${entityError.message}`);
            entity = peerId;
          }
        }
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
        const cachedHash = this.accessHashCache.get(`${tenantId}:${externalConversationId}`);
        if (cachedHash !== undefined) {
          entity = new Api.InputPeerUser({ userId: peerId, accessHash: cachedHash });
        } else {
          try {
            await connection.client.getDialogs({ limit: 100 });
            entity = await connection.client.getEntity(peerId);
          } catch {
            entity = peerId;
          }
        }
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

    const dialogLimit = options?.limit ?? 5;
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
            }, tenantId);
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
            }, tenantId);
            conversationId = newConv.id;
            dialogsImported++;
          }

          const tgMessages = await connection.client.getMessages(dialog.id, { limit: messageLimit });

          const existingMessages = await storage.getMessagesByConversation(conversationId, tenantId);
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
            }, tenantId);
            messagesImported++;
          }

          if (tgMessages.length > 0) {
            const lastMsg = tgMessages[0];
            await storage.updateConversation(conversationId, tenantId, {
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

  /**
   * Lazily syncs history for a single chat when a new message arrives from an unknown user.
   * Fetches last `messageLimit` messages (excluding the just-received one) and saves to DB.
   */
  async syncSingleChatHistory(
    tenantId: string,
    accountId: string,
    channelId: string | null,
    chatId: string,
    conversationId: string,
    customerName: string,
    messageLimit = 20,
  ): Promise<void> {
    const connectionKey = `${tenantId}:${accountId}`;
    const connection = this.connections.get(connectionKey);
    if (!connection?.connected) return;

    try {
      const tgMessages = await connection.client.getMessages(chatId, { limit: messageLimit });
      const existingMessages = await storage.getMessagesByConversation(conversationId, tenantId);
      const existingMsgIds = new Set(
        existingMessages
          .filter(m => m.metadata && typeof m.metadata === "object" && "telegramMsgId" in (m.metadata as object))
          .map(m => (m.metadata as { telegramMsgId: string }).telegramMsgId),
      );

      let imported = 0;
      for (const msg of tgMessages.reverse()) {
        if (!msg.text?.trim()) continue;
        const telegramMsgId = msg.id.toString();
        if (existingMsgIds.has(telegramMsgId)) continue;

        await storage.createMessage({
          conversationId,
          role: msg.out ? "owner" : "customer",
          content: msg.text,
          metadata: {
            channel: "telegram_personal",
            synced: true,
            syncedAt: new Date().toISOString(),
            telegramMsgId,
            senderId: msg.senderId?.toString() || "",
            senderName: msg.out ? "Operator" : customerName,
          },
          createdAt: new Date((msg.date || 0) * 1000),
        }, tenantId);
        imported++;
      }
      if (imported > 0) {
        console.log(`[TelegramClientManager] Lazy-synced ${imported} messages for new chat ${chatId}`);
      }
    } catch (err: any) {
      console.warn(`[TelegramClientManager] Lazy sync failed for chat ${chatId}: ${err.message}`);
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

  /**
   * Send a message to a Telegram user by their @username.
   * Works even if there's no existing conversation (gramjs resolves the entity).
   * Returns userId (numeric string) for creating the customer record.
   */
  async sendMessageByUsername(
    tenantId: string,
    accountId: string,
    username: string,
    text: string,
  ): Promise<{ success: boolean; externalMessageId?: string; userId?: string; firstName?: string; username?: string; error?: string }> {
    // Find any connected account for this tenant (or specific accountId)
    const connection = accountId
      ? this.connections.get(`${tenantId}:${accountId}`) ?? this.findAnyConnection(tenantId)
      : this.findAnyConnection(tenantId);

    if (!connection?.connected) {
      return { success: false, error: "No connected Telegram Personal account" };
    }

    const cleanUsername = username.startsWith("@") ? username : `@${username}`;

    try {
      console.log(`[TelegramClientManager] Sending to username ${cleanUsername} via account ${connection.accountId}`);
      const entity = await connection.client.getEntity(cleanUsername);
      const result = await connection.client.sendMessage(entity, { message: text });

      const user = entity as Api.User;
      const userId = user.id?.toString() ?? "";
      const firstName = user.firstName ?? "";
      const resolvedUsername = user.username ?? username;

      // Cache access_hash for future sends
      if (user.accessHash !== undefined && userId) {
        this.accessHashCache.set(`${tenantId}:${userId}`, user.accessHash);
      }

      connection.lastActivity = new Date();
      console.log(`[TelegramClientManager] Message sent to ${cleanUsername} (userId=${userId}), msgId=${result.id}`);

      return {
        success: true,
        externalMessageId: result.id.toString(),
        userId,
        firstName,
        username: resolvedUsername,
      };
    } catch (error: any) {
      console.error(`[TelegramClientManager] sendMessageByUsername error for ${cleanUsername}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Two-account strategy for sending by phone number without shadow-ban risk:
   *
   * Account A (resolver) — calls contacts.ImportContacts(phone) to get userId + accessHash.
   *   ImportContacts does NOT trigger the phone-search shadow ban.
   * Account B (sender)   — sends the actual message using InputPeerUser(userId, accessHash).
   *   Because it uses a known userId (not a search), it also avoids the shadow ban.
   *
   * If only one account is connected, it acts as both A and B.
   * Returns userId so the caller can create/find the customer record.
   */
  async importContactAndSend(
    tenantId: string,
    phone: string,
    text: string,
  ): Promise<{
    success: boolean;
    userId?: string;
    firstName?: string;
    username?: string;
    accountId?: string;  // sender account id
    error?: string;
  }> {
    // Collect all connected accounts for this tenant, with their DB roles
    const allConns = Array.from(this.connections.values()).filter(
      c => c.tenantId === tenantId && c.connected,
    );

    if (allConns.length === 0) {
      return { success: false, error: "No connected Telegram Personal account" };
    }

    const cleanPhone = phone.replace(/[^\d+]/g, "");

    // Load roles from DB to honour resolver/sender designation
    let accountRoles: Map<string, string> = new Map();
    try {
      const accounts = await storage.getTelegramAccountsByTenant(tenantId);
      for (const a of accounts) {
        accountRoles.set(a.id, (a as any).tgRole ?? "both");
      }
    } catch { /* fallback: treat all as "both" */ }

    // ── Step 1: Account A — importContacts → userId + accessHash ────────────
    // Prefer explicit "resolver" or "both"; fallback to first connected account.
    const resolverConn =
      allConns.find(c => accountRoles.get(c.accountId) === "resolver") ??
      allConns.find(c => accountRoles.get(c.accountId) === "both") ??
      allConns[0];

    let userId: string;
    let accessHash: bigint;
    let firstName = "";
    let username: string | undefined;

    try {
      console.log(`[TelegramClientManager] importContactAndSend: resolving ${cleanPhone} via account ${resolverConn.accountId}`);

      const contact = new Api.InputPhoneContact({
        clientId: BigInt(Date.now()),
        phone: cleanPhone,
        firstName: "Lead",
        lastName: cleanPhone.slice(-4),
      });

      const result = await resolverConn.client.invoke(
        new Api.contacts.ImportContacts({ contacts: [contact] }),
      );

      if (!result.users || result.users.length === 0) {
        return { success: false, error: "Phone not registered in Telegram" };
      }

      const user = result.users[0] as Api.User;
      userId = user.id.toString();
      accessHash = user.accessHash!;
      firstName = user.firstName ?? "";
      username = user.username ?? undefined;

      console.log(`[TelegramClientManager] importContacts: resolved ${cleanPhone} → userId=${userId} (${firstName})`);

      // Cache for resolver account too (in case it is also the sender)
      this.accessHashCache.set(`${tenantId}:${userId}`, accessHash);
    } catch (err: any) {
      console.error(`[TelegramClientManager] importContacts failed for ${cleanPhone}: ${err.message}`);
      return { success: false, error: err.message };
    }

    // ── Step 2: Account B — send message using userId + accessHash ───────────
    // Prefer explicit "sender" or "both"; avoid the resolver if possible.
    const senderConn =
      allConns.find(c => accountRoles.get(c.accountId) === "sender") ??
      allConns.find(c => c.accountId !== resolverConn.accountId && accountRoles.get(c.accountId) === "both") ??
      allConns.find(c => c.accountId !== resolverConn.accountId) ??
      resolverConn;

    // Cache the accessHash for the sender account's entity lookup
    this.accessHashCache.set(`${tenantId}:${userId}`, accessHash);

    try {
      console.log(`[TelegramClientManager] importContactAndSend: sending to userId=${userId} via account ${senderConn.accountId}`);

      const peer = new Api.InputPeerUser({
        userId: BigInt(userId),
        accessHash,
      });

      const result = await senderConn.client.sendMessage(peer, { message: text });
      senderConn.lastActivity = new Date();

      console.log(`[TelegramClientManager] importContactAndSend: sent to ${userId}, msgId=${result.id}`);

      return {
        success: true,
        userId,
        firstName,
        username,
        accountId: senderConn.accountId,
        externalMessageId: result.id.toString(),
      } as any;
    } catch (err: any) {
      console.error(`[TelegramClientManager] importContactAndSend send failed for userId=${userId}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /** Find any connected account for the given tenant */
  private findAnyConnection(tenantId: string): ActiveConnection | undefined {
    for (const [, conn] of this.connections) {
      if (conn.tenantId === tenantId && conn.connected) return conn;
    }
    return undefined;
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
    this.pendingOutbound.clear();
    this.isInitialized = false;

    console.log("[TelegramClientManager] Shutdown complete");
  }
}

export const telegramClientManager = new TelegramClientManager();
