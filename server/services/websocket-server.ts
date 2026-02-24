import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import type { Message, Conversation } from "@shared/schema";
import { parse as parseUrl } from "url";
import { getSession } from "../session";
import { storage } from "../storage";
import type { RequestHandler } from "express";

interface ConnectedClient {
  ws: WebSocket;
  tenantId: string;
  userId?: string;
  conversationId?: string;
}

class RealtimeService {
  private wss: WebSocketServer | null = null;
  private clients: Set<ConnectedClient> = new Set();
  private sessionParser: RequestHandler | null = null;

  initialize(server: Server) {
    this.wss = new WebSocketServer({ noServer: true });
    this.sessionParser = getSession();

    this.wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
      const authenticatedTenantId = (request as any).authenticatedTenantId as string | undefined;
      const authenticatedUserId = (request as any).authenticatedUserId as string | undefined;

      const client: ConnectedClient = {
        ws,
        tenantId: authenticatedTenantId || "default",
        userId: authenticatedUserId,
      };
      this.clients.add(client);
      console.log(`[WebSocket] Client connected (tenant: ${client.tenantId}, user: ${client.userId || "anonymous"})`);

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === "subscribe" && message.conversationId) {
            client.conversationId = message.conversationId;
          }
          if (message.type === "set_tenant" && message.tenantId) {
            if (authenticatedTenantId) {
              if (message.tenantId !== authenticatedTenantId) {
                console.warn(`[WebSocket] Rejected tenant override: ${message.tenantId} (session: ${authenticatedTenantId})`);
                ws.send(JSON.stringify({ type: "error", message: "Tenant bound to authenticated session" }));
              }
            } else {
              client.tenantId = message.tenantId;
            }
          }
          if (message.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          }
        } catch {
        }
      });

      ws.on("close", () => {
        this.clients.delete(client);
        console.log("[WebSocket] Client disconnected");
      });

      ws.on("error", (error) => {
        console.error("[WebSocket] Error:", error.message);
        this.clients.delete(client);
      });

      ws.send(JSON.stringify({ type: "connected" }));
    });

    server.on("upgrade", (request: IncomingMessage, socket, head) => {
      const { pathname } = parseUrl(request.url || "");

      if (pathname === "/ws") {
        this.authenticateAndUpgrade(request, socket as any, head);
      }
    });

    console.log("[WebSocket] Server initialized on /ws (with session authentication)");
  }

  private authenticateAndUpgrade(request: IncomingMessage, socket: any, head: Buffer) {
    if (!this.sessionParser) {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
      return;
    }

    this.sessionParser(request as any, {} as any, async (err?: any) => {
      if (err) {
        console.error("[WebSocket] Session parse error:", err);
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
        return;
      }

      const session = (request as any).session;

      if (session?.userId) {
        try {
          const user = await storage.getUser(session.userId);
          if (!user?.tenantId) {
            console.debug(`[WebSocket] Rejected: user ${session.userId} has no tenant (platform staff)`);
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
          }
          (request as any).authenticatedTenantId = user.tenantId;
          (request as any).authenticatedUserId = session.userId;
        } catch (lookupErr) {
          console.error("[WebSocket] User lookup error:", lookupErr);
          socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
          socket.destroy();
          return;
        }
      } else if (process.env.NODE_ENV === "production") {
        console.warn("[WebSocket] Rejected: unauthenticated connection in production");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        this.wss!.emit("connection", ws, request);
      });
    });
  }

  broadcastNewMessage(tenantId: string, message: Message, conversationId: string) {
    const payload = JSON.stringify({
      type: "new_message",
      conversationId,
      message,
    });

    Array.from(this.clients).forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN && client.tenantId === tenantId) {
        if (!client.conversationId || client.conversationId === conversationId) {
          client.ws.send(payload);
        }
      }
    });
  }

  broadcastConversationUpdate(tenantId: string, conversation: Partial<Conversation> & { id: string }) {
    const payload = JSON.stringify({
      type: "conversation_update",
      conversation,
    });

    Array.from(this.clients).forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN && client.tenantId === tenantId) {
        client.ws.send(payload);
      }
    });
  }

  broadcastNewConversation(tenantId: string, conversation: any) {
    const payload = JSON.stringify({
      type: "new_conversation",
      conversation,
    });

    Array.from(this.clients).forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN && client.tenantId === tenantId) {
        client.ws.send(payload);
      }
    });
  }

  broadcastNewSuggestion(tenantId: string, conversationId: string, suggestionId: string) {
    const payload = JSON.stringify({
      type: "new_suggestion",
      conversationId,
      suggestionId,
    });

    Array.from(this.clients).forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN && client.tenantId === tenantId) {
        client.ws.send(payload);
      }
    });
  }

  async close(): Promise<void> {
    if (!this.wss) return;
    await new Promise<void>((resolve) => {
      this.wss!.close(() => resolve());
    });
    this.wss = null;
    this.clients.clear();
  }
}

export const realtimeService = new RealtimeService();
