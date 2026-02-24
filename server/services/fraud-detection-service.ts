import crypto from "crypto";
import { db } from "../db";
import { channelFingerprints, fraudFlags, tenants, subscriptions, users } from "@shared/schema";
import { eq, and, ne } from "drizzle-orm";
import { auditLog } from "./audit-log";
import type { ChannelFingerprintType, FraudReason, TenantStatus } from "@shared/schema";

export interface FingerprintInput {
  telegram?: {
    botId?: string;
    botToken?: string;
  };
  whatsapp_business?: {
    businessId?: string;
    phoneNumber?: string;
  };
  whatsapp_personal?: {
    phoneNumber: string;
  };
  max?: {
    workspaceId?: string;
    teamId?: string;
  };
}

export interface ChannelReusCheckResult {
  isReused: boolean;
  existingTenantId?: string;
  fingerprintHash: string;
}

export interface FraudCheckResult {
  allowed: boolean;
  reason?: FraudReason;
  message: string;
}

const GENERIC_FRAUD_ERROR = "Этот аккаунт требует ручной проверки. Пожалуйста, свяжитесь с поддержкой.";

export class FraudDetectionService {
  private computeSha256(input: string): string {
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  computeChannelFingerprint(channelType: ChannelFingerprintType, input: FingerprintInput): string | null {
    switch (channelType) {
      case "telegram": {
        const data = input.telegram;
        if (!data) return null;
        const identifier = data.botId || data.botToken;
        if (!identifier) return null;
        return this.computeSha256(`telegram:${identifier}`);
      }
      case "whatsapp_business": {
        const data = input.whatsapp_business;
        if (!data) return null;
        const identifier = data.businessId || data.phoneNumber;
        if (!identifier) return null;
        return this.computeSha256(`whatsapp_business:${identifier}`);
      }
      case "whatsapp_personal": {
        const data = input.whatsapp_personal;
        if (!data?.phoneNumber) return null;
        return this.computeSha256(`whatsapp_personal:${data.phoneNumber}`);
      }
      case "max": {
        const data = input.max;
        if (!data) return null;
        const identifier = data.workspaceId || data.teamId;
        if (!identifier) return null;
        return this.computeSha256(`max:${identifier}`);
      }
      default:
        return null;
    }
  }

  async checkChannelReuse(
    channelType: ChannelFingerprintType,
    fingerprintHash: string,
    currentTenantId: string
  ): Promise<ChannelReusCheckResult> {
    const existing = await db
      .select()
      .from(channelFingerprints)
      .where(
        and(
          eq(channelFingerprints.fingerprintHash, fingerprintHash),
          eq(channelFingerprints.channelType, channelType),
          ne(channelFingerprints.tenantId, currentTenantId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return {
        isReused: true,
        existingTenantId: existing[0].tenantId,
        fingerprintHash,
      };
    }

    return {
      isReused: false,
      fingerprintHash,
    };
  }

  async registerChannelFingerprint(
    channelType: ChannelFingerprintType,
    fingerprintHash: string,
    tenantId: string
  ): Promise<void> {
    const existing = await db
      .select()
      .from(channelFingerprints)
      .where(
        and(
          eq(channelFingerprints.fingerprintHash, fingerprintHash),
          eq(channelFingerprints.channelType, channelType),
          eq(channelFingerprints.tenantId, tenantId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(channelFingerprints)
        .set({ lastSeenAt: new Date() })
        .where(eq(channelFingerprints.id, existing[0].id));
    } else {
      await db.insert(channelFingerprints).values({
        channelType,
        fingerprintHash,
        tenantId,
      });
    }
  }

  async createFraudFlag(
    tenantId: string,
    reason: FraudReason,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    await db.insert(fraudFlags).values({
      tenantId,
      reason,
      metadata,
    });

    await auditLog.log(
      "fraud_flag_created" as any,
      "fraud",
      tenantId,
      "system",
      "system",
      { reason, metadata }
    );
  }

  async restrictTenant(tenantId: string, reason: FraudReason): Promise<void> {
    await db
      .update(tenants)
      .set({ status: "restricted" as TenantStatus })
      .where(eq(tenants.id, tenantId));

    await auditLog.log(
      "tenant_restricted" as any,
      "tenant",
      tenantId,
      "system",
      "system",
      { reason }
    );
  }

  async getTenantStatus(tenantId: string): Promise<TenantStatus> {
    const tenant = await db
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    return (tenant[0]?.status as TenantStatus) || "active";
  }

  async isTrialTenant(tenantId: string): Promise<boolean> {
    const subscription = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .limit(1);

    return subscription[0]?.status === "trialing";
  }

  async validateChannelConnection(
    tenantId: string,
    channelType: ChannelFingerprintType,
    input: FingerprintInput
  ): Promise<FraudCheckResult> {
    const tenantStatus = await this.getTenantStatus(tenantId);
    if (tenantStatus === "restricted") {
      return {
        allowed: false,
        reason: "SUSPICIOUS_ACTIVITY",
        message: GENERIC_FRAUD_ERROR,
      };
    }

    const fingerprintHash = this.computeChannelFingerprint(channelType, input);
    if (!fingerprintHash) {
      return {
        allowed: true,
        message: "Channel fingerprint not available",
      };
    }

    const isTrial = await this.isTrialTenant(tenantId);
    
    const reuseCheck = await this.checkChannelReuse(channelType, fingerprintHash, tenantId);

    if (reuseCheck.isReused && isTrial) {
      await this.createFraudFlag(tenantId, "CHANNEL_REUSE", {
        channelType,
        fingerprintHash,
      });
      await this.restrictTenant(tenantId, "CHANNEL_REUSE");

      return {
        allowed: false,
        reason: "CHANNEL_REUSE",
        message: GENERIC_FRAUD_ERROR,
      };
    }

    await this.registerChannelFingerprint(channelType, fingerprintHash, tenantId);

    return {
      allowed: true,
      message: "Channel connection allowed",
    };
  }

  async checkTrialEligibility(
    userEmail: string
  ): Promise<FraudCheckResult> {
    const emailHash = this.computeSha256(`email:${userEmail.toLowerCase()}`);
    
    const existingUser = await db
      .select({
        id: users.id,
        tenantId: users.tenantId,
        email: users.email,
      })
      .from(users)
      .where(eq(users.email, userEmail.toLowerCase()))
      .limit(1);

    if (existingUser.length === 0) {
      return {
        allowed: true,
        message: "Trial eligible - new user",
      };
    }

    const user = existingUser[0];
    if (!user.tenantId) {
      return {
        allowed: true,
        message: "Trial eligible - no tenant",
      };
    }

    const userSubscription = await db
      .select({
        hadTrial: subscriptions.hadTrial,
        status: subscriptions.status,
        trialStartedAt: subscriptions.trialStartedAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, user.tenantId))
      .limit(1);

    if (userSubscription.length > 0) {
      const sub = userSubscription[0];
      if (sub.hadTrial || sub.trialStartedAt || sub.status === "active" || sub.status === "past_due") {
        await this.createFraudFlag(user.tenantId, "MULTI_TRIAL_ATTEMPT", {
          emailHash,
          previousStatus: sub.status,
        });

        return {
          allowed: false,
          reason: "MULTI_TRIAL_ATTEMPT",
          message: "Пробный период уже был использован. Требуется подписка.",
        };
      }
    }

    return {
      allowed: true,
      message: "Trial eligible",
    };
  }

  async getFraudFlags(tenantId: string): Promise<typeof fraudFlags.$inferSelect[]> {
    return db
      .select()
      .from(fraudFlags)
      .where(eq(fraudFlags.tenantId, tenantId));
  }

  async resolveFraudFlag(
    flagId: string,
    resolvedBy: string
  ): Promise<void> {
    await db
      .update(fraudFlags)
      .set({
        resolvedAt: new Date(),
        resolvedBy,
      })
      .where(eq(fraudFlags.id, flagId));
  }

  async unrestrictTenant(tenantId: string, adminId: string): Promise<void> {
    await db
      .update(tenants)
      .set({ status: "active" as TenantStatus })
      .where(eq(tenants.id, tenantId));

    await auditLog.log(
      "tenant_unrestricted" as any,
      "tenant",
      tenantId,
      adminId,
      "user",
      {}
    );
  }
}

export const fraudDetectionService = new FraudDetectionService();
