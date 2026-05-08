import { describe, it, expect, beforeEach, vi } from "vitest";
import { WhatsAppPersonalAdapter, _testOnly_authSessions } from "../whatsapp-personal-adapter";

vi.mock("../feature-flags", () => ({
  featureFlagService: {
    isEnabled: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("../message-bus", () => ({
  messageBus: {
    emitIncomingMessage: vi.fn(),
  },
}));

vi.mock("../../utils/sanitizer", () => ({
  sanitizeForLog: vi.fn((x: unknown) => x),
}));

describe("WhatsAppPersonalAdapter", () => {
  let adapter: WhatsAppPersonalAdapter;

  beforeEach(() => {
    adapter = new WhatsAppPersonalAdapter("test-tenant");
    _testOnly_authSessions.clear();
  });

  // ── parseIncomingMessage ────────────────────────────────────────────────────

  describe("parseIncomingMessage", () => {
    it("should parse conversation text message", () => {
      const payload = {
        key: { remoteJid: "79001234567@s.whatsapp.net", id: "msg-001", fromMe: false },
        message: { conversation: "Привет!" },
        messageTimestamp: 1700000000,
        pushName: "Иван",
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result!.text).toBe("Привет!");
      expect(result!.externalMessageId).toBe("msg-001");
      expect(result!.channel).toBe("whatsapp_personal");
      expect(result!.metadata.fromMe).toBe(false);
      expect(result!.metadata.pushName).toBe("Иван");
    });

    it("should parse extendedTextMessage", () => {
      const payload = {
        key: { remoteJid: "79001234567@s.whatsapp.net", id: "msg-002", fromMe: false },
        message: { extendedTextMessage: { text: "Цитата с ответом" } },
        messageTimestamp: 1700000001,
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result!.text).toBe("Цитата с ответом");
    });

    it("should return null for message without text", () => {
      const payload = {
        key: { remoteJid: "79001234567@s.whatsapp.net", id: "msg-003", fromMe: false },
        message: {},
        messageTimestamp: 1700000002,
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).toBeNull();
    });

    it("should return null when fromMe is true (metadata only — filtering is done in messages.upsert)", () => {
      const payload = {
        key: { remoteJid: "79001234567@s.whatsapp.net", id: "msg-004", fromMe: true },
        message: { conversation: "Моё сообщение" },
        messageTimestamp: 1700000003,
      };

      // parseIncomingMessage itself does NOT filter fromMe — it's filtered upstream
      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result!.metadata.fromMe).toBe(true);
    });

    it("should parse image caption", () => {
      const payload = {
        key: { remoteJid: "79001234567@s.whatsapp.net", id: "msg-005", fromMe: false },
        message: { imageMessage: { caption: "Фото с описанием" } },
        messageTimestamp: 1700000004,
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result!.text).toBe("Фото с описанием");
    });

    it("should return [Audio] for audio message without text", () => {
      const payload = {
        key: { remoteJid: "79001234567@s.whatsapp.net", id: "msg-006", fromMe: false },
        message: { audioMessage: { url: "https://cdn.example.com/audio.ogg" } },
        messageTimestamp: 1700000005,
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result!.text).toBe("[Audio]");
    });

    it("should return [Image] for image message without caption", () => {
      const payload = {
        key: { remoteJid: "79001234567@s.whatsapp.net", id: "msg-010", fromMe: false },
        message: { imageMessage: {} },
        messageTimestamp: 1700000010,
      };
      const result = adapter.parseIncomingMessage(payload);
      expect(result).not.toBeNull();
      expect(result!.text).toBe("[Image]");
    });

    it("should return [Document] for document message without caption", () => {
      const payload = {
        key: { remoteJid: "79001234567@s.whatsapp.net", id: "msg-011", fromMe: false },
        message: { documentMessage: { fileName: "report.pdf" } },
        messageTimestamp: 1700000011,
      };
      const result = adapter.parseIncomingMessage(payload);
      expect(result).not.toBeNull();
      expect(result!.text).toBe("[Document]");
    });

    it("should extract phone from jid", () => {
      const payload = {
        key: { remoteJid: "79001234567@s.whatsapp.net", id: "msg-007", fromMe: false },
        message: { conversation: "Тест" },
        messageTimestamp: 1700000006,
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result!.metadata.phone).toBe("79001234567");
      expect(result!.externalConversationId).toBe("79001234567@s.whatsapp.net");
    });

    it("should detect group messages (isGroup)", () => {
      const payload = {
        key: {
          remoteJid: "120363000000000001@g.us",
          id: "msg-008",
          fromMe: false,
          participant: "79001234567@s.whatsapp.net",
        },
        message: { conversation: "Групповое сообщение" },
        messageTimestamp: 1700000007,
      };

      const result = adapter.parseIncomingMessage(payload);

      expect(result).not.toBeNull();
      expect(result!.metadata.isGroup).toBe(true);
      expect(result!.externalConversationId).toBe("120363000000000001@g.us");
    });

    it("should handle invalid payload (null)", () => {
      expect(adapter.parseIncomingMessage(null)).toBeNull();
    });

    it("should handle invalid payload (string)", () => {
      expect(adapter.parseIncomingMessage("invalid")).toBeNull();
    });

    it("should return null when remoteJid is missing", () => {
      const payload = {
        key: { id: "msg-009", fromMe: false },
        message: { conversation: "Без jid" },
      };

      expect(adapter.parseIncomingMessage(payload)).toBeNull();
    });
  });

  // ── isConnected ─────────────────────────────────────────────────────────────

  describe("isConnected", () => {
    it("should return false when no session exists", () => {
      expect(WhatsAppPersonalAdapter.isConnected("unknown-tenant")).toBe(false);
    });

    it("should return true when status is connected", () => {
      _testOnly_authSessions.set("tenant-1", {
        socket: null,
        qrCode: null,
        qrDataUrl: null,
        pairingCode: null,
        status: "connected",
        user: { id: "7900:1@s.whatsapp.net", name: "Иван", phone: "79001234567" },
      });

      expect(WhatsAppPersonalAdapter.isConnected("tenant-1")).toBe(true);
    });

    it("should return true when reconnecting with user info", () => {
      _testOnly_authSessions.set("tenant-2", {
        socket: null,
        qrCode: null,
        qrDataUrl: null,
        pairingCode: null,
        status: "connecting",
        reconnecting: true,
        user: { id: "7900:1@s.whatsapp.net", name: "Иван", phone: "79001234567" },
      });

      expect(WhatsAppPersonalAdapter.isConnected("tenant-2")).toBe(true);
    });

    it("should return false when status is disconnected even with socket (FIX-06)", () => {
      _testOnly_authSessions.set("tenant-3", {
        socket: { end: vi.fn() } as any,
        qrCode: null,
        qrDataUrl: null,
        pairingCode: null,
        status: "disconnected",
        user: { id: "7900:1@s.whatsapp.net", name: "Иван", phone: "79001234567" },
      });

      expect(WhatsAppPersonalAdapter.isConnected("tenant-3")).toBe(false);
    });

    it("should return false when status is disconnected and not reconnecting", () => {
      _testOnly_authSessions.set("tenant-4", {
        socket: null,
        qrCode: null,
        qrDataUrl: null,
        pairingCode: null,
        status: "disconnected",
        reconnecting: false,
        user: { id: "7900:1@s.whatsapp.net", name: "Иван", phone: "79001234567" },
      });

      expect(WhatsAppPersonalAdapter.isConnected("tenant-4")).toBe(false);
    });
  });

  // ── hasSession ──────────────────────────────────────────────────────────────

  describe("hasSession", () => {
    it("should return false when no session exists", () => {
      expect(WhatsAppPersonalAdapter.hasSession("no-session")).toBe(false);
    });

    it("should return false when session exists but has no user", () => {
      _testOnly_authSessions.set("tenant-5", {
        socket: null,
        qrCode: "qr-data",
        qrDataUrl: null,
        pairingCode: null,
        status: "qr_ready",
      });

      expect(WhatsAppPersonalAdapter.hasSession("tenant-5")).toBe(false);
    });

    it("should return true when session has user info", () => {
      _testOnly_authSessions.set("tenant-6", {
        socket: null,
        qrCode: null,
        qrDataUrl: null,
        pairingCode: null,
        status: "connected",
        user: { id: "7900:1@s.whatsapp.net", name: "Иван", phone: "79001234567" },
      });

      expect(WhatsAppPersonalAdapter.hasSession("tenant-6")).toBe(true);
    });
  });

  // ── checkAuth ───────────────────────────────────────────────────────────────

  describe("checkAuth", () => {
    it("should return disconnected status when no session", async () => {
      const result = await WhatsAppPersonalAdapter.checkAuth("no-session");

      expect(result.success).toBe(false);
      expect(result.status).toBe("disconnected");
      expect(result.error).toBe("No active session");
    });

    it("should return session status and user info when connected", async () => {
      const user = { id: "7900:1@s.whatsapp.net", name: "Иван", phone: "79001234567" };
      _testOnly_authSessions.set("tenant-7", {
        socket: null,
        qrCode: null,
        qrDataUrl: null,
        pairingCode: null,
        status: "connected",
        user,
      });

      const result = await WhatsAppPersonalAdapter.checkAuth("tenant-7");

      expect(result.success).toBe(true);
      expect(result.status).toBe("connected");
      expect(result.user).toEqual(user);
    });

    it("should return qr_ready status with qrCode", async () => {
      _testOnly_authSessions.set("tenant-8", {
        socket: null,
        qrCode: "2@abc123",
        qrDataUrl: "data:image/png;base64,abc",
        pairingCode: null,
        status: "qr_ready",
      });

      const result = await WhatsAppPersonalAdapter.checkAuth("tenant-8");

      expect(result.success).toBe(true);
      expect(result.status).toBe("qr_ready");
      expect(result.qrCode).toBe("2@abc123");
      expect(result.qrDataUrl).toBe("data:image/png;base64,abc");
    });

    it("should return pairing_code_ready status with pairingCode", async () => {
      _testOnly_authSessions.set("tenant-9", {
        socket: null,
        qrCode: null,
        qrDataUrl: null,
        pairingCode: "ABCD1234",
        status: "pairing_code_ready",
      });

      const result = await WhatsAppPersonalAdapter.checkAuth("tenant-9");

      expect(result.success).toBe(true);
      expect(result.status).toBe("pairing_code_ready");
      expect(result.pairingCode).toBe("ABCD1234");
    });
  });
});
