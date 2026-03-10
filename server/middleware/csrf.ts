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
 * We use an empty string as the session identifier (no per-session binding).
 *
 * Rationale: binding the CSRF token to req.session.id caused login failures
 * whenever the session expired or was regenerated.  After session expiry the
 * old CSRF cookie became invalid for the new session ID; two concurrent
 * GET /api/csrf-token calls both saw an invalid cookie and each generated a
 * different fresh token — the last Set-Cookie won in the browser, making the
 * first caller's token stale and causing an INVALID_CSRF_TOKEN 403 on login.
 *
 * Security is still preserved by the double-submit cookie pattern itself:
 *   • The CSRF cookie is httpOnly → unreadable by JavaScript / XSS.
 *   • The raw token is same-origin only → a cross-origin attacker cannot
 *     read it from the GET /api/csrf-token response.
 *   • An attacker would need to control both the CSRF cookie (httpOnly) and
 *     the header value simultaneously — which is impossible without already
 *     having full control of the victim's browser.
 * The session-binding was defence-in-depth; removing it does not meaningfully
 * weaken the protection in this application's threat model.
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
  getSessionIdentifier: () => "",
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
