import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import type { ChannelAdapter, ParsedIncomingMessage, ChannelSendResult } from "./channel-adapter";
import type { ChannelType } from "@shared/schema";
import { featureFlagService } from "./feature-flags";
import { getSecret } from "./secret-resolver";

// Helper to get Telegram credentials from DB or fallback to env
async function getTelegramCredentials(): Promise<{ apiId: number; apiHash: string } | null> {
  // First try database (global secrets)
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
  
  // Fallback to environment variables
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

interface AuthState {
  phoneCodeHash?: string;
  client?: TelegramClient;
  qrToken?: Buffer;
  qrExpires?: number;
}

const authStates = new Map<string, AuthState>();

interface QrAuthResult {
  success: boolean;
  qrUrl?: string;
  expiresAt?: number;
  sessionId?: string;
  error?: string;
}

export class TelegramPersonalAdapter implements ChannelAdapter {
  readonly name: ChannelType = "telegram_personal";
  
  private client: TelegramClient | null = null;
  private sessionString: string;

  constructor(sessionString: string = "") {
    this.sessionString = sessionString;
  }

  private async getClient(): Promise<TelegramClient> {
    if (this.client && this.client.connected) {
      return this.client;
    }

    const credentials = await getTelegramCredentials();
    if (!credentials) {
      throw new Error("TELEGRAM_API_ID and TELEGRAM_API_HASH not configured");
    }

    const { apiId, apiHash } = credentials;
    const session = new StringSession(this.sessionString);
    this.client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
    });

    await this.client.connect();
    return this.client;
  }

  async sendMessage(
    externalConversationId: string,
    text: string,
    options?: { replyToMessageId?: string }
  ): Promise<ChannelSendResult> {
    const isEnabled = await featureFlagService.isEnabled("TELEGRAM_PERSONAL_CHANNEL_ENABLED");
    if (!isEnabled) {
      console.log("[TelegramPersonal] Channel disabled by feature flag");
      return { success: false, error: "Telegram Personal channel disabled" };
    }

    if (!this.sessionString) {
      return { success: false, error: "Not authenticated" };
    }

    try {
      const client = await this.getClient();
      
      const result = await client.sendMessage(externalConversationId, {
        message: text,
        replyTo: options?.replyToMessageId ? parseInt(options.replyToMessageId, 10) : undefined,
      });

      console.log(`[TelegramPersonal] Message sent to ${externalConversationId}`);
      return {
        success: true,
        externalMessageId: result.id.toString(),
        timestamp: new Date(),
      };
    } catch (error: any) {
      console.error("[TelegramPersonal] Send error:", error.message);
      return { success: false, error: error.message };
    }
  }

  parseIncomingMessage(rawPayload: unknown): ParsedIncomingMessage | null {
    try {
      if (!rawPayload || typeof rawPayload !== "object") {
        return null;
      }

      const payload = rawPayload as any;
      if (!payload.message) {
        return null;
      }

      const message = payload.message;
      const chat = message.peerId;
      const sender = message.fromId;

      return {
        externalMessageId: message.id?.toString() || `tgp_${Date.now()}`,
        externalConversationId: chat?.userId?.toString() || chat?.channelId?.toString() || "",
        externalUserId: sender?.userId?.toString() || "",
        text: message.message || "",
        timestamp: new Date((message.date || 0) * 1000),
        channel: "telegram_personal",
        metadata: {
          isOutgoing: message.out || false,
        },
      };
    } catch (error: any) {
      console.error("[TelegramPersonal] Parse error:", error.message);
      return null;
    }
  }

  async sendTypingStart(externalConversationId: string): Promise<void> {
    const isEnabled = await featureFlagService.isEnabled("TELEGRAM_PERSONAL_CHANNEL_ENABLED");
    if (!isEnabled || !this.sessionString) return;

    try {
      const client = await this.getClient();
      await client.invoke(
        new Api.messages.SetTyping({
          peer: externalConversationId,
          action: new Api.SendMessageTypingAction(),
        })
      );
    } catch (error: any) {
      console.warn("[TelegramPersonal] Typing indicator error:", error.message);
    }
  }

  async sendTypingStop(externalConversationId: string): Promise<void> {
    const isEnabled = await featureFlagService.isEnabled("TELEGRAM_PERSONAL_CHANNEL_ENABLED");
    if (!isEnabled || !this.sessionString) return;

    try {
      const client = await this.getClient();
      await client.invoke(
        new Api.messages.SetTyping({
          peer: externalConversationId,
          action: new Api.SendMessageCancelAction(),
        })
      );
    } catch (error: any) {
      console.warn("[TelegramPersonal] Cancel typing error:", error.message);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }

  static async startAuth(
    sessionId: string,
    phoneNumber: string
  ): Promise<{ success: boolean; error?: string }> {
    const credentials = await getTelegramCredentials();
    if (!credentials) {
      return { success: false, error: "TELEGRAM_API_ID and TELEGRAM_API_HASH not configured" };
    }

    const { apiId, apiHash } = credentials;

    try {
      const session = new StringSession("");
      const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
      });

      await client.connect();

      const result = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber,
          apiId,
          apiHash,
          settings: new Api.CodeSettings({
            allowFlashcall: false,
            currentNumber: false,
            allowAppHash: true,
          }),
        })
      );

      const phoneCodeHash = (result as any).phoneCodeHash;

      authStates.set(sessionId, {
        phoneCodeHash,
        client,
      });

      console.log(`[TelegramPersonal] Code sent to ${phoneNumber}`);
      return { success: true };
    } catch (error: any) {
      console.error("[TelegramPersonal] StartAuth error:", error.message);
      
      let errorMessage = error.message;
      if (error.message.includes("PHONE_NUMBER_INVALID")) {
        errorMessage = "Invalid phone number format. Use international format, e.g.: +79001234567";
      } else if (error.message.includes("PHONE_NUMBER_BANNED")) {
        errorMessage = "This phone number is banned in Telegram";
      } else if (error.message.includes("FLOOD")) {
        errorMessage = "Too many attempts. Please wait a few minutes";
      }

      return { success: false, error: errorMessage };
    }
  }

  static async verifyCode(
    sessionId: string,
    phoneNumber: string,
    code: string
  ): Promise<{ success: boolean; sessionString?: string; user?: any; needs2FA?: boolean; error?: string }> {
    const state = authStates.get(sessionId);
    if (!state || !state.client || !state.phoneCodeHash) {
      return { success: false, error: "Auth session not found. Please start over" };
    }

    try {
      const result = await state.client.invoke(
        new Api.auth.SignIn({
          phoneNumber,
          phoneCodeHash: state.phoneCodeHash,
          phoneCode: code,
        })
      );

      const sessionString = state.client.session.save() as unknown as string;
      authStates.delete(sessionId);

      const user = (result as any).user;
      console.log(`[TelegramPersonal] Auth successful for ${phoneNumber}`);

      return {
        success: true,
        sessionString,
        user: user ? {
          id: user.id?.toString(),
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          phone: user.phone,
        } : undefined,
      };
    } catch (error: any) {
      console.error("[TelegramPersonal] VerifyCode error:", error.message);

      if (error.message.includes("SESSION_PASSWORD_NEEDED")) {
        return { success: false, needs2FA: true };
      }

      let errorMessage = error.message;
      if (error.message.includes("PHONE_CODE_INVALID")) {
        errorMessage = "Invalid code. Please check and try again";
      } else if (error.message.includes("PHONE_CODE_EXPIRED")) {
        errorMessage = "Code expired. Please request a new one";
        authStates.delete(sessionId);
      }

      return { success: false, error: errorMessage };
    }
  }

  static async verify2FA(
    sessionId: string,
    password: string
  ): Promise<{ success: boolean; sessionString?: string; user?: any; error?: string }> {
    const state = authStates.get(sessionId);
    if (!state || !state.client) {
      return { success: false, error: "Auth session not found. Please start over" };
    }

    try {
      const passwordInfo = await state.client.invoke(new Api.account.GetPassword());
      
      const passwordCheck = await (state.client as any).checkPassword(passwordInfo, password);
      
      const result = await state.client.invoke(
        new Api.auth.CheckPassword({
          password: passwordCheck
        })
      );

      const sessionString = state.client.session.save() as unknown as string;
      authStates.delete(sessionId);

      const user = (result as any).user;
      console.log("[TelegramPersonal] 2FA verification successful");

      return {
        success: true,
        sessionString,
        user: user ? {
          id: user.id?.toString(),
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          phone: user.phone,
        } : undefined,
      };
    } catch (error: any) {
      console.error("[TelegramPersonal] 2FA error:", error.message);

      let errorMessage = error.message;
      if (error.message.includes("PASSWORD_HASH_INVALID")) {
        errorMessage = "Invalid 2FA password";
      }

      return { success: false, error: errorMessage };
    }
  }

  static async cancelAuth(sessionId: string): Promise<void> {
    const state = authStates.get(sessionId);
    if (state?.client) {
      try {
        await state.client.disconnect();
      } catch (e) {
        // ignore
      }
    }
    authStates.delete(sessionId);
  }

  static async verifySession(
    sessionString: string
  ): Promise<{ success: boolean; user?: any; error?: string }> {
    const credentials = await getTelegramCredentials();
    if (!credentials) {
      return { success: false, error: "TELEGRAM_API_ID and TELEGRAM_API_HASH not configured" };
    }

    const { apiId, apiHash } = credentials;

    try {
      const session = new StringSession(sessionString);
      const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 3,
      });

      await client.connect();
      
      const me = await client.getMe();
      await client.disconnect();

      return {
        success: true,
        user: me ? {
          id: (me as any).id?.toString(),
          firstName: (me as any).firstName,
          lastName: (me as any).lastName,
          username: (me as any).username,
          phone: (me as any).phone,
        } : undefined,
      };
    } catch (error: any) {
      console.error("[TelegramPersonal] Session verify error:", error.message);
      return { success: false, error: error.message };
    }
  }

  static async startQrAuth(sessionId: string): Promise<QrAuthResult & { authPromise?: Promise<any> }> {
    const credentials = await getTelegramCredentials();
    if (!credentials) {
      return { success: false, error: "TELEGRAM_API_ID and TELEGRAM_API_HASH not configured" };
    }

    const { apiId, apiHash } = credentials;

    try {
      const existingState = authStates.get(sessionId);
      if (existingState?.client) {
        try {
          await existingState.client.disconnect();
        } catch {
          // ignore
        }
      }

      const session = new StringSession("");
      const client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
      });

      await client.connect();

      let currentQrUrl: string | null = null;
      let currentExpires: number | null = null;
      let needs2FA = false;
      let authUser: any = null;
      let authResolve: ((value: any) => void) | null = null;
      let authReject: ((error: any) => void) | null = null;

      const authPromise = new Promise((resolve, reject) => {
        authResolve = resolve;
        authReject = reject;
      });

      authStates.set(sessionId, {
        client,
        qrToken: undefined,
        qrExpires: undefined,
      });

      client.signInUserWithQrCode(
        { apiId, apiHash },
        {
          qrCode: async (code) => {
            const tokenBase64 = code.token.toString("base64url");
            currentQrUrl = `tg://login?token=${tokenBase64}`;
            currentExpires = code.expires * 1000;
            
            const state = authStates.get(sessionId);
            if (state) {
              state.qrToken = Buffer.from(code.token);
              state.qrExpires = code.expires;
            }
            
            console.log(`[TelegramPersonal] QR token updated, expires at ${new Date(code.expires * 1000).toISOString()}`);
          },
          password: async (hint) => {
            needs2FA = true;
            console.log("[TelegramPersonal] 2FA required, hint:", hint);
            
            const state = authStates.get(sessionId);
            if (state) {
              (state as any).needs2FA = true;
              (state as any).passwordHint = hint;
            }
            
            return new Promise<string>((resolve, reject) => {
              if (state) {
                (state as any).passwordResolver = resolve;
                (state as any).passwordRejecter = reject;
              }
            });
          },
          onError: async (err) => {
            console.error("[TelegramPersonal] QR auth error:", err.message);
            if (authReject) authReject(err);
            return true;
          },
        }
      ).then((user) => {
        authUser = user;
        const state = authStates.get(sessionId);
        if (state) {
          (state as any).authCompleted = true;
          (state as any).authUser = user;
        }
        if (authResolve) authResolve(user);
      }).catch((err) => {
        const state = authStates.get(sessionId);
        if (state) {
          (state as any).authError = err;
        }
        if (authReject) authReject(err);
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      if (!currentQrUrl) {
        authStates.delete(sessionId);
        return { success: false, error: "Failed to generate QR code" };
      }

      console.log(`[TelegramPersonal] QR auth started for session ${sessionId}`);
      
      return {
        success: true,
        qrUrl: currentQrUrl,
        expiresAt: currentExpires || undefined,
        sessionId,
      };
    } catch (error: any) {
      console.error("[TelegramPersonal] StartQrAuth error:", error.message);
      
      let errorMessage = error.message;
      if (error.message.includes("FLOOD")) {
        errorMessage = "Too many attempts. Please wait a few minutes";
      }

      return { success: false, error: errorMessage };
    }
  }

  static async checkQrAuth(sessionId: string): Promise<{
    success: boolean;
    status: "pending" | "authorized" | "expired" | "needs_2fa";
    sessionString?: string;
    user?: any;
    qrUrl?: string;
    expiresAt?: number;
    error?: string;
  }> {
    const state = authStates.get(sessionId);
    if (!state || !state.client) {
      return { success: false, status: "expired", error: "Session not found. Please start over" };
    }

    const client = state.client;

    if ((state as any).needs2FA || (state as any).passwordResolver) {
      return {
        success: true,
        status: "needs_2fa",
      };
    }

    if ((state as any).authCompleted) {
      const sessionString = client.session.save() as unknown as string;
      const user = (state as any).authUser;
      
      authStates.delete(sessionId);
      console.log("[TelegramPersonal] QR auth successful");
      
      return {
        success: true,
        status: "authorized",
        sessionString,
        user: user ? {
          id: user.id?.toString(),
          firstName: user.firstName,
          lastName: user.lastName,
          username: user.username,
          phone: user.phone,
        } : undefined,
      };
    }

    if (state.qrToken && state.qrExpires) {
      const now = Date.now() / 1000;
      if (now > state.qrExpires + 30) {
        return {
          success: false,
          status: "expired",
          error: "QR code expired. Please generate a new one",
        };
      }

      const tokenBase64 = Buffer.from(state.qrToken).toString("base64url");
      const qrUrl = `tg://login?token=${tokenBase64}`;
      
      return {
        success: true,
        status: "pending",
        qrUrl,
        expiresAt: state.qrExpires * 1000,
      };
    }

    return {
      success: true,
      status: "pending",
    };
  }

  static async verify2FAForQr(
    sessionId: string,
    password: string
  ): Promise<{ success: boolean; sessionString?: string; user?: any; error?: string }> {
    const state = authStates.get(sessionId);
    if (!state || !state.client) {
      return { success: false, error: "Auth session not found. Please start over" };
    }

    try {
      const passwordResolver = (state as any).passwordResolver;
      if (!passwordResolver) {
        return { success: false, error: "2FA not required or session expired" };
      }

      passwordResolver(password);
      (state as any).passwordResolver = null;
      (state as any).needs2FA = false;

      for (let i = 0; i < 30; i++) {
        await new Promise(resolve => setTimeout(resolve, 200));
        
        if ((state as any).authError) {
          const error = (state as any).authError;
          authStates.delete(sessionId);
          return { success: false, error: error.message || "Authentication failed" };
        }
        
        if ((state as any).authCompleted) {
          const sessionString = state.client.session.save() as unknown as string;
          const user = (state as any).authUser;
          
          authStates.delete(sessionId);
          console.log("[TelegramPersonal] QR + 2FA verification successful");

          return {
            success: true,
            sessionString,
            user: user ? {
              id: user.id?.toString(),
              firstName: user.firstName,
              lastName: user.lastName,
              username: user.username,
              phone: user.phone,
            } : undefined,
          };
        }
      }

      return { success: false, error: "2FA verification timed out. Please try again" };
    } catch (error: any) {
      console.error("[TelegramPersonal] 2FA for QR error:", error.message);

      let errorMessage = error.message;
      if (error.message.includes("PASSWORD_HASH_INVALID")) {
        errorMessage = "Invalid 2FA password";
      }

      return { success: false, error: errorMessage };
    }
  }
}
