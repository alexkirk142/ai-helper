# Add Feature Flag

## Steps

1. **Read `feature_flags.json`** in the project root — current global flag state
2. **Read `server/services/feature-flags.ts`** — `FeatureFlagService` implementation
3. **Read `shared/schema.ts`** — find `FEATURE_FLAG_NAMES`, `featureFlags` table, and types
4. **Add the flag name** to `FEATURE_FLAG_NAMES` array in `shared/schema.ts`
5. **Add default config** to `DEFAULT_FLAGS` in `server/services/feature-flags.ts`
6. **Add flag entry** to `feature_flags.json` with initial `enabled` value
7. **Add flag check** in relevant code paths using `featureFlagService.isEnabled()`
8. **Ensure graceful degradation** when flag is `false`
9. **Test** with flag `true` and `false`

## Where to register the flag

### 1. Type definition — `shared/schema.ts`

Add to the `FEATURE_FLAG_NAMES` array:

```typescript
export const FEATURE_FLAG_NAMES = [
  "AI_SUGGESTIONS_ENABLED",
  "DECISION_ENGINE_ENABLED",
  // ... existing flags ...
  "MY_NEW_FEATURE_ENABLED",   // <-- add here
] as const;
```

The `FeatureFlagName` type is automatically derived:
```typescript
export type FeatureFlagName = typeof FEATURE_FLAG_NAMES[number];
```

### 2. Default config — `server/services/feature-flags.ts`

Add to `DEFAULT_FLAGS`:

```typescript
const DEFAULT_FLAGS: Record<FeatureFlagName, { description: string; enabled: boolean }> = {
  // ... existing flags ...
  MY_NEW_FEATURE_ENABLED: {
    description: "Enable my new feature",
    enabled: false,
  },
};
```

### 3. Static config — `feature_flags.json`

Add entry:

```json
{
  "global:MY_NEW_FEATURE_ENABLED": { "enabled": false }
}
```

## Usage pattern — checking the flag

```typescript
import { featureFlagService } from "./services/feature-flags";

// In route handler or service (async)
const isEnabled = await featureFlagService.isEnabled("MY_NEW_FEATURE_ENABLED");
if (!isEnabled) {
  return res.status(404).json({ error: "Feature not available" });
}

// With tenant-specific override
const isEnabled = await featureFlagService.isEnabled("MY_NEW_FEATURE_ENABLED", tenantId);

// Synchronous check (for hot paths)
import { isFeatureEnabled } from "./services/feature-flags";
if (!isFeatureEnabled("MY_NEW_FEATURE_ENABLED", tenantId)) {
  return;
}
```

## Flag resolution order

1. **Tenant-specific flag** (`{tenantId}:FLAG_NAME`) — checked first
2. **Global flag** (`global:FLAG_NAME`) — fallback
3. **Default** — `false` if no flag exists

## Admin API for flag management

Flags can be toggled at runtime via admin API:

- `GET /api/admin/feature-flags` — list all flags
- `GET /api/admin/feature-flags/:name` — get single flag
- `POST /api/admin/feature-flags/:name/toggle` — toggle flag (`{ enabled: true/false }`)
- `GET /api/feature-flags/:name/check` — check if enabled

These routes require `requireAuth` + `requirePermission("MANAGE_TENANT_SETTINGS")`.

## Existing flags reference

| Flag | Description | Default |
|------|-------------|---------|
| `AI_SUGGESTIONS_ENABLED` | AI-powered response suggestions | `true` |
| `DECISION_ENGINE_ENABLED` | Advanced decision engine for auto-responses | `false` |
| `AI_AUTOSEND_ENABLED` | Auto-send AI responses without approval | `false` |
| `HUMAN_DELAY_ENABLED` | Human-like delay before sending | `false` |
| `RAG_ENABLED` | RAG for context retrieval | `true` |
| `FEW_SHOT_LEARNING` | Few-shot learning with approved responses | `true` |
| `TELEGRAM_CHANNEL_ENABLED` | Telegram Bot API channel | `false` |
| `TELEGRAM_PERSONAL_CHANNEL_ENABLED` | Telegram MTProto personal channel | `false` |
| `WHATSAPP_CHANNEL_ENABLED` | WhatsApp channel | `false` |
| `WHATSAPP_PERSONAL_CHANNEL_ENABLED` | WhatsApp personal channel | `false` |
| `MAX_CHANNEL_ENABLED` | Max (VK Teams) channel | `false` |
| `MAX_PERSONAL_CHANNEL_ENABLED` | Max personal channel | `false` |
