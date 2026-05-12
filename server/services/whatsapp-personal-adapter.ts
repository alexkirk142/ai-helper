import type { WASocket } from "@whiskeysockets/baileys";

let _baileys: typeof import("@whiskeysockets/baileys") | null = null;
async function getBaileys() {
  if (!_baileys) {
    _baileys = await import("@whiskeysockets/baileys");
  }
  return _baileys;
}
import type { ChannelAdapter, ParsedIncomingMessage, ChannelSendResult } from "./channel-adapter.types";
import type { ChannelType } from "@shared/schema";
import { featureFlagService } from "./feature-flags";
import { messageBus } from "./message-bus";
import { sanitizeForLog } from "../utils/sanitizer";
import * as fs from "fs";
import * as path from "path";
import pino from "pino";
import QRCode from "qrcode";

const AUTH_DIR = "./whatsapp_sessions";

// Suppress Baileys' internal console.log calls that leak Signal Protocol session data
// (e.g. "Closing session: SessionEntry { _chains: ..., privKey: <Buffer...> }")
const _origConsoleLog = console.log;
console.log = (...args: unknown[]) => {
  const first = args[0];
  if (typeof first === "string" && first.startsWith("Closing session:")) return;
  if (first && typeof first === "object" && "_chains" in (first as object)) return;
  _origConsoleLog(...args);
};

// ── DB-backed session persistence ──────────────────────────────────────────
// Serialize the entire session directory to JSON (base64 files) and store in
// the whatsapp_auth_sessions table so credentials survive container restarts.

async function saveSessionToDb(tenantId: string, sessionDir: string): Promise<void> {
  try {
    if (!fs.existsSync(sessionDir)) return;
    const files: Record<string, string> = {};
    for (const name of fs.readdirSync(sessionDir)) {
      const fullPath = path.join(sessionDir, name);
      if (fs.statSync(fullPath).isFile()) {
        files[name] = fs.readFileSync(fullPath).toString("base64");
      }
    }
    if (Object.keys(files).length === 0) return;

    const { db } = await import("../db");
    const { whatsappAuthSessions } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const authData = JSON.stringify({ files });
    await db
      .insert(whatsappAuthSessions)
      .values({ tenantId, authData, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: whatsappAuthSessions.tenantId,
        set: { authData, updatedAt: new Date() },
      });
  } catch (err: any) {
    console.warn(`[WhatsAppPersonal] saveSessionToDb failed for ${tenantId}:`, err.message);
  }
}

async function restoreSessionFromDb(tenantId: string, sessionDir: string): Promise<boolean> {
  try {
    const { db } = await import("../db");
    const { whatsappAuthSessions } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const rows = await db.select().from(whatsappAuthSessions).where(eq(whatsappAuthSessions.tenantId, tenantId));
    if (!rows.length || !rows[0].authData) return false;

    const { files } = JSON.parse(rows[0].authData) as { files: Record<string, string> };
    if (!files || Object.keys(files).length === 0) return false;

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    for (const [name, b64] of Object.entries(files)) {
      fs.writeFileSync(path.join(sessionDir, name), Buffer.from(b64, "base64"));
    }
    console.log(`[WhatsAppPersonal] Restored session from DB for tenant ${tenantId}`);
    return true;
  } catch (err: any) {
    console.warn(`[WhatsAppPersonal] restoreSessionFromDb failed for ${tenantId}:`, err.message);
    return false;
  }
}

async function deleteSessionFromDb(tenantId: string): Promise<void> {
  try {
    const { db } = await import("../db");
    const { whatsappAuthSessions } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.delete(whatsappAuthSessions).where(eq(whatsappAuthSessions.tenantId, tenantId));
  } catch (err: any) {
    console.warn(`[WhatsAppPersonal] deleteSessionFromDb failed for ${tenantId}:`, err.message);
  }
}

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
const processedHistoryIds = new Map<string, Set<string>>();
const authInProgress = new Set<string>();

// Медиа-кэш: tenantId → Map<messageId, { buffer: Buffer; mimeType: string; fileName: string }>
// Ограничен 100 записями на тенант для защиты памяти
const mediaCache = new Map<string, Map<string, { buffer: Buffer; mimeType: string; fileName: string }>>();

const MAX_MEDIA_CACHE_PER_TENANT = 100;

function addToMediaCache(
  tenantId: string,
  messageId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): void {
  let cache = mediaCache.get(tenantId);
  if (!cache) {
    cache = new Map();
    mediaCache.set(tenantId, cache);
  }
  if (cache.size >= MAX_MEDIA_CACHE_PER_TENANT) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(messageId, { buffer, mimeType, fileName });
}

export function getFromMediaCache(
  tenantId: string,
  messageId: string
): { buffer: Buffer; mimeType: string; fileName: string } | undefined {
  return mediaCache.get(tenantId)?.get(messageId);
}

async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string | null> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const { OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey });

    const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "mp3";
    const file = new File([buffer], `audio.${ext}`, { type: mimeType });

    const transcription = await openai.audio.transcriptions.create({
      file: file as any,
      model: "whisper-1",
      language: "ru",
    });

    const text = transcription.text?.trim();
    if (!text) return null;

    console.log(`[WhatsAppPersonal] Whisper transcription: "${text.substring(0, 80)}"`);
    return text;
  } catch (error: any) {
    console.warn(`[WhatsAppPersonal] Whisper transcription failed: ${error.message}`);
    return null;
  }
}

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

  async sendMediaMessage(
    externalConversationId: string,
    buffer: Buffer,
    mimetype: string,
    fileName: string,
    caption?: string
  ): Promise<ChannelSendResult> {
    const isEnabled = await featureFlagService.isEnabled("WHATSAPP_PERSONAL_CHANNEL_ENABLED");
    if (!isEnabled) {
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

      let messagePayload: any;

      if (mimetype.startsWith("image/")) {
        messagePayload = {
          image: buffer,
          mimetype,
          caption: caption || "",
        };
      } else if (mimetype.startsWith("video/")) {
        messagePayload = {
          video: buffer,
          mimetype,
          caption: caption || "",
        };
      } else if (mimetype.startsWith("audio/")) {
        const isVoiceNote = mimetype === "audio/ogg" || mimetype.includes("ogg");
        messagePayload = {
          audio: buffer,
          mimetype: isVoiceNote ? "audio/ogg; codecs=opus" : mimetype,
          ptt: isVoiceNote,
        };
      } else {
        messagePayload = {
          document: buffer,
          mimetype,
          fileName: fileName || "file",
          caption: caption || "",
        };
      }

      const result = await session.socket.sendMessage(jid, messagePayload);

      console.log(`[WhatsAppPersonal] Media sent (${mimetype}) to ${externalConversationId}`);
      return {
        success: true,
        externalMessageId: result?.key?.id || `wap_media_${Date.now()}`,
        timestamp: new Date(),
      };
    } catch (error: any) {
      console.error("[WhatsAppPersonal] sendMediaMessage error:", error.message);
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

      // Whether this message carries a downloadable media attachment.
      // Media-only messages (no caption) are still valid and must not be dropped.
      const hasMedia = !!(
        messageContent?.imageMessage ||
        messageContent?.videoMessage ||
        messageContent?.documentMessage ||
        messageContent?.audioMessage ||
        messageContent?.stickerMessage
      );
      
      if (messageContent?.conversation) {
        text = messageContent.conversation;
      } else if (messageContent?.extendedTextMessage?.text) {
        text = messageContent.extendedTextMessage.text;
      } else if (messageContent?.imageMessage) {
        text = messageContent.imageMessage.caption || "";
      } else if (messageContent?.videoMessage) {
        text = messageContent.videoMessage.caption || "";
      } else if (messageContent?.documentMessage) {
        text = messageContent.documentMessage.caption || messageContent.documentMessage.fileName || "";
      } else if (messageContent?.audioMessage) {
        text = "";
      } else if (messageContent?.stickerMessage) {
        text = "";
      } else if (messageContent?.contactMessage) {
        text = "[Контакт]";
      } else if (messageContent?.locationMessage) {
        text = "[Локация]";
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
            text = params.id || params.title || "";
          } catch {
            text = "";
          }
        }
      }
      
      console.log("[WhatsAppPersonal] Extracted text:", text ? text.substring(0, 50) : "(empty)");

      if (!text && !hasMedia) {
        console.log("[WhatsAppPersonal] Parse: empty text and no media, returning null");
        return null;
      }

      const userId = isLid ? jid : (msg.key.participant || (isGroup ? phone : jid));
      
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

  private static async _downloadMediaIfPresent(
    msg: any,
    parsed: ParsedIncomingMessage,
    tenantId: string,
    session: AuthSession | undefined
  ): Promise<import("./channel-adapter.types").ParsedAttachment | null> {
    const messageContent = msg.message;
    if (!messageContent || !session?.socket) return null;

    let mimeType = "";
    let fileName = "";
    let attachmentType: import("./channel-adapter.types").ParsedAttachment["type"] = "document";

    if (messageContent.imageMessage) {
      mimeType = messageContent.imageMessage.mimetype || "image/jpeg";
      fileName = "image.jpg";
      attachmentType = "image";
    } else if (messageContent.videoMessage) {
      mimeType = messageContent.videoMessage.mimetype || "video/mp4";
      fileName = messageContent.videoMessage.fileName || "video.mp4";
      attachmentType = "video";
    } else if (messageContent.audioMessage) {
      mimeType = messageContent.audioMessage.mimetype || "audio/ogg";
      fileName = "audio.ogg";
      attachmentType = messageContent.audioMessage.ptt ? "voice" : "audio";
    } else if (messageContent.documentMessage) {
      mimeType = messageContent.documentMessage.mimetype || "application/octet-stream";
      fileName = messageContent.documentMessage.fileName || "document";
      attachmentType = "document";
    } else {
      return null;
    }

    try {
      const baileys = await getBaileys();
      const { downloadMediaMessage } = baileys;
      const buffer = await downloadMediaMessage(
        msg,
        "buffer",
        {},
        {
          logger: pino({ level: "silent" }),
          reuploadRequest: session.socket.updateMediaMessage,
        }
      ) as Buffer;

      if (!buffer || buffer.length === 0) {
        console.warn(`[WhatsAppPersonal] Empty media buffer for message ${parsed.externalMessageId}`);
        return null;
      }

      addToMediaCache(tenantId, parsed.externalMessageId, buffer, mimeType, fileName);

      const mediaUrl = `/api/whatsapp-personal/media/${encodeURIComponent(tenantId)}/${encodeURIComponent(parsed.externalMessageId)}`;
      console.log(`[WhatsAppPersonal] Media downloaded (${buffer.length} bytes), cached as ${parsed.externalMessageId}`);

      // Транскрипция голосового сообщения
      let voiceTranscription: string | null = null;
      if (attachmentType === "voice" || attachmentType === "audio") {
        voiceTranscription = await transcribeAudio(buffer, mimeType);
      }

      return {
        type: attachmentType,
        url: mediaUrl,
        mimeType,
        fileName,
        fileSize: buffer.length,
        duration: messageContent.audioMessage?.seconds,
        _transcription: voiceTranscription,
      } as any;
    } catch (error: any) {
      console.warn(`[WhatsAppPersonal] Media download failed for ${parsed.externalMessageId}: ${error.message}`);
      return null;
    }
  }

  private static _attachMessageHandlers(socket: WASocket, tenantId: string): void {
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
            // Скачать медиа если есть вложение
            const session = authSessions.get(tenantId);
            const mediaAttachment = await WhatsAppPersonalAdapter._downloadMediaIfPresent(
              msg,
              parsed,
              tenantId,
              session
            );
            if (mediaAttachment) {
              parsed.attachments = [mediaAttachment];
            }

            // Если есть транскрипция голоса — заменить [Audio] на реальный текст
            if (
              mediaAttachment &&
              (mediaAttachment.type === "voice" || mediaAttachment.type === "audio")
            ) {
              const transcription = (mediaAttachment as any)._transcription as string | undefined;
              if (transcription) {
                parsed.text = transcription;
                console.log(`[WhatsAppPersonal] Replaced [Audio] with Whisper transcription: "${transcription.substring(0, 60)}"`);
              }
            }

            messageBus.emitIncomingMessage(tenantId, null, parsed);
            console.log(`[WhatsAppPersonal] Message emitted for tenant ${tenantId}`);
          } catch (error) {
            console.error("[WhatsAppPersonal] Message processing error:", error);
          }
        }
      }
    });

    socket.ev.on("messaging-history.set", async ({ chats, messages, isLatest }) => {
      console.log(`[WhatsAppPersonal] History sync: ${chats?.length || 0} chats, ${messages?.length || 0} messages, isLatest: ${isLatest}`);

      if (!messages || messages.length === 0) {
        console.log(`[WhatsAppPersonal] No messages in history sync`);
        return;
      }

      const messagesByChat = new Map<string, any[]>();
      for (const msg of messages) {
        const jid = msg.key?.remoteJid;
        if (!jid || msg.key?.fromMe) continue;

        if (!messagesByChat.has(jid)) {
          messagesByChat.set(jid, []);
        }
        messagesByChat.get(jid)!.push(msg);
      }

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
        const recentMsg = chat.messages.sort((a: any, b: any) =>
          ((b.messageTimestamp || 0) - (a.messageTimestamp || 0))
        )[0];

        if (recentMsg) {
          const parsed = adapter.parseIncomingMessage(recentMsg);
          if (parsed) {
            const seen = processedHistoryIds.get(tenantId) ?? new Set<string>();
            if (seen.has(parsed.externalMessageId)) {
              console.log(`[WhatsAppPersonal] Skipping duplicate history message ${parsed.externalMessageId}`);
              continue;
            }
            seen.add(parsed.externalMessageId);
            if (seen.size > 500) seen.clear();
            processedHistoryIds.set(tenantId, seen);

            try {
              messageBus.emitIncomingMessage(tenantId, null, parsed);
              console.log(`[WhatsAppPersonal] History message emitted from ${chat.jid}`);
            } catch (error) {
              console.error("[WhatsAppPersonal] History message processing error:", error);
            }
          }
        }
      }
    });
  }

  static async startAuth(tenantId: string, isAutoReconnect: boolean = false): Promise<{
    success: boolean;
    qrCode?: string;
    qrDataUrl?: string;
    error?: string;
  }> {
    if (authInProgress.has(tenantId) && !isAutoReconnect) {
      console.log(`[WhatsAppPersonal] Auth already in progress for tenant ${tenantId}, skipping`);
      return { success: false, error: "Authentication already in progress" };
    }
    authInProgress.add(tenantId);
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

      // Restore from DB if the local session directory is missing (e.g. after container restart)
      if (!fs.existsSync(sessionDir) || fs.readdirSync(sessionDir).length === 0) {
        await restoreSessionFromDb(tenantId, sessionDir);
      }

      const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = await getBaileys();
      const { state, saveCreds: rawSaveCreds } = await useMultiFileAuthState(sessionDir);
      const saveCreds = async () => {
        await rawSaveCreds();
        await saveSessionToDb(tenantId, sessionDir);
      };
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

          // Ignore close events triggered by our own socket.end() call during auth setup
          if (authInProgress.has(tenantId)) {
            console.log(`[WhatsAppPersonal] Close triggered by our own socket.end(), skipping reconnect for tenant ${tenantId}`);
            return;
          }
          
          if (shouldReconnect && !session.reconnecting) {
            console.log(`[WhatsAppPersonal] Auto-reconnecting for tenant ${tenantId}...`);
            session.status = "connecting";
            session.error = undefined;
            session.reconnecting = true;
            
            const delay = 5000 + Math.min((session.reconnectAttempts || 0) * 3000, 15000);
            setTimeout(() => {
              WhatsAppPersonalAdapter.startAuth(tenantId, true).catch(err => {
                console.error(`[WhatsAppPersonal] Auto-reconnect failed:`, err);
                session.reconnecting = false;
              });
            }, delay);
          } else if (!shouldReconnect) {
            session.status = "disconnected";
            session.error = statusCode === 401 ? "Session expired" : 
                           statusCode === 403 ? "Access forbidden" : "Logged out";
            
            try {
              fs.rmSync(sessionDir, { recursive: true, force: true });
              console.log(`[WhatsAppPersonal] Removed invalid session for tenant ${tenantId}`);
            } catch {
            }
            deleteSessionFromDb(tenantId).catch(() => {});
            
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

      WhatsAppPersonalAdapter._attachMessageHandlers(socket, tenantId);

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
    } finally {
      authInProgress.delete(tenantId);
    }
  }

  static async startAuthWithPhone(tenantId: string, phoneNumber: string): Promise<{
    success: boolean;
    pairingCode?: string;
    error?: string;
  }> {
    if (authInProgress.has(tenantId)) {
      console.log(`[WhatsAppPersonal] Auth already in progress for tenant ${tenantId}, skipping`);
      return { success: false, error: "Authentication already in progress" };
    }
    authInProgress.add(tenantId);
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

      const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } = await getBaileys();
      const { state, saveCreds: rawSaveCreds } = await useMultiFileAuthState(sessionDir);
      const saveCreds = async () => {
        await rawSaveCreds();
        await saveSessionToDb(tenantId, sessionDir);
      };
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

      // Pairing code requires a standard WhatsApp-recognized browser fingerprint.
      // Custom strings are rejected by WA servers — must use Browsers helper.
      const socket = makeWASocket({
        version,
        logger,
        auth: state,
        printQRInTerminal: false,
        mobile: false,
        browser: Browsers.ubuntu("Chrome"),
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

          // Ignore close events triggered by our own socket.end() call during auth setup
          if (authInProgress.has(tenantId)) {
            console.log(`[WhatsAppPersonal] Phone auth close triggered by socket.end(), skipping for tenant ${tenantId}`);
            return;
          }

          if (!shouldReconnect) {
            session.status = "disconnected";
            session.error = statusCode === 401 ? "Session expired" : 
                           statusCode === 403 ? "Access forbidden" : "Logged out";
            
            try {
              fs.rmSync(sessionDir, { recursive: true, force: true });
              console.log(`[WhatsAppPersonal] Removed invalid phone auth session for tenant ${tenantId}`);
            } catch {
            }
            deleteSessionFromDb(tenantId).catch(() => {});
            
            authSessions.delete(tenantId);
          } else if (!session.reconnecting) {
            // Pairing code accepted — Baileys dropped the connection to re-auth.
            // Hand off to startAuth which handles reconnect with back-off correctly.
            session.status = "connecting";
            session.reconnecting = true;
            const delay = 5000 + Math.min((session.reconnectAttempts || 0) * 3000, 15000);
            console.log(`[WhatsAppPersonal] Phone auth: reconnecting after pairing in ${delay}ms for tenant ${tenantId}`);
            setTimeout(() => {
              WhatsAppPersonalAdapter.startAuth(tenantId, true).catch((err) => {
                console.error(`[WhatsAppPersonal] Phone auth auto-reconnect failed:`, err);
                session.reconnecting = false;
              });
            }, delay);
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

      WhatsAppPersonalAdapter._attachMessageHandlers(socket, tenantId);

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
    } finally {
      authInProgress.delete(tenantId);
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
    deleteSessionFromDb(tenantId).catch(() => {});

    authSessions.delete(tenantId);
    processedHistoryIds.delete(tenantId);
    mediaCache.delete(tenantId);
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

    // Check if we have credentials — either on FS or in DB
    const hasLocalSession = fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length > 0;
    if (!hasLocalSession) {
      // Try to restore from DB first so startAuth can use the credentials
      const restoredFromDb = await restoreSessionFromDb(tenantId, sessionDir);
      if (!restoredFromDb) {
        return { success: false, connected: false, error: "No saved session" };
      }
      console.log(`[WhatsAppPersonal] Restored session files from DB for tenant ${tenantId}`);
    }

    const existingSession = authSessions.get(tenantId);
    if (existingSession?.status === "connected") {
      return {
        success: true,
        connected: true,
        user: existingSession.user,
      };
    }

    WhatsAppPersonalAdapter.startAuth(tenantId).catch(err => {
      console.error(`[WhatsAppPersonal] Restore auth error:`, err);
    });

    for (let i = 0; i < 2; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const session = authSessions.get(tenantId);
      if (session?.status === "connected") {
        return { success: true, connected: true, user: session.user };
      }
    }

    return {
      success: true,
      connected: false,
      error: "Session is restoring in background",
    };
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

    if (session.status === "connected") return true;
    if (session.user && session.reconnecting === true) return true;

    return false;
  }

  static hasSession(tenantId: string): boolean {
    const session = authSessions.get(tenantId);
    return !!session?.user;
  }

  static getSession(tenantId: string): AuthSession | undefined {
    return authSessions.get(tenantId);
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

export const _testOnly_authSessions = authSessions;
