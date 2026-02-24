# Debug Telegram Issue

## Steps

1. **Read all Telegram-related files** listed below
2. **Check logs** for these error patterns:
   - `FloodWait` / `FLOOD` — rate limited by Telegram
   - `AuthKeyUnregistered` / `SESSION_REVOKED` — session expired
   - `PHONE_NUMBER_INVALID` / `PHONE_NUMBER_BANNED` — phone issues
   - `PHONE_CODE_INVALID` / `PHONE_CODE_EXPIRED` — verification code issues
   - `PASSWORD_HASH_INVALID` — 2FA password wrong
   - `ConnectionError` — network or Telegram DC down
   - `ChatWriteForbidden` — no write permission in chat
   - `RPCError` — generic Telegram RPC failure
3. **Verify session** is valid and not expired — check `telegramSessions` table
4. **Check credentials** — API ID/Hash resolution order:
   - First: database secrets (global scope) via `getSecret({ scope: "global", keyName: "TELEGRAM_API_ID" })`
   - Fallback: environment variables `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`
5. **Verify GramJS client** connection state in `TelegramClientManager`
6. **Check feature flags** — `TELEGRAM_PERSONAL_CHANNEL_ENABLED`, `TELEGRAM_CHANNEL_ENABLED`
7. **Check rate limiting** — the adapter uses exponential backoff for 429 / 5xx errors

## Common issues and solutions

### FloodWait / FLOOD
- **Cause**: Too many requests to Telegram API
- **Fix**: Wait N seconds before retrying. The adapter handles this automatically with exponential backoff
- **Check**: `server/services/telegram-adapter.ts` — `isRetryableError()` and retry logic

### AuthKeyUnregistered / SESSION_REVOKED
- **Cause**: Session string is invalid or revoked
- **Fix**: Re-authenticate the account — delete the session from `telegramSessions` table, reconnect via onboarding
- **Check**: `TelegramClientManager.connectAccount()` — `isUserAuthorized()` check

### PHONE_NUMBER_INVALID
- **Cause**: Wrong phone format
- **Fix**: Use international format with `+` prefix (e.g., `+79001234567`)

### PHONE_CODE_EXPIRED
- **Cause**: Verification code timed out
- **Fix**: Request a new code via `sendCode()`

### ConnectionError
- **Cause**: Network issue or Telegram DC down
- **Fix**: `TelegramClientManager` auto-reconnects after 30 seconds. Check network/proxy settings

### ChatWriteForbidden
- **Cause**: Bot/user doesn't have write permission in the target chat
- **Fix**: Verify the bot is added to the group or the user has not been restricted

### Bot API vs Personal API
- **Bot API** (`TelegramAdapter`): Uses HTTP requests to `api.telegram.org`, token from `TELEGRAM_BOT_TOKEN`
- **Personal API** (`TelegramClientManager` / `TelegramPersonalAdapter`): Uses GramJS MTProto, `TELEGRAM_API_ID` + `TELEGRAM_API_HASH`

## Environment variables

```bash
# Bot API
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_WEBHOOK_SECRET=your_webhook_secret

# Personal API (GramJS MTProto)
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
```

## Files to check

### Core Telegram files
- `server/services/telegram-client-manager.ts` — multi-account GramJS client manager, auto-reconnect, health checks (60s), heartbeat (15s)
- `server/services/telegram-adapter.ts` — Bot API adapter, HTTP requests, retry logic
- `server/services/telegram-personal-adapter.ts` — personal account adapter (GramJS), phone auth, QR auth, 2FA
- `server/routes/telegram-webhook.ts` — webhook handler for incoming Bot API updates

### Supporting files
- `server/services/channel-adapter.ts` — channel adapter interface, routes messages to correct adapter
- `server/services/inbound-message-handler.ts` — processes incoming messages from all channels
- `server/services/feature-flags.ts` — feature flag checks for Telegram channels
- `server/middleware/webhook-security.ts` — `telegramWebhookSecurity` middleware
- `shared/schema.ts` — `telegramSessions` table, `channels` table

### Database tables
- `telegramSessions` — stores MTProto session strings, account status, phone numbers
- `channels` — stores channel config including Telegram bot tokens and webhook URLs

### Tests
- `server/__tests__/telegram-adapter.test.ts`

## Key functions to trace

- `TelegramClientManager.initialize()` — startup, loads sessions, connects accounts
- `TelegramClientManager.connectAccount()` — connects a single account with GramJS
- `TelegramClientManager.scheduleReconnect()` — auto-reconnect on failure (30s delay)
- `TelegramAdapter.sendMessage()` — sends via Bot API
- `TelegramPersonalAdapter.sendMessage()` — sends via GramJS
- `telegramWebhookHandler()` — handles incoming webhook updates
