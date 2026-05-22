import { CryptoPay, Assets } from "@foile/crypto-pay-api";
import { db } from "../db";
import { plans, subscriptions, tenants, subscriptionGrants } from "@shared/schema";
import type { Plan, Subscription, SubscriptionStatus, BillingStatus, PlanFeatureType } from "@shared/schema";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import crypto from "crypto";
import { SUBSCRIPTION_PRICE_USDT, AI_SUBSCRIPTION_PRICE_USDT, TRIAL_PERIOD_HOURS, EXTRA_MAX_ACCOUNTS_PRICE_USDT } from "../config/business-constants";
import { getSecret } from "./secret-resolver";

async function getCryptoPayToken(): Promise<string | null> {
  const fromDb = await getSecret({ scope: "global", keyName: "CRYPTO_PAY_API_TOKEN" });
  return fromDb ?? process.env.CRYPTO_PAY_API_TOKEN ?? null;
}

async function getIsTestnet(): Promise<boolean> {
  const fromDb = await getSecret({ scope: "global", keyName: "CRYPTO_PAY_TESTNET" });
  if (fromDb !== null) return fromDb === "true";
  return process.env.CRYPTO_PAY_TESTNET === "true";
}

export async function getSubscriptionPriceUsdt(): Promise<number> {
  const val = await getSecret({ scope: "global", keyName: "PRICE_SUBSCRIPTION_USDT" });
  if (val !== null) {
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) return n;
  }
  return SUBSCRIPTION_PRICE_USDT;
}

export async function getAiSubscriptionPriceUsdt(): Promise<number> {
  const val = await getSecret({ scope: "global", keyName: "PRICE_AI_AGENT_USDT" });
  if (val !== null) {
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) return n;
  }
  return AI_SUBSCRIPTION_PRICE_USDT;
}

export async function getExtraAccountPriceUsdt(): Promise<number> {
  const val = await getSecret({ scope: "global", keyName: "PRICE_EXTRA_MAX_ACCOUNT_USDT" });
  if (val !== null) {
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) return n;
  }
  return EXTRA_MAX_ACCOUNTS_PRICE_USDT;
}

export async function getTrialPeriodHours(): Promise<number> {
  const val = await getSecret({ scope: "global", keyName: "PRICE_TRIAL_HOURS" });
  if (val !== null) {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return TRIAL_PERIOD_HOURS;
}

const PLAN_CONFIG = {
  name: "AI Sales Operator Pro",
  planType: "channels" as PlanFeatureType,
  amount: SUBSCRIPTION_PRICE_USDT * 100, // USD cents
  currency: "usd",
  cryptoAmount: String(SUBSCRIPTION_PRICE_USDT),
  cryptoAsset: "USDT",
  interval: "month" as const,
};

const AI_PLAN_CONFIG = {
  name: "AI Agent",
  planType: "ai_agent" as PlanFeatureType,
  amount: AI_SUBSCRIPTION_PRICE_USDT * 100,
  currency: "usd",
  cryptoAmount: String(AI_SUBSCRIPTION_PRICE_USDT),
  cryptoAsset: "USDT",
  interval: "month" as const,
};

const EXTRA_ACCOUNTS_PLAN_CONFIG = {
  name: "MAX Personal — дополнительные аккаунты",
  planType: "extra_max_accounts" as PlanFeatureType,
  amount: EXTRA_MAX_ACCOUNTS_PRICE_USDT * 100,
  currency: "usd",
  cryptoAmount: String(EXTRA_MAX_ACCOUNTS_PRICE_USDT),
  cryptoAsset: "USDT",
  interval: "month" as const,
};

export async function getCryptoPay(): Promise<CryptoPay> {
  const [token, isTestnet] = await Promise.all([getCryptoPayToken(), getIsTestnet()]);
  if (!token) {
    throw new Error("CryptoBot is not configured. Set CRYPTO_PAY_API_TOKEN environment variable or add it via admin panel.");
  }
  return new CryptoPay(token, {
    hostname: isTestnet ? "testnet-pay.crypt.bot" : "pay.crypt.bot",
    protocol: "https",
  });
}

export async function ensurePlanExists(): Promise<Plan> {
  const [existingPlan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.isActive, true), eq(plans.planType, "channels")))
    .limit(1);

  if (existingPlan) {
    return existingPlan;
  }

  const [plan] = await db.insert(plans).values({
    name: PLAN_CONFIG.name,
    planType: PLAN_CONFIG.planType,
    amount: PLAN_CONFIG.amount,
    currency: PLAN_CONFIG.currency,
    cryptoAmount: PLAN_CONFIG.cryptoAmount,
    cryptoAsset: PLAN_CONFIG.cryptoAsset,
    interval: PLAN_CONFIG.interval,
    isActive: true,
  }).returning();

  console.log(`[CryptoBilling] Created channels plan: ${plan.name}`);
  return plan;
}

export async function ensureAiPlanExists(): Promise<Plan> {
  const [existingPlan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.isActive, true), eq(plans.planType, "ai_agent")))
    .limit(1);

  if (existingPlan) {
    return existingPlan;
  }

  const [plan] = await db.insert(plans).values({
    name: AI_PLAN_CONFIG.name,
    planType: AI_PLAN_CONFIG.planType,
    amount: AI_PLAN_CONFIG.amount,
    currency: AI_PLAN_CONFIG.currency,
    cryptoAmount: AI_PLAN_CONFIG.cryptoAmount,
    cryptoAsset: AI_PLAN_CONFIG.cryptoAsset,
    interval: AI_PLAN_CONFIG.interval,
    isActive: true,
  }).returning();

  console.log(`[CryptoBilling] Created AI Agent plan: ${plan.name}`);
  return plan;
}

export async function createInvoice(
  tenantId: string,
  successUrl: string
): Promise<{ payUrl: string; invoiceId: number }> {
  const [cryptoPayInstance, plan, priceUsdt] = await Promise.all([
    getCryptoPay(),
    ensurePlanExists(),
    getSubscriptionPriceUsdt(),
  ]);

  const [existingSub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "channels")));

  if (existingSub?.status === "active") {
    throw new Error("Tenant already has an active channels subscription");
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));

  const invoice = await cryptoPayInstance.createInvoice(
    Assets.USDT,
    String(priceUsdt),
    {
      description: `${plan.name} - месячная подписка`,
      expires_in: 3600,
      paid_btn_name: "callback" as any,
      paid_btn_url: successUrl,
      payload: JSON.stringify({
        tenantId,
        planId: plan.id,
        feature: "channels",
        tenantName: tenant?.name || "Unknown",
      }),
      allow_comments: false,
      allow_anonymous: false,
    }
  );

  if (!existingSub) {
    await db.insert(subscriptions).values({
      tenantId,
      feature: "channels",
      planId: plan.id,
      cryptoInvoiceId: String(invoice.invoice_id),
      paymentProvider: "cryptobot",
      status: "incomplete",
    });
  } else if (existingSub.status === "trialing") {
    // Keep trial access while payment is pending — only store the new invoice ID
    await db
      .update(subscriptions)
      .set({
        planId: plan.id,
        cryptoInvoiceId: String(invoice.invoice_id),
        paymentProvider: "cryptobot",
        updatedAt: new Date(),
      })
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "channels")));
  } else {
    await db
      .update(subscriptions)
      .set({
        cryptoInvoiceId: String(invoice.invoice_id),
        paymentProvider: "cryptobot",
        status: "incomplete",
        updatedAt: new Date(),
      })
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "channels")));
  }

  console.log(`[CryptoBilling] Created channels invoice ${invoice.invoice_id} for tenant ${tenantId}`);
  return { payUrl: invoice.pay_url, invoiceId: invoice.invoice_id };
}

export async function createAiInvoice(
  tenantId: string,
  successUrl: string
): Promise<{ payUrl: string; invoiceId: number }> {
  const [cryptoPayInstance, plan, priceUsdt] = await Promise.all([
    getCryptoPay(),
    ensureAiPlanExists(),
    getAiSubscriptionPriceUsdt(),
  ]);

  const [existingSub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "ai_agent")));

  if (existingSub?.status === "active") {
    throw new Error("Tenant already has an active AI Agent subscription");
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));

  const invoice = await cryptoPayInstance.createInvoice(
    Assets.USDT,
    String(priceUsdt),
    {
      description: `${plan.name} - месячная подписка`,
      expires_in: 3600,
      paid_btn_name: "callback" as any,
      paid_btn_url: successUrl,
      payload: JSON.stringify({
        tenantId,
        planId: plan.id,
        feature: "ai_agent",
        tenantName: tenant?.name || "Unknown",
      }),
      allow_comments: false,
      allow_anonymous: false,
    }
  );

  if (!existingSub) {
    await db.insert(subscriptions).values({
      tenantId,
      feature: "ai_agent",
      planId: plan.id,
      cryptoInvoiceId: String(invoice.invoice_id),
      paymentProvider: "cryptobot",
      status: "incomplete",
    });
  } else if (existingSub.status === "trialing") {
    await db
      .update(subscriptions)
      .set({
        planId: plan.id,
        cryptoInvoiceId: String(invoice.invoice_id),
        paymentProvider: "cryptobot",
        updatedAt: new Date(),
      })
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "ai_agent")));
  } else {
    await db
      .update(subscriptions)
      .set({
        cryptoInvoiceId: String(invoice.invoice_id),
        paymentProvider: "cryptobot",
        status: "incomplete",
        updatedAt: new Date(),
      })
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "ai_agent")));
  }

  console.log(`[CryptoBilling] Created AI Agent invoice ${invoice.invoice_id} for tenant ${tenantId}`);
  return { payUrl: invoice.pay_url, invoiceId: invoice.invoice_id };
}

export async function ensureExtraAccountsPlanExists(): Promise<Plan> {
  const [existingPlan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.isActive, true), eq(plans.planType, "extra_max_accounts")))
    .limit(1);

  if (existingPlan) return existingPlan;

  const [plan] = await db.insert(plans).values({
    name: EXTRA_ACCOUNTS_PLAN_CONFIG.name,
    planType: EXTRA_ACCOUNTS_PLAN_CONFIG.planType,
    amount: EXTRA_ACCOUNTS_PLAN_CONFIG.amount,
    currency: EXTRA_ACCOUNTS_PLAN_CONFIG.currency,
    cryptoAmount: EXTRA_ACCOUNTS_PLAN_CONFIG.cryptoAmount,
    cryptoAsset: EXTRA_ACCOUNTS_PLAN_CONFIG.cryptoAsset,
    interval: EXTRA_ACCOUNTS_PLAN_CONFIG.interval,
    isActive: true,
  }).returning();

  console.log(`[CryptoBilling] Created extra_max_accounts plan: ${plan.name}`);
  return plan;
}

export async function createExtraAccountsInvoice(
  tenantId: string,
  successUrl: string
): Promise<{ payUrl: string; invoiceId: number }> {
  const [cryptoPayInstance, plan, priceUsdt] = await Promise.all([
    getCryptoPay(),
    ensureExtraAccountsPlanExists(),
    getExtraAccountPriceUsdt(),
  ]);

  const [existingSub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "extra_max_accounts")));

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));

  const currentSlots = existingSub?.extraSlots ?? 0;

  const invoice = await cryptoPayInstance.createInvoice(
    Assets.USDT,
    String(priceUsdt),
    {
      description: `${plan.name} — 1 дополнительный аккаунт`,
      expires_in: 3600,
      paid_btn_name: "callback" as any,
      paid_btn_url: successUrl,
      payload: JSON.stringify({
        tenantId,
        planId: plan.id,
        feature: "extra_max_accounts",
        tenantName: tenant?.name || "Unknown",
      }),
      allow_comments: false,
      allow_anonymous: false,
    }
  );

  if (!existingSub) {
    // First extra-account purchase: create record with 0 slots (slot added on payment)
    await db.insert(subscriptions).values({
      tenantId,
      feature: "extra_max_accounts",
      planId: plan.id,
      cryptoInvoiceId: String(invoice.invoice_id),
      paymentProvider: "cryptobot",
      status: "incomplete",
    });
  } else {
    // Subsequent purchases (even if already active): just store new invoice ID
    await db
      .update(subscriptions)
      .set({
        planId: plan.id,
        cryptoInvoiceId: String(invoice.invoice_id),
        paymentProvider: "cryptobot",
        updatedAt: new Date(),
      })
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "extra_max_accounts")));
  }

  console.log(`[CryptoBilling] Created extra_max_accounts invoice ${invoice.invoice_id} for tenant ${tenantId} (current slots: ${currentSlots})`);
  return { payUrl: invoice.pay_url, invoiceId: invoice.invoice_id };
}

export async function getExtraAccountsSubscriptionByTenant(tenantId: string): Promise<Subscription | null> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "extra_max_accounts")));
  return sub || null;
}

export async function getExtraAccountsBillingStatus(tenantId: string): Promise<BillingStatus> {
  const subscription = await getExtraAccountsSubscriptionByTenant(tenantId);

  const [activeGrant] = await db
    .select({ endsAt: subscriptionGrants.endsAt })
    .from(subscriptionGrants)
    .where(
      and(
        eq(subscriptionGrants.tenantId, tenantId),
        eq(subscriptionGrants.feature, "extra_max_accounts"),
        isNull(subscriptionGrants.revokedAt),
        sql`${subscriptionGrants.startsAt} <= NOW()`,
        sql`${subscriptionGrants.endsAt} > NOW()`
      )
    )
    .orderBy(desc(subscriptionGrants.endsAt))
    .limit(1);

  const hasActiveGrant = !!activeGrant;
  const grantEndsAt = activeGrant?.endsAt ?? null;

  if (!subscription) {
    return {
      hasSubscription: false,
      status: hasActiveGrant ? "active" as SubscriptionStatus : null,
      plan: null,
      currentPeriodEnd: grantEndsAt,
      cancelAtPeriodEnd: false,
      canAccess: hasActiveGrant,
      isTrial: false,
      trialEndsAt: null,
      trialDaysRemaining: null,
      hadTrial: false,
      hasActiveGrant,
      grantEndsAt,
      extraSlots: 0,
    };
  }

  const plan = subscription.planId ? await getPlanById(subscription.planId) : null;
  const now = new Date();

  const extraSlots = subscription.extraSlots ?? 0;
  // canAccess = true when tenant has at least 1 paid extra slot
  let canAccess = extraSlots > 0;

  if (hasActiveGrant) canAccess = true;

  return {
    hasSubscription: true,
    status: hasActiveGrant ? "active" as SubscriptionStatus : (extraSlots > 0 ? "active" as SubscriptionStatus : subscription.status as SubscriptionStatus),
    plan,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
    canAccess,
    isTrial: false,
    trialEndsAt: null,
    trialDaysRemaining: null,
    hadTrial: false,
    hasActiveGrant,
    grantEndsAt,
    extraSlots,
  };
}

export async function cancelExtraAccountsSubscription(tenantId: string): Promise<void> {
  const subscription = await getExtraAccountsSubscriptionByTenant(tenantId);
  if (!subscription) throw new Error("No extra accounts subscription found");

  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "extra_max_accounts")));

  console.log(`[CryptoBilling] Extra accounts subscription marked for cancellation: tenant ${tenantId}`);
}

export async function checkInvoiceStatus(invoiceId: string): Promise<"active" | "paid" | "expired"> {
  const cryptoPayInstance = await getCryptoPay();
  
  const result = await cryptoPayInstance.getInvoices({
    invoice_ids: [Number(invoiceId)],
  });

  // CryptoPay API returns { items: [...] } not a direct array
  const invoices: any[] = Array.isArray(result) ? result : ((result as any)?.items ?? []);

  if (invoices.length === 0) {
    throw new Error(`Invoice ${invoiceId} not found in CryptoPay`);
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

export async function verifyWebhookSignature(body: string, signature: string): Promise<boolean> {
  const token = await getCryptoPayToken();
  if (!token) {
    console.error("[CryptoBilling] Cannot verify webhook: no API token");
    return false;
  }

  const secret = crypto.createHash("sha256").update(token).digest();
  const hmac = crypto.createHmac("sha256", secret).update(body).digest("hex");
  
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

  const rawFeature = (metadata as any).feature;
  const feature: PlanFeatureType =
    rawFeature === "ai_agent" ? "ai_agent" :
    rawFeature === "extra_max_accounts" ? "extra_max_accounts" :
    "channels";

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  if (feature === "extra_max_accounts") {
    // Per-slot model: each payment adds exactly 1 extra account slot
    const [existing] = await db
      .select({ extraSlots: subscriptions.extraSlots })
      .from(subscriptions)
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "extra_max_accounts")));

    const currentSlots = existing?.extraSlots ?? 0;
    const newSlots = currentSlots + 1;

    await db
      .update(subscriptions)
      .set({
        status: "active",
        extraSlots: newSlots,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        updatedAt: now,
      })
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "extra_max_accounts")));

    console.log(`[CryptoBilling] Extra account slot added for tenant ${tenantId}: ${currentSlots} → ${newSlots} slots`);
    return;
  }

  await db
    .update(subscriptions)
    .set({
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      updatedAt: now,
    })
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, feature)));

  console.log(`[CryptoBilling] Activated ${feature} subscription for tenant ${tenantId} until ${periodEnd.toISOString()}`);
}

export async function getSubscriptionByTenant(tenantId: string): Promise<Subscription | null> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "channels")));
  return sub || null;
}

export async function getAiSubscriptionByTenant(tenantId: string): Promise<Subscription | null> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "ai_agent")));
  return sub || null;
}

export async function getPlanById(planId: string): Promise<Plan | null> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  return plan || null;
}

export async function getBillingStatus(tenantId: string): Promise<BillingStatus> {
  const subscription = await getSubscriptionByTenant(tenantId);
  
  if (!subscription) {
    // Even without a subscription record, check for an active channels grant
    const [activeGrant] = await db
      .select({ endsAt: subscriptionGrants.endsAt })
      .from(subscriptionGrants)
      .where(
        and(
          eq(subscriptionGrants.tenantId, tenantId),
          eq(subscriptionGrants.feature, "channels"),
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

  // Check for an active channels subscription grant (manual comp by platform admin)
  const [activeGrant] = await db
    .select({ endsAt: subscriptionGrants.endsAt })
    .from(subscriptionGrants)
    .where(
      and(
        eq(subscriptionGrants.tenantId, tenantId),
        eq(subscriptionGrants.feature, "channels"),
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

/** Billing status for the AI Agent subscription (feature = 'ai_agent'). No trial support. */
export async function getAiBillingStatus(tenantId: string): Promise<BillingStatus> {
  const subscription = await getAiSubscriptionByTenant(tenantId);

  // Check for an active ai_agent grant (manual comp by platform admin)
  const [aiGrant] = await db
    .select({ endsAt: subscriptionGrants.endsAt })
    .from(subscriptionGrants)
    .where(
      and(
        eq(subscriptionGrants.tenantId, tenantId),
        eq(subscriptionGrants.feature, "ai_agent"),
        isNull(subscriptionGrants.revokedAt),
        sql`${subscriptionGrants.startsAt} <= NOW()`,
        sql`${subscriptionGrants.endsAt} > NOW()`
      )
    )
    .orderBy(desc(subscriptionGrants.endsAt))
    .limit(1);

  const hasActiveGrant = !!aiGrant;
  const grantEndsAt = aiGrant?.endsAt ?? null;

  if (!subscription) {
    return {
      hasSubscription: false,
      status: hasActiveGrant ? "active" as SubscriptionStatus : null,
      plan: null,
      currentPeriodEnd: grantEndsAt,
      cancelAtPeriodEnd: false,
      canAccess: hasActiveGrant,
      isTrial: false,
      trialEndsAt: null,
      trialDaysRemaining: null,
      hadTrial: false,
      hasActiveGrant,
      grantEndsAt,
    };
  }

  const plan = subscription.planId ? await getPlanById(subscription.planId) : null;
  const now = new Date();

  const accessibleStatuses: SubscriptionStatus[] = ["active", "past_due"];
  let canAccess = accessibleStatuses.includes(subscription.status as SubscriptionStatus);

  if (canAccess && subscription.currentPeriodEnd) {
    canAccess = new Date(subscription.currentPeriodEnd) > now;
  }

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
    isTrial: false,
    trialEndsAt: null,
    trialDaysRemaining: null,
    hadTrial: false,
    hasActiveGrant,
    grantEndsAt,
  };
}

export async function cancelSubscription(tenantId: string): Promise<void> {
  const subscription = await getSubscriptionByTenant(tenantId);

  if (!subscription) {
    throw new Error("No channels subscription found");
  }

  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "channels")));

  console.log(`[CryptoBilling] Channels subscription marked for cancellation: tenant ${tenantId}`);
}

export async function cancelAiSubscription(tenantId: string): Promise<void> {
  const subscription = await getAiSubscriptionByTenant(tenantId);

  if (!subscription) {
    throw new Error("No AI Agent subscription found");
  }

  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "ai_agent")));

  console.log(`[CryptoBilling] AI Agent subscription marked for cancellation: tenant ${tenantId}`);
}

/**
 * Start a free trial for a tenant.
 * Rules:
 * - Trial can only be started once per tenant (hadTrial flag prevents re-use)
 * - Trial lasts TRIAL_PERIOD_HOURS hours
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
  const trialHours = await getTrialPeriodHours();
  const trialEndsAt = new Date(now.getTime() + trialHours * 60 * 60 * 1000);
  
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
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "channels")));
  } else {
    // Create new subscription with trial
    await db.insert(subscriptions).values({
      tenantId,
      feature: "channels",
      status: "trialing",
      trialStartedAt: now,
      trialEndsAt: trialEndsAt,
      hadTrial: true,
      paymentProvider: "cryptobot",
    });
  }
  
  console.log(`[CryptoBilling] Started ${TRIAL_PERIOD_HOURS}h trial for tenant ${tenantId}, expires at ${trialEndsAt.toISOString()}`);
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
      .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.feature, "channels")));
  } else {
    // Create new expired subscription
    await db.insert(subscriptions).values({
      tenantId,
      feature: "channels",
      status: "expired",
      hadTrial: true,
      paymentProvider: "cryptobot",
    });
  }

  console.log(`[CryptoBilling] Created expired channels subscription for tenant ${tenantId} (fraud prevention)`);
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
    const cryptoPayInstance = await getCryptoPay();
    const me = await cryptoPayInstance.getMe();
    console.log(`[CryptoBilling] Connected as: ${me.name} (App ID: ${me.app_id})`);
    return true;
  } catch (error) {
    console.error("[CryptoBilling] Connection test failed:", error);
    return false;
  }
}
