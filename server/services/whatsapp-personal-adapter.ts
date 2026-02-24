import type { WASocket } from "@whiskeysockets/baileys";

let _baileys: typeof import("@whiskeysockets/baileys") | null = null;
async function getBaileys() {
  if (!_baileys) {
    _baileys = await import("@whiskeysockets/baileys");
  }
  return _baileys;
}
import type { ChannelAdapter, ParsedIncomingMessage, ChannelSendResult } from "./channel-adapter";
import type { ChannelType } from "@shared/schema";
import { featureFlagService } from "./feature-flags";
import { processIncomingMessageFull } from "./inbound-message-handler";
import { sanitizeForLog } from "../utils/sanitizer";
import * as fs from "fs";
import * as path from "path";
import pino from "pino";
import QRCode from "qrcode";

const AUTH_DIR = "./whatsapp_sessions";

interface AuthSession {
  socket: WASocket | null;
  qrCode: string | null;
  qrDataUrl: string | null;
  pairingCode: string | null;
  status: "disconnected" | "connecting" | "qr_ready" | "pairing_code_ready" | "connected" | "error";
  error?: string;
  user?: {
    id: string;
    name: string;
    phone: string;
  };
  messageHandler?: (message: any) => void;
  authMethod?: "qr" | "phone";
  reconnectAttempts?: number;
  reconnecting?: boolean;
}

const authSessions = new Map<string, AuthSession>();

export class WhatsAppPersonalAdapter implements ChannelAdapter {
  readonly name: ChannelType = "whatsapp_personal";
  
  private tenantId: string;

  constructor(tenantId: string = "default") {
    this.tenantId = tenantId;
  }

  async sendMessage(
    externalConversationId: string,
    text: string,
    options?: { replyToMessageId?: string }
  ): Promise<ChannelSendResult> {
    const isEnabled = await featureFlagService.isEnabled("WHATSAPP_PERSONAL_CHANNEL_ENABLED");
    if (!isEnabled) {
      console.log("[WhatsAppPersonal] Channel disabled by feature flag");
      return { success: false, error: "WhatsApp Personal channel disabled" };
    }

    const session = authSessions.get(this.tenantId);
    if (!session?.socket || session.status !== "connected") {
      return { success: false, error: "Not connected to WhatsApp" };
    }

    try {
      const jid = externalConversationId.includes("@") 
        ? externalConversationId 
        : `${externalConversationId}@s.whatsapp.net`;

      const result = await session.socket.sendMessage(jid, { 
        text,
        ...(options?.replyToMessageId ? {
          quoted: { key: { id: options.replyToMessageId } } as any
        } : {})
      });

      console.log(`[WhatsAppPersonal] Message sent to ${externalConversationId}`);
      return {
        success: true,
        externalMessageId: result?.key?.id || `wap_${Date.now()}`,
        timestamp: new Date(),
      };
    } catch (error: any) {
      console.error("[WhatsAppPersonal] Send error:", error.message);
      return { success: false, error: error.message };
    }
  }

  parseIncomingMessage(rawPayload: unknown): ParsedIncomingMessage | null {
    try {
      if (!rawPayload || typeof rawPayload !== "object") {
        console.log("[WhatsAppPersonal] Parse: invalid payload");
        return null;
      }

      const msg = rawPayload as any;
      
      console.log("[WhatsAppPersonal] Raw message structure:", JSON.stringify({
        hasKey: !!msg.key,
        hasMessage: !!msg.message,
        messageKeys: msg.message ? Object.keys(msg.message) : [],
        pushName: msg.pushName,
      }));
      
      if (!msg.key?.remoteJid) {
        console.log("[WhatsAppPersonal] Parse: no remoteJid in key");
        return null;
      }

      const jid = msg.key.remoteJid;
      const isGroup = jid.endsWith("@g.us");
      const isLid = jid.endsWith("@lid");
      
      const phone = jid.replace("@s.whatsapp.net", "").replace("@g.us", "").replace("@lid", "");
      
      let text = "";
      const messageContent = msg.message;
      
      if (messageContent?.conversation) {
        text = messageContent.conversation;
      } else if (messageContent?.extendedTextMessage?.text) {
        text = messageContent.extendedTextMessage.text;
      } else if (messageContent?.imageMessage?.caption) {
        text = messageContent.imageMessage.caption || "[Image]";
      } else if (messageContent?.videoMessage?.caption) {
        text = messageContent.videoMessage.caption || "[Video]";
      } else if (messageContent?.documentMessage?.caption) {
        text = messageContent.documentMessage.caption || "[Document]";
      } else if (messageContent?.audioMessage) {
        text = "[Audio]";
      } else if (messageContent?.stickerMessage) {
        text = "[Sticker]";
      } else if (messageContent?.contactMessage) {
        text = "[Contact]";
      } else if (messageContent?.locationMessage) {
        text = "[Location]";
      } else if (messageContent?.buttonsResponseMessage?.selectedButtonId) {
        text = messageContent.buttonsResponseMessage.selectedDisplayText || messageContent.buttonsResponseMessage.selectedButtonId;
      } else if (messageContent?.listResponseMessage?.singleSelectReply?.selectedRowId) {
        text = messageContent.listResponseMessage.title || messageContent.listResponseMessage.singleSelectReply.selectedRowId;
      } else if (messageContent?.templateButtonReplyMessage?.selectedId) {
        text = messageContent.templateButtonReplyMessage.selectedDisplayText || messageContent.templateButtonReplyMessage.selectedId;
      } else if (messageContent?.interactiveResponseMessage) {
        const ir = messageContent.interactiveResponseMessage;
        if (ir.nativeFlowResponseMessage?.paramsJson) {
          try {
            const params = JSON.parse(ir.nativeFlowResponseMessage.paramsJson);
            text = params.id || params.title || "[Interactive Response]";
          } catch {
            text = "[Interactive Response]";
          }
        }
      }
      
      console.log("[WhatsAppPersonal] Extracted text:", text ? text.substring(0, 50) : "(empty)");

      if (!text) {
        console.log("[WhatsAppPersonal] Parse: empty text, returning null");
        return null;
      }

      const userId = isLid ? jid : (msg.key.participant || phone);
      
      return {
        externalMessageId: msg.key.id || `wap_${Date.now()}`,
        externalConversationId: jid,
        externalUserId: userId,
        text,
        timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000),
        channel: "whatsapp_personal",
        metadata: {
          isGroup,
          isLid,
          phone: isLid ? "" : phone,
          remoteJid: jid,
          fromMe: msg.key.fromMe || false,
          pushName: msg.pushName,
        },
      };
    } catch (error: any) {
      console.error("[WhatsAppPersonal] Parse error:", error.message);
      return null;
    }
  }

  async sendTypingStart(externalConversationId: string): Promise<void> {
    const isEnabled = await featureFlagService.isEnabled("WHATSAPP_PERSONAL_CHANNEL_ENABLED");
    if (!isEnabled) return;

    const session = authSessions.get(this.tenantId);
    if (!session?.socket || session.status !== "connected") return;

    try {
      const jid = externalConversationId.includes("@") 
        ? externalConversationId 
        : `${externalConversationId}@s.whatsapp.net`;
      
      await session.socket.sendPresenceUpdate("composing", jid);
    } catch (error: any) {
      console.warn("[WhatsAppPersonal] Typing indicator error:", error.message);
    }
  }

  async sendTypingStop(externalConversationId: string): Promise<void> {
    const isEnabled = await featureFlagService.isEnabled("WHATSAPP_PERSONAL_CHANNEL_ENABLED");
    if (!isEnabled) return;

    const session = authSessions.get(this.tenantId);
    if (!session?.socket || session.status !== "connected") return;

    try {
      const jid = externalConversationId.includes("@") 
        ? externalConversationId 
        : `${externalConversationId}@s.whatsapp.net`;
      
      await session.socket.sendPresenceUpdate("paused", jid);
    } catch (error: any) {
      console.warn("[WhatsAppPersonal] Cancel typing error:", error.message);
    }
  }

  static async startAuth(tenantId: string, isAutoReconnect: boolean = false): Promise<{
    success: boolean;
    qrCode?: string;
    qrDataUrl?: string;
    error?: string;
  }> {
    try {
      const existingSession = authSessions.get(tenantId);
      
      if (existingSession?.reconnecting && !isAutoReconnect) {
        existingSession.reconnecting = false;
        existingSession.reconnectAttempts = 0;
      }
      
      if (isAutoReconnect && existingSession) {
        const attempts = (existingSession.reconnectAttempts || 0) + 1;
        if (attempts > 5) {
          console.log(`[WhatsAppPersonal] Max reconnect attempts (5) reached for tenant ${tenantId}`);
          existingSession.status = "disconnected";
          existingSession.error = "Connection failed after 5 attempts";
          existingSession.reconnecting = false;
          return { success: false, error: "Max reconnect attempts reached" };
        }
        existingSession.reconnectAttempts = attempts;
        console.log(`[WhatsAppPersonal] Reconnect attempt ${attempts}/5 for tenant ${tenantId}`);
      }
      
      if (existingSession?.socket) {
        try {
          existingSession.reconnecting = false;
          existingSession.socket.end(undefined);
        } catch {
        }
      }

      const sessionDir = path.join(AUTH_DIR, tenantId);
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }

      const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = await getBaileys();
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const { version, isLatest } = await fetchLatestBaileysVersion();
      
      console.log(`[WhatsAppPersonal] Using Baileys v${version.join(".")}, latest: ${isLatest}`);

      const session: AuthSession = {
        socket: null,
        qrCode: null,
        qrDataUrl: null,
        pairingCode: null,
        status: "connecting",
        authMethod: "qr",
      };
      authSessions.set(tenantId, session);

      const logger = pino({ level: "silent" });

      const socket = makeWASocket({
        version,
        logger,
        auth: state,
        printQRInTerminal: false,
        browser: ["AI Sales Operator", "Chrome", "1.0.0"],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: undefined,
        keepAliveIntervalMs: 30000,
        emitOwnEvents: true,
        markOnlineOnConnect: true,
      });

      session.socket = socket;

      socket.ev.on("creds.update", saveCreds);

      socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          session.qrCode = qr;
          session.status = "qr_ready";
          
          try {
            session.qrDataUrl = await QRCode.toDataURL(qr, {
              width: 300,
              margin: 2,
              color: {
                dark: "#000000",
                light: "#ffffff",
              },
            });
          } catch (e) {
            console.error("[WhatsAppPersonal] QR generation error:", e);
          }
          
          console.log(`[WhatsAppPersonal] QR code ready for tenant ${tenantId}`);
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const invalidSessionCodes = [401, 403, 440, DisconnectReason.loggedOut];
          const shouldReconnect = !invalidSessionCodes.includes(statusCode);
          console.log(`[WhatsAppPersonal] Connection closed, statusCode: ${statusCode}, reconnect: ${shouldReconnect}`);
          
          if (shouldReconnect && !session.reconnecting) {
            console.log(`[WhatsAppPersonal] Auto-reconnecting for tenant ${tenantId}...`);
            session.status = "connecting";
            session.error = undefined;
            session.reconnecting = true;
            
            const delay = 3000 + Math.min((session.reconnectAttempts || 0) * 2000, 10000);
            setTimeout(() => {
              WhatsAppPersonalAdapter.startAuth(tenantId, true).catch(err => {
                console.error(`[WhatsAppPersonal] Auto-reconnect failed:`, err);
                session.reconnecting = false;
              });
            }, delay);
          } else {
            session.status = "disconnected";
            session.error = statusCode === 401 ? "Session expired" : 
                           statusCode === 403 ? "Access forbidden" : "Logged out";
            
            try {
              fs.rmSync(sessionDir, { recursive: true, force: true });
              console.log(`[WhatsAppPersonal] Removed invalid session for tenant ${tenantId}`);
            } catch {
            }
            
            authSessions.delete(tenantId);
          }
        } else if (connection === "open") {
          session.status = "connected";
          session.error = undefined;
          session.reconnecting = false;
          session.reconnectAttempts = 0;
          
          const user = socket.user;
          if (user) {
            session.user = {
              id: user.id,
              name: user.name || "",
              phone: user.id.split(":")[0].replace("@s.whatsapp.net", ""),
            };
          }
          
          console.log(`[WhatsAppPersonal] Connected for tenant ${tenantId}`, session.user);
        }
      });

      socket.ev.on("messages.upsert", async ({ messages, type }) => {
        console.log(`[WhatsAppPersonal] messages.upsert event: type=${type}, count=${messages.length}`);
        
        if (type !== "notify") {
          console.log(`[WhatsAppPersonal] Skipping non-notify event type: ${type}`);
          return;
        }

        for (const msg of messages) {
          console.log(`[WhatsAppPersonal] Processing message:`, JSON.stringify({
            fromMe: msg.key?.fromMe,
            remoteJid: msg.key?.remoteJid,
            id: msg.key?.id,
            hasMessage: !!msg.message,
          }));
          
          if (msg.key.fromMe) {
            console.log(`[WhatsAppPersonal] Skipping own message`);
            continue;
          }
          
          const adapter = new WhatsAppPersonalAdapter(tenantId);
          const parsed = adapter.parseIncomingMessage(msg);
          
          console.log(`[WhatsAppPersonal] Parsed result:`, parsed ? JSON.stringify(sanitizeForLog(parsed)) : "null");
          
          if (parsed) {
            try {
              await processIncomingMessageFull(tenantId, parsed);
              console.log(`[WhatsAppPersonal] Message processed for tenant ${tenantId}`);
            } catch (error) {
              console.error("[WhatsAppPersonal] Message processing error:", error);
            }
          }
        }
      });

      // Load recent conversations on connect (history sync)
      socket.ev.on("messaging-history.set", async ({ chats, messages, isLatest }) => {
        console.log(`[WhatsAppPersonal] History sync: ${chats?.length || 0} chats, ${messages?.length || 0} messages, isLatest: ${isLatest}`);
        
        if (!messages || messages.length === 0) {
          console.log(`[WhatsAppPersonal] No messages in history sync`);
          return;
        }

        // Group messages by conversation (remoteJid)
        const messagesByChat = new Map<string, any[]>();
        for (const msg of messages) {
          const jid = msg.key?.remoteJid;
          if (!jid || msg.key?.fromMe) continue;
          
          if (!messagesByChat.has(jid)) {
            messagesByChat.set(jid, []);
          }
          messagesByChat.get(jid)!.push(msg);
        }

        // Get last 3 unique conversations with incoming messages
        const sortedChats = Array.from(messagesByChat.entries())
          .map(([jid, msgs]) => ({
            jid,
            messages: msgs,
            lastMessageTime: Math.max(...msgs.map((m: any) => (m.messageTimestamp || 0) * 1000))
          }))
          .sort((a, b) => b.lastMessageTime - a.lastMessageTime)
          .slice(0, 3);

        console.log(`[WhatsAppPersonal] Processing ${sortedChats.length} recent conversations from history`);

        const adapter = new WhatsAppPersonalAdapter(tenantId);
        
        for (const chat of sortedChats) {
          // Get the most recent message from this chat
          const recentMsg = chat.messages.sort((a: any, b: any) => 
            ((b.messageTimestamp || 0) - (a.messageTimestamp || 0))
          )[0];
          
          if (recentMsg) {
            const parsed = adapter.parseIncomingMessage(recentMsg);
            if (parsed) {
              try {
                await processIncomingMessageFull(tenantId, parsed);
                console.log(`[WhatsAppPersonal] History message processed from ${chat.jid}`);
              } catch (error) {
                console.error("[WhatsAppPersonal] History message processing error:", error);
              }
            }
          }
        }
      });

      await new Promise(resolve => setTimeout(resolve, 2000));

      const currentSession = authSessions.get(tenantId);
      
      if (currentSession?.status === "connected") {
        return {
          success: true,
        };
      }
      
      if (currentSession?.qrCode) {
        return {
          success: true,
          qrCode: currentSession.qrCode,
          qrDataUrl: currentSession.qrDataUrl || undefined,
        };
      }

      return {
        success: false,
        error: "Failed to initialize WhatsApp connection",
      };
    } catch (error: any) {
      console.error("[WhatsAppPersonal] StartAuth error:", error.message);
      return { success: false, error: error.message };
    }
  }

  static async startAuthWithPhone(tenantId: string, phoneNumber: string): Promise<{
    success: boolean;
    pairingCode?: string;
    error?: string;
  }> {
    try {
      const cleanPhone = phoneNumber.replace(/[^\d]/g, "");
      
      if (cleanPhone.length < 10 || cleanPhone.length > 15) {
        return { success: false, error: "Invalid phone number format" };
      }

      const existingSession = authSessions.get(tenantId);
      if (existingSession?.socket) {
        try {
          existingSession.socket.end(undefined);
        } catch {
        }
      }

      const sessionDir = path.join(AUTH_DIR, tenantId);
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }

      const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = await getBaileys();
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const { version, isLatest } = await fetchLatestBaileysVersion();
      
      console.log(`[WhatsAppPersonal] Phone auth using Baileys v${version.join(".")}, latest: ${isLatest}`);

      const session: AuthSession = {
        socket: null,
        qrCode: null,
        qrDataUrl: null,
        pairingCode: null,
        status: "connecting",
        authMethod: "phone",
      };
      authSessions.set(tenantId, session);

      const logger = pino({ level: "silent" });

      const socket = makeWASocket({
        version,
        logger,
        auth: state,
        printQRInTerminal: false,
        browser: ["AI Sales Operator", "Chrome", "1.0.0"],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: undefined,
        keepAliveIntervalMs: 30000,
        emitOwnEvents: true,
        markOnlineOnConnect: true,
      });

      session.socket = socket;

      socket.ev.on("creds.update", saveCreds);

      socket.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const invalidSessionCodes = [401, 403, 440, DisconnectReason.loggedOut];
          const shouldReconnect = !invalidSessionCodes.includes(statusCode);
          console.log(`[WhatsAppPersonal] Phone auth connection closed, statusCode: ${statusCode}, reconnect: ${shouldReconnect}`);
          
          if (!shouldReconnect) {
            session.status = "disconnected";
            session.error = statusCode === 401 ? "Session expired" : 
                           statusCode === 403 ? "Access forbidden" : "Logged out";
            
            try {
              fs.rmSync(sessionDir, { recursive: true, force: true });
              console.log(`[WhatsAppPersonal] Removed invalid phone auth session for tenant ${tenantId}`);
            } catch {
            }
            
            authSessions.delete(tenantId);
          }
        } else if (connection === "open") {
          session.status = "connected";
          session.error = undefined;
          session.reconnecting = false;
          session.reconnectAttempts = 0;
          
          const user = socket.user;
          if (user) {
            session.user = {
              id: user.id,
              name: user.name || "",
              phone: user.id.split(":")[0].replace("@s.whatsapp.net", ""),
            };
          }
          
          console.log(`[WhatsAppPersonal] Phone auth connected for tenant ${tenantId}`, session.user);
        }
      });

      socket.ev.on("messages.upsert", async ({ messages, type }) => {
        console.log(`[WhatsAppPersonal] messages.upsert event: type=${type}, count=${messages.length}`);
        
        if (type !== "notify") {
          console.log(`[WhatsAppPersonal] Skipping non-notify event type: ${type}`);
          return;
        }

        for (const msg of messages) {
          console.log(`[WhatsAppPersonal] Processing message:`, JSON.stringify({
            fromMe: msg.key?.fromMe,
            remoteJid: msg.key?.remoteJid,
            id: msg.key?.id,
            hasMessage: !!msg.message,
          }));
          
          if (msg.key.fromMe) {
            console.log(`[WhatsAppPersonal] Skipping own message`);
            continue;
          }
          
          const adapter = new WhatsAppPersonalAdapter(tenantId);
          const parsed = adapter.parseIncomingMessage(msg);
          
          console.log(`[WhatsAppPersonal] Parsed result:`, parsed ? JSON.stringify(sanitizeForLog(parsed)) : "null");
          
          if (parsed) {
            try {
              await processIncomingMessageFull(tenantId, parsed);
              console.log(`[WhatsAppPersonal] Message processed for tenant ${tenantId}`);
            } catch (error) {
              console.error("[WhatsAppPersonal] Message processing error:", error);
            }
          }
        }
      });

      // Load recent conversations on connect (history sync) - phone auth
      socket.ev.on("messaging-history.set", async ({ chats, messages, isLatest }) => {
        console.log(`[WhatsAppPersonal] Phone auth history sync: ${chats?.length || 0} chats, ${messages?.length || 0} messages, isLatest: ${isLatest}`);
        
        if (!messages || messages.length === 0) {
          console.log(`[WhatsAppPersonal] No messages in history sync`);
          return;
        }

        // Group messages by conversation (remoteJid)
        const messagesByChat = new Map<string, any[]>();
        for (const msg of messages) {
          const jid = msg.key?.remoteJid;
          if (!jid || msg.key?.fromMe) continue;
          
          if (!messagesByChat.has(jid)) {
            messagesByChat.set(jid, []);
          }
          messagesByChat.get(jid)!.push(msg);
        }

        // Get last 3 unique conversations with incoming messages
        const sortedChats = Array.from(messagesByChat.entries())
          .map(([jid, msgs]) => ({
            jid,
            messages: msgs,
            lastMessageTime: Math.max(...msgs.map((m: any) => (m.messageTimestamp || 0) * 1000))
          }))
          .sort((a, b) => b.lastMessageTime - a.lastMessageTime)
          .slice(0, 3);

        console.log(`[WhatsAppPersonal] Processing ${sortedChats.length} recent conversations from history`);

        const adapter = new WhatsAppPersonalAdapter(tenantId);
        
        for (const chat of sortedChats) {
          // Get the most recent message from this chat
          const recentMsg = chat.messages.sort((a: any, b: any) => 
            ((b.messageTimestamp || 0) - (a.messageTimestamp || 0))
          )[0];
          
          if (recentMsg) {
            const parsed = adapter.parseIncomingMessage(recentMsg);
            if (parsed) {
              try {
                await processIncomingMessageFull(tenantId, parsed);
                console.log(`[WhatsAppPersonal] History message processed from ${chat.jid}`);
              } catch (error) {
                console.error("[WhatsAppPersonal] History message processing error:", error);
              }
            }
          }
        }
      });

      await new Promise(resolve => setTimeout(resolve, 1500));

      if (!state.creds.registered) {
        try {
          const code = await socket.requestPairingCode(cleanPhone);
          session.pairingCode = code;
          session.status = "pairing_code_ready";
          
          console.log(`[WhatsAppPersonal] Pairing code ready for tenant ${tenantId}: ${code}`);
          
          return {
            success: true,
            pairingCode: code,
          };
        } catch (error: any) {
          console.error("[WhatsAppPersonal] Request pairing code error:", error.message);
          return { success: false, error: error.message || "Failed to request pairing code" };
        }
      } else {
        return { success: true };
      }
    } catch (error: any) {
      console.error("[WhatsAppPersonal] StartAuthWithPhone error:", error.message);
      return { success: false, error: error.message };
    }
  }

  static async checkAuth(tenantId: string): Promise<{
    success: boolean;
    status: "disconnected" | "connecting" | "qr_ready" | "pairing_code_ready" | "connected" | "error";
    qrCode?: string;
    qrDataUrl?: string;
    pairingCode?: string;
    user?: { id: string; name: string; phone: string };
    error?: string;
  }> {
    const session = authSessions.get(tenantId);
    
    if (!session) {
      return {
        success: false,
        status: "disconnected",
        error: "No active session",
      };
    }

    return {
      success: true,
      status: session.status,
      qrCode: session.qrCode || undefined,
      qrDataUrl: session.qrDataUrl || undefined,
      pairingCode: session.pairingCode || undefined,
      user: session.user,
      error: session.error,
    };
  }

  static async logout(tenantId: string): Promise<{ success: boolean; error?: string }> {
    const session = authSessions.get(tenantId);
    
    if (session?.socket) {
      try {
        await session.socket.logout();
      } catch {
      }
      
      try {
        session.socket.end(undefined);
      } catch {
      }
    }

    const sessionDir = path.join(AUTH_DIR, tenantId);
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch {
    }

    authSessions.delete(tenantId);
    console.log(`[WhatsAppPersonal] Logged out tenant ${tenantId}`);

    return { success: true };
  }

  static async restoreSession(tenantId: string): Promise<{
    success: boolean;
    connected: boolean;
    user?: { id: string; name: string; phone: string };
    error?: string;
  }> {
    const sessionDir = path.join(AUTH_DIR, tenantId);
    
    if (!fs.existsSync(sessionDir)) {
      return { success: false, connected: false, error: "No saved session" };
    }

    // Check if already connected or connecting
    const existingSession = authSessions.get(tenantId);
    if (existingSession?.status === "connected") {
      return {
        success: true,
        connected: true,
        user: existingSession.user,
      };
    }

    // Start auth - don't wait for full connection, Baileys handles reconnection
    WhatsAppPersonalAdapter.startAuth(tenantId).catch(err => {
      console.error(`[WhatsAppPersonal] Restore auth error:`, err);
    });

    // Wait briefly for initial connection (5 seconds max)
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const session = authSessions.get(tenantId);
      if (session?.status === "connected") {
        return {
          success: true,
          connected: true,
          user: session.user,
        };
      }
      
      // If user info is available (from previous session), consider it restoring
      if (session?.user && (session.reconnecting || session.socket)) {
        return {
          success: true,
          connected: true,
          user: session.user,
        };
      }
      
      if (session?.status === "qr_ready") {
        return {
          success: false,
          connected: false,
          error: "Session expired. Please re-authenticate with QR code.",
        };
      }
    }

    // Check final state - if reconnecting with user info, still consider success
    const finalSession = authSessions.get(tenantId);
    if (finalSession?.status === "connected" || (finalSession?.user && finalSession?.socket)) {
      return {
        success: true,
        connected: true,
        user: finalSession.user,
      };
    }

    // If session exists and is trying to reconnect, return success (will connect soon)
    if (finalSession?.reconnecting && finalSession?.user) {
      return {
        success: true,
        connected: true,
        user: finalSession.user,
      };
    }

    return { success: false, connected: false, error: "Connection timeout - session will auto-reconnect" };
  }

  static getConnectedSessions(): string[] {
    const connected: string[] = [];
    authSessions.forEach((session, tenantId) => {
      if (session.status === "connected") {
        connected.push(tenantId);
      }
    });
    return connected;
  }

  static isConnected(tenantId: string): boolean {
    const session = authSessions.get(tenantId);
    if (!session) return false;
    
    // Consider connected if status is connected OR if we have user info (was connected before)
    // and session is reconnecting (temporary disconnect)
    if (session.status === "connected") return true;
    if (session.user && session.reconnecting) return true;
    if (session.user && session.socket) return true;
    
    return false;
  }

  static hasSession(tenantId: string): boolean {
    const session = authSessions.get(tenantId);
    return !!session?.user;
  }

  static getSessionInfo(tenantId: string): { 
    connected: boolean; 
    user?: { id: string; name: string; phone: string };
    reconnecting?: boolean;
  } {
    const session = authSessions.get(tenantId);
    if (!session) {
      return { connected: false };
    }
    
    const connected = WhatsAppPersonalAdapter.isConnected(tenantId);
    
    return {
      connected,
      user: session.user,
      reconnecting: session.reconnecting,
    };
  }
}
