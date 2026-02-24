/**
 * CSRF protection — double-submit cookie pattern via `csrf-csrf` v4.
 *
 * HOW IT WORKS
 * ─────────────
 * 1. Client calls GET /api/csrf-token → server generates a HMAC-signed token,
 *    stores it in an httpOnly cookie (`x-csrf-token`), and returns the raw
 *    token value in the JSON body.
 * 2. Client caches the raw token and sends it as the `X-Csrf-Token` request
 *    header on every state-changing request (POST / PUT / PATCH / DELETE).
 * 3. Server re-computes the HMAC from the header value and compares it to the
 *    value stored in the httpOnly cookie.  Because the cookie is httpOnly and
 *    the GET response is same-origin, an attacker cannot obtain the token.
 *
 * EXEMPTIONS
 * ──────────
 * • Safe HTTP methods (GET, HEAD, OPTIONS) — never mutate state.
 * • Webhook paths (/webhooks/*, /api/webhook/*) — protected by HMAC
 *   signature verification (`webhook-security.ts`) instead.
 *
 * SESSION IDENTIFIER
 * ──────────────────
 * We use the client IP (req.ip) rather than the session ID so that the CSRF
 * token remains valid across the login request itself (login creates a new
 * session, which would otherwise invalidate the pre-login token).
 * Combined with `sameSite: lax` + `httpOnly: true` this remains secure.
 */
import { doubleCsrf } from "csrf-csrf";
import type { Request, Response, NextFunction } from "express";
import { getConfig } from "../config";

const DEV_FALLBACK_SECRET = "csrf-dev-only-insecure-fallback-secret-32c";

// Webhook paths use their own HMAC signature verification.
const WEBHOOK_PREFIXES = ["/webhooks/", "/api/webhook/"];

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => {
    try {
      return getConfig().SESSION_SECRET ?? DEV_FALLBACK_SECRET;
    } catch {
      return DEV_FALLBACK_SECRET;
    }
  },
  getSessionIdentifier: (req: Request) => req.ip ?? "",
  cookieName: "x-csrf-token",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
  size: 64,
  getCsrfTokenFromRequest: (req: Request) =>
    req.headers?.["x-csrf-token"] as string | undefined,
  skipCsrfProtection: (req: Request) =>
    WEBHOOK_PREFIXES.some((p) => req.path.startsWith(p)),
});

/**
 * Express middleware: validates the CSRF token on all state-changing requests.
 * Safe methods and webhook paths are automatically exempt.
 *
 * On failure: 403 { error: "Invalid CSRF token", code: "INVALID_CSRF_TOKEN" }
 */
export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  doubleCsrfProtection(req, res, (err?: unknown) => {
    if (err) {
      res
        .status(403)
        .json({ error: "Invalid CSRF token", code: "INVALID_CSRF_TOKEN" });
      return;
    }
    next();
  });
}

export { generateCsrfToken };
