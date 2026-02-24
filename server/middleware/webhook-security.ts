import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { auditLog } from "../services/audit-log";

export interface WebhookVerifyResult {
  valid: boolean;
  error?: string;
}

export interface WebhookSecurityConfig {
  channel: "telegram" | "whatsapp" | "max";
  timestampTolerance?: number;
  requireSignature?: boolean;
}

const DEFAULT_TIMESTAMP_TOLERANCE = 300;

export function computeHmacSha256(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function verifyHmacSignature(
  expectedSignature: string,
  computedSignature: string
): boolean {
  const expectedBuffer = Buffer.from(expectedSignature);
  const computedBuffer = Buffer.from(computedSignature);

  if (expectedBuffer.length !== computedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, computedBuffer);
}

export function verifyTimestamp(
  timestamp: number,
  toleranceSeconds: number = DEFAULT_TIMESTAMP_TOLERANCE
): WebhookVerifyResult {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - timestamp);

  if (diff > toleranceSeconds) {
    return {
      valid: false,
      error: `Timestamp outside tolerance: ${diff}s > ${toleranceSeconds}s`,
    };
  }

  return { valid: true };
}

export function extractTimestampFromHeader(
  headers: Record<string, string>,
  headerName: string
): number | null {
  const value = headers[headerName] || headers[headerName.toLowerCase()];
  if (!value) return null;

  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

function isProductionLike(): boolean {
  return process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging";
}

export function verifyTelegramWebhook(
  headers: Record<string, string>,
  body: unknown,
  secret?: string,
  config?: { timestampTolerance?: number }
): WebhookVerifyResult {
  if (!secret) {
    if (isProductionLike()) {
      return { valid: false, error: "Webhook secret not configured" };
    }
    return { valid: true };
  }

  const receivedToken =
    headers["x-telegram-bot-api-secret-token"] ||
    headers["X-Telegram-Bot-Api-Secret-Token"];

  if (!receivedToken) {
    return { valid: false, error: "Missing secret header" };
  }

  if (receivedToken !== secret) {
    return { valid: false, error: "Invalid secret" };
  }

  const timestamp = extractTimestampFromHeader(headers, "x-telegram-timestamp");
  if (timestamp !== null) {
    const timestampResult = verifyTimestamp(
      timestamp,
      config?.timestampTolerance ?? DEFAULT_TIMESTAMP_TOLERANCE
    );
    if (!timestampResult.valid) {
      return timestampResult;
    }
  }

  return { valid: true };
}

export function verifyWhatsAppWebhook(
  headers: Record<string, string>,
  body: unknown,
  secret?: string,
  config?: { timestampTolerance?: number }
): WebhookVerifyResult {
  const signature = headers["x-hub-signature-256"];

  if (!signature) {
    return { valid: false, error: "Missing X-Hub-Signature-256 header" };
  }

  if (!secret) {
    if (isProductionLike()) {
      return { valid: false, error: "Webhook secret not configured" };
    }
    return { valid: true };
  }

  const bodyString = typeof body === "string" ? body : JSON.stringify(body);
  const expectedSignature = "sha256=" + computeHmacSha256(bodyString, secret);

  if (!verifyHmacSignature(signature, expectedSignature)) {
    return { valid: false, error: "Invalid signature" };
  }

  const timestamp = extractTimestampFromHeader(headers, "x-hub-timestamp");
  if (timestamp !== null) {
    const timestampResult = verifyTimestamp(
      timestamp,
      config?.timestampTolerance ?? DEFAULT_TIMESTAMP_TOLERANCE
    );
    if (!timestampResult.valid) {
      return timestampResult;
    }
  }

  return { valid: true };
}

export function verifyMaxWebhook(
  headers: Record<string, string>,
  body: unknown,
  secret?: string,
  config?: { timestampTolerance?: number }
): WebhookVerifyResult {
  if (!secret) {
    if (isProductionLike()) {
      return { valid: false, error: "Webhook secret not configured" };
    }
    return { valid: true };
  }

  const receivedSecret =
    headers["x-max-bot-api-secret"] ||
    headers["X-Max-Bot-Api-Secret"] ||
    headers["X-MAX-BOT-API-SECRET"];

  if (!receivedSecret) {
    return { valid: false, error: "Missing secret header" };
  }

  const hmacHeader =
    headers["x-max-signature"] ||
    headers["X-Max-Signature"];

  if (hmacHeader) {
    const bodyString = typeof body === "string" ? body : JSON.stringify(body);
    const computedSignature = computeHmacSha256(bodyString, secret);

    if (!verifyHmacSignature(hmacHeader, computedSignature)) {
      return { valid: false, error: "Invalid HMAC signature" };
    }
  } else {
    if (receivedSecret !== secret) {
      return { valid: false, error: "Invalid secret" };
    }
  }

  const timestamp = extractTimestampFromHeader(headers, "x-max-timestamp");
  if (timestamp !== null) {
    const timestampResult = verifyTimestamp(
      timestamp,
      config?.timestampTolerance ?? DEFAULT_TIMESTAMP_TOLERANCE
    );
    if (!timestampResult.valid) {
      return timestampResult;
    }
  }

  return { valid: true };
}

export function createWebhookSecurityMiddleware(config: WebhookSecurityConfig) {
  return async function webhookSecurityMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") {
        headers[key.toLowerCase()] = value;
      }
    }

    let secret: string | undefined;
    let verifyResult: WebhookVerifyResult;

    const rawBody = (req as any).rawBody;
    const body = rawBody instanceof Buffer
      ? rawBody.toString("utf8")
      : req.body;

    switch (config.channel) {
      case "telegram":
        secret = process.env.TELEGRAM_WEBHOOK_SECRET;
        verifyResult = verifyTelegramWebhook(headers, body, secret, {
          timestampTolerance: config.timestampTolerance,
        });
        break;

      case "whatsapp":
        secret = process.env.WHATSAPP_APP_SECRET;
        verifyResult = verifyWhatsAppWebhook(headers, body, secret, {
          timestampTolerance: config.timestampTolerance,
        });
        break;

      case "max":
        secret = process.env.MAX_WEBHOOK_SECRET;
        verifyResult = verifyMaxWebhook(headers, body, secret, {
          timestampTolerance: config.timestampTolerance,
        });
        break;

      default:
        verifyResult = { valid: false, error: "Unknown channel" };
    }

    if (!verifyResult.valid) {
      const clientIp = req.ip || req.socket?.remoteAddress || "unknown";

      await auditLog.log(
        "webhook_verification_failed",
        "webhook",
        config.channel,
        "system",
        "system",
        {
          channel: config.channel,
          error: verifyResult.error,
          clientIp,
          userAgent: headers["user-agent"],
          path: req.path,
        }
      );

      console.warn(
        `[WebhookSecurity] ${config.channel} verification failed: ${verifyResult.error} (IP: ${clientIp})`
      );

      res.status(401).json({
        ok: false,
        error: verifyResult.error,
      });
      return;
    }

    next();
  };
}

export const telegramWebhookSecurity = createWebhookSecurityMiddleware({
  channel: "telegram",
});

export const whatsappWebhookSecurity = createWebhookSecurityMiddleware({
  channel: "whatsapp",
});

export const maxWebhookSecurity = createWebhookSecurityMiddleware({
  channel: "max",
});
