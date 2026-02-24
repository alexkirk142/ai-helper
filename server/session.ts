import session from "express-session";
import connectPg from "connect-pg-simple";
import { getConfig } from "./config.js";

/**
 * Session middleware: PostgreSQL store, 1 week TTL.
 * Used for email/password auth (session.userId).
 *
 * SESSION_SECRET is enforced as required in production/staging by envSchema at startup.
 * In development/test a clearly-labelled insecure fallback is used so the dev server
 * can start without the variable set.
 */
export function getSession() {
  const cfg = getConfig();
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week

  const secret =
    cfg.SESSION_SECRET ??
    "dev-only-insecure-fallback-secret-do-not-use-in-production";

  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl / 1000, // connect-pg-simple expects seconds
    tableName: "sessions",
  });
  const isProduction = cfg.NODE_ENV === "production";
  // Railway and most cloud providers sit behind a reverse proxy that terminates TLS.
  // We always trust the first proxy hop so secure cookies work correctly.
  const trustProxy = process.env.TRUST_PROXY !== "false";
  return session({
    secret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction ? (trustProxy ? "auto" : true) : false,
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}
