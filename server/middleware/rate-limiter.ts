import type { Request, Response, NextFunction } from "express";
import { auditLog } from "../services/audit-log";
import { getRateLimiterRedisClient } from "../redis-client";
import type Redis from "ioredis";

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      userId?: string;
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback types & stores
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimits: Map<string, RateLimitEntry> = new Map();
const tenantLimits: Map<string, RateLimitEntry> = new Map();

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RateLimitCategory =
  | "public"
  | "webhook"
  | "ai"
  | "onboarding"
  | "conversation"
  | "default";

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  category?: RateLimitCategory;
  enableAudit?: boolean;
}

interface TenantRateLimitConfig {
  maxConversationsPerMin: number;
  maxAiCallsPerMin: number;
}

// ---------------------------------------------------------------------------
// Tenant config (always in-memory — it's config, not counters)
// ---------------------------------------------------------------------------

const DEFAULT_TENANT_LIMITS: TenantRateLimitConfig = {
  maxConversationsPerMin: 50,
  maxAiCallsPerMin: 30,
};

const tenantConfigs: Map<string, TenantRateLimitConfig> = new Map();

export function setTenantRateLimits(
  tenantId: string,
  config: Partial<TenantRateLimitConfig>,
): void {
  const existing = tenantConfigs.get(tenantId) || { ...DEFAULT_TENANT_LIMITS };
  tenantConfigs.set(tenantId, { ...existing, ...config });
}

export function getTenantRateLimits(tenantId: string): TenantRateLimitConfig {
  return tenantConfigs.get(tenantId) || { ...DEFAULT_TENANT_LIMITS };
}

// ---------------------------------------------------------------------------
// Category defaults
// ---------------------------------------------------------------------------

const isDev = process.env.NODE_ENV !== "production";

const RATE_LIMIT_DEFAULTS: Record<
  RateLimitCategory,
  Omit<RateLimitOptions, "keyGenerator">
> = {
  public: { windowMs: 60_000, maxRequests: isDev ? 500 : 100 },
  webhook: { windowMs: 60_000, maxRequests: 500 },
  ai: { windowMs: 60_000, maxRequests: isDev ? 100 : 20 },
  onboarding: { windowMs: 60_000, maxRequests: isDev ? 100 : 30 },
  conversation: { windowMs: 60_000, maxRequests: isDev ? 300 : 100 },
  default: { windowMs: 60_000, maxRequests: isDev ? 500 : 100 },
};

const defaultOptions: RateLimitOptions = {
  windowMs: 60_000,
  maxRequests: 100,
  category: "default",
  enableAudit: true,
};

// ---------------------------------------------------------------------------
// Redis helpers
// ---------------------------------------------------------------------------

/**
 * Atomically increment a counter key and set its TTL on the first increment.
 * Returns { count, resetAt } or null if Redis is unavailable.
 *
 * Lua script:
 *   KEYS[1] = key
 *   ARGV[1] = windowMs (milliseconds)
 * Returns: {count, pttl}
 */
const INCR_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local pttl = redis.call('PTTL', KEYS[1])
return {count, pttl}
`;

async function redisIncr(
  redis: Redis,
  key: string,
  windowMs: number,
): Promise<{ count: number; resetAt: number } | null> {
  try {
    const result = (await redis.eval(INCR_SCRIPT, 1, key, windowMs)) as [
      number,
      number,
    ];
    const pttl = result[1] > 0 ? result[1] : windowMs;
    return { count: result[0], resetAt: Date.now() + pttl };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// In-memory helpers (fallback)
// ---------------------------------------------------------------------------

function memIncr(
  store: Map<string, RateLimitEntry>,
  key: string,
  windowMs: number,
): { count: number; resetAt: number } {
  const now = Date.now();
  let entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }
  entry.count++;
  return { count: entry.count, resetAt: entry.resetAt };
}

// ---------------------------------------------------------------------------
// createRateLimiter
// ---------------------------------------------------------------------------

export function createRateLimiter(options: Partial<RateLimitOptions> = {}) {
  const category = options.category || "default";
  const categoryDefaults = RATE_LIMIT_DEFAULTS[category];
  const opts: RateLimitOptions = {
    ...defaultOptions,
    ...categoryDefaults,
    ...options,
    category,
  };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const baseKey = opts.keyGenerator?.(req) || req.ip || "unknown";
    const key = `rl:${category}:${baseKey}`;
    const now = Date.now();

    let count: number;
    let resetAt: number;

    const redis = getRateLimiterRedisClient();
    if (redis) {
      const result = await redisIncr(redis, key, opts.windowMs);
      if (result) {
        ({ count, resetAt } = result);
      } else {
        // Redis eval failed mid-flight — fall through to in-memory
        ({ count, resetAt } = memIncr(rateLimits, key, opts.windowMs));
      }
    } else {
      ({ count, resetAt } = memIncr(rateLimits, key, opts.windowMs));
    }

    const remaining = Math.max(0, opts.maxRequests - count);
    const retryAfterSec = Math.ceil((resetAt - now) / 1000);

    res.setHeader("X-RateLimit-Limit", opts.maxRequests);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));
    res.setHeader("X-RateLimit-Category", category);

    if (count > opts.maxRequests) {
      res.setHeader("Retry-After", retryAfterSec);

      if (opts.enableAudit) {
        const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
        await auditLog.log(
          "rate_limit_exceeded",
          "rate_limit",
          category,
          "system",
          "system",
          {
            category,
            clientIp,
            path: req.path,
            method: req.method,
            limit: opts.maxRequests,
            count,
            retryAfter: retryAfterSec,
          },
        );
      }

      res.status(429).json({
        error: "Too many requests",
        retryAfter: retryAfterSec,
        category,
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// createTenantRateLimiter
// ---------------------------------------------------------------------------

export function createTenantRateLimiter(
  limitType: "conversation" | "ai",
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const tenantId = req.tenantId;
    if (!tenantId) {
      next();
      return;
    }

    const config = getTenantRateLimits(tenantId);
    const maxRequests =
      limitType === "conversation"
        ? config.maxConversationsPerMin
        : config.maxAiCallsPerMin;

    const key = `rl:tenant:${tenantId}:${limitType}`;
    const windowMs = 60_000;
    const now = Date.now();

    let count: number;
    let resetAt: number;

    const redis = getRateLimiterRedisClient();
    if (redis) {
      const result = await redisIncr(redis, key, windowMs);
      if (result) {
        ({ count, resetAt } = result);
      } else {
        ({ count, resetAt } = memIncr(tenantLimits, key, windowMs));
      }
    } else {
      ({ count, resetAt } = memIncr(tenantLimits, key, windowMs));
    }

    const remaining = Math.max(0, maxRequests - count);
    const retryAfterSec = Math.ceil((resetAt - now) / 1000);

    res.setHeader("X-Tenant-RateLimit-Limit", maxRequests);
    res.setHeader("X-Tenant-RateLimit-Remaining", remaining);
    res.setHeader("X-Tenant-RateLimit-Reset", Math.ceil(resetAt / 1000));

    if (count > maxRequests) {
      res.setHeader("Retry-After", retryAfterSec);

      const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
      await auditLog.log(
        "rate_limit_exceeded",
        "tenant_rate_limit",
        tenantId,
        req.userId || "system",
        req.userId ? "user" : "system",
        {
          tenantId,
          limitType,
          clientIp,
          path: req.path,
          method: req.method,
          limit: maxRequests,
          count,
          retryAfter: retryAfterSec,
        },
      );

      res.status(429).json({
        error: "Tenant rate limit exceeded",
        limitType,
        retryAfter: retryAfterSec,
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Pre-built limiter instances (same thresholds as before)
// ---------------------------------------------------------------------------

export const apiRateLimiter = createRateLimiter({ category: "public" });
export const aiRateLimiter = createRateLimiter({ category: "ai" });
export const webhookRateLimiter = createRateLimiter({ category: "webhook" });
export const onboardingRateLimiter = createRateLimiter({ category: "onboarding" });
export const conversationRateLimiter = createRateLimiter({ category: "conversation" });

export const tenantConversationLimiter = createTenantRateLimiter("conversation");
export const tenantAiLimiter = createTenantRateLimiter("ai");

// ---------------------------------------------------------------------------
// Utility helpers (kept for tests / health endpoints)
// ---------------------------------------------------------------------------

/** Clears the in-memory fallback stores (used in tests). */
export function clearRateLimits(): void {
  rateLimits.clear();
  tenantLimits.clear();
}

/** Returns the number of active entries in the in-memory fallback stores. */
export function getRateLimitStats(): { global: number; tenant: number } {
  return {
    global: rateLimits.size,
    tenant: tenantLimits.size,
  };
}

// Periodic cleanup for the in-memory fallback store.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Array.from(rateLimits.entries())) {
    if (now >= entry.resetAt) rateLimits.delete(key);
  }
  for (const [key, entry] of Array.from(tenantLimits.entries())) {
    if (now >= entry.resetAt) tenantLimits.delete(key);
  }
}, 60_000);
