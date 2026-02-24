import { CryptoPay, Assets } from "@foile/crypto-pay-api";
import { db } from "../db";
import { plans, subscriptions, tenants, subscriptionGrants } from "@shared/schema";
import type { Plan, Subscription, SubscriptionStatus, BillingStatus } from "@shared/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import crypto from "crypto";

const CRYPTO_PAY_TOKEN = process.env.CRYPTO_PAY_API_TOKEN;
const IS_TESTNET = process.env.CRYPTO_PAY_TESTNET === "true";

if (!CRYPTO_PAY_TOKEN) {
  console.warn("[CryptoBilling] CRYPTO_PAY_API_TOKEN not configured");
}

const cryptoPay = CRYPTO_PAY_TOKEN
  ? new CryptoPay(CRYPTO_PAY_TOKEN, {
      hostname: IS_TESTNET ? "testnet-pay.crypt.bot" : "pay.crypt.bot",
      protocol: "https",
    })
  : null;

const PLAN_CONFIG = {
  name: "AI Sales Operator Pro",
  amount: 5000, // $50.00 in cents
  currency: "usd",
  cryptoAmount: "50", // 50 USDT
  cryptoAsset: "USDT",
  interval: "month" as const,
};

export function getCryptoPay(): CryptoPay {
  if (!cryptoPay) {
    throw new Error("CryptoBot is not configured. Set CRYPTO_PAY_API_TOKEN environment variable.");
  }
  return cryptoPay;
}

export async function ensurePlanExists(): Promise<Plan> {
  const [existingPlan] = await db.select().from(plans).where(eq(plans.isActive, true)).limit(1);
  
  if (existingPlan) {
    return existingPlan;
  }

  const [plan] = await db.insert(plans).values({
    name: PLAN_CONFIG.name,
    amount: PLAN_CONFIG.amount,
    currency: PLAN_CONFIG.currency,
    cryptoAmount: PLAN_CONFIG.cryptoAmount,
    cryptoAsset: PLAN_CONFIG.cryptoAsset,
    interval: PLAN_CONFIG.interval,
    isActive: true,
  }).returning();

  console.log(`[CryptoBilling] Created plan: ${plan.name}`);
  return plan;
}

export async function createInvoice(
  tenantId: string,
  successUrl: string
): Promise<{ payUrl: string; invoiceId: number }> {
  const cryptoPayInstance = getCryptoPay();
  const plan = await ensurePlanExists();

  const [existingSub] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
  
  if (existingSub?.status === "active") {
    throw new Error("Tenant already has an active subscription");
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  
  const invoice = await cryptoPayInstance.createInvoice(
    Assets.USDT,
    plan.cryptoAmount || "50",
    {
      description: `${plan.name} - месячная подписка`,
      expires_in: 3600, // 1 hour
      paid_btn_name: "callback" as any,
      paid_btn_url: successUrl,
      payload: JSON.stringify({
        tenantId,
        planId: plan.id,
        tenantName: tenant?.name || "Unknown",
      }),
      allow_comments: false,
      allow_anonymous: false,
    }
  );

  if (!existingSub) {
    await db.insert(subscriptions).values({
      tenantId,
      planId: plan.id,
      cryptoInvoiceId: String(invoice.invoice_id),
      paymentProvider: "cryptobot",
      status: "incomplete",
    });
  } else {
    await db
      .update(subscriptions)
      .set({
        cryptoInvoiceId: String(invoice.invoice_id),
        paymentProvider: "cryptobot",
        status: "incomplete",
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.tenantId, tenantId));
  }

  console.log(`[CryptoBilling] Created invoice ${invoice.invoice_id} for tenant ${tenantId}`);

  return {
    payUrl: invoice.pay_url,
    invoiceId: invoice.invoice_id,
  };
}

export async function checkInvoiceStatus(invoiceId: string): Promise<"active" | "paid" | "expired"> {
  const cryptoPayInstance = getCryptoPay();
  
  const invoices = await cryptoPayInstance.getInvoices({
    invoice_ids: [Number(invoiceId)],
  });

  if (invoices.length === 0) {
    throw new Error("Invoice not found");
  }

  return invoices[0].status as "active" | "paid" | "expired";
}

export interface CryptoWebhookPayload {
  update_type: "invoice_paid";
  request_date: string;
  update_id: number;
  payload: {
    invoice_id: number;
    status: "paid";
    hash: string;
    asset: string;
    amount: string;
    pay_url: string;
    description: string;
    created_at: string;
    paid_at: string;
    paid_anonymously: boolean;
    comment?: string;
    payload?: string;
  };
}

export function verifyWebhookSignature(body: string, signature: string): boolean {
  if (!CRYPTO_PAY_TOKEN) {
    console.error("[CryptoBilling] Cannot verify webhook: no API token");
    return false;
  }

  const secret = crypto.createHash("sha256").update(CRYPTO_PAY_TOKEN).digest();
  const checkString = body;
  const hmac = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  
  return hmac === signature;
}

export async function handleWebhookEvent(payload: CryptoWebhookPayload): Promise<void> {
  console.log(`[CryptoBilling] Processing webhook: ${payload.update_type}`);

  if (payload.update_type !== "invoice_paid") {
    console.log(`[CryptoBilling] Ignoring event type: ${payload.update_type}`);
    return;
  }

  const invoice = payload.payload;
  let metadata: { tenantId?: string; planId?: string } = {};
  
  try {
    if (invoice.payload) {
      metadata = JSON.parse(invoice.payload);
    }
  } catch (e) {
    console.error("[CryptoBilling] Failed to parse invoice payload:", e);
  }

  const tenantId = metadata.tenantId;
  if (!tenantId) {
    console.error("[CryptoBilling] No tenantId in invoice payload");
    return;
  }

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await db
    .update(subscriptions)
    .set({
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      updatedAt: now,
    })
    .where(eq(subscriptions.tenantId, tenantId));

  console.log(`[CryptoBilling] Activated subscription for tenant ${tenantId} until ${periodEnd.toISOString()}`);
}

export async function getSubscriptionByTenant(tenantId: string): Promise<Subscription | null> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
  return sub || null;
}

export async function getPlanById(planId: string): Promise<Plan | null> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  return plan || null;
}

export async function getBillingStatus(tenantId: string): Promise<BillingStatus> {
  const subscription = await getSubscriptionByTenant(tenantId);
  
  if (!subscription) {
    // Even without a subscription record, check for an active grant
    const [activeGrant] = await db
      .select({ endsAt: subscriptionGrants.endsAt })
      .from(subscriptionGrants)
      .where(
        and(
          eq(subscriptionGrants.tenantId, tenantId),
          isNull(subscriptionGrants.revokedAt),
          sql`${subscriptionGrants.startsAt} <= NOW()`,
          sql`${subscriptionGrants.endsAt} > NOW()`
        )
      )
      .orderBy(desc(subscriptionGrants.endsAt))
      .limit(1);

    return {
      hasSubscription: false,
      status: activeGrant ? "active" as SubscriptionStatus : null,
      plan: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canAccess: !!activeGrant,
      isTrial: false,
      trialEndsAt: null,
      trialDaysRemaining: null,
      hadTrial: false,
      hasActiveGrant: !!activeGrant,
      grantEndsAt: activeGrant?.endsAt ?? null,
    };
  }

  const plan = subscription.planId ? await getPlanById(subscription.planId) : null;
  const now = new Date();
  
  // Check if this is an active trial
  const isTrial = subscription.status === "trialing" && 
    !!subscription.trialEndsAt && 
    new Date(subscription.trialEndsAt) > now;
  
  // Calculate trial days remaining
  let trialDaysRemaining: number | null = null;
  if (subscription.trialEndsAt && subscription.status === "trialing") {
    const msRemaining = new Date(subscription.trialEndsAt).getTime() - now.getTime();
    trialDaysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
  }
  
  // Determine access: active, trialing (with valid trial), past_due, canceled (before period end)
  const accessibleStatuses: SubscriptionStatus[] = ["active", "trialing", "past_due", "canceled"];
  let canAccess = accessibleStatuses.includes(subscription.status as SubscriptionStatus);
  
  // For trialing status, check if trial is still valid
  if (subscription.status === "trialing") {
    canAccess = isTrial;
  }
  
  // For active/past_due, check if period hasn't ended
  if (subscription.status === "active" || subscription.status === "past_due" || subscription.status === "canceled") {
    canAccess = canAccess && (!subscription.currentPeriodEnd || new Date(subscription.currentPeriodEnd) > now);
  }

  // Check for an active subscription grant (manual comp by platform admin)
  const [activeGrant] = await db
    .select({ endsAt: subscriptionGrants.endsAt })
    .from(subscriptionGrants)
    .where(
      and(
        eq(subscriptionGrants.tenantId, tenantId),
        isNull(subscriptionGrants.revokedAt),
        sql`${subscriptionGrants.startsAt} <= NOW()`,
        sql`${subscriptionGrants.endsAt} > NOW()`
      )
    )
    .orderBy(desc(subscriptionGrants.endsAt))
    .limit(1);

  const hasActiveGrant = !!activeGrant;
  const grantEndsAt = activeGrant?.endsAt ?? null;

  if (hasActiveGrant) {
    canAccess = true;
  }

  return {
    hasSubscription: true,
    status: hasActiveGrant ? "active" as SubscriptionStatus : subscription.status as SubscriptionStatus,
    plan,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
    canAccess,
    isTrial,
    trialEndsAt: subscription.trialEndsAt,
    trialDaysRemaining,
    hadTrial: subscription.hadTrial || false,
    hasActiveGrant,
    grantEndsAt,
  };
}

export async function cancelSubscription(tenantId: string): Promise<void> {
  const subscription = await getSubscriptionByTenant(tenantId);
  
  if (!subscription) {
    throw new Error("No subscription found");
  }

  await db
    .update(subscriptions)
    .set({
      cancelAtPeriodEnd: true,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.tenantId, tenantId));
  
  console.log(`[CryptoBilling] Subscription marked for cancellation: tenant ${tenantId}`);
}

// Trial duration: 72 hours (3 days)
const TRIAL_DURATION_HOURS = 72;

/**
 * Start a free trial for a tenant.
 * Rules:
 * - Trial can only be started once per tenant (hadTrial flag prevents re-use)
 * - Trial lasts 72 hours
 * - If tenant already had a paid subscription or expired trial, no new trial is allowed
 */
export async function startTrial(tenantId: string): Promise<{ success: boolean; reason?: string }> {
  const existingSub = await getSubscriptionByTenant(tenantId);
  
  // Check if tenant already had a trial or any subscription activity
  if (existingSub) {
    // If hadTrial is already set, deny trial
    if (existingSub.hadTrial) {
      console.log(`[CryptoBilling] Trial already used for tenant ${tenantId}`);
      return { success: false, reason: "Trial already used" };
    }
    
    // If trialStartedAt is set, tenant already had a trial (regardless of status)
    if (existingSub.trialStartedAt) {
      console.log(`[CryptoBilling] Tenant ${tenantId} already had trial (started at ${existingSub.trialStartedAt})`);
      return { success: false, reason: "Trial already used" };
    }
    
    // If they have any real subscription activity, don't start trial
    const blockedStatuses = ["active", "canceled", "past_due", "expired", "trialing", "incomplete", "unpaid", "paused"];
    if (blockedStatuses.includes(existingSub.status)) {
      console.log(`[CryptoBilling] Tenant ${tenantId} has existing subscription (${existingSub.status}), no trial needed`);
      return { success: false, reason: "Already has subscription" };
    }
  }
  
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DURATION_HOURS * 60 * 60 * 1000);
  
  if (existingSub) {
    // Update existing subscription to trialing
    await db
      .update(subscriptions)
      .set({
        status: "trialing",
        trialStartedAt: now,
        trialEndsAt: trialEndsAt,
        hadTrial: true,
        updatedAt: now,
      })
      .where(eq(subscriptions.tenantId, tenantId));
  } else {
    // Create new subscription with trial
    await db.insert(subscriptions).values({
      tenantId,
      status: "trialing",
      trialStartedAt: now,
      trialEndsAt: trialEndsAt,
      hadTrial: true,
      paymentProvider: "cryptobot",
    });
  }
  
  console.log(`[CryptoBilling] Started 72h trial for tenant ${tenantId}, expires at ${trialEndsAt.toISOString()}`);
  return { success: true };
}

/**
 * Check if a tenant is eligible for a trial
 */
export async function canStartTrial(tenantId: string): Promise<boolean> {
  const existingSub = await getSubscriptionByTenant(tenantId);
  
  if (!existingSub) {
    return true; // No subscription = eligible for trial
  }
  
  // Already had trial (hadTrial flag or trialStartedAt set)
  if (existingSub.hadTrial || existingSub.trialStartedAt) {
    return false;
  }
  
  // Any subscription record with a status means they already have/had subscription activity
  const blockedStatuses = ["active", "canceled", "past_due", "expired", "trialing", "incomplete", "unpaid", "paused"];
  if (blockedStatuses.includes(existingSub.status)) {
    return false;
  }
  
  return true;
}

/**
 * Create an expired subscription for a tenant.
 * Used when fraud detection prevents trial - tenant gets paywalled immediately.
 */
export async function createExpiredSubscription(tenantId: string): Promise<void> {
  const existingSub = await getSubscriptionByTenant(tenantId);
  
  if (existingSub) {
    // Update to expired status, mark hadTrial to prevent abuse
    await db
      .update(subscriptions)
      .set({
        status: "expired",
        hadTrial: true,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.tenantId, tenantId));
  } else {
    // Create new expired subscription
    await db.insert(subscriptions).values({
      tenantId,
      status: "expired",
      hadTrial: true,
      paymentProvider: "cryptobot",
    });
  }
  
  console.log(`[CryptoBilling] Created expired subscription for tenant ${tenantId} (fraud prevention)`);
}

export async function refreshExpiredSubscriptions(): Promise<void> {
  const now = new Date();
  
  // Process expired trials
  const trialingSubs = await db.select().from(subscriptions)
    .where(eq(subscriptions.status, "trialing"));
  
  for (const sub of trialingSubs) {
    if (sub.trialEndsAt && new Date(sub.trialEndsAt) < now) {
      await db
        .update(subscriptions)
        .set({
          status: "expired",
          updatedAt: now,
        })
        .where(eq(subscriptions.id, sub.id));
      console.log(`[CryptoBilling] Trial expired for tenant ${sub.tenantId}`);
    }
  }
  
  // Process expired active subscriptions
  const activeSubs = await db.select().from(subscriptions)
    .where(eq(subscriptions.status, "active"));
  
  for (const sub of activeSubs) {
    if (sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) < now) {
      if (sub.cancelAtPeriodEnd) {
        await db
          .update(subscriptions)
          .set({
            status: "canceled",
            canceledAt: now,
            updatedAt: now,
          })
          .where(eq(subscriptions.id, sub.id));
        console.log(`[CryptoBilling] Subscription expired and canceled: tenant ${sub.tenantId}`);
      } else {
        await db
          .update(subscriptions)
          .set({
            status: "past_due",
            updatedAt: now,
          })
          .where(eq(subscriptions.id, sub.id));
        console.log(`[CryptoBilling] Subscription expired, needs renewal: tenant ${sub.tenantId}`);
      }
    }
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const cryptoPayInstance = getCryptoPay();
    const me = await cryptoPayInstance.getMe();
    console.log(`[CryptoBilling] Connected as: ${me.name} (App ID: ${me.app_id})`);
    return true;
  } catch (error) {
    console.error("[CryptoBilling] Connection test failed:", error);
    return false;
  }
}
