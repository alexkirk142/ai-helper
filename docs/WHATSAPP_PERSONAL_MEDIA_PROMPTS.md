# WhatsApp Personal — Промпты для реализации недостающего функционала

> Аудит проведён: май 2026  
> Предыдущий документ (рефакторинг и auth-фиксы): `docs/WHATSAPP_PERSONAL_FIX_PROMPTS.md`  
> Этот документ: **новый медиа-функционал и отправка новым клиентам**
>
> **Порядок выполнения строго последовательный** — каждая задача опирается на результат предыдущей.  
> **Железное правило безопасности:** ни одна из задач не должна изменять файлы:
> - `telegram-adapter.ts`, `telegram-client-manager.ts`, `telegram-personal-adapter.ts`
> - `max-green-api-adapter.ts`, `max-personal-adapter.ts`
> - `whatsapp-adapter.ts` (Business API)
> - В `message.routes.ts` и `inbound-message-handler.ts` — только добавлять новые ветки `whatsapp_personal`, существующие ветки других каналов не трогать.

---

## FEAT-01 — Критический баг: входящие медиа без подписи молча теряются (P0)

**Проблема:** В `parseIncomingMessage` условия для `imageMessage`, `videoMessage`, `documentMessage` проверяют наличие caption перед присвоением текста. Если клиент прислал фото без подписи — метод доходит до `if (!text)` и возвращает `null`. Беседа не создаётся, сообщение теряется полностью.

**Файл:** `server/services/whatsapp-personal-adapter.ts`

**Промпт:**

```
В файле server/services/whatsapp-personal-adapter.ts исправить критический баг в методе
parseIncomingMessage: входящие медиа-сообщения без подписи (caption) молча отбрасываются.

Текущий код (строки ~127–137):
  } else if (messageContent?.imageMessage?.caption) {
    text = messageContent.imageMessage.caption || "[Image]";
  } else if (messageContent?.videoMessage?.caption) {
    text = messageContent.videoMessage.caption || "[Video]";
  } else if (messageContent?.documentMessage?.caption) {
    text = messageContent.documentMessage.caption || "[Document]";

Проблема: условие .caption в if-guard означает, что если caption пустой/отсутствует,
ветка пропускается. text остаётся "", метод возвращает null, сообщение теряется.

Исправление — убрать .caption из условия (проверять только наличие объекта сообщения):

  } else if (messageContent?.imageMessage) {
    text = messageContent.imageMessage.caption || "[Image]";
  } else if (messageContent?.videoMessage) {
    text = messageContent.videoMessage.caption || "[Video]";
  } else if (messageContent?.documentMessage) {
    text = messageContent.documentMessage.caption || "[Document]";

Аналогично исправить строку логирования (102–107) — она уже не виновата, но убедись
что она по-прежнему логирует messageKeys.

Никакие другие файлы не изменяются.
Никакие другие каналы (telegram, max_personal, whatsapp business) не затрагиваются.

После исправления обновить unit-тест в server/services/__tests__/whatsapp-personal-adapter.test.ts:
Добавить тест рядом с существующим "should parse image caption":

  it("should return [Image] for image message without caption", () => {
    const payload = {
      key: { remoteJid: "79001234567@s.whatsapp.net", id: "msg-010", fromMe: false },
      message: { imageMessage: {} },  // нет caption
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
```

---

## FEAT-02 — Отправка медиа оператором (фото, файлы, аудио, видео) (P0)

**Проблема:** Оператор не может отправить клиенту ничего кроме текста. Все остальные каналы (Telegram Personal, MAX Personal) поддерживают отправку файлов. В `message.routes.ts` блок media-send (строки 206–299) полностью игнорирует `whatsapp_personal`.

**Затрагиваемые файлы:**
- `server/services/whatsapp-personal-adapter.ts` — добавить метод `sendMediaMessage`
- `server/routes/message.routes.ts` — добавить ветку для `whatsapp_personal` в media-send блок

**Промпт часть 1 — Метод в адаптере:**

```
В файле server/services/whatsapp-personal-adapter.ts добавить публичный метод
sendMediaMessage для отправки медиа-файлов через Baileys.

Добавить метод ПОСЛЕ существующего метода sendMessage (после строки ~91), ВНУТРИ класса WhatsAppPersonalAdapter:

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
        // Для аудио (voice note): ptt: true — отображается как голосовое сообщение
        // Для обычного аудио-файла: ptt: false
        const isVoiceNote = mimetype === "audio/ogg" || mimetype.includes("ogg");
        messagePayload = {
          audio: buffer,
          mimetype: isVoiceNote ? "audio/ogg; codecs=opus" : mimetype,
          ptt: isVoiceNote,
        };
      } else {
        // Документы, PDF, Excel, Word, txt и т.д.
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

Убедиться что:
1. Метод добавлен внутри класса WhatsAppPersonalAdapter (не снаружи)
2. Типы ChannelSendResult уже импортированы (они есть в строке 10)
3. Никакие другие методы класса не изменяются
4. Никакие другие файлы не изменяются в этой части
```

**Промпт часть 2 — Ветка в routes:**

```
В файле server/routes/message.routes.ts добавить ветку для отправки медиа через WhatsApp Personal.

Блок media-send находится примерно на строках 206–299. Он выглядит так:
  if (uploadedFile && role === "owner" && conversation.messages.length > 0) {
    ...
    if (effectiveChannelType === "telegram_personal" ...) { ... }
    if (effectiveChannelType === "telegram" ...) { ... }
    if (effectiveChannelType === "max_personal" ...) { ... }
  }

Добавить новый блок ПОСЛЕ блока max_personal (после строки ~298) и ДО закрывающей скобки блока:

        if (effectiveChannelType === "whatsapp_personal" && conversation.customer?.externalId) {
          try {
            const adapter = new WhatsAppPersonalAdapter(conversation.tenantId);
            let recipientJid = conversation.customer.externalId;
            if (!recipientJid.includes("@")) recipientJid = `${recipientJid}@s.whatsapp.net`;
            const { buffer, mimetype, size } = uploadedFile;
            const originalname = Buffer.from(uploadedFile.originalname, "latin1").toString("utf8");

            const sendResult = await adapter.sendMediaMessage(
              recipientJid,
              buffer,
              mimetype,
              originalname,
              content.trim() || undefined,
            );

            if (sendResult.success) {
              outboundAttachment = buildAttachmentMeta(mimetype, originalname, size, {});
              console.log(`[OutboundHandler] WhatsApp Personal media sent: msgId=${sendResult.externalMessageId}`);
            } else {
              console.error(`[OutboundHandler] WhatsApp Personal media send failed: ${sendResult.error}`);
            }
          } catch (sendError: any) {
            console.error(`[OutboundHandler] WhatsApp Personal media send error:`, sendError.message);
          }
        }

Важно:
1. НЕ изменять существующие блоки telegram_personal, telegram, max_personal
2. Новый блок ставится ВНУТРИ внешнего if (uploadedFile && role === "owner" && conversation.messages.length > 0)
3. WhatsAppPersonalAdapter уже импортирован в этом файле (строка 8)
4. Функция buildAttachmentMeta уже определена в этом файле (~строка 471)
5. Никакие другие части файла не изменяются
```

---

## FEAT-03 — Инициация новой беседы с клиентом по номеру телефона (P1)

**Проблема:** Нельзя написать первым новому клиенту через WhatsApp Personal. У Telegram Personal и MAX Personal есть `/start-conversation` эндпоинт, у WhatsApp Personal — нет. Дополнительно: `conversation.messages.length > 0` в `message.routes.ts` блокирует отправку первого сообщения в новую беседу.

**Файл:** `server/routes/channels/whatsapp-personal.routes.ts`

**Промпт:**

```
В файле server/routes/channels/whatsapp-personal.routes.ts добавить новый роут
POST /api/whatsapp-personal/start-conversation.

Добавить роут ПЕРЕД строкой "export default router;" (в конец файла):

router.post(
  "/api/whatsapp-personal/start-conversation",
  requireAuth,
  requirePermission("MANAGE_CHANNELS"),
  requireActiveSubscription,
  requireActiveTenant,
  requireTenant,
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;

      const { phoneNumber, initialMessage } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ error: "Номер телефона обязателен" });
      }

      // Очищаем от всего кроме цифр
      const cleanDigits = String(phoneNumber).replace(/\D/g, "");
      if (cleanDigits.length < 10 || cleanDigits.length > 15) {
        return res.status(400).json({ error: "Неверный формат номера телефона" });
      }

      const { WhatsAppPersonalAdapter: WAP } = await import(
        "../../services/whatsapp-personal-adapter"
      );

      if (!WAP.isConnected(tenantId)) {
        return res.status(400).json({ error: "WhatsApp Personal не подключён" });
      }

      const recipientJid = `${cleanDigits}@s.whatsapp.net`;

      // Найти или создать клиента
      const { storage } = await import("../../storage");
      let customer = await storage.getCustomerByExternalId(tenantId, "whatsapp_personal", recipientJid);

      if (!customer) {
        try {
          customer = await storage.createCustomer(
            {
              tenantId,
              externalId: recipientJid,
              name: `WhatsApp +${cleanDigits}`,
              channel: "whatsapp_personal",
              phone: `+${cleanDigits}`,
              metadata: {},
            },
            tenantId
          );
        } catch (e: any) {
          // Гонка — клиент уже был создан параллельным запросом
          customer = await storage.getCustomerByExternalId(tenantId, "whatsapp_personal", recipientJid);
          if (!customer) throw e;
        }
      }

      // Найти или создать активную беседу
      const allConversations = await storage.getConversationsByTenant(tenantId);
      let conversation = allConversations.find(
        (c) =>
          c.customerId === customer!.id &&
          (c.status === "active" || c.status === "pending")
      );

      if (!conversation) {
        conversation = await storage.createConversation(
          {
            tenantId,
            customerId: customer.id,
            status: "active",
            mode: "learning",
          },
          tenantId
        );
      }

      // Отправить первое сообщение, если передано
      if (initialMessage && String(initialMessage).trim()) {
        const trimmed = String(initialMessage).trim();
        const adapter = new WAP(tenantId);

        const sendResult = await adapter.sendMessage(recipientJid, trimmed);

        if (sendResult.success) {
          await storage.createMessage(
            {
              conversationId: conversation.id,
              role: "assistant",
              content: trimmed,
              metadata: {
                isOutbound: true,
                externalMessageId: sendResult.externalMessageId ?? null,
                channel: "whatsapp_personal",
                recipientJid,
              },
            },
            tenantId
          );
          console.log(
            `[WhatsAppPersonal] start-conversation: sent initial message to ${recipientJid}`
          );
        } else {
          console.error(
            `[WhatsAppPersonal] start-conversation: failed to send initial message: ${sendResult.error}`
          );
          // Не возвращаем ошибку — беседа всё равно создана, сообщение можно отправить позже
        }
      }

      res.json({ success: true, conversationId: conversation.id });
    } catch (error: any) {
      console.error("Error starting WhatsApp Personal conversation:", error);
      res.status(500).json({ error: error.message || "Failed to start conversation" });
    }
  }
);

Требования к импортам:
- requireActiveSubscription и requireActiveTenant уже импортированы в начале файла
- WhatsAppPersonalAdapter импортируется динамически внутри handler (как в других роутах)
- storage импортируется динамически внутри handler

Никакие другие файлы не изменяются.
Роуты других каналов (telegram-personal.routes.ts, max.routes.ts) не трогать.
```

---

## FEAT-04 — Скачивание и сервинг входящих медиа-файлов (P1)

**Проблема:** Входящие фото, документы, видео, голосовые сообщения от клиентов не сохраняются. `ParsedIncomingMessage.attachments` никогда не заполняется для WhatsApp Personal. Оператор видит только текст-заглушку, реальный файл недоступен.

**Решение:** При получении медиа-сообщения скачать файл через Baileys `downloadMediaMessage`, сохранить в ограниченный in-memory кэш, создать `ParsedAttachment` с URL на медиа-прокси, добавить роут для отдачи файла.

**Затрагиваемые файлы:**
- `server/services/whatsapp-personal-adapter.ts` — кэш медиа + скачивание в `_attachMessageHandlers`
- `server/routes/channels/whatsapp-personal.routes.ts` — новый GET роут для медиа

**Промпт часть 1 — Медиа-кэш и скачивание:**

```
В файле server/services/whatsapp-personal-adapter.ts реализовать скачивание входящих
медиа-файлов и сохранение их в in-memory кэш с отдачей через HTTP.

--- Шаг 1: Добавить медиа-кэш на уровне модуля ---

После строки с объявлением processedHistoryIds добавить:

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
  // Если кэш переполнен — удалить самую старую запись
  if (cache.size >= MAX_MEDIA_CACHE_PER_TENANT) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(messageId, { buffer, mimeType, fileName });
}

// Экспорт для использования в роутах
export function getFromMediaCache(
  tenantId: string,
  messageId: string
): { buffer: Buffer; mimeType: string; fileName: string } | undefined {
  return mediaCache.get(tenantId)?.get(messageId);
}

--- Шаг 2: Добавить скачивание медиа в _attachMessageHandlers ---

В статическом методе _attachMessageHandlers, в обработчике "messages.upsert",
ПЕРЕД вызовом messageBus.emitIncomingMessage(tenantId, null, parsed) добавить:

        // Скачать медиа если есть вложение
        const mediaAttachment = await WhatsAppPersonalAdapter._downloadMediaIfPresent(
          msg,
          parsed,
          tenantId,
          session
        );
        if (mediaAttachment) {
          parsed.attachments = [mediaAttachment];
        }

Здесь session — это текущая сессия. Её нужно получить внутри обработчика:
  const session = authSessions.get(tenantId);

--- Шаг 3: Добавить приватный статический метод _downloadMediaIfPresent ---

Добавить в класс WhatsAppPersonalAdapter новый приватный статический метод
ПЕРЕД методом _attachMessageHandlers:

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
      return null; // Нет медиа — не скачиваем
    }

    try {
      const { downloadMediaMessage } = await getBaileys();
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

      return {
        type: attachmentType,
        url: mediaUrl,
        mimeType,
        fileName,
        fileSize: buffer.length,
      };
    } catch (error: any) {
      console.warn(`[WhatsAppPersonal] Media download failed for ${parsed.externalMessageId}: ${error.message}`);
      return null;
    }
  }

Важно:
1. Метод _downloadMediaIfPresent добавляется ВНУТРИ класса WhatsAppPersonalAdapter
2. ParsedIncomingMessage уже импортирован в типах (строка 10)
3. ParsedAttachment тип импортируется динамически внутри метода
4. getBaileys() уже определён в начале файла — используем его для downloadMediaMessage
5. pino уже импортирован в файле (строка 17)
6. Никакие другие методы класса не изменяются

--- Шаг 4: Очистка кэша при logout ---

В методе logout() добавить после processedHistoryIds.delete(tenantId):
  mediaCache.delete(tenantId);
```

**Промпт часть 2 — HTTP-роут для отдачи медиа:**

```
В файле server/routes/channels/whatsapp-personal.routes.ts добавить роут для отдачи
закэшированных медиа-файлов.

Добавить ПЕРЕД строкой "export default router;":

router.get(
  "/api/whatsapp-personal/media/:tenantId/:messageId",
  requireAuth,
  requireTenant,
  async (req: Request, res: Response) => {
    try {
      const { tenantId, messageId } = req.params;

      // Проверить что tenantId в URL совпадает с tenantId из сессии
      const requestTenantId = req.tenantId!;
      if (tenantId !== requestTenantId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { getFromMediaCache } = await import("../../services/whatsapp-personal-adapter");
      const media = getFromMediaCache(tenantId, decodeURIComponent(messageId));

      if (!media) {
        return res.status(404).json({ error: "Media not found or expired" });
      }

      res.set("Content-Type", media.mimeType);
      res.set("Content-Length", String(media.buffer.length));
      res.set("Content-Disposition", `inline; filename="${media.fileName}"`);
      res.set("Cache-Control", "private, max-age=3600");
      res.send(media.buffer);
    } catch (error: any) {
      console.error("Error serving WhatsApp Personal media:", error);
      res.status(500).json({ error: "Failed to serve media" });
    }
  }
);

Важно:
1. Роут добавляется ПЕРЕД "export default router;"
2. Изоляция по tenantId: проверяем что req.tenantId совпадает с :tenantId из URL
3. getFromMediaCache — новый экспорт из whatsapp-personal-adapter.ts (добавленный в FEAT-04 часть 1)
4. Никакие другие роуты не изменяются
5. Никакие другие файлы не изменяются в этой части
```

---

## FEAT-05 — Интеграция OCR-пайплайна для изображений WhatsApp Personal (P2)

**Проблема:** VIN OCR (распознавание номеров кузовов из фотографий) работает только для Telegram Personal. Когда клиент присылает фото через WhatsApp Personal — OCR не запускается. Это происходит потому что `inbound-message-handler.ts` умеет разрешать только URL по паттерну `/api/telegram-personal/media/...`.

**Зависимость:** Выполнять ПОСЛЕ FEAT-04 (нужны MediaCache и медиа-URL).

**Файл:** `server/services/inbound-message-handler.ts`

**Промпт:**

```
В файле server/services/inbound-message-handler.ts расширить пайплайн OCR-анализа изображений
для поддержки WhatsApp Personal.

Найти блок (примерно строки 454–482) который разрешает URL Telegram медиа в base64 data URL:

  const resolvedAttachments = await Promise.all(
    imageAttachments.map(async (att) => {
      const url = att.url ?? "";
      const match = url.match(/^\/api\/telegram-personal\/media\/([^/]+)\/([^/]+)\/(\d+)$/);
      if (!match) return att;
      // ... скачивание через telegramClientManager ...
    })
  );

Изменение: в той же map-функции, ДО проверки Telegram паттерна (не заменяя его, а добавляя),
добавить обработку WhatsApp Personal URL:

  const resolvedAttachments = await Promise.all(
    imageAttachments.map(async (att) => {
      const url = att.url ?? "";

      // ── WhatsApp Personal media (FEAT-05) ────────────────────────────────
      const waMatch = url.match(/^\/api\/whatsapp-personal\/media\/([^/]+)\/([^/]+)$/);
      if (waMatch) {
        const [, waTenantId, waMessageId] = waMatch;
        try {
          const { getFromMediaCache } = await import("./whatsapp-personal-adapter");
          const media = getFromMediaCache(waTenantId, decodeURIComponent(waMessageId));
          if (media && media.buffer.length > 0) {
            const mimeType = media.mimeType || "image/jpeg";
            const dataUrl = `data:${mimeType};base64,${media.buffer.toString("base64")}`;
            console.log(`[InboundHandler] Resolved WA Personal media → data URL (${media.buffer.length} bytes)`);
            return { ...att, url: dataUrl };
          }
        } catch (waErr: any) {
          console.warn(`[InboundHandler] Failed to resolve WA Personal media for OCR: ${waErr.message}`);
        }
        return att;
      }

      // ── Telegram Personal media (существующий код, НЕ изменять) ──────────
      const match = url.match(/^\/api\/telegram-personal\/media\/([^/]+)\/([^/]+)\/(\d+)$/);
      if (!match) return att;
      const [, accountId, chatId, msgId] = match;
      try {
        const { telegramClientManager } = await import("./telegram-client-manager");
        // ... существующий код без изменений ...
      } catch (dlErr: any) {
        // ... существующий код без изменений ...
      }
    })
  );

Правила:
1. Существующий Telegram-блок (match, telegramClientManager) остаётся НЕТРОНУТЫМ
2. WhatsApp-блок добавляется ПЕРЕД Telegram-блоком внутри той же map-функции
3. getFromMediaCache — это экспорт из whatsapp-personal-adapter.ts (добавленный в FEAT-04)
4. Никакие другие части inbound-message-handler.ts не изменяются
5. Никакие другие файлы не изменяются
```

---

## FEAT-06 — Транскрипция голосовых сообщений (P2, опционально)

**Проблема:** Голосовые сообщения от клиентов отображаются как `[Audio]`. ИИ не может ответить на содержание, оператор не видит что сказал клиент.

**Зависимость:** Выполнять ПОСЛЕ FEAT-04 (нужен MediaCache с аудио-данными).

**Примечание:** Задача требует наличия OpenAI API ключа и доступа к `openai` SDK. Проверить что `openai` установлен (`npm list openai`) прежде чем выполнять.

**Файл:** `server/services/whatsapp-personal-adapter.ts`

**Промпт:**

```
В файле server/services/whatsapp-personal-adapter.ts добавить транскрипцию голосовых
сообщений через OpenAI Whisper API.

Задача выполняется ТОЛЬКО если:
1. openai пакет уже установлен (проверить package.json)
2. OPENAI_API_KEY есть в переменных окружения
3. FEAT-04 уже выполнен (MediaCache существует)

--- Шаг 1: Добавить функцию транскрипции ---

Добавить после функции addToMediaCache и getFromMediaCache (на уровне модуля):

async function transcribeAudio(buffer: Buffer, mimeType: string): Promise<string | null> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const { OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey });

    // OpenAI Whisper принимает File-like объект
    const { Blob } = await import("buffer");
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

--- Шаг 2: Изменить _downloadMediaIfPresent ---

В методе _downloadMediaIfPresent, в ветке где attachmentType === "voice" или "audio",
ПОСЛЕ вызова addToMediaCache добавить транскрипцию:

    // Транскрипция голосового сообщения
    let voiceTranscription: string | null = null;
    if (attachmentType === "voice" || attachmentType === "audio") {
      voiceTranscription = await transcribeAudio(buffer, mimeType);
    }

Затем, при формировании ParsedAttachment, добавить поле duration:

    return {
      type: attachmentType,
      url: mediaUrl,
      mimeType,
      fileName,
      fileSize: buffer.length,
      duration: messageContent.audioMessage?.seconds,
    };

--- Шаг 3: В _attachMessageHandlers использовать транскрипцию ---

После строки:
  if (mediaAttachment) {
    parsed.attachments = [mediaAttachment];
  }

Добавить:
  // Если есть транскрипция голоса — добавить её в текст сообщения
  if (
    mediaAttachment &&
    (mediaAttachment.type === "voice" || mediaAttachment.type === "audio")
  ) {
    const transcription = (mediaAttachment as any)._transcription as string | undefined;
    if (transcription) {
      parsed.text = transcription;
      console.log(`[WhatsAppPersonal] Replaced [Audio] with transcription: "${transcription.substring(0, 60)}"`);
    }
  }

Для этого нужно временно хранить транскрипцию в attachment:
В _downloadMediaIfPresent, в return-объекте добавить приватное поле:
    return {
      type: attachmentType,
      url: mediaUrl,
      mimeType,
      fileName,
      fileSize: buffer.length,
      _transcription: voiceTranscription, // временное поле, не в схеме типа
    } as any;

Важно:
1. Transcription происходит асинхронно — добавить await перед вызовом _downloadMediaIfPresent
   если его ещё нет
2. Если Whisper недоступен — текст остаётся "[Audio]", ошибка не бросается
3. Никакие другие каналы не затрагиваются
4. Если openai не установлен — эта задача пропускается
```

---

## Итоговый чеклист

| # | Задача | Приоритет | Файлы | Опасность для других каналов |
|---|--------|-----------|-------|------------------------------|
| FEAT-01 | Медиа без caption → плейсхолдер, не null | **P0 Критично** | `whatsapp-personal-adapter.ts`, тест | Нет |
| FEAT-02 | Отправка медиа оператором (фото/файл/аудио) | **P0 Критично** | `whatsapp-personal-adapter.ts`, `message.routes.ts` | Нет — только новая ветка |
| FEAT-03 | `/start-conversation` — написать первым | **P1 Важно** | `whatsapp-personal.routes.ts` | Нет |
| FEAT-04 | Скачивание входящих медиа + медиа-прокси | **P1 Важно** | `whatsapp-personal-adapter.ts`, `whatsapp-personal.routes.ts` | Нет |
| FEAT-05 | OCR фотографий (VIN) | **P2 Желательно** | `inbound-message-handler.ts` | Минимальный — только новая WA-ветка |
| FEAT-06 | Транскрипция голосовых (Whisper) | **P2 Опционально** | `whatsapp-personal-adapter.ts` | Нет |

**Ключевые гарантии безопасности для других каналов:**
- В `message.routes.ts` добавляется только новый `if (effectiveChannelType === "whatsapp_personal")` блок, существующие блоки `telegram_personal`, `telegram`, `max_personal` **не изменяются**
- В `inbound-message-handler.ts` Telegram-блок остаётся нетронутым, WA-блок добавляется перед ним с ранним `return att` при отсутствии совпадения
- Медиа-кэш изолирован по `tenantId`, доступ через HTTP защищён проверкой `req.tenantId`
- `sendMediaMessage` — новый метод, не заменяет `sendMessage`

**Оценка времени:**
- FEAT-01: 30 мин (включая тест)
- FEAT-02: 1–2 часа
- FEAT-03: 1 час
- FEAT-04: 2–3 часа
- FEAT-05: 30 мин (зависит от FEAT-04)
- FEAT-06: 1–2 часа (зависит от FEAT-04)

**Итого P0+P1:** ~5–7 часов
