# WhatsApp Personal — Промпты для исправления аудитных проблем

> Аудит проведён: май 2026  
> Файлы затронуты: `server/services/whatsapp-personal-adapter.ts`, `server/routes/channels/whatsapp-personal.routes.ts`, `client/src/pages/settings.tsx`  
> **Порядок выполнения строго последовательный** — каждый фикс опирается на результат предыдущего.  
> Green API / Max Personal (`max-green-api-adapter.ts`, `max-personal-adapter.ts`) — **не трогать**.

---

## FIX-01 — Устранение дублирования обработчиков событий (HIGH)

**Проблема:** Методы `startAuth` и `startAuthWithPhone` содержат ~180 строк идентичного кода для обработки `messages.upsert` и `messaging-history.set`. Любой баг нужно исправлять в двух местах.

**Промпт:**

```
В файле server/services/whatsapp-personal-adapter.ts есть критическое дублирование кода.

Методы startAuth (строки ~373–463) и startAuthWithPhone (строки ~594–684) содержат абсолютно одинаковые обработчики событий Baileys:
- socket.ev.on("messages.upsert", ...)
- socket.ev.on("messaging-history.set", ...)

Задача: вынести эти два обработчика в приватный статический метод:

  private static _attachMessageHandlers(
    socket: WASocket,
    tenantId: string
  ): void

Метод должен содержать оба обработчика событий из startAuth (они являются эталонными).
Затем в startAuth и startAuthWithPhone заменить дублирующийся код одним вызовом:
  WhatsAppPersonalAdapter._attachMessageHandlers(socket, tenantId);

Вызов размещается сразу после socket.ev.on("creds.update", saveCreds);
и перед await new Promise(resolve => setTimeout(...)).

Убедись что:
1. Логика не изменилась — только рефакторинг
2. Переменная session остаётся доступной в connection.update обработчике (она в замыкании, не в _attachMessageHandlers)
3. TypeScript типы не нарушены
4. Ни один файл за пределами whatsapp-personal-adapter.ts не изменяется
```

---

## FIX-02 — Дедупликация history sync (исключить повторную обработку старых сообщений) (HIGH)

**Проблема:** При каждом reconnect срабатывает `messaging-history.set`, который эмитит топ-3 старых сообщения в messageBus. Это повторно запускает AI-обработку на уже обработанных сообщениях.

**Зависимость:** Выполнять после FIX-01 (работаем с уже вынесенным `_attachMessageHandlers`).

**Промпт:**

```
В файле server/services/whatsapp-personal-adapter.ts нужно предотвратить повторную обработку
сообщений из history sync при каждом переподключении.

Проблема: метод _attachMessageHandlers (после FIX-01) содержит обработчик
socket.ev.on("messaging-history.set", ...) который при каждом reconnect берёт топ-3
последних чата и вызывает messageBus.emitIncomingMessage() на старых сообщениях.
Это приводит к повторному запуску AI на уже обработанных сообщениях.

Решение:
1. Добавить в начало файла (на уровне модуля, рядом с authSessions) новую Map:
   const processedHistoryIds = new Map<string, Set<string>>();
   // ключ: tenantId, значение: Set<externalMessageId>

2. В обработчике messaging-history.set внутри _attachMessageHandlers:
   - Перед вызовом messageBus.emitIncomingMessage() проверить:
     const seen = processedHistoryIds.get(tenantId) ?? new Set<string>();
     if (seen.has(parsed.externalMessageId)) {
       console.log(`[WhatsAppPersonal] Skipping duplicate history message ${parsed.externalMessageId}`);
       continue; // или return — в зависимости от структуры
     }
     seen.add(parsed.externalMessageId);
     processedHistoryIds.set(tenantId, seen);
   - Только после этой проверки вызывать messageBus.emitIncomingMessage()

3. В методе logout() добавить очистку:
   processedHistoryIds.delete(tenantId);
   (после authSessions.delete(tenantId))

4. Ограничить размер Set: если seen.size > 500, очистить:
   if (seen.size > 500) seen.clear();
   (добавить после seen.add(...))

Ни один другой файл не изменяется.
```

---

## FIX-03 — Мьютекс для предотвращения гонки при параллельных startAuth (MEDIUM)

**Проблема:** Два одновременных вызова `startAuth` для одного tenantId создают два сокета. Второй перезапишет `session.socket`, но первый продолжит работать.

**Зависимость:** Выполнять после FIX-01 и FIX-02.

**Промпт:**

```
В файле server/services/whatsapp-personal-adapter.ts нужно предотвратить race condition
при параллельных вызовах startAuth и startAuthWithPhone для одного tenantId.

Проблема: если два HTTP-запроса одновременно вызовут startAuth("tenant123"),
оба создадут по WASocket, второй перезапишет session.socket в authSessions,
но первый сокет продолжит работать в фоне и слать события.

Решение — добавить простой Map-мьютекс на уровне модуля:

1. Добавить рядом с authSessions:
   const authInProgress = new Set<string>();

2. В начало метода startAuth (сразу после объявления try{):
   if (authInProgress.has(tenantId) && !isAutoReconnect) {
     console.log(`[WhatsAppPersonal] Auth already in progress for tenant ${tenantId}, skipping`);
     return { success: false, error: "Authentication already in progress" };
   }
   authInProgress.add(tenantId);

3. В конце метода startAuth — в блоке finally (создать если нет):
   authInProgress.delete(tenantId);
   (Убедись что finally выполняется при любом exit — success или error)

4. Аналогично для startAuthWithPhone: те же шаги 2 и 3.
   В startAuthWithPhone isAutoReconnect нет, поэтому проверка проще:
   if (authInProgress.has(tenantId)) {
     return { success: false, error: "Authentication already in progress" };
   }
   authInProgress.add(tenantId);

5. Исключение: для isAutoReconnect=true мьютекс не применяем
   (автореконнект должен работать без ограничений).

Структура try/finally в обоих методах должна выглядеть так:
   authInProgress.add(tenantId);
   try {
     // ... существующая логика ...
   } catch (error: any) {
     // ... существующая обработка ...
   } finally {
     authInProgress.delete(tenantId);
   }

Ни один другой файл не изменяется.
```

---

## FIX-04 — Безопасность маршрутов: добавить fraud check и requireActiveTenant на QR auth (MEDIUM)

**Проблема:** Роут `POST /api/whatsapp-personal/start-auth` (QR-метод) не проходит через `fraudDetectionService` и `requireActiveTenant`, в отличие от `start-auth-phone`.

**Зависимость:** Независим от FIX-01–03, но логично делать в этом порядке.

**Промпт:**

```
В файле server/routes/channels/whatsapp-personal.routes.ts нужно устранить несоответствие
в middleware между двумя роутами аутентификации.

Текущая ситуация:
- POST /api/whatsapp-personal/start-auth-phone использует: requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, requireTenant + fraudDetectionService внутри handler
- POST /api/whatsapp-personal/start-auth использует: requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireTenant — без requireActiveTenant и без fraudDetectionService

Задача:
1. Добавить requireActiveTenant в middleware-цепочку start-auth:
   Было:   router.post("/api/whatsapp-personal/start-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireTenant,
   Стало:  router.post("/api/whatsapp-personal/start-auth", requireAuth, requirePermission("MANAGE_CHANNELS"), requireActiveSubscription, requireActiveTenant, requireTenant,

2. Добавить fraud check внутри handler start-auth (по аналогии с start-auth-phone):
   Сразу после получения tenantId (const tenantId = req.tenantId!) добавить:

   const fraudCheck = await fraudDetectionService.validateChannelConnection(
     tenantId,
     "whatsapp_personal",
     { whatsapp_personal: { method: "qr" } }
   );

   if (!fraudCheck.allowed) {
     return res.status(403).json({
       error: fraudCheck.message,
       code: "FRAUD_DETECTED"
     });
   }

3. Убедиться что импорт fraudDetectionService уже есть в начале файла
   (он там уже присутствует — используется в start-auth-phone).

Никакие другие файлы не изменяются.
```

---

## FIX-05 — Исправить restoreSession: параллельный запуск без blocking wait (MEDIUM)

**Проблема:** `restoreSession` блокирует запуск сервера на 5 секунд на каждый тенант (sequential busy-wait цикл). При N тенантах — N×5 сек.

**Промпт:**

```
В файле server/services/whatsapp-personal-adapter.ts метод restoreSession
блокирует запуск сервера: он делает busy-wait цикл из 10 итераций × 500мс = 5 секунд.
Вызывается из index.ts последовательно для каждого тенанта.

Задача: переработать restoreSession чтобы он не блокировал дольше 1 секунды.

Новая логика restoreSession:
1. Проверить наличие sessionDir (fs.existsSync) — без изменений
2. Проверить existingSession?.status === "connected" — без изменений, быстрый return
3. Вместо запуска startAuth с ожиданием — запустить startAuth fire-and-forget:
   WhatsAppPersonalAdapter.startAuth(tenantId).catch(err => {
     console.error(`[WhatsAppPersonal] Restore auth error:`, err);
   });
4. Подождать максимум 1 секунду (2 попытки × 500мс) вместо 5 секунд (10 × 500мс):
   for (let i = 0; i < 2; i++) {
     await new Promise(resolve => setTimeout(resolve, 500));
     const session = authSessions.get(tenantId);
     if (session?.status === "connected") {
       return { success: true, connected: true, user: session.user };
     }
   }
5. Если за 1 секунду не подключился — возвращать success: true, connected: false
   с пояснением что сессия восстанавливается в фоне:
   return {
     success: true,
     connected: false,
     error: "Session is restoring in background"
   };

Убрать все промежуточные проверки session.user && session.reconnecting
и session.user && session.socket внутри цикла — они порождали ложное connected: true.

В server/index.ts вызовы restoreSession уже идут в цикле for...of.
Это нормально — теперь каждый будет ждать не более 1 сек, итого для N тенантов = N×1 сек вместо N×5.
Если N > 3, рекомендуется в index.ts заменить for...of на Promise.all(),
но это изменение в index.ts, сделай его только если он упомянут в задаче.

Ни один другой файл кроме whatsapp-personal-adapter.ts не изменяется.
```

---

## FIX-06 — Исправить isConnected: убрать ложный статус "подключён" (LOW)

**Проблема:** `isConnected` возвращает `true` когда есть `session.user && session.socket`, даже если статус `"disconnected"`. UI показывает зелёный статус для отключённого аккаунта.

**Промпт:**

```
В файле server/services/whatsapp-personal-adapter.ts в статическом методе isConnected
есть логическая ошибка — третья ветка возвращает true при наличии socket объекта,
даже если socket уже закрыт:

  if (session.user && session.socket) return true;  // ← НЕПРАВИЛЬНО

Задача: исправить метод isConnected:

static isConnected(tenantId: string): boolean {
  const session = authSessions.get(tenantId);
  if (!session) return false;

  // Только явно подключённый статус
  if (session.status === "connected") return true;

  // Временный разрыв во время автопереподключения — считаем подключённым
  // только если reconnecting активен (не просто есть socket)
  if (session.user && session.reconnecting === true) return true;

  return false;
}

Убрать строку: if (session.user && session.socket) return true;

Аналогично проверить метод hasSession — он выглядит корректно (проверяет только user),
трогать не нужно.

Ни один другой файл не изменяется.
```

---

## FIX-07 — Frontend: исправить текст про интервал QR-кода и добавить таймер для pairing code (MEDIUM)

**Проблема 1:** UI написано «Код обновляется автоматически каждые 20 сек» — неправда. Baileys меняет QR по своему расписанию (может быть 5–30 сек), фронтенд подтягивает его каждые 2 сек через polling.

**Проблема 2:** Pairing code действителен ~30 секунд, но в UI нет никакого таймера или предупреждения об истечении.

**Промпт:**

```
В файле client/src/pages/settings.tsx в компоненте WhatsAppPersonalCard нужно исправить
два UX-недочёта, связанных с временными показателями.

--- Часть 1: Текст под QR-кодом ---

Найти строку (примерно строка 2425):
  <p className="text-xs text-muted-foreground">
    Код обновляется автоматически каждые 20 сек
  </p>

Заменить на:
  <p className="text-xs text-muted-foreground">
    Код обновляется автоматически. Страница обновляет статус каждые 2 сек
  </p>

--- Часть 2: Таймер истечения pairing code ---

В блоке отображения pairing code (примерно строка 2442) нужно добавить таймер обратного
отсчёта и кнопку "Запросить новый код".

1. Добавить в начало компонента WhatsAppPersonalCard новый state:
   const [pairingCodeSecondsLeft, setPairingCodeSecondsLeft] = useState<number | null>(null);
   const pairingTimerRef = useRef<NodeJS.Timeout | null>(null);

2. Добавить вспомогательные функции рядом с существующими (после stopPolling):

   const stopPairingTimer = () => {
     if (pairingTimerRef.current) {
       clearInterval(pairingTimerRef.current);
       pairingTimerRef.current = null;
     }
     setPairingCodeSecondsLeft(null);
   };

   const startPairingTimer = () => {
     stopPairingTimer();
     setPairingCodeSecondsLeft(28);
     pairingTimerRef.current = setInterval(() => {
       setPairingCodeSecondsLeft(prev => {
         if (prev === null || prev <= 1) {
           stopPairingTimer();
           return 0;
         }
         return prev - 1;
       });
     }, 1000);
   };

3. В функции startAuthWithPhone, после строки setPairingCode(result.pairingCode):
   startPairingTimer();

4. В функции cancelAuth добавить:
   stopPairingTimer();

5. В useEffect cleanup добавить:
   return () => {
     stopPolling();
     stopPairingTimer();
   };

6. В блоке отображения pairingCode (где показывается код XXXX-XXXX) добавить
   под блоком с кодом:

   {pairingCodeSecondsLeft !== null && (
     <div className={`text-sm ${pairingCodeSecondsLeft <= 10 ? "text-red-500" : "text-muted-foreground"}`}>
       {pairingCodeSecondsLeft > 0
         ? `Код действителен ещё ${pairingCodeSecondsLeft} сек`
         : "Код истёк — запросите новый"}
     </div>
   )}
   {pairingCodeSecondsLeft === 0 && (
     <Button
       variant="outline"
       size="sm"
       onClick={startAuthWithPhone}
       disabled={isLoading}
     >
       Запросить новый код
     </Button>
   )}

Ни один другой компонент/файл не изменяется.
```

---

## FIX-08 — Frontend: cancelAuth должен закрывать сессию на сервере (LOW)

**Проблема:** Нажатие "Отмена" только сбрасывает UI-состояние. Сервер продолжает держать активный Baileys socket в состоянии `qr_ready`. При следующем открытии настроек сервер вернёт старый QR.

**Промпт:**

```
В файле client/src/pages/settings.tsx в компоненте WhatsAppPersonalCard
функция cancelAuth только сбрасывает UI, но не уведомляет сервер.

Задача в двух частях:

--- Часть 1: Frontend ---

Изменить функцию cancelAuth (примерно строка 2244):

Было:
  const cancelAuth = () => {
    stopPolling();
    setAuthStatus("disconnected");
    setQrDataUrl(null);
    setPairingCode(null);
    setAuthMethod(null);
  };

Стало:
  const cancelAuth = async () => {
    stopPolling();
    try {
      await apiRequest("POST", "/api/whatsapp-personal/cancel-auth", {});
    } catch {
      // игнорируем ошибку — UI сбрасывается в любом случае
    }
    setAuthStatus("disconnected");
    setQrDataUrl(null);
    setPairingCode(null);
    setAuthMethod(null);
  };

Кнопку "Отмена" сделать disabled во время async выполнения (опционально,
если добавить локальный isCancelling state, но это не обязательно).

--- Часть 2: Backend ---

В файле server/routes/channels/whatsapp-personal.routes.ts добавить новый роут
после существующего роута check-auth:

router.post(
  "/api/whatsapp-personal/cancel-auth",
  requireAuth,
  requirePermission("MANAGE_CHANNELS"),
  requireTenant,
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantId!;
      const { WhatsAppPersonalAdapter: WAP } = await import(
        "../../services/whatsapp-personal-adapter"
      );
      // Используем logout — он корректно закрывает socket и удаляет сессию
      // только если статус НЕ connected (иначе это был бы нежелательный логаут)
      const authCheck = await WAP.checkAuth(tenantId);
      if (
        authCheck.status === "qr_ready" ||
        authCheck.status === "pairing_code_ready" ||
        authCheck.status === "connecting"
      ) {
        await WAP.logout(tenantId);
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error cancelling WhatsApp Personal auth:", error);
      res.status(500).json({ error: error.message || "Failed to cancel auth" });
    }
  }
);

Никакие другие файлы не изменяются.
```

---

## FIX-09 — Написать unit-тесты для WhatsAppPersonalAdapter (LOW)

**Проблема:** Полное отсутствие тестов. Файл `whatsapp-adapter.test.ts` покрывает только Business API adapter.

**Зависимость:** Выполнять последним — после всех предыдущих фиксов, чтобы тестировать уже исправленный код.

**Промпт:**

```
Создать файл server/services/__tests__/whatsapp-personal-adapter.test.ts
с unit-тестами для WhatsAppPersonalAdapter.

Тестировать только методы которые не требуют живого Baileys-соединения:
- parseIncomingMessage
- checkAuth (через мок authSessions)
- isConnected (через мок authSessions)
- hasSession (через мок authSessions)

Использовать vitest (уже установлен в проекте).

Структура файла:

import { describe, it, expect, beforeEach, vi } from "vitest";
import { WhatsAppPersonalAdapter } from "../whatsapp-personal-adapter";

describe("WhatsAppPersonalAdapter", () => {

  describe("parseIncomingMessage", () => {
    it("should parse conversation text message", () => { ... });
    it("should parse extendedTextMessage", () => { ... });
    it("should return null for message without text", () => { ... });
    it("should return null for fromMe message", () => { ... });  // примечание: fromMe фильтруется в messages.upsert, но parseIncomingMessage не фильтрует
    it("should parse image caption", () => { ... });
    it("should extract phone from jid", () => { ... });
    it("should detect group messages (isGroup)", () => { ... });
    it("should handle invalid payload", () => { ... });
  });

  describe("isConnected", () => {
    it("should return false when no session exists", () => { ... });
    it("should return true when status is connected", () => { ... });
    it("should return true when reconnecting with user info", () => { ... });
    it("should return false when status is disconnected even with socket", () => { ... });
    // Последний тест проверяет FIX-06
  });

  describe("checkAuth", () => {
    it("should return disconnected when no session", async () => { ... });
    it("should return session status and user info", async () => { ... });
  });

});

Для тестов isConnected и checkAuth нужно получить доступ к модуль-level Map authSessions.
Так как authSessions не экспортируется — используй динамический импорт или добавь
экспорт только для тестов:

В whatsapp-personal-adapter.ts добавить в конец файла (не в класс):
  export const _testOnly_authSessions = authSessions;  // только для тестов

И в тестовом файле:
  import { WhatsAppPersonalAdapter, _testOnly_authSessions } from "../whatsapp-personal-adapter";
  
  beforeEach(() => {
    _testOnly_authSessions.clear();
  });

Все тесты должны проходить командой: npx vitest run server/services/__tests__/whatsapp-personal-adapter.test.ts
```

---

## Итоговый чеклист

| # | Фикс | Severity | Файлы | Затрагивает Green API |
|---|------|----------|-------|-----------------------|
| FIX-01 | Вынести обработчики в `_attachMessageHandlers` | HIGH | `whatsapp-personal-adapter.ts` | Нет |
| FIX-02 | Дедупликация history sync через `processedHistoryIds` | HIGH | `whatsapp-personal-adapter.ts` | Нет |
| FIX-03 | Мьютекс `authInProgress` для startAuth | MEDIUM | `whatsapp-personal-adapter.ts` | Нет |
| FIX-04 | fraud check + requireActiveTenant на QR-роут | MEDIUM | `whatsapp-personal.routes.ts` | Нет |
| FIX-05 | restoreSession: max 1 сек wait вместо 5 сек | MEDIUM | `whatsapp-personal-adapter.ts` | Нет |
| FIX-06 | isConnected: убрать ложный статус через socket | LOW | `whatsapp-personal-adapter.ts` | Нет |
| FIX-07 | UI: текст QR + таймер pairing code | MEDIUM | `settings.tsx` | Нет |
| FIX-08 | cancelAuth уведомляет сервер + новый роут | LOW | `settings.tsx`, `whatsapp-personal.routes.ts` | Нет |
| FIX-09 | Unit-тесты для parseIncomingMessage, isConnected | LOW | новый test файл | Нет |

**Общее время:** ~4–6 часов при последовательном выполнении.
