import Stripe from "stripe";
import { db } from "../db";
import { plans, subscriptions, tenants, subscriptionGrants } from "@shared/schema";
import type { Plan, Subscription, SubscriptionStatus, BillingStatus } from "@shared/schema";
import { eq, and, lte, gte, isNull } from "drizzle-orm";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.warn("[Billing] STRIPE_SECRET_KEY not configured");
}

const stripe = STRIPE_SECRET_KEY 
  ? new Stripe(STRIPE_SECRET_KEY)
  : null;

const PLAN_CONFIG = {
  name: "AI Sales Operator Pro",
  amount: 5000, // $50.00 in cents
  currency: "usd",
  interval: "month" as const,
};

export async function getStripe(): Promise<Stripe> {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY environment variable.");
  }
  return stripe;
}

export async function ensurePlanExists(): Promise<Plan> {
  const [existingPlan] = await db.select().from(plans).where(eq(plans.isActive, true)).limit(1);
  
  if (existingPlan) {
    return existingPlan;
  }

  const stripeInstance = await getStripe();
  
  const product = await stripeInstance.products.create({
    name: PLAN_CONFIG.name,
    description: "Full access to AI Sales Operator platform",
  });

  const price = await stripeInstance.prices.create({
    product: product.id,
    unit_amount: PLAN_CONFIG.amount,
    currency: PLAN_CONFIG.currency,
    recurring: { interval: PLAN_CONFIG.interval },
  });

  const [plan] = await db.insert(plans).values({
    name: PLAN_CONFIG.name,
    stripePriceId: price.id,
    stripeProductId: product.id,
    amount: PLAN_CONFIG.amount,
    currency: PLAN_CONFIG.currency,
    interval: PLAN_CONFIG.interval,
    isActive: true,
  }).returning();

  console.log(`[Billing] Created plan: ${plan.name} (${price.id})`);
  return plan;
}

export async function getOrCreateStripeCustomer(tenantId: string, email: string): Promise<string> {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
  
  if (subscription?.stripeCustomerId) {
    return subscription.stripeCustomerId;
  }

  const stripeInstance = await getStripe();
  
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  
  const customer = await stripeInstance.customers.create({
    email,
    metadata: {
      tenantId,
      tenantName: tenant?.name || "Unknown",
    },
  });

  return customer.id;
}

export async function createCheckoutSession(
  tenantId: string, 
  email: string,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const stripeInstance = await getStripe();
  const plan = await ensurePlanExists();
  const customerId = await getOrCreateStripeCustomer(tenantId, email);

  const [existingSub] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
  
  if (existingSub?.status === "active") {
    throw new Error("Tenant already has an active subscription");
  }

  const session = await stripeInstance.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [
      {
        price: plan.stripePriceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      tenantId,
      planId: plan.id,
    },
    subscription_data: {
      metadata: {
        tenantId,
        planId: plan.id,
      },
    },
  });

  if (!existingSub) {
    await db.insert(subscriptions).values({
      tenantId,
      planId: plan.id,
      stripeCustomerId: customerId,
      status: "incomplete",
    });
  }

  return session.url!;
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  console.log(`[Billing] Processing webhook: ${event.type}`);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription) {
        await handleSubscriptionCreated(session.subscription as string, session.metadata?.tenantId);
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      await syncSubscription(subscription);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(subscription);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subId = (invoice as any).subscription;
      if (subId) {
        await updateSubscriptionStatus(subId as string, "past_due");
      }
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object;
      const subId = (invoice as any).subscription;
      if (subId) {
        await updateSubscriptionStatus(subId as string, "active");
      }
      break;
    }

    default:
      console.log(`[Billing] Unhandled event type: ${event.type}`);
  }
}

async function handleSubscriptionCreated(stripeSubscriptionId: string, tenantId?: string): Promise<void> {
  if (!tenantId) {
    console.error("[Billing] No tenantId in subscription metadata");
    return;
  }

  const stripeInstance = await getStripe();
  const stripeSub = await stripeInstance.subscriptions.retrieve(stripeSubscriptionId);
  
  await syncSubscription(stripeSub);
}

async function syncSubscription(stripeSub: Stripe.Subscription): Promise<void> {
  const tenantId = stripeSub.metadata?.tenantId;
  if (!tenantId) {
    console.error("[Billing] No tenantId in subscription metadata");
    return;
  }

  const status = mapStripeStatus(stripeSub.status);
  const subAny = stripeSub as any;
  
  await db
    .update(subscriptions)
    .set({
      stripeSubscriptionId: stripeSub.id,
      status,
      currentPeriodStart: subAny.current_period_start ? new Date(subAny.current_period_start * 1000) : null,
      currentPeriodEnd: subAny.current_period_end ? new Date(subAny.current_period_end * 1000) : null,
      cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
      canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
      trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.tenantId, tenantId));

  console.log(`[Billing] Synced subscription for tenant ${tenantId}: ${status}`);
}

async function handleSubscriptionDeleted(stripeSub: Stripe.Subscription): Promise<void> {
  const tenantId = stripeSub.metadata?.tenantId;
  if (!tenantId) return;

  await db
    .update(subscriptions)
    .set({
      status: "canceled",
      canceledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.tenantId, tenantId));

  console.log(`[Billing] Subscription deleted for tenant ${tenantId}`);
}

async function updateSubscriptionStatus(stripeSubscriptionId: string, status: SubscriptionStatus): Promise<void> {
  await db
    .update(subscriptions)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));
}

function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
  const statusMap: Record<string, SubscriptionStatus> = {
    trialing: "trialing",
    active: "active",
    past_due: "past_due",
    canceled: "canceled",
    unpaid: "unpaid",
    incomplete: "incomplete",
    incomplete_expired: "unpaid",
    paused: "paused",
  };
  return statusMap[stripeStatus] || "incomplete";
}

export async function getSubscriptionByTenant(tenantId: string): Promise<Subscription | null> {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
  return sub || null;
}

export async function getPlanById(planId: string): Promise<Plan | null> {
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
  return plan || null;
}

export async function hasActiveGrant(tenantId: string): Promise<{ hasGrant: boolean; grantEndsAt: Date | null }> {
  const now = new Date();
  const [grant] = await db
    .select()
    .from(subscriptionGrants)
    .where(
      and(
        eq(subscriptionGrants.tenantId, tenantId),
        lte(subscriptionGrants.startsAt, now),
        gte(subscriptionGrants.endsAt, now),
        isNull(subscriptionGrants.revokedAt)
      )
    )
    .limit(1);

  return {
    hasGrant: !!grant,
    grantEndsAt: grant?.endsAt || null,
  };
}

export async function getBillingStatus(tenantId: string): Promise<BillingStatus> {
  const subscription = await getSubscriptionByTenant(tenantId);
  const grantStatus = await hasActiveGrant(tenantId);
  
  if (!subscription) {
    return {
      hasSubscription: false,
      status: null,
      plan: null,
      currentPeriodEnd: grantStatus.grantEndsAt,
      cancelAtPeriodEnd: false,
      canAccess: grantStatus.hasGrant,
      isTrial: false,
      trialEndsAt: null,
      trialDaysRemaining: null,
      hadTrial: false,
      hasActiveGrant: grantStatus.hasGrant,
      grantEndsAt: grantStatus.grantEndsAt,
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
  
  // Determine access
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

  // Grant access if there's an active grant (OR with subscription access)
  const finalCanAccess = canAccess || grantStatus.hasGrant;

  return {
    hasSubscription: true,
    status: subscription.status as SubscriptionStatus,
    plan,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd || false,
    canAccess: finalCanAccess,
    isTrial,
    trialEndsAt: subscription.trialEndsAt,
    trialDaysRemaining,
    hadTrial: subscription.hadTrial || false,
    hasActiveGrant: grantStatus.hasGrant,
    grantEndsAt: grantStatus.grantEndsAt,
  };
}

export async function cancelSubscription(tenantId: string): Promise<void> {
  const subscription = await getSubscriptionByTenant(tenantId);
  
  if (!subscription?.stripeSubscriptionId) {
    throw new Error("No active subscription found");
  }

  const stripeInstance = await getStripe();
  
  await stripeInstance.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  await db
    .update(subscriptions)
    .set({
      cancelAtPeriodEnd: true,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.tenantId, tenantId));
}
