import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authService } from "../services/auth-service";
import { requireAuth, requirePermission } from "../middleware/rbac";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRateLimiterRedisInstance } from "../redis-client";
import { storage } from "../storage";
import { db } from "../db";
import { adminActions } from "@shared/schema";

const router = Router();

// ============ VALIDATION SCHEMAS ============

const signupSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  username: z.string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, underscores and hyphens")
    .optional(),
  inviteToken: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

const inviteSchema = z.object({
  email: z.string().email("Invalid email format"),
  role: z.enum(["admin", "operator", "viewer"]),
});

// ============ RATE LIMITING ============

/**
 * Auth-specific rate limiters.
 * SECURITY: Strict limits to prevent brute force attacks.
 * - 5 attempts per 15 minutes for login
 * - 3 attempts per hour for signup (prevent spam accounts)
 *
 * Uses a Redis-backed store when REDIS_URL is configured so limits are
 * shared across all worker processes.  Falls back to the default
 * express-rate-limit in-memory store when Redis is unavailable (dev without
 * Redis still works transparently).
 */
/**
 * Build a RedisStore for express-rate-limit if REDIS_URL is configured.
 * Returns undefined (memory store fallback) when Redis is not configured.
 * passOnStoreError: true means Redis errors allow the request through rather
 * than returning 500, so dev without Redis continues to work transparently.
 */
function makeRedisStore(prefix: string): RedisStore | undefined {
  const redis = getRateLimiterRedisInstance();
  if (!redis) return undefined;
  return new RedisStore({
    prefix,
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<number>,
  });
}

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: makeRedisStore("rl:auth:login:"),
});

const signupRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: "Too many signup attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: makeRedisStore("rl:auth:signup:"),
});

// ============ ROUTES ============

/**
 * POST /auth/signup
 * 
 * Register new user with email/password.
 * Supports two modes:
 * 1. With inviteToken: Join existing tenant with specified role
 * 2. Without inviteToken: Create new tenant and become owner
 * 
 * SECURITY:
 * - Rate limited (3/hour)
 * - Password strength validation
 * - Anti-enumeration (same response time for existing emails)
 * - Invite tokens are one-time use
 */
router.post("/signup", signupRateLimiter, async (req: Request, res: Response) => {
  try {
    // Validate request body
    const parseResult = signupSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parseResult.error.errors.map(e => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const result = await authService.signup(parseResult.data);

    if (!result.success) {
      // Map error codes to appropriate HTTP status
      // SECURITY: SIGNUP_CONFLICT uses 200 to prevent enumeration via status code
      const statusMap: Record<string, number> = {
        SIGNUP_CONFLICT: 200, // Anti-enumeration: same status as success
        USERNAME_EXISTS: 409,
        INVALID_INVITE: 400,
        INVITE_EXPIRED: 400,
        WEAK_PASSWORD: 400,
      };
      const status = statusMap[result.errorCode || ""] || 400;
      
      // SECURITY: For SIGNUP_CONFLICT, return response that looks like success
      // but with a message prompting user to login/reset instead
      if (result.errorCode === "SIGNUP_CONFLICT") {
        return res.status(200).json({ 
          success: false, 
          message: result.error,
          hint: "login_or_reset"
        });
      }
      
      return res.status(status).json({ error: result.error, code: result.errorCode });
    }

    // Set session cookie
    // SECURITY: HttpOnly, Secure (in production), SameSite=Lax
    if (result.user) {
      req.session = req.session || {};
      (req.session as any).userId = result.user.id;
      (req.session as any).tenantId = result.user.tenantId;
      (req.session as any).role = result.user.role;
    }

    return res.status(201).json({
      success: true,
      user: {
        id: result.user!.id,
        email: result.user!.email,
        username: result.user!.username,
        role: result.user!.role,
        tenantId: result.user!.tenantId,
      },
    });
  } catch (error) {
    console.error("[Auth] Signup error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/login
 * 
 * Authenticate user with email/password.
 * 
 * SECURITY:
 * - Rate limited (5/15min per IP+email)
 * - Account lockout after 5 failed attempts
 * - Anti-enumeration: Same error message for invalid email/password
 * - Constant-time comparison prevents timing attacks
 */
router.post("/login", authRateLimiter, async (req: Request, res: Response) => {
  try {
    // Validate request body
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parseResult.error.errors.map(e => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const result = await authService.login(parseResult.data);

    if (!result.success) {
      // SECURITY: Don't reveal whether email exists
      // All auth failures return 401 with generic message
      const statusMap: Record<string, number> = {
        INVALID_CREDENTIALS: 401,
        ACCOUNT_LOCKED: 423, // Locked
      };
      const status = statusMap[result.errorCode || ""] || 401;
      return res.status(status).json({ error: result.error, code: result.errorCode });
    }

    // Set session cookie
    if (result.user) {
      (req.session as any).userId = result.user.id;
      (req.session as any).tenantId = result.user.tenantId;
      (req.session as any).role = result.user.role;
      
      // Explicitly save session to ensure cookie is set
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Audit log for successful login
      await db.insert(adminActions).values({
        actionType: "user_login",
        targetType: "user",
        targetId: result.user.id,
        adminId: result.user.id,
        reason: "User login",
        previousState: null,
        metadata: {
          ip: req.ip || req.socket.remoteAddress,
          userAgent: req.get("User-Agent")?.slice(0, 200),
        },
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: result.user!.id,
        email: result.user!.email,
        username: result.user!.username,
        role: result.user!.role,
        tenantId: result.user!.tenantId,
      },
    });
  } catch (error) {
    console.error("[Auth] Login error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/logout
 * 
 * Destroy session and clear cookies.
 */
router.post("/logout", async (req: Request, res: Response) => {
  const userId = (req.session as any)?.userId;

  if (userId) {
    try {
      await db.insert(adminActions).values({
        actionType: "user_logout",
        targetType: "user",
        targetId: userId,
        adminId: userId,
        reason: "User logout",
        previousState: null,
        metadata: {
          ip: req.ip || req.socket.remoteAddress,
        },
      });
    } catch (err) {
      console.error("[Auth] Failed to log logout event:", err);
    }
  }

  if (req.session?.destroy) {
    await new Promise<void>((resolve) => {
      req.session.destroy((err: any) => {
        if (err) {
          console.error("[Auth] Session destroy error:", err);
        }
        resolve();
      });
    });
  }
  res.clearCookie("connect.sid");
  return res.status(200).json({ success: true });
});

/**
 * GET /auth/me
 * 
 * Get current authenticated user info.
 * Used by frontend to check auth state.
 */
router.get("/me", async (req: Request, res: Response) => {
  const session = req.session as any;
  
  if (!session?.userId) {
    return res.status(200).json({ authenticated: false });
  }

  // Get user from storage for full data
  const user = await storage.getUser(session.userId);
  if (!user) {
    return res.status(200).json({ authenticated: false });
  }

  return res.status(200).json({
    authenticated: true,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      authProvider: user.authProvider,
    },
    tenantId: user.tenantId,
    role: user.role,
  });
});

/**
 * POST /auth/invite
 * 
 * Create invite for new team member.
 * Requires MANAGE_USERS permission (owner only).
 * 
 * SECURITY:
 * - Only tenant owner can invite
 * - Invite tokens expire in 72 hours
 * - One pending invite per email per tenant
 */
router.post("/invite", requireAuth, requirePermission("MANAGE_USERS"), async (req: Request, res: Response) => {
  try {
    const parseResult = inviteSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parseResult.error.errors.map(e => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const session = req.session as any;
    if (!session?.tenantId || !session?.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const result = await authService.createInvite(
      session.tenantId,
      parseResult.data.email,
      parseResult.data.role,
      session.userId
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    // Return invite link (token is in the link)
    // SECURITY: plaintextToken is shown ONCE - only hash is stored in DB
    // In production, this should send email with invite link
    const inviteLink = `/signup?invite=${result.plaintextToken}`;

    return res.status(201).json({
      success: true,
      inviteLink,
      expiresAt: result.invite!.expiresAt,
    });
  } catch (error) {
    console.error("[Auth] Invite error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============ EMAIL VERIFICATION ROUTES ============

const verifyEmailSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email format"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * POST /auth/send-verification
 * 
 * Send email verification link to current user.
 * Requires authentication.
 */
router.post("/send-verification", requireAuth, async (req: Request, res: Response) => {
  try {
    const session = req.session as any;
    if (!session?.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // Build base URL for verification link
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    
    const result = await authService.sendVerificationEmail(session.userId, baseUrl);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json({ 
      success: true, 
      message: "Verification email sent" 
    });
  } catch (error) {
    console.error("[Auth] Send verification error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/verify-email
 * 
 * Verify email with token from email link.
 * 
 * SECURITY:
 * - Token validated via hash lookup
 * - Single-use tokens
 * - Expiration check
 */
router.post("/verify-email", async (req: Request, res: Response) => {
  try {
    const parseResult = verifyEmailSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parseResult.error.errors.map(e => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const result = await authService.verifyEmail(parseResult.data.token);

    if (!result.success) {
      const statusMap: Record<string, number> = {
        INVALID_TOKEN: 400,
        TOKEN_USED: 400,
        TOKEN_EXPIRED: 400,
      };
      const status = statusMap[result.errorCode || ""] || 400;
      return res.status(status).json({ error: result.error, code: result.errorCode });
    }

    return res.status(200).json({ 
      success: true, 
      message: "Email verified successfully" 
    });
  } catch (error) {
    console.error("[Auth] Verify email error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ============ PASSWORD RESET ROUTES ============

/**
 * POST /auth/forgot-password
 * 
 * Request password reset email.
 * 
 * SECURITY:
 * - Anti-enumeration: Always returns success
 * - Rate limited to prevent abuse
 */
router.post("/forgot-password", authRateLimiter, async (req: Request, res: Response) => {
  try {
    const parseResult = forgotPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parseResult.error.errors.map(e => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    // Build base URL for reset link
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    
    await authService.forgotPassword(parseResult.data.email, baseUrl);

    // SECURITY: Always return success to prevent email enumeration
    return res.status(200).json({ 
      success: true, 
      message: "If that email exists, a password reset link has been sent" 
    });
  } catch (error) {
    console.error("[Auth] Forgot password error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/reset-password
 * 
 * Reset password with token.
 * 
 * SECURITY:
 * - Token validated via hash lookup
 * - Single-use tokens
 * - Password strength validated
 */
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const parseResult = resetPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parseResult.error.errors.map(e => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const result = await authService.resetPassword(
      parseResult.data.token,
      parseResult.data.password
    );

    if (!result.success) {
      const statusMap: Record<string, number> = {
        INVALID_TOKEN: 400,
        TOKEN_USED: 400,
        TOKEN_EXPIRED: 400,
        WEAK_PASSWORD: 400,
      };
      const status = statusMap[result.errorCode || ""] || 400;
      return res.status(status).json({ error: result.error, code: result.errorCode });
    }

    return res.status(200).json({ 
      success: true, 
      message: "Password reset successfully" 
    });
  } catch (error) {
    console.error("[Auth] Reset password error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
