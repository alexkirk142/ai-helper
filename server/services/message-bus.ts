import { EventEmitter } from "events";
import type { ParsedIncomingMessage } from "./channel-adapter.types";

interface IncomingMessagePayload {
  tenantId: string;
  channelId: string | null;
  message: ParsedIncomingMessage;
}

class MessageBus extends EventEmitter {
  emitIncomingMessage(tenantId: string, channelId: string | null, message: ParsedIncomingMessage): void {
    this.emit("incoming_message", { tenantId, channelId, message });
  }

  onIncomingMessage(handler: (payload: IncomingMessagePayload) => void): void {
    this.on("incoming_message", handler);
  }
}

export const messageBus = new MessageBus();
