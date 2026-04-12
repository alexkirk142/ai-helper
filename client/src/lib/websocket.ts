import { queryClient } from "./queryClient";
import { showBrowserNotification } from "@/hooks/use-notifications";

type MessageHandler = (data: any) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private isConnecting = false;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[WebSocket] Connected");
        this.isConnecting = false;
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch {
        }
      };

      this.ws.onclose = () => {
        console.log("[WebSocket] Disconnected");
        this.isConnecting = false;
        this.ws = null;
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
      };
    } catch {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("[WebSocket] Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    console.log(`[WebSocket] Reconnecting in ${delay}ms...`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  private handleMessage(data: any) {
    const { type } = data;
    console.log(`[WebSocket] Received: ${type}`, data);

    if (type === "new_message") {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", data.conversationId] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/channel-counts"] });

      // Browser notification for incoming customer messages only
      if (data.message?.role === "customer") {
        const senderName = data.message?.metadata?.pushName
          || data.message?.metadata?.senderName
          || "Клиент";
        const text = data.message?.content || "Новое сообщение";
        showBrowserNotification(`💬 ${senderName}`, text, data.conversationId);
      }
    }

    if (type === "new_conversation") {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/channel-counts"] });

      // Browser notification for new incoming conversations
      const customer = data.conversation?.customer;
      const senderName = customer?.name || customer?.phone || "Новый клиент";
      showBrowserNotification("🆕 Новый диалог", senderName, data.conversation?.id);
    }

    if (type === "conversation_update") {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/channel-counts"] });
      // payload shape: { type, conversation: { id, ... } } — use conversation.id, not conversationId
      const convId = data.conversation?.id ?? data.conversationId;
      if (convId) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", convId] });
      }
    }

    if (type === "new_suggestion") {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", data.conversationId] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations/channel-counts"] });
    }

    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  subscribe(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  subscribeToConversation(conversationId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", conversationId }));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsClient = new WebSocketClient();
