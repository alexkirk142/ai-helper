/**
 * Shared ioredis client for rate limiting.
 *
 * Designed for resilience: if REDIS_URL is absent or Redis is unreachable the
 * `isAvailable()` helper returns false and callers silently fall back to their
 * in-memory implementations.  The client auto-reconnects, so a transient Redis
 * outage will restore Redis-backed limiting without a server restart.
 */
import Redis from "ioredis";

let client: Redis | null = null;
let available = false;
let warnedUnavailable = false;

function parseRedisUrl(): string | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    new URL(url);
    return url;
  } catch {
    console.error("[Redis] REDIS_URL is not a valid URL — rate-limiter will use in-memory fallback");
    return null;
  }
}

export function getRateLimiterRedis(): Redis | null {
  if (client) return available ? client : null;

  const url = parseRedisUrl();
  if (!url) return null;

  client = new Redis(url, {
    enableOfflineQueue: true,  // allow queuing commands before connection is ready (prevents startup crash with rate-limit-redis RedisStore)
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });

  client.on("connect", () => {
    available = true;
    warnedUnavailable = false;
    console.log("[Redis] Rate-limiter connected");
  });

  client.on("error", (err: Error) => {
    if (available || !warnedUnavailable) {
      console.warn("[Redis] Rate-limiter error — falling back to in-memory:", err.message);
      warnedUnavailable = true;
    }
    available = false;
  });

  client.on("reconnecting", () => {
    console.log("[Redis] Rate-limiter reconnecting…");
  });

  return null;
}

/** True when the client has an active Redis connection. */
export function isRateLimiterRedisAvailable(): boolean {
  getRateLimiterRedis();
  return available;
}

/** Returns the raw client for use with rate-limit-redis's `sendCommand`. */
export function getRateLimiterRedisClient(): Redis | null {
  getRateLimiterRedis();
  return available ? client : null;
}

/**
 * Returns the raw ioredis instance regardless of current connection state.
 * Use this when you need to pass the client to a third-party store (e.g.
 * rate-limit-redis) that manages its own error handling.  Prefer
 * `getRateLimiterRedisClient()` when you need a connected client.
 */
export function getRateLimiterRedisInstance(): Redis | null {
  getRateLimiterRedis();
  return client;
}

export async function closeRateLimiterRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => client?.disconnect());
    client = null;
    available = false;
  }
}
