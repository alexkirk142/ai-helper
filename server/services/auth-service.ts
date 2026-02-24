import bcrypt from "bcrypt";
import crypto from "crypto";
import { storage } from "../storage";
import { User, InsertUser, UserInvite } from "@shared/schema";
import { auditLog } from "./audit-log";
import { UserRole } from "../middleware/rbac";
import { emailProvider, emailTemplates } from "./email-provider";
import { startTrial } from "./cryptobot-billing";
import { fraudDetectionService } from "./fraud-detection-service";

const SALT_ROUNDS = 12;
const EMAIL_VERIFICATION_EXPIRY_HOURS = 24;
const PASSWORD_RESET_EXPIRY_HOURS = 1;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const INVITE_EXPIRY_HOURS = 72;

export interface SignupRequest {
  email: string;
  password: string;
  username?: string; // Auto-generated from email if not provided
  inviteToken?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
  errorCode?: "INVALID_CREDENTIALS" | "ACCOUNT_LOCKED" | "EMAIL_EXISTS" | "USERNAME_EXISTS" | "INVALID_INVITE" | "INVITE_EXPIRED" | "WEAK_PASSWORD" | "SIGNUP_CONFLICT";
}

export interface InviteResult {
  success: boolean;
  invite?: UserInvite;
  error?: string;
}

export class AuthService {
  /**
   * Hash password using bcrypt with configurable salt rounds.
   * SECURITY: Uses 12 rounds - balances security vs. performance.
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Verify password against hash.
   * SECURITY: Uses timing-safe comparison internally.
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate cryptographically secure invite token.
   */
  generateInviteToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Validate password strength.
   * SECURITY: Minimum requirements for production use.
   */
  validatePasswordStrength(password: string): { valid: boolean; reason?: string } {
    if (password.length < 8) {
      return { valid: false, reason: "Password must be at least 8 characters" };
    }
    if (password.length > 128) {
      return { valid: false, reason: "Password must be less than 128 characters" };
    }
    if (!/[A-Z]/.test(password)) {
      return { valid: false, reason: "Password must contain at least one uppercase letter" };
    }
    if (!/[a-z]/.test(password)) {
      return { valid: false, reason: "Password must contain at least one lowercase letter" };
    }
    if (!/[0-9]/.test(password)) {
      return { valid: false, reason: "Password must contain at least one number" };
    }
    return { valid: true };
  }

  /**
   * Signup with email/password.
   * Supports both invite-based (join existing tenant) and auto-provision (create new tenant).
   * 
   * SECURITY CONSIDERATIONS:
   * - Anti-enumeration: Same response time for existing/non-existing emails
   * - Password hashed before storage
   * - Invite tokens are one-time use
   */
  /**
   * Generate username from email (e.g., "user@example.com" -> "user_a1b2c3")
   */
  private generateUsernameFromEmail(email: string): string {
    const localPart = email.split("@")[0];
    const sanitized = localPart.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 20);
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${sanitized}_${suffix}`;
  }

  async signup(request: SignupRequest): Promise<AuthResult> {
    const { email, password, inviteToken } = request;
    const normalizedEmail = email.toLowerCase().trim();
    
    // Auto-generate username if not provided
    let username = request.username || this.generateUsernameFromEmail(normalizedEmail);

    // Validate password strength first (fast check)
    const passwordCheck = this.validatePasswordStrength(password);
    if (!passwordCheck.valid) {
      return { success: false, error: passwordCheck.reason, errorCode: "WEAK_PASSWORD" };
    }

    // Check if email already exists
    // SECURITY: Anti-enumeration - return generic message, log attempt with masked PII
    const existingByEmail = await storage.getUserByEmail(normalizedEmail);
    if (existingByEmail) {
      await this.constantTimeDelay();
      await this.logDuplicateSignupAttempt(normalizedEmail, "email");
      return { 
        success: false, 
        error: "Unable to create account. If you already have an account, try logging in or resetting your password.",
        errorCode: "SIGNUP_CONFLICT" 
      };
    }

    // Check if username already exists (rare with random suffix, but possible)
    // SECURITY: Username uniqueness can be revealed (it's public info in most systems)
    const existingByUsername = await storage.getUserByUsername(username);
    if (existingByUsername) {
      // Regenerate with new suffix
      username = this.generateUsernameFromEmail(normalizedEmail);
    }

    let tenantId: string;
    let role: UserRole = "owner";

    if (inviteToken) {
      // Invite-based signup: join existing tenant
      // SECURITY: Hash the token before lookup (we only store hashes)
      const tokenHash = this.hashInviteToken(inviteToken);
      const invite = await storage.getUserInviteByTokenHash(tokenHash);
      
      if (!invite) {
        return { success: false, error: "Invalid invite token", errorCode: "INVALID_INVITE" };
      }

      if (invite.usedAt) {
        return { success: false, error: "Invite already used", errorCode: "INVALID_INVITE" };
      }

      if (new Date() > invite.expiresAt) {
        return { success: false, error: "Invite has expired", errorCode: "INVITE_EXPIRED" };
      }

      // Verify email matches invite (case-insensitive)
      if (invite.email.toLowerCase() !== normalizedEmail) {
        return { success: false, error: "Email does not match invite", errorCode: "INVALID_INVITE" };
      }

      tenantId = invite.tenantId;
      role = invite.role as UserRole;

      // Mark invite as used
      await storage.markUserInviteUsed(invite.id);
    } else {
      // Check trial eligibility before creating tenant (fraud prevention F2)
      const trialEligibility = await fraudDetectionService.checkTrialEligibility(normalizedEmail);
      
      // Auto-provision: create new tenant
      const tenant = await storage.createTenant({
        name: `${username}'s Business`,
        language: "ru",
        tone: "formal",
        addressStyle: "vy",
        currency: "RUB",
        timezone: "Europe/Moscow",
      });
      tenantId = tenant.id;
      role = "owner";
      
      // Start 72-hour free trial for new tenant (if eligible)
      if (trialEligibility.allowed) {
        const trialResult = await startTrial(tenant.id);
        if (trialResult.success) {
          console.log(`[Auth] Started 72h trial for new tenant ${tenant.id}`);
        }
      } else {
        // F2 ENFORCEMENT: Restrict tenant and create expired subscription
        // This ensures the user cannot access features without paying
        console.log(`[Auth] Trial denied for tenant ${tenant.id}: ${trialEligibility.reason}`);
        await fraudDetectionService.restrictTenant(tenant.id, "MULTI_TRIAL_ATTEMPT");
        
        // Create expired subscription so tenant is immediately paywalled
        const { createExpiredSubscription } = await import("./cryptobot-billing");
        await createExpiredSubscription(tenant.id);
        console.log(`[Auth] Tenant ${tenant.id} restricted and paywalled due to trial abuse`);
      }
    }

    // Hash password
    const hashedPassword = await this.hashPassword(password);

    // Create user
    // SECURITY: Wrap in try-catch to handle DB unique constraint violations (race condition)
    // This prevents duplicate emails even if two requests pass the app-level check simultaneously
    let user;
    try {
      user = await storage.createUser({
        email: normalizedEmail,
        username,
        password: hashedPassword,
        tenantId,
        role,
        authProvider: "local",
        emailVerifiedAt: null, // null = unverified
      });
    } catch (error: any) {
      // Handle PostgreSQL unique constraint violation (race condition)
      // Error code 23505 = unique_violation
      if (this.isUniqueViolationError(error)) {
        // SECURITY: Anti-enumeration - same response regardless of constraint type
        await this.constantTimeDelay();
        
        // Determine constraint type for internal logging only
        const constraintName = (error.constraint || error.detail || "").toLowerCase();
        const conflictType = constraintName.includes("email") ? "email" : 
                            constraintName.includes("username") ? "username" : "unknown";
        
        await this.logDuplicateSignupAttempt(
          conflictType === "email" ? normalizedEmail : username, 
          conflictType
        );
        
        // SECURITY: Return identical response for email conflicts (anti-enumeration)
        // Username conflicts can be revealed (public info)
        if (conflictType === "username") {
          return { success: false, error: "Username already taken", errorCode: "USERNAME_EXISTS" };
        }
        
        return { 
          success: false, 
          error: "Unable to create account. If you already have an account, try logging in or resetting your password.",
          errorCode: "SIGNUP_CONFLICT" 
        };
      }
      
      // Re-throw non-constraint errors
      throw error;
    }

    // Audit log
    await auditLog.log(
      "user_signup" as any,
      "user",
      user.id,
      user.id,
      "user",
      { authProvider: "local", hasInvite: !!inviteToken, role, tenantId }
    );

    return { success: true, user };
  }

  /**
   * Check if error is a PostgreSQL unique constraint violation.
   * Error code 23505 = unique_violation
   */
  private isUniqueViolationError(error: any): boolean {
    // pg/postgres error format
    if (error.code === "23505") return true;
    // Drizzle wrapped error
    if (error.cause?.code === "23505") return true;
    // Error message patterns
    const msg = (error.message || "").toLowerCase();
    return msg.includes("unique constraint") || msg.includes("duplicate key");
  }

  /**
   * Login with email/password.
   * 
   * SECURITY CONSIDERATIONS:
   * - Anti-enumeration: Same error message for invalid email/password
   * - Account lockout after MAX_FAILED_ATTEMPTS
   * - Constant-time comparison to prevent timing attacks
   * - Updates lastLoginAt on success
   */
  async login(request: LoginRequest): Promise<AuthResult> {
    const { email, password } = request;
    const normalizedEmail = email.toLowerCase().trim();

    // Find user by email
    const user = await storage.getUserByEmail(normalizedEmail);

    // SECURITY: Anti-enumeration - same response for non-existent user
    if (!user) {
      // Perform dummy hash to maintain constant time
      await this.constantTimeDelay();
      return { success: false, error: "Invalid email or password", errorCode: "INVALID_CREDENTIALS" };
    }

    // Check if account is locked
    if (user.lockedUntil && new Date() < user.lockedUntil) {
      // SECURITY: Extend lockout on repeated attempts while locked
      const newLockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      await storage.updateUserLoginAttempts(user.id, MAX_FAILED_ATTEMPTS, newLockUntil);
      
      const remainingMinutes = Math.ceil(LOCKOUT_DURATION_MS / 60000);
      return { 
        success: false, 
        error: `Account locked. Try again in ${remainingMinutes} minutes`, 
        errorCode: "ACCOUNT_LOCKED" 
      };
    }

    // Verify password
    // SECURITY: User must have local auth provider (not OIDC-only)
    if (user.authProvider === "oidc" && !user.password) {
      await this.constantTimeDelay();
      return { success: false, error: "Invalid email or password", errorCode: "INVALID_CREDENTIALS" };
    }

    const passwordValid = await this.verifyPassword(password, user.password);

    if (!passwordValid) {
      // Increment failed attempts
      const newAttempts = (user.failedLoginAttempts || 0) + 1;
      
      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        // Lock account
        await storage.updateUserLoginAttempts(user.id, newAttempts, new Date(Date.now() + LOCKOUT_DURATION_MS));
        
        await auditLog.log(
          "account_locked" as any,
          "user",
          user.id,
          "system",
          "system",
          { failedAttempts: newAttempts, lockoutMinutes: LOCKOUT_DURATION_MS / 60000, tenantId: user.tenantId }
        );

        return { 
          success: false, 
          error: `Account locked due to too many failed attempts. Try again in 15 minutes`, 
          errorCode: "ACCOUNT_LOCKED" 
        };
      } else {
        await storage.updateUserLoginAttempts(user.id, newAttempts, null);
      }

      return { success: false, error: "Invalid email or password", errorCode: "INVALID_CREDENTIALS" };
    }

    // Success: reset failed attempts and update last login
    await storage.updateUserLoginSuccess(user.id);

    await auditLog.log(
      "user_login" as any,
      "user",
      user.id,
      user.id,
      "user",
      { authProvider: "local", tenantId: user.tenantId }
    );

    return { success: true, user };
  }

  /**
   * Hash invite token using SHA-256.
   * SECURITY: Never store plaintext tokens in database.
   */
  hashInviteToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  // ============ EMAIL VERIFICATION ============

  /**
   * Send email verification link.
   * Creates token, stores hash, sends email with plaintext token.
   * 
   * SECURITY:
   * - Invalidates previous unused tokens for this user
   * - Token expires in 24 hours
   * - Single-use tokens
   */
  async sendVerificationEmail(userId: string, baseUrl: string): Promise<{ success: boolean; error?: string }> {
    const user = await storage.getUser(userId);
    if (!user || !user.email) {
      return { success: false, error: "User not found or no email" };
    }

    if (user.emailVerifiedAt) {
      return { success: false, error: "Email already verified" };
    }

    // Invalidate any existing tokens
    await storage.invalidateUserTokens(userId, "email_verification");

    // Generate new token
    const plaintextToken = this.generateSecureToken();
    const tokenHash = this.hashToken(plaintextToken);
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

    await storage.createEmailToken({
      userId,
      tokenHash,
      type: "email_verification",
      expiresAt,
    });

    // Build verification URL
    const verifyUrl = `${baseUrl}/auth/verify-email?token=${plaintextToken}`;

    // Send email
    const emailMessage = emailTemplates.verification(user.username, verifyUrl);
    emailMessage.to = user.email;
    
    const result = await emailProvider.send(emailMessage);
    
    if (!result.success) {
      return { success: false, error: "Failed to send verification email" };
    }

    await auditLog.log(
      "verification_email_sent" as any,
      "user",
      userId,
      userId,
      "user",
      { email: user.email }
    );

    return { success: true };
  }

  /**
   * Verify email with token.
   * 
   * SECURITY:
   * - Token validated via hash lookup
   * - Single-use (marked used immediately)
   * - Expiration checked
   */
  async verifyEmail(token: string): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    const tokenHash = this.hashToken(token);
    const emailToken = await storage.getEmailTokenByHash(tokenHash);

    if (!emailToken) {
      return { success: false, error: "Invalid token", errorCode: "INVALID_TOKEN" };
    }

    if (emailToken.usedAt) {
      return { success: false, error: "Token already used", errorCode: "TOKEN_USED" };
    }

    if (new Date() > emailToken.expiresAt) {
      return { success: false, error: "Token expired", errorCode: "TOKEN_EXPIRED" };
    }

    if (emailToken.type !== "email_verification") {
      return { success: false, error: "Invalid token type", errorCode: "INVALID_TOKEN" };
    }

    // Mark token as used
    await storage.markEmailTokenUsed(emailToken.id);

    // Update user's email verified status
    await storage.updateUserEmailVerified(emailToken.userId);

    await auditLog.log(
      "email_verified" as any,
      "user",
      emailToken.userId,
      emailToken.userId,
      "user",
      {}
    );

    return { success: true };
  }

  // ============ PASSWORD RESET ============

  /**
   * Initiate password reset.
   * 
   * SECURITY:
   * - Anti-enumeration: Always returns success (don't reveal if email exists)
   * - Invalidates previous reset tokens
   * - Token expires in 1 hour
   */
  async forgotPassword(email: string, baseUrl: string): Promise<{ success: boolean }> {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await storage.getUserByEmail(normalizedEmail);

    // SECURITY: Always return success to prevent email enumeration
    if (!user) {
      // Add delay to match timing of actual token generation
      await this.constantTimeDelay();
      return { success: true };
    }

    // Invalidate any existing reset tokens
    await storage.invalidateUserTokens(user.id, "password_reset");

    // Generate new token
    const plaintextToken = this.generateSecureToken();
    const tokenHash = this.hashToken(plaintextToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000);

    await storage.createEmailToken({
      userId: user.id,
      tokenHash,
      type: "password_reset",
      expiresAt,
    });

    // Build reset URL
    const resetUrl = `${baseUrl}/auth/reset-password?token=${plaintextToken}`;

    // Send email
    const emailMessage = emailTemplates.passwordReset(user.username, resetUrl);
    emailMessage.to = user.email!;
    
    await emailProvider.send(emailMessage);

    await auditLog.log(
      "password_reset_requested" as any,
      "user",
      user.id,
      user.id,
      "user",
      { email: normalizedEmail }
    );

    return { success: true };
  }

  /**
   * Reset password with token.
   * 
   * SECURITY:
   * - Token validated via hash lookup
   * - Single-use token
   * - Password strength validated
   * - All existing sessions should be invalidated (TODO: implement session store)
   */
  async resetPassword(token: string, newPassword: string): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    // Validate password strength
    const passwordCheck = this.validatePasswordStrength(newPassword);
    if (!passwordCheck.valid) {
      return { success: false, error: passwordCheck.reason, errorCode: "WEAK_PASSWORD" };
    }

    const tokenHash = this.hashToken(token);
    const emailToken = await storage.getEmailTokenByHash(tokenHash);

    if (!emailToken) {
      return { success: false, error: "Invalid token", errorCode: "INVALID_TOKEN" };
    }

    if (emailToken.usedAt) {
      return { success: false, error: "Token already used", errorCode: "TOKEN_USED" };
    }

    if (new Date() > emailToken.expiresAt) {
      return { success: false, error: "Token expired", errorCode: "TOKEN_EXPIRED" };
    }

    if (emailToken.type !== "password_reset") {
      return { success: false, error: "Invalid token type", errorCode: "INVALID_TOKEN" };
    }

    // Mark token as used
    await storage.markEmailTokenUsed(emailToken.id);

    // Hash new password and update
    const passwordHash = await this.hashPassword(newPassword);
    await storage.updateUserPassword(emailToken.userId, passwordHash);

    await auditLog.log(
      "password_reset_completed" as any,
      "user",
      emailToken.userId,
      emailToken.userId,
      "user",
      {}
    );

    return { success: true };
  }

  /**
   * Generate cryptographically secure token for emails.
   */
  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Hash token using SHA-256.
   * SECURITY: Never store plaintext tokens in DB.
   */
  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Create invite for new team member.
   * Returns plaintext token ONCE - only hash is stored in DB.
   */
  async createInvite(
    tenantId: string, 
    email: string, 
    role: UserRole, 
    invitedBy: string
  ): Promise<InviteResult & { plaintextToken?: string }> {
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists in this tenant
    const existingUser = await storage.getUserByEmail(normalizedEmail);
    if (existingUser && existingUser.tenantId === tenantId) {
      return { success: false, error: "User already exists in this tenant" };
    }

    // Check for existing pending invite
    const existingInvite = await storage.getPendingInviteForEmail(tenantId, normalizedEmail);
    if (existingInvite) {
      return { success: false, error: "Pending invite already exists for this email" };
    }

    const plaintextToken = this.generateInviteToken();
    const tokenHash = this.hashInviteToken(plaintextToken);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

    const invite = await storage.createUserInvite({
      tenantId,
      email: normalizedEmail,
      role,
      tokenHash,
      invitedBy,
      expiresAt,
    });

    await auditLog.log(
      "user_invite_created" as any,
      "user_invite",
      invite.id,
      invitedBy,
      "user",
      { invitedEmail: normalizedEmail, role, tenantId }
    );

    return { success: true, invite, plaintextToken };
  }

  /**
   * Log duplicate signup attempt with masked PII for observability.
   * SECURITY: Logs the attempt for security monitoring without exposing full PII.
   */
  private async logDuplicateSignupAttempt(identifier: string, type: "email" | "username" | "unknown"): Promise<void> {
    // Mask PII: show first 2 chars + domain for email, first 3 chars for username
    let maskedIdentifier: string;
    if (type === "email" && identifier.includes("@")) {
      const [local, domain] = identifier.split("@");
      maskedIdentifier = `${local.slice(0, 2)}***@${domain}`;
    } else {
      maskedIdentifier = `${identifier.slice(0, 3)}***`;
    }
    
    await auditLog.log(
      "duplicate_signup_attempt" as any,
      "auth",
      "signup",
      "anonymous",
      "system",
      { 
        conflictType: type, 
        maskedIdentifier,
        timestamp: new Date().toISOString()
      }
    );
  }

  /**
   * Constant-time delay to prevent timing attacks.
   * SECURITY: Ensures response time is consistent regardless of user existence.
   */
  private async constantTimeDelay(): Promise<void> {
    // Simulate bcrypt hash time (~100-200ms with 12 rounds)
    await bcrypt.hash("dummy-password-for-timing", SALT_ROUNDS);
  }
}

export const authService = new AuthService();
